-- POS Balam — H-33: folio comercial corto con consecutivo diario único.
--
-- El folio visible pasa a ser {PREFIJO}-{AAMMDD}-{0001}. La identidad técnica de
-- la venta NO cambia: sigue siendo `pos.sales.operation_id` (UUID inmutable) y es
-- la que usan la reserva de stock, el commit idempotente y los conflictos.
--
-- Esta migración sólo agrega la AUTORIDAD del consecutivo diario: un contador
-- atómico por (prefijo, día) del que cada terminal reserva un bloque. Con bloque
-- reservado una terminal offline emite folios cortos y definitivos sin coordinarse
-- con nadie. No modifica commit_sale ni ninguna ruta financiera; `folio_conflict`
-- continúa siendo la última defensa contra un folio provisional duplicado.

begin;

create table if not exists pos.folio_counters (
  prefix        text not null,
  business_date date not null,
  last_seq      integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (prefix, business_date),
  constraint folio_counters_prefix_chk check (prefix ~ '^[A-Z0-9]{1,6}$'),
  constraint folio_counters_seq_chk check (last_seq >= 0)
);

alter table pos.folio_counters enable row level security;

-- El contador se escribe EXCLUSIVAMENTE por la función security definer de abajo:
-- ninguna policy concede insert/update directo, ni siquiera al administrador.
drop policy if exists active_admin_select on pos.folio_counters;
create policy active_admin_select on pos.folio_counters
  for select to authenticated
  using (pos.is_active_admin());

grant select on pos.folio_counters to authenticated;
grant all on pos.folio_counters to service_role;

-- Reserva atómica de un rango de consecutivos para un día del negocio.
-- `p_floor` permite a la terminal declarar el mayor consecutivo que ya conoce
-- (por ejemplo folios provisionales creados sin red y ya sincronizados por otra
-- terminal): el contador nunca retrocede y nunca entrega un número por debajo.
create or replace function pos.reserve_folio_block(
  p_prefix text,
  p_business_date date,
  p_count integer default 1,
  p_floor integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_prefix text;
  v_count integer;
  v_floor integer;
  v_to integer;
begin
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para reservar folios'
      using errcode = '42501';
  end if;

  v_prefix := left(upper(regexp_replace(coalesce(p_prefix, ''), '[^A-Za-z0-9]', '', 'g')), 6);
  if v_prefix = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid_prefix');
  end if;
  if p_business_date is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_business_date');
  end if;

  v_count := least(greatest(coalesce(p_count, 1), 1), 100);
  v_floor := greatest(coalesce(p_floor, 0), 0);

  insert into pos.folio_counters as fc (prefix, business_date, last_seq)
  values (v_prefix, p_business_date, v_floor + v_count)
  on conflict (prefix, business_date) do update
    set last_seq = greatest(fc.last_seq, v_floor) + v_count,
        updated_at = now()
  returning fc.last_seq into v_to;

  return jsonb_build_object(
    'ok', true,
    'prefix', v_prefix,
    'business_date', to_char(p_business_date, 'YYYY-MM-DD'),
    'from', v_to - v_count + 1,
    'to', v_to
  );
end;
$$;

revoke all on function pos.reserve_folio_block(text, date, integer, integer) from public;
grant execute on function pos.reserve_folio_block(text, date, integer, integer) to authenticated;

commit;
