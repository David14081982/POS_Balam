# ADR-009 — El precio por talla es un mapa de excepciones dentro del artículo

**Estado:** vigente · **Historias:** H-36 (origen)

## Contexto

El negocio necesita que ciertas tallas de un mismo SKU tengan un precio
comercial distinto. En BALAM el SKU identifica el **modelo** —reserva un
marcador `T` en el segmento de talla— y la variante que ya usan existencias,
etiquetas, `sale_items`, la reserva de stock y `sale_line_balance` es
`(producto, talla)`. La mayoría de los artículos mantiene un precio único y sólo
unos pocos necesitan excepciones.

## Decisión

El precio sigue siendo un atributo del artículo, con un mapa de **excepciones**
por talla: `pos.products.precios_talla jsonb`, forma `{ "<talla>": <precio> }`,
replicando el patrón que la propia tabla ya usa en `barcode_urls`. La ausencia
de una clave significa «vale el precio general»; `{}` es el estado histórico.
La autoridad `DATA.listPrice(producto, talla)` es la única que resuelve la
pregunta, y `DATA.priceRange()` deriva de ella el rango del catálogo.

## Trade-off

**Beneficio obtenido:** el dato viaja dentro de la fila de producto, así que
hereda el versionado optimista de H-06, la cola offline y el pull sin superficie
de sincronización nueva; queda protegido del vendedor por el trigger existente
sin trabajo extra; `pos.commit_sale` no se toca; y los artículos existentes no
cambian de comportamiento porque la columna nace vacía.

**Costo aceptado:** un `jsonb` sin integridad referencial hacia el catálogo de
tallas —una talla retirada deja una entrada huérfana, como ya ocurre con
`barcode_urls`, y hay que podarla en el cliente—; los precios no son
consultables desde SQL sin desanidar, así que no hay reportes de precios por
variante sin trabajo adicional; y `products` engorda un snapshot que ya se envía
completo en cada escritura.

**Alternativa descartada:** una tabla `pos.product_prices (product_id, talla,
precio)`. Normalizada y consultable, pero traería policies, grants, privilegios
por defecto y `security_invoker` —toda la superficie que costó dos migraciones
en H-35—, un dominio nuevo en el pull con su paginación, una colección local
nueva, y rompería el versionado atómico de H-06: el precio dejaría de cambiar
junto a su producto y dos terminales podrían dejarlos en versiones incoherentes.
Desproporcionado para un mapa de a lo sumo veinte entradas por artículo. Se
justificaría si el negocio necesitara historial de precios o listas por
sucursal, que no es el caso.

**Segunda decisión, sobre la forma guardada:** se guarda el mapa canónico por
talla y la agrupación «grupo de tallas → precio» vive sólo en la interfaz.
Guardar `[{tallas, precio}]` preservaría la agrupación literal del
administrador, pero admite que una talla aparezca en dos filas con precios
distintos y obligaría a una regla de desempate dentro de la autoridad — la
ambigüedad que `ADR-003` existe para evitar. El costo es que dos filas con el
mismo precio se muestran fusionadas al reabrir el formulario.

## Cómo se revierte y qué se rompería

La columna es aditiva: retirarla devolvería a todos los artículos al precio
único y las ventas ya emitidas conservarían intacto su precio congelado por
renglón (`ADR-002`). Revertir la autoridad, en cambio, reintroduce la
duplicación de `AP-01` y el cálculo erróneo del descuento.

## Referencias

`docs/fixes/precio-por-talla.md` ·
`supabase/migrations/20260728005100_pos_h36_variant_price.sql` · `ADR-003` ·
`AP-01`
