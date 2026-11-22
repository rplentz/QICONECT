import { db } from "../db/database.js";

type AccountRole = "CLINIC_ADMIN" | "THERAPIST" | "PATIENT";
interface AccountInput { clinicId: string; email: string; fullName: string; phone?: string; password: string; role: AccountRole }
const profileId: Record<AccountRole, number> = { CLINIC_ADMIN: 1, THERAPIST: 3, PATIENT: 4 };

export async function createClinicAccount(
  input: AccountInput,
  provisionClinicLink?: (userClinicId: string, userId: string) => void,
): Promise<{ userId: string; userClinicId: string }> {
  const insert = db.transaction(() => {
    const result = db.prepare(
      "INSERT INTO USUARIO(nome,email,senha,perfil,dt_registro,dt_atualizacao) VALUES(?,?,?,?,?,?)",
    ).run(input.fullName.trim(), input.email.trim().toLowerCase(), input.password, profileId[input.role], new Date().toISOString(), new Date().toISOString());
    const userId = String(result.lastInsertRowid);
    const clinicLink = db.prepare(
      "INSERT INTO USUARIO_CLINICA(usuario_id,perfil_id,clinica_id,status) VALUES(?,?,?,1)",
    ).run(Number(userId), profileId[input.role], Number(input.clinicId));
    const userClinicId = String(clinicLink.lastInsertRowid);
    provisionClinicLink?.(userClinicId, userId);
    return { userId, userClinicId };
  });
  return insert.immediate();
}
