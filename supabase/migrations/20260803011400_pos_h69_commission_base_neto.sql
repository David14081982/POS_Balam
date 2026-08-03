-- H-69 (continuacion) - La base de calculo persistida contradecia la politica.
--
-- La politica autorizada dice, literalmente: «3 % de la venta NETA sin IVA y
-- despues de descuentos» y «cortesias, IVA, envios y tarjetas de regalo no
-- comisionan». La sonda de lectura encontro en produccion:
--
--     commission.base = 'bruto'
--
-- que es justo lo contrario: aplica el porcentaje sobre el total CON IVA, de
-- modo que el impuesto comisionaba. No es el valor de fabrica -que es 'neto'-,
-- asi que alguien lo cambio en algun momento; pero contradice la autorizacion
-- vigente y sobre $1,150 pagaria $34.50 en vez de $29.74.
--
-- Se alinea con la politica autorizada y se guarda el valor anterior para que
-- revertirlo sea un dato, no una arqueologia. Si 'bruto' fuera una decision
-- deliberada, el dueno lo devuelve con un clic en
-- Configuracion > Vendedores > Base de calculo de la comision.

begin;

insert into pos.settings(key, value)
select '_h69CommissionBaseBefore', coalesce(
         (select value from pos.settings where key = 'commission.base'), '"neto"'::jsonb)
on conflict (key) do update
  set value = excluded.value, updated_at = now();

insert into pos.settings(key, value)
values ('commission.base', '"neto"'::jsonb)
on conflict (key) do update
  set value = excluded.value, updated_at = now();

do $$
declare
  v_base text;
begin
  select value #>> '{}' into v_base from pos.settings where key = 'commission.base';
  if v_base is distinct from 'neto' then
    raise exception 'H-69: commission.base quedo en % y la politica exige neto', v_base;
  end if;
  if not exists (select 1 from pos.settings where key = '_h69CommissionBaseBefore') then
    raise exception 'H-69: falta el registro de reversion de commission.base';
  end if;
end;
$$;

commit;
