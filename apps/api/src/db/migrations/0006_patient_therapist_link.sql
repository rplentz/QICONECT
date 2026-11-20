ALTER TABLE PACIENTE ADD COLUMN terapeuta_id TEXT REFERENCES TERAPEUTA(id);

UPDATE PACIENTE
SET terapeuta_id = (
  SELECT t.id
  FROM AGENDA a
  JOIN TERAPEUTA t ON t.membership_id = a.therapist_membership_id AND t.clinic_id = a.clinic_id
  WHERE a.patient_membership_id = PACIENTE.membership_id
    AND a.clinic_id = PACIENTE.clinic_id
  ORDER BY a.created_at
  LIMIT 1
)
WHERE terapeuta_id IS NULL;

CREATE INDEX paciente_terapeuta_idx ON PACIENTE(clinic_id, terapeuta_id);
