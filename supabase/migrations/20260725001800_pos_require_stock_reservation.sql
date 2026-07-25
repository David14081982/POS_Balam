-- POS Balam — Migración 018: una venta cobrada exige reserva H-01.

begin;

alter table pos.sales
  add column if not exists operation_id text;

create unique index if not exists sales_operation_id_uidx
  on pos.sales (operation_id)
  where operation_id is not null;

create or replace function pos.require_sale_stock_reservation()
returns trigger
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
begin
  -- Apartados y cancelaciones no retiran inventario todavía.
  if new.estado in ('Apartado', 'Cancelado') then
    return new;
  end if;

  -- Una venta histórica ya existente sin operation_id continúa actualizable.
  if tg_op = 'UPDATE'
     and old.operation_id is null
     and new.operation_id is null then
    return new;
  end if;

  if nullif(trim(new.operation_id), '') is null
     or not exists (
       select 1
         from pos.stock_reservations r
        where r.operation_id = new.operation_id
          and r.folio = new.folio
     ) then
    raise exception 'La venta no tiene una reserva de inventario confirmada'
      using errcode = 'P0001',
            hint = 'Ejecute pos.reserve_sale_stock antes de guardar la venta';
  end if;

  return new;
end;
$$;

drop trigger if exists sales_require_stock_reservation on pos.sales;
create trigger sales_require_stock_reservation
before insert or update on pos.sales
for each row execute function pos.require_sale_stock_reservation();

commit;
