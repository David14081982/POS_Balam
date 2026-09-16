# Edición de productos: resultado confirmado y error contextual

**Riesgo:** H-172
**Estado:** PARCIALMENTE RESUELTO — integrado, publicado y verificado; A/B/C real NO CERTIFICADO.
**Fecha:** 16/09/2026
**Commit:** `30bd52a8257716cf13e6b69cb0e13e77f5e8105f`

## Problema y reproducción

Inventario → editar → guardar pierde código/contexto al capturar errores.
La palabra UUID, JSON o `reference_` termina clasificada como archivo aunque la
operación no importe nada. Una respuesta de guardado vacía o de otro ID tampoco
tiene una comprobación explícita antes del cierre, y dos clics pueden enviar
dos solicitudes mientras se espera la confirmación.

Base de publicación: `4afea8e269d55c69505dbf1778e2f49a7031200b`.
`node test-h172-product-edit.mjs --contract-only`: **0/4**, antes del cambio.
El instrumento ejecuta el manejador real y el clasificador con errores y
respuestas controlados; no escribe en Supabase.

La investigación comenzó en una copia antigua sin Git utilizable, donde se
llamó H168 y se reprodujeron además fallos de confirmación local. Al preparar
la publicación se encontró la arquitectura online H164 y cambios posteriores.
H168 ya identifica tickets en main. Esta integración H172 conserva esas mejoras;
no publica los helpers de cola offline de la copia antigua ni sobrescribe su
historia. DATA y STORE vigentes ya esperan la autoridad remota.

## Causa raíz

Los `catch` de `InventoryScreen.saveProduct` entregan sólo `error.message`.
El catálogo general infiere archivo por palabras, sin operación. El editor
consume el resultado de DATA sin comprobar que represente exactamente el
conjunto solicitado, y no tiene un candado de envío hasta el fin de la promesa.

## Diseño

Exclusivamente `edit` y `family-edit`: conservar error estructurado, validar
IDs/conteo del resultado confirmado y mantener el borrador ante fallo.
Mientras se espera, impedir doble envío, cierre y cambios que quedarían fuera
del borrador enviado. La autoridad comercial continúa siendo Supabase según
ADR-015; no se habilita operación offline ni se modifica su transporte.

## Solución

- `balam/inventory.jsx`: estado de guardado exclusivo de edición, comprobación
  del resultado por ID, rechazo explícito del producto desaparecido y contexto
  `product_edit` en errores; el editor sólo cierra después de confirmación.
- `balam/shared.jsx`: códigos de edición con explicaciones propias; errores
  desconocidos no inventan causas. Conexión y confirmación incierta conservan
  su precedencia y mensajes online vigentes.
- `test-h172-product-edit.mjs`: regresión del manejador y recorrido de navegador
  con DATA real, transporte controlado, recarga y XLSX serializado/releído.
- Workflow existente: añade esta prueba antes de publicar el mismo artefacto.

No cambia DATA, STORE, CONFIG, AUTH, barcodes, SKU, firma, cantidades, SQL,
catálogos, creación de productos ni el formato/exportador Excel.

## Pruebas

- Base: **0/4**.
- Primera pasada integrada: **4/7**; el arnés no implementaba
  `assertBusinessReady` en su gateway controlado. El producto bloqueó
  correctamente el guardado sin esa comprobación. Se corrigió el arnés.
- UI vigente `test-h164-online-ui.mjs`: **6/6**.
- PWA vigente `test-h164-online-pwa.mjs`: **2/2**.
- `node test-h172-product-edit.mjs`: **7/7**, salida 0; errores, conjuntos
  devueltos, doble clic, confirmación, edición V1/V2, recarga y XLSX.
- Evidencia: `docs/fixes/evidence/h172-{baseline,verification,ui,pwa}.json`.
  El workflow aprobó la regresión y el despliegue del commit.
  No se repitieron pruebas locales tras cerrar la verificación.
- Build: 74 recursos, 9.36 MB; ambos HTML idénticos, SHA-256
  `7020d3e565b1721febc8746a73c69c7c32f44677dda4b3cd25b02e34dd87e531`.
- SW SHA-256:
  `5b5bc9f71ac1c6c69cfc64a78d9daeff37c97466ab414eae0097af7acde9f07e`.

## Publicación

Commit enviado a `main`; [workflow 35132940589](https://github.com/David14081982/POS_Balam/actions/runs/35132940589) aprobado.
Publicado en https://david14081982.github.io/POS_Balam/.
Verificación HTTP 200 y coincidencia byte a byte de ambos HTML y `sw.js`
con el commit técnico. Evidencia: `docs/fixes/evidence/h172-publication.json`.
La certificación remota opcional no se ejecutó.

## Riesgo residual y pendientes

A/B/C real de esta corrección **NO CERTIFICADO**; las pruebas usan transporte
controlado, sin escrituras comerciales. No se afirma haber reproducido el dato
original del usuario ni todas las combinaciones históricas. Se conservan las
validaciones físicas y los rechazos válidos del servidor.
La publicación requiere adopción del nuevo cliente por cada instalación.
Las comprobaciones semánticas de error/resultado se añaden al workflow para
que un mensaje sin jerga no se confunda otra vez con una explicación correcta.

## Referencias

- `docs/03-known-risks.md`, H172.
- `docs/architect/decisions/ADR-015-autoridad-comercial-online.md`.
- `docs/fixes/autoridad-mensajes-humanos-h134.md`.
- `docs/fixes/persistencia-corte-caracteristicas-editar-v2.md`.
- `.github/workflows/h164-online-authority.yml`.
