-- Resumo do dia (escrito pela IA quando houver chave GEMINI_API_KEY; senão, por regras fixas)
create table public.resumos (
  dia        date primary key,
  texto      text not null,
  fonte      text not null default 'regras' check (fonte in ('ia','regras')),
  criado_em  timestamptz not null default now()
);
alter table public.resumos enable row level security;
create policy resumos_ler on public.resumos for select to authenticated using ((select privado.eh_aprovado()));
revoke all on public.resumos from anon;
alter publication supabase_realtime add table public.resumos;

-- dados do calendário iCal: só a função "agenda" (service_role) chama, com o token secreto de um aprovado
create or replace function public.agenda_por_token(t uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when exists (
    select 1 from privado.tokens_agenda k join public.membros m on m.user_id = k.user_id
    where k.token = t and m.status = 'aprovado')
  then jsonb_build_object(
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'titulo', e.titulo, 'inicio', e.inicio, 'fim', e.fim, 'dia_inteiro', e.dia_inteiro, 'local', e.local, 'descricao', e.descricao, 'projeto', p.nome)) from public.eventos e left join public.projetos p on p.id = e.projeto_id where e.inicio > now() - interval '120 days'), '[]'::jsonb),
    'prazos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'entrega', x.entrega, 'fim', x.fim_previsto, 'responsavel', x.responsavel, 'projeto', p.nome, 'estado', x.estado)) from public.tarefas x join public.projetos p on p.id = x.projeto_id where x.fim_previsto > current_date - 120), '[]'::jsonb),
    'sprints', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'inicio', s.inicio, 'fim', s.fim, 'objetivo', s.objetivo)) from public.sprints s where s.fim > current_date - 120), '[]'::jsonb))
  else null end;
$$;
revoke all on function public.agenda_por_token(uuid) from public, anon, authenticated;
grant execute on function public.agenda_por_token(uuid) to service_role;

-- Resumo com IA às 07:15 de Brasília (10:15 UTC), antes do e-mail das 07:30
select cron.schedule('tripro-resumo-ia', '15 10 * * *', $$
  select net.http_post(
    url := 'https://SEU_PROJETO.supabase.co/functions/v1/notificar',
    body := jsonb_build_object('tipo', 'resumo_ia'),
    headers := jsonb_build_object('Content-Type', 'application/json'));
$$);
