# Certificación preproducción transversal V2

**Riesgo:** H-110
**Estado:** RESUELTO
**Fecha:** 16/08/2026
**Commit:** `4831791`

## Problema y reproducción

POS BALAM tenía pruebas focalizadas de referencias V2, POS, devoluciones,
cambios, préstamos, etiquetas y Excel, pero no un contrato que recorriera esas
funciones en una sola sesión ni demostrara al final la eliminación exacta de
sus datos sintéticos. La línea roja confirmó que
`test-h110-preproduction-v2-certification.mjs` no existía.

## Causa raíz

La cobertura estaba distribuida entre arneses independientes. Cada uno probaba
su módulo con una semilla propia, por lo que ninguna prueba certificaba la
continuidad de `products.id`, `referenceFamilyId` y `barcodeCode` a través del
flujo transversal ni comparaba el estado local completo antes y después.

## Diseño

El arnés ejecuta el bundle distribuido en un único contexto Chromium efímero.
Registra el fixture con el prefijo `CERT-PREPROD-V2-H110`, bloquea toda conexión
a Supabase antes de red y conserva una instantánea de todas las colecciones de
`DATA` y de `localStorage`. PDF y XLSX se inspeccionan en memoria. La limpieza
restaura la instantánea y comprueba colecciones, almacenamiento, catálogo e
IndexedDB; un camino de emergencia repite la restauración si falla cualquier
etapa.

Invariantes:

- sólo se crean dos referencias V2, un vendedor y un cliente sintéticos;
- no se vacía ni reemplaza el inventario preexistente;
- ninguna petición alcanza Supabase;
- el flujo administrativo de reinicialización no se invoca;
- ninguna descarga se guarda dentro del checkout;
- venta, devolución, cambio y préstamo conservan identidad física exacta;
- el estado local final es idéntico al inicial.

## Solución

Se añadió `test-h110-preproduction-v2-certification.mjs`. El recorrido usa las
pantallas existentes para alta familiar, Inventario, Detalle, POS, venta,
devolución, cambio, préstamo, etiquetas y exportación Excel. No se modificó
código productivo ni se añadió funcionalidad de negocio.

## Pruebas

- Línea roja: ausencia del arnés, 0/1.
- `node test-h110-preproduction-v2-certification.mjs`: 20/20.
- Dos referencias creadas con stock sintético 5+5.
- PDF validado en memoria: encabezado y cierre estructural válidos.
- XLSX validado en memoria: hojas `Inventario`, `Catálogos`, `_BALAM`; ambos
  `products.id` y el nombre de familia presentes.
- Limpieza: todas las colecciones `DATA` y `localStorage` idénticas a la línea
  base; cero residuo del fixture en catálogo e IndexedDB.
- Red: 13 intentos Supabase interceptados en la corrida final; cero respuestas
  remotas. El conteo depende del ciclo de sincronización, no el bloqueo.
- Regresiones: H-102 16/16; Cambio 37/37; Devoluciones 17/17;
  Préstamos 117/117; Excel H-86 42/42; contrato de entrada de arneses 8/8.
- `node --check test-h110-preproduction-v2-certification.mjs`: sin errores.
- `node build-offline.mjs`: completó, pero el árbol local no tenía el bundle
  correspondiente a las fuentes actuales. Como H-110 no modifica producto, los
  tres artefactos generados se restauraron a sus bytes iniciales; `git diff`
  confirma cero cambio en ellos.

## Riesgo residual y pendientes

El arnés certifica el bundle local con Chromium/Chrome. No sustituye una prueba
manual sobre periféricos físicos de caja ni debe apuntarse a una base remota.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-110--no-existía-una-certificación-preproducción-v2-transversal-y-autolimpiable`
- `docs/fixes/modelo-referencias-fisicas-v2.md`
- `docs/fixes/saldo-por-renglon.md`
- `docs/fixes/pantalla-prestamos.md`
- `docs/fixes/jerarquia-visual-etiqueta-60x40.md`
- `docs/fixes/atributos-opcionales-canonicos.md`
