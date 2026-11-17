import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/database.js";
import { getAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { hashPassword } from "../security/password.js";
import { createClinicAccount } from "../services/accounts.js";
import { writeAudit } from "../services/audit.js";
import { HttpError } from "../utils/http-error.js";

export const registrationRouter = Router();

const resourceSchema = z.enum([
  "clinic",
  "user",
  "patient",
  "therapist",
  "specialty",
  "therapy",
  "protocol",
  "diagnosis",
  "evolution",
  "agenda",
  "encounter",
  "chart",
]);
type Resource = z.infer<typeof resourceSchema>;

const recordId = z.string().trim().min(1).max(100);
const optionalText = (max = 500) => z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().trim().max(max).optional(),
);

function hasInput(body: unknown, key: string): boolean {
  return typeof body === "object" && body !== null && Object.prototype.hasOwnProperty.call(body, key);
}

function inputOrCurrent<T>(body: unknown, key: string, value: T | null | undefined, current: T | null): T | null {
  if (!hasInput(body, key)) return current;
  return value == null || value === "" ? null : value;
}

function assertClinicMember(clinicId: string, membershipId: string, role: "PATIENT" | "THERAPIST"): void {
  const member = db
    .prepare("SELECT id FROM memberships WHERE id = ? AND clinic_id = ? AND role = ? AND status = 'ACTIVE'")
    .get(membershipId, clinicId, role);
  if (!member) {
    throw new HttpError(404, role === "PATIENT" ? "PATIENT_NOT_FOUND" : "THERAPIST_NOT_FOUND", "Vínculo não encontrado nesta clínica.");
  }
}

function getOrCreateChart(clinicId: string, patientMembershipId: string): string {
  const existing = db
    .prepare("SELECT id FROM PRONTUARIO WHERE clinic_id = ? AND patient_membership_id = ?")
    .get(clinicId, patientMembershipId) as { id: string } | undefined;
  if (existing) return existing.id;

  const patientProfile = db
    .prepare("SELECT id FROM PACIENTE WHERE clinic_id = ? AND membership_id = ?")
    .get(clinicId, patientMembershipId) as { id: string } | undefined;
  if (!patientProfile) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado nesta clínica.");
  const id = randomUUID();
  const openedAt = new Date().toISOString();
  db.prepare(
    "INSERT INTO PRONTUARIO (id, clinic_id, patient_membership_id, data_abertura, status, paciente_id) VALUES (?, ?, ?, ?, 'ACTIVE', ?)",
  ).run(id, clinicId, patientMembershipId, openedAt, patientProfile.id);
  return id;
}

function protocolDiagnosisLinks(clinicId: string, protocolId: string, diagnosisId: string | null): void {
  if (!diagnosisId) return;
  const steps = db.prepare("SELECT id FROM PROTOCOLO_ETAPA WHERE clinic_id = ? AND protocolo_id = ?").all(
    clinicId,
    protocolId,
  ) as Array<{ id: string }>;
  const insertLink = db.prepare(
    `INSERT INTO DIAGNOSTICO_PROTOCOLO
     (id, clinic_id, diagnostico_id, protocolo_etapa_id, dt_diagnostico, status)
     VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS')`,
  );
  const now = new Date().toISOString();
  const exists = db.prepare(
    "SELECT 1 FROM DIAGNOSTICO_PROTOCOLO WHERE clinic_id = ? AND diagnostico_id = ? AND protocolo_etapa_id = ?",
  );
  for (const step of steps) {
    if (!exists.get(clinicId, diagnosisId, step.id)) insertLink.run(randomUUID(), clinicId, diagnosisId, step.id, now);
  }
}

function getRecords(resource: Resource, clinicId: string): unknown[] {
  switch (resource) {
    case "clinic":
      return db.prepare(
        `SELECT id, nome AS name, cnpj, email, telefone AS phone, endereco AS address, timezone,
                ativo AS active, dt_registro AS createdAt, dt_atualizacao AS updatedAt
         FROM CLINICA WHERE id = ?`,
      ).all(clinicId);
    case "user":
      return db.prepare(
        `SELECT m.id AS id, u.id AS userId, u.nome AS fullName, u.email, u.telefone AS phone,
                m.role, m.status AS membershipStatus, u.ativo AS active,
                p.nome AS profileName, u.dt_registro AS createdAt, u.dt_ult_acesso AS lastLoginAt
         FROM memberships m
         JOIN USUARIO u ON u.id = m.user_id
         JOIN PERFIL p ON p.id = m.profile_id
         WHERE m.clinic_id = ?
         ORDER BY u.nome`,
      ).all(clinicId);
    case "patient":
      return db.prepare(
        `SELECT p.membership_id AS id, p.usuario_id AS userId, u.nome AS fullName, u.email,
                p.telefone AS phone, p.cpf, p.dt_nasc AS birthDate, p.sexo AS sex,
                p.endereco AS address, p.ativo AS active, p.dt_atualizacao AS updatedAt
         FROM PACIENTE p JOIN USUARIO u ON u.id = p.usuario_id
         WHERE p.clinic_id = ?
         ORDER BY u.nome`,
      ).all(clinicId);
    case "therapist":
      return db.prepare(
        `SELECT t.membership_id AS id, t.usuario_id AS userId, u.nome AS fullName, u.email,
                u.telefone AS phone, t.cpf, t.registro_prof AS professionalRegistration,
                t.formacao AS formation, t.ativo AS active, t.dt_atualizacao AS updatedAt,
                (SELECT GROUP_CONCAT(especialidade_id, ',') FROM TERAPEUTA_ESPECIALIDADE ts
                 WHERE ts.therapist_membership_id = t.membership_id AND ts.clinic_id = t.clinic_id) AS specialtyIds,
                (SELECT GROUP_CONCAT(s.nome, ', ') FROM TERAPEUTA_ESPECIALIDADE ts
                 JOIN ESPECIALIDADE s ON s.id = ts.especialidade_id AND s.clinic_id = ts.clinic_id
                 WHERE ts.therapist_membership_id = t.membership_id AND ts.clinic_id = t.clinic_id) AS specialties,
                (SELECT GROUP_CONCAT(therapy_id, ',') FROM therapist_therapies tt
                 WHERE tt.membership_id = t.membership_id AND tt.clinic_id = t.clinic_id) AS therapyIds,
                (SELECT GROUP_CONCAT(th.nome, ', ') FROM therapist_therapies tt
                 JOIN TERAPIA th ON th.id = tt.therapy_id AND th.clinic_id = tt.clinic_id
                 WHERE tt.membership_id = t.membership_id AND tt.clinic_id = t.clinic_id) AS therapies
         FROM TERAPEUTA t JOIN USUARIO u ON u.id = t.usuario_id
         WHERE t.clinic_id = ?
         ORDER BY u.nome`,
      ).all(clinicId);
    case "specialty":
      return db.prepare(
        `SELECT id, nome AS name, descricao AS description, ativo AS active
         FROM ESPECIALIDADE WHERE clinic_id = ? ORDER BY nome`,
      ).all(clinicId);
    case "therapy":
      return db.prepare(
        `SELECT t.id, t.especialidade_id AS specialtyId, s.nome AS specialtyName,
                t.nome AS name, t.descricao AS description, t.duracao_min AS durationMinutes,
                t.ativa AS active
         FROM TERAPIA t JOIN ESPECIALIDADE s ON s.id = t.especialidade_id AND s.clinic_id = t.clinic_id
         WHERE t.clinic_id = ? ORDER BY t.nome`,
      ).all(clinicId);
    case "protocol":
      return db.prepare(
        `SELECT p.id, p.terapia_id AS therapyId, t.nome AS therapyName,
                p.therapist_membership_id AS therapistId, therapistUser.nome AS therapistName,
                p.diagnostico_id AS diagnosisId, d.descricao AS diagnosisDescription,
                p.nome AS name, p.descricao AS description, p.objetivo AS objective,
                p.ativo AS active, p.created_at AS createdAt
         FROM PROTOCOLO p
         JOIN TERAPIA t ON t.id = p.terapia_id AND t.clinic_id = p.clinic_id
         LEFT JOIN memberships therapist ON therapist.id = p.therapist_membership_id AND therapist.clinic_id = p.clinic_id
         LEFT JOIN USUARIO therapistUser ON therapistUser.id = therapist.user_id
         LEFT JOIN DIAGNOSTICO d ON d.id = p.diagnostico_id AND d.clinic_id = p.clinic_id
         WHERE p.clinic_id = ? ORDER BY p.nome`,
      ).all(clinicId);
    case "diagnosis":
      return db.prepare(
        `SELECT d.id, d.patient_membership_id AS patientId, patientUser.nome AS patientName,
                d.therapist_membership_id AS therapistId, therapistUser.nome AS therapistName,
                d.descricao AS description, d.dt_diagnostico AS diagnosedAt
         FROM DIAGNOSTICO d
         JOIN memberships patient ON patient.id = d.patient_membership_id AND patient.clinic_id = d.clinic_id
         JOIN USUARIO patientUser ON patientUser.id = patient.user_id
         JOIN memberships therapist ON therapist.id = d.therapist_membership_id AND therapist.clinic_id = d.clinic_id
         JOIN USUARIO therapistUser ON therapistUser.id = therapist.user_id
         WHERE d.clinic_id = ? ORDER BY d.dt_diagnostico DESC`,
      ).all(clinicId);
    case "evolution":
      return db.prepare(
        `SELECT e.id, e.diagnostico_protocolo_id AS diagnosisProtocolId,
                d.descricao AS diagnosisDescription, p.nome AS protocolName,
                e.descricao AS description, e.dt_evolucao AS evolvedAt, e.status
         FROM EVOLUCAO e
         JOIN DIAGNOSTICO_PROTOCOLO dp ON dp.id = e.diagnostico_protocolo_id AND dp.clinic_id = e.clinic_id
         JOIN DIAGNOSTICO d ON d.id = dp.diagnostico_id AND d.clinic_id = dp.clinic_id
         JOIN PROTOCOLO_ETAPA ps ON ps.id = dp.protocolo_etapa_id AND ps.clinic_id = dp.clinic_id
         JOIN PROTOCOLO p ON p.id = ps.protocolo_id AND p.clinic_id = ps.clinic_id
         WHERE e.clinic_id = ? ORDER BY e.dt_evolucao DESC`,
      ).all(clinicId);
    case "agenda":
      return db.prepare(
        `SELECT a.id, a.patient_membership_id AS patientId, patientUser.nome AS patientName,
                a.therapist_membership_id AS therapistId, therapistUser.nome AS therapistName,
                a.terapia_id AS therapyId, t.nome AS therapyName,
                a.dt_inicio AS startsAt, a.dt_fim AS endsAt, a.status
         FROM AGENDA a
         JOIN TERAPIA t ON t.id = a.terapia_id AND t.clinic_id = a.clinic_id
         JOIN memberships patient ON patient.id = a.patient_membership_id AND patient.clinic_id = a.clinic_id
         JOIN USUARIO patientUser ON patientUser.id = patient.user_id
         JOIN memberships therapist ON therapist.id = a.therapist_membership_id AND therapist.clinic_id = a.clinic_id
         JOIN USUARIO therapistUser ON therapistUser.id = therapist.user_id
         WHERE a.clinic_id = ? ORDER BY a.dt_inicio DESC LIMIT 200`,
      ).all(clinicId);
    case "encounter":
      return db.prepare(
        `SELECT e.id, e.prontuario_id AS chartId, e.patient_membership_id AS patientId,
                patientUser.nome AS patientName, e.therapist_membership_id AS therapistId,
                therapistUser.nome AS therapistName, e.terapia_id AS therapyId,
                t.nome AS therapyName, e.agenda_id AS appointmentId, e.dt_atend AS attendedAt,
                e.status, e.notes
         FROM ATENDIMENTO e
         JOIN memberships patient ON patient.id = e.patient_membership_id AND patient.clinic_id = e.clinic_id
         JOIN USUARIO patientUser ON patientUser.id = patient.user_id
         JOIN memberships therapist ON therapist.id = e.therapist_membership_id AND therapist.clinic_id = e.clinic_id
         JOIN USUARIO therapistUser ON therapistUser.id = therapist.user_id
         JOIN TERAPIA t ON t.id = e.terapia_id AND t.clinic_id = e.clinic_id
         WHERE e.clinic_id = ? ORDER BY e.dt_atend DESC`,
      ).all(clinicId);
    case "chart":
      return db.prepare(
        `SELECT c.id, c.patient_membership_id AS patientId, u.nome AS patientName,
                c.data_abertura AS openedAt, c.status
         FROM PRONTUARIO c
         JOIN memberships m ON m.id = c.patient_membership_id AND m.clinic_id = c.clinic_id
         JOIN USUARIO u ON u.id = m.user_id
         WHERE c.clinic_id = ? ORDER BY c.data_abertura DESC`,
      ).all(clinicId);
  }
}

registrationRouter.get("/registrations/options", requireAuth, requireRole("CLINIC_ADMIN"), (request, response) => {
  const auth = getAuth(request);
  const clinicId = auth.clinicId;
  const options = {
    profiles: db.prepare("SELECT code AS value, nome AS label FROM PERFIL ORDER BY nome").all(),
    patients: db.prepare(
      `SELECT m.id AS value, u.nome AS label FROM memberships m
       JOIN USUARIO u ON u.id = m.user_id
       WHERE m.clinic_id = ? AND m.role = 'PATIENT' AND m.status = 'ACTIVE' AND u.ativo = 1
       ORDER BY u.nome`,
    ).all(clinicId),
    patientsWithoutChart: db.prepare(
      `SELECT m.id AS value, u.nome AS label FROM memberships m
       JOIN USUARIO u ON u.id = m.user_id
       WHERE m.clinic_id = ? AND m.role = 'PATIENT' AND m.status = 'ACTIVE' AND u.ativo = 1
         AND NOT EXISTS (
           SELECT 1 FROM PRONTUARIO c WHERE c.clinic_id = m.clinic_id AND c.patient_membership_id = m.id
         )
       ORDER BY u.nome`,
    ).all(clinicId),
    therapists: db.prepare(
      `SELECT m.id AS value, u.nome AS label FROM memberships m
       JOIN USUARIO u ON u.id = m.user_id
       WHERE m.clinic_id = ? AND m.role = 'THERAPIST' AND m.status = 'ACTIVE' AND u.ativo = 1
       ORDER BY u.nome`,
    ).all(clinicId),
    specialties: db.prepare(
      "SELECT id AS value, nome AS label FROM ESPECIALIDADE WHERE clinic_id = ? AND ativo = 1 ORDER BY nome",
    ).all(clinicId),
    therapies: db.prepare(
      "SELECT id AS value, nome AS label FROM TERAPIA WHERE clinic_id = ? AND ativa = 1 ORDER BY nome",
    ).all(clinicId),
    protocols: db.prepare(
      "SELECT id AS value, nome AS label FROM PROTOCOLO WHERE clinic_id = ? AND ativo = 1 ORDER BY nome",
    ).all(clinicId),
    diagnoses: db.prepare(
      `SELECT d.id AS value, patientUser.nome || ' · ' || substr(d.descricao, 1, 80) AS label
       FROM DIAGNOSTICO d
       JOIN memberships m ON m.id = d.patient_membership_id AND m.clinic_id = d.clinic_id
       JOIN USUARIO patientUser ON patientUser.id = m.user_id
       WHERE d.clinic_id = ? ORDER BY d.dt_diagnostico DESC`,
    ).all(clinicId),
    protocolSteps: db.prepare(
      `SELECT s.id AS value, p.nome || ' · Etapa ' || s.sequencia || ' · ' || s.descricao AS label
       FROM PROTOCOLO_ETAPA s JOIN PROTOCOLO p ON p.id = s.protocolo_id AND p.clinic_id = s.clinic_id
       WHERE s.clinic_id = ? ORDER BY p.nome, s.sequencia`,
    ).all(clinicId),
    diagnosisProtocols: db.prepare(
      `SELECT dp.id AS value, patientUser.nome || ' · ' || substr(d.descricao, 1, 60) || ' · ' || p.nome AS label
       FROM DIAGNOSTICO_PROTOCOLO dp
       JOIN DIAGNOSTICO d ON d.id = dp.diagnostico_id AND d.clinic_id = dp.clinic_id
       JOIN memberships m ON m.id = d.patient_membership_id AND m.clinic_id = d.clinic_id
       JOIN USUARIO patientUser ON patientUser.id = m.user_id
       JOIN PROTOCOLO_ETAPA s ON s.id = dp.protocolo_etapa_id AND s.clinic_id = dp.clinic_id
       JOIN PROTOCOLO p ON p.id = s.protocolo_id AND p.clinic_id = s.clinic_id
       WHERE dp.clinic_id = ? ORDER BY d.dt_diagnostico DESC`,
    ).all(clinicId),
    charts: db.prepare(
      `SELECT c.id AS value, u.nome || ' · ' || c.status AS label
       FROM PRONTUARIO c JOIN memberships m ON m.id = c.patient_membership_id AND m.clinic_id = c.clinic_id
       JOIN USUARIO u ON u.id = m.user_id
       WHERE c.clinic_id = ? ORDER BY u.nome`,
    ).all(clinicId),
    appointments: db.prepare(
      `SELECT a.id AS value, u.nome || ' · ' || a.dt_inicio AS label
       FROM AGENDA a JOIN memberships m ON m.id = a.patient_membership_id AND m.clinic_id = a.clinic_id
       JOIN USUARIO u ON u.id = m.user_id
       WHERE a.clinic_id = ? ORDER BY a.dt_inicio DESC LIMIT 200`,
    ).all(clinicId),
  };
  response.json({ options });
});

registrationRouter.get("/registrations/archived-clinics", requireAuth, requireRole("CLINIC_ADMIN"), (request, response) => {
  const auth = getAuth(request);
  const clinics = db.prepare(
    `SELECT c.id, c.nome AS name
     FROM CLINICA c
     JOIN memberships m ON m.clinic_id = c.id
     WHERE m.user_id = ? AND m.role = 'CLINIC_ADMIN' AND m.status = 'ACTIVE' AND c.ativo = 0
     ORDER BY c.nome`,
  ).all(auth.userId);
  response.json({ clinics });
});

registrationRouter.post("/registrations/clinic/:id/restore", requireAuth, requireRole("CLINIC_ADMIN"), (request, response, next) => {
  try {
    const id = recordId.parse(request.params.id);
    const auth = getAuth(request);
    const membership = db.prepare(
      `SELECT c.id FROM CLINICA c
       JOIN memberships m ON m.clinic_id = c.id
       WHERE c.id = ? AND c.ativo = 0 AND m.user_id = ?
         AND m.role = 'CLINIC_ADMIN' AND m.status = 'ACTIVE'`,
    ).get(id, auth.userId);
    if (!membership) throw new HttpError(404, "CLINIC_NOT_FOUND", "Clínica arquivada não encontrada ou sem acesso administrativo.");

    const result = db.prepare("UPDATE CLINICA SET ativo = 1, dt_atualizacao = ? WHERE id = ? AND ativo = 0")
      .run(new Date().toISOString(), id);
    if (result.changes !== 1) throw new HttpError(409, "CLINIC_NOT_ARCHIVED", "A clínica não está arquivada.");
    writeAudit({ ...auth, clinicId: id }, "clinic.restored", "clinic", id);
    response.json({ id });
  } catch (error) {
    next(error);
  }
});

registrationRouter.get("/registrations/protocol-steps", requireAuth, requireRole("CLINIC_ADMIN"), (request, response, next) => {
  try {
    const auth = getAuth(request);
    const protocolId = recordId.parse(request.query.protocolId);
    const steps = db.prepare(
      `SELECT s.id, s.protocolo_id AS protocolId, s.sequencia AS sequence,
              s.dt_inicio AS startsAt, s.dt_fim AS endsAt, s.descricao AS description, s.obs AS notes
       FROM PROTOCOLO_ETAPA s
       WHERE s.clinic_id = ? AND s.protocolo_id = ?
       ORDER BY s.sequencia`,
    ).all(auth.clinicId, protocolId);
    response.json({ steps });
  } catch (error) {
    next(error);
  }
});

registrationRouter.get("/registrations/:resource", requireAuth, requireRole("CLINIC_ADMIN"), (request, response, next) => {
  try {
    const resource = resourceSchema.parse(request.params.resource);
    response.json({ records: getRecords(resource, getAuth(request).clinicId) });
  } catch (error) {
    next(error);
  }
});

registrationRouter.post("/registrations/protocol-steps", requireAuth, requireRole("CLINIC_ADMIN"), (request, response, next) => {
  try {
    const input = z.object({
      protocolId: recordId,
      sequence: z.number().int().positive(),
      startsAt: z.string().date().optional(),
      endsAt: z.string().date().optional(),
      description: z.string().trim().min(2).max(1000),
      notes: optionalText(1000),
    }).refine((value) => !value.startsAt || !value.endsAt || value.startsAt <= value.endsAt, {
      message: "A data final da etapa deve ser igual ou posterior à inicial.",
    }).parse(request.body);
    const auth = getAuth(request);
    const protocol = db.prepare("SELECT id FROM PROTOCOLO WHERE id = ? AND clinic_id = ?").get(input.protocolId, auth.clinicId);
    if (!protocol) throw new HttpError(404, "PROTOCOL_NOT_FOUND", "Protocolo não encontrado nesta clínica.");
    const id = randomUUID();
    const createStep = db.transaction(() => {
      db.prepare(
        `INSERT INTO PROTOCOLO_ETAPA
         (id, clinic_id, protocolo_id, sequencia, dt_inicio, dt_fim, descricao, obs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, auth.clinicId, input.protocolId, input.sequence, input.startsAt ?? null, input.endsAt ?? null, input.description, input.notes ?? null);
      const diagnosis = db.prepare("SELECT diagnostico_id AS id FROM PROTOCOLO WHERE id = ?").get(input.protocolId) as { id: string | null };
      if (diagnosis.id) protocolDiagnosisLinks(auth.clinicId, input.protocolId, diagnosis.id);
    });
    createStep.immediate();
    writeAudit(auth, "protocol_step.created", "protocol_step", id);
    response.status(201).json({ id, ...input });
  } catch (error) {
    next(error);
  }
});

registrationRouter.post("/registrations/:resource", requireAuth, requireRole("CLINIC_ADMIN"), async (request, response, next) => {
  try {
    const resource = resourceSchema.parse(request.params.resource);
    const auth = getAuth(request);
    const now = new Date().toISOString();

    switch (resource) {
      case "clinic":
      {
        const input = z.object({
          name: z.string().trim().min(2).max(160),
          cnpj: optionalText(18),
          email: z.string().email().max(254).optional().or(z.literal("")),
          phone: optionalText(30),
          address: optionalText(500),
          timezone: z.string().trim().min(1).max(80),
        }).parse(request.body);
        if (input.cnpj && db.prepare("SELECT id FROM CLINICA WHERE cnpj = ?").get(input.cnpj)) {
          throw new HttpError(409, "CLINIC_CNPJ_EXISTS", "Já existe uma clínica cadastrada com este CNPJ.");
        }
        const id = randomUUID();
        const membershipId = randomUUID();
        const createdAt = new Date().toISOString();
        const createClinic = db.transaction(() => {
          db.prepare(
            `INSERT INTO CLINICA
             (id, slug, nome, cnpj, email, telefone, endereco, timezone, ativo, dt_registro, dt_atualizacao)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          ).run(
            id, `clinic-${id}`, input.name, input.cnpj ?? null, input.email || null, input.phone ?? null,
            input.address ?? null, input.timezone, createdAt, createdAt,
          );
          db.prepare(
            `INSERT INTO memberships (id, clinic_id, user_id, role, status, created_at)
             VALUES (?, ?, ?, 'CLINIC_ADMIN', 'ACTIVE', ?)`,
          ).run(membershipId, id, auth.userId, createdAt);
        });
        createClinic.immediate();
        writeAudit({ ...auth, clinicId: id }, "clinic.created", "clinic", id);
        response.status(201).json({ id });
        return;
      }
      case "user": {
        const input = z.object({
          fullName: z.string().trim().min(2).max(120),
          email: z.string().email().max(254),
          phone: optionalText(30),
          password: z.string().min(10).max(128),
          role: z.enum(["CLINIC_ADMIN", "THERAPIST", "PATIENT"]),
        }).parse(request.body);
        const account = await createClinicAccount(
          { ...input, clinicId: auth.clinicId },
          (membershipId, userId) => {
            if (input.role === "PATIENT") {
              db.prepare(
                `INSERT INTO PACIENTE
                 (id, usuario_id, clinica_id, telefone, membership_id, clinic_id, ativo, dt_atualizacao)
                 VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
              ).run(randomUUID(), userId, auth.clinicId, input.phone ?? null, membershipId, auth.clinicId, now);
            } else if (input.role === "THERAPIST") {
              db.prepare(
                `INSERT INTO TERAPEUTA
                 (id, usuario_id, clinica_id, membership_id, clinic_id, ativo, dt_atualizacao)
                 VALUES (?, ?, ?, ?, ?, 1, ?)`,
              ).run(randomUUID(), userId, auth.clinicId, membershipId, auth.clinicId, now);
            }
          },
        );
        writeAudit(auth, "user.created", "membership", account.membershipId, { role: input.role });
        response.status(201).json({ id: account.membershipId, ...input, password: undefined });
        return;
      }
      case "patient": {
        const input = z.object({
          fullName: z.string().trim().min(2).max(120),
          email: z.string().email().max(254),
          phone: optionalText(30),
          password: z.string().min(10).max(128),
          cpf: optionalText(14),
          birthDate: z.string().date().nullable().optional(),
          sex: z.enum(["F", "M", "OTHER", "UNSPECIFIED"]).nullable().optional(),
          address: optionalText(500),
        }).parse(request.body);
        const account = await createClinicAccount(
          { ...input, clinicId: auth.clinicId, role: "PATIENT" },
          (membershipId, userId) => {
            db.prepare(
              `INSERT INTO PACIENTE
               (id, usuario_id, clinica_id, telefone, membership_id, clinic_id, dt_nasc, cpf, endereco, sexo, ativo, dt_atualizacao)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            ).run(
              randomUUID(), userId, auth.clinicId, input.phone ?? null, membershipId, auth.clinicId,
              input.birthDate ?? null, input.cpf ?? null, input.address ?? null, input.sex ?? null, now,
            );
          },
        );
        writeAudit(auth, "patient.created", "membership", account.membershipId);
        response.status(201).json({ id: account.membershipId });
        return;
      }
      case "therapist": {
        const input = z.object({
          fullName: z.string().trim().min(2).max(120),
          email: z.string().email().max(254),
          phone: optionalText(30),
          password: z.string().min(10).max(128),
          cpf: optionalText(14),
          professionalRegistration: optionalText(100),
          formation: optionalText(500),
          specialtyIds: z.array(recordId).max(50).default([]),
          therapyIds: z.array(recordId).max(50).default([]),
        }).parse(request.body);
        const specialtyIds = [...new Set(input.specialtyIds)];
        const therapyIds = [...new Set(input.therapyIds)];
        if (specialtyIds.length > 0) {
          const valid = db.prepare(
            `SELECT id FROM ESPECIALIDADE WHERE clinic_id = ? AND ativo = 1
             AND id IN (${specialtyIds.map(() => "?").join(", ")})`,
          ).all(auth.clinicId, ...specialtyIds) as Array<{ id: string }>;
          if (valid.length !== specialtyIds.length) throw new HttpError(400, "INVALID_SPECIALTY", "Selecione apenas especialidades ativas desta clínica.");
        }
        if (therapyIds.length > 0) {
          const valid = db.prepare(
            `SELECT id FROM TERAPIA WHERE clinic_id = ? AND ativa = 1
             AND id IN (${therapyIds.map(() => "?").join(", ")})`,
          ).all(auth.clinicId, ...therapyIds) as Array<{ id: string }>;
          if (valid.length !== therapyIds.length) throw new HttpError(400, "INVALID_THERAPY", "Selecione apenas terapias ativas desta clínica.");
        }
        const account = await createClinicAccount(
          { ...input, clinicId: auth.clinicId, role: "THERAPIST" },
          (membershipId, userId) => {
            const therapistProfileId = randomUUID();
            db.prepare(
              `INSERT INTO TERAPEUTA
               (id, usuario_id, clinica_id, membership_id, clinic_id, registro_prof, cpf, formacao, ativo, dt_atualizacao)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            ).run(
              therapistProfileId, userId, auth.clinicId, membershipId, auth.clinicId,
              input.professionalRegistration ?? null, input.cpf ?? null, input.formation ?? null, now,
            );
            const addSpecialty = db.prepare(
              `INSERT INTO TERAPEUTA_ESPECIALIDADE
               (id, clinic_id, therapist_membership_id, especialidade_id, created_at, terapeuta_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
            );
            for (const specialtyId of specialtyIds) {
              addSpecialty.run(randomUUID(), auth.clinicId, membershipId, specialtyId, now, therapistProfileId);
            }
            const addTherapy = db.prepare(
              "INSERT INTO therapist_therapies (clinic_id, membership_id, therapy_id) VALUES (?, ?, ?)",
            );
            for (const therapyId of therapyIds) addTherapy.run(auth.clinicId, membershipId, therapyId);
          },
        );
        writeAudit(auth, "therapist.created", "membership", account.membershipId);
        response.status(201).json({ id: account.membershipId });
        return;
      }
      case "specialty": {
        const input = z.object({
          name: z.string().trim().min(2).max(100),
          description: optionalText(1000),
          active: z.boolean().default(true),
        }).parse(request.body);
        const id = randomUUID();
        db.prepare("INSERT INTO ESPECIALIDADE (id, clinic_id, nome, descricao, ativo) VALUES (?, ?, ?, ?, ?)").run(
          id, auth.clinicId, input.name, input.description ?? null, Number(input.active),
        );
        writeAudit(auth, "specialty.created", "specialty", id);
        response.status(201).json({ id });
        return;
      }
      case "therapy": {
        const input = z.object({
          specialtyId: recordId,
          name: z.string().trim().min(2).max(100),
          description: optionalText(1000),
          durationMinutes: z.number().int().min(10).max(480),
          active: z.boolean().default(true),
        }).parse(request.body);
        const specialty = db.prepare("SELECT id FROM ESPECIALIDADE WHERE id = ? AND clinic_id = ?").get(input.specialtyId, auth.clinicId);
        if (!specialty) throw new HttpError(404, "SPECIALTY_NOT_FOUND", "Especialidade não encontrada nesta clínica.");
        const id = randomUUID();
        db.prepare(
          `INSERT INTO TERAPIA (id, clinic_id, especialidade_id, nome, descricao, duracao_min, price, ativa)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        ).run(id, auth.clinicId, input.specialtyId, input.name, input.description ?? null, input.durationMinutes, Number(input.active));
        writeAudit(auth, "therapy.created", "therapy", id);
        response.status(201).json({ id });
        return;
      }
      case "protocol": {
        const input = z.object({
          therapyId: recordId,
          therapistId: recordId.nullable().optional(),
          diagnosisId: recordId.nullable().optional(),
          name: z.string().trim().min(2).max(160),
          description: optionalText(2000),
          objective: optionalText(1000),
          active: z.boolean().default(true),
        }).parse(request.body);
        const therapy = db.prepare("SELECT id FROM TERAPIA WHERE id = ? AND clinic_id = ?").get(input.therapyId, auth.clinicId);
        if (!therapy) throw new HttpError(404, "THERAPY_NOT_FOUND", "Terapia não encontrada nesta clínica.");
        if (input.therapistId) assertClinicMember(auth.clinicId, input.therapistId, "THERAPIST");
        if (input.diagnosisId) {
          const diagnosis = db.prepare("SELECT id FROM DIAGNOSTICO WHERE id = ? AND clinic_id = ?").get(input.diagnosisId, auth.clinicId);
          if (!diagnosis) throw new HttpError(404, "DIAGNOSIS_NOT_FOUND", "Diagnóstico não encontrado nesta clínica.");
        }
        const therapistProfile = input.therapistId
          ? db.prepare("SELECT id FROM TERAPEUTA WHERE membership_id = ? AND clinic_id = ?").get(input.therapistId, auth.clinicId) as { id: string } | undefined
          : undefined;
        const id = randomUUID();
        db.prepare(
          `INSERT INTO PROTOCOLO
           (id, clinic_id, terapia_id, therapist_membership_id, nome, descricao, objetivo, ativo,
            created_at, updated_at, terapeuta_id, diagnostico_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, auth.clinicId, input.therapyId, input.therapistId ?? null, input.name, input.description ?? null,
          input.objective ?? null, Number(input.active), now, now, therapistProfile?.id ?? null, input.diagnosisId ?? null,
        );
        writeAudit(auth, "protocol.created", "protocol", id);
        response.status(201).json({ id });
        return;
      }
      case "diagnosis": {
        const input = z.object({
          patientId: recordId,
          therapistId: recordId,
          description: z.string().trim().min(2).max(4000),
          diagnosedAt: z.string().date(),
        }).parse(request.body);
        assertClinicMember(auth.clinicId, input.patientId, "PATIENT");
        assertClinicMember(auth.clinicId, input.therapistId, "THERAPIST");
        const patientProfile = db.prepare("SELECT id FROM PACIENTE WHERE membership_id = ? AND clinic_id = ?").get(input.patientId, auth.clinicId) as { id: string };
        const therapistProfile = db.prepare("SELECT id FROM TERAPEUTA WHERE membership_id = ? AND clinic_id = ?").get(input.therapistId, auth.clinicId) as { id: string };
        const id = randomUUID();
        const createDiagnosis = db.transaction(() => {
          const chartId = getOrCreateChart(auth.clinicId, input.patientId);
          db.prepare(
            `INSERT INTO DIAGNOSTICO
             (id, clinic_id, patient_chart_id, patient_membership_id, therapist_membership_id,
              descricao, dt_diagnostico, paciente_id, terapeuta_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(id, auth.clinicId, chartId, input.patientId, input.therapistId, input.description, input.diagnosedAt, patientProfile.id, therapistProfile.id);
        });
        createDiagnosis.immediate();
        writeAudit(auth, "diagnosis.created", "diagnosis", id);
        response.status(201).json({ id });
        return;
      }
      case "evolution": {
        const input = z.object({
          diagnosisProtocolId: recordId,
          description: z.string().trim().min(2).max(4000),
          evolvedAt: z.string().date(),
          status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]).default("IN_PROGRESS"),
        }).parse(request.body);
        const link = db.prepare(
          "SELECT id FROM DIAGNOSTICO_PROTOCOLO WHERE id = ? AND clinic_id = ?",
        ).get(input.diagnosisProtocolId, auth.clinicId);
        if (!link) throw new HttpError(404, "DIAGNOSIS_PROTOCOL_NOT_FOUND", "Vínculo de diagnóstico e protocolo não encontrado.");
        const id = randomUUID();
        db.prepare(
          `INSERT INTO EVOLUCAO
           (id, clinic_id, diagnostico_protocolo_id, author_membership_id, descricao, dt_evolucao, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, auth.clinicId, input.diagnosisProtocolId, auth.membershipId, input.description, input.evolvedAt, input.status, now);
        writeAudit(auth, "evolution.created", "evolution", id);
        response.status(201).json({ id });
        return;
      }
      case "agenda":
        throw new HttpError(405, "USE_APPOINTMENT_ENDPOINT", "Use o formulário de agendamento para validar disponibilidade e conflitos.");
      case "encounter": {
        const input = z.object({
          chartId: recordId,
          therapistId: recordId,
          therapyId: recordId,
          appointmentId: recordId.nullable().optional(),
          attendedAt: z.string().datetime({ offset: true }),
          status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).default("ACTIVE"),
          notes: optionalText(4000),
        }).parse(request.body);
        const chart = db.prepare(
          "SELECT id, patient_membership_id AS patientId FROM PRONTUARIO WHERE id = ? AND clinic_id = ?",
        ).get(input.chartId, auth.clinicId) as { id: string; patientId: string } | undefined;
        if (!chart) throw new HttpError(404, "CHART_NOT_FOUND", "Prontuário não encontrado nesta clínica.");
        assertClinicMember(auth.clinicId, chart.patientId, "PATIENT");
        assertClinicMember(auth.clinicId, input.therapistId, "THERAPIST");
        const therapy = db.prepare("SELECT id FROM TERAPIA WHERE id = ? AND clinic_id = ?").get(input.therapyId, auth.clinicId);
        if (!therapy) throw new HttpError(404, "THERAPY_NOT_FOUND", "Terapia não encontrada nesta clínica.");
        if (input.appointmentId) {
          const appointment = db.prepare("SELECT id FROM AGENDA WHERE id = ? AND clinic_id = ?").get(input.appointmentId, auth.clinicId);
          if (!appointment) throw new HttpError(404, "APPOINTMENT_NOT_FOUND", "Agendamento não encontrado nesta clínica.");
        }
        const patientProfile = db.prepare("SELECT id FROM PACIENTE WHERE membership_id = ? AND clinic_id = ?").get(chart.patientId, auth.clinicId) as { id: string };
        const therapistProfile = db.prepare("SELECT id FROM TERAPEUTA WHERE membership_id = ? AND clinic_id = ?").get(input.therapistId, auth.clinicId) as { id: string };
        const id = randomUUID();
        db.prepare(
          `INSERT INTO ATENDIMENTO
           (id, clinic_id, prontuario_id, patient_membership_id, therapist_membership_id, terapia_id,
            agenda_id, dt_atend, status, notes, created_at, updated_at, paciente_id, terapeuta_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          id, auth.clinicId, input.chartId, chart.patientId, input.therapistId, input.therapyId,
          input.appointmentId ?? null, input.attendedAt, input.status, input.notes ?? null, now, now,
          patientProfile.id, therapistProfile.id,
        );
        writeAudit(auth, "encounter.created", "encounter", id);
        response.status(201).json({ id });
        return;
      }
      case "chart": {
        const input = z.object({
          patientId: recordId,
          openedAt: z.string().date(),
          status: z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]).default("ACTIVE"),
        }).parse(request.body);
        assertClinicMember(auth.clinicId, input.patientId, "PATIENT");
        const patientProfile = db.prepare("SELECT id FROM PACIENTE WHERE membership_id = ? AND clinic_id = ?").get(input.patientId, auth.clinicId) as { id: string };
        const id = randomUUID();
        db.prepare(
          `INSERT INTO PRONTUARIO (id, clinic_id, patient_membership_id, data_abertura, status, paciente_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, auth.clinicId, input.patientId, input.openedAt, input.status, patientProfile.id);
        writeAudit(auth, "chart.created", "chart", id);
        response.status(201).json({ id });
        return;
      }
    }
  } catch (error) {
    next(error);
  }
});

registrationRouter.patch("/registrations/:resource/:id", requireAuth, requireRole("CLINIC_ADMIN"), async (request, response, next) => {
  try {
    const resource = resourceSchema.parse(request.params.resource);
    const id = recordId.parse(request.params.id);
    const auth = getAuth(request);
    const now = new Date().toISOString();

    switch (resource) {
      case "clinic": {
        if (id !== auth.clinicId) throw new HttpError(404, "CLINIC_NOT_FOUND", "Clínica não encontrada.");
        const input = z.object({
          name: z.string().trim().min(2).max(160).optional(),
          cnpj: optionalText(18),
          email: z.string().email().max(254).optional().or(z.literal("")),
          phone: optionalText(30),
          address: optionalText(500),
          timezone: z.string().trim().min(1).max(80).optional(),
          active: z.boolean().optional(),
        }).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.").parse(request.body);
        const current = db.prepare(
          "SELECT nome AS name, cnpj, email, telefone AS phone, endereco AS address, timezone, ativo AS active FROM CLINICA WHERE id = ?",
        ).get(id) as { name: string; cnpj: string | null; email: string | null; phone: string | null; address: string | null; timezone: string; active: number } | undefined;
        if (!current) throw new HttpError(404, "CLINIC_NOT_FOUND", "Clínica não encontrada.");
        if (input.active === false) {
          const otherActiveClinic = db.prepare(
            `SELECT 1 FROM memberships m
             JOIN CLINICA c ON c.id = m.clinic_id
             WHERE m.user_id = ? AND m.clinic_id != ? AND m.role = 'CLINIC_ADMIN'
               AND m.status = 'ACTIVE' AND c.ativo = 1 LIMIT 1`,
          ).get(auth.userId, id);
          if (!otherActiveClinic) {
            throw new HttpError(409, "LAST_ACTIVE_CLINIC", "Não é possível arquivar a única clínica ativa do seu usuário. Vincule-se a outra clínica ativa antes.");
          }
        }
        db.prepare(
          `UPDATE CLINICA SET nome = ?, cnpj = ?, email = ?, telefone = ?, endereco = ?,
           timezone = ?, ativo = COALESCE(?, ativo), dt_atualizacao = ? WHERE id = ?`,
        ).run(
          input.name ?? current.name,
          inputOrCurrent(request.body, "cnpj", input.cnpj, current.cnpj),
          inputOrCurrent(request.body, "email", input.email, current.email),
          inputOrCurrent(request.body, "phone", input.phone, current.phone),
          inputOrCurrent(request.body, "address", input.address, current.address),
          input.timezone ?? current.timezone, input.active === undefined ? null : Number(input.active), now, id,
        );
        writeAudit(auth, input.active === false ? "clinic.archived" : "clinic.updated", "clinic", id);
        response.json({ id });
        return;
      }
      case "user": {
        const input = z.object({
          fullName: z.string().trim().min(2).max(120).optional(),
          email: z.string().email().max(254).optional(),
          phone: optionalText(30),
          password: z.string().min(10).max(128).optional(),
          active: z.boolean().optional(),
        }).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.").parse(request.body);
        const membership = db.prepare(
          `SELECT m.user_id AS userId, u.nome AS fullName, u.email, u.telefone AS phone
           FROM memberships m JOIN USUARIO u ON u.id = m.user_id
           WHERE m.id = ? AND m.clinic_id = ?`,
        ).get(id, auth.clinicId) as { userId: string; fullName: string; email: string; phone: string | null } | undefined;
        if (!membership) throw new HttpError(404, "USER_NOT_FOUND", "Usuário não encontrado nesta clínica.");
        if (input.active === false && membership.userId === auth.userId) {
          throw new HttpError(409, "CANNOT_DEACTIVATE_SELF", "Não é possível desativar a própria conta.");
        }
        const passwordHash = input.password ? await hashPassword(input.password) : undefined;
        db.prepare(
          `UPDATE USUARIO SET nome = ?, email = ?, telefone = ?,
           password_hash = COALESCE(?, password_hash), ativo = COALESCE(?, ativo), dt_atualizacao = ?
           WHERE id = ?`,
        ).run(
          input.fullName ?? membership.fullName,
          input.email?.toLowerCase() ?? membership.email,
          inputOrCurrent(request.body, "phone", input.phone, membership.phone),
          passwordHash ?? null, input.active === undefined ? null : Number(input.active), now, membership.userId,
        );
        if (input.active !== undefined) {
          db.prepare("UPDATE memberships SET status = ? WHERE id = ? AND clinic_id = ?")
            .run(input.active ? "ACTIVE" : "SUSPENDED", id, auth.clinicId);
        }
        writeAudit(auth, "user.updated", "membership", id, { passwordChanged: Boolean(input.password) });
        response.json({ id });
        return;
      }
      case "patient":
      case "therapist": {
        const patient = resource === "patient";
        const input = z.object({
          fullName: z.string().trim().min(2).max(120).optional(),
          email: z.string().email().max(254).optional(),
          phone: optionalText(30),
          password: z.string().min(10).max(128).optional(),
          cpf: optionalText(14),
          birthDate: z.string().date().nullable().optional(),
          sex: z.enum(["F", "M", "OTHER", "UNSPECIFIED"]).nullable().optional(),
          address: optionalText(500),
          professionalRegistration: optionalText(100),
          formation: optionalText(500),
          specialtyIds: z.array(recordId).max(50).optional(),
          therapyIds: z.array(recordId).max(50).optional(),
          active: z.boolean().optional(),
        }).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.").parse(request.body);
        const profile: {
          userId: string;
          cpf: string | null;
          birthDate?: string | null;
          sex?: string | null;
          address?: string | null;
          phone?: string | null;
          professionalRegistration?: string | null;
          formation?: string | null;
          therapistProfileId?: string;
          active: number;
        } | undefined = patient
          ? db.prepare(
            `SELECT usuario_id AS userId, cpf, dt_nasc AS birthDate, sexo AS sex, endereco AS address,
                    telefone AS phone, ativo AS active
             FROM PACIENTE WHERE membership_id = ? AND clinic_id = ?`,
          ).get(id, auth.clinicId) as {
            userId: string; cpf: string | null; birthDate?: string | null; sex?: string | null;
            address?: string | null; phone?: string | null; active: number;
          } | undefined
          : db.prepare(
            `SELECT usuario_id AS userId, id AS therapistProfileId, cpf, registro_prof AS professionalRegistration,
                    formacao AS formation, ativo AS active
             FROM TERAPEUTA WHERE membership_id = ? AND clinic_id = ?`,
          ).get(id, auth.clinicId) as {
            userId: string; therapistProfileId?: string; cpf: string | null; professionalRegistration?: string | null;
            formation?: string | null; active: number;
          } | undefined;
        if (!profile) throw new HttpError(404, patient ? "PATIENT_NOT_FOUND" : "THERAPIST_NOT_FOUND", "Cadastro não encontrado nesta clínica.");
        if (input.active === false && profile.userId === auth.userId) {
          throw new HttpError(409, "CANNOT_DEACTIVATE_SELF", "Não é possível desativar a própria conta.");
        }
        const currentUser = db.prepare("SELECT nome AS fullName, email, telefone AS phone FROM USUARIO WHERE id = ?")
          .get(profile.userId) as { fullName: string; email: string; phone: string | null };
        const specialtyIds = input.specialtyIds ? [...new Set(input.specialtyIds)] : undefined;
        const therapyIds = input.therapyIds ? [...new Set(input.therapyIds)] : undefined;
        if (!patient && specialtyIds && specialtyIds.length > 0) {
          const valid = db.prepare(
            `SELECT id FROM ESPECIALIDADE WHERE clinic_id = ? AND ativo = 1
             AND id IN (${specialtyIds.map(() => "?").join(", ")})`,
          ).all(auth.clinicId, ...specialtyIds) as Array<{ id: string }>;
          if (valid.length !== specialtyIds.length) throw new HttpError(400, "INVALID_SPECIALTY", "Selecione apenas especialidades ativas desta clínica.");
        }
        if (!patient && therapyIds && therapyIds.length > 0) {
          const valid = db.prepare(
            `SELECT id FROM TERAPIA WHERE clinic_id = ? AND ativa = 1
             AND id IN (${therapyIds.map(() => "?").join(", ")})`,
          ).all(auth.clinicId, ...therapyIds) as Array<{ id: string }>;
          if (valid.length !== therapyIds.length) throw new HttpError(400, "INVALID_THERAPY", "Selecione apenas terapias ativas desta clínica.");
        }
        const passwordHash = input.password ? await hashPassword(input.password) : undefined;
        db.prepare(
          `UPDATE USUARIO SET nome = ?, email = ?, telefone = ?,
           password_hash = COALESCE(?, password_hash), ativo = COALESCE(?, ativo), dt_atualizacao = ?
           WHERE id = ?`,
        ).run(
          input.fullName ?? currentUser.fullName, input.email?.toLowerCase() ?? currentUser.email,
          inputOrCurrent(request.body, "phone", input.phone, currentUser.phone), passwordHash ?? null,
          input.active === undefined ? null : Number(input.active), now, profile.userId,
        );
        if (patient) {
          db.prepare(
            `UPDATE PACIENTE SET telefone = ?, cpf = ?, dt_nasc = ?, sexo = ?, endereco = ?,
             ativo = COALESCE(?, ativo), dt_atualizacao = ?
             WHERE membership_id = ? AND clinic_id = ?`,
          ).run(
            inputOrCurrent(request.body, "phone", input.phone, profile.phone),
            inputOrCurrent(request.body, "cpf", input.cpf, profile.cpf),
            inputOrCurrent(request.body, "birthDate", input.birthDate, profile.birthDate),
            inputOrCurrent(request.body, "sex", input.sex, profile.sex),
            inputOrCurrent(request.body, "address", input.address, profile.address),
            input.active === undefined ? null : Number(input.active), now, id, auth.clinicId,
          );
        } else {
          db.prepare(
            `UPDATE TERAPEUTA SET cpf = ?, registro_prof = ?, formacao = ?,
             ativo = COALESCE(?, ativo), dt_atualizacao = ?
             WHERE membership_id = ? AND clinic_id = ?`,
          ).run(
            inputOrCurrent(request.body, "cpf", input.cpf, profile.cpf),
            inputOrCurrent(request.body, "professionalRegistration", input.professionalRegistration, profile.professionalRegistration),
            inputOrCurrent(request.body, "formation", input.formation, profile.formation),
            input.active === undefined ? null : Number(input.active), now, id, auth.clinicId,
          );
          if (specialtyIds) {
            const replaceSpecialties = db.transaction(() => {
              db.prepare("DELETE FROM TERAPEUTA_ESPECIALIDADE WHERE clinic_id = ? AND therapist_membership_id = ?").run(auth.clinicId, id);
              const add = db.prepare(
                `INSERT INTO TERAPEUTA_ESPECIALIDADE
                 (id, clinic_id, therapist_membership_id, especialidade_id, created_at, terapeuta_id)
                 VALUES (?, ?, ?, ?, ?, ?)`,
              );
              if (!profile.therapistProfileId) {
                throw new HttpError(404, "THERAPIST_NOT_FOUND", "Cadastro de terapeuta não encontrado nesta clínica.");
              }
              for (const specialtyId of specialtyIds) {
                add.run(randomUUID(), auth.clinicId, id, specialtyId, now, profile.therapistProfileId);
              }
            });
            replaceSpecialties.immediate();
          }
          if (therapyIds) {
            const replaceTherapies = db.transaction(() => {
              db.prepare("DELETE FROM therapist_therapies WHERE clinic_id = ? AND membership_id = ?").run(auth.clinicId, id);
              const add = db.prepare("INSERT INTO therapist_therapies (clinic_id, membership_id, therapy_id) VALUES (?, ?, ?)");
              for (const therapyId of therapyIds) add.run(auth.clinicId, id, therapyId);
            });
            replaceTherapies.immediate();
          }
        }
        if (input.active !== undefined) {
          db.prepare("UPDATE memberships SET status = ? WHERE id = ? AND clinic_id = ?")
            .run(input.active ? "ACTIVE" : "SUSPENDED", id, auth.clinicId);
        }
        writeAudit(auth, `${resource}.updated`, resource, id);
        response.json({ id });
        return;
      }
      case "specialty": {
        const input = z.object({
          name: z.string().trim().min(2).max(100).optional(),
          description: optionalText(1000),
          active: z.boolean().optional(),
        }).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.").parse(request.body);
        const current = db.prepare(
          "SELECT nome AS name, descricao AS description, ativo AS active FROM ESPECIALIDADE WHERE id = ? AND clinic_id = ?",
        ).get(id, auth.clinicId) as { name: string; description: string | null; active: number } | undefined;
        if (!current) throw new HttpError(404, "SPECIALTY_NOT_FOUND", "Especialidade não encontrada.");
        const result = db.prepare(
          `UPDATE ESPECIALIDADE SET nome = ?, descricao = ?, ativo = COALESCE(?, ativo)
           WHERE id = ? AND clinic_id = ?`,
        ).run(
          input.name ?? current.name,
          inputOrCurrent(request.body, "description", input.description, current.description),
          input.active === undefined ? null : Number(input.active), id, auth.clinicId,
        );
        if (result.changes !== 1) throw new HttpError(404, "SPECIALTY_NOT_FOUND", "Especialidade não encontrada.");
        writeAudit(auth, "specialty.updated", "specialty", id);
        response.json({ id });
        return;
      }
      case "therapy": {
        const input = z.object({
          specialtyId: recordId.optional(),
          name: z.string().trim().min(2).max(100).optional(),
          description: optionalText(1000),
          durationMinutes: z.number().int().min(10).max(480).optional(),
          active: z.boolean().optional(),
        }).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.").parse(request.body);
        if (input.specialtyId) {
          const specialty = db.prepare("SELECT id FROM ESPECIALIDADE WHERE id = ? AND clinic_id = ?").get(input.specialtyId, auth.clinicId);
          if (!specialty) throw new HttpError(404, "SPECIALTY_NOT_FOUND", "Especialidade não encontrada nesta clínica.");
        }
        const current = db.prepare(
          `SELECT especialidade_id AS specialtyId, nome AS name, descricao AS description,
                  duracao_min AS durationMinutes, ativa AS active
           FROM TERAPIA WHERE id = ? AND clinic_id = ?`,
        ).get(id, auth.clinicId) as {
          specialtyId: string; name: string; description: string | null; durationMinutes: number; active: number;
        } | undefined;
        if (!current) throw new HttpError(404, "THERAPY_NOT_FOUND", "Terapia não encontrada.");
        const result = db.prepare(
          `UPDATE TERAPIA SET especialidade_id = ?, nome = ?,
           descricao = ?, duracao_min = ?, ativa = COALESCE(?, ativa)
           WHERE id = ? AND clinic_id = ?`,
        ).run(
          input.specialtyId ?? current.specialtyId, input.name ?? current.name,
          inputOrCurrent(request.body, "description", input.description, current.description), input.durationMinutes ?? current.durationMinutes,
          input.active === undefined ? null : Number(input.active), id, auth.clinicId,
        );
        if (result.changes !== 1) throw new HttpError(404, "THERAPY_NOT_FOUND", "Terapia não encontrada.");
        writeAudit(auth, "therapy.updated", "therapy", id);
        response.json({ id });
        return;
      }
      case "protocol": {
        const input = z.object({
          therapyId: recordId.optional(),
          therapistId: recordId.nullable().optional(),
          diagnosisId: recordId.nullable().optional(),
          name: z.string().trim().min(2).max(160).optional(),
          description: optionalText(2000),
          objective: optionalText(1000),
          active: z.boolean().optional(),
        }).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.").parse(request.body);
        if (input.therapyId && !db.prepare("SELECT id FROM TERAPIA WHERE id = ? AND clinic_id = ?").get(input.therapyId, auth.clinicId)) {
          throw new HttpError(404, "THERAPY_NOT_FOUND", "Terapia não encontrada nesta clínica.");
        }
        if (input.therapistId) assertClinicMember(auth.clinicId, input.therapistId, "THERAPIST");
        if (input.diagnosisId && !db.prepare("SELECT id FROM DIAGNOSTICO WHERE id = ? AND clinic_id = ?").get(input.diagnosisId, auth.clinicId)) {
          throw new HttpError(404, "DIAGNOSIS_NOT_FOUND", "Diagnóstico não encontrado nesta clínica.");
        }
        const therapistProfile = input.therapistId
          ? db.prepare("SELECT id FROM TERAPEUTA WHERE membership_id = ? AND clinic_id = ?").get(input.therapistId, auth.clinicId) as { id: string } | undefined
          : undefined;
        const current = db.prepare(
          `SELECT therapist_membership_id AS therapistId, terapeuta_id AS therapistProfileId,
                  diagnostico_id AS diagnosisId, nome AS name, descricao AS description, objetivo AS objective
           FROM PROTOCOLO WHERE id = ? AND clinic_id = ?`,
        ).get(id, auth.clinicId) as {
          therapistId: string | null; therapistProfileId: string | null; diagnosisId: string | null;
          name: string; description: string | null; objective: string | null;
        } | undefined;
        if (!current) throw new HttpError(404, "PROTOCOL_NOT_FOUND", "Protocolo não encontrado.");
        const diagnosis = input.diagnosisId === undefined ? current.diagnosisId : input.diagnosisId;
        const updateProtocol = db.transaction(() => {
          const result = db.prepare(
            `UPDATE PROTOCOLO SET terapia_id = COALESCE(?, terapia_id),
             therapist_membership_id = ?, terapeuta_id = ?, diagnostico_id = ?,
             nome = COALESCE(?, nome), descricao = ?, objetivo = ?, ativo = COALESCE(?, ativo), updated_at = ?
             WHERE id = ? AND clinic_id = ?`,
          ).run(
            input.therapyId ?? null,
            input.therapistId === undefined ? current.therapistId : input.therapistId,
            input.therapistId === undefined ? current.therapistProfileId : therapistProfile?.id ?? null,
            input.diagnosisId === undefined ? current.diagnosisId : input.diagnosisId,
            input.name ?? current.name,
            inputOrCurrent(request.body, "description", input.description, current.description),
            inputOrCurrent(request.body, "objective", input.objective, current.objective),
            input.active === undefined ? null : Number(input.active), now, id, auth.clinicId,
          );
          if (result.changes !== 1) throw new HttpError(404, "PROTOCOL_NOT_FOUND", "Protocolo não encontrado.");
          protocolDiagnosisLinks(auth.clinicId, id, diagnosis);
        });
        updateProtocol.immediate();
        writeAudit(auth, "protocol.updated", "protocol", id);
        response.json({ id });
        return;
      }
      case "diagnosis": {
        const input = z.object({
          patientId: recordId.optional(),
          therapistId: recordId.optional(),
          description: z.string().trim().min(2).max(4000).optional(),
          diagnosedAt: z.string().date().optional(),
        }).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.").parse(request.body);
        const current = db.prepare(
          "SELECT patient_membership_id AS patientId, therapist_membership_id AS therapistId FROM DIAGNOSTICO WHERE id = ? AND clinic_id = ?",
        ).get(id, auth.clinicId) as { patientId: string; therapistId: string } | undefined;
        if (!current) throw new HttpError(404, "DIAGNOSIS_NOT_FOUND", "Diagnóstico não encontrado.");
        const patientId = input.patientId ?? current.patientId;
        const therapistId = input.therapistId ?? current.therapistId;
        assertClinicMember(auth.clinicId, patientId, "PATIENT");
        assertClinicMember(auth.clinicId, therapistId, "THERAPIST");
        const chartId = getOrCreateChart(auth.clinicId, patientId);
        const patientProfile = db.prepare("SELECT id FROM PACIENTE WHERE membership_id = ? AND clinic_id = ?").get(patientId, auth.clinicId) as { id: string };
        const therapistProfile = db.prepare("SELECT id FROM TERAPEUTA WHERE membership_id = ? AND clinic_id = ?").get(therapistId, auth.clinicId) as { id: string };
        db.prepare(
          `UPDATE DIAGNOSTICO SET patient_chart_id = ?, patient_membership_id = ?, therapist_membership_id = ?,
           paciente_id = ?, terapeuta_id = ?, descricao = COALESCE(?, descricao),
           dt_diagnostico = COALESCE(?, dt_diagnostico) WHERE id = ? AND clinic_id = ?`,
        ).run(
          chartId, patientId, therapistId, patientProfile.id, therapistProfile.id,
          input.description ?? null, input.diagnosedAt ?? null, id, auth.clinicId,
        );
        writeAudit(auth, "diagnosis.updated", "diagnosis", id);
        response.json({ id });
        return;
      }
      case "evolution": {
        const input = z.object({
          diagnosisProtocolId: recordId.optional(),
          description: z.string().trim().min(2).max(4000).optional(),
          evolvedAt: z.string().date().optional(),
          status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
        }).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.").parse(request.body);
        if (input.diagnosisProtocolId && !db.prepare(
          "SELECT id FROM DIAGNOSTICO_PROTOCOLO WHERE id = ? AND clinic_id = ?",
        ).get(input.diagnosisProtocolId, auth.clinicId)) {
          throw new HttpError(404, "DIAGNOSIS_PROTOCOL_NOT_FOUND", "Vínculo de diagnóstico e protocolo não encontrado.");
        }
        const result = db.prepare(
          `UPDATE EVOLUCAO SET diagnostico_protocolo_id = COALESCE(?, diagnostico_protocolo_id),
           descricao = COALESCE(?, descricao), dt_evolucao = COALESCE(?, dt_evolucao),
           status = COALESCE(?, status) WHERE id = ? AND clinic_id = ?`,
        ).run(
          input.diagnosisProtocolId ?? null, input.description ?? null, input.evolvedAt ?? null,
          input.status ?? null, id, auth.clinicId,
        );
        if (result.changes !== 1) throw new HttpError(404, "EVOLUTION_NOT_FOUND", "Evolução não encontrada.");
        writeAudit(auth, "evolution.updated", "evolution", id);
        response.json({ id });
        return;
      }
      case "agenda":
        throw new HttpError(405, "USE_APPOINTMENT_ENDPOINT", "Use as ações de remarcação e cancelamento da agenda.");
      case "encounter": {
        const input = z.object({
          chartId: recordId.optional(),
          therapistId: recordId.optional(),
          therapyId: recordId.optional(),
          appointmentId: recordId.nullable().optional(),
          attendedAt: z.string().datetime({ offset: true }).optional(),
          status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]).optional(),
          notes: optionalText(4000),
        }).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.").parse(request.body);
        const current = db.prepare(
          "SELECT prontuario_id AS chartId, therapist_membership_id AS therapistId, terapia_id AS therapyId FROM ATENDIMENTO WHERE id = ? AND clinic_id = ?",
        ).get(id, auth.clinicId) as { chartId: string; therapistId: string; therapyId: string } | undefined;
        if (!current) throw new HttpError(404, "ENCOUNTER_NOT_FOUND", "Atendimento não encontrado.");
        const chartId = input.chartId ?? current.chartId;
        const chart = db.prepare(
          "SELECT patient_membership_id AS patientId FROM PRONTUARIO WHERE id = ? AND clinic_id = ?",
        ).get(chartId, auth.clinicId) as { patientId: string } | undefined;
        if (!chart) throw new HttpError(404, "CHART_NOT_FOUND", "Prontuário não encontrado nesta clínica.");
        const therapistId = input.therapistId ?? current.therapistId;
        const therapyId = input.therapyId ?? current.therapyId;
        assertClinicMember(auth.clinicId, therapistId, "THERAPIST");
        if (!db.prepare("SELECT id FROM TERAPIA WHERE id = ? AND clinic_id = ?").get(therapyId, auth.clinicId)) {
          throw new HttpError(404, "THERAPY_NOT_FOUND", "Terapia não encontrada nesta clínica.");
        }
        const patientProfile = db.prepare("SELECT id FROM PACIENTE WHERE membership_id = ? AND clinic_id = ?").get(chart.patientId, auth.clinicId) as { id: string };
        const therapistProfile = db.prepare("SELECT id FROM TERAPEUTA WHERE membership_id = ? AND clinic_id = ?").get(therapistId, auth.clinicId) as { id: string };
        const result = db.prepare(
          `UPDATE ATENDIMENTO SET prontuario_id = ?, patient_membership_id = ?, therapist_membership_id = ?,
           terapia_id = ?, agenda_id = ?, dt_atend = COALESCE(?, dt_atend), status = COALESCE(?, status),
           notes = ?, updated_at = ?, paciente_id = ?, terapeuta_id = ?
           WHERE id = ? AND clinic_id = ?`,
        ).run(
          chartId, chart.patientId, therapistId, therapyId, input.appointmentId ?? null,
          input.attendedAt ?? null, input.status ?? null, input.notes ?? null, now,
          patientProfile.id, therapistProfile.id, id, auth.clinicId,
        );
        if (result.changes !== 1) throw new HttpError(404, "ENCOUNTER_NOT_FOUND", "Atendimento não encontrado.");
        writeAudit(auth, "encounter.updated", "encounter", id);
        response.json({ id });
        return;
      }
      case "chart": {
        const input = z.object({
          patientId: recordId.optional(),
          openedAt: z.string().date().optional(),
          status: z.enum(["ACTIVE", "CLOSED", "ARCHIVED"]).optional(),
        }).refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.").parse(request.body);
        const current = db.prepare(
          "SELECT patient_membership_id AS patientId FROM PRONTUARIO WHERE id = ? AND clinic_id = ?",
        ).get(id, auth.clinicId) as { patientId: string } | undefined;
        if (!current) throw new HttpError(404, "CHART_NOT_FOUND", "Prontuário não encontrado.");
        const patientId = input.patientId ?? current.patientId;
        assertClinicMember(auth.clinicId, patientId, "PATIENT");
        const patientProfile = db.prepare("SELECT id FROM PACIENTE WHERE membership_id = ? AND clinic_id = ?").get(patientId, auth.clinicId) as { id: string };
        const result = db.prepare(
          `UPDATE PRONTUARIO SET patient_membership_id = ?, paciente_id = ?,
           data_abertura = COALESCE(?, data_abertura), status = COALESCE(?, status)
           WHERE id = ? AND clinic_id = ?`,
        ).run(patientId, patientProfile.id, input.openedAt ?? null, input.status ?? null, id, auth.clinicId);
        if (result.changes !== 1) throw new HttpError(404, "CHART_NOT_FOUND", "Prontuário não encontrado.");
        writeAudit(auth, "chart.updated", "chart", id);
        response.json({ id });
        return;
      }
    }
  } catch (error) {
    next(error);
  }
});
