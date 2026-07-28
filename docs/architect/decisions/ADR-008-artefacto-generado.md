# ADR-008 — El artefacto generado no es fuente y se verifica al publicarse

**Estado:** vigente · **Historias:** H-19 (origen), H-33, H-34

## Contexto

`build-offline.mjs` asignaba un UUID aleatorio a cada entrada del manifiesto, de
modo que dos ejecuciones con las mismas fuentes producían artefactos con hashes
distintos. Un cambio de hash no permitía distinguir una modificación real de una
reconstrucción equivalente. Y `index.html` —el archivo que realmente se
distribuye y que ejecutan los arneses— es un archivo de 8.6 MB que un agente
puede editar por error creyendo que corrige el producto.

## Decisión

`index.html` y `POS Balam (offline).html` son artefactos, nunca fuente: se
modifica `balam/` y se regeneran. Cada asset se identifica por SHA-256 de su
MIME, modo de compresión y bytes, así que dos builds equivalentes son idénticos
byte por byte. Al publicar, el archivo servido por GitHub Pages se compara
contra el `index.html` del commit y su SHA-256 se registra en el documento de
corrección.

## Trade-off

**Beneficio obtenido:** el hash pasa a ser una señal fiable —si cambió, cambió
algo real— y la publicación deja de ser una suposición: H-34 detectó así que
Pages seguía sirviendo el artefacto de H-33.

**Costo aceptado:** dos archivos enormes versionados que se regeneran en casi
todos los commits, diffs de Git ilegibles en esos archivos, y un paso manual más
en cada despliegue. Los arneses de bundle dependen de que el artefacto esté
regenerado, así que olvidarlo produce pruebas que validan una versión anterior
sin avisar.

**Alternativa descartada:** no versionar los artefactos y construirlos en el
despliegue. Se descartó porque GitHub Pages sirve directamente el repositorio y
porque el modo offline —abrir el archivo desde una memoria USB, sin servidor—
es un requisito real del negocio.

## Cómo se revierte y qué se rompería

No se revierte sin perder la distribución offline. Editar el artefacto como
fuente rompe la correspondencia entre commit y producto, y el siguiente build
descarta silenciosamente el cambio.

## Referencias

`docs/fixes/bundle-reproducible.md` · `docs/fixes/folio-comercial-diario.md` ·
`docs/fixes/plazo-posventa.md` · `AGENTS.md`
