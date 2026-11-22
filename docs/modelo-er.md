# Diagrama do modelo de dados atual

O diagrama acompanha as chaves configuradas na planilha. A definição física está em `apps/api/src/db/workbook-schema.sql`.

```mermaid
erDiagram
  STATUS ||--o{ CLINICA : status
  PERFIL ||--o{ USUARIO : perfil_padrao
  USUARIO ||--o{ USUARIO_CLINICA : acessa
  PERFIL ||--o{ USUARIO_CLINICA : perfil_na_clinica
  CLINICA ||--o{ USUARIO_CLINICA : autoriza
  USUARIO ||--o| PACIENTE : perfil_paciente
  CLINICA ||--o{ PACIENTE : atende
  USUARIO ||--o| TERAPEUTA : perfil_terapeuta
  USUARIO ||--o{ TERAPEUTA_DISPONIBILIDADE : disponibilidade
  CLINICA ||--o{ TERAPEUTA_DISPONIBILIDADE : agenda
  TERAPEUTA ||--o{ TERAPEUTA_ESPECIALIDADE : possui
  ESPECIALIDADE ||--o{ TERAPEUTA_ESPECIALIDADE : classifica
  ESPECIALIDADE ||--o{ TERAPIA : organiza
  TERAPEUTA ||--o{ DIAGNOSTICO : registra
  PACIENTE ||--o{ DIAGNOSTICO : recebe
  DIAGNOSTICO ||--o{ PROTOCOLO : orienta
  TERAPEUTA ||--o{ PROTOCOLO : conduz
  PROTOCOLO ||--o{ PROTOCOLO_ETAPA : contém
  TERAPIA ||--o{ PROTOCOLO_ETAPA : utiliza
  DIAGNOSTICO ||--o{ DIAGNOSTICO_PROTOCOLO : acompanha
  PROTOCOLO_ETAPA ||--o{ DIAGNOSTICO_PROTOCOLO : aplicada
  DIAGNOSTICO_PROTOCOLO ||--o{ EVOLUCAO : registra
  PACIENTE ||--o{ AGENDA : agenda
  TERAPEUTA ||--o{ AGENDA : atende
  TERAPIA ||--o{ AGENDA : selecionada
  PACIENTE ||--o{ ATENDIMENTO : participa
  TERAPEUTA ||--o{ ATENDIMENTO : realiza
  TERAPIA ||--o{ ATENDIMENTO : realizada
  ATENDIMENTO ||--|| PRONTUARIO : documenta
  ATENDIMENTO ||--o{ ANAMNESE : avalia
  ANAMNESE ||--o{ ANAMNESE_PERGUNTAS : responde
  PERGUNTAS ||--o{ ANAMNESE_PERGUNTAS : pergunta
  PRONTUARIO ||--o{ ANEXO : armazena
  ATENDIMENTO ||--o{ ANEXO : contextualiza
  PRONTUARIO ||--o{ BIOWELL_AVALIACAO : avalia
  ATENDIMENTO ||--o{ BIOWELL_AVALIACAO : contextualiza
  ATENDIMENTO ||--o{ RELATORIO : gera
  AGENDA ||--o{ PAGAMENTO : cobra
  ATENDIMENTO ||--o{ PAGAMENTO : quita
  USUARIO ||--o{ sessions : autentica
  CLINICA ||--o{ sessions : selecionada
  USUARIO_CLINICA ||--o{ sessions : autoriza
  CLINICA ||--o{ notifications : recebe
  USUARIO ||--o{ notifications : destinatario
```

O modelo contém as tabelas de negócio da planilha e mantém apenas `sessions` e `notifications` como tabelas técnicas adicionais. O catálogo `STATUS` é compartilhado entre as entidades que possuem campo de status.
