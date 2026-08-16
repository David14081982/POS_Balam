# Disponibilidad familiar y espacio seguro del carrito POS

**Riesgo:** H-112
**Estado:** RESUELTO
**Fecha:** 16/08/2026
**Commit:** `0b59cc8`

## Problema y reproducción

La auditoría UI-PAR reprodujo tres contradicciones en el POS:

1. una familia V2 con referencias vendibles de $1,150 y $1,250, más una
   referencia agotada de $1,350, anunciaba «3 referencias disponibles» y
   `$1,150–$1,350`;
2. en 320/360/375/390/430 px, la región visible de cards y controles se
   cruzaba con la barra fija del carrito;
3. «Agregar» medía 36×44 px.

La regresión H-112 previa a la corrección produjo **8 aprobaciones y 12
fallos**. V1 y la ausencia de overflow ya estaban verdes.

## Causa raíz

`DATA.referenceFamilyProjection()` ya separaba `availableReferences`, pero
`ProductCard` usaba `referenceCount`, `priceMin` y `priceMax`, todos derivados
de la familia administrativa completa. El selector H-111 sí filtraba stock
positivo, por eso tarjeta y decisión posterior se contradecían.

En responsive, `CartAccess` era fijo y el contenedor exterior reservaba espacio,
pero `.pos-cat` no tenía `min-height: 0`; por ello su hijo con
`overflow-y: auto` crecía con las cards en lugar de confinar el scroll al área
anterior al carrito. El CTA declaraba `w-9`, equivalente a 36 px.

## Diseño

- La familia administrativa y sus referencias no cambian.
- Sólo la tarjeta POS deriva conteo y rango de `availableReferences`.
- El selector H-111 y la resolución final por `products.id` no cambian.
- El catálogo conserva el carrito fijo, pero confina su scroll dentro del alto
  disponible y del espacio inferior existente.
- El icono no cambia; su superficie interactiva pasa a 44×44 px.
- V1 conserva exactamente su precio, copy y selector legacy.

## Solución

- `balam/pos.jsx`: `precioCatalogo()` calcula el rango familiar mediante
  `DATA.listPrice()` sólo sobre referencias con stock positivo; una familia
  totalmente agotada no publica un rango disponible.
- `ProductCard` usa `availableReferences.length` para el copy.
- `.pos-cat` y su viewport de catálogo aceptan encogimiento con `min-h-0`, de
  modo que el scroll queda por encima de `CartAccess`.
- «Agregar» usa `w-11 h-11` y un `data-testid` estable.
- `test-h112-pos-card-availability-responsive.mjs` fija los tres contratos.

No hubo cambio en datos, CONFIG, Supabase, stock persistido, SKU, barcode,
familias, precios, V1 ni identidad.

## Pruebas

- Rojo H-112: 8 pasaron, 12 fallaron.
- Verde H-112: 20/20; cinco anchos con intersección 0, target 44×44 y overflow
  0; V1 intacto; precio máximo agotado excluido.
- BALAM QA H-112: 28/28 en 320/360/375/390/430/768/1024/1280/1440; selectores
  V1/V2, copy, precio, variantes, consola, página y red.
- H-111: 9/9 contrato y 19/19 E2E.
- H-102: 15/15 contrato y 16/16 E2E.
- Responsive general: 492/492.
- H-109 móvil: 10/10.
- Certificación V2 H-110: 20/20; 58 intentos Supabase bloqueados, cero
  escrituras remotas y limpieza exacta.
- Tallas 9/9; precio por talla 38/38; venta 20/20; contratos 42/42.
- Navegación 15/15; smoke bundle 17/17; reproducibilidad 8/8.
- Guardián UX: 11 interacciones, 2 validaciones y recorrido completo, igual a
  su línea base.
- `node build-offline.mjs`: correcto; 72 assets; artefactos idénticos de
  trabajo de 8,991,475 bytes antes de la normalización Git.
- GitHub Pages y el blob `index.html` de `b6e1829` coinciden byte por byte:
  8,991,304 bytes y SHA-256
  `194CA6C0864D99A31C0525AFCCD0B1ED17F82B4496AC558796EF97128F43373F`.
- Validación pública H-112 sobre la descarga exacta de Pages: 20/20.

## Riesgo residual y pendientes

Chrome headless no sustituye una comprobación manual con lector USB o
periféricos físicos. Firefox y WebKit no están instalados. No existe riesgo
residual conocido sobre identidad, stock, precios persistidos o V1.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-112--la-tarjeta-familiar-y-el-carrito-móvil-contradicen-la-disponibilidad-operable-del-pos`.
- Auditoría local aprobada: UI-PAR-01, UI-PAR-02 y UI-PAR-03.
- Autoridad: `docs/architect/authorities/inventory.md`.
- Paridad H-111: `docs/fixes/paridad-selector-tallas-pos-v1-v2.md`.
