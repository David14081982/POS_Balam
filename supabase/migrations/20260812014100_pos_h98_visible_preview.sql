-- H-98: el preview autoritativo enumera cada autoridad incluida en el plan
-- cerrado de Punto Cero y entrega un sello temporal. No modifica ni elimina
-- datos; la función destructiva permanece intacta.
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
    'clientes', (select count(*) from pos.clients where generic is not true),
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
    'sync_complete', v_queue=0 and v_blocked=0 and v_unsynchronized=0,
    'supabase_accessible', true,
    'preserved', jsonb_build_object('configuracion',true,'catalogos',true,'usuarios',true,
      'roles_permisos',true,'constructor_sku',true,'metodos_pago',true,'logotipo',true,'tienda',true)
  );
end;
$$;

revoke all on function pos.point_zero_preview() from public, anon;
grant execute on function pos.point_zero_preview() to authenticated, service_role;

comment on function pos.point_zero_preview() is
  'H-98 preview administrativo no destructivo: plan completo, conteos autoritativos y sello temporal';
