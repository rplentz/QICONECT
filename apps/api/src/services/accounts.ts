import { randomUUID } from "node:crypto";
import { db } from "../db/database.js";
import { hashPassword } from "../security/password.js";

type AccountRole = "CLINIC_ADMIN" | "THERAPIST" | "PATIENT";

interface AccountInput {
  clinicId: string;
  email: string;
  fullName: string;
  phone?: string;
  password: string;
  role: AccountRole;
}

export async function createClinicAccount(
  input: AccountInput,
  provisionMembership?: (membershipId: string, userId: string) => void,
): Promise<{ userId: string; membershipId: string }> {
  const userId = randomUUID();
  const membershipId = randomUUID();
  const createdAt = new Date().toISOString();
  const passwordHash = await hashPassword(input.password);

  const createAccount = db.transaction(() => {
    db.prepare(
      "INSERT INTO USUARIO (id, email, password_hash, nome, telefone, ativo, dt_registro) VALUES (?, ?, ?, ?, ?, 1, ?)",
    ).run(userId, input.email.trim().toLowerCase(), passwordHash, input.fullName.trim(), input.phone ?? null, createdAt);
    db.prepare(
      "INSERT INTO memberships (id, clinic_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)",
    ).run(membershipId, input.clinicId, userId, input.role, createdAt);
    provisionMembership?.(membershipId, userId);
  });

  createAccount.immediate();
  return { userId, membershipId };
}
