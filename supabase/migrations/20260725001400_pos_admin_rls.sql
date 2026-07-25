-- POS Balam — Migración 014: acceso al dominio solo para administrador activo.
-- Contención H-07. El login actual del producto es exclusivo del administrador;
-- los vendedores se seleccionan dentro de la venta y no son identidades Auth.

begin;

create or replace function pos.is_active_admin()
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
       and s.role = 'admin'
       and s.active is true
       and s.deleted_at is null
  );
$$;

revoke all on function pos.is_active_admin() from public;
grant execute on function pos.is_active_admin() to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'settings', 'lookup', 'products', 'clients', 'sellers', 'sales',
    'sale_items', 'movements', 'promotions', 'returns', 'return_items',
    'liquidations', 'sale_payments', 'sync_conflicts'
  ]
  loop
    execute format('alter table pos.%I enable row level security', t);
    execute format('drop policy if exists auth_all on pos.%I', t);
    execute format('drop policy if exists active_admin_all on pos.%I', t);
    if t = 'sync_conflicts' then
      execute format(
        'drop policy if exists sync_conflicts_authenticated_select on pos.%I',
        t
      );
    end if;
    execute format(
      'create policy active_admin_all on pos.%I
         for all to authenticated
         using (pos.is_active_admin())
         with check (pos.is_active_admin())',
      t
    );
  end loop;
end;
$$;

-- Defensa en profundidad: visitantes sin sesión no reciben ni USAGE del schema.
revoke all on all tables in schema pos from anon;
revoke all on all sequences in schema pos from anon;
revoke usage on schema pos from anon;
alter default privileges in schema pos revoke all on tables from anon;
alter default privileges in schema pos revoke all on sequences from anon;

-- PostgREST necesita grants SQL además de una policy RLS aprobatoria.
grant usage on schema pos to authenticated;
grant all on all tables in schema pos to authenticated;
grant usage on all sequences in schema pos to authenticated;

commit;
