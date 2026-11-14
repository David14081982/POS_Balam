-- H192: apply only after owner approves the per-account preview.
begin;
do $pre$ begin
 perform pg_advisory_xact_lock(hashtextextended('pos.online.commercial',164));
 -- H192_OWNER_PREVIEW: any account/catalog/override drift requires a new preview.
 if (md5(jsonb_build_array(
  (select jsonb_agg(to_jsonb(a) order by user_id) from pos.user_permission_role_assignments a),
  (select jsonb_agg(to_jsonb(a) order by user_id,screen_key) from pos.user_screen_permission_overrides a),
  (select jsonb_agg(to_jsonb(a) order by user_id,capability_key) from pos.user_capability_overrides a),
  (select jsonb_agg(to_jsonb(a) order by role_code,screen_key) from pos.role_screen_permissions a),
  (select jsonb_agg(to_jsonb(a) order by role_code,capability_key) from pos.role_capability_permissions a),
  (select jsonb_agg(jsonb_build_array(id,email) order by id) from auth.users),
  (select jsonb_agg(jsonb_build_array(id,email,role,active,deleted_at) order by id) from pos.sellers),
  (select jsonb_agg(to_jsonb(a) order by screen_key) from pos.screen_permission_catalog a),
  (select jsonb_agg(to_jsonb(a) order by code) from pos.permission_roles a)
 )::text)) is distinct from '5ae17dd8a53790a985c472a3761f0534' then raise exception 'H192_PREVIEW_STALE'; end if;
 if md5(replace(pg_get_functiondef('pos.admin_apply_user_screen_permissions(uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n')) <> 'd20badf3d5ff7d221c9b2902fc3618b1' then raise exception 'H192_BASELINE_DRIFT: pos.admin_apply_user_screen_permissions(uuid,text,jsonb)'; end if;
 if md5(replace(pg_get_functiondef('pos.online_save_entities(text,jsonb)'::regprocedure),E'\r\n',E'\n')) <> 'e012af5b9daf0648b178e853f2fd29df' then raise exception 'H192_BASELINE_DRIFT: pos.online_save_entities(text,jsonb)'; end if;
 if md5(replace(pg_get_functiondef('pos.resolve_operational_capability(uuid,text)'::regprocedure),E'\r\n',E'\n')) <> 'fe7369338378465277367df77441e663' then raise exception 'H192_BASELINE_DRIFT: pos.resolve_operational_capability(uuid,text)'; end if;
 if md5(replace(pg_get_functiondef('pos.user_screen_permissions_version(uuid)'::regprocedure),E'\r\n',E'\n')) <> '764b80a6a001254b4007bdc52e3122a6' then raise exception 'H192_BASELINE_DRIFT: pos.user_screen_permissions_version(uuid)'; end if;
 if md5(replace(pg_get_functiondef('pos.dispatch_online_command(uuid,jsonb,integer)'::regprocedure),E'\r\n',E'\n')) <> '34bf63837dbf48d856e98ba430415bab' then raise exception 'H192_BASELINE_DRIFT: pos.dispatch_online_command(uuid,jsonb,integer)'; end if;
 if md5(replace(pg_get_functiondef('pos.restrict_seller_product_update()'::regprocedure),E'\r\n',E'\n')) <> 'd250cdd879860bf1cb3014b5b38b1310' then raise exception 'H192_BASELINE_DRIFT: pos.restrict_seller_product_update()'; end if;
end $pre$;
create temp table h192_preservation on commit drop as
select 'products'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.products t
union all
select 'clients'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.clients t
union all
select 'sellers'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.sellers t
union all
select 'promotions'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.promotions t
union all
select 'sales'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.sales t
union all
select 'sale_items'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.sale_items t
union all
select 'sale_payments'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.sale_payments t
union all
select 'returns'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.returns t
union all
select 'return_items'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.return_items t
union all
select 'exchanges'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.exchanges t
union all
select 'exchange_items'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.exchange_items t
union all
select 'loan_documents'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.loan_documents t
union all
select 'movements'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.movements t
union all
select 'liquidations'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.liquidations t
union all
select 'commission_adjustments'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.commission_adjustments t
union all
select 'lookup'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.lookup t
union all
select 'settings'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.settings t
union all
select 'config_sync_state'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.config_sync_state t
union all
select 'user_permission_role_assignments'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.user_permission_role_assignments t
union all
select 'user_screen_permission_overrides'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.user_screen_permission_overrides t
union all
select 'role_capability_permissions'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.role_capability_permissions t
union all
select 'role_screen_permissions'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.role_screen_permissions t
union all
select 'permission_roles'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.permission_roles t;
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

CREATE OR REPLACE FUNCTION pos.admin_apply_user_screen_permissions(p_target_user_id uuid, p_role_code text, p_overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pos', 'auth', 'pg_temp'
AS $function$
declare
  v_actor uuid := auth.uid();
  v_batch uuid := extensions.gen_random_uuid();
  v_old_role text;
  v_key text;
  v_value jsonb;
  v_effect text;
  v_old_effect text;
begin
  if not pos.can_manage_screen_permissions(v_actor) then
    raise exception 'No autorizado para modificar permisos'
      using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'La identidad Auth objetivo no existe'
      using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_overrides, '{}'::jsonb)) <> 'object' then
    raise exception 'Los overrides deben ser un objeto JSON'
      using errcode = '22023';
  end if;

  select a.role_code into v_old_role
  from pos.user_permission_role_assignments a
  where a.user_id = p_target_user_id;

  if p_role_code is null then
    delete from pos.user_permission_role_assignments
    where user_id = p_target_user_id;
  else
    if not exists (
      select 1 from pos.permission_roles r
      where r.code = p_role_code and r.active
    ) then
      raise exception 'Rol base inexistente o inactivo: %', p_role_code
        using errcode = '22023';
    end if;
    insert into pos.user_permission_role_assignments (
      user_id, role_code, updated_at, updated_by
    ) values (
      p_target_user_id, p_role_code, now(), v_actor
    )
    on conflict (user_id) do update set
      role_code = excluded.role_code,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by;
  end if;

  if v_old_role is distinct from p_role_code then
    insert into pos.permission_change_audit (
      batch_id, actor_user_id, target_user_id, change_kind,
      old_value, new_value
    ) values (
      v_batch, v_actor, p_target_user_id, 'user_role',
      to_jsonb(v_old_role), to_jsonb(p_role_code)
    );
  end if;

  for v_key, v_value in
    select e.key, e.value from jsonb_each(coalesce(p_overrides, '{}'::jsonb)) e
  loop
    if nullif(trim(v_key), '') is null then
      raise exception 'La clave de pantalla no puede estar vacía'
        using errcode = '22023';
    end if;

    select o.effect into v_old_effect
    from pos.user_screen_permission_overrides o
    where o.user_id = p_target_user_id and o.screen_key = v_key;

    if jsonb_typeof(v_value) = 'null' then
      v_effect := null;
      delete from pos.user_screen_permission_overrides
      where user_id = p_target_user_id and screen_key = v_key;
    else
      v_effect := trim(both '"' from v_value::text);
      if v_effect not in ('allow', 'deny') then
        raise exception 'Override inválido para %: %', v_key, v_effect
          using errcode = '22023';
      end if;
      insert into pos.user_screen_permission_overrides (
        user_id, screen_key, effect, updated_at, updated_by
      ) values (
        p_target_user_id, v_key, v_effect, now(), v_actor
      )
      on conflict (user_id, screen_key) do update set
        effect = excluded.effect,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;
    end if;

    if v_old_effect is distinct from v_effect then
      insert into pos.permission_change_audit (
        batch_id, actor_user_id, target_user_id, screen_key,
        change_kind, old_value, new_value
      ) values (
        v_batch, v_actor, p_target_user_id, v_key,
        'user_override', to_jsonb(v_old_effect), to_jsonb(v_effect)
      );
    end if;
  end loop;

  perform pos.sync_user_screen_capabilities(p_target_user_id);
  perform pos.assert_permission_admin_survives();
  return v_batch;
end;
$function$
;
CREATE OR REPLACE FUNCTION pos.online_save_entities(p_kind text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos', 'auth'
AS $function$
declare r jsonb; saved jsonb; result jsonb:='[]'; exists_row boolean; old_profile jsonb;
begin
 perform pos.online_check_rows(p_kind,p_rows);
 if p_kind not in('clients','sellers','promotions') then raise exception 'INVALID_ENTITY_KIND'; end if;
 for r in select value from jsonb_array_elements(p_rows) order by value->>'id' loop
  if p_kind='clients' then
   select exists(select 1 from pos.clients where id=r->>'id') into exists_row;
   perform pos.require_current_capability(case when exists_row then 'customers.update' else 'customers.create' end);
   if exists_row then
    update pos.clients set nombre=r->>'nombre',tel=r->>'tel',email=r->>'email',direccion=r->>'direccion',
     talla=r->>'talla',notas=r->>'notas',nacimiento=nullif(r->>'nacimiento','')::date,
     generic=coalesce((r->>'generic')::boolean,false),sync_base_version=(r->>'sync_base_version')::bigint,
     sync_device_id=pos.assert_online_device() where id=r->>'id' returning to_jsonb(clients) into saved;
   else
    insert into pos.clients(id,nombre,tel,email,direccion,talla,notas,nacimiento,generic,sync_base_version,sync_device_id)
    values(r->>'id',r->>'nombre',r->>'tel',r->>'email',r->>'direccion',r->>'talla',r->>'notas',
     nullif(r->>'nacimiento','')::date,coalesce((r->>'generic')::boolean,false),0,pos.assert_online_device())
    returning to_jsonb(clients) into saved;
   end if;
  elsif p_kind='promotions' then
   perform pos.require_current_capability('promotions.manage');
   select exists(select 1 from pos.promotions where id=r->>'id') into exists_row;
   if exists_row then
    update pos.promotions set nombre=r->>'nombre',tipo=r->>'tipo',valor=(r->>'valor')::numeric,
     inicio=nullif(r->>'inicio','')::date,fin=nullif(r->>'fin','')::date,hora_inicio=r->>'hora_inicio',
     hora_fin=r->>'hora_fin',pausado=coalesce((r->>'pausado')::boolean,false),scope=coalesce(r->'scope','{}'),
     sync_base_version=(r->>'sync_base_version')::bigint,sync_device_id=pos.assert_online_device()
     where id=r->>'id' returning to_jsonb(promotions) into saved;
   else
    insert into pos.promotions(id,nombre,tipo,valor,inicio,fin,hora_inicio,hora_fin,pausado,scope,creado,sync_base_version,sync_device_id)
    values(r->>'id',r->>'nombre',coalesce(r->>'tipo','pct'),coalesce((r->>'valor')::numeric,0),
     nullif(r->>'inicio','')::date,nullif(r->>'fin','')::date,r->>'hora_inicio',r->>'hora_fin',
     coalesce((r->>'pausado')::boolean,false),coalesce(r->'scope','{}'),(r->>'creado')::bigint,0,pos.assert_online_device())
    returning to_jsonb(promotions) into saved;
   end if;
  else
   perform pos.require_current_capability('sellers.manage');
   if exists(select 1 from pos.online_account_requests ar where ar.target_user_id::text=r->>'id'
     and ar.state not in('completed','rejected','cancelled')
     and ar.request_id::text is distinct from current_setting('pos.online_account',true)) then
    raise exception 'ACCOUNT_TARGET_HAS_UNCONFIRMED_REQUEST' using errcode='40001'; end if;
   select to_jsonb(s) into old_profile from pos.sellers s where id=r->>'id';
   exists_row:=old_profile is not null;
   if exists_row then
    r:=old_profile||r;
    update pos.sellers set nombre=r->>'nombre',iniciales=r->>'iniciales',color=r->>'color',
     comision_pct=coalesce((r->>'comision_pct')::numeric,0),commission_override_pct=(r->>'commission_override_pct')::numeric,
     seller_level_code=r->>'seller_level_code',commission_policy_version=coalesce((r->>'commission_policy_version')::smallint,1),
     meta_mes=coalesce((r->>'meta_mes')::numeric,0),bono=r->>'bono',email=r->>'email',role=coalesce(r->>'role','vendedor'),
     avatar_url=r->>'avatar_url',active=coalesce((r->>'active')::boolean,true),
     sync_base_version=(r->>'sync_base_version')::bigint,sync_device_id=pos.assert_online_device()
     where id=r->>'id' returning to_jsonb(sellers)-'password_hash' into saved;
   else
    insert into pos.sellers(id,nombre,iniciales,color,comision_pct,commission_override_pct,seller_level_code,
     commission_policy_version,meta_mes,bono,email,role,avatar_url,active,sync_base_version,sync_device_id)
    values(r->>'id',r->>'nombre',r->>'iniciales',r->>'color',coalesce((r->>'comision_pct')::numeric,0),
     (r->>'commission_override_pct')::numeric,r->>'seller_level_code',coalesce((r->>'commission_policy_version')::smallint,1),
     coalesce((r->>'meta_mes')::numeric,0),r->>'bono',r->>'email',coalesce(r->>'role','vendedor'),r->>'avatar_url',
     coalesce((r->>'active')::boolean,true),0,pos.assert_online_device())
    returning to_jsonb(sellers)-'password_hash' into saved;
   end if;
   -- H191: only the newly confirmed Auth creation receives its initial role.
   -- Existing assignments (including inactive ones) and overrides are untouched.
   if not exists_row and exists (
    select 1 from pos.online_account_requests ar join auth.users u on u.id=ar.target_user_id
    where ar.actor_id=auth.uid() and ar.request_id::text=current_setting('pos.online_account',true)
     and ar.action='create' and ar.state='auth_confirmed'
     and u.id::text=saved->>'id' and lower(u.email)=lower(saved->>'email')
   ) then
    with assigned as (
     insert into pos.user_permission_role_assignments(user_id,role_code,active,updated_by)
     values((saved->>'id')::uuid,saved->>'role',true,auth.uid())
     on conflict(user_id) do nothing returning user_id,role_code
    )
    insert into pos.permission_change_audit(batch_id,actor_user_id,target_user_id,role_code,change_kind,old_value,new_value)
    select current_setting('pos.online_account',true)::uuid,auth.uid(),user_id,role_code,'user_role',null,to_jsonb(role_code) from assigned;
    if found then perform pos.sync_user_screen_capabilities((saved->>'id')::uuid); end if;
   end if;
  end if;
  if saved is null then raise exception 'ENTITY_CONFIRMATION_MISSING'; end if;
  result:=result||jsonb_build_array(saved);
 end loop;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION pos.resolve_operational_capability(p_user_id uuid, p_capability_key text)
 RETURNS TABLE(allowed boolean, source text, role_code text, effect text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pos', 'auth', 'pg_temp'
AS $function$
  with identity_state as (
    select
      u.id,
      a.role_code,
      coalesce(s.active and s.deleted_at is null, false) as profile_active,
      s.role as profile_role,
      coalesce(a.active, false) as assignment_active,
      coalesce(r.active, false) as role_active
    from auth.users u
    left join lateral (
      select p.active, p.deleted_at, p.role
      from pos.sellers p
      where lower(p.email) = lower(u.email)
      order by (p.deleted_at is null) desc, p.updated_at desc
      limit 1
    ) s on true
    left join pos.user_permission_role_assignments a on a.user_id = u.id
    left join pos.permission_roles r on r.code = a.role_code
    where u.id = p_user_id
  ),
  capability as (
    select c.capability_key
    from pos.operational_capabilities c
    where c.capability_key = p_capability_key and c.active
  ),
  resolution as (
    select
      i.role_code,
      o.effect,
      rp.allowed as role_allowed,
      o.effect is not null as has_override,
      rp.capability_key is not null as has_role_permission
    from identity_state i
    cross join capability c
    left join pos.user_capability_overrides o
      on o.user_id = p_user_id and o.capability_key = c.capability_key
    left join pos.role_capability_permissions rp
      on rp.role_code = i.role_code
     and rp.capability_key = c.capability_key
    where i.profile_active and i.assignment_active and i.role_active
      and (i.profile_role='admin' or p_capability_key not in('settings.manage','permissions.manage','sellers.manage'))
      and ((i.profile_role='admin' and not exists(select 1 from pos.screen_operational_capabilities() m where m.capability_key=p_capability_key))
       or exists(select 1 from pos.screen_operational_capabilities() m
        cross join lateral pos.resolve_screen_permission(p_user_id,m.screen_key) sp
        where m.capability_key=p_capability_key and sp.allowed))
  )
  select
    case
      when x.has_override then x.effect = 'allow'
      when x.has_role_permission then x.role_allowed
      else false
    end,
    case
      when x.has_override then 'override'
      when x.has_role_permission then 'role'
      else 'default'
    end,
    x.role_code,
    x.effect
  from resolution x
  union all
  select false, 'default', null::text, null::text
  where not exists (select 1 from resolution);
$function$
;
CREATE OR REPLACE FUNCTION pos.user_screen_permissions_version(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pos', 'auth', 'pg_temp'
AS $function$
  with identity_state as (
    select jsonb_build_object(
      'auth_exists', u.id is not null,
      'profile_active', coalesce(s.active and s.deleted_at is null, false),
      'profile_updated_at', s.updated_at
    ) as value
    from (select p_user_id as user_id) requested
    left join auth.users u on u.id = requested.user_id
    left join lateral (
      select p.active, p.deleted_at, p.updated_at
      from pos.sellers p
      where lower(p.email) = lower(u.email)
      order by (p.deleted_at is null) desc, p.updated_at desc
      limit 1
    ) s on true
  ),
  assignment_state as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'role_code', a.role_code,
          'active', a.active,
          'updated_at', a.updated_at
        )
        order by a.role_code
      ),
      '[]'::jsonb
    ) as value
    from pos.user_permission_role_assignments a
    where a.user_id = p_user_id
  ),
  override_state as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'screen_key', o.screen_key,
          'effect', o.effect,
          'updated_at', o.updated_at
        )
        order by o.screen_key
      ),
      '[]'::jsonb
    ) as value
    from pos.user_screen_permission_overrides o
    where o.user_id = p_user_id
  ),
  role_state as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'screen_key', p.screen_key,
          'allowed', p.allowed,
          'updated_at', p.updated_at,
          'role_active', r.active,
          'role_updated_at', r.updated_at
        )
        order by p.screen_key
      ),
      '[]'::jsonb
    ) as value
    from pos.role_screen_permissions p
    join pos.permission_roles r on r.code = p.role_code
    where p.role_code = (
      select a.role_code
      from pos.user_permission_role_assignments a
      where a.user_id = p_user_id
    )
  ),
  catalog_state as (
    select jsonb_build_object(
      'catalog_version', s.catalog_version,
      'updated_at', s.updated_at
    ) as value
    from pos.screen_permission_catalog_state s
    where s.singleton
  )
  select md5(
    identity_state.value::text || '|' ||
    assignment_state.value::text || '|' ||
    override_state.value::text || '|' ||
    role_state.value::text || '|' ||
    catalog_state.value::text || '|' ||
    coalesce((select jsonb_agg(jsonb_build_array(capability_key,effect,updated_at) order by capability_key)::text
      from pos.user_capability_overrides where user_id=p_user_id),'[]')
  )
  from identity_state
  cross join assignment_state
  cross join override_state
  cross join role_state
  cross join catalog_state;
$function$
;
CREATE OR REPLACE FUNCTION pos.dispatch_online_command(p_request_id uuid, p_command jsonb, p_depth integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos', 'auth'
AS $function$
declare
 k text:=p_command->>'type'; domain text:=p_command->>'kind'; r jsonb; x jsonb;
 m pos.system_manifest%rowtype; d text; a jsonb; n integer:=0; old_row jsonb; child_result jsonb;
begin
 if not pos.online_request_context() then raise exception 'ONLINE_COMMAND_REQUIRED' using errcode='42501'; end if;
 d:=pos.assert_online_device();
 select * into m from pos.system_manifest where singleton for share;
 if p_command ? 'accountRequestId' then p_command:=pos.online_account_profile_command(p_command); end if;
 -- H192: shared collection capability must not open denied sale surfaces.
 if k='sale' then
  if not coalesce((select allowed from pos.resolve_screen_permission(auth.uid(),
    case when p_command->>'mode' in('payment','layaway_liquidation') then 'apartados' else 'pos' end)),false) then
   raise exception 'SALE_SCREEN_REQUIRED' using errcode='42501';
  end if;
 end if;
 case k
 when 'batch','sizeMigration' then
  if k='sizeMigration' and (exists(select 1 from pos.sales) or exists(select 1 from pos.returns)
   or exists(select 1 from pos.exchanges) or exists(select 1 from pos.loan_documents where deleted_at is null)
   or exists(select 1 from pos.movements) or exists(select 1 from pos.sale_payments)) then
   raise exception 'SIZE_MIGRATION_HAS_COMMERCIAL_HISTORY' using errcode='23514'; end if;
  if p_depth<>0 or jsonb_typeof(p_command->'commands')<>'array' or jsonb_array_length(p_command->'commands') not between 1 and 200 then
   raise exception 'INVALID_COMMAND_BATCH' using errcode='22023'; end if;
  r:='[]';
  for x in select value from jsonb_array_elements(p_command->'commands') loop
   n:=n+1; r:=r||jsonb_build_array(pos.dispatch_online_command(md5(p_request_id::text||':'||n)::uuid,x,p_depth+1));
  end loop;
 when 'upsert' then
  if domain='products' then
   perform pos.online_check_rows('products',p_command->'rows');
   if coalesce((p_command->>'familyBatch')::boolean,false) then
    r:=pos.commit_reference_family_batch(p_request_id,(p_command->>'referenceFamilyId')::uuid,p_command->'rows',m.sync_protocol_current,m.data_epoch);
   else r:=pos.save_products_checked_v2(p_request_id,p_command->'rows',m.sync_protocol_current,m.data_epoch); end if;
  else r:=pos.online_save_entities(domain,p_command->'rows'); end if;
 when 'profileUpdate','staffUpdate' then
  if domain is distinct from 'sellers' then raise exception 'INVALID_PROFILE_KIND'; end if;
  r:=pos.online_save_entities('sellers',p_command->'rows');
 when 'softDelete' then
  if domain='products' then
   r:=pos.delete_product_checked_v2(p_request_id,p_command->>'val',(p_command->>'baseVersion')::bigint,d,m.sync_protocol_current,m.data_epoch);
  elsif domain in('clients','sellers','promotions') then
   perform pos.require_current_capability(case domain when 'clients' then 'customers.delete' when 'sellers' then 'sellers.manage' else 'promotions.manage' end);
   if domain='sellers' and exists(select 1 from pos.online_account_requests ar where ar.target_user_id::text=p_command->>'val'
     and ar.state not in('completed','rejected','cancelled')
     and ar.request_id::text is distinct from current_setting('pos.online_account',true)) then
    raise exception 'ACCOUNT_TARGET_HAS_UNCONFIRMED_REQUEST' using errcode='40001'; end if;
   perform pos.online_check_rows(domain,jsonb_build_array(jsonb_build_object('id',p_command->>'val','sync_base_version',(p_command->>'baseVersion')::bigint)));
   r:=pos.soft_delete_entity(domain,p_command->>'val',(p_command->>'baseVersion')::bigint,d);
  else raise exception 'INVALID_DELETE_KIND'; end if;
 when 'productDeleteScope' then
  r:=pos.delete_products_checked_v2(p_request_id,p_command->>'scope',(p_command->>'referenceFamilyId')::uuid,
   p_command->'targets',d,m.sync_protocol_current,m.data_epoch);
 when 'clearInventory' then
  if not coalesce(pos.is_active_admin(),false) then
   raise exception 'ACTIVE_ADMIN_REQUIRED' using errcode='42501'; end if;
  perform pos.require_current_capability('inventory.delete');
  if jsonb_typeof(p_command->'targets') is distinct from 'array' then raise exception 'INVALID_INVENTORY_DELETE_SCOPE'; end if;
  if (select count(*) from pos.products where deleted_at is null)<>jsonb_array_length(p_command->'targets')
   or exists(select 1 from pos.products p where p.deleted_at is null and not exists(
    select 1 from jsonb_array_elements(p_command->'targets') t where t->>'id'=p.id)) then
   raise exception 'INVENTORY_SCOPE_CHANGED' using errcode='40001'; end if;
  r:='[]';
  for x in select value from jsonb_array_elements(p_command->'targets') order by value->>'id' loop
   n:=n+1;
   child_result:=pos.delete_products_checked_v2(md5(p_request_id::text||':'||n)::uuid,
    'reference',null,jsonb_build_array(x),d,m.sync_protocol_current,m.data_epoch);
   if child_result is null or child_result='false'::jsonb or child_result->>'ok'='false' then raise exception 'INVENTORY_DELETE_NOT_CONFIRMED'; end if;
   r:=r||jsonb_build_array(child_result);
  end loop;
 when 'config' then
  r:=pos.commit_config(p_request_id::text,(p_command->>'expectedVersion')::bigint,d,p_command->'lookup',p_command->'settings',m.sync_protocol_current,m.data_epoch);
  if r->>'ok'='false' then raise exception using message=coalesce(r->>'error','CONFIG_REJECTED'); end if;
  if jsonb_typeof(p_command->'productUpdates')='array' and jsonb_array_length(p_command->'productUpdates')>0 then
   perform pos.online_check_rows('products',p_command->'productUpdates');
   child_result:=pos.save_products_checked_v2(md5(p_request_id::text||':products')::uuid,p_command->'productUpdates',m.sync_protocol_current,m.data_epoch);
   if child_result is null or child_result='false'::jsonb or child_result->>'ok'='false' then raise exception 'CONFIG_PRODUCTS_NOT_CONFIRMED'; end if;
  end if;
 when 'sale' then
   perform pos.h186_assert_sale(p_command);
  if coalesce(p_command->>'mode','')<>'layaway_liquidation' then
   select to_jsonb(s) into old_row from pos.sales s where folio=p_command#>>'{header,folio}' for update;
   if p_command->>'mode'='payment' then
    a:=p_command->'expectedSale';
    if old_row is null or jsonb_typeof(a) is distinct from 'object'
     or not a ?& array['estado','anticipo','saldo','pago_efectivo','pago_otro','operation_id']
     or exists(select 1 from unnest(array['estado','anticipo','saldo','pago_efectivo','pago_otro','operation_id']) key
      where coalesce(old_row->key,'null'::jsonb) is distinct from coalesce(a->key,'null'::jsonb)) then
     raise exception 'SALE_VERSION_CONFLICT' using errcode='40001'; end if;
   elsif old_row is not null then
    raise exception 'SALE_ALREADY_EXISTS' using errcode='40001';
   else
    if p_command->'quoteContext' is distinct from pos.online_quote_context() then
     raise exception 'COMMERCIAL_QUOTE_CHANGED' using errcode='40001'; end if;
    a:=p_command->'expectedProducts';
    if jsonb_typeof(a) is distinct from 'array' or jsonb_array_length(a)=0
     or exists(select 1 from jsonb_array_elements(p_command->'items') line where not exists(
      select 1 from jsonb_array_elements(a) expected where expected->>'id'=line->>'product_id')) then
     raise exception 'SALE_PRODUCT_BASE_REQUIRED' using errcode='22023'; end if;
    for x in select value from jsonb_array_elements(a) order by value->>'id' loop
     if not exists(select 1 from pos.products p where p.id=x->>'id' and p.deleted_at is null
      and p.sync_version=coalesce(x->>'version',x->>'baseVersion')::bigint) then
      raise exception 'SALE_PRODUCT_VERSION_CONFLICT' using errcode='40001'; end if;
    end loop;
   end if;
  end if;
  if p_command->>'mode'='layaway_liquidation' then
   r:=pos.commit_layaway_liquidation_checked(p_request_id::text,coalesce(p_command->>'saleOperationId',p_command->>'operationId'),p_command->>'folio',
    p_command->'payment',coalesce(p_command->'sellerEffects','[]'),
    jsonb_build_object('item_identities',coalesce(p_command->'itemIdentities','[]'),
     'commission_amount',coalesce(p_command#>'{commissionSnapshot,amount}','0'),
     'commission_base',coalesce(p_command#>'{commissionSnapshot,base}','"neto"'),
     'commission_rows',coalesce(p_command#>'{commissionSnapshot,rows}','[]')));
  elsif jsonb_typeof(p_command#>'{header,descuentos_adicionales}')='array' then
   r:=pos.commit_sale_with_additional_discount_checked(p_request_id::text,p_command->>'operationId',p_command->'header',
    coalesce(p_command->'items','[]'),coalesce(p_command->'moves','[]'),coalesce(p_command->'payments','[]'),
    coalesce(p_command->'stockLines','[]'),coalesce((p_command->>'reserveStock')::boolean,false),
    nullif(p_command->'clientEffect','null'::jsonb),coalesce(p_command->'sellerEffects','[]'));
  else
   r:=pos.commit_sale_checked(p_request_id::text,p_command->>'operationId',p_command->'header',
    coalesce(p_command->'items','[]'),coalesce(p_command->'moves','[]'),coalesce(p_command->'payments','[]'),
    coalesce(p_command->'stockLines','[]'),coalesce((p_command->>'reserveStock')::boolean,false),
    nullif(p_command->'clientEffect','null'::jsonb),coalesce(p_command->'sellerEffects','[]'));
  end if;
    
   if r->>'ok'='true' then
    perform pos.h186_persist_sale(p_command);
    if exists(select 1 from pos.sales s where s.folio=coalesce(p_command#>>'{header,folio}',p_command->>'folio') and s.financial_version=2) then
     -- Delegates assembled their response before the final H69/H85/H94/H186
     -- persistence. Seal the receipt from the final rows, in their existing order.
     r:=r||jsonb_build_object(
      'sale',(select to_jsonb(s) from pos.sales s where s.folio=coalesce(p_command#>>'{header,folio}',p_command->>'folio')),
      'items',(select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from pos.sale_items i
        where i.folio=coalesce(p_command#>>'{header,folio}',p_command->>'folio')));
    end if;
   end if;

when 'return' then
   perform pos.h186_assert_postsale(p_command);
  if coalesce((p_command->>'legacy')::boolean,false) then
   raise exception 'LEGACY_REPLAY_RETIRED' using errcode='22023';
  end if;
  r:=pos.commit_return_checked(p_request_id::text,p_command->'header',coalesce(p_command->'items','[]'),
   coalesce(p_command->'moves','[]'),coalesce(p_command->'stockLines','[]'),nullif(p_command->'clientEffect','null'::jsonb),coalesce(p_command->'sellerEffects','[]'),false);
    if r->>'ok'='true' then perform pos.h186_persist_postsale(p_command); end if;
when 'exchange' then
   perform pos.h186_assert_postsale(p_command);
  if p_command->'quoteContext' is distinct from pos.online_quote_context() then
   raise exception 'COMMERCIAL_QUOTE_CHANGED' using errcode='40001'; end if;
  a:=p_command->'expectedProducts';
  if jsonb_typeof(a) is distinct from 'array' or jsonb_array_length(a)=0
   or exists(select 1 from jsonb_array_elements(p_command->'items') line where line->>'lado'='entregado' and not exists(
    select 1 from jsonb_array_elements(a) expected where expected->>'id'=line->>'product_id')) then
   raise exception 'EXCHANGE_PRODUCT_BASE_REQUIRED' using errcode='22023'; end if;
  for x in select value from jsonb_array_elements(a) order by value->>'id' loop
   if not exists(select 1 from pos.products p where p.id=x->>'id' and p.deleted_at is null
    and p.sync_version=coalesce(x->>'version',x->>'baseVersion')::bigint) then
    raise exception 'EXCHANGE_PRODUCT_VERSION_CONFLICT' using errcode='40001'; end if;
  end loop;
  r:=pos.commit_exchange_checked(p_request_id::text,p_command->'header',coalesce(p_command->'items','[]'),
   coalesce(p_command->'moves','[]'),nullif(p_command->'payment','null'::jsonb),coalesce(p_command->'seller_effects','[]'));
 when 'loanOperation' then
  if p_command->>'action' in('deliver','edit') and exists(
   select 1 from jsonb_array_elements(p_command#>'{loan,lineas}') line
   where not exists(select 1 from pos.products p where p.id=coalesce(line->>'productId',line->>'product_id') and p.deleted_at is null)
  ) then raise exception 'LOAN_PRODUCT_NOT_FOUND' using errcode='23514'; end if;
  r:=pos.commit_loan_operation(p_request_id,p_command->>'action',p_command->'loan',coalesce((p_command->>'expectedVersion')::bigint,0));
 when 'referenceReclassification' then
  r:=pos.commit_reference_reclassification(p_request_id::text,p_command->>'sourceProductId',p_command->>'targetProductId',
   (p_command->>'quantity')::integer,p_command->>'actor',p_command->>'reason',p_command->>'reversalOf');
 when 'commissionSettle' then r:=pos.settle_commission_checked(p_request_id,p_command->>'sellerId');
 when 'commissionClose' then r:=pos.close_commission_period_checked(p_request_id);
 when 'commissionAdjustment' then r:=pos.apply_commission_adjustment_checked(p_request_id,coalesce(p_command->'rows','[]'),coalesce(p_command->>'motivo',''));
 when 'folio' then
  r:=pos.reserve_folio_block(p_command->>'prefix',case when p_command->>'businessDate' ~ '^\d{6}$' then to_date(p_command->>'businessDate','YYMMDD') else (p_command->>'businessDate')::date end,1,coalesce((p_command->>'floor')::integer,0));
  if r->>'ok'='true' then r:=r||jsonb_build_object('folio',(r->>'prefix')||'-'||to_char((r->>'business_date')::date,'YYMMDD')||'-'||lpad(r->>'from',greatest(case when p_command->>'documentKind'='loan' then 3 else 4 end,length(r->>'from')),'0')); end if;
 when 'physicalCard','physicalCardClaim' then
  r:=to_jsonb(pos.claim_physical_card(p_command->>'folio',p_command->>'claimToken'));
 when 'deviceUpdate' then
  r:=to_jsonb(pos.admin_update_sync_device(p_command->>'deviceId',p_command->>'displayName',p_command->>'deviceType'));
 when 'deviceRetire' then
  r:=to_jsonb(pos.admin_set_sync_device_retired(p_command->>'deviceId',(p_command->>'retired')::boolean,p_command->>'note'));
 when 'pointZeroBackup' then
  r:=pos.create_point_zero_backup(p_command->>'previewToken',
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'pointZero' then
  r:=pos.execute_point_zero(coalesce(p_command->>'operationId',p_request_id::text),p_command->>'previewToken',
   (p_command->>'backupId')::uuid,p_command->>'confirmation',
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'cleanupBackup' then
  r:=pos.create_test_data_cleanup_backup(p_command->>'preset',p_command->'selection',p_command->>'planHash',6,
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'cleanup' then
  r:=pos.execute_test_data_cleanup(coalesce(p_command->>'operationId',p_request_id::text),p_command->>'preset',p_command->'selection',
   p_command->>'planHash',(p_command->>'backupId')::uuid,p_command->>'confirmation',6,
   (coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'))->>'x-balam-client-build',d);
 when 'permissions' then
  a:=p_command->'args';
  if p_command->>'rpc'='admin_sync_screen_permission_catalog' then
   r:=to_jsonb(pos.admin_sync_screen_permission_catalog(a->'p_entries',(a->>'p_expected_version')::bigint));
  elsif p_command->>'rpc'='admin_apply_user_screen_permissions_checked' then
   r:=to_jsonb(pos.admin_apply_user_screen_permissions_checked((a->>'p_target_user_id')::uuid,a->>'p_role_code',a->'p_overrides',
    a->>'p_expected_version',array(select jsonb_array_elements_text(a->'p_screen_keys'))));
  else raise exception 'UNKNOWN_PERMISSION_COMMAND' using errcode='22023'; end if;
 else raise exception using errcode='22023',message='UNKNOWN_ONLINE_COMMAND',detail=coalesce(k,'null');
 end case;
 if r is null or r='false'::jsonb or r->>'ok'='false' then
  raise exception using errcode='P0001',message=coalesce(r->>'error','OPERATION_NOT_CONFIRMED'),detail=coalesce(r::text,'null');
 end if;
 return r;
end $function$
;
CREATE OR REPLACE FUNCTION pos.restrict_seller_product_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pos', 'pg_temp'
AS $function$
declare
  compared_new jsonb := to_jsonb(new);
  compared_old jsonb := to_jsonb(old);
begin
  -- H189: only the private sale reservation's decrement may normalize the V2 mirror.
  -- This function remains SECURITY INVOKER: a direct authenticated UPDATE never
  -- inherits the reservation owner's identity. A client GUC alone is insufficient.
  if old.record_model = 'v2' and new.record_model = 'v2'
     and current_user = pg_get_userbyid((select proowner from pg_proc
       where oid = 'pos.reserve_sale_stock(text,text,jsonb)'::regprocedure))
     and new.stock_quantity >= 0 and new.stock_quantity < old.stock_quantity
     and new.sync_device_id like 'sale:%'
     and new.stock = jsonb_build_array(jsonb_build_object(
       'talla', new.size_code, 'escala', coalesce(new.size_scale, ''),
       'stock', new.stock_quantity)) then
    if pos.online_request_context() and exists (
      select 1 from pos.online_requests r
      where r.actor_id = auth.uid() and r.request_id::text = current_setting('pos.online_request', true)
        and r.state = 'executing' and r.command_kind = 'sale'
    ) then
      compared_new := compared_new - 'stock_quantity';
      compared_old := compared_old - 'stock_quantity';
    end if;
  end if;
  -- H190: private post-sale transactions may normalize their V2 stock mirror.
  if old.record_model = 'v2' and new.record_model = 'v2'
     and current_user = pg_get_userbyid((select proowner from pg_proc
       where oid = 'pos.commit_return(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)'::regprocedure))
     and new.stock_quantity >= 0 and new.stock_quantity > old.stock_quantity
     and new.sync_device_id like 'return:%'
     and new.stock = jsonb_build_array(jsonb_build_object(
       'talla', new.size_code, 'escala', coalesce(new.size_scale, ''),
       'stock', new.stock_quantity)) then
    if pos.online_request_context() and exists (
      select 1 from pos.online_requests r
      where r.actor_id = auth.uid() and r.request_id::text = current_setting('pos.online_request', true)
        and r.state = 'executing' and r.command_kind = 'return'
    ) then
      compared_new := compared_new - 'stock_quantity';
      compared_old := compared_old - 'stock_quantity';
    end if;
  end if;
  if old.record_model = 'v2' and new.record_model = 'v2'
     and current_user = pg_get_userbyid((select proowner from pg_proc
       where oid = 'pos.commit_exchange(text,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure))
     and new.stock_quantity >= 0
     and new.sync_device_id like 'exchange:%'
     and new.stock = jsonb_build_array(jsonb_build_object(
       'talla', new.size_code, 'escala', coalesce(new.size_scale, ''),
       'stock', new.stock_quantity)) then
    if pos.online_request_context() and exists (
      select 1 from pos.online_requests r
      where r.actor_id = auth.uid() and r.request_id::text = current_setting('pos.online_request', true)
        and r.state = 'executing' and r.command_kind = 'exchange'
    ) then
      compared_new := compared_new - 'stock_quantity';
      compared_old := compared_old - 'stock_quantity';
    end if;
  end if;
  -- H192: inventory capability authorizes only private gateway writes.
  -- SECURITY INVOKER keeps forged direct markers outside the owner boundary.
  if current_user = pg_get_userbyid((select proowner from pg_proc
       where oid='pos.save_products_checked(uuid,jsonb)'::regprocedure))
     and pos.online_request_context()
     and exists(select 1 from pos.online_requests r where r.actor_id=auth.uid()
       and r.request_id::text=current_setting('pos.online_request',true) and r.state='executing'
       and r.command_kind in('upsert','referenceReclassification','productDeleteScope','clearInventory','softDelete','batch','sizeMigration'))
     and (pos.current_has_capability('inventory.adjust') or
       (pos.current_has_capability('inventory.delete') and
        (compared_new-array['deleted_at','sync_base_version','sync_version','sync_device_id','updated_at'])
         is not distinct from
        (compared_old-array['deleted_at','sync_base_version','sync_version','sync_device_id','updated_at']))) then
    return new;
  end if;
  if pos.is_active_seller() and not pos.is_active_admin() and
     (compared_new - array[
       'stock', 'sync_base_version', 'sync_version', 'sync_device_id',
       'updated_at'
     ]) is distinct from
     (compared_old - array[
       'stock', 'sync_base_version', 'sync_version', 'sync_device_id',
       'updated_at'
     ]) then
    raise exception 'El vendedor sólo puede actualizar existencias'
      using errcode = '42501';
  end if;
  return new;
end;
$function$
;
create policy h192_loan_read on pos.loan_documents for select to authenticated
 using(coalesce((select allowed from pos.current_screen_permission('prestamos')),false));
create policy h192_report_read on pos.returns for select to authenticated
 using(coalesce((select allowed from pos.current_screen_permission('reportes')),false)
 or coalesce((select allowed from pos.current_screen_permission('vendedores')),false));
create policy h192_report_read on pos.return_items for select to authenticated
 using(coalesce((select allowed from pos.current_screen_permission('reportes')),false)
 or coalesce((select allowed from pos.current_screen_permission('vendedores')),false));
create policy h192_report_read on pos.liquidations for select to authenticated
 using(coalesce((select allowed from pos.current_screen_permission('reportes')),false)
 or coalesce((select allowed from pos.current_screen_permission('vendedores')),false));
create trigger h166_snapshot_changed after insert or update or delete or truncate on pos.user_capability_overrides for each statement execute function pos.h166_advance_snapshot_revision();
-- One alignment of existing accounts; no business row or profile is changed.
do $align$
declare target uuid;
begin
 for target in select id from auth.users order by id loop
  perform pos.sync_user_screen_capabilities(target);
 end loop;
 if exists(select * from h192_preservation except select * from (select 'products'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.products t
union all
select 'clients'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.clients t
union all
select 'sellers'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.sellers t
union all
select 'promotions'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.promotions t
union all
select 'sales'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.sales t
union all
select 'sale_items'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.sale_items t
union all
select 'sale_payments'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.sale_payments t
union all
select 'returns'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.returns t
union all
select 'return_items'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.return_items t
union all
select 'exchanges'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.exchanges t
union all
select 'exchange_items'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.exchange_items t
union all
select 'loan_documents'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.loan_documents t
union all
select 'movements'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.movements t
union all
select 'liquidations'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.liquidations t
union all
select 'commission_adjustments'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.commission_adjustments t
union all
select 'lookup'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.lookup t
union all
select 'settings'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.settings t
union all
select 'config_sync_state'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.config_sync_state t
union all
select 'user_permission_role_assignments'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.user_permission_role_assignments t
union all
select 'user_screen_permission_overrides'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.user_screen_permission_overrides t
union all
select 'role_capability_permissions'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.role_capability_permissions t
union all
select 'role_screen_permissions'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.role_screen_permissions t
union all
select 'permission_roles'::text name,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) hash from pos.permission_roles t) preserved)
 then raise exception 'H192_PROTECTED_ROWS_CHANGED'; end if;
end $align$;
do $verify$
begin
 if md5(replace(pg_get_functiondef('pos.admin_apply_user_screen_permissions(uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n')) <> '06ac1e239bfb34ed7363cbfbb86573f0' then raise exception 'H192_FUNCTION_DRIFT: pos.admin_apply_user_screen_permissions(uuid,text,jsonb)'; end if;
 if md5(replace(pg_get_functiondef('pos.dispatch_online_command(uuid,jsonb,integer)'::regprocedure),E'\r\n',E'\n')) <> '485107508f6a3c9df8cccdc0869405ad' then raise exception 'H192_FUNCTION_DRIFT: pos.dispatch_online_command(uuid,jsonb,integer)'; end if;
 if md5(replace(pg_get_functiondef('pos.online_save_entities(text,jsonb)'::regprocedure),E'\r\n',E'\n')) <> '4a1523342e9d0479e6596978274dd5a2' then raise exception 'H192_FUNCTION_DRIFT: pos.online_save_entities(text,jsonb)'; end if;
 if md5(replace(pg_get_functiondef('pos.resolve_operational_capability(uuid,text)'::regprocedure),E'\r\n',E'\n')) <> '29e62e54f05bc239a4ddf3b84d8aa369' then raise exception 'H192_FUNCTION_DRIFT: pos.resolve_operational_capability(uuid,text)'; end if;
 if md5(replace(pg_get_functiondef('pos.restrict_seller_product_update()'::regprocedure),E'\r\n',E'\n')) <> '6c53af55f86f09ed49d733d6ba570669' then raise exception 'H192_FUNCTION_DRIFT: pos.restrict_seller_product_update()'; end if;
 if md5(replace(pg_get_functiondef('pos.user_screen_permissions_version(uuid)'::regprocedure),E'\r\n',E'\n')) <> '86a9a51367b6056c4d915657ecfa4cba' then raise exception 'H192_FUNCTION_DRIFT: pos.user_screen_permissions_version(uuid)'; end if;
 if exists(select 1 from pos.screen_operational_capabilities() where screen_key like 'config.%'
  or capability_key in('settings.manage','permissions.manage','sellers.manage')) then raise exception 'H192_ADMIN_CAPABILITY_MAPPING'; end if;
 if has_function_privilege('authenticated','pos.sync_user_screen_capabilities(uuid)','execute')
  or has_function_privilege('anon','pos.sync_user_screen_capabilities(uuid)','execute')
  or has_function_privilege('authenticated','pos.screen_operational_capabilities()','execute')
  then raise exception 'H192_PRIVATE_SYNC'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='pos' and c.relname in('products','returns','return_items','liquidations','loan_documents','user_capability_overrides') and not c.relrowsecurity)
  or has_table_privilege('authenticated','pos.products','update')
  or has_table_privilege('authenticated','pos.user_capability_overrides','insert')
  then raise exception 'H192_WRITE_BOUNDARY'; end if;
 if not exists(select 1 from pg_trigger where tgrelid='pos.user_capability_overrides'::regclass
  and tgname='h166_snapshot_changed') then raise exception 'H192_INVALIDATION'; end if;
end $verify$;
commit;
