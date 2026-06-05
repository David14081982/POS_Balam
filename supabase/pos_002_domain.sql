-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — Migración 002: tablas de DOMINIO (productos, clientes, ventas) ║
-- ║  Schema `pos`. Hoy el POS las maneja LOCAL (localStorage); esto es el destino ║
-- ║  nube. El seam store.jsx aún NO sincroniza estas tablas (pendiente).         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create table if not exists pos.products (
  id         text primary key,
  cat        text not null,            -- FK lógica → pos.lookup(category)
  manga      text not null,            --                     (sleeve)
  tela       text not null,            --                     (fabric)
  color      text not null,            --                     (color)
  cuello     text not null default 'NOR',
  modelo     text not null,
  nombre     text not null,
  orn        text default '—',
  orn_colors jsonb not null default '[]',
  precio     numeric(10,2) not null default 0,
  pop        boolean not null default false,
  stock      jsonb not null default '[]',   -- [{talla,escala,stock}] 20 entradas
  imagen     text,
  sku        text,                          -- derivado; índice para búsqueda
  updated_at timestamptz not null default now()
);
create index if not exists pos_products_sku_idx on pos.products (sku);

create table if not exists pos.clients (
  id         text primary key,
  nombre     text not null,
  tel        text,
  email      text,
  direccion  text,
  talla      text,
  notas      text,
  compras    int not null default 0,
  total      numeric(12,2) not null default 0,
  ultima     date,
  nacimiento date,
  generic    boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists pos.sellers (
  id           text primary key,
  nombre       text not null,
  iniciales    text,
  color        text,
  comision_pct numeric(5,2) not null default 0,
  meta_mes     numeric(12,2) not null default 0,
  ventas_mes   numeric(12,2) not null default 0,
  ventas_num   int not null default 0,
  comision_acum numeric(12,2) not null default 0,
  bono         text,
  updated_at   timestamptz not null default now()
);

create table if not exists pos.sales (
  folio      text primary key,
  fecha      timestamptz not null default now(),
  cliente_id text references pos.clients(id),
  cliente    text,                          -- snapshot del nombre
  vendedores jsonb not null default '[]',   -- [seller_id]
  metodo     text not null,                 -- FK lógica → pos.lookup(payment_method)
  estado     text not null,                 --                   (sale_status)
  items      int not null default 0,
  total      numeric(12,2) not null default 0,
  anticipo   numeric(12,2),                 -- para apartados
  updated_at timestamptz not null default now()
);

create table if not exists pos.sale_items (
  id        bigint generated always as identity primary key,
  folio     text not null references pos.sales(folio) on delete cascade,
  sku       text,
  nombre    text,
  talla     text,
  qty       int not null,
  precio    numeric(10,2) not null
);
create index if not exists pos_sale_items_folio_idx on pos.sale_items (folio);

create table if not exists pos.movements (
  id        bigint generated always as identity primary key,
  fecha     timestamptz not null default now(),
  tipo      text not null,                  -- FK lógica → pos.lookup(movement_type)
  producto  text,
  sku       text,
  cant      int not null,
  ref       text
);

-- Permisos (alineado con migración 001; endurecer en fase auth con RLS)
grant all on all tables in schema pos to anon, authenticated;
grant usage on all sequences in schema pos to anon, authenticated;
alter default privileges in schema pos grant all on tables to anon, authenticated;
alter default privileges in schema pos grant all on sequences to anon, authenticated;

-- RLS: Supabase lo ACTIVA por defecto en tablas nuevas → sin policy bloquea TODO
-- (insert da 42501). Lo desactivamos como en 001 (endurecer en fase auth).
alter table pos.products   disable row level security;
alter table pos.clients    disable row level security;
alter table pos.sellers    disable row level security;
alter table pos.sales      disable row level security;
alter table pos.sale_items disable row level security;
alter table pos.movements  disable row level security;

-- Pendiente código: extender store.jsx con pushSale/pushProduct/pull de dominio +
-- cola offline (editar sin red → sync al reconectar). Hoy local-first en localStorage.
