# Arquitetura do MVP

## Stack

- Interface: React, TypeScript e Vite.
- API: Express 5, TypeScript e Zod.
- Persistência: SQLite por `better-sqlite3`.
- Esquema canônico: `apps/api/src/db/workbook-schema.sql`, derivado da planilha de configurações.
- O versionamento do esquema usa `PRAGMA user_version`; não há tabela de migrações no modelo ativo.

## Aplicações

```text
apps/api/src/db/         Esquema, migração e dados de desenvolvimento
apps/api/src/middleware/ Autenticação e autorização
apps/api/src/routes/     Login, cadastros, pacientes, agenda e prontuário
apps/api/src/services/   Contas e notificações pendentes
apps/web/src/features/   Login, painel, agenda, cadastros e prontuário
packages/contracts/      Regra compartilhada de cancelamento
data/                    Banco SQLite local e arquivos enviados
```

## Clínica e perfil

`USUARIO_CLINICA` define o perfil e a situação de uma conta em cada clínica. A API valida o vínculo ativo antes de atender solicitações. Os registros de pacientes são escopados por `PACIENTE.clinica_id`; o vínculo do terapeuta com a clínica vem de `USUARIO_CLINICA`.

## Sessões e senhas

- O cookie de sessão é HttpOnly, SameSite=Lax e Secure em produção.
- O banco armazena o hash do token de sessão em `sessions`, ligado a `USUARIO`, `CLINICA` e `USUARIO_CLINICA`, com relação opcional ao perfil clínico.
- Para testes locais, contas novas armazenam senha em texto em `USUARIO.senha`, conforme a decisão temporária do produto. Senhas antigas em hash scrypt continuam verificáveis durante a migração.
- Os registros do prontuário são armazenados nas entidades específicas da planilha. O modelo atual não tem estado de liberação por registro nem tabela de auditoria.

## Agenda e notificações

`AGENDA` usa `STATUS`, `TERAPEUTA_DISPONIBILIDADE` e a busca de sobreposições para validar reservas. A disponibilidade representa janelas semanais; o modelo da planilha não registra bloqueios pontuais. O atendimento começa em `ATENDIMENTO`, seguido por `PRONTUARIO` e os registros clínicos associados.

`notifications` fica ligada à clínica e, quando identificável, ao usuário destinatário. O envio externo por e-mail ou WhatsApp continua sem provedor configurado.

## Migração do modelo

Na primeira inicialização após a mudança, a API cria um backup do banco anterior, converte os dados com relações correspondentes e remove as tabelas antigas fora do modelo atualizado. Consulte [modelo-base-dados.md](./modelo-base-dados.md) para os limites do esquema.
