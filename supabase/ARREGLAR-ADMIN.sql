-- ════════════════════════════════════════════════════════════════════════
--  ARREGLAR-ADMIN.sql  (versión 2 — robusta)
--  Hace admin REAL a tu cuenta de acceso en pos.sellers, tomando el correo
--  DIRECTO de Supabase Auth (auth.users), sin depender de cómo esté escrito.
--
--  CÓMO USARLO:
--    Supabase → proyecto Balam → SQL Editor → New query →
--    pega TODO → botón RUN.
--  Es seguro correrlo varias veces. Solo toca la cuenta admin@balamguayaberas.
--
--  IMPORTANTE: copia lo que salga en los bloques (1) y (3) y mándamelo.
-- ════════════════════════════════════════════════════════════════════════

-- ═══ (1) DIAGNÓSTICO — cómo están las cosas AHORA ═══
--  correo_login  = cuentas que pueden iniciar sesión (Supabase Auth)
--  correo_sellers= ficha correspondiente en pos.sellers (NULL = no hay match)
select u.email                                   as correo_login,
       s.email                                   as correo_sellers,
       s.role,
       s.active
  from auth.users u
  left join pos.sellers s
    on lower(btrim(s.email)) = lower(btrim(u.email))
 order by u.email;

-- ═══ (2) ARREGLO ═══
-- 2a) Si a tu cuenta de acceso le falta ficha en sellers, se la creamos (admin).
insert into pos.sellers (id, nombre, iniciales, color, role, email, active)
select gen_random_uuid()::text, 'Administrador', 'AD', '#131B2E', 'admin',
       lower(btrim(u.email)), true
  from auth.users u
 where u.email ilike '%admin@balamguayaberas.com%'
   and not exists (
     select 1 from pos.sellers s
      where lower(btrim(s.email)) = lower(btrim(u.email))
   );

-- 2b) Si ya tiene ficha, la dejamos como admin activa y con el correo limpio.
update pos.sellers s
   set role   = 'admin',
       active = true,
       email  = lower(btrim(u.email))
  from auth.users u
 where u.email ilike '%admin@balamguayaberas.com%'
   and lower(btrim(s.email)) = lower(btrim(u.email));

-- ═══ (3) VERIFICACIÓN — debe salir UNA fila con role=admin y active=true ═══
select u.email                                   as correo_login,
       s.email                                   as correo_sellers,
       s.role,
       s.active
  from auth.users u
  left join pos.sellers s
    on lower(btrim(s.email)) = lower(btrim(u.email))
 where u.email ilike '%admin@balamguayaberas.com%';
