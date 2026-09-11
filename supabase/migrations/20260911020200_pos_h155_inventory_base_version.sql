-- H-155: BEFORE INSERT clears EXCLUDED.sync_base_version during an UPSERT.
-- Recover the exact submitted base only in the two inventory RPC UPDATE arms.
-- Leave the shared entity trigger, legacy NULL semantics and payload hashes intact.
begin;
set local lock_timeout = '10s';
do $h155_version$
declare
  v_oid regprocedure; v_before text; v_body text; v_expected_hash text; v_metadata jsonb;
  v_entity_guard text := pg_get_functiondef('pos.guard_entity_version()'::regprocedure);
  v_from text := 'sync_base_version=excluded.sync_base_version';
  v_to text := $replacement$sync_base_version=(select source_row.sync_base_version
      from jsonb_to_recordset(p_rows) as source_row(id text,sync_base_version bigint)
      where source_row.id=excluded.id)$replacement$;
begin
  foreach v_oid in array array[
    'pos.save_products_checked(uuid,jsonb)'::regprocedure,
    'pos.commit_reference_family_batch_h101_internal(uuid,uuid,jsonb,integer,bigint)'::regprocedure
  ] loop
    select pg_get_functiondef(p.oid), p.prosrc,
      jsonb_build_object('owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,
        'config',p.proconfig,'language',p.prolang,'returns',p.prorettype,'args',p.proargtypes::text)
      into v_before,v_body,v_metadata from pg_proc p where p.oid=v_oid;
    v_expected_hash := case when v_oid='pos.save_products_checked(uuid,jsonb)'::regprocedure
      then '8019d723cd6896dc49606bb9c617e8f9' else '47fbd3f3a29591ace11eb1bce8567aaa' end;
    -- H-94/H-101 bodies after the applied H-138 registration correction.
    if md5(btrim(replace(v_body,E'\r\n',E'\n'),E' \t\r\n')) <> v_expected_hash
       or (length(v_before)-length(replace(v_before,v_from,'')))/length(v_from) <> 1 then
      raise exception 'H155_INVENTORY_VERSION_SOURCE_DRIFT: %',v_oid;
    end if;
    execute replace(v_before,v_from,v_to);
    if v_metadata is distinct from (select jsonb_build_object(
        'owner',p.proowner,'acl',p.proacl,'definer',p.prosecdef,'config',p.proconfig,
        'language',p.prolang,'returns',p.prorettype,'args',p.proargtypes::text)
        from pg_proc p where p.oid=v_oid) then
      raise exception 'H155_INVENTORY_VERSION_METADATA_CHANGED: %',v_oid;
    end if;
  end loop;
  if pg_get_functiondef('pos.guard_entity_version()'::regprocedure) is distinct from v_entity_guard then
    raise exception 'H155_SHARED_ENTITY_GUARD_CHANGED';
  end if;
end;
$h155_version$;
commit;
