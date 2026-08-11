# Contrato objetivo de CONFIG para referencias físicas V2

**Historia:** H-94, fase previa al piloto

**Estado:** CONFIG REMOTA APLICADA; CLIENTE VERDE; PILOTO/PUBLICACIÓN PENDIENTES

**Fecha de auditoría:** 11/08/2026

**Commit documental:** Pendiente de commit

**Autoridad leída:** CONFIG publicada (`pos.settings`, `pos.lookup`,
`_catalogMeta` y Constructor de SKU) mediante la sesión normal del propietario,
exclusivamente en lectura.

Este documento incorpora la decisión definitiva sobre `caracteristicas` y la
autorización posterior del catálogo remoto `ornament_color`. Continúan fuera de
alcance regenerar SKU o convertir productos V1, ejecutar punto cero, cargar
inventario real e imprimir etiquetas reales.

## A. CONFIG publicada y CONFIG objetivo

Abreviaturas: **A** = En alta, **R** = En referencia, **S** = En SKU,
**O** = Obligatorio y **F** = Filtrable. `Cond.` significa validación
condicionada al valor de otro catálogo. Talla se captura en el control
estructural, no como dos selectores simultáneos.

| Kind · nombre | Publicado A/R/S/O/F | Objetivo A/R/S/O/F | Cambio requerido | Razón e impacto |
|---|---|---|---|---|
| `category` · Categoría | Sí/Sí/Sí/Sí/No | Sí/Sí/Sí/Sí/No | Ninguno | Ya distingue referencia, SKU y alta. Es dimensión estadística por atributo. |
| `producto` · Modelo | No/No/Sí/No/No | Sí/Sí/Sí/Sí/No | Activar A, R y O; conservar S | El cliente hoy lo captura y exige por una excepción, y la firma lo añade fuera de CONFIG. Se elimina esa autoridad paralela: el catálogo gobierna alta, firma y SKU. |
| `sleeve` · Manga | Sí/Sí/Sí/Sí/No | Sí/Sí/Sí/Sí/No | Ninguno | Ya forma referencia y SKU. Estadística desde atributo/snapshot. |
| `fabric` · Material | Sí/Sí/No/Sí/Sí | Sí/Sí/Sí/Sí/Sí | Activar S | Evita que materiales distintos sean comercialmente indistinguibles. No cambia la seguridad por ID/barcode. |
| `color` · Color Tela | Sí/Sí/Sí/Sí/Sí | Sí/Sí/Sí/Sí/Sí | Ninguno | Autoridad independiente del color de ornamento. |
| `neck` · Cuello | Sí/Sí/No/Sí/No | Sí/Sí/Sí/Sí/No | Activar S | Cuellos distintos tendrán token comercial distinto. |
| `ornament` · Ornamento | No/Sí/No/Sí/No | Sí/Sí/Sí/Sí/No | Activar A y S | Debe poder seleccionarse. `—`/Sin ornamento es una selección explícita válida; no se infiere por vacío. |
| `ornament_color` · Color de ornamento | Sí/Sí/No/No/Sí | Sí/Sí/Sí/Cond./Sí | Activar S y validación condicional | Catálogo multiselección independiente. Cambia firma, filtros y SKU mediante una combinación canónica. |
| `size_letter` · Talla (Letra) | Estructural/Sí/No/No/No | Estructural/Sí/—/Sí/No | Quitarle decisión S individual | Aporta catálogo y escala, pero el Constructor consume una única Talla efectiva. |
| `size_number` · Talla (Número) | Estructural/Sí/Sí/No/No | Estructural/Sí/—/Sí/No | Quitarle decisión S individual | Corrige la asimetría actual sin exigir dos tallas. |
| `corte` · Corte | Sí/No/No/No/No | Sí/Sí/No inicial/No/No | Activar R; conservar S apagado inicialmente | Corte puede separar referencias. El administrador puede activar S después de revisar impacto. |
| `caracteristicas` · Características | No/No/No/No/No | Sí/Sí/No inicial/No/Sí | Activar A, R y F | Dos valores distintos pueden crear IDs, barcodes, stock y estadísticas independientes aun con SKU visible igual. |
| `effective_size` · Talla efectiva (virtual) | No existe | Estructural/Sí/Sí/Sí/No | Crear metadato virtual, sin filas de lookup | Es el único segmento de talla del Constructor y de la firma; resuelve letra o número. |

Orden objetivo inicial del Constructor:

1. Categoría (`category`).
2. Modelo (`producto`).
3. Manga (`sleeve`).
4. Material (`fabric`).
5. Color Tela (`color`).
6. Cuello (`neck`).
7. Ornamento (`ornament`).
8. Color de ornamento (`ornament_color`).
9. Talla efectiva (`effective_size`).
10. Corte (`corte`), apagado inicialmente.
11. Características (`caracteristicas`), apagado inicialmente.

`EN REFERENCIA` y `EN SKU` continúan siendo independientes. Un cambio posterior
de `EN SKU` exige previsualizar nuevos códigos, longitud, referencias afectadas,
colisiones, atributos omitidos y ejemplos; no cambia `products.id`,
`barcode_code`, stock ni documentos congelados.

### Inconsistencias que debe eliminar la implementación

- La CONFIG publicada marca Modelo fuera de Alta/Referencia/Obligatorio, pero el
  formulario lo captura y `DATA.physicalSignature()` lo agrega siempre como
  `model`. Al activar `producto` en referencia hay que retirar ese agregado fijo
  para no duplicarlo.
- La talla número está En SKU y la talla letra no. El cliente filtra hoy dos
  `sizeSlot`; no existe una autoridad virtual común.
- Ornamento está obligatorio y En alta apagado: la obligación queda oculta.
- Corte se captura, pero no forma referencia; Características no participa en
  ninguna dimensión.
- Los defaults locales no son la autoridad publicada: entre otras diferencias,
  la semilla deja Material En SKU, Talla Número fuera del SKU y no contiene los
  tres catálogos personalizados publicados.
- Preview usa el estado `ornColors`; el alta termina enviando
  `ornamentColorCodes`; la función canónica actual es privada y ordena con
  `localeCompare`. No hay todavía un contrato único de serialización.

## B. Autoridad exacta de Talla efectiva

`DATA.effectiveSize(product, explicitSize?)` será la única autoridad y devolverá:

```text
{
  sizeCategoryId, // size_letter o size_number
  sizeCode,       // código persistido
  scale,          // L o N
  label,
  skuToken
}
```

Invariantes:

- una referencia V2 tiene exactamente un `sizeCategoryId` y un `sizeCode` activo
  perteneciente a esa categoría;
- nunca se exige letra y número simultáneamente;
- la firma física incorpora el par `[sizeCategoryId, sizeCode]`;
- preview, SKU final, Excel, filtros y snapshots consumen el mismo descriptor;
- V1 conserva su matriz y sus SKU congelados; la autoridad sólo proyecta cada
  talla cuando se simula o se opera una pieza;
- el Constructor muestra un solo segmento `Talla efectiva`, no dos toggles.

`skuToken` es el código desnudo cuando no es ambiguo (`L`, `XL`, `40`). Si el
mismo código existe en ambas categorías —hoy ocurre con `PZ`, `CH`, `M`, `GR` y
`XG`— antepone la escala (`L:M` frente a `N:M`). Así una unificación visual no
crea una colisión comercial entre dos autoridades técnicas distintas.

## C. Autoridad canónica de multicolor

La única función pública será
`DATA.canonicalOrnamentColorCodes(values)`. Su contrato:

1. normaliza a códigos string conocidos de `ornament_color`;
2. elimina repetidos;
3. ordena por comparación binaria estable del código, no por locale ni por orden
   de selección;
4. devuelve el array canónico para persistencia, firma, Excel, estadísticas y
   snapshots;
5. deriva el token comercial con `codes.join('+')`.

Con códigos reales publicados, `DRO + CF`, `CF + DRO` y
`DRO + CF + DRO` producen el mismo array `["CF","DRO"]`, la misma firma y el
mismo token `CF+DRO`. El código real de Dorado es `DRO`; `DOR` no debe inventarse.

La validación de color pertenece al valor de Ornamento:

- `colorMode: none`: oculta y vacía colores (`—` y `NA`);
- `colorMode: optional`: permite cero o más;
- `colorMode: required`: exige al menos uno.

Por compatibilidad, `allowsColors:false` se interpreta como `none` y la ausencia
de `colorMode` como `optional`. Ningún ornamento se convierte silenciosamente en
`required`; esa marca debe existir expresamente en su metadato.

## D. Simulación del Constructor con códigos reales

Receta base: Categoría–Modelo–Manga–Material–Color Tela–Cuello–Ornamento–Color de
ornamento–Talla efectiva. Corte se muestra aparte porque inicia apagado;
Características queda fuera del SKU.

| Caso | SKU simulado | Longitud |
|---|---|---:|
| DANTE · talla 40 · Dorado | `1-DAN-ML-LIN-BL-MAO-BEL-DRO-40` | 30 |
| DANTE · talla 40 · Azul | `1-DAN-ML-LIN-BL-MAO-BEL-AZL-40` | 30 |
| DANTE · talla 40 · Dorado+Café | `1-DAN-ML-LIN-BL-MAO-BEL-CF+DRO-40` | 33 |
| DANTE · talla L · Dorado | `1-DAN-ML-LIN-BL-MAO-BEL-DRO-L` | 29 |
| Caso Dorado con Corte `SLF` activado | `1-DAN-ML-LIN-BL-MAO-BEL-DRO-40-SLF` | 34 |

Una referencia con Característica `23` y otra con Característica `26` conservan
el mismo primer SKU mientras `caracteristicas.inSku=false`, pero su firma,
`products.id`, `barcode_code`, stock y estadísticas son distintos. El Constructor
muestra la advertencia y la propuesta con `-23`/`-26` si el administrador simula
activar ese segmento.

## E. Colisiones observadas, sin guardar

La lectura lógica publicada contenía 222 productos activos, 841 combinaciones de
talla con existencia positiva y 3,334 unidades. Esto es una proyección del
cliente; no sustituye ni modifica las 1,378 filas V1 protegidas en la base.

- receta publicada: 221 SKU visibles; 154 grupos repetidos abarcan 774 de las
  841 combinaciones, con hasta 10 combinaciones por SKU;
- receta objetivo, Corte apagado: 841 SKU simulados distintos, cero grupos
  repetidos observados;
- receta objetivo, Corte encendido: también 841 distintos;
- los 154 grupos actuales desaparecen en la simulación por la talla efectiva y
  los segmentos físicos añadidos. Ejemplos: `1-PRE-ML-BL-T` (10),
  `1-ALS-ML-CCAP-T` (9), `1-TDO-ML-BL-T` (9), `1-CRZ-MC-AAC-T` (9) y
  `24-TB-MC-BL-T` (9).

No queda una colisión en los datos V1 observados, pero el contrato permite
colisiones futuras deliberadas por Características o Corte fuera del SKU. El
piloto debe crear ese caso sintético; cero colisiones actuales no demuestra que
la advertencia sea innecesaria.

## F. Longitud observada

Sobre las 841 simulaciones:

| Perfil | Mínima | Típica (mediana) | Máxima observada |
|---|---:|---:|---:|
| Receta objetivo, Corte apagado | 22 | 31 | 46 |
| Receta objetivo, Corte encendido | 24 | 33 | 48 |

La longitud sólo afecta legibilidad comercial. La etiqueta imprime el SKU como
texto, pero Code128 codifica el `barcode_code` de 16 caracteres; un SKU de 48
caracteres no alarga ni invalida las barras de 60×40.

## G. Auditoría de los 69 valores de Características

Resultado global: 69/69 activos; códigos únicos y consecutivos `1`–`69`; cero
etiquetas exactamente duplicadas; cero equivalencias semánticas que puedan
afirmarse con seguridad sólo por el texto. Ningún producto de la proyección
lógica leída usa hoy `attrs.caracteristicas`, por lo que uso cero no prueba
obsolescencia. `GEN` exige definición o imagen; `ORN` solapa vocabulario con
Ornamento; `COR` puede ser Corte/estructura; `COL` incrusta un color que no debe
convertirse en una segunda autoridad cromática. Nada se depura automáticamente.

| Código | Valor publicado | Dictamen previo a decisión propietaria |
|---:|---|---|
| 1 | 4 LINEAS DE ALFORZAS ENTRE ESPACIO ANCHO | Física; ORN `ALF`. Separar motivo de técnica. |
| 2 | DOBLE LINEA DE TRIANGULOS CON PESTAÑAS | Motivo físico distinguible. |
| 3 | BALANZAS | GEN; pedir imagen/definición. |
| 4 | ESCUADRAS | GEN; puede ser motivo físico. |
| 5 | AGAVES | GEN; puede ser motivo físico. |
| 6 | LINEA DE CUSTODIA | Motivo físico; confirmar nomenclatura. |
| 7 | LINEA DE X ANCHA | Motivo físico distinguible. |
| 8 | 6 LINEAS | GEN; no indica técnica ni disposición. |
| 9 | ROMBOS CIRCULAR CON 4 ROMBITOS | Motivo físico distinguible. |
| 10 | 4 NUDITOS EN DIAGONAL | Motivo físico distinguible. |
| 11 | FLORES AZULES Y HOJAS VERDES | Física + COL; separar color si es variable. |
| 12 | LINEAS CRUCECITAS ENTRE 2 LINEAS DE CARACOLITOS | Motivo físico distinguible. |
| 13 | CUBANA DOS BOLSAS ARRIBA | COR/estructura; revisar frente a Corte y ORN `BOL`. |
| 14 | LINEA DE CARACOLITOS | Motivo físico distinguible. |
| 15 | RIEL Y ALFORZAS | Física; ORN `ALF`. |
| 16 | 12 LINEAS DE ALFORZAS | Física; ORN `ALF`. |
| 17 | CORONITAS GUIRNALDAS | Motivo físico distinguible. |
| 18 | LINEA CUADRITOS PERFORADOS | Motivo físico distinguible. |
| 19 | LINEA DE CRUZ EN ROMBO | Motivo físico distinguible. |
| 20 | ESPIRAL CON PICOS | Motivo físico distinguible. |
| 21 | TIRA DE FLORES AZUL CIELO | Física + COL; separar color si es variable. |
| 22 | SOL Y RIELES CRUZADOS | Motivo físico distinguible. |
| 23 | 3 TIRAS ESFERAS DORADAS | Física + COL; Dorado pertenece a color de ornamento si es variable. |
| 24 | ESPIRAL CUADRADO | Motivo físico distinguible. |
| 25 | TIRA FLECHAS CRUZADAS | Motivo físico distinguible. |
| 26 | 6 BORDADOS DE PEDAL | Física; ORN `BPE`. |
| 27 | 8 LINEAS DE PICUETAS | Física; ORN `PIC`. |
| 28 | CADENA DE OVALOS | Motivo físico distinguible. |
| 29 | TIRA DE X ENTRE 2 LINEAS DE CARACOLES | Motivo físico distinguible. |
| 30 | TIRA RED | GEN; definir qué significa red. |
| 31 | TIRA DE X Y ROMBOS | Motivo físico distinguible. |
| 32 | ROMBO Y 2 PUNTAS DE FLECHAS BORDADO ANCHO | Motivo físico; “bordado” es técnica genérica. |
| 33 | 4 LINEAS DE PICUETAS | Física; ORN `PIC`. |
| 34 | MULTIROMBOS | GEN; pedir patrón/imagen. |
| 35 | CRUCES Y TRIANGULOS ENFRENTADOS | Motivo físico distinguible. |
| 36 | TIRA X EMPALMADAS | Motivo físico distinguible. |
| 37 | LINEA DELGADA RED ROMBITOS | Motivo físico; aclarar “red”. |
| 38 | LINEAS DOBLE DE NUDITOS | Motivo físico distinguible. |
| 39 | RELOJ DE ARENA | GEN, aunque puede ser un motivo válido. |
| 40 | PICUETAS BLANCO | ORN `PIC` + COL; separar Blanco si es variable. |
| 41 | 2 GANCHOS CRUZADOS Y 4 ROMBITOS | Motivo físico distinguible. |
| 42 | ALFORZAS 2 BOLSAS ABAJO OCULTAS | COR/estructura + ORN `ALF`/`BOL`. |
| 43 | PICUETA, ALFORZA, BORDADO PEDAL Y BOLSAS | Combinación física; solapa `PIC`, `ALF`, `BPE` y `BOL`. |
| 44 | PICUETAS Y ALFORZAS | Combinación física; ORN `PIC`/`ALF`. |
| 45 | COPOS DE NIEVE | Motivo físico distinguible. |
| 46 | LINEA CUADRITOS Y ALFORZAS | Física; ORN `ALF`. |
| 47 | PICUETA NEGRA Y ALFORZA | ORN `PIC`/`ALF` + COL; separar Negro si es variable. |
| 48 | 8 LINEAS DE ALFORZAS | Física; ORN `ALF`. |
| 49 | MOÑITOS HORIZONTALES Y ROMBITOS | Motivo físico distinguible. |
| 50 | TIRA FLOR DE PICOS | Motivo físico distinguible. |
| 51 | ROMBOS CON NUDITOS | Motivo físico distinguible. |
| 52 | TIRA X EMPALMADAS, CRUCECITA Y PESTAÑAS | Motivo físico distinguible. |
| 53 | 2 BOLSAS PUROS CON ALFORZA | COR/estructura + ORN `BOL`/`ALF`; aclarar “puros”. |
| 54 | PICOS | GEN; demasiado amplio sin imagen/definición. |
| 55 | PRESIDENCIAL | COR/estilo probable; no describe por sí solo el rasgo. |
| 56 | ROMBOS CON ESTRELLAS | Motivo físico distinguible. |
| 57 | LINEA BORDADO CERCO | Física; aclarar técnica y motivo. |
| 58 | ROMBOS CIRCULARES Y PUNTA DE FLECHAS | Motivo físico distinguible. |
| 59 | CADENAS | GEN; puede representar varios patrones. |
| 60 | ROMBITOS CON CRUZ Y ALFORZAS | Física; ORN `ALF`. |
| 61 | S INVERTIDA Y LINEAS DE NUDITOS | Motivo físico distinguible. |
| 62 | BORDADO TIPO S | GEN/técnica; pedir definición o imagen. |
| 63 | SEMIPRESIDENCIAL | COR/estilo probable; definir diferencia con `55`. |
| 64 | PANAL | GEN, aunque puede ser un motivo válido. |
| 65 | 2 TELARAÑAS UNIDAS | Motivo físico distinguible. |
| 66 | ROMBOS VICTORIA | Motivo físico; confirmar qué define “Victoria”. |
| 67 | 6 BORDADOS ELECTRONICOS | Física; ORN `BEL`. |
| 68 | TLAHITOLTEPEC | GEN/COR/origen posible; requiere definición. |
| 69 | FLORES CON ESTRELLAS | Motivo físico distinguible. |

La decisión propietaria pendiente sobre cada valor debe ser una de: conservar
como motivo, renombrar con definición, mover a Corte, representar la técnica en
Ornamento, separar el color o desactivar. “Desactivar” nunca elimina historia.

## H. Cambio exacto propuesto para una fase autorizada posterior

Archivos fuente que requerirían modificación:

- `balam/config.jsx`: metadatos objetivo, orden, slot virtual de Talla efectiva y
  semántica `colorMode`.
- `balam/data.jsx`: autoridades públicas de talla/multicolor, firma sin Modelo
  hardcodeado, SKU/preview comunes, diferencias de atributos y proyecciones
  estadísticas por ID/snapshot.
- `balam/inventory.jsx`: captura/edición de Características y Corte como
  referencia, validación condicional del color y un solo selector efectivo.
- `balam/settings.jsx`: un toggle de Talla efectiva y preflight completo de
  colisiones, longitud, omitidos y ejemplos.
- `balam/xlsx-io.jsx`: round-trip del array multicolor canónico y de atributos
  personalizados sin inferir identidad desde SKU.
- `balam/reports.jsx`: existencia desde productos vivos y ventas desde snapshots,
  agrupables por Características y demás dimensiones.
- pruebas `test-h94-reference-model-v2.mjs`,
  `test-h86-inventory-xlsx-contract.mjs`, `test-product-sizes.mjs` y
  `test-filtros-inventario.mjs`; agregar contratos específicos de CONFIG y
  estadísticas.

CONFIG remota posterior:

- actualizar exclusivamente `_catalogMeta` en `pos.settings` con los flags y
  órdenes de esta tabla;
- crear el metadato virtual `effective_size`, sin filas en `pos.lookup`;
- añadir `colorMode` a los metadatos de valores de `ornament` en `pos.lookup`;
- crear `ornament_color` con sólo `DRO`, `AZL`, `CF`, `PLT`, `BL` y `NE`;
- no editar ninguno de los 69 códigos/etiquetas de `caracteristicas` en esta fase.

La migración de datos `20260811013600_pos_h94_config_target.sql` persiste esa
CONFIG sin escribir `products`, stock ni documentos. H-94 ya dispone de
`attrs`, `ornament_color_codes`, talla/stock V2, firma, snapshots e índices; no
se modifica `store.jsx`, barcode/POS/posventa ni el esquema de identidad. Los
artefactos se regeneran con `node build-offline.mjs`; nunca se editan como fuente.

## I. Pruebas rojas antes de tocar CONFIG

Primero deben añadirse y fallar contra el cliente/CONFIG actuales:

1. los 12 catálogos publicados y `effective_size` cumplen exactamente la tabla;
2. Modelo no entra por una excepción y aparece una sola vez en la firma;
3. letra `L`, letra `XL` y número `40` producen sus tokens; sólo se admite una
   categoría/talla y los códigos cruzados ambiguos se distinguen;
4. todas las permutaciones y duplicados `DRO`/`CF` dan el mismo preview, SKU,
   firma, Excel, snapshot y agrupación estadística;
5. `colorMode:none|optional|required` oculta, permite o exige correctamente;
6. Características A/B producen firmas, IDs, barcodes y stock independientes,
   pero SKU igual + advertencia cuando S está apagado;
7. filtros y reportes agrupan por `products.id + attrs` o snapshot, nunca
   analizan SKU;
8. el preflight del Constructor reproduce 841 resultados sin escribir y muestra
   colisiones/longitud/atributos omitidos;
9. Excel V2 conserva talla efectiva, multicolor y Características en round-trip;
10. venta, devolución, cambio, apartado, préstamo y dos terminales conservan el
    ID exacto cuando dos SKU coinciden;
11. precio, promoción y descuento no cambian ID, barcode, firma ni SKU;
12. una huella antes/después acredita intactos los 1,378 V1 y el stock remoto.

Sólo después de ver estas pruebas rojas se implementa localmente; luego deben
quedar verdes junto con todas las regresiones H-94, H-86, V1 y V2.

## J. Reversa no destructiva

Para la documentación de esta fase, la reversa sólo elimina este contrato y sus
referencias documentales; no existe cambio operativo que revertir.

Para una aplicación futura autorizada:

1. guardar snapshot exacto versionado de `_catalogMeta`, metadatos de
   `ornament`, versión/hash de CONFIG y artefacto cliente anterior;
2. aplicar CONFIG con comparación de versión y operación atómica;
3. no regenerar SKU existentes ni escribir productos durante esa operación;
4. si falla el cliente publicado, retirar primero ese cliente;
5. restaurar después el snapshot de CONFIG mediante la misma autoridad atómica;
6. conservar el esquema aditivo H-94; no revertir migraciones ni datos;
7. acreditar por huella que productos V1, stock y documentos no cambiaron.

Si ya existieran referencias piloto, primero se detiene y aísla el piloto. Nunca
se “revierte” fusionando referencias, cambiando sus IDs/barcodes o reescribiendo
documentos. Esta fase se detiene antes de crear cualquiera.

## K. Despliegue controlado del 11/08/2026

La implementación local llegó a verde y el dry-run remoto confirmó como única
pendiente `20260811013600_pos_h94_config_target.sql`. La migración contiene
guardas de 1,378 productos V1, cero V2, 69/69 Características y huellas
antes/después; no escribe productos ni documentos.

La aplicación se abortó dos veces dentro de la transacción, sin commit:

1. `_catalogMeta` remoto contiene 11 kinds, pero no `ornament_color` ni
   `effective_size`. El cliente auditado materializaba `ornament_color` desde
   defaults, por eso la vista publicada no representaba la fila cruda completa.
2. `pos.lookup` tampoco contiene bajo `kind='ornament_color'` los códigos
   `DRO`, `AZL` y `CF` que el cliente mostraba desde defaults.

Después de ambos abortos, `migration list` dejó `13600` sólo local; los conteos
remotos siguieron en 1,378 productos, 40 settings, 474 lookup, 1 venta,
1 movimiento, cero devoluciones/cambios/préstamos/reclasificaciones y 8 commits
CONFIG. No se publicó cliente, no se crearon fixtures y no se modificó CONFIG.

La decisión posterior autorizó exactamente `DRO — Dorado`, `AZL — Azul`,
`CF — Café`, `PLT — Plateado`, `BL — Blanco` y `NE — Negro`. La migración se
endureció para exigir ausencia total previa del kind, insertar únicamente esas
seis filas y validar el arreglo remoto exacto dentro de la misma transacción.

El dry-run volvió a mostrar sólo `13600`; la aplicación acreditó 1,378 V1,
cero V2, las huellas protegidas sin cambio y CONFIG versión 9. La lectura SQL
directa de la transacción devolvió las seis filas y la metadata aprobada. Los
conteos posteriores son: 1,378 productos, 40 settings, 480 lookup, 1 venta,
1 movimiento, cero devoluciones/cambios/préstamos/reclasificaciones y 9 commits
CONFIG. `migration list` quedó simétrico y el dry-run final respondió
`Remote database is up to date`.

El cliente ya no materializa `ornament_color` desde defaults al cargar un estado
remoto: si el servidor no entrega el kind, la lista queda vacía y sin metadata.
Las pruebas lo acreditan junto con el conjunto remoto exacto. CONFIG 30/30,
modelo V2 48/48, Excel 42/42, etiquetas 19/19, formulario 19/19 y ornamentos
17/17. Antes de cerrar faltan publicación, validación con la sesión normal y el
piloto sintético con limpieza.
