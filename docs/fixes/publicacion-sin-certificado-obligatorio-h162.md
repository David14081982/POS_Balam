# Publicación sin certificación real obligatoria

**Riesgo:** H-162
**Estado:** PARCIALMENTE RESUELTO — corregido localmente; publicación pendiente
**Fecha:** 11/09/2026
**Commit:** Pendiente de commit

## Problema y reproducción

La corrección H-161 llegó a `origin/main` con sus 98 comprobaciones locales
aprobadas, pero GitHub Pages siguió sirviendo el HTML anterior. La ejecución
H148 `34664301574` falla en `Require a complete live certificate for this
delivery`: `tested build differs from delivery`, código 1. El job `deploy`
queda omitido aunque las comprobaciones anteriores a esa puerta aprobaron.

El usuario autorizó expresamente retirar las condiciones de certificación
real que impiden publicar en GitHub. La decisión aplica al requisito de entrega;
no declara ejecutadas las pruebas reales ni autoriza operaciones comerciales.

## Causa raíz

`.github/workflows/h148-sync-authority.yml` valida obligatoriamente el archivo
`docs/fixes/evidence/h148-live-matrix.json` contra el nuevo HTML en cada push o
pull request. Cualquier cambio del bundle invalida ese certificado, lo que
convierte la matriz real en una dependencia universal de publicación.

`test-h155-publication.mjs` exige la misma puerta, por lo que retirar sólo el
paso YAML dejaría una regresión obligatoria fallando. Los tests H132 utilizan
fixtures o snapshots sintéticos y no requieren certificación remota; permanecen.
La consulta API de protección de `main` respondió 404, `Branch not protected`;
el bloqueo observado procede del workflow. Local y remoto estaban alineados en
`a0fdb78` antes de esta corrección.

AGENTS y las reglas arquitectónicas vigentes exigen esa misma certificación.
Deben actualizarse junto con el workflow para reflejar la instrucción actual
del usuario y evitar restablecer automáticamente la condición retirada.

## Diseño

La publicación normal conserva las regresiones y deja de exigir un certificado
real A/B/C. El workflow mantiene la ejecución real como opción manual bajo
petición y conserva la validación estricta de la evidencia cuando se ejecuta.
Una entrega sin esa ejecución se identifica como no certificada en remoto.

La modificación se limita a automatización, pruebas de su contrato y reglas
de trabajo. No cambia lógica comercial, SQL, permisos, identidad, cola offline
ni datos. Los bytes de H-161 ya probados deben conservarse y verificarse tras
el despliegue.

## Solución

En `.github/workflows/h148-sync-authority.yml` se retiró únicamente el paso que
exige el certificado real en la regresión automática. Se conserva el self-test
del validador, el resto de las regresiones, `deploy.needs: regression` y las
condiciones de publicación exclusiva desde `main`. El modo real sigue siendo
manual, con `live=false` predeterminado, y valida estrictamente su matriz.

`test-h155-publication.mjs` comprueba el nuevo contrato y rechaza nueve
mutaciones que omiten regresiones, vuelven a imponer certificación para
publicar, adelantan el artefacto o activan automáticamente el modo real.

AGENTS, arquitectura, playbooks, autoridad de sincronización y las instrucciones
de QA distinguen ahora publicación de certificación. Las notas de H148/H155
conservan su evidencia histórica y remiten a H-162. El validador sólo cambia
su comentario descriptivo; no se alteran sus comprobaciones de evidencia real.

La corrección se preparó sobre `main`, base documental `a0fdb78`. No se cambió
el código de `balam/`, SQL ni los artefactos de H-161. HTML/offline permanecen
idénticos, SHA-256
`ece24479d2ef006c0c6de50f680a7fcb487800ee56c5c048b8f7434ff4185a14`;
el SW conserva
`51cdbbb33d1a6fdd07b7a0db8560352d3c5eac368962e80f566dc717c9cf6d1c`.

## Pruebas

Línea base ejecutada: `node test-h155-publication.mjs`, **5/5**, código 0.
El validador del certificado actual produjo código 1 por discrepancia del hash
del HTML; coincide con el bloqueo observado en GitHub Actions.

El nuevo contrato contra el YAML anterior falla con `real certificate must
remain in the manual job`, código 1, antes de completar comprobaciones. Tras
retirar la puerta, `node test-h155-publication.mjs` pasa **10/10**: el contrato
vigente y nueve mutaciones rechazadas. Logs locales:
`.evidence-h162/publication-red.log` y `publication-green.log`.

`node test-h148-sync-certification.mjs --self-test` rechaza **29 certificados
falsos**, código 0. La certificación opcional conserva sus controles estrictos.
`node --check` del test y `git diff --check`: correctos.

La ejecución de GitHub Actions y la igualdad de los archivos públicos con la
entrega permanecen pendientes; no se contabilizan como pruebas aprobadas.

## Riesgo residual y pendientes

Publicar no acredita convergencia A/B/C contra Supabase. Esa certificación
permanece opcional y sólo puede declararse cuando se ejecute completa sobre
el artefacto correspondiente. La petición no autoriza una restauración de
inventario ni omitir los conflictos `ID_NOT_FOUND` de H-161.

Commit, push y verificación pública pendientes. No se declara H-161 publicado
antes de comprobar el resultado de Pages.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-162.
- `docs/fixes/importacion-familias-uuid-v5-h161.md`.
- `.github/workflows/h148-sync-authority.yml`.
- `test-h148-sync-certification.mjs`.
- `AGENTS.md` y `docs/architect/playbooks/synchronization.md`.
