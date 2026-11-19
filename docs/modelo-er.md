# Modelo Entidade-Relacionamento — QIConect

Modelo do banco SQLite após as migrações `0001` a `0005`. Os diagramas destacam chaves primárias (PK), estrangeiras (FK), únicas (UK) e os principais atributos; campos de auditoria e controle de baixa relevância foram omitidos para facilitar a leitura.

As relações abaixo refletem as chaves estrangeiras declaradas no banco. Quando aplicável, as FKs são compostas por `clinic_id` e pelo identificador do registro para manter o isolamento entre clínicas.

## Clínica, cadastros e atendimento

```mermaid
erDiagram
    CLINICA {
        TEXT id PK
        TEXT slug UK
        TEXT nome
        TEXT timezone
        INTEGER ativo
    }
    USUARIO {
        TEXT id PK
        TEXT email UK
        TEXT password_hash
        TEXT nome
        INTEGER ativo
    }
    PERFIL {
        TEXT id PK
        TEXT code UK
        TEXT nome UK
    }
    memberships {
        TEXT id PK
        TEXT clinic_id FK
        TEXT user_id FK
        TEXT profile_id FK
        TEXT role
        TEXT status
    }
    PACIENTE {
        TEXT membership_id PK, FK
        TEXT clinic_id FK
        TEXT id UK
        TEXT usuario_id FK
        TEXT clinica_id FK
        TEXT dt_nasc
        INTEGER ativo
    }
    TERAPEUTA {
        TEXT membership_id PK, FK
        TEXT clinic_id FK
        TEXT id UK
        TEXT usuario_id FK
        TEXT clinica_id FK
        TEXT registro_prof
        INTEGER ativo
    }
    ESPECIALIDADE {
        TEXT id PK
        TEXT clinic_id FK
        TEXT nome
        INTEGER ativo
    }
    TERAPEUTA_ESPECIALIDADE {
        TEXT id PK
        TEXT clinic_id FK
        TEXT therapist_membership_id FK
        TEXT terapeuta_id FK
        TEXT especialidade_id FK
    }
    therapist_therapies {
        TEXT membership_id PK, FK
        TEXT therapy_id PK, FK
        TEXT clinic_id FK
    }
    TERAPIA {
        TEXT id PK
        TEXT clinic_id FK
        TEXT especialidade_id FK
        TEXT nome
        INTEGER duracao_min
        INTEGER ativa
    }
    AGENDA {
        TEXT id PK
        TEXT clinic_id FK
        TEXT patient_membership_id FK
        TEXT therapist_membership_id FK
        TEXT paciente_id FK
        TEXT terapeuta_id FK
        TEXT terapia_id FK
        TEXT status
        TEXT dt_inicio
        TEXT dt_fim
        TEXT cancelled_by_user_id FK
    }
    PRONTUARIO {
        TEXT id PK
        TEXT clinic_id FK
        TEXT patient_membership_id FK
        TEXT paciente_id FK
        TEXT data_abertura
        TEXT status
    }
    ATENDIMENTO {
        TEXT id PK
        TEXT clinic_id FK
        TEXT prontuario_id FK
        TEXT patient_membership_id FK
        TEXT therapist_membership_id FK
        TEXT terapia_id FK
        TEXT agenda_id FK
        TEXT dt_atend
        TEXT status
    }
    DIAGNOSTICO {
        TEXT id PK
        TEXT clinic_id FK
        TEXT patient_chart_id FK
        TEXT patient_membership_id FK
        TEXT therapist_membership_id FK
        TEXT encounter_id FK
        TEXT descricao
        TEXT dt_diagnostico
    }
    PROTOCOLO {
        TEXT id PK
        TEXT clinic_id FK
        TEXT terapia_id FK
        TEXT therapist_membership_id FK
        TEXT terapeuta_id FK
        TEXT diagnostico_id FK
        TEXT nome
        INTEGER ativo
    }
    PROTOCOLO_ETAPA {
        TEXT id PK
        TEXT clinic_id FK
        TEXT protocolo_id FK
        INTEGER sequencia
        TEXT descricao
    }
    DIAGNOSTICO_PROTOCOLO {
        TEXT id PK
        TEXT clinic_id FK
        TEXT diagnostico_id FK
        TEXT protocolo_etapa_id FK
        TEXT status
    }
    EVOLUCAO {
        TEXT id PK
        TEXT clinic_id FK
        TEXT diagnostico_protocolo_id FK
        TEXT author_membership_id FK
        TEXT descricao
        TEXT dt_evolucao
        TEXT status
    }

    CLINICA ||--o{ memberships : organiza
    USUARIO ||--o{ memberships : participa
    PERFIL ||--o{ memberships : classifica
    memberships ||--o| PACIENTE : perfil_paciente
    memberships ||--o| TERAPEUTA : perfil_terapeuta
    USUARIO o|--o{ PACIENTE : identifica
    USUARIO o|--o{ TERAPEUTA : identifica
    CLINICA o|--o{ PACIENTE : cadastra
    CLINICA o|--o{ TERAPEUTA : cadastra
    CLINICA ||--o{ ESPECIALIDADE : oferece
    CLINICA ||--o{ TERAPIA : oferece
    ESPECIALIDADE ||--o{ TERAPIA : classifica
    TERAPEUTA o|--o{ TERAPEUTA_ESPECIALIDADE : possui
    memberships ||--o{ TERAPEUTA_ESPECIALIDADE : vincula
    ESPECIALIDADE ||--o{ TERAPEUTA_ESPECIALIDADE : relaciona
    memberships ||--o{ therapist_therapies : habilita
    TERAPIA ||--o{ therapist_therapies : disponibiliza
    CLINICA ||--o{ AGENDA : mantém
    memberships ||--o{ AGENDA : paciente
    memberships ||--o{ AGENDA : terapeuta
    PACIENTE o|--o{ AGENDA : agenda
    TERAPEUTA o|--o{ AGENDA : atende
    TERAPIA ||--o{ AGENDA : solicita
    USUARIO o|--o{ AGENDA : cancela
    memberships ||--o| PRONTUARIO : possui
    PACIENTE o|--o| PRONTUARIO : registra
    CLINICA ||--o{ PRONTUARIO : mantém
    PRONTUARIO ||--o{ ATENDIMENTO : contém
    memberships ||--o{ ATENDIMENTO : paciente
    memberships ||--o{ ATENDIMENTO : terapeuta
    PACIENTE o|--o{ ATENDIMENTO : perfil_paciente
    TERAPEUTA o|--o{ ATENDIMENTO : perfil_terapeuta
    TERAPIA ||--o{ ATENDIMENTO : realizada
    AGENDA o|--o{ ATENDIMENTO : origina
    PACIENTE o|--o{ DIAGNOSTICO : recebe
    TERAPEUTA o|--o{ DIAGNOSTICO : registra
    memberships ||--o{ DIAGNOSTICO : paciente
    memberships ||--o{ DIAGNOSTICO : terapeuta
    PRONTUARIO ||--o{ DIAGNOSTICO : documenta
    ATENDIMENTO o|--o{ DIAGNOSTICO : contextualiza
    TERAPIA ||--o{ PROTOCOLO : define
    memberships o|--o{ PROTOCOLO : responsável
    TERAPEUTA o|--o{ PROTOCOLO : responsável
    DIAGNOSTICO o|--o{ PROTOCOLO : indica
    PROTOCOLO ||--o{ PROTOCOLO_ETAPA : divide
    DIAGNOSTICO ||--o{ DIAGNOSTICO_PROTOCOLO : aplica
    PROTOCOLO_ETAPA ||--o{ DIAGNOSTICO_PROTOCOLO : etapa_aplicada
    DIAGNOSTICO_PROTOCOLO ||--o{ EVOLUCAO : acompanha
    memberships ||--o{ EVOLUCAO : autor
```

## Registros clínicos, avaliações e financeiro

```mermaid
erDiagram
    memberships {
        TEXT id PK
        TEXT clinic_id FK
        TEXT role
    }
    ESPECIALIDADE {
        TEXT id PK
        TEXT clinic_id FK
    }
    PERGUNTAS {
        TEXT id PK
        TEXT clinic_id FK
        TEXT specialty_id FK
        TEXT descricao
    }
    ANAMNESE {
        TEXT id PK
        TEXT clinic_id FK
        TEXT atendimento_id FK
        TEXT created_by_membership_id FK
        TEXT tipo
        TEXT dt_registro
    }
    ANAMNESE_PERGUNTAS {
        TEXT id PK
        TEXT clinic_id FK
        TEXT anamnese_id FK
        TEXT pergunta_id FK
        TEXT Resposta
    }
    anamnesis_question_options {
        TEXT id PK
        TEXT clinic_id FK
        TEXT question_id FK
        INTEGER display_order
    }
    anamnesis_assignments {
        TEXT id PK
        TEXT clinic_id FK
        TEXT anamnesis_id FK
        TEXT question_id FK
        INTEGER display_order
    }
    PRONTUARIO {
        TEXT id PK
        TEXT clinic_id FK
        TEXT patient_membership_id FK
    }
    ATENDIMENTO {
        TEXT id PK
        TEXT clinic_id
    }
    ANEXO {
        TEXT id PK
        TEXT clinic_id FK
        TEXT prontuario_id FK
        TEXT atendimento_id FK
        TEXT uploaded_by_membership_id FK
        TEXT storage_key UK
    }
    BIOWELL_AVALIACAO {
        TEXT id PK
        TEXT clinic_id FK
        TEXT patient_chart_id FK
        TEXT patient_membership_id FK
        TEXT atendimento_id FK
        TEXT assessed_by_membership_id FK
        REAL indice_energetico
        REAL indice_estresse
    }
    BIOWELL_CHAKRA {
        TEXT id PK
        TEXT clinic_id FK
        TEXT avaliacao_id FK
        TEXT chakra
        REAL valor
    }
    ANALISE_LINGUA {
        TEXT id PK
        TEXT clinic_id FK
        TEXT patient_chart_id FK
        TEXT patient_membership_id FK
        TEXT atendimento_id FK
        TEXT analyzed_by_membership_id FK
        TEXT imagem
    }
    RELATORIO {
        TEXT id PK
        TEXT clinic_id FK
        TEXT patient_chart_id FK
        TEXT patient_membership_id FK
        TEXT atendimento_id FK
        TEXT generated_by_membership_id FK
        TEXT arquivo_pdf UK
    }
    PACIENTE {
        TEXT membership_id PK, FK
        TEXT id UK
    }
    AGENDA {
        TEXT id PK
        TEXT clinic_id FK
    }
    PACOTE {
        TEXT id PK
        TEXT clinic_id FK
        TEXT patient_membership_id FK
        TEXT paciente_id FK
        TEXT status
    }
    PAGAMENTO {
        TEXT id PK
        TEXT clinic_id FK
        TEXT patient_membership_id FK
        TEXT paciente_id FK
        TEXT agenda_id FK
        TEXT package_id FK
        REAL valor
        TEXT status
    }

    ESPECIALIDADE o|--o{ PERGUNTAS : especializa
    ATENDIMENTO ||--o{ ANAMNESE : registra
    memberships ||--o{ ANAMNESE : autor
    ANAMNESE ||--o{ ANAMNESE_PERGUNTAS : responde
    PERGUNTAS ||--o{ ANAMNESE_PERGUNTAS : pergunta
    PERGUNTAS ||--o{ anamnesis_question_options : oferece
    ANAMNESE ||--o{ anamnesis_assignments : atribui
    PERGUNTAS ||--o{ anamnesis_assignments : seleciona
    PRONTUARIO ||--o{ ANEXO : arquiva
    ATENDIMENTO o|--o{ ANEXO : associa
    memberships ||--o{ ANEXO : envia
    PRONTUARIO ||--o{ BIOWELL_AVALIACAO : contém
    memberships ||--o{ BIOWELL_AVALIACAO : paciente
    memberships ||--o{ BIOWELL_AVALIACAO : avaliador
    ATENDIMENTO o|--o{ BIOWELL_AVALIACAO : contextualiza
    PACIENTE o|--o{ BIOWELL_AVALIACAO : avaliado
    BIOWELL_AVALIACAO ||--o{ BIOWELL_CHAKRA : mede
    PRONTUARIO ||--o{ ANALISE_LINGUA : contém
    memberships ||--o{ ANALISE_LINGUA : paciente
    memberships o|--o{ ANALISE_LINGUA : analista
    ATENDIMENTO o|--o{ ANALISE_LINGUA : contextualiza
    PACIENTE o|--o{ ANALISE_LINGUA : analisado
    PRONTUARIO ||--o{ RELATORIO : contém
    memberships ||--o{ RELATORIO : paciente
    memberships ||--o{ RELATORIO : emissor
    ATENDIMENTO o|--o{ RELATORIO : contextualiza
    PACIENTE o|--o{ RELATORIO : pertence
    memberships ||--o{ PACOTE : adquire
    PACIENTE o|--o{ PACOTE : possui
    memberships ||--o{ PAGAMENTO : paciente
    PACIENTE o|--o{ PAGAMENTO : responsável
    AGENDA o|--o{ PAGAMENTO : quita
    PACOTE o|--o{ PAGAMENTO : utiliza
```

## Suporte operacional e auditoria

```mermaid
erDiagram
    CLINICA {
        TEXT id PK
    }
    USUARIO {
        TEXT id PK
    }
    memberships {
        TEXT id PK
        TEXT clinic_id FK
    }
    AGENDA {
        TEXT id PK
    }
    sessions {
        TEXT token_hash PK
        TEXT user_id FK
        TEXT clinic_id FK
        TEXT expires_at
    }
    notifications {
        TEXT id PK
        TEXT clinic_id FK
        TEXT recipient
        TEXT channel
        TEXT status
    }
    appointment_events {
        TEXT id PK
        TEXT appointment_id FK
        TEXT actor_user_id FK
        TEXT action
    }
    availability_rules {
        TEXT id PK
        TEXT clinic_id FK
        TEXT therapist_membership_id FK
        INTEGER weekday
        TEXT starts_at
        TEXT ends_at
    }
    schedule_blocks {
        TEXT id PK
        TEXT clinic_id FK
        TEXT therapist_membership_id FK
        TEXT starts_at
        TEXT ends_at
    }
    clinical_records {
        TEXT id PK
        TEXT clinic_id FK
        TEXT patient_membership_id FK
        TEXT author_membership_id FK
        TEXT type
        TEXT released_at
    }
    AUDITORIA {
        TEXT id PK
        TEXT clinic_id FK
        TEXT usuario_id FK
        TEXT acao
        TEXT registro_id
        TEXT dt_hora
    }
    workbook_import_batches {
        TEXT id PK
        TEXT clinic_id FK
        TEXT source_name
        TEXT source_sha256
        INTEGER imported_rows
        INTEGER skipped_rows
    }
    workbook_import_rejections {
        TEXT id PK
        TEXT batch_id FK
        TEXT sheet_name
        TEXT reason_code
        TEXT unresolved_fields_json
    }
    schema_migrations {
        TEXT version PK
        TEXT applied_at
    }

    USUARIO ||--o{ sessions : autentica
    CLINICA ||--o{ sessions : contexto
    CLINICA ||--o{ notifications : recebe
    AGENDA ||--o{ appointment_events : registra
    USUARIO o|--o{ appointment_events : autor
    memberships ||--o{ availability_rules : define
    memberships ||--o{ schedule_blocks : bloqueia
    CLINICA ||--o{ availability_rules : pertence
    CLINICA ||--o{ schedule_blocks : pertence
    CLINICA ||--o{ clinical_records : mantém
    memberships ||--o{ clinical_records : paciente
    memberships ||--o{ clinical_records : autor
    CLINICA o|--o{ AUDITORIA : audita
    USUARIO o|--o{ AUDITORIA : ator
    CLINICA o|--o{ workbook_import_batches : importa
    workbook_import_batches ||--o{ workbook_import_rejections : detalha
```

## Observações

- `memberships` é o vínculo entre usuário, clínica e perfil; `PACIENTE` e `TERAPEUTA` complementam esse vínculo com dados específicos de cada papel.
- Algumas tabelas mantêm identificadores de planilha (`paciente_id`, `terapeuta_id`, entre outros) além dos vínculos por `memberships`. O diagrama registra somente relações que têm FK declarada no esquema.
- `ANEXO`, `ANALISE_LINGUA` e `RELATORIO` armazenam referências/metadados de arquivos; o conteúdo não é armazenado como coluna binária no SQLite.
- `sessions.token_hash` representa o hash do token de sessão, não o token em texto claro.
- Tabelas auxiliares de importação e auditoria podem conter dados sensíveis. Restrinja o acesso ao banco SQLite e aos arquivos de backup.
