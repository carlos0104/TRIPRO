# TRIPRO

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
   - `EMAIL_REMETENTE` = `TRIPRO <projetos@triumsistemas.com.br>`
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
