-- TRIPRO · quadro kanban, sprints, subtarefas, anexos e agenda

-- 1. Sprints (da equipe, valem para todos os projetos)
create table public.sprints (
  id         bigint generated always as identity primary key,
  nome       text not null check (length(trim(nome)) between 1 and 80),
  objetivo   text,
  inicio     date not null,
  fim        date not null,
  status     text not null default 'planejada' check (status in ('planejada','ativa','concluida')),
  criado_em  timestamptz not null default now(),
  constraint sprint_datas check (fim >= inicio)
);

-- 2. Campos novos na entrega (tarefa)
alter table public.tarefas
  add column sprint_id  bigint references public.sprints(id) on delete set null,
  add column estado     text not null default 'a_fazer' check (estado in ('a_fazer','fazendo','revisao','concluida')),
  add column prioridade text not null default 'media' check (prioridade in ('baixa','media','alta','urgente')),
  add column descricao  text check (descricao is null or length(descricao) <= 5000);
create index tarefas_sprint on public.tarefas (sprint_id);

-- entregas já concluídas ou iniciadas entram na coluna certa
update public.tarefas t set estado = case when u.p >= 100 then 'concluida' when u.p > 0 then 'fazendo' else 'a_fazer' end
from (select distinct on (tarefa_id) tarefa_id, percentual p from public.avancos order by tarefa_id, data desc, id desc) u
where u.tarefa_id = t.id;

-- avanço de 100% move para Concluída; avanço menor tira de Concluída
create or replace function public.estado_pelo_avanco() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.percentual >= 100 then
    update public.tarefas set estado = 'concluida' where id = new.tarefa_id and estado <> 'concluida';
  else
    update public.tarefas set estado = 'fazendo' where id = new.tarefa_id and estado in ('concluida','a_fazer') and new.percentual > 0;
  end if;
  return new;
end $$;
revoke all on function public.estado_pelo_avanco() from public, anon, authenticated;
create trigger avancos_estado after insert on public.avancos for each row execute function public.estado_pelo_avanco();

-- 3. Subtarefas (checklist da entrega)
create table public.subtarefas (
  id         bigint generated always as identity primary key,
  tarefa_id  text not null references public.tarefas(id) on delete cascade,
  titulo     text not null check (length(trim(titulo)) between 1 and 200),
  feito      boolean not null default false,
  ordem      int not null default 0,
  criado_em  timestamptz not null default now()
);
create index subtarefas_tarefa on public.subtarefas (tarefa_id, ordem);

-- 4. Anexos (arquivo no Storage privado "anexos")
create table public.anexos (
  id         bigint generated always as identity primary key,
  tarefa_id  text not null references public.tarefas(id) on delete cascade,
  nome       text not null,
  caminho    text not null unique,
  tipo       text,
  tamanho    bigint,
  autor_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  autor      text default (auth.jwt() ->> 'email'),
  criado_em  timestamptz not null default now()
);
create index anexos_tarefa on public.anexos (tarefa_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('anexos', 'anexos', false, 10485760,
        array['image/png','image/jpeg','image/webp','image/gif','application/pdf'])
on conflict (id) do nothing;

create policy anexos_arquivo_ler on storage.objects for select to authenticated
  using (bucket_id = 'anexos' and (select privado.eh_aprovado()));
create policy anexos_arquivo_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'anexos' and (select privado.eh_aprovado()));
create policy anexos_arquivo_excluir on storage.objects for delete to authenticated
  using (bucket_id = 'anexos' and (owner_id = (select auth.uid())::text or (select privado.eh_admin())));

-- 5. Agenda
create table public.eventos (
  id          bigint generated always as identity primary key,
  titulo      text not null check (length(trim(titulo)) between 1 and 160),
  inicio      timestamptz not null,
  fim         timestamptz not null,
  dia_inteiro boolean not null default false,
  local       text,
  descricao   text check (descricao is null or length(descricao) <= 2000),
  projeto_id  text references public.projetos(id) on delete set null,
  tarefa_id   text references public.tarefas(id) on delete set null,
  autor_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  autor       text default (auth.jwt() ->> 'email'),
  criado_em   timestamptz not null default now(),
  constraint evento_datas check (fim >= inicio)
);
create index eventos_inicio on public.eventos (inicio);

-- link secreto de assinatura da agenda (iCal), um por pessoa, fora da API
create table privado.tokens_agenda (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  token    uuid not null unique default gen_random_uuid(),
  criado_em timestamptz not null default now()
);
create or replace function public.meu_link_agenda(novo boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t uuid;
begin
  if not privado.eh_aprovado() then raise exception 'acesso não aprovado'; end if;
  if novo then delete from privado.tokens_agenda where user_id = auth.uid(); end if;
  insert into privado.tokens_agenda (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  select token into t from privado.tokens_agenda where user_id = auth.uid();
  return t;
end $$;
revoke all on function public.meu_link_agenda(boolean) from public, anon;
grant execute on function public.meu_link_agenda(boolean) to authenticated;

-- 6. Autor sempre é quem está logado
create or replace function public.definir_dono() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null then new.autor_id := auth.uid(); new.autor := auth.jwt() ->> 'email'; end if;
  return new;
end $$;
create trigger anexos_dono before insert on public.anexos for each row execute function public.definir_dono();
create trigger eventos_dono before insert on public.eventos for each row execute function public.definir_dono();

-- 7. RLS: aprovados leem e criam; admin (ou o autor) exclui
alter table public.sprints enable row level security;
alter table public.subtarefas enable row level security;
alter table public.anexos enable row level security;
alter table public.eventos enable row level security;

create policy sprints_ler on public.sprints for select to authenticated using ((select privado.eh_aprovado()));
create policy sprints_criar on public.sprints for insert to authenticated with check ((select privado.eh_aprovado()));
create policy sprints_alterar on public.sprints for update to authenticated using ((select privado.eh_aprovado())) with check ((select privado.eh_aprovado()));
create policy sprints_excluir on public.sprints for delete to authenticated using ((select privado.eh_admin()));

create policy subtarefas_ler on public.subtarefas for select to authenticated using ((select privado.eh_aprovado()));
create policy subtarefas_criar on public.subtarefas for insert to authenticated with check ((select privado.eh_aprovado()));
create policy subtarefas_alterar on public.subtarefas for update to authenticated using ((select privado.eh_aprovado())) with check ((select privado.eh_aprovado()));
create policy subtarefas_excluir on public.subtarefas for delete to authenticated using ((select privado.eh_aprovado()));

create policy anexos_ler on public.anexos for select to authenticated using ((select privado.eh_aprovado()));
create policy anexos_criar on public.anexos for insert to authenticated with check ((select privado.eh_aprovado()));
create policy anexos_excluir on public.anexos for delete to authenticated using (autor_id = (select auth.uid()) or (select privado.eh_admin()));

create policy eventos_ler on public.eventos for select to authenticated using ((select privado.eh_aprovado()));
create policy eventos_criar on public.eventos for insert to authenticated with check ((select privado.eh_aprovado()));
create policy eventos_alterar on public.eventos for update to authenticated using (autor_id = (select auth.uid()) or (select privado.eh_admin())) with check ((select privado.eh_aprovado()));
create policy eventos_excluir on public.eventos for delete to authenticated using (autor_id = (select auth.uid()) or (select privado.eh_admin()));

revoke all on public.sprints, public.subtarefas, public.anexos, public.eventos from anon;
alter publication supabase_realtime add table public.sprints, public.subtarefas, public.anexos, public.eventos;
