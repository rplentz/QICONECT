import { randomUUID } from "node:crypto";
import { Router } from "express";
import { canPatientCancelAppointment } from "@qiconect/contracts";
import { z } from "zod";
import { db } from "../db/database.js";
import { getAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { queueAppointmentNotice, queueCancellationNotice } from "../services/notifications.js";
import { writeAudit } from "../services/audit.js";
import { HttpError } from "../utils/http-error.js";

export const appointmentRouter = Router();

const appointmentSelection = `
  SELECT a.id, a.patient_membership_id AS patientMembershipId,
         a.therapist_membership_id AS therapistMembershipId, a.terapia_id AS therapyId,
         a.dt_inicio AS startsAt, a.dt_fim AS endsAt, a.status,
         a.cancellation_reason AS cancellationReason, t.nome AS therapyName,
         patientUser.nome AS patientName, therapistUser.nome AS therapistName
  FROM AGENDA a
  JOIN TERAPIA t ON t.id = a.terapia_id AND t.clinic_id = a.clinic_id
  JOIN memberships patientMembership ON patientMembership.id = a.patient_membership_id
  JOIN USUARIO patientUser ON patientUser.id = patientMembership.user_id
  JOIN memberships therapistMembership ON therapistMembership.id = a.therapist_membership_id
  JOIN USUARIO therapistUser ON therapistUser.id = therapistMembership.user_id
`;

function getLocalTime(date: Date, timezone: string): { weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekdayLabel = parts.find((part) => part.type === "weekday")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const weekday = weekdayNames.indexOf(weekdayLabel ?? "");
  if (weekday < 0 || !hour || !minute) throw new HttpError(400, "INVALID_DATE", "Não foi possível interpretar o horário.");
  return { weekday, time: `${hour}:${minute}` };
}

function ensureAppointmentAvailability(
  auth: ReturnType<typeof getAuth>,
  therapistMembershipId: string,
  startsAt: Date,
  endsAt: Date,
): void {
  const start = getLocalTime(startsAt, auth.clinicTimezone);
  const end = getLocalTime(endsAt, auth.clinicTimezone);
  if (start.weekday !== end.weekday || start.time >= end.time) {
    throw new HttpError(400, "INVALID_SLOT", "O atendimento deve começar e terminar no mesmo dia.");
  }

  const rule = db
    .prepare(
      `SELECT id FROM availability_rules
       WHERE clinic_id = ? AND therapist_membership_id = ? AND weekday = ? AND active = 1
         AND starts_at <= ? AND ends_at >= ? LIMIT 1`,
    )
    .get(auth.clinicId, therapistMembershipId, start.weekday, start.time, end.time);
  if (!rule) throw new HttpError(409, "OUTSIDE_AVAILABILITY", "Este horário está fora da disponibilidade do terapeuta.");

  const block = db
    .prepare(
      `SELECT id FROM schedule_blocks
       WHERE clinic_id = ? AND therapist_membership_id = ? AND starts_at < ? AND ends_at > ? LIMIT 1`,
    )
    .get(auth.clinicId, therapistMembershipId, endsAt.toISOString(), startsAt.toISOString());
  if (block) throw new HttpError(409, "SCHEDULE_BLOCKED", "O terapeuta não está disponível neste horário.");
}

function ensureNoConflict(
  clinicId: string,
  therapistMembershipId: string,
  patientMembershipId: string,
  startsAt: Date,
  endsAt: Date,
  excludingAppointmentId?: string,
): void {
  const conflict = db
    .prepare(
      `SELECT id FROM AGENDA
       WHERE clinic_id = ? AND status = 'CONFIRMED' AND dt_inicio < ? AND dt_fim > ?
         AND (therapist_membership_id = ? OR patient_membership_id = ?)
         AND (? IS NULL OR id <> ?) LIMIT 1`,
    )
    .get(
      clinicId,
      endsAt.toISOString(),
      startsAt.toISOString(),
      therapistMembershipId,
      patientMembershipId,
      excludingAppointmentId ?? null,
      excludingAppointmentId ?? null,
    );
  if (conflict) throw new HttpError(409, "SLOT_TAKEN", "Este horário não está mais disponível.");
}

appointmentRouter.get("/appointments", requireAuth, (request, response) => {
  const auth = getAuth(request);
  const from = z.string().datetime({ offset: true }).optional().parse(request.query.from);
  const to = z.string().datetime({ offset: true }).optional().parse(request.query.to);
  const roleFilter =
    auth.role === "PATIENT"
      ? " AND a.patient_membership_id = ?"
      : auth.role === "THERAPIST"
        ? " AND a.therapist_membership_id = ?"
        : "";
  const parameters = [auth.clinicId, ...(from ? [new Date(from).toISOString()] : []), ...(to ? [new Date(to).toISOString()] : [])];
  if (auth.role !== "CLINIC_ADMIN") parameters.push(auth.membershipId);
  const dates = `${from ? " AND a.dt_inicio >= ?" : ""}${to ? " AND a.dt_inicio < ?" : ""}`;
  const appointments = db
    .prepare(
      `${appointmentSelection}
       WHERE a.clinic_id = ?${dates}${roleFilter}
       ORDER BY a.dt_inicio DESC LIMIT 200`,
    )
    .all(...parameters);
  response.json({ appointments });
});

appointmentRouter.post("/appointments", requireAuth, (request, response, next) => {
  try {
    const input = z
      .object({
        patientMembershipId: z.string().uuid().optional(),
        therapistMembershipId: z.string().uuid(),
        therapyId: z.string().uuid(),
        startsAt: z.string().datetime({ offset: true }),
      })
      .parse(request.body);
    const auth = getAuth(request);
    const patientMembershipId = auth.role === "PATIENT" ? auth.membershipId : input.patientMembershipId;
    if (!patientMembershipId) throw new HttpError(400, "PATIENT_REQUIRED", "Selecione o paciente.");

    const patient = db
      .prepare(
        `SELECT m.id, u.email, u.telefone AS phone FROM memberships m
         JOIN USUARIO u ON u.id = m.user_id
         WHERE m.id = ? AND m.clinic_id = ? AND m.role = 'PATIENT' AND m.status = 'ACTIVE' AND u.ativo = 1`,
      )
      .get(patientMembershipId, auth.clinicId);
    if (!patient) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado nesta clínica.");
    if (auth.role === "PATIENT" && auth.membershipId !== patientMembershipId) {
      throw new HttpError(403, "FORBIDDEN", "Você só pode agendar para si.");
    }

    const therapist = db
      .prepare(
        `SELECT u.email, u.telefone AS phone FROM memberships m
         JOIN USUARIO u ON u.id = m.user_id
         WHERE m.id = ? AND m.clinic_id = ? AND m.role = 'THERAPIST' AND m.status = 'ACTIVE' AND u.ativo = 1`,
      )
      .get(input.therapistMembershipId, auth.clinicId) as { email: string; phone: string | null } | undefined;
    if (!therapist) throw new HttpError(404, "THERAPIST_NOT_FOUND", "Terapeuta não encontrado nesta clínica.");

    const therapy = db
      .prepare("SELECT duracao_min AS durationMinutes FROM TERAPIA WHERE id = ? AND clinic_id = ? AND ativa = 1")
      .get(input.therapyId, auth.clinicId) as { durationMinutes: number } | undefined;
    if (!therapy) throw new HttpError(404, "THERAPY_NOT_FOUND", "Terapia não encontrada nesta clínica.");

    const therapistCanProvide = db
      .prepare("SELECT 1 FROM therapist_therapies WHERE clinic_id = ? AND membership_id = ? AND therapy_id = ?")
      .get(auth.clinicId, input.therapistMembershipId, input.therapyId);
    if (!therapistCanProvide) throw new HttpError(409, "THERAPY_NOT_AVAILABLE", "Este terapeuta não está habilitado para a terapia.");

    const startsAt = new Date(input.startsAt);
    if (startsAt.getTime() <= Date.now()) throw new HttpError(400, "INVALID_DATE", "O agendamento deve ser futuro.");
    const endsAt = new Date(startsAt.getTime() + therapy.durationMinutes * 60_000);
    ensureAppointmentAvailability(auth, input.therapistMembershipId, startsAt, endsAt);

    const appointmentId = randomUUID();
    const createdAt = new Date().toISOString();
    const createAppointment = db.transaction(() => {
      ensureNoConflict(
        auth.clinicId,
        input.therapistMembershipId,
        patientMembershipId,
        startsAt,
        endsAt,
      );

      db.prepare(
        `INSERT INTO AGENDA
         (id, clinic_id, patient_membership_id, therapist_membership_id, terapia_id, dt_inicio, dt_fim, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?)`,
      ).run(
        appointmentId,
        auth.clinicId,
        patientMembershipId,
        input.therapistMembershipId,
        input.therapyId,
        startsAt.toISOString(),
        endsAt.toISOString(),
        createdAt,
        createdAt,
      );
      db.prepare(
        "INSERT INTO appointment_events (id, appointment_id, actor_user_id, action, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(randomUUID(), appointmentId, auth.userId, "CREATED", createdAt);
    });
    createAppointment.immediate();
    const patientContact = patient as { id: string; email: string; phone: string | null };
    queueAppointmentNotice(
      auth.clinicId,
      [patientContact, therapist],
      "APPOINTMENT_CONFIRMED",
      appointmentId,
    );
    writeAudit(auth, "appointment.created", "appointment", appointmentId);
    const created = db.prepare(`${appointmentSelection} WHERE a.id = ? AND a.clinic_id = ?`).get(appointmentId, auth.clinicId);
    response.status(201).json({ appointment: created });
  } catch (error) {
    next(error);
  }
});

appointmentRouter.post("/appointments/:id/reschedule", requireAuth, (request, response, next) => {
  try {
    const input = z.object({ startsAt: z.string().datetime({ offset: true }) }).parse(request.body);
    const auth = getAuth(request);
    const appointmentId = z.string().uuid().parse(request.params.id);
    const appointment = db
      .prepare(
        `SELECT a.id, a.patient_membership_id AS patientMembershipId, a.therapist_membership_id AS therapistMembershipId,
                a.terapia_id AS therapyId, a.dt_inicio AS startsAt, a.status,
                t.duracao_min AS durationMinutes
         FROM AGENDA a
         JOIN TERAPIA t ON t.id = a.terapia_id AND t.clinic_id = a.clinic_id
         WHERE a.id = ? AND a.clinic_id = ?`,
      )
      .get(appointmentId, auth.clinicId) as
      | {
          id: string;
          patientMembershipId: string;
          therapistMembershipId: string;
          therapyId: string;
          startsAt: string;
          status: string;
          durationMinutes: number;
        }
      | undefined;
    if (!appointment) throw new HttpError(404, "APPOINTMENT_NOT_FOUND", "Agendamento não encontrado.");
    if (appointment.status !== "CONFIRMED") throw new HttpError(409, "APPOINTMENT_NOT_ACTIVE", "Este agendamento não está ativo.");

    const isPatient = auth.role === "PATIENT" && auth.membershipId === appointment.patientMembershipId;
    const isTherapist = auth.role === "THERAPIST" && auth.membershipId === appointment.therapistMembershipId;
    const isClinicAdmin = auth.role === "CLINIC_ADMIN";
    if (!isPatient && !isTherapist && !isClinicAdmin) throw new HttpError(403, "FORBIDDEN", "Você não pode remarcar este agendamento.");
    if (isPatient && !canPatientCancelAppointment(new Date(appointment.startsAt), new Date())) {
      throw new HttpError(409, "CANCELLATION_WINDOW_CLOSED", "A remarcação pelo portal deve ocorrer até quatro horas antes.");
    }

    const startsAt = new Date(input.startsAt);
    if (startsAt.getTime() <= Date.now()) throw new HttpError(400, "INVALID_DATE", "O novo horário deve ser futuro.");
    const endsAt = new Date(startsAt.getTime() + appointment.durationMinutes * 60_000);
    ensureAppointmentAvailability(auth, appointment.therapistMembershipId, startsAt, endsAt);

    const therapist = db
      .prepare(
        `SELECT u.email, u.telefone AS phone FROM memberships m JOIN USUARIO u ON u.id = m.user_id
         WHERE m.id = ? AND m.clinic_id = ? AND m.role = 'THERAPIST' AND m.status = 'ACTIVE'`,
      )
      .get(appointment.therapistMembershipId, auth.clinicId) as { email: string; phone: string | null };
    const patient = db
      .prepare(
        `SELECT u.email, u.telefone AS phone FROM memberships m JOIN USUARIO u ON u.id = m.user_id
         WHERE m.id = ? AND m.clinic_id = ? AND m.role = 'PATIENT' AND m.status = 'ACTIVE'`,
      )
      .get(appointment.patientMembershipId, auth.clinicId) as { email: string; phone: string | null };
    const now = new Date().toISOString();
    const reschedule = db.transaction(() => {
      ensureNoConflict(
        auth.clinicId,
        appointment.therapistMembershipId,
        appointment.patientMembershipId,
        startsAt,
        endsAt,
        appointmentId,
      );
      db.prepare("UPDATE AGENDA SET dt_inicio = ?, dt_fim = ?, updated_at = ? WHERE id = ? AND status = 'CONFIRMED'").run(
        startsAt.toISOString(),
        endsAt.toISOString(),
        now,
        appointmentId,
      );
      db.prepare(
        "INSERT INTO appointment_events (id, appointment_id, actor_user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        randomUUID(),
        appointmentId,
        auth.userId,
        "RESCHEDULED",
        JSON.stringify({ from: appointment.startsAt, to: startsAt.toISOString() }),
        now,
      );
    });
    reschedule.immediate();
    queueAppointmentNotice(auth.clinicId, [patient, therapist], "APPOINTMENT_RESCHEDULED", appointmentId);
    writeAudit(auth, "appointment.rescheduled", "appointment", appointmentId);
    const updated = db.prepare(`${appointmentSelection} WHERE a.id = ? AND a.clinic_id = ?`).get(appointmentId, auth.clinicId);
    response.json({ appointment: updated, notifications: "NOT_CONFIGURED" });
  } catch (error) {
    next(error);
  }
});

appointmentRouter.post("/appointments/:id/cancel", requireAuth, (request, response, next) => {
  try {
    const input = z.object({ reason: z.string().trim().max(500).optional() }).parse(request.body ?? {});
    const auth = getAuth(request);
    const appointmentId = z.string().uuid().parse(request.params.id);
    const appointment = db
      .prepare(
        `SELECT a.id, a.patient_membership_id AS patientMembershipId, a.therapist_membership_id AS therapistMembershipId,
                a.dt_inicio AS startsAt, a.status, u.email AS therapistEmail, u.telefone AS therapistPhone
         FROM AGENDA a
         JOIN memberships m ON m.id = a.therapist_membership_id AND m.clinic_id = a.clinic_id
         JOIN USUARIO u ON u.id = m.user_id
         WHERE a.id = ? AND a.clinic_id = ?`,
      )
      .get(appointmentId, auth.clinicId) as
      | {
          id: string;
          patientMembershipId: string;
          therapistMembershipId: string;
          startsAt: string;
          status: string;
          therapistEmail: string;
          therapistPhone: string | null;
        }
      | undefined;
    if (!appointment) throw new HttpError(404, "APPOINTMENT_NOT_FOUND", "Agendamento não encontrado.");
    if (appointment.status !== "CONFIRMED") throw new HttpError(409, "APPOINTMENT_NOT_ACTIVE", "Este agendamento não está ativo.");

    const isPatient = auth.role === "PATIENT" && auth.membershipId === appointment.patientMembershipId;
    const isTherapist = auth.role === "THERAPIST" && auth.membershipId === appointment.therapistMembershipId;
    const isClinicAdmin = auth.role === "CLINIC_ADMIN";
    if (!isPatient && !isTherapist && !isClinicAdmin) throw new HttpError(403, "FORBIDDEN", "Você não pode cancelar este agendamento.");
    if (isPatient && !canPatientCancelAppointment(new Date(appointment.startsAt), new Date())) {
      throw new HttpError(409, "CANCELLATION_WINDOW_CLOSED", "O cancelamento pelo portal deve ocorrer até quatro horas antes.");
    }
    if (!isPatient && !input.reason) {
      throw new HttpError(400, "REASON_REQUIRED", "Informe o motivo para o cancelamento administrativo ou do terapeuta.");
    }

    const now = new Date().toISOString();
    const cancelAppointment = db.transaction(() => {
      const result = db
        .prepare(
          `UPDATE AGENDA
           SET status = 'CANCELLED', cancellation_reason = ?, cancelled_at = ?, cancelled_by_user_id = ?,
               cancellation_channel = ?, updated_at = ?
           WHERE id = ? AND clinic_id = ? AND status = 'CONFIRMED'`,
        )
        .run(
          input.reason ?? null,
          now,
          auth.userId,
          isPatient ? "PATIENT_PORTAL" : "CLINIC_STAFF",
          now,
          appointmentId,
          auth.clinicId,
        );
      if (result.changes !== 1) throw new HttpError(409, "APPOINTMENT_NOT_ACTIVE", "Este agendamento já foi alterado.");
      db.prepare(
        "INSERT INTO appointment_events (id, appointment_id, actor_user_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(randomUUID(), appointmentId, auth.userId, "CANCELLED", JSON.stringify({ reason: input.reason ?? null }), now);
    });
    cancelAppointment.immediate();
    queueCancellationNotice(auth.clinicId, { email: appointment.therapistEmail, phone: appointment.therapistPhone }, appointmentId);
    writeAudit(auth, "appointment.cancelled", "appointment", appointmentId, { reasonProvided: Boolean(input.reason) });
    response.json({ status: "CANCELLED", notifications: "NOT_CONFIGURED" });
  } catch (error) {
    next(error);
  }
});

appointmentRouter.patch("/appointments/:id/status", requireAuth, requireRole("THERAPIST"), (request, response, next) => {
  try {
    const input = z.object({ status: z.enum(["COMPLETED", "NO_SHOW"]) }).parse(request.body);
    const auth = getAuth(request);
    const appointmentId = z.string().uuid().parse(request.params.id);
    const now = new Date().toISOString();
    const updateStatus = db.transaction(() => {
      const update = db
        .prepare(
          "UPDATE AGENDA SET status = ?, updated_at = ? WHERE id = ? AND clinic_id = ? AND status = 'CONFIRMED' AND (? = 'CLINIC_ADMIN' OR therapist_membership_id = ?)",
        )
        .run(input.status, now, appointmentId, auth.clinicId, auth.role, auth.membershipId);
      if (update.changes !== 1) {
        throw new HttpError(404, "APPOINTMENT_NOT_FOUND", "Atendimento não encontrado ou não pode ser atualizado.");
      }
      db.prepare(
        "INSERT INTO appointment_events (id, appointment_id, actor_user_id, action, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(randomUUID(), appointmentId, auth.userId, input.status, now);
    });
    updateStatus.immediate();
    writeAudit(auth, `appointment.${input.status.toLowerCase()}`, "appointment", appointmentId);
    response.json({ id: appointmentId, status: input.status });
  } catch (error) {
    next(error);
  }
});
