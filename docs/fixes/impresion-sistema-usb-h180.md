# Impresión del sistema en tablet con impresora USB

**Riesgo:** H-180
**Estado:** RESUELTO EN CÓDIGO — confirmación en papel pendiente
**Fecha:** 30/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

END-80TEUX por USB, THERMER instalado. El dueño confirma que THERMER imprime
y aparece en los servicios de impresión de Android. BALAM sigue invocando
RawBT, incluso desinstalado. La auditoría reproduce la selección por agente
Android/Linux táctil y el paquete fijo. Se conserva el tamaño y diseño actuales.

## Causa raíz

La autoridad de transporte confunde dispositivo Android con disponibilidad de
RawBT/Bluetooth. `PrintManager.enqueue()` además descarta las solicitudes
automáticas en esa ruta. La instalación de otro servicio no afecta el intent
con paquete fijo. No está demostrada la causa del escalado físico de la foto.

## Diseño

Una salida mediante diálogo del sistema en todas las plataformas. Android y
el servicio instalado se encargan de descubrir y comunicarse con la impresora.
Sin paquetes fijos, WebUSB, descubrimiento simulado ni nuevos ajustes globales.
`print.auto` conserva su valor y solicita el diálogo al confirmar el cobro;
no promete impresión silenciosa. Dos copias conservan etiquetas, aislamiento,
orden y recursos hasta el cierre del diálogo. Las plantillas, tamaños,
imágenes, tipografía, históricos y datos comerciales permanecen intactos.

No hay SQL ni cambios de roles, CONFIG persistida, sincronización o permisos.
La cola es técnica y efímera; no reenvía ventas. V1/V2 conservan sus documentos.

## Solución

`PrintManager` usa el adaptador del navegador en PC y tablet. Se retira el
intent con paquete RawBT fijo y la exclusión de solicitudes automáticas Android.
Cada copia conserva su snapshot, iframe, hash del documento entregado y turno;
`afterprint` junto con el retorno de `print()` libera el trabajo. El regreso del
foco no equivale a terminar ni confirma papel. Se mantiene el cierre manual y
el reintento explícito ante fallo.

`shared.jsx` conserva el helper anterior como compatibilidad, devolviendo falso,
y muestra la ayuda del sistema. `settings.jsx` explica el diálogo automático y
el orden de las copias. No se modifican plantillas ni geometría de los tickets;
se regeneran HTML y service worker con `node build-offline.mjs`.

La regresión H-180 queda en el workflow de publicación. Las pruebas anteriores
de Android ahora verifican el documento en la frontera del sistema. Las pruebas
del generador PNG conservado siguen pasando, sin atribuirle entrega a impresora.

## Pruebas

Evidencia: `evidence/h180-system-print.json`.

- H-180 antes: 6/8; fallan Android y Linux táctil por elegir RawBT. Se omiten
  las verificaciones dependientes de esas rutas inválidas. Después: 18/18.
- H-153 ciclo: 80/80; errores: 18/18; carreras: 3/3. Documentos consecutivos,
  copias, largo-corto-largo, desmontaje del origen, fallo/reintento y cancelación.
- Diez PDF únicos entregados por la frontera de transporte, comprobados por
  PyMuPDF: 10/10. Todas las líneas DOM aparecen en el PDF, cajas dentro de la
  página y una sola página continua de 80 mm (redondeo medido 80.095 mm).
  Los hashes entregados coinciden entre perfiles cuando el documento es igual.
  Inspección visual del ticket corto: contenido, totales y pie completos.
- H-179 copias: 13/13; H-173 geometría: 28/28; H-168 web: 41/41;
  H-177 tinta PNG: 8/8; H-178 contenido: 12/12; UI: 6/6; PWA: 2/2.
- Build PASS. SHA-256 local de `index.html`:
  `b960b26ca1af6b208826f8ce425e07a80a5b56cdc7e6deace3f412adbc74721f`.

Los perfiles Android se ejecutan en Chromium de escritorio con agente y toque
simulados. Se intercepta el transporte y se inspecciona su documento completo;
no se ejecuta Android ni THERMER reales. Sin certificación distribuida A/B/C.

## Despliegue

Pendiente de commit, workflow y comprobación del HTML/SW públicos contra el commit.

## Riesgo residual y pendientes

HARDWARE NOT_TESTED. El propietario debe verificar salida física, escala y
copias en THERMER/END-80TEUX después de actualizar BALAM. Invocar el diálogo
no demuestra detección USB ni papel. Los ajustes físicos dependen del servicio.

## Referencias

- `docs/03-known-risks.md`, H-180; H-143, H-146, H-153, H-173 y H-179.
- `docs/02-architecture.md`, transporte de comprobantes.
- https://www.enduropos.com/product/impresora-termica-80mm/
- https://play.google.com/store/apps/details?id=mate.bluetoothprint
- https://developer.android.com/reference/android/printservice/package-summary
