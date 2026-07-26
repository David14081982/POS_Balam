-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — Migración 005: Promociones/Descuentos + costo de producto      ║
-- ║  • pos.products.costo: costo unitario (para validar margen en Descuentos).   ║
-- ║  • pos.promotions: descuentos que el POS aplica AUTOMÁTICAMENTE en la venta.  ║
-- ║    Acumulables (suma de % + suma de $) con tope de margen mínimo.            ║
-- ║    scope (jsonb) = filtros de alcance; vacío en una dimensión = sin filtro.   ║
-- ║  Convención actual: RLS off + grant anon (igual que 001/002). pos_004 (fase   ║
-- ║  deploy) lo endurece: incluir pos.promotions al activar RLS/políticas.        ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- 1) Costo de producto (default 0; el POS estima 45% del precio si falta en local)
alter table pos.products add column if not exists costo numeric(10,2) not null default 0;

-- 2) Tabla de promociones
create table if not exists pos.promotions (
  id          text primary key,
  nombre      text not null,
  tipo        text not null default 'pct',     -- 'pct' (%) | 'fijo' ($ por pieza)
  valor       numeric(10,2) not null default 0,
  inicio      date,                            -- null = sin fecha de inicio
  fin         date,                            -- null = indefinido
  hora_inicio text,                            -- 'HH:MM' opcional
  hora_fin    text,                            -- 'HH:MM' opcional
  pausado     boolean not null default false,
  scope       jsonb not null default '{}',     -- {cats,telas,mangas,cuellos,colores,tallas,modelos,orns}
  creado      bigint,
  updated_at  timestamptz not null default now()
);

-- Permisos (alineado con 001/002; endurecer en pos_004 con RLS)
grant all on all tables in schema pos to anon, authenticated;
grant usage on all sequences in schema pos to anon, authenticated;

-- RLS: Supabase lo ACTIVA por defecto en tablas nuevas → sin policy bloquea TODO.
-- Lo desactivamos como en 001/002 (se endurece en la fase de deploy, pos_004).
alter table pos.promotions disable row level security;
