-- H-56 Fase 4: verificación de herencia del editor, sin escrituras.

begin;

do $$
declare
  v_actor uuid;
  v_snapshot jsonb;
  v_oid oid;
begin
  select u.id into v_actor
  from auth.users u
  where pos.can_manage_screen_permissions(u.id)
  order by u.created_at limit 1;
  if v_actor is null then raise exception 'H56_EDITOR_ADMIN_REQUIRED'; end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  v_snapshot := pos.admin_user_permission_editor_snapshot(
    v_actor, array['config.usuarios', 'config.permisos']
  );
  if jsonb_typeof(v_snapshot -> 'roles') <> 'array'
     or jsonb_array_length(v_snapshot -> 'roles') < 1
     or exists (
       select 1 from jsonb_array_elements(v_snapshot -> 'permissions') p
       where not (p ? 'role_allowed' and p ? 'role_configured')
     ) then
    raise exception 'H56_EDITOR_INHERITANCE_SHAPE_FAILED';
  end if;

  v_oid :=
    'pos.admin_user_permission_editor_snapshot(uuid,text[])'::regprocedure;
  if not (select prosecdef from pg_proc where oid = v_oid)
     or (select array_to_string(proconfig, ',') from pg_proc where oid = v_oid)
        not like '%search_path=pos, auth, pg_temp%'
     or has_function_privilege('public', v_oid, 'execute')
     or has_function_privilege('anon', v_oid, 'execute')
     or not has_function_privilege('authenticated', v_oid, 'execute')
     or has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'H56_EDITOR_SNAPSHOT_ACL_FAILED';
  end if;
  raise notice 'H56_EDITOR_SNAPSHOT roles=ok inheritance=ok acl=ok';
end;
$$;

commit;
