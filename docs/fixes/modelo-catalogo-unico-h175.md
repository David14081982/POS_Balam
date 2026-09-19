# El modelo siempre sigue al catálogo Modelo

**Riesgo:** H-175
**Estado:** RESUELTO — cliente publicado y migración aplicada y verificada
**Fecha:** 19/09/2026
**Commit:** `cc431ba` (cliente), `a6b13b6` (migración y prueba ida y vuelta)

## Problema y reproducción

El dueño pide que las TIRA BORDADA digan «TB» y que ningún producto nuevo
repita el problema de H-174.

El origen es la columna Excel «No. Modelo», que se importa sin relación con el
catálogo Modelo (`attrs.producto`). La pantalla sí deriva el modelo del
catálogo. Por eso existen 35 referencias con `0TB` frente a `TB`.

`node test-h175-model-projection.mjs` sobre `HEAD`: **3/9**.

- Un alta V2 conserva `0TB`, tanto desde Inventario como desde Excel.
- Una actualización por Excel cambia el modelo de una referencia protegida. Es
  el mismo P0001 de H-174, por otra ruta.
- Un Excel antiguo produce un cambio fantasma.
- Una referencia libre no se normaliza.

## Causa raíz

No existía una autoridad única del `modelo` V2. `createReference()`,
`updateReference()` y `updateFromImport()` aceptaban el valor recibido aunque
el catálogo Modelo lo define.

## Diseño

`DATA.referenceModel(next, current)` es la autoridad:

- Una referencia protegida (existencias, bloqueo u operaciones) conserva su
  valor persistido, igual que la guarda SQL.
- Si no está protegida, `modelo` es el código del catálogo Modelo.
- Sin catálogo Modelo, conserva el valor capturado.

La consumen el alta, la edición en Inventario y la actualización por Excel. La
guarda SQL, la firma, el SKU, el código de barras y el bloqueo de cambios
físicos no cambian.

La migración `20260919022400_pos_h175_tira_bordada_model.sql` corrige los datos:

- Cambia `0TB` → `TB` en 35 IDs exactos: 34 protegidos y
  `3-TB-MC-MNT-MAO-RJO-N:GR`, que tiene 0 piezas.
- Compara por hash todas las demás columnas y el resto del inventario.
- Si algo difiere, aborta completa.
- En una base sin esas filas no hace nada.

## Solución

- `balam/data.jsx`: `projectedModel`, `referenceIdentityGuarded` y
  `referenceModel`, más su uso en `createReference` y `updateReference`.
- `balam/xlsx-io.jsx`: `updateFromImport` usa `D.referenceModel`.
- Migración de datos aplicada el 19/09/2026 con autorización explícita del dueño.
  El primer intento abortó sin efectos por `ONLINE_COMMAND_REQUIRED`: la guarda
  H-164 exige su canal online. El segundo, con `service_role`, abortó por
  permisos de `h133_internal_enabled`. La versión final aplica el patrón de las
  verificaciones H-164: suspende `online_runtime` dentro de la transacción y lo
  restaura byte a byte, con aserción.

## Pruebas

- Reproducción: 3/9 → **10/10**. Incluye la exportación e importación del
  inventario completo sin cambios ni conflictos.
- `db push --dry-run`: sólo `20260919022400` pendiente.
- Regresiones verdes, iguales a `HEAD`: `test-h174-edit-model-projection` 6/6,
  `test-h172-product-edit` 7/7, `test-h164-online-ui` 6/6 y
  `test-h164-online-pwa` 2/2.
- Fallos previos con huella idéntica en `HEAD`:
  - `test-h163-inventory-xlsx` y `test-h86-inventory-xlsx-contract`: excepción
    al preparar sus datos de prueba.
  - `test-xlsx-security` 16/17 y `test-export-modelo` 8/14: requieren
    categorías de talla que la configuración inicial ya no trae.
  - Ninguno está en el workflow.

## Riesgo residual y pendientes

- La verificación posterior es independiente, de solo lectura, contra la lista
  capturada antes del cambio:
  - Las 35 dicen `TB`, con el mismo `barcode_code`, SKU y existencias.
  - Las 59 TIRA BORDADA activas dicen `TB`.
  - No queda ningún `modelo` distinto del catálogo.
  - `online_runtime.enabled` sigue en true.
  - `migration list` registra 20260919022400 en local y en remoto.
- Las referencias V1 están fuera del alcance: no hay V1 operativas.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-175`
- `edicion-modelo-proyeccion-h174.md`
