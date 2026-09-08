-- H-148: ejercicio real de liquidación, identidad congelada y replay.
-- Sólo filas nuevas; el subbloque revierte todas las semillas incluso al pasar.
begin;
do $verification$
declare
  v_uid uuid := gen_random_uuid();
  v_id text := 'qa-h148-' || v_uid::text;
  v_email text := v_uid::text || '@h148.invalid';
  v_product pos.products%rowtype;
  v_product_id text := gen_random_uuid()::text;
  v_color text;
  v_signature text;
  v_found boolean := false;
  v_payment jsonb;
  v_result jsonb;
  v_line pos.sale_items%rowtype;
  v_baseline text;
  v_denied boolean := false;
begin
  select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]'))
    into v_baseline from pos.products p;
  if has_function_privilege('anon',
      'pos.commit_layaway_liquidation_checked(text,text,text,jsonb,jsonb,jsonb)','execute') then
    raise exception 'H148_ANON_EXECUTE';
  end if;
  begin
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values(v_uid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
    insert into pos.sellers(id,nombre,email,role,active,comision_pct)
    values(v_id,'QA H148',v_email,'admin',true,0);
    insert into pos.user_permission_role_assignments(user_id,role_code,active)
    values(v_uid,'admin',true);
    perform set_config('request.jwt.claim.sub',v_uid::text,true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',v_uid,'email',v_email,'role','authenticated')::text,true);
    select * into v_product from pos.products where deleted_at is null and record_model='v2' order by id limit 1;
    if v_product.id is null then raise exception 'H148_REQUIRES_VALID_PRODUCT_TEMPLATE'; end if;
    for v_color in select code from pos.lookup where kind='color' and active order by code loop
      v_signature:=replace(v_product.physical_signature,'["color",'||to_jsonb(v_product.color)::text||']','["color",'||to_jsonb(v_color)::text||']');
      if v_signature<>v_product.physical_signature and not exists(
          select 1 from pos.products where deleted_at is null and record_model='v2'
            and physical_signature::jsonb=v_signature::jsonb) then
        v_product.color:=v_color; v_product.physical_signature:=v_signature; v_found:=true; exit;
      end if;
    end loop;
    if not v_found then raise exception 'H148_NO_UNUSED_VALID_REFERENCE'; end if;
    v_product.id:=v_product_id; v_product.nombre:='QA H148'; v_product.sku:=v_id;
    v_product.reference_family_id:=v_product_id;
    v_product.barcode_code:=pos.h133_barcode_v3_from_id(v_product_id); v_product.barcode_contract:=3; v_product.barcode_aliases:='[]';
    v_product.physical_identity_locked:=false; v_product.stock_quantity:=2;
    v_product.stock:=jsonb_build_array(jsonb_build_object('talla',v_product.size_code,'escala',v_product.size_scale,'stock',2));
    v_product.sync_version:=0; v_product.sync_base_version:=0; v_product.deleted_at:=null;
    insert into pos.products values(v_product.*);
    insert into pos.sales(folio,operation_id,fecha,cliente,vendedores,items,subtotal,iva,total,anticipo,saldo,pago_efectivo,pago_otro,metodo,estado,return_limit_days)
    values(v_id,v_id,now(),'QA H148','[]',1,100,0,100,0,100,0,0,'Apartado','Apartado',30);
    insert into pos.sale_items(folio,product_id,sku,nombre,talla,qty,precio,precio_base,precio_original,
      line_id,barcode_code,physical_attrs,list_price,effective_price,discount_snapshot,ornamento,orn_colors)
    values(v_id,v_product_id,v_id,'QA H148',v_product.size_code,1,100,100,100,v_id,v_product.barcode_code,
      '{"recordModel":"v2","frozen":true}',100,100,'{"promotions":[],"additional":0}','QA','["QA"]');
    v_payment:=jsonb_build_object('id',v_id,'folio',v_id,'fecha',now()::text,'tipo','liquidacion',
      'metodo','Efectivo','monto',100,'efectivo',100,'tarjeta',0,'transferencia',0,'otro',0);
    v_result:=pos.commit_layaway_liquidation_checked(v_id,v_id,v_id,v_payment,'[]','{}');
    if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'H148_LIQUIDATION_REJECTED: %',v_result; end if;
    select * into v_line from pos.sale_items where folio=v_id;
    if v_line.line_id is distinct from v_id or v_line.barcode_code is distinct from v_product.barcode_code
       or v_line.physical_attrs is distinct from '{"recordModel":"v2","frozen":true}'::jsonb
       or v_line.list_price is distinct from 100 or v_line.effective_price is distinct from 100
       or v_line.discount_snapshot is distinct from '{"promotions":[],"additional":0}'::jsonb
       or v_line.ornamento is distinct from 'QA' or v_line.orn_colors is distinct from '["QA"]'::jsonb then
      raise exception 'H148_FROZEN_LINE_IDENTITY_LOST';
    end if;
    if v_result->'items'->0->>'line_id' is distinct from v_id then raise exception 'H148_RESPONSE_IDENTITY_LOST'; end if;
    v_result:=pos.commit_layaway_liquidation_checked(v_id,v_id,v_id,v_payment,'[]','{}');
    if not coalesce((v_result->>'liquidation_idempotent')::boolean,false)
       or (select stock_quantity from pos.products where id=v_product_id)<>1
       or (select count(*) from pos.sale_payments where folio=v_id)<>1 then
      raise exception 'H148_REPLAY_CHANGED_STOCK_OR_PAYMENT';
    end if;
    perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
    perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
    begin
      perform pos.commit_layaway_liquidation_checked(v_id,v_id,v_id,v_payment,'[]','{}');
    exception when insufficient_privilege then v_denied:=true;
    end;
    if not v_denied then raise exception 'H148_UNPROFILED_ACCESS'; end if;
    raise sqlstate 'P0148' using message='rollback H148 fixtures';
  exception when sqlstate 'P0148' then null;
  end;
  if v_baseline is distinct from (select md5(coalesce(jsonb_agg(to_jsonb(p) order by id)::text,'[]')) from pos.products p)
     or exists(select 1 from auth.users where id=v_uid)
     or exists(select 1 from pos.sales where folio=v_id) then
    raise exception 'H148_FIXTURE_ROLLBACK_FAILED';
  end if;
  raise notice 'H148 PASS frozen metadata, response, idempotence, authorization, rollback';
end;
$verification$;
commit;
