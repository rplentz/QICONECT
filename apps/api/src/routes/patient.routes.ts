import { Router } from "express";
import { z } from "zod";
import { db } from "../db/database.js";
import { getAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { createClinicAccount } from "../services/accounts.js";
import { HttpError } from "../utils/http-error.js";

export const patientRouter = Router();
const patientSelect = `SELECT p.id AS id,u.nome AS fullName,u.email,p.telefone AS phone,p.dt_nasc AS birthDate,p.cpf,
  p.endereco AS address,p.sexo AS sex,p.Signo AS zodiacSign,
  (SELECT MAX(a.dt_inicio) FROM AGENDA a WHERE a.paciente_id=p.id AND a.status<>4) AS lastAppointmentAt
  FROM PACIENTE p JOIN USUARIO u ON u.id=p.usuario_id JOIN USUARIO_CLINICA uc ON uc.usuario_id=u.id AND uc.clinica_id=p.clinica_id AND uc.perfil_id=4 AND uc.status=1`;

patientRouter.get("/patients", requireAuth, (request, response) => {
  const auth = getAuth(request);
  const search = z.string().trim().max(100).optional().parse(request.query.search);
  const filterSelf = auth.role === "PATIENT" ? " AND p.usuario_id=?" : "";
  const rows = db.prepare(`${patientSelect} WHERE p.clinica_id=?${filterSelf}
    AND (? IS NULL OR u.nome LIKE ? OR u.email LIKE ? OR p.cpf LIKE ?) ORDER BY u.nome LIMIT 200`)
    .all(Number(auth.clinicId), ...(auth.role === "PATIENT" ? [Number(auth.userId)] : []), search ?? null,
      search ? `%${search}%` : null, search ? `%${search}%` : null, search ? `%${search}%` : null);
  response.json({ patients: rows });
});

patientRouter.post("/patients", requireAuth, requireRole("THERAPIST"), async (request, response, next) => {
  try {
    const input = z.object({ fullName: z.string().trim().min(2).max(120), email: z.string().email().max(254),
      phone: z.string().max(30).optional(), password: z.string().min(1).max(128), birthDate: z.string().optional(),
      cpf: z.string().trim().max(14).optional(), sex: z.string().optional(), address: z.string().optional() }).parse(request.body);
    const created = await createClinicAccount({ clinicId: getAuth(request).clinicId, email: input.email, fullName: input.fullName,
      phone: input.phone, password: input.password, role: "PATIENT" }, (_linkId, userId) => {
      db.prepare("INSERT INTO PACIENTE(usuario_id,clinica_id,cpf,dt_nasc,telefone,sexo,endereco) VALUES(?,?,?,?,?,?,?)")
        .run(Number(userId), Number(getAuth(request).clinicId), input.cpf?.replace(/\D/g, "") ?? null,
          input.birthDate ?? null, input.phone ?? null, input.sex ?? null, input.address ?? null);
    });
    const patient = db.prepare("SELECT id FROM PACIENTE WHERE usuario_id=?").get(Number(created.userId)) as { id: number };
    response.status(201).json({ id: String(patient.id), fullName: input.fullName, email: input.email, birthDate: input.birthDate ?? null });
  } catch (error) { next(error); }
});

// The workbook has no profile-update-request table, so the patient profile is updated directly.
patientRouter.post("/patients/update-requests", requireAuth, requireRole("PATIENT"), (request, response, next) => {
  try {
    const auth = getAuth(request);
    const input = z.object({ fullName: z.string().trim().max(120).optional(), email: z.string().email().max(254).optional(),
      phone: z.string().max(30).optional(), birthDate: z.string().optional(), cpf: z.string().max(14).optional() }).parse(request.body);
    const userId = Number(auth.userId);
    const patient = db.prepare("SELECT id FROM PACIENTE WHERE usuario_id=? AND clinica_id=?").get(userId, Number(auth.clinicId)) as { id: number } | undefined;
    if (!patient) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado nesta clínica.");
    if (input.fullName !== undefined || input.email !== undefined) {
      db.prepare("UPDATE USUARIO SET nome=COALESCE(?,nome),email=COALESCE(?,email),dt_atualizacao=? WHERE id=?")
        .run(input.fullName ?? null, input.email?.trim().toLowerCase() ?? null, new Date().toISOString(), userId);
    }
    db.prepare("UPDATE PACIENTE SET telefone=COALESCE(?,telefone),dt_nasc=COALESCE(?,dt_nasc),cpf=COALESCE(?,cpf) WHERE id=?")
      .run(input.phone ?? null, input.birthDate ?? null, input.cpf?.replace(/\D/g, "") ?? null, patient.id);
    response.json({ id: String(patient.id), status: "UPDATED" });
  } catch (error) { next(error); }
});

patientRouter.get("/patients/:patientId", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    const id = z.coerce.number().int().positive().parse(request.params.patientId);
    const row = db.prepare(`${patientSelect} WHERE p.id=? AND p.clinica_id=?`).get(id, Number(auth.clinicId)) as { id: number } | undefined;
    if (!row) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado nesta clínica.");
    if (auth.role === "PATIENT" && Number(auth.userId) !== Number(db.prepare("SELECT usuario_id FROM PACIENTE WHERE id=?").pluck().get(id))) {
      throw new HttpError(403, "FORBIDDEN", "Você só pode consultar seu próprio cadastro.");
    }
    response.json({ patient: { ...row, id: String(row.id) } });
  } catch (error) { next(error); }
});
