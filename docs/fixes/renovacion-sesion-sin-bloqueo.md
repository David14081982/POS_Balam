# Renovación de sesión sin bloqueo visual

**Riesgo:** H-78
**Estado:** RESUELTO
**Fecha:** 06/08/2026
**Commit:** `42bef5e`

## Problema y reproducción

Al recuperar una pestaña o restaurar la ventana, el POS sustituía la interfaz
por un fondo oscuro con «Cargando…». La reproducción automatizada retuvo la RPC
de permisos durante `TOKEN_REFRESHED`: antes de corregir, AUTH quedó no listo y
perdió temporalmente la identidad resuelta (18/19 pruebas).

## Causa raíz

Supabase puede emitir cambios de autenticación al renovar o reafirmar la sesión.
El listener de AUTH no distinguía la misma identidad de un login distinto:
marcaba `ready = false`, emitía el estado intermedio y borraba perfil y permisos.
`App` mostraba correctamente su gate de arranque ante ese estado incorrecto.

## Diseño

Una sesión ya verificada del mismo `user.id` permanece utilizable durante su
renovación. El snapshot remoto sigue actualizándose y puede reemplazar o revocar
los permisos. Una identidad nueva o ausente conserva el comportamiento
fail-closed y no reutiliza permisos de otra cuenta.

## Solución

`balam/auth.jsx` reconoce una identidad ya resuelta y preserva temporalmente su
perfil y ACL mientras ejecuta `resolveProfile` en segundo plano. La prueba de
AUTH simula una RPC retenida y demuestra que el shell no recibe un falso estado
de arranque.

## Pruebas

- `node test-auth-permissions.mjs`: 19/19.
- `node test-module-contracts.mjs`: 41/41.
- `node test-role-access.mjs`: 15/15.
- `node test-build-reproducibility.mjs`: 8/8.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 15/15.

## Riesgo residual y pendientes

Ninguno conocido. Un cambio real de identidad sigue bloqueando la interfaz
hasta verificar el nuevo perfil, como exige el contrato de seguridad.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-78---renovar-la-sesión-al-recuperar-foco-desmonta-temporalmente-la-aplicación`.
- `docs/fixes/permisos-visualizacion.md`.
