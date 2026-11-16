-- E-mails que entram já aprovados como administradores no primeiro login.
-- Troque SEU_EMAIL pelo e-mail da conta Google do administrador (não suba o e-mail real em repositório público).
create table privado.admins_iniciais (email text primary key);
insert into privado.admins_iniciais (email) values ('SEU_EMAIL');

create or replace function public.novo_membro() returns trigger
language plpgsql security definer set search_path = '' as $$
declare adm boolean;
begin
  select exists (select 1 from privado.admins_iniciais a where a.email = lower(new.email)) into adm;
  insert into public.membros (user_id, email, nome, foto, status, papel, aprovado_em, aprovado_por)
  values (new.id, lower(new.email),
          coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
          new.raw_user_meta_data ->> 'avatar_url',
          case when adm then 'aprovado' else 'pendente' end,
          case when adm then 'admin' else 'editor' end,
          case when adm then now() end,
          case when adm then 'configuração inicial' end)
  on conflict (user_id) do nothing;
  return new;
end $$;
revoke all on function public.novo_membro() from public, anon, authenticated;
