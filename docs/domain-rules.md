# Regras de domínio do MVP

## Clínica e permissões

- Toda consulta de dados usa a clínica ativa da sessão; o cliente não escolhe o `clinic_id` de registros clínicos.
- Pacientes e terapeutas podem ter contas com vínculos distintos por clínica.
- Apenas vínculos ativos podem entrar no contexto da clínica.
- O administrador da clínica administra cadastros e agenda, mas não lê prontuários clínicos sem perfil de terapeuta.
- Cadastros administrativos podem ser arquivados logicamente e restaurados; o histórico e os vínculos permanecem no banco.
- Uma clínica só pode ser arquivada se o administrador tiver acesso a outra clínica ativa, e clínicas arquivadas podem ser restauradas por um administrador vinculado.
- O paciente só lista o próprio cadastro e registros liberados.

## Agendamento

- A clínica define fuso horário e regras semanais de disponibilidade de cada terapeuta.
- Terapeuta precisa estar habilitado para a terapia selecionada.
- O horário precisa estar disponível, fora de bloqueios e sem conflito de agenda do paciente ou terapeuta.
- Reservas e remarcações verificam conflito em transação SQLite imediata.
- Os instantes de atendimento são armazenados em UTC e comparados segundo o fuso da clínica.
- O paciente pode agendar para si; a equipe da clínica pode agendar para um paciente da mesma clínica.

## Cancelamento e remarcação

- O paciente pode cancelar/remarcar quando faltam quatro horas ou mais para o atendimento original.
- Exatamente quatro horas antes ainda permite a ação; com menos de quatro horas, o portal bloqueia.
- Terapeuta e administrador podem cancelar, mas precisam registrar motivo.
- Cancelamento mantém o histórico e libera o horário.
- Remarcação atualiza horário no agendamento existente e guarda os horários anterior e novo no histórico.
- Reserva, confirmação, remarcação e cancelamento geram itens de notificação. No MVP ficam `NOT_CONFIGURED`; nenhum e-mail ou WhatsApp é entregue sem integração.

## Prontuário

- Terapeutas podem criar anamnese, diagnóstico, protocolo e evolução para pacientes vinculados à clínica.
- Cada registro guarda autor, clínica e data de criação.
- O terapeuta autor pode liberar cada registro ao paciente; o paciente vê somente registros liberados.
- A API do MVP não permite apagar registros clínicos.

## Ainda não implementado

- Upload e armazenamento de documentos/imagens.
- Consentimentos digitais e solicitações de exclusão.
- Recuperação de senha e alteração de senha.
- Edição de cadastro do paciente.
- Gestão de instâncias clínicas em nível de plataforma.
- Entrega real de notificações por e-mail/WhatsApp.
- Integrações Bio-Well/IA, cobrança e exportação de relatórios.
