-- ════════════════════════════════════════════════════════════════════════════
--  BALAM — Pega TODO esto en Supabase → SQL Editor → New query → RUN.
--  Es seguro correrlo aunque ya lo hayas corrido antes (no duplica nada).
--  Junta: (1) tabla de promociones + costo, (2) seguridad RLS para el dominio.
--  ⚠ Córrelo DESPUÉS de tener creada la cuenta admin (Authentication → Add user).
-- ════════════════════════════════════════════════════════════════════════════

-- ── (1) Promociones + costo de producto ─────────────────────────────────────
alter table pos.products add column if not exists costo numeric(10,2) not null default 0;

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

-- ── (2) Seguridad: RLS ON + solo usuarios autenticados ──────────────────────
do $$
declare t text;
begin
  foreach t in array array['settings','lookup','products','clients','sellers','sales','sale_items','movements','promotions']
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
