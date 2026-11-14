-- H192 single server correspondence, derived from docs/05 and current screens.
-- Included verbatim by the migration generator and isolated preview.
create function pos.screen_operational_capabilities()
returns table(screen_key text,capability_key text)
language sql immutable set search_path=pg_catalog as $$
 select * from (values
 ('pos','sales.create'),('pos','sales.collect'),
 ('pos','customers.create'),
 ('apartados','sales.collect'),
 ('clientes','customers.create'),('clientes','customers.update'),('clientes','customers.delete'),
 ('devoluciones','sales.refund'),('devoluciones','sales.exchange'),
 ('inventario','inventory.adjust'),('inventario','inventory.delete'),
 ('descuentos','promotions.manage'),
 ('vendedores','commissions.settle'),('vendedores','commissions.close_period'),
 ('prestamos','inventory.loan.deliver'),('prestamos','inventory.loan.return'),
 ('prestamos','inventory.loan.shortage'),('prestamos','inventory.loan.close'),
 ('prestamos','inventory.loan.edit'),('prestamos','inventory.loan.delete'),
 ('prestamos','inventory.loan.reopen')
 ) m(screen_key,capability_key);
$$;
revoke all on function pos.screen_operational_capabilities() from public,anon,authenticated;

-- Internal only: the checked editor and confirmed account creation own access.
create function pos.sync_user_screen_capabilities(p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,pos,auth as $$
declare profile_role text;
begin
 select s.role into profile_role from auth.users u join pos.sellers s on lower(s.email)=lower(u.email)
 where u.id=p_user_id order by (s.deleted_at is null) desc,s.updated_at desc limit 1;
 -- Preserve admin role rules and unrelated administrative capabilities.
 if profile_role is null then return; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,56));
 insert into pos.user_capability_overrides(user_id,capability_key,effect,updated_at,updated_by)
 select p_user_id,c.capability_key,
  case when exists(select 1 from pos.screen_operational_capabilities() m
   cross join lateral pos.resolve_screen_permission(p_user_id,m.screen_key) r
   where m.capability_key=c.capability_key and r.allowed) then 'allow' else 'deny' end,
  clock_timestamp(),auth.uid()
 from pos.operational_capabilities c where c.active
 and (profile_role<>'admin' or (
  exists(select 1 from pos.screen_operational_capabilities() m where m.capability_key=c.capability_key)
  and (exists(select 1 from pos.user_capability_overrides o where o.user_id=p_user_id and o.capability_key=c.capability_key)
   or not exists(select 1 from pos.screen_operational_capabilities() m
    cross join lateral pos.resolve_screen_permission(p_user_id,m.screen_key) r
    where m.capability_key=c.capability_key and r.allowed))))
 on conflict(user_id,capability_key) do update set effect=excluded.effect,
  updated_at=excluded.updated_at,updated_by=excluded.updated_by
 where user_capability_overrides.effect is distinct from excluded.effect;
end $$;
revoke all on function pos.sync_user_screen_capabilities(uuid) from public,anon,authenticated;
