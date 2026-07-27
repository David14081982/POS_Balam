# SDK Supabase local y fijado

**Riesgo:** H-28
**Estado:** RESUELTO
**Fecha:** 26/07/2026
**Commit:** Pendiente de commit

## Problema y reproducción

`STORE.ensureClient()` descargaba en cada navegador
`@supabase/supabase-js@2` desde jsDelivr. La URL permitía cambiar cualquier
versión 2.x sin un commit y hacía que Auth y sincronización dependieran de la
red aun dentro del bundle offline.

`node test-supabase-sdk.mjs` aprobó 0/4 antes de corregir: detectó la inyección
dinámica, la falta de una entrada local, la ausencia del artefacto y la falta de
un SHA-256 documentado.

## Causa raíz

El SDK se resolvía tarde y fuera del proceso reproducible. La versión mayor no
determinaba bytes concretos y el paquete no estaba en el lockfile, en
`balam/vendor` ni en el manifiesto del bundle.

## Diseño

- Fijar una versión exacta del paquete en `package-lock.json`.
- Versionar el UMD que ejecutará el navegador y documentar su SHA-256.
- Cargarlo antes de los módulos en ambas entradas fuente.
- Hacer que `STORE` consuma únicamente el global local ya cargado.
- Si el SDK falta, conservar la operación local-first sin intentar red.
- No modificar URL, clave pública, esquema, sesión, cola ni payloads.

## Solución

`@supabase/supabase-js` quedó fijado en 2.110.8. Su UMD de 207 904 bytes vive en
`balam/vendor/supabase-2.110.8/supabase.min.js`, con SHA-256
`913f94db33b394a97d34c058347009053ac2d9534459c0990eb08594a108d2ee`.

`POS Balam.html` y `balam/_source.html` lo cargan antes de los módulos. El build
lo incorpora como asset local y `STORE.ensureClient()` ya no crea elementos
`script` ni contiene una URL CDN: valida `window.supabase.createClient`, crea el
mismo cliente o devuelve `null` para conservar el modo local.

## Pruebas

- Reproducción anterior: 0/4.
- `node test-supabase-sdk.mjs`: 4/4.
- `node test-module-contracts.mjs`: 36/36.
- `node test-role-access.mjs`: 10/10.
- `node test-store-queue.mjs`: 97/97.
- `node build-offline.mjs`: correcto, 67 assets.
- `node test-build-reproducibility.mjs`: 8/8.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 13/13.
- `node test-browser-harness-entry.mjs`: 8/8.
- `node test-auto-fotos.mjs`: 11/11.
- `node test-reset-propaga.mjs`: 21/21.

## Riesgo residual y pendientes

No queda una descarga mutable del SDK en runtime. Una actualización futura debe
cambiar conjuntamente la dependencia exacta, el archivo versionado y su hash,
reconstruir los artefactos y repetir las regresiones.

Si el archivo se elimina o altera, el build falla o el cliente no se habilita;
la información local y la cola se conservan, pero Auth y sincronización quedan
inactivas hasta restaurar un SDK válido.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-28--sdk-supabase-mutable-y-descargado-en-runtime`
- Arquitectura: `docs/02-architecture.md#build-offline`
- Corrección relacionada: `docs/fixes/build-sin-dependencias-remotas.md`
