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
  const therapistOnly = auth.role === "THERAPIST" ? " AND pp.terapeuta_id = @therapistId" : "";
  const therapist = auth.role === "THERAPIST"
    ? db.prepare("SELECT id FROM TERAPEUTA WHERE membership_id = ? AND clinic_id = ? AND ativo = 1").get(auth.membershipId, auth.clinicId) as { id: string } | undefined
    : undefined;
  const rows = db
    .prepare(
      `SELECT m.id AS membershipId, u.nome AS fullName, u.email, u.telefone AS phone,
              pp.dt_nasc AS birthDate, pp.cpf, m.created_at AS createdAt,
              (SELECT MAX(a.dt_atend)
               FROM ATENDIMENTO a
               WHERE a.patient_membership_id = m.id
                 AND a.clinic_id = m.clinic_id
                 AND a.status <> 'CANCELLED'
                 ${auth.role === "THERAPIST" ? "AND a.therapist_membership_id = @membershipId" : ""}) AS lastAppointmentAt
       FROM memberships m
       JOIN USUARIO u ON u.id = m.user_id
       LEFT JOIN PACIENTE pp ON pp.membership_id = m.id AND pp.clinic_id = m.clinic_id
       WHERE m.clinic_id = @clinicId AND m.role = 'PATIENT' AND m.status = 'ACTIVE'
       ${patientOnly}
       ${therapistOnly}
       AND (@search IS NULL OR u.nome LIKE @likeSearch OR u.email LIKE @likeSearch OR pp.cpf LIKE @likeSearch)
       ORDER BY u.nome LIMIT 200`,
    )
    .all({
      clinicId: auth.clinicId,
      membershipId: auth.membershipId,
      therapistId: therapist?.id ?? null,
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
    const therapist = db
      .prepare("SELECT id FROM TERAPEUTA WHERE membership_id = ? AND clinic_id = ? AND ativo = 1")
      .get(auth.membershipId, auth.clinicId) as { id: string } | undefined;
    if (!therapist) throw new HttpError(404, "THERAPIST_NOT_FOUND", "Perfil do terapeuta não encontrado nesta clínica.");
    const normalizedPhone = input.phone?.replace(/\D/g, "") || undefined;
    const normalizedCpf = input.cpf?.replace(/\D/g, "") || undefined;
    const account = await createClinicAccount(
      { ...input, phone: normalizedPhone, clinicId: auth.clinicId, role: "PATIENT" },
      (membershipId, userId) => {
        db.prepare(
          "INSERT INTO PACIENTE (id, usuario_id, clinica_id, telefone, membership_id, clinic_id, dt_nasc, cpf, endereco, sexo, ativo, dt_atualizacao, emergency_contact_name, emergency_contact_phone, terapeuta_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
        ).run(
          randomUUID(),
          userId,
          auth.clinicId,
          normalizedPhone ?? null,
          membershipId,
          auth.clinicId,
          input.birthDate ?? null,
          normalizedCpf ?? null,
          null,
          null,
          new Date().toISOString(),
          input.emergencyContactName ?? null,
          input.emergencyContactPhone ?? null,
          therapist.id,
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

patientRouter.post("/patients/update-requests", requireAuth, requireRole("PATIENT"), (request, response, next) => {
  try {
    const auth = getAuth(request);
    const optionalText = (max: number) => z.preprocess(
      (value) => value === "" ? undefined : value,
      z.string().trim().min(2).max(max).optional(),
    );
    const input = z.object({
      fullName: optionalText(120),
      email: z.preprocess((value) => value === "" ? undefined : value, z.string().email().max(254).optional()),
      phone: optionalText(30),
      birthDate: z.preprocess((value) => value === "" ? undefined : value, z.string().date().optional()),
      cpf: optionalText(14),
    }).parse(request.body);
    const current = db.prepare(
      `SELECT u.nome AS fullName, u.email, u.telefone AS phone, pp.dt_nasc AS birthDate,
              pp.cpf, pp.terapeuta_id AS therapistId
       FROM memberships m
       JOIN USUARIO u ON u.id = m.user_id
       LEFT JOIN PACIENTE pp ON pp.membership_id = m.id AND pp.clinic_id = m.clinic_id
       WHERE m.id = ? AND m.clinic_id = ? AND m.role = 'PATIENT' AND m.status = 'ACTIVE'`,
    ).get(auth.membershipId, auth.clinicId) as {
      fullName: string;
      email: string;
      phone: string | null;
      birthDate: string | null;
      cpf: string | null;
      therapistId: string | null;
    } | undefined;
    if (!current) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado nesta clínica.");
    const requested = {
      fullName: input.fullName,
      email: input.email?.trim().toLowerCase(),
      phone: input.phone?.replace(/\D/g, "") || undefined,
      birthDate: input.birthDate,
      cpf: input.cpf?.replace(/\D/g, "") || undefined,
    };
    const changes = Object.fromEntries(Object.entries(requested).filter(([key, value]) => {
      if (value === undefined) return false;
      const currentValue = current[key as keyof typeof current];
      return value !== currentValue;
    }));
    if (Object.keys(changes).length === 0) {
      throw new HttpError(400, "NO_PROFILE_CHANGES", "Informe pelo menos uma alteração cadastral.");
    }
    const now = new Date().toISOString();
    const existing = db.prepare(
      `SELECT id FROM SOLICITACAO_ATUALIZACAO_CADASTRAL
       WHERE clinic_id = ? AND patient_membership_id = ? AND status = 'PENDING'`,
    ).get(auth.clinicId, auth.membershipId) as { id: string } | undefined;
    const requestId = existing?.id ?? randomUUID();
    if (existing) {
      db.prepare(
        `UPDATE SOLICITACAO_ATUALIZACAO_CADASTRAL
         SET alteracoes = ?, terapeuta_id = ?, requested_at = ?
         WHERE id = ? AND clinic_id = ?`,
      ).run(JSON.stringify(changes), current.therapistId, now, requestId, auth.clinicId);
    } else {
      db.prepare(
        `INSERT INTO SOLICITACAO_ATUALIZACAO_CADASTRAL
         (id, clinic_id, patient_membership_id, terapeuta_id, alteracoes, status, requested_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      ).run(requestId, auth.clinicId, auth.membershipId, current.therapistId, JSON.stringify(changes), now);
    }
    writeAudit(auth, "patient.profile_update_requested", "profile_update_request", requestId, { changes });
    response.status(existing ? 200 : 201).json({ id: requestId, status: "PENDING" });
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
