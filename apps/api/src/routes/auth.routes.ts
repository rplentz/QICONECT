import { Router } from "express";
import { z } from "zod";
import { db } from "../db/database.js";
import { requireAuth, getAuth } from "../middleware/auth.js";
import { verifyPassword } from "../security/password.js";
import { clearSessionCookie, createSessionToken, hashSessionToken, sessionExpiry, setSessionCookie } from "../security/session.js";
import { HttpError } from "../utils/http-error.js";

export const authRouter = Router();
const roleNames: Record<number, "CLINIC_ADMIN" | "THERAPIST" | "PATIENT"> = { 1: "CLINIC_ADMIN", 2: "CLINIC_ADMIN", 3: "THERAPIST", 4: "PATIENT" };
const idSchema = z.coerce.number().int().positive();
const sessionCookieToken = (request: import("express").Request) => request.headers.cookie?.split(";").map((part) => part.trim())
  .find((part) => part.startsWith("qiconect_session="))?.slice("qiconect_session=".length);

authRouter.post("/login", async (request, response) => {
  const input = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) }).safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: { code: "INVALID_INPUT", message: "Informe um e-mail e uma senha válidos." } });
    return;
  }
  const user = db.prepare("SELECT id,email,senha,nome FROM USUARIO WHERE email=? COLLATE NOCASE")
    .get(input.data.email.trim()) as { id: number; email: string; senha: string; nome: string } | undefined;
  // The current workbook explicitly keeps test passwords in plain text; hashing is a later phase.
  if (!user || (user.senha !== input.data.password && !(await verifyPassword(input.data.password, user.senha)))) {
    response.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha incorretos." } });
    return;
  }
  const clinics = db.prepare(
    `SELECT uc.id AS userClinicId, uc.perfil_id AS profileId, p.nome AS profileName,
            c.id AS clinicId, c.nome AS clinicName
     FROM USUARIO_CLINICA uc JOIN CLINICA c ON c.id=uc.clinica_id
     JOIN PERFIL p ON p.id=uc.perfil_id WHERE uc.usuario_id=? AND uc.status=1 AND c.status=1 ORDER BY c.nome`,
  ).all(user.id) as Array<{ userClinicId: number; profileId: number; profileName: string; clinicId: number; clinicName: string }>;
  if (!clinics.length) {
    response.status(403).json({ error: { code: "NO_CLINIC_ACCESS", message: "Esta conta não possui vínculo ativo com uma clínica." } });
    return;
  }
  const token = createSessionToken();
  const selected = clinics[0];
  db.prepare("DELETE FROM sessions WHERE user_id=? OR expires_at<=?").run(user.id, new Date().toISOString());
  db.prepare("UPDATE USUARIO SET dt_ult_acesso=?,dt_atualizacao=? WHERE id=?").run(new Date().toISOString(), new Date().toISOString(), user.id);
  const patientId=selected.profileId===4?(db.prepare("SELECT id FROM PACIENTE WHERE usuario_id=? AND clinica_id=?").pluck().get(user.id,selected.clinicId) as number|undefined)??null:null;
  const therapistId=selected.profileId===3?(db.prepare("SELECT id FROM TERAPEUTA WHERE usuario_id=?").pluck().get(user.id) as number|undefined)??null:null;
  db.prepare("INSERT INTO sessions(token_hash,user_id,clinic_id,user_clinic_id,patient_id,therapist_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(hashSessionToken(token), user.id, selected.clinicId, selected.userClinicId, patientId, therapistId, sessionExpiry(), new Date().toISOString());
  setSessionCookie(response, token);
  response.json({
    user: { id: String(user.id), email: user.email, fullName: user.nome },
    clinics: clinics.map((c) => ({ userClinicId: String(c.userClinicId), role: roleNames[c.profileId], clinicId: String(c.clinicId), clinicName: c.clinicName })),
    activeClinicId: String(selected.clinicId),
  });
});

authRouter.post("/logout", requireAuth, (request, response) => {
  const token = sessionCookieToken(request);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hashSessionToken(token));
  clearSessionCookie(response);
  response.status(204).end();
});

authRouter.get("/me", requireAuth, (request, response) => {
  const auth = getAuth(request);
  const clinics = db.prepare(
    `SELECT uc.id AS userClinicId, uc.perfil_id AS profileId, c.id AS clinicId, c.nome AS clinicName
     FROM USUARIO_CLINICA uc JOIN CLINICA c ON c.id=uc.clinica_id
     WHERE uc.usuario_id=? AND uc.status=1 AND c.status=1 ORDER BY c.nome`,
  ).all(auth.userId) as Array<{ userClinicId: number; profileId: number; clinicId: number; clinicName: string }>;
  response.json({
    user: { id: auth.userId, email: auth.email, fullName: auth.fullName },
    activeClinic: { id: auth.clinicId, name: auth.clinicName, timezone: auth.clinicTimezone, role: auth.role },
    clinics: clinics.map((clinic) => ({ userClinicId: String(clinic.userClinicId), role: roleNames[clinic.profileId], clinicId: String(clinic.clinicId), clinicName: clinic.clinicName })),
  });
});

authRouter.post("/clinic", requireAuth, (request, response, next) => {
  try {
    const clinicId = idSchema.parse(z.object({ clinicId: z.union([z.string(), z.number()]) }).parse(request.body).clinicId);
    const auth = getAuth(request);
    const membership = db.prepare("SELECT id FROM USUARIO_CLINICA WHERE clinica_id=? AND usuario_id=? AND status=1")
      .get(clinicId, auth.userId) as { id: number } | undefined;
    if (!membership) throw new HttpError(403, "FORBIDDEN", "Você não tem vínculo com esta clínica.");
    const token = sessionCookieToken(request);
    if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Faça login para continuar.");
    const profileId=Number(db.prepare("SELECT perfil_id FROM USUARIO_CLINICA WHERE id=?").pluck().get(membership.id));
    const patientId=profileId===4?(db.prepare("SELECT id FROM PACIENTE WHERE usuario_id=? AND clinica_id=?").pluck().get(Number(auth.userId),clinicId) as number|undefined)??null:null;
    const therapistId=profileId===3?(db.prepare("SELECT id FROM TERAPEUTA WHERE usuario_id=?").pluck().get(Number(auth.userId)) as number|undefined)??null:null;
    db.prepare("UPDATE sessions SET clinic_id=?,user_clinic_id=?,patient_id=?,therapist_id=? WHERE token_hash=?")
      .run(clinicId, membership.id, patientId, therapistId, hashSessionToken(token));
    response.json({ activeClinicId: String(clinicId) });
  } catch (error) { next(error); }
});
