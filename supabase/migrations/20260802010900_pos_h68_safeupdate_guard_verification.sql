-- Verificacion remota de la CAUSA de H-68: la guarda `safeupdate`.
--
-- 20260802010800 probo el COMPORTAMIENTO de la limpieza corregida. Esta migracion
-- prueba el DIAGNOSTICO, leyendolo del catalogo de la propia instalacion: sin
-- ella, «era safeupdate» seguiria siendo una hipotesis razonable en vez de un
-- hecho comprobado.
--
-- Lo que NO se puede hacer aqui, y se declara: `load 'safeupdate'` esta prohibido
-- para el rol de migraciones (`access to library "safeupdate" is not allowed`,
-- 42501), asi que la guarda no puede ARMARSE en esta sesion para ejecutar la
-- limpieza bajo ella. El vinculo queda cerrado por deduccion, no por conjetura:
-- la guarda solo rechaza sentencias sin WHERE, y la comprobacion de abajo afirma
-- que la frontera desplegada no tiene ninguna.

begin;

do $$
declare
  v_roles    text;
  v_def      text;
  v_stmt     text;
  v_bare     int := 0;
begin
  -- ── 1) La guarda existe en ESTA instalacion ───────────────────────────────
  -- Es lo que convierte un DELETE sin WHERE lanzado por el navegador (rol
  -- `authenticated`) en «DELETE requires a WHERE clause», mientras `db push`
  -- —que entra como `postgres`— aplicaba la misma funcion sin protestar.
  select string_agg(distinct coalesce(r.rolname, '<base>'), ',' order by coalesce(r.rolname, '<base>'))
    into v_roles
    from pg_db_role_setting s
    left join pg_roles r on r.oid = s.setrole
   where array_to_string(s.setconfig, ' ') like '%safeupdate%';

  if v_roles is null then
    raise exception 'H68G_SAFEUPDATE_NOT_CONFIGURED'
      using detail = 'Ningun rol ni base precarga safeupdate: el diagnostico de H-68 no se sostiene';
  end if;

  -- ── 2) La frontera desplegada no puede activarla ──────────────────────────
  -- Se lee del catalogo, no del archivo: es el cuerpo que de verdad ejecuta la
  -- base hoy. Cualquier DELETE o UPDATE sin WHERE que sobreviva aqui volveria a
  -- romper el boton en el navegador aunque `db push` pase en verde.
  v_def := pg_get_functiondef('pos.purge_test_data(text)'::regprocedure);

  for v_stmt in
    select m[1] from regexp_matches(
      v_def, '((?:delete\s+from|update)\s+pos\.[a-z_]+[^;]*;)', 'gi') as m
  loop
    if v_stmt !~* '\swhere\s' then
      v_bare := v_bare + 1;
      raise exception 'H68G_BARE_STATEMENT_SURVIVES: % [roles con safeupdate: %]',
        left(regexp_replace(v_stmt, '\s+', ' ', 'g'), 140), v_roles;
    end if;
  end loop;

  -- El detector tiene que saber señalar: si no, el cero de arriba no significa nada.
  if 'delete from pos.sales;' ~* '\swhere\s'
     or 'update pos.clients set compras = 0;' ~* '\swhere\s' then
    raise exception 'H68G_DETECTOR_BROKEN';
  end if;

  -- ── 3) Y la frontera sigue cerrada a quien no debe entrar ─────────────────
  if has_function_privilege('anon', 'pos.purge_test_data(text)', 'execute') then
    raise exception 'H68G_ANON_CAN_PURGE';
  end if;
  if not has_function_privilege('authenticated', 'pos.purge_test_data(text)', 'execute') then
    raise exception 'H68G_AUTHENTICATED_CANNOT_PURGE';
  end if;
end;
$$;

commit;
