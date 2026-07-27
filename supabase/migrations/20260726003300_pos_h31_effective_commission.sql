-- H-31: datos persistentes para la autoridad de comisión efectiva.
--
-- Las filas existentes conservan commission_policy_version = 0 y, por tanto,
-- su comision_pct se interpreta como porcentaje heredado. Las filas creadas
-- después de esta migración nacen en versión 1 y resuelven:
-- personalizada -> nivel comercial -> commission.basePct.
--
-- Reversión: respaldar estas tres columnas y eliminarlas sólo después de que
-- todos los clientes vuelvan al lector heredado de comision_pct.

alter table pos.sellers
  add column if not exists commission_override_pct numeric(5,2),
  add column if not exists seller_level_code text,
  add column if not exists commission_policy_version smallint;

update pos.sellers
set commission_policy_version = 0
where commission_policy_version is null;

alter table pos.sellers
  alter column commission_policy_version set default 1,
  alter column commission_policy_version set not null;

alter table pos.sellers
  drop constraint if exists sellers_commission_override_pct_range,
  add constraint sellers_commission_override_pct_range
    check (
      commission_override_pct is null
      or commission_override_pct between 0 and 100
    ),
  drop constraint if exists sellers_commission_policy_version_range,
  add constraint sellers_commission_policy_version_range
    check (commission_policy_version in (0, 1));
