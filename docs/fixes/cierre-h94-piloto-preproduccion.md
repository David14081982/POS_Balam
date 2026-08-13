# Cierre H-94: piloto V2 de preproduccion

**Riesgo:** H-94
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 12/08/2026
**Commit:** Pendiente de commit

## Problema y reproduccion

El modelo anterior no podia distinguir de forma segura referencias fisicas con
el mismo SKU. H-94 definio `products.id` como identidad tecnica,
`barcode_code` como identidad logistica y SKU como representacion comercial.
El cierre requeria demostrar el modelo en un piloto completo sin convertir V1,
sin cargar inventario real y sin iniciar Punto Cero.

## Causa raiz

La causa original y sus defectos derivados quedaron documentados en H-94,
H-95, H-96 y H-97. Durante este cierre aparecio una perdida concreta de
identidad al reconciliar movimientos de Reclasificacion: el pull omitía
`operation_id` y no enriquecia `reversal_of` desde el ledger. La prueba roja
fue 48/49 y el piloto se detuvo antes de duplicar stock.

## Diseño

El piloto uso siete referencias V2, cinco SKU y 35 piezas. D/E compartieron SKU
y difirieron por Corte; F/G compartieron SKU y difirieron por Caracteristicas.
Todos conservaron IDs y barcodes distintos. El manifiesto durable
`balam_h94_pilot_manifest` registro IDs, folios y operaciones antes de cada
frontera remota. La limpieza uso exclusivamente ese alcance.

Punto Cero, inventario real, regeneracion masiva de SKU, etiquetas fisicas y
apertura productiva quedaron fuera del alcance.

## Solucion

- H-96 separo `op.id` de `op.key` y preservo el `operationId` comercial de
  Cambios hasta `exchange_commits`.
- H-14 agrego descarte unitario de cola con guardas documentales exactas.
- H-97 preservo `movements.operation_id` y enlazo la reversa desde
  `reference_reclassifications`.
- No se requirio una nueva migracion SQL para H-96, H-14 o H-97.
- El piloto completo valido alta, SKU, barcode, inventario, busqueda, escaneo,
  etiquetas, Excel, estadisticas, venta, Kardex, Apartado, anticipo, abono,
  liquidacion, devolucion, Cambio, prestamo/devolucion y
  Reclasificacion/reversa.
- Dos terminales, offline, reconexion y replay quedaron cubiertos por los
  arneses ejecutables de cola, prestamos, H-77 y H-80. Dos intentos manuales de
  falsificar conectividad desde JavaScript no se usaron como evidencia: Chrome
  mantuvo la red efectiva y ambas operaciones se confirmaron una sola vez.

## Pruebas

- H-94 49/49; H-96 36/36; cola 176/176; Cambio E2E 37/37; pantalla 45/45.
- H-95 16/16; H-86 17/17; contratos 42/42; migraciones 31/31.
- Prestamos/sincronizacion 69/69; H-77 20/20; H-80 7/7.
- Navegacion 15/15; responsive 492/492; smoke bundle 17/17.
- PWA 19/19; login/instalacion 10/10; instalacion publicada 6/6.
- Pages run `31658297121`: `success` para `2381741`.
- Bytes publicados: 8,963,319; SHA-256
  `AAC1402ED82273404D004712E7992251BC9B73474B9E96959CE15AA110A31215`,
  iguales al build normalizado.
- `supabase migration list --linked`: todas las versiones locales/remotas
  coinciden hasta `20260811013800`.

La limpieza exacta comprobo antes de borrar: V1=1,378, huella
`d8bd3f2ed327f3e330c814d0bf9e8731`, siete V2, cero documentos externos al
manifiesto. Retiro 5 ventas, 1 devolucion, 3 cambios, 1 prestamo, 2
reclasificaciones, 17 movimientos, 1 vendedor y sus hijos exactos. Resultado:

- V1 remoto: 1,378;
- V2: 0;
- H94-PILOT: 0;
- stock: 3,334;
- huella V1: `d8bd3f2ed327f3e330c814d0bf9e8731`;
- cola/bloqueos: 0/0, `synchronized=true`;
- residuo de IDs del manifiesto: 0.

## Riesgo residual y pendientes

No queda un defecto tecnico conocido que bloquee Punto Cero. La validacion no
autoriza produccion: configuracion definitiva, carga de inventario real,
impresion/colocacion de etiquetas reales y apertura productiva pertenecen a la
siguiente historia.

## Referencias

- `docs/fixes/modelo-referencias-fisicas-v2.md`
- `docs/fixes/reintento-cambios-conflicto-cola.md`
- `docs/fixes/reclasificacion-idempotencia-tras-pull.md`
- `docs/fixes/frontera-escritura-productos.md`
