-- H-35 · Corrección de permisos de pos.line_consumption
--
-- Defecto detectado por la verificación 20260728005000 al aplicarse sobre la
-- base real: la vista quedó legible por `authenticated`.
--
-- Causa raíz: el esquema `pos` tiene privilegios por defecto instalados
--
--     defaclobjtype 'r' -> {authenticated=arwdDxtm/postgres,
--                           service_role=arwdDxtm/postgres}
--
-- de modo que TODA relación creada en `pos` recibe automáticamente permisos
-- completos para `authenticated`. Una vista es una relación. La migración
-- 20260728004700 escribió `revoke all ... from public`, que retira el permiso
-- de PUBLIC pero NO el concedido nominalmente al rol `authenticated`. Para
-- funciones no existe privilegio por defecto en `pos`, y por eso el mismo
-- `revoke from public` sí bastó en `pos.sale_line_balance()`: tablas y
-- funciones no se comportan igual ante `alter default privileges`.
--
-- Se corrige con DOS medidas, no una:
--
--   1. El `revoke` explícito cierra la exposición actual.
--   2. `security_invoker = true` es la defensa de fondo: si un privilegio por
--      defecto vuelve a conceder la vista, quien la consulte lo hará con sus
--      propios permisos y el RLS de `sale_items` y `return_items` se aplicará
--      de nuevo. Sin esto dependeríamos de que nadie recree el objeto sin
--      acordarse del `revoke`.
--
-- Alcance: únicamente los permisos y la opción de pos.line_consumption. No se
-- toca la definición de la vista, ni pos.sale_line_balance(), ni
-- pos.commit_return(), ni ningún otro objeto.

-- 1) Defensa de fondo: la vista deja de ejecutarse con los permisos de su
--    dueño, por lo que el RLS de las tablas subyacentes vuelve a aplicarse.
alter view pos.line_consumption set (security_invoker = true);

-- 2) Cierre de la exposición: se retira el grant que instalaron los
--    privilegios por defecto. `anon` se revoca también aunque hoy no lo
--    tenga, para que el estado deseado sea explícito y no dependa de cuál
--    fuera el privilegio por defecto vigente al crear la vista.
revoke all on pos.line_consumption from authenticated;
revoke all on pos.line_consumption from anon;
revoke all on pos.line_consumption from public;

-- 3) El único lector autorizado sigue siendo service_role, que es quien
--    ejecuta pos.sale_line_balance() y pos.commit_return().
grant select on pos.line_consumption to service_role;

comment on view pos.line_consumption is
  'H-35: consumos de unidades vendidas por documento. El modulo de Cambios anade aqui su rama. Interna: solo service_role, con security_invoker.';

-- 4) Comprobación inmediata en la misma transacción. Si cualquiera de las dos
--    medidas no quedó asentada, esta migración aborta y no se registra.
do $$
declare
  v_invoker text;
begin
  if has_table_privilege('authenticated', 'pos.line_consumption', 'select') then
    raise exception 'H-35: line_consumption sigue legible por authenticated tras el revoke';
  end if;
  if has_table_privilege('anon', 'pos.line_consumption', 'select') then
    raise exception 'H-35: line_consumption sigue legible por anon tras el revoke';
  end if;
  if not has_table_privilege('service_role', 'pos.line_consumption', 'select') then
    raise exception 'H-35: service_role perdió la lectura de line_consumption';
  end if;

  select option_value into v_invoker
    from pg_options_to_table(
      (select c.reloptions
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'pos' and c.relname = 'line_consumption')
    )
   where option_name = 'security_invoker';

  if v_invoker is null or lower(v_invoker) not in ('true', 'on', '1') then
    raise exception 'H-35: security_invoker no quedó activado en line_consumption';
  end if;

  raise notice 'H-35: permisos corregidos · solo service_role · security_invoker activo';
end;
$$;
