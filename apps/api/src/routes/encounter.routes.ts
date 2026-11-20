import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/database.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { writeAudit } from "../services/audit.js";
import { HttpError } from "../utils/http-error.js";

export const encounterRouter = Router();

const uploadRoot = resolve(fileURLToPath(new URL("../../../../data/uploads", import.meta.url)));
mkdirSync(uploadRoot, { recursive: true });

const attachmentSelection = `
  SELECT id, tipo AS type, original_filename AS originalFilename,
         content_type AS contentType, size_bytes AS sizeBytes,
         descricao AS description, dt_upload AS uploadedAt
  FROM ANEXO`;

function getAttachments(attendanceId: string, clinicId: string) {
  return db
    .prepare(`${attachmentSelection} WHERE atendimento_id = ? AND clinic_id = ? ORDER BY dt_upload DESC`)
    .all(attendanceId, clinicId)
    .map((attachment) => ({
      ...attachment as { id: string; type: string; originalFilename: string; contentType: string; sizeBytes: number; description: string | null; uploadedAt: string },
      url: `/api/v1/encounters/attachments/${(attachment as { id: string }).id}/content`,
    }));
}

const appointmentSelection = `
  SELECT a.id AS appointmentId, a.patient_membership_id AS patientMembershipId,
         a.therapist_membership_id AS therapistMembershipId, a.terapia_id AS therapyId,
         a.dt_inicio AS startsAt, a.dt_fim AS endsAt, a.status AS appointmentStatus,
         t.nome AS therapyName, patientUser.nome AS patientName, therapistUser.nome AS therapistName
  FROM AGENDA a
  JOIN TERAPIA t ON t.id = a.terapia_id AND t.clinic_id = a.clinic_id
  JOIN memberships patient ON patient.id = a.patient_membership_id AND patient.clinic_id = a.clinic_id
  JOIN USUARIO patientUser ON patientUser.id = patient.user_id
  JOIN memberships therapist ON therapist.id = a.therapist_membership_id AND therapist.clinic_id = a.clinic_id
  JOIN USUARIO therapistUser ON therapistUser.id = therapist.user_id
`;
const encounterListSelection = appointmentSelection.replace(
  "SELECT a.id AS appointmentId,",
  "SELECT attendance.id AS encounterId, attendance.status AS attendanceStatus, a.id AS appointmentId,",
);

function assertClinicalRole(role: string): asserts role is "THERAPIST" | "PATIENT" {
  if (role !== "THERAPIST" && role !== "PATIENT") {
    throw new HttpError(403, "CLINICAL_ACCESS_REQUIRED", "Atendimentos estão disponíveis para terapeutas e pacientes.");
  }
}

function getAppointment(appointmentId: string, clinicId: string, membershipId: string, role: string) {
  assertClinicalRole(role);
  const memberColumn = role === "THERAPIST" ? "therapist_membership_id" : "patient_membership_id";
  const appointment = db
    .prepare(
      `${appointmentSelection}
       WHERE a.id = ? AND a.clinic_id = ? AND a.${memberColumn} = ?`,
    )
    .get(appointmentId, clinicId, membershipId);
  if (!appointment) throw new HttpError(404, "APPOINTMENT_NOT_FOUND", "Atendimento não encontrado nesta clínica.");
  return appointment as {
    appointmentId: string;
    patientMembershipId: string;
    therapistMembershipId: string;
    therapyId: string;
    startsAt: string;
    endsAt: string;
    appointmentStatus: string;
    therapyName: string;
    patientName: string;
    therapistName: string;
  };
}

function getAttendance(appointmentId: string, clinicId: string) {
  return db
    .prepare(
      `SELECT id, prontuario_id AS chartId, dt_atend AS attendedAt, status, notes, created_at AS createdAt
       FROM ATENDIMENTO WHERE agenda_id = ? AND clinic_id = ?`,
    )
    .get(appointmentId, clinicId) as {
    id: string;
    chartId: string;
    attendedAt: string;
    status: "ACTIVE" | "COMPLETED" | "CANCELLED";
    notes: string | null;
    createdAt: string;
  } | undefined;
}

function getEncounterDetails(appointmentId: string, clinicId: string, membershipId: string, role: string) {
  const appointment = getAppointment(appointmentId, clinicId, membershipId, role);
  const attendance = getAttendance(appointmentId, clinicId);
  const questions = db
    .prepare(
      `SELECT q.id, q.descricao AS description
       FROM PERGUNTAS q
       WHERE q.clinic_id = ? AND q.ativo = 1
       ORDER BY q.display_order, q.descricao`,
    )
    .all(clinicId);

  if (!attendance) {
    return {
      appointment,
      attendance: null,
      questions,
      anamneses: [],
      diagnoses: [],
      protocols: [],
      protocolOptions: getProtocolOptions(clinicId, appointment.therapyId),
      evolutions: [],
      attachments: [],
    };
  }

  const anamneses = db
    .prepare(
      `SELECT id, tipo AS type, descricao AS description, dt_registro AS registeredAt
       FROM ANAMNESE WHERE atendimento_id = ? AND clinic_id = ? ORDER BY dt_registro DESC`,
    )
    .all(attendance.id, clinicId) as Array<{
    id: string;
    type: string;
    description: string;
    registeredAt: string;
  }>;
  const answers = db
    .prepare(
      `SELECT ap.anamnese_id AS anamnesisId, ap.pergunta_id AS questionId,
              q.descricao AS question, ap."Resposta" AS answer
       FROM ANAMNESE_PERGUNTAS ap
       JOIN ANAMNESE anamnesis ON anamnesis.id = ap.anamnese_id AND anamnesis.clinic_id = ap.clinic_id
       JOIN PERGUNTAS q ON q.id = ap.pergunta_id AND q.clinic_id = ap.clinic_id
       WHERE anamnesis.atendimento_id = ? AND ap.clinic_id = ?
       ORDER BY q.display_order, q.descricao`,
    )
    .all(attendance.id, clinicId) as Array<{
    anamnesisId: string;
    questionId: string;
    question: string;
    answer: string;
  }>;
  const diagnoses = db
    .prepare(
      `SELECT id, descricao AS description, dt_diagnostico AS diagnosedAt
       FROM DIAGNOSTICO WHERE encounter_id = ? AND clinic_id = ? ORDER BY dt_diagnostico DESC`,
    )
    .all(attendance.id, clinicId);
  const protocols = db
    .prepare(
      `SELECT dp.id AS diagnosisProtocolId, d.id AS diagnosisId, d.descricao AS diagnosisDescription,
              p.id AS protocolId, p.nome AS protocolName, step.id AS stepId,
              step.sequencia AS sequence, step.descricao AS stepDescription,
              step.dt_inicio AS startsAt, step.dt_fim AS endsAt, step.obs AS stepNotes,
              dp.dt_diagnostico AS startedAt, dp.status, dp.notes
       FROM DIAGNOSTICO_PROTOCOLO dp
       JOIN DIAGNOSTICO d ON d.id = dp.diagnostico_id AND d.clinic_id = dp.clinic_id
       JOIN PROTOCOLO_ETAPA step ON step.id = dp.protocolo_etapa_id AND step.clinic_id = dp.clinic_id
       JOIN PROTOCOLO p ON p.id = step.protocolo_id AND p.clinic_id = step.clinic_id
       WHERE d.encounter_id = ? AND dp.clinic_id = ?
       ORDER BY p.nome, step.sequencia`,
    )
    .all(attendance.id, clinicId);
  const evolutions = db
    .prepare(
      `SELECT e.id, e.diagnostico_protocolo_id AS diagnosisProtocolId,
              e.descricao AS description, e.dt_evolucao AS evolvedAt, e.status,
              step.sequencia AS sequence, step.descricao AS stepDescription,
              p.nome AS protocolName, authorUser.nome AS authorName
       FROM EVOLUCAO e
       JOIN DIAGNOSTICO_PROTOCOLO dp ON dp.id = e.diagnostico_protocolo_id AND dp.clinic_id = e.clinic_id
       JOIN DIAGNOSTICO d ON d.id = dp.diagnostico_id AND d.clinic_id = dp.clinic_id
       JOIN PROTOCOLO_ETAPA step ON step.id = dp.protocolo_etapa_id AND step.clinic_id = dp.clinic_id
       JOIN PROTOCOLO p ON p.id = step.protocolo_id AND p.clinic_id = step.clinic_id
       JOIN memberships author ON author.id = e.author_membership_id AND author.clinic_id = e.clinic_id
       JOIN USUARIO authorUser ON authorUser.id = author.user_id
       WHERE d.encounter_id = ? AND e.clinic_id = ?
       ORDER BY e.dt_evolucao DESC, e.created_at DESC`,
    )
    .all(attendance.id, clinicId);

  return {
    appointment,
    attendance,
    questions,
    anamneses: anamneses.map((anamnesis) => ({
      ...anamnesis,
      answers: answers.filter((answer) => answer.anamnesisId === anamnesis.id),
    })),
    diagnoses,
    protocols,
    protocolOptions: getProtocolOptions(clinicId, appointment.therapyId),
    evolutions,
    attachments: getAttachments(attendance.id, clinicId),
  };
}

function getProtocolOptions(clinicId: string, therapyId: string) {
  const rows = db
    .prepare(
      `SELECT p.id, p.nome AS name, p.descricao AS description, p.objetivo AS objective,
              step.id AS stepId, step.sequencia AS sequence, step.dt_inicio AS startsAt,
              step.dt_fim AS endsAt, step.descricao AS stepDescription, step.obs AS notes
       FROM PROTOCOLO p
       LEFT JOIN PROTOCOLO_ETAPA step ON step.protocolo_id = p.id AND step.clinic_id = p.clinic_id
       WHERE p.clinic_id = ? AND p.terapia_id = ? AND p.ativo = 1
       ORDER BY p.nome, step.sequencia`,
    )
    .all(clinicId, therapyId) as Array<{
    id: string;
    name: string;
    description: string | null;
    objective: string | null;
    stepId: string | null;
    sequence: number | null;
    startsAt: string | null;
    endsAt: string | null;
    stepDescription: string | null;
    notes: string | null;
  }>;
  const protocols = new Map<string, {
    id: string;
    name: string;
    description: string | null;
    objective: string | null;
    steps: Array<{
      id: string;
      sequence: number;
      startsAt: string | null;
      endsAt: string | null;
      description: string;
      notes: string | null;
    }>;
  }>();
  for (const row of rows) {
    let protocol = protocols.get(row.id);
    if (!protocol) {
      protocol = { id: row.id, name: row.name, description: row.description, objective: row.objective, steps: [] };
      protocols.set(row.id, protocol);
    }
    if (row.stepId && row.sequence !== null && row.stepDescription !== null) {
      protocol.steps.push({
        id: row.stepId,
        sequence: row.sequence,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        description: row.stepDescription,
        notes: row.notes,
      });
    }
  }
  return [...protocols.values()];
}

function requireTherapist(role: string): void {
  if (role !== "THERAPIST") {
    throw new HttpError(403, "FORBIDDEN", "Somente terapeutas podem alterar o atendimento.");
  }
}

function requireActiveAttendance(appointmentId: string, clinicId: string) {
  const attendance = getAttendance(appointmentId, clinicId);
  if (!attendance) throw new HttpError(409, "ATTENDANCE_NOT_STARTED", "Inicie o atendimento antes de registrar as informações.");
  if (attendance.status !== "ACTIVE") throw new HttpError(409, "ATTENDANCE_NOT_ACTIVE", "Este atendimento já foi encerrado.");
  return attendance;
}

encounterRouter.get("/encounters", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    assertClinicalRole(auth.role);
    const memberColumn = auth.role === "THERAPIST" ? "therapist_membership_id" : "patient_membership_id";
    const encounters = db
      .prepare(
        `${encounterListSelection}
         LEFT JOIN ATENDIMENTO attendance
           ON attendance.agenda_id = a.id AND attendance.clinic_id = a.clinic_id
         WHERE a.clinic_id = ? AND a.${memberColumn} = ? AND a.status <> 'CANCELLED'
         ORDER BY a.dt_inicio DESC LIMIT 200`,
      )
      .all(auth.clinicId, auth.membershipId)
      .map((row) => row as object);
    response.json({ encounters });
  } catch (error) {
    next(error);
  }
});

encounterRouter.get("/encounters/:appointmentId", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    const appointmentId = z.string().uuid().parse(request.params.appointmentId);
    response.json(getEncounterDetails(appointmentId, auth.clinicId, auth.membershipId, auth.role));
  } catch (error) {
    next(error);
  }
});

encounterRouter.get("/encounters/attachments/:attachmentId/content", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    assertClinicalRole(auth.role);
    const attachmentId = z.string().uuid().parse(request.params.attachmentId);
    const attachment = db.prepare(
      `SELECT a.arquivo AS filePath, a.original_filename AS originalFilename, a.content_type AS contentType,
              a.atendimento_id AS attendanceId, attendance.agenda_id AS appointmentId
       FROM ANEXO a
       JOIN ATENDIMENTO attendance ON attendance.id = a.atendimento_id AND attendance.clinic_id = a.clinic_id
       WHERE a.id = ? AND a.clinic_id = ?`,
    ).get(attachmentId, auth.clinicId) as { filePath: string; originalFilename: string; contentType: string; attendanceId: string; appointmentId: string } | undefined;
    if (!attachment) throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Arquivo não encontrado.");
    getAppointment(attachment.appointmentId, auth.clinicId, auth.membershipId, auth.role);
    const filePath = resolve(uploadRoot, attachment.filePath);
    if (!filePath.startsWith(`${uploadRoot}${process.platform === "win32" ? "\\" : "/"}`)) {
      throw new HttpError(404, "ATTACHMENT_NOT_FOUND", "Arquivo não encontrado.");
    }
    response.type(attachment.contentType);
    response.setHeader("Content-Disposition", `inline; filename="${basename(attachment.originalFilename).replace(/[^a-zA-Z0-9._-]/g, "_")}"`);
    response.send(readFileSync(filePath));
  } catch (error) {
    next(error);
  }
});

encounterRouter.post("/encounters/:appointmentId/questions", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    requireTherapist(auth.role);
    const appointmentId = z.string().uuid().parse(request.params.appointmentId);
    const appointment = getAppointment(appointmentId, auth.clinicId, auth.membershipId, auth.role);
    const input = z.object({
      description: z.string().trim().min(2).max(500),
    }).parse(request.body);
    const therapy = db.prepare(
      "SELECT especialidade_id AS specialtyId FROM TERAPIA WHERE id = ? AND clinic_id = ?",
    ).get(appointment.therapyId, auth.clinicId) as { specialtyId: string } | undefined;
    if (!therapy) throw new HttpError(404, "THERAPY_NOT_FOUND", "Terapia não encontrada nesta clínica.");
    const existing = db.prepare(
      `SELECT id, descricao AS description FROM PERGUNTAS
       WHERE clinic_id = ? AND specialty_id IS NULL AND descricao = ? AND ativo = 1`,
    ).get(auth.clinicId, input.description) as { id: string; description: string } | undefined;
    if (existing) return response.status(200).json({ question: existing, created: false });
    const question = {
      id: randomUUID(),
      description: input.description,
    };
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO PERGUNTAS (id, clinic_id, specialty_id, descricao, ativo, display_order, created_at)
       VALUES (?, ?, NULL, ?, 1, COALESCE((SELECT MAX(display_order) + 1 FROM PERGUNTAS WHERE clinic_id = ?), 0), ?)`,
    ).run(question.id, auth.clinicId, question.description, auth.clinicId, now);
    writeAudit(auth, "anamnesis.question_created", "question", question.id);
    response.status(201).json({ question, created: true });
  } catch (error) {
    next(error);
  }
});

encounterRouter.post("/encounters/:appointmentId/attachments", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    requireTherapist(auth.role);
    const appointmentId = z.string().uuid().parse(request.params.appointmentId);
    const appointment = getAppointment(appointmentId, auth.clinicId, auth.membershipId, auth.role);
    const attendance = requireActiveAttendance(appointmentId, auth.clinicId);
    const input = z.object({
      type: z.enum(["EXAM", "TONGUE_PHOTO"]),
      originalFilename: z.string().trim().min(1).max(255),
      contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
      contentBase64: z.string().min(1).max(14_000_000),
      description: z.string().trim().max(1000).optional(),
    }).parse(request.body);
    if (input.type === "TONGUE_PHOTO" && !input.contentType.startsWith("image/")) {
      throw new HttpError(400, "INVALID_TONGUE_FILE", "A foto da língua deve ser JPG ou PNG.");
    }
    const content = Buffer.from(input.contentBase64.replace(/^data:[^;]+;base64,/, ""), "base64");
    if (content.length === 0 || content.length > 10 * 1024 * 1024) {
      throw new HttpError(413, "FILE_TOO_LARGE", "Cada arquivo deve ter no máximo 10 MB.");
    }
    const chart = db.prepare("SELECT id FROM PRONTUARIO WHERE id = ? AND clinic_id = ?").get(attendance.chartId, auth.clinicId) as { id: string } | undefined;
    if (!chart) throw new HttpError(404, "CHART_NOT_FOUND", "Prontuário não encontrado.");
    const id = randomUUID();
    const storageKey = `encounters/${auth.clinicId}/${attendance.id}/${id}`;
    const filePath = resolve(uploadRoot, storageKey);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, { flag: "wx" });
    const now = new Date().toISOString();
    try {
      db.prepare(
        `INSERT INTO ANEXO
         (id, clinic_id, prontuario_id, atendimento_id, uploaded_by_membership_id, tipo, storage_key,
          original_filename, content_type, size_bytes, descricao, dt_upload, created_at, arquivo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, auth.clinicId, chart.id, attendance.id, auth.membershipId, input.type, storageKey,
        input.originalFilename, input.contentType, content.length, input.description ?? null, now, now, storageKey,
      );
    } catch (error) {
      try { unlinkSync(filePath); } catch { /* arquivo já não existe */ }
      throw error;
    }
    writeAudit(auth, "encounter.attachment_uploaded", "attachment", id, { type: input.type, appointmentId });
    response.status(201).json({
      id,
      type: input.type,
      originalFilename: input.originalFilename,
      contentType: input.contentType,
      sizeBytes: content.length,
      description: input.description ?? null,
      uploadedAt: now,
      url: `/api/v1/encounters/attachments/${id}/content`,
    });
  } catch (error) {
    next(error);
  }
});

encounterRouter.post("/encounters/:appointmentId/start", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    requireTherapist(auth.role);
    const appointmentId = z.string().uuid().parse(request.params.appointmentId);
    const appointment = getAppointment(appointmentId, auth.clinicId, auth.membershipId, auth.role);
    const createdAt = new Date().toISOString();
    const result = db.transaction(() => {
      const existing = getAttendance(appointmentId, auth.clinicId);
      if (existing) return { attendance: existing, created: false };
      if (appointment.appointmentStatus !== "CONFIRMED") {
        throw new HttpError(409, "APPOINTMENT_NOT_CONFIRMED", "Somente atendimentos confirmados podem ser iniciados.");
      }

      const chart = db
        .prepare("SELECT id FROM PRONTUARIO WHERE clinic_id = ? AND patient_membership_id = ?")
        .get(auth.clinicId, appointment.patientMembershipId) as { id: string } | undefined;
      const patientProfile = db
        .prepare("SELECT id FROM PACIENTE WHERE clinic_id = ? AND membership_id = ?")
        .get(auth.clinicId, appointment.patientMembershipId) as { id: string } | undefined;
      const therapistProfile = db
        .prepare("SELECT id FROM TERAPEUTA WHERE clinic_id = ? AND membership_id = ?")
        .get(auth.clinicId, appointment.therapistMembershipId) as { id: string } | undefined;
      if (!patientProfile || !therapistProfile) {
        throw new HttpError(409, "PROFILE_NOT_FOUND", "Não foi possível localizar os perfis vinculados ao agendamento.");
      }
      const chartId = chart?.id ?? randomUUID();
      if (!chart) {
        db.prepare(
          `INSERT INTO PRONTUARIO
           (id, clinic_id, patient_membership_id, data_abertura, status, created_at, updated_at, paciente_id)
           VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
        ).run(chartId, auth.clinicId, appointment.patientMembershipId, createdAt, createdAt, createdAt, patientProfile.id);
      }

      const attendanceId = randomUUID();
      db.prepare(
        `INSERT INTO ATENDIMENTO
         (id, clinic_id, prontuario_id, patient_membership_id, therapist_membership_id, terapia_id,
          agenda_id, dt_atend, status, created_at, updated_at, paciente_id, terapeuta_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
      ).run(
        attendanceId, auth.clinicId, chartId, appointment.patientMembershipId, appointment.therapistMembershipId,
        appointment.therapyId, appointmentId, appointment.startsAt, createdAt, createdAt, patientProfile.id,
        therapistProfile.id,
      );
      return { attendance: getAttendance(appointmentId, auth.clinicId), created: true };
    }).immediate();

    if (result.created) writeAudit(auth, "encounter.started", "encounter", result.attendance?.id ?? null);
    response.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
});

encounterRouter.post("/encounters/:appointmentId/finish", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    requireTherapist(auth.role);
    const appointmentId = z.string().uuid().parse(request.params.appointmentId);
    getAppointment(appointmentId, auth.clinicId, auth.membershipId, auth.role);
    const attendance = getAttendance(appointmentId, auth.clinicId);
    if (!attendance) throw new HttpError(404, "ATTENDANCE_NOT_FOUND", "Inicie o atendimento antes de encerrá-lo.");
    if (attendance.status === "CANCELLED") {
      throw new HttpError(409, "ATTENDANCE_CANCELLED", "Este atendimento foi cancelado.");
    }
    if (attendance.status === "ACTIVE") {
      const finishedAt = new Date().toISOString();
      db.transaction(() => {
        db.prepare("UPDATE ATENDIMENTO SET status = 'COMPLETED', updated_at = ? WHERE id = ? AND clinic_id = ?")
          .run(finishedAt, attendance.id, auth.clinicId);
        db.prepare("UPDATE AGENDA SET status = 'COMPLETED', updated_at = ? WHERE id = ? AND clinic_id = ?")
          .run(finishedAt, appointmentId, auth.clinicId);
      }).immediate();
      writeAudit(auth, "encounter.finished", "encounter", attendance.id);
    }
    response.json({ id: attendance.id, status: "COMPLETED" });
  } catch (error) {
    next(error);
  }
});

encounterRouter.post("/encounters/:appointmentId/anamneses", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    requireTherapist(auth.role);
    const appointmentId = z.string().uuid().parse(request.params.appointmentId);
    const appointment = getAppointment(appointmentId, auth.clinicId, auth.membershipId, auth.role);
    const attendance = requireActiveAttendance(appointmentId, auth.clinicId);
    const input = z.object({
      type: z.string().trim().min(2).max(100),
      description: z.string().trim().min(2).max(4000),
      selectedQuestionIds: z.array(z.string().uuid()).optional(),
      answers: z.array(z.object({
        questionId: z.string().uuid(),
        answer: z.string().trim().max(4000),
      })).max(100).default([]),
    }).parse(request.body);
    const selectedQuestionIds = input.selectedQuestionIds ?? input.answers.map((answer) => answer.questionId);
    if (selectedQuestionIds.length === 0) {
      throw new HttpError(400, "QUESTION_REQUIRED", "Selecione pelo menos uma pergunta para salvar a anamnese.");
    }
    if (new Set(selectedQuestionIds).size !== selectedQuestionIds.length) {
      throw new HttpError(400, "DUPLICATE_QUESTION", "Cada pergunta pode aparecer apenas uma vez na anamnese.");
    }
    if (new Set(input.answers.map((answer) => answer.questionId)).size !== input.answers.length) {
      throw new HttpError(400, "DUPLICATE_QUESTION", "Cada pergunta pode ter apenas uma resposta por registro.");
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    db.transaction(() => {
      const questionExists = db.prepare(
        `SELECT id FROM PERGUNTAS
         WHERE id = ? AND clinic_id = ? AND ativo = 1`,
      );
      const insertAnswer = db.prepare(
        `INSERT INTO ANAMNESE_PERGUNTAS (id, clinic_id, anamnese_id, pergunta_id, "Resposta", created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      db.prepare(
        `INSERT INTO ANAMNESE (id, clinic_id, atendimento_id, tipo, descricao, dt_registro, created_by_membership_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, auth.clinicId, attendance.id, input.type, input.description, now, auth.membershipId, now);
      for (const questionId of selectedQuestionIds) {
        if (!questionExists.get(questionId, auth.clinicId)) {
          throw new HttpError(400, "QUESTION_NOT_AVAILABLE", "Uma das perguntas não pertence à terapia deste atendimento.");
        }
      }
      for (const answer of input.answers.filter((item) => selectedQuestionIds.includes(item.questionId))) {
        if (answer.answer) {
          insertAnswer.run(randomUUID(), auth.clinicId, id, answer.questionId, answer.answer, now);
        }
      }
    }).immediate();
    writeAudit(auth, "anamnesis.created", "anamnesis", id);
    response.status(201).json({ id });
  } catch (error) {
    next(error);
  }
});

encounterRouter.patch("/encounters/:appointmentId/anamneses/:anamnesisId", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    requireTherapist(auth.role);
    const appointmentId = z.string().uuid().parse(request.params.appointmentId);
    const anamnesisId = z.string().uuid().parse(request.params.anamnesisId);
    const appointment = getAppointment(appointmentId, auth.clinicId, auth.membershipId, auth.role);
    const attendance = requireActiveAttendance(appointmentId, auth.clinicId);
    const input = z.object({
      type: z.string().trim().min(2).max(100),
      description: z.string().trim().min(2).max(4000),
      selectedQuestionIds: z.array(z.string().uuid()).min(1),
      answers: z.array(z.object({
        questionId: z.string().uuid(),
        answer: z.string().trim().max(4000),
      })).max(100).default([]),
    }).parse(request.body);
    if (new Set(input.selectedQuestionIds).size !== input.selectedQuestionIds.length) {
      throw new HttpError(400, "DUPLICATE_QUESTION", "Cada pergunta pode aparecer apenas uma vez na anamnese.");
    }
    if (new Set(input.answers.map((answer) => answer.questionId)).size !== input.answers.length) {
      throw new HttpError(400, "DUPLICATE_QUESTION", "Cada pergunta pode ter apenas uma resposta por registro.");
    }
    const existingAnamnesis = db.prepare(
      `SELECT id FROM ANAMNESE
       WHERE id = ? AND clinic_id = ? AND atendimento_id = ?`,
    ).get(anamnesisId, auth.clinicId, attendance.id);
    if (!existingAnamnesis) throw new HttpError(404, "ANAMNESIS_NOT_FOUND", "Anamnese não encontrada neste atendimento.");
    const now = new Date().toISOString();
    db.transaction(() => {
      const questionExists = db.prepare(
        `SELECT id FROM PERGUNTAS
         WHERE id = ? AND clinic_id = ? AND ativo = 1`,
      );
      const upsertAnswer = db.prepare(
        `INSERT INTO ANAMNESE_PERGUNTAS (id, clinic_id, anamnese_id, pergunta_id, "Resposta", created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (anamnese_id, pergunta_id) DO UPDATE SET "Resposta" = excluded."Resposta"`,
      );
      db.prepare("UPDATE ANAMNESE SET tipo = ?, descricao = ?, dt_registro = ? WHERE id = ? AND clinic_id = ?")
        .run(input.type, input.description, now, anamnesisId, auth.clinicId);
      for (const questionId of input.selectedQuestionIds) {
        if (!questionExists.get(questionId, auth.clinicId)) {
          throw new HttpError(400, "QUESTION_NOT_AVAILABLE", "Uma das perguntas não pertence à terapia deste atendimento.");
        }
        const answer = input.answers.find((item) => item.questionId === questionId)?.answer ?? "";
        upsertAnswer.run(randomUUID(), auth.clinicId, anamnesisId, questionId, answer, now);
      }
    }).immediate();
    writeAudit(auth, "anamnesis.updated", "anamnesis", anamnesisId);
    response.json({ id: anamnesisId });
  } catch (error) {
    next(error);
  }
});

encounterRouter.post("/encounters/:appointmentId/diagnoses", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    requireTherapist(auth.role);
    const appointmentId = z.string().uuid().parse(request.params.appointmentId);
    const appointment = getAppointment(appointmentId, auth.clinicId, auth.membershipId, auth.role);
    const attendance = requireActiveAttendance(appointmentId, auth.clinicId);
    const input = z.object({
      description: z.string().trim().min(2).max(4000),
      diagnosedAt: z.string().date(),
    }).parse(request.body);
    const patientProfile = db
      .prepare("SELECT id FROM PACIENTE WHERE clinic_id = ? AND membership_id = ?")
      .get(auth.clinicId, appointment.patientMembershipId) as { id: string } | undefined;
    const therapistProfile = db
      .prepare("SELECT id FROM TERAPEUTA WHERE clinic_id = ? AND membership_id = ?")
      .get(auth.clinicId, auth.membershipId) as { id: string } | undefined;
    if (!patientProfile || !therapistProfile) {
      throw new HttpError(409, "PROFILE_NOT_FOUND", "Não foi possível localizar os perfis vinculados ao atendimento.");
    }
    const id = randomUUID();
    db.prepare(
      `INSERT INTO DIAGNOSTICO
       (id, clinic_id, patient_chart_id, patient_membership_id, therapist_membership_id, encounter_id,
        descricao, dt_diagnostico, created_at, paciente_id, terapeuta_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, auth.clinicId, attendance.chartId, appointment.patientMembershipId, auth.membershipId,
      attendance.id, input.description, input.diagnosedAt, new Date().toISOString(), patientProfile.id,
      therapistProfile.id,
    );
    writeAudit(auth, "diagnosis.created", "diagnosis", id);
    response.status(201).json({ id });
  } catch (error) {
    next(error);
  }
});

encounterRouter.post("/encounters/:appointmentId/protocols", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    requireTherapist(auth.role);
    const appointmentId = z.string().uuid().parse(request.params.appointmentId);
    const appointment = getAppointment(appointmentId, auth.clinicId, auth.membershipId, auth.role);
    requireActiveAttendance(appointmentId, auth.clinicId);
    const input = z.object({
      diagnosisId: z.string().uuid(),
      protocolId: z.string().uuid(),
    }).parse(request.body);
    const diagnosis = db.prepare(
      "SELECT id FROM DIAGNOSTICO WHERE id = ? AND clinic_id = ? AND encounter_id = ?",
    ).get(input.diagnosisId, auth.clinicId, getAttendance(appointmentId, auth.clinicId)?.id);
    if (!diagnosis) throw new HttpError(404, "DIAGNOSIS_NOT_FOUND", "Diagnóstico não encontrado neste atendimento.");
    const protocol = db.prepare(
      "SELECT id FROM PROTOCOLO WHERE id = ? AND clinic_id = ? AND terapia_id = ? AND ativo = 1",
    ).get(input.protocolId, auth.clinicId, appointment.therapyId);
    if (!protocol) throw new HttpError(404, "PROTOCOL_NOT_FOUND", "Protocolo não disponível para esta terapia.");
    const steps = db.prepare(
      "SELECT id FROM PROTOCOLO_ETAPA WHERE protocolo_id = ? AND clinic_id = ? ORDER BY sequencia",
    ).all(input.protocolId, auth.clinicId) as Array<{ id: string }>;
    if (steps.length === 0) throw new HttpError(409, "PROTOCOL_WITHOUT_STEPS", "Adicione etapas ao protocolo antes de vinculá-lo.");
    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO DIAGNOSTICO_PROTOCOLO
       (id, clinic_id, diagnostico_id, protocolo_etapa_id, dt_diagnostico, status, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM DIAGNOSTICO_PROTOCOLO
         WHERE clinic_id = ? AND diagnostico_id = ? AND protocolo_etapa_id = ?
       )`,
    );
    let linkedSteps = 0;
    db.transaction(() => {
      for (const [index, step] of steps.entries()) {
        linkedSteps += insert.run(
          randomUUID(), auth.clinicId, input.diagnosisId, step.id, now, index === 0 ? "IN_PROGRESS" : "PLANNED",
          now, auth.clinicId, input.diagnosisId, step.id,
        ).changes;
      }
    }).immediate();
    writeAudit(auth, "protocol.attached", "diagnosis", input.diagnosisId, { protocolId: input.protocolId, linkedSteps });
    response.status(201).json({ protocolId: input.protocolId, linkedSteps });
  } catch (error) {
    next(error);
  }
});

encounterRouter.patch("/encounters/:appointmentId/protocol-stages/:diagnosisProtocolId", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    requireTherapist(auth.role);
    const appointmentId = z.string().uuid().parse(request.params.appointmentId);
    getAppointment(appointmentId, auth.clinicId, auth.membershipId, auth.role);
    const attendance = requireActiveAttendance(appointmentId, auth.clinicId);
    const diagnosisProtocolId = z.string().uuid().parse(request.params.diagnosisProtocolId);
    const input = z.object({
      status: z.enum(["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
      notes: z.string().trim().max(1000).optional(),
    }).parse(request.body);
    const result = db.prepare(
      `UPDATE DIAGNOSTICO_PROTOCOLO SET status = ?, notes = COALESCE(?, notes)
       WHERE id = ? AND clinic_id = ?
         AND diagnostico_id IN (SELECT id FROM DIAGNOSTICO WHERE encounter_id = ?)`,
    ).run(input.status, input.notes ?? null, diagnosisProtocolId, auth.clinicId, attendance.id);
    if (result.changes !== 1) throw new HttpError(404, "PROTOCOL_STAGE_NOT_FOUND", "Etapa não encontrada neste atendimento.");
    writeAudit(auth, "protocol_stage.updated", "diagnosis_protocol", diagnosisProtocolId, { status: input.status });
    response.json({ id: diagnosisProtocolId, status: input.status });
  } catch (error) {
    next(error);
  }
});

encounterRouter.post("/encounters/:appointmentId/evolutions", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    requireTherapist(auth.role);
    const appointmentId = z.string().uuid().parse(request.params.appointmentId);
    getAppointment(appointmentId, auth.clinicId, auth.membershipId, auth.role);
    const attendance = requireActiveAttendance(appointmentId, auth.clinicId);
    const input = z.object({
      diagnosisProtocolId: z.string().uuid(),
      description: z.string().trim().min(2).max(4000),
      evolvedAt: z.string().date(),
      status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]).default("IN_PROGRESS"),
    }).parse(request.body);
    const link = db.prepare(
      `SELECT dp.id FROM DIAGNOSTICO_PROTOCOLO dp
       JOIN DIAGNOSTICO d ON d.id = dp.diagnostico_id AND d.clinic_id = dp.clinic_id
       WHERE dp.id = ? AND dp.clinic_id = ? AND d.encounter_id = ?`,
    ).get(input.diagnosisProtocolId, auth.clinicId, attendance.id);
    if (!link) throw new HttpError(404, "DIAGNOSIS_PROTOCOL_NOT_FOUND", "Etapa não encontrada neste atendimento.");
    const id = randomUUID();
    db.prepare(
      `INSERT INTO EVOLUCAO
       (id, clinic_id, diagnostico_protocolo_id, author_membership_id, descricao, dt_evolucao, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, auth.clinicId, input.diagnosisProtocolId, auth.membershipId, input.description,
      input.evolvedAt, input.status, new Date().toISOString(),
    );
    writeAudit(auth, "evolution.created", "evolution", id);
    response.status(201).json({ id });
  } catch (error) {
    next(error);
  }
});
