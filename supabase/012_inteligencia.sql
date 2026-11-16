-- TRIPRO · dependências, bloqueios, horas e custo, decisões, commits do GitHub e relatório para o cliente

-- 1. Dependências entre tarefas (B depende de A)
create table public.dependencias (
  tarefa_id  text not null references public.tarefas(id) on delete cascade,
  depende_de text not null references public.tarefas(id) on delete cascade,
  criado_em  timestamptz not null default now(),
  primary key (tarefa_id, depende_de),
  check (tarefa_id <> depende_de)
);
alter table public.dependencias enable row level security;
create policy dependencias_ler on public.dependencias for select to authenticated using ((select privado.eh_aprovado()));
create policy dependencias_criar on public.dependencias for insert to authenticated with check ((select privado.eh_aprovado()));
create policy dependencias_excluir on public.dependencias for delete to authenticated using ((select privado.eh_aprovado()));

-- 2. Bloqueio da tarefa (marcado pelos comentários ou à mão)
alter table public.tarefas
  add column bloqueio text,
  add column bloqueado_por text,
  add column bloqueado_em timestamptz;

-- 3. Horas gastas no avanço (opcional, para o custo real)
alter table public.avancos add column horas numeric(7,2) check (horas is null or horas >= 0);

-- 4. Valor da hora por responsável (só administradores veem)
create table public.custos_pessoa (
  nome          text primary key,
  valor_hora    numeric(10,2) not null check (valor_hora >= 0),
  atualizado_em timestamptz not null default now()
);
alter table public.custos_pessoa enable row level security;
create policy custos_admin on public.custos_pessoa for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));

-- 5. Registro de decisões
create table public.decisoes (
  id         bigint generated always as identity primary key,
  projeto_id text references public.projetos(id) on delete cascade,
  tarefa_id  text references public.tarefas(id) on delete set null,
  texto      text not null check (length(trim(texto)) between 1 and 1000),
  origem     text not null default 'manual' check (origem in ('manual','comentario','ata')),
  autor      text default (auth.jwt() ->> 'email'),
  autor_id   uuid default auth.uid() references auth.users(id) on delete set null,
  data       date not null default current_date,
  criado_em  timestamptz not null default now()
);
create index decisoes_projeto on public.decisoes (projeto_id, data desc);
alter table public.decisoes enable row level security;
create policy decisoes_ler on public.decisoes for select to authenticated using ((select privado.eh_aprovado()));
create policy decisoes_criar on public.decisoes for insert to authenticated with check ((select privado.eh_aprovado()));
create policy decisoes_excluir on public.decisoes for delete to authenticated using (autor_id = (select auth.uid()) or (select privado.eh_admin()));

-- 6. Commits e pull requests do GitHub ligados às tarefas (gravados só pela função "github")
create table public.commits (
  id        bigint generated always as identity primary key,
  tarefa_id text not null references public.tarefas(id) on delete cascade,
  tipo      text not null default 'commit' check (tipo in ('commit','pr')),
  repo      text, sha text, mensagem text, autor text, url text,
  data      timestamptz not null default now(),
  unique (tarefa_id, sha)
);
create index commits_tarefa on public.commits (tarefa_id, data desc);
alter table public.commits enable row level security;
create policy commits_ler on public.commits for select to authenticated using ((select privado.eh_aprovado()));

-- 7. Link de leitura para o cliente (um por projeto, revogável)
create table public.links_publicos (
  token      uuid primary key default gen_random_uuid(),
  projeto_id text not null references public.projetos(id) on delete cascade,
  ativo      boolean not null default true,
  criado_por text default (auth.jwt() ->> 'email'),
  criado_em  timestamptz not null default now()
);
alter table public.links_publicos enable row level security;
create policy links_admin on public.links_publicos for all to authenticated
  using ((select privado.eh_admin())) with check ((select privado.eh_admin()));

create or replace function public.relatorio_publico(t uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'projeto', jsonb_build_object('nome', p.nome, 'descricao', p.descricao, 'status', p.status),
    'tarefas', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'entrega', x.entrega, 'modulo', x.modulo, 'peso', x.peso, 'inicio', x.inicio_previsto, 'fim', x.fim_previsto, 'estado', x.estado)) from public.tarefas x where x.projeto_id = p.id), '[]'::jsonb),
    'avancos', coalesce((select jsonb_agg(jsonb_build_object('tarefa_id', v.tarefa_id, 'data', v.data, 'percentual', v.percentual) order by v.data, v.id) from public.avancos v join public.tarefas x on x.id = v.tarefa_id where x.projeto_id = p.id), '[]'::jsonb),
    'gerado_em', now())
  from public.links_publicos l join public.projetos p on p.id = l.projeto_id
  where l.token = t and l.ativo;
$$;
revoke all on function public.relatorio_publico(uuid) from public, anon, authenticated;
grant execute on function public.relatorio_publico(uuid) to service_role;

-- 8. Comentário que fala de bloqueio marca a tarefa; o que fala de decisão vira registro
create or replace function public.analisar_comentario() returns trigger
language plpgsql security definer set search_path = '' as $$
declare txt text := lower(new.texto); pj text;
begin
  if txt ~ '(desbloque|destrav|liberad[oa]|resolvid[oa]|j[aá] tenho acesso)' then
    update public.tarefas set bloqueio = null, bloqueado_por = null, bloqueado_em = null where id = new.tarefa_id and bloqueio is not null;
  elsif txt ~ '(travad[oa]|bloquead[oa]|impedid[oa]|aguardando|esperando|sem acesso|parad[oa] por|depende d[oae])' then
    update public.tarefas set bloqueio = left(new.texto, 200), bloqueado_por = new.autor, bloqueado_em = now() where id = new.tarefa_id;
  end if;
  if txt ~ '(decidimos|decidid[oa]|ficou definid[oa]|ficou acertad[oa]|vamos seguir com|fica combinad[oa]|aprovad[oa] pel[oa])' then
    select projeto_id into pj from public.tarefas where id = new.tarefa_id;
    insert into public.decisoes (projeto_id, tarefa_id, texto, origem, autor, autor_id)
    values (pj, new.tarefa_id, left(new.texto, 1000), 'comentario', new.autor, new.autor_id);
  end if;
  return new;
end $$;
revoke all on function public.analisar_comentario() from public, anon, authenticated;
create trigger comentarios_analise after insert on public.comentarios for each row execute function public.analisar_comentario();

revoke all on public.dependencias, public.custos_pessoa, public.decisoes, public.commits, public.links_publicos from anon;
alter publication supabase_realtime add table public.dependencias, public.decisoes, public.commits;
