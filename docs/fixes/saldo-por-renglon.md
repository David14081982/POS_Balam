# Autoridad única del saldo por renglón

**Riesgo:** H-35
**Estado:** RESUELTO
**Fecha:** 28/07/2026
**Commit:** `c10920e`

Fase 2 del módulo de Cambios de productos. Establece **una sola** autoridad de
«¿cuántas unidades de este renglón siguen disponibles?» para que ninguna unidad
pueda consumirse dos veces entre devoluciones y cambios, ni siquiera con
operaciones parciales, varias terminales y sincronización diferida.

Esta fase **no** implementa cambios: prepara el terreno y deja el comportamiento
actual intacto.

---

## 1. Contrato ACTUAL de `pos.commit_return`

Definición autoritativa única: `20260725002100_pos_transactional_return.sql`.
`commit_legacy_return` (migración `20260725002300`) no valida cantidades por su
cuenta: delega en esta misma función con `p_legacy => true`.

### Entradas

```
pos.commit_return(
  p_commit_id      text,
  p_return         jsonb,   -- cabecera: id, folio, cliente, vendedores, metodo, total, notas, fecha
  p_items          jsonb,   -- [{return_id, product_id, sku, nombre, talla, qty, motivo, precio}]
  p_moves          jsonb,   -- [{return_id, fecha, tipo, producto, sku, cant, ref}]
  p_stock_lines    jsonb,   -- [{product_id, talla, qty}]
  p_client_effect  jsonb default null,
  p_seller_effects jsonb default '[]'::jsonb,
  p_legacy         boolean default false
) returns jsonb
language plpgsql · security definer · set search_path = pos, pg_temp
```

### Validaciones, en orden

1. **Permiso:** `pos.is_active_admin() or pos.is_active_seller()`; si no,
   excepción `42501` («Cuenta sin permiso para registrar devoluciones»).
2. **Forma:** `commit_id`, `id` y `folio` no vacíos; `p_items` arreglo **no
   vacío**; `p_moves`, `p_stock_lines` y `p_seller_effects` arreglos. Si falla →
   `invalid_request`.
3. **Renglones:** todo renglón debe traer `return_id` igual al de la cabecera,
   `sku` y `talla` no vacíos y `qty > 0`. Si falla → `invalid_items`.

### Bloqueos

- `pg_advisory_xact_lock(hashtext(p_commit_id))` **antes** de consultar
  idempotencia: serializa reintentos de la misma operación.
- `perform 1 from pos.sales where folio = v_folio for update`: serializa **todas
  las devoluciones de la misma venta**. Si no existe → `sale_not_found`.
- `select … from pos.products … order by p.id for update` sobre los productos de
  `p_stock_lines`, en orden estable para evitar deadlocks.

### Idempotencia

`pos.return_commits (commit_id pk, return_id, folio, payload_hash, actor_email)`.
El hash es `md5` de un `jsonb_build_object` con return, items, moves,
stock_lines, client_effect, seller_effects y legacy.

- Mismo `commit_id` + mismo hash + mismo return_id + mismo folio → devuelve
  `{ok:true, idempotent:true, …}` **sin repetir efectos**.
- Mismo `commit_id` con contenido distinto → `commit_mismatch`.
- `returns.id` ya existente y no legacy → `return_id_conflict`.

### Cálculo ACTUAL de cantidades disponibles

Es el punto exacto que esta fase modifica:

```sql
requested = Σ qty de p_items            agrupado por (sku, talla)
sold      = Σ qty de pos.sale_items     donde folio = v_folio,           agrupado por (sku, talla)
returned  = Σ qty de pos.return_items   unido a pos.returns
                                        donde r.folio = v_folio
                                          AND r.id <> v_return_id        agrupado por (sku, talla)

falta si  requested.qty > greatest(sold.qty - returned.qty, 0)
→ invalid_return_quantity, con items[] {sku, talla, requested, available}
```

La exclusión `r.id <> v_return_id` evita que una devolución reescrita se cuente
a sí misma. **La autoridad es `sale_items − return_items`: los cambios no
existen en esta cuenta.**

Además, tope monetario independiente:
`p_return.total + Σ(returns.total del folio, excluyendo el actual) > sales.total + 0.01`
→ `refund_exceeds_sale`.

### Inventario

Sólo cuando `p_legacy = false`:

- `sum(p_stock_lines.qty)` debe ser **exactamente igual** a `sum(p_items.qty)` y
  `p_stock_lines` no puede venir vacío → si no, `invalid_stock_lines`.
- Cada `(product_id, talla)` debe existir, no estar borrado y tener esa talla en
  el arreglo `stock` → si no, `invalid_stock_target` con items[].
- Reingreso: `jsonb_set(stock, [idx,'stock'], anterior + qty)`, más
  `sync_base_version = sync_version` y `sync_device_id = 'return:'||commit_id`.

### Escritura de devoluciones y movimientos

- `insert … on conflict (id) do update` sobre `pos.returns` (cabecera completa).
- `delete from pos.return_items where return_id = …` + `insert` de los renglones.
- Movimientos: si legacy, `delete from pos.movements where ref = folio and tipo
  = 'Devolución'`; si no, `delete … where return_id = v_return_id`. Después
  inserta los movimientos con `return_id` (nulo en legacy) y `ref = folio`.

### Clientes y comisiones

Sólo cuando `p_legacy = false`:

- **Cliente:** `update pos.clients set total = …` con la comparación
  version-aware (`sync_version = base+1 and total = after_total` → no reaplica;
  si no, `greatest(0, total + delta)`). Si no encuentra fila → excepción `P0001`
  «Cliente de la devolución no existe».
- **Vendedores:** bucle sobre `p_seller_effects` con la misma lógica
  version-aware sobre `ventas_mes` y `comision_acum`, exigiendo `active = true`
  y `deleted_at is null`. Si no encuentra fila → `P0001` «Vendedor de la
  devolución no existe o está inactivo».

### Estado de la venta

```sql
sold     = Σ pos.sale_items   por (sku,talla) del folio
returned = Σ pos.return_items por (sku,talla) del folio  -- TODAS, incluida la actual
estado = case when exists (sold s left join returned r
                           where coalesce(r.qty,0) < s.qty)
              then 'Devolución parcial' else 'Devuelto' end
```

Se calcula **después** de insertar los renglones, por eso incluye la devolución
actual. Se escribe con `update pos.sales set estado = …`.

### Errores posibles

`42501` (excepción) · `invalid_request` · `invalid_items` · `commit_mismatch` ·
`sale_not_found` · `return_id_conflict` · `invalid_return_quantity` (+`items`) ·
`refund_exceeds_sale` · `invalid_stock_lines` · `invalid_stock_target`
(+`items`) · `P0001` cliente · `P0001` vendedor.

### Respuesta

```json
{ "ok": true, "idempotent": false|true, "sale_state": "Devuelto|Devolución parcial",
  "products": [...], "clients": [...], "sellers": [...] }
```

o `{ "ok": false, "error": "<código>", "items": [...] }` en los rechazos.

---

## 2. Contrato NUEVO

### Cómo se calcula el saldo por renglón

Se introduce una **costura explícita** entre «qué documentos consumen unidades»
y «cómo se calcula el saldo», de modo que añadir cambios en la fase 4 no toque
ni a `commit_return` ni a sus consumidores.

**Vista `pos.line_consumption`** — un renglón por consumo, con su origen:

```sql
create or replace view pos.line_consumption as
  select r.folio as sale_folio, ri.sku, ri.talla, ri.qty,
         'devolucion'::text as origen, ri.return_id as documento
    from pos.return_items ri
    join pos.returns r on r.id = ri.return_id;
```

Hoy tiene **una sola rama**. La fase 4 añadirá un `union all` con los renglones
`lado = 'devuelto'` de los cambios: un único `create or replace view`, sin tocar
la función ni sus llamadores.

**Función `pos.sale_line_balance(p_folio text, p_exclude_document text default null)`**
`returns table(sku text, talla text, vendida integer, consumida integer, disponible integer)`,
`stable`, `security definer`, con la misma guarda de permiso que el resto:

```
vendida    = Σ pos.sale_items del folio, por (sku, talla)
consumida  = Σ pos.line_consumption del folio, por (sku, talla),
             excluyendo `documento = p_exclude_document` cuando se indica
disponible = greatest(vendida − consumida, 0)
```

`p_exclude_document` reproduce exactamente la exclusión `r.id <> v_return_id`
que hoy hace la función en línea.

### Autoridad local

`DATA.saleLineBalance(folio, { excludeDocument })` devuelve
`[{ sku, talla, vendida, devuelta, cambiada, consumida, disponible }]`.

Sus fuentes salen de `consumptionSources()`, la costura local espejo de la
vista: hoy declara únicamente `DATA.returns`; cuando exista `DATA.exchanges`
—colección que la fase 4 creará— añade sus renglones `lado = 'devuelto'` sin
que ningún consumidor cambie.

`DATA.returnedQty()` se conserva con su significado literal (piezas
**devueltas**) porque la pantalla de Devoluciones y las pruebas lo usan, pero
deja de ser la autoridad del disponible: pasa a derivarse del balance.
`recordReturn()` valida contra `disponible`, no contra `vendida − devuelta`.

### Cómo se evita el doble consumo

Tres condiciones, todas ya presentes o añadidas aquí:

1. **Serialización:** todo documento que consuma unidades toma
   `for update` sobre la venta antes de validar. Dos terminales no pueden
   evaluar el mismo saldo a la vez.
2. **Autoridad única:** la validación no consulta `return_items` sino
   `line_consumption`. Un documento nuevo que consuma unidades es invisible para
   la validación **sólo si olvida registrarse en la vista**, y eso queda como
   una única decisión localizada en vez de repetirse en cada función.
3. **Registro obligatorio:** las unidades consumidas se escriben dentro de la
   **misma transacción** que las valida, así que un commit parcial no puede
   dejar unidades consumidas sin registrar ni registradas sin consumir.

### Cómo se conserva el comportamiento actual

Mientras no existan cambios, `pos.line_consumption` es literalmente la misma
consulta que hoy está embebida en `commit_return`, y `DATA.exchanges` no existe,
por lo que el término `cambiada` vale 0 en todos los renglones. La demostración
formal está en la sección siguiente.

---

## 3. Demostración de retrocompatibilidad (tablas de cambios vacías)

### El saldo disponible es idéntico

Hoy:

```sql
returned = Σ ri.qty
             from pos.return_items ri join pos.returns r on r.id = ri.return_id
            where r.folio = v_folio and r.id <> v_return_id
         group by ri.sku, ri.talla
available = greatest(sold − returned, 0)
```

Con la vista de una sola rama:

```sql
consumida = Σ lc.qty
              from pos.line_consumption lc          -- = return_items ⨝ returns
             where lc.sale_folio = v_folio
               and lc.documento <> p_exclude_document   -- = r.id <> v_return_id
          group by lc.sku, lc.talla
disponible = greatest(vendida − consumida, 0)
```

Las dos expresiones son **la misma consulta** tras sustituir la definición de la
vista: mismo `join`, mismo filtro por folio, misma exclusión por documento,
misma agrupación y el mismo `greatest`. No es una equivalencia aproximada sino
una sustitución textual.

### Acepta y rechaza exactamente los mismos casos

`invalid_return_quantity` se dispara cuando
`requested > coalesce(disponible, 0)`. Como `disponible` es idéntico, el
conjunto de solicitudes rechazadas es idéntico, y el `items[]` del error
conserva las mismas claves (`sku`, `talla`, `requested`, `available`).

Un `(sku, talla)` que no aparece en `sale_items` sigue teniendo disponible 0 —en
la versión actual porque el `left join` con `sold` produce `null` y `coalesce`
lo vuelve 0; en la nueva porque el renglón no existe en el balance y el
`coalesce` del llamador lo vuelve 0—, así que se rechaza igual.

### No cambian importes, inventario, comisiones ni estados

- **Importes:** la función no toca `p_return.total` ni el tope
  `refund_exceeds_sale`, que sigue sumando `returns.total`. Un cambio no es un
  reembolso y por eso **no debe** entrar en ese tope; dejarlo intacto es parte
  del contrato. Ninguna línea de precio, IVA, pago o H-32 se modifica.
- **Inventario:** las reglas `invalid_stock_lines` e `invalid_stock_target` y el
  `jsonb_set` de reingreso quedan **sin tocar**. La igualdad
  `sum(stock_lines) = sum(items)` sigue vigente porque una devolución reingresa
  todas sus piezas; la condición de vendible/no vendible pertenece a la fase 4.
- **Comisiones y clientes:** los bloques version-aware no se modifican en
  absoluto.
- **Estado:** `exists(sold left join returned where coalesce(returned,0) < sold)`
  equivale a `exists(select 1 from sale_line_balance(folio) where disponible > 0)`,
  porque `disponible = greatest(vendida − consumida, 0)` y `vendida > 0` para
  toda fila del balance. Los dos casos límite coinciden: una venta **sin
  renglones** produce conjunto vacío y por tanto `'Devuelto'` en ambas
  versiones; un consumo mayor que lo vendido —imposible por validación— se
  clampa a 0 en ambas.

### No cambia la respuesta del RPC

Ni la firma, ni las claves, ni los códigos de error, ni el orden de las
validaciones cambian. La única diferencia observable sería un
`invalid_return_quantity` provocado por un cambio… que hoy no puede existir
porque no hay cambios registrados.

---

## 4. Pruebas definidas ANTES de modificar la función

Arnés nuevo `test-line-balance.mjs` sobre el módulo real, más la migración de
verificación remota y la regresión existente.

| # | Caso | Dónde se prueba |
|---|---|---|
| 1 | Devolución total | local + `test-returns.mjs` |
| 2 | Devolución parcial | local |
| 3 | Varias devoluciones parciales sucesivas | local |
| 4 | Sobredevolución rechazada | local + verificación SQL |
| 5 | Concurrencia entre terminales sobre la misma unidad | verificación SQL |
| 6 | Reintento idempotente | verificación SQL + `test-store-queue.mjs` |
| 7 | Rollback completo ante fallo | verificación SQL |
| 8 | Venta sin renglones | local + verificación SQL |
| 9 | Venta histórica (sin campos nuevos) | local |
| 10 | Compatibilidad con devoluciones ya existentes | local + verificación SQL |
| 11 | Tablas de cambios vacías ⇒ saldo idéntico | local + verificación SQL |
| 12 | Coexistencia futura devolución + cambio sobre la misma línea | local, ejercitando la costura `consumptionSources()` |

El caso 12 se prueba hoy **en la autoridad local**, donde la costura puede
alimentarse con una colección de cambios simulada. En SQL, la rama de cambios de
la vista no existe todavía; su prueba pertenece a la fase 4 y así queda
registrado, sin declarar cubierto lo que no lo está.

---

## 5. Causa raíz

La pregunta «¿cuántas unidades de este renglón siguen disponibles?» estaba
**respondida tres veces con la misma fórmula copiada**: en la validación de
`commit_return`, en su cálculo de estado y en `DATA.returnedQty()` del cliente.
Las tres consultaban directamente `return_items`, es decir, la tabla de **una**
clase de documento.

Mientras las devoluciones fueran el único documento que consume unidades, esa
duplicación era invisible. En cuanto exista un segundo documento —un cambio—,
cada fórmula tendría que enumerar todas las clases de documento, y bastaría con
que una sola olvidara la nueva para que la misma pieza se devolviera y se
cambiara: doble reingreso de stock y doble efecto financiero, sin que ninguna
restricción de la base lo impidiera.

El defecto no es una consulta equivocada: es la **ausencia de una autoridad
única** y de un punto de extensión.

## 6. Solución

| Archivo | Responsabilidad |
|---|---|
| `balam/data.jsx` | `consumptionSources()` (costura) y `saleLineBalance()` (autoridad). `recordReturn()` valida contra `disponible`. `returnedQty()` conserva su significado literal. |
| `balam/returns.jsx` | Lo devolvible por renglón sale del balance, no de una resta local. |
| `supabase/migrations/20260728004700_pos_h35_line_balance.sql` | Vista `pos.line_consumption`, función `pos.sale_line_balance()` y `commit_return` consumiendo la autoridad. |
| `supabase/migrations/20260728004900_pos_h35_line_balance_grants.sql` | Corrección de permisos de la vista: revoke nominal y `security_invoker`. |
| `supabase/migrations/20260728005000_pos_h35_line_balance_verification.sql` | Verificación autocontenida y endurecida. |
| `test-line-balance.mjs` | Arnés nuevo, 34 casos. |

Decisiones registradas:

- **`allReturned` conserva la comparación histórica por renglón crudo**,
  incluido su comportamiento ante renglones repetidos del mismo `(sku, talla)`.
  Sólo se sustituyó la fuente —lo consumido en vez de lo devuelto—, que sin
  cambios registrados es la misma cantidad. Corregir esa comparación habría
  alterado importes, algo expresamente fuera del alcance de esta fase.
- **`pos.sale_line_balance()` es interna.** Durante la implementación se le
  concedió `execute` a `authenticated`; siendo `security definer` y sin guarda
  propia, eso habría permitido a cualquier cuenta autenticada —incluida una sin
  perfil en `pos.sellers`— leer las cantidades de cualquier folio, debilitando
  la contención de H-07/H-08. Se corrigió antes de aplicar nada: la función y la
  vista sólo se conceden a `service_role`, sus llamadores son `commit_return` y
  las migraciones, y el cliente usa su autoridad local equivalente. La
  verificación aborta si alguna de las dos vuelve a quedar expuesta.
- **La exclusión usa `is distinct from`** en vez de `<>`. Con
  `return_items.return_id NOT NULL` ambas son equivalentes; la elegida no
  depende de esa restricción para comportarse bien.
- **La vista necesitó una corrección de permisos aparte (`004900`).** Al aplicar
  la verificación sobre la base real, su propia guarda abortó la migración: la
  vista había quedado legible por `authenticated`. El esquema `pos` tiene
  privilegios por defecto (`defaclobjtype 'r'` → `authenticated=arwdDxtm`), de
  modo que toda relación nueva se concede automáticamente a ese rol; el
  `revoke ... from public` de `004700` retira el permiso de `PUBLIC` pero no el
  concedido nominalmente. Para funciones no hay privilegio por defecto en `pos`,
  y por eso el mismo `revoke` sí bastó en `sale_line_balance()`: **tablas y
  funciones no se comportan igual ante `alter default privileges`**, y trasladar
  el razonamiento de una a otra fue el error. La corrección aplica dos medidas:
  el revoke nominal a `authenticated` y `anon`, que cierra la exposición, y
  `security_invoker = true`, que es la defensa de fondo —sin ella la vista se
  ejecuta con los permisos de su dueño y evita el RLS de `sale_items` y
  `return_items`, así que un privilegio por defecto futuro volvería a abrir el
  agujero—. La verificación exige ahora **ambas** condiciones y falla si
  cualquiera decae.
- **La verificación se renumeró a `005000`.** Las migraciones se aplican por
  orden de versión, y `004800` se habría ejecutado antes que la corrección
  `004900`. La verificación debe correr siempre al final; `004800` nunca llegó a
  registrarse en remoto, así que renumerarla no reescribe historial.

## 7. Pruebas ejecutadas

Reproducción previa: `node test-line-balance.mjs` → **7 pasaron, 27 fallaron**.
Después: **34 pasaron, 0 fallaron**, cubriendo forma de la autoridad, parciales
sucesivas, devolución total, sobredevolución en una operación, renglones
independientes, exclusión de documento, ventas sin renglones, ventas
históricas, devoluciones preexistentes, costura de cambios vacía y alimentada,
coexistencia devolución + cambio sobre la misma línea, impedimento del doble
consumo y contratos de interfaz y SQL.

Regresión: devoluciones 17/17 · plazo H-34 38/38 · coherencia de venta 17/17 ·
cola 115/115 · migraciones 29/29 · trazabilidad H-32 65/65 · build reproducible
8/8 · contratos 36/36 · folio diario 60/60 · folios multi-terminal 12/12 ·
comisiones 10/10 · comisión efectiva 22/22 · liquidaciones 10/10 · descuentos
43/43 · elegibilidad 10/10 · smoke bundle 17/17 · navegación 13/13 · roles 10/10
· concurrencia 9/9 · propagación de reset 21/21 · avatares 13/13 · SDK 4/4.
Build offline correcto con 67 assets.

Diff de `commit_return` contra `20260725002100`: **dos bloques**, el de
validación de cantidades y el de estado. Firma, `revoke`/`grant`, orden de
validaciones, códigos de error, reglas de inventario, tope monetario y efectos
de cliente y comisión, sin cambios.

Durante la corrida, el disco de la terminal se llenó (0 B libres de 238 GB) y
abortaron un build y dos arneses. Los artefactos **no se corrompieron**: el
build falló antes de escribir y quedaron idénticos a los del commit anterior.
Tras liberar espacio, build y arneses se repitieron completos y en verde.

## 8. Riesgo residual y pendientes

- **Las tres migraciones están aplicadas y verificadas** en `telohdbvbvsfmwyriflz`
  el 28/07/2026: `004700`, `004900` y `005000`, en ese orden.
- La rama de cambios de `pos.line_consumption` **no existe todavía**: la
  coexistencia devolución + cambio está probada en la autoridad local, donde la
  costura puede alimentarse, pero **no en SQL**. Esa prueba pertenece a la fase
  que cree las tablas de cambios y así queda registrado.
- La igualdad `sum(stock_lines) = sum(items)` de `commit_return` sigue vigente y
  es correcta para devoluciones. La condición vendible / no vendible obligará a
  revisarla cuando el módulo de Cambios la introduzca.
- La pantalla de Devoluciones muestra hoy «devuelto» para unidades consumidas;
  cuando existan cambios convendrá distinguir el motivo del consumo. Es
  presentación, no autoridad.
