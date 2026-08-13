-- POS Balam - H-98: Punto Cero administrativo permanente y seguro.
-- La purga operativa H-68 sigue siendo la autoridad de sus documentos. Esta
-- frontera la compone dentro de UNA transaccion, elimina el inventario que H-68
-- conserva y sella preview, respaldo, auditoria y nueva epoca de sincronizacion.
begin;

alter table pos.system_manifest
  add column if not exists system_mode text not null default 'preproduction';
alter table pos.system_manifest drop constraint if exists system_manifest_mode_check;
alter table pos.system_manifest add constraint system_manifest_mode_check
  check (system_mode in ('preproduction', 'production'));

-- Correccion hacia adelante de la frontera H-77: Supabase carga `safeupdate`
-- para authenticated y exige WHERE incluso dentro de SECURITY DEFINER.
create or replace function pos.establish_sync_point_zero(
  p_protocol_version integer, p_expected_epoch bigint
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, pos
as $$
declare v_epoch bigint; v_products bigint; v_pieces numeric; v_fingerprint text;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception 'sync_point_zero_forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('pos.sync.point-zero',0));
  perform pos.assert_sync_write_context(p_protocol_version,p_expected_epoch);
  select count(distinct p.id), coalesce(sum(case when p.record_model='v2'
      then coalesce(p.stock_quantity,0) else coalesce((s.item->>'stock')::numeric,0) end),0)
    into v_products,v_pieces from pos.products p
    left join lateral jsonb_array_elements(case when p.record_model='v2' then '[]'::jsonb else coalesce(p.stock,'[]'::jsonb) end) s(item) on true
    where p.deleted_at is null;
  select md5(coalesce(string_agg(to_jsonb(p)::text,'|' order by p.id),''))
    into v_fingerprint from pos.products p where p.deleted_at is null;
  update pos.system_manifest set data_epoch=data_epoch+1,updated_at=now()
    where singleton returning data_epoch into v_epoch;
  insert into pos.inventory_sync_baselines(data_epoch,product_count,piece_count,fingerprint,created_by)
  values(v_epoch,v_products,v_pieces,v_fingerprint,auth.uid());
  update pos.sync_devices set status='must_rebootstrap' where device_id is not null;
  perform pos.bump_sync_domain('products','point-zero');
  perform pos.bump_sync_domain('config','point-zero');
  return jsonb_build_object('ok',true,'data_epoch',v_epoch,'product_count',v_products,
    'piece_count',v_pieces,'fingerprint',v_fingerprint);
end;
$$;

create table if not exists pos.point_zero_backups (
  backup_id uuid primary key default extensions.gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  actor_email text,
  device_id text,
  client_build text,
  schema_version bigint not null,
  preview_token text not null,
  payload_hash text not null,
  counts jsonb not null,
  payload jsonb not null
);

create table if not exists pos.point_zero_operations (
  operation_id text primary key,
  backup_id uuid not null references pos.point_zero_backups(backup_id),
  status text not null check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  actor_user_id uuid not null,
  actor_email text,
  device_id text,
  client_build text,
  schema_version bigint not null,
  preview_token text not null,
  counts_before jsonb not null,
  counts_after jsonb,
  result jsonb not null default '{}'::jsonb
);

alter table pos.point_zero_backups enable row level security;
alter table pos.point_zero_operations enable row level security;
revoke all on pos.point_zero_backups, pos.point_zero_operations from public, anon, authenticated;
grant select on pos.point_zero_backups, pos.point_zero_operations to authenticated;
grant all on pos.point_zero_backups, pos.point_zero_operations to service_role;
drop policy if exists point_zero_backups_admin_read on pos.point_zero_backups;
create policy point_zero_backups_admin_read on pos.point_zero_backups
  for select to authenticated using (pos.is_active_admin() and pos.current_has_capability('settings.manage'));
drop policy if exists point_zero_operations_admin_read on pos.point_zero_operations;
create policy point_zero_operations_admin_read on pos.point_zero_operations
  for select to authenticated using (pos.is_active_admin() and pos.current_has_capability('settings.manage'));

-- Snapshot cerrado de todo lo que Punto Cero puede eliminar. El orden estable
-- permite usar su SHA-256 como contrato entre preview, respaldo y ejecucion.
create or replace function pos.point_zero_payload()
returns jsonb language sql stable security definer
set search_path = pg_catalog, pos
as $$
  select jsonb_build_object(
    'products', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.products x),
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
$$;

create or replace function pos.point_zero_sha256(p_payload jsonb)
returns text language sql immutable security definer
set search_path = pg_catalog, extensions
as $$ select encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex') $$;

create or replace function pos.point_zero_preserved_hash()
returns text language sql stable security definer
set search_path = pg_catalog, pos, auth, extensions
as $$
  select pos.point_zero_sha256(jsonb_build_object(
    'settings', (select coalesce(jsonb_agg(to_jsonb(x) order by x.key), '[]'::jsonb) from pos.settings x where x.key <> '_resetMark'),
    'lookup', (select coalesce(jsonb_agg(to_jsonb(x) order by x.kind, x.code), '[]'::jsonb) from pos.lookup x),
    'sellers', (select coalesce(jsonb_agg(to_jsonb(x) - array['ventas_mes','ventas_num','comision_acum','updated_at','sync_base_version','sync_device_id'] order by x.id), '[]'::jsonb) from pos.sellers x),
    'promotions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from pos.promotions x),
    'permission_roles', (select coalesce(jsonb_agg(to_jsonb(x) order by x.code), '[]'::jsonb) from pos.permission_roles x),
    'role_screen_permissions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.role_code, x.screen_key), '[]'::jsonb) from pos.role_screen_permissions x),
    'user_screen_permission_overrides', (select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id, x.screen_key), '[]'::jsonb) from pos.user_screen_permission_overrides x),
    'role_capability_permissions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.role_code, x.capability_key), '[]'::jsonb) from pos.role_capability_permissions x),
    'user_capability_overrides', (select coalesce(jsonb_agg(to_jsonb(x) order by x.user_id, x.capability_key), '[]'::jsonb) from pos.user_capability_overrides x),
    'auth_users', (select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'email',x.email,'deleted_at',x.deleted_at) order by x.id), '[]'::jsonb) from auth.users x)
  ));
$$;

create or replace function pos.point_zero_preview()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, pos
as $$
declare
  v_payload jsonb; v_counts jsonb; v_hash text; v_manifest pos.system_manifest%rowtype;
  v_queue bigint; v_blocked bigint; v_active bigint; v_unsynchronized bigint;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501', message='point_zero_requires_admin';
  end if;
  select * into strict v_manifest from pos.system_manifest where singleton;
  select coalesce(sum(queue_pending),0), coalesce(sum(queue_blocked),0)
    into v_queue, v_blocked from pos.sync_devices;
  select count(*) into v_unsynchronized from pos.sync_devices d
   where d.data_epoch<>v_manifest.data_epoch or d.queue_pending<>0 or d.queue_blocked<>0
      or d.status<>'online' or d.last_seen_at<now()-interval '2 minutes';
  select count(*) into v_active from pos.point_zero_operations where status='running';
  v_payload := pos.point_zero_payload();
  v_hash := pos.point_zero_sha256(v_payload);
  v_counts := jsonb_build_object(
    'productos', (select count(*) from pos.products),
    'piezas', (select coalesce(sum(case when record_model='v2' then coalesce(stock_quantity,0)
      else (select coalesce(sum(coalesce((e.value->>'stock')::numeric,0)),0) from jsonb_array_elements(coalesce(stock,'[]'::jsonb)) e(value)) end),0) from pos.products where deleted_at is null),
    'ventas', (select count(*) from pos.sales where estado <> 'Apartado'),
    'apartados', (select count(*) from pos.sales where estado = 'Apartado'),
    'pagos', (select count(*) from pos.sale_payments),
    'devoluciones', (select count(*) from pos.returns),
    'cambios', (select count(*) from pos.exchanges),
    'prestamos', (select count(*) from pos.loan_documents),
    'movimientos', (select count(*) from pos.movements),
    'reclasificaciones', (select count(*) from pos.reference_reclassifications),
    'comisiones', (select count(*) from pos.liquidations) + (select count(*) from pos.commission_adjustments),
    'clientes', (select count(*) from pos.clients where generic is not true),
    'cola', v_queue, 'bloqueos', v_blocked
  );
  return jsonb_build_object(
    'ok', true, 'system_mode', v_manifest.system_mode,
    'schema_version', v_manifest.schema_version, 'data_epoch', v_manifest.data_epoch,
    'counts', v_counts, 'snapshot_hash', v_hash,
    'preview_token', pos.point_zero_sha256(jsonb_build_object('snapshot_hash',v_hash,
      'counts',v_counts,'schema_version',v_manifest.schema_version,'data_epoch',v_manifest.data_epoch,
      'system_mode',v_manifest.system_mode)),
    'queue_pending', v_queue, 'active_locks', v_blocked,
    'active_operation', v_active, 'unsynchronized_devices', v_unsynchronized,
    'sync_complete', v_queue=0 and v_blocked=0 and v_unsynchronized=0,
    'supabase_accessible', true,
    'preserved', jsonb_build_object('configuracion',true,'catalogos',true,'usuarios',true,
      'roles_permisos',true,'constructor_sku',true,'metodos_pago',true,'logotipo',true,'tienda',true)
  );
end;
$$;

create or replace function pos.create_point_zero_backup(
  p_preview_token text, p_client_build text default null, p_device_id text default null
) returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, pos
as $$
declare v_preview jsonb; v_payload jsonb; v_id uuid; v_doc jsonb;
begin
  v_preview := pos.point_zero_preview();
  if v_preview->>'system_mode' <> 'preproduction' then raise exception 'point_zero_production_locked'; end if;
  if v_preview->>'preview_token' <> coalesce(p_preview_token,'') then raise exception 'point_zero_preview_changed'; end if;
  if not coalesce((v_preview->>'sync_complete')::boolean,false) then raise exception 'point_zero_not_synchronized'; end if;
  v_payload := pos.point_zero_payload();
  insert into pos.point_zero_backups(created_by,actor_email,device_id,client_build,
    schema_version,preview_token,payload_hash,counts,payload)
  values(auth.uid(),auth.jwt()->>'email',p_device_id,p_client_build,
    (v_preview->>'schema_version')::bigint,p_preview_token,v_preview->>'snapshot_hash',v_preview->'counts',v_payload)
  returning backup_id into v_id;
  v_doc := jsonb_build_object('format','balam-point-zero-backup-v1','backup_id',v_id,
    'created_at',statement_timestamp(),'user',auth.jwt()->>'email','device_id',p_device_id,
    'client_build',p_client_build,'schema_version',v_preview->'schema_version',
    'counts',v_preview->'counts','payload_hash',v_preview->>'snapshot_hash','payload',v_payload);
  return jsonb_build_object('ok',true,'backup_id',v_id,'preview_token',p_preview_token,
    'payload_hash',v_preview->>'snapshot_hash','document',v_doc);
end;
$$;

create or replace function pos.execute_point_zero(
  p_operation_id text, p_preview_token text, p_backup_id uuid, p_confirmation text,
  p_client_build text default null, p_device_id text default null
) returns jsonb language plpgsql volatile security definer
set search_path = pg_catalog, pos
as $$
declare
  v_preview jsonb; v_after jsonb; v_backup pos.point_zero_backups%rowtype;
  v_prior pos.point_zero_operations%rowtype; v_preserved text; v_preserved_after text;
  v_product_ids text[]; v_move_ids bigint[]; v_reclass_ids text[]; v_adjust_ids uuid[];
  v_rows bigint; v_epoch bigint; v_result jsonb; v_error text;
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
    delete from pos.products where id=any(v_product_ids);
    get diagnostics v_rows=row_count;
    if v_rows<>cardinality(v_product_ids) then raise exception 'point_zero_delete_mismatch: products'; end if;

    v_preserved_after := pos.point_zero_preserved_hash();
    if v_preserved_after<>v_preserved then raise exception 'point_zero_preserved_data_changed'; end if;
    update pos.system_manifest set data_epoch=data_epoch+1,
      schema_version=greatest(schema_version,20260812013900),updated_at=now()
      where singleton returning data_epoch into v_epoch;
    update pos.sync_devices set status='must_rebootstrap' where device_id is not null;
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
$$;

create or replace function pos.point_zero_receipt(p_operation_id text)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, pos
as $$
declare v_row pos.point_zero_operations%rowtype;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501', message='point_zero_requires_admin';
  end if;
  select * into strict v_row from pos.point_zero_operations where operation_id=p_operation_id;
  return jsonb_build_object('format','balam-point-zero-receipt-v1','operation_id',v_row.operation_id,
    'backup_id',v_row.backup_id,'user',v_row.actor_email,'device_id',v_row.device_id,
    'started_at',v_row.started_at,'completed_at',v_row.completed_at,'status',v_row.status,
    'schema_version',v_row.schema_version,'client_build',v_row.client_build,
    'counts_before',v_row.counts_before,'counts_after',v_row.counts_after,'result',v_row.result);
end;
$$;

revoke all on function pos.point_zero_payload(), pos.point_zero_sha256(jsonb),
  pos.point_zero_preserved_hash() from public, anon, authenticated;
revoke all on function pos.point_zero_preview(),
  pos.create_point_zero_backup(text,text,text),
  pos.execute_point_zero(text,text,uuid,text,text,text), pos.point_zero_receipt(text) from public, anon;
grant execute on function pos.point_zero_preview(),
  pos.create_point_zero_backup(text,text,text),
  pos.execute_point_zero(text,text,uuid,text,text,text), pos.point_zero_receipt(text) to authenticated;

update pos.system_manifest set schema_version=greatest(schema_version,20260812013900),
  updated_at=now() where singleton;

commit;
