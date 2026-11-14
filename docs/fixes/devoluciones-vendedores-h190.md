# Devoluciones y cambios de vendedores: guarda V2 y lectura del documento

**Riesgo:** H-190
**Estado:** RESUELTO — DESPLEGADO Y VERIFICADO EN SUPABASE; caja pendiente
**Fecha:** 13/11/2026 (Hermosillo)
**Commit:** Pendiente de commit

## Problema y reproducción

La auditoría entregada por el dueño registra tres devoluciones rechazadas con
42501 el 13/11. El preflight propio confirmó tres recibos rechazados, la guarda
H-189 con hash `605bf2f7add6117c0cd17436e3945c32` y únicamente la policy
administrativa en `returns` y `return_items`.

`node test-h190-seller-postsale.mjs --before` reproduce ambos rechazos usando
el gateway real, un vendedor autorizado y productos V2 sintéticos. Sus huellas
comerciales no cambian. La misma devolución sí confirma como administrador,
pero el snapshot consultado como vendedor no contiene cabecera ni renglones.
Dos operaciones esperadas fallan antes del parche; también falla la lectura.

## Causa raíz

H-189 sólo excluye el espejo `stock_quantity` de su comparación protegida ante
una reserva de venta legítima. `commit_return` incrementa existencias con
`return:` y `commit_exchange` usa `exchange:`. Ninguno satisface esa excepción.
La normalización V2 ocurre antes de la guarda del vendedor.

Separadamente, `online_snapshot()` es SECURITY INVOKER. La capacidad de ejecutar
la devolución no permitía leer sus dos tablas. Tras el commit, `confirmed()` de
DATA necesita el documento; su ausencia causa confirmación pendiente y puede
presentar la venta como inconsistente. Por eso escritura y lectura se corrigen
en una sola transacción.

## Diseño

Se respetó Comprender → Reproducir → Causa raíz → Diseño → Corrección → Pruebas
→ Documentación → Cierre. Fuente de definición: preflight real del servidor.
La definición nueva se generó insertando dos bloques antes de la comparación
final; retirarlos reproduce byte por byte la definición H-189.

- Devolución: V2, cantidad no negativa que aumenta, marcador `return:`, dueño
  de `commit_return`, JSON stock exactamente igual al espejo y solicitud
  `executing` del mismo actor con comando `return`.
- Cambio: iguales condiciones, dueño de `commit_exchange`, marcador y comando
  `exchange`, cantidad final no negativa. Admite los dos sentidos del stock.
- La guarda conserva SECURITY INVOKER, propietario, ACL y search_path. Mantiene
  intactas la rama de venta y la comparación de todos los demás atributos.
- Dos policies exclusivamente SELECT consultan `current_has_capability`.
  Perfil, asignación y rol activos siguen siendo requisitos de esa autoridad.
- No se modifican transacciones comerciales, wrappers, triggers, RLS de
  productos, asignaciones, datos, recibos anteriores, cliente o impresión.

El contrato online de ADR-015 continúa vigente. No hay cola, replay ni
persistencia paralela nueva. Los históricos no se transforman. Un resultado
incierto conserva la identidad existente; no autoriza repetir el negocio.

## Solución

- `20261113023000_pos_h190_seller_postsale.sql`: reemplazo de una función y dos
  policies en una misma transacción, con verificaciones antes de COMMIT.
- `20261113023100_pos_h190_seller_postsale_verification.sql`: verificación
  autocontenida de metadatos y frontera de acceso, sin semillas productivas.
- `h190-readonly.sql`: lectura de metadatos y huella agregada de los rechazos.
- Dos arneses pequeños reutilizan la fixture SQL H-189 y datos sintéticos.

Hash nuevo de la función: `d250cdd879860bf1cb3014b5b38b1310`.
La migración aborta ante deriva del hash previo; no debe reaplicarse.

## Pruebas

Diez comprobaciones de alcance: siete casos locales y tres de despliegue.
No se ejecutaron suites generales, `test-migrations.mjs` ni CI para respetar
el límite solicitado. La verificación SQL específica sí corrió localmente,
dentro de 230 antes del commit y como migración 231 en producción.

| Caso | Comando / comprobación | Resultado |
|---|---|---|
| 1 | `node test-h190-seller-postsale.mjs --before` | Reproduce rechazos y documento invisible |
| 2 | `node test-h190-seller-postsale.mjs`: instalación | Filas POS, otras funciones, privilegios, RLS y triggers preservados |
| 3 | Mismo arnés: venta y primera parcial | Stock, reembolso, comisión y lectura correctos |
| 4 | Mismo arnés: segunda parcial | Lectura completa, replay sin efectos, exceso rechazado |
| 5 | Mismo arnés: cambio entre dos referencias | +1/-1 stock, diferencia de 50, evidencia financiera original intacta |
| 6 | Mismo arnés: frontera de seguridad | UPDATE directo y marcadores falsos 42501; roles inválidos bloqueados |
| 7 | `node test-h190-policy-roles.mjs` | Admin inactivo bloqueado; predicado respeta deny de capacidad |
| 8 | `supabase db query --linked --file supabase/operations/h190-readonly.sql --output json` previo | 228/229 aplicadas, hash y policies esperados |
| 9 | `supabase db push --linked --dry-run` | Sólo 230/231 |
| 10 | Misma consulta readonly posterior + comparación | Sólo la función y dos policies previstas cambiaron |

Hubo reintentos de preparación del arnés: dos errores de tipos del parámetro de
producto, dos intentos con pago sintético sin componentes H-186 y un arranque
del caso 7 sin activar el cerco online. Se corrigieron las fixtures, no el
producto; no se repitieron casos que ya habían pasado. El límite anterior es
de comprobaciones distintas, no de invocaciones del runner. Evidencia final:
[baseline](evidence/h190/baseline.json), [cinco casos](evidence/h190/isolated.json),
[roles](evidence/h190/policy-roles.json), [despliegue](evidence/h190/deployment.json).

## Despliegue y reconciliación

`git fetch` confirmó la divergencia H-189. El merge local `ee6cb3b` conserva
ambos historiales, resolviendo solamente los dos documentos en conflicto.
Los cinco PDF borrados y `supabase/.temp/cli-latest` permanecen ajenos a la historia.
228/229 se conservan sin cambios; no se reaplicaron.

`supabase db push --linked --yes` aplicó únicamente 230/231. El postflight del
14/11/2026 06:07:37 UTC confirmó el hash nuevo, ambas policies, otras 171
funciones idénticas, privilegios/RLS de 64 tablas, 112 triggers y las 73 policies
anteriores intactos. Los tres recibos rechazados conservan exactamente su hash.
La migración no contiene DML comercial; no se hicieron pruebas funcionales ni
operaciones comerciales en producción. No se afirma comparación exhaustiva de
filas comerciales productivas: la preservación de todas las filas se midió en
la fixture; en remoto se verificaron metadatos y los tres rechazos.

Publicación de código pendiente de registrar. No se genera ni despliega cliente.

## Riesgo residual y pendientes

Primera devolución/cambio real por vendedor, UI de confirmación y documento
impreso: NOT_TESTED. Prueba física de impresora: NOT_TESTED. A/B/C: NO CERTIFICADO,
no solicitado. No se afirma una certificación completa con estas pruebas básicas.
Recargar la aplicación permite consultar inmediatamente los documentos ahora
autorizados; las confirmaciones nuevas ya consultan el snapshot completo.

Reversión: nueva migración que restaure la definición exacta H-189 y retire
únicamente `h190_refund_select` de ambas tablas, con comparación de hash y
conservación de metadatos. No borrar recibos ni revertir ventas/devoluciones
válidas posteriores. Esta reversión no fue ejecutada ni probada en esta historia.

Aprendizaje: probar una guarda compartida sólo con ventas no cubre posventa.
Los casos añadidos demuestran tanto la escritura como la lectura del documento
desde el mismo rol. No se añade otra autoridad ni otra regla arquitectónica.

Historias 2 y 3 no iniciadas; continúan pendientes de su ciclo independiente.

## Referencias

- `docs/03-known-risks.md`, H-190.
- `docs/02-architecture.md`, autorización y commit de devolución.
- `docs/04-contrato-del-cambio.md`.
- Migraciones H-189 228/229 y fixture `test-fixtures/h189/sql-fixture.mjs`.
