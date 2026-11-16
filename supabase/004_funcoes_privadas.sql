-- Funções de permissão fora do schema exposto pela API (não viram /rpc)
create schema if not exists privado;
grant usage on schema privado to authenticated;
alter function public.eh_aprovado() set schema privado;
alter function public.eh_admin() set schema privado;
