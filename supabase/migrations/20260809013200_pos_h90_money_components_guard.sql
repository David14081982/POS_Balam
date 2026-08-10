-- H-90 · Endurece la validación JSON frente a campos ausentes o tipos inválidos.
-- La migración anterior ya está aplicada; se reemplaza sólo la función y no se
-- reescribe ningún documento.

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
        where jsonb_typeof(part) is distinct from 'object'
           or nullif(trim(part ->> 'methodCode'), '') is null
           or nullif(trim(part ->> 'methodLabel'), '') is null
           or part ->> 'methodCode' in ('Mixto', 'Apartado', 'Cortesía')
           or jsonb_typeof(part -> 'amount') is distinct from 'number'
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
  'H-90: valida objetos, identidad, etiqueta snapshot, centavos, unicidad y suma exacta de componentes monetarios.';
