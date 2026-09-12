# Confirmaciones pendientes sin ocultar la aplicación

**Riesgo:** H-169
**Estado:** RESUELTO en interfaz; publicado y verificado
**Fecha:** 12/09/2026
**Commit técnico:** `8c037f091ed1b6729a141e10a02873cf44741153`

## Problema y reproducción

Con sesión autorizada y una pantalla ya cargada, capturar texto y emitir un
estado comercial no disponible/pendiente. El artefacto de main `88287db` oculta
el formulario y presenta una página blanca con «Estamos confirmando la operación.
No la repitas.». La captura permanece montada, pero invisible e inerte. Si hay
una referencia sin resultado terminal, tampoco aparece consulta manual.

Reproducción sobre el HTML publicado H-168: `BALAM_UI_CASE=Conexión
BALAM_TEST_OUTPUT=docs/fixes/evidence/h169-before node test-h164-online-ui.mjs`:
**0 PASS / 1 FAIL**, «Una confirmación no debe ocultar la captura».
JSON y captura en `evidence/h169-before/` (SHA del HTML registrado).

## Causa raíz

App usa `startupGate` tanto para el arranque/autorización como para cualquier
`!ready`, `hasUnresolvedRequests`, error o consulta posterior. Esa función
clona el shell con `inert`, `aria-hidden` y `visibility:hidden`, y superpone un
aviso fijo. La confirmación se trata como trabajo activo y suprime el botón.
La espera puede durar indefinidamente mientras el servidor no tenga un recibo
terminal: no demuestra que una operación haya fallado ni autoriza reenviarla.

Flujo vigente revisado: formulario → DATA/CONFIG → STORE.execute → referencia
técnica → comando → recibo → snapshot → resolución del await del formulario.
El ciclo periódico y la consulta manual resuelven referencias; no reproducen
el comando. La causa del bloqueo visual está en App, no en ese protocolo.

## Diseño

- Después de cargar datos y autorizar al usuario, el estado comercial sólo
  informa dentro del contenido. La pantalla conserva identidad React, captura,
  foco y navegación mientras se consulta o espera.
- La consulta utiliza `STORE.init()` vigente, sin ejecutar otra venta/guardado,
  con su coalescencia, recuperación y validación de permisos existentes.
  Sólo su botón espera; no se habilita durante el envío comercial activo.
- No hay éxito anticipado, borrado de referencias, nueva cola, cambios de
  autoridad, modificaciones SQL ni cambios en documentos históricos.
- El arranque sin datos y la autorización pendiente/rechazada conservan su
  control de acceso. Otra identidad no hereda una pantalla anterior. La
  revalidación de acceso puede conservar el formulario oculto para recuperarlo,
  sin autorizar el acceso con permisos no verificados.

## Solución

Única fuente funcional modificada: `balam/app.jsx`. El estado comercial
posterior presenta una franja con «Confirmación pendiente» y «Consultar estado».
Un envío activo muestra «Guardando…»; la cabecera ya no anuncia «Todo actualizado»
si existe una confirmación pendiente. Las consultas fallidas permiten volver a
consultar sin ocultar el formulario. El arranque con referencia pendiente también
ofrece consulta; se elimina la superposición fija del aviso.

Se actualizan los arneses H-164 que antes exigían explícitamente ocultar la
captura. El transporte añade una comprobación de rechazo de un segundo comando
durante la espera, con el contador de envíos sin aumentar. Los tres arneses ya
pertenecen al workflow obligatorio, por lo que H-169 queda protegido en CI.
HTML y service worker regenerados exclusivamente desde fuente.

## Pruebas

| Comando | Resultado |
|---|---|
| `node build-offline.mjs` | exit 0, ambos HTML idénticos |
| `node test-h164-online-ui.mjs` | 6/6 sobre artefacto final |
| `node test-h164-online-pwa.mjs` | 2/2 sobre artefacto final |
| `node test-h164-startup-app.mjs` | 7/7, AUTH real con transporte controlado |
| `node test-h164-online-transport.mjs` | 13/13, incluye segundo comando rechazado y recuperación del await original |
| `node test-h164-online-account.mjs` | 1/1, respuesta perdida sin duplicar Auth/perfil |
| `node test-h164-online-config.mjs` | 3/3 CONFIG/AUTH/PWA |
| `node test-h164-online-architecture.mjs` | exit 0; 28 módulos, fronteras vigentes |
| `git diff --check` | exit 0 |

UI final verifica: mismo nodo DOM y una sola montura mientras cambia el estado;
captura editable y enfocable durante envío, recibo pendiente y error; consulta
rechazada recuperable y segunda consulta correcta; aviso retirado al confirmar;
navegación a Clientes en escritorio y regreso al POS en móvil de 390 px. Los
otros cinco casos conservan cajones, etiquetas PNG/PDF, Excel e impresión
histórica. No se escriben operaciones comerciales remotas.

Evidencia final: `evidence/h169-after/online-ui.json`, `startup-app.json`,
`online-pwa.json` y capturas escritorio/móvil. La pantalla POS de la prueba
contiene un input controlado para demostrar continuidad de captura; Clientes
y el shell son los componentes reales del bundle.

SHA-256 del HTML final:
`608541d6d0eb85040c95e780704dddb8d80056beb969447ed66ea8c27025cc41`.

## Riesgo residual y pendientes

Supabase real A/B/C y terminal física **NO CERTIFICADO** para este artefacto. No se
modifican STORE, AUTH, SQL ni permisos; esta corrección no garantiza un plazo
para que una operación remota desconocida alcance su resultado terminal.
Las restricciones comerciales siguen activas mientras el resultado sea incierto.
Una pestaña que conserve el cliente anterior necesita adoptar la actualización.

## Publicación

Commit técnico subido a main. Actions `34725515390`: regresiones y Pages
**SUCCESS**, incluyendo H-164, navegación H-166, etiquetas H-167 y tickets H-168.
La certificación live no se ejecutó. Ambos HTML y el service worker públicos
respondieron HTTP 200 y coincidieron byte a byte con el commit: **3/3**.
Evidencia: `evidence/h169-workflow.json` y `evidence/h169-publication.json`.
No se aplicaron migraciones ni se modificaron operaciones comerciales reales.

## Referencias

- `docs/03-known-risks.md`, H-169.
- `docs/02-architecture.md`, STORE y syncStatus.
- `docs/fixes/refresco-permisos-sin-intermitencia-h158.md`.
- `docs/architect/playbooks/client.md`, `synchronization.md`, `delivery.md`.
