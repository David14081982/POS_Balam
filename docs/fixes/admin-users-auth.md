# Corrección de autorización en `admin-users`

**Riesgo:** H-05
**Estado:** RESUELTO
**Fecha:** 25/07/2026
**Commit de corrección:** `407ce14`
**Commit de verificación:** Pendiente de commit

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
- La verificación final confirmó que `admin-users` sigue activa como versión 8.
- Una identidad administrativa temporal autenticada creó mediante la Edge
  Function una cuenta de vendedor con contraseña inicial.
- La contraseña inicial autenticó con HTTP 200.
- `action=update` cambió realmente la contraseña y devolvió HTTP 200.
- La contraseña anterior fue rechazada con HTTP 400 y la nueva autenticó con
  HTTP 200.
- `action=delete` eliminó la identidad y su perfil; el acceso posterior fue
  rechazado.
- La solicitud sin sesión continuó rechazada con HTTP 401.
- Resultado remoto: 9/9 verificaciones.
- Las migraciones `20260725002700` y `20260725002800` prepararon y eliminaron
  la identidad administrativa temporal. La 028 comprobó que no quedaran cuentas
  ni perfiles de prueba.
- Regresiones finales: `test-store-queue.mjs` 55/55,
  `test-role-access.mjs` 10/10 y `test-concurrency.mjs` 9/9.

## Riesgo residual

Ninguno conocido dentro del flujo crear, cambiar contraseña y eliminar usuarios
mediante `admin-users`. La función exige una sesión administrativa activa y la
clave `service_role` permanece exclusivamente en el entorno de Supabase.
