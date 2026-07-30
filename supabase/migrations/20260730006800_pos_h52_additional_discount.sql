-- POS Balam — H-52: snapshot de descuento adicional y folio físico de un uso.
-- Aditiva: ventas históricas conservan NULL (no se inventa evidencia).

begin;

alter table pos.sales
  add column if not exists descuento_adicional numeric(12,2),
  add column if not exists total_antes_descuento_adicional numeric(12,2),
  add column if not exists descuentos_adicionales jsonb;

alter table pos.sale_items
  add column if not exists descuento_adicional numeric(12,2);

alter table pos.sales
  drop constraint if exists sales_additional_discount_chk;
alter table pos.sales
  add constraint sales_additional_discount_chk check (
    (descuento_adicional is null and total_antes_descuento_adicional is null and descuentos_adicionales is null)
    or (
      descuento_adicional >= 0
      and total_antes_descuento_adicional >= 0
      and jsonb_typeof(descuentos_adicionales) = 'array'
      and round(total_antes_descuento_adicional - descuento_adicional, 2) = round(total, 2)
    )
  );

alter table pos.sale_items
  drop constraint if exists sale_items_additional_discount_chk;
alter table pos.sale_items
  add constraint sale_items_additional_discount_chk
  check (descuento_adicional is null or descuento_adicional >= 0);

create table if not exists pos.physical_card_redemptions (
  folio text primary key,
  sale_folio text references pos.sales(folio) on delete restrict,
  claim_token text not null,
  claimed_by uuid,
  claimed_at timestamptz not null default now(),
  benefit_code text,
  benefit_name text,
  redeemed_by text,
  redeemed_at timestamptz
);

alter table pos.physical_card_redemptions enable row level security;
revoke all on pos.physical_card_redemptions from public, anon, authenticated;
grant all on pos.physical_card_redemptions to service_role;

drop policy if exists active_admin_select on pos.physical_card_redemptions;
create policy active_admin_select on pos.physical_card_redemptions
  for select to authenticated using (pos.is_active_admin());
grant select on pos.physical_card_redemptions to authenticated;

create or replace function pos.physical_card_available(p_folio text)
returns boolean
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_folio text := upper(trim(p_folio));
begin
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para validar tarjetas' using errcode = '42501';
  end if;
  if nullif(v_folio, '') is null then return false; end if;
  return not exists (
    select 1 from pos.physical_card_redemptions
    where folio = v_folio
      and (sale_folio is not null or claimed_at > now() - interval '15 minutes')
  );
end;
$$;
revoke all on function pos.physical_card_available(text) from public, anon;
grant execute on function pos.physical_card_available(text) to authenticated;

create or replace function pos.claim_physical_card(p_folio text, p_claim_token text)
returns boolean
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_folio text := upper(trim(p_folio));
  v_token text := trim(p_claim_token);
  v_existing pos.physical_card_redemptions%rowtype;
begin
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para validar tarjetas' using errcode = '42501';
  end if;
  if nullif(v_folio, '') is null or nullif(v_token, '') is null then return false; end if;
  perform pg_advisory_xact_lock(hashtext('physical-card:' || v_folio));
  select * into v_existing from pos.physical_card_redemptions where folio = v_folio;
  if found and v_existing.sale_folio is not null then return false; end if;
  if found and v_existing.claim_token = v_token then return true; end if;
  if found and v_existing.claimed_at > now() - interval '15 minutes' then return false; end if;
  delete from pos.physical_card_redemptions where folio = v_folio;
  insert into pos.physical_card_redemptions(folio, claim_token, claimed_by)
  values (v_folio, v_token, auth.uid());
  return true;
end;
$$;
revoke all on function pos.claim_physical_card(text, text) from public, anon;
grant execute on function pos.claim_physical_card(text, text) to authenticated;

create or replace function pos.commit_sale_with_additional_discount(
  p_commit_id text,
  p_operation_id text,
  p_sale jsonb,
  p_items jsonb,
  p_moves jsonb,
  p_payments jsonb,
  p_stock_lines jsonb,
  p_reserve_stock boolean,
  p_client_effect jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_result jsonb;
  v_folio text := p_sale ->> 'folio';
  v_app record;
  v_card text;
  v_prior text;
  v_claim text;
begin
  if jsonb_typeof(p_sale -> 'descuentos_adicionales') <> 'array'
     or coalesce((p_sale ->> 'descuento_adicional')::numeric, -1) < 0
     or coalesce((p_sale ->> 'total_antes_descuento_adicional')::numeric, -1) < 0
     or round(coalesce((p_sale ->> 'total_antes_descuento_adicional')::numeric, 0)
            - coalesce((p_sale ->> 'descuento_adicional')::numeric, 0), 2)
        <> round(coalesce((p_sale ->> 'total')::numeric, 0), 2) then
    return jsonb_build_object('ok', false, 'error', 'invalid_additional_discount');
  end if;

  if abs(
    coalesce((select sum(coalesce((x ->> 'descuento_adicional')::numeric, 0))
      from jsonb_array_elements(p_items) x), 0)
    - coalesce((p_sale ->> 'descuento_adicional')::numeric, 0)
  ) > 0.01 then
    return jsonb_build_object('ok', false, 'error', 'additional_discount_lines_mismatch');
  end if;

  -- La autoridad vigente realiza venta, inventario, pagos, cliente y vendedores.
  -- Una excepción posterior revierte también esos efectos: es una sola transacción.
  v_result := pos.commit_sale(
    p_commit_id, p_operation_id, p_sale, p_items, p_moves, p_payments,
    p_stock_lines, p_reserve_stock, p_client_effect, p_seller_effects
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then return v_result; end if;

  update pos.sales set
    descuento_adicional = (p_sale ->> 'descuento_adicional')::numeric,
    total_antes_descuento_adicional = (p_sale ->> 'total_antes_descuento_adicional')::numeric,
    descuentos_adicionales = p_sale -> 'descuentos_adicionales'
  where folio = v_folio;

  update pos.sale_items si set
    descuento_adicional = x.descuento_adicional
  from jsonb_to_recordset(p_items) as x(
    folio text, product_id text, sku text, nombre text, talla text,
    qty integer, precio numeric, precio_base numeric, precio_original numeric,
    promos jsonb, descuento_adicional numeric
  )
  where si.folio = v_folio and si.sku = x.sku and si.talla is not distinct from x.talla;

  for v_app in
    select value as app from jsonb_array_elements(p_sale -> 'descuentos_adicionales')
  loop
    if v_app.app ->> 'origin' = 'Tarjeta física' then
      v_card := upper(trim(v_app.app ->> 'cardFolio'));
      v_claim := trim(v_app.app ->> 'claimToken');
      if nullif(v_card, '') is null or nullif(v_claim, '') is null
         or coalesce((v_app.app ->> 'onlineVerified')::boolean, false) is not true then
        raise exception 'Tarjeta física sin validación en línea' using errcode = 'P0001';
      end if;
      perform pg_advisory_xact_lock(hashtext('physical-card:' || v_card));
      update pos.physical_card_redemptions set
        sale_folio = v_folio,
        benefit_code = v_app.app ->> 'benefitCode',
        benefit_name = v_app.app ->> 'benefitName',
        redeemed_by = v_app.app ->> 'appliedBy',
        redeemed_at = now()
      where folio = v_card and claim_token = v_claim
        and sale_folio is null and claimed_at > now() - interval '15 minutes';
      if not found then
        raise exception 'El folio de tarjeta física ya fue utilizado o la reserva expiró' using errcode = '23505';
      end if;
    end if;
  end loop;
  return v_result || jsonb_build_object('additional_discount', true);
end;
$$;

revoke all on function pos.commit_sale_with_additional_discount(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb
) from public, anon;
grant execute on function pos.commit_sale_with_additional_discount(
  text, text, jsonb, jsonb, jsonb, jsonb, jsonb, boolean, jsonb, jsonb
) to authenticated;

commit;
