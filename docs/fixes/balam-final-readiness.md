# BALAM FINAL READINESS

**Riesgo:** H-171. **Estado:** EN CURSO; aptitud final de entrega NO CERTIFICADA.
**Fecha:** 13/09/2026, Hermosillo. **Commit:** Pendiente de commit.
**Corte:** recuperación `9482…` COMPLETA; `d4b616be…` interrumpido, su limpieza EN CURSO; publicación de f4d EN CURSO.

## 1. Qué se hizo

Architecture Navigator confirmó exclusivamente `David14081982/POS_Balam`,
Supabase `telohdbvbvsfmwyriflz`, esquema `pos` y ADR-015: **Only Online**.
El trabajo parte de `c148a8c0935ea533035387a391965df9b0748082` en
`.work/balam-final-readiness`; la copia raíz antigua no define el producto vigente.
Supabase confirma operaciones y stock; DATA/CONFIG son proyecciones efímeras.
El shell PWA no habilita ventas sin internet ni replay comercial.

Se auditaron superficies, controles y autoridad; se corrigieron siete controles
inoperantes y dos recortes responsive. La [matriz de superficies](evidence/h171-surfaces.md)
conserva entradas, acciones, backend, persistencia, resultados y límites de cobertura.

La limpieza histórica autorizada está comprobada:

| Alcance | Resultado y evidencia |
|---|---|
| Comercial | **149/149 eliminadas**, 35/35 tablas protegidas conservadas; [postcheck independiente](evidence/h171/commercial-post-delete.json). |
| Técnico | **317 adicionales eliminadas**, sin contar las ocho ya incluidas en 149; [COMMIT y verificación](evidence/h171/technical-cleanup-outcome.json). |
| Auth | **11/11 identidades ausentes**: 10 DELETE por GoTrue y una ya ausente; [resultado](evidence/h171/auth-retirement-result.json). |
| Autoridad protegida | **973 productos / 251 familias / 3483 piezas**; [integridad posterior](evidence/h171/after-auth-protected-integrity.json). |

El primer intento comercial falló por `DEVICE_RETIRED` y revirtió 35/35 tablas.
La copia autorizada con el contexto de mantenimiento existente confirmó 149;
no se desactivaron guardas ni se reactivaron instalaciones. Los respaldos privados
canónicos reprodujeron **149/149 comerciales y 325/325 técnicas** en restauración
local con tipos reales: [comercial](evidence/h171-commercial-backup-roundtrip.md)
y [técnica](evidence/h171-auth-tech-canonical-restore-validation.json).

Se preservan la venta `BG-260912-0001`, operación
`35e2c61a-7561-41b9-9535-e39e671a55d3`, y la solicitud real
`70549527-4867-4342-94d2-38e770b0f2a9`, completada posteriormente y conservada con
MD5 `8fdc987d8fe491f467f968da4c5306e0`; [inspección](evidence/h171/request7054-completion-inspection.json).
Folio, nombre, prefijo o fecha aislados no autorizan una baja. **Storage: cero
objetos eliminados**; los 2520 objetos inventariados pertenecen al propietario comercial.
Las revisiones y los contadores monotónicos avanzan; no se rebobinan para aparentar igualdad.

## 2. Qué cambió para el usuario

- Retirados seis editores sin efecto: `currency`, `pos.askSize`, `pos.allowLayaway`,
  `commission.auto`, `pos.sound` y `print.lowStockAlert`. Sus valores históricos se conservan.
- Retirado «Enviar felicitación», que no tenía handler; la lista de cumpleaños permanece.
- Usuarios permite acceder a Estado, Editar y Activar/Desactivar en móvil mediante scroll
  horizontal accesible. El selector semanal/mensual ajusta su cabecera al ancho.
- Añadido el atributo inerte `data-testid='auth-logout'` para el recorrido UI real.

Fuentes: `balam/settings.jsx`, `balam/dashboard.jsx` y `balam/app.jsx`.
Ambos HTML y `sw.js` se regeneraron con `node build-offline.mjs`; no hay migración
comercial nueva. El certificador registra intenciones antes de HTTP, respalda por
PK/huella y retira sólo fixtures nuevos demostrados. La ejecución live requiere
invocación explícita; un preflight local no certifica la entrega.

## 3. Pruebas realizadas

Candidato actual, idéntico en ambos HTML, SHA-256:
`f4d73fa350d4187dade1a55c999dc203b405f4c20d95d9138aaf1b2ef0a82646`.
[Identidad de artefactos](evidence/h171/final-logout-artifacts.json).

| Evidencia ejecutada | Resultado y límite |
|---|---|
| Jornada UI aislada sobre f4d | **9/9 escritorio + 9/9 móvil**: login, variante, carrito, cobro, vendedor, ticket, stock, consulta, logout/relogin y refresh; [escritorio](evidence/h171/core-journey-logout-desktop/journey.json), [móvil](evidence/h171/core-journey-logout-mobile/journey.json). |
| Smoke y responsive sobre f4d | **192/192 superficies + 8/8 anchos**, 208 capturas, cero errores JS, recortes o escrituras externas; [verificación](evidence/h171-smoke-final-f4d/verification.json). |
| Regresión amplia anterior | Evidencia del candidato cf32: [regresiones de navegador](evidence/h171/final-browser-regressions.json). No se atribuye automáticamente al nuevo hash. |
| Lectura real canónica | **64 tablas / 4332 filas**, inventario 973/251/3483 y venta protegida confirmados en ese corte; [captura](evidence/h171/canonical-capture-probe.json). |
| Ciclo de limpieza local | SQL y Auth separados, restauración, dependencias y revisiones comprobados con fixtures locales; [ciclo integrado](evidence/h171/live-cleanup-lifecycle-local.json). No acredita una limpieza remota pendiente. |

Los recorridos aislados usan transporte interceptado: no certifican Supabase,
RLS, persistencia real ni concurrencia. La matriz histórica H170 tiene su propio
alcance y artefacto; no se convierte en 22 jornadas UI ni en certificación H171.

El intento real `9482…` aprobó ocho escenarios y se interrumpió en el siguiente
antes de enviar CONFIG: el journal confundió el booleano comercial
`lookup.meta.requiresAuthorization` con un campo secreto. No existe intención
CONFIG registrada. Es un fallo del **certificador**, sin defecto de producto
nuevo demostrado; [interrupción y causa](evidence/h171/live-interruption.json).
El runner actual incorpora vigilancia del journal y límite de 360 segundos por
caso. La recuperación exacta de `9482…` está **COMPLETA**: **35/35 filas POS
eliminadas y 1/1 Auth ausente**, con cero residuos nuevos de ese run. Las **63
tablas protegidas coinciden exactamente** y la revisión monotónica conserva su
avance legítimo; inventario **973/251/3483**, venta `BG-260912-0001` y solicitud
7054 intactos. [Resultado independiente](evidence/h171/recovery-completion.json),
SHA-256 `a5af78b29355dfbb3c2da19a831e4598876e9bfb3b795c1c885cb0ff9bd42ad4`.
La recuperación acredita ese run interrumpido, no la jornada final.

La jornada `d4b616be-2bed-4512-9053-6f0ee6a7c372`, iniciada a las **07:18 UTC**,
se interrumpió en `confirmed-sale-ticket`: el comprobador exigía exactamente un
handoff con `print.auto=true` y acción manual posterior. El contador real no se
guardó; no se afirma que hubiera cero o dos. La corrección del comprobador no
cambia el producto; [evidencia y límite](evidence/h171/live-print-observation-interruption.json).
Los **cuatro casos finales quedan pendientes de reintento**:

1. Arranque de A/B/C independientes desde la autoridad.
2. Dos ventas completas por UI, primero C y después A, con ticket, stock y comparación A/B/C.
3. Bloqueo Only Online sin éxito ni cola comercial; reconexión y lectura de autoridad.
4. Recarga de B y cierre completo de C; contexto nuevo vacío, login UI y reconstrucción desde Supabase.

Limpieza d4b **EN CURSO: 20 filas POS + 1 Auth**; plan listo y restauración **20/20**,
review `90c79dad9aada466533d98f1641358c0dd7cee49b2052fa0beac5a9fd6f678c8`.
El marcador interno `sale:<UUID>` de producto/vendedor se vinculó por actor,
recibo y estado exactos. No demuestra un defecto del producto ni una baja concluida.

## 4. Despliegue

Candidato f4d **en proceso de publicación; bytes servidos aún sin verificar**.
La verificación pública previa correspondía a H170, SHA
`ae53f13541729ecb3fff768d4a974a44fd5fe790f7d7961d6fde1dd28801665d`.
Rama de trabajo: `release/balam-final-readiness`. El resultado de la jornada final,
su limpieza y la publicación se incorporará al terminar; este corte no los anticipa.

## 5. Riesgos residuales

**P0 de producto conocidos pendientes: 0. P1 de producto conocidos pendientes: 0.**
La recuperación 9482 está completa; la limpieza de d4b sigue en ejecución.
No se declara limpio ni certificado. **P2/P3 nuevos pendientes: 0/0** dentro del
alcance revisado. La **DoD sigue pendiente** hasta verificar los cuatro casos,
su limpieza exacta y la publicación del candidato; lo no ejecutado no se presume PASS.

El OWNER ordenó conservar estas cuatro filas hasta su decisión individual.
Todas tienen baja lógica y ninguna se incluye en los retiros autorizados:

| Tabla / ID exacto | Nombre exacto conservado |
|---|---|
| clients / `cli-1789079431176-jyxi` | `QA editado` |
| clients / `cli-1789078624431-0fz3` | `qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c recovered` |
| clients / `cli-1789078938103-ams0` | `qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c reactivated` |
| promotions / `promo-1789079431430` | `qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c` |

Se conservan las recuperaciones H148 B `c2e16d05-cd08-44a2-8279-43804a7d23a9`
y C `07134617-ac05-4c2e-afad-5def238bd3c5`: completadas, dispositivos revocados,
con listas de descarte de 10 y 17 operaciones necesarias para impedir replay.
Sus `write_token` no nulos se omitieron del respaldo; no se afirma caducidad ni
restauración íntegra. La [evidencia individual](evidence/h171/remaining-held-decisions.json)
detalla nombres, fechas, huellas y relaciones, sin exponer tokens.

También permanece el original legacy `eef0157e-287a-417d-aa14-c7c3983fc3d7` en
`needs_review`, sin reaplicar ni descartar. Hardware de impresión/lector y todos
los puestos físicos no están certificados; el ticket HTML no prueba impresión física.

## 6. Commits

**Pendiente de commit** técnico y documental. Este informe y el resumen H171 de
[riesgos conocidos](../03-known-risks.md) son el cierre ejecutivo único de esta H;
los datos extensos y resultados históricos permanecen en la evidencia enlazada.
