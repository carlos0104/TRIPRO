create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Ao lançar 100% em uma entrega, pede o envio do e-mail de conclusão
create or replace function public.avisar_conclusao() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.percentual = 100 and new.notificado_em is null then
    perform net.http_post(
      url := 'https://SEU_PROJETO.supabase.co/functions/v1/notificar',
      body := jsonb_build_object('tipo', 'conclusao'),
      headers := jsonb_build_object('Content-Type', 'application/json'));
  end if;
  return new;
end $$;
revoke all on function public.avisar_conclusao() from public, anon, authenticated;
create trigger avancos_conclusao after insert on public.avancos
  for each row execute function public.avisar_conclusao();

-- Resumo diário às 07:30 de Brasília (10:30 UTC)
select cron.schedule('tripro-resumo-diario', '30 10 * * *', $$
  select net.http_post(
    url := 'https://SEU_PROJETO.supabase.co/functions/v1/notificar',
    body := jsonb_build_object('tipo', 'resumo'),
    headers := jsonb_build_object('Content-Type', 'application/json'));
$$);
