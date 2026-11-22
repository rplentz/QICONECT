import { db } from "../db/database.js";

export function queueCancellationNotice(clinicId: string, therapist: { email: string; phone: string | null }, appointmentId: string): void {
  queueNotice(clinicId, [therapist], "APPOINTMENT_CANCELLED", appointmentId);
}
export function queueAppointmentNotice(
  clinicId: string,
  recipients: Array<{ email: string; phone: string | null }>,
  event: "APPOINTMENT_CONFIRMED" | "APPOINTMENT_RESCHEDULED",
  appointmentId: string,
): void { queueNotice(clinicId, recipients, event, appointmentId); }

function queueNotice(clinicId: string, recipients: Array<{ email: string; phone: string | null }>, event: string, appointmentId: string): void {
  const insert = db.prepare(
    `INSERT INTO notifications(clinic_id,user_id,recipient,channel,event,status,details,created_at)
     VALUES(?,?,?,?,?,'NOT_CONFIGURED',?,?)`,
  );
  const details = JSON.stringify({ appointmentId, delivery: "Configure um provedor para habilitar o envio." });
  for (const recipient of recipients) {
    for (const [channel, target] of [["EMAIL", recipient.email], ["WHATSAPP", recipient.phone ?? ""]] as const) {
      const user = channel === "EMAIL"
        ? db.prepare("SELECT id FROM USUARIO WHERE email=? COLLATE NOCASE LIMIT 1").get(target) as { id: number } | undefined
        : db.prepare("SELECT usuario_id AS id FROM PACIENTE WHERE telefone=? LIMIT 1").get(target) as { id: number } | undefined;
      insert.run(Number(clinicId), user?.id ?? null, target, channel, event, details, new Date().toISOString());
    }
  }
}
