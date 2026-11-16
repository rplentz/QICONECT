import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/database.js";
import { getAuth, requireAuth, requireRole } from "../middleware/auth.js";
import { createClinicAccount } from "../services/accounts.js";
import { writeAudit } from "../services/audit.js";
import { HttpError } from "../utils/http-error.js";

export const clinicRouter = Router();

clinicRouter.get("/dashboard", requireAuth, (request, response) => {
  const auth = getAuth(request);
  const roleFilter =
    auth.role === "PATIENT"
      ? " AND patient_membership_id = @membershipId"
      : auth.role === "THERAPIST"
        ? " AND therapist_membership_id = @membershipId"
        : "";
  const parameters = { clinicId: auth.clinicId, membershipId: auth.membershipId, now: new Date().toISOString() };

  const appointments = db
    .prepare(
      `SELECT a.id, a.dt_inicio AS startsAt, a.dt_fim AS endsAt, a.status,
              t.nome AS therapyName, patientUser.nome AS patientName,
              therapistUser.nome AS therapistName
       FROM AGENDA a
       JOIN TERAPIA t ON t.id = a.terapia_id AND t.clinic_id = a.clinic_id
       JOIN memberships patientMembership ON patientMembership.id = a.patient_membership_id
       JOIN USUARIO patientUser ON patientUser.id = patientMembership.user_id
       JOIN memberships therapistMembership ON therapistMembership.id = a.therapist_membership_id
       JOIN USUARIO therapistUser ON therapistUser.id = therapistMembership.user_id
       WHERE a.clinic_id = @clinicId AND a.status = 'CONFIRMED' AND a.dt_inicio >= @now${roleFilter}
       ORDER BY a.dt_inicio LIMIT 8`,
    )
    .all(parameters);
  const patients =
    auth.role === "PATIENT"
      ? 1
      : (db
          .prepare("SELECT COUNT(*) AS count FROM memberships WHERE clinic_id = ? AND role = 'PATIENT' AND status = 'ACTIVE'")
          .get(auth.clinicId) as { count: number }).count;
  const today = new Date();
  const dayStart = new Date(today);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const todayAppointments = db
    .prepare(
      `SELECT COUNT(*) AS count FROM AGENDA
       WHERE clinic_id = ? AND dt_inicio >= ? AND dt_inicio < ? AND status = 'CONFIRMED'${roleFilter.replaceAll("@membershipId", "?")}`,
    )
    .get(auth.clinicId, dayStart.toISOString(), dayEnd.toISOString(), ...(auth.role === "CLINIC_ADMIN" ? [] : [auth.membershipId])) as {
      count: number;
    };

  response.json({
    counts: { patients, appointmentsToday: todayAppointments.count },
    upcomingAppointments: appointments,
  });
});

clinicRouter.get("/catalog", requireAuth, (request, response) => {
  const auth = getAuth(request);
  const specialties = db
    .prepare("SELECT id, nome AS name, descricao AS description FROM ESPECIALIDADE WHERE clinic_id = ? AND ativo = 1 ORDER BY nome")
    .all(auth.clinicId);
  const therapies = db
    .prepare(
      `SELECT t.id, t.nome AS name, t.descricao AS description, t.duracao_min AS durationMinutes, t.price,
              s.id AS specialtyId, s.nome AS specialtyName
       FROM TERAPIA t JOIN ESPECIALIDADE s ON s.id = t.especialidade_id AND s.clinic_id = t.clinic_id
       WHERE t.clinic_id = ? AND t.ativa = 1 ORDER BY t.nome`,
    )
    .all(auth.clinicId);
  response.json({ specialties, therapies });
});

clinicRouter.post("/specialties", requireAuth, requireRole("CLINIC_ADMIN"), (request, response, next) => {
  try {
    const input = z.object({ name: z.string().trim().min(2).max(100), description: z.string().max(1000).optional() }).parse(request.body);
    const auth = getAuth(request);
    const id = randomUUID();
    db.prepare("INSERT INTO ESPECIALIDADE (id, clinic_id, nome, descricao) VALUES (?, ?, ?, ?)").run(
      id,
      auth.clinicId,
      input.name,
      input.description ?? null,
    );
    writeAudit(auth, "specialty.created", "specialty", id);
    response.status(201).json({ id, ...input });
  } catch (error) {
    next(error);
  }
});

clinicRouter.post("/therapies", requireAuth, requireRole("CLINIC_ADMIN"), (request, response, next) => {
  try {
    const input = z
      .object({
        specialtyId: z.string().uuid(),
        name: z.string().trim().min(2).max(100),
        description: z.string().max(1000).optional(),
        durationMinutes: z.number().int().min(10).max(480),
        price: z.number().nonnegative().optional(),
      })
      .parse(request.body);
    const auth = getAuth(request);
    const specialty = db
      .prepare("SELECT id FROM ESPECIALIDADE WHERE id = ? AND clinic_id = ? AND ativo = 1")
      .get(input.specialtyId, auth.clinicId);
    if (!specialty) throw new HttpError(404, "SPECIALTY_NOT_FOUND", "Especialidade não encontrada nesta clínica.");
    const id = randomUUID();
    db.prepare(
      "INSERT INTO TERAPIA (id, clinic_id, especialidade_id, nome, descricao, duracao_min, price, ativa) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    ).run(
      id,
      auth.clinicId,
      input.specialtyId,
      input.name,
      input.description ?? null,
      input.durationMinutes,
      input.price ?? null,
    );
    writeAudit(auth, "therapy.created", "therapy", id);
    response.status(201).json({ id, ...input });
  } catch (error) {
    next(error);
  }
});

clinicRouter.get("/therapists", requireAuth, (request, response) => {
  const auth = getAuth(request);
  const therapists = db
    .prepare(
      `SELECT m.id AS membershipId, u.nome AS fullName, u.email, u.telefone AS phone,
              tp.registro_prof AS professionalRegistration
       FROM memberships m
       JOIN USUARIO u ON u.id = m.user_id
       LEFT JOIN TERAPEUTA tp ON tp.membership_id = m.id AND tp.clinic_id = m.clinic_id
       WHERE m.clinic_id = ? AND m.role = 'THERAPIST' AND m.status = 'ACTIVE'
       ORDER BY u.nome`,
    )
    .all(auth.clinicId);
  response.json({ therapists });
});

clinicRouter.post("/therapists", requireAuth, requireRole("CLINIC_ADMIN"), async (request, response, next) => {
  try {
    const input = z
      .object({
        fullName: z.string().trim().min(2).max(120),
        email: z.string().email().max(254),
        phone: z.string().max(30).optional(),
        password: z.string().min(10).max(128),
        professionalRegistration: z.string().max(100).optional(),
        therapyIds: z.array(z.string().uuid()).max(50).default([]),
      })
      .parse(request.body);
    const auth = getAuth(request);
    const therapyIds = [...new Set(input.therapyIds)];
    if (therapyIds.length > 0) {
      const placeholders = therapyIds.map(() => "?").join(", ");
      const enabledTherapies = db
        .prepare(`SELECT id FROM TERAPIA WHERE clinic_id = ? AND ativa = 1 AND id IN (${placeholders})`)
        .all(auth.clinicId, ...therapyIds) as Array<{ id: string }>;
      if (enabledTherapies.length !== therapyIds.length) {
        throw new HttpError(400, "INVALID_THERAPY", "Selecione apenas terapias ativas desta clínica.");
      }
    }
    const account = await createClinicAccount(
      { ...input, clinicId: auth.clinicId, role: "THERAPIST" },
      (membershipId, userId) => {
        db.prepare(
          "INSERT INTO TERAPEUTA (id, usuario_id, clinica_id, membership_id, clinic_id, registro_prof, ativo, dt_atualizacao) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
        ).run(randomUUID(), userId, auth.clinicId, membershipId, auth.clinicId, input.professionalRegistration ?? null, new Date().toISOString());
        const addTherapy = db.prepare(
          "INSERT INTO therapist_therapies (clinic_id, membership_id, therapy_id) VALUES (?, ?, ?)",
        );
        for (const therapyId of therapyIds) addTherapy.run(auth.clinicId, membershipId, therapyId);
      },
    );
    writeAudit(auth, "therapist.created", "membership", account.membershipId);
    response.status(201).json({ membershipId: account.membershipId, fullName: input.fullName, email: input.email });
  } catch (error) {
    next(error);
  }
});

clinicRouter.get("/availability", requireAuth, (request, response) => {
  const auth = getAuth(request);
  const therapistId = z.string().uuid().optional().parse(request.query.therapistMembershipId);
  const rules = db
    .prepare(
      `SELECT id, therapist_membership_id AS therapistMembershipId, weekday, starts_at AS startsAt, ends_at AS endsAt
       FROM availability_rules
       WHERE clinic_id = ? AND active = 1${therapistId ? " AND therapist_membership_id = ?" : ""}
       ORDER BY therapist_membership_id, weekday, starts_at`,
    )
    .all(...(therapistId ? [auth.clinicId, therapistId] : [auth.clinicId]));
  response.json({ availability: rules });
});

clinicRouter.post("/availability", requireAuth, (request, response, next) => {
  try {
    const input = z
      .object({
        therapistMembershipId: z.string().uuid(),
        weekday: z.number().int().min(0).max(6),
        startsAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        endsAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      })
      .refine((value) => value.startsAt < value.endsAt, { message: "O horário final deve ser posterior ao inicial." })
      .parse(request.body);
    const auth = getAuth(request);
    if (auth.role === "PATIENT") {
      throw new HttpError(403, "FORBIDDEN", "Pacientes não podem alterar a disponibilidade da agenda.");
    }
    if (auth.role === "THERAPIST" && auth.membershipId !== input.therapistMembershipId) {
      throw new HttpError(403, "FORBIDDEN", "Você só pode gerenciar sua própria disponibilidade.");
    }
    const therapist = db
      .prepare("SELECT id FROM memberships WHERE id = ? AND clinic_id = ? AND role = 'THERAPIST' AND status = 'ACTIVE'")
      .get(input.therapistMembershipId, auth.clinicId);
    if (!therapist) throw new HttpError(404, "THERAPIST_NOT_FOUND", "Terapeuta não encontrado nesta clínica.");

    const id = randomUUID();
    db.prepare(
      "INSERT INTO availability_rules (id, clinic_id, therapist_membership_id, weekday, starts_at, ends_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)",
    ).run(id, auth.clinicId, input.therapistMembershipId, input.weekday, input.startsAt, input.endsAt);
    writeAudit(auth, "availability.created", "availability_rule", id);
    response.status(201).json({ id, ...input });
  } catch (error) {
    next(error);
  }
});
