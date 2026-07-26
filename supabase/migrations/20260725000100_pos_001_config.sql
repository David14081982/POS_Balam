-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — Migración 001: módulo de Configuración (catálogos + ajustes)   ║
-- ║  Proyecto Supabase: telohdbvbvsfmwyriflz                                    ║
-- ║                                                                            ║
-- ║  ⚠ AISLAMIENTO: la base es COMPARTIDA con "BALAM Antigravity" (probador     ║
-- ║  virtual: catalog_garments, companies, users, …). Para no colisionar, el    ║
-- ║  POS vive en su PROPIO schema `pos`. Ejecuta este script en el SQL Editor.  ║
-- ║  Espeja exactamente las semillas de balam/config.jsx (local-first).         ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

create schema if not exists pos;

-- ── Parámetros sueltos (key/value) ──────────────────────────────────────────
create table if not exists pos.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── Catálogos genéricos (lookup) ────────────────────────────────────────────
-- `code` es estable y entra en el SKU (cat-manga-tela-color-modelo): NO renombrar
-- ni borrar codes en uso; desactivar con active=false.
create table if not exists pos.lookup (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,                 -- category | fabric | sleeve | neck | color | ornament | size_letter | size_number | payment_method | sale_status | movement_type | seller_role | fit | premium_fabric | country_code
  code       text not null,
  label      text not null,
  active     boolean not null default true,
  meta       jsonb not null default '{}',   -- color→{hex}, sale_status→{tone}, payment_method→{icon}, seller_role→{minPct}
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  unique (kind, code)
);
create index if not exists pos_lookup_kind_idx on pos.lookup (kind, sort_order);

-- RLS: por ahora alineado con el resto del proyecto (desactivado). Endurecer en fase auth.
alter table pos.settings disable row level security;
alter table pos.lookup   disable row level security;

-- ── Semilla: parámetros ─────────────────────────────────────────────────────
insert into pos.settings (key, value) values
  ('store.name',                '"Balam Guayaberas"'),
  ('store.rfc',                 '"XAXX010101000"'),
  ('store.address',             '"Calle 60 #412, Centro, Mérida, Yuc."'),
  ('store.phone',               '"999 924 0011"'),
  ('currency',                  '"MXN"'),
  ('tax.ivaPct',                '16'),
  ('tax.included',              'true'),
  ('stock.lowThreshold',        '4'),
  ('client.recurrentThreshold', '3'),
  ('commission.basePct',        '5'),
  ('commission.monthlyGoal',    '200000'),
  ('commission.bonus',          '2000'),
  ('commission.auto',           'true'),
  ('report.marginPct',          '33'),
  ('folio.prefix',              '"BG-"'),
  ('ticket.footer',             '"¡Gracias por su compra! Máximo 7 días para cambios."'),
  ('pos.askSize',               'true'),
  ('pos.allowLayaway',          'true'),
  ('pos.sound',                 'true'),
  ('pos.validateStock',         'true'),
  ('print.auto',                'false'),
  ('print.lowStockAlert',       'true')
on conflict (key) do nothing;

-- ── Semilla: catálogos ──────────────────────────────────────────────────────
insert into pos.lookup (kind, code, label, meta, sort_order) values
  -- Categorías
  ('category','10','Guayabera Blanca','{}',0),
  ('category','21','Guayabera Color','{}',1),
  ('category','20','Camisa','{}',2),
  ('category','30','Pantalón','{}',3),
  -- Telas
  ('fabric','ALG','Algodón','{}',0),
  ('fabric','POL','Poliéster','{}',1),
  ('fabric','MNT','Mantequilla','{}',2),
  ('fabric','AJSP','Ajuar Especial','{}',3),
  -- Mangas
  ('sleeve','MC','Manga Corta','{}',0),
  ('sleeve','ML','Manga Larga','{}',1),
  -- Cuellos
  ('neck','NOR','Normal / Clásico','{}',0),
  ('neck','MAO','Mao (chino)','{}',1),
  ('neck','ITA','Italiano','{}',2),
  ('neck','CER','Cerrado / Sport','{}',3),
  -- Colores (meta.hex)
  ('color','BL','Blanco','{"hex":"#f3f4f6"}',0),
  ('color','BE','Beige','{"hex":"#d8c4a0"}',1),
  ('color','AZ','Azul Cielo','{"hex":"#3b6fb0"}',2),
  ('color','NE','Negro','{"hex":"#1c1f24"}',3),
  ('color','VI','Vino','{"hex":"#6b2230"}',4),
  ('color','HU','Hueso','{"hex":"#e8e2d4"}',5),
  ('color','AC','Azul Acero','{"hex":"#4a6b8a"}',6),
  ('color','MR','Azul Marino','{"hex":"#1e2a44"}',7),
  ('color','AR','Arena','{"hex":"#c9b896"}',8),
  ('color','GR','Gris','{"hex":"#8b9099"}',9),
  ('color','CF','Café','{"hex":"#5a4334"}',10),
  ('color','RS','Rosa','{"hex":"#d99bb0"}',11),
  ('color','ML','Melón','{"hex":"#e8a06a"}',12),
  ('color','KK','Kaky','{"hex":"#7a7250"}',13),
  ('color','MZ','Mezclilla Azul','{"hex":"#3a4d6b"}',14),
  ('color','OR','Oro','{"hex":"#caa83a"}',15),
  ('color','PL','Plata','{"hex":"#c8ccd2"}',16),
  ('color','RJ','Rojo','{"hex":"#b23b3b"}',17),
  ('color','VE','Verde','{"hex":"#3d8c5a"}',18),
  -- Ornamentos
  ('ornament','Bordado Eléctrico','Bordado Eléctrico','{}',0),
  ('ornament','Alforza','Alforza','{}',1),
  ('ornament','—','Sin ornamento','{}',2),
  -- Tallas letra
  ('size_letter','XS','XS','{}',0),('size_letter','S','S','{}',1),('size_letter','M','M','{}',2),
  ('size_letter','L','L','{}',3),('size_letter','XL','XL','{}',4),('size_letter','2XL','2XL','{}',5),
  ('size_letter','3XL','3XL','{}',6),('size_letter','4XL','4XL','{}',7),('size_letter','5XL','5XL','{}',8),
  ('size_letter','6XL','6XL','{}',9),
  -- Tallas número
  ('size_number','34','34','{}',0),('size_number','36','36','{}',1),('size_number','38','38','{}',2),
  ('size_number','40','40','{}',3),('size_number','42','42','{}',4),('size_number','44','44','{}',5),
  ('size_number','46','46','{}',6),('size_number','48','48','{}',7),('size_number','50','50','{}',8),
  ('size_number','52','52','{}',9),
  -- Métodos de pago (meta.icon)
  ('payment_method','Efectivo','Efectivo','{"icon":"cash"}',0),
  ('payment_method','Tarjeta','Tarjeta','{"icon":"card"}',1),
  ('payment_method','Transferencia','Transferencia','{"icon":"transfer"}',2),
  ('payment_method','Mixto','Mixto','{"icon":"split"}',3),
  ('payment_method','Apartado','Apartado','{"icon":"clock"}',4),
  -- Estatus de venta (meta.tone)
  ('sale_status','Pagado','Pagado','{"tone":"success"}',0),
  ('sale_status','Apartado','Apartado','{"tone":"warning"}',1),
  ('sale_status','Pendiente','Pendiente','{"tone":"info"}',2),
  ('sale_status','Cancelado','Cancelado','{"tone":"danger"}',3),
  ('sale_status','Entregado','Entregado','{"tone":"success"}',4),
  ('sale_status','Enviado','Enviado','{"tone":"info"}',5),
  ('sale_status','En Ajuste','En Ajuste','{"tone":"warning"}',6),
  -- Tipos de movimiento
  ('movement_type','Entrada','Entrada','{}',0),
  ('movement_type','Venta','Venta','{}',1),
  ('movement_type','Ajuste','Ajuste','{}',2),
  ('movement_type','Transferencia','Transferencia','{}',3),
  -- Roles de vendedor (meta.minPct)
  ('seller_role','senior','Heritage Senior Associate','{"minPct":5}',0),
  ('seller_role','consultant','Artisanal Consultant','{"minPct":0}',1),
  -- Fit (CRM)
  ('fit','Slim','Slim','{}',0),('fit','Regular','Regular','{}',1),('fit','Tailored','Tailored','{}',2),
  -- Telas premium (CRM)
  ('premium_fabric','Lino Artesanal','Lino Artesanal','{}',0),
  ('premium_fabric','Algodón Egipcio','Algodón Egipcio','{}',1),
  ('premium_fabric','Seda Italiana','Seda Italiana','{}',2),
  -- Códigos de país (CRM)
  ('country_code','+52','México (+52)','{}',0),
  ('country_code','+1','EE. UU. / Canadá (+1)','{}',1),
  ('country_code','+34','España (+34)','{}',2)
on conflict (kind, code) do nothing;

-- ── Próximas migraciones (fuera de este script): tablas de DOMINIO ──────────
--   pos.products, pos.clients, pos.sellers, pos.sales, pos.sale_items, pos.movements
--   (hoy el POS las maneja en localStorage; migrarlas es la fase nube siguiente).
