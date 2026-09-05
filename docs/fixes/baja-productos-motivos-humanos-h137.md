# Motivos claros cuando una baja está bloqueada

**Riesgo:** H-137
**Estado:** PARCIALMENTE RESUELTO
**Fecha:** 05/09/2026
**Commit:** `bf1b8cdd6e8a0537afe494fe2ad16a2efd671efb`

## Problema y reproducción

El usuario no puede eliminar referencias/familias. Sin identificación del caso
real todavía. La operación funciona en Chrome aislado: selección, confirmación,
baja local, solicitud durable y recarga, tanto individual como familiar.
H-114 contrato 13/13 y QA 55/55 también pasan. La consulta remota sólo lectura
encontró doce bajas recientes con estado sincronizado y sin diagnóstico; esto
no descarta un bloqueo local que todavía no haya llegado al servidor.

Se reprodujo un defecto de explicación: con cambios pendientes de enviar, el
aviso genérico oculta el motivo. La devolución vigente usa «restitución», poco
claro para quien opera el mostrador. Rojo: 36/39 en el recorrido ampliado.

## Causa raíz

Inventario entrega `guard.error`/`result.error` sin el código de la autoridad.
`messageAuthority` detecta jerga como «cola» y sustituye el mensaje por una
explicación genérica. No se encontró una falla general de la autoridad de baja.

## Diseño

Conservar las guardas y llevar su código y contexto hasta el catálogo central.
Mensajes específicos sólo en contexto `product_delete`, evitando reinterpretar
un `PRODUCT_NOT_FOUND` de otro flujo. La eliminación sigue identificando
products.id exactos; SKU no amplía el alcance. Sin cambio de datos ni SQL.

## Solución

`balam/inventory.jsx` conserva contexto/código/mensaje al mostrar el bloqueo.
`balam/shared.jsx` explica pendientes, apartado, confirmación de cobro, préstamo,
devolución vigente, producto ausente, familia cambiada y baja no guardada.
No se modifican permisos, validación, stock, cola ni documentos históricos.
Artefactos regenerados desde fuentes.

## Pruebas

- `node test-h137-delete-feedback.mjs`: rojo 36/39; verde ampliado 41/41.
  Ejercita UI + DATA + STORE reales en una sesión aislada con red bloqueada.
  Bloqueos por pendientes/apartado/préstamo/devolución; luego baja individual
  y familiar con históricos vencidos. Comprueba IDs exactos, otra familia
  intacta, documentos intactos, solicitud durable, stock y recarga.
- Ocho viewports 320–1440 px; capturas de aviso/modal móvil inspeccionadas.
- H-114 contrato 13/13 y QA 55/55; H-134 mensajes 43/43.
- H-134 E2E 26/26; H-136 lector 23/23; smoke bundle 17/17; navegación 15/15;
  build desde fuentes, reproducibilidad 8/8 y dos builds idénticos.
- Pages `built`, HTTP 200, bytes idénticos al blob Git aprobado;
  SHA-256 `22e697ba7ed69a663a3ce11c3c859c132cd50127844e59224e4d83a609f444c7`.
  H-137 contra el sitio publicado: 41/41, datos aislados y red de negocio bloqueada.

## Riesgo residual y pendientes

El bloqueo real reportado sigue sin identificar: se solicitó familia y aviso.
No se eliminó ningún producto real ni se invocó una RPC remota de baja. La
prueba verifica la solicitud local durable y H-114 cubre tombstone/pull;
no se afirma haber certificado una nueva eliminación en producción.

## Ampliación: alta, sincronización y baja — 05/09/2026

**Commit de la ampliación:** `f3e4d58`.

El recorrido nuevo tampoco reproduce el incidente: formulario de alta con dos
tallas → envío durable → confirmación SQL → baja individual/familiar → recarga
y pull. Mientras el alta está en vuelo se impide la baja y se explica que hay
cambios pendientes de enviar. Al confirmarse, ambas opciones funcionan sin
reabrir el selector. Esto demuestra una condición de bloqueo legítima; no
demuestra que haya sido la causa del caso reportado.

Se añadieron `test-h137-delete-sql.mjs` y `test-h137-delete-sync.mjs`, ejecutados
mediante una opción de la prueba H-138. Reutilizan PostgreSQL local PGlite 0.5.8
y las funciones de alta vigentes después de H-138; no agregan lógica de negocio.
Las definiciones actuales de baja/versionado se obtuvieron mediante una consulta
remota de sólo lectura y también se ejecutaron localmente.

Prueba final: **55/55** (18 altas H-138, 23 comprobaciones SQL de baja y 14 de
navegador). Regresión contractual H-114: **13/13**. Comando reproducible, con
`BALAM_PGLITE_MODULE` apuntando a `dist/index.js` de PGlite instalado externamente:

```powershell
node test-h138-registration-sql.mjs --delete-cycle --delete-browser
```

La ejecución contrastada añadió `--live-defs=C:/tmp/balam-h138-server-after-defs.json`
y `--delete-live-defs=C:/tmp/balam-h137-delete-defs.json`, exportaciones de
`pg_get_functiondef` (consultas de sólo lectura). Sin esas opciones carga las
migraciones del repositorio. Los errores iniciales del arnés —sentencia preparada
con dos comandos, cliente capturado antes de sustituir transporte y operaciones
auxiliares sin simular— se corrigieron en las pruebas, no en BALAM.

La prueba SQL verifica versión obsoleta, alcance incompleto, apartados,
préstamos, devolución vigente, idempotencia, tombstones versionados, otras
familias e históricos intactos. El navegador usa UI, DATA, STORE e IndexedDB
reales; el transporte de alta/baja ejecuta esas funciones en PGlite. Tras la
baja vacía deliberadamente la caché de productos del contexto aislado y exige
que el pull reconstruya el inventario sin resucitar los eliminados.

Límites: autenticación/capacidades/protocolo son fixtures; catálogos y telemetría
se simulan. No certifica RLS, red real, otra terminal ni la familia concreta del
usuario. No hubo cambio de aplicación, migración nueva ni modificación de datos
comerciales. H-137 conserva estado parcial: la explicación ya está corregida;
el incidente exacto de eliminación sigue sin reproducirse.

## Referencias

- `docs/03-known-risks.md`, H-137.
- `docs/fixes/paridad-capacidad-baja-productos-v1-v2.md`.
- `docs/fixes/autoridad-mensajes-humanos-h134.md`.
- `test-h137-delete-feedback.mjs`.
