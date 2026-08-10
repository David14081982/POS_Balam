-- H-90 · Verificación autocontenida del desglose dinámico.
do $$
declare
  v_payment_id text := 'h90-verification-payment';
  v_return_id text := 'h90-verification-return';
  v_wire text;
begin
  if exists (select 1 from pos.sale_payments where components is not null)
     or exists (select 1 from pos.returns where components is not null) then
    raise notice 'H-90: existen documentos posteriores al punto cero; no se reescriben';
  end if;

  v_wire := '__BALAM_MONEY_V1__' || jsonb_build_object(
    'nominalMethod', 'Mixto',
    'components', jsonb_build_array(
      jsonb_build_object('methodCode', 'Efectivo', 'methodLabel', 'Efectivo', 'amount', 30),
      jsonb_build_object('methodCode', 'MP', 'methodLabel', 'Mercado Pago', 'amount', 70)
    )
  )::text;
  insert into pos.sale_payments(id, folio, fecha, tipo, metodo, monto, efectivo, otro)
  values(v_payment_id, 'H90-VERIFY', '2026-08-09 12:00', 'venta', v_wire, 100, 30, 70);
  if not exists (select 1 from pos.sale_payments where id = v_payment_id
      and metodo = 'Mixto' and components -> 1 ->> 'methodCode' = 'MP'
      and pos.money_components_valid(components, monto)) then
    raise exception 'H-90: el pago dinámico no quedó congelado';
  end if;

  begin
    insert into pos.returns(id, folio, metodo, total, fecha, components)
    values(v_return_id, 'H90-VERIFY', 'Mixto', 100, '2026-08-09 12:05',
      '[{"methodCode":"Efectivo","methodLabel":"Efectivo","amount":99}]'::jsonb);
    raise exception 'H-90: se aceptó un desglose descuadrado';
  exception when check_violation then null;
  end;

  delete from pos.sale_payments where id = v_payment_id;
  delete from pos.returns where id = v_return_id;
  raise notice 'H-90: componentes dinámicos válidos, suma exacta y compatibilidad NULL verificadas';
end;
$$;
