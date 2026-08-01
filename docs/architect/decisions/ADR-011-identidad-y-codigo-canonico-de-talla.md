# ADR-011 · La identidad de una talla no es el código que se edita

**Estado:** **decisión arquitectónica aceptada · implementación NO autorizada**
**Historia:** H-66 · **Fecha:** 01/08/2026

> Al cerrarse este documento: **cero migraciones aplicadas · cero cambios
> funcionales · cero cambios en datos · arnés en rojo intencional**. Lo que sigue
> es el contrato acordado, no una descripción de lo construido.

## Contexto

En `pos.lookup` una fila se identifica por `unique(kind, code)`, y `code` cumple
tres funciones incompatibles a la vez:

1. **identidad técnica** — `stock[].talla` guarda ese valor y por él se localiza
   la variante (`resolveProductSizes`, `stockVariantOf`);
2. **valor de intercambio** — el Excel compone sus encabezados con él;
3. **etiqueta de captura** — es lo que el administrador escribe al dar de alta.

La consecuencia se pagó tres veces. H-63: 1,460 piezas invisibles bajo códigos
retirados. H-64: la talla 38 registrada como «0» porque el código se capturó mal
y no había forma de corregirlo. Y al intentar normalizarlos, editar un código
resultaba ser una migración física de 2,261 filas con 1,817 piezas reales.

Es el defecto que `FF-02` describe —modelar la implementación en lugar del
concepto— y el mismo que costó H-33 con el folio: un campo con dos funciones
incompatibles.

## Decisión

Se separan los tres conceptos:

| Campo | Qué es | Muta |
|---|---|---|
| `internal_code` | **Identidad** estable de la talla. Es lo que `stock[]`, los documentos, las promociones, los precios por talla y los códigos de barras ya guardan | **Nunca** |
| `code` | **Código canónico** de operación e intercambio. Lo muestra Configuración y lo usan los encabezados de Excel | Sí, con validación |
| `label` | Etiqueta visible para el vendedor | Sí |

**Editar `code` no mueve una sola existencia.** Es una edición de catálogo, no
una migración.

Toda operación de catálogo identifica la fila por `(kind, internal_code)`:
lectura, upsert, edición, borrado, activación, importación, sincronización,
reconciliación de filas ausentes, RPC y `expected_version`. Si el servidor
siguiera reconciliando por `(kind, code)`, editar el canónico crearía una fila
nueva y dejaría la anterior — el duplicado que originó H-63.

Un código canónico retirado **no se reutiliza** mientras puedan existir archivos
que lo referencien; el historial de códigos canónicos lo conserva y lo reserva.

## Alternativas descartadas

**A · Migrar físicamente los códigos.** Reescribir `stock[].talla` para que la
identidad coincida con la talla. Rechazada: mueve 1,817 piezas reales, obliga a
una tabla de equivalencias en la ruta que mueve inventario, impide que la talla 0
use el código `0` —hay que quemar el código anterior— y deja cada corrección
futura convertida otra vez en migración.

**B · `size_id` inmutable en todas las referencias.** Es el destino correcto a
largo plazo, pero exige reescribir el contrato de `stock[]`, de los documentos,
de la cola y del Excel en una tienda con ventas diarias. C es su primer paso:
`internal_code` es exactamente el campo que B promovería.

## Contratos que la implementación debe cumplir

Cuatro, y ninguno es opcional.

### 1 · Terminales anteriores: el servidor proyecta `meta.value`

Un cliente con el artefacto anterior no sabe construir `meta.value` desde
`internal_code`: aplicaría `meta.value ?? code` y buscaría existencias con la
identidad `40` cuando `stock[].talla` guarda `A`. Por eso **`meta.value` se
proyecta en el servidor**, con disparador sobre `pos.lookup`, y no depende de
código nuevo del cliente. Una restricción impide que diverja de `internal_code`.

**Demostrado sobre el artefacto anterior:** con filas `code=40 · meta.value=A`,
`code=42 · meta.value=B` y `code=0 · meta.value=s`, y un producto con
`stock[].talla` en `A`, `B` y `s`, el artefacto previo resuelve 6, 2 y 1 piezas,
las ofrece como «40», «42» y «0», y `stockOf(p,'A')` localiza la variante.

**Pero la lectura compatible no alcanza**, y aquí está el matiz que obliga a
combinar: ese mismo artefacto **exporta a Excel con encabezados `TA`, `TB`, `Ts`**
—compone por identidad, no por canónico—. Un archivo así saldría sin `_esquema`,
así que el importador nuevo lo bloquea; pero la terminal anterior seguiría
pudiendo escribir el catálogo.

**Decisión: compatibilidad de lectura + bloqueo de escritura, impuesto en el
servidor.** El artefacto anterior no se puede modificar, de modo que la
protección no puede vivir en él. Punto de venta e Inventario siguen funcionando
—sólo leen, y la identidad no cambió—; lo que se corta es su capacidad de
escribir catálogo. No se bloquea la aplicación entera porque no hace falta: como
H-66 **no mueve identidad**, todo lo que una terminal anterior hace con
existencias sigue siendo semánticamente correcto.

### 2 · `expected_version` sólo protege si no es evadible

Hoy `pos.lookup` tiene RLS activa con política `active_admin_all` y
`grant all … to authenticated` (`pos_004_rls`, `pos_admin_rls`): **cualquier
administrador activo puede hacer `INSERT`, `UPDATE`, `UPSERT` y `DELETE`
directos**, y `pushConfig()` hace exactamente eso. Una versión esperada aplicada
sólo en el cliente nuevo no protege nada.

El contrato exige: **revocar la escritura directa sobre `pos.lookup`** para
`authenticated`, conservar sólo lectura, y llevar altas, ediciones, activaciones,
desactivaciones y borrados a **RPC controlado** que valide `expected_version`
dentro del servidor, identifique por `(kind, internal_code)`, rechace cualquier
intento de modificar `internal_code` e impida que un cliente cree una fila
apoyándose en el `default`.

### 3 · El historial es temporal, no un par anterior→actual

El mismo canónico significa identidades distintas según la versión: antes de
H-66 `T0` es la identidad `0` —talla 38—; después, `T0` es la identidad `s`
—talla 0— y `T38` es la identidad `0`. Un par `previous_code → replacement_code`
no puede responder eso.

El historial se modela como **intervalos de vigencia**: `kind`, `internal_code`,
`canonical_code`, `valid_from_version`, `valid_to_version`, `changed_at`,
`actor_user_id`, `operation_id`. La pareja `(canonical_code, catalog_version)`
debe resolver a **una sola** identidad, garantizado por índice y por una guarda
de no solapamiento.

### 4 · Un archivo sin versión no se interpreta

Todo archivo nuevo lleva `_esquema`, `catalog_version` y fecha de exportación, y
sus encabezados son canónicos. Un archivo **sin marca no entra por un modo
genérico «heredado»**, porque `T0` ha tenido más de un significado: o se bloquea,
o el administrador **elige explícitamente el esquema histórico aplicable**, y
antes de aplicar se muestra vista previa con columna encontrada, identidad a la
que resolverá, etiqueta y cantidad que se modificará. Dos columnas que resuelvan
a la misma identidad bloquean el archivo completo. **El significado de `T0` no se
adivina nunca.**

## Costo

- Una columna, dos índices y una tabla de historial en el esquema.
- Toda operación de catálogo debe repuntarse a la identidad; hacerlo a medias
  reproduce duplicados.
- `sizeId` y `filterKey`, que H-61 definió como identidad estable de una talla,
  hoy se construyen con `code`: deben repuntarse o esa autoridad se rompe.
- Los archivos Excel anteriores dejan de ser autodescriptivos: requieren marca de
  esquema o un modo heredado confirmado por el administrador. **Nunca se traducen
  por adivinación.**
- El dato crudo seguirá guardando `A`, `B`, `0`. Es interno y nadie lo ve, pero
  quien abra la base lo verá.

## Beneficio

- Corregir un código deja de ser una migración y pasa a ser una edición.
- Desaparece la clase de riesgo de H-63 y H-64: ninguna corrección de catálogo
  puede volver a esconder existencias, porque las existencias no se tocan.
- La verificación es trivial y demoledora: **la huella de `stock` debe ser
  idéntica antes y después**.

## Nota

La separación ya existía. `resolveProductSizes()` localiza el stock con
`meta.value ?? item.code` desde H-57, y `meta.value` está vacío en las 76
entradas de talla. Esta decisión no inventa la costura: la nombra y la activa.
