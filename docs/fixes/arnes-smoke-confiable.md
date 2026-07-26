# Arnés smoke confiable

**Riesgo:** H-15
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** `8f6ce90`

## Problema y reproducción

`node test-smoke.mjs bundle` arrancaba la aplicación y aprobaba las primeras
siete verificaciones, pero Playwright agotaba 30 segundos al pulsar `Cancelar`.
El botón era visible y estable; `#__bundler_err` interceptaba los eventos de
puntero. Una excepción antes del final omitía además el cierre explícito de
Chrome y del servidor HTTP.

## Causa raíz

El bundle muestra un panel global para eventos `error`, incluidos eventos
genéricos de recursos que no son excepciones JavaScript. El smoke no separaba
ese diagnóstico auxiliar de la superficie interactiva. El cierre de recursos
sólo estaba en la ruta exitosa y la jaula Supabase abortaba solicitudes sin una
sonda que demostrara su aislamiento.

La imagen truncada original era un factor contribuyente, pero no la causa
completa: con una imagen PNG válida persistieron 12 mensajes genéricos, cero
`pageerror`, cero imágenes rotas y cero solicitudes Supabase espontáneas.

## Diseño

- No modificar la aplicación ni los artefactos de producción.
- Mantener visible el panel para diagnóstico, pero impedir que bloquee clics
  únicamente dentro del navegador de prueba.
- Conservar `pageerror` como fallo por excepción JavaScript.
- Responder localmente cualquier URL Supabase y probar la jaula con una sonda.
- Cerrar Chrome y servidor mediante `try/finally` en éxito o error.
- Usar un fixture de imagen válido para no introducir ruido propio.

## Solución

`test-smoke.mjs` usa un PNG embebido válido, inyecta
`pointer-events:none` para `#__bundler_err`, simula Supabase con HTTP 401 y
verifica la intercepción mediante una petición de sonda. Todo el recorrido está
envuelto en `try/catch/finally`; una interrupción suma un fallo legible y siempre
libera navegador y servidor.

## Pruebas

- Reproducción previa: 9 verificaciones alcanzadas, 1 interrupción por timeout;
  el overlay interceptó `Cancelar`.
- `node --check test-smoke.mjs`: correcto.
- Primera ejecución de `node test-smoke.mjs bundle`: 17/17.
- Segunda ejecución consecutiva: 17/17, sin conflicto en el puerto 8803.
- Cada ejecución interceptó la sonda Supabase y respondió localmente HTTP 401.
- Ambas ejecuciones terminaron con cero `pageerror`.

## Riesgo residual y pendientes

El panel generado contiene 12 mensajes de recurso sin URL. Ya no produce falsos
negativos ni oculta excepciones JavaScript, pero el bundler podría enriquecer
esos mensajes en una corrección separada. No afecta los datos ni realiza
peticiones al Supabase real.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-15--smoke-e2e-produce-falsos-negativos-y-no-libera-recursos-al-fallar`
- Corrección relacionada: `docs/fixes/diagnostico-cola-offline.md`
