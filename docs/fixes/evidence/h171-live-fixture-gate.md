# H-171 · Prevención de nuevos residuos QA

**Fecha:** 12/09/2026, Hermosillo. **Commit:** Pendiente de commit.
**Estado:** prevención implementada; limpieza integral pendiente en H-171.

## Causa demostrada

`test-h164-live-online.mjs` certificaba sus escenarios y declaraba al terminar
`Business QA history retained`. El helper `h164-qa-retirement.mjs` desactiva
cinco perfiles, bloquea dos cuentas Auth y exige que la historia financiera
permanezca idéntica. Ese retiro no satisface la Definition of Done que exige
cero residuos QA en la autoridad comercial.

## Decisión y comportamiento

El runner rechaza la ejecución live y la reanudación antes de leer fuentes o
diarios, crear evidencia, consultar credenciales, abrir HTTP o aprovisionar.
Devuelve salida 2, `QA_RESIDUE_POLICY_UNSUPPORTED`, `certified:false` y
`deliveryCertified:false`. No existe una variable de excepción.

La comprobación `BALAM_LIVE_PREFLIGHT_ONLY=1` sigue validando localmente el
artefacto y la identidad de STORE; declara expresamente que no certifica y que
la ejecución live permanece bloqueada. No inicia solicitudes ni crea archivos.
El workflow describe el bloqueo e incluye el guardián en la regresión.

Los **22 escenarios históricos permanecen intactos**, igual que sus matrices,
recibos y hashes. H-169/H-170 conservan su evidencia de funcionalidad y
preservación bajo la política anterior; no prueban residuos cero ni certifican
el artefacto de H-171. Las guardas históricas de recuperación siguen probándose.

Se descartó retirar únicamente cuentas porque deja documentos comerciales.
Una limpieza completa requiere inventario por identidades y relaciones,
respaldo verificable, tratamiento de stock/recibos/Auth y comprobación de filas
ajenas; no se infiere a partir de prefijos ni se modifica `system_manifest`.

## Verificación

- `node test-h171-live-fixture-gate.mjs`: **5/5 PASS**. Ejecuta el runner real desde un directorio vacío; bloquea alta, resume inexistente, reintento y supuesta excepción de entorno antes incluso de leer `balam/store.jsx`. El directorio sigue vacío. El preflight válido sólo lee y declara no certificado.
- `node test-h170-certifier-recovery.mjs`: **10/10 PASS**, sin solicitudes remotas.
- `node test-h171-settings-controls.mjs --source`: PASS tras retirar selectores de texto de las acciones; la reproducción anterior se conserva.

Esta puerta **no resuelve el P0 de contaminación**, no limpia residuos
existentes y no convierte la falta de una matriz nueva en certificación.
La limpieza exacta y la decisión de entrega continúan pendientes en H-171.
