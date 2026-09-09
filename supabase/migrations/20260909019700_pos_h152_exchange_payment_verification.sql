-- H152: rollback-only fixtures; no real cleanup or existing row mutation.
begin;
do $verify$
declare token text:='h152-'||gen_random_uuid()::text; p jsonb; p2 jsonb; b jsonb; denied boolean:=false;
begin
 begin
  insert into pos.exchanges(id,folio,origen_folio,fecha,valor_reconocido,valor_entregado,diferencia,base_comision,comision_monto)
  values(token,token||'-folio',token||'-source','2026-09-09 10:00',100,990,890,890,0);
  insert into pos.sale_payments(id,folio,fecha,tipo,metodo,monto,tarjeta)
  values(token||'-payment',token||'-folio','2026-09-09 10:00','cambio','Tarjeta',890,890),
   (token||'-retained',token||'-folio','2026-09-09 09:00','venta','Tarjeta',100,100);
  p:=pos.test_data_cleanup_plan('custom','{"exchanges":true}');
  if not coalesce((p->'documents'->'payment_ids') ? (token||'-payment'),false)
    or (p->'documents'->'payment_ids') ? (token||'-retained') then raise exception 'H152_PAYMENT_SELECTION'; end if;
  b:=pos.test_data_cleanup_payload(p);
  if not exists(select 1 from jsonb_array_elements(b->'sale_payments') x where x->>'id'=token||'-payment' and (x->>'monto')::numeric=890)
    or exists(select 1 from jsonb_array_elements(b->'sale_payments') x where x->>'id'=token||'-retained') then raise exception 'H152_PAYMENT_BACKUP'; end if;
  update pos.sale_payments set monto=891,tarjeta=891 where id=token||'-payment';
  p2:=pos.test_data_cleanup_plan('custom','{"exchanges":true}');
  if p->>'plan_hash'=p2->>'plan_hash' then raise exception 'H152_PAYMENT_HASH'; end if;
  if has_function_privilege('anon','pos.test_data_cleanup_plan(text,jsonb)','execute')
    or has_function_privilege('authenticated','pos.test_data_cleanup_payload(jsonb)','execute') then raise exception 'H152_HELPER_PRIVILEGES'; end if;
  perform set_config('request.jwt.claims','{}',true);
  perform set_config('request.jwt.claim.sub','',true);
  begin
   perform pos.execute_test_data_cleanup(token,'custom','{"exchanges":true}',p->>'plan_hash',gen_random_uuid(),'LIMPIAR OPERACIONES',6,'h152',token);
  exception when insufficient_privilege then denied:=true;
  end;
  if not denied then raise exception 'H152_UNAUTHORIZED_EXECUTION'; end if;
  raise exception 'H152_FIXTURE_ROLLBACK';
 exception when others then if sqlerrm<>'H152_FIXTURE_ROLLBACK' then raise; end if;
 end;
 if exists(select 1 from pos.exchanges where id=token)
   or exists(select 1 from pos.sale_payments where id in(token||'-payment',token||'-retained')) then raise exception 'H152_FIXTURE_LEAK'; end if;
 raise notice 'H152_VERIFIED selection=exact backup=complete hash=monetary guard=denied fixtures=rolled_back';
end $verify$;
commit;
