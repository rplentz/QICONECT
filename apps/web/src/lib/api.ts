export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "object" &&
      payload.error !== null &&
      "message" in payload.error
        ? String(payload.error.message)
        : undefined;
    throw new ApiError(message ?? `A solicitação falhou (${response.status}).`, response.status);
  }
  return payload as T;
}

export interface Session {
  user: { id: string; email: string; fullName: string };
  activeClinic: { id: string; name: string; timezone: string; role: "CLINIC_ADMIN" | "THERAPIST" | "PATIENT" };
  clinics: Array<{ membershipId: string; role: string; clinicId: string; clinicName: string }>;
}

export interface Patient {
  membershipId: string;
  fullName: string;
  email: string;
  phone: string | null;
  birthDate: string | null;
  cpf?: string | null;
}

export interface Therapist {
  membershipId: string;
  fullName: string;
  email: string;
  phone: string | null;
  professionalRegistration: string | null;
}

export interface Therapy {
  id: string;
  name: string;
  specialtyId: string;
  specialtyName: string;
  durationMinutes: number;
  price: number | null;
}

export interface Appointment {
  id: string;
  patientMembershipId: string;
  therapistMembershipId: string;
  therapyId: string;
  startsAt: string;
  endsAt: string;
  status: "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  therapyName: string;
  patientName: string;
  therapistName: string;
}

export interface ClinicalRecord {
  id: string;
  patientMembershipId?: string;
  patientName?: string;
  type: "ANAMNESIS" | "DIAGNOSIS" | "PROTOCOL" | "EVOLUTION";
  title: string;
  content: Record<string, unknown>;
  releasedAt: string | null;
  createdAt: string;
  authorName: string;
}
