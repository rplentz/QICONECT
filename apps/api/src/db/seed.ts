import { randomUUID } from "node:crypto";
import { db } from "./database.js";
import { hashPassword } from "../security/password.js";

const now = () => new Date().toISOString();

export async function seedDemoData(): Promise<void> {
  const existingClinic = db.prepare("SELECT id FROM CLINICA LIMIT 1").get();
  if (existingClinic) return;

  const clinicId = randomUUID();
  const specialtyId = randomUUID();
  const therapyId = randomUUID();
  const createdAt = now();

  const users = [
    { email: "admin@qiconect.local", name: "Administração QIConect", phone: null, role: "CLINIC_ADMIN", password: "Admin123!" },
    { email: "terapeuta@qiconect.local", name: "Ana Terapeuta", phone: "+5511999999999", role: "THERAPIST", password: "Terapeuta123!" },
    { email: "paciente@qiconect.local", name: "Joana Paciente", phone: "+5511988888888", role: "PATIENT", password: "Paciente123!" },
  ] as const;

  const insertUser = db.prepare(
    "INSERT INTO USUARIO (id, email, password_hash, nome, telefone, ativo, dt_registro) VALUES (?, ?, ?, ?, ?, 1, ?)",
  );
  const insertMembership = db.prepare(
    "INSERT INTO memberships (id, clinic_id, user_id, role, status, created_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)",
  );

  const hashes = await Promise.all(users.map((user) => hashPassword(user.password)));

  const createSeed = db.transaction(() => {
    db.prepare("INSERT INTO CLINICA (id, slug, nome, timezone, dt_registro) VALUES (?, ?, ?, ?, ?)").run(
      clinicId,
      "qiconect-demo",
      "Clínica QIConect",
      "America/Sao_Paulo",
      createdAt,
    );
    db.prepare("INSERT INTO ESPECIALIDADE (id, clinic_id, nome, descricao) VALUES (?, ?, ?, ?)").run(
      specialtyId,
      clinicId,
      "Naturopatia",
      "Práticas integrativas e acompanhamento terapêutico.",
    );
    db.prepare(
      "INSERT INTO TERAPIA (id, clinic_id, especialidade_id, nome, descricao, duracao_min, price, ativa) VALUES (?, ?, ?, ?, ?, ?, ?, 1)",
    ).run(therapyId, clinicId, specialtyId, "Consulta integrativa", "Atendimento inicial ou de acompanhamento.", 60, 120);

    const membershipIds: Record<string, string> = {};
    for (const [index, user] of users.entries()) {
      const userId = randomUUID();
      const membershipId = randomUUID();
      membershipIds[user.role] = membershipId;
      insertUser.run(userId, user.email, hashes[index], user.name, user.phone, createdAt);
      insertMembership.run(membershipId, clinicId, userId, user.role, createdAt);

      if (user.role === "PATIENT") {
        db.prepare("INSERT INTO PACIENTE (id, usuario_id, clinica_id, telefone, membership_id, clinic_id) VALUES (?, ?, ?, ?, ?, ?)").run(
          membershipId, userId, clinicId, user.phone, membershipId, clinicId,
        );
      } else if (user.role === "THERAPIST") {
        db.prepare(
          "INSERT INTO TERAPEUTA (id, usuario_id, clinica_id, membership_id, clinic_id, registro_prof, biography) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(membershipId, userId, clinicId, membershipId, clinicId, "DEMO-001", "Terapeuta da clínica de demonstração.");
      }
    }

    db.prepare("INSERT INTO therapist_therapies (clinic_id, membership_id, therapy_id) VALUES (?, ?, ?)").run(
      clinicId,
      membershipIds.THERAPIST,
      therapyId,
    );

    const insertAvailability = db.prepare(
      "INSERT INTO availability_rules (id, clinic_id, therapist_membership_id, weekday, starts_at, ends_at, active) VALUES (?, ?, ?, ?, ?, ?, 1)",
    );
    for (let weekday = 1; weekday <= 5; weekday += 1) {
      insertAvailability.run(randomUUID(), clinicId, membershipIds.THERAPIST, weekday, "08:00", "18:00");
    }
  });

  createSeed.immediate();
}
