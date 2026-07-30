-- H-52 — verificación autocontenida. Aborta ante deriva y no deja semillas.

begin;

do $verify$
declare
  v_result jsonb;
  v_folio_a text := 'H52-VERIFY-A';
  v_folio_b text := 'H52-VERIFY-B';
begin
  if to_regprocedure('pos.commit_sale_with_additional_discount(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,jsonb,jsonb)') is null then
    raise exception 'H-52: falta la costura transaccional';
  end if;
  if to_regprocedure('pos.physical_card_available(text)') is null then
    raise exception 'H-52: falta la consulta de disponibilidad del folio físico';
  end if;
  if to_regprocedure('pos.claim_physical_card(text,text)') is null then
    raise exception 'H-52: falta la reserva atómica del folio físico';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'pos' and table_name = 'sales'
      and column_name = 'descuentos_adicionales'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'pos' and table_name = 'sale_items'
      and column_name = 'descuento_adicional'
  ) then
    raise exception 'H-52: faltan columnas del snapshot';
  end if;

  v_result := pos.commit_sale_with_additional_discount(
    'h52-invalid', 'h52-invalid',
    jsonb_build_object('folio', 'H52-INVALID', 'total', 100,
      'total_antes_descuento_adicional', 100, 'descuento_adicional', 10,
      'descuentos_adicionales', '{}'::jsonb),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, null, '[]'::jsonb
  );
  if v_result ->> 'error' <> 'invalid_additional_discount' then
    raise exception 'H-52: la costura aceptó totales incoherentes: %', v_result;
  end if;

  insert into pos.physical_card_redemptions(folio, claim_token)
  values ('H52-CARD-ONE', 'claim-a');
  begin
    insert into pos.physical_card_redemptions(folio, claim_token)
    values ('H52-CARD-ONE', 'claim-b');
    raise exception 'H-52: el mismo folio físico se consumió dos veces';
  exception when unique_violation then
    null;
  end;

  if has_table_privilege('anon', 'pos.physical_card_redemptions', 'select')
     or has_table_privilege('authenticated', 'pos.physical_card_redemptions', 'insert') then
    raise exception 'H-52: ledger de tarjetas expuesto al navegador';
  end if;
  raise notice 'H-52: snapshot aditivo, validación, unicidad y permisos correctos';

  delete from pos.physical_card_redemptions where folio = 'H52-CARD-ONE';
end
$verify$;

rollback;
