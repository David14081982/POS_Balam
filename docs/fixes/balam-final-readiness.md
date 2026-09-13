# BALAM FINAL READINESS

**Riesgo:** H-171. **Fecha:** 13/09/2026.
**Estado:** PARCIALMENTE RESUELTO: trabajo autorizado y publicación completos; DoD pendiente de decisión OWNER.

## 1. Qué se hizo

**Production ready: NO.** BALAM NO puede entregarse todavía bajo la DoD estricta por **una causa**: cuatro filas históricas siguen sin clasificación OWNER. Las comprobaciones operativas priorizadas terminaron; no quedan nuevas pruebas programadas para este cierre.

| Indicador | Resultado |
|---|---|
| P0 open / P1 open | **0 / 0** defectos de producto conocidos pendientes |
| P2 backlog / P3 backlog | **0 / 0** nuevos defectos reproducidos pendientes dentro de H171 |
| Critical workflows | **4/4 comprobaciones del cierre priorizado PASS**, compuestas de dos ejecuciones sobre el mismo artefacto |
| Data / inventory integrity | **PASS: 973 productos, 251 familias, 3,483 piezas** |
| Supabase authority / stock / sales persistence | **PASS** en las ejecuciones y contratos identificados abajo |
| Permissions | **PASS**, evidencia real reutilizada de contrato sin cambios |
| Refresh / relogin / A/B/C | **PASS**, incluido contexto nuevo vacío |
| QA contamination | **0 residuos nuevos de los manifiestos verificados; 4 filas UNKNOWN retenidas. Cero global NO acreditado** |
| Critical JS errors / dead blocking warnings | **0 errores JS observados; ningún aviso muerto bloqueante demostrado** en el alcance revisado |
| Dead/inoperative functions removed | **7** |

Architecture Navigator confirmó exclusivamente `David14081982/POS_Balam`, Supabase
`telohdbvbvsfmwyriflz`, esquema `pos` y ADR-015: **Only Online**.
Supabase confirma las operaciones; DATA/CONFIG son proyecciones efímeras.
El shell PWA y el nombre histórico del HTML no habilitan ventas sin internet ni replay comercial.
El [inventario de caminos críticos](evidence/h171/critical-workflows.json) registra 22 grupos funcionales en un corte histórico; no representa 22 jornadas UI certificadas ni el resultado actual. La [matriz de superficies](evidence/h171-surfaces.md) conserva sus límites de cobertura.

La limpieza histórica autorizada quedó completa, con respaldos y comprobaciones:
**149/149 filas comerciales**, **317 técnicas adicionales** y **11/11 identidades Auth ausentes**
—10 bajas GoTrue y una ausencia previa—.
Evidencias: [comercial](evidence/h171/commercial-post-delete.json),
[técnica](evidence/h171/technical-cleanup-outcome.json) y [Auth](evidence/h171/auth-retirement-result.json).

| Fixtures propios de la entrega | Retiro y verificación |
|---|---|
| `9482e643…` | **35/35 POS + 1/1 Auth**; [evidencia](evidence/h171/recovery-completion.json). |
| `d4b616be…` | **20/20 POS + 1/1 Auth**; [evidencia](evidence/h171/recovery-completion-d4b.json). |
| `6826dbe9…` | **20/20 POS + 1/1 Auth**; [evidencia](evidence/h171/recovery-completion-6826.json). |
| `57a5e11f…` | **28/28 POS + 1/1 Auth**; [evidencia](evidence/h171/recovery-completion-57a5.json). |
| `04beb00f…` | **8/8 POS + 1/1 Auth**, sin ventas nuevas; [evidencia](evidence/h171/final-session-cleanup.json). |

Los 973 productos reales conservan su integridad. La venta **BG-260912-0001**,
operación `35e2c61a-7561-41b9-9535-e39e671a55d3`, y la solicitud real completada
`70549527-4867-4342-94d2-38e770b0f2a9` permanecen intactas.
Las filas ajenas a cada manifiesto conservaron sus hashes. Sólo permanecen los
avances monotónicos legítimos; el contador BG del 13/09 queda en **4**, sin rebobinar.
**Storage: cero objetos eliminados**; no se equipararon referencias ausentes con orfandad demostrada.

## 2. Qué cambió para el usuario

Se retiraron seis editores sin efecto: `currency`, `pos.askSize`, `pos.allowLayaway`,
`commission.auto`, `pos.sound` y `print.lowStockAlert`, conservando sus valores históricos.
También se retiró «Enviar felicitación» sin handler; la lista de cumpleaños permanece.
Usuarios permite acceder a Estado, Editar y Activar/Desactivar en móvil; el selector
semanal/mensual ajusta su cabecera al ancho.

Las fuentes modificadas de producto son `balam/settings.jsx`, `balam/dashboard.jsx`
y `balam/app.jsx`; este último incorpora un selector inerte para logout.
Se regeneraron los artefactos. No se alteraron las autoridades comerciales ni las migraciones.
El comprobador registra intenciones, respalda y retira sólo sus fixtures demostrados.

## 3. Pruebas realizadas

| Evidencia | Resultado y alcance |
|---|---|
| UI aislada, artefacto final | **9/9 escritorio + 9/9 móvil**; [escritorio](evidence/h171/core-journey-logout-desktop/journey.json), [móvil](evidence/h171/core-journey-logout-mobile/journey.json). |
| Superficies y responsive | **192/192 + 8/8 anchos**, 208 capturas; [resultado](evidence/h171-smoke-final-f4d/verification.json). |
| Matriz real H170, contrato previo | **22 escenarios distintos PASS en 26 intentos**, con 4 interrupciones recuperadas; [matriz histórica](evidence/h170-live-matrix.json). No son 22 jornadas UI del nuevo artefacto. |
| Permisos | [Evidencia real reutilizada](evidence/h171/permission-evidence-reuse.json): AUTH, permisos, STORE, DATA, SCREENS, Edge y migraciones sin cambios; no se atribuye cobertura nueva de todos los roles. |
| Jornada real `57a5…` | Tres casos PASS: A/B/C, dos ventas UI de **9/9 + 9/9 pasos** y bloqueo/reconexión Only Online; [casos completados](evidence/h171/final-journey-completed-cases.json). |
| Sesión nueva `04beb…` | Bootstrap y contexto C vacío **2/2 PASS**, refresh B y comparación A/B/C, con limpieza completa. |
| Aceptación del cierre | **4 nombres distintos PASS: 3 + 1**, sin duplicar bootstrap; [aceptación](evidence/h171/final-acceptance.json). |

Las dos ventas se completaron primero en C y después en A: login, variante,
carrito, cobro validado, vendedor, ticket, stock, consulta y refresh.
La última sesión partió de cookies y almacenamiento vacíos y reconstruyó el estado desde Supabase.

El cuarto FAIL original de 57a5 se conserva: el comprobador confundía el UUID Auth
con el identificador de vendedor. Se corrigió y se ejecutó sólo la comprobación
pendiente. La guarda SQL de su limpieza hizo rollback por contar por fila un trigger
que avanza por sentencia; la corrección **10→9** preservó los mismos 28 objetivos,
DELETE, hashes, locks y fences. Sus postchecks remotos quedaron verificados.
Las interrupciones de los comprobadores no se reescribieron como PASS ni se atribuyeron al producto.

## 4. Despliegue

**PUBLICADO Y VERIFICADO**, commit `1dddd60494c7b24beb1574851bf06d040079b0f7`.
El [workflow 34746195058](https://github.com/David14081982/POS_Balam/actions/runs/34746195058)
terminó con regresiones y deploy SUCCESS.
A las **07:57:34 UTC del 13/09/2026**, ambos HTML y `sw.js` públicos devolvieron
HTTP 200 y coincidieron byte por byte con Git: [verificación](evidence/h171/production-verification.json).

SHA-256 de ambos HTML: `f4d73fa350d4187dade1a55c999dc203b405f4c20d95d9138aaf1b2ef0a82646`.
[Producción BALAM](https://david14081982.github.io/POS_Balam/).
El cierre posterior modifica comprobadores y documentación; conserva estos mismos bytes de cliente.

## 5. Riesgos residuales y decisión OWNER

Estas cuatro filas conservan su baja lógica y su hash. Sus nombres o dispositivos
sugieren QA, pero no demuestran por sí solos su identidad. **No fueron borradas.**

| Fila | Nombre | Decisión pendiente |
|---|---|---|
| Cliente `cli-1789079431176-jyxi` | QA editado | Clasificar como historia a conservar o autorizar retiro exacto. |
| Cliente `cli-1789078624431-0fz3` | qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c recovered | Clasificar como historia a conservar o autorizar retiro exacto. |
| Cliente `cli-1789078938103-ams0` | qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c reactivated | Clasificar como historia a conservar o autorizar retiro exacto. |
| Promoción `promo-1789079431430` | qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c | Clasificar como historia a conservar o autorizar retiro exacto. |

Los clientes aparecen en respaldos y recibos históricos protegidos. El
[detalle individual](evidence/h171/remaining-held-decisions.json) conserva las referencias
y la falta de prueba inmutable de creación. Mantener una fila por autorización
no demuestra que sea ajena a QA; por eso la DoD global permanece pendiente.

Se conservan las recuperaciones H148 B `c2e16d05-cd08-44a2-8279-43804a7d23a9`
y C `07134617-ac05-4c2e-afad-5def238bd3c5`: sus listas de 10 y 17 descartes
protegen contra replay. Sus tokens no nulos se omitieron del respaldo; no se
afirma caducidad ni restauración íntegra. El legacy
`eef0157e-287a-417d-aa14-c7c3983fc3d7` permanece `needs_review`, sin aplicarlo.

Impresora, lector y la totalidad de puestos físicos no están certificados.
El ticket HTML y su entrega al navegador no prueban impresión física.
Apertura/cierre formal de caja y ventas offline no son flujos del producto actual.
Estos límites no se convierten en defectos P2/P3 no reproducidos.

## 6. Commits

- Producto H171: `b6d5edd07d7768a499fd7db7edfb428d8544520a`.
- Registro inicial: `8b692acc6e584c081491668cacb542fa1ab3b0b0`.
- Candidato publicado: `1dddd60494c7b24beb1574851bf06d040079b0f7`.
- Comprobadores y evidencia final: **Pendiente de commit**.
- El registro documental posterior incorpora el hash técnico; no publica otro cliente.
