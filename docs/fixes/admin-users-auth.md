# Corrección de autorización en `admin-users`

**Riesgo:** H-05
**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit:** `407ce14`

## Problema

La creación y eliminación de usuarios fallaban durante la validación del
administrador. La Edge Function consultaba `pos.sellers` con el cliente
`service_role`, pero ese rol no tenía acceso al esquema personalizado `pos`.
La sesión del administrador y su token sí llegaban correctamente a la función.

## Corrección

El cliente construido con el token del usuario ahora configura explícitamente
`db.schema = "pos"` y se utiliza para validar al administrador y operar sobre
`pos.sellers`. El cliente `service_role` queda reservado para las operaciones
administrativas de Supabase Auth: crear, actualizar y eliminar cuentas.

## Alcance

- Archivo modificado: `supabase/functions/admin-users/index.ts`.
- Edge Function desplegada en el proyecto Balam como versión 8.
- No se modificaron el inicio de sesión, el transporte del token, la interfaz,
  las tablas ni las políticas RLS.

## Verificación

- El despliegue terminó correctamente y Supabase reportó la versión 8 activa.
- Una solicitud sin sesión continuó siendo rechazada con HTTP 401.
- Con la sesión real de `admin@balamguayaberas.com`, se confirmó manualmente la
  creación, edición y eliminación de un usuario temporal.
- `test-store-queue.mjs`: 29 pruebas aprobadas.
- Los tests de navegador no alcanzaron a iniciar la aplicación por timeout al
  cargar dependencias CDN; no produjeron un fallo dentro del flujo de usuarios.
- El cambio de contraseña conserva la misma llamada administrativa desplegada,
  pero no se hizo una modificación real de contraseña durante esta corrección.

## Riesgo residual

El cambio de contraseña no se verificó mediante una mutación real durante esta
corrección. No forma parte del fallo de autorización ya resuelto.
