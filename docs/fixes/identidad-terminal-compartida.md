# Identidad de terminal compartida

## Estado

Resuelto el 26/07/2026. Commit: `06d0454`.

## Problema

`DATA` y `STORE` implementaban por separado la lectura y creación de
`balam_device_id`. Con `localStorage` disponible ambas copias normalmente leían
la misma clave, pero ante un fallo de almacenamiento `DATA` generaba una
identidad volátil en cada llamada y `STORE` conservaba otra en memoria.

## Reproducción

`node test-module-contracts.mjs` produjo 11 pruebas aprobadas y 5 fallidas antes
del cambio: no existía un contrato único, el orden no lo cargaba, ambos módulos
mantenían su implementación y la identidad volátil no podía ser compartida.

## Causa raíz

La identidad de terminal carecía de un propietario de módulo. Dominio y
persistencia habían copiado la misma responsabilidad, con políticas diferentes
en la ruta de error.

## Corrección

`balam/core.jsx` publica `window.CORE.getDeviceId()` antes de cargar
`CONFIG`, `DATA` y `STORE`. Conserva la clave histórica `balam_device_id` y
memoriza una única identidad, incluida la alternativa volátil. `DATA` la usa
para IDs de operación/folios y `STORE` para snapshots y tombstones.

No se modificaron formatos persistidos, payloads SQL, reglas de negocio,
migraciones, cola offline ni datos históricos.

## Pruebas

- `node test-module-contracts.mjs`: 16/16.
- `node test-concurrency.mjs`: 9/9.
- `node test-store-queue.mjs`: 97/97.
- `node test-discounts.mjs`: 43/43.
- `node test-migrations.mjs`: 24/24.
- `node test-role-access.mjs`: 10/10 reportadas por el arnés.
- `node test-commission.mjs`: 10/10.
- `node build-offline.mjs`: correcto, 66 assets.
- `node test-smoke.mjs bundle`: 17/17.
- `node test-ui-navigation.mjs`: 13/13.
- `git diff --check`: correcto.

El primer intento de `test-auto-fotos.mjs` sobre la entrada de desarrollo no
arrancó dentro de 25 segundos por dependencias CDN restringidas. El bundle
autocontenido sí arrancó y completó el recorrido real.

## Riesgo residual y reversión

Riesgo residual bajo: si el almacenamiento permanece bloqueado, la identidad
volátil sólo dura mientras la página siga abierta, igual que la mejor garantía
posible sin persistencia; ahora todos los módulos comparten esa misma identidad.

La reversión es independiente: retirar `core.jsx`, restaurar las dos funciones
anteriores y regenerar los artefactos. No requiere revertir datos ni Supabase.
