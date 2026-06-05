-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — Migración 006: Historial de liquidaciones de comisión           ║
-- ║  • pos.liquidations: registro de cada pago de comisión a un vendedor.        ║
-- ║    tipo 'liquidacion' = pago individual; 'corte' = pago del corte de mes.     ║
-- ║    Append-only (el POS nunca edita/borra filas); upsert idempotente por id.   ║
-- ║  Convención: RLS off + grant anon (igual que 001/002/005). _PEGAR-EN-SQL la    ║
-- ║  endurece (RLS ON + policy authenticated) junto al resto del dominio.          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists pos.liquidations (
  id          text primary key,
  seller_id   text,                            -- pos.sellers.id atribuido (puede quedar huérfano si se borra el vendedor)
  seller      text,                            -- nombre del vendedor al momento del pago (histórico)
  monto       numeric(10,2) not null default 0,
  tipo        text not null default 'liquidacion', -- 'liquidacion' | 'corte'
  fecha       text,                            -- 'YYYY-MM-DD HH:MM' (formato local del POS)
  updated_at  timestamptz not null default now()
);

-- Consulta típica: liquidaciones de un vendedor, más recientes primero.
create index if not exists liquidations_seller_idx on pos.liquidations (seller_id, fecha desc);

-- Permisos (alineado con 001/002/005; endurecer con RLS en _PEGAR-EN-SQL-EDITOR)
grant all on all tables in schema pos to anon, authenticated;
grant usage on all sequences in schema pos to anon, authenticated;

-- RLS: Supabase lo ACTIVA por defecto en tablas nuevas → sin policy bloquea TODO.
-- Lo desactivamos como en 001/002/005 (se endurece en la fase de deploy).
alter table pos.liquidations disable row level security;
