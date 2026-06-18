-- ════════════════════════════════════════════════════════════════════════════
--  BALAM — Pega TODO esto en Supabase → SQL Editor → New query → RUN.
--  Es seguro correrlo aunque ya lo hayas corrido antes (no duplica nada).
--  Junta: (1) tabla de promociones + costo, (2) seguridad RLS para el dominio.
--  ⚠ Córrelo DESPUÉS de tener creada la cuenta admin (Authentication → Add user).
-- ════════════════════════════════════════════════════════════════════════════

-- ── (1) Promociones + costo de producto ─────────────────────────────────────
alter table pos.products add column if not exists costo numeric(10,2) not null default 0;

-- Fecha de nacimiento del cliente (alimenta la tarjeta de Cumpleaños del Panel de control).
alter table pos.clients add column if not exists nacimiento date;

-- ── (1.2) Códigos de barras (opcional): URLs de las imágenes guardadas en Storage ──
-- Mapa { talla: url } por producto. El código en sí se deriva de SKU+talla, no se guarda.
alter table pos.products add column if not exists barcode_urls jsonb not null default '{}';

-- ── (1.3) Atributos de catálogos creados por el admin (Fase 2) ──────────────────
-- Mapa { kind: code } por producto, p. ej. { temporada: 'VER25', coleccion: 'GALA' }.
-- Los catálogos del sistema (cat/manga/tela/color/cuello) siguen en sus columnas propias.
alter table pos.products add column if not exists attrs jsonb not null default '{}';

-- ── (1.4) Cortesías (regalos/giveaways): valor regalado por venta ───────────────
-- La venta se guarda con total = 0 (no se cobró). Aquí guardamos lo que se habría cobrado
-- para los reportes de "cuánto se ha regalado". Solo se llena en ventas con método 'Cortesía'.
alter table pos.sales add column if not exists valor_regalado numeric(12,2) not null default 0;

-- Bucket público para los PNG de etiquetas. Lectura pública (bucket public);
-- escritura solo para usuarios autenticados (la terminal con sesión).
insert into storage.buckets (id, name, public)
values ('barcodes', 'barcodes', true)
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'barcodes_auth_write') then
    create policy "barcodes_auth_write" on storage.objects for all to authenticated
      using (bucket_id = 'barcodes') with check (bucket_id = 'barcodes');
  end if;
end $$;

create table if not exists pos.promotions (
  id          text primary key,
  nombre      text not null,
  tipo        text not null default 'pct',
  valor       numeric(10,2) not null default 0,
  inicio      date,
  fin         date,
  hora_inicio text,
  hora_fin    text,
  pausado     boolean not null default false,
  scope       jsonb not null default '{}',
  creado      bigint,
  updated_at  timestamptz not null default now()
);

-- ── (1.5) Devoluciones (cabecera + renglones) ───────────────────────────────
create table if not exists pos.returns (
  id          text primary key,
  folio       text,
  cliente     text,
  vendedores  jsonb not null default '[]',
  metodo      text,
  total       numeric(12,2) not null default 0,
  notas       text,
  fecha       text,
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
  motivo    text,
  precio    numeric(10,2) not null default 0
);
create index if not exists pos_return_items_rid_idx on pos.return_items (return_id);

-- ── (1.6) Historial de liquidaciones de comisión ────────────────────────────
create table if not exists pos.liquidations (
  id          text primary key,
  seller_id   text,
  seller      text,
  monto       numeric(10,2) not null default 0,
  tipo        text not null default 'liquidacion',  -- 'liquidacion' | 'corte'
  fecha       text,
  updated_at  timestamptz not null default now()
);
create index if not exists liquidations_seller_idx on pos.liquidations (seller_id, fecha desc);

-- ── (2) Seguridad: RLS ON + solo usuarios autenticados ──────────────────────
do $$
declare t text;
begin
  foreach t in array array['settings','lookup','products','clients','sellers','sales','sale_items','movements','promotions','returns','return_items','liquidations']
  loop
    execute format('alter table pos.%I enable row level security', t);
    execute format('drop policy if exists auth_all on pos.%I', t);
    execute format('create policy auth_all on pos.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Quitar acceso a visitantes anónimos (con el link ya NO pueden leer/editar datos).
revoke all on all tables in schema pos from anon;
revoke all on all sequences in schema pos from anon;
revoke usage on schema pos from anon;
alter default privileges in schema pos revoke all on tables from anon;
alter default privileges in schema pos revoke all on sequences from anon;

-- Mantener acceso a usuarios autenticados (los que inician sesión).
grant usage on schema pos to authenticated;
grant all on all tables in schema pos to authenticated;
grant usage on all sequences in schema pos to authenticated;
alter default privileges in schema pos grant all on tables to authenticated;
alter default privileges in schema pos grant all on sequences to authenticated;

-- Frase del ticket.
update pos.settings set value = '"¡Gracias por su compra! Máximo 7 días para cambios."'
where key = 'ticket.footer';
