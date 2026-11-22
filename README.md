# QIConect

MVP local da plataforma web de gestão clínica integrativa. O projeto é um monorepo npm com interface React, API Express/TypeScript e persistência SQLite em arquivo. Não é necessário Docker nem um servidor de banco separado.

## Requisitos

- Node.js 22 ou superior.
- npm.
- Python 3.12, somente para importar planilhas Excel.

## Iniciar no Windows

Na pasta do projeto:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd install
npm.cmd run dev
```

Se já existir um `.env`, preserve-o; basta confirmar que `DATABASE_PATH=data/qiconect.sqlite` está configurado. A API cria o diretório e o banco automaticamente e aplica migrações pendentes. Em uma base vazia, prepara uma clínica local de desenvolvimento na primeira execução.

- Interface: `http://localhost:5174`
- API: `http://localhost:3333/api/v1/health`
- Banco local: `data/qiconect.sqlite`

O frontend encaminha as chamadas `/api` para a API por proxy Vite. O banco contém dados de saúde; mantenha o arquivo local protegido e use somente dados fictícios nesta versão.

## Importar a planilha de simulação (legado)

Os scripts de importação abaixo pertencem ao esquema anterior e ainda precisam ser convertidos para o modelo de `QIConect_configuracoes.xlsx`. A inicialização do sistema já aplica a nova modelagem; não execute os comandos legados contra o banco remodelado.

O modo incremental importa somente clínica, especialidades, terapias e perguntas, sem apagar os dados existentes. Para substituir a base pela planilha, o modo de substituição preserva a conta administrativa ativa, ativa as contas importadas com novas senhas aleatórias e nunca usa as senhas da planilha. As credenciais geradas são exibidas uma vez após a importação; guarde-as com segurança. Linhas com horários ausentes, arquivos não fornecidos ou referências inválidas ficam para revisão. A substituição é destrutiva e cria um backup automático; veja [docs/modelo-base-dados.md](./docs/modelo-base-dados.md).

```powershell
py -3.12 scripts\import_excel_to_sqlite.py --input "C:\caminho\QIConect_Simulacao_Atendimento_Completo.xlsx"
py -3.12 scripts\import_excel_to_sqlite.py --input "C:\caminho\QIConect_Simulacao_Atendimento_Completo.xlsx" --apply
py -3.12 scripts\replace_database_from_workbook.py --input "C:\caminho\QIConect_Simulacao_Atendimento_Completo.xlsx" --apply
```

## Login e usuários

A tela não preenche nem exibe contas de demonstração. Ao entrar, a API valida o e-mail e a senha contra `USUARIO` e verifica o vínculo ativo em `USUARIO_CLINICA` com uma clínica ativa. Uma base vazia recebe contas locais de desenvolvimento para validação; não use os dados gerados em produção. A modelagem derivada da planilha está descrita em [docs/modelo-base-dados.md](./docs/modelo-base-dados.md).

## Funcionalidades disponíveis

- Login, logout e sessão em cookie HttpOnly.
- Vínculos por clínica e troca de clínica restrita às clínicas autorizadas.
- Cadastros administrativos de clínicas, usuários, pacientes, terapeutas, especialidades e terapias, com criação, consulta, edição, arquivamento lógico e restauração.
- Cadastro/listagem de pacientes e terapeutas.
- Catálogo de especialidades e terapias.
- Regras semanais de disponibilidade de terapeutas.
- Agendamentos e remarcação com validação de clínica, profissional habilitado, disponibilidade e conflito de horário.
- Cancelamento pelo paciente até quatro horas antes; cancelamentos da equipe exigem motivo.
- Prontuário com registros de anamnese, diagnóstico, protocolo e evolução, incluindo liberação ao paciente.
- Registros de auditoria e notificações pendentes de provedor.

## Notificações e limitações

O cancelamento cria registros de notificação para e-mail e WhatsApp, mas **não envia mensagens externas ainda**. É necessário escolher/configurar um provedor de e-mail e um provedor de WhatsApp Business antes de habilitar a entrega real. IA, Bio-Well, pagamentos, recuperação de senha por e-mail e upload de arquivos ainda não estão implementados.

Esta versão é um MVP para desenvolvimento e validação com dados fictícios, não um sistema clínico pronto para produção. Para produção, faltam revisão de segurança e privacidade, implantação HTTPS, fluxos institucionais de provisionamento de clínicas, gestão de segredos, política de retenção/backups e configuração de provedores.

## Comandos

| Comando | Finalidade |
|---|---|
| `npm.cmd run dev` | Inicia API e frontend |
| `npm.cmd run build` | Compila contratos, API e frontend |
| `npm.cmd run typecheck` | Verifica os tipos TypeScript |
| `npm.cmd test` | Executa testes automatizados (regra de quatro horas, autenticação, isolamento e agenda) |

Consulte [docs/architecture.md](./docs/architecture.md) e [docs/domain-rules.md](./docs/domain-rules.md).
