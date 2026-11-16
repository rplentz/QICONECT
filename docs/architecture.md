# Arquitetura do MVP

## Stack

- Monorepo npm workspaces.
- Interface: React, TypeScript e Vite.
- API: Express 5, TypeScript e validação Zod.
- Persistência local: SQLite por `better-sqlite3`.
- Senhas: scrypt com salt aleatório.
- Testes: Vitest.

## Aplicações

```text
apps/
  api/
    src/
      config/       Leitura/validação da configuração
      db/           Criação do banco e dados demonstrativos
        migrations/ Migrações SQL versionadas do domínio clínico
      middleware/   Sessão, autorização, erros
      routes/       Auth, clínica, pacientes, agenda e prontuário
      security/     Hash de senha e sessão
      services/     Contas, auditoria e notificações pendentes
  web/
    src/
      features/     Login, painel, agenda, pacientes e prontuário
      lib/          Cliente da API e tipos de tela
packages/
  contracts/       Regra compartilhada de cancelamento
docs/              Regras e arquitetura
test/              Configuração de testes
data/              Banco SQLite local (não versionado)
```

## Isolamento multi-clínica

Uma conta pode ter vários vínculos de clínica. Cada requisição autenticada resolve clínica ativa da sessão no banco. Operações clínicas filtram pelo `clinic_id` e pelas permissões do vínculo. Chaves estrangeiras compostas impedem que pacientes, terapeutas e terapias de uma clínica sejam relacionados a um agendamento ou registro de outra.

O SQLite permite validar o MVP localmente sem instalar um serviço de banco. A camada atual usa SQL diretamente e não é uma migração transparente para PostgreSQL; uma estratégia de repositórios/migração deve ser definida antes do crescimento e da implantação multi-tenant em produção.

## Sessões e prontuário

- O cookie é HttpOnly, SameSite=Lax e Secure em produção.
- O token de sessão é aleatório; o banco guarda somente SHA-256 do token.
- Senhas usam scrypt; não são armazenadas em texto puro.
- O portal filtra prontuários por paciente e estado de liberação.
- Alterações relevantes são gravadas em `audit_events`.
- Registros clínicos não são excluídos pela API do MVP.

## Agendamento e notificações

Reservas são criadas dentro de transação SQLite imediata, após validação de disponibilidade e busca de sobreposição para paciente/terapeuta. O cancelamento pelo paciente valida a janela mínima de quatro horas; a equipe pode cancelar fora da janela, com motivo.

O cancelamento grava eventos e itens de notificação para e-mail e WhatsApp. O estado atual `NOT_CONFIGURED` é explícito: não existe integração de envio neste MVP e a gravação não deve ser interpretada como entrega ao terapeuta.

## Restrições de uso

Os dados de demonstração são criados apenas em `NODE_ENV=development`. O servidor bloqueia inicialização em outros ambientes até que o provisionamento inicial, revisão de segurança e operação de produção sejam implementados.

O mapeamento da planilha para as tabelas SQLite e as decisões de normalização estão em [modelo-base-dados.md](./modelo-base-dados.md).
