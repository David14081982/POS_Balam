-- H-83: verificación estructural y publicación del contrato de esquema.
begin;

do $$
declare
  v_missing text;
begin
  select string_agg(expected.table_name || '.' || expected.column_name, ', ')
  into v_missing
  from (values
    ('sale_items', 'ornamento'), ('sale_items', 'orn_colors'),
    ('return_items', 'ornamento'), ('return_items', 'orn_colors'),
    ('exchange_items', 'ornamento'), ('exchange_items', 'orn_colors')
  ) as expected(table_name, column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'pos' and c.table_name = expected.table_name
      and c.column_name = expected.column_name
  );
  if v_missing is not null then
    raise exception 'H-83: faltan columnas: %', v_missing;
  end if;
  if to_regprocedure('pos.commit_sale_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)') is null
     or to_regprocedure('pos.commit_sale_with_additional_discount_checked(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)') is null
     or to_regprocedure('pos.commit_return_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,boolean)') is null
     or to_regprocedure('pos.commit_exchange_checked(text,jsonb,jsonb,jsonb,jsonb,jsonb)') is null then
    raise exception 'H-83: faltan fronteras transaccionales';
  end if;
end;
$$;

update pos.system_manifest
set schema_version = greatest(schema_version, 20260808012700), updated_at = now()
where singleton;

commit;
