CREATE TABLE anamnesis_question_options (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (question_id, display_order),
  FOREIGN KEY (question_id, clinic_id)
    REFERENCES anamnesis_questions(id, clinic_id) ON DELETE RESTRICT
);

CREATE TABLE anamnesis_assignments (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL,
  anamnesis_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (anamnesis_id, question_id),
  FOREIGN KEY (anamnesis_id, clinic_id)
    REFERENCES anamneses(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (question_id, clinic_id)
    REFERENCES anamnesis_questions(id, clinic_id) ON DELETE RESTRICT
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

CREATE INDEX workbook_import_rejections_batch_idx
  ON workbook_import_rejections(batch_id, sheet_name);
