# Recuperación del escritor local al volver de RawBT

**Riesgo:** H-147
**Estado:** CORREGIDO Y VALIDADO — PUBLICACIÓN PENDIENTE
**Fecha:** 05/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El usuario confirma que, al regresar de RawBT, la tablet queda en
«Preparando almacenamiento local». Parte de `f5c3cdc`, sin alterar el worktree
original. El gate muestra además el nombre literal `hourglass_top`.

## Causa raíz

`DATA` libera el Web Lock al recibir `beforeunload`, aun cuando el documento
no llega a salir. La petición termina en `waiting` y sólo `pageshow` solicita
otra. Volver desde una aplicación externa no exige ese evento. La reproducción
controlada dispara `beforeunload` seguido de foco/visibilidad sobre Web Locks
reales y deja el gate permanente sin otra pestaña. También un `pageshow`
inmediato puede adelantarse al `finally` que libera la bandera de petición.
El gate usa una clase Material Rounded que no garantiza el glifo disponible.
No se capturaron eventos directamente en la tablet: evidencia equivalente del
ciclo y reporte del usuario, no una traza de Android nativo.

## Diseño

Liberar por `pagehide`, no por una intención cancelable de navegar. Mantener
el lock al cambiar de aplicación sin abandonar el documento. Al restaurar,
solicitar el mismo lock y rebase, incluso si el regreso se adelantó al cierre
asíncrono. Foco/visibilidad recuperan sólo un estado `waiting`, nunca `blocked`.
Una página realmente oculta por navegación no debe readquirir en su `finally`.
El gate usa los SVG existentes para evitar nombres de iconos como texto.

| Capacidad/ciclo | Invariante |
|---|---|
| Imprimir, cancelar salida, volver de RawBT | Escritor y pantalla conservados si no hubo salida real |
| pagehide→pageshow inmediato/tardío/repetido | Una petición, sin carrera ni espera huérfana |
| Otra pestaña activa | Espera sin robar el lock |
| Relevo y recarga | Rebase durable antes de habilitar escritura |
| Caché inválida | Bloqueo conservado; no borrar datos ni reintentar en bucle |
| POS, Reportes, Apartados, cambios, devoluciones | Mismo transporte y documentos |
| V1/V2, pendientes, identidad y stock | Sin transformación ni mutación por imprimir |
| SQL, roles, cola/pull remotos | Contratos intactos; sin migraciones ni escrituras reales |

## Solución

`balam/data.jsx` elimina la liberación por `beforeunload`, utiliza un listener
estable de `pagehide` y recupera el lease por `pageshow`, foco o visibilidad.
Una bandera de salida evita readquisiciones desde páginas que no regresaron;
el `finally` vuelve a solicitar si el regreso precedió al fin de la petición.
La autoridad continúa en el Web Lock exclusivo y el rebase existente.
`balam/app.jsx` usa `window.Icon` (SVG) en los cuatro estados del gate.

## Pruebas

Rojo válido H-147: 7/13; verde inicial 13/13. La prueba se amplía con espera
en página que sale y regreso por visibilidad sin `pageshow`. El primer arnés
apuntó a una clave de fixture inexistente (`sales_v2`); se corrigió a la clave
vigente `sales_v1` antes de registrar el rojo válido.
H-143: 40/40, incluida navegación cancelable en cada intent y escritor activo
al volver; H-65 E2E 28/28 y contrato 35/35; AUTH 19/19; módulos 42/42;
concurrencia 15 comprobaciones, sin fallos; build 8/8.

Cola: primer pase 185/186, fallo intermitente en clasificación `PGRST205`.
Control sobre `f5c3cdc`: 186/186; repetición con el cambio: 186/186.
La suite sólo carga `core.jsx` y `store.jsx`, ambos idénticos al control.
No se modificó el clasificador ni la cola para satisfacer la prueba.

H-82 perdió el gate de arranque al vencer sus 450 ms durante la carga. Se
reemplazó esa carrera del arnés por una liberación explícita después de observar
el gate, conservando la aserción de espera sin propietario y el lock real.
H-82 final 13/13: la pausa sólo intercepta el nombre del lock de DATA,
sin demorar locks internos de AUTH. H-147 final 16/16, incluido regreso por
visibilidad sin foco, página que sale mientras espera, rebase y bloqueo por
caché inválida. Smoke bundle 17/17 y navegación 15/15. El cambio final de
registro de visibilidad se cubre explícitamente en H-147.

QA visual: gate en tablet con SVG local y mensaje íntegro; impresión cubre
ocho viewports (320–1440 px), reintento, POS, Reportes, Apartados y escritorio.
Self-review: no hay otra autoridad, lock, cache ni política comercial; no se
alteran importes, productos, snapshots, permisos, Excel, etiquetas o préstamo.
El nuevo recorrido conserva la exclusión, rebase y rechazo ante datos inválidos.
Las pruebas interceptan Supabase: no se modificaron datos reales ni se invocó
una limpieza/rebootstrap. La cola y el pull no cambian de implementación.

Dos builds finales coinciden: SHA-256 local
`d1d7a7bad86c88d8bc4d49a6b79038d5684e87c1cc548039c0e176c049563f49`.
Un intento intermedio falló al abrir el HTML generado (`UNKNOWN` de Windows);
el reintento terminó y la verificación final del build dio 8/8.
Publicación pendiente de registrar.

## Riesgo residual y pendientes

Confirmar regreso desde la impresora física. El navegador continúa siendo la
autoridad del lock; no se habilita escritura por timeout, foco o consulta.
No se borra caché ni cola como método de recuperación.

## Referencias

- `diagnostico-del-escritor-local.md` y `liquidacion-apartado-autoridad-stock.md`.
- `docs/architect/decisions/ADR-006-local-first-y-transaccion-sql.md`.
- https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event
- https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event
