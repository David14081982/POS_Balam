-- H-113 · Permisos reales sobre un esquema aislado. No ejecuta limpieza.
begin;

do $$
declare
  v_admin uuid := '00000000-0000-4000-8000-000000011310';
  v_seller uuid := '00000000-0000-4000-8000-000000011311';
  v_preview jsonb;
  v_denied boolean := false;
  v_proc oid;
begin
  insert into auth.users(id,email) values
    (v_admin,'h113-permission-admin@fixture.invalid'),
    (v_seller,'h113-permission-seller@fixture.invalid');
  insert into pos.permission_roles(code,name) values('seller','Seller') on conflict(code) do nothing;
  insert into pos.sellers(id,nombre,email,role,active) values
    ('h113-permission-admin','Admin H113','h113-permission-admin@fixture.invalid','admin',true),
    ('h113-permission-seller','Seller H113','h113-permission-seller@fixture.invalid','vendedor',true);
  insert into pos.user_permission_role_assignments(user_id,role_code) values
    (v_admin,'admin'),(v_seller,'seller');

  perform set_config('request.jwt.claim.sub',v_seller::text,true);
  perform set_config('request.jwt.claim.email','h113-permission-seller@fixture.invalid',true);
  begin
    perform pos.preview_test_data_cleanup('operations','{}',2);
  exception when insufficient_privilege then v_denied:=sqlerrm='cleanup_requires_admin'; end;
  if not v_denied then raise exception 'H113_SELLER_NOT_DENIED'; end if;

  if has_function_privilege('anon','pos.preview_test_data_cleanup(text,jsonb,integer)','execute')
     or has_function_privilege('public','pos.preview_test_data_cleanup(text,jsonb,integer)','execute')
     or has_function_privilege('anon','pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)','execute')
     or has_function_privilege('public','pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)','execute') then
    raise exception 'H113_PUBLIC_OR_ANON_EXECUTE';
  end if;
  if has_function_privilege('authenticated','pos.test_data_cleanup_plan(text,jsonb)','execute')
     or has_function_privilege('authenticated','pos.test_data_cleanup_payload(jsonb)','execute') then
    raise exception 'H113_INTERNAL_FUNCTION_EXPOSED';
  end if;

  foreach v_proc in array array[
    'pos.preview_test_data_cleanup(text,jsonb,integer)'::regprocedure::oid,
    'pos.create_test_data_cleanup_backup(text,jsonb,text,integer,text,text)'::regprocedure::oid,
    'pos.execute_test_data_cleanup(text,text,jsonb,text,uuid,text,integer,text,text)'::regprocedure::oid,
    'pos.test_data_cleanup_receipt(text)'::regprocedure::oid
  ] loop
    if not exists(select 1 from pg_proc p where p.oid=v_proc and p.prosecdef
      and pg_get_userbyid(p.proowner)='postgres'
      and exists(select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%pg_catalog%')) then
      raise exception 'H113_SECURITY_DEFINER_CONTRACT:%',v_proc::regprocedure;
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claim.email','h113-permission-admin@fixture.invalid',true);
  update pos.system_manifest set system_mode='production' where singleton;
  v_preview:=pos.preview_test_data_cleanup('operations','{}',2);
  if (v_preview->>'executable')::boolean
     or not (v_preview->'blocked_reasons' ? 'cleanup_production_locked') then
    raise exception 'H113_PRODUCTION_NOT_BLOCKED:%',v_preview;
  end if;
  raise notice 'H113 permissions seller=denied anon=denied public=denied internals=private owner=postgres search_path=sealed production=blocked';
end;
$$;

rollback;
