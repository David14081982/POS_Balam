-- H-186: activar SOLO después de verificar los bytes publicados en GitHub Pages.
-- Aplicar antes las migraciones 225 y 226; esta activación es una operación separada.
-- Cambia exclusivamente el mínimo financiero 1 -> 2; repetir con 2 es inocuo.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '30s';

do $activation$
declare runtime pos.online_runtime%rowtype;
begin
  select * into runtime from pos.online_runtime where singleton is true for update;
  if not found then
    raise exception 'H186_RUNTIME_NOT_FOUND';
  end if;
  if runtime.enabled is distinct from true then
    raise exception 'H186_RUNTIME_NOT_ENABLED';
  end if;
  if runtime.min_financial_version is null or runtime.min_financial_version not in (1, 2) then
    raise exception 'H186_FINANCIAL_VERSION_UNEXPECTED';
  end if;
end;
$activation$;

select 'before' as phase, enabled, min_financial_version
from pos.online_runtime where singleton is true;

update pos.online_runtime
set min_financial_version = 2
where singleton is true and min_financial_version = 1;

do $verification$
begin
  if not exists (
    select 1 from pos.online_runtime
    where singleton is true and enabled is true and min_financial_version = 2
  ) then
    raise exception 'H186_FINANCIAL_ACTIVATION_FAILED';
  end if;
end;
$verification$;

select 'after' as phase, enabled, min_financial_version
from pos.online_runtime where singleton is true;

commit;
