-- Physical schema generated from the workbook headers only (no application-only fields).
PRAGMA foreign_keys = ON;

CREATE TABLE "CLINICA" (
  "id" TEXT PRIMARY KEY,
  "nome" TEXT,
  "cnpj" TEXT,
  "email" TEXT,
  "telefone" TEXT,
  "endereco" TEXT,
  "ativo" INTEGER,
  "dt_registro" TEXT,
  "dt_atualizacao" TEXT
);

CREATE TABLE "PERFIL" (
  "id" TEXT PRIMARY KEY,
  "nome" TEXT
);

CREATE TABLE "USUARIO" (
  "id" TEXT PRIMARY KEY,
  "nome" TEXT,
  "email" TEXT NOT NULL UNIQUE COLLATE NOCASE,
  "senha" TEXT,
  "perfil" TEXT,
  "ativo" INTEGER,
  "dt_ult_acesso" TEXT,
  "dt_registro" TEXT,
  "dt_atualizacao" TEXT
);

CREATE TABLE "PACIENTE" (
  "id" TEXT PRIMARY KEY,
  "usuario_id" TEXT,
  "clinica_id" TEXT,
  "cpf" TEXT,
  "dt_nasc" TEXT,
  "telefone" TEXT,
  "sexo" TEXT,
  "endereco" TEXT,
  "Signo" TEXT,
  FOREIGN KEY ("usuario_id") REFERENCES "USUARIO"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("clinica_id") REFERENCES "CLINICA"("id") ON DELETE RESTRICT
);

CREATE TABLE "TERAPEUTA" (
  "id" TEXT PRIMARY KEY,
  "usuario_id" TEXT,
  "clinica_id" TEXT,
  "cpf" TEXT,
  "registro_prof" TEXT,
  "formacao" TEXT,
  FOREIGN KEY ("usuario_id") REFERENCES "USUARIO"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("clinica_id") REFERENCES "CLINICA"("id") ON DELETE RESTRICT
);

CREATE TABLE "ESPECIALIDADE" (
  "id" TEXT PRIMARY KEY,
  "nome" TEXT,
  "descricao" TEXT,
  "ativo" INTEGER
);

CREATE TABLE "TERAPEUTA_ESPECIALIDADE" (
  "id" TEXT PRIMARY KEY,
  "terapeuta_id" TEXT,
  "especialidade_id" TEXT,
  FOREIGN KEY ("terapeuta_id") REFERENCES "TERAPEUTA"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("especialidade_id") REFERENCES "ESPECIALIDADE"("id") ON DELETE RESTRICT
);

CREATE TABLE "TERAPIA" (
  "id" TEXT PRIMARY KEY,
  "especialidade_id" TEXT,
  "nome" TEXT,
  "descricao" TEXT,
  "duracao_min" INTEGER,
  "ativa" INTEGER,
  FOREIGN KEY ("especialidade_id") REFERENCES "ESPECIALIDADE"("id") ON DELETE RESTRICT
);

CREATE TABLE "PROTOCOLO" (
  "id" TEXT PRIMARY KEY,
  "terapeuta_id" TEXT,
  "diagnostico_id" TEXT,
  "nome" TEXT,
  "Sintomas" TEXT,
  "objetivo" TEXT,
  FOREIGN KEY ("terapeuta_id") REFERENCES "TERAPEUTA"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("diagnostico_id") REFERENCES "DIAGNOSTICO"("id") ON DELETE RESTRICT
);

CREATE TABLE "PROTOCOLO_ETAPA" (
  "id" TEXT PRIMARY KEY,
  "protocolo_id" TEXT,
  "sequencia" INTEGER,
  "terapia_id" TEXT,
  "dt_inicio" TEXT,
  "dt_fim" TEXT,
  "descricao" TEXT,
  "obs" TEXT,
  FOREIGN KEY ("protocolo_id") REFERENCES "PROTOCOLO"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("terapia_id") REFERENCES "TERAPIA"("id") ON DELETE RESTRICT
);

CREATE TABLE "DIAGNOSTICO" (
  "id" TEXT PRIMARY KEY,
  "terapeuta_id" TEXT,
  "paciente_id" TEXT,
  "descricao" TEXT,
  "dt_diagnostico" TEXT,
  FOREIGN KEY ("terapeuta_id") REFERENCES "TERAPEUTA"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("paciente_id") REFERENCES "PACIENTE"("id") ON DELETE RESTRICT
);

CREATE TABLE "DIAGNOSTICO_PROTOCOLO" (
  "id" TEXT PRIMARY KEY,
  "diagnostico_id" TEXT,
  "protocolo_etapa_id" TEXT,
  "dt_diagnostico" TEXT,
  "status" TEXT,
  FOREIGN KEY ("diagnostico_id") REFERENCES "DIAGNOSTICO"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("protocolo_etapa_id") REFERENCES "PROTOCOLO_ETAPA"("id") ON DELETE RESTRICT
);

CREATE TABLE "EVOLUCAO" (
  "id" TEXT PRIMARY KEY,
  "diagnostico_protocolo_id" TEXT,
  "descricao" TEXT,
  "dt_evolucao" TEXT,
  "status" TEXT,
  FOREIGN KEY ("diagnostico_protocolo_id") REFERENCES "DIAGNOSTICO_PROTOCOLO"("id") ON DELETE RESTRICT
);

CREATE TABLE "AGENDA" (
  "id" TEXT PRIMARY KEY,
  "paciente_id" TEXT,
  "terapeuta_id" TEXT,
  "terapia_id" TEXT,
  "dt_inicio" TEXT,
  "dt_fim" TEXT,
  "status" TEXT,
  FOREIGN KEY ("paciente_id") REFERENCES "PACIENTE"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("terapeuta_id") REFERENCES "TERAPEUTA"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("terapia_id") REFERENCES "TERAPIA"("id") ON DELETE RESTRICT
);

CREATE TABLE "ATENDIMENTO" (
  "id" TEXT PRIMARY KEY,
  "prontuario_id" TEXT,
  "paciente_id" TEXT,
  "terapeuta_id" TEXT,
  "terapia_id" TEXT,
  "dt_atend" TEXT,
  "status" TEXT,
  FOREIGN KEY ("prontuario_id") REFERENCES "PRONTUARIO"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("paciente_id") REFERENCES "PACIENTE"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("terapeuta_id") REFERENCES "TERAPEUTA"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("terapia_id") REFERENCES "TERAPIA"("id") ON DELETE RESTRICT
);

CREATE TABLE "PRONTUARIO" (
  "id" TEXT PRIMARY KEY,
  "paciente_id" TEXT,
  "data_abertura" TEXT,
  "status" TEXT,
  FOREIGN KEY ("paciente_id") REFERENCES "PACIENTE"("id") ON DELETE RESTRICT
);

CREATE TABLE "ANAMNESE" (
  "id" TEXT PRIMARY KEY,
  "atendimento_id" TEXT,
  "tipo" TEXT,
  "descricao" TEXT,
  "dt_registro" TEXT,
  FOREIGN KEY ("atendimento_id") REFERENCES "ATENDIMENTO"("id") ON DELETE RESTRICT
);

CREATE TABLE "PERGUNTAS" (
  "id" TEXT PRIMARY KEY,
  "descricao" TEXT
);

CREATE TABLE "ANAMNESE_PERGUNTAS" (
  "id" TEXT PRIMARY KEY,
  "anamnese_id" TEXT,
  "pergunta_id" TEXT,
  "Resposta" TEXT,
  FOREIGN KEY ("anamnese_id") REFERENCES "ANAMNESE"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("pergunta_id") REFERENCES "PERGUNTAS"("id") ON DELETE RESTRICT
);

CREATE TABLE "ANEXO" (
  "id" TEXT PRIMARY KEY,
  "prontuario_id" TEXT,
  "atendimento_id" TEXT,
  "tipo" TEXT,
  "arquivo" TEXT,
  "descricao" TEXT,
  "dt_atualizacao" TEXT,
  FOREIGN KEY ("prontuario_id") REFERENCES "PRONTUARIO"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("atendimento_id") REFERENCES "ATENDIMENTO"("id") ON DELETE RESTRICT
);

CREATE TABLE "BIOWELL_AVALIACAO" (
  "id" TEXT PRIMARY KEY,
  "paciente_id" TEXT,
  "atendimento_id" TEXT,
  "dt_avaliacao" TEXT,
  "indice_energetico" REAL,
  "indice_estresse" REAL,
  FOREIGN KEY ("paciente_id") REFERENCES "PACIENTE"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("atendimento_id") REFERENCES "ATENDIMENTO"("id") ON DELETE RESTRICT
);

CREATE TABLE "BIOWELL_CHAKRA" (
  "id" TEXT PRIMARY KEY,
  "avaliacao_id" TEXT,
  "chakra" TEXT,
  "valor" REAL,
  "equilibrio" TEXT,
  FOREIGN KEY ("avaliacao_id") REFERENCES "BIOWELL_AVALIACAO"("id") ON DELETE RESTRICT
);

CREATE TABLE "ANALISE_LINGUA" (
  "id" TEXT PRIMARY KEY,
  "paciente_id" TEXT,
  "atendimento_id" TEXT,
  "imagem" TEXT,
  "resultado_ia" TEXT,
  "parecer_terapeuta" TEXT,
  FOREIGN KEY ("paciente_id") REFERENCES "PACIENTE"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("atendimento_id") REFERENCES "ATENDIMENTO"("id") ON DELETE RESTRICT
);

CREATE TABLE "RELATORIO" (
  "id" TEXT PRIMARY KEY,
  "paciente_id" TEXT,
  "atendimento_id" TEXT,
  "tipo" TEXT,
  "arquivo_pdf" TEXT,
  "dt_geracao" TEXT,
  FOREIGN KEY ("paciente_id") REFERENCES "PACIENTE"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("atendimento_id") REFERENCES "ATENDIMENTO"("id") ON DELETE RESTRICT
);

CREATE TABLE "PAGAMENTO" (
  "id" TEXT PRIMARY KEY,
  "paciente_id" TEXT,
  "agenda_id" TEXT,
  "valor" REAL,
  "forma_pagamento" TEXT,
  "status" TEXT,
  FOREIGN KEY ("paciente_id") REFERENCES "PACIENTE"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("agenda_id") REFERENCES "AGENDA"("id") ON DELETE RESTRICT
);

CREATE TABLE "PACOTE" (
  "id" TEXT PRIMARY KEY,
  "paciente_id" TEXT,
  "nome" TEXT,
  "quantidade_sessoes" INTEGER,
  "valor" REAL,
  "validade" TEXT,
  FOREIGN KEY ("paciente_id") REFERENCES "PACIENTE"("id") ON DELETE RESTRICT
);

CREATE TABLE "AUDITORIA" (
  "id" TEXT PRIMARY KEY,
  "usuario_id" TEXT,
  "entidade" TEXT,
  "registro_id" TEXT,
  "acao" TEXT,
  "dt_hora" TEXT,
  "ip" TEXT,
  FOREIGN KEY ("usuario_id") REFERENCES "USUARIO"("id") ON DELETE RESTRICT
);

PRAGMA user_version = 1;
