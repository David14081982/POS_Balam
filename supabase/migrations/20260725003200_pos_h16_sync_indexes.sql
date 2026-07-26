-- H-16: índices de las dos consultas filtradas del pull de ventas.

create index if not exists sales_fecha_folio_idx
  on pos.sales (fecha, folio);

create index if not exists sales_apartado_folio_idx
  on pos.sales (folio)
  where estado = 'Apartado';

do $$
begin
  if to_regclass('pos.sales_fecha_folio_idx') is null
     or to_regclass('pos.sales_apartado_folio_idx') is null then
    raise exception 'H16_SYNC_INDEX_MISSING';
  end if;
end;
$$;
