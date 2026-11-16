# Modelo relacional derivado da planilha de simulação

O arquivo `apps/api/src/db/migrations/0001_workbook_clinical_domain.sql` adiciona o modelo à base SQLite existente. As migrações `0002_workbook_import_batches.sql` e `0003_workbook_relationships.sql` registram importações, relações de perguntas e linhas para revisão. A migração `0004_workbook_table_names.sql` renomeia as tabelas de domínio para os nomes das abas da planilha; `0005_workbook_column_names.sql` renomeia as colunas de negócio conforme os cabeçalhos e acrescenta os identificadores de planilha, mantendo chaves técnicas necessárias à aplicação. As migrações são versionadas e executadas em transação durante a inicialização da API; o banco não precisa ser recriado.

## Mapeamento das abas

| Aba da planilha | Tabela SQL | Decisão de modelagem |
|---|---|---|
| CLINICA | `CLINICA` | Complementada com CNPJ, contato, endereço, estado ativo e atualização. |
| PERFIL | `PERFIL` | Catálogo de papéis; Empresa/Terapeuta/Paciente se relacionam a `memberships`. |
| USUARIO | `USUARIO` | Credenciais ficam em `password_hash`; senha em texto simples não é armazenada. |
| PACIENTE | `PACIENTE` + `memberships` | Dados civis no perfil; usuário, papel e vínculo com clínica separados. |
| TERAPEUTA | `TERAPEUTA` + `memberships` | Formação/registro no perfil; especialidades e terapias em relacionamentos próprios. |
| ESPECIALIDADE | `ESPECIALIDADE` | Catálogo da clínica. |
| TERAPEUTA_ESPECIALIDADE | `TERAPEUTA_ESPECIALIDADE` | Associação N:N entre terapeuta e especialidade. |
| TERAPIA | `TERAPIA` | Terapia vinculada a especialidade e clínica. |
| PROTOCOLO | `PROTOCOLO` | Modelo terapêutico; preserva o vínculo opcional com o diagnóstico indicado na planilha. |
| PROTOCOLO_ETAPA | `PROTOCOLO_ETAPA` | Etapas ordenadas e pertencentes a um protocolo. |
| DIAGNOSTICO | `DIAGNOSTICO` | Registro individual vinculado a prontuário, paciente e terapeuta. |
| DIAGNOSTICO_PROTOCOLO | `DIAGNOSTICO_PROTOCOLO` | Vincula diagnóstico a uma etapa aplicada, com status e início. |
| EVOLUCAO | `EVOLUCAO` | Histórico de evolução vinculado à etapa de tratamento e autoria. |
| AGENDA | `AGENDA` | Agendamentos; adiciona data/canal/autoria do cancelamento. |
| PRONTUARIO | `PRONTUARIO` | Um prontuário por paciente e clínica. |
| ATENDIMENTO | `ATENDIMENTO` | Atendimento realizado, opcionalmente associado a um agendamento. |
| ANAMNESE | `ANAMNESE` | Instância de anamnese vinculada a atendimento. |
| PERGUNTAS | `PERGUNTAS` | Perguntas configuráveis por clínica e especialidade. |
| ANAMNESE_PERGUNTAS | `ANAMNESE_PERGUNTAS` | Tabela correspondente à aba da planilha; preserva o vínculo da resposta com a pergunta e a anamnese. |
| ANEXO | `ANEXO` | Metadados e chave privada de armazenamento; não guarda o arquivo dentro do banco. |
| BIOWELL_AVALIACAO | `BIOWELL_AVALIACAO` | Avaliação associada a paciente, atendimento e profissional responsável. |
| BIOWELL_CHAKRA | `BIOWELL_CHAKRA` | Medições por chakra ligadas à avaliação. |
| ANALISE_LINGUA | `ANALISE_LINGUA` | Referência privada à imagem, resultado da IA e parecer profissional. |
| RELATORIO | `RELATORIO` | Metadados do relatório e chave de armazenamento privado. |
| PAGAMENTO | `PAGAMENTO` | Pagamento ligado ao paciente e, quando aplicável, a atendimento ou pacote. |
| PACOTE | `PACOTE` | Pacote adquirido por paciente, quantidade, valor e validade. |
| AUDITORIA | `AUDITORIA` | Mantém os registros de auditoria e o endereço IP. |

Tabelas internas fora da planilha permanecem porque são usadas pela aplicação ou guardam dados de suporte: `memberships`, `sessions`, `notifications`, regras e bloqueios de agenda, eventos de agendamento, relações auxiliares de anamnese, registros clínicos, lotes/rejeições de importação e `schema_migrations`. Nenhuma tabela fora da planilha foi removida: as que têm dados ou são referenciadas pelo sistema não foram classificadas como obsoletas.

## Isolamento e integridade

As relações clínicas usam chaves estrangeiras compostas com `clinic_id` quando aplicável. Isso impede ligar, por exemplo, um paciente de uma clínica a um atendimento de outra. Índices apoiam consultas de prontuário, agenda e histórico por paciente.

## Importação da planilha

O modo incremental `scripts/import_excel_to_sqlite.py` grava somente clínica, especialidades, terapias e perguntas independentes; não apaga ou atualiza dados existentes.

Para substituir os dados atuais pelos da planilha, `scripts/replace_database_from_workbook.py` preserva a conta administrativa ativa, remove os demais registros da aplicação e importa os dados em uma transação. As contas de paciente/terapeuta e seus vínculos são criados ativos. Cada conta recebe uma senha aleatória forte; o script exibe e-mail e senha uma única vez, somente depois do commit. Apenas o hash é armazenado no banco e as senhas da planilha não são lidas nem reutilizadas. Guarde as credenciais exibidas em local seguro. A conta administrativa preservada recebe vínculo ativo com a clínica importada.

Linhas sem relação confiável são guardadas em `workbook_import_rejections` para revisão, sem incluir colunas de senha. A resposta da aba `ANAMNESE_PERGUNTAS` é importada diretamente pela coluna `Resposta`; não são presumidas abas de respostas separadas. Arquivos citados na planilha não são anexados porque o conteúdo dos arquivos não está no `.xlsx`. Datas de agenda sem hora e registros com referências inexistentes também ficam nessa área, em vez de receberem vínculos inventados. Essa tabela contém dados clínicos; limite o acesso ao arquivo SQLite.

Antes de importar, rode a prévia (não grava no banco):

```powershell
py -3.12 scripts\import_excel_to_sqlite.py --input "C:\caminho\QIConect_Simulacao_Atendimento_Completo.xlsx"
```

Para aplicar:

```powershell
py -3.12 scripts\import_excel_to_sqlite.py --input "C:\caminho\QIConect_Simulacao_Atendimento_Completo.xlsx" --apply
```

Para substituir os dados, a opção destrutiva exige `--apply`:

```powershell
py -3.12 scripts\replace_database_from_workbook.py --input "C:\caminho\QIConect_Simulacao_Atendimento_Completo.xlsx" --apply
```

O modo incremental cria backup, grava os cadastros numa transação e registra um resumo em `workbook_import_batches`; reexecutar a mesma planilha é idempotente. O modo de substituição também cria backup, preserva a conta administrativa ativa, verifica as chaves estrangeiras e registra as linhas que exigem revisão. A substituição não se repete para o mesmo arquivo por padrão; use `--force` somente quando quiser limpar e importar novamente, o que também gera novas senhas para as contas importadas.

## Aplicar e verificar

Inicie a API com `npm.cmd run dev`; ela aplica as migrações pendentes automaticamente. Para listar as tabelas com SQLite:

```sql
SELECT name
FROM sqlite_master
WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
ORDER BY name;
```

Para consultar o estado das migrações:

```sql
SELECT version, applied_at
FROM schema_migrations
ORDER BY version;
```
