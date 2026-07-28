-- POS Balam — H-33: alias histórico del folio impreso.
--
-- El folio que se imprime en el ticket no cambia nunca. En el único caso
-- residual en que la nube obliga a reidentificar una venta —dos terminales sin
-- bloque que además comparten código de terminal, o una operación heredada de
-- H-02 todavía en cola— el folio impreso se conserva aquí para siempre y sigue
-- resolviendo búsqueda, devolución y reimpresión desde cualquier terminal.
--
-- Es una columna aditiva. No modifica commit_sale, commit_return, importes,
-- IVA, descuentos, promociones ni comisiones. Las ventas existentes quedan con
-- un arreglo vacío, que significa «su folio impreso es el vigente».

begin;

alter table pos.sales
  add column if not exists folio_aliases jsonb not null default '[]'::jsonb;

alter table pos.sales
  drop constraint if exists sales_folio_aliases_chk;
alter table pos.sales
  add constraint sales_folio_aliases_chk
  check (jsonb_typeof(folio_aliases) = 'array');

-- Búsqueda por folio impreso: `folio_aliases @> '["BG-260727-0001-K7Q"]'`.
create index if not exists sales_folio_aliases_idx
  on pos.sales using gin (folio_aliases jsonb_path_ops);

comment on column pos.sales.folio_aliases is
  'H-33: folios ya impresos que esta venta tuvo antes de reidentificarse. Nunca se borran.';

do $$
declare
  v_dirty bigint;
begin
  select count(*) into v_dirty from pos.sales where jsonb_typeof(folio_aliases) <> 'array';
  if v_dirty > 0 then
    raise exception 'H-33: % venta(s) quedaron con alias inválido', v_dirty;
  end if;
  raise notice 'H-33: pos.sales.folio_aliases disponible; ninguna venta existente cambió de folio';
end;
$$;

commit;
