import { randomUUID } from "node:crypto";
import { db } from "../db/database.js";

export function queueCancellationNotice(
  clinicId: string,
  therapist: { email: string; phone: string | null },
  appointmentId: string,
): void {
  queueNotice(clinicId, [therapist], "APPOINTMENT_CANCELLED", appointmentId);
}

export function queueAppointmentNotice(
  clinicId: string,
  recipients: Array<{ email: string; phone: string | null }>,
  event: "APPOINTMENT_CONFIRMED" | "APPOINTMENT_RESCHEDULED",
  appointmentId: string,
): void {
  queueNotice(clinicId, recipients, event, appointmentId);
}

function queueNotice(
  clinicId: string,
  recipients: Array<{ email: string; phone: string | null }>,
  event: string,
  appointmentId: string,
): void {
  const createdAt = new Date().toISOString();
  const insert = db.prepare(
    "INSERT INTO notifications (id, clinic_id, recipient, channel, event, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const details = JSON.stringify({ appointmentId, delivery: "Configure um provedor para habilitar o envio." });

  for (const recipient of recipients) {
    insert.run(randomUUID(), clinicId, recipient.email, "EMAIL", event, "NOT_CONFIGURED", details, createdAt);
    insert.run(
      randomUUID(),
      clinicId,
      recipient.phone ?? "",
      "WHATSAPP",
      event,
      "NOT_CONFIGURED",
      details,
      createdAt,
    );
  }
}
