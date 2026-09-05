# Retirar el aviso de SKU compartidos en Configuración

**Riesgo:** H-140.
**Estado:** RESUELTO Y PUBLICADO.
**Fecha:** 05/09/2026.
**Commit:** `161ae0b15902587584a2c076c3d38dbabab35103`.

## Problema y reproducción

El usuario solicita eliminar el bloque «Advertencia: … referencias físicas
comparten … SKU visible(s)», incluidas diferencias, campos excluidos y claves
sugeridas. Prohíbe cambiar configuración o regenerar SKU. La captura aportada
y `SkuBuilder` confirman el bloque. Es una retirada de presentación solicitada,
no una corrección de los datos ni una desactivación de validaciones de identidad.

## Causa raíz

`balam/settings.jsx` agrupaba productos por SKU exclusivamente para renderizar
este aviso. La información técnica no resulta útil para las vendedoras según
la decisión explícita del usuario.

## Diseño y solución

Se retiran el bloque y su agrupación privada sin otros consumidores. Los
catálogos, interruptores, SKU persistidos, productos, códigos de barras y guardas
de DATA conservan su implementación. No se ejecuta regeneración ni SQL.
Se regeneran los artefactos desde fuentes con `node build-offline.mjs`.

Se adapta la comprobación 18 de `test-h94-config-target.mjs`: su exigencia de
mostrar este aviso quedó reemplazada por la petición. Conserva las comprobaciones
de longitud y campos ocultos; las otras 29 pruebas mantienen sus contratos.

## Pruebas

- H-94 configuración: **30/30**.
- QA en Chrome aislado, dos productos con el mismo SKU, 360 y 1280 px:
  **6/6**. Constructor presente, aviso ausente en ambos anchos, configuración
  y productos idénticos antes/después de abrir la pantalla, cero excepciones.
  Capturas inspeccionadas. Se corrigió el identificador de navegación del
  arnés temporal (`producto`, no `catalogos`); no fue un fallo de BALAM.
- Navegación: **15/15**. Smoke bundle: **17/17**. Build reproducible: **8/8**.
- Sin suite nueva permanente para esta retirada visual. QA temporal:
  `node C:/tmp/balam-h140-qa.mjs`; red comercial bloqueada.

## Riesgo residual y pendientes

Pages `built`, HTTP 200 y bytes idénticos al blob Git del commit;
SHA-256 `6716ed95b6491ad9bec62907646224bd7c66f81e3ef5fd15b6b47b2b78e7d757`.
QA contra sitio publicado: **6/6**, con datos aislados y red comercial bloqueada.
Sin pendientes conocidos para esta retirada. Los SKU compartidos permanecen tal como
estaban; esta historia retira únicamente su aviso en Configuración. Ningún
dato real ni ajuste de negocio se modifica.

## Referencias

- `docs/03-known-risks.md`, H-140.
- `balam/settings.jsx`, `SkuBuilder`.
- `test-h94-config-target.mjs`.
