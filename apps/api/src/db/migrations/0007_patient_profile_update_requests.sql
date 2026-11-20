CREATE TABLE SOLICITACAO_ATUALIZACAO_CADASTRAL (
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
  ON SOLICITACAO_ATUALIZACAO_CADASTRAL(clinic_id, patient_membership_id, status);
