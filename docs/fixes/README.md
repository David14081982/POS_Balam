# Historial de correcciones

Un archivo por corrección conserva la causa y la evidencia más allá de una
sesión de chat.

## Cómo usar este directorio

- Antes de modificar un módulo, leer las correcciones relacionadas.
- Crear el documento desde `_template.md` durante la etapa de documentación.
- Usar nombres estables en minúsculas y con guiones.
- Enlazar el riesgo de `../03-known-risks.md`.
- No inventar commits, fechas ni resultados de pruebas.

## Correcciones registradas

| Archivo | Riesgo | Tema |
|---|---|---|
| `admin-users-auth.md` | H-05 | Autorización de usuarios mediante Edge Function |
| `concurrencia-multi-terminal.md` | H-06 | Versionado optimista, conflictos y tombstones |
| `rls-administrador-activo.md` | H-07 | Acceso al dominio sólo para administrador activo |
| `vendedor-solo-punto-venta.md` | H-08 | Administrador completo y vendedor sólo Punto de Venta |
| `inventario-concurrente.md` | H-01 | Reserva atómica e idempotente de stock por venta |
| `venta-transaccional-idempotente.md` | H-04 | Venta y devolución transaccionales e idempotentes |
| `folios-multi-terminal.md` | H-02 | Identidad inmutable y folios únicos offline |
| `aislamiento-cola-por-sesion.md` | H-09 | Cola offline aislada por identidad |
| `migraciones-reproducibles.md` | H-10 | Cadena formal y contrato de esquema |
| `margen-minimo-promociones.md` | H-11 | Piso de margen en promociones |
| `lector-excel-seguro.md` | H-12 | Dependencia Excel fijada y lectura con límites |
| `recuperacion-movimientos-terminal.md` | H-13 | Reconstrucción del kardex desde Supabase |
| `diagnostico-cola-offline.md` | H-14 | Diagnóstico y recuperación de la cola offline |
| `arnes-smoke-confiable.md` | H-15 | Smoke E2E aislado, confiable y con cleanup |
| `paginacion-volumen-sincronizacion.md` | H-16 | Paginación completa e índices medidos |
| `limpieza-codigo-recursos.md` | H-17 | Código muerto y CSS no cargado |
| `identidad-terminal-compartida.md` | H-18 | Contrato único de identidad de terminal |
| `bundle-reproducible.md` | H-19 | Identidad determinista de assets del bundle |
| `build-sin-dependencias-remotas.md` | H-20 | Recursos externos fijados y build sin red |
| `desacoplar-config-data.md` | H-21 | Adaptador de productos entre CONFIG y DATA |
| `desacoplar-data-store.md` | H-22 | Gateway de sincronización entre DATA y STORE |
| `desacoplar-config-store.md` | H-23 | Gateway de sincronización entre CONFIG y STORE |
| `desacoplar-auth-store.md` | H-24 | Gateway de cliente entre AUTH y STORE |
| `selector-segmentado-compartido.md` | H-25 | Selector común de Clientes e Inventario |
| `procesamiento-imagenes-compartido.md` | H-26 | Lectura y reducción común de imágenes |
| `arneses-e2e-sin-cdn.md` | H-27 | Ocho recorridos E2E sobre el bundle local |
| `sdk-supabase-local-fijado.md` | H-28 | SDK de navegador local, exacto y verificable |
| `eligible-active-sellers.md` | H-29 | Vendedores comerciales activos y elegibles |
| `fotografias-vendedores.md` | H-30 | Fotografías en la pantalla Vendedores |
| `autoridad-comision-efectiva.md` | H-31 | Precedencia y compatibilidad del porcentaje efectivo |
| `trazabilidad-descuento-ticket.md` | H-32 | Evidencia del descuento por renglón y formato de Finanzas |
| `folio-comercial-diario.md` | H-33 | Folio corto con consecutivo diario y contador central |
| `plazo-posventa.md` | H-34 | Plazo de devolución configurable y congelado en la venta |
| `saldo-por-renglon.md` | H-35 | Autoridad única del saldo por renglón entre devoluciones y cambios |
| `precio-por-talla.md` | H-36 | Precio general del artículo con excepciones por talla |
| `modelo-del-cambio.md` | H-37 | Modelo del cambio de mercancía y costura de suministro (C4) |
| `commit-transaccional-cambio.md` | H-38 | Autoridad transaccional del cambio (C5) |
| `pantalla-del-cambio.md` | H-42 | Pantalla del cambio, atribucion y comprobante (C6) |
| `pantalla-apartados.md` | H-40 | Pantalla de apartados, abono con forma de pago y comprobante |
| `ticket-impreso-paginado.md` | H-41 | El comprobante impreso se cortaba en la primera hoja |
| `pantalla-prestamos.md` | H-46 · H-48 · H-49 | Préstamos de mercancía: documento, cartera, vale firmado, lector y fechas |

Documentación financiera relacionada, creada antes de este índice:

- `../H-03-coherencia-cobro.md`
- `../trazabilidad-financiera.md`

Cuando H-03 vuelva a modificarse, su nuevo documento de corrección debe crearse
en este directorio; los documentos anteriores se conservan como evidencia.
