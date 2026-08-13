-- H-98: verificación remota, autoritativa y estrictamente de lectura.
-- Impersona dentro de esta transacción a un administrador real únicamente para
-- invocar point_zero_preview(); no llama respaldo, ejecución ni purga.
begin;

do $$
declare
  v_admin uuid;
  v_email text;
  v_preview jsonb;
  v_products_before bigint;
  v_products_after bigint;
  v_pieces_before numeric;
  v_pieces_after numeric;
  v_key text;
begin
  select u.id, u.email into v_admin, v_email
    from auth.users u
    join pos.sellers s on lower(s.email)=lower(u.email)
   where s.role='admin' and s.active is true and s.deleted_at is null
   order by u.created_at
   limit 1;
  if v_admin is null then raise exception 'H98_VISIBLE_PREVIEW_ADMIN_MISSING'; end if;

  select count(*) into v_products_before from pos.products;
  select coalesce(sum(case when record_model='v2' then coalesce(stock_quantity,0)
    else (select coalesce(sum(coalesce((e.value->>'stock')::numeric,0)),0)
      from jsonb_array_elements(coalesce(stock,'[]'::jsonb)) e(value)) end),0)
    into v_pieces_before from pos.products where deleted_at is null;

  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claim.email',v_email,true);
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub',v_admin::text,'email',v_email,'role','authenticated','aud','authenticated'
  )::text,true);

  v_preview := pos.point_zero_preview();
  if not coalesce((v_preview->>'ok')::boolean,false)
     or nullif(v_preview->>'generated_at','') is null
     or nullif(v_preview->>'preview_token','') is null then
    raise exception 'H98_VISIBLE_PREVIEW_INVALID';
  end if;
  foreach v_key in array array[
    'productos','piezas','ventas','sale_items','movimientos','apartados','pagos',
    'devoluciones','return_items','cambios','exchange_items','prestamos',
    'reclasificaciones','liquidaciones','commission_adjustments',
    'physical_card_redemptions','stock_reservations','sale_commits','return_commits',
    'exchange_commits','layaway_liquidation_commits','folio_counters','clientes'
  ] loop
    if not (v_preview->'counts' ? v_key) then
      raise exception 'H98_VISIBLE_PREVIEW_COUNT_MISSING:%',v_key;
    end if;
  end loop;

  select count(*) into v_products_after from pos.products;
  select coalesce(sum(case when record_model='v2' then coalesce(stock_quantity,0)
    else (select coalesce(sum(coalesce((e.value->>'stock')::numeric,0)),0)
      from jsonb_array_elements(coalesce(stock,'[]'::jsonb)) e(value)) end),0)
    into v_pieces_after from pos.products where deleted_at is null;
  if v_products_after<>v_products_before or v_pieces_after<>v_pieces_before then
    raise exception 'H98_VISIBLE_PREVIEW_MUTATED_DATA';
  end if;

  raise notice 'H98_VISIBLE_PREVIEW counts=% generated_at=% products_unchanged=% pieces_unchanged=%',
    v_preview->'counts',v_preview->>'generated_at',v_products_after,v_pieces_after;
end;
$$;

rollback;
