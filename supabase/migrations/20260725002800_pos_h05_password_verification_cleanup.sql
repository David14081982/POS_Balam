-- POS Balam — H-05: limpieza de la identidad administrativa temporal.

do $$
declare
  v_email text := 'h05.bootstrap.20260725@gmail.com';
  v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids
    from auth.users where lower(email) = lower(v_email);

  delete from pos.sellers where lower(email) = lower(v_email);
  delete from auth.identities where user_id = any(v_ids);
  delete from auth.users where id = any(v_ids);

  if exists (select 1 from auth.users where lower(email) = lower(v_email))
     or exists (select 1 from pos.sellers where lower(email) = lower(v_email))
     or exists (
       select 1 from auth.users
        where lower(email) = 'h05.password.target.20260725@gmail.com'
     )
     or exists (
       select 1 from pos.sellers
        where lower(email) = 'h05.password.target.20260725@gmail.com'
     ) then
    raise exception 'H-05 dejó identidades o perfiles temporales';
  end if;
end;
$$;
