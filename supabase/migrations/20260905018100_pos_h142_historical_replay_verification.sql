begin;
do $verify$
declare r record; v_item jsonb; v_result jsonb; v_denied boolean;
begin
 if to_regprocedure('pos.h133_operational_items(jsonb,boolean,text)') is null
    or to_regprocedure('pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)') is null
    or to_regprocedure('pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)') is null then
  raise exception 'H142_HISTORICAL_CONTRACT_MISSING';
 end if;
 if has_function_privilege('anon','pos.h133_operational_items(jsonb,boolean,text)','execute')
    or has_function_privilege('authenticated','pos.h133_operational_items(jsonb,boolean,text)','execute') then
  raise exception 'H142_INTERNAL_ADAPTER_EXPOSED';
 end if;
 if has_function_privilege('anon','pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)','execute')
    or has_function_privilege('anon','pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)','execute')
    or not has_function_privilege('authenticated','pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)','execute')
    or not has_function_privilege('authenticated','pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)','execute') then
  raise exception 'H142_PUBLIC_WRAPPER_ACL_CHANGED';
 end if;
 if pos.h133_operational_items('[]',false,'')<>'[]'::jsonb then raise exception 'H142_EMPTY_ITEMS_CHANGED'; end if;
 -- Read-only verification on existing historical sources; never edits a document.
 for r in select p.id,p.barcode_code,s.folio,s.line_id,s.talla,s.barcode_code historical
   from pos.products p join pos.sale_items s on s.product_id=p.id
   where p.record_model='v2' and p.deleted_at is null and s.line_id is not null
     and s.barcode_code<>p.barcode_code and p.barcode_aliases ? s.barcode_code
   order by p.id,s.line_id limit 1 loop
  v_item:=jsonb_build_array(jsonb_build_object('product_id',r.id,'barcode_code',r.historical,
    'line_id','h142-readonly-verification','source_sale_line_id',r.line_id,'talla',r.talla,'lado','devuelto'));
  v_result:=pos.h133_operational_items(v_item,true,r.folio);
  perform pos.h94_assert_v2_document_items(v_result);
  if v_result->0->>'barcode_code'<>r.barcode_code
     or v_result->0->>'source_barcode_code'<>r.historical then raise exception 'H142_ALIAS_NOT_TRANSLATED'; end if;
  v_denied:=false;
  begin
   perform pos.h94_assert_v2_document_items(pos.h133_operational_items(v_item,true,'h142-wrong-'||gen_random_uuid()::text));
  exception when others then
   if sqlerrm='V2_LINE_IDENTITY_REQUIRED' then v_denied:=true; else raise; end if;
  end;
  if not v_denied then raise exception 'H142_FOREIGN_ORIGIN_ACCEPTED'; end if;
 end loop;
end;
$verify$;
commit;
