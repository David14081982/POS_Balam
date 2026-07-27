# Arneses E2E sin dependencia de CDN

**Riesgo:** H-27
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Ocho pruebas Playwright abrían `POS Balam.html`. Esa entrada de desarrollo
necesita React/Babel desde CDN, por lo que filtros e importación de fotos
agotaron sus timeouts antes de ejecutar casos en el entorno restringido.

`node test-browser-harness-entry.mjs` aprobó 0/8 antes del cambio: fotos
automáticas, exportación, filtros, importación, liquidaciones, dos resets y
seguridad XLSX servían y visitaban la entrada de desarrollo.

## Causa raíz

Los arneses se crearon antes de que el bundle fuera reproducible y autónomo, y
conservaron la entrada Babel aunque validaban comportamiento integrado. Dos
pruebas de nube falsa dependían además del cliente Supabase descargado para
emitir solicitudes que después interceptaban localmente.

## Diseño

- Ejecutar el artefacto realmente distribuido: `index.html`.
- No cambiar fixtures, casos, puertos ni aserciones funcionales.
- Conservar lecturas estáticas de `POS Balam.html`.
- Conservar los modos desarrollo/bundle deliberados de `test-smoke.mjs`.
- Simular Supabase dentro del navegador cuando el arnés necesita su transporte.
- Mantener toda solicitud real confinada o abortada.

## Solución

Los ocho servidores y `page.goto()` apuntan a `index.html`.

`test-auto-fotos.mjs` instala un cliente controlado con Auth, consultas vacías y
Storage reemplazable. `test-reset-propaga.mjs` instala un adaptador PostgREST
basado en `fetch`, que sigue atravesando las rutas Playwright existentes, y su
nube falsa aplica los efectos de `commit_sale`/`commit_return` sobre venta,
devolución y stock. El fixture ya no encola un snapshot de producto junto al
RPC, evitando una doble reserva artificial.

## Pruebas

- Reproducción anterior: entrada local 0/8.
- `node test-browser-harness-entry.mjs`: 8/8.
- `node test-auto-fotos.mjs`: 11/11.
- `node test-export-modelo.mjs`: 14/14.
- `node test-filtros-inventario.mjs`: 18/18.
- `node test-import-fotos.mjs`: 23/23.
- `node test-liquidations.mjs`: 10/10.
- `node test-reset-propaga.mjs`: 21/21.
- `node test-reset-pruebas.mjs`: 19/19.
- `node test-xlsx-security.mjs`: 17/17.
- `node test-module-contracts.mjs`: 36/36.
- `node test-build-reproducibility.mjs`: 8/8.
- `node test-smoke.mjs bundle`: 17/17.

No se regeneraron artefactos: esta corrección sólo modifica pruebas y
documentación; la fuente `balam/` permanece idéntica.

## Riesgo residual y pendientes

Riesgo bajo. Los adaptadores de nube falsa implementan sólo los contratos
ejercitados y están protegidos por sus aserciones completas. No sustituyen las
verificaciones de Supabase real documentadas en riesgos de datos y RLS.

El modo de desarrollo de `test-smoke.mjs` sigue requiriendo CDN cuando se invoca
sin `bundle`; se conserva deliberadamente para diagnosticar la entrada fuente.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-27--ocho-arneses-e2e-dependen-de-babel-y-cdn`
- Arquitectura: `docs/02-architecture.md#build-offline`
- Smoke: `docs/fixes/arnes-smoke-confiable.md`
- Build: `docs/fixes/build-sin-dependencias-remotas.md`
