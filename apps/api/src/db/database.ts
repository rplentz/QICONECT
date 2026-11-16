import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../config/env.js";
import { migrateDatabase } from "./migrate.js";

const projectRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const databasePath =
  env.DATABASE_PATH === ":memory:"
    ? ":memory:"
    : isAbsolute(env.DATABASE_PATH)
      ? env.DATABASE_PATH
      : resolve(projectRoot, env.DATABASE_PATH);

if (databasePath !== ":memory:") {
  mkdirSync(dirname(databasePath), { recursive: true });
}

export const db = new Database(databasePath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

const hasMigrationHistory = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
  .get();

if (!hasMigrationHistory) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS clinics (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memberships (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('CLINIC_ADMIN', 'THERAPIST', 'PATIENT')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INVITED', 'SUSPENDED')),
    created_at TEXT NOT NULL,
    UNIQUE (clinic_id, user_id),
    UNIQUE (id, clinic_id)
  );

  CREATE TABLE IF NOT EXISTS patient_profiles (
    membership_id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    birth_date TEXT,
    cpf TEXT,
    address TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    FOREIGN KEY (membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS therapist_profiles (
    membership_id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    professional_registration TEXT,
    biography TEXT,
    FOREIGN KEY (membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS specialties (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    UNIQUE (clinic_id, name),
    UNIQUE (id, clinic_id)
  );

  CREATE TABLE IF NOT EXISTS therapies (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
    specialty_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 10 AND 480),
    price REAL CHECK (price IS NULL OR price >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    UNIQUE (clinic_id, name),
    UNIQUE (id, clinic_id),
    FOREIGN KEY (specialty_id, clinic_id) REFERENCES specialties(id, clinic_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS therapist_therapies (
    clinic_id TEXT NOT NULL,
    membership_id TEXT NOT NULL,
    therapy_id TEXT NOT NULL,
    PRIMARY KEY (membership_id, therapy_id),
    FOREIGN KEY (membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
    FOREIGN KEY (therapy_id, clinic_id) REFERENCES therapies(id, clinic_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS availability_rules (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    therapist_membership_id TEXT NOT NULL,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    CHECK (starts_at < ends_at),
    FOREIGN KEY (therapist_membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS schedule_blocks (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    therapist_membership_id TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    reason TEXT,
    CHECK (starts_at < ends_at),
    FOREIGN KEY (therapist_membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
    patient_membership_id TEXT NOT NULL,
    therapist_membership_id TEXT NOT NULL,
    therapy_id TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
    cancellation_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (starts_at < ends_at),
    FOREIGN KEY (patient_membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
    FOREIGN KEY (therapist_membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
    FOREIGN KEY (therapy_id, clinic_id) REFERENCES therapies(id, clinic_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS clinical_records (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
    patient_membership_id TEXT NOT NULL,
    author_membership_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('ANAMNESIS', 'DIAGNOSIS', 'PROTOCOL', 'EVOLUTION', 'DOCUMENT')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    released_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (patient_membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
    FOREIGN KEY (author_membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appointment_events (
    id TEXT PRIMARY KEY,
    appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE RESTRICT,
    actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE RESTRICT,
    recipient TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('EMAIL', 'WHATSAPP')),
    event TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'NOT_CONFIGURED')),
    details TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    clinic_id TEXT REFERENCES clinics(id) ON DELETE RESTRICT,
    actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships(user_id, status);
  CREATE INDEX IF NOT EXISTS memberships_clinic_role_idx ON memberships(clinic_id, role, status);
  CREATE INDEX IF NOT EXISTS appointments_clinic_start_idx ON appointments(clinic_id, starts_at, status);
  CREATE INDEX IF NOT EXISTS appointments_therapist_start_idx ON appointments(therapist_membership_id, starts_at, status);
  CREATE INDEX IF NOT EXISTS appointments_patient_start_idx ON appointments(patient_membership_id, starts_at, status);
  CREATE INDEX IF NOT EXISTS clinical_records_patient_idx ON clinical_records(clinic_id, patient_membership_id, created_at);
  CREATE INDEX IF NOT EXISTS audit_events_clinic_idx ON audit_events(clinic_id, created_at);
  CREATE INDEX IF NOT EXISTS notifications_clinic_idx ON notifications(clinic_id, status, created_at);
  `);
}

migrateDatabase(db);
