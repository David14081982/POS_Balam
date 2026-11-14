# Rol operativo en altas de cuentas

**Riesgo:** H-191
**Estado:** RESUELTO — SQL desplegado; publicación del cliente en curso.
**Fecha:** 14/11/2026
**Commit:** Pendiente de commit

## Problema y reproducción

El recibo de alta confirmaba Auth y el perfil, pero no su asignación operativa.
El fixture reprodujo un alta confirmada sin `sales.create`; el editor podía
reenviar `base_role` nulo. No se crearon cuentas de prueba en producción.

## Causa raíz

`admin-users` entrega el perfil a `execute_online_command` y
`online_save_entities` lo inserta sin poblar `user_permission_role_assignments`.
El snapshot del editor tampoco incluía el rol del perfil para usarlo de respaldo.

## Diseño

La confirmación SQL es la autoridad. Sólo un perfil nuevo, asociado al recibo
`create/auth_confirmed` del mismo actor y al mismo id/correo Auth, recibe su rol.
La inserción y su auditoría pertenecen a la transacción del perfil. Conflictos
con asignaciones existentes no las reemplazan ni reactivan. Sin backfill.
El editor usa `base_role || user.role`, con ambos valores procedentes del servidor.

## Solución

232/233 reemplazan dos funciones desde sus definiciones productivas, con hashes
previos, propietarios, ACL y search_path conservados. No cambia la Edge Function,
Auth, contraseñas, navegación, excepciones ni autoridades comerciales.
Se regeneraron los HTML y SW desde `balam/permissions.jsx`.
La invalidación administrativa existente incluye las asignaciones de rol.

## Pruebas

Cuatro casos dirigidos, sin suites generales por el límite del propietario:

1. `node test-h191-account-role.mjs`: alta por RPCs de recibo y gateway,
   ausencia previa, asignación posterior, capacidad efectiva, reintento,
   conservación de asignación inactiva/deny y rechazo de escrituras privadas.
2. Mismo arnés: ejecución del cierre real `save()` del editor con rol ausente
   y existente; el snapshot SQL suministra el rol del perfil.
3. `BALAM_UI_CASE='Inventario: cajón' node test-h164-online-ui.mjs`: 1/1,
   ejecuta el bundle regenerado con red externa bloqueada.
4. `BALAM_PWA_CASE=activation node test-h164-online-pwa.mjs`: 1/1,
   activación conserva evidencia antigua y elimina sólo recursos estáticos.

Preparación del fixture: dos intentos fallaron por el orden de la siembra y
por sembrar una asignación con identidad activa; corregidos antes de 2/2 PASS.
No se atribuye primera pasada verde. Auth se simula en aislamiento; las RPC SQL
son reales. Build PASS. Dry-run seleccionó exclusivamente 232/233; se aplicaron
y el postflight comparó las definiciones exactas, el resto de funciones,
asignaciones, excepciones, policies, ACL y triggers: todos conservados.
Evidencia sanitizada en `evidence/h191/`; metadatos íntegros sólo locales.

## Riesgo residual y pendientes

Alta real mediante Auth remoto y aceptación en terminal: NOT_TESTED. No se
modificó ni desplegó la Edge Function. Certificación A/B/C NO CERTIFICADO.
Las cuentas históricas sin asignación no se reparan automáticamente; el editor
usa su perfil cuando el administrador guarda. Rollback mediante migración
nueva de las dos definiciones previas, conservadas localmente; no borrar roles.
Entrega selectiva para conservar el historial privado H-189 y los cinco PDF
borrados ajenos. Workflow manual verifica evidencia y hashes para respetar el
límite de pruebas; no ejecuta suites amplias ni certificación distribuida.

## Referencias

- `docs/03-known-risks.md`, H-191; `docs/02-architecture.md`, Edge Functions.
- `docs/fixes/permisos-vendedores-h189.md`.
