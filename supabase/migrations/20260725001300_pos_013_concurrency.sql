-- POS Balam — Migración 013: control optimista multi-terminal y tombstones.
-- Ejecutar después de pos_012_sale_payments.sql.

begin;

create table if not exists pos.sync_conflicts (
  id               bigint generated always as identity primary key,
  entity           text not null,
  entity_id        text not null,
  operation        text not null check (operation in ('upsert', 'delete')),
  expected_version bigint not null,
  actual_version   bigint not null,
  attempted        jsonb,
  current_row      jsonb,
  device_id        text,
  actor_id         uuid default auth.uid(),
  occurred_at      timestamptz not null default now()
);

alter table pos.sync_conflicts enable row level security;
drop policy if exists sync_conflicts_authenticated_select on pos.sync_conflicts;
create policy sync_conflicts_authenticated_select on pos.sync_conflicts
  for select to authenticated using (true);

-- Columnas compatibles con filas históricas: la versión 0 significa que todavía
-- no ha ocurrido una escritura bajo el contrato H-06.
alter table pos.products
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_base_version bigint,
  add column if not exists sync_device_id text,
  add column if not exists deleted_at timestamptz;
alter table pos.clients
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_base_version bigint,
  add column if not exists sync_device_id text,
  add column if not exists deleted_at timestamptz;
alter table pos.sellers
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_base_version bigint,
  add column if not exists sync_device_id text,
  add column if not exists deleted_at timestamptz;
alter table pos.promotions
  add column if not exists sync_version bigint not null default 0,
  add column if not exists sync_base_version bigint,
  add column if not exists sync_device_id text,
  add column if not exists deleted_at timestamptz;

create or replace function pos.guard_entity_version()
returns trigger
language plpgsql
security definer
set search_path = pos, pg_temp
as $$
declare
  op text;
begin
  if tg_op = 'INSERT' then
    new.sync_version := 1;
    new.sync_base_version := null;
    new.updated_at := now();
    return new;
  end if;

  op := case when new.deleted_at is not null
                  and old.deleted_at is null then 'delete' else 'upsert' end;

  if new.sync_base_version is not null
     and new.sync_base_version <> old.sync_version then
    insert into pos.sync_conflicts (
      entity, entity_id, operation, expected_version, actual_version,
      attempted, current_row, device_id
    ) values (
      tg_table_name, old.id, op, new.sync_base_version, old.sync_version,
      to_jsonb(new) - 'sync_base_version', to_jsonb(old),
      new.sync_device_id
    );
    -- La sentencia termina con éxito pero conserva y devuelve la fila vigente.
    -- STORE compara la versión devuelta y trata el resultado como conflicto.
    return old;
  end if;

  new.sync_version := old.sync_version + 1;
  new.sync_base_version := null;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists products_guard_entity_version on pos.products;
create trigger products_guard_entity_version
before insert or update on pos.products
for each row execute function pos.guard_entity_version();

drop trigger if exists clients_guard_entity_version on pos.clients;
create trigger clients_guard_entity_version
before insert or update on pos.clients
for each row execute function pos.guard_entity_version();

drop trigger if exists sellers_guard_entity_version on pos.sellers;
create trigger sellers_guard_entity_version
before insert or update on pos.sellers
for each row execute function pos.guard_entity_version();

drop trigger if exists promotions_guard_entity_version on pos.promotions;
create trigger promotions_guard_entity_version
before insert or update on pos.promotions
for each row execute function pos.guard_entity_version();

-- El borrado conserva la fila para que una terminal vieja no pueda reinsertarla.
-- SECURITY INVOKER mantiene las políticas RLS de la tabla objetivo.
create or replace function pos.soft_delete_entity(
  p_entity text,
  p_id text,
  p_base_version bigint,
  p_device_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = pos, pg_temp
as $$
declare
  result jsonb;
begin
  if p_entity not in ('products', 'clients', 'sellers', 'promotions') then
    raise exception 'Entidad no permitida: %', p_entity;
  end if;

  execute format(
    'update pos.%I
       set deleted_at = now(),
           sync_base_version = $2,
           sync_device_id = $3
     where id = $1
     returning to_jsonb(%I.*)',
    p_entity, p_entity
  ) into result using p_id, coalesce(p_base_version, 0), p_device_id;

  return result;
end;
$$;

grant execute on function pos.soft_delete_entity(text, text, bigint, text)
  to authenticated;
grant select on pos.sync_conflicts to authenticated;

commit;
