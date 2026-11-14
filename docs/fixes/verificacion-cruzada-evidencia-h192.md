# Verificación cruzada de evidencia y retrospectiva H-191/H-192

**Riesgo:** H-192 — falla metodológica y alcance de permisos
**Estado:** regla incorporada; hallazgo corregido y base aplicada por autorización posterior; límites funcionales conservados
**Fecha:** 14/11/2026
**Commit:** `ee593ce` (aprendizaje respaldado en rama de revisión).

## Problema y reproducción

El diseño inicial de H-192 convirtió una correspondencia documental en permisos
sin contrastar todos sus consumidores. Concedía liquidación/cierre desde Reportes
y edición de fichas de clientes desde POS. Ambos errores se corrigieron localmente
en la sesión anterior; esta tarea no cambia esas correcciones ni las aplica.

La evidencia independiente era accesible: `reports.jsx` consulta y exporta;
`sellers.jsx` contiene liquidación, cierre y Ajuste histórico; `ClientPicker`
en `pos-ticket.jsx` llama a `addClient`, mientras `clients.jsx` llama a
`updateClient`. El caso 5 reforzado falló con la concesión indebida y pasó con
venta pagada y actualización de acumulados sin editar la ficha. Los resultados
anteriores se conservan en [isolated.json](evidence/h192/isolated.json).

La tarea original autorizó únicamente instrucciones/documentación locales y una
retrospectiva delimitada. Excluyó cambios de código, pruebas funcionales,
migraciones, permisos, datos comerciales, Supabase, commits, push y despliegues.
Este documento conserva esa revisión como antecedente. El seguimiento del
14/11/2026 descrito abajo corresponde a la instrucción posterior del dueño
para corregir `clearInventory`, añadir su negativa y actualizar la tabla.

## Causa raíz

Se omitió el contraste exigido por FF-05, FF-10 y FF-11. Las expectativas de las
pruebas asumieron parte del mismo mapa equivocado que la implementación: verificar
concesión/revocación no demostraba la legitimidad de cada concesión. La lectura
documental y el verde local se presentaron con más alcance del demostrado.
La responsabilidad fue del análisis; el límite de pruebas no justificaba omitirlo.

## Diseño

Una definición normativa única, `R-EVI-01`, en [THINKING.md](../architect/THINKING.md#r-evi-01),
de severidad BLOCKING. [AGENTS.md](../../AGENTS.md) la hace obligatoria antes de
proponer, implementar o validar en toda futura sesión. El expediente de cada
historia conserva la trazabilidad y sus límites; este informe conserva el
antecedente, sin repetir el procedimiento en otros playbooks.

| Regla existente | Aporte específico de R-EVI-01 |
|---|---|
| AGENTS, antes de modificar, punto 3 | Convierte la prioridad del código en una comprobación obligatoria también antes de proponer y concluir. |
| FF-05 | Exige origen, consumidores y operaciones que comparten funciones/capacidades. |
| FF-10 | Exige expectativas justificadas independientemente y bloqueo de concesiones indebidas. |
| FF-11 | Hace explícita la cadena usuario → componente → cliente → servidor → datos y efectos indirectos. |
| R-SEC-06 / R-SEC-07 | Complementa matriz de identidades y autoridad del servidor; no las sustituye por ocultación de controles. |
| R-DEL-01 / R-DEL-02 / R-DEL-11 | Conserva evidencia de causa, alcance de pruebas y validación positiva/negativa; añade la comprobación de premisas. |
| WORKFLOW / metodología 1–8 | Mantiene etapas, autorizaciones y puertas; no impone suites generales, certificación ni permisos adicionales. |

La regla no presupone que el comportamiento implementado sea correcto: distingue
lo observado del contrato autorizado y de decisiones de negocio pendientes.
Tampoco convierte la aprobación del dueño en una revisión técnica a su cargo.

## Solución

- `AGENTS.md`: referencia obligatoria a la regla única.
- `docs/architect/THINKING.md`: procedimiento, ocho puntos de trazabilidad,
  privilegios compartidos, expectativas independientes y límite de conclusiones.
- Este expediente, índice de correcciones, riesgos y expedientes H-191/H-192:
  antecedente, revisión delimitada y pendientes verificables.
- [Diff normativo](evidence/h192/regla-evidencia.diff): texto exacto de las instrucciones nuevas.

## Revisión retrospectiva delimitada

Se aplicó R-EVI-01 después de incorporarla. Se leyeron los consumidores del cliente,
gateway, migraciones y evidencia existente; no se ejecutaron operaciones comerciales
ni nuevas pruebas funcionales. Los PASS citados son evidencia previa, no una nueva
ejecución. El censo productivo conservado es una fotografía anterior, no una lectura
remota actualizada.

### Trazabilidad H-191

| Puntos de R-EVI-01 | Alta de cuenta | Respaldo del editor |
|---|---|---|
| 1–2: operación y origen | Administrador crea usuario en `NewUserForm`, [settings.jsx](../../balam/settings.jsx#L2670). | Administrador guarda pantallas de un usuario sin rol operativo, [permissions.jsx](../../balam/permissions.jsx#L264). |
| 3–4: cliente y servidor | `STORE.callFunction('admin-users')` → `continueAccount/applyProfile` → `execute_online_command` → `online_save_entities`. [Edge Function](../../supabase/functions/admin-users/index.ts#L71), [SQL 232](../../supabase/migrations/20261114023200_pos_h191_account_role.sql#L74). | `save()` envía `base_role || user.role` → wrapper del editor → `admin_apply_user_screen_permissions`. Snapshot del rol del perfil en [SQL 232](../../supabase/migrations/20261114023200_pos_h191_account_role.sql#L212). |
| 5–6: restricciones y datos | `sellers.manage`, actor/dispositivo válidos, recibo `create/auth_confirmed`, id/correo Auth coincidentes y perfil nuevo; inserta asignación y auditoría en la transacción del perfil. | Guarda administrativa y versión esperada; modifica asignación/pantallas del usuario seleccionado, no inventa el rol en el navegador. |
| 7–8: compartidos e invariantes | El gateway también actualiza perfiles; la nueva asignación sólo corre en alta confirmada. `ON CONFLICT DO NOTHING` preserva asignaciones, incluidas inactivas, y excepciones. | Conserva un `base_role` existente; no repara cuentas históricas automáticamente ni eleva vendedores por una pantalla. |

**Resultado:** no se encontró otra asociación incorrecta o concesión indebida en
esas rutas. [Evidencia SQL previa](evidence/h191/isolated.json) reproduce la ausencia
de rol y prueba alta, replay, preservación y fallback. [Postflight registrado](evidence/h191/deployment.json)
documenta 232/233 aplicadas y conservación de asignaciones/overrides/otros objetos.
No demuestra un alta desde navegador atravesando Auth remoto.

**Premisa pendiente compartida con H-192:** `test-h191-account-role.mjs` aplica
232/233, mientras `test-h192-screen-operations.mjs` siembra cuentas antes de 234.
Ninguno ejercita el alta nueva que entra por `online_save_entities` y luego llama
al sincronizador H-192 ([234, rama de alta](../../supabase/migrations/20261114023400_pos_h192_screen_operations.sql#L303)).
La integración está implementada por lectura, pero no demostrada por esos PASS.

### Trazabilidad H-192

La matriz de consumidores del [expediente funcional](pantallas-operaciones-h192.md)
completa el mapa por pantalla; el contrato actual está en [docs/05](../05-operational-capabilities.md).
El editor usa `save()` → gateway `permissions` → wrapper versionado →
`admin_apply_user_screen_permissions` → `sync_user_screen_capabilities` en la
misma transacción. Conserva `can_manage_screen_permissions` y la guarda de último
administrador; escribe pantallas, overrides y auditoría/revisión correspondientes.
El resolver exige identidad activa y pantalla efectiva, y bloquea capacidades
administrativas para perfiles vendedores. Referencias: [234: editor](../../supabase/migrations/20261114023400_pos_h192_screen_operations.sql#L121),
[sincronizador](../../supabase/operations/h192-screen-capabilities.sql#L25) y
[resolver](../../supabase/migrations/20261114023400_pos_h192_screen_operations.sql#L325).

Los permisos compartidos requieren describir la operación completa: POS y Clientes
comparten alta; POS y Apartados comparten cobro con guarda adicional por modo;
Vendedores comparte `commissions.settle` entre liquidación y Ajuste histórico.
Las dos asociaciones incorrectas anteriores ya no están en el mapa local.

### Hallazgo adicional: vaciado de inventario con una capacidad compartida

**Estado al hallarlo:** alcance de privilegio pendiente de resolver; evidencia
por código, sin ejecución en la revisión documental. La siguiente cadena describe
ese borrador anterior; la corrección posterior se registra al final de la cadena.

1. La operación es **Vaciar inventario**, distinta del borrado de una referencia/familia.
2. Se origina en `ClearInventoryCard`, montado en `config.inventario`
   ([settings.jsx:456](../../balam/settings.jsx#L456), [panel](../../balam/settings.jsx#L1636)).
3. Llama a `DATA.clearInventory()` → `STORE.clearInventory()`
   ([data.jsx](../../balam/data.jsx#L3957), [store.jsx](../../balam/store.jsx#L1021)).
4. El gateway acepta `clearInventory` y llama a `delete_products_checked_v2`
   por cada producto ([234](../../supabase/migrations/20261114023400_pos_h192_screen_operations.sql#L553)).
5. Esa rama exige `inventory.delete`; no exige administrador ni una pantalla de
   Configuración. La función de baja conserva versión, contexto y bloqueos de
   apartados, préstamos e históricos retornables ([H-149](../../supabase/migrations/20260908018400_pos_h149_directed_recovery.sql#L400)).
6. Lee todos los productos activos y pretende marcar `products.deleted_at`;
   registra auditoría. No equivale a borrar ventas/históricos ni evita sus guardas.
7. H-192 concede `inventory.delete` por Inventario y su guarda de productos admite
   `clearInventory` en contexto privado ([mapa](../../supabase/operations/h192-screen-capabilities.sql#L13),
   [guarda](../../supabase/migrations/20261114023400_pos_h192_screen_operations.sql#L774)).
   Ocultar el botón al vendedor no retira la autorización de ese comando.
8. Deben conservarse las bajas individuales/familiares autorizadas, las protecciones
   comerciales y el límite administrativo de Configuración. Falta resolver si el
   vaciado total debe quedar reservado al administrador y reflejarlo en servidor.

La instrucción de operar Inventario no basta para dar por aprobada una acción
administrativa de otra pantalla. Se identifica una autorización indirecta sin
decisión específica acreditada. la cuenta de pruebas es la cuenta no administradora que, según
el censo conservado, recibiría esa capacidad; permanece activa. No se ha concedido
esta ampliación en producción. H-192 no está lista para cierre por sólo aprobar
la tabla de nombres de capacidades: ese alcance debe resolverse primero.

**Seguimiento autorizado, 14/11/2026:** el propietario reservó `clearInventory`
a administrador activo además de `inventory.delete`. La rama del gateway ahora
comprueba `pos.is_active_admin()` y rechaza con `42501 / ACTIVE_ADMIN_REQUIRED`
antes de llegar al borrado. Se conservan la capacidad y las guardas comerciales.
La negativa se incorporó al caso 8 existente: vendedor con Inventario y capacidad
efectiva, comando con todos los productos/versiones y filas completas idénticas
después del rechazo. Falló antes con `23514 / PRODUCT_RETURNABLE_HISTORY` y pasó
tras la guarda; los cuatro casos SQL existentes pasan. No hubo purga productiva
ni vaciado exitoso de administrador. La tabla actualizada distingue capacidad de
autorización del comando; la cuenta de pruebas sigue activa, sin permiso de vaciado.

### Límites concretos de la evidencia disponible

| Tema | Evidencia existente | Lo que no demuestra |
|---|---|---|
| H-191 alta/fallback | SQL con Auth simulado y ejecución del cierre `save()` en VM. | Alta real con Edge Function/Auth/navegador; integración del alta con 234. |
| POS / Clientes | Caso 5: alta, venta pagada, agregados y edición denegada/autorizada. | Todos los modos de venta y abonos; los comandos de apartado usados para su guarda son incompletos. |
| Préstamos | Caso 6: entrega, devolución completa, snapshot, replay, revocación; stock idéntico. | Todos los caminos de baja, faltante y reapertura; la validación histórica de cantidades sigue fuera de esta historia. |
| Reportes / Vendedores | Caso 7: predicados SELECT copiados a sentinelas y comandos de comisión denegados sin Vendedores. | Snapshot y totales reales de Reportes con documentos; liquidación/cierre/Ajuste histórico exitosos con el permiso nuevo. |
| Inventario | Caso 8: precio por gateway, acceso directo/falsificado, revocación y negativa de vaciado con Inventario habilitado. | Altas, familias, todas las bajas y vaciado exitoso de administrador. |
| Configuración / identidades | UI sin escrituras con configuración sembrada; controles admin; SQL negativo con vendedor inactivo y sin perfil. | Todas las variantes de callbacks/datos, ni administrador inactivo en esa matriz SQL. |

Estos huecos no prueban otros defectos, pero impiden presentar todos esos flujos
como verificados. Completar sólo los casos relevantes requerirá autorización
funcional independiente; esta tarea conserva los diez escenarios existentes.

## Pruebas

Verificación documental local: lectura cruzada de reglas, enlaces/referencias,
unicidad de R-EVI-01, formato y diff, y hashes de archivos antes/después para
detectar cualquier cambio no documental. Resultado y alcance en
[regla-evidencia-verificacion.json](evidence/h192/regla-evidencia-verificacion.json).
En aquella tarea documental no se repitieron suites funcionales, build, pruebas
remotas ni certificados. Ese PASS sólo acredita coherencia documental y los
archivos de aquella revisión; no prueba funcionamiento de H-192 en producción.
La ejecución SQL posterior corresponde al seguimiento autorizado de `clearInventory`
y se registra en [isolated.json](evidence/h192/isolated.json).
Los hashes demuestran preservación de archivos; no demuestran corrección del negocio.

## Riesgo residual y pendientes

La regla es persistente y obligatoria por las instrucciones del repositorio;
su aplicación exige juicio y evidencia. No es un verificador automático de
premisas ni garantiza ausencia absoluta de errores. `THINKING.md` conserva
las once preguntas y su límite de 120 líneas; las puertas de WORKFLOW no cambian.
El sistema arquitectónico ya excedía su presupuesto global antes de esta tarea;
no se reestructuró el sistema completo para resolver esa deuda ajena al alcance.

Estado al concluir la retrospectiva: H-191 quedó publicada por autorización posterior del propietario; H-192 conservaba
migraciones sin aplicar. El hallazgo de vaciado quedó corregido y probado localmente en el
seguimiento autorizado, sin presumir aprobación ni verificación productiva.
La fotografía de permisos debe revalidarse en el ciclo productivo autorizado;
no se actualizó desde Supabase. El propietario autorizó después el respaldo en
`review/h191-h192-permissions`, con excepción de commit limitada a esa rama:
`ee593ce` conserva este aprendizaje y `7aaa960` el borrador funcional. No autoriza
aplicar H-192 ni publicar su cliente. La tabla y el censo privados no se subieron.

Seguimiento posterior del 14/11/2026: el dueño aprobó la tabla y autorizó producción.
234/235 quedaron aplicadas; la lectura posterior confirmó ocho hashes de funciones,
capacidades aprobadas de seis cuentas y preservación de datos comerciales. El
[expediente funcional](pantallas-operaciones-h192.md) registra respaldo, reversión
del primer intento, vía administrativa y límites. Este despliegue no convierte
el PASS documental anterior en prueba funcional; las operaciones reales siguen
NO PROBADAS por instrucción del propietario.

## Referencias

- [H-192 y H-191](../03-known-risks.md).
- [Metodología](../01-engineering-methodology.md), [THINKING](../architect/THINKING.md),
  [WORKFLOW](../architect/WORKFLOW.md), [seguridad](../architect/playbooks/security.md)
  y [entrega](../architect/playbooks/delivery.md).
- [Expediente H-191](altas-rol-operativo-h191.md) y [expediente H-192](pantallas-operaciones-h192.md).
