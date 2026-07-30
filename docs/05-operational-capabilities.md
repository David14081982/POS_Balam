# Mapa de capacidades operativas

La visualización no autoriza operaciones. La autoridad operativa es
`pos.require_current_capability(text)` y cada frontera pública debe resolver una
clave estable antes de mutar datos.

| Pantalla | Acción | Capacidad | Frontera | Protección |
|---|---|---|---|---|
| Reportes / Vendedores | Liquidar comisión | `commissions.settle` | `settle_commission_checked` | RPC atómica, auditada e idempotente |
| Reportes | Cerrar periodo | `commissions.close_period` | `close_commission_period_checked` | RPC atómica, auditada e idempotente |
| Devoluciones | Devolver/reembolsar | `sales.refund` | `commit_return_checked` | wrapper sobre transacción vigente |
| Devoluciones | Cambiar mercancía | `sales.exchange` | `commit_exchange_checked` | wrapper sobre transacción vigente |
| Inventario | Alta/edición/ajuste | `inventory.adjust` | `save_products_checked` | sin escritura directa; auditada |
| Inventario | Baja lógica | `inventory.delete` | `delete_product_checked` | sin escritura directa; auditada |
| Configuración | Ajustes y catálogos | `settings.manage` | RLS `settings/lookup` | policy por capacidad |
| Configuración | Permisos | `permissions.manage` | guarda común de RPC administrativas | capacidad + permisos de pantalla |
| Punto de venta | Confirmar venta | `sales.create` | `commit_sale*_checked` | wrapper sobre transacción vigente |
| Punto de venta / Apartados | Cobro inicial con dinero | `sales.create` + `sales.collect` | `commit_sale*_checked` | guarda compuesta |
| Apartados | Abono o liquidación | `sales.collect` | `commit_sale*_checked` | detecta apartado remoto existente |
| Clientes | Crear | `customers.create` | RLS `clients` | policy por capacidad |
| Clientes | Editar | `customers.update` | RLS `clients` | policy por capacidad |
| Clientes | Eliminar | `customers.delete` | RLS `clients` | policy de delete |
| Descuentos | Administrar promociones | `promotions.manage` | RLS `promotions` | policy por capacidad |
| Vendedores | Administrar cuentas | `sellers.manage` | RLS + Edge Function `admin-users` | capacidad validada con JWT del actor |

## Compatibilidad

`admin` hereda todas las capacidades. `vendedor` conserva `sales.create`,
`sales.collect`, `sales.refund`, `sales.exchange`, `customers.create` y
`customers.update`; cualquier clave nueva nace denegada.

## Fronteras pendientes

- No existe hoy una acción de cancelación: `Cancelado` es estado histórico.
- Cambio de método y reversión de cobro no existen como operaciones; no se
  infieren desde la edición de una fila.
- Préstamos aún deben migrarse a `inventory.loan`.
- El borrado lógico genérico debe dividirse por entidad para que
  `customers.delete`, `promotions.manage` y `sellers.manage` cubran también
  tombstones, no sólo `DELETE`.
