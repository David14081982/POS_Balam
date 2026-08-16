# Métodos de pago legibles en el checkout móvil

**Riesgo:** H-108
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 16/08/2026
**Commit:** `ddca21d`

## Problema y reproducción

Con los seis métodos configurados, Cobrar venta forzaba hasta cinco columnas.
Entre 320 y 430 px «Transferencia» no cabía; a 320 px tampoco «Apartado».
La línea roja obtuvo **64/70**: seis fallos de texto truncado.

## Causa raíz

`CheckoutModal` calculaba cinco columnas iguales y el nombre llevaba `truncate`.
La celda de «Transferencia» medía entre 43 y 65 px frente a 71 px de contenido.

## Diseño

Todos los métodos canónicos deben permanecer visibles, legibles y táctiles sin
cambiar sus códigos, orden, selección ni procesamiento del cobro.

## Solución

La cuadrícula usa tres columnas en el modal y el nombre permite presentación
normal. Sólo cambiaron clases de composición en `balam/pos-ticket.jsx`.

## Pruebas

- `node test-h108-mobile-payment-methods.mjs`: rojo **64/70**; verde **70/70**
  en 320/360/375/390/430 px.
- Flujo de cobro: guardián verde, **2 validaciones y 11 interacciones**.
- Carrito H-88A **30/30**; responsive H-87 **492/492**; navegación **15/15**;
  smoke **15/15**; build reproducible **8/8**.
- Coherencia de ventas **20/20**; H-75 **14/14**; H-90 **17/17 + 24/24 +
  21/21**.

## Riesgo residual y pendientes

Ninguno conocido dentro del alcance UI. No se modificaron métodos, importes,
ventas, stock, persistencia, Supabase ni reglas de negocio.

## Publicación

Integrado en `main` mediante `62d6ed8`. Pages run `31950744444` terminó en
`success`. El `index.html` servido mide 8,989,774 bytes, SHA-256
`c4675f0a0c456c0942e784b1cd71bf4a2f1ece1410f77a384abd66b1b59a0f8e`,
idéntico al blob Git `4781bdfa5e29eb4a251d8c470045cee23a27241b` tras normalizar
CRLF→LF. H-108 volvió a pasar **70/70** sobre esos bytes.

## Referencias

- Riesgo H-108 en `docs/03-known-risks.md`.
- `docs/architect/playbooks/client.md`.
- `docs/fixes/carrito-pos-siempre-accesible.md`.
