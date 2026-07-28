# ADR-007 — Cero red en runtime y en el build normal

**Estado:** vigente · **Historias:** H-19, H-20 (origen), H-27, H-28

## Contexto

`build-offline.mjs` descargaba Babel, React, JsBarcode, CSS, fuentes e imágenes
en cada ejecución y usaba `npx --yes tailwindcss`. En un entorno sin red, Babel
degradaba a runtime y el build terminaba con `fetch failed`. En paralelo,
`STORE.ensureClient()` creaba dinámicamente un `<script>` apuntando a la versión
mayor `@2` del SDK de Supabase: bytes mutables de los que dependían Auth y
sincronización, sin commit que los registrara.

## Decisión

Todo lo que el producto ejecuta está versionado en el repositorio y verificado
por hash: 46 respuestas externas con su SHA-256, el SDK de Supabase fijado en
2.110.8 con su UMD local, y Tailwind como dependencia exacta del lockfile. El
build normal sólo lee y verifica ese almacén; un recurso ausente o corrupto
aborta. La red se habilita únicamente para una actualización deliberada con
`BALAM_REFRESH_BUILD_RESOURCES=1`, cuyo diff se revisa.

## Trade-off

**Beneficio obtenido:** el mismo commit produce el mismo artefacto en cualquier
máquina y sin Internet; un cambio upstream no puede alterar producción sin pasar
por un commit revisable; y una terminal sin acceso a jsDelivr sigue pudiendo
autenticarse y sincronizar.

**Costo aceptado:** actualizar cualquier dependencia deja de ser trivial —hay
que cambiar versión, archivo, hash y lockfile conjuntamente y repetir las
pruebas—, el repositorio carga ~200 KB de vendor por dependencia, y las
correcciones de seguridad upstream no llegan solas: requieren una acción
deliberada. Un arnés de desarrollo (`test-smoke.mjs` sin `bundle`) conserva
intencionalmente su dependencia de CDN y no puede correr en entornos
restringidos.

**Alternativa descartada:** fijar sólo la versión menor en el CDN. Se descartó
porque fija el nombre, no los bytes, y el defecto de H-28 era precisamente que
ni Git, ni el lockfile, ni el build eran autoridad sobre lo que se ejecutaba.

## Cómo se revierte y qué se rompería

Revertir devuelve el proyecto a un artefacto que puede cambiar sin commit y a un
build que falla sin Internet. La reproducibilidad byte a byte del artefacto
—base de `ADR-008`— se pierde con ello.

## Referencias

`docs/fixes/build-sin-dependencias-remotas.md` ·
`docs/fixes/sdk-supabase-local-fijado.md` · `docs/fixes/arneses-e2e-sin-cdn.md` ·
`balam/vendor/build-resources.json`
