import { randomUUID } from "node:crypto";
import { db } from "../db/database.js";
import type { AuthContext } from "../types/express.js";

export function writeAudit(
  auth: AuthContext,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata?: Record<string, unknown>,
): void {
  db.prepare(
    "INSERT INTO AUDITORIA (id, clinic_id, usuario_id, acao, entidade, registro_id, metadata, dt_hora) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    randomUUID(),
    auth.clinicId,
    auth.userId,
    action,
    entityType,
    entityId,
    metadata ? JSON.stringify(metadata) : null,
    new Date().toISOString(),
  );
}
