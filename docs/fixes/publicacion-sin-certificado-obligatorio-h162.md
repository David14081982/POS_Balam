# Publicación sin certificación real obligatoria

**Riesgo:** H-162
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 11/09/2026
**Commit técnico:** `067c05de6ef172ce2985b8e90317d2229f1bb97c`

## Problema y reproducción

La corrección H-161 llegó a `origin/main` con sus 98 comprobaciones locales
aprobadas, pero GitHub Pages siguió sirviendo el HTML anterior. La ejecución
H148 `34664301574` falló en `Require a complete live certificate for this
delivery`: `tested build differs from delivery`, código 1. El job `deploy`
quedó omitido aunque las comprobaciones anteriores a esa puerta aprobaron.

El usuario autorizó expresamente retirar las condiciones de certificación
real que impiden publicar en GitHub. La decisión aplica al requisito de entrega;
no declara ejecutadas las pruebas reales ni autoriza operaciones comerciales.

## Causa raíz

`.github/workflows/h148-sync-authority.yml` validaba obligatoriamente el archivo
`docs/fixes/evidence/h148-live-matrix.json` contra el nuevo HTML en cada push o
pull request. Cualquier cambio del bundle invalidaba ese certificado, lo que
convertía la matriz real en una dependencia universal de publicación.

`test-h155-publication.mjs` exigía la misma puerta, por lo que retirar sólo el
paso YAML dejaría una regresión obligatoria fallando. Los tests H132 utilizan
fixtures o snapshots sintéticos y no requieren certificación remota; permanecen.
La consulta API de protección de `main` respondió 404, `Branch not protected`;
el bloqueo observado procedía del workflow. Local y remoto estaban alineados en
`a0fdb78` antes de esta corrección.

AGENTS y las reglas arquitectónicas anteriores exigían esa misma certificación.
Se actualizaron junto con el workflow para reflejar la instrucción actual del
usuario y evitar restablecer automáticamente la condición retirada.

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
exigía el certificado real en la regresión automática. Se conserva el self-test
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

GitHub Actions H148 `34665064732` terminó correctamente sobre `067c05d`:
regresión a las 01:34:48 UTC del 12/09/2026 y despliegue a las 01:35:03 UTC.
El job `live-certification` quedó omitido, como corresponde a la publicación
normal. H132 `34665064724` también aprobó.

La verificación pública terminó a las **01:36:08.945 UTC del 12/09/2026**
(11/09 en Hermosillo): **10/10 rutas HTTP 200**, todas con SHA-256 idéntico al
archivo del commit. Se comprobaron raíz, `index.html`, HTML
offline, `sw.js`, manifest y cinco iconos. H-161 quedó publicado con los mismos
bytes que superaron sus pruebas locales. Las consultas usaron un parámetro
de versión para evitar respuestas de caché anteriores.

Evidencia: `docs/fixes/evidence/h162-pages.json`, con los hashes esperados y
recibidos, las ejecuciones de Actions y el estado real de cada job.

## Riesgo residual y pendientes

Publicar no acredita convergencia A/B/C contra Supabase. Esa certificación
permanece opcional y sólo puede declararse cuando se ejecute completa sobre
el artefacto correspondiente. La petición no autoriza una restauración de
inventario ni omitir los conflictos `ID_NOT_FOUND` de H-161.

El commit técnico `067c05de6ef172ce2985b8e90317d2229f1bb97c` está en
`origin/main` y su publicación fue verificada. No queda pendiente conocido
dentro de la retirada del requisito. La certificación distribuida permanece
**NO CERTIFICADO**: no se solicitó ni se ejecutó una matriz real, y no hubo
escrituras comerciales en Supabase. Una terminal abierta puede requerir cargar
la actualización publicada; su adopción física no fue observada.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-162.
- `docs/fixes/importacion-familias-uuid-v5-h161.md`.
- `.github/workflows/h148-sync-authority.yml`.
- `test-h148-sync-certification.mjs`.
- `AGENTS.md` y `docs/architect/playbooks/synchronization.md`.
- `docs/fixes/evidence/h162-pages.json`.
