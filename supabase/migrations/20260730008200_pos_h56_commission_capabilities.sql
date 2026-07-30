-- H-56 Fase 5 grupo 1: liquidaciones y cierre de comisiones.

begin;

create or replace function pos.settle_commission_checked(
  p_operation_id uuid,
  p_seller_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pos, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_hash text := md5(coalesce(p_seller_id, ''));
  v_existing pos.capability_operation_audit%rowtype;
  v_seller pos.sellers%rowtype;
  v_result jsonb;
begin
  perform pos.require_current_capability('commissions.settle');
  if p_operation_id is null or nullif(trim(p_seller_id), '') is null then
    raise exception 'COMMISSION_OPERATION_INVALID' using errcode = '22023';
  end if;

  select * into v_existing
  from pos.capability_operation_audit
  where operation_id = p_operation_id;
  if found then
    if v_existing.capability_key <> 'commissions.settle'
       or v_existing.actor_user_id <> v_actor
       or v_existing.payload_hash <> v_hash then
      raise exception 'CAPABILITY_OPERATION_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_seller_id, 5601));
  select * into v_seller
  from pos.sellers
  where id = p_seller_id and deleted_at is null
  for update;
  if not found then
    raise exception 'COMMISSION_SELLER_NOT_FOUND' using errcode = '22023';
  end if;

  if coalesce(v_seller.comision_acum, 0) > 0 then
    insert into pos.liquidations(id, seller_id, seller, monto, tipo, fecha)
    values (
      'liq-' || p_operation_id::text, v_seller.id, v_seller.nombre,
      round(v_seller.comision_acum, 2), 'liquidacion',
      to_char(statement_timestamp(), 'YYYY-MM-DD HH24:MI')
    );
  end if;
  update pos.sellers
  set comision_acum = 0
  where id = v_seller.id;

  v_result := jsonb_build_object(
    'operation_id', p_operation_id,
    'seller_id', v_seller.id,
    'seller', v_seller.nombre,
    'amount', round(coalesce(v_seller.comision_acum, 0), 2),
    'settled_at', statement_timestamp()
  );
  insert into pos.capability_operation_audit(
    operation_id, capability_key, actor_user_id, subject_key,
    payload_hash, result
  ) values (
    p_operation_id, 'commissions.settle', v_actor, v_seller.id,
    v_hash, v_result
  );
  return v_result;
end;
$$;

create or replace function pos.close_commission_period_internal(
  p_operation_id uuid,
  p_seller_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pos, auth, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_hash text := md5(coalesce(array_to_string(p_seller_ids, ','), '*'));
  v_existing pos.capability_operation_audit%rowtype;
  v_seller pos.sellers%rowtype;
  v_total numeric := 0;
  v_count integer := 0;
  v_result jsonb;
begin
  perform pos.require_current_capability('commissions.close_period');
  if p_operation_id is null then
    raise exception 'COMMISSION_OPERATION_INVALID' using errcode = '22023';
  end if;

  select * into v_existing
  from pos.capability_operation_audit
  where operation_id = p_operation_id;
  if found then
    if v_existing.capability_key <> 'commissions.close_period'
       or v_existing.actor_user_id <> v_actor
       or v_existing.payload_hash <> v_hash then
      raise exception 'CAPABILITY_OPERATION_CONFLICT' using errcode = '22023';
    end if;
    return v_existing.result;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('commissions.close_period', 56));
  perform 1
  from pos.sellers s
  where s.deleted_at is null
    and (p_seller_ids is null or s.id = any(p_seller_ids))
  order by s.id
  for update;

  for v_seller in
    select s.*
    from pos.sellers s
    where s.deleted_at is null
      and (p_seller_ids is null or s.id = any(p_seller_ids))
    order by s.id
  loop
    if coalesce(v_seller.comision_acum, 0) > 0 then
      insert into pos.liquidations(id, seller_id, seller, monto, tipo, fecha)
      values (
        'cut-' || p_operation_id::text || '-' || v_seller.id,
        v_seller.id, v_seller.nombre, round(v_seller.comision_acum, 2),
        'corte', to_char(statement_timestamp(), 'YYYY-MM-DD HH24:MI')
      );
      v_total := v_total + v_seller.comision_acum;
      v_count := v_count + 1;
    end if;
    update pos.sellers
    set comision_acum = 0, ventas_mes = 0, ventas_num = 0
    where id = v_seller.id;
  end loop;

  v_result := jsonb_build_object(
    'operation_id', p_operation_id,
    'total', round(v_total, 2),
    'sellers', v_count,
    'period_started', current_date,
    'closed_at', statement_timestamp()
  );
  insert into pos.capability_operation_audit(
    operation_id, capability_key, actor_user_id, subject_key,
    payload_hash, result
  ) values (
    p_operation_id, 'commissions.close_period', v_actor, null,
    v_hash, v_result
  );
  return v_result;
end;
$$;

create or replace function pos.close_commission_period_checked(
  p_operation_id uuid
)
returns jsonb
language sql
security definer
set search_path = pos, auth, pg_temp
as $$
  select pos.close_commission_period_internal(p_operation_id, null);
$$;

create or replace function pos.restrict_direct_commission_writes()
returns trigger
language plpgsql
set search_path = pos, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (
       new.comision_acum is distinct from old.comision_acum
       or new.ventas_mes is distinct from old.ventas_mes
       or new.ventas_num is distinct from old.ventas_num
     ) then
    raise exception 'COMMISSION_RPC_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists sellers_restrict_direct_commission_writes on pos.sellers;
create trigger sellers_restrict_direct_commission_writes
before update on pos.sellers
for each row execute function pos.restrict_direct_commission_writes();

revoke insert, update, delete, truncate on pos.liquidations
  from public, anon, authenticated;
grant select on pos.liquidations to authenticated;

revoke all on function pos.settle_commission_checked(uuid, text)
  from public, anon;
revoke all on function pos.close_commission_period_internal(uuid, text[])
  from public, anon, authenticated;
revoke all on function pos.close_commission_period_checked(uuid)
  from public, anon;
revoke all on function pos.restrict_direct_commission_writes()
  from public, anon, authenticated;
grant execute on function pos.settle_commission_checked(uuid, text)
  to authenticated;
grant execute on function pos.close_commission_period_checked(uuid)
  to authenticated;

commit;
