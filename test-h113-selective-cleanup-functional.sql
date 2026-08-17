-- H-113 · Recorrido funcional sobre PostgreSQL AISLADO. Siempre termina ROLLBACK.
-- Requiere el esquema migrado y nunca debe ejecutarse contra datos compartidos.
begin;

do $$
declare
  v_user uuid := '00000000-0000-4000-8000-000000011300';
  v_preview jsonb;
  v_backup jsonb;
  v_result jsonb;
  v_again jsonb;
  v_rejected boolean := false;
begin
  perform set_config('request.jwt.claim.sub',v_user::text,true);
  perform set_config('request.jwt.claim.email','h113-admin@fixture.invalid',true);
  insert into auth.users(id,email) values(v_user,'h113-admin@fixture.invalid') on conflict(id) do update set email=excluded.email;
  update pos.sellers set email='h113-admin@fixture.invalid',role='admin',active=true where id='h113-admin';
  insert into pos.user_permission_role_assignments(user_id,role_code) values(v_user,'admin')
    on conflict(user_id) do update set role_code='admin';
  insert into pos.clients(id,nombre,generic) values('H113-CUSTOMER','Cliente conservado',false);
  insert into pos.folio_counters(prefix,business_date,last_seq) values('H113','2026-08-17',77);

  insert into pos.products(id,cat,manga,tela,color,modelo,nombre,sku,stock,record_model)
  values('H113-V1','GUA','MC','ALG','BLA','V1','Legacy','H113-LEGACY',
    '[{"talla":"M","escala":"L","stock":8}]','v1');
  insert into pos.products(id,cat,manga,tela,color,modelo,nombre,sku,record_model,
    size_category_id,size_code,size_scale,stock_quantity,barcode_code,ornament_color_codes,physical_signature)
  values
    ('H113-V2-A','GUA','MC','ALG','BLA','V2A','V2 A','H113-DUP','v2','NUM','40','N',4,'H1130001','[]','H113-SIG-A'),
    ('H113-V2-B','GUA','MC','ALG','AZL','V2B','V2 B','H113-DUP','v2','NUM','40','N',9,'H1130002','[]','H113-SIG-B');

  -- Fixture controlado: representa dos ventas ya comprometidas. Se desactiva
  -- sólo la guarda de INSERT porque aquí no se invoca commit_sale_checked.
  alter table pos.sales disable trigger sales_require_stock_reservation;
  insert into pos.sales(folio,cliente_id,cliente,vendedores,metodo,estado,items,total,operation_id,comisiones)
  values
    ('H113-SALE-V1','H113-CUSTOMER','Cliente conservado','[]','Efectivo','Pagado',1,100,'H113-OP-V1','[]'),
    ('H113-SALE-V2','H113-CUSTOMER','Cliente conservado','[]','Efectivo','Pagado',1,100,'H113-OP-V2','[]');
  alter table pos.sales enable trigger sales_require_stock_reservation;
  insert into pos.sale_items(folio,product_id,sku,nombre,talla,qty,precio,line_id)
  values
    ('H113-SALE-V1',null,'H113-LEGACY','Legacy','M',2,100,'H113-LINE-V1'),
    ('H113-SALE-V2','H113-V2-A','H113-DUP','V2 A','40',1,100,'H113-LINE-V2');
  insert into pos.returns(id,folio,cliente,vendedores,total,fecha,comisiones)
  values('H113-RETURN-NULL','H113-SALE-V1','Cliente conservado','[]',0,'2026-08-17 01:00',null);
  insert into pos.loan_documents(id,folio,state,document)
  values('H113-LOAN','H113-LOAN-FOLIO','pendiente','{}');

  update pos.system_manifest set system_mode='preproduction' where singleton;
  insert into pos.sync_devices(device_id,protocol_version,schema_version,data_epoch,status,last_seen_at)
  select 'H113-OLD-DEVICE',1,20260815014800,data_epoch,'online',now() from pos.system_manifest where singleton;
  v_preview:=pos.preview_test_data_cleanup('operations','{}',2);
  if (v_preview->>'executable')::boolean
     or not exists(select 1 from jsonb_array_elements(v_preview->'blocked_reasons') x
       where x->>'code'='client_schema_incompatible') then
    raise exception 'H113_OLD_DEVICE_MUST_BLOCK:%',v_preview;
  end if;
  update pos.sync_devices set schema_version=20260817014900 where device_id='H113-OLD-DEVICE';
  v_preview:=pos.preview_test_data_cleanup('custom','{"loans":true}',2);
  if (v_preview->>'executable')::boolean
     or not exists(select 1 from jsonb_array_elements(v_preview->'blocked_reasons') x
       where x->>'code'='commission_evidence_missing' and x->>'document'='return') then
    raise exception 'H113_RETAINED_EVIDENCE_MUST_BLOCK:%',v_preview;
  end if;
  update pos.returns set comisiones='[]' where id='H113-RETURN-NULL';
  v_preview:=pos.preview_test_data_cleanup('custom','{"loans":true}',2);
  if not (v_preview->>'executable')::boolean then
    raise exception 'H113_COMPLETE_RETAINED_EVIDENCE_BLOCKED:%',v_preview;
  end if;
  -- Subtransacción desechable: un ajuste retenido suma una vez y su fila espejo
  -- tipo `ajuste` no se interpreta como liquidación pagada.
  begin
    insert into pos.commission_adjustments(operation_id,motivo,total,vendedores,detalle)
    values('00000000-0000-4000-8000-000000011301','fixture',25,1,
      '[{"seller_id":"h113-admin","monto":25,"ventas":1}]');
    insert into pos.liquidations(id,seller_id,seller,monto,tipo,fecha)
    values('H113-ADJUSTMENT-MIRROR','h113-admin','Admin',25,'ajuste','2026-08-17 01:30');
    update pos.sellers set comision_acum=999 where id='h113-admin';
    v_backup:=pos.create_test_data_cleanup_backup('custom','{"loans":true}',v_preview->>'plan_hash',2,'fixture','fixture-device');
    v_result:=pos.execute_test_data_cleanup('H113-ADJUSTMENT-PROBE','custom','{"loans":true}',v_preview->>'plan_hash',
      (v_backup->>'backup_id')::uuid,'LIMPIAR OPERACIONES',2,'fixture','fixture-device');
    if (select comision_acum from pos.sellers where id='h113-admin')<>25 then
      raise exception 'H113_RETAINED_ADJUSTMENT_RECOMPUTE_FAILED';
    end if;
    raise exception 'H113_ADJUSTMENT_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm<>'H113_ADJUSTMENT_PROBE_ROLLBACK' then raise; end if;
  end;
  update pos.returns set comisiones=null where id='H113-RETURN-NULL';
  v_preview:=pos.preview_test_data_cleanup('operations','{}',2);
  if not (v_preview->>'executable')::boolean
     or (select (x->>'target_stock')::integer from jsonb_array_elements(v_preview->'stock') x where x->>'product_id'='H113-V1')<>10
     or (select (x->>'target_stock')::integer from jsonb_array_elements(v_preview->'stock') x where x->>'product_id'='H113-V2-A')<>5 then
    raise exception 'H113_FUNCTIONAL_PREVIEW_FAILED:%',v_preview;
  end if;
  if exists(select 1 from jsonb_array_elements(v_preview->'stock') x where x->>'product_id'='H113-V2-B') then
    raise exception 'H113_DUPLICATE_SKU_WRONG_REFERENCE';
  end if;

  v_backup:=pos.create_test_data_cleanup_backup('operations','{}',v_preview->>'plan_hash',2,'fixture','fixture-device');
  if not ((v_backup->'document'->'payload') ?& array['physical_card_redemptions','sale_commits',
      'return_commits','exchange_commits','layaway_liquidation_commits','stock_reservations','movements']) then
    raise exception 'H113_BACKUP_COVERAGE_INCOMPLETE';
  end if;
  v_result:=pos.execute_test_data_cleanup('H113-CLEANUP','operations','{}',v_preview->>'plan_hash',
    (v_backup->>'backup_id')::uuid,'LIMPIAR OPERACIONES',2,'fixture','fixture-device');
  if not (v_result->>'ok')::boolean
     or (select (stock->0->>'stock')::integer from pos.products where id='H113-V1')<>10
     or (select stock_quantity from pos.products where id='H113-V2-A')<>5
     or (select stock_quantity from pos.products where id='H113-V2-B')<>9
     or exists(select 1 from pos.sales where folio like 'H113-SALE-%')
     or not exists(select 1 from pos.clients where id='H113-CUSTOMER' and deleted_at is null)
     or not exists(select 1 from pos.folio_counters where prefix='H113' and last_seq=77) then
    raise exception 'H113_FUNCTIONAL_EXECUTION_FAILED:%',v_result;
  end if;
  v_again:=pos.execute_test_data_cleanup('H113-CLEANUP','operations','{}',v_preview->>'plan_hash',
    (v_backup->>'backup_id')::uuid,'LIMPIAR OPERACIONES',2,'fixture','fixture-device');
  if not coalesce((v_again->>'idempotent')::boolean,false)
     or (select stock_quantity from pos.products where id='H113-V2-A')<>5 then
    raise exception 'H113_FUNCTIONAL_IDEMPOTENCE_FAILED:%',v_again;
  end if;
  if exists(select 1 from pos.test_data_purges where purge_id='H113-CLEANUP') then
    raise exception 'H113_OLD_CLIENT_WOULD_SEE_FULL_PURGE';
  end if;
  begin
    insert into pos.loan_documents(id,folio,state,document)
    values('H113-LOAN','H113-LOAN-RESURRECTED','pendiente','{}');
  exception when others then v_rejected:=sqlerrm='operation_purged'; end;
  if not v_rejected then raise exception 'H113_LOAN_TOMBSTONE_FAILED'; end if;
  raise notice 'H113 functional V1=restored V2=exact duplicate_sku=preserved retained_evidence=guarded backup=complete loan_tombstone=ok clients=preserved folios=preserved idempotent=ok';
end;
$$;

rollback;
