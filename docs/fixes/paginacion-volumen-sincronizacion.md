# Paginación y volumen de sincronización

**Riesgo:** H-16
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

`pullSales()` se describía como paginado, pero sus consultas por fecha y estado
no usaban `range()`. Configuración, dominios y lotes de renglones también
trataban una respuesta como el conjunto completo. Un diagnóstico transaccional
y revertido confirmó que producción todavía es pequeña: 453 filas en `lookup`,
240 productos, cuatro ventas y hasta nueve filas en los demás dominios.

El stub de PostgREST se ajustó a su límite de 1 000 filas. Con 1 001 productos y
1 001 ventas, el resultado previo fue 89 aprobadas y cuatro fallidas: ambos
conjuntos quedaron truncados a 1 000 y no hubo una segunda consulta.

## Causa raíz

El cliente no tenía una frontera común que recorriera páginas. Sólo movimientos
lo hacía de forma especializada. Una página llena y un conjunto completo eran
indistinguibles, por lo que el truncamiento era silencioso y podía reemplazar
estado local con un subconjunto remoto.

## Diseño

- Recorrer páginas explícitas de 1 000 filas con orden estable.
- No aplicar resultados parciales cuando una página falla.
- Paginar configuración, dominios, ventas y lotes de renglones.
- Conservar ventana de ventas, todos los apartados, búsqueda histórica por
  folio, fusión local y protección de cola existentes.
- Añadir índices únicamente donde `EXPLAIN ANALYZE` demuestre un scan costoso.
- Mantener el modelo local-first y no modificar datos históricos.

## Solución

- `balam/store.jsx` incorpora `fetchPages()` y `fetchAllRows()`.
- Configuración y todos los dominios recorren páginas ordenadas por su clave.
- Ventas recientes se ordenan por `fecha, folio`; apartados por `folio`.
- Lotes de 100 folios también paginan sus renglones por `id`.
- La migración 032 crea `sales_fecha_folio_idx` y el índice parcial
  `sales_apartado_folio_idx`.
- Se regeneraron `index.html` y `POS Balam (offline).html`.

## Pruebas

- Reproducción previa: `test-store-queue.mjs`, 89/93; fallaron las cuatro
  aserciones de volumen.
- Corrección ampliada: `test-store-queue.mjs`, 97/97, incluidos 1 001
  productos, 1 001 ventas, 1 001 catálogos y 1 100 renglones.
- `test-migrations.mjs`: 24/24.
- Regresiones: coherencia financiera 17/17, devoluciones 17/17, roles 10/10 y
  concurrencia 9/9.
- `test-smoke.mjs bundle`: 17/17.
- `build-offline.mjs`: correcto. El primer intento sin red no pudo descargar
  Tailwind; el reintento autorizado generó el bundle precompilado.
- Smoke de desarrollo: no ejecutó aserciones porque las dependencias CDN no
  cargaron en el entorno restringido. El bundle distribuido sí fue aprobado.
- Supabase: historial local/remoto hasta 032, dry-run sin pendientes y lint sin
  errores; permanecen dos advertencias PL/pgSQL preexistentes.

Dataset sintético PostgreSQL 18.4:

- 100 000 ventas, 500 000 renglones y 100 000 movimientos.
- Ventas recientes: ~105 ms con sequential scan antes; ~2.8 ms con index scan.
- Apartados: ~32 ms antes; ~1.8 ms con índice parcial.
- Renglones y movimientos ya usaban índices (~3.9 ms y ~0.75 ms).
- Inserción sintética de 100 000 ventas: ~1.96 s sin los índices y ~4.15 s con
  ellos; costo incremental aproximado de 0.022 ms por fila.

## Riesgo residual y pendientes

La paginación por offset es determinista para un conjunto estable. Si ocurren
altas o bajas mientras se recorren páginas, el siguiente pull eventual corrige
la vista; no se cambió a cursores sin evidencia de churn real. Los pulls aún
descargan snapshots completos de dominios administrables, ahora correctos pero
no incrementales. Una sincronización por deltas sería otra fase y requiere
versiones/cursores de servidor.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-16--pulls-truncados-por-límite-de-postgrest`
- Arquitectura: `docs/02-architecture.md#paginación-y-volumen`
- Antecedente: `docs/fixes/recuperacion-movimientos-terminal.md`
