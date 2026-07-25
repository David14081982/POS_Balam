-- ════════════════════════════════════════════════════════════════════════
--  ARREGLAR-ADMIN.sql
--  Hace que la cuenta  admin@balamguayaberas.com  sea ADMINISTRADOR REAL en
--  pos.sellers, para poder crear / editar / borrar usuarios desde el sistema.
--
--  Causa del problema: la fila admin sembrada quedó con el correo antiguo
--  (admin@balam.com), pero tú inicias sesión con admin@balamguayaberas.com.
--  La Edge Function busca por correo exacto y no la encontraba → "Solo un
--  administrador puede gestionar usuarios".
--
--  CÓMO USARLO:
--    Supabase → (tu proyecto Balam) → SQL Editor → New query →
--    pega TODO esto → botón RUN.
--  Es seguro correrlo varias veces (no duplica ni borra nada).
-- ════════════════════════════════════════════════════════════════════════

-- 1) Si existe la fila con el correo viejo, cámbiale el correo al real.
update pos.sellers
   set email = 'admin@balamguayaberas.com'
 where lower(email) = 'admin@balam.com'
   and not exists (select 1 from pos.sellers s where lower(s.email) = 'admin@balamguayaberas.com');

-- 2) Si todavía NO hay ninguna fila con el correo real, créala como admin.
insert into pos.sellers (id, nombre, iniciales, color, role, email, active)
select gen_random_uuid()::text, 'Administrador', 'AD', '#131B2E', 'admin', 'admin@balamguayaberas.com', true
 where not exists (select 1 from pos.sellers where lower(email) = 'admin@balamguayaberas.com');

-- 3) Asegura que esa fila esté en minúsculas, con rol admin y activa.
update pos.sellers
   set email  = lower(email),
       role   = 'admin',
       active = true
 where lower(email) = 'admin@balamguayaberas.com';

-- 4) Verificación: debe salir UNA fila con role = admin y active = true.
select id, nombre, email, role, active
  from pos.sellers
 where lower(email) = 'admin@balamguayaberas.com';
