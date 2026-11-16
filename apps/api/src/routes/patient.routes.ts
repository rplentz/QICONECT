import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/database.js";
import { getAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { createClinicAccount } from "../services/accounts.js";
import { writeAudit } from "../services/audit.js";
import { HttpError } from "../utils/http-error.js";

export const patientRouter = Router();

patientRouter.get("/patients", requireAuth, (request, response) => {
  const auth = getAuth(request);
  const search = z.string().trim().max(100).optional().parse(request.query.search);
  const patientOnly = auth.role === "PATIENT" ? " AND m.id = @membershipId" : "";
  const rows = db
    .prepare(
      `SELECT m.id AS membershipId, u.nome AS fullName, u.email, u.telefone AS phone,
              pp.dt_nasc AS birthDate, pp.cpf, m.created_at AS createdAt
       FROM memberships m
       JOIN USUARIO u ON u.id = m.user_id
       LEFT JOIN PACIENTE pp ON pp.membership_id = m.id AND pp.clinic_id = m.clinic_id
       WHERE m.clinic_id = @clinicId AND m.role = 'PATIENT' AND m.status = 'ACTIVE'
       ${patientOnly}
       AND (@search IS NULL OR u.nome LIKE @likeSearch OR u.email LIKE @likeSearch OR pp.cpf LIKE @likeSearch)
       ORDER BY u.nome LIMIT 200`,
    )
    .all({
      clinicId: auth.clinicId,
      membershipId: auth.membershipId,
      search: search ?? null,
      likeSearch: search ? `%${search}%` : null,
    });
  response.json({ patients: rows });
});

patientRouter.post("/patients", requireAuth, requireRole("THERAPIST"), async (request, response, next) => {
  try {
    const input = z
      .object({
        fullName: z.string().trim().min(2).max(120),
        email: z.string().email().max(254),
        phone: z.string().max(30).optional(),
        password: z.string().min(10).max(128),
        birthDate: z.string().date().optional(),
        cpf: z.string().trim().max(14).optional(),
        emergencyContactName: z.string().trim().max(120).optional(),
        emergencyContactPhone: z.string().trim().max(30).optional(),
      })
      .parse(request.body);
    const auth = getAuth(request);
    const account = await createClinicAccount(
      { ...input, clinicId: auth.clinicId, role: "PATIENT" },
      (membershipId, userId) => {
        db.prepare(
          "INSERT INTO PACIENTE (id, usuario_id, clinica_id, telefone, membership_id, clinic_id, dt_nasc, cpf, endereco, sexo, ativo, dt_atualizacao, emergency_contact_name, emergency_contact_phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)",
        ).run(
          randomUUID(),
          userId,
          auth.clinicId,
          input.phone ?? null,
          membershipId,
          auth.clinicId,
          input.birthDate ?? null,
          input.cpf ?? null,
          null,
          null,
          new Date().toISOString(),
          input.emergencyContactName ?? null,
          input.emergencyContactPhone ?? null,
        );
      },
    );
    writeAudit(auth, "patient.created", "membership", account.membershipId);
    response.status(201).json({
      membershipId: account.membershipId,
      fullName: input.fullName,
      email: input.email,
      birthDate: input.birthDate ?? null,
    });
  } catch (error) {
    next(error);
  }
});

patientRouter.get("/patients/:membershipId", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    const membershipId = z.string().uuid().parse(request.params.membershipId);
    if (auth.role === "PATIENT" && auth.membershipId !== membershipId) {
      throw new HttpError(403, "FORBIDDEN", "Você só pode consultar seu próprio cadastro.");
    }
    const patient = db
      .prepare(
        `SELECT m.id AS membershipId, u.nome AS fullName, u.email, u.telefone AS phone,
                pp.dt_nasc AS birthDate, pp.cpf, pp.emergency_contact_name AS emergencyContactName,
                pp.emergency_contact_phone AS emergencyContactPhone
         FROM memberships m JOIN USUARIO u ON u.id = m.user_id
         LEFT JOIN PACIENTE pp ON pp.membership_id = m.id AND pp.clinic_id = m.clinic_id
         WHERE m.id = ? AND m.clinic_id = ? AND m.role = 'PATIENT' AND m.status = 'ACTIVE'`,
      )
      .get(membershipId, auth.clinicId);
    if (!patient) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado nesta clínica.");
    response.json({ patient });
  } catch (error) {
    next(error);
  }
});
