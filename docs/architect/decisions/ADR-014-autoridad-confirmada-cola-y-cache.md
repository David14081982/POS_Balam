# ADR-014 · Autoridad confirmada, intención offline y caché son roles distintos

**Estado:** vigente · aplicada por H-121
**Historia:** H-121 · **Fecha:** 19/08/2026

## Contexto

BALAM necesita memoria, persistencia local y cola para operar sin red. Eso no
autoriza que una fila cacheada siga siendo un documento confirmado cuando un
pull completo o una cobertura declarada demuestra que ya no existe en
Supabase. `mergeRemote()` y varios vacíos ignorados rompen hoy esa separación.

## Decisión

Por dominio existen cuatro roles y no se intercambian:

1. Supabase es autoridad del documento confirmado y de su baja.
2. La cola durable es autoridad exclusiva de una intención no confirmada, por
   identidad exacta y mientras la operación permanezca en cola.
3. `DATA` y `localStorage` son una proyección reconstruible. Offline pueden
   mostrar el último estado conocido y la intención pendiente; online sólo
   pueden declarar vigente lo que la autoridad o la cola justifican.
4. Actividad, dispositivos, cursores y Realtime son observabilidad/protocolo;
   nunca crean, conservan ni reviven documentos comerciales.

La ausencia sólo tiene significado dentro de la cobertura demostrada por el
pull. Un snapshot completo incluye el conjunto vacío. Una ventana parcial debe
declarar sus límites y sólo puede reconciliar identidades dentro de ellos.

La evidencia forense que deba sobrevivir a la reconciliación sale de la
proyección comercial mediante los mecanismos administrativos existentes de
exportación/recuperación o cuarentena. No se crea otra colección, clave, tabla o
snapshot comercial permanente.

## Contratos

1. Cada dominio declara cobertura, paginación, aplicación, identidades
   pendientes y efectos cruzados antes de activarse.
2. Un cursor avanza únicamente después de un pull completo y aplicado; error,
   omisión, carrera o persistencia fallida no son éxito.
3. Remoto presente actualiza; remoto ausente con cola exacta conserva la
   intención; tombstone retira; remoto ausente sin cola retira de la proyección
   operativa sólo cuando la cobertura lo demuestra.
4. Ningún marcador local como `_syncStatus` o `_loanVersion` sustituye la
   presencia remota o una operación durable exacta.
5. Los efectos de una operación pendiente bloquean juntos sus dominios de
   stock, documento, pago, movimiento, cliente y comisión.
6. `syncStatus.synchronized` exige conectividad y convergencia aplicada, no sólo
   cola cero, época y ausencia de invalidaciones conocidas.
7. Alterar cachés reales, mover evidencia o reconstruir una terminal requiere
   export forense y autorización separada.

## Aplicación y verificación

La auditoría, el expediente y el resultado viven en
`docs/fixes/autoridad-unica-datos-h121.md`. La implementación declara el
resultado de cada pull, reconcilia Ventas por cobertura, aplica snapshots
completos vacíos, centraliza los efectos protegidos por cola y deriva las
proyecciones de comisiones desde documentos remotos. Equipo David se
reconstruyó sólo después de exportar y sellar su evidencia forense.

## Alternativas descartadas

- Otra base de documentos sólo-local: crea una segunda autoridad.
- Confiar en `sync_activity`: no contiene payload comercial reproducible.
- Reemplazar ciegamente una ventana parcial: borra historia fuera de cobertura.
- Conservar todo local “por seguridad”: mantiene documentos fantasma operativos.
- Limpiar automáticamente sin export: puede destruir la única evidencia local.

## Referencias

`ADR-003` · `ADR-006` · `ADR-012` · H-62 · H-77 · H-118 · H-120 · H-121
