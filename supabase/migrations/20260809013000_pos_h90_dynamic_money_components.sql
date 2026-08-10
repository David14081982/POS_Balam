-- H-90 · Componentes monetarios dinámicos, inmutables y compatibles con historia.
-- Las columnas fijas se conservan durante la transición; `components` es la
-- autoridad para toda operación nacida después del punto cero.

alter table pos.sale_payments
  add column if not exists components jsonb;
alter table pos.returns
  add column if not exists components jsonb;

create or replace function pos.money_components_valid(p_components jsonb, p_total numeric)
returns boolean
language sql
immutable
set search_path = pos, pg_temp
as $$
  select p_components is not null
     and jsonb_typeof(p_components) = 'array'
     and jsonb_array_length(p_components) > 0
     and not exists (
       select 1 from jsonb_array_elements(p_components) part
        where jsonb_typeof(part) <> 'object'
           or nullif(trim(part ->> 'methodCode'), '') is null
           or nullif(trim(part ->> 'methodLabel'), '') is null
           or part ->> 'methodCode' in ('Mixto', 'Apartado', 'Cortesía')
           or jsonb_typeof(part -> 'amount') <> 'number'
           or (part ->> 'amount')::numeric <= 0
           or round((part ->> 'amount')::numeric, 2) <> (part ->> 'amount')::numeric
     )
     and round(coalesce((select sum((part ->> 'amount')::numeric)
                           from jsonb_array_elements(p_components) part), 0), 2)
         = round(coalesce(p_total, 0), 2)
     and (select count(*) from jsonb_array_elements(p_components))
         = (select count(distinct part ->> 'methodCode') from jsonb_array_elements(p_components) part)
$$;

comment on function pos.money_components_valid(jsonb, numeric) is
  'H-90: valida identidad, etiqueta snapshot, centavos, unicidad y suma exacta de componentes monetarios.';

alter table pos.sale_payments
  drop constraint if exists sale_payments_components_valid;
alter table pos.sale_payments
  add constraint sale_payments_components_valid
  check (components is null or pos.money_components_valid(components, monto));

alter table pos.returns
  drop constraint if exists returns_components_valid;
alter table pos.returns
  add constraint returns_components_valid
  check (components is null or pos.money_components_valid(components, total));

-- Los RPC históricos proyectan sólo las columnas conocidas. Este sobre de
-- transporte permite pasar los componentes por su campo textual existente y
-- el trigger lo consume antes de persistir: nunca queda visible en la tabla.
create or replace function pos.decode_money_components_wire()
returns trigger
language plpgsql
set search_path = pos, pg_temp
as $$
declare
  v_marker constant text := '__BALAM_MONEY_V1__';
  v_payload jsonb;
begin
  if new.metodo is not null and left(new.metodo, char_length(v_marker)) = v_marker then
    begin
      v_payload := substring(new.metodo from char_length(v_marker) + 1)::jsonb;
    exception when others then
      raise exception 'invalid_money_components_wire' using errcode = '22023';
    end;
    new.metodo := nullif(trim(v_payload ->> 'nominalMethod'), '');
    new.components := v_payload -> 'components';
    if new.metodo is null or not pos.money_components_valid(new.components,
        coalesce((to_jsonb(new) ->> 'monto')::numeric, (to_jsonb(new) ->> 'total')::numeric)) then
      raise exception 'invalid_money_components' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists decode_money_components_wire on pos.sale_payments;
create trigger decode_money_components_wire
before insert or update of metodo, components, monto on pos.sale_payments
for each row execute function pos.decode_money_components_wire();

drop trigger if exists decode_money_components_wire on pos.returns;
create trigger decode_money_components_wire
before insert or update of metodo, components, total on pos.returns
for each row execute function pos.decode_money_components_wire();

comment on column pos.sale_payments.components is
  'H-90: autoridad monetaria dinámica [{methodCode, methodLabel, amount}]. NULL significa documento histórico no adoptado.';
comment on column pos.returns.components is
  'H-90: salida real del reembolso. NULL significa documento histórico sin desglose demostrable.';
