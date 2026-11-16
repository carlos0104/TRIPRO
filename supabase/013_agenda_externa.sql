-- TriPro · trazer a agenda pessoal (Google ou Outlook.com) para dentro do TriPro
-- O link secreto (.ics) fica só no servidor: a tela nunca recebe o endereço de volta.

create table privado.agendas_externas (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  url            text not null check (url ~ '^https://'),
  provedor       text not null default 'outro',
  mostrar_equipe boolean not null default false,
  ultima_sync    timestamptz,
  erro           text,
  total          int not null default 0,
  criado_em      timestamptz not null default now()
);

create table public.eventos_externos (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  uid         text not null,
  titulo      text not null,
  local       text,
  dia_inteiro boolean not null default false,
  inicio      text not null,  -- ISO (data para dia inteiro, data-hora UTC para o resto)
  fim         text not null,
  unique (user_id, uid)
);
create index eventos_externos_user on public.eventos_externos (user_id, inicio);
alter table public.eventos_externos enable row level security;
create policy externos_meus on public.eventos_externos for select to authenticated using (user_id = (select auth.uid()) and (select privado.eh_aprovado()));
revoke all on public.eventos_externos from anon;

-- Conectar, desconectar e ver o estado (sem devolver o link)
create or replace function public.definir_agenda_externa(endereco text, equipe boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare u text := trim(regexp_replace(endereco, '^webcals?://', 'https://'));
begin
  if not privado.eh_aprovado() then raise exception 'sem acesso'; end if;
  if u !~* '^https://(calendar\.google\.com|outlook\.live\.com|outlook\.office365\.com|outlook\.office\.com|p[0-9]+-caldav\.icloud\.com)/' then
    raise exception 'Use o link .ics do Google Agenda ou do Outlook.com (Hotmail).';
  end if;
  insert into privado.agendas_externas (user_id, url, provedor, mostrar_equipe)
  values (auth.uid(), u, case when u ~* 'google' then 'google' when u ~* 'outlook' then 'outlook' else 'icloud' end, coalesce(equipe, false))
  on conflict (user_id) do update set url = excluded.url, provedor = excluded.provedor, mostrar_equipe = excluded.mostrar_equipe, ultima_sync = null, erro = null;
end $$;

create or replace function public.equipe_agenda_externa(equipe boolean) returns void
language sql security definer set search_path = '' as $$
  update privado.agendas_externas set mostrar_equipe = equipe where user_id = auth.uid();
$$;

create or replace function public.remover_agenda_externa() returns void
language sql security definer set search_path = '' as $$
  delete from public.eventos_externos where user_id = auth.uid();
  delete from privado.agendas_externas where user_id = auth.uid();
$$;

create or replace function public.minha_agenda_externa() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('provedor', provedor, 'mostrar_equipe', mostrar_equipe, 'ultima_sync', ultima_sync, 'erro', erro, 'total', total)
  from privado.agendas_externas where user_id = auth.uid();
$$;

-- Equipe vê só "Ocupado" (sem título nem local) de quem escolheu compartilhar
create or replace function public.ocupados_equipe(de text, ate text) returns table (user_id uuid, nome text, inicio text, fim text, dia_inteiro boolean)
language sql stable security definer set search_path = '' as $$
  select e.user_id, coalesce(m.nome, m.email), e.inicio, e.fim, e.dia_inteiro
  from public.eventos_externos e
  join privado.agendas_externas a on a.user_id = e.user_id and a.mostrar_equipe
  join public.membros m on m.user_id = e.user_id
  where privado.eh_aprovado() and e.user_id <> auth.uid() and e.inicio <= ate and e.fim >= de;
$$;

revoke all on function public.definir_agenda_externa(text, boolean), public.equipe_agenda_externa(boolean), public.remover_agenda_externa(), public.minha_agenda_externa(), public.ocupados_equipe(text, text) from public, anon;
grant execute on function public.definir_agenda_externa(text, boolean), public.equipe_agenda_externa(boolean), public.remover_agenda_externa(), public.minha_agenda_externa(), public.ocupados_equipe(text, text) to authenticated;

-- Para a função de sincronização (service_role)
create or replace function public.agendas_para_sincronizar(so uuid default null) returns table (user_id uuid, url text)
language sql stable security definer set search_path = '' as $$
  select user_id, url from privado.agendas_externas
  where (so is null or user_id = so) and (so is not null or ultima_sync is null or ultima_sync < now() - interval '10 minutes');
$$;
create or replace function public.gravar_sincronizacao(u uuid, eventos jsonb, falha text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if falha is not null then
    update privado.agendas_externas set erro = left(falha, 300), ultima_sync = now() where user_id = u; return;
  end if;
  delete from public.eventos_externos where user_id = u;
  insert into public.eventos_externos (user_id, uid, titulo, local, dia_inteiro, inicio, fim)
  select u, x->>'uid', x->>'titulo', x->>'local', coalesce((x->>'dia_inteiro')::boolean, false), x->>'inicio', x->>'fim'
  from jsonb_array_elements(eventos) x on conflict do nothing;
  update privado.agendas_externas set erro = null, ultima_sync = now(), total = jsonb_array_length(eventos) where user_id = u;
end $$;
revoke all on function public.agendas_para_sincronizar(uuid), public.gravar_sincronizacao(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.agendas_para_sincronizar(uuid), public.gravar_sincronizacao(uuid, jsonb, text) to service_role;

-- A cada 15 minutos
select cron.schedule('tripro-agenda-externa', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://SEU_PROJETO.supabase.co/functions/v1/agenda-externa',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json'));
$$);
