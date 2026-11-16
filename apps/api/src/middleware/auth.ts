import type { RequestHandler } from "express";
import { db } from "../db/database.js";
import { hashSessionToken, SESSION_COOKIE } from "../security/session.js";
import type { AuthContext } from "../types/express.js";

const roleOrder = {
  PATIENT: 0,
  THERAPIST: 1,
  CLINIC_ADMIN: 2,
} as const;

export const requireAuth: RequestHandler = (request, response, next) => {
  const rawCookie = request.headers.cookie;
  const token = rawCookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  if (!token) {
    response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Faça login para continuar." } });
    return;
  }

  const auth = db
    .prepare(
      `SELECT u.id AS userId, u.email, u.nome AS fullName, m.id AS membershipId,
              c.id AS clinicId, c.nome AS clinicName, c.timezone AS clinicTimezone, m.role
       FROM sessions s
       JOIN USUARIO u ON u.id = s.user_id AND u.ativo = 1
       JOIN memberships m ON m.user_id = u.id AND m.clinic_id = s.clinic_id AND m.status = 'ACTIVE'
       JOIN CLINICA c ON c.id = s.clinic_id AND c.ativo = 1
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashSessionToken(token), new Date().toISOString()) as AuthContext | undefined;

  if (!auth) {
    response.clearCookie(SESSION_COOKIE, { path: "/", sameSite: "lax", httpOnly: true });
    response.status(401).json({ error: { code: "SESSION_EXPIRED", message: "Sua sessão expirou. Faça login novamente." } });
    return;
  }

  request.auth = auth;
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
