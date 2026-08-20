# Operación terminal para evidencias huérfanas de devoluciones

**Riesgo:** H-123
**Estado:** RESUELTO — implementación y limpieza real verificadas
**Fecha:** 20/08/2026
**Commit:** `d365e8b`

## Problema y reproducción

La limpieza selectiva detectaba dos `return_commits` sin una fila correspondiente
en `pos.returns`: `BG-260811-0015` y `BG-260812-0001`. La guarda H-120 impedía
limpiar Devoluciones, pero la interfaz no ofrecía una operación terminal para
retirar únicamente esas evidencias técnicas.

La prueba roja `test-h123-orphan-return-cleanup-e2e.mjs` confirmó que el grupo
seleccionable no existía. El preview remoto previo identificó exactamente los dos
folios y demostró ausencia de cabecera comercial, renglones, movimientos, pagos y
venta vigente asociados.

## Causa raíz

H-120 agregó detección y bloqueo cerrado, pero dejó incompleto el ciclo de vida:

- `test_data_cleanup_plan()` sólo exponía el detalle como una guarda de
  Devoluciones;
- `test_data_cleanup_payload()` no lo respaldaba como alcance autónomo;
- `execute_test_data_cleanup()` sólo podía retirar commits unidos a una
  devolución comercial seleccionada;
- la UI no tenía un dominio explícito para resolver la evidencia.

## Diseño

`orphan_return_evidence` es un dominio técnico, explícito y opt-in. Supabase
selecciona por `commit_id` y conserva también el `return_id` para colocar la
lápida antirresurrección. Antes de borrar, la ejecución toma el mismo advisory
lock que `commit_return`, vuelve a demostrar que el commit existe y continúa
sin cabecera comercial, y exige cardinalidad exacta.

El dominio tiene efecto cero sobre inventario y finanzas: no crea devoluciones,
`return_items`, pagos, movimientos ni documentos comerciales; tampoco recompone
ventas o comisiones. Un cambio del conjunto seleccionado invalida el `plan_hash`.
Si el administrador selecciona Devoluciones pero no el dominio huérfano, la
guarda H-120 permanece cerrada.

## Solución

- `20260820016300_pos_h123_orphan_return_cleanup.sql` extiende plan, respaldo,
  riesgo de flota y ejecución exacta; eleva el protocolo selectivo a 5 y el
  esquema a `20260820016300`.
- `20260820016400_pos_h123_orphan_return_cleanup_verification.sql` verifica el
  contrato dentro de `BEGIN/ROLLBACK`.
- `balam/settings.jsx` muestra el nuevo grupo, conteo, folio, fecha e identidad
  técnica, y explica explícitamente el efecto cero.
- `balam/store.jsx` anuncia el esquema y protocolo vigentes.
- Las regresiones H-113, H-116, H-119, H-120 y H-122 se actualizaron al contrato
  de ocho dominios/protocolo 5.

## Pruebas

- Prueba roja inicial: grupo ausente, 0/1.
- PostgreSQL 18 aislado: migraciones 163/164 aplicadas; verificación
  `H123_ORPHAN_RETURN_OK`.
- Fixture funcional transaccional: `H123_FUNCTIONAL_OK orphan=2
  valid_return=preserved stock=7 finance=preserved receipt=completed`.
- UI H-123: 15/15; flujo completo de preview, respaldo, confirmación y ejecución
  simulada; 320, 360, 390, 430, 768, 1024 y 1440 px sin overflow.
- H-113 UI 21/21; H-116 contrato 20/20 y UI 29/29; H-118 10/10;
  H-119 E2E real contra PostgreSQL aislado 37/37; H-122 UI 21/21.
- Cola local-first: 186/186. Migraciones: 31/31. Navegación: 15/15.
- Smoke del bundle productivo: 17/17. `node build-offline.mjs`: correcto.
- Supabase: dry-run exacto 163/164; ambas migraciones aplicadas y verificación
  remota correcta. La migración no eliminó las evidencias reales.
- Ejecución real `0820e643-5b84-4bf0-b662-dfe7a845858a`: cola 0/0,
  cuarentena accionable 0/0, preview exacto de dos commits y cero líneas de
  stock. Retiró únicamente `BG-260811-0015` y `BG-260812-0001`; la época avanzó
  una vez, de 2 a 3.
- La huella SHA-256 de todos los dominios comerciales no relacionados fue
  `68a09bd1e6a2244f64fd5e1abd0e16fdbe02f64c4a3a43a1d447c359f3ae3126`
  antes y después. El postflight confirmó ausencia de cabeceras, renglones,
  movimientos, pagos y ventas asociados, además de cola y cuarentena en cero.

## Despliegue

Las migraciones 163/164 se aplicaron antes del cliente. El cliente fue publicado
desde `d365e8b` y su `index.html` servido coincidió byte por byte con el build.
La ejecución exacta descargó el expediente inerte en
`C:\Users\david\Documents\BALAM-respaldos\H-123-20260820-equipo-david`:

- `01-preflight.json`: SHA-256
  `fca2303fc43a531fc039cd418d0e0f429806f667e85b63230b264cab0e4ad9fb`;
- `02-respaldo-autoritativo.json`: 452,159 bytes, SHA-256
  `d06376a60769fda39dc2b6749a6998de0d6ee67cfeebca814844b81fc8a0b142`;
- `03-comprobante.json`: SHA-256
  `73952a7212bcc8e388e22c7319797563f24ea5938cd727706490018e16b0c366`;
- `04-verificacion-post.json`: SHA-256
  `3b719c50ae6f096d7e8e57e4ee769c25247b6738f59b6a1f70524fc8227b7b33`;
- `SHA256SUMS.json`: SHA-256
  `50196dd485f459a467639a90e937898ef9128869b37125cacb71e674bf771772`.

## Riesgo residual y pendientes

Ninguno conocido dentro de H-123. Las dos lápidas por `return_id` impiden
resurrección y el expediente permanece fuera de toda colección operativa. La
operación no reconstruyó históricos ni tocó stock, ventas, pagos, movimientos o
comisiones. `BG-260810-0011` pertenece a H-122 y quedó deliberadamente fuera de
este alcance.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-123--evidencias-huérfanas-de-devolución-sin-operación-terminal`
- Arquitectura: `docs/02-architecture.md`, «Limpieza selectiva y riesgo real de flota».
- Correcciones relacionadas: `consistencia-devoluciones-limpieza.md`,
  `claridad-dominios-limpieza.md`, `autoridad-unica-datos-h121.md`.
