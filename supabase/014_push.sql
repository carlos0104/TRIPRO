-- TriPro · notificações no celular (Web Push) e número no ícone do app
-- As chaves VAPID são criadas pela própria função "push" na primeira vez e ficam só no banco (schema privado).

create table privado.push_config (
  id        int primary key default 1 check (id = 1),
  publica   text not null,
  privada   text not null,
  criado_em timestamptz not null default now()
);

create table public.push_inscricoes (
  id        bigint generated always as identity primary key,
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint  text not null unique,
  p256dh    text not null,
  auth      text not null,
  aparelho  text,
  criado_em timestamptz not null default now()
);
alter table public.push_inscricoes enable row level security;
create policy push_ler on public.push_inscricoes for select to authenticated using (user_id = (select auth.uid()));
create policy push_criar on public.push_inscricoes for insert to authenticated with check (user_id = (select auth.uid()) and (select privado.eh_aprovado()));
create policy push_mudar on public.push_inscricoes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_apagar on public.push_inscricoes for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.push_inscricoes from anon;

alter table public.notificacoes add column push_em timestamptz;

-- usadas só pela função "push" (service_role)
create or replace function public.push_chaves(nova_publica text default null, nova_privada text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if nova_publica is not null then
    insert into privado.push_config (id, publica, privada) values (1, nova_publica, nova_privada) on conflict (id) do nothing;
  end if;
  return (select jsonb_build_object('publica', publica, 'privada', privada) from privado.push_config where id = 1);
end $$;

create or replace function public.push_pendente(nid bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n public.notificacoes; r jsonb;
begin
  update public.notificacoes set push_em = now()
   where id = nid and push_em is null and criado_em > now() - interval '10 minutes'
  returning * into n;
  if n.id is null then return null; end if;
  select jsonb_build_object(
    'notificacao', jsonb_build_object('id', n.id, 'tipo', n.tipo, 'titulo', n.titulo, 'texto', n.texto, 'tarefa_id', n.tarefa_id, 'evento_id', n.evento_id),
    'nao_lidas', (select count(*) from public.notificacoes where user_id = n.user_id and not lida),
    'inscricoes', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)) from public.push_inscricoes where user_id = n.user_id), '[]'::jsonb))
  into r;
  return r;
end $$;

create or replace function public.push_do_usuario(u uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('nao_lidas', (select count(*) from public.notificacoes where user_id = u and not lida),
    'inscricoes', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth)) from public.push_inscricoes where user_id = u), '[]'::jsonb));
$$;

create or replace function public.push_remover(ep text) returns void
language sql security definer set search_path = '' as $$ delete from public.push_inscricoes where endpoint = ep; $$;

revoke all on function public.push_chaves(text, text), public.push_pendente(bigint), public.push_do_usuario(uuid), public.push_remover(text) from public, anon, authenticated;
grant execute on function public.push_chaves(text, text), public.push_pendente(bigint), public.push_do_usuario(uuid), public.push_remover(text) to service_role;

-- cada notificação nova dispara o envio para os aparelhos da pessoa
create or replace function public.notificacao_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(url := 'https://SEU_PROJETO.supabase.co/functions/v1/push',
    body := jsonb_build_object('tipo', 'notificacao', 'id', new.id), headers := jsonb_build_object('Content-Type', 'application/json'));
  return new;
exception when others then return new;
end $$;
revoke all on function public.notificacao_push() from public, anon, authenticated;
create trigger notificacoes_push after insert on public.notificacoes for each row execute function public.notificacao_push();
