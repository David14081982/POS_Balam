# Guion visible desde la entrada del lector HID

**Riesgo:** H-130
**Estado:** RESUELTO LOCALMENTE — PENDIENTE DE PUBLICACIÓN
**Fecha:** 28/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

H-126 permitió resolver un código V1 aun cuando una distribución de teclado
entregara apóstrofes por los guiones. Sin embargo, la adaptación ocurría dentro
de `BARCODES.resolve()` y sólo después de Enter. Los inputs controlados de POS,
Préstamos y Cambios seguían mostrando `'`, y sus capturas globales acumulaban
el valor crudo de `KeyboardEvent.key`.

La regresión H-130 simuló la evidencia real del navegador:
`{ key: "'", code: "Minus" }`. Antes de corregir, no existían
`BARCODES.scannerChar()` ni `consumeScannerInputKey()` y el rojo terminó 1/7:
seis garantías de entrada fallaron.

## Causa raíz

La solución H-126 cerró la resolución semántica pero no la frontera de entrada.
Cada pantalla guardaba o acumulaba la tecla antes de llamar a la autoridad de
códigos. Por eso el producto podía encontrarse correctamente al final y, aun
así, el operador observaba el carácter equivocado durante la lectura.

## Diseño

La autoridad compartida conserva dos representaciones durante una ráfaga
global:

- carácter canónico: `Minus` mal interpretado como `'` se acumula como `-`;
- texto crudo: se conserva sólo para retirar exactamente lo que el HID alcanzó
  a escribir en otro input cuando Enter confirma un código conocido.

Contratos e invariantes:

1. el campo directo consume la sustitución antes de que el navegador la pinte;
2. `code === "Quote"` conserva un apóstrofe real;
3. un guion ya correcto permanece intacto;
4. una ráfaga global desconocida no modifica el campo humano;
5. el respaldo post-Enter de H-126 permanece para navegadores/eventos sin
   `KeyboardEvent.code`;
6. no se escriben SKU, `barcode_code`, `products.id`, etiquetas, stock,
   documentos, históricos, cola offline ni Supabase.

El contrato depende de la posición física, no del contenido concreto del
código. Por eso cubre etiquetas V1 existentes y futuras con guiones y no exige
regenerarlas. V2 sigue resolviendo su `barcode_code` sin cambios.

## Solución

- `balam/barcodes.jsx` publica `scannerChar()`,
  `consumeScannerInputKey()` y `removeScannerText()` como única autoridad HID.
- `balam/pos.jsx`, `balam/loans.jsx` y `balam/returns.jsx` consumen esa autoridad
  en entrada directa y captura global.
- Las capturas globales guardan por separado el código canónico y la ráfaga
  cruda. POS y Cambios reciben la misma limpieza segura que ya existía de forma
  local en Préstamos.
- La regresión E2E de H-126 ahora fija también el carácter visible y la limpieza
  de otros campos en los tres consumidores.

## Pruebas

- Rojo: `node test-h130-scanner-visible-hyphen.mjs` — 1/7; seis fallos.
- Verde: `node test-h130-scanner-visible-hyphen.mjs` — 7/7.
- Contrato H-126: `node test-h126-scanner-keyboard-layout.mjs` — 8/8.
- BALAM QA fuente: `node test-h126-scanner-keyboard-layout-e2e.mjs` — 42/42;
  POS, Préstamos y Cambios, entrada directa/global, limpieza de campo ajeno,
  320–1440 px y cero errores de página.
- BALAM QA bundle: `node test-h126-scanner-keyboard-layout-e2e.mjs --bundle` —
  42/42.
- Préstamos: `node test-loans-screen.mjs` — 117/117.
- Cambio: `node test-exchange-screen.mjs` — 45/45;
  `node test-cambio-e2e.mjs` — 37/37.
- POS V1/V2: contrato 9/9 y E2E 19/19.
- Contratos de módulos: 42/42; responsive: 492/492; arranque: 5/5;
  smoke bundle: 17/17; navegación: 15/15; reproducibilidad: 8/8.
- `node build-offline.mjs` — correcto. `index.html` y
  `POS Balam (offline).html` son idénticos: 9,020,870 bytes, SHA-256
  `bece1824d2fdf5412d3afaef32a84192f0f8bce83ee87e082866243fb7ba2e27`.

## Riesgo residual y pendientes

No hubo lector físico disponible en este entorno ni certificación en
Firefox/WebKit. Los navegadores modernos exponen `KeyboardEvent.code`; si un
lector transmite un apóstrofe como tecla física `Quote` en vez de transmitir
`Minus` bajo otra distribución, BALAM no puede inferir la intención antes de
Enter sin arriesgar identidades literales. En ese caso H-126 todavía resuelve y
limpia la lectura al confirmarla, pero la corrección física permanente requiere
alinear la distribución del lector y del sistema.

La normalización sólo gobierna entradas dentro de BALAM. No cambia lo que el
lector escribe en otras aplicaciones del sistema operativo.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-130--el-lector-resuelve-apóstrofes-pero-los-sigue-escribiendo-en-pantalla`.
- `docs/fixes/lector-guiones-apostrofes.md` (H-126).
- `docs/02-architecture.md` (identidad V2 y autoridad HID).
- `docs/architect/playbooks/client.md`.
