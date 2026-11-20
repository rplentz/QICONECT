-- QIConect database schema for SQLite (DBeaver).

-- Run this script using a SQLite connection. It creates an empty application database.

-- The PERFIL rows and migration history are required reference data for application compatibility.

PRAGMA foreign_keys = ON;

BEGIN TRANSACTION;

CREATE TABLE "AGENDA" (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES "CLINICA"(id) ON DELETE RESTRICT,
    patient_membership_id TEXT NOT NULL,
    therapist_membership_id TEXT NOT NULL,
    terapia_id TEXT NOT NULL,
    dt_inicio TEXT NOT NULL,
    dt_fim TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
    cancellation_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL, cancelled_at TEXT, cancelled_by_user_id TEXT REFERENCES "USUARIO"(id) ON DELETE SET NULL, cancellation_channel TEXT, patient_chart_id TEXT, paciente_id TEXT REFERENCES PACIENTE(id), terapeuta_id TEXT REFERENCES TERAPEUTA(id),
    CHECK (dt_inicio < dt_fim),
    FOREIGN KEY (patient_membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
    FOREIGN KEY (therapist_membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
    FOREIGN KEY (terapia_id, clinic_id) REFERENCES "TERAPIA"(id, clinic_id) ON DELETE RESTRICT
  );

CREATE TABLE "ANALISE_LINGUA" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_chart_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  atendimento_id TEXT,
  imagem TEXT NOT NULL,
  resultado_ia TEXT,
  parecer_terapeuta TEXT,
  analyzed_by_membership_id TEXT,
  analyzed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paciente_id TEXT REFERENCES PACIENTE(id),
  FOREIGN KEY (patient_chart_id, clinic_id)
    REFERENCES "PRONTUARIO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (atendimento_id, clinic_id)
    REFERENCES "ATENDIMENTO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (analyzed_by_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "ANAMNESE" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  atendimento_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  descricao TEXT,
  dt_registro TEXT NOT NULL,
  created_by_membership_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (atendimento_id, clinic_id)
    REFERENCES "ATENDIMENTO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "ANAMNESE_PERGUNTAS" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  anamnese_id TEXT NOT NULL,
  pergunta_id TEXT NOT NULL,
  "Resposta" TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (anamnese_id, pergunta_id),
  FOREIGN KEY (anamnese_id, clinic_id)
    REFERENCES "ANAMNESE"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (pergunta_id, clinic_id)
    REFERENCES "PERGUNTAS"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "ANEXO" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  prontuario_id TEXT NOT NULL,
  atendimento_id TEXT,
  uploaded_by_membership_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  descricao TEXT,
  dt_upload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, arquivo TEXT,
  FOREIGN KEY (prontuario_id, clinic_id)
    REFERENCES "PRONTUARIO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (atendimento_id, clinic_id)
    REFERENCES "ATENDIMENTO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (uploaded_by_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "ATENDIMENTO" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  prontuario_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  therapist_membership_id TEXT NOT NULL,
  terapia_id TEXT NOT NULL,
  agenda_id TEXT,
  dt_atend TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paciente_id TEXT REFERENCES PACIENTE(id), terapeuta_id TEXT REFERENCES TERAPEUTA(id),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (prontuario_id, clinic_id)
    REFERENCES "PRONTUARIO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (therapist_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (terapia_id, clinic_id)
    REFERENCES "TERAPIA"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (agenda_id, clinic_id)
    REFERENCES "AGENDA"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "AUDITORIA" (
    id TEXT PRIMARY KEY,
    clinic_id TEXT REFERENCES "CLINICA"(id) ON DELETE RESTRICT,
    usuario_id TEXT REFERENCES "USUARIO"(id) ON DELETE SET NULL,
    acao TEXT NOT NULL,
    entidade TEXT NOT NULL,
    registro_id TEXT,
    metadata TEXT,
    dt_hora TEXT NOT NULL
  , ip TEXT);

CREATE TABLE "BIOWELL_AVALIACAO" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_chart_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  atendimento_id TEXT,
  assessed_by_membership_id TEXT NOT NULL,
  dt_avaliacao TEXT NOT NULL,
  indice_energetico REAL,
  indice_estresse REAL,
  source_reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paciente_id TEXT REFERENCES PACIENTE(id),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_chart_id, clinic_id)
    REFERENCES "PRONTUARIO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (assessed_by_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (atendimento_id, clinic_id)
    REFERENCES "ATENDIMENTO"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "BIOWELL_CHAKRA" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  avaliacao_id TEXT NOT NULL,
  chakra TEXT NOT NULL,
  valor REAL,
  equilibrio TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (avaliacao_id, chakra),
  FOREIGN KEY (avaliacao_id, clinic_id)
    REFERENCES "BIOWELL_AVALIACAO"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "CLINICA" (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    nome TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    dt_registro TEXT NOT NULL
  , cnpj TEXT, email TEXT, telefone TEXT, endereco TEXT, ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)), dt_atualizacao TEXT);

CREATE TABLE "DIAGNOSTICO" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_chart_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  therapist_membership_id TEXT NOT NULL,
  encounter_id TEXT,
  descricao TEXT NOT NULL,
  dt_diagnostico TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paciente_id TEXT REFERENCES PACIENTE(id), terapeuta_id TEXT REFERENCES TERAPEUTA(id),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_chart_id, clinic_id)
    REFERENCES "PRONTUARIO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (therapist_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (encounter_id, clinic_id)
    REFERENCES "ATENDIMENTO"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "DIAGNOSTICO_PROTOCOLO" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  diagnostico_id TEXT NOT NULL,
  protocolo_etapa_id TEXT NOT NULL,
  dt_diagnostico TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (diagnostico_id, clinic_id)
    REFERENCES "DIAGNOSTICO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (protocolo_etapa_id, clinic_id)
    REFERENCES "PROTOCOLO_ETAPA"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "ESPECIALIDADE" (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES "CLINICA"(id) ON DELETE RESTRICT,
    nome TEXT NOT NULL,
    descricao TEXT,
    ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    UNIQUE (clinic_id, nome),
    UNIQUE (id, clinic_id)
  );

CREATE TABLE "EVOLUCAO" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  diagnostico_protocolo_id TEXT NOT NULL,
  author_membership_id TEXT NOT NULL,
  descricao TEXT NOT NULL,
  dt_evolucao TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (diagnostico_protocolo_id, clinic_id)
    REFERENCES "DIAGNOSTICO_PROTOCOLO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (author_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "PACIENTE" (
    membership_id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    dt_nasc TEXT,
    cpf TEXT,
    endereco TEXT,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT, sexo TEXT CHECK (sexo IS NULL OR sexo IN ('F', 'M', 'OTHER', 'UNSPECIFIED')), ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)), dt_atualizacao TEXT, id TEXT, usuario_id TEXT REFERENCES USUARIO(id), clinica_id TEXT REFERENCES CLINICA(id), telefone TEXT, terapeuta_id TEXT REFERENCES TERAPEUTA(id),
    FOREIGN KEY (membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
  );

CREATE TABLE "SOLICITACAO_ATUALIZACAO_CADASTRAL" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  terapeuta_id TEXT,
  alteracoes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by_membership_id TEXT,
  FOREIGN KEY (clinic_id) REFERENCES CLINICA(id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (terapeuta_id) REFERENCES TERAPEUTA(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewed_by_membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE SET NULL
);

CREATE INDEX profile_update_request_patient_idx
  ON "SOLICITACAO_ATUALIZACAO_CADASTRAL"(clinic_id, patient_membership_id, status);

CREATE TABLE "PACOTE" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  quantidade_sessoes INTEGER NOT NULL CHECK (quantidade_sessoes > 0),
  valor REAL NOT NULL CHECK (valor >= 0),
  validade TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paciente_id TEXT REFERENCES PACIENTE(id),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "PAGAMENTO" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  agenda_id TEXT,
  package_id TEXT,
  valor REAL NOT NULL CHECK (valor >= 0),
  forma_pagamento TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PAID', 'REFUNDED', 'CANCELLED')),
  paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paciente_id TEXT REFERENCES PACIENTE(id),
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (agenda_id, clinic_id)
    REFERENCES "AGENDA"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (package_id, clinic_id)
    REFERENCES "PACOTE"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "PERFIL" (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL UNIQUE
);

CREATE TABLE "PERGUNTAS" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  specialty_id TEXT,
  descricao TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (specialty_id, clinic_id)
    REFERENCES "ESPECIALIDADE"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "PRONTUARIO" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  data_abertura TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED', 'ARCHIVED')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paciente_id TEXT REFERENCES PACIENTE(id),
  UNIQUE (clinic_id, patient_membership_id),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "PROTOCOLO" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  terapia_id TEXT NOT NULL,
  therapist_membership_id TEXT,
  nome TEXT NOT NULL,
  descricao TEXT,
  objetivo TEXT,
  ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, terapeuta_id TEXT REFERENCES TERAPEUTA(id), diagnostico_id TEXT REFERENCES DIAGNOSTICO(id),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (terapia_id, clinic_id)
    REFERENCES "TERAPIA"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (therapist_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "PROTOCOLO_ETAPA" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  protocolo_id TEXT NOT NULL,
  sequencia INTEGER NOT NULL CHECK (sequencia > 0),
  dt_inicio TEXT,
  dt_fim TEXT,
  descricao TEXT NOT NULL,
  obs TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (protocolo_id, sequencia),
  UNIQUE (id, clinic_id),
  CHECK (dt_inicio IS NULL OR dt_fim IS NULL OR dt_inicio <= dt_fim),
  FOREIGN KEY (protocolo_id, clinic_id)
    REFERENCES "PROTOCOLO"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "RELATORIO" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  patient_chart_id TEXT NOT NULL,
  patient_membership_id TEXT NOT NULL,
  atendimento_id TEXT,
  generated_by_membership_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  arquivo_pdf TEXT NOT NULL UNIQUE,
  dt_geracao TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, paciente_id TEXT REFERENCES PACIENTE(id),
  FOREIGN KEY (patient_chart_id, clinic_id)
    REFERENCES "PRONTUARIO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (atendimento_id, clinic_id)
    REFERENCES "ATENDIMENTO"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (generated_by_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "TERAPEUTA" (
    membership_id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    registro_prof TEXT,
    biography TEXT, cpf TEXT, formacao TEXT, ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)), dt_atualizacao TEXT, id TEXT, usuario_id TEXT REFERENCES USUARIO(id), clinica_id TEXT REFERENCES CLINICA(id),
    FOREIGN KEY (membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
  );

CREATE TABLE "TERAPEUTA_ESPECIALIDADE" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  therapist_membership_id TEXT NOT NULL,
  especialidade_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, terapeuta_id TEXT REFERENCES TERAPEUTA(id),
  UNIQUE (therapist_membership_id, especialidade_id),
  FOREIGN KEY (therapist_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (especialidade_id, clinic_id)
    REFERENCES "ESPECIALIDADE"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE "TERAPIA" (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES "CLINICA"(id) ON DELETE RESTRICT,
    especialidade_id TEXT NOT NULL,
    nome TEXT NOT NULL,
    descricao TEXT,
    duracao_min INTEGER NOT NULL CHECK (duracao_min BETWEEN 10 AND 480),
    price REAL CHECK (price IS NULL OR price >= 0),
    ativa INTEGER NOT NULL DEFAULT 1 CHECK (ativa IN (0, 1)),
    UNIQUE (clinic_id, nome),
    UNIQUE (id, clinic_id),
    FOREIGN KEY (especialidade_id, clinic_id) REFERENCES "ESPECIALIDADE"(id, clinic_id) ON DELETE RESTRICT
  );

CREATE TABLE "USUARIO" (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    nome TEXT NOT NULL,
    telefone TEXT,
    ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0, 1)),
    dt_registro TEXT NOT NULL
  , dt_ult_acesso TEXT, dt_atualizacao TEXT);

CREATE TABLE anamnesis_assignments (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  anamnesis_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (anamnesis_id, question_id),
  FOREIGN KEY (anamnesis_id, clinic_id)
    REFERENCES "ANAMNESE"(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (question_id, clinic_id)
    REFERENCES "PERGUNTAS"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE anamnesis_question_options (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (question_id, display_order),
  FOREIGN KEY (question_id, clinic_id)
    REFERENCES "PERGUNTAS"(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE appointment_events (
    id TEXT PRIMARY KEY,
    appointment_id TEXT NOT NULL REFERENCES "AGENDA"(id) ON DELETE RESTRICT,
    actor_user_id TEXT REFERENCES "USUARIO"(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at TEXT NOT NULL
  );

CREATE TABLE availability_rules (
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

CREATE TABLE clinical_records (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES "CLINICA"(id) ON DELETE RESTRICT,
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

CREATE TABLE memberships (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES "CLINICA"(id) ON DELETE RESTRICT,
    user_id TEXT NOT NULL REFERENCES "USUARIO"(id) ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('CLINIC_ADMIN', 'THERAPIST', 'PATIENT')),
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INVITED', 'SUSPENDED')),
    created_at TEXT NOT NULL, profile_id TEXT REFERENCES "PERFIL"(id),
    UNIQUE (clinic_id, user_id),
    UNIQUE (id, clinic_id)
  );

CREATE TABLE notifications (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL REFERENCES "CLINICA"(id) ON DELETE RESTRICT,
    recipient TEXT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('EMAIL', 'WHATSAPP')),
    event TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'NOT_CONFIGURED')),
    details TEXT,
    created_at TEXT NOT NULL
  );

CREATE TABLE schedule_blocks (
    id TEXT PRIMARY KEY,
    clinic_id TEXT NOT NULL,
    therapist_membership_id TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    reason TEXT,
    CHECK (starts_at < ends_at),
    FOREIGN KEY (therapist_membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT
  );

CREATE TABLE schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "USUARIO"(id) ON DELETE CASCADE,
    clinic_id TEXT NOT NULL REFERENCES "CLINICA"(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

CREATE TABLE therapist_therapies (
    clinic_id TEXT NOT NULL,
    membership_id TEXT NOT NULL,
    therapy_id TEXT NOT NULL,
    PRIMARY KEY (membership_id, therapy_id),
    FOREIGN KEY (membership_id, clinic_id) REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
    FOREIGN KEY (therapy_id, clinic_id) REFERENCES "TERAPIA"(id, clinic_id) ON DELETE RESTRICT
  );

CREATE TABLE workbook_import_batches (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  clinic_id TEXT REFERENCES "CLINICA"(id) ON DELETE RESTRICT,
  imported_at TEXT NOT NULL,
  imported_rows INTEGER NOT NULL CHECK (imported_rows >= 0),
  reused_rows INTEGER NOT NULL CHECK (reused_rows >= 0),
  skipped_rows INTEGER NOT NULL CHECK (skipped_rows >= 0),
  summary_json TEXT NOT NULL,
  UNIQUE (source_name, source_sha256)
);

CREATE TABLE workbook_import_rejections (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  source_id TEXT,
  reason_code TEXT NOT NULL,
  unresolved_fields_json TEXT NOT NULL,
  source_row_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES workbook_import_batches(id) ON DELETE CASCADE
);

CREATE INDEX anamneses_encounter_type_idx ON "ANAMNESE"(clinic_id, atendimento_id, tipo);

CREATE INDEX anamnesis_answers_clinic_idx ON "ANAMNESE_PERGUNTAS"(clinic_id, anamnese_id);

CREATE INDEX anamnesis_questions_clinic_active_idx
  ON "PERGUNTAS"(clinic_id, ativo, display_order);

CREATE INDEX appointments_clinic_start_idx ON "AGENDA"(clinic_id, dt_inicio, status);

CREATE UNIQUE INDEX appointments_id_clinic_unique_idx ON "AGENDA"(id, clinic_id);

CREATE INDEX appointments_patient_start_idx ON "AGENDA"(patient_membership_id, dt_inicio, status);

CREATE INDEX appointments_therapist_start_idx ON "AGENDA"(therapist_membership_id, dt_inicio, status);

CREATE INDEX attachments_chart_date_idx ON "ANEXO"(clinic_id, prontuario_id, dt_upload);

CREATE INDEX audit_events_clinic_idx ON "AUDITORIA"(clinic_id, dt_hora);

CREATE INDEX audit_events_entity_idx ON "AUDITORIA"(clinic_id, entidade, registro_id, dt_hora);

CREATE INDEX biowell_patient_date_idx ON "BIOWELL_AVALIACAO"(clinic_id, patient_membership_id, dt_avaliacao);

CREATE INDEX clinical_records_patient_idx ON clinical_records(clinic_id, patient_membership_id, created_at);

CREATE UNIQUE INDEX clinics_cnpj_unique_idx ON "CLINICA"(cnpj) WHERE cnpj IS NOT NULL;

CREATE INDEX diagnoses_patient_date_idx ON "DIAGNOSTICO"(clinic_id, patient_membership_id, dt_diagnostico);

CREATE INDEX diagnosis_protocols_diagnosis_idx ON "DIAGNOSTICO_PROTOCOLO"(clinic_id, diagnostico_id, status);

CREATE INDEX encounters_patient_date_idx ON "ATENDIMENTO"(clinic_id, patient_membership_id, dt_atend);

CREATE INDEX encounters_therapist_date_idx ON "ATENDIMENTO"(clinic_id, therapist_membership_id, dt_atend);

CREATE INDEX evolutions_protocol_date_idx ON "EVOLUCAO"(clinic_id, diagnostico_protocolo_id, dt_evolucao);

CREATE INDEX memberships_clinic_role_idx ON memberships(clinic_id, role, status);

CREATE INDEX memberships_user_idx ON memberships(user_id, status);

CREATE INDEX notifications_clinic_idx ON notifications(clinic_id, status, created_at);

CREATE UNIQUE INDEX paciente_workbook_id_idx ON PACIENTE(id);
CREATE INDEX paciente_terapeuta_idx ON PACIENTE(clinic_id, terapeuta_id);

CREATE INDEX patient_charts_clinic_status_idx ON "PRONTUARIO"(clinic_id, status);

CREATE UNIQUE INDEX patient_profiles_cpf_per_clinic_idx
  ON "PACIENTE"(clinic_id, cpf)
  WHERE cpf IS NOT NULL;

CREATE INDEX payments_patient_date_idx ON "PAGAMENTO"(clinic_id, patient_membership_id, created_at);

CREATE INDEX protocols_clinic_active_idx ON "PROTOCOLO"(clinic_id, ativo, nome);

CREATE INDEX reports_patient_date_idx ON "RELATORIO"(clinic_id, patient_membership_id, dt_geracao);

CREATE UNIQUE INDEX terapeuta_workbook_id_idx ON TERAPEUTA(id);

CREATE INDEX therapeutic_packages_patient_idx
  ON "PACOTE"(clinic_id, patient_membership_id, status);

CREATE UNIQUE INDEX therapist_profiles_cpf_per_clinic_idx
  ON "TERAPEUTA"(clinic_id, cpf)
  WHERE cpf IS NOT NULL;

CREATE INDEX therapist_specialties_clinic_idx
  ON "TERAPEUTA_ESPECIALIDADE"(clinic_id, therapist_membership_id);

CREATE INDEX tongue_analyses_patient_date_idx
  ON "ANALISE_LINGUA"(clinic_id, patient_membership_id, created_at);

CREATE INDEX workbook_import_rejections_batch_idx
  ON workbook_import_rejections(batch_id, sheet_name);

CREATE TRIGGER agenda_workbook_ids_after_insert
AFTER INSERT ON AGENDA
WHEN NEW.paciente_id IS NULL OR NEW.terapeuta_id IS NULL
BEGIN
  UPDATE AGENDA
  SET paciente_id = COALESCE(NEW.paciente_id, (SELECT id FROM PACIENTE WHERE membership_id = NEW.patient_membership_id)),
      terapeuta_id = COALESCE(NEW.terapeuta_id, (SELECT id FROM TERAPEUTA WHERE membership_id = NEW.therapist_membership_id))
  WHERE id = NEW.id;
END;

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

INSERT INTO PERFIL (id, code, nome) VALUES
  ('profile-company', 'CLINIC_ADMIN', 'Empresa'),
  ('profile-therapist', 'THERAPIST', 'Terapeuta'),
  ('profile-patient', 'PATIENT', 'Paciente');

INSERT INTO schema_migrations (version, applied_at) VALUES
  ('0001_workbook_clinical_domain.sql', CURRENT_TIMESTAMP),
  ('0002_workbook_import_batches.sql', CURRENT_TIMESTAMP),
  ('0003_workbook_relationships.sql', CURRENT_TIMESTAMP),
  ('0004_workbook_table_names.sql', CURRENT_TIMESTAMP),
  ('0005_workbook_column_names.sql', CURRENT_TIMESTAMP);

COMMIT;
