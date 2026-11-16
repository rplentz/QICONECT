export const APPOINTMENT_CANCELLATION_WINDOW_MS = 4 * 60 * 60 * 1000;

export function canPatientCancelAppointment(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() - now.getTime() >= APPOINTMENT_CANCELLATION_WINDOW_MS;
}
