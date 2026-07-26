# Migraciones reproducibles y contrato de esquema

**Riesgo:** H-10
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** `41dac52`

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
- Las migraciones 01950 y 030 preparan y eliminan dos filas reservadas para que
  las verificaciones históricas 020–026 también sean ejecutables desde vacío.
- La migración 031 compara una huella semántica estable entre PostgreSQL 17 y
  18; no depende del orden físico de columnas ni de representaciones internas
  que cambiaron entre versiones.
- El historial remoto 001–012 se reparó como aplicado sin ejecutar su SQL; 029
  fue aplicada y aprobó sobre producción.

## Pruebas

- Reproducción: `supabase migration list --linked` — inicialmente sólo 013–028.
- Reproducción: `supabase db push --linked --dry-run` — enumeró 001–012 como
  migraciones anteriores ausentes.
- Dos bases vacías ejecutaron 001–031 desde cero sobre PostgreSQL 18.4:
  17 tablas, 191 columnas, 11 funciones, 30 policies y cero semillas
  reservadas en cada una.
- Huella semántica idéntica en ambas y producción:
  `a7d720a0d8a5f6ae5d33c5c1f61f3e49`.
- Dumps normalizados idénticos, SHA-256
  `E101689C7A0F5F45A8A05A6C9052F5F4B2B949121C1FEE39C77862B84727CA66`.
- `node test-migrations.mjs` — 23 pasaron, 0 fallaron.
- `supabase migration list --linked` — local/remoto idénticos 001–031.
- `supabase db push --linked --dry-run` — base remota actualizada, sin
  migraciones pendientes.
- Migraciones 029 y 031 — contrato remoto aprobado.
- `supabase db lint --linked --schema pos --level warning` — cero errores; dos
  advertencias preexistentes por variables no leídas.
- Regresiones: cola 89/89, concurrencia 9/9, roles 10/10, coherencia de venta
  17/17, devoluciones 17/17 y folios 4/4.
- `test-smoke.mjs` agotó la espera de arranque antes de ejecutar aserciones; no
  modifica ni invalida la evidencia SQL de H-10.

## Riesgo residual y pendientes

H-10 queda resuelto. El residual bajo es deliberado: la huella no compara el
orden físico histórico de columnas, el texto de defaults ni las restricciones
internas `NOT NULL` introducidas por PostgreSQL 18. Sí compara nombres y tipos,
nulabilidad, restricciones funcionales, índices, funciones, policies y RLS.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-10--cadena-de-migraciones-no-reconstruye-el-esquema`
- Arquitectura: `docs/02-architecture.md#supabase`
