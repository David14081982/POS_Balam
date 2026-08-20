# Estabilidad de la vista previa de limpieza

**Riesgo:** H-124
**Estado:** RESUELTO
**Fecha:** 20/08/2026
**Commit:** `69f7496`

## Problema y reproducción

Con `Ventas y apartados` seleccionado y un plan ejecutable, abrir **Continuar
con la limpieza** y pulsar **Crear respaldo y continuar** podía devolver
`CLEANUP_PREVIEW_CHANGED` sin que hubiera cambiado ninguna venta, pieza, pago,
época o bloqueo. La guarda impedía borrar, pero dejaba el diálogo con el resumen
anterior y mostraba un código interno sin una acción útil.

La reproducción roja de UI hace que el primer preview tenga `BG-ANTERIOR`, que
la creación de respaldo detecte un cambio y que el segundo preview tenga
`BG-NUEVA`. Antes de la corrección, el diálogo conservaba el primer plan y
exponía el código. La reproducción SQL cambia únicamente `last_seen_at` entre
dos planes comerciales idénticos; antes, sus hashes eran distintos.

## Causa raíz

`pos.test_data_cleanup_fleet_risk()` añadía el objeto completo `fleet` a
`v_core` y calculaba `plan_hash` sobre ese objeto. `fleet.devices` contiene
`last_seen_at`, estado de conexión y otros datos de observabilidad. A la vez,
`previewTestDataCleanup()` reconcilia el equipo antes de cada consulta. El
latido normal de Equipo David cambiaba `last_seen_at` entre la revisión y el
respaldo, aunque el alcance comercial fuera idéntico.

El segundo preview del cliente comparaba correctamente ambas huellas y fallaba
cerrado. El defecto estaba en la identidad del plan y, de forma secundaria, en
la recuperación de la UI.

## Diseño

- Supabase continúa siendo autoridad del alcance confirmado.
- `plan_hash` conserva selección, documentos, stock, época y
  `blocked_reasons`.
- `fleet` continúa en la respuesta para diagnóstico, pero no identifica el
  alcance comercial.
- Una operación pendiente intersectante modifica `blocked_reasons`, vuelve el
  plan no ejecutable y cambia la huella.
- Si ocurre un cambio real entre pasos, no se reutiliza el plan anterior: se
  consulta de nuevo, se cierra el diálogo obsoleto y se exige revisar el resumen
  actualizado.

No se relajó ninguna guarda ni se añadió un reintento automático de respaldo o
limpieza.

## Solución

- Migración `20260820016500`: autoridad privada
  `test_data_cleanup_plan_hash()` que excluye sólo `fleet`, y adopción exacta
  desde `test_data_cleanup_fleet_risk()`.
- Migraciones `20260820016600` y `20260820016700`: verificación estructural y
  regresión funcional transaccional con `ROLLBACK`.
- `balam/store.jsx`: esquema mínimo `20260820016500`, para desplegar servidor
  antes que cliente.
- `balam/settings.jsx`: traducción y recuperación de
  `cleanup_preview_changed`; refresca el plan, descarta el diálogo anterior y
  comunica que no se creó respaldo ni se borró información.
- `test-store-queue.mjs`: fixture H-121 actualizado al esquema vigente.

## Pruebas

- Regresión roja UI: falló esperando la recuperación y mostrando el código
  técnico antes del cambio.
- Regresión funcional remota autocontenida:
  `H124_CLEANUP_PREVIEW_STABILITY_OK heartbeat=stable blocking=invalidates`.
  Las semillas técnicas estuvieron dentro de `BEGIN … ROLLBACK`; no se ejecutó
  ninguna limpieza.
- H-124 contrato: 11/11.
- H-124 E2E: 11/11, incluidos 320, 390, 768 y 1440 px sin overflow.
- H-113: 35/35; H-116: 20/20; H-118: 10/10.
- Cola/sincronización: 186/186; contratos de módulos: 42/42; migraciones:
  31/31; build reproducible: 8/8; smoke del bundle: 17/17.
- `supabase db push --dry-run --linked`: sólo 165/166 antes del despliegue.
- Build offline completo: `index.html`, `POS Balam (offline).html`, PWA y
  service worker regenerados desde `balam/`.

## Riesgo residual y pendientes

Ninguno conocido dentro de H-124. Un cambio comercial o una nueva operación
pendiente seguirá invalidando el plan por diseño y exigirá una nueva revisión.
La venta `BG-260810-0011` no fue borrada ni modificada por esta corrección.

## Despliegue

Las migraciones 165–167 quedaron aplicadas antes del cliente. `origin/main`
avanzó sin fuerza hasta `598afcd`. GitHub Pages coincide byte por byte con el
blob publicado: 9,015,007 bytes y SHA-256
`6778c0200178a105832a5755cd51f296c4d5d688412651094bcc242605a7cdca`.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-124--la-telemetría-invalida-una-limpieza-sin-cambios-comerciales`
- `docs/fixes/limpieza-selectiva-datos-prueba.md`
- `docs/fixes/limpieza-h113-riesgo-real-equipos.md`
- `docs/architect/authorities/synchronization.md`
- ADR-012 y ADR-014.
