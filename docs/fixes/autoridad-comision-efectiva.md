# Autoridad de comisión efectiva del vendedor

**Riesgo:** H-31
**Estado:** PARCIALMENTE RESUELTO
**Fecha:** 26/07/2026
**Commit:** eacfff7

## Problema y reproducción

`commission.basePct`, `seller_role` y `seller.comisionPct` existían como datos
separados. El cálculo vigente consultaba directamente `comisionPct`, mientras
el catálogo de niveles sólo infería una etiqueta visual mediante
`meta.minPct`. No había asignación persistida de nivel ni una autoridad común
que distinguiera 0% de ausencia.

Antes del cambio, `node test-effective-commission.mjs` produjo 6/22. H-29,
H-30 y la inmovilidad de los módulos financieros ya cumplían; fallaron las
fuentes personalizada, nivel, general y heredada, sus casos 0%, y la
persistencia local/remota.

## Causa raíz

Cada fuente tenía un modelo independiente y ninguna función definía su
precedencia. `comisionPct` era no-null y las altas lo inicializaban en 0, por
lo que tampoco era posible decidir si un valor existente era intencional o
producto del defecto previo.

## Diseño

`DATA.resolveSellerCommission(seller)` devuelve:

- `effectivePct`;
- `source`: `personalizada`, `nivel`, `general` o `heredada`;
- `level`: código, etiqueta y actividad cuando se utilizó un nivel;
- `policyVersion`.

Para política versión 1, la precedencia es personalizada → nivel → general.
Sólo `null`/`undefined` representan ausencia; 0% es válido en las tres fuentes.
El nivel usa `sellerLevelCode` y `seller_role.meta.commissionPct`. Una
asignación existente se busca en `CONFIG.all()` para conservar un nivel
posteriormente inactivado; impedir asignaciones nuevas corresponde a una
interfaz posterior.

La compatibilidad no interpreta ni modifica porcentajes actuales:

- versión ausente o 0 conserva `comisionPct` como `heredada`, incluido 0%;
- altas nuevas usan versión 1, override `null` y nivel `null`;
- no se infiere un nivel desde `comisionPct`;
- la migración 033 asigna versión 0 a filas existentes y default 1 a futuras;
- la migración es reejecutable y documenta la condición de reversión.

## Solución

- `balam/data.jsx`: autoridad central y contrato de alta local nueva.
- `balam/store.jsx`: mapeo bidireccional nullable de override, nivel y versión.
- `supabase/functions/admin-users/index.ts`: alta Auth/perfil bajo versión 1.
- `supabase/migrations/20260726003300_pos_h31_effective_commission.sql`:
  columnas, marcador legado, defaults y restricciones.
- `test-effective-commission.mjs`: reproducción y 22 contratos de precedencia,
  0%, compatibilidad, persistencia y alcance.
- `index.html` y `POS Balam (offline).html`: artefactos regenerados desde
  `balam/`.
- `test-store-queue.mjs`: esperas deterministas del arnés. No es parte de la
  autoridad de comisión; corrige una fragilidad preexistente que impedía
  validar H-31 de forma repetible (ver más abajo).

No se modificó la interfaz de niveles ni el motor financiero. En particular,
ventas, apartados, devoluciones, liquidaciones, cierres, metas y bonos siguen
usando su comportamiento histórico.

## Pruebas

- Antes: `node test-effective-commission.mjs`: 6/22.
- Después: `node test-effective-commission.mjs`: 22/22.
- `node test-eligible-sellers.mjs`: 10/10.
- `node test-seller-avatars.mjs`: 13/13.
- `node test-module-contracts.mjs`: 36/36.
- `node test-migrations.mjs`: 24/24.
- `node test-store-queue.mjs`: 97/97 aislada (5 repeticiones), 97/97 al final
  de la cadena de 14 suites y 97/97 con la CPU saturada (3 repeticiones).
- `node build-offline.mjs`: correcto, 67 recursos.
- `node test-build-reproducibility.mjs`: 8/8.
- `node test-smoke.mjs bundle`: 17/17.

### Fragilidad del arnés de cola (preexistente, ajena a H-31)

Una ejecución encadenada produjo 92/97 en la cola, con fallos en snapshots de
venta y pagos que no pertenecen al diff. El diagnóstico descartó contaminación
entre pruebas, estado global sin restablecer, temporizadores sin limpiar y
orden de ejecución: cada bloque construye su propio `freshEnv()` y su propia
instancia de STORE.

La causa real es del arnés. `test-store-queue.mjs` esperaba con `sleep(ms)` de
reloj, pero los stubs de red e IndexedDB resuelven con `setTimeout(..., 0)`: lo
que debe avanzar son turnos del bucle de eventos, no milisegundos. Con la CPU
saturada el proceso recibe poco tiempo de ejecución, la espera de reloj vence
con muy pocos turnos consumidos y la aserción lee un drenado a medio terminar.

La reproducción es a demanda: con doce procesos quemando CPU en paralelo, la
cola cayó a 84/97, 81/97 y 91/97. El mismo experimento sobre `HEAD` (df1f074,
sin H-31) produjo 11 y 6 fallos, por lo que no es una regresión de H-31.

Corrección aplicada, limitada a `test-store-queue.mjs`: `sleep(ms)` consume
ahora un número fijo de turnos del bucle de eventos y conserva un piso de
tiempo real, necesario porque `pushConfig` mantiene su debounce de 600 ms. Bajo
la misma carga que antes rompía la suite, la cola aprueba 97/97.

## Riesgo residual y pendientes

La migración está versionada pero no fue desplegada por instrucción expresa;
la Edge Function también queda pendiente de despliegue. Hasta que ambos se
publiquen conjuntamente, los campos nuevos no existen en producción.

La autoridad todavía no sustituye `comisionPct` en cálculos financieros ni en
la presentación, porque ventas históricas, snapshots, devoluciones,
liquidaciones, cierres, metas, bonos y cambios amplios de interfaz quedaron
expresamente fuera de H-31. La asignación/edición de nivel y comisión
personalizada también queda para un hallazgo posterior.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-31--autoridad-de-comisión-efectiva-del-vendedor`.
- Arquitectura: `docs/02-architecture.md`, sección `Autoridad de comisión efectiva`.
- Elegibilidad: `docs/fixes/eligible-active-sellers.md`.
