-- H164: one targeted nullable-object regression, with real financial helpers.
-- Only new QA fixtures; every row, permission and setting is rolled back.
begin;
do $verify$
declare
 migration_owner name:=current_user;
 actor uuid:=gen_random_uuid(); payment_request uuid:=gen_random_uuid(); exchange_request uuid:=gen_random_uuid();
 product_id text:=gen_random_uuid()::text;
 prefix text:='qa-h164-null-'||actor::text;
 client_id text:=prefix||'-client'; sale_folio text:=prefix||'-layaway'; source_folio text:=prefix||'-source';
 exchange_uuid text:=prefix||'-exchange'; exchange_folio text:=prefix||'-change';
 sale_operation text:=gen_random_uuid()::text; source_operation text:=gen_random_uuid()::text;
 barcode text; version bigint; command jsonb; response jsonb; repeated jsonb; header jsonb; payments jsonb;
 definition text; stock_before jsonb; initial_runtime jsonb; original_hash text;
begin
 select pg_get_functiondef('pos.dispatch_online_command(uuid,jsonb,integer)'::regprocedure) into definition;
 if (length(definition)-length(replace(definition,'nullif(p_command->''clientEffect'',''null''::jsonb)','')))
      /length('nullif(p_command->''clientEffect'',''null''::jsonb)')<>3
   or position('nullif(p_command->''payment'',''null''::jsonb)' in definition)=0
   or position('p_command->''payment'',coalesce(p_command->''sellerEffects'',''[]'')' in definition)=0 then
  raise exception 'H164_OPTIONAL_OBJECT_BOUNDARY_INCOMPLETE'; end if;
 if has_function_privilege('authenticated','pos.dispatch_online_command(uuid,jsonb,integer)','execute')
   or has_function_privilege('anon','pos.dispatch_online_command(uuid,jsonb,integer)','execute') then
  raise exception 'H164_DISPATCH_ACL_CHANGED'; end if;
 select to_jsonb(r) into initial_runtime from pos.online_runtime r where singleton;
 begin
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('request.headers','{}',true);
  -- Seed as the migration owner. This uncommitted runtime value is invisible
  -- to other connections and is restored before the authenticated gateway call.
  update pos.online_runtime set enabled=false where singleton;
  insert into auth.users(id,email) values(actor,prefix||'@invalid.test');
  barcode:=pos.h133_barcode_v3_from_id(product_id);
  insert into pos.system_manifest(singleton,schema_version,sync_protocol_min,sync_protocol_current,data_epoch,domain_modes)
   values(true,207,2,2,1,'{}') on conflict(singleton) do nothing;
  insert into pos.sellers(id,nombre,email,role,active) values(actor::text,prefix,prefix||'@invalid.test','admin',true);
  insert into pos.permission_roles(code,name,active) values(prefix,prefix,true);
  insert into pos.user_permission_role_assignments(user_id,role_code,active) values(actor,prefix,true);
  insert into pos.operational_capabilities(capability_key,description)
   values('sales.collect','sales.collect'),('sales.exchange','sales.exchange'),('permissions.manage','permissions.manage') on conflict do nothing;
  insert into pos.role_capability_permissions(role_code,capability_key,allowed)
   values(prefix,'sales.collect',true),(prefix,'sales.exchange',true),(prefix,'permissions.manage',true);
  insert into pos.screen_permission_catalog(screen_key,parent_key,is_leaf,active,catalog_version)
   values('config.usuarios',null,true,true,1),('config.permisos',null,true,true,1) on conflict(screen_key) do nothing;
  insert into pos.role_screen_permissions(role_code,screen_key,allowed)
   values(prefix,'config.usuarios',true),(prefix,'config.permisos',true);
  insert into pos.clients(id,nombre,compras,total) values(client_id,prefix,1,100);
  insert into pos.sales(folio,operation_id,fecha,cliente_id,cliente,vendedores,items,subtotal,iva,total,
    anticipo,saldo,pago_efectivo,pago_otro,metodo,estado)
   values(sale_folio,sale_operation,now(),client_id,prefix,'[]',0,100,0,100,10,90,10,0,'Apartado','Apartado');
  insert into pos.sale_payments(id,folio,fecha,tipo,metodo,monto,efectivo,tarjeta,transferencia,otro)
   values(prefix||'-initial',sale_folio,now()::text,'anticipo','Efectivo',10,10,0,0,0);
  insert into pos.products(id,cat,manga,tela,color,modelo,nombre,precio,record_model,reference_family_id,
    size_category_id,size_code,size_scale,stock_quantity,barcode_code,barcode_contract,barcode_aliases,physical_signature)
   values(product_id,'QA','QA','QA','QA','QA',prefix,100,'v2',product_id::uuid,
    prefix,'M','L',3,barcode,3,'[]',jsonb_build_array(jsonb_build_array('qa',prefix))::text);
  select stock,sync_version into stock_before,version from pos.products where id=product_id;
  insert into pos.stock_reservations(operation_id,folio,lines,actor_email)
   values(source_operation,source_folio,jsonb_build_array(jsonb_build_object('product_id',product_id,'talla','M','qty',1)),prefix||'@invalid.test');
  insert into pos.sales(folio,operation_id,fecha,cliente,vendedores,items,subtotal,iva,total,metodo,estado)
   values(source_folio,source_operation,now(),prefix,'[]',1,100,0,100,'Efectivo','Pagado');
  insert into pos.sale_items(folio,product_id,sku,nombre,talla,qty,precio,precio_base,precio_original,line_id,barcode_code)
   values(source_folio,product_id,prefix,prefix,'M',1,100,100,100,prefix||'-source-line',barcode);
  update pos.online_runtime set enabled=true where singleton;
  execute format('set local role %I',migration_owner);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'email',prefix||'@invalid.test','role','authenticated')::text,true);
  perform set_config('request.headers',jsonb_build_object('x-balam-device-id',prefix,'x-balam-client-build','h164-null-regression')::text,true);
  response:=pos.online_presence(prefix,'h164-null-regression');
  if response->>'ok'<>'true' then raise exception 'H164_NULL_PRESENCE: %',response; end if;
  select to_jsonb(s) into header from pos.sales s where folio=sale_folio;
  select jsonb_agg(to_jsonb(p)) into payments from pos.sale_payments p where folio=sale_folio;
  command:=jsonb_build_object('expectedActorId',actor,'type','sale','mode','payment','folio',sale_folio,
   'operationId',sale_operation,'header',header||'{"anticipo":30,"saldo":70,"pago_efectivo":30}'::jsonb,
   'expectedSale',jsonb_build_object('estado',header->'estado','anticipo',header->'anticipo','saldo',header->'saldo',
    'pago_efectivo',header->'pago_efectivo','pago_otro',header->'pago_otro','operation_id',header->'operation_id'),
   'items','[]'::jsonb,'moves','[]'::jsonb,'stockLines','[]'::jsonb,'reserveStock',false,
   'payments',payments||jsonb_build_array(jsonb_build_object('id',prefix||'-partial','folio',sale_folio,'fecha',now()::text,
    'tipo','abono','metodo','Efectivo','monto',20,'efectivo',20,'tarjeta',0,'transferencia',0,'otro',0)),
   'clientEffect','null'::jsonb,'sellerEffects','[]'::jsonb);
  original_hash:=encode(extensions.digest(convert_to(command::text,'UTF8'),'sha256'),'hex');
  set local role authenticated;
  response:=pos.execute_online_command(payment_request,command);
  if response->>'ok'<>'true' then raise exception 'H164_NULL_PARTIAL_PAYMENT: %',response; end if;
  repeated:=pos.resolve_online_request(payment_request);
  if repeated is distinct from response then raise exception 'H164_NULL_RECEIPT_CHANGED'; end if;
  execute format('set local role %I',migration_owner);
  if (select compras<>1 or total<>100 from pos.clients where id=client_id)
    or (select anticipo<>30 or saldo<>70 or pago_efectivo<>30 from pos.sales where folio=sale_folio)
    or (select count(*)<>2 or sum(monto)<>30 from pos.sale_payments where folio=sale_folio)
    or (select command_hash from pos.online_requests where actor_id=actor and request_id=payment_request) is distinct from original_hash then
   raise exception 'H164_NULL_PAYMENT_EFFECTS_CHANGED'; end if;
  -- A zero-difference exchange accepts the other nullable object and creates no payment.
  command:=jsonb_build_object('expectedActorId',actor,'type','exchange','quoteContext',pos.online_quote_context(),
   'expectedProducts',jsonb_build_array(jsonb_build_object('id',product_id,'version',version)),
   'header',jsonb_build_object('id',exchange_uuid,'folio',exchange_folio,'origen_folio',source_folio,'fecha',now()::text,
    'usuario',prefix,'vendedor_id',actor::text,'comision_monto',0),
   'items',jsonb_build_array(
    jsonb_build_object('lado','devuelto','product_id',product_id,'sku',prefix,'nombre',prefix,'talla','M','qty',1,
     'line_id',prefix||'-returned','source_sale_line_id',prefix||'-source-line','barcode_code',barcode,'motivo','Talla','condicion','Sin uso'),
    jsonb_build_object('lado','entregado','product_id',product_id,'sku',prefix,'nombre',prefix,'talla','M','qty',1,
     'line_id',prefix||'-delivered','barcode_code',barcode)),
   'moves','[]'::jsonb,'payment','null'::jsonb,'seller_effects','[]'::jsonb);
  set local role authenticated;
  response:=pos.execute_online_command(exchange_request,command);
  if response->>'ok'<>'true' then raise exception 'H164_NULL_EXCHANGE_PAYMENT: %',response; end if;
  execute format('set local role %I',migration_owner);
  if (select count(*) from pos.exchanges where id=exchange_uuid)<>1
    or (select count(*) from pos.exchange_items where exchange_id=exchange_uuid)<>2
    or exists(select 1 from pos.sale_payments where folio=exchange_folio)
    or (select stock from pos.products where id=product_id) is distinct from stock_before then
   raise exception 'H164_NULL_EXCHANGE_EFFECTS_CHANGED'; end if;
  raise exception using errcode='ZN164',message='H164_NULL_VERIFIED_ROLLBACK';
 exception when sqlstate 'ZN164' then null;
 end;
 if exists(select 1 from auth.users where id=actor)
   or exists(select 1 from pos.clients where id=client_id)
   or exists(select 1 from pos.products where id=product_id)
   or exists(select 1 from pos.sales where folio in(sale_folio,source_folio))
   or exists(select 1 from pos.online_requests where actor_id=actor)
   or (select to_jsonb(r) from pos.online_runtime r where singleton) is distinct from initial_runtime then
  raise exception 'H164_NULL_FIXTURE_LEAK'; end if;
end $verify$;
commit;
