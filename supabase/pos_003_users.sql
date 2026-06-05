-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — Migración 003: usuarios/roles sobre pos.sellers                ║
-- ║  Se UNIFICA "usuarios" y "vendedores" en pos.sellers (una persona puede ser  ║
-- ║  admin y vendedor a la vez). El admin inicia sesión con email+contraseña;    ║
-- ║  los vendedores NO inician sesión (se eligen por venta en el picker).        ║
-- ║  ⚠ password_hash = SHA-256+salt del cliente: DISUASIVO, no auth real.        ║
-- ║    Seguridad real = Supabase Auth (fase posterior).                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

alter table pos.sellers add column if not exists email         text;
alter table pos.sellers add column if not exists password_hash text;
alter table pos.sellers add column if not exists role          text not null default 'vendedor';
alter table pos.sellers add column if not exists avatar_url    text;
alter table pos.sellers add column if not exists active        boolean not null default true;

-- email único cuando existe (vendedores pueden no tener email)
create unique index if not exists pos_sellers_email_idx on pos.sellers (lower(email)) where email is not null;

-- Los 3 vendedores actuales quedan como 'vendedor' activos (default ya lo cubre)
update pos.sellers set role = 'vendedor' where role is null;

-- Admin/dueño (sin contraseña aún → la crea en el primer inicio de sesión).
insert into pos.sellers (id, nombre, iniciales, color, comision_pct, meta_mes, ventas_mes, ventas_num, comision_acum, bono, role, email, active)
values ('s0', 'Juan Balam', 'JB', '#131B2E', 0, 0, 0, 0, 0, 'Sin bono', 'admin', 'admin@balam.com', true)
on conflict (id) do nothing;

-- RLS ya desactivado en pos.sellers (migración 002). Grants ya aplicados.
