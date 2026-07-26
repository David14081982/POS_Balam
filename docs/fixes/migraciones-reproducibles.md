# Migraciones reproducibles y contrato de esquema

**Riesgo:** H-10
**Estado:** PARCIALMENTE RESUELTO
**Fecha:** 25/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

`supabase/migrations/` y el historial remoto comenzaban en 013. Las bases
001–012 sólo existían como scripts manuales en la raíz de `supabase/`, y no
existía `supabase/config.toml`. `supabase db push --dry-run` confirmó que, al
incorporarlas, Supabase detectaba trece versiones anteriores ausentes. La
inspección de dependencias mostró además que 004 falla si se ejecuta antes de
005 porque intenta proteger `pos.promotions`.

## Causa raíz

El esquema evolucionó mediante ejecuciones manuales antes de adoptar
`supabase/migrations`. La numeración de los archivos legibles se interpretaba
como orden aunque un comentario de 004 documentaba la dependencia inversa.
Ninguna prueba automatizada comprobaba integridad, orden o contrato final.

## Diseño

La carpeta `supabase/migrations/` es la única autoridad de despliegue. Las
bases históricas se copian sin cambiar su SQL, pero reciben versiones
cronológicas que respetan dependencias. Producción registra esas bases como ya
aplicadas sin reejecutarlas. Una migración final de sólo verificación aborta
ante deriva de objetos o seguridad. Los scripts manuales permanecen como
referencia operativa, no como camino de instalación.

## Solución

- Se creó `supabase/config.toml` para PostgreSQL 17, migraciones habilitadas,
  seed deshabilitado y API local con el esquema `pos`.
- Se incorporaron trece archivos formales para 001–012; 005 antecede a 004.
- `test-migrations.mjs` verifica versiones únicas, copias históricas exactas,
  orden de dependencias y presencia del contrato final.
- La migración 029 verifica tablas, columnas, funciones, RLS, policies, grants
  de `anon` y el bucket `product-photos`.
- El historial remoto 001–012 se reparó como aplicado sin ejecutar su SQL; 029
  fue aplicada y aprobó sobre producción.

## Pruebas

- Reproducción: `supabase migration list --linked` — inicialmente sólo 013–028.
- Reproducción: `supabase db push --linked --dry-run` — enumeró 001–012 como
  migraciones anteriores ausentes.
- `node test-migrations.mjs` — 21 pasaron, 0 fallaron.
- `supabase migration list --linked` — local/remoto idénticos 001–029.
- `supabase db push --linked --dry-run` — base remota actualizada, sin
  migraciones pendientes.
- Migración 029 — contrato remoto aprobado.
- `supabase db lint --linked --schema pos --level warning` — cero errores; dos
  advertencias preexistentes por variables no leídas.
- Regresiones: cola 62/62, concurrencia 9/9, roles sin fallos, coherencia de
  venta 17/17, devoluciones 17/17 y comisiones 10/10.
- `supabase db reset --local --no-seed` — no ejecutada: Docker Desktop no está
  instalado; la CLI abortó antes de crear la base.

## Riesgo residual y pendientes

La actualización del proyecto real quedó verificada, pero falta ejecutar
001–029 desde cero en dos proyectos vacíos y comparar sus dumps con producción.
Hasta contar con Docker Desktop o proyectos Supabase temporales autorizados,
H-10 permanece parcialmente resuelto.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-10--cadena-de-migraciones-no-reconstruye-el-esquema`
- Arquitectura: `docs/02-architecture.md#supabase`
