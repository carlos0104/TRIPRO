-- TRIPRO · convites, menções em comentários, participantes de eventos e notificações

-- 1. Convites: o admin cadastra o e-mail antes; no primeiro login a pessoa já entra aprovada
create table public.convites (
  email      text primary key check (email = lower(email) and email like '%@%'),
  nome       text,
  papel      text not null default 'editor' check (papel in ('admin','editor')),
  criado_por text default (auth.jwt() ->> 'email'),
  criado_em  timestamptz not null default now(),
  usado_em   timestamptz
);
alter table public.convites enable row level security;
create policy convites_admin on public.convites for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
revoke all on public.convites from anon;

create or replace function public.novo_membro() returns trigger
language plpgsql security definer set search_path = '' as $$
declare adm boolean; cv record;
begin
  select exists (select 1 from privado.admins_iniciais a where a.email = lower(new.email)) into adm;
  select * into cv from public.convites c where c.email = lower(new.email) and c.usado_em is null;
  insert into public.membros (user_id, email, nome, foto, status, papel, aprovado_em, aprovado_por)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', cv.nome),
          new.raw_user_meta_data ->> 'avatar_url',
          case when adm or cv.email is not null then 'aprovado' else 'pendente' end,
          case when adm then 'admin' when cv.email is not null then cv.papel else 'editor' end,
          case when adm or cv.email is not null then now() end,
          case when adm then 'configuração inicial' when cv.email is not null then 'convite de ' || coalesce(cv.criado_por, 'admin') end)
  on conflict (user_id) do nothing;
  if cv.email is not null then update public.convites set usado_em = now() where email = cv.email; end if;
  return new;
end $$;
revoke all on function public.novo_membro() from public, anon, authenticated;

-- 2. Pessoas aprovadas (para mencionar e convidar para eventos); só aprovados chamam
create or replace function public.pessoas() returns table (user_id uuid, nome text, email text, foto text, papel text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, coalesce(m.nome, split_part(m.email, '@', 1)), m.email, m.foto, m.papel
  from public.membros m where m.status = 'aprovado' and privado.eh_aprovado() order by 2;
$$;
revoke all on function public.pessoas() from public, anon;
grant execute on function public.pessoas() to authenticated;

-- 3. Menções e participantes
alter table public.comentarios add column mencoes uuid[] not null default '{}';
alter table public.eventos add column participantes uuid[] not null default '{}';

-- 4. Notificações (cada pessoa vê e marca como lida só as suas)
create table public.notificacoes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  tipo       text not null check (tipo in ('mencao','evento','aprovacao')),
  titulo     text not null,
  texto      text,
  tarefa_id  text references public.tarefas(id) on delete cascade,
  evento_id  bigint references public.eventos(id) on delete cascade,
  autor      text,
  lida       boolean not null default false,
  criado_em  timestamptz not null default now(),
  email_em   timestamptz
);
create index notificacoes_user on public.notificacoes (user_id, lida, criado_em desc);
alter table public.notificacoes enable row level security;
create policy notificacoes_ver on public.notificacoes for select to authenticated using (user_id = (select auth.uid()));
create policy notificacoes_ler on public.notificacoes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy notificacoes_apagar on public.notificacoes for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.notificacoes from anon;
alter publication supabase_realtime add table public.notificacoes;

-- pede o envio por e-mail (a função "notificar" lê o que falta e marca como enviado)
create or replace function privado.pedir_email_notificacoes() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(url := 'https://SEU_PROJETO.supabase.co/functions/v1/notificar',
    body := jsonb_build_object('tipo', 'notificacoes'), headers := jsonb_build_object('Content-Type', 'application/json'));
exception when others then null;
end $$;

create or replace function public.notificar_mencoes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.notificacoes (user_id, tipo, titulo, texto, tarefa_id, autor)
  select distinct m.user_id, 'mencao', coalesce(new.autor, 'Alguém') || ' mencionou você', left(new.texto, 300), new.tarefa_id, new.autor
  from unnest(new.mencoes) u(id) join public.membros m on m.user_id = u.id
  where m.status = 'aprovado' and m.user_id <> new.autor_id;
  get diagnostics n = row_count;
  if n > 0 then perform privado.pedir_email_notificacoes(); end if;
  return new;
end $$;
revoke all on function public.notificar_mencoes() from public, anon, authenticated;
create trigger comentarios_mencoes after insert on public.comentarios for each row execute function public.notificar_mencoes();

create or replace function public.notificar_participantes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  insert into public.notificacoes (user_id, tipo, titulo, texto, evento_id, autor)
  select distinct m.user_id, 'evento', 'Convite: ' || new.titulo,
         to_char(new.inicio at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI') || coalesce(' · ' || new.local, ''), new.id, new.autor
  from unnest(new.participantes) u(id) join public.membros m on m.user_id = u.id
  where m.status = 'aprovado' and m.user_id <> new.autor_id
    and (tg_op = 'INSERT' or not (u.id = any (old.participantes)));
  get diagnostics n = row_count;
  if n > 0 then perform privado.pedir_email_notificacoes(); end if;
  return new;
end $$;
revoke all on function public.notificar_participantes() from public, anon, authenticated;
create trigger eventos_participantes after insert or update of participantes on public.eventos for each row execute function public.notificar_participantes();

create or replace function public.notificar_aprovacao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'aprovado' and old.status is distinct from 'aprovado' then
    insert into public.notificacoes (user_id, tipo, titulo, texto, autor)
    values (new.user_id, 'aprovacao', 'Seu acesso foi aprovado', 'Bem-vindo ao TRIPRO. Veja as dicas no menu Ajuda.', new.aprovado_por);
  end if;
  return new;
end $$;
revoke all on function public.notificar_aprovacao() from public, anon, authenticated;
create trigger membros_aprovacao after update of status on public.membros for each row execute function public.notificar_aprovacao();

-- 5. Resumo do dia também por projeto ('' = resumo geral de todos os projetos)
alter table public.resumos add column projeto_id text not null default '';
alter table public.resumos drop constraint resumos_pkey;
alter table public.resumos add primary key (dia, projeto_id);
