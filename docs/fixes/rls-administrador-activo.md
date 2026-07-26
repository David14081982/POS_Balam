# RLS para administrador activo

**Riesgo:** H-07
**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit:** `23bec3b`

## Problema y reproducción

La clave `anon` no podía entrar al esquema `pos`, pero cualquier identidad
válida de Supabase Auth heredaba policies `auth_all` con `using (true)` y
`with check (true)`.

Una cuenta temporal sin fila en `pos.sellers` obtuvo SELECT, UPDATE y DELETE
en las 14 tablas del dominio. En 13 tablas el INSERT alcanzó restricciones de
datos y sólo `sync_conflicts` lo rechazó por una policy adicional. Por tanto,
poseer una sesión Auth era suficiente para leer o modificar datos comerciales.

## Causa raíz

Las policies comprobaban únicamente el rol PostgreSQL `authenticated`; no
relacionaban el correo del JWT con `pos.sellers` ni verificaban `role`,
`active` o `deleted_at`.

## Diseño

El producto vigente sólo ofrece login administrativo. El contrato adoptado es:

- `anon`: sin acceso al esquema;
- `authenticated`: acceso al dominio únicamente cuando existe un perfil con
  el mismo correo, `role='admin'`, `active=true` y sin tombstone;
- `service_role`: acceso técnico exclusivo para operaciones de servidor;
- RLS permanece habilitado en las 14 tablas.

La función `pos.is_active_admin()` es `security definer`, fija su
`search_path` y no se concede a `public`.

## Solución

- `20260725001400_pos_admin_rls.sql` crea el predicado de autorización,
  elimina `auth_all` y aplica `active_admin_all`.
- La misma migración revoca en profundidad los grants de `anon`.
- Durante la verificación se demostró que `service_role` carecía de `USAGE`
  sobre el esquema personalizado. Como la 014 ya estaba aplicada, no se
  reescribió su historial.
- `20260725001500_pos_service_role_grants.sql` restaura sólo los grants
  técnicos de `service_role`, incluidos privilegios predeterminados.

## Pruebas

Pruebas remotas contra el proyecto enlazado:

- historial local/remoto contiene `20260725001400` y `20260725001500`;
- `anon`: rechazo en 14/14 tablas;
- administrador activo: SELECT 200 en 14/14 tablas y CRUD de cliente
  crear/actualizar/eliminar con comprobación final de cero filas;
- administrador inactivo: cero filas visibles y 14/14 escrituras rechazadas
  con `42501`;
- vendedor activo: cero filas visibles y 14/14 escrituras rechazadas;
- cuenta Auth sin perfil: cero filas visibles y 14/14 escrituras rechazadas;
- PATCH y DELETE del vendedor contra su propio perfil devolvieron resultado
  vacío; una lectura administrativa confirmó que la fila sobrevivió sin
  cambios;
- auditoría final eliminó todas las identidades y perfiles temporales.

Regresiones locales:

- `node test-store-queue.mjs`: 34 pasaron, 0 fallaron;
- `node test-concurrency.mjs`: 9 pasaron, 0 fallaron.

## Riesgo residual y pendientes

Esta corrección mantiene el contrato actual de login sólo administrativo. El
acceso de vendedores exclusivamente al Punto de Venta y una sección gráfica de
permisos por rol requieren una corrección separada que proteja navegación y
operaciones del servidor. Ocultar pantallas por sí solo no constituye
autorización.

No se verificó en esta corrección una Edge Function desplegada ni un flujo
completo de navegador contra producción; los grants de `service_role` y las
policies sí fueron comprobados mediante las APIs reales de Auth y PostgREST.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-07--acceso-excesivo-de-cualquier-autenticado`
- Arquitectura: `docs/02-architecture.md#autorización-del-esquema-pos`
