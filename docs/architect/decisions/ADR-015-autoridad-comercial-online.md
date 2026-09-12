# ADR-015 — Autoridad comercial únicamente online

**Estado:** aprobado por el propietario; implementación y certificación en H-164.
**Reemplaza:** ADR-006, ADR-012 y ADR-014 respecto de operación offline,
cola, proyección durable y recuperación comercial. Sus contratos históricos
de identidad, transacción SQL y evidencia siguen conservados.

## Decisión

Supabase es la única autoridad comercial. Toda mutación pasa por el coordinador
STORE, exige conexión real y autorización del servidor, y espera confirmación
transaccional y lectura remota antes de mostrar éxito. No hay fallback offline.

DATA y CONFIG contienen proyecciones efímeras que se reconstruyen desde una
lectura remota completa. LocalStorage e IndexedDB no reciben colecciones de
negocio. La PWA conserva exclusivamente recursos técnicos y estáticos.

Una respuesta incierta se consulta por identidad estable. El navegador puede
conservar una referencia técnica sin payload; nunca una operación para reenviar.
La resolución de un ID ausente debe impedir un commit tardío de ese mismo ID.
Las cuentas Auth requieren resolución de su flujo servidor, además de SQL.

## Contratos obligatorios

1. Sin conexión real no se crea ni confirma una operación comercial.
2. La autorización, idempotencia, control de versiones y concurrencia viven en
   servidor; ni un candado local ni un encabezado del navegador los sustituyen.
3. Las filas y documentos históricos mantienen identidades y valores pactados.
4. Realtime sólo provoca una nueva consulta. La recuperación debe funcionar
   al refrescar, reconectar o abrir de nuevo, sin depender de eventos recibidos.
5. Antes de retirar una fuente legacy se inventaría y conserva evidencia remota
   íntegra comprobada por hash. Nunca se reejecuta automáticamente su contenido.
6. Una operación real sin confirmación permanece como expediente individual
   para decisión; no se borra ni convierte en autoridad operativa.
7. Los clientes antiguos quedan cercados en servidor durante la activación.
   La certificación de las instalaciones requiere verificar su adopción real.
8. Se conserva la presentación de la aplicación. Sólo cambian los controles
   de disponibilidad y los estados que ya no corresponden al producto.

## Coste aceptado y reversión

Sin Internet o Supabase se detiene temporalmente la operación. La latencia de
confirmación incluye el servidor y la lectura autoritativa. Un bloqueo SQL
compartido serializa inicialmente las mutaciones de las tres cajas; cambiarlo
exige demostrar invariantes equivalentes y medir el resultado.

Una corrección se publica hacia adelante. Revertir la aplicación no autoriza
restaurar colas ni operación offline. Las migraciones son aditivas y la
activación del cerco ocurre después de verificar cliente y servidor.

## Evidencia

Inventario, clasificación, pruebas, adopción y estado de publicación viven en
`docs/fixes/evaluacion-arquitectura-sincronizacion-h164.md` y H-164 del registro
de riesgos. El estado aprobado de esta decisión no equivale a certificación.
