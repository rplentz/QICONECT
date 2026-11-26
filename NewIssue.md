Preparar publicação externa do QIConect

<!-- This issue will be created in repo rplentz/QICONECT (https://github.com/rplentz/QICONECT). Changing this line has no effect. -->

Assignees: 
Labels: 
Milestone: 
Projects: 


## Objetivo
Disponibilizar o QIConect para acesso externo por meio de uma URL segura, documentando a implantação e os requisitos para manter o serviço funcionando.

## Contexto
O sistema é um monorepo com frontend web, API e persistência SQLite. Uma publicação apenas do frontend no GitHub Pages não disponibiliza a API nem oferece a persistência necessária para o banco. O MVP ainda não está pronto para uso clínico em produção; a implantação deve usar dados fictícios até a conclusão das revisões de segurança e privacidade.

## Escopo
- Definir uma plataforma de hospedagem compatível com o frontend, a API e o armazenamento persistente.
- Configurar variáveis de ambiente e segredos fora do repositório.
- Configurar HTTPS, origem permitida (CORS), sessões e armazenamento/backups do banco.
- Automatizar build e implantação a partir do GitHub, com instruções de rollback.
- Documentar a URL publicada, configuração, operação e limitações conhecidas.

## Critérios de aceite
- A aplicação pode ser acessada externamente por HTTPS.
- Login, navegação e chamadas à API funcionam no ambiente publicado.
- O banco mantém os dados entre reinicializações e possui estratégia documentada de backup e restauração.
- Nenhum segredo, arquivo .env local ou banco de dados com dados pessoais/clínicos é publicado no repositório ou na imagem de build.
- A implantação usa dados fictícios e apresenta claramente as limitações do MVP até aprovação para uso em produção.
- As etapas de configuração, atualização e rollback estão documentadas.

## Fora do escopo inicial
Envio real de e-mail/WhatsApp, pagamentos, IA, Bio-Well, recuperação de senha por e-mail e uso com dados clínicos reais, até que esses recursos e os requisitos de segurança e privacidade sejam implementados e revisados.

## Observações
Antes de escolher o provedor, confirmar custos, região de hospedagem, armazenamento persistente e forma de gerenciamento dos segredos. Não incluir credenciais ou dados de pacientes neste issue.
