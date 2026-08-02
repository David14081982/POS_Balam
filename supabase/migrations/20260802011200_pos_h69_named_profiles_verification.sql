-- H-69 - Verificacion nominal de los perfiles indicados por el dueno.
--
-- La politica autorizada nombra a Lupita Rivera y Monica Duarte. La verificacion
-- anterior admitia que apareciera al menos una; esta exige LAS DOS y ademas que
-- resuelvan el 3 % de la tienda. Es una asercion aparte a proposito: si fallara,
-- lo que hay que revisar es el DATO -como esta escrito el nombre-, no la
-- correccion, y conviene que el mensaje lo diga sin ambiguedad.
--
-- Sin `raise notice` visible en el CLI, que esta migracion no aborte ES la
-- prueba de que ambas quedaron configuradas.

begin;

do $$
declare
  v_lupita integer;
  v_monica integer;
  v_sin_politica integer;
begin
  select count(*) into v_lupita
    from pos.sellers
   where deleted_at is null and role = 'vendedor' and active
     and pos.unaccent_lower_ok(nombre) like '%lupita%'
     and pos.unaccent_lower_ok(nombre) like '%rivera%';

  select count(*) into v_monica
    from pos.sellers
   where deleted_at is null and role = 'vendedor' and active
     and pos.unaccent_lower_ok(nombre) like '%monica%'
     and pos.unaccent_lower_ok(nombre) like '%duarte%';

  if v_lupita = 0 then
    raise exception 'H-69: no hay ningun vendedor activo cuyo nombre contenga "Lupita" y "Rivera"';
  end if;
  if v_monica = 0 then
    raise exception 'H-69: no hay ningun vendedor activo cuyo nombre contenga "Monica" y "Duarte"';
  end if;

  -- Ambas deben resolver el 3 % de la tienda: version >= 1 y sin porcentaje
  -- propio distinto de 3 ni nivel que las desvie.
  select count(*) into v_sin_politica
    from pos.sellers
   where deleted_at is null and role = 'vendedor' and active
     and ((pos.unaccent_lower_ok(nombre) like '%lupita%'
           and pos.unaccent_lower_ok(nombre) like '%rivera%')
       or (pos.unaccent_lower_ok(nombre) like '%monica%'
           and pos.unaccent_lower_ok(nombre) like '%duarte%'))
     and (coalesce(commission_policy_version, 0) < 1
          or (commission_override_pct is not null and commission_override_pct <> 3)
          or seller_level_code is not null);
  if v_sin_politica > 0 then
    raise exception 'H-69: % perfil(es) nombrados no resuelven el 3 %% de la tienda', v_sin_politica;
  end if;
end;
$$;

commit;
