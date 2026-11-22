# Modelo de dados do QIConect

O esquema SQLite está definido em `apps/api/src/db/workbook-schema.sql` e segue as abas de entidades e as guias `tiposdedados`, `chaves` e `relacionamentos` de `QIConect_configuracoes.xlsx`. As tabelas de negócio são as tabelas da planilha. As únicas tabelas técnicas adicionais são `sessions` e `notifications`, mantidas por decisão do produto.

## Vínculos principais

- `USUARIO.perfil` guarda o perfil padrão da conta. `USUARIO_CLINICA` registra o perfil e o status do usuário dentro de cada clínica. O acesso é autorizado por esse vínculo e pelo status da clínica.
- `PACIENTE` guarda os dados do paciente e referencia `USUARIO` e `CLINICA`. `TERAPEUTA` guarda os dados profissionais e referencia `USUARIO`; seu perfil de acesso à clínica fica em `USUARIO_CLINICA`.
- `TERAPEUTA_DISPONIBILIDADE` vincula o usuário terapeuta à clínica, ao dia da semana e ao intervalo de horário. A agenda também impede conflito com agendamentos existentes.
- O fluxo clínico usa `AGENDA`, `ATENDIMENTO`, `PRONTUARIO`, `ANAMNESE`/`ANAMNESE_PERGUNTAS`, `DIAGNOSTICO`, `PROTOCOLO`/`PROTOCOLO_ETAPA`, `DIAGNOSTICO_PROTOCOLO` e `EVOLUCAO`.
- Os campos `status` que existem nas entidades referenciam o catálogo comum `STATUS`.
- `sessions` referencia `USUARIO`, `CLINICA`, `USUARIO_CLINICA` e, conforme o perfil, `PACIENTE` ou `TERAPEUTA`. `notifications` referencia `CLINICA` e o usuário quando identificado.

## Migração e preservação de dados

Na primeira inicialização após a remodelagem, a API cria um backup SQLite com o sufixo `before-workbook-remodel`. A migração converte os registros do esquema anterior para as entidades novas, remove as tabelas antigas e registra a versão pelo `PRAGMA user_version`, sem criar uma tabela `schema_migrations`. IDs de sessão em uso são preservados quando os vínculos correspondentes existem. Hashes de senha existentes continuam aceitos durante a transição; as novas contas de desenvolvimento usam o campo `USUARIO.senha` em texto, conforme a decisão temporária para testes.

O arquivo de modelo antigo em `docs/qiconect_sqlite_ddl.sql` foi descontinuado. Não execute esse arquivo; use o esquema canônico em `apps/api/src/db/workbook-schema.sql`.

## Limites definidos pelo modelo

- `TERAPEUTA_DISPONIBILIDADE` permite horários recorrentes e a agenda verifica conflitos existentes. A planilha não contém campos para registrar bloqueios pontuais, motivo ou intervalo de ausência.
- A planilha não armazena histórico de eventos da agenda nem uma situação de liberação por registro clínico. Essas funções deixam de ter a persistência antiga.
- O catálogo `STATUS` não possui um estado específico “Concluído”; o atendimento usa os estados listados na planilha.
- Datas e horários são serializados como texto ISO nos campos declarados `date`/`TIME`, preservando ordenação e leitura pelo SQLite.
