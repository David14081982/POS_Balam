-- POS Balam — Migración 015: acceso técnico del service_role al schema pos.
-- Complementa la 014 sin ampliar permisos de anon ni authenticated.

begin;

grant usage on schema pos to service_role;
grant all on all tables in schema pos to service_role;
grant usage on all sequences in schema pos to service_role;

alter default privileges in schema pos
  grant all on tables to service_role;
alter default privileges in schema pos
  grant usage on sequences to service_role;

commit;
