-- POS Balam — Migración 016: vendedor activo limitado a operaciones del POS.

begin;

create or replace function pos.is_active_seller()
returns boolean
language sql
stable
security definer
set search_path = pos, pg_temp
as $$
  select exists (
    select 1
      from pos.sellers s
     where lower(s.email) = lower(auth.jwt() ->> 'email')
       and s.role = 'vendedor'
       and s.active is true
       and s.deleted_at is null
  );
$$;

revoke all on function pos.is_active_seller() from public;
grant execute on function pos.is_active_seller() to authenticated;

-- Catálogo y contexto necesarios para cobrar.
create policy seller_select on pos.settings
  for select to authenticated using (pos.is_active_seller());
create policy seller_select on pos.lookup
  for select to authenticated using (pos.is_active_seller());
create policy seller_select on pos.promotions
  for select to authenticated using (pos.is_active_seller());
create policy seller_select on pos.products
  for select to authenticated using (pos.is_active_seller());
create policy seller_select on pos.clients
  for select to authenticated using (pos.is_active_seller());
create policy seller_select on pos.sellers
  for select to authenticated using (pos.is_active_seller());

-- El POS puede ajustar stock y agregados, pero no administrar estas entidades.
create policy seller_update on pos.products
  for update to authenticated
  using (pos.is_active_seller())
  with check (pos.is_active_seller());
create policy seller_insert on pos.clients
  for insert to authenticated
  with check (pos.is_active_seller());
create policy seller_update on pos.clients
  for update to authenticated
  using (pos.is_active_seller())
  with check (pos.is_active_seller());
create policy seller_update on pos.sellers
  for update to authenticated
  using (pos.is_active_seller())
  with check (pos.is_active_seller());

-- Persistencia idempotente de la venta y sus movimientos de dinero/inventario.
create policy seller_pos_all on pos.sales
  for all to authenticated
  using (pos.is_active_seller())
  with check (pos.is_active_seller());
create policy seller_pos_all on pos.sale_items
  for all to authenticated
  using (pos.is_active_seller())
  with check (pos.is_active_seller());
create policy seller_pos_all on pos.movements
  for all to authenticated
  using (pos.is_active_seller())
  with check (pos.is_active_seller());
create policy seller_pos_all on pos.sale_payments
  for all to authenticated
  using (pos.is_active_seller())
  with check (pos.is_active_seller());

-- Un vendedor sólo puede cambiar existencias/versionado en productos.
create or replace function pos.restrict_seller_product_update()
returns trigger
language plpgsql
set search_path = pos, pg_temp
as $$
begin
  if pos.is_active_seller() and not pos.is_active_admin() and
     (to_jsonb(new) - array[
       'stock', 'sync_base_version', 'sync_version', 'sync_device_id',
       'updated_at'
     ]) is distinct from
     (to_jsonb(old) - array[
       'stock', 'sync_base_version', 'sync_version', 'sync_device_id',
       'updated_at'
     ]) then
    raise exception 'El vendedor sólo puede actualizar existencias'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists products_restrict_seller_update on pos.products;
create trigger products_restrict_seller_update
before update on pos.products
for each row execute function pos.restrict_seller_product_update();

-- En vendedores sólo se actualizan acumulados calculados durante el cobro.
create or replace function pos.restrict_seller_metrics_update()
returns trigger
language plpgsql
set search_path = pos, pg_temp
as $$
begin
  if pos.is_active_seller() and not pos.is_active_admin() and
     (to_jsonb(new) - array[
       'ventas_mes', 'ventas_num', 'comision_acum', 'bono',
       'sync_base_version', 'sync_version', 'sync_device_id', 'updated_at'
     ]) is distinct from
     (to_jsonb(old) - array[
       'ventas_mes', 'ventas_num', 'comision_acum', 'bono',
       'sync_base_version', 'sync_version', 'sync_device_id', 'updated_at'
     ]) then
    raise exception 'El vendedor sólo puede actualizar métricas de venta'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists sellers_restrict_seller_update on pos.sellers;
create trigger sellers_restrict_seller_update
before update on pos.sellers
for each row execute function pos.restrict_seller_metrics_update();

commit;
