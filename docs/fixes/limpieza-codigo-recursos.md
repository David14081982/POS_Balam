# Limpieza de código muerto y recursos no cargados

**Riesgo:** H-17
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Tres hojas heredadas permanecían en `balam/`: `styles.css`, `modules.css` y
`light.css`. Ninguna entrada HTML contenía un `href` hacia ellas y
`build-offline.mjs` sólo incorpora recursos locales encontrados en atributos
`src`/`href`. El build anterior enumeró 65 assets sin incluir estos CSS.

Además, `app.jsx` recibía `setTweak` sin usarlo y `discounts.jsx` importaba
`ToastHost` y declaraba `inDim` sin referencias posteriores. La búsqueda cubrió
fuente, entradas, build y pruebas.

Como referencia de comportamiento se recorrieron las nueve pantallas del
bundle antes de eliminar archivos. Todas renderizaron sin excepciones.

## Causa raíz

La migración visual a Tailwind reemplazó las hojas CSS antiguas en la entrada,
pero no eliminó los archivos. Refactors del shell y promociones dejaron
bindings que ya no participaban en ninguna ruta. Código existente y código
ejecutado dejaron de ser el mismo conjunto.

## Diseño

- Eliminar sólo archivos con carga cero y símbolos con referencias cero.
- No modificar reglas, datos, Supabase, localStorage ni cola.
- Preservar `tweaks-panel.jsx`: `App` usa `useTweaks` y el módulo expone
  componentes/protocolo para un host externo que no puede auditarse únicamente
  desde este repositorio.
- Proteger navegación completa, exports del editor y apariencia del bundle.
- Regenerar artefactos desde la fuente.

## Solución

- Se eliminaron 29 490 bytes de CSS heredado:
  `balam/styles.css`, `balam/modules.css` y `balam/light.css`.
- `app.jsx` conserva únicamente el valor devuelto por `useTweaks`.
- `discounts.jsx` dejó de importar `ToastHost` local y eliminó `inDim`.
- `test-ui-navigation.mjs` recorre todas las pantallas, comprueba los exports
  públicos del editor y falla si reaparecen archivos/referencias CSS antiguas.
- Se regeneraron `index.html` y `POS Balam (offline).html`.

## Pruebas

- Referencia anterior: nueve pantallas renderizadas, cero excepciones.
- Comparación visual contra el commit anterior, esperando fuentes y dos frames:
  21/21; nueve capturas idénticas byte por byte.
- `node test-ui-navigation.mjs`: 13/13.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-discounts.mjs`: 43/43.
- `node test-role-access.mjs`: 10/10.
- `node test-store-queue.mjs`: 97/97.
- `node test-sale-coherence.mjs`: 17/17.
- `node test-returns.mjs`: 17/17.
- `node test-filtros-inventario.mjs`: 18/18; el primer intento sin acceso CDN
  agotó el arranque y el reintento autorizado aprobó.
- `node test-migrations.mjs`: 24/24.
- `node build-offline.mjs`: correcto, 65 assets y bundle de 8.56 MB.

## Riesgo residual y pendientes

No se eliminaron los componentes `Tweak*` porque sus consumidores pueden vivir
en el host externo del protocolo de edición. La prueba confirma que continúan
disponibles en runtime y que las cadenas `postMessage` permanecen.

La eliminación es recuperable desde el commit anterior. La consolidación de
utilidades o contratos duplicados queda fuera de H-17 y corresponde a la Fase
16.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-17--código-y-estilos-heredados-sin-consumidores`
- Arquitectura: `docs/02-architecture.md#recursos-de-interfaz`
