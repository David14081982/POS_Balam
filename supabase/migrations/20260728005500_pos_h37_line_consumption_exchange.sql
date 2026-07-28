-- H-37 (C4) · La rama de cambios que faltaba en pos.line_consumption
--
-- Defecto detectado por la verificación 20260728005600 al aplicarse sobre la
-- base real: tras registrar un cambio, la pieza DEVUELTA seguía con
-- disponible = 1.
--
-- Causa raíz: 20260728005300 creó la costura de SUMINISTRO (pos.line_supply)
-- pero no añadió la rama de cambios a la costura de CONSUMO. `line_consumption`
-- seguía leyendo únicamente `pos.return_items`, así que los renglones
-- `lado = 'devuelto'` de un cambio no restaban nada. Es exactamente el
-- `union all` que docs/fixes/saldo-por-renglon.md dejó anunciado para esta fase.
--
-- El espejo local no lo reveló porque `consumptionSources()` de balam/data.jsx
-- ya traía esa rama desde H-35: sólo faltaba del lado SQL.
--
-- 20260728005300 ya está registrada, así que no se reescribe (R-DB-01): se
-- corrige hacia adelante. La verificación se renumeró de 005400 a 005600 porque
-- las migraciones corren por orden de versión y debe ser la última (R-DB-02);
-- 005400 nunca llegó a registrarse.
--
-- Alcance: únicamente la definición de la vista y la reafirmación de su
-- contención. No se toca sale_line_balance, ni line_supply, ni commit_return.

create or replace view pos.line_consumption as
  select r.folio      as sale_folio,
         ri.sku       as sku,
         ri.talla     as talla,
         ri.qty       as qty,
         'devolucion'::text as origen,
         ri.return_id as documento
    from pos.return_items ri
    join pos.returns r on r.id = ri.return_id
  union all
  select e.origen_folio as sale_folio,
         ei.sku         as sku,
         ei.talla       as talla,
         ei.qty         as qty,
         'cambio'::text as origen,
         ei.exchange_id as documento
    from pos.exchange_items ei
    join pos.exchanges e on e.id = ei.exchange_id
   where ei.lado = 'devuelto';

comment on view pos.line_consumption is
  'H-35/H-37: consumos de unidades vendidas por documento — devoluciones y cambios. Interna: solo service_role, con security_invoker.';

-- Reafirmación explícita de la contención. `create or replace view` conserva
-- reloptions y grants, pero la lección de AP-02 y AP-03 es no depender de ello:
-- el privilegio por defecto del esquema pos concede toda relación a
-- `authenticated`, y sin security_invoker la vista evitaría el RLS de sus tablas.
alter view pos.line_consumption set (security_invoker = true);
revoke all on pos.line_consumption from authenticated;
revoke all on pos.line_consumption from anon;
revoke all on pos.line_consumption from public;
grant select on pos.line_consumption to service_role;
