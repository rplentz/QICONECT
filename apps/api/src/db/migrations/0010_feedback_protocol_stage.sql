CREATE TABLE IF NOT EXISTS FEEDBACK (
  id INTEGER PRIMARY KEY,
  protocolo_etapa_id INTEGER NOT NULL REFERENCES PROTOCOLO_ETAPA(id),
  dt_feedback date,
  percepcao_melhora TEXT,
  sugestao TEXT,
  avaliacao_melhora INTEGER
);
