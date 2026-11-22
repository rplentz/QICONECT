export interface AuthContext {
  userId: string;
  email: string;
  fullName: string;
  userClinicId: string;
  clinicId: string;
  clinicName: string;
  clinicTimezone: string;
  role: "CLINIC_ADMIN" | "THERAPIST" | "PATIENT";
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
