import type { AuthContext } from "../types/express.js";

// The workbook model has no audit table. Call sites remain source-compatible while
// audit persistence is intentionally disabled until the model defines that entity.
export function writeAudit(
  _auth: AuthContext,
  _action: string,
  _entityType: string,
  _entityId: string | null,
  _metadata?: Record<string, unknown>,
): void {}
