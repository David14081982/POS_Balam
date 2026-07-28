# Plazo de posventa configurable y congelado en la venta

**Riesgo:** H-34
**Estado:** RESUELTO
**Fecha:** 28/07/2026
**Commit:** `59a16c9`

Fase 1 del módulo de Cambios de productos. Entrega valor por sí sola —el plazo
de devoluciones— y establece el contrato que las fases siguientes necesitan.

## Problema y reproducción

El producto no tenía ninguna noción de plazo: cualquier venta admitía devolución
para siempre. El requerimiento pide un límite configurable y opcional, pero la
única forma de implementarlo sin romper el histórico es que **cada venta
conserve el plazo vigente al momento de crearse**.

`node test-return-deadline.mjs` sobre el código anterior: **7 pasaron, 31
fallaron**. Los 7 que pasaban son precisamente los casos «sin límite», porque el
comportamiento histórico equivale a no tener plazo. Fallaban la autoridad
`DATA.returnDeadline()`, el congelamiento, las etiquetas, el bloqueo de una
devolución vencida, el arranque del plazo en apartados, el transporte a la nube,
la migración y los controles de la interfaz.

## Causa raíz

No es un defecto sino un contrato ausente. La única política de devoluciones
persistida era `returns.reverseCommission`, que se lee **vigente** en cada
operación. Implementar el plazo con ese mismo patrón —derivarlo de la
configuración al momento de devolver— habría hecho que activar el límite
venciera retroactivamente ventas ya emitidas y que cambiar los días alterara el
pasado. La evidencia debía vivir en el documento, como ya ocurre con el folio
(H-33), el desglose financiero (H-03) y las promociones del renglón (H-32).

## Diseño

Snapshot en la venta, con tres estados representables:

| `returnLimitDays` | `returnExpiresAt` | Significado |
|---|---|---|
| `null` | `null` | **Sin límite**: la venta no vence nunca. Es el estado de todas las ventas anteriores a H-34. |
| `> 0` | `null` | Apartado sin liquidar: el plazo está congelado pero **aún no arranca**. |
| `> 0` | fecha | Vence al terminar ese día del negocio. |

Decisiones:

- **El plazo cuenta desde la misma fecha que se guarda en la venta**, no desde
  una segunda lectura del reloj (misma lección que H-33 con el folio): una venta
  cerca de la medianoche no queda partida entre dos días.
- **Los apartados arrancan al liquidarse.** La mercancía se entrega al liquidar;
  medir desde la reserva dejaría vencido un apartado pagado a 30 días. Los días
  se congelan al crear (política vigente entonces) y la fecha se fija en
  `finalizarApartado()`.
- **El plazo no filtra la pantalla, la explica.** Una venta vencida sigue
  apareciendo en Devoluciones con su etiqueta; lo que se bloquea es confirmar.
  Así el mostrador entiende por qué no puede proceder en vez de no encontrar la
  venta. El filtro segmentado permite aislar Vigentes / Vencidos / Sin límite.
- **`isReturnable()` no cambia.** Sigue siendo la autoridad de estado de venta;
  el plazo es una compuerta ortogonal. Mezclarlas habría hecho desaparecer las
  ventas vencidas del filtro «Vencidos».
- **Aritmética de calendario sobre la tripleta año/mes/día**, sin conversión de
  husos: el horario de verano no puede correr un vencimiento un día.
- **Una fecha dañada no bloquea.** `returnDeadline()` devuelve «sin límite» ante
  un valor irreconocible: nunca inventa un vencimiento contra el mostrador.
- **`commit_sale` se redefine de forma estrictamente aditiva.** El texto de la
  función se generó a partir de la definición vigente (H-32) aplicando sólo tres
  ediciones, y el diff se revisó para probar que no hay otra diferencia. Un
  primer intento de retipearla a mano introdujo nueve desviaciones semánticas
  —entre ellas `is distinct from`, `greatest(0, …)` en el total del cliente y la
  pérdida de `v_products` de la reserva—; ese método se descartó.
- **Un reintento sin plazo no borra el plazo.** La rama `on conflict` usa
  `coalesce(excluded.…, pos.sales.…)`: una terminal antigua que reenvíe una
  operación no puede eliminar evidencia.

## Solución

| Archivo | Cambio |
|---|---|
| `balam/config.jsx` | Ajustes `returns.limitEnabled` (false) y `returns.limitDays` (15). `backfillState()` los propaga a estados locales y remotos antiguos. |
| `balam/data.jsx` | `returnDeadline()` como autoridad única; helpers de calendario; congelamiento en `recordSale()`; arranque del plazo en `finalizarApartado()`; bloqueo en `recordReturn()`. |
| `balam/store.jsx` | `pushSale()` envía `return_limit_days` / `return_expires_at` sólo si existen; `MAP.sales.fromRow` los reconstruye. |
| `balam/settings.jsx` | Tarjeta «Plazo para devoluciones» en Configuración → Devoluciones. |
| `balam/returns.jsx` | Filtro segmentado, etiqueta de vencimiento por venta, plazo en la tarjeta de contexto y bloqueo explicado del botón de confirmar. |
| `supabase/migrations/20260728004500_pos_h34_return_deadline.sql` | Dos columnas, dos restricciones, índice parcial y `commit_sale` aditiva. |
| `supabase/migrations/20260728004600_pos_h34_return_deadline_verification.sql` | Verificación autocontenida con limpieza total. |
| `test-return-deadline.mjs` | Arnés nuevo, 38 casos. |

## Pruebas

Reproducción previa: `node test-return-deadline.mjs` → 7 pasaron, 31 fallaron.
Después del cambio: **38 pasaron, 0 fallaron**, cubriendo sin límite,
congelamiento, inmutabilidad ante cambios de configuración, etiquetas («Vence en
12 días», «Vence hoy», «Vencido hace 3 días», «Sin límite»), cruce de fin de
año, bloqueo fuera de plazo sin efectos colaterales, compatibilidad con ventas
históricas, apartados, normalización de valores inválidos y contratos de
`STORE`, migración e interfaz.

Regresión ejecutada:

| Arnés | Resultado |
|---|---|
| `test-migrations.mjs` | 29/29 |
| `test-sale-coherence.mjs` | 17/17 |
| `test-returns.mjs` | 17/17 |
| `test-folio-diario.mjs` | 60/60 |
| `test-folio-concurrency.mjs` | 12/12 |
| `test-discount-trace.mjs` | 65/65 |
| `test-store-queue.mjs` | 115/115 |
| `test-module-contracts.mjs` | 36/36 |
| `test-effective-commission.mjs` | 22/22 |
| `test-commission.mjs` | 10/10 |
| `test-liquidations.mjs` | 10/10 |
| `test-discounts.mjs` | 43/43 |
| `test-build-reproducibility.mjs` | 8/8 |
| `test-smoke.mjs bundle` | 17/17 |
| `test-ui-navigation.mjs` | 13/13 |
| `test-role-access.mjs` | 10/10 |
| `test-concurrency.mjs` | 9/9 |
| `test-reset-propaga.mjs` | 21/21 |
| `test-eligible-sellers.mjs` | 10/10 |
| `test-seller-avatars.mjs` | 13/13 |

`node build-offline.mjs` regeneró los artefactos correctamente (67 assets).

Verificación del método de la migración: se extrajo `commit_sale` de
`20260727004000_pos_h32_discount_trace.sql` y de la migración nueva y se
compararon. El diff contiene **exactamente** los tres bloques aditivos previstos
(12 líneas añadidas, 2 modificadas —sólo comas de continuación—) y ninguna otra
diferencia. Firma y `revoke`/`grant` idénticos.

## Despliegue

Ambas migraciones se aplicaron al proyecto `Balam` (`telohdbvbvsfmwyriflz`) el
28/07/2026, **antes** de publicar el cliente. `db push --dry-run` previo listó
exactamente las dos migraciones esperadas.

La migración de verificación emitió sus cinco avisos de éxito: las 6 ventas
existentes quedaron sin límite; un payload sin las claves nuevas produjo una
venta sin límite; la venta con plazo conservó 15 días con vencimiento
2026-08-12; un reintento sin plazo conservó la evidencia; y la base rechazó un
vencimiento sin política que lo explique.

Comprobación posterior directa contra la base:

| Comprobación | Resultado |
|---|---|
| `return_limit_days` / `return_expires_at` | `integer` / `date`, nullable, **sin default** |
| Restricciones `sales_return_limit_days_chk` y `sales_return_deadline_pair_chk` | 2 de 2 presentes |
| Índice parcial `sales_return_expires_at_idx` | presente |
| Ventas reales | 6, de las cuales **0 con plazo** |
| Filas temporales de la verificación (venta, vendedor, commits) | 0 · limpieza total |
| `commit_sale` desplegada | transporta el plazo **y** conserva `is distinct from p_operation_id` y `coalesce(v_stock -> 'products', …)` |

La última fila es la evidencia en producción de que ninguna de las nueve
desviaciones del intento manual llegó a la base.

Artefacto publicado (GitHub Pages, commit `59a16c9`): el archivo servido en
`https://david14081982.github.io/POS_Balam/` es idéntico byte por byte al
`index.html` del commit, SHA-256
`7b6d102b6661f65478dbbec8b8ca0dedea49cc0e25955413b984d4f4140350f6`. Antes de la
reconstrucción, Pages seguía entregando el artefacto de H-33
(`f65e4fa8…`), por lo que la comparación distingue realmente ambas versiones.
Ese mismo archivo es el que aprobó `test-smoke.mjs bundle` 17/17 y
`test-ui-navigation.mjs` 13/13: los arneses ejecutan `index.html` y el bundle no
cambió entre la prueba y la publicación.

## Riesgo residual y pendientes

- Una venta vencida sólo puede devolverse desactivando el límite en
  Configuración. No existe una autorización administrativa puntual con
  justificación registrada; se evaluó y se dejó fuera por alcance.
- El plazo aplica hoy únicamente a devoluciones. Su uso por el módulo de Cambios
  —y la política «conservar / reiniciar plazo después de un cambio»— pertenece a
  fases posteriores.
- Ninguna venta existente recibió plazo: todas quedan «sin límite» y conservan
  su comportamiento.

## Referencias

- Riesgo: `docs/03-known-risks.md` → H-34.
- Diseño aprobado del módulo de Cambios (fases F1–F7).
- Contratos relacionados: H-03 (snapshot financiero), H-04 (commit
  transaccional), H-32 (evidencia del descuento), H-33 (folio comercial).
