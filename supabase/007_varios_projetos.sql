-- TRIPRO acompanha vários projetos da Trium
create table public.projetos (
  id          text primary key,
  nome        text not null check (length(trim(nome)) between 1 and 80),
  descricao   text,
  status      text not null default 'ativo' check (status in ('ativo','pausado','concluido')),
  ordem       int not null default 0,
  criado_em   timestamptz not null default now()
);
insert into public.projetos (id, nome, descricao, ordem) values ('crm', 'CRM Trium', 'CRM com WhatsApp, Iara e funil de vendas', 1);

alter table public.tarefas add column projeto_id text references public.projetos(id) on delete cascade;
update public.tarefas set projeto_id = 'crm' where projeto_id is null;
alter table public.tarefas alter column projeto_id set not null;
create index tarefas_projeto on public.tarefas (projeto_id);

alter table public.projetos enable row level security;
create policy projetos_ler on public.projetos for select to authenticated using ((select privado.eh_aprovado()));
create policy projetos_criar on public.projetos for insert to authenticated with check ((select privado.eh_admin()));
create policy projetos_alterar on public.projetos for update to authenticated using ((select privado.eh_admin())) with check ((select privado.eh_admin()));
create policy projetos_excluir on public.projetos for delete to authenticated using ((select privado.eh_admin()));
revoke all on public.projetos from anon;
alter publication supabase_realtime add table public.projetos;
