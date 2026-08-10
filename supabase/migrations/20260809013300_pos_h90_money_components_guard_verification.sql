-- H-90 · Verifica que ningún componente incompleto atraviese la autoridad SQL.
do $$
begin
  if pos.money_components_valid(
      '[{"methodCode":"Efectivo","methodLabel":"Efectivo","amount":30},
        {"methodCode":"MP","methodLabel":"Mercado Pago"}]'::jsonb,
      30) then
    raise exception 'H-90: se aceptó un componente sin amount';
  end if;

  if pos.money_components_valid(
      '[{"methodCode":"Efectivo","methodLabel":"Efectivo","amount":"30"}]'::jsonb,
      30) then
    raise exception 'H-90: se aceptó amount con tipo texto';
  end if;

  if not pos.money_components_valid(
      '[{"methodCode":"Efectivo","methodLabel":"Efectivo","amount":30},
        {"methodCode":"MP","methodLabel":"Mercado Pago","amount":70}]'::jsonb,
      100) then
    raise exception 'H-90: el desglose válido dejó de aceptarse';
  end if;

  raise notice 'H-90: campos ausentes, tipos inválidos y desglose válido verificados';
end;
$$;
