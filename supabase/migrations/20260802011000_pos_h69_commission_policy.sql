-- H-69 - Sistema de comisiones de vendedores.
--
-- Politica autorizada por el dueno del producto (02/08/2026):
--   * base 3 % sobre la venta NETA sin IVA y despues de descuentos;
--   * 4 % a partir de la meta mensual del vendedor;
--   * 5 % por encima del 120 % de esa meta, solo sobre el excedente.
-- Los tramos son MARGINALES: cada peso se paga a la tasa de su tramo, de modo
-- que una venta ya cobrada nunca se recalcula al cruzar un umbral y su comision
-- puede congelarse el dia que se emite (ADR-002).
--
-- Esta migracion NO calcula comision: la calcula el cliente con su autoridad
-- unica y aqui solo se PERSISTE la evidencia congelada. La base sigue siendo la
-- duena de los acumulados, que continuan siendo exclusivos de las RPC.
--
-- Las tres funciones `*_checked` se redefinen a partir de su TEXTO VIGENTE con
-- ediciones acotadas y diff revisado (R-DB-03, AP-05). Las funciones grandes
-- -`commit_sale`, `commit_layaway_liquidation`, `commit_exchange`- no se tocan.

begin;

-- ---------------------------------------------------------------------------
-- 1. Esquema aditivo (R-DB-04): un registro historico sin estas columnas sigue
--    siendo legible, y un reintento que no las envia no borra lo ya guardado.
-- ---------------------------------------------------------------------------
alter table pos.sales
  add column if not exists comisiones jsonb;

comment on column pos.sales.comisiones is
  'H-69: evidencia congelada de comision por vendedor (sellerId, base, pct, monto, source, policyVersion, tramos). NULL = venta anterior a H-69.';

alter table pos.exchanges
  add column if not exists comision_base_importe numeric(12,2) not null default 0,
  add column if not exists comision_source text,
  add column if not exists comision_policy_version integer;

-- ---------------------------------------------------------------------------
-- 2. Documento de ajuste historico.
--    Los tickets emitidos NO se reescriben. Lo que no se pago en su momento se
--    reconoce en un documento propio, con identidad, actor y detalle.
-- ---------------------------------------------------------------------------
create table if not exists pos.commission_adjustments (
  operation_id uuid primary key,
  actor_user_id uuid,
  motivo text,
  total numeric(12,2) not null default 0,
  vendedores integer not null default 0,
  detalle jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists commission_adjustments_created_idx
  on pos.commission_adjustments (created_at desc);

-- Mismo regimen que pos.liquidations desde H-56: lectura para el personal
-- autenticado, escritura EXCLUSIVA de la RPC auditada.
alter table pos.commission_adjustments disable row level security;
revoke all on pos.commission_adjustments from public, anon, authenticated;
grant select on pos.commission_adjustments to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RPC del ajuste historico: atomica, auditada e idempotente por operacion.
--    Acredita el importe reconocido en el acumulado del vendedor -que solo las
--    RPC pueden tocar- y deja el documento como prueba.
-- ---------------------------------------------------------------------------
create or replace function pos.apply_commission_adjustment_checked(
  p_operation_id uuid,
  p_rows jsonb,
  p_motivo text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = pos, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_hash text := md5(coalesce(p_rows::text, '[]'));
  v_existing pos.capability_operation_audit%rowtype;
  v_row record;
  v_total numeric := 0;
  v_count integer := 0;
  v_result jsonb;
begin
  perform pos.require_current_capability('commissions.settle');
  if p_operation_id is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'COMMISSION_ADJUSTMENT_INVALID' using errcode = '22023';
  end if;

  -- Idempotencia por (operacion, actor, huella del payload), igual que el resto
  -- de capacidades de H-56: repetir la llamada devuelve el mismo resultado y no
  -- vuelve a acreditar.
  select * into v_existing
  from pos.capability_operation_audit
  where operation_id = p_operation_id;
  if found then
    if v_existing.capability_key <> 'commissions.adjust'
       or v_existing.actor_user_id <> v_actor
       or v_existing.payload_hash <> v_hash then
      raise exception 'CAPABILITY_OPERATION_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('commissions.adjust', 69));

  for v_row in
    select x.seller_id, x.monto, x.ventas
      from jsonb_to_recordset(p_rows)
        as x(seller_id text, monto numeric, ventas integer)
  loop
    if nullif(trim(v_row.seller_id), '') is null or coalesce(v_row.monto, 0) <= 0 then
      continue;
    end if;
    update pos.sellers
       set comision_acum = round(coalesce(comision_acum, 0) + v_row.monto, 2)
     where id = v_row.seller_id and deleted_at is null;
    if not found then
      raise exception 'COMMISSION_SELLER_NOT_FOUND' using errcode = '22023';
    end if;
    insert into pos.liquidations(id, seller_id, seller, monto, tipo, fecha)
    select 'adj-' || p_operation_id::text || '-' || v_row.seller_id,
           s.id, s.nombre, round(v_row.monto, 2), 'ajuste',
           to_char(statement_timestamp(), 'YYYY-MM-DD HH24:MI')
      from pos.sellers s where s.id = v_row.seller_id
    on conflict (id) do nothing;
    v_total := v_total + v_row.monto;
    v_count := v_count + 1;
  end loop;

  insert into pos.commission_adjustments(
    operation_id, actor_user_id, motivo, total, vendedores, detalle
  ) values (
    p_operation_id, v_actor, nullif(trim(coalesce(p_motivo, '')), ''),
    round(v_total, 2), v_count, p_rows
  );

  v_result := jsonb_build_object(
    'operation_id', p_operation_id,
    'total', round(v_total, 2),
    'sellers', v_count,
    'applied_at', statement_timestamp()
  );
  insert into pos.capability_operation_audit(
    operation_id, capability_key, actor_user_id, subject_key, payload_hash, result
  ) values (
    p_operation_id, 'commissions.adjust', v_actor, null, v_hash, v_result
  );
  return v_result;
end;
$$;

revoke all on function pos.apply_commission_adjustment_checked(uuid, jsonb, text)
  from public, anon;
grant execute on function pos.apply_commission_adjustment_checked(uuid, jsonb, text)
  to authenticated;

-- La capacidad `commissions.adjust` reutiliza el permiso de liquidar: quien
-- puede pagar una comision puede reconocer la que no se pago.
insert into pos.operational_capabilities(capability_key, description)
values ('commissions.adjust', 'Reconocer comision historica no pagada')
on conflict (capability_key) do update
set description = excluded.description, active = true, updated_at = now();

insert into pos.role_capability_permissions(role_code, capability_key, allowed)
select 'admin', 'commissions.adjust', true
where exists (select 1 from pos.permission_roles r where r.code = 'admin')
on conflict (role_code, capability_key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Persistencia de la evidencia congelada en las tres operaciones.
--    Generadas desde su definicion vigente; el diff se revisó bloque a bloque.
-- ---------------------------------------------------------------------------

-- Comparacion de nombres tolerante a mayusculas y acentos, sin depender de la
-- extension `unaccent` (no siempre instalada). Se usa en la verificacion para
-- localizar a los perfiles nombrados por el dueno escriban como escriban su
-- nombre.
create or replace function pos.unaccent_lower_ok(p_text text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select translate(lower(coalesce(p_text, '')),
                   E'áéíóúàèìòùäëïöüñ',
                   'aeiouaeiouaeioun')
$$;

-- H-69: persistencia de la politica del excedente de un cambio. Vive en su
-- propia funcion -y no dentro del wrapper- para que la verificacion remota pueda
-- ejercitarla sin montar un cambio completo (R-DB-09: el comportamiento se
-- prueba ejecutandolo).
create or replace function pos.record_exchange_commission_policy(p_exchange jsonb)
returns integer
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_rows integer;
begin
  update pos.exchanges
     set comision_base_importe = coalesce(
           (p_exchange ->> 'comision_base_importe')::numeric, comision_base_importe),
         comision_source = coalesce(
           nullif(trim(p_exchange ->> 'comision_source'), ''), comision_source),
         comision_policy_version = coalesce(
           (p_exchange ->> 'comision_policy_version')::integer, comision_policy_version)
   where id = p_exchange ->> 'id';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

revoke all on function pos.record_exchange_commission_policy(jsonb)
  from public, anon, authenticated;

create or replace function pos.commit_sale_checked(
  p_commit_id text, p_operation_id text, p_sale jsonb, p_items jsonb,
  p_moves jsonb, p_payments jsonb, p_stock_lines jsonb,
  p_reserve_stock boolean, p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_folio text := p_sale ->> 'folio';
  v_result jsonb;
  v_before jsonb;
  v_state jsonb;
  v_prior_reserved boolean := false;
  v_existing_commit boolean := false;
  v_should_reserve boolean := false;
  v_effective_reserve boolean := false;
begin
  perform pos.require_sale_commit_capabilities(p_sale, p_payments);
  if p_sale ? 'comision' and p_sale -> 'comision' <> 'null'::jsonb then
    if jsonb_typeof(p_sale -> 'comision') <> 'number' then
      return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
    end if;
    if (p_sale ->> 'comision')::numeric < 0
       or round((p_sale ->> 'comision')::numeric, 2)
          <> (p_sale ->> 'comision')::numeric then
      return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
    end if;
  end if;
  if p_sale ? 'comision_base' and p_sale -> 'comision_base' <> 'null'::jsonb then
    if jsonb_typeof(p_sale -> 'comision_base') <> 'string'
       or nullif(trim(p_sale ->> 'comision_base'), '') is null
       or p_sale ->> 'comision_base' not in ('neto', 'bruto') then
      return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
    end if;
  end if;
  if p_sale ? 'comisiones' and p_sale -> 'comisiones' <> 'null'::jsonb then
    if jsonb_typeof(p_sale -> 'comisiones') <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
    end if;
  end if;
  if nullif(trim(p_operation_id), '') is not null then
    perform pg_advisory_xact_lock(hashtext(p_operation_id));
  end if;
  v_should_reserve := coalesce(p_sale ->> 'estado', '')
      not in ('Apartado', 'Cancelado')
    and jsonb_typeof(p_stock_lines) = 'array'
    and jsonb_array_length(p_stock_lines) > 0;
  select exists(select 1 from pos.sale_commits where commit_id = p_commit_id)
    into v_existing_commit;
  v_effective_reserve := v_should_reserve;
  v_before := pos.sale_commit_authoritative_state(
    p_operation_id, v_folio, p_stock_lines
  );
  v_prior_reserved := coalesce((v_before ->> 'stock_reserved')::boolean, false);

  v_result := pos.commit_sale(
    p_commit_id, p_operation_id, p_sale, p_items, p_moves, p_payments,
    p_stock_lines, v_effective_reserve, p_client_effect, p_seller_effects
  );
  -- Compatibilidad con commits creados por el wrapper anterior: su hash podia
  -- contener la bandera cliente false aunque la reserva ya existiera. La
  -- primera llamada solo leyo el commit y devolvio commit_mismatch, por lo que
  -- es seguro probar el payload historico sin duplicar efectos.
  if v_existing_commit
     and v_result ->> 'error' = 'commit_mismatch'
     and v_effective_reserve is distinct from coalesce(p_reserve_stock, false) then
    v_result := pos.commit_sale(
      p_commit_id, p_operation_id, p_sale, p_items, p_moves, p_payments,
      p_stock_lines, coalesce(p_reserve_stock, false),
      p_client_effect, p_seller_effects
    );
  end if;
  if coalesce((v_result ->> 'ok')::boolean, false) then
    update pos.sales set
      comision = case when p_sale ? 'comision'
        then (p_sale ->> 'comision')::numeric else comision end,
      comision_base = case when p_sale ? 'comision_base'
        then nullif(trim(p_sale ->> 'comision_base'), '') else comision_base end,
      comisiones = case when p_sale ? 'comisiones'
        then p_sale -> 'comisiones' else comisiones end
     where folio = v_folio and operation_id = p_operation_id;
  end if;
  v_state := pos.sale_commit_authoritative_state(
    p_operation_id, v_folio, p_stock_lines
  );
  return v_result || v_state || jsonb_build_object(
    'commit_idempotent', coalesce((v_result ->> 'idempotent')::boolean, false),
    'stock_idempotent', v_prior_reserved
      and coalesce((v_state ->> 'stock_reserved')::boolean, false)
  );
end;
$$;

create or replace function pos.commit_layaway_liquidation_checked(
  p_commit_id text,
  p_operation_id text,
  p_folio text,
  p_payment jsonb,
  p_seller_effects jsonb default '[]'::jsonb,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform pos.require_current_capability('sales.collect');
  if p_context ? 'commission_rows'
     and p_context -> 'commission_rows' <> 'null'::jsonb
     and jsonb_typeof(p_context -> 'commission_rows') <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_commission_snapshot');
  end if;
  v_result := pos.commit_layaway_liquidation(
    p_commit_id, p_operation_id, p_folio, p_payment, p_seller_effects,
    p_context
  );
  -- H-69: el apartado comisiona AL LIQUIDARSE. El desglose por vendedor viaja en
  -- el contexto y se congela aqui, en la misma transaccion que confirma el pago.
  if coalesce((v_result ->> 'ok')::boolean, false)
     and p_context ? 'commission_rows'
     and jsonb_typeof(p_context -> 'commission_rows') = 'array' then
    update pos.sales
       set comisiones = p_context -> 'commission_rows'
     where folio = p_folio;
  end if;
  return v_result;
end;
$$;

create or replace function pos.commit_exchange_checked(
  p_commit_id text,
  p_exchange jsonb,
  p_items jsonb,
  p_moves jsonb default '[]'::jsonb,
  p_payment jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform pos.require_current_capability('sales.exchange');
  v_result := pos.commit_exchange(
    p_commit_id, p_exchange, p_items, p_moves, p_payment, p_seller_effects
  );
  -- H-69: `comision_pct` y `comision_monto` ya los escribe `commit_exchange`.
  -- Aqui se anade lo que faltaba para reconstruir la cifra: sobre que importe se
  -- calculo y bajo que politica. Se hace en el wrapper para no retipear la
  -- funcion grande (AP-05).
  if coalesce((v_result ->> 'ok')::boolean, false) then
    perform pos.record_exchange_commission_policy(p_exchange);
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Politica inicial de los perfiles comerciales.
--
--    Hasta hoy toda alta nacia con `comision_pct = 0` y version 0, es decir
--    `heredada 0 %`, y ninguna pantalla podia cambiarlo: por eso ninguna venta
--    genero comision. Se promueve a version 1 SOLO a quien no tiene ninguna
--    decision explicita en los datos, de modo que pase a resolver por el
--    porcentaje base de la tienda (3 %).
--
--    No se toca a nadie con `commission_override_pct`, `seller_level_code` o un
--    `comision_pct` distinto de cero: esa gente YA tiene una decision tomada y
--    la migracion la respeta.
-- ---------------------------------------------------------------------------
-- El conjunto afectado se REGISTRA antes de tocarlo. Sirve para dos cosas: la
-- reversion es exacta -se sabe a quien devolver a version 0, y no se adivina por
-- una fecha- y la app puede leer el registro para confirmar en pantalla a quien
-- alcanzo la politica, que es la unica via de comprobacion disponible sin acceso
-- de lectura a la base.
insert into pos.settings(key, value)
select '_h69PolicyPromoted', coalesce(jsonb_agg(jsonb_build_object(
         'id', s.id, 'nombre', s.nombre, 'antes', coalesce(s.commission_policy_version, 0)
       ) order by s.nombre), '[]'::jsonb)
  from pos.sellers s
 where s.deleted_at is null
   and s.role = 'vendedor'
   and coalesce(s.commission_policy_version, 0) = 0
   and s.commission_override_pct is null
   and s.seller_level_code is null
   and coalesce(s.comision_pct, 0) = 0
on conflict (key) do update
  set value = excluded.value, updated_at = now();

update pos.sellers
   set commission_policy_version = 1
 where deleted_at is null
   and role = 'vendedor'
   and coalesce(commission_policy_version, 0) = 0
   and commission_override_pct is null
   and seller_level_code is null
   and coalesce(comision_pct, 0) = 0;

-- ---------------------------------------------------------------------------
-- 6. Verificacion autocontenida (R-DB-05, ADR-004).
--    El CLI no imprime `raise notice`, asi que la evidencia se ASEVERA: que esta
--    migracion no aborte ES la prueba.
-- ---------------------------------------------------------------------------
do $$
declare
  v_vendedores integer;
  v_en_cero integer;
  v_lupita integer;
  v_monica integer;
  v_mal integer;
begin
  -- 6.1 La tienda tiene personal comercial. Sin esto, todo lo demas seria un
  --     verde vacio sobre una tabla sin filas.
  select count(*) into v_vendedores
    from pos.sellers
   where deleted_at is null and role = 'vendedor' and active;
  if v_vendedores = 0 then
    raise exception 'H-69: no hay vendedores activos; la politica no pudo aplicarse';
  end if;

  -- 6.2 Nadie queda resolviendo 0 % POR OMISION. Un 0 % explicito es legitimo y
  --     no se cuenta: lo que no puede quedar es alguien en version 0 sin
  --     porcentaje, que es exactamente el defecto que se corrige.
  select count(*) into v_en_cero
    from pos.sellers
   where deleted_at is null and role = 'vendedor' and active
     and coalesce(commission_policy_version, 0) = 0
     and commission_override_pct is null
     and seller_level_code is null
     and coalesce(comision_pct, 0) = 0;
  if v_en_cero > 0 then
    raise exception 'H-69: % vendedor(es) siguen sin politica de comision', v_en_cero;
  end if;

  -- 6.3 Los dos perfiles nombrados por el dueno. Si existen, deben haber quedado
  --     resolviendo el 3 % de la tienda; si no existen, se dice con claridad en
  --     vez de dar por buena una coincidencia que nunca ocurrio.
  select count(*) into v_lupita
    from pos.sellers
   where deleted_at is null and role = 'vendedor'
     and pos.unaccent_lower_ok(nombre) like '%lupita%';
  select count(*) into v_monica
    from pos.sellers
   where deleted_at is null and role = 'vendedor'
     and pos.unaccent_lower_ok(nombre) like '%nica duarte%';
  if v_lupita = 0 and v_monica = 0 then
    raise exception 'H-69: no se encontro ni a Lupita Rivera ni a Monica Duarte entre los vendedores';
  end if;

  select count(*) into v_mal
    from pos.sellers
   where deleted_at is null and role = 'vendedor'
     and (pos.unaccent_lower_ok(nombre) like '%lupita%'
          or pos.unaccent_lower_ok(nombre) like '%nica duarte%')
     and (coalesce(commission_policy_version, 0) < 1
          or (commission_override_pct is not null and commission_override_pct <> 3));
  if v_mal > 0 then
    raise exception 'H-69: % perfil(es) nombrados no quedaron al 3 %%', v_mal;
  end if;

  -- 6.3b El registro de reversion existe y no esta vacio: sin el, la promocion
  --      de politica seria irreversible y ademas invisible desde la app.
  if not exists (select 1 from pos.settings where key = '_h69PolicyPromoted') then
    raise exception 'H-69: falta el registro de reversion _h69PolicyPromoted';
  end if;

  -- 6.4 Las columnas nuevas existen y las funciones quedaron redefinidas.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'pos' and table_name = 'sales' and column_name = 'comisiones'
  ) then
    raise exception 'H-69: falta pos.sales.comisiones';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'pos' and table_name = 'exchanges'
       and column_name = 'comision_base_importe'
  ) then
    raise exception 'H-69: falta pos.exchanges.comision_base_importe';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'pos' and p.proname = 'apply_commission_adjustment_checked'
  ) then
    raise exception 'H-69: falta pos.apply_commission_adjustment_checked';
  end if;

  -- 6.5 La frontera de escritura sigue en pie: el trigger que responde
  --     COMMISSION_RPC_REQUIRED no se retiro al desbloquear el guardado de
  --     perfil. Si alguien lo quitara, esta migracion lo denunciaria.
  if not exists (
    select 1 from pg_trigger
     where tgname = 'sellers_restrict_direct_commission_writes'
       and not tgisinternal
  ) then
    raise exception 'H-69: el trigger que protege los acumulados desaparecio';
  end if;

  -- 6.6 `authenticated` NO puede escribir el documento de ajuste directamente.
  if has_table_privilege('authenticated', 'pos.commission_adjustments', 'INSERT') then
    raise exception 'H-69: authenticated puede insertar ajustes sin pasar por la RPC';
  end if;
end;
$$;

commit;
