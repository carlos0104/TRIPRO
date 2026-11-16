-- Login por e-mail e senha: só vale acesso com e-mail confirmado
-- (impede que alguém crie conta com o e-mail de outra pessoa e herde o acesso dela)
create or replace function privado.eh_aprovado() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m join auth.users u on u.id = m.user_id
                 where m.user_id = auth.uid() and m.status = 'aprovado' and u.email_confirmed_at is not null);
$$;
create or replace function privado.eh_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m join auth.users u on u.id = m.user_id
                 where m.user_id = auth.uid() and m.status = 'aprovado' and m.papel = 'admin' and u.email_confirmed_at is not null);
$$;
