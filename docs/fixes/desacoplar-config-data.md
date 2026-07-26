# Desacoplar CONFIG de DATA

**Riesgo:** H-21
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** `d4d7e68`

## Problema y reproducción

`DATA` depende de `CONFIG` para catálogos y reglas, pero `CONFIG.inUse()` y
`CONFIG.removeCatalog()` dependían a su vez de `window.DATA.products`; el
segundo también invocaba `DATA.saveProducts()`.

Antes del cambio, `node test-module-contracts.mjs` aprobó 16/18: fallaron la
ausencia de dependencia directa y la existencia de un adaptador único.

## Causa raíz

La guarda de catálogos se implementó leyendo directamente la estructura global
del dominio. No existía una frontera para consultar productos ni solicitar su
persistencia, por lo que dos módulos cargados en orden quedaban conectados en
ambas direcciones.

## Diseño

- `DATA` conserva autoridad sobre el arreglo y `saveProducts()`.
- `CORE` sólo conserva funciones de acceso, nunca una copia de los datos.
- Antes del registro, la consulta devuelve `[]`, equivalente al comportamiento
  anterior cuando `window.DATA` todavía no existía.
- Mantener sin cambios las guardas de color, tallas, atributos y stock.
- Mantener la misma persistencia/sincronización al limpiar un atributo.

## Solución

`CORE` publica `registerCatalogProducts()`, `catalogProducts()` y
`saveCatalogProducts()`. `DATA` registra funciones sobre su arreglo real
después de publicar `window.DATA`. `CONFIG` usa exclusivamente ese adaptador y
ya no contiene referencias a `window.DATA`.

No cambiaron formatos, catálogos guardados, productos, cola, Supabase ni reglas.

## Pruebas

- Reproducción anterior: 16/18.
- `node test-module-contracts.mjs`: 20/20.
- Guarda de código de color usado: aprobada.
- Limpieza y persistencia de atributo custom: aprobada.
- `node test-concurrency.mjs`: 9/9.
- `node test-discounts.mjs`: 43/43.
- `node test-store-queue.mjs`: 97/97.
- `node test-role-access.mjs`: 10/10 reportadas por el arnés.
- `node build-offline.mjs`: correcto, 66 assets.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 13/13.
- `git diff --check`: correcto.

## Riesgo residual y pendientes

`CONFIG → DATA` quedó eliminado; `DATA → CONFIG` es una dependencia
unidireccional intencional porque configuración es la autoridad de catálogos.
`DATA ↔ STORE` sigue siendo una relación bidireccional más amplia y debe
analizarse en otra corrección, sin mezclar dominio y persistencia aquí.

La reversión restaura las dos lecturas directas de `window.DATA` y retira el
adaptador; no requiere migración ni modificación de datos.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-21--ciclo-directo-config--data-para-uso-de-catálogos`
- Arquitectura: `docs/02-architecture.md#core`
