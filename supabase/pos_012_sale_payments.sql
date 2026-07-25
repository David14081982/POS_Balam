-- Trazabilidad financiera: un renglón inmutable por entrada de dinero.
-- No inventa pagos históricos; éstos quedan identificados por la ausencia de filas.
create table if not exists pos.sale_payments (
  id            text primary key,
  folio         text not null,
  fecha         text not null,
  tipo          text not null check (tipo in ('venta','anticipo','abono','liquidacion')),
  metodo        text not null,
  monto         numeric(12,2) not null check (monto > 0),
  efectivo      numeric(12,2) not null default 0 check (efectivo >= 0),
  tarjeta       numeric(12,2) not null default 0 check (tarjeta >= 0),
  transferencia numeric(12,2) not null default 0 check (transferencia >= 0),
  otro          numeric(12,2) not null default 0 check (otro >= 0),
  created_at    timestamptz not null default now(),
  constraint sale_payments_parts_match check (
    efectivo + tarjeta + transferencia + otro = monto
  )
);

create index if not exists sale_payments_folio_idx on pos.sale_payments (folio, fecha);
grant all on pos.sale_payments to anon, authenticated;
alter table pos.sale_payments enable row level security;
drop policy if exists auth_all on pos.sale_payments;
create policy auth_all on pos.sale_payments for all to authenticated using (true) with check (true);
