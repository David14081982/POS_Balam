# Lector HID: guiones interpretados como apóstrofes

**Riesgo:** H-126
**Estado:** RESUELTO LOCALMENTE — PENDIENTE DE PUBLICACIÓN
**Fecha:** 27/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Un lector USB HID emula un teclado. Si la distribución configurada en el lector
no coincide con la del sistema operativo, la tecla física usada para `-` puede
llegar al navegador como `'`. POS, Préstamos y Cambios entregaban ese texto sin
adaptación a `BARCODES.resolve()`, cuya coincidencia era exclusivamente literal.

Con una pieza sintética cuyo código era `21-ML-ALG-38-128`, la lectura
`21'ML'ALG'38'128` devolvía `BARCODE_NOT_FOUND`. La prueba roja registró 5/8:
fallaron resolución, identidad física y el adaptador `find()` de Préstamos.

## Causa raíz

Las capturas directa y global conservaban correctamente `KeyboardEvent.key`,
pero `balam/barcodes.jsx` sólo comparaba el texto recibido contra el código
materializado. No existía un segundo intento acotado para la sustitución que
introduce la distribución del teclado. La reproducción determinista demuestra
el corte entre la entrada HID y la autoridad compartida de resolución.

## Diseño

La resolución conserva estas invariantes:

1. el texto literal se busca siempre primero;
2. un código real que contiene `'` mantiene prioridad exacta;
3. sólo ante `BARCODE_NOT_FOUND` y presencia de `'` se intenta el candidato con
   `'` sustituido por `-`;
4. una coincidencia ambigua literal permanece bloqueada y no se reinterpreta;
5. `codeOf()`, SKU, `products.id`, `barcode_code`, etiquetas, inventario e
   históricos no se escriben ni transforman.

La capacidad modificada es de sólo lectura:

| Flujo equivalente | V1 | V2 | Paridad | Evidencia |
|---|---|---|---|---|
| Entrada directa/global | código materializado con guiones | `barcode_code` | Sí | E2E POS y Préstamos |
| Resolución | exacta y respaldo teclado | exacta primero | Sí | contrato H-126 8/8 |
| Identidad física | producto + talla | `products.id` + `sizeCode` | Sí | producto byte a byte estable |
| Consumidores | POS, Préstamos, Cambios | los mismos | Sí | E2E H-126 37/37 |
| Persistencia/cola/remoto | no aplica; lectura pura | no aplica; lectura pura | Sí | sin mutaciones ni red |

## Solución

- `balam/barcodes.jsx` separa la coincidencia literal en `resolveExact()` y
  aplica el respaldo de teclado sólo después de no encontrar el texto original.
- POS y la búsqueda de ventas para Cambios recibieron selectores
  `data-testid` inertes para recorrer el comportamiento sin depender de copy,
  posición o estructura visual.
- Se añadieron regresiones de contrato y E2E para POS, Préstamos y Cambios.

## Pruebas

- Rojo previo: `node test-h126-scanner-keyboard-layout.mjs` — 5/8; tres garantías
  nuevas fallaron con `BARCODE_NOT_FOUND`.
- Verde: `node test-h126-scanner-keyboard-layout.mjs` — 8/8.
- BALAM QA: `node test-h126-scanner-keyboard-layout-e2e.mjs` — 37/37, sin
  errores de página; entrada directa, ráfaga global y tres consumidores; ocho
  anchos entre 320 y 1440 px, sin overflow.
- Bundle: `node test-h126-scanner-keyboard-layout-e2e.mjs --bundle` — 37/37.
- `node test-module-contracts.mjs` — 42/42.
- `node test-exchange-screen.mjs` — 45/45.
- `node test-loans-screen.mjs` — 115/117 en dos ejecuciones; las dos aserciones
  históricas de ráfaga global dependen de que `setTimeout(5)` no exceda 50 ms.
  El recorrido equivalente determinista de H-126 aprobó dentro del bundle.
- `node test-cambio-e2e.mjs` — 37/37.
- `node test-smoke.mjs bundle` — 17/17.
- `node test-ui-navigation.mjs` — 15/15.
- `node test-build-reproducibility.mjs` — 8/8.
- `node build-offline.mjs` — correcto; `index.html` y
  `POS Balam (offline).html` idénticos, 9,015,842 bytes, SHA-256
  `b9d6cef12b9308ca8091debb6768a221adc0f505e92a060a82f2f364832bbdc9`.
- Evidencia visual sintética en `.evidence-h126/` para POS, Préstamos y Cambios.

## Riesgo residual y pendientes

No se contó con el lector físico ni se verificaron Firefox/WebKit. El arnés
histórico de Préstamos conserva dos aserciones sensibles a la planificación del
temporizador; no se modificó porque queda fuera de la corrección solicitada y la
regresión H-126 cubre el mismo flujo sin esa fuente de indeterminismo.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-126--el-lector-hid-puede-sustituir-guiones-por-apóstrofes-según-el-teclado`
- `docs/fixes/pantalla-prestamos.md` (H-48, lector HID en Préstamos).
- `docs/fixes/modelo-referencias-fisicas-v2.md` (identidad y barcode V2).
- `docs/architect/playbooks/client.md`.
