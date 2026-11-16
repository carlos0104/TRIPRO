-- Atualização em tempo real no painel (respeita o RLS)
alter publication supabase_realtime add table public.tarefas, public.avancos, public.comentarios, public.membros;
