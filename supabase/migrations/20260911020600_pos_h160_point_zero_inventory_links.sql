-- H-160: derived from pg_get_functiondef on the linked authority.
-- Back up and remove H133 product dependencies without changing public grants,
-- retirement, confirmation, mode, synchronization or preservation guards.
begin;
do $guard$ begin
 if md5(replace(pg_get_functiondef('pos.point_zero_payload()'::regprocedure),chr(13)||chr(10),chr(10)))<> '80ecd36acac5c871d43b1adb83b2de96' then
  raise exception 'H160_DEFINITION_DRIFT: point_zero_payload';
 end if;
 if md5(replace(pg_get_functiondef('pos.execute_point_zero(text,text,uuid,text,text,text)'::regprocedure),chr(13)||chr(10),chr(10)))<> '7bbcd91094d2c62167892c3c701eacd6' then
  raise exception 'H160_DEFINITION_DRIFT: execute_point_zero';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION pos.point_zero_payload()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
  select jsonb_build_object(
    'products', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.products x),
    'barcode_aliases', (select coalesce(jsonb_agg(to_jsonb(x) order by x.alias_code), '[]'::jsonb) from pos.barcode_aliases x),
    'inventory_v1_v2_map', (select coalesce(jsonb_agg(to_jsonb(x) order by x.source_v1_product_id, x.size_scale, x.raw_size_value), '[]'::jsonb) from pos.inventory_v1_v2_map x),
    'clients', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.clients x where x.generic is not true),
    'sales', (select coalesce(jsonb_agg(to_jsonb(x) order by x.folio), '[]'::jsonb) from pos.sales x),
    'sale_items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.sale_items x),
    'sale_payments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.sale_payments x),
    'returns', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.returns x),
    'return_items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.return_items x),
    'exchanges', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.exchanges x),
    'exchange_items', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.exchange_items x),
    'loan_documents', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.loan_documents x),
    'movements', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.movements x),
    'liquidations', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.liquidations x),
    'commission_adjustments', (select coalesce(jsonb_agg(to_jsonb(x) order by x.operation_id), '[]'::jsonb) from pos.commission_adjustments x),
    'reference_reclassifications', (select coalesce(jsonb_agg(to_jsonb(x) order by x.operation_id), '[]'::jsonb) from pos.reference_reclassifications x),
    'physical_card_redemptions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.folio), '[]'::jsonb) from pos.physical_card_redemptions x),
    'stock_reservations', (select coalesce(jsonb_agg(to_jsonb(x) order by x.operation_id), '[]'::jsonb) from pos.stock_reservations x),
    'sale_commits', (select coalesce(jsonb_agg(to_jsonb(x) order by x.commit_id), '[]'::jsonb) from pos.sale_commits x),
    'return_commits', (select coalesce(jsonb_agg(to_jsonb(x) order by x.commit_id), '[]'::jsonb) from pos.return_commits x),
    'exchange_commits', (select coalesce(jsonb_agg(to_jsonb(x) order by x.commit_id), '[]'::jsonb) from pos.exchange_commits x),
    'layaway_liquidation_commits', (select coalesce(jsonb_agg(to_jsonb(x) order by x.commit_id), '[]'::jsonb) from pos.layaway_liquidation_commits x),
    'folio_counters', (select coalesce(jsonb_agg(to_jsonb(x) order by x.prefix, x.business_date), '[]'::jsonb) from pos.folio_counters x)
  );
$function$;
CREATE OR REPLACE FUNCTION pos.execute_point_zero(p_operation_id text, p_preview_token text, p_backup_id uuid, p_confirmation text, p_client_build text DEFAULT NULL::text, p_device_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
declare
  v_preview jsonb; v_after jsonb; v_backup pos.point_zero_backups%rowtype;
  v_prior pos.point_zero_operations%rowtype; v_preserved text; v_preserved_after text;
  v_product_ids text[]; v_move_ids bigint[]; v_reclass_ids text[]; v_adjust_ids uuid[];
  v_rows bigint; v_epoch bigint; v_result jsonb; v_error text;
  v_alias_codes text[]; v_map_ids text[]; v_internal_previous text;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501', message='point_zero_requires_admin';
  end if;
  if nullif(trim(coalesce(p_operation_id,'')),'') is null then raise exception 'point_zero_invalid_operation_id'; end if;
  if p_confirmation is distinct from 'PUNTO CERO' then raise exception 'point_zero_confirmation_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('pos.point-zero.execute',0));
  select * into v_prior from pos.point_zero_operations where operation_id=p_operation_id;
  if found then return v_prior.result || jsonb_build_object('idempotent',true); end if;
  v_preview := pos.point_zero_preview();
  if v_preview->>'system_mode' <> 'preproduction' then raise exception 'point_zero_production_locked'; end if;
  if v_preview->>'preview_token' <> coalesce(p_preview_token,'') then raise exception 'point_zero_preview_changed'; end if;
  if not coalesce((v_preview->>'sync_complete')::boolean,false) then raise exception 'point_zero_not_synchronized'; end if;
  select * into v_backup from pos.point_zero_backups where backup_id=p_backup_id and created_by=auth.uid();
  if not found or v_backup.preview_token<>p_preview_token or v_backup.payload_hash<>v_preview->>'snapshot_hash' then
    raise exception 'point_zero_backup_mismatch';
  end if;
  insert into pos.point_zero_operations(operation_id,backup_id,status,actor_user_id,actor_email,
    device_id,client_build,schema_version,preview_token,counts_before)
  values(p_operation_id,p_backup_id,'running',auth.uid(),auth.jwt()->>'email',p_device_id,
    p_client_build,(v_preview->>'schema_version')::bigint,p_preview_token,v_preview->'counts');
  v_preserved := pos.point_zero_preserved_hash();
  begin
    -- H-68 elimina documentos/clientes/contadores y pone acumulados en cero.
    v_result := pos.purge_test_data(p_operation_id);
    if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'point_zero_operational_purge_failed: %', v_result; end if;

    select coalesce(array_agg(operation_id order by operation_id),'{}'::text[]) into v_reclass_ids from pos.reference_reclassifications;
    update pos.reference_reclassifications set reversed_by=null, reversal_of=null where operation_id=any(v_reclass_ids);
    delete from pos.reference_reclassifications where operation_id=any(v_reclass_ids);
    get diagnostics v_rows=row_count;
    if v_rows<>cardinality(v_reclass_ids) then raise exception 'point_zero_delete_mismatch: reference_reclassifications'; end if;

    select coalesce(array_agg(operation_id order by operation_id),'{}'::uuid[]) into v_adjust_ids from pos.commission_adjustments;
    delete from pos.commission_adjustments where operation_id=any(v_adjust_ids);
    get diagnostics v_rows=row_count;
    if v_rows<>cardinality(v_adjust_ids) then raise exception 'point_zero_delete_mismatch: commission_adjustments'; end if;

    select coalesce(array_agg(id order by id),'{}'::bigint[]) into v_move_ids from pos.movements;
    delete from pos.movements where id=any(v_move_ids);
    get diagnostics v_rows=row_count;
    if v_rows<>cardinality(v_move_ids) then raise exception 'point_zero_delete_mismatch: movements'; end if;

    select coalesce(array_agg(id order by id),'{}'::text[]) into v_product_ids from pos.products;
    -- H-160: inventory identities are backed up with their products and removed
    -- before the RESTRICT parent. Keep the ordinary H133 immutable-alias guard.
    select coalesce(array_agg(target_v2_product_id order by target_v2_product_id),'{}'::text[])
      into v_map_ids from pos.inventory_v1_v2_map where target_v2_product_id=any(v_product_ids);
    delete from pos.inventory_v1_v2_map where target_v2_product_id=any(v_map_ids);
    get diagnostics v_rows=row_count;
    if v_rows<>cardinality(v_map_ids) then raise exception 'point_zero_delete_mismatch: inventory_v1_v2_map'; end if;

    select coalesce(array_agg(alias_code order by alias_code),'{}'::text[])
      into v_alias_codes from pos.barcode_aliases where product_id=any(v_product_ids);
    v_internal_previous:=coalesce(current_setting('pos.h133_internal',true),'');
    perform set_config('pos.h133_internal','on',true);
    delete from pos.barcode_aliases where alias_code=any(v_alias_codes);
    get diagnostics v_rows=row_count;
    perform set_config('pos.h133_internal',v_internal_previous,true);
    if v_rows<>cardinality(v_alias_codes) then raise exception 'point_zero_delete_mismatch: barcode_aliases'; end if;
    if exists(select 1 from pos.barcode_aliases) or exists(select 1 from pos.inventory_v1_v2_map) then
      raise exception 'point_zero_inventory_links_remain';
    end if;
    delete from pos.products where id=any(v_product_ids);
    get diagnostics v_rows=row_count;
    if v_rows<>cardinality(v_product_ids) then raise exception 'point_zero_delete_mismatch: products'; end if;

    v_preserved_after := pos.point_zero_preserved_hash();
    if v_preserved_after<>v_preserved then raise exception 'point_zero_preserved_data_changed'; end if;
    update pos.system_manifest set data_epoch=data_epoch+1,
      schema_version=greatest(schema_version,20260812013900),updated_at=now()
      where singleton returning data_epoch into v_epoch;
    update pos.sync_devices set status='must_rebootstrap' where device_id is not null and status <> 'revoked';
    perform pos.bump_sync_domain('products','point-zero:'||p_operation_id);
    perform pos.bump_sync_domain('clients','point-zero:'||p_operation_id);
    perform pos.bump_sync_domain('sales','point-zero:'||p_operation_id);
    perform pos.bump_sync_domain('movements','point-zero:'||p_operation_id);
    v_after := pos.point_zero_preview();
    if exists(select 1 from jsonb_each_text(v_after->'counts') x where x.key not in ('cola','bloqueos') and x.value::numeric<>0) then
      raise exception 'point_zero_postcondition_failed';
    end if;
    v_result := jsonb_build_object('ok',true,'status','completed','operation_id',p_operation_id,
      'backup_id',p_backup_id,'completed_at',statement_timestamp(),'data_epoch',v_epoch,
      'counts_before',v_preview->'counts','counts_after',v_after->'counts',
      'preserved',v_after->'preserved','preserved_hash',v_preserved_after,
      'schema_version',20260812013900,'client_build',p_client_build,'device_id',p_device_id,
      'sync',jsonb_build_object('queue',0,'locks',0,'status','correcta'));
    update pos.point_zero_operations set status='completed',completed_at=now(),
      counts_after=v_after->'counts',result=v_result where operation_id=p_operation_id;
    return v_result;
  exception when others then
    get stacked diagnostics v_error=message_text;
    v_result := jsonb_build_object('ok',false,'status','failed','operation_id',p_operation_id,
      'backup_id',p_backup_id,'error',v_error,'rolled_back',true);
    update pos.point_zero_operations set status='failed',completed_at=now(),result=v_result
      where operation_id=p_operation_id;
    return v_result;
  end;
end;
$function$;
commit;
