-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — Migración 007: Devoluciones                                     ║
-- ║  • pos.returns: cabecera de cada devolución (folio original, cliente,        ║
-- ║    método de reembolso, total reembolsado, notas).                           ║
-- ║  • pos.return_items: renglones devueltos (sku, talla, qty, motivo, precio).  ║
-- ║    motivo = code de pos.lookup(return_reason) — catálogo editable por admin.  ║
-- ║  Nota: folio NO es FK (una venta semilla puede no existir en la nube; evita   ║
-- ║  fallos de inserción). El reingreso de stock se asienta en pos.movements      ║
-- ║  como tipo 'Devolución' (cant positiva).                                       ║
-- ║  Convención: RLS off + grant anon (igual que 002/005/006). _PEGAR-EN-SQL la    ║
-- ║  endurece (RLS ON + policy authenticated) junto al resto del dominio.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists pos.returns (
  id          text primary key,
  folio       text,                            -- venta original (FK lógica → pos.sales.folio)
  cliente     text,                            -- snapshot del nombre
  vendedores  jsonb not null default '[]',     -- [seller_id] atribuidos en la venta original
  metodo      text,                            -- método de reembolso (lookup payment_method)
  total       numeric(12,2) not null default 0, -- monto reembolsado
  notas       text,
  fecha       text,                            -- 'YYYY-MM-DD HH:MM' (formato local del POS)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists pos_returns_folio_idx on pos.returns (folio);

create table if not exists pos.return_items (
  id        bigint generated always as identity primary key,
  return_id text not null references pos.returns(id) on delete cascade,
  sku       text,
  nombre    text,
  talla     text,
  qty       int not null,
  motivo    text,                              -- code de pos.lookup(return_reason)
  precio    numeric(10,2) not null default 0
);
create index if not exists pos_return_items_rid_idx on pos.return_items (return_id);

-- Permisos (alineado con 002/005/006; endurecer con RLS en _PEGAR-EN-SQL-EDITOR)
grant all on all tables in schema pos to anon, authenticated;
grant usage on all sequences in schema pos to anon, authenticated;

-- RLS: Supabase lo ACTIVA por defecto en tablas nuevas → sin policy bloquea TODO.
-- Lo desactivamos como en el resto del dominio (se endurece en la fase de deploy).
alter table pos.returns      disable row level security;
alter table pos.return_items disable row level security;
