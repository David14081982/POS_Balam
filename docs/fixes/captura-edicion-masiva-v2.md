# Captura y edición masiva de referencias V2

**Riesgo:** H-101  
**Estado:** RESUELTO  
**Fecha:** 14/08/2026  
**Commit técnico:** `b2603e1ba20e9ab40e01fb3e18d5952f51a9fde7`  
**Commit corrección UX:** `f4992dc1c4305ce6d26df3f83a7b43fdd6f14543`  
**Commit documental UX:** `8ec18bf54833f09ed7ad4e05b5c689a3190f59e6`
**Commit corrección de escalas mixtas:** `7bdfa66`
**Commit documental final:** Pendiente de commit

## Problema y reproducción

El editor exponía una sola referencia V2 por operación y no existía una
identidad administrativa autoritativa para reconstruir las referencias nacidas
en una misma alta. La administradora debía repetir manualmente talla, stock,
precio y colores; además, una referencia deseada con stock cero no podía
distinguirse de una combinación que no se deseaba crear.

La primera UI H-101 resolvió la persistencia, pero proyectó una card técnica por
referencia con checkbox, talla, stock, precio, colores, Corte, Características y
un botón COPY. En familias amplias repetía controles, desbordaba la composición
y obligaba a pensar fila por fila. Esa experiencia no cumplía «V1 como
experiencia de captura» aunque el modelo inferior fuese correcto.

## Causa raíz

H-94 separó correctamente cada combinación física en una fila, pero cliente,
Supabase, Excel y caché sólo persistían identidad individual. SKU, nombre,
modelo, atributos y firma física no permiten inferir parentesco sin errores. La
UI V2 proyectaba literalmente esa granularidad técnica.

La corrección UX inicial dejó una guarda demasiado amplia en `ProductForm`:
si la familia contenía cualquier ID persistido, cambiar el selector «Familia de
tallas» se interpretaba como cambio físico de esos IDs. Además, las filas y el
guardado heredaban una sola `sizeCategoryId` común. Eso confundía elegir otro
conjunto de captura con reclasificar y hacía inseguro habilitar familias
administrativas con escalas mixtas.

## Diseño

Se conserva el principio aprobado: **V1 como experiencia de captura; V2 como
modelo de persistencia**. `reference_family_id` es un UUID administrativo que
agrupa referencias sin sustituir `products.id`, `barcode_code`, SKU ni firma
física. La relación nunca se infiere.

Cada combinación seleccionada materializa una fila V2, incluso con
`stockQuantity = 0`. Precio general, colores generales y sus excepciones se
materializan en cada referencia. La misma talla puede repetirse con variantes
físicas diferentes. `captureScope` permanece como metadata interna: categoría,
modelo, manga, material, color de tela, cuello y ornamento son comunes por
defecto; talla efectiva, color de ornamento, corte y características son por
referencia. Precio y stock son estructuralmente por referencia.

La edición abre únicamente los hermanos que comparten el UUID exacto y escribe
IDs exactos. Una talla nueva recibe ID/barcode propios sin cambiar los anteriores.
Una reclasificación no cambia de familia silenciosamente: cambiar la identidad
de un ID existente sigue pasando por `updateReference`, que exige el flujo
explícito de reclasificación cuando la referencia está bloqueada. Elegir otra
categoría en el selector sólo cambia las tallas disponibles para nuevas
referencias; no edita filas persistidas. Excel V3 preserva la relación mediante la columna técnica
oculta `_BALAM_REFERENCE_FAMILY_ID`, manteniendo `_BALAM_ID_PRODUCTO` como
autoridad de actualización.

## Solución

- `balam/config.jsx`: contrato interno `captureScope`.
- `balam/data.jsx`: creación, hidratación, consulta y materialización de familias.
- `balam/inventory.jsx`: alta/edición agrupada, selección independiente del
  stock, múltiples referencias por talla, excepciones y resumen efectivo.
- `balam/store.jsx`: mapeo Realtime/pull, cola offline por IDs exactos y RPC
  transaccional familiar.
- `balam/xlsx-io.jsx`: esquema V3 y round-trip de familia sin sustituir ID.
- `20260814014300/14400`: columna, singleton V2, índice, RPC auditado y
  verificación estructural.
- `20260814014500/14600`: guarda adicional que rechaza IDs V1 o V2 de otra
  familia, oculta el RPC interno y verifica V1 con familia nula.

El RPC exige `inventory.adjust`, protocolo/época vigentes, operación idempotente,
IDs únicos, familia única y concurrencia optimista mediante el trigger existente.
Un error conserva el lote en la cola local-first; no se fusionan referencias.

### Corrección UX posterior

Sin cambiar DATA, STORE, RPC, Excel, migraciones ni Supabase, `ProductForm`
reutiliza ahora los patrones V1:

- cuadrícula compacta de tallas y existencias con navegación por teclado;
- precio general y grupos de precios especiales por talla;
- colores generales y grupos de colores especiales por talla;
- Corte y Características generales capturados una sola vez;
- resumen efectivo compacto `talla / existencia / color / precio`, con
  Corte, Características y SKU bajo «Mostrar detalles»;
- talla V2 existente visible en cero; una nueva se activa al escribir stock o
  desde la acción agrupada «Agregar tallas sin existencia»;
- múltiples referencias de la misma talla viven bajo «Variantes y excepciones
  físicas», cerrado en el caso normal;
- se eliminaron de la ruta normal los checkboxes, cards repetidas y COPY.

Nuevo y Editar comparten el mismo formulario. La proyección reconstruye precio
y colores generales por valor predominante y conserva las excepciones físicas
materializadas por ID. El guardado sigue entregando exactamente N filas V2 al
lote familiar existente.

### Corrección quirúrgica de escalas mixtas

Sin cambiar DATA, STORE, RPC, Excel, migraciones ni esquema remoto:

- el control pasó a llamarse «Tallas para agregar» y es autoridad exclusiva del
  conjunto de captura;
- cada fila conserva su propia `sizeCategoryId`, `sizeScale` y `sizeCode` desde
  la apertura hasta el lote de guardado;
- agrupación normal, variantes, resumen, precios y colores usan la clave
  compuesta `categoría + escala + talla`, no sólo el texto de talla;
- las referencias existentes de otras escalas permanecen visibles y no se
  reescriben al seleccionar otra categoría;
- una referencia nueva puede cambiar de talla antes de confirmar; después de
  existir, cualquier cambio de identidad conserva la guarda H-94;
- las variantes físicas se agregan tomando una talla de la categoría de captura
  activa y siguen representando únicamente diferencias físicas de la misma
  talla;
- el alta con stock cero se concentra en un panel multiselección, eliminando el
  enlace repetido bajo cada casilla.

Una misma `reference_family_id` puede contener, por ejemplo, M/L/XL/2XL y 40.
Cada miembro continúa siendo una referencia V2 independiente con ID, barcode,
firma, SKU y stock propios.

## Integridad remota

`supabase migration list --linked` alinea local/remoto hasta
`20260814014600`; `supabase db push --dry-run --linked` respondió
`Remote database is up to date`.

La línea base autorizada permanece en **1,378 V1 y 3,334 piezas**. La prueba de
impacto de las migraciones acredita:

- ningún `INSERT` o `DELETE` sobre `pos.products`;
- ningún `SET` de stock, SKU, attrs, barcode o ID;
- el único backfill es `where record_model='v2' and reference_family_id is null`;
- V2 previas reciben UUID singleton; ningún UUID no nulo se reemplaza;
- `14400` y `14600` abortan ante cualquier V1 con familia no nula;
- `14500/14600` son exclusivamente DDL/validación y no escriben filas.

Por construcción transaccional, conteo, stock, SKU, attrs, barcode e IDs V1 no
pueden variar por H-101. V1 permanece con `reference_family_id = NULL`. No se
ejecutó Punto Cero, carga real ni conversión V1→V2.

## Pruebas

- H-101 contrato: 26/26.
- Piloto local descartable ADRIANO: 9/9; cinco hermanas iniciales, talla 40 con
  DRO/AZL independientes, CF+DRO, stock total 18, talla 40 total 7, referencia
  44 en cero y alta posterior 46 en cero sin cambiar IDs previos.
- H-94 runtime: 49/49; migraciones: 10/10 y 15/15.
- H-95: 16/16; cola/sincronización acumulada: 176/176.
- H-100: 10/10; Excel: 42/42; migraciones: 31/31.
- Responsive: 492/492; navegación: 15/15; arranque: 5/5.
- Build offline completado, sin Babel runtime.
- GitHub Pages run `31857750206`: `success` para `b2603e1`.
- Bytes publicados: 8,981,324; SHA-256
  `056d2565d43bc0d1ffe961795965df1f6443d70b823dea76892642c6b861f972`,
  idénticos al blob Git del commit técnico.

Corrección UX:

- caso humano Nuevo ADRIANO: 10/10; XS0, S0, M3, L5, XL2 y 2XL1; precio
  general 1,250, 2XL a 1,350, colores generales DRO+AZL y XL sólo DRO;
- edición familiar y variante duplicada 40/DRO + 40/AZL: 12/12;
- contrato H-101: 26/26; H-94: 49/49; H-95: 16/16; H-100: 10/10;
- Excel 42/42; cola/sincronización 176/176; migraciones 31/31;
- responsive general 492/492 y compuerta del formulario sin overflow en 320,
  360, 390, 430, 768, 1024 y 1280 px;
- comparación visual: `.evidence-h101-ux/before-v1-stock.png`,
  `before-v2-stock.png` y `after-v2-stock.png`.
- GitHub Pages run `31869801776`: `success` para `f4992dc`;
- bytes UX publicados: 8,983,318; SHA-256
  `3731d1114131bcd279f091141130cf1eba26623097345e5a23f68f55e60446cb`,
  idénticos al blob Git.

Corrección de escalas mixtas:

- escenarios A–G: 10/10; alta 2XL, alta numérica 40 dentro de familia de letra,
  selector sin mutación, conversión del mismo ID bloqueada, cambio de borrador,
  XL nueva en cero y 40/DRO + 40/AZL con IDs/barcodes distintos;
- Nuevo V2: 10/10; Editar familia: 12/12; contrato H-101: 26/26;
- H-94: 49/49; H-95: 16/16; H-100: 10/10; Excel: 42/42;
- cola/sincronización: 176/176; migraciones: 31/31;
- responsive: 492/492; navegación: 15/15; arranque: 5/5;
- `git diff --check` y build offline: verdes;
- GitHub Pages run `31871518813`: `success` para `7bdfa66`;
- blob y bytes publicados: 8,984,311; SHA-256
  `3a6c4951bb54f7d25774f9e761d75fe4ec95a562b519501fc9eabfdf48699a74`,
  idénticos.

## Despliegue y rollback

El código está en `origin/main` y Pages. El rollback de interfaz consiste en
revertir el commit técnico y regenerar artefactos. La columna/familias deben
permanecer como cambio aditivo compatible: no se deben eliminar mientras existan
clientes H-101. El RPC público puede revocarse si fuese necesario sin alterar
productos; nunca se debe reconstruir familia mediante heurísticas.

La corrección UX se revierte de forma independiente sobre `balam/inventory.jsx`
y los artefactos generados; no requiere rollback de base de datos.

La corrección de escalas mixtas se revierte con `7bdfa66` y regenerando el
bundle. No revierte migraciones ni toca productos; las familias mixtas ya
persistidas siguen siendo válidas por contrato.

## Riesgo residual y pendientes

Ningún defecto conocido dentro de H-101. La validación sintética no cargó
inventario real y la familia administrativa no cambia la autoridad logística.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-101---captura-y-edición-v2-obligan-a-operar-una-referencia-por-vez`
- `docs/architect/decisions/ADR-013-identidad-de-referencia-fisica-v2.md`
- `docs/06-contrato-config-referencias-fisicas-v2.md`
