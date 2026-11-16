import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/database.js";
import { requireAuth, getAuth } from "../middleware/auth.js";
import { verifyPassword } from "../security/password.js";
import {
  clearSessionCookie,
  createSessionToken,
  hashSessionToken,
  sessionExpiry,
  setSessionCookie,
} from "../security/session.js";
import { writeAudit } from "../services/audit.js";
import { HttpError } from "../utils/http-error.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
});

authRouter.post("/login", async (request, response) => {
  const input = loginSchema.safeParse(request.body);
  if (!input.success) {
    response.status(400).json({ error: { code: "INVALID_INPUT", message: "Informe um e-mail e uma senha válidos." } });
    return;
  }

  const email = input.data.email.trim().toLowerCase();
  const user = db
    .prepare("SELECT id, email, password_hash AS passwordHash, nome AS fullName FROM USUARIO WHERE email = ? AND ativo = 1")
    .get(email) as { id: string; email: string; passwordHash: string; fullName: string } | undefined;

  if (!user || !(await verifyPassword(input.data.password, user.passwordHash))) {
    response.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha incorretos." } });
    return;
  }

  const memberships = db
    .prepare(
      `SELECT m.id AS membershipId, m.role, c.id AS clinicId, c.nome AS clinicName
       FROM memberships m JOIN CLINICA c ON c.id = m.clinic_id
       WHERE m.user_id = ? AND m.status = 'ACTIVE' AND c.ativo = 1 ORDER BY c.nome`,
    )
    .all(user.id) as Array<{ membershipId: string; role: string; clinicId: string; clinicName: string }>;

  if (memberships.length === 0) {
    response.status(403).json({ error: { code: "NO_CLINIC_ACCESS", message: "Esta conta não possui vínculo ativo com uma clínica." } });
    return;
  }

  const token = createSessionToken();
  const currentClinic = memberships[0];
  db.prepare("DELETE FROM sessions WHERE user_id = ? OR expires_at <= ?").run(user.id, new Date().toISOString());
  db.prepare("UPDATE USUARIO SET dt_ult_acesso = ?, dt_atualizacao = ? WHERE id = ?").run(
    new Date().toISOString(),
    new Date().toISOString(),
    user.id,
  );
  db.prepare("INSERT INTO sessions (token_hash, user_id, clinic_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)").run(
    hashSessionToken(token),
    user.id,
    currentClinic.clinicId,
    sessionExpiry(),
    new Date().toISOString(),
  );

  setSessionCookie(response, token);
  response.json({
    user: { id: user.id, email: user.email, fullName: user.fullName },
    clinics: memberships,
    activeClinicId: currentClinic.clinicId,
  });
});

authRouter.post("/logout", requireAuth, (request, response) => {
  const token = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("qiconect_session="))
    ?.slice("qiconect_session=".length);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
  clearSessionCookie(response);
  response.status(204).end();
});

authRouter.get("/me", requireAuth, (request, response) => {
  const auth = getAuth(request);
  const clinics = db
    .prepare(
      `SELECT m.id AS membershipId, m.role, c.id AS clinicId, c.nome AS clinicName
       FROM memberships m JOIN CLINICA c ON c.id = m.clinic_id
       WHERE m.user_id = ? AND m.status = 'ACTIVE' AND c.ativo = 1 ORDER BY c.nome`,
    )
    .all(auth.userId);

  response.json({
    user: { id: auth.userId, email: auth.email, fullName: auth.fullName },
    activeClinic: { id: auth.clinicId, name: auth.clinicName, timezone: auth.clinicTimezone, role: auth.role },
    clinics,
  });
});

authRouter.post("/clinic", requireAuth, (request, response, next) => {
  try {
    const input = z.object({ clinicId: z.string().uuid() }).parse(request.body);
    const auth = getAuth(request);
    const membership = db
      .prepare("SELECT id FROM memberships WHERE clinic_id = ? AND user_id = ? AND status = 'ACTIVE'")
      .get(input.clinicId, auth.userId) as { id: string } | undefined;
    if (!membership) throw new HttpError(403, "FORBIDDEN", "Você não tem vínculo com esta clínica.");

    const token = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("qiconect_session="))
      ?.slice("qiconect_session=".length);
    if (!token) throw new HttpError(401, "UNAUTHENTICATED", "Faça login para continuar.");

    db.prepare("UPDATE sessions SET clinic_id = ? WHERE token_hash = ?").run(input.clinicId, hashSessionToken(token));
    writeAudit(auth, "clinic.context.changed", "clinic", input.clinicId);
    response.json({ activeClinicId: input.clinicId });
  } catch (error) {
    next(error);
  }
});
