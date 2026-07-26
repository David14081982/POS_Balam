# Arquitectura de POS BALAM

## Vista general

POS BALAM es una aplicación React cargada directamente en el navegador, sin
bundler en tiempo de ejecución. Los módulos en `balam/` publican APIs globales
en `window`. La aplicación es **local-first**: opera con datos en memoria y
`localStorage`; Supabase replica y comparte la información cuando hay sesión y
conectividad.

Flujo principal:

```text
Interfaz React
    ↓
CONFIG / DATA / AUTH
    ↓ cambios locales inmediatos
localStorage
    ↓ push asíncrono
STORE → cola offline → Supabase (esquema pos)
    ↑                    ↓
    └──── pull/merge al iniciar y sincronizar
```

`POS Balam.html` carga los módulos fuente. `build-offline.mjs` genera
`index.html` y `POS Balam (offline).html`; estos dos archivos son artefactos, no
la fuente primaria.

## Orden de carga

El orden relevante definido en `POS Balam.html` es:

1. `balam/config.jsx`
2. `balam/data.jsx`
3. `balam/auth.jsx`
4. módulos de interfaz
5. `balam/store.jsx`
6. `balam/app.jsx`

Aunque `STORE` se carga después, `CONFIG`, `DATA` y `AUTH` consultan sus métodos
en tiempo de uso, no durante su declaración. `App` coordina la inicialización.

## CONFIG

Archivo: `balam/config.jsx`. API: `window.CONFIG`.

- Contiene ajustes, catálogos y reglas administrables.
- La copia local vive en `localStorage` bajo `balam_config_v1`.
- Expone lecturas y mutaciones; al guardar emite `configchange`.
- Si `STORE` está disponible, `pushConfig()` replica configuración y catálogos.
- `DATA` lee ciertos catálogos mediante getters para reflejar cambios sin
  recargar módulos.

Supabase separa esta información en tablas de configuración (`settings` y
`lookup`). Si existe configuración pendiente en la cola al arrancar, el pull se
omite para impedir que una copia remota anterior pise cambios locales.

## DATA

Archivo: `balam/data.jsx`. API: `window.DATA`.

- Es el modelo de dominio usado por la interfaz.
- Mantiene en memoria productos, vendedores, clientes, ventas, promociones,
  liquidaciones, devoluciones, pagos y movimientos.
- Persiste cada colección en claves propias de `localStorage`.
- Ejecuta reglas de negocio como folios, ventas, pagos, devoluciones,
  comisiones, inventario y datos de prueba.
- Las mutaciones guardan primero localmente y después llaman a `STORE`.
- `applyRemote()` incorpora datos recibidos de la nube sin volver a enviarlos.

Ventas y devoluciones usan rutas especializadas (`STORE.pushSale()` y
`STORE.pushReturn()`). Cada una se confirma remotamente mediante su propia
transacción SQL idempotente.

### Promociones y margen mínimo

`window.PROMOS` calcula el precio unitario que usa el Punto de Venta y la vista
previa administrativa. Los descuentos porcentuales acumulados se aplican
primero y después los montos fijos.

Cuando el producto tiene costo positivo y
`discount.minMarginPct > 0`, el precio promocional no puede bajar de:

```text
costo / (1 - margen_mínimo / 100)
```

El piso se limita al precio de lista: una promoción nunca aumenta el precio.
Si el precio de lista ya incumple el margen, se bloquea el descuento adicional.
Costo cero/ausente o margen 0 conservan el cálculo histórico. El margen se
administra en Configuración → Ventas y POS, entre 0% y 100%, y afecta sólo
cálculos nuevos; las ventas guardadas conservan sus snapshots monetarios.

## AUTH

Archivo: `balam/auth.jsx`. API: `window.AUTH`.

- Usa el cliente creado por `STORE.getClient()`.
- Inicializa y observa la sesión de Supabase Auth.
- Supabase JS persiste el token en `localStorage` y renueva la sesión.
- Después del login, relaciona el correo autenticado con un vendedor de
  `DATA.sellers`.
- Expone usuario actual, estado de sesión y comprobación de administrador.
- Emite `authchange` para que la interfaz reaccione.

La administración de cuentas no se realiza directamente desde el navegador:
usa la Edge Function `admin-users`.

## STORE

Archivo: `balam/store.jsx`. API: `window.STORE`.

Es la frontera entre el dominio local y Supabase:

- Crea un único cliente Supabase configurado para el esquema `pos`.
- Traduce objetos locales a filas SQL y viceversa mediante `MAP`.
- Hace `push` de configuración, colecciones, ventas y devoluciones.
- Hace `pull` de configuración y dominio.
- Fusiona ventas remotas; no borra ventas locales ausentes en la ventana remota.
- Pagina ventas recientes y permite recuperar una venta por folio.
- Sube fotos y códigos de barras a Supabase Storage.
- Invoca Edge Functions con el token real y conserva el cuerpo del error.

`STORE.enabled` indica disponibilidad del cliente; no significa que todas las
operaciones pendientes ya estén sincronizadas. `STORE.pending` es el tamaño de
la cola.

## Supabase

La autoridad de despliegue es la cadena ordenada de
`supabase/migrations/*.sql`, configurada por `supabase/config.toml`. Contiene
las bases históricas 001–012, las correcciones 013–028 y verificaciones finales
del contrato hasta 031. Los archivos `supabase/pos_*.sql` se conservan como fuentes
históricas legibles de 001–012; `test-migrations.mjs` exige que sus copias
formales permanezcan idénticas.

El orden formal coloca promociones antes del antiguo script 004 porque ese
script intenta activar RLS sobre `pos.promotions`. La versión desplegada queda
determinada por el historial de migraciones, no por ejecutar manualmente
`_PEGAR-EN-SQL-EDITOR.sql`.

La migración `20260725002900_pos_h10_schema_contract_verification.sql` no cambia
datos: aborta si faltan tablas, columnas o funciones esenciales, si alguna
tabla `pos` queda sin RLS, si sobreviven policies permisivas antiguas, si
`anon` conserva acceso al esquema o si falta el bucket público de fotos.
Las migraciones 01950 y 030 rodean las verificaciones históricas con semillas
reservadas y las eliminan antes de terminar. La migración 031 aborta cuando la
huella semántica de tablas, columnas, funciones, restricciones, índices y RLS
se aparta de dos reconstrucciones limpias reproducibles.

Responsabilidades:

- Persistencia compartida entre terminales.
- Supabase Auth para identidad y sesión.
- Row Level Security para autorización sobre el esquema.
- Storage para imágenes y códigos.
- Edge Functions para operaciones que requieren privilegios de servidor.

### Autorización del esquema `pos`

El acceso directo de navegador al esquema sigue el contrato de las migraciones
`20260725001400_pos_admin_rls.sql`,
`20260725001500_pos_service_role_grants.sql` y
`20260725001600_pos_seller_pos_access.sql`:

- `anon` no tiene acceso al esquema ni a sus tablas;
- una sesión `authenticated` se relaciona por correo con un perfil activo y no
  eliminado;
- el administrador puede operar todo el dominio;
- el vendedor puede leer catálogo, configuración de cobro, clientes y
  vendedores, y escribir únicamente el conjunto operativo de una venta;
- el vendedor no puede actualizar productos directamente; las salidas de stock
  de venta sólo atraviesan `pos.reserve_sale_stock()`;
- sus cambios directos de vendedores se limitan a métricas de venta;
- un perfil inactivo o una cuenta Auth sin perfil recibe conjuntos vacíos y
  RLS rechaza sus escrituras;
- `service_role` conserva permisos técnicos sobre el esquema y omite RLS, por
  lo que sólo puede existir en infraestructura de servidor.

La interfaz aplica el mismo contrato: administrador ve todas las pantallas y
vendedor sólo Punto de Venta. `AUTH.canAccess()` es la autoridad de navegación;
una página persistida no autorizada se reemplaza por el destino seguro del rol.
El último perfil verificado se guarda para permitir el arranque local-first sin
red; al reconectar, Supabase vuelve a validar estado y rol.

El producto no define todavía permisos configurables por pantalla. Esa
capacidad sería una ampliación independiente del contrato fijo actual.

`supabase/_PEGAR-EN-SQL-EDITOR.sql`, `ARREGLAR-ADMIN.sql` y scripts de limpieza
son herramientas operativas heredadas, no migraciones ni fuentes de verdad;
antes de ejecutarlos se debe revisar alcance y entorno.

## Edge Functions

Actualmente `supabase/functions/admin-users/index.ts`:

- Recibe el JWT del usuario.
- Usa un cliente con ese JWT y esquema `pos` para comprobar que sea
  administrador y operar sobre `pos.sellers` bajo RLS.
- Reserva `service_role` para crear, actualizar o eliminar usuarios en
  Supabase Auth.
- Nunca debe exponer la clave `service_role` al navegador.

Una Edge Function desplegada puede diferir del archivo local. Toda corrección
debe registrar versión/despliegue y verificar el comportamiento remoto.
La versión 8 de `admin-users` quedó verificada mediante creación de una identidad
temporal, autenticación, cambio real de contraseña, invalidación de la anterior,
autenticación con la nueva y eliminación completa. Las migraciones
`20260725002700` y `20260725002800` encapsulan la preparación y limpieza de la
identidad administrativa auxiliar.

## Sincronización

En el arranque, `STORE.init({ pull: true })`:

1. Cuenta las operaciones que ya estaban pendientes.
2. Intenta drenar la cola antes de descargar.
3. Procesa la marca de reset, si existe.
4. Descarga configuración, salvo que haya configuración local pendiente.
5. Descarga y aplica colecciones de dominio.
6. Descarga ventas por ventana temporal y las fusiona.
7. Vuelve a intentar la cola.

También se drena al evento del navegador `online`. La sincronización es
eventual; la interfaz no espera confirmación remota para aceptar una mutación
local.

### Recuperación transaccional de terminal

Un arranque administrativo recupera desde Supabase productos, clientes,
vendedores, promociones, devoluciones con sus renglones, liquidaciones, pagos,
movimientos y ventas con sus renglones. Las ventas recientes usan la ventana
configurable de 365 días y se agregan todos los apartados; un folio anterior se
puede recuperar bajo demanda.

`pos.movements` es un historial de sólo lectura para el cliente: las escrituras
de venta y devolución se realizan exclusivamente dentro de sus commits SQL
transaccionales. El pull recorre la tabla por `id` ascendente en páginas de
1 000 y sólo reemplaza `DATA.movements` después de completar la lectura. Si una
venta o devolución de la sesión activa sigue en la cola, se omite ese pull para
no pisar movimientos locales todavía no confirmados.

Los campos financieros de una venta se reconstruyen desde su snapshot remoto y
los pagos desde `sale_payments`. Un registro histórico sin esos campos conserva
su total conocido y no recibe valores inventados.

### Versionado multi-terminal

Productos, clientes, vendedores y promociones usan el contrato introducido por
`supabase/migrations/20260725001300_pos_013_concurrency.sql`:

- `sync_version` es la versión confirmada por el servidor;
- cada escritura envía `sync_base_version`, la versión que leyó la terminal;
- el servidor solo acepta coincidencia exacta e incrementa la versión;
- un intento obsoleto conserva la fila vigente y se registra en
  `pos.sync_conflicts`;
- `deleted_at` conserva eliminaciones como tombstones;
- `pos.soft_delete_entity()` aplica el borrado lógico bajo las políticas RLS de
  la tabla;
- cada navegador conserva un `balam_device_id` para relacionar conflictos con
  la terminal que los originó.

La política es primera escritura confirmada gana. El cliente pide la
representación resultante del `upsert`: si fue aceptado, guarda la versión nueva;
si fue rechazado, restaura la fila vigente y avisa. Las operaciones compactadas
se reconstruyen justo antes de enviarse para incorporar versiones confirmadas
mientras otra operación estaba en vuelo.

La migración de verificación
`20260725002600_pos_h06_concurrency_verification.sql` comprobó este contrato en
el Supabase enlazado para productos, clientes, vendedores y promociones:
cuatro escrituras obsoletas conservaron la primera versión confirmada y quedaron
auditadas; un snapshot anterior tampoco revivió un tombstone.

Este contrato de snapshots evita que una copia antigua revierta stock, pero por
sí solo no combina dos deltas de venta concurrentes. La reserva atómica
descrita a continuación cubre esa coordinación de H-01.

### Reserva atómica de stock

Las migraciones `20260725001700_pos_atomic_stock_reservation.sql` y
`20260725001800_pos_require_stock_reservation.sql` separan el descuento de una
venta de la sincronización de snapshots:

1. Cada venta local recibe un `operation_id` estable.
2. `STORE` conserva la operación en la cola y llama `pos.commit_sale()`; esta
   función invoca internamente `pos.reserve_sale_stock()` cuando corresponde.
3. La función serializa el mismo `operation_id`, bloquea productos en orden
   estable, agrupa por producto/talla y valida todo antes de descontar.
4. `pos.stock_reservations` registra la operación confirmada; repetirla
   devuelve éxito idempotente sin descontar otra vez.
5. Un trigger impide insertar una venta cobrada nueva sin una reserva que
   coincida en `operation_id` y folio.
6. Si falta inventario, la operación permanece en cola y la venta local queda
   `stock_pending`; no aparece como venta autoritativa hasta un reintento
   exitoso.

Los apartados no reservan inventario al crearse; la reserva se exige cuando se
liquidan y pasan a estado cobrado. Las ventas históricas sin `operation_id`
siguen siendo legibles y actualizables.

Este contrato resuelve la competencia por existencias de H-01 y es parte de la
transacción completa de venta descrita a continuación.

### Commit transaccional de venta

Las migraciones `20260725001900_pos_transactional_sale.sql` y
`20260725002000_pos_transactional_sale_verification.sql` establecen el contrato
remoto de H-04 para ventas:

1. La clave de la operación durable de la cola se usa como `commit_id`; la clave
   estable de la venta continúa como `operation_id` de la reserva.
2. Una única llamada `pos.commit_sale()` procesa reserva, cabecera, renglones,
   movimientos, historial completo de pagos y deltas de cliente/vendedores.
3. PostgreSQL confirma todos los componentes o revierte todos ante cualquier
   excepción.
4. `pos.sale_commits` conserva el hash canónico del payload. Repetir la misma
   clave y contenido devuelve `idempotent=true`; cambiar el contenido devuelve
   `commit_mismatch`.
5. Los acumulados se aplican como deltas dentro del commit y una sola vez. La
   respuesta devuelve productos, cliente y vendedores para reconciliar las
   versiones locales.
6. Cada abono de apartado es un commit nuevo con el historial completo. La
   liquidación reutiliza el `operation_id` de la venta para reservar stock una
   sola vez.

Las operaciones de venta creadas por versiones anteriores de la aplicación se
migran en la cola con pagos/efectos vacíos y conservan su identificador. Las
ventas históricas siguen siendo legibles.

### Identidad y folio de venta

Cada venta nueva tiene dos identificadores con responsabilidades distintas:

- `_operationId` / `sales.operation_id` es la identidad inmutable usada por
  reserva, commit idempotente y restricción única en Supabase;
- `folio` es la referencia visible y conserva el formato
  `prefijo + consecutivo local + token de operación`.

El token representa en base 36 los 128 bits completos del UUID de operación.
Por eso dos terminales offline pueden compartir prefijo y consecutivo sin
producir la misma referencia. Borrar el navegador crea otra identidad de
terminal y cada venta recibe además su propio UUID. Los folios históricos sin
token permanecen válidos y el cálculo del próximo consecutivo ignora los
dígitos del token.

Supabase conserva una defensa adicional: `commit_sale()` devuelve
`folio_conflict` si el folio ya pertenece a otro `operation_id`. Ante una
operación antigua pendiente, `STORE` genera el folio seguro a partir de la
misma identidad inmutable, cambia conjuntamente sus renglones, pagos,
movimientos, devoluciones y entradas de cola, y reintenta el mismo commit. Una
venta confirmada nunca se renombra.

### Commit transaccional de devolución

Las migraciones `20260725002100_pos_transactional_return.sql` y
`20260725002200_pos_transactional_return_verification.sql` completan H-04:

1. La devolución completa permanece como una operación durable en la cola y
   viaja mediante una sola llamada `pos.commit_return()`.
2. La función bloquea la venta original y valida cantidades contra
   `sale_items` menos todas las devoluciones ya confirmadas. Dos terminales no
   pueden devolver la misma unidad.
3. En una transacción confirma cabecera, renglones, reingreso de stock,
   movimiento, estado de venta y reversos de cliente/comisión.
4. `pos.return_commits` conserva el hash del payload. Un reintento idéntico no
   duplica efectos y una clave reutilizada con otro contenido se rechaza.
5. Cada movimiento nuevo guarda `return_id`; devoluciones parciales distintas
   no borran ni reemplazan movimientos ajenos.
6. La respuesta devuelve el estado autoritativo de la venta y las entidades
   versionadas para reconciliar la copia local.

Las migraciones `20260725002300_pos_legacy_return_adoption.sql` y
`20260725002400_pos_legacy_return_adoption_verification.sql` cierran la
adopción de operaciones antiguas que ya estaban en cola. La migración local
captura desde `DATA` los objetivos exactos y su versión base para producto,
cliente y vendedores. `pos.commit_legacy_return()` valida todos los objetivos
antes de escribir: los aplica sólo sobre la versión base, reconoce sin duplicar
un objetivo ya aplicado en `base_version + 1` y deja en cola cualquier tercera
versión como `legacy_version_conflict`. Cabecera, renglones, movimientos y
objetivos se confirman o revierten juntos. No se infieren deltas históricos.
Los datos históricos sin `product_id` o `return_id` siguen siendo legibles.

## localStorage

Es persistencia operativa, no un caché descartable. Aloja:

- configuración;
- colecciones de dominio;
- secuencia local de folios;
- periodo y banderas de datos de prueba;
- sesión administrada por Supabase JS;
- cola `balam_sync_queue`.

Consecuencias:

- Borrar datos del navegador puede eliminar cambios aún no sincronizados.
- La cuota puede agotarse, especialmente con imágenes base64.
- Dos pestañas o dos terminales no comparten coordinación atómica local.
- Cambiar claves o formatos exige compatibilidad o migración explícita.

## Cola offline

La cola está en `localStorage` bajo `balam_sync_queue`.

- Toda operación se encola **antes** de intentar enviarse.
- `flushQueue()` es el ejecutor único y procesa en orden.
- Los `upsert` de una misma tabla y la configuración se compactan al estado más
  reciente.
- Ventas y eliminaciones se conservan en orden y deben ser idempotentes.
- Una operación solo sale de la cola después de éxito remoto.
- Cada operación conserva `status`, `attempts`, fechas y un diagnóstico con
  categoría, código, mensaje y política de recuperación.
- Red y errores de servidor permanecen en reintento automático. Autenticación,
  RLS, esquema, restricciones y conflictos se clasifican por separado; los
  bloqueos permanentes no se martillan en cada drenado.
- `STORE.queueStatus()` expone un resumen sanitizado y
  `STORE.retryOperation(id)` permite el reintento explícito.
- La campana administrativa muestra operaciones fallidas y su causa. Una nueva
  sesión reanuda las operaciones detenidas por autenticación.
- `flushQueue()` toma el candado antes de esperar al cliente de Supabase: nunca
  hay dos ejecutores de cola concurrentes dentro de la misma pestaña.
- Si `localStorage` rechaza la escritura por cuota, la cola completa se refleja
  en IndexedDB (`balam_sync/durable_queue`) antes de enviarse. El arranque
  hidrata ese espejo antes de drenar o hacer pull. Cuando `localStorage` vuelve
  a aceptar escrituras, recupera la autoridad y elimina el espejo para no
  restaurar snapshots obsoletos. Sólo si ambos almacenamientos fallan se
  conserva en memoria y se muestra la alerta crítica de no cerrar la pestaña.
- Cada operación nueva conserva el correo normalizado de la sesión que la creó.
  `flushQueue()` sólo ejecuta operaciones cuyo propietario coincide con la
  sesión activa; la compactación y el reajuste de versiones respetan el mismo
  límite.
- `AUTH` entrega cada cambio de identidad a `STORE.setSession()`. El logout
  suspende sincronización sin borrar pendientes y cada identidad distinta
  vuelve a drenar su propia cola antes de realizar un pull.
- Las operaciones históricas sin propietario se ponen en cuarentena. No se
  atribuyen al primer login: un administrador debe revisarlas y reclamarlas
  expresamente con `STORE.claimLegacyQueue()`.

La cola mejora durabilidad, pero por sí sola no convierte varias escrituras SQL
en una transacción. Ventas y devoluciones resuelven ese límite mediante
`commit_sale` y `commit_return`, respectivamente.

## Contratos que no deben romperse

- La acción local debe funcionar sin conexión y dejar una operación recuperable.
- Un pull no debe pisar cambios locales pendientes.
- Reintentar no debe duplicar ventas, pagos, devoluciones ni movimientos.
- Datos históricos sin campos nuevos deben seguir siendo legibles.
- Una terminal con una versión antigua no puede sobrescribir ni revivir una
  entidad más reciente; el conflicto debe quedar registrado.
- `sales.total` es el total final con IVA; el desglose fiscal y los pagos son
  snapshots históricos, no cálculos con configuración vigente.
