# Diagonal configurada desde la entrada del lector HID

**Riesgo:** H-131
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 28/08/2026
**Commit funcional:** `ddf63af`

## Problema y reproducción

Las categorías usan legítimamente el símbolo `/`; por ejemplo, los catorce SKU
V1 reportados contienen `R/P`. Una etiqueta materializada por talla imprime
`5-PA1-R/P-NA-CAR-34`, pero el lector conectado a Windows entregaba la posición
física `Slash` como `key === "-"`. Al mismo tiempo, por el defecto ya atendido
en H-130, la posición física `Minus` podía llegar como apóstrofe.

La regresión reprodujo el flujo completo de teclas. Antes de corregir, una
lectura de `5-PA1-R/P-NA-CAR-34` llegaba como `5'PA1'R-P'NA'CAR'34`; H-130
recuperaba los guiones, pero el resultado quedaba
`5-PA1-R-P-NA-CAR-34`. Esa identidad no existe porque sustituye la diagonal
configurada por otro separador. El rojo terminó 4/20: fallaron la entrada
directa y las catorce resoluciones exactas.

Se revisaron los catorce SKU base suministrados:

| SKU base | Ejemplo materializado talla 34 |
|---|---|
| `5-PA1---R/P-NA-CAR-T` | `5-PA1-R/P-NA-CAR-34` |
| `5-PGO8---R/P-NA-GRSO-T` | `5-PGO8-R/P-NA-GRSO-34` |
| `5-PB2---R/P-NA-BG-T` | `5-PB2-R/P-NA-BG-34` |
| `5-PAB9---R/P-NA-ABT-T` | `5-PAB9-R/P-NA-ABT-34` |
| `5-PAM13---R/P-NA-AMAR-T` | `5-PAM13-R/P-NA-AMAR-34` |
| `5-PN14---R/P-NA-NEG-T` | `5-PN14-R/P-NA-NEG-34` |
| `5-PKC3---R/P-NA-CCAP-T` | `5-PKC3-R/P-NA-CCAP-34` |
| `5-PCO4---R/P-NA-COSC-T` | `5-PCO4-R/P-NA-COSC-34` |
| `1-PPC5---R/P-NA-PLTC-T` | `1-PPC5-R/P-NA-PLTC-34` |
| `5-PVC10---R/P-NA-VCLA-T` | `5-PVC10-R/P-NA-VCLA-34` |
| `5-PVBC11---R/P-NA-VBOC-T` | `5-PVBC11-R/P-NA-VBOC-34` |
| `5-PVB012---R/P-NA-VBOO-T` | `5-PVB012-R/P-NA-VBOO-34` |
| `5-PGC7---R/P-NA-GRSC-T` | `5-PGC7-R/P-NA-GRSC-34` |
| `5-PPO6---R/P-NA-PLTO-T` | `5-PPO6-R/P-NA-PLTO-34` |

## Causa raíz

Un lector HID envía posiciones físicas de teclado. El lector y la distribución
activa del sistema no coinciden: el símbolo que el código de barras pretende
como `/` usa la posición física `Slash`, pero el navegador reporta `key: "-"`.
H-130 ya interpretaba la posición `Minus` cuando llegaba como apóstrofe, pero no
tenía el contrato simétrico para `Slash`. Por eso el dato persistido era correcto
y el error se introducía exclusivamente durante la captura del lector.

La evidencia equivalente es determinista: `{ key: "-", code: "Slash" }`
producía `-`, no era consumido por el input controlado y hacía fallar la
coincidencia exacta de los catorce ejemplos.

## Diseño

`BARCODES.scannerChar()` sigue siendo la única frontera de adaptación HID:

1. `{ key: "'", code: "Minus" }` produce `-` como en H-130;
2. `{ key: "-", code: "Slash" }` produce `/`;
3. `/` ya correcto permanece `/` y `-` desde `Minus` permanece `-`;
4. `Quote` conserva un apóstrofe literal;
5. Ctrl, Alt y Meta no se reinterpretan;
6. la compatibilidad sin `event.code` usa los códigos físicos heredados 189 y
   191;
7. no se reescriben SKU, códigos de categoría, `barcode_code`, `products.id`,
   productos, existencias, documentos, cola offline ni Supabase.

POS, Préstamos y Cambios ya consumen esta autoridad compartida tanto en el campo
directo como en la captura global, por lo que no se duplicó lógica en pantallas.

## Solución

- `balam/barcodes.jsx` reconoce la posición física `Slash` y entrega `/` antes
  de pintar o acumular el carácter.
- `test-h131-scanner-slash-layout.mjs` materializa y resuelve los catorce códigos
  reportados con la combinación real de `Minus` y `Slash` mal interpretada.
- El E2E existente del lector verifica también la diagonal visible en POS,
  Préstamos y Cambios, en fuente y bundle.
- Se regeneraron `index.html`, `POS Balam (offline).html` y `sw.js` desde
  `balam/`; no se editaron como fuente.

## Pruebas

- Rojo H-131: 4/20; dieciséis fallos deterministas.
- Verde H-131: 23/23, incluidos los catorce SKU y la inmutabilidad de datos.
- H-130: 7/7; H-126: 8/8.
- BALAM QA lector fuente: 45/45; bundle: 45/45. Cubre POS, Préstamos y
  Cambios, 320–1440 px y cero errores de página.
- Contratos de módulos: 42/42; POS V1/V2: 9/9 + 19/19.
- Préstamos: 115/117 por las dos aserciones históricas e intermitentes de
  cadencia global; la misma captura de Préstamos pasó en el E2E determinista.
- Cambio: 45/45 + 37/37; responsive: 492/492; arranque: 5/5; smoke
  bundle: 17/17; navegación: 15/15; reproducibilidad: 8/8.
- Diagnóstico físico sin regresión: H-127 9/9 + 11/11; H-128 11/11 + 9/9.
- `node build-offline.mjs`: correcto; los dos HTML locales son idénticos. El
  blob Git de `index.html` tiene 9,020,787 bytes y SHA-256
  `935a9d4c3b8bd5c51b24efc3ac4928f41e9a5cb97c1419ea82307396ed1cacf4`.

## Despliegue

`ddf63af` avanzó `origin/main` por fast-forward. GitHub Pages run
[`33239254916`](https://github.com/David14081982/POS_Balam/actions/runs/33239254916)
terminó en `success`. El `index.html` público coincide byte a byte con el blob
Git: 9,020,787 bytes y SHA-256
`935a9d4c3b8bd5c51b24efc3ac4928f41e9a5cb97c1419ea82307396ed1cacf4`.
Chrome público confirmó `Slash`→`/`, `Minus`→`-`, `Quote` literal y `/` literal,
sin errores de página.

## Riesgo residual y pendientes

No hubo lector físico disponible ni certificación Firefox/WebKit. El contrato
depende de `KeyboardEvent.code`, que los navegadores modernos exponen; la ruta
heredada cubre 189/191 cuando `code` falta. La solución sólo adapta entradas
dentro de BALAM y no cambia lo que el lector escribe en otras aplicaciones.

La advertencia roja mostrada para PVC10 no pertenece a H-131. H-127/H-128 ya
demostraron que `5-PVC10-R/P-NA-VCLA-32` y `-36` tienen 277 módulos y X de
0.199288 mm en 60×40, por debajo del mínimo contractual de 0.250 mm. Recuperar
esa densidad exige una decisión operativa sobre tamaño, texto o simbología y no
se puede resolver ocultando la alerta ni modificando identidades sin autoridad.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-131--la-diagonal-configurada-llega-como-guion-desde-el-lector-hid`.
- `docs/fixes/lector-guiones-apostrofes.md` (H-126).
- `docs/fixes/normalizacion-visible-lector-hid-h130.md` (H-130).
- `docs/fixes/autoridad-fisica-code128-h127.md` (H-127).
- `docs/fixes/recuperacion-layout-v1-denso-h128.md` (H-128).
- `docs/02-architecture.md` (autoridad HID e identidad V1/V2).
- `docs/architect/playbooks/client.md`.
