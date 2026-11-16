# TriPro

Acompanhamento de **todos os projetos da Trium** (aplicação independente, sem ligação com os sistemas que ela acompanha): carteira de projetos, Curva S por projeto (planejado, realizado e projeção de término), entregas da semana, atrasos, avanço por módulo e comentários da equipe. E-mail a cada entrega concluída e resumo diário às 7h30.

Funciona no navegador e pode ser **instalado como app** (PWA) no Android, no iPhone/iPad e no computador: *Menu › Instalar o app*.

- **Página:** `index.html` (site estático, roda no GitHub Pages)
- **Banco e login:** Supabase (projeto `trium-acompanhamento`, região São Paulo)
- **E-mails:** função `notificar` no Supabase, enviando pelo Resend

## Segurança

- O código é público. A página usa só a **chave pública** do Supabase, que foi feita para ficar no navegador.
- Quem protege os dados são as regras de acesso do banco (RLS): sem login aprovado, ninguém lê nem grava nada.
- Login só pelo Google. Todo novo acesso fica **pendente** até o administrador aprovar em *Menu › Usuários*.
- **Nunca** coloque neste repositório a chave `service_role`, a chave do Resend ou senhas.

## Colocar no ar (uma vez)

### 1. Login com Google
1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto, configure a *Tela de consentimento OAuth* (tipo Externo) e crie uma credencial **ID do cliente OAuth** do tipo *Aplicativo da Web*.
2. Em *URIs de redirecionamento autorizados*, coloque: `https://wtbhkhkrtmyfzyzegncj.supabase.co/auth/v1/callback`
3. No Supabase: *Authentication › Sign In / Providers › Google*: ligue e cole o *Client ID* e o *Client Secret* do Google.
4. No Supabase: *Authentication › URL Configuration*: em *Site URL* coloque o endereço do GitHub Pages (passo 3) e adicione o mesmo endereço em *Redirect URLs*.

### 2. E-mails (Resend)
1. Crie a conta no [Resend](https://resend.com) e verifique o domínio `triumsistemas.com.br` (sem domínio verificado, o Resend só envia para o próprio dono da conta).
2. Crie uma API key.
3. No Supabase: *Edge Functions › Secrets*, cadastre:
   - `RESEND_API_KEY` = a chave do Resend
   - `EMAIL_REMETENTE` = `TriPro <projetos@triumsistemas.com.br>`
   - `LINK_PAINEL` = endereço do GitHub Pages

### 3. GitHub Pages
1. Suba esta pasta num repositório (ex.: `trium/tripro`).
2. *Settings › Pages › Deploy from a branch › main / root*.
3. O endereço fica `https://SEU_USUARIO.github.io/tripro/`.

> GitHub Pages grátis exige repositório **público**. Repositório privado com Pages precisa de plano pago, e o site continua acessível pelo link. Como o código não tem segredos, o repositório público é seguro.

## Uso
- **Lançar avanço:** escolha a entrega e o percentual **acumulado** (ex.: 60% = 60% da entrega pronta). Ao lançar 100%, todos recebem o e-mail de conclusão.
- **Novo projeto** (administrador): nome, descrição e situação. Cada projeto tem a sua Curva S.
- **Nova entrega:** módulo, responsável, datas previstas e peso (dias de esforço). O peso define quanto a entrega move a curva.
- **Comentários:** na gaveta de cada entrega. Entram no resumo diário.
- **Meus e-mails:** cada pessoa liga ou desliga o e-mail de conclusão e o resumo diário.

## Como a curva é calculada
- **Planejado:** o peso de cada entrega é distribuído igualmente entre o início e o fim previstos.
- **Realizado:** soma, pelo peso, do último percentual lançado de cada entrega até aquela data.
- **Índice de prazo:** realizado ÷ planejado hoje (1,00 = no prazo; abaixo de 1 = atrasado).
- **Projeção:** ritmo médio das últimas 4 semanas, levado até 100%.

## Banco (pasta `supabase/`)
Os scripts já foram aplicados no projeto. Servem de registro e para recriar o banco em outro projeto:
`001_estrutura` · `002_carga_inicial` (dados de exemplo) · `003_notificacoes` (gatilho e agendamento das 7h30) · `004_funcoes_privadas` · `005_tempo_real` · `006_admin_inicial` · `007_varios_projetos` · `functions/notificar` (função dos e-mails).

## Ícone do Google no botão de login
Baixe o ícone oficial na página de identidade visual do *Sign in with Google* e salve como `icons/google.svg`. A página usa o arquivo automaticamente; sem ele, o botão mostra um ícone neutro.

## App instalável (PWA)
`manifest.webmanifest`, `sw.js` e a pasta `icons/`. O service worker guarda só a casca do app; dados e login vão sempre direto ao Supabase. Ao publicar uma versão nova, troque `VERSAO` em `sw.js` para os aparelhos atualizarem.

## Quadro, sprints, agenda e resumo do dia (versão 3)

Migrações novas: `008_kanban_sprints_agenda.sql` e `009_resumos_e_agenda.sql` (já aplicadas no projeto). Edge Functions: `notificar` (v3) e `agenda`.

- **Quadro (kanban):** colunas A fazer, Fazendo, Em revisão e Concluída. Arraste os cartões no computador; no celular, abra a tarefa e use "Mover para". Mover para Concluída lança 100% e dispara o e-mail. Para reabrir, lance um avanço menor que 100%.
- **Sprints:** crie, inicie e conclua. Ao concluir, o que sobrou vai para a próxima sprint ou volta ao backlog. Só uma sprint ativa por vez.
- **Tarefas:** abas Detalhes, Subtarefas (checklist) e Anexos (imagem ou PDF, até 10 MB, no Storage privado `anexos`, aberto por link temporário de 1 hora).
- **Agenda:** eventos manuais + prazos + sprints. Cada evento tem "Google Agenda", "Outlook" e ".ics". Em Configurações > Agenda, cada pessoa gera um link iCal pessoal para assinar no Google Agenda ou no Outlook (mão única; o Google atualiza a cada 8 a 24 h).
- **Resumo do dia:** gerado às 7h15 (cron `tripro-resumo-ia`) e incluído no e-mail das 7h30. Sem chave de IA, sai um resumo por regras fixas (custo zero). Para usar IA gratuita, crie uma chave no Google AI Studio e cadastre o segredo `GEMINI_API_KEY` nas Edge Functions (opcional: `GEMINI_MODELO`, padrão `gemini-2.5-flash`). Atenção: no plano gratuito do Gemini, o Google pode usar os dados enviados para melhorar os produtos dele.
- **Seletor de projeto:** no topo (atalho Ctrl+K), com busca. Vale para todas as telas.

## Versão 4: mais inteligente e reorganizada

Migração nova: `011_convites_mencoes_notificacoes.sql` (já aplicada). Função `notificar` v4 (resumo por projeto, perguntas à IA, e-mail de menções).

- **Menu:** Hoje · Trabalho (Quadro, Agenda, Sprints) · Acompanhamento (Projetos e Curva S, Todas as tarefas) · Equipe (Conversas, Usuários e acessos) · Ajuda, Configurações e Sair.
- **Hoje:** resumo do dia (geral ou do projeto escolhido), "Precisa de atenção" (atrasos, tarefas paradas há 7 dias, sprint em risco, sobrecarga, projeto abaixo do plano, backlog), minhas tarefas, agenda de hoje e sprint ativa.
- **Barra inteligente (Ctrl+K):** busca tarefas, projetos e telas; cria tarefa por frase (`Tela de login sexta @Rafael #CRM !alta`); pergunta à IA (`o que está atrasado?`).
- **Subtarefas** calculam o avanço sozinhas; com todas feitas, a tarefa vai para Em revisão (95%) até alguém mover para Concluída.
- **Conversas:** novo comentário com @menção; a pessoa recebe notificação (sino) e e-mail.
- **Usuários:** convidar por e-mail (entra já aprovado), aprovar, rejeitar, bloquear, desbloquear e remover.
- **Agenda do time:** filtros por projeto, responsável e situação; reuniões minhas e da equipe; prazos com a cor da situação; participantes notificados.
- **Tema claro/escuro, tour guiado e manual** (menu Ajuda).

## v5 · inteligência (previsões, dependências, custo, GitHub e cliente)

- **Previsões** (menu Acompanhamento): simulação de 2.000 cenários com o avanço real de cada semana. Mostra a chance de cumprir o prazo, a data mais provável (P50) e a data com folga (P85).
- **Calibração**: fator real ÷ planejado por pessoa e por módulo. O cadastro de tarefa sugere um prazo realista.
- **Dependências** ("Depende de" no cadastro) e **atraso em cadeia**.
- **Bloqueios automáticos**: comentários com "travado", "aguardando" ou "sem acesso" marcam a tarefa; "liberado" ou "resolvido" desmarcam.
- **Decisões**: comentários com "decidimos" ou "ficou definido" entram sozinhos; também é possível colar uma ata.
- **Sprint automática**: montada pela capacidade de cada pessoa, pelas prioridades e pelas dependências.
- **Custo e valor entregue** em R$, visível só para administradores. O valor da hora fica em Configurações; as horas são lançadas no avanço.
- **GitHub**: a função `github` recebe o webhook. Crie o segredo `GITHUB_WEBHOOK_SECRET` no Supabase e o mesmo valor no webhook do repositório (eventos push e pull_request).
- **Link do cliente**: `relatorio.html?t=<token>` é uma página só de leitura, gerada e desativada pelo administrador no projeto. Os dados vêm da função `relatorio`.

Migração: `supabase/012_inteligencia.sql`.
