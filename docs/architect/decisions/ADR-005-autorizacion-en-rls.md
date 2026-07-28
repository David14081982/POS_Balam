# ADR-005 — La autorización vive en RLS y en el perfil activo

**Estado:** vigente · **Historias:** H-05, H-07 (origen), H-08

## Contexto

Las policies `auth_all` aplicaban `using (true)` y `with check (true)` a todo
rol `authenticated`. Una cuenta temporal de Supabase Auth **sin fila en
`pos.sellers`** obtuvo SELECT, UPDATE y DELETE en las 14 tablas del dominio.
En paralelo, `AUTH.isAdmin()` devolvía verdadero ante cualquier sesión y
`AUTH.current()` fabricaba un rol `admin` cuando no encontraba perfil local.

## Decisión

La autoridad de autorización es la base, no la interfaz. Una sesión
`authenticated` sólo accede al esquema si existe un perfil con su correo,
activo y sin tombstone; el rol de ese perfil decide el alcance. `AUTH.canAccess()`
aplica el mismo contrato en la navegación, y `service_role` queda reservado a
infraestructura de servidor porque omite RLS. Ocultar pantallas no es
autorización.

## Trade-off

**Beneficio obtenido:** una cuenta huérfana, inactiva o de otro rol no puede
leer ni escribir datos comerciales aunque llegue por PostgREST directo, saltando
por completo la interfaz.

**Costo aceptado:** cada tabla, vista y función nueva del esquema `pos` hereda
una obligación permanente de revisión de permisos —la lección de `AP-02` y
`AP-04`—, y toda operación de servidor que necesite saltarse RLS obliga a una
Edge Function en vez de una llamada directa. Además, una terminal totalmente
offline opera con el último perfil verificado, así que una desactivación remota
sólo se hace efectiva al reconectar: se aceptó para no romper el modelo
local-first.

**Alternativa descartada:** validar el rol en el cliente y confiar en la
interfaz. Se descartó porque H-07 demostró exactamente su fallo: la interfaz no
estaba en el camino del atacante.

## Cómo se revierte y qué se rompería

No se revierte. Volver a policies permisivas reabre el acceso de cualquier
cuenta Auth al dominio completo. La verificación `20260725002900` aborta si
alguna tabla queda sin RLS, si sobreviven policies permisivas antiguas o si
`anon` recupera acceso al esquema.

## Referencias

`docs/fixes/rls-administrador-activo.md` · `docs/fixes/vendedor-solo-punto-venta.md` ·
`docs/fixes/admin-users-auth.md` · `docs/02-architecture.md` § Autorización del
esquema `pos`
