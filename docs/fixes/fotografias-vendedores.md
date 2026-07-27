# Fotografías en la pantalla Vendedores

**Riesgo:** H-30
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Un usuario con `seller.avatar` válido mostraba su fotografía en Configuración →
Usuarios y en el selector del POS, pero la pantalla lateral Vendedores
presentaba siempre sus iniciales.

`node test-seller-avatars.mjs` aprobó 4/10 antes del cambio. Confirmó que DATA,
Configuración y el mapeo bidireccional de STORE conservaban el dato, pero
fallaron resumen, tarjeta, lista, detalle, representación compartida y respaldo
visual.

## Causa raíz

El dato no se perdía. `balam/sellers.jsx` construía directamente cuatro
representaciones de iniciales y ninguna consultaba `seller.avatar`. La ruptura
estaba exclusivamente en el render de la pantalla comercial, después de que el
modelo local y Supabase ya habían entregado correctamente la fotografía.

## Diseño

`SellerAvatar` es un componente local de `balam/sellers.jsx`:

- renderiza `<img>` con `seller.avatar` y texto alternativo con el nombre;
- conserva tamaños, forma y clases de cada contexto;
- usa iniciales y color como respaldo cuando no existe fotografía;
- no modifica DATA, STORE, Storage, Auth, sincronización ni datos históricos.

El componente se usa en el resumen de avatares, tarjetas, lista y detalle.

## Solución

- `balam/sellers.jsx`: añade `SellerAvatar` y reemplaza las cuatro
  representaciones que ignoraban la fotografía.
- `test-seller-avatars.mjs`: verifica el flujo de datos, todos los consumidores,
  la representación de imagen y el respaldo por iniciales.
- `index.html` y `POS Balam (offline).html`: regenerados desde la fuente.

## Pruebas

- Antes: `node test-seller-avatars.mjs`: 4/10.
- Después: `node test-seller-avatars.mjs`: 13/13.
- `node test-eligible-sellers.mjs`: 10/10.
- `node test-module-contracts.mjs`: 36/36.
- `node build-offline.mjs`: correcto, 67 recursos.
- `node test-build-reproducibility.mjs`: 8/8.
- `node test-ui-navigation.mjs`: 13/13.
- `node test-smoke.mjs bundle`: 17/17.

## Riesgo residual y pendientes

Una URL o data URL corrupta puede producir el indicador de imagen rota del
navegador; el respaldo por iniciales cubre ausencia del dato, no errores de red
posteriores a la carga. La validación y reducción del archivo al seleccionarlo
continúan bajo el contrato resuelto en H-26.

No se modificaron elegibilidad H-29, fotografías de productos, comisiones,
Auth, Edge Functions, Storage, esquema SQL ni reportes.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-30--fotografías-de-vendedores-ignoradas-por-la-pantalla-comercial`.
- Procesamiento de imágenes: `docs/fixes/procesamiento-imagenes-compartido.md`.
- Elegibilidad comercial: `docs/fixes/eligible-active-sellers.md`.
