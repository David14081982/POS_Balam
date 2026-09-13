# H171 — Superficies, autoridades y cobertura de entrega BALAM

Fecha de revisión: 12/09/2026 Hermosillo. Base: `c148a8c`, rescatada de
`.h161-release` al worktree `.work/balam-final-readiness`. La copia antigua en
la raíz del workspace no describe el producto publicado actual.

## Autoridades y límite del resultado

Architecture Navigator: `docs/architect/README.md` → `PHILOSOPHY.md`,
`THINKING.md`, `WORKFLOW.md`, playbooks cliente/sincronización/entrega y
autoridades ventas/inventario/seguridad/sincronización. ADR-015 sustituye
local-first para operación comercial. La metodología de ocho etapas y
`docs/02-architecture.md` siguen vigentes.

Supabase BALAM (`telohdbvbvsfmwyriflz`, esquema `pos`) es la única autoridad
comercial. `STORE.execute` (`balam/store.jsx:217`) comprueba conexión/actor,
espera recibo terminal y lectura remota antes de devolver éxito (`:265`).
`DATA.confirmCommand` (`balam/data.jsx:1019`) exige confirmación; las colecciones
son proyecciones efímeras, sin cola comercial ni almacenamiento de negocio local.
Una referencia técnica incierta contiene identidad, no un payload para replay.

Clasificaciones: **READY** = implementación conectada y evidencia del alcance
indicado; **PARTIAL** = cobertura o condición de entrega pendiente; **BROKEN** =
comportamiento contradice un control/contrato demostrado; **DEAD-UNUSED** = ruta
retirada o sin consumidor; **QA ONLY** = instrumento/fixture, no función de venta;
**UNKNOWN** = no hay evidencia suficiente. READY técnico no certifica hardware.

La certificación histórica H170 corresponde al HTML
`ae53f13541729ecb3fff768d4a974a44fd5fe790f7d7961d6fde1dd28801665d`.
`h170-live-matrix.json` conserva 22 escenarios distintos finalmente aprobados y
cuatro intentos fallidos/reanudados. Su alcance explícito son APIs de dominio
en tres navegadores contra Supabase más pantalla offline/recuperación; la
regresión visual se conserva separada. No equivale a 26 intentos sin fallos,
a recorrer todos los formularios ni a adoptar las tres cajas físicas.

## Matriz ENTRY / ACTIONS / BACKEND / PERSISTENCE / RESULT

Rutas/líneas referidas a la base H170; una modificación posterior debe contrastar
el módulo y el artefacto final. Todas las pantallas vienen de `balam/screens.jsx:4`.

| Superficie y clase | ENTRY | ACTIONS existentes | BACKEND / autoridad | PERSISTENCE | RESULT observado o límite |
|---|---|---|---|---|---|
| Panel — PARTIAL | `screens.jsx:5`, `dashboard.jsx:44` | KPIs; accesos venta, clientes, catálogo, reportes y abonos; cumpleaños | DATA sobre snapshot confirmado | Memoria; preferencia de navegación técnica | Montaje/navegación; no certifica exactitud de todos los KPIs por sí solo. H171 corrige recorte de Mensual a 430 px y retira Enviar felicitación sin handler, preservando la lista |
| POS — READY técnico / PARTIAL físico | `screens.jsx:6`, `pos.jsx:281` | Catálogo/familia/talla, cliente, vendedor, descuentos, cobro y ticket | `DATA.recordSale` → venta SQL, stock, pagos y comisión | Recibo + documento remoto; lectura antes de éxito | H170: venta/cobro/comisión, respuesta perdida, última pieza concurrente PASS; papel físico pendiente |
| Inventario individual/familiar — READY técnico | `screens.jsx:7`, `inventory.jsx:116` | Nuevo, editar, baja exacta/familiar, reclasificar | `saveProductRows`/`saveProductFamily`/`removeProductScope`; gateway SQL con versión e identidad | `products`, tombstones, reclasificación/movimientos | H170: V2/V3, CAS obsoleto, baja concurrente y reclasificación PASS |
| Excel Inventario — PARTIAL | `inventory.jsx:172`, `:187` | Plantilla, exportar, importar, revisar plan y confirmar lote | `XLSXIO.planImport` sin mutación; `saveProductRows` al aceptar | Archivo exportado + escritura remota confirmada | UI H164 prueba preflight/export; H163 tiene round-trip específico; A/B/C Excel completo H170 no consta |
| Etiquetas/fotos — PARTIAL | Inventario → Etiquetas/imagen | Preview, PNG, PDF, imprimir, guardar URLs | `BARCODES.certifySellableReference`; `STORE.uploadImage` (`store.jsx:1096`) | Storage `barcodes`/`product-photos`; metadata por comando | H167 performance/lifecycle/resolución; H168 PDF/contacto. Upload real y lector/impresora pendientes |
| Clientes — READY técnico / PARTIAL visual | `screens.jsx:8`, `clients.jsx:81` | Alta, edición, baja, búsqueda e historial | `data.jsx:3580`, `:3590` → operaciones exactas de cliente | `clients` versionado + snapshot | H170 cliente/perfil PASS tras timeout conservado; smoke no valida guardado |
| Apartados — READY técnico / PARTIAL producto | `screens.jsx:9`, `layaway.jsx:310` | Anticipo POS, abono, liquidación, cartera y comprobantes | `registrarPagoApartado`; `data.jsx:2165`, `:2194` → commit SQL | Venta/pagos/stock y comisión confirmados | H170 abonos concurrentes/liquidación PASS; no reserva al crear (`layaway.jsx:154`); cancelación/reembolso anticipo no están implementados |
| Préstamos — READY técnico / PARTIAL visual | `screens.jsx:10`, `loans.jsx:128` | Entrega, devolución parcial/total, faltante, editar, baja, vale/exportar | `data.jsx:4029`, `:4075`, `:4092`, `:4117`, `:4126` → loanOperation | `loan_documents` completo + auditoría y versión | H170 préstamo/devolución concurrente PASS; humo en rama vacía; vale físico pendiente |
| Devoluciones/Cambios — READY técnico / PARTIAL físico | `screens.jsx:11`, `returns.jsx:305`, `:665` | Folio, saldo por renglón, motivo, piezas, reembolso/diferencia y ticket | DATA y autoridades SQL saldo/plazo/valor histórico; commit transaccional | Documento, stock, pagos y comisión en SQL | H170 saldo concurrente de devolución/cambio PASS; papel real pendiente |
| Descuentos — READY técnico / PARTIAL visual | `screens.jsx:12`, `discounts.jsx:187`, `:311` | Alta, edición, pausa, eliminación y preview | PROMOS/`resolveLineDiscount`; comandos promociones/config | `promotions`, settings/lookup confirmados | H170 promoción/config aislada PASS; todas combinaciones visuales no recorridas |
| Vendedores/comisiones — READY técnico | `screens.jsx:13`, `sellers.jsx:86` | Consulta, liquidación, cierre/ajuste y políticas | `data.jsx:2212`, `:2221`, `:2980` → ledger y RPC específicas | `liquidations`, ajustes y documentos históricos | H170 liquidación PASS. H69 ya conectó política efectiva; no elevar la nota antigua H31 a fallo actual |
| Reportes — PARTIAL | `screens.jsx:14`, `reports.jsx:132`, `:341`, `:443` | Resumen, ventas/devoluciones/cambios/métodos, filtros, Excel, A4/80mm | `revenueSummary`, `exchangeReport`, `sellerCommissionReport`, `paymentMethodReport` | Lectura de snapshot; documentos de exportación | H164 reimpresión histórica sin mutar PASS; humo de entrada no certifica conciliación completa |
| Config tienda/catálogos/ventas/beneficios/devoluciones/clientes/impresión — PARTIAL | `screens.jsx:17`–`:28`, `settings.jsx:34` | Campos, catálogos, logo, SKU, tallas, beneficios y contacto web | CONFIG 14 mutadores async → gateway config; `store.jsx:199` | `settings`/`lookup` versionados y snapshot | Conectado online. H171 retira seis controles sin efecto; evidencia específica en `h171-controls.md`. El humo no prueba todos los guardados |
| Usuarios/permisos — PARTIAL | Config → usuarios/permisos | Cuenta/perfil, rol, estado, matriz de visibilidad | Edge `admin-users`, `online_account_requests`, `AUTH`, RLS/capacidades | Auth + perfil + recibo servidor | H170 creación/permiso/arranque pendiente PASS; eliminación Auth original aún no terminal. Recorte de tabla a 320–1024 px reproducido; H171 añade región desplazable y cabecera adaptable |
| Administración/Datos/Punto Cero — PARTIAL | `settings.jsx:1732`, `store.jsx:1054` | Modo, diagnóstico, preview, respaldo, confirmación y recibo | `point_zero_preview`/execute y limpieza selectiva SQL | Respaldo/auditoría remotos; sin borrado local | SQL aislado y verificación remota reversible; H170 no purga tienda. Humo usa fixture PRODUCCIÓN, botones destructivos bloqueados |
| PWA/login — READY técnico / PARTIAL físico | App/login/topbar | Ingreso, instalación, actualización y recuperación | Auth remoto; `PWA`; STORE/adopción | Tokens/técnica y caché shell; ningún negocio offline | UI/PWA/adopción técnicas; puestos físicos completos no certificados |
| Demo local antiguo — DEAD-UNUSED histórico | No hay `DemoPanel` productivo | Generación anterior retirada | Sin ruta comercial local nueva | Historia conservada en repositorio | `config.demo` ahora significa Administración/Datos, no generación QA |
| Pruebas y fixtures — QA ONLY | `test-*`, `qa-*`, evidencia | Ensayos con stubs o live opt-in | Instrumentos, no autoridades de negocio | Evidencia declarada | Las suites local-first históricas no son criterio del producto Only Online |

Detalle de las doce entradas de Configuración (`PANELS`, `settings.jsx:1491`):

| ENTRY | ACTIONS | BACKEND / PERSISTENCE | RESULT de esta revisión |
|---|---|---|---|
| `config.negocio` | Equipos/historial, manual, logo, contacto, prefijo; IVA fijo informativo | Registro remoto de dispositivos; CONFIG → settings; documento PDF | PARTIAL: montaje y lecturas fixture; retiro de equipo, subida y guardado no ejecutados |
| `config.producto` | Orden SKU, diagnóstico, migración de tallas, Excel y catálogos estructurales | CONFIG lookup/settings; planes de importación; comandos explícitos de inventario | PARTIAL: montaje con catálogo válido; migraciones/importación no accionadas |
| `config.ventas` | Métodos, estados, validación de existencias y umbrales | CONFIG lookup/settings y consumidores POS/DATA | READY técnico para navegación; guardados evaluados por suites específicas, no por humo |
| `config.beneficios` | Límites/desactivación de descuento manual, beneficios y tarjetas | CONFIG catálogo; snapshot de beneficio en documento y validación SQL | PARTIAL: editor montado; redención real no ejecutada aquí |
| `config.devoluciones` | Motivos, plazo y reversión de comisión | CONFIG; política conservada en venta y validación SQL | READY técnico por implementación/H170; humo no altera política |
| `config.vendedores` | Escalera/base de comisión, meta, rol, margen y bono informativo | CONFIG; autoridad de comisión DATA/SQL, documentos históricos | READY técnico con límites del bono expresos |
| `config.clientes` | Catálogos de fit, preferencias de tela y prefijo telefónico | CONFIG lookup; formularios CRM | PARTIAL: montaje; edición de todos los catálogos no ejecutada |
| `config.inventario` | Vaciar con guarda, migrar fotos y tipos de movimiento | Comandos remotos/Storage; nada se elimina en memoria como éxito | PARTIAL: diagnósticos fixture; purga/subida no ejecutadas |
| `config.impresion` | Historial de impresiones, autoimpresión, pie y website | CONFIG settings; cola técnica de impresión; documentos confirmados | PARTIAL: preview/contrato técnico; papel real pendiente |
| `config.usuarios` | Alta/edición, estado y acceso al perfil | DATA/Edge/Auth; perfil y recibo remoto | PARTIAL: controles responsive comprobados con callback aislado; Auth real requiere evidencia separada |
| `config.permisos` | Buscar usuario, matriz, herencia, guardar cambios | RPC admin de permisos; RLS/capacidades | PARTIAL: catálogo/editor cargados con adaptador readonly; guardado real no ejecutado aquí |
| `config.demo` | Diagnóstico, modo, preview/respaldo/ejecución de Punto Cero y limpieza selectiva | RPC con tokens/guardas, respaldo/auditoría SQL | PARTIAL: producción fixture, cero ejecución destructiva |

## Evidencia de navegación H171

Instrumento reproducible: `qa-h171-surface-smoke.mjs` en la raíz del worktree.
Resultado final detallado: [h171/final-smoke/matrix.json](h171/final-smoke/matrix.json).
Matriz legible, 24 entradas por ocho anchos:
[h171/final-smoke/coverage.md](h171/final-smoke/coverage.md).
Captura por superficie/ancho en la misma carpeta. Se prueba el HTML inmutable
cargado al arrancar el arnés. El JSON registra su SHA-256; la prueba no incorpora
cambios de fuente o build posteriores al arranque.

Fixture explícito, sin datos de otras fuentes: una referencia V2 con stock 3,
un cliente registrado y el genérico obligatorio, vendedor y administrador,
venta pagada, apartado y pago coherente.
Préstamos, devoluciones, cambios, promociones y liquidaciones están vacíos.
La administración recibe un diagnóstico artificial de PRODUCCIÓN; permisos
recibe un catálogo que coincide con SCREENS y un administrador de prueba.
Todos los destinos externos se abortan; Auth/lecturas de STORE son adaptadores
en memoria. La prueba registra intentos de escritura y compara DATA/CONFIG.
No acciona guardar, cobrar, eliminar, importar, Punto Cero ni publicar.

Cobertura ejecutada: login + 11 pantallas + 12 secciones, en
320/360/390/430/768/1024/1280/1440 px: 192 superficies. Altura 844 móvil y 900
desde 768 px. Screenshot es del viewport; las secciones largas requieren scroll
para ver contenido inferior. La medición enumera overflow del documento y
elementos visibles fuera de un contenedor deliberadamente desplazable.
Un contador de campos sin label programático es señal para revisión, no informe
axe ni prueba completa de accesibilidad. Firefox/WebKit/axe/hardware NOT_TESTED.

El primer intento se interrumpió por fixture incompleto: `serverNow` no estaba
simulado y `FolioPrefixField` rechazó Configuración. Se conserva
`h171-smoke/harness-incomplete-missing-clock.json`. Se corrigió sólo el arnés;
no es fallo atribuido al producto ni resultado aprobado. Un segundo intento,
conservado en `harness-incomplete-generic-client.json`, omitió el cliente genérico
que exige `pos.jsx:72`; falló al montar el TicketPanel de escritorio. El fixture
se completó usando el contrato de `test-h70-clientes-ventas.mjs:115`.

El primer pase completo, sobre candidato H171
`1c2f9866e009924f5bba8f2edd38edaa617c3b8ca413018eaceaa168d93cae5a`,
renderizó 192/192 sin errores JavaScript ni overflow global. La inspección visual
reveló que esa métrica excluía controles recortados por `overflow-hidden`. Se
amplió el instrumento: `h171-clipping-before/matrix.json` conserva 192 renders,
185 sin observación y siete filas para revisión. Seis corresponden a Usuarios
(320/360/390/430/768/1024) y una a Panel (430). No se presenta el primer contador
como aprobación visual completa.

Usuarios ocultaba Editar y Activar/Desactivar; a 768 también recortaba Agregar.
La cabecera ahora envuelve su contenido y la tabla usa una región con scroll
horizontal, foco y nombre accesible, siguiendo `inventory.jsx:389` y
`clients.jsx:159`. El selector del gráfico del Panel conserva su lógica y ahora
envuelve la cabecera y evita comprimir los botones.

`test-h171-users-responsive.mjs --source` prueba ambos cambios en App real con
fixture aislado: ocho anchos, scroll horizontal con teclado, hit-test y visibilidad
completa de los controles; lee ambos estados, abre alta y ediciones, comprueba
los callbacks de activación sin mutar DATA, y alterna gráfico mensual/semanal
con 6/7 barras. Este alcance no equivale a guardar un usuario en Auth real.
También comprueba que un cumpleaños sembrado sigue visible y que la tarjeta
ya no ofrece «Enviar felicitación», botón sin handler en el artefacto previo.
La captura `h171-clipping-before/1440-dashboard.png` conserva esa promesa vacía.
Un primer fixture sin contexto de comisiones se rechazó antes de montar la
pantalla; se conserva en `h171-users-responsive/harness-incomplete-commission-context.json`.

Prueba final del bundle ejecutada de 02:32:57 a 02:35:28 UTC del 13/09/2026
(12/09/2026 en Hermosillo), SHA-256
`cf32a52c56c5cacadc536bc151993f2efc5bcebbd2608089cee0a0bc92139437`:

| Evidencia final | Resultado |
|---|---|
| Login + 11 pantallas + 12 secciones × 8 anchos | 192/192 renderizadas |
| Error JavaScript / consola | 0 / 0 |
| Overflow global / controles recortados visibles | 0 / 0 |
| DATA y CONFIG conservados | 8/8 contextos |
| Intentos de escritura del humo / destinos externos autorizados | 0 / 0 |
| Claves locales comerciales detectadas | 0 |
| Prueba responsive sobre bundle, sin `--source` | 8/8 anchos aprobados |

[La prueba funcional responsive](h171/final-responsive/matrix.json) tiene el
mismo hash del bundle: abrió ocho altas y 16 ediciones, leyó 16 estados,
alcanzó 16 callbacks de activación aislados y alternó 16 veces el gráfico.
DATA quedó intacta. Ocho comprobaciones conservaron la lista de cumpleaños y
confirmaron ausencia de la acción sin implementación.

Se inspeccionaron visualmente
[Usuarios a 320 px, después de desplazar la tabla](h171/final-responsive/320-users-actions.png)
y [Panel a 430 px con Mensual activo](h171/final-responsive/430-dashboard-monthly.png).
Los controles aparecen enteros; Agregar adapta la cabecera. Hay 192 capturas
finales de navegación y 16 de controles responsive. Las capturas previas se
conservan en `h171-clipping-before/`.

## Bloqueadores y pendientes acotados

1. En la base, seis controles prometen comportamientos sin lector en cliente ni
   SQL: currency, pos.askSize, pos.allowLayaway, commission.auto, pos.sound y
   print.lowStockAlert. Únicos usos son default/control/semilla; H40 ya documentó
   allowLayaway. Retirados por H171; contraste final registrado en `h171-controls.md`.
   commission.bonus se declara expresamente informativo y no es un séptimo fallo.
2. Adopción física completa y hardware no certificados: 1/3 observada en H164;
   dos puestos y evidencia legacy exacta aún requieren inspección.
3. H170 conserva gestión Auth original sin resultado terminal. La mejora permite
   operar con snapshot confirmado, no fuerza ni afirma su eliminación.
4. Timeouts remotos observados en H170 y recuperados por continuación; no hay
   prueba nueva en este documento que declare su causa o corrección.

Los recortes Usuarios/Panel se corrigen en H171 con la reproducción y prueba
descritas arriba. No se crean nuevas historias. Matriz remota y
verificación de producción corresponden al informe principal H171.

## Regresión vigente

El workflow `.github/workflows/h164-online-authority.yml` ejecuta arquitectura,
migraciones, SQL PGlite, transporte, adopción, arranque, DATA, CONFIG, cuenta,
mensajes, identidad, Settings/callbacks; después build y UI/PWA; H166 rendimiento,
H167 etiquetas y H168 website. H171 bloquea `test:online:live`, incluida la
reanudación, antes del aprovisionamiento porque su política conserva historia
QA. El preflight local declara expresamente que no certifica entrega. Este
arnés no invocó pruebas remotas; las matrices históricas mantienen su alcance
y no certifican el artefacto H171 ni residuos cero.
