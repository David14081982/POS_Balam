-- 20260730006500_pos_h47_exchange_commission.sql
--
-- H-47 (C7) · La comision del excedente del cambio se acredita y se puede revertir.
--
-- `pos.exchanges` ya guardaba `base_comision` —el excedente de valor, que es la
-- BASE de la comision segun el Contrato del Cambio, seccion 7— y desde H-42
-- guarda tambien `vendedor_id`, a quien le corresponde. Lo que faltaba era el
-- IMPORTE realmente acreditado y con que criterio se calculo.
--
-- Sin esa evidencia congelada (ADR-002) la reversa tendria que recalcular con la
-- configuracion vigente, y un cambio de `commission.base` o del porcentaje de un
-- vendedor entre el registro y la reversa descuadraria el acumulado: se restaria
-- una cifra distinta de la que se sumo. Es `AP-06` —derivar lo que debe ser
-- evidencia— aplicado a dinero de una persona.
--
-- Operacion ADITIVA. No borra, no reescribe filas existentes y no cambia ninguna
-- funcion: los cambios ya registrados quedan con comision acreditada 0, que es
-- exactamente lo que ocurrio con ellos.

alter table pos.exchanges
  add column if not exists comision_monto     numeric(12,2) not null default 0,
  add column if not exists comision_base      text,
  add column if not exists comision_pct       numeric(6,2)  not null default 0,
  add column if not exists comision_revertida timestamptz;

comment on column pos.exchanges.comision_monto is
  'H-47: importe de comision REALMENTE acreditado al vendedor del cambio. Evidencia congelada: la reversa resta esto, no un recalculo.';
comment on column pos.exchanges.comision_base is
  'H-47: criterio con el que se calculo, neto o bruto, vigente al registrar. Nunca se relee de la configuracion actual.';
comment on column pos.exchanges.comision_pct is
  'H-47: porcentaje del vendedor vigente al registrar el cambio.';
comment on column pos.exchanges.comision_revertida is
  'H-47: marca de reversa. Nula mientras la comision siga acreditada. Hace la reversa idempotente.';

-- El criterio solo admite los dos valores que el negocio reconoce. Se valida por
-- CHECK y no por tipo enumerado para que la columna siga siendo aditiva y no
-- obligue a crear un tipo nuevo en una base con datos.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'exchanges_comision_base_check'
       and conrelid = 'pos.exchanges'::regclass
  ) then
    alter table pos.exchanges
      add constraint exchanges_comision_base_check
      check (comision_base is null or comision_base in ('neto', 'bruto'));
  end if;
end $$;
