CREATE TABLE workbook_import_batches (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  clinic_id TEXT REFERENCES clinics(id) ON DELETE RESTRICT,
  imported_at TEXT NOT NULL,
  imported_rows INTEGER NOT NULL CHECK (imported_rows >= 0),
  reused_rows INTEGER NOT NULL CHECK (reused_rows >= 0),
  skipped_rows INTEGER NOT NULL CHECK (skipped_rows >= 0),
  summary_json TEXT NOT NULL,
  UNIQUE (source_name, source_sha256)
);
