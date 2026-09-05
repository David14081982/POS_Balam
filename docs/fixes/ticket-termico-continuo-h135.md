# Ticket térmico de una página y altura variable

**Riesgo:** H-135
**Estado:** RESUELTO LOCALMENTE — PUBLICACIÓN PENDIENTE
**Fecha:** 05/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El usuario imprime el PDF tal como lo genera BALAM. Su archivo `Ticket POS
Balam Guayaberas.pdf` contiene dos páginas carta de 215.9 × 279.4 mm; el
historial de pagos y el pie quedaron en la segunda. Una página adicional puede
provocar otro corte físico.

Se trabajó sobre d122f0d, último `origin/main`, en un worktree aislado. La
carpeta original contiene trabajo previo ajeno y no se modificó. El caso previo
`node test-ticket-print.mjs` pasó 23/23, pero produjo dos páginas tanto para
venta de 1,820 px como para abonos de 1,607, 1,662 y 1,682 px.

La reproducción nueva `node test-h135-continuous-ticket.mjs` falló **33/61**
(28 verdes): tres prendas producían dos páginas carta y 24 prendas cuatro.
Los PDF rojos están en `C:/tmp/balam-h135-red/` y se regeneran ejecutando el
arnés nuevo sobre el bundle anterior. Son operaciones sintéticas aisladas.

## Causa raíz

`POS Balam.html` declaraba `@page { size: 80mm auto }`: esa combinación no
establece una dimensión CSS válida. El navegador cae en carta. El portal y
flujo normal introducidos en H-41 evitaron perder contenido, pero validaban
precisamente la continuación en otras hojas. No había medición de altura para
generar un PDF continuo.

## Diseño

El contrato solicitado es una página de 80 mm cuya altura cubra todo el
documento sin reducir letra ni omitir historial, importes o pie. No existía
una autoridad de geometría para estos comprobantes: `UI.useReceiptAutoPrint`
sólo controla cuándo imprimir. Se añade un hook privado compartido en la
autoridad existente `pos-ticket.jsx`, sin otra plantilla ni dependencia.

Se mide la caja renderizada, se convierte px→mm, se redondea hacia arriba y se
añade 1 mm. Una página CSS nombrada se aplica al comprobante y al body durante
impresión: asignarla sólo al portal producía una hoja inicial vacía, detectada
y corregida durante el verde. `ResizeObserver`, fuentes y `beforeprint`
actualizan la medida. Cada desmontaje elimina observador, listener y regla.

### Alcance y ciclo de vida

| Recorrido | Evidencia y garantía |
|---|---|
| Venta V2 y venta histórica V1 | Mismo texto; el ticket no consulta productos actuales |
| Venta larga → corta → reimpresión | Altura aumenta y disminuye; no conserva tamaño viejo |
| Abonos y Cambios | Conservan vocabulario, pagos e historial del componente actual |
| Devolución directa | Documento propio, mismo cálculo físico de página |
| Manual y automática | H-85/Cambios conservan cero o una impresión según configuración |
| Cerrar | Se retiran formato y recursos temporales |
| Pantallas de 320–1440 px | Mismo ancho y altura física en ocho viewports |
| Datos, roles, nube, reversas | No cambian; impresión es una proyección sin escritura |
| Reportes, etiquetas y préstamos | Ventanas propias; no reciben el estilo temporal |

No hay nueva regla de negocio, tabla, RPC, migración, identidad ni autoridad
financiera. La cola offline y los snapshots históricos quedan fuera del diff.

## Solución

- `balam/pos-ticket.jsx`: `useReceiptPageSize()` usado por venta y devolución.
- `POS Balam.html`: retira el tamaño inválido; conserva flujo y protección H-41.
- `test-ticket-print.mjs`: conserva 23 controles, verifica página única y altura
  real del PDF en lugar de multiplicar hojas por la altura carta.
- `test-h135-continuous-ticket.mjs`: regresión permanente con PDF real,
  reimpresión, compatibilidad, geometría, limpieza y ausencia de efectos de datos.
- Build regenera `_source.html`, ambos HTML distribuidos y `sw.js`.

## Pruebas

| Comando / verificación | Resultado |
|---|---|
| `node test-h135-continuous-ticket.mjs` | Rojo 28/61 → verde 61/61 |
| `node test-ticket-print.mjs` | 23/23 |
| `node test-h85-receipts.mjs` | 20/20; incluye reimpresión por botón de Historial |
| `node test-h73-comprobante-del-cambio.mjs` | 29/29 |
| `node test-layaway-screen.mjs` | 55/55 |
| `node test-cambio-e2e.mjs` | 37/37 |
| `node test-smoke.mjs bundle` | 17/17 |
| `node test-ui-navigation.mjs` | 15/15 |
| `node test-build-reproducibility.mjs` | 8/8 |
| `node build-offline.mjs`, repetido | Bytes idénticos; 72 assets, 9.03 MB |
| Lectura independiente con PyMuPDF | 16/16 PDF: una página, texto idéntico al rojo salvo whitespace y cero palabras fuera de página |
| BALAM QA visual | Venta y devolución renderizadas desde el PDF; sin recortes ni hojas vacías |

Tres prendas: **80.09 × 359.83 mm**; 24 prendas: **80.09 × 1006.09 mm**;
una prenda posterior: **80.09 × 299.13 mm**. La pequeña diferencia respecto a
80 mm proviene de discretización del PDF. Abono: 505.88 mm; cambio: 511.22 mm;
devolución de doce renglones: 450.85 mm. Todos tienen una sola página.

Evidencia local regenerable: `C:/tmp/balam-h135-green/` contiene PDFs,
`metrics.json`, `pdf-content-qa.json` e imágenes. La suite intercepta tráfico
remoto y el estado de ventas/pagos/productos/movimientos/devoluciones no cambia.

`node test-module-contracts.mjs` obtiene **41/42**, también sobre una copia
íntegra de sus fuentes en d122f0d. El contrato fallido busca literalmente
`resizeImageFile } = window.UI`, pero H-134 añadió otros imports después.
La llamada vigente sigue presente. Se clasifica **ARNÉS OBSOLETO, P3**, ajeno
a impresión; no se altera para dar verde artificial. Registro de baseline:
`C:/tmp/balam-h135-modules-baseline.log`.

## Despliegue

Pendiente de commit y verificación publicada. No requiere migraciones.
SHA-256 del bundle validado y reproducible:
`80e839e882ede88aff00f08ba2885c369b77e875e91cb45199bca8a6a8e116ac`.

## Riesgo residual y pendientes

- **Hardware pendiente:** confirmar en la impresora que el controlador acepta
  la longitud del PDF y corta al final. Las pruebas demuestran el PDF continuo,
  no el corte físico. No se certificaron Firefox/WebKit ni otra anchura de rollo.
- Se conserva el separador `Â·` preexistente del ornamento (hallazgo visual P3).
- El formato fijo de un controlador/visor que fuerce otra hoja puede requerir
  configuración de papel; no se alteró configuración del equipo del usuario.
- Aprendizaje: H-41 cubría contenido disponible, pero faltaba exigir geometría
  física y una página. Ambos requisitos quedan en la regresión H-135.

## Referencias

- `docs/03-known-risks.md` § H-135 y H-41.
- `docs/02-architecture.md` § Evidencia visual del comprobante histórico.
- `docs/fixes/ticket-impreso-paginado.md` y `sistema-de-comprobantes-historicos.md`.
