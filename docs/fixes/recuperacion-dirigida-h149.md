# H149 — Recuperación dirigida de pendientes de prueba

**Riesgo:** H-149. **Fecha:** 08/09/2026.
**Estado:** RESUELTO; publicado y verificado. Recibos físicos de A/B pendientes de su próximo uso.
**Commit:** `2fc891242809261e861f8ecdc7730293442b649f`.

## Problema y reproducción

El propietario autoriza descartar los pendientes de prueba de dos dispositivos
exactos (10 y 17), sin acceso físico. La recuperación local C ya cerró 1/1;
su evidencia permanece en `recuperacion-flota-real-28-pruebas.md`.
La reproducción contra HEAD anterior falla **0/7**: envía las colas simuladas
y no ofrece consumo durable de una directiva.

## Causa raíz

La consulta remota de contratos y actividad confirma que H142/H148 sólo tienen
reintentos por operación, no una directiva durable de descarte y reconstrucción.
Las RPC de venta no reciben device_id: bloquear sólo por dispositivo en el
cliente deja abierta su ejecución por builds antiguas. La cuenta es compartida
por diez dispositivos; bloquearla completa afectaría equipos ajenos.
La actividad se reporta asincrónicamente: una venta todavía no reportada tampoco
puede quedar fuera del cerco. El heartbeat informa la época del equipo, que no
necesariamente coincide con la época congelada de cada operación antigua.

## Diseño y matriz de ciclo completo

Se extiende el control de sincronización con una directiva por dispositivo,
autorización administrativa, época/protocolo, IDs candidatos congelados,
captura técnica sin payload y recibo de finalización. La actividad histórica de
Karolina contiene 12 candidatos (dos upserts posiblemente coalescidos); no se
presenta ese conteo como su cola actual de 10. El arranque captura el subconjunto
exacto antes de eliminarlo. Una divergencia conserva la cola y la directiva.

| Etapa | Contrato y prueba |
|---|---|
| Identidad/autorización | ID exacto y propietario activo; otros equipos intactos |
| Servidor legacy | Guardar IDs antes de ACK/RPC y device_id en escrituras directas |
| Arranque/UI | Puerta antes de flush y mutación; mensaje humano y reintento automático |
| Evidencia | IDs, tipo, época/protocolo y hash; sin credenciales ni payload comercial |
| Descarte | Subconjunto autorizado, prueba durable LS/IDB, reinicio tras fallo |
| Reconstrucción | Reutilizar rebootstrap H148, pull completo y cursores confirmados |
| Finalización | Servidor verifica época y versiones; token habilita nuevas operaciones |
| Repetición | Directiva consumida no borra cola nueva; IDs antiguos siguen rechazados |
| Consumidores | V1/V2, históricos, stock, permisos y configuración legítima preservados |

## Solución

`pos.sync_device_recoveries` agrega exclusivamente control operativo. El ciclo
es `pending → captured → completed`, con propietario activo, autorización,
conteo y candidatos congelados. Las RPC financieras verifican antes del ACK;
los triggers protegen escrituras directas y bajas con permisos del invocador.
Los originales que una build anterior archivó pueden aportar su evidencia;
una discrepancia conserva las operaciones ajenas y la directiva pendiente.

Los clientes actuales identifican cada petición. Un cliente antiguo puede
identificarse mediante actividad inequívoca o el contexto de su RPC. Una
petición sin origen de una cuenta con recuperación exige actualización antes
de ejecutar. Los otros equipos siguen escribiendo al identificarse; no se
bloquea la cuenta completa. El primer control exige red y las instalaciones
ya comprobadas conservan funcionamiento offline.

STORE comprueba el recibo antes de modificar la cola, su durabilidad real en
localStorage/IndexedDB y la reconciliación antes de finalizar. Una copia vacía
sólo en memoria no certifica descarte. El recibo habilita nuevas escrituras;
los IDs antiguos siguen rechazados y una directiva consumida no borra otra cola.

DATA/CONFIG bloquean captura mientras la proyección se reconstruye. La interfaz
muestra «Estamos actualizando la información de este equipo.» y después «Todo
actualizado. Puedes continuar trabajando.». La espera ofrece «Actualizar ahora»;
una build incompatible, «Actualizar BALAM» usando el mecanismo PWA existente.
Se preservan cookies, sesión, configuración compatible, V1/V2 e históricos.

Migraciones **20260908018400–20260908019100** aplicadas antes del cliente.
Las funciones se generaron desde `pg_get_functiondef` con guardas MD5 de origen.
La primera prueba HTTPS detectó una baja con permisos del invocador llamando a
un helper privado. 190/191 restauran exactamente su función original y verifican
la barrera por trigger, sin elevar permisos ni abrir el helper a authenticated.
No se reescribió ninguna migración aplicada; no hubo exposición ni pérdida.

Directivas registradas el **08/09/2026, 15:00:10 UTC**:

| Equipo | ID exacto | Pendientes autorizados | Directiva |
|---|---|---:|---|
| Karolina | `dev-ms3il7ts-7jsbewuw` | 10 | `70c1d6b8-5ce0-4cbb-b6e2-3f393d1e46b8` |
| Z9ESB6 | `dev-mtov9u6i-lvz9esb6` | 17 | `4ddd6086-3b27-4d1a-8bff-27ebd27699d7` |

Ambas permanecen `pending`, con mínimo `2026-09-08-h149`. No se falsearon conteos
ni estados sincronizados. Registrar las directivas conservó los hashes exactos
de las **17 tablas comerciales**, incluidos timestamps. El cerco comprobó los
29 candidatos observados y rechazó también una venta antigua no reportada.
Evidencia: [h149-server-recovery.json](evidence/h149-server-recovery.json).

## Pruebas

- `node test-h149-directed-recovery.mjs`: **15/15**, incluyendo 10/17, errores de
  captura/recibo, reinicio, doble fallo durable, épocas antiguas, archivo previo,
  pestaña sin lease, segunda ejecución, operación nueva y captura offline
  durante caída de API sin permitir uploads ni degradar permisos.
- `node test-store-queue.mjs`: **186/186**. El arnés declara la nueva RPC sin
  directiva y espera el envío real de perfil en lugar de una espera de 40 ms.
- H148: reconciliación **15/15**, durabilidad **32/32**; módulos **42/42**;
  concurrencia, QA H142 **5/5** y foco/UI Centro de equipos **20/20**.
- H63 **34/34**, configuración objetivo **30/30**, permisos **13/13**, AUTH
  **19/19**, sesión **14/14**, PWA **19/19**, identidad H132 **7/7**, migraciones **31/31**.
- Smoke de interfaz **15/15** y responsive **492/492**. La matriz SQL de
  20 comprobaciones se repitió contra el estado final y pasó.
- SQL real: matriz inicial de **20 comprobaciones**; época antigua, origen
  desconocido, otro equipo permitido y baja con rol authenticated real.
  Los fixtures se revierten dentro de cada prueba.
- Matriz HTTPS/Chrome de desarrollo **23/23**, tres perfiles, arranques 10/17,
  cero replay, operación nueva, ocho tamaños de pantalla y todos los flujos H148.
  La limpieza de fixtures conservó el estado comercial previo.
- Certificación exacta del artefacto de publicación: **23/23**, tres perfiles
  nuevos y **16/16 dominios**. Ambos ciclos reconstruyen proyección alterada,
  mantienen veraz Centro de equipos y conservan hashes comerciales exactos
  durante la recuperación, incluidos timestamps.
  Certificado: [h148-live-matrix.json](evidence/h148-live-matrix.json).
  HTML SHA-256: `49aabdb7513d88b1548f8a22930281d25016d5d8eab1902bcff4037582c73e15`.

## Publicación

Build `2026-09-08-h149` publicada el **08/09/2026** en
[GitHub Pages](https://david14081982.github.io/POS_Balam/).
`index.html`, HTML offline y `sw.js` coinciden byte a byte con `2fc8912`.
Chrome público a 320/1280 muestra acceso correcto, sin overflow ni errores
de ejecución. Evidencia: [h149-publication.json](evidence/h149-publication.json).

- [CI de sincronización aprobado](https://github.com/David14081982/POS_Balam/actions/runs/34248994821).
- [CI de identidad aprobado](https://github.com/David14081982/POS_Balam/actions/runs/34248994879).
- [Despliegue aprobado](https://github.com/David14081982/POS_Balam/actions/runs/34248993368).

La implementación queda cerrada. Las dos directivas reales permanecen
pendientes hasta su consumo; no se certifica ejecución física anticipada.

## Riesgo residual

No existe acceso físico a A/B. Su cierre operativo exige el recibo real del
próximo arranque, sin requerir acceso remoto ni intervención técnica.
Si la evidencia no coincide con la autorización, no se descartan operaciones
ajenas. Las builds antiguas ya ejecutándose no pueden adquirir una
interfaz nueva por SQL: reciben rechazo humano del servidor y requieren abrir
la actualización. No se eliminan datos comerciales remotos.

## Referencias

- `docs/03-known-risks.md`, H-149.
- `docs/02-architecture.md`, Sincronización.
- `docs/fixes/recuperacion-flota-real-28-pruebas.md`.
- Evidencia local: `C:/tmp/balam-h148-evidence/h149-*`.
