-- Trium · Acompanhamento do projeto
-- Estrutura, aprovação de usuários e regras de acesso (RLS).
-- Ninguém lê nem grava sem login aprovado. A página só usa a chave pública.

-- 1. Membros: todo login com Google cria uma linha "pendente"
create table public.membros (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  nome        text,
  foto        text,
  status      text not null default 'pendente' check (status in ('pendente','aprovado','bloqueado')),
  papel       text not null default 'editor' check (papel in ('admin','editor')),
  criado_em   timestamptz not null default now(),
  aprovado_em timestamptz,
  aprovado_por text,
  receber_conclusoes boolean not null default true,
  receber_resumo     boolean not null default true
);

-- 2. Entregas do projeto
create table public.tarefas (
  id               text primary key,
  modulo           text not null,
  entrega          text not null,
  responsavel      text not null,
  peso             numeric(6,2) not null check (peso > 0),
  inicio_previsto  date not null,
  fim_previsto     date not null,
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  constraint datas_validas check (fim_previsto >= inicio_previsto)
);

-- 3. Avanços: cada lançamento é o % acumulado da entrega naquela data
create table public.avancos (
  id          bigint generated always as identity primary key,
  tarefa_id   text not null references public.tarefas(id) on delete cascade,
  data        date not null default current_date,
  percentual  numeric(5,2) not null check (percentual between 0 and 100),
  observacao  text,
  autor       text default (auth.jwt() ->> 'email'),
  criado_em   timestamptz not null default now(),
  notificado_em timestamptz
);
create index avancos_tarefa_data on public.avancos (tarefa_id, data);

-- 3b. Comentários por entrega
create table public.comentarios (
  id         bigint generated always as identity primary key,
  tarefa_id  text not null references public.tarefas(id) on delete cascade,
  texto      text not null check (length(trim(texto)) between 1 and 2000),
  autor_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  autor      text default (auth.jwt() ->> 'email'),
  criado_em  timestamptz not null default now()
);
create index comentarios_tarefa on public.comentarios (tarefa_id, criado_em);

-- 3c. Registro de e-mails enviados (evita envio duplicado)
create table public.envios (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('conclusao','resumo')),
  referencia  text not null,
  destinatarios int not null default 0,
  enviado_em  timestamptz not null default now(),
  unique (tipo, referencia)
);

-- 4. Funções de permissão (security definer para não depender do RLS de membros)
create or replace function public.eh_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.user_id = auth.uid() and m.status = 'aprovado');
$$;
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.user_id = auth.uid() and m.status = 'aprovado' and m.papel = 'admin');
$$;
revoke all on function public.eh_aprovado() from public, anon;
revoke all on function public.eh_admin() from public, anon;
grant execute on function public.eh_aprovado() to authenticated;
grant execute on function public.eh_admin() to authenticated;

-- 5. Novo usuário do Google vira membro pendente
create or replace function public.novo_membro() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.membros (user_id, email, nome, foto)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
          new.raw_user_meta_data ->> 'avatar_url')
  on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function public.novo_membro() from public, anon, authenticated;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.novo_membro();

-- 5b. Cada membro escolhe quais e-mails recebe (sem poder mudar o próprio status)
create or replace function public.minhas_preferencias(conclusoes boolean, resumo boolean) returns void
language sql security definer set search_path = '' as $$
  update public.membros set receber_conclusoes = conclusoes, receber_resumo = resumo where user_id = auth.uid();
$$;
revoke all on function public.minhas_preferencias(boolean, boolean) from public, anon;
grant execute on function public.minhas_preferencias(boolean, boolean) to authenticated;

-- 6. Carimbo de atualização
create or replace function public.carimbar() returns trigger
language plpgsql set search_path = '' as $$
begin new.atualizado_em := now(); return new; end $$;
create trigger tarefas_atualizado before update on public.tarefas
  for each row execute function public.carimbar();

-- 6b. O autor é sempre quem está logado (não dá para assinar por outra pessoa)
create or replace function public.definir_autor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.autor := auth.jwt() ->> 'email';
    if tg_table_name = 'comentarios' then new.autor_id := auth.uid(); end if;
  end if;
  if tg_table_name = 'avancos' then new.notificado_em := null; end if;
  return new;
end $$;
create trigger avancos_autor before insert on public.avancos for each row execute function public.definir_autor();
create trigger comentarios_autor before insert on public.comentarios for each row execute function public.definir_autor();

-- 7. RLS
alter table public.membros enable row level security;
alter table public.tarefas enable row level security;
alter table public.avancos enable row level security;
alter table public.comentarios enable row level security;
alter table public.envios enable row level security;

-- membros: cada um vê a própria linha; admin vê e altera todas; ninguém se autoaprova
create policy membros_ver_proprio on public.membros for select to authenticated
  using (user_id = (select auth.uid()));
create policy membros_admin_ver on public.membros for select to authenticated
  using ((select public.eh_admin()));
create policy membros_admin_alterar on public.membros for update to authenticated
  using ((select public.eh_admin())) with check ((select public.eh_admin()));
create policy membros_admin_excluir on public.membros for delete to authenticated
  using ((select public.eh_admin()) and user_id <> (select auth.uid()));

-- tarefas e avanços: só aprovados
create policy tarefas_ler on public.tarefas for select to authenticated using ((select public.eh_aprovado()));
create policy tarefas_criar on public.tarefas for insert to authenticated with check ((select public.eh_aprovado()));
create policy tarefas_alterar on public.tarefas for update to authenticated using ((select public.eh_aprovado())) with check ((select public.eh_aprovado()));
create policy tarefas_excluir on public.tarefas for delete to authenticated using ((select public.eh_admin()));

create policy avancos_ler on public.avancos for select to authenticated using ((select public.eh_aprovado()));
create policy avancos_criar on public.avancos for insert to authenticated with check ((select public.eh_aprovado()));
create policy avancos_excluir on public.avancos for delete to authenticated using ((select public.eh_admin()));

create policy comentarios_ler on public.comentarios for select to authenticated using ((select public.eh_aprovado()));
create policy comentarios_criar on public.comentarios for insert to authenticated with check ((select public.eh_aprovado()) and autor_id = (select auth.uid()));
create policy comentarios_excluir on public.comentarios for delete to authenticated using (autor_id = (select auth.uid()) or (select public.eh_admin()));

create policy envios_admin_ver on public.envios for select to authenticated using ((select public.eh_admin()));

-- anon não tem acesso a nada
revoke all on public.membros, public.tarefas, public.avancos, public.comentarios, public.envios from anon;
