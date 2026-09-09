# Propagación de una limpieza confirmada a los demás equipos

**Riesgo:** H-151
**Estado:** RESUELTO y publicado
**Fecha:** 09/09/2026
**Commit:** `d5989bb6bd1f3aa22d555ce725183d6afabed754`

## Problema y reproducción

Después de limpiar datos de prueba, otros equipos conservaban proyecciones
anteriores. La consulta remota de diagnóstico confirmó una limpieza terminada
a las 17:20:08 UTC, época 8, con cero ventas, devoluciones y cambios. EIFBB1 y
Z9ESB6 reportaban `must_rebootstrap` con cola vacía y cursores anteriores.

La reproducción controlada entrega un manifiesto de época nueva y su evento
de limpieza a una terminal con caché anterior. Sin intervención manual debe
descargar el estado confirmado, persistirlo y registrar el evento recibido.
La misma prueba sobre el código anterior da **2 aprobadas y 10 fallidas**.

## Causa raíz

`STORE.init()` detectaba la incompatibilidad de época y retornaba antes de
`applyRemoteSelectiveCleanup()`. La reconciliación y el polling también se
detenían por esa incompatibilidad. La recuperación manual existente podía
reconstruir la caché, pero no había entrada automática para una terminal vacía.

## Diseño

Se reutiliza `rebootstrapFromCloud()`: el servidor conserva la autoridad y
los mismos lectores completos reconstruyen las proyecciones V1/V2. Sólo un
evento compatible que coincida con la época actual autoriza esta ruta, con
cola totalmente vacía, escritor local válido y ninguna captura activa.

La cola se revisa nuevamente tras consultar el manifiesto, antes de archivar
o reconstruir. Una intención llegada durante la espera o un segundo cambio de
época detienen la recuperación automática. Las operaciones pendientes de
cualquier sesión se conservan. El evento se marca recibido después de la
reconstrucción, con lectura de comprobación del checkpoint durable.

## Solución

- `balam/store.jsx`: recuperación al arrancar, recibir el cambio de época o
  reintentar por polling; guardas de concurrencia y versión del evento.
- `test-h151-cleanup-propagation.mjs`: regresión ejecutable del fallo y sus
  límites, incluyendo carreras con nuevas intenciones y épocas posteriores.
- Certificador H148: tres perfiles Chrome independientes reciben el evento ya
  confirmado al recargar; compara las tablas comerciales antes y después y
  vigila que la recuperación no emita escrituras comerciales.
- Artefactos regenerados desde fuentes con `node build-offline.mjs`.

No requiere migraciones ni repite la limpieza del usuario.

## Pruebas

| Comando | Resultado |
|---|---|
| `node test-h151-cleanup-propagation.mjs` | 12/12 |
| `node test-h148-reconciliation.mjs` | 15/15 |
| `node test-h148-projection-durability.mjs` | 32/32 |
| `node test-h149-directed-recovery.mjs` | 15/15 |
| `node test-h113-selective-cleanup.mjs` | 35/35 |
| `node test-h148-sync-certification.mjs --self-test` | 18 certificados falsos rechazados |
| `node test-store-queue.mjs` | 186/186 |
| `node test-smoke.mjs` | 17/17 |
| `node test-ui-navigation.mjs` | 15/15 |
| `node test-build-reproducibility.mjs` | 8/8 |
| `BALAM_SYNC_LIVE=1 node test-h148-live-convergence.mjs` | 24/24 reales, 16 dominios |
| `node test-h148-sync-certification.mjs docs/fixes/evidence/h148-live-matrix.json` | CERTIFIED |
| `BALAM_TEST_URL=https://david14081982.github.io/POS_Balam/ node test-h150-cleanup-quarantine-sql-ui.mjs` | 12/12 sobre el cliente público, PostgreSQL local aislado y rollback |

La prueba específica real aprobó en los tres perfiles A/B/C: epoch 8, cola cero,
sincronizados, caché obsoleta retirada, cero RPC comerciales y 17 tablas sin
cambios. La matriz completa terminó el 09/09/2026 a las 17:59:42 UTC: 24/24,
sin pendientes perdidos ni divergencias, fixtures retirados y 17 huellas
comerciales originales idénticas antes/después. Esta prueba real ejerce
arranque automático con el evento existente; los casos de terminal abierta,
polling, fallos y carreras se ejercen en la regresión controlada. No se atribuye
esta certificación a las instalaciones físicas del usuario.

El primer intento real falló por una semilla de caché con ID ajeno al contrato
UUID/V3. Se corrigió el arnés para clonar una referencia V2 válida con un UUID
y barcode propios. No se relajó la validación del producto para admitirla.
Ese intento terminó limpiando sus fixtures y conservó las 17 huellas comerciales.

BALAM QA: navegación del bundle 15/15 y humo en Chrome 17/17. La matriz real
incluye recuperación dirigida en ocho anchos (320–1440), bloqueo de captura
durante la recuperación y persistencia tras recarga. Se inspeccionaron además
las capturas de 320 y 1280: aviso completo y legible, sin recorte ni overflow.

## Riesgo residual y pendientes

Los equipos deben cargar el nuevo cliente y tener conexión. Una cola pendiente,
una captura activa o un evento incompatible impiden la reconstrucción automática.
No se ha inspeccionado el almacenamiento local de las instalaciones físicas del
usuario. No volver a ejecutar la limpieza: basta cargar el nuevo cliente en cada
equipo; los pendientes reales conservan sus guardas.

## Publicación

Cliente `2026-09-09-h151` publicado en GitHub Pages desde `d5989bb` el
09/09/2026. HTML, HTML offline y service worker coinciden byte a byte con el
commit; evidencia en `docs/fixes/evidence/h151-public.json`. La comprobación
del flujo público de limpieza aprobó 12/12 contra PostgreSQL local aislado,
con rollback; no ejecutó una segunda limpieza en Supabase.

GitHub Actions del commit técnico: H148 sincronización
[`34386364457`](https://github.com/David14081982/POS_Balam/actions/runs/34386364457),
H132 identidad [`34386364374`](https://github.com/David14081982/POS_Balam/actions/runs/34386364374)
y Pages [`34386363657`](https://github.com/David14081982/POS_Balam/actions/runs/34386363657)
terminaron correctamente.

SHA-256 del HTML certificado:
`859c56a7811622399e30a2eeb7b0f14cfdfe22b11811c7a379a0c55cc7258ab8`.

## Referencias

- `docs/03-known-risks.md#h-151--equipos-vacíos-quedan-detenidos-tras-una-limpieza-remota`
- `docs/02-architecture.md`, limpieza selectiva y riesgo real de flota.
- `docs/fixes/limpieza-pendientes-cuarentena-h150.md`.
- `docs/fixes/evidence/h148-live-matrix.json`, certificado vigente al publicar.
