CREATE TABLE IF NOT EXISTS "AGENDA" (
  id TEXT PRIMARY KEY,
  clinic_id TEXT NOT NULL REFERENCES "CLINICA"(id) ON DELETE RESTRICT,
  patient_membership_id TEXT NOT NULL,
  therapist_membership_id TEXT NOT NULL,
  terapia_id TEXT NOT NULL,
  dt_inicio TEXT NOT NULL,
  dt_fim TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CONFIRMED'
    CHECK (status IN ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),
  cancellation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  patient_chart_id TEXT,
  cancelled_at TEXT,
  cancelled_by_user_id TEXT REFERENCES "USUARIO"(id) ON DELETE SET NULL,
  cancellation_channel TEXT,
  paciente_id TEXT REFERENCES PACIENTE(id),
  terapeuta_id TEXT REFERENCES TERAPEUTA(id),
  CHECK (dt_inicio < dt_fim),
  FOREIGN KEY (patient_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (therapist_membership_id, clinic_id)
    REFERENCES memberships(id, clinic_id) ON DELETE RESTRICT,
  FOREIGN KEY (terapia_id, clinic_id)
    REFERENCES "TERAPIA"(id, clinic_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS appointments_clinic_start_idx
  ON "AGENDA"(clinic_id, dt_inicio, status);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_id_clinic_unique_idx
  ON "AGENDA"(id, clinic_id);
CREATE INDEX IF NOT EXISTS appointments_patient_start_idx
  ON "AGENDA"(patient_membership_id, dt_inicio, status);
CREATE INDEX IF NOT EXISTS appointments_therapist_start_idx
  ON "AGENDA"(therapist_membership_id, dt_inicio, status);

CREATE TRIGGER IF NOT EXISTS agenda_workbook_ids_after_insert
AFTER INSERT ON AGENDA
WHEN NEW.paciente_id IS NULL OR NEW.terapeuta_id IS NULL
BEGIN
  UPDATE AGENDA
  SET paciente_id = COALESCE(NEW.paciente_id, (SELECT id FROM PACIENTE WHERE membership_id = NEW.patient_membership_id)),
      terapeuta_id = COALESCE(NEW.terapeuta_id, (SELECT id FROM TERAPEUTA WHERE membership_id = NEW.therapist_membership_id))
  WHERE id = NEW.id;
END;

ALTER TABLE PROTOCOLO_ETAPA
  ADD COLUMN terapia_id TEXT REFERENCES TERAPIA(id) ON DELETE RESTRICT;
UPDATE PROTOCOLO_ETAPA
SET terapia_id = (
  SELECT terapia_id FROM PROTOCOLO WHERE PROTOCOLO.id = PROTOCOLO_ETAPA.protocolo_id
)
WHERE terapia_id IS NULL;
