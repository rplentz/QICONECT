import type { RequestHandler } from "express";
import { db } from "../db/database.js";
import { hashSessionToken, SESSION_COOKIE } from "../security/session.js";
import type { AuthContext } from "../types/express.js";

const roleOrder = { PATIENT: 0, THERAPIST: 1, CLINIC_ADMIN: 2 } as const;
const roleNames: Record<number, AuthContext["role"]> = { 1: "CLINIC_ADMIN", 2: "CLINIC_ADMIN", 3: "THERAPIST", 4: "PATIENT" };

export const requireAuth: RequestHandler = (request, response, next) => {
  const token = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!token) {
    response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Faça login para continuar." } });
    return;
  }
  const row = db.prepare(
    `SELECT u.id AS userId, u.email, u.nome AS fullName, uc.id AS userClinicId,
            c.id AS clinicId, c.nome AS clinicName, uc.perfil_id AS profileId
     FROM sessions s JOIN USUARIO u ON u.id=s.user_id
     JOIN USUARIO_CLINICA uc ON uc.id=s.user_clinic_id AND uc.usuario_id=u.id AND uc.clinica_id=s.clinic_id
     JOIN CLINICA c ON c.id=s.clinic_id
     LEFT JOIN PACIENTE patient ON patient.id=s.patient_id AND patient.usuario_id=u.id AND patient.clinica_id=c.id
     LEFT JOIN TERAPEUTA therapist ON therapist.id=s.therapist_id AND therapist.usuario_id=u.id
     WHERE s.token_hash=? AND s.expires_at>? AND uc.status=1 AND c.status=1
       AND (uc.perfil_id<>4 OR patient.id IS NOT NULL) AND (uc.perfil_id<>3 OR therapist.id IS NOT NULL)`,
  ).get(hashSessionToken(token), new Date().toISOString()) as
    | { userId: number; email: string; fullName: string; userClinicId: number; clinicId: number; clinicName: string; profileId: number }
    | undefined;
  const role = row ? roleNames[row.profileId] : undefined;
  if (!row || !role) {
    response.clearCookie(SESSION_COOKIE, { path: "/", sameSite: "lax", httpOnly: true });
    response.status(401).json({ error: { code: "SESSION_EXPIRED", message: "Sua sessão expirou. Faça login novamente." } });
    return;
  }
  request.auth = {
    ...row,
    userId: String(row.userId),
    userClinicId: String(row.userClinicId),
    clinicId: String(row.clinicId),
    clinicTimezone: "America/Sao_Paulo",
    role,
  };
  next();
};

export function requireRole(minimumRole: keyof typeof roleOrder): RequestHandler {
  return (request, response, next) => {
    const role = request.auth?.role;
    if (!role || roleOrder[role] < roleOrder[minimumRole]) {
      response.status(403).json({ error: { code: "FORBIDDEN", message: "Você não tem permissão para esta ação." } });
      return;
    }
    next();
  };
}

export function getAuth(request: Express.Request): AuthContext {
  if (!request.auth) throw new Error("Auth context is missing after requireAuth.");
  return request.auth;
}
