do $$
declare v_body text;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'pos' and table_name = 'sales'
       and column_name = 'receipt_snapshot' and data_type = 'jsonb'
  ) then raise exception 'H85: falta pos.sales.receipt_snapshot'; end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'pos.sales'::regclass
       and conname = 'sales_receipt_snapshot_shape_ck'
  ) then raise exception 'H85: falta validacion del snapshot'; end if;

  if not has_function_privilege('authenticated',
    'pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)', 'execute')
     or has_function_privilege('anon',
    'pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)', 'execute')
  then raise exception 'H85: privilegios invalidos'; end if;

  if to_regprocedure(
    'pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'
  ) is null then
    raise exception 'H85: falta commit de venta con descuento adicional';
  end if;

  select pg_get_functiondef('pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)'::regprocedure)
    into v_body;
  if position('receipt_snapshot' in v_body) = 0
     or position('receipt_snapshot is null' in v_body) = 0
  then raise exception 'H85: el commit no conserva inmutable el snapshot'; end if;
end;
$$;
