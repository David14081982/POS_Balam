# Vendedores comerciales activos y elegibles

**Riesgo:** H-29
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** `ce200af`

## Problema y reproducción

La colección `DATA.sellers` representa al personal administrado desde
Configuración → Usuarios. Antes del cambio, la pantalla lateral Vendedores
consumía la colección completa para tarjetas, lista, avatares y totales. El
selector del POS sólo descartaba `active === false`.

La reproducción automatizada evaluó cinco perfiles:

| Perfil | Pantalla Vendedores antes | Selector POS antes |
|---|---:|---:|
| Administrador activo | Incluido | Incluido |
| Vendedor activo | Incluido | Incluido |
| Vendedor inactivo | Incluido | Excluido |
| Gerente activo | Incluido | Incluido |
| Perfil eliminado | Incluido | Incluido |

El contrato previo `test-eligible-sellers.mjs` produjo 6 verificaciones
correctas y 4 fallidas: no existía una autoridad compartida y ninguno de los
dos consumidores exigía simultáneamente actividad, rol y ausencia de
tombstone.

## Causa raíz

El catálogo de personal y el catálogo comercial comparten la misma colección,
pero no existía una regla de elegibilidad reutilizable. `balam/sellers.jsx`
usaba directamente `D.sellers` y `balam/pos.jsx` aplicaba un filtro local
incompleto. Por ello, cada consumidor interpretaba de forma distinta qué
persona podía actuar como vendedor.

## Diseño

`DATA.isEligibleSeller(seller)` es la única regla de elegibilidad comercial:

- `active === true`;
- `role === 'vendedor'`;
- `_deletedAt == null`;
- `deleted_at == null`.

La regla vive en `balam/data.jsx`, junto al modelo normalizado que comparte la
interfaz. La pantalla Vendedores y el selector del POS filtran con esa misma
función. Configuración → Usuarios conserva la colección completa para seguir
administrando al personal, incluidos otros roles e inactivos.

No se modifica la estructura persistida ni la sincronización, por lo que se
conservan datos históricos, el modelo local-first y la cola offline.

## Solución

- `balam/data.jsx`: define y publica `isEligibleSeller`.
- `balam/sellers.jsx`: usa la colección elegible para tarjetas, lista,
  avatares, totales y acciones visibles de la pantalla.
- `balam/pos.jsx`: limita el selector posterior al cobro a vendedores
  elegibles.
- `test-eligible-sellers.mjs`: conserva la reproducción y el contrato.
- `index.html` y `POS Balam (offline).html`: artefactos regenerados desde
  `balam/`.

Después del cambio:

| Perfil | Pantalla Vendedores | Selector POS |
|---|---:|---:|
| Administrador activo | Excluido | Excluido |
| Vendedor activo | Incluido | Incluido |
| Vendedor inactivo | Excluido | Excluido |
| Gerente activo | Excluido | Excluido |
| Perfil eliminado | Excluido | Excluido |

## Pruebas

- `node test-eligible-sellers.mjs`: 10/10.
- `node test-module-contracts.mjs`: 36/36.
- `node test-role-access.mjs`: 10/10.
- `node test-liquidations.mjs`: 10/10.
- `node build-offline.mjs`: 67 recursos, build correcto.
- `node test-build-reproducibility.mjs`: 8/8.
- `node test-ui-navigation.mjs`: 13/13.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-sale-coherence.mjs`: 17/17.
- `node test-returns.mjs`: 17/17.
- `node test-store-queue.mjs`: 97/97.

Las verificaciones estructurales confirman además que Configuración → Usuarios
continúa recorriendo `D.sellers` completo.

## Riesgo residual y pendientes

La regla protege los dos consumidores autorizados en este cambio. Las
funciones financieras internas conservan su comportamiento histórico y aún
pueden recibir directamente un identificador arbitrario si otro consumidor
las invoca fuera de estas pantallas.

**Problema descubierto durante la investigación:** el módulo Reportes tiene
filtros y agregaciones propios sobre vendedores. Quedó expresamente fuera del
alcance solicitado y no fue modificado.

No se modificaron fotografías, porcentajes o cálculo de comisiones, Auth, Edge
Functions, esquema SQL, apartados, devoluciones ni reportes.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-29--personal-no-elegible-participa-como-vendedor`.
- Arquitectura: `docs/02-architecture.md`, sección `DATA`.
- Acceso por rol: `docs/fixes/vendedor-solo-punto-venta.md`.
