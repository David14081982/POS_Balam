# Toast sin superposición sobre el checkout móvil

**Riesgo:** H-109
**Estado:** RESUELTO
**Fecha:** 16/08/2026
**Commit:** `ddca21d`

## Problema y reproducción

En el checkout de Apartado, el footer queda cerca del borde inferior. El toast
fijado abajo a la derecha cruzaba el CTA en 320/360/375/390 px y a 320 px cubría
su centro. La línea roja obtuvo **6/10**, con cuatro fallos de superposición.

## Causa raíz

`ToastHost` compartía el mismo borde inferior que las acciones primarias de los
modales móviles y no tenía un contrato responsive para evitarlas.

## Diseño

En móvil, los avisos temporales deben permanecer dentro del viewport sin ocupar
la zona inferior de acciones. Desde `sm`, se conserva la posición histórica.
No cambian el contenido, duración ni disparo de los avisos.

## Solución

`ToastHost` se ubica arriba con margen lateral hasta 639 px y conserva abajo a
la derecha desde `sm`. El toast limita su ancho al contenedor. Sólo cambiaron
clases de presentación en `balam/shared.jsx`.

## Pruebas

- `node test-h109-mobile-checkout-toast.mjs`: rojo **6/10**; verde **10/10**
  en 320/360/375/390/430 px.
- Flujo de cobro: guardián verde, **2 validaciones y 11 interacciones**.
- Carrito H-88A **30/30**; responsive H-87 **492/492**; navegación **15/15**;
  smoke **15/15**; build reproducible **8/8**.
- Coherencia de ventas **20/20**; H-75 **14/14**; H-90 **17/17 + 24/24 +
  21/21**.

## Riesgo residual y pendientes

Ninguno conocido dentro del alcance UI. En móvil el toast ocupa temporalmente
la franja superior; las pruebas confirman que queda dentro del viewport y no
cubre el CTA. No se modificó lógica ni persistencia.

## Referencias

- Riesgo H-109 en `docs/03-known-risks.md`.
- `docs/architect/playbooks/client.md`.
- `docs/fixes/ui-responsive-global.md`.
