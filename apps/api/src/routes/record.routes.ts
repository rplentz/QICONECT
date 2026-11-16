import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/database.js";
import { getAuth, requireAuth } from "../middleware/auth.js";
import { writeAudit } from "../services/audit.js";
import { HttpError } from "../utils/http-error.js";

export const recordRouter = Router();

recordRouter.get("/records", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    if (auth.role === "CLINIC_ADMIN") {
      throw new HttpError(403, "CLINICAL_ACCESS_REQUIRED", "Registros clínicos exigem perfil de terapeuta autorizado.");
    }

    const records =
      auth.role === "PATIENT"
        ? db
            .prepare(
              `SELECT r.id, r.type, r.title, r.content, r.released_at AS releasedAt, r.created_at AS createdAt,
                      authorUser.nome AS authorName
               FROM clinical_records r
               JOIN memberships author ON author.id = r.author_membership_id AND author.clinic_id = r.clinic_id
               JOIN USUARIO authorUser ON authorUser.id = author.user_id
               WHERE r.clinic_id = ? AND r.patient_membership_id = ? AND r.released_at IS NOT NULL
               ORDER BY r.created_at DESC LIMIT 200`,
            )
            .all(auth.clinicId, auth.membershipId)
        : db
            .prepare(
              `SELECT r.id, r.patient_membership_id AS patientMembershipId, patientUser.nome AS patientName,
                      r.type, r.title, r.content, r.released_at AS releasedAt, r.created_at AS createdAt,
                      authorUser.nome AS authorName
               FROM clinical_records r
               JOIN memberships patient ON patient.id = r.patient_membership_id AND patient.clinic_id = r.clinic_id
               JOIN USUARIO patientUser ON patientUser.id = patient.user_id
               JOIN memberships author ON author.id = r.author_membership_id AND author.clinic_id = r.clinic_id
               JOIN USUARIO authorUser ON authorUser.id = author.user_id
               WHERE r.clinic_id = ?
               ORDER BY r.created_at DESC LIMIT 200`,
            )
            .all(auth.clinicId);

    response.json({
      records: records.map((record) => {
        const row = record as { content: string };
        return { ...row, content: JSON.parse(row.content) as unknown };
      }),
    });
  } catch (error) {
    next(error);
  }
});

recordRouter.post("/records", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    if (auth.role !== "THERAPIST") {
      throw new HttpError(403, "FORBIDDEN", "Somente terapeutas podem criar registros clínicos.");
    }
    const input = z
      .object({
        patientMembershipId: z.string().uuid(),
        type: z.enum(["ANAMNESIS", "DIAGNOSIS", "PROTOCOL", "EVOLUTION"]),
        title: z.string().trim().min(2).max(160),
        content: z.record(z.string(), z.unknown()),
      })
      .parse(request.body);

    const patient = db
      .prepare("SELECT id FROM memberships WHERE id = ? AND clinic_id = ? AND role = 'PATIENT' AND status = 'ACTIVE'")
      .get(input.patientMembershipId, auth.clinicId);
    if (!patient) throw new HttpError(404, "PATIENT_NOT_FOUND", "Paciente não encontrado nesta clínica.");

    const id = randomUUID();
    const createdAt = new Date().toISOString();
    db.prepare(
      `INSERT INTO clinical_records
       (id, clinic_id, patient_membership_id, author_membership_id, type, title, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      auth.clinicId,
      input.patientMembershipId,
      auth.membershipId,
      input.type,
      input.title,
      JSON.stringify(input.content),
      createdAt,
    );
    writeAudit(auth, "clinical_record.created", "clinical_record", id, { type: input.type });
    response.status(201).json({ id, ...input, releasedAt: null, createdAt });
  } catch (error) {
    next(error);
  }
});

recordRouter.post("/records/:id/release", requireAuth, (request, response, next) => {
  try {
    const auth = getAuth(request);
    if (auth.role !== "THERAPIST") {
      throw new HttpError(403, "FORBIDDEN", "Somente terapeutas podem liberar registros ao paciente.");
    }
    const recordId = z.string().uuid().parse(request.params.id);
    const releasedAt = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE clinical_records SET released_at = ?
         WHERE id = ? AND clinic_id = ? AND author_membership_id = ? AND released_at IS NULL`,
      )
      .run(releasedAt, recordId, auth.clinicId, auth.membershipId);
    if (result.changes !== 1) {
      throw new HttpError(404, "RECORD_NOT_FOUND", "Registro não encontrado, já liberado ou não pertence a você.");
    }
    writeAudit(auth, "clinical_record.released", "clinical_record", recordId);
    response.json({ id: recordId, releasedAt });
  } catch (error) {
    next(error);
  }
});
