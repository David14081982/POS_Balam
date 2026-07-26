-- H-03: snapshot monetario inmutable por venta.
-- No reescribe ventas históricas; las columnas quedan NULL en filas anteriores.
alter table pos.sales
  add column if not exists subtotal numeric(12,2),
  add column if not exists iva numeric(12,2),
  add column if not exists iva_pct numeric(5,2),
  add column if not exists iva_included boolean,
  add column if not exists saldo numeric(12,2),
  add column if not exists pago_efectivo numeric(12,2),
  add column if not exists pago_otro numeric(12,2);

alter table pos.sales
  drop constraint if exists sales_amounts_valid,
  add constraint sales_amounts_valid check (
    total >= 0
    and (anticipo is null or anticipo >= 0)
    and (anticipo is null or anticipo <= total)
    and (saldo is null or saldo >= 0)
    and (saldo is null or anticipo is null or saldo = total - anticipo)
    and (subtotal is null or subtotal >= 0)
    and (iva is null or iva >= 0)
    and (
      metodo in ('Apartado', 'Cortesía')
      or pago_efectivo is null
      or pago_otro is null
      or pago_efectivo + pago_otro = total
    )
  );
