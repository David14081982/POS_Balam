# Recuperación de las 28 intenciones de prueba en la flota real

**Riesgo:** H-148, seguimiento de instalaciones físicas.
**Estado:** PARCIALMENTE RESUELTO; flota todavía NO CERTIFICADA.
**Fecha:** 08/09/2026.
**Commit:** `2fc891242809261e861f8ecdc7730293442b649f`.

## Problema y reproducción

El dueño autorizó descartar las 28 intenciones locales de prueba (17/10/1),
sin enviarlas, reproducirlas ni convertirlas en nuevas operaciones. La
autorización no permite eliminar información comercial confirmada en Supabase.
Se exige diagnóstico previo, cola cero, reconstrucción y nuevas pruebas entre
las tres instalaciones originales.

La consulta de las 13:38 UTC confirmó esos conteos y build H142. Los equipos A
(`dev-mtov9u6i-lvz9esb6`) y B (`dev-ms3il7ts-7jsbewuw`) no tenían conexión de
control disponible en esta sesión; sus últimas señales eran del 07/09 a las
23:33 UTC y del 08/09 a las 02:52 UTC. Telemetría y expedientes del servidor no
contienen sus colas durables completas.

Se localizó C (`dev-mtny3o3e-rwa6o1na`) en la pestaña BALAM de Chrome Default
de esta computadora, en el origen publicado. Se intervino esa instalación
real conservando su identidad y sesión; no se creó un perfil sustituto.

## Causa raíz

C todavía ejecutaba H142, con época local 6 frente a época remota 7 y
`must_rebootstrap`. La cola activa `localStorage/balam_sync_queue` contenía
exactamente una intención `productDeleteScope`, sin intentos de envío. La
base IndexedDB `balam_sync`, almacén `durable_queue`, estaba vacía.

ID autorizado: `62ba2e98-03f0-4605-94d1-5d46fbf4978b`.
SHA-256 de la operación:
`5ed045d1b6fc66bb3ba55dea63d77f1458ebb54ffebcd4d2d52bc09850bec78a`.
SHA-256 de la cola:
`a4bc68b9b3ead7b50bfef6ee6543c97ab3ac09e97e0f69a2f5b3686115048938`.

Las tres referencias objetivo ya tenían tombstones remotos del 05/09 a las
22:08:53 UTC. No había recibo de capacidad, venta, configuración ni movimiento
para ese operation_id. La existencia del tombstone no identifica por sí sola
qué operación lo produjo. Se conservó la baja confirmada sin reenviarla ni
revertirla.

## Diseño

Diagnóstico técnico sin secretos guardado antes de actuar: build observado,
protocolo, ambas épocas, conteo, ID, dominio, tipo, timestamps, hashes,
cuarentena, cursores y ubicación durable. No se conservó un payload ejecutable
ni se publicó como intención nueva.

La API `discardOperation` sólo admite operaciones bloqueadas. Para esta cola
de una sola intención se usó `STORE.clearQueue` únicamente después de validar
el ID y hash exactos, conteo uno, propietario activo, estado, cero intentos y
ausencia de otro respaldo/archivo durable. Así el conjunto retirado fue
exactamente el autorizado. No se falseó un bloqueo ni se hizo limpieza general
del navegador. Se verificaron memoria, localStorage e IndexedDB después.

La reconstrucción empleó el pipeline publicado de H148. No se modificaron
contratos, código de aplicación, esquema, permisos, épocas remotas ni datos
confirmados. No se ejecutó Punto Cero, reintento ni limpieza remota.

## Solución

C pasó de un pendiente a cero a las 13:52:14 UTC, preservando configuración,
identidad y época hasta iniciar la reconstrucción. Después se descargó el
HTML certificado, se activó el service worker actualizado y se cargó H148.
SHA-256 del HTML:
`2ef20021e02fb3d704eb8a314818fa18e40ae17148d74d460df68b33881a921d`.

`STORE.synchronizeNow()` completó rebootstrap y reconciliación a las 13:54:08
UTC. C quedó en época 7, protocolo 3, sin pendientes, conflictos ni dominios
por aplicar. La interfaz mostró «Todo actualizado». El proceso funcionó con
Realtime apagado. Después de recargar volvió a quedar actualizado y recuperó
la suscripción normal.

## Pruebas

Evidencia técnica local: `C:/tmp/balam-h148-evidence/fleet-*`.
Resumen verificable: [fleet28-recovery-progress.json](evidence/fleet28-recovery-progress.json),
marcado explícitamente como recuperación parcial, no certificado de flota.
Se utilizaron consultas SQL de lectura y una conexión CDP a la pestaña
original, limitada en las operaciones ejecutadas al origen BALAM.
Al finalizar la intervención local se desconectó CDP, se deshabilitó la
depuración temporal, se comprobó cerrado el puerto local y se dejó BALAM
abierto en su pestaña original.

- Diagnóstico previo, descarte exacto y persistencia: **1/1** autorizado en C;
  configuración e identidad conservadas; cola principal y respaldo vacíos.
- Rebootstrap real C: **PASS**, build `2026-09-07-h148`, época 7, protocolo 3.
- Comparación semántica de **12 colecciones** con las tablas remotas:
  productos, clientes, vendedores, ventas, promociones, devoluciones,
  liquidaciones, ajustes de comisión, pagos, cambios, préstamos y movimientos.
  Se aplicaron las transformaciones vigentes de STORE/DATA, incluidos colores
  canónicos, vendedor resuelto y reserva de stock consultada por RPC.
- Resultado: **973 referencias**, **251 familias**, **3,493 piezas**, cuatro
  clientes activos, cinco vendedores, ocho ventas, nueve pagos, una devolución,
  un cambio y 15 movimientos; sin diferencias en las colecciones comprobadas.
- Líneas históricas: ventas **12/12**, devolución **1/1**, cambio **2/2**;
  identidad física, importes y snapshots conservados.
- Configuración: **22 catálogos y 38 ajustes**, sin diferencias; permisos:
  **23 pantallas** contrastadas con el snapshot de la cuenta real.
- **V1 operativo 0**, todas las referencias operativas bajo barcode contract
  3; los tres tombstones respetados.
- Las **17 tablas comerciales** conservaron exactamente conteos y hashes,
  incluidos timestamps, antes y después de descarte y reconstrucción.
- Recarga real: cola cero, H148 y época 7 persistentes, «Todo actualizado»;
  la intención descartada no reapareció.

Una comparación inicial de filas crudas señaló representaciones diferentes de
colores, vendedor y reserva. El instrumento se corrigió para usar los
adaptadores y la consulta de reserva que usa el cliente; no se alteraron datos
ni se omitieron esos campos para obtener coincidencia.

## Riesgo residual y pendientes

**Descartadas físicamente: 1/28. A y B: recuperación automática preparada en H149.**
La instrucción posterior del propietario elimina la dependencia de acceso
remoto. Las dos directivas exactas están registradas desde las 15:00:10 UTC;
su cerco SQL bloquea replay identificado y peticiones antiguas sin origen.
No se editaron sus conteos para aparentar limpieza. El próximo uso de la build
actualizada capturará los originales, descartará 17+10 y reconstruirá cada
instalación; el recibo remoto certificará ese evento físico.

La instrucción posterior autoriza certificar y publicar mediante perfiles
aislados sin esperar a A/B. Sus pruebas viven en
`recuperacion-dirigida-h149.md`. CRUD multiequipo y operaciones nuevas siguen
**NO EJECUTADOS en las dos instalaciones físicas**; las simulaciones declaradas
no se presentan como visitas a Karolina o Z9ESB6.

No se detectó evidencia inequívoca de operación comercial real dentro de la
intención local inspeccionada. El único pendiente físico es su siguiente uso;
no se requiere acceso remoto ni intervención técnica de las vendedoras.

## Referencias

- `docs/03-known-risks.md#h-148`
- `docs/fixes/convergencia-autoritativa-h148.md`
- `docs/architect/decisions/ADR-014-autoridad-confirmada-cola-y-cache.md`
