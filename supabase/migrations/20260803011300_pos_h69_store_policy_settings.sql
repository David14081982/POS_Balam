-- H-69 (continuacion) - La politica de la tienda vivia en dos sitios.
--
-- DEFECTO: la migracion 20260802011000 promovio los perfiles a la politica
-- nueva, pero la ESCALERA de la tienda se cambio unicamente en el valor por
-- defecto del codigo (`balam/config.jsx`). Los ajustes se persisten en
-- `pos.settings` y `CONFIG.load()` los fusiona ASI:
--
--     Object.assign({}, SEED_SETTINGS, next.settings)
--
-- es decir, **lo persistido gana sobre el valor por defecto**. En produccion
-- `commission.basePct` seguia valiendo 5 -el defecto anterior a H-69, que nunca
-- nadie edito porque era un ajuste sin consumidor- y las tres claves nuevas
-- -`goalPct`, `surplusPct`, `surplusThresholdPct`- no existian.
--
-- Consecuencia real: un vendedor sin porcentaje propio heredaba **5 %** en vez
-- del 3 % autorizado, y la escalera se aplanaba a 5/5/5, porque la guarda que
-- impide que un tramo pague menos que el anterior elevaba meta y excedente hasta
-- la base persistida. La politica autorizada NO estaba en vigor.
--
-- Leccion: cambiar el valor por defecto de un ajuste ya persistido no cambia
-- nada. La politica es un DATO y se migra como un dato.

begin;

-- ---------------------------------------------------------------------------
-- 1. Registro de reversion: que valia cada clave antes de tocarla.
-- ---------------------------------------------------------------------------
insert into pos.settings(key, value)
select '_h69StorePolicyBefore', coalesce(jsonb_object_agg(s.key, s.value), '{}'::jsonb)
  from pos.settings s
 where s.key in ('commission.basePct', 'commission.goalPct',
                 'commission.surplusPct', 'commission.surplusThresholdPct')
on conflict (key) do update
  set value = excluded.value, updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. La escalera autorizada, como dato persistido.
--    3 % base · 4 % al alcanzar la meta · 5 % sobre el excedente del 120 %.
-- ---------------------------------------------------------------------------
insert into pos.settings(key, value) values
  ('commission.basePct', '3'::jsonb),
  ('commission.goalPct', '4'::jsonb),
  ('commission.surplusPct', '5'::jsonb),
  ('commission.surplusThresholdPct', '120'::jsonb)
on conflict (key) do update
  set value = excluded.value, updated_at = now();

-- ---------------------------------------------------------------------------
-- 3. Ningun perfil puede quedar resolviendo 0 % por omision, INCLUIDO el que
--    hoy no es vendedor.
--
--    La migracion anterior filtraba por `role = 'vendedor'`, asi que dejo en
--    version 0 a los perfiles administrativos. Si manana un administrador pasa a
--    vendedor -un clic en Configuracion- reaparece el defecto: version 0 con
--    `comision_pct = 0` resuelve `heredada 0 %`.
--
--    Un 0 % INTENCIONAL se expresa hoy con `commission_override_pct = 0`, que es
--    explicito y esta fuera de este filtro. La combinacion version 0 + pct 0 no
--    es una decision: es el rastro del alta que ponia cero a todo el mundo.
-- ---------------------------------------------------------------------------
insert into pos.settings(key, value)
select '_h69PolicyPromotedAll', coalesce(jsonb_agg(jsonb_build_object(
         'id', s.id, 'nombre', s.nombre, 'role', s.role
       ) order by s.nombre), '[]'::jsonb)
  from pos.sellers s
 where s.deleted_at is null
   and coalesce(s.commission_policy_version, 0) = 0
   and s.commission_override_pct is null
   and s.seller_level_code is null
   and coalesce(s.comision_pct, 0) = 0
on conflict (key) do update
  set value = excluded.value, updated_at = now();

update pos.sellers
   set commission_policy_version = 1
 where deleted_at is null
   and coalesce(commission_policy_version, 0) = 0
   and commission_override_pct is null
   and seller_level_code is null
   and coalesce(comision_pct, 0) = 0;

-- ---------------------------------------------------------------------------
-- 4. Verificacion autocontenida. Que no aborte ES la prueba.
-- ---------------------------------------------------------------------------
do $$
declare
  v_base numeric;
  v_goal numeric;
  v_surplus numeric;
  v_umbral numeric;
  v_en_cero integer;
  v_vendedores integer;
begin
  select (value #>> '{}')::numeric into v_base
    from pos.settings where key = 'commission.basePct';
  select (value #>> '{}')::numeric into v_goal
    from pos.settings where key = 'commission.goalPct';
  select (value #>> '{}')::numeric into v_surplus
    from pos.settings where key = 'commission.surplusPct';
  select (value #>> '{}')::numeric into v_umbral
    from pos.settings where key = 'commission.surplusThresholdPct';

  if v_base is distinct from 3 then
    raise exception 'H-69: commission.basePct quedo en % y debia ser 3', v_base;
  end if;
  if v_goal is distinct from 4 then
    raise exception 'H-69: commission.goalPct quedo en % y debia ser 4', v_goal;
  end if;
  if v_surplus is distinct from 5 then
    raise exception 'H-69: commission.surplusPct quedo en % y debia ser 5', v_surplus;
  end if;
  if v_umbral is distinct from 120 then
    raise exception 'H-69: commission.surplusThresholdPct quedo en % y debia ser 120', v_umbral;
  end if;

  -- La escalera tiene que SUBIR. Una escalera plana o descendente significaria
  -- que la politica autorizada no esta en vigor aunque las claves existan.
  if not (v_goal > v_base and v_surplus > v_goal) then
    raise exception 'H-69: la escalera no asciende: %/%/%', v_base, v_goal, v_surplus;
  end if;

  -- Nadie, sea cual sea su rol, queda resolviendo 0 % por omision.
  select count(*) into v_en_cero
    from pos.sellers
   where deleted_at is null
     and coalesce(commission_policy_version, 0) = 0
     and commission_override_pct is null
     and seller_level_code is null
     and coalesce(comision_pct, 0) = 0;
  if v_en_cero > 0 then
    raise exception 'H-69: % perfil(es) siguen sin politica de comision', v_en_cero;
  end if;

  -- El alta nueva nace correcta: comprobado sobre el DEFAULT real de la columna,
  -- no sobre lo que el cliente promete enviar.
  if coalesce((
    select column_default from information_schema.columns
     where table_schema = 'pos' and table_name = 'sellers'
       and column_name = 'commission_policy_version'), '') not like '%1%' then
    raise exception 'H-69: el alta nueva no nace en politica version 1';
  end if;

  select count(*) into v_vendedores
    from pos.sellers where deleted_at is null and role = 'vendedor' and active;
  if v_vendedores = 0 then
    raise exception 'H-69: no hay vendedores activos';
  end if;
end;
$$;

commit;
