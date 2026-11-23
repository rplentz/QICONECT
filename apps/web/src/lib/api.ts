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
  clinics: Array<{ userClinicId: string; role: string; clinicId: string; clinicName: string }>;
}

export interface Patient {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  birthDate: string | null;
  cpf?: string | null;
  lastAppointmentAt?: string | null;
}

export interface Therapist {
  id: string;
  fullName: string;
  email: string;
  professionalRegistration: string | null;
}

export interface Therapy {
  id: string;
  name: string;
  specialtyId: string;
  specialtyName: string;
  durationMinutes: number;
}

export interface Appointment {
  id: string;
  patientId: string;
  therapistId: string;
  therapyId: string;
  startsAt: string;
  endsAt: string;
  status: "ACTIVE" | "INACTIVE" | "CONFIRMED" | "CANCELLED" | "RESCHEDULED" | "WAITING" | "IN_PROGRESS" | "PAID";
  therapyName: string;
  patientName: string;
  therapistName: string;
  rescheduledAt: string | null;
}

export interface ClinicalRecord {
  id: string;
  patientId?: string;
  patientName?: string;
  type: "ANAMNESIS" | "DIAGNOSIS" | "PROTOCOL" | "EVOLUTION";
  title: string;
  content: Record<string, unknown>;
  createdAt: string;
  authorName: string;
}

export interface EncounterSummary {
  appointmentId: string;
  encounterId: string | null;
  attendanceStatus: Appointment["status"] | null;
  patientId: string;
  therapistId: string;
  therapyId: string;
  startsAt: string;
  endsAt: string;
  appointmentStatus: Appointment["status"];
  therapyName: string;
  patientName: string;
  therapistName: string;
}

export interface EncounterDetails {
  appointment: Omit<EncounterSummary, "encounterId" | "attendanceStatus">;
  attendance: {
    id: string;
    chartId: string;
    attendedAt: string;
    status: Appointment["status"];
    notes: string | null;
    startedAt: string;
    examRequested: boolean;
  } | null;
  questions: Array<{ id: string; description: string }>;
  anamneses: Array<{
    id: string;
    type: string;
    description: string;
    registeredAt: string;
    answers: Array<{ questionId: string; question: string; answer: string }>;
  }>;
  diagnoses: Array<{ id: string; description: string; diagnosedAt: string | null }>;
  protocols: Array<{
    diagnosisProtocolId: string;
    diagnosisId: string;
    diagnosisDescription: string;
    diagnosedAt: string | null;
    protocolId: string;
    protocolName: string;
    stepId: string;
    sequence: number;
    stepDescription: string;
    startsAt: string | null;
    endsAt: string | null;
    stepNotes: string | null;
    startedAt: string;
    status: Appointment["status"];
    notes: string | null;
  }>;
  protocolOptions: Array<{
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
  }>;
  evolutions: Array<{
    id: string;
    diagnosisProtocolId: string;
    description: string;
    evolvedAt: string | null;
    status: Appointment["status"];
    sequence: number;
    stepDescription: string;
    protocolName: string;
    authorName: string;
  }>;
  attachments: Array<{
    id: string;
    type: "EXAM" | "TONGUE_PHOTO";
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
    description: string | null;
    uploadedAt: string;
    url: string;
  }>;
}
