-- H-133: distribuye el truncamiento sobre los 80 bits finales del UUID.
-- Evita colisiones sistemáticas en UUIDs con prefijo compartido sin cambiar
-- longitud, Code Set C ni la garantía final del índice único PostgreSQL.
begin;

create or replace function pos.h133_barcode_v3_from_id(p_id text)
returns text language plpgsql immutable strict
set search_path = pg_catalog, pg_temp as $$
declare
  v_hex text; v_value numeric := 0; v_i integer; v_digit integer; v_char text;
begin
  if p_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' then
    raise exception 'BARCODE_V3_UUID_REQUIRED' using errcode='22023';
  end if;
  v_hex := lower(replace(p_id, '-', ''));
  for v_i in 13..32 loop
    v_char := substr(v_hex, v_i, 1);
    v_digit := strpos('0123456789abcdef', v_char) - 1;
    if v_digit < 0 then raise exception 'BARCODE_V3_UUID_REQUIRED' using errcode='22023'; end if;
    v_value := v_value * 16 + v_digit;
  end loop;
  return '3' || lpad(trunc(v_value)::text, 25, '0');
end;
$$;

commit;
