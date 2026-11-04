# Mostrar u ocultar precio en todas las etiquetas

**Riesgo:** H-188
**Estado:** RESUELTO — commit local; publicación pendiente de autorización
**Fecha:** 04/11/2026
**Commit:** `9aac6637a5e76c954c00e0441ce771dc5d18ee92`

## Problema y reproducción

El propietario solicita un único switch «Mostrar precio en etiquetas» en
Configuración → Impresión, activado por defecto y persistente. LabelModal
tenía una casilla temporal iniciada en true al abrir; no existía el ajuste global.
Línea base: `node test-h99-label-pdf.mjs --before` 0/2 por default/control
ausentes; arnés PDF vigente antes de extenderlo 23/23. Es un contrato nuevo,
no un error de precios.

## Causa raíz

`LabelModal` guardaba withPrice en useState(true). `labelItem()` ya entregaba
precio o vacío al único SVG, al PDF y al documento imprimible; la preferencia
no pertenecía a CONFIG ni sobrevivía al desmontaje. El PDF también usa ese
mismo precio para su capa textual invisible.

## Diseño

`print.labelsShowPrice: true` utiliza `CONFIG.setSetting` → CORE → comando
config existente → confirmación online → CONFIG.load. No hay migración,
almacenamiento paralelo ni modificación de STORE/SQL/permisos. ADR-015 es el
contrato vigente; no se restaura la persistencia local-first histórica.
Como H-168, CONFIG.get devuelve el default sólo para un snapshot confirmado
sin clave, sin modificar ni volver a guardar ese snapshot.

El único CfgToggle reside en la sección Impresión existente y sustituye la
casilla temporal del modal. Selección individual/masiva, copias, preparación,
descarga, compartir y vista imprimible conservan sus rutas. La revisión comercial
incluye CONFIG.version: el listener existente cancela preparación y PDF obsoletos.
No se añade otra suscripción, caché o condición al renderizador.

La autoridad es la preferencia global, no una opción por producto/talla.
DATA.listPrice, DATA.materializedSku y BARCODES conservan sus contratos.
La preferencia se persiste; el precio impreso se deriva al generar. Ningún
documento existente, producto o precio se reescribe. Todas las terminales
consumen la configuración confirmada mediante su lectura habitual; las mismas
capacidades administran su edición. No se modifica el acceso de ningún rol.
La costura es labelItem y los consumidores comparten su salida; SQL, finanzas,
cola, inventario, descuentos y tickets quedan fuera. La evidencia comprueba
documentos completos y no sólo llamadas a imprimir. Este requerimiento no
necesita un nuevo ADR ni una regla preventiva: usa el mecanismo existente.

## Solución

- `balam/config.jsx`: default y compatibilidad con cuentas sin la clave.
- `balam/settings.jsx`: un CfgToggle y atributo estable para pruebas.
- `balam/inventory.jsx`: withPrice lee CONFIG; se retira la casilla temporal.
  labelSvg, LABEL_LAYOUT_CSS, raster y generadores permanecen intactos.
- `test-h99-label-pdf.mjs`: se extiende el arnés existente con los casos pedidos.
- `test-h167-label-performance.mjs`: la prueba recibe el ajuste global en lugar
  de desmarcar la casilla retirada. Esa recepción recertifica por el mecanismo
  vigente y conserva el techo de coste de apertura, más una lectura de
  productos por InventoryScreen.onCfg. Las garantías y el límite de raster
  por copia permanecen. No se refija ni modifica la línea base.

## Pruebas

- `node test-h99-label-pdf.mjs --before`: 0/2 antes del cambio.
- `node test-h99-label-pdf.mjs`: 28/28 sobre el bundle final. Default ON
  histórico sin escribir configuración; individual con/sin precio; SVG exacto
  eliminando exclusivamente el texto de precio. Lote de 881 copias
  (293 + 294 + 294), tallas 38/40/42, precios $850/$1,250/$12,345: todas las
  páginas HTML y PDF sin precio, incluidos sus JPEG y texto invisible;
  MediaBox 60×40, SKU y cantidades completos. Recarga real page.reload(),
  snapshot confirmado exterior al navegador, ajuste false conservado y cero
  escrituras adicionales. Documentos consecutivos individual/masivo y cierre
  de ventanas mantienen el recorrido existente.
- `node test-h164-online-ui.mjs`: 6/6; `node test-h164-online-pwa.mjs`: 2/2.
- `node test-h167-label-performance.mjs`: 61/61 escenarios funcionales.
  La comparación inicial dio 92/94: el nuevo evento CONFIG registra cuatro
  lecturas de productos frente a tres al abrir. Se ajustó exclusivamente esa
  expectativa por la lectura existente de InventoryScreen.onCfg. El bloque
  real final de comparaciones, ejecutado sobre las mismas mediciones y con
  SHA-256 de artefacto comprobado, pasó 94/94: conjunto 155/155 sin repetir
  escenarios ni cambiar el baseline. Evidencia tracked anterior restaurada.
- `node build-offline.mjs`: exit 0; HTML principal y alterno idénticos.
- Comparación del bloque completo de constantes, SVG, CSS y generadores de
  etiquetas contra HEAD anterior: idéntico. `git diff --check`: aprobado.

La primera ejecución del candidato detectó `C is not defined` en LabelModal;
se corrigió a window.CONFIG y se reconstruyó antes de los resultados finales
anteriores. No se atribuye aprobación al artefacto fallido.

SHA-256 HTML final:
`0c3e748d666a873db4d6da0686e1fe12d51c96975629691aec7db3993355721e`.
Service worker:
`299c629e0de109940cc0790651fc1c11c7dfbd789926abc5692a6e9f729f73a1`.

## Riesgo residual y pendientes

Impresión física NOT_TESTED. Persistencia/recarga se comprueba con confirmación
remota simulada; certificación distribuida A/B/C NO CERTIFICADO, no solicitada.
El cambio no requiere modificar datos remotos durante la entrega.

## Entrega

Commit local y artefactos regenerados. La revisión automática rechazó
`git push origin main`: requiere autorización explícita para modificar la
rama compartida y activar su publicación. No hubo push ni despliegue; por
tanto no se atribuye verificación pública ni ejecución CI a este cambio.
Se conserva la entrega local solicitada y la evidencia de pruebas anterior.

## Referencias

- `docs/03-known-risks.md` — H-188.
- `docs/02-architecture.md` — CONFIG y etiquetas.
- `jerarquia-visual-etiqueta-60x40.md`, `sku-materializado-en-etiquetas.md`.
- `h171-etiquetas-a-peticion.md`, `pagina-web-tickets-h168.md`.
