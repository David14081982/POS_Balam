-- H-159: generated from the live point_zero_preview definition.
-- Retired installations are fenced by existing SQL and no longer participate.
-- Active installations still require the existing queue, epoch and online checks.
-- Client tombstones remain preserved and are not operational deletion candidates.
do $guard$ begin
 if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='pos' and p.proname='point_zero_preview'
    and md5(replace(pg_get_functiondef(p.oid),chr(13)||chr(10),chr(10)))='facb9404079a65caccedaad47d6ff73d') then
  raise exception 'H159_DEFINITION_DRIFT: point_zero_preview';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION pos.point_zero_preview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pos'
AS $function$
declare
  v_payload jsonb; v_counts jsonb; v_hash text; v_manifest pos.system_manifest%rowtype;
  v_queue bigint; v_blocked bigint; v_active bigint; v_unsynchronized bigint;
begin
  if not pos.is_active_admin() or not pos.current_has_capability('settings.manage') then
    raise exception using errcode='42501', message='point_zero_requires_admin';
  end if;
  select * into strict v_manifest from pos.system_manifest where singleton;
  select coalesce(sum(queue_pending),0), coalesce(sum(queue_blocked),0)
    into v_queue, v_blocked from pos.sync_devices where status <> 'revoked';
  select count(*) into v_unsynchronized from pos.sync_devices d
   where d.status <> 'revoked' and (d.data_epoch<>v_manifest.data_epoch or d.queue_pending<>0 or d.queue_blocked<>0
      or d.status<>'online' or d.last_seen_at<now()-interval '2 minutes');
  select count(*) into v_active from pos.point_zero_operations where status='running';
  v_payload := pos.point_zero_payload();
  v_hash := pos.point_zero_sha256(v_payload);
  v_counts := jsonb_build_object(
    'productos', (select count(*) from pos.products),
    'piezas', (select coalesce(sum(case when record_model='v2' then coalesce(stock_quantity,0)
      else (select coalesce(sum(coalesce((e.value->>'stock')::numeric,0)),0)
        from jsonb_array_elements(coalesce(stock,'[]'::jsonb)) e(value)) end),0)
      from pos.products where deleted_at is null),
    'ventas', (select count(*) from pos.sales where estado <> 'Apartado'),
    'sale_items', (select count(*) from pos.sale_items),
    'apartados', (select count(*) from pos.sales where estado = 'Apartado'),
    'pagos', (select count(*) from pos.sale_payments),
    'devoluciones', (select count(*) from pos.returns),
    'return_items', (select count(*) from pos.return_items),
    'cambios', (select count(*) from pos.exchanges),
    'exchange_items', (select count(*) from pos.exchange_items),
    'prestamos', (select count(*) from pos.loan_documents),
    'movimientos', (select count(*) from pos.movements),
    'reclasificaciones', (select count(*) from pos.reference_reclassifications),
    'liquidaciones', (select count(*) from pos.liquidations),
    'commission_adjustments', (select count(*) from pos.commission_adjustments),
    'physical_card_redemptions', (select count(*) from pos.physical_card_redemptions),
    'stock_reservations', (select count(*) from pos.stock_reservations),
    'sale_commits', (select count(*) from pos.sale_commits),
    'return_commits', (select count(*) from pos.return_commits),
    'exchange_commits', (select count(*) from pos.exchange_commits),
    'layaway_liquidation_commits', (select count(*) from pos.layaway_liquidation_commits),
    'folio_counters', (select count(*) from pos.folio_counters),
    'clientes', (select count(*) from pos.clients where generic is not true and deleted_at is null),
    'cola', v_queue, 'bloqueos', v_blocked
  );
  return jsonb_build_object(
    'ok', true, 'generated_at', statement_timestamp(),
    'system_mode', v_manifest.system_mode,
    'schema_version', v_manifest.schema_version, 'data_epoch', v_manifest.data_epoch,
    'counts', v_counts, 'snapshot_hash', v_hash,
    'preview_token', pos.point_zero_sha256(jsonb_build_object('snapshot_hash',v_hash,
      'counts',v_counts,'schema_version',v_manifest.schema_version,'data_epoch',v_manifest.data_epoch,
      'system_mode',v_manifest.system_mode)),
    'queue_pending', v_queue, 'active_locks', v_blocked,
    'active_operation', v_active, 'unsynchronized_devices', v_unsynchronized,
    'blocked_devices', (select coalesce(jsonb_agg(jsonb_build_object(
      'device_id',d.device_id,'display_name',d.display_name,'status',d.status,
      'data_epoch',d.data_epoch,'queue_pending',d.queue_pending,'queue_blocked',d.queue_blocked,
      'last_seen_at',d.last_seen_at,
      'reasons',to_jsonb(array_remove(array[
        case when d.data_epoch<>v_manifest.data_epoch then 'epoch' end,
        case when d.queue_pending<>0 then 'pending' end,
        case when d.queue_blocked<>0 then 'blocked' end,
        case when d.status<>'online' then 'offline' end,
        case when d.last_seen_at<now()-interval '2 minutes' then 'stale' end
      ],null))) order by coalesce(d.display_name,d.device_id),d.device_id),'[]'::jsonb)
      from pos.sync_devices d where d.status <> 'revoked'
        and (d.data_epoch<>v_manifest.data_epoch or d.queue_pending<>0 or d.queue_blocked<>0
          or d.status<>'online' or d.last_seen_at<now()-interval '2 minutes')),
    'retired_devices', (select count(*) from pos.sync_devices where status='revoked'),
    'sync_complete', v_queue=0 and v_blocked=0 and v_unsynchronized=0,
    'supabase_accessible', true,
    'preserved', jsonb_build_object('configuracion',true,'catalogos',true,'usuarios',true,
      'roles_permisos',true,'constructor_sku',true,'metodos_pago',true,'logotipo',true,'tienda',true)
  );
end;
$function$;

revoke all on function pos.point_zero_preview() from public, anon;
grant execute on function pos.point_zero_preview() to authenticated, service_role;
comment on function pos.point_zero_preview() is
 'H-159: administrative preview with operational counts and explicit active-device blockers; no business writes';
