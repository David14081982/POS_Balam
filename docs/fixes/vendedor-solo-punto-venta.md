# Vendedor limitado al Punto de Venta

**Riesgo:** H-08
**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Una sesión de vendedor se trataba como administrativa porque
`AUTH.isAdmin()` sólo comprobaba que existiera sesión. Si el perfil no estaba
en la copia local, `AUTH.current()` fabricaba una identidad con rol `admin`.

La navegación tampoco hacía cumplir permisos: sólo cuatro entradas estaban
marcadas, el botón no bloqueaba el cambio y `balam-page` podía restaurar
cualquier pantalla.

`node test-role-access.mjs` reprodujo cinco fallos: vendedor considerado
administrador, ausencia de contrato de acceso, inventario permitido y cuenta
huérfana promovida implícitamente.

## Causa raíz

Autenticación, rol y navegación no compartían una autoridad. La interfaz
infería privilegios desde la existencia de sesión y RLS sólo contemplaba el
contrato temporal de H-07: administrador o ningún acceso.

## Diseño

- Perfil remoto activo como autoridad del rol.
- Sin fallback administrativo.
- Administrador: todas las pantallas.
- Vendedor: sólo `pos`.
- Inactivo o sin perfil: sin acceso.
- Último perfil remoto verificado como respaldo exclusivo para arranque
  offline del mismo correo.
- RLS de vendedor limitado a datos y operaciones requeridos por el cobro.
- En el contrato original de H-08, productos permitían sólo stock y vendedores
  sólo métricas. H-01 endureció después el stock: ahora el vendedor únicamente
  puede descontarlo mediante `pos.reserve_sale_stock()`.
- Cola offline y versionado optimista permanecen vigentes.

## Solución

- `balam/auth.jsx`: resolución remota del perfil, caché offline verificada,
  `role()`, `isAdmin()` real y `canAccess(page)`.
- `balam/app.jsx`: menú filtrado, redirección de página persistida, estado
  visual de vendedor y pantalla para perfil no autorizado, conservando la
  línea gráfica existente.
- `balam/store.jsx`: el vendedor actualiza productos/vendedores sin UPSERT
  administrativo y sólo descarga dominios necesarios para el POS.
- `20260725001600_pos_seller_pos_access.sql`: policies de vendedor y triggers
  de columnas protegidas. Las migraciones 017/018 sustituyen posteriormente el
  UPDATE directo de stock por la reserva atómica.
- `index.html` y `POS Balam (offline).html`: regenerados con
  `node build-offline.mjs`.

## Pruebas

Automatizadas aprobadas:

- `node test-role-access.mjs`: 10/10;
- `node test-store-queue.mjs`: 37/37;
- `node test-concurrency.mjs`: 9/9;
- `node test-sale-coherence.mjs`: 15/15;
- `node test-commission.mjs`: 10/10.

Supabase real:

- migración 016 presente local y remotamente;
- administrador y vendedor leyeron las seis fuentes con datos necesarias;
- inactivo y cuenta huérfana vieron cero fuentes con filas;
- vendedor creó cliente y persistió venta, renglón, movimiento y pago;
- vendedor actualizó stock y métricas;
- renombrar producto, promoverse, escribir configuración o crear devolución
  fue rechazado con `42501`;
- escrituras de inactivo y huérfano fueron rechazadas con `42501`;
- cero identidades y filas temporales después de la limpieza.

El bundle final se generó correctamente. El smoke del bundle arrancó sin
errores y aprobó sus primeras siete comprobaciones; después quedó bloqueado por
el overlay `__bundler_err` ya existente. El smoke de desarrollo agotó el tiempo
esperando dependencias CDN. `test-discounts.mjs` conservó dos fallos existentes
del piso de margen, fuera del alcance de autorización.

## Riesgo residual y pendientes

Una terminal completamente offline conserva el último rol verificado para
seguir operando local-first; una desactivación realizada desde otra terminal
se aplica cuando recupera conexión.

El vendedor tiene autoridad sobre las operaciones de cobro necesarias. La
atomicidad e idempotencia transaccional completa de la venta no se resuelven
aquí y permanecen en H-01/H-04. Los permisos configurables por pantalla tampoco
forman parte del contrato fijo solicitado.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-08--vendedor-sin-confinamiento-al-punto-de-venta`
- Arquitectura: `docs/02-architecture.md#autorización-del-esquema-pos`
