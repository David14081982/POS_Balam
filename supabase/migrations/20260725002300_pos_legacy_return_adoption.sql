-- POS Balam — H-04: adopción exacta de devoluciones creadas por colas antiguas.

begin;

create or replace function pos.commit_legacy_return(
  p_commit_id text,
  p_return jsonb,
  p_items jsonb,
  p_moves jsonb,
  p_targets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  v_result jsonb;
  v_conflicts jsonb := '[]'::jsonb;
  v_target record;
  v_products jsonb := '[]'::jsonb;
  v_clients jsonb := '[]'::jsonb;
  v_sellers jsonb := '[]'::jsonb;
begin
  if not (pos.is_active_admin() or pos.is_active_seller()) then
    raise exception 'Cuenta sin permiso para adoptar devoluciones'
      using errcode = '42501';
  end if;

  if not coalesce((p_targets ->> 'complete')::boolean, false)
     or jsonb_typeof(p_targets -> 'products') <> 'array'
     or jsonb_array_length(p_targets -> 'products') = 0
     or jsonb_typeof(coalesce(p_targets -> 'sellers', '[]'::jsonb)) <> 'array' then
    return jsonb_build_object(
      'ok', false, 'error', 'legacy_context_incomplete'
    );
  end if;

  -- Bloqueo estable de todos los objetivos antes de comprobar versiones.
  perform p.id
    from pos.products p
   where p.id in (
     select x.id from jsonb_to_recordset(p_targets -> 'products')
       as x(id text, base_version bigint, stock jsonb)
   )
   order by p.id
   for update;

  for v_target in
    select * from jsonb_to_recordset(p_targets -> 'products')
      as x(id text, base_version bigint, stock jsonb)
  loop
    if not exists (
      select 1 from pos.products p
       where p.id = v_target.id
         and p.deleted_at is null
         and (
           p.sync_version = coalesce(v_target.base_version, 0)
           or (
             p.sync_version = coalesce(v_target.base_version, 0) + 1
             and p.stock = v_target.stock
           )
         )
    ) then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'entity', 'products', 'id', v_target.id
      ));
    end if;
  end loop;

  if p_targets -> 'client' is not null
     and jsonb_typeof(p_targets -> 'client') = 'object' then
    perform 1 from pos.clients
     where id = p_targets -> 'client' ->> 'id'
     for update;
    if not exists (
      select 1 from pos.clients c
       where c.id = p_targets -> 'client' ->> 'id'
         and c.deleted_at is null
         and (
           c.sync_version = coalesce((p_targets -> 'client' ->> 'base_version')::bigint, 0)
           or (
             c.sync_version = coalesce((p_targets -> 'client' ->> 'base_version')::bigint, 0) + 1
             and c.total = coalesce((p_targets -> 'client' ->> 'total')::numeric, 0)
           )
         )
    ) then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'entity', 'clients', 'id', p_targets -> 'client' ->> 'id'
      ));
    end if;
  end if;

  perform s.id
    from pos.sellers s
   where s.id in (
     select x.id from jsonb_to_recordset(coalesce(p_targets -> 'sellers', '[]'::jsonb))
       as x(id text, base_version bigint, ventas_mes numeric, comision_acum numeric)
   )
   order by s.id
   for update;

  for v_target in
    select * from jsonb_to_recordset(coalesce(p_targets -> 'sellers', '[]'::jsonb))
      as x(id text, base_version bigint, ventas_mes numeric, comision_acum numeric)
  loop
    if not exists (
      select 1 from pos.sellers s
       where s.id = v_target.id
         and s.active is true
         and s.deleted_at is null
         and (
           s.sync_version = coalesce(v_target.base_version, 0)
           or (
             s.sync_version = coalesce(v_target.base_version, 0) + 1
             and s.ventas_mes = v_target.ventas_mes
             and s.comision_acum = v_target.comision_acum
           )
         )
    ) then
      v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
        'entity', 'sellers', 'id', v_target.id
      ));
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object(
      'ok', false, 'error', 'legacy_version_conflict',
      'conflicts', v_conflicts
    );
  end if;

  -- Cabecera/renglones/movimientos se adoptan mediante el mismo commit
  -- idempotente. Los objetivos se aplican en esta misma transacción.
  v_result := pos.commit_return(
    p_commit_id, p_return, p_items, p_moves,
    '[]'::jsonb, null, '[]'::jsonb, true
  );
  if not coalesce((v_result ->> 'ok')::boolean, false) then
    return v_result;
  end if;

  for v_target in
    select * from jsonb_to_recordset(p_targets -> 'products')
      as x(id text, base_version bigint, stock jsonb)
  loop
    update pos.products
       set stock = v_target.stock,
           sync_base_version = sync_version,
           sync_device_id = 'legacy-return:' || p_commit_id
     where id = v_target.id
       and sync_version = coalesce(v_target.base_version, 0);
  end loop;

  if p_targets -> 'client' is not null
     and jsonb_typeof(p_targets -> 'client') = 'object' then
    update pos.clients
       set total = coalesce((p_targets -> 'client' ->> 'total')::numeric, 0),
           sync_base_version = sync_version,
           sync_device_id = 'legacy-return:' || p_commit_id
     where id = p_targets -> 'client' ->> 'id'
       and sync_version = coalesce((p_targets -> 'client' ->> 'base_version')::bigint, 0);
  end if;

  for v_target in
    select * from jsonb_to_recordset(coalesce(p_targets -> 'sellers', '[]'::jsonb))
      as x(id text, base_version bigint, ventas_mes numeric, comision_acum numeric)
  loop
    update pos.sellers
       set ventas_mes = v_target.ventas_mes,
           comision_acum = v_target.comision_acum,
           sync_base_version = sync_version,
           sync_device_id = 'legacy-return:' || p_commit_id
     where id = v_target.id
       and sync_version = coalesce(v_target.base_version, 0);
  end loop;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.id), '[]'::jsonb)
    into v_products from pos.products p
   where p.id in (
     select x.id from jsonb_to_recordset(p_targets -> 'products')
       as x(id text, base_version bigint, stock jsonb)
   );
  if p_targets -> 'client' is not null
     and jsonb_typeof(p_targets -> 'client') = 'object' then
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)
      into v_clients from pos.clients c
     where c.id = p_targets -> 'client' ->> 'id';
  end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb)
    into v_sellers from pos.sellers s
   where s.id in (
     select x.id from jsonb_to_recordset(coalesce(p_targets -> 'sellers', '[]'::jsonb))
       as x(id text, base_version bigint, ventas_mes numeric, comision_acum numeric)
   );

  return v_result || jsonb_build_object(
    'legacy_adopted', true,
    'products', v_products, 'clients', v_clients, 'sellers', v_sellers
  );
end;
$$;

revoke all on function pos.commit_legacy_return(
  text, jsonb, jsonb, jsonb, jsonb
) from public;
grant execute on function pos.commit_legacy_return(
  text, jsonb, jsonb, jsonb, jsonb
) to authenticated;

commit;
