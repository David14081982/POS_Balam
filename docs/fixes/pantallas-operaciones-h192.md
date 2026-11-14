# Pantallas como autoridad operativa

**Riesgo:** H-192
**Estado:** RESUELTO — base y cliente publicados; verificación productiva de sólo lectura, operación real NO PROBADA
**Fecha:** 14/11/2026
**Commit:** `7aaa960` (implementación), `ee593ce` (aprendizaje), `74a7ad3` (entrega publicada).

## Problema y reproducción

La revisión productiva de sólo lectura mostró permisos operativos que no
correspondían a las pantallas habilitadas. El editor sólo actualizaba pantallas. Las
policies de préstamos y liquidaciones sólo permiten administradores; los ajustes
presentaban controles que guardan en onBlur/onChange. Evidencia equivalente:
censo, definiciones productivas y componentes ejecutables, antes de modificar.

## Causa raíz

H-56 separó navegación y operación. La nueva decisión del propietario cambia
ese contrato. Conceder sólo capacidades no basta: faltan lecturas para confirmar
documentos y existen guardas de vendedor en la edición de productos. Los
préstamos no actualizan productos; no requieren una excepción de stock.

## Diseño

Decisión posterior del propietario, 14/11/2026: el vaciado completo pertenece
a Configuración y exige administrador activo además de `inventory.delete`.
La pantalla Inventario conserva sus operaciones ordinarias; no autoriza
`clearInventory` a un vendedor. Se incorpora la negativa al caso 8 existente.
El propietario aprobó la tabla por cuenta del 14/11/2026 y autorizó aplicar con
la tienda cerrada. Se revalidó el censo antes de aplicar: seis cuentas idénticas.

Una función SQL contiene la correspondencia documentada en `docs/05`. La unión
de pantallas autoriza las capacidades necesarias; las demás reciben `deny` en
la tabla existente, sin tabla ni pantalla paralela. El resolver también exige
una pantalla habilitada: un override antiguo no conserva una operación revocada.
`admin_apply_user_screen_permissions` llama al sincronizador dentro del lote
atómico y de la versión esperada. La creación confirmada H-191 lo llama sólo
cuando insertó una asignación nueva; respeta las asignaciones existentes.

POS mantiene `sales.create`, `sales.collect`, `customers.create`.
La edición de la ficha usa `customers.update`, concedido sólo por Clientes.
El gateway distingue venta nueva de cobro de apartado para que la capacidad
compartida no permita operar un apartado con su pantalla denegada.
Vendedores realmente ofrece liquidación, cierre de mes y ajuste histórico por
`commissions.settle`; la administración de cuentas pertenece a Configuración.
Reportes sólo consulta esos resultados: no concede `commissions.settle` ni
`commissions.close_period`. Se corrigió la asociación anterior de `docs/05`
al contrastarla con los botones reales de `reports.jsx` y `sellers.jsx`, tras
la aclaración solicitada por el dueño. La proyección por cuenta se conserva
exclusivamente en evidencia privada. La cuenta de pruebas permanece activa.
No se concede `sellers.manage`, `settings.manage` ni `permissions.manage` a
vendedores. No cambia el rol admin ni `can_manage_screen_permissions`. La
revocación de una pantalla operativa también limita al administrador en servidor;
sus capacidades administrativas ajenas al mapa se conservan. El administrador
conserva sus capacidades y sus overrides al alinearlo.

Una alineación transaccional única conserva pantallas/perfiles y escribe sólo
overrides operativos y la revisión de invalidación. La migración aborta si la
huella de cuentas/perfiles/catálogo/permisos difiere de la tabla aprobada. Bajo el
candado del gateway compara también hashes de 23 tablas protegidas antes/después.
No corrige ventas, stock, históricos ni recibos; la cuenta de pruebas permanece activa.

## Solución

- 234/235: dos funciones nuevas privadas y seis redefiniciones generadas desde
  producción. Hash previo y posterior por función, ACL/propietario/search_path
  conservados; sin cambiar wrappers transaccionales de venta/devolución/cambio.
- Cuatro policies SELECT adicionales: préstamos por pantalla; devoluciones,
  renglones y liquidaciones por Reportes/Vendedores. Las policies y ACL existentes
  se conservan; ningún permiso de escritura directa se concede.
- La guarda de productos reconoce únicamente escrituras del dueño de la función
  por un recibo online en ejecución, un comando de inventario y capacidad efectiva.
  La condición especial de baja sólo permite tombstone/metadata. El acceso directo
  y el marcador falsificado siguen rechazados.
- El token del editor y la revisión H-166 incluyen `user_capability_overrides`.
- `settings.jsx`: campos deshabilitados y acciones ocultas para consulta, conserva
  valores de switches/selectores y navegación. Los callbacks vuelven a comprobar
  el rol al ejecutarse. No monta editores administrativos ni configuración USB
  para vendedor. El administrador conserva los componentes y controles existentes.
- `permissions.jsx`: explica que las pantallas conceden operaciones.
- `clearInventory`: exige `pos.is_active_admin()` además de `inventory.delete`
  antes de validar el alcance o ejecutar bajas. Se conservan las guardas
  comerciales, versiones y transacción existentes. Inventario no concede
  esta acción administrativa a vendedores, incluida la cuenta de pruebas.

## Pruebas

Seis casos de H-192, diez en total con los cuatro de H-191; sin suites generales.

5. `node test-h192-screen-operations.mjs`: editor atómico, revocación para vendedor
   y administrador, dependencias POS/Apartados, configuración denegada y
   preservación de reglas admin y acceso al editor de permisos. POS crea un
   cliente y confirma una venta pagada con sus agregados sin `customers.update`;
   editar la ficha falla con 42501 hasta autorizar Clientes, y se revoca al negarla.
6. Mismo arnés: entrega/devolución de préstamo por vendedor, snapshot, reintento,
   revocación y producto completo idéntico antes/después.
7. Mismo arnés: predicados RLS reales en sentinelas aislados para Reportes sin
   `sales.refund` ni permisos de liquidación/cierre; ambos comandos rechazados
   con 42501. Vendedores concede y retira esas capacidades. Vendedor denegado,
   inactivo, sin perfil, anon y service_role.
8. Mismo arnés: edición de precio por gateway con Inventario, rechazo directo,
   marcador falsificado y revocación. Vendedor con Inventario e `inventory.delete`
   efectivo intenta `clearInventory` con todos los productos y versiones: recibe
   `42501 / ACTIVE_ADMIN_REQUIRED`; las filas completas permanecen idénticas.
   Antes de añadir la guarda la misma negativa falló: el comando llegó a la
   protección comercial `23514 / PRODUCT_RETURNABLE_HISTORY`. Después: 4/4 SQL
   PASS, sin añadir un undécimo caso. No se probó un vaciado exitoso de administrador.
9. `node test-h192-settings-readonly.mjs`: bundle en Chrome, las doce secciones
   de Configuración consultables, ningún campo editable ni acción del vendedor,
   valores visibles y controles de administrador conservados. Cero escrituras
   remotas; 1/1 PASS.
10. `BALAM_PWA_CASE=activation node test-h164-online-pwa.mjs`: 1/1 PASS en el bundle
    final; activación conserva evidencia antigua. Build PASS.

Se corrigió una verificación demasiado amplia que exigía RLS en tablas históricas
fuera del alcance; se limita a los seis objetos afectados, sin tocar esas tablas.
El fixture UI necesitó simular conectividad/fecha como el arnés H-171 existente
(dos intentos de montaje fallidos). Se repitieron los mismos casos tras completar
alineación, verificación de hashes y valores de consulta; no son pruebas nuevas.
El fixture sustituye exclusivamente la huella del entorno productivo por la de
sus semillas sintéticas; ejecuta el resto de la migración sin cambios.
Durante la revisión final se corrigió una concatenación del generador SQL que
interpretaba `$'` dentro de una definición como sustitución JavaScript; el parser
aislado rechazó ese borrador. Se reconstruyó desde los seis archivos de definición
y la ejecución final volvió a pasar 4/4. Esas pruebas fueron exclusivamente locales.

## Despliegue y verificación productiva del 14/11/2026

H-192 parte de `f0f1250`, main publicado de H-191. Se preservaron el historial
local anterior y los cambios ajenos, sin reset destructivo ni force push.
La autorización posterior del propietario permite aplicar 234/235 y publicar
el cliente sólo después de verificar la base. El censo y las capacidades
anteriores coincidieron exactamente con la tabla aprobada para las seis cuentas.
Antes de aplicar se guardó un respaldo privado de nueve tablas de permisos,
definiciones, policies y triggers, junto con huellas de las 64 tablas de `pos`.
La evidencia privada no forma parte de GitHub.

El primer `db push` fue rechazado en la alineación por la guarda existente
`42501 / ONLINE_COMMAND_REQUIRED`: el canal de migraciones no cumplía la
identidad de mantenimiento admitida por `guard_online_commercial_write`.
La lectura posterior confirmó reversión completa: 64 tablas y 6,508 filas,
permisos, 172 funciones y ledger idénticos. No hubo aplicación parcial.
El fixture aislado ejecuta como postgres y no reprodujo esa diferencia del canal.

Se verificó por lectura que el canal administrativo Management API ejecuta con
`session_user = postgres`, sin actor Auth, condición ya admitida por la guarda.
Por esa vía se aplicaron las mismas sentencias aprobadas y el registro de ambas
migraciones dentro de una sola transacción. No se alteraron guardas, RLS ni
privilegios para permitir el despliegue. El parser del registro se contrastó con
las sentencias ya registradas de 232/233 antes de construir el lote.

La lectura posterior de las 14:46:23 UTC comprobó:

- 234/235 registradas, con hashes SHA-256 de sus sentencias idénticos al SQL
  aprobado; las seis migraciones anteriores permanecen idénticas.
- Ocho hashes de funciones esperados; otras 166 funciones idénticas. Propietario,
  ACL, search_path y modo de seguridad previos preservados.
- Capacidades efectivas de las seis cuentas idénticas a la columna aprobada
  después. Perfiles, estado activo, roles y pantallas sin cambios.
- Las 64 ACL/RLS de tablas y las policies/triggers anteriores permanecen;
  sólo se agregaron las cuatro policies SELECT y el trigger de invalidación
  previstos. Los dos helpers nuevos no se exponen a public/anon/authenticated.
- 62 tablas y 6,507 filas completas idénticas por conteo y SHA-256 de JSONB
  canónico, incluidas ventas, inventario e históricos. Sólo cambian 125 overrides
  operativos y la revisión de invalidación. No se crearon operaciones de prueba.
- `clearInventory` conserva la exigencia de administrador activo además de
  `inventory.delete`, comprobada por definición y hash. Su rechazo 42501 al
  vendedor se ejercitó en local; no se ejecutó el comando en producción.

Evidencia pública sin identidades: [deployment.json](evidence/h192/deployment.json).
Consulta reproducible: `supabase/operations/h192-deployment-readonly.sql`;
su salida contiene respaldo privado y nunca debe publicarse. La verificación
posterior utilizó exclusivamente SELECT en transacción READ ONLY.
Cliente publicado en main y Pages desde `74a7ad3959df039ebdd7246be0eb228c7d3e2dc9`.
Workflow [43607155019](https://github.com/David14081982/POS_Balam/actions/runs/43607155019):
verificación de evidencia y despliegue correctos. Los once archivos estáticos
servidos coinciden byte por byte con ese commit. SHA-256 del index y offline:
`57c1bed8f19a342d9f967acd0661cedcd6403165421ca51c9989a03a205a577e`.
[Constancia del workflow](evidence/h192/publication.json) y
[comparación de Pages](evidence/h192/pages-verification.json).
El cierre documental posterior conserva esos mismos bytes. H-192 queda también
respaldada en `review/h191-h192-permissions`; main se reconcilió por avance directo
desde `f0f1250`. Los cinco PDF borrados y el estado local del CLI siguen ajenos a
los commits; el historial y stash anteriores se conservan sólo como respaldo local.

## Riesgo residual y pendientes

La retrospectiva documental R-EVI-01 detectó otro alcance sin decisión acreditada:
`inventory.delete` también protege `clearInventory`, iniciado en Configuración.
El propietario resolvió después reservarlo a administrador activo además de la
capacidad. La guarda y negativa local descritas arriba atienden esa decisión;
la tabla por cuenta ahora muestra también quién puede solicitar el vaciado.
Los conteos de capacidades no cambian: la restricción es adicional a la capacidad.
La evidencia documental anterior sólo acredita coherencia documental en esa
revisión; su PASS no acredita funcionamiento ni despliegue productivo. Evidencia y límites en
[verificación cruzada](verificacion-cruzada-evidencia-h192.md).

Revisión solicitada por el propietario tras el error de Reportes: el análisis
inicial trasladó el mapa documental sin verificar cada acción de la interfaz
y su frontera de servidor. Los casos comprobaron revocación, pero no todas las
concesiones indebidas. Eso incumplió la prioridad del código ejecutable y la
comprobación de consumidores de `THINKING.md` (FF-05/FF-10/FF-11); el límite de
pruebas no justifica la omisión.

Se detectó además `customers.update` asociado a POS: `ClientPicker` sólo llama
a `addClient`; la edición del perfil se origina en `clients.jsx`. El acumulado
de compras se actualiza dentro de `commit_sale`, sin exigir esa capacidad.
Se retiró esa concesión dentro de la migración aún no aplicada. El caso 5
falló con el mapa anterior (`true !== false`) y pasó tras la corrección: alta
de cliente, venta pagada, snapshot, importe cobrado y agregados confirmados;
edición de ficha rechazada con 42501, autorizada al habilitar Clientes y
revocada al negarlo. Se repitieron los cuatro casos SQL existentes, 4/4 PASS;
no se añadieron escenarios ni se repitieron las pruebas de UI/PWA del bundle
sin cambios. La proyección por cuenta se actualizó en la tabla privada. La capacidad
`commissions.settle` también autoriza el botón existente Ajuste histórico de
Vendedores; se explicitó ese alcance en `docs/05` y la propuesta privada.

Contraste restante por lectura de consumidores y fronteras vigentes; no equivale
a ejecutar todos los flujos ni a certificación productiva:

| Pantalla | Consumidor real | Frontera de servidor contrastada |
|---|---|---|
| POS | `pos.jsx` / `pos-ticket.jsx`: venta, cobro, `addClient` | `dispatch_online_command`, cadena `commit_sale*_checked`, `online_save_entities` |
| Apartados | `layaway.jsx` / `data.jsx`: abono y liquidación | modo de venta y `sales.collect`; no autoriza crear ventas nuevas |
| Clientes | `clients.jsx`: alta, edición y baja | `online_save_entities` y rama `softDelete`, capacidades por operación |
| Inventario | `inventory.jsx`: guardar artículo/familia y eliminar | `save_products_checked`, `commit_reference_family_batch`, `delete_products_checked_v2` |
| Devoluciones | `returns.jsx` / `data.jsx`: devolución y cambio | delegates `h83_commit_return/exchange`, `sales.refund/exchange`; guardas H-190 conservadas |
| Descuentos | `discounts.jsx`: alta, pausa, edición, duplicado y baja | `online_save_entities` / `dispatch_online_command`, `promotions.manage` |
| Vendedores | `sellers.jsx`: liquidación, cierre y Ajuste histórico | `settle_commission_checked`, `close_commission_period_internal`, `apply_commission_adjustment_checked` |
| Préstamos | `loans.jsx` / `data.jsx`: entrega, devolución, edición, faltante y baja | `commit_loan_operation`; cierre/reapertura también intervienen al devolver/cambiar estado |
| Reportes / Panel | consulta, exportación, impresión y navegación | sin capacidades de escritura añadidas; Reportes obtiene SELECT de documentos faltantes |
| Configuración | `settings.jsx`: consulta del vendedor | `commit_config` exige administrador activo y `settings.manage`; editor de permisos conserva su guarda |

H-191 conserva su evidencia específica de alta y fallback; Auth remoto y
aceptación en terminal siguen NOT_TESTED. Esta revisión no autoriza afirmar
que toda la aplicación esté libre de defectos ni sustituye una operación real.
En el seguimiento de `clearInventory` sólo cambiaron el
borrador SQL, su verificador, el caso 8 y evidencia/documentación; el cliente
conserva los bytes previamente probados. No se repitieron build ni UI/PWA.

La tabla completa aprobada permanece local en
`.evidence-h192-private/aprobacion-capacidades.md`, sin publicar identidades.
H-191 se publicó por separado. El respaldo inicial en
`review/h191-h192-permissions` no autorizaba producción; la autorización posterior
del propietario sí permite este despliegue y su publicación. La documentación
pública omite nombres, identificadores y proyecciones por cuenta.

La prueba de alta H-191 simula Auth; no hay aceptación en terminal ni certificación
distribuida A/B/C. No se modifica la validación histórica de cantidades de préstamos,
pendiente conocida en `docs/05`; la prueba usa cantidades válidas. Las capacidades
compartidas se mantienen si otra pantalla las necesita. La edición de permisos
por rol no forma parte del editor autorizado; el gateway sólo admite el editor
individual. Una futura UI de roles debe usar el mismo sincronizador.

**NO PROBADO:** operaciones comerciales reales después de H-192; alta nueva
integrada H-191/H-192 con Auth real; aceptación en terminal e impresión física;
vaciado exitoso de administrador; liquidaciones/cierres/ajustes exitosos, todos
los modos de préstamo y totales de Reportes con documentos reales. La lectura
productiva demuestra estado, permisos y conservación, no esos recorridos.
Se mantienen los seis casos locales de H-192, diez junto con H-191; no se añadieron
casos funcionales ni se repitieron suites generales.

Rollback: nueva migración con las seis definiciones previas, retiro de las cuatro
policies nuevas y del trigger nuevo; restaurar exactamente los overrides anteriores
desde el respaldo privado del despliegue. Nunca revertir documentos comerciales.

## Referencias

- H-191, H-190 y H-189 en `docs/03-known-risks.md`.
- `docs/05-operational-capabilities.md` y autoridades de seguridad.
