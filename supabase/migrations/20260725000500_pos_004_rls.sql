-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  POS Balam — Migración 004: SEGURIDAD (RLS) para deploy público             ║
-- ║  CORRER SOLO AL PUBLICAR EN UN DOMINIO. Endurece la base:                    ║
-- ║   • RLS ON en todo pos.* → 'anon' NO puede leer/escribir nada.               ║
-- ║   • 'authenticated' (la terminal con sesión Supabase Auth) tiene acceso.     ║
-- ║   La llave anon embebida en el HTML deja de ser un riesgo.                   ║
-- ║  ⚠ ORDEN: correr DESPUÉS de pos_001/002/003/005 (las tablas deben existir).  ║
-- ║  ⚠ Tras correr esto, el cliente DEBE iniciar sesión (cuenta dueño) o no       ║
-- ║    sincroniza. Crear la cuenta: Dashboard → Authentication → Add user        ║
-- ║    (Auto Confirm), o supabase/create-owner.mjs.                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- 1) RLS ON + política única (acceso total al rol authenticated) por tabla.
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

-- 2) Quitar acceso a anon (mantener authenticated).
revoke all on all tables in schema pos from anon;
revoke all on all sequences in schema pos from anon;
revoke usage on schema pos from anon;
alter default privileges in schema pos revoke all on tables from anon;
alter default privileges in schema pos revoke all on sequences from anon;

grant usage on schema pos to authenticated;
grant all on all tables in schema pos to authenticated;
grant usage on all sequences in schema pos to authenticated;
alter default privileges in schema pos grant all on tables to authenticated;
alter default privileges in schema pos grant all on sequences to authenticated;

-- 3) Frase del ticket (cambio pedido): "Máximo 7 días para cambios".
update pos.settings set value = '"¡Gracias por su compra! Máximo 7 días para cambios."'
where key = 'ticket.footer';
