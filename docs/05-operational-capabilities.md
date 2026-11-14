# Mapa de capacidades operativas

H-192, aprobado y aplicado en producción el 14/11/2026: las pantallas autorizan
sus operaciones mediante la correspondencia única
`pos.screen_operational_capabilities()`. El editor sincroniza
`user_capability_overrides` en la misma transacción. La autoridad de ejecución
sigue siendo `pos.require_current_capability(text)`, además de las guardas de
contexto del gateway. Las migraciones 234/235 reemplazan la separación H-56.

| Pantalla | Acción | Capacidad | Frontera | Protección |
|---|---|---|---|---|
| Vendedores | Liquidar comisión | `commissions.settle` | `settle_commission_checked` | RPC atómica, auditada e idempotente |
| Vendedores | Ajuste histórico de comisión | `commissions.settle` | `apply_commission_adjustment_checked` | La guarda reutiliza liquidación; la auditoría registra `commissions.adjust` |
| Vendedores | Cerrar periodo | `commissions.close_period` | `close_commission_period_checked` | RPC atómica, auditada e idempotente |
| Reportes | Consultar totales, devoluciones y liquidaciones | Ninguna de escritura | SELECT por pantalla | No concede liquidar ni cerrar periodos |
| Devoluciones | Devolver/reembolsar | `sales.refund` | `commit_return_checked` | wrapper sobre transacción vigente |
| Devoluciones | Cambiar mercancía | `sales.exchange` | `commit_exchange_checked` | wrapper sobre transacción vigente |
| Inventario | Alta/edición/ajuste | `inventory.adjust` | `save_products_checked` | sin escritura directa; auditada |
| Inventario | Baja lógica | `inventory.delete` | `delete_product_checked` | sin escritura directa; auditada |
| Configuración → Inventario | Vaciar inventario completo | `inventory.delete` **y administrador activo** | `dispatch_online_command`, rama `clearInventory` | Inventario no autoriza el vaciado a vendedores; conserva alcance, versiones y bloqueos comerciales |
| Configuración | Consultar ajustes y catálogos | Ninguna de escritura | snapshot/RLS vigentes | Sólo administradores conservan `settings.manage`; la pantalla no la concede |
| Configuración | Administrar permisos | Ninguna concedida por pantalla | guarda común de RPC administrativas | Sólo administradores con `permissions.manage` y pantallas requeridas |
| Punto de venta | Confirmar venta | `sales.create` | `commit_sale*_checked` | wrapper sobre transacción vigente |
| Punto de venta | Cobro inicial con dinero, incluida creación de apartado | `sales.create` + `sales.collect` | `commit_sale*_checked` | guarda compuesta |
| Apartados | Abono o liquidación | `sales.collect` | `commit_sale*_checked` | detecta apartado remoto existente |
| Clientes / Punto de venta | Crear | `customers.create` | gateway `online_save_entities` | capacidad en servidor |
| Clientes | Editar ficha | `customers.update` | gateway `online_save_entities` | POS no concede edición; sus agregados se actualizan dentro de la venta |
| Clientes | Eliminar | `customers.delete` | gateway `dispatch_online_command` → `soft_delete_entity` | capacidad en servidor; sin escritura directa |
| Descuentos | Administrar promociones | `promotions.manage` | gateway `online_save_entities` / `dispatch_online_command` | capacidad en servidor; sin escritura directa |
| Configuración → Usuarios | Administrar cuentas | No se concede por pantalla | gateway + Edge Function `admin-users` | `sellers.manage` queda reservado al perfil administrador |
| Préstamos | Entrega, devolución, faltante, cierre, edición, baja, reapertura | `inventory.loan.deliver/return/shortage/close/edit/delete/reopen` | `commit_loan_operation` | capacidad, versión e idempotencia |

## Compatibilidad

Las reglas del rol `admin` permanecen intactas. Para vendedor, la unión de sus
pantallas efectivas concede capacidades; las restantes reciben `deny`, incluso
si el rol las heredaba. `config.*` no concede escritura, ni administración de
usuarios. Las claves reservadas `sales.cancel`, `inventory.loan` y
`commissions.adjust` no se conceden a vendedores. El Ajuste histórico sí existe,
pero su guarda usa `commissions.settle`; `commissions.adjust` identifica su auditoría.
La denegación de una pantalla operativa también se respeta para administradores;
sus capacidades administrativas ajenas a este mapa no se derivan de `config.*`.
POS conserva venta, cobro y creación de clientes. Como `sales.collect`
se comparte, el gateway exige POS para una venta nueva y Apartados para abonar
o liquidar un apartado; denegar Apartados no impide cobrar una venta nueva.
Las dependencias compartidas permanecen si otra pantalla autorizada las usa.

Préstamos permite SELECT de su documento; Reportes y Vendedores permiten SELECT
de devoluciones, renglones y liquidaciones para completar sus totales, sin
conceder `sales.refund` por esa lectura. Las policies existentes no se alteran.
Los préstamos conservan su contrato: registran mercancía prestada, sin mover stock.
Inventario opera por gateway con capacidad; la guarda de vendedor reconoce ese
contexto privado y sigue rechazando escritura directa o marcadores falsificados.
El borrado lógico de clientes, promociones y usuarios ya exige la capacidad
de cada entidad en `dispatch_online_command` antes de `soft_delete_entity`
(H-164); no depende de permisos de `DELETE` directo.

## Fronteras pendientes

- No existe hoy una acción de cancelación: `Cancelado` es estado histórico.
- Cambio de método y reversión de cobro no existen como operaciones; no se
  infieren desde la edición de una fila.
- Préstamos operan bajo `inventory.loan.*` con documento remoto versionado
  (H-56 Fase 5), actualmente mediante el gateway online H-164.
  Pendiente: el servidor no valida cantidades devueltas.
