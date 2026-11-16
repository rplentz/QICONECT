import { describe, expect, it } from "vitest";
import {
  APPOINTMENT_CANCELLATION_WINDOW_MS,
  canPatientCancelAppointment,
} from "./appointment.js";

describe("canPatientCancelAppointment", () => {
  const now = new Date("2026-01-01T10:00:00.000Z");

  it("allows cancellation exactly four hours before the appointment", () => {
    const startsAt = new Date(now.getTime() + APPOINTMENT_CANCELLATION_WINDOW_MS);

    expect(canPatientCancelAppointment(startsAt, now)).toBe(true);
  });

  it("rejects cancellation less than four hours before the appointment", () => {
    const startsAt = new Date(now.getTime() + APPOINTMENT_CANCELLATION_WINDOW_MS - 1);

    expect(canPatientCancelAppointment(startsAt, now)).toBe(false);
  });

  it("rejects cancellation after the appointment has started", () => {
    const startsAt = new Date(now.getTime() - 1);

    expect(canPatientCancelAppointment(startsAt, now)).toBe(false);
  });
});
