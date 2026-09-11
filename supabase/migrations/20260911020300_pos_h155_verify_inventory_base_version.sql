-- H-155: execute each installed RPC's assignment through PostgreSQL UPSERT.
-- Full public RPC/ACK execution is in test-h155-ornament-order-sql.mjs.
-- The temporary guard is generated from the actual shared guard; its only body
-- change redirects diagnostics into a temporary table, avoiding real rows/sequences.
begin;
do $h155_version_verify$
declare
  v_oid regprocedure; v_definition text; v_guard text; v_clone text;
  v_tail text; v_assignment text; v_end integer; v_sql text; v_row jsonb;
  v_actual jsonb; v_before jsonb; v_rejected boolean; v_id text;
begin
  if pos.h133_internal_enabled() then raise exception 'H155_VERSION_VERIFY_INTERNAL_BYPASS'; end if;
  create temporary table h155_version_probe(
    id text primary key,precio numeric,stock_quantity integer,sync_version bigint,
    sync_base_version bigint,sync_device_id text,updated_at timestamptz,deleted_at timestamptz
  ) on commit drop;
  create temporary table h155_version_conflicts(
    entity text,entity_id text,operation text,expected_version bigint,actual_version bigint,
    attempted jsonb,current_row jsonb,device_id text
  ) on commit drop;
  v_guard := pg_get_functiondef('pos.guard_entity_version()'::regprocedure);
  if (length(v_guard)-length(replace(v_guard,'pos.guard_entity_version()','')))/length('pos.guard_entity_version()')<>1
     or (length(v_guard)-length(replace(v_guard,'pos.sync_conflicts','')))/length('pos.sync_conflicts')<>1 then
    raise exception 'H155_VERSION_VERIFY_GUARD_SOURCE_DRIFT';
  end if;
  v_clone := replace(replace(v_guard,'pos.guard_entity_version()','pg_temp.h155_version_probe_guard()'),
    'pos.sync_conflicts','pg_temp.h155_version_conflicts');
  execute v_clone;
  create trigger h155_version_probe_trigger before insert or update on h155_version_probe
    for each row execute function pg_temp.h155_version_probe_guard();

  foreach v_oid in array array[
    'pos.save_products_checked(uuid,jsonb)'::regprocedure,
    'pos.commit_reference_family_batch_h101_internal(uuid,uuid,jsonb,integer,bigint)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_oid);
    if position('sync_base_version=excluded.sync_base_version' in v_definition)>0
       or position('sync_base_version=(select source_row.sync_base_version' in v_definition)=0 then
      raise exception 'H155_ORIGINAL_PAYLOAD_BASE_MISSING: %',v_oid;
    end if;
    -- Exercise the assignment read from the installed definition, not a second formula.
    v_tail := substr(v_definition,strpos(v_definition,'sync_base_version='));
    v_end := strpos(v_tail,',sync_device_id=excluded.sync_device_id');
    if v_end=0 then raise exception 'H155_VERSION_VERIFY_ASSIGNMENT_BOUNDARY'; end if;
    v_assignment := substr(v_tail,1,v_end-1);
    if position('jsonb_to_recordset(p_rows) as source_row(id text,sync_base_version bigint)' in v_assignment)=0
       or position('where source_row.id=excluded.id' in v_assignment)=0 then
      raise exception 'H155_VERSION_VERIFY_PAYLOAD_CORRELATION';
    end if;
    v_sql := 'insert into pg_temp.h155_version_probe(id,precio,stock_quantity,sync_base_version,sync_device_id)
      select r.id,r.precio,r.stock_quantity,r.sync_base_version,r.sync_device_id
      from jsonb_to_recordset($1) as r(id text,precio numeric,stock_quantity integer,sync_base_version bigint,sync_device_id text)
      on conflict(id) do update set precio=excluded.precio,stock_quantity=excluded.stock_quantity,'
      ||replace(v_assignment,'p_rows','$1')||',sync_device_id=excluded.sync_device_id';
    v_id := v_oid::text;
    v_row := jsonb_build_object('id',v_id,'precio',100,'stock_quantity',5,'sync_base_version',0,'sync_device_id','h155-temporary');
    execute v_sql using jsonb_build_array(v_row);
    if (select sync_version from h155_version_probe where id=v_id)<>1
       or (select sync_base_version from h155_version_probe where id=v_id) is not null then
      raise exception 'H155_INSERT_CONTRACT_CHANGED';
    end if;
    execute v_sql using jsonb_build_array(v_row||'{"sync_base_version":1,"stock_quantity":4}'::jsonb);
    select to_jsonb(p) into v_before from h155_version_probe p where id=v_id;
    if (v_before->>'sync_version')::bigint<>2 or (v_before->>'stock_quantity')::integer<>4 then
      raise exception 'H155_CURRENT_BASE_NOT_ACCEPTED';
    end if;
    execute v_sql using jsonb_build_array(v_row||'{"sync_base_version":1,"precio":105}'::jsonb);
    select to_jsonb(p) into v_actual from h155_version_probe p where id=v_id;
    if v_actual is distinct from v_before
       or not exists(select 1 from h155_version_conflicts where entity_id=v_id and expected_version=1 and actual_version=2) then
      raise exception 'H155_STALE_UPSERT_RESTORED_STOCK';
    end if;
    execute v_sql using jsonb_build_array(v_row||'{"sync_base_version":2,"stock_quantity":4,"precio":106}'::jsonb);
    if (select sync_version from h155_version_probe where id=v_id)<>3
       or (select precio from h155_version_probe where id=v_id)<>106 then
      raise exception 'H155_NEXT_CURRENT_BASE_NOT_ACCEPTED';
    end if;
    -- Missing and explicit NULL bases keep the previous legacy contract.
    execute v_sql using jsonb_build_array((v_row-'sync_base_version')||'{"stock_quantity":4,"precio":107}'::jsonb);
    execute v_sql using jsonb_build_array(v_row||'{"sync_base_version":null,"stock_quantity":4,"precio":108}'::jsonb);
    select to_jsonb(p) into v_before from h155_version_probe p where id=v_id;
    if (v_before->>'sync_version')::bigint<>5 or (v_before->>'precio')::numeric<>108 then
      raise exception 'H155_LEGACY_NULL_BASE_CHANGED';
    end if;
    v_rejected := false;
    begin
      execute v_sql using jsonb_build_array(v_row,v_row);
    exception when cardinality_violation then v_rejected := true;
    end;
    select to_jsonb(p) into v_actual from h155_version_probe p where id=v_id;
    if not v_rejected or v_actual is distinct from v_before then
      raise exception 'H155_DUPLICATE_PAYLOAD_NOT_ATOMIC';
    end if;
  end loop;
  drop table h155_version_probe;
  drop function pg_temp.h155_version_probe_guard();
end;
$h155_version_verify$;
commit;
