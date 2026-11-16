ALTER TABLE clinics ADD COLUMN cnpj TEXT;
ALTER TABLE clinics ADD COLUMN email TEXT;
ALTER TABLE clinics ADD COLUMN phone TEXT;
ALTER TABLE clinics ADD COLUMN address TEXT;
ALTER TABLE clinics ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
ALTER TABLE clinics ADD COLUMN updated_at TEXT;
UPDATE clinics SET updated_at = created_at WHERE updated_at IS NULL;
CREATE UNIQUE INDEX clinics_cnpj_unique_idx ON clinics(cnpj) WHERE cnpj IS NOT NULL;

ALTER TABLE users ADD COLUMN last_login_at TEXT;
ALTER TABLE users ADD COLUMN updated_at TEXT;
UPDATE users SET updated_at = created_at WHERE updated_at IS NULL;

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE
);
INSERT INTO profiles (id, code, name) VALUES
  ('profile-company', 'CLINIC_ADMIN', 'Empresa'),
  ('profile-therapist', 'THERAPIST', 'Terapeuta'),
  ('profile-patient', 'PATIENT', 'Paciente');

ALTER TABLE memberships ADD COLUMN profile_id TEXT REFERENCES profiles(id);
UPDATE memberships
SET profile_id = CASE role
  WHEN 'CLINIC_ADMIN' THEN 'profile-company'
  WHEN 'THERAPIST' THEN 'profile-therapist'
  WHEN 'PATIENT' THEN 'profile-patient'
END
WHERE profile_id IS NULL;

CREATE TRIGGER memberships_assign_profile_after_insert
AFTER INSERT ON memberships
WHEN NEW.profile_id IS NULL
BEGIN
  UPDATE memberships
  SET profile_id = CASE NEW.role
    WHEN 'CLINIC_ADMIN' THEN 'profile-company'
    WHEN 'THERAPIST' THEN 'profile-therapist'
    WHEN 'PATIENT' THEN 'profile-patient'
  END
  WHERE id = NEW.id;
END;

ALTER TABLE patient_profiles ADD COLUMN sex TEXT CHECK (sex IS NULL OR sex IN ('F', 'M', 'OTHER', 'UNSPECIFIED'));
ALTER TABLE patient_profiles ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
ALTER TABLE patient_profiles ADD COLUMN updated_at TEXT;
CREATE UNIQUE INDEX patient_profiles_cpf_per_clinic_idx
  ON patient_profiles(clinic_id, cpf)
  WHERE cpf IS NOT NULL;

ALTER TABLE therapist_profiles ADD COLUMN cpf TEXT;
ALTER TABLE therapist_profiles ADD COLUMN formation TEXT;
ALTER TABLE therapist_profiles ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
ALTER TABLE therapist_profiles ADD COLUMN updated_at TEXT;
CREATE UNIQUE INDEX therapist_profiles_cpf_per_clinic_idx
  ON therapist_profiles(clinic_id, cpf)
  WHERE cpf IS NOT NULL;

CREATE TABLE therapist_specialties (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  therapist_membership_id TEXT NOT NULL,
  specialty_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (therapist_membership_id, specialty_id),
  FOREIGN KEY (therapist_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (specialty_id, clinic_id)
    REFERENCES specialties(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX therapist_specialties_clinic_idx
  ON therapist_specialties(clinic_id, therapist_membership_id);

ALTER TABLE appointments ADD COLUMN cancelled_at TEXT;
ALTER TABLE appointments ADD COLUMN cancelled_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN cancellation_channel TEXT;
ALTER TABLE appointments ADD COLUMN patient_chart_id TEXT;
CREATE UNIQUE INDEX appointments_id_clinic_unique_idx ON appointments(id, clinic_id);

CREATE TABLE patient_charts (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED', 'ARCHIVED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (clinic_id, patient_membership_id),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX patient_charts_clinic_status_idx ON patient_charts(clinic_id, status);

CREATE TABLE encounters (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_chart_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  therapist_membership_id TEXT NOT NULL,
  therapy_id TEXT NOT NULL,
  appointment_id TEXT,
  attended_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_chart_id, clinic_id)
    REFERENCES patient_charts(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (therapist_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (therapy_id, clinic_id)
    REFERENCES therapies(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (appointment_id, clinic_id)
    REFERENCES appointments(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX encounters_patient_date_idx ON encounters(clinic_id, patient_membership_id, attended_at);
CREATE INDEX encounters_therapist_date_idx ON encounters(clinic_id, therapist_membership_id, attended_at);

CREATE TABLE diagnoses (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_chart_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  therapist_membership_id TEXT NOT NULL,
  encounter_id TEXT,
  description TEXT NOT NULL,
  diagnosed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_chart_id, clinic_id)
    REFERENCES patient_charts(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (therapist_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (encounter_id, clinic_id)
    REFERENCES encounters(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX diagnoses_patient_date_idx ON diagnoses(clinic_id, patient_membership_id, diagnosed_at);

CREATE TABLE protocols (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  therapy_id TEXT NOT NULL,
  therapist_membership_id TEXT,
  name TEXT NOT NULL,
  description TEXT,
  objective TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (therapy_id, clinic_id)
    REFERENCES therapies(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (therapist_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX protocols_clinic_active_idx ON protocols(clinic_id, active, name);

CREATE TABLE protocol_steps (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  protocol_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  starts_at TEXT,
  ends_at TEXT,
  description TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (protocol_id, sequence),
  UNIQUE (id, clinic_id),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at <= ends_at),
  FOREIGN KEY (protocol_id, clinic_id)
    REFERENCES protocols(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE diagnosis_protocols (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  diagnosis_id TEXT NOT NULL,
  protocol_step_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (diagnosis_id, clinic_id)
    REFERENCES diagnoses(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (protocol_step_id, clinic_id)
    REFERENCES protocol_steps(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX diagnosis_protocols_diagnosis_idx ON diagnosis_protocols(clinic_id, diagnosis_id, status);

CREATE TABLE evolutions (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  diagnosis_protocol_id TEXT NOT NULL,
  author_membership_id TEXT NOT NULL,
  description TEXT NOT NULL,
  evolved_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnosis_protocol_id, clinic_id)
    REFERENCES diagnosis_protocols(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (author_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX evolutions_protocol_date_idx ON evolutions(clinic_id, diagnosis_protocol_id, evolved_at);

CREATE TABLE anamneses (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  encounter_id TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  registered_at TEXT NOT NULL,
  created_by_membership_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (encounter_id, clinic_id)
    REFERENCES encounters(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX anamneses_encounter_type_idx ON anamneses(clinic_id, encounter_id, type);

CREATE TABLE anamnesis_questions (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  specialty_id TEXT,
  description TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (specialty_id, clinic_id)
    REFERENCES specialties(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX anamnesis_questions_clinic_active_idx
  ON anamnesis_questions(clinic_id, active, display_order);

CREATE TABLE anamnesis_answers (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  anamnesis_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (anamnesis_id, question_id),
  FOREIGN KEY (anamnesis_id, clinic_id)
    REFERENCES anamneses(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (question_id, clinic_id)
    REFERENCES anamnesis_questions(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX anamnesis_answers_clinic_idx ON anamnesis_answers(clinic_id, anamnesis_id);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_chart_id TEXT NOT NULL,
  encounter_id TEXT,
  uploaded_by_membership_id TEXT NOT NULL,
  type TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  description TEXT,
  uploaded_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_chart_id, clinic_id)
    REFERENCES patient_charts(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (encounter_id, clinic_id)
    REFERENCES encounters(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (uploaded_by_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX attachments_chart_date_idx ON attachments(clinic_id, patient_chart_id, uploaded_at);

CREATE TABLE biowell_assessments (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_chart_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  encounter_id TEXT,
  assessed_by_membership_id TEXT NOT NULL,
  assessed_at TEXT NOT NULL,
  energy_index REAL,
  stress_index REAL,
  source_reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_chart_id, clinic_id)
    REFERENCES patient_charts(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (assessed_by_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (encounter_id, clinic_id)
    REFERENCES encounters(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX biowell_patient_date_idx ON biowell_assessments(clinic_id, patient_membership_id, assessed_at);

CREATE TABLE biowell_chakras (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  assessment_id TEXT NOT NULL,
  chakra TEXT NOT NULL,
  value REAL,
  balance TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (assessment_id, chakra),
  FOREIGN KEY (assessment_id, clinic_id)
    REFERENCES biowell_assessments(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE tongue_analyses (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_chart_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  encounter_id TEXT,
  image_storage_key TEXT NOT NULL,
  ai_result TEXT,
  therapist_opinion TEXT,
  analyzed_by_membership_id TEXT,
  analyzed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_chart_id, clinic_id)
    REFERENCES patient_charts(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (encounter_id, clinic_id)
    REFERENCES encounters(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (analyzed_by_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX tongue_analyses_patient_date_idx
  ON tongue_analyses(clinic_id, patient_membership_id, created_at);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_chart_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  encounter_id TEXT,
  generated_by_membership_id TEXT NOT NULL,
  type TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_chart_id, clinic_id)
    REFERENCES patient_charts(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (encounter_id, clinic_id)
    REFERENCES encounters(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (generated_by_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX reports_patient_date_idx ON reports(clinic_id, patient_membership_id, generated_at);

CREATE TABLE therapeutic_packages (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  name TEXT NOT NULL,
  session_quantity INTEGER NOT NULL CHECK (session_quantity > 0),
  price REAL NOT NULL CHECK (price >= 0),
  valid_until TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX therapeutic_packages_patient_idx
  ON therapeutic_packages(clinic_id, patient_membership_id, status);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  appointment_id TEXT,
  package_id TEXT,
  amount REAL NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PAID', 'REFUNDED', 'CANCELLED')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (appointment_id, clinic_id)
    REFERENCES appointments(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (package_id, clinic_id)
    REFERENCES therapeutic_packages(id, clinic_id) ON DELETE RESTRICT
);
CREATE INDEX payments_patient_date_idx ON payments(clinic_id, patient_membership_id, created_at);

ALTER TABLE audit_events ADD COLUMN ip_address TEXT;
CREATE INDEX audit_events_entity_idx ON audit_events(clinic_id, entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
