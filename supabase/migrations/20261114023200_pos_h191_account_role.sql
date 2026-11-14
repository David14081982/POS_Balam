-- H191: initial operational role at confirmed account creation; no backfill.
begin;
do $pre$ begin
 if md5(replace(pg_get_functiondef('pos.online_save_entities(text,jsonb)'::regprocedure),E'\r\n',E'\n')) <> '48506cd816e1daaead9826dfb0fd4e6e' then raise exception 'H191_BASELINE_DRIFT: pos.online_save_entities(text,jsonb)'; end if;
 if md5(replace(pg_get_functiondef('pos.admin_user_permission_snapshot(uuid,text[])'::regprocedure),E'\r\n',E'\n')) <> 'a0c0d1bd21d485a3494f1353e047aa9f' then raise exception 'H191_BASELINE_DRIFT: pos.admin_user_permission_snapshot(uuid,text[])'; end if;
end $pre$;
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
   end if;
  end if;
  if saved is null then raise exception 'ENTITY_CONFIRMATION_MISSING'; end if;
  result:=result||jsonb_build_array(saved);
 end loop;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION pos.admin_user_permission_snapshot(p_target_user_id uuid, p_screen_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pos', 'auth', 'pg_temp'
AS $function$
declare
  v_result jsonb;
begin
  if not pos.can_manage_screen_permissions(auth.uid()) then
    raise exception 'PERMISSION_ADMIN_UNAUTHORIZED'
      using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'TARGET_USER_NOT_FOUND'
      using errcode = '22023';
  end if;
  if cardinality(coalesce(p_screen_keys, array[]::text[]))
     <> (
       select count(distinct k)
       from unnest(coalesce(p_screen_keys, array[]::text[])) k
     ) then
    raise exception 'SCREEN_KEYS_DUPLICATED' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_screen_keys, array[]::text[])) k
    left join pos.screen_permission_catalog c on c.screen_key = k
    where c.screen_key is null
  ) then
    raise exception 'SCREEN_KEY_UNKNOWN' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(coalesce(p_screen_keys, array[]::text[])) k
    join pos.screen_permission_catalog c on c.screen_key = k
    where not c.active or not c.is_leaf
  ) then
    raise exception 'SCREEN_KEY_INACTIVE' using errcode = '22023';
  end if;

  with requested as (
    select k.screen_key, k.sort_order
    from unnest(coalesce(p_screen_keys, array[]::text[]))
         with ordinality as k(screen_key, sort_order)
  ),
  identity_profile as (
    select
      u.id,
      u.email::text as email,
      s.role::text as profile_role,
      coalesce(s.nombre, split_part(u.email, '@', 1), 'Usuario')::text
        as display_name,
      case
        when s.id is null or s.deleted_at is not null then 'profile_missing'
        when s.active is not true then 'user_inactive'
        else 'active'
      end::text as profile_status
    from auth.users u
    left join lateral (
      select p.id, p.nombre, p.active, p.deleted_at, p.role
      from pos.sellers p
      where lower(p.email) = lower(u.email)
      order by (p.deleted_at is null) desc, p.updated_at desc
      limit 1
    ) s on true
    where u.id = p_target_user_id
  ),
  permission_rows as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'screen_key', k.screen_key,
          'allowed', r.allowed,
          'source', r.source,
          'role_code', r.role_code,
          'effect', r.effect
        )
        order by k.sort_order
      ),
      '[]'::jsonb
    ) as value
    from requested k
    cross join lateral pos.resolve_screen_permission(
      p_target_user_id, k.screen_key
    ) r
  ),
  overrides as (
    select coalesce(
      jsonb_object_agg(o.screen_key, o.effect order by o.screen_key),
      '{}'::jsonb
    ) as value
    from pos.user_screen_permission_overrides o
    where o.user_id = p_target_user_id
  ),
  metadata as (
    select
      a.role_code,
      greatest(a.updated_at, o.updated_at, audit.changed_at) as last_modified_at
    from (select p_target_user_id as user_id) target
    left join pos.user_permission_role_assignments a
      on a.user_id = target.user_id
    left join lateral (
      select max(x.updated_at) as updated_at
      from pos.user_screen_permission_overrides x
      where x.user_id = target.user_id
    ) o on true
    left join lateral (
      select max(x.changed_at) as changed_at
      from pos.permission_change_audit x
      where x.target_user_id = target.user_id
    ) audit on true
  )
  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', identity_profile.id,
      'email', identity_profile.email,
      'name', identity_profile.display_name,
      'status', identity_profile.profile_status,
      'role', identity_profile.profile_role
    ),
    'base_role', metadata.role_code,
    'overrides', overrides.value,
    'permissions', permission_rows.value,
    'permission_version',
      pos.user_screen_permissions_version(p_target_user_id),
    'last_modified_at', metadata.last_modified_at,
    'verified_at', statement_timestamp()
  )
  into v_result
  from identity_profile
  cross join permission_rows
  cross join overrides
  cross join metadata;

  return v_result;
end;
$function$
;
do $verify$
begin
 if not exists(select 1 from pg_proc where oid='pos.online_save_entities(text,jsonb)'::regprocedure and prosecdef and proowner='postgres'::regrole and proconfig=array['search_path=pg_catalog, pos, auth'])
  or has_function_privilege('authenticated','pos.online_save_entities(text,jsonb)','execute')
  or has_function_privilege('anon','pos.online_save_entities(text,jsonb)','execute') then raise exception 'H191_PRIVATE_BOUNDARY'; end if;
 if not exists(select 1 from pg_proc where oid='pos.admin_user_permission_snapshot(uuid,text[])'::regprocedure and prosecdef and proowner='postgres'::regrole and proconfig=array['search_path=pos, auth, pg_temp'])
  or not has_function_privilege('authenticated','pos.admin_user_permission_snapshot(uuid,text[])','execute')
  or has_function_privilege('anon','pos.admin_user_permission_snapshot(uuid,text[])','execute') then raise exception 'H191_SNAPSHOT_BOUNDARY'; end if;
 if has_table_privilege('authenticated','pos.user_permission_role_assignments','insert')
  or has_table_privilege('authenticated','pos.sellers','insert')
  or not (select relrowsecurity from pg_class where oid='pos.user_permission_role_assignments'::regclass)
  then raise exception 'H191_DIRECT_WRITE'; end if;
end $verify$;
commit;
