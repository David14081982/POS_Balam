# Restauración de permisos de vendedores

**Riesgo:** H-189
**Estado:** RESUELTO — asignaciones desplegadas y verificadas en Supabase
**Fecha:** 11/11/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Tres perfiles activos de vendedor vinculados a cuentas Auth no tenían
asignación activa en `pos.user_permission_role_assignments`. Los permisos
individuales permitían a dos de ellos abrir POS, pero no concedían la
capacidad `sales.create`. La evidencia productiva previa registró 18
solicitudes rechazadas, que se conservaron sin reintentar.

## Causa raíz

La autorización operativa requiere una asignación activa del rol vendedor.
Los permisos de pantalla no sustituyen esa asignación. No se atribuye un
origen histórico a las filas faltantes. La autenticación existente utiliza
`signInWithPassword`; esta corrección no modifica cuentas ni contraseñas.

## Diseño

Restaurar únicamente las tres asignaciones verificadas de LUIS, PRUEBA y
VENDEDORES mediante el coordinador online y la autoridad vigente de permisos.
Conservar reglas del rol, permisos individuales, administradores, UI,
configuración y datos comerciales. Los identificadores y condiciones
esperadas están cerrados en el script y el manifiesto.

## Solución

- `supabase/operations/h189-restore-seller-assignments.sql`: operación ya
  aplicada; conserva comprobaciones transaccionales de preservación.
- `supabase/operations/h189-targets.json`: manifiesto de las tres cuentas.
- `supabase/operations/h189-rollback-seller-assignments.sql`: reversión
  específica archivada; no ejecutada.

Los archivos se publican sin modificar su contenido previamente validado.
No se vuelve a ejecutar SQL durante el commit y push. Las cabeceras de los
scripts describen su preparación original; la restauración ya fue aplicada
con autorización en esta sesión.

## Pruebas

Se conserva la ejecución previa de H-189: preflight remoto, dry-run de las
migraciones entonces autorizadas, dos casos aislados y postflight remoto.
Las cinco comprobaciones pasaron a la primera. No se ejecutaron más pruebas
para esta publicación ni se repitieron las suites generales.

El [postflight existente](evidence/h189/execution-20261111/postflight-comparison.json)
confirma tres asignaciones y tres recibos de permisos, sin capacidades
administrativas; 60 tablas protegidas, cinco secuencias comerciales y los
18 rechazos históricos permanecieron intactos. Se conserva también la
[salida de la operación](evidence/h189/execution-20261111/roles-apply-raw.json).
Ese postflight corresponde al trabajo productivo previo completo de H-189;
no significa que esta publicación incluya sus cambios de stock.

## Entrega, riesgo residual y pendientes

El usuario autorizó publicar código y evidencia y después limitó expresamente
el commit y push a permisos de vendedores. La publicación parte de
`3f6529027545b37d3890b1cb1a862054ecf1ac07` y contiene sólo este alcance.
Los commits usan `[skip ci]` para respetar el límite de pruebas; no se
regenera ni despliega otro cliente.

Las migraciones de stock V2 228/229 ya aplicadas previamente en Supabase no
se incluyen. Su código y expediente permanecen conservados localmente en
`c23fedf5a876c891bc7fe8ac87f3e86ca6a9cb30` y
`3ba51a093971e40caa7dcb7b2ab786d079454b12`; deben tenerse presentes antes de
planificar otra entrega de base de datos.

Inicio de sesión real con las credenciales de cada vendedor: NOT_TESTED.
Se verificaron las asignaciones y capacidades, no ese recorrido en terminal.
La selección manual de vendedor y las reglas de ventas/comisiones se
conservan. A/B/C NO CERTIFICADO, no solicitado. No se inicia otro problema.

## Referencias

- Riesgo: `docs/03-known-risks.md`, H-189.
- Autoridad existente: `docs/architect/authorities/security.md`.
- Autenticación existente: `balam/auth.jsx`.
