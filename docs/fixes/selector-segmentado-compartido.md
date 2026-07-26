# Selector segmentado compartido

**Riesgo:** H-25
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Clientes e Inventario declaraban localmente `Segment()` con la misma estructura,
estado activo, callbacks y tokens. Sólo Inventario añadía desplazamiento
horizontal y evitaba comprimir o partir opciones en pantallas estrechas.

Antes del cambio, `node test-module-contracts.mjs` aprobó 29/32: fallaron el
export compartido y la ausencia de las dos declaraciones locales.

## Causa raíz

El selector nació dentro de cada pantalla y no se incorporó a `window.UI`
cuando su contrato pasó a ser compartido. Como resultado, la defensa responsiva
se corrigió únicamente en Inventario.

## Diseño

- Publicar una sola implementación en `shared.jsx`.
- Conservar estructura, tokens, claves, valor activo y callback.
- Adoptar la defensa responsiva ya usada por Inventario.
- No cambiar opciones, estado, lógica de filtros, datos ni persistencia.
- Verificar visualmente todas las pantallas contra el bundle anterior.

## Solución

`window.UI.Segment` contiene la variante responsiva canónica. `clients.jsx` e
`inventory.jsx` la obtienen de `window.UI` y eliminaron sus copias locales. Las
invocaciones existentes permanecen sin cambios.

Se regeneraron `index.html` y `POS Balam (offline).html` desde `balam/`.

## Pruebas

- Reproducción anterior: 29/32.
- `node test-module-contracts.mjs`: 32/32.
- `node test-ui-navigation.mjs baseline`: 13/13 sobre el bundle anterior.
- `node test-ui-navigation.mjs compare`: 22/22; nueve pantallas idénticas píxel
  por píxel y sin excepciones.
- `node build-offline.mjs`: correcto, 66 assets.
- `node test-build-reproducibility.mjs`: 8/8.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-filtros-inventario.mjs`: no ejecutó casos; agotó 25 segundos al
  esperar dependencias CDN del archivo de desarrollo en el entorno restringido.

## Riesgo residual y pendientes

Riesgo bajo: `Segment` forma parte de la API global `window.UI`, acorde con la
arquitectura vigente. El orden de carga está congelado por contrato y la
comparación visual verificó ambos consumidores dentro del recorrido completo.

El fallo de arranque del arnés de desarrollo no afecta al bundle distribuido,
que sí fue recorrido; permanece como limitación ambiental de esa prueba.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-25--selector-segmentado-duplicado-en-clientes-e-inventario`
- Arquitectura: `docs/02-architecture.md#recursos-de-interfaz`
- Residual previo: `docs/fixes/limpieza-codigo-recursos.md`
