-- H-114 · verificación estructural, sin borrar ni crear datos comerciales.
do $$
declare v_def text;
begin
  if to_regprocedure('pos.delete_products_checked_v2(uuid,text,uuid,jsonb,text,integer,bigint)') is null then
    raise exception 'H-114: falta RPC de baja por alcance';
  end if;
  if not has_function_privilege('authenticated','pos.delete_products_checked_v2(uuid,text,uuid,jsonb,text,integer,bigint)','execute')
     or has_function_privilege('anon','pos.delete_products_checked_v2(uuid,text,uuid,jsonb,text,integer,bigint)','execute') then
    raise exception 'H-114: permisos incorrectos';
  end if;
  v_def := pg_get_functiondef('pos.delete_products_checked_v2(uuid,text,uuid,jsonb,text,integer,bigint)'::regprocedure);
  if position('inventory.delete' in v_def)=0 or position('REFERENCE_FAMILY_SCOPE_MISMATCH' in v_def)=0
     or position('capability_operation_audit' in v_def)=0 or position('deleted_at=now()' in replace(v_def,' ',''))=0
     or position('PRODUCT_OPEN_LOAN' in v_def)=0 or position('PRODUCT_RETURNABLE_HISTORY' in v_def)=0
     or position('PRODUCT_VERSION_CONFLICT' in v_def)=0 then
    raise exception 'H-114: faltan guardas, tombstone o idempotencia';
  end if;
  if position('delete_products_checked_v2' in pg_get_functiondef(
       'pos.delete_product_checked_v2(uuid,text,bigint,text,integer,bigint)'::regprocedure))=0 then
    raise exception 'H-114: V1/V2 individual no delega en la autoridad única';
  end if;
end $$;
