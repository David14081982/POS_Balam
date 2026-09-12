# Punto Cero incorpora los enlaces de inventario V3

**Riesgo:** [H-160](../03-known-risks.md#h-160--punto-cero-omite-los-enlaces-de-inventario-v3)
**Estado:** CORREGIDO, APLICADO Y EJECUTADO; adopción de la nueva época en terminales ausentes NO CERTIFICADA.
**Fecha:** 11/09/2026
**Commit técnico:** `fa978f5f5295054435ee8e013d233c3e7fe5bdd2`

## Problema y reproducción

El dueño solicitó dejar BALAM sin inventario ni operaciones, con respaldo
previo y conservación de configuración, catálogos, usuarios, roles y permisos,
constructor de SKU, métodos de pago, logotipo y configuración de tienda.
Después autorizó descartar todas las intenciones pendientes y retirar las seis
instalaciones que aún estaban activas. La flota quedó con 14 instalaciones
retiradas; ese retiro no demuestra que se haya borrado el almacenamiento de
los navegadores ausentes.

La ejecución real, posterior al respaldo sellado, devolvió `status=failed`,
`rolled_back=true` y `barcode_aliases_product_id_fkey`. El bloque SQL se revirtió:
permanecieron los **2,386 productos y 3,502 piezas**, y la huella de datos
protegidos permaneció idéntica. La inspección identificó **138 alias y 831
mapas históricos V1/V2** relacionados con ese inventario.

El respaldo del intento fallido,
`e418e8da-bd95-4565-8114-d2b58d00090a`, conserva el payload anterior de 21
familias. No incluye las dos tablas de enlaces y no se reutiliza para el nuevo
intento. El resultado esperado es un respaldo que también las cubra y una
ejecución atómica que pueda eliminar sus productos sin alterar las ocho
categorías protegidas ni las defensas ordinarias de identidad.

## Causa raíz

H98 creó el payload y el plan de Punto Cero antes de la incorporación de
`barcode_aliases` e `inventory_v1_v2_map` por H133. Ambas tablas tienen claves
foráneas `ON DELETE RESTRICT` hacia `products`. H98 intentaba borrar los
productos sin haber respaldado ni eliminado esos hijos. El primer alias
existente detenía la operación; sin alias, la FK del mapa produce el mismo
bloqueo, reproducido por separado en PostgreSQL aislado.

El trigger `h133_alias_immutable` también impide el borrado ordinario de alias.
Retirar sólo la FK o añadir un `DELETE` sin respetar esa defensa no resolvería
el contrato completo. Las reclasificaciones, los otros hijos de productos
identificados en la autoridad real, ya estaban incluidas en el plan.

El fixture SQL anterior usaba tablas de negocio sintéticas y no modelaba
estas FK ni el trigger H133. Podía aprobar sus casos de prueba sin detectar
la dependencia ausente. H160 incorpora esas definiciones reales y demuestra
el fallo previo antes de aplicar la corrección en el mismo intérprete.

## Diseño

La autoridad continúa en los RPC existentes de Punto Cero. El payload agrega
dos claves con orden estable; el formato de respaldo y los consumidores
anteriores mantienen su contrato. La huella y el token del preview incluyen
los enlaces, por lo que modificar cualquiera de esas tablas invalida un
preview anterior. Se exige crear y guardar un respaldo nuevo antes del nuevo
intento, usando otra identidad de operación.

La ejecución obtiene los IDs de productos, elimina sus mapas y alias por
condiciones `WHERE`, comprueba las cantidades y exige que no queden enlaces.
Después continúa con el borrado de productos existente. Todo permanece dentro
del bloque transaccional que revierte la purga ante una excepción.

El permiso interno `pos.h133_internal` se activa únicamente alrededor del
borrado de alias y se restaura antes de borrar productos. Si ocurre un error
mientras está activo, la reversión del subbloque restaura tanto los datos como
ese ajuste transaccional. Fuera de ese ámbito, el trigger sigue rechazando
actualizaciones y borrados ordinarios de alias.

Se conservan `inventory_contract_state`, su contrato V3 activo, los respaldos
y operaciones históricas H133, las FK, los triggers y los privilegios. No cambia
el cálculo de la huella protegida ni la guarda de administrador activo,
`settings.manage`, modo preproducción, sincronización, confirmación, respaldo
coincidente o idempotencia. La actualización de equipos conserva el filtro
`status <> 'revoked'`; Punto Cero no reactiva las instalaciones retiradas.

## Solución

- `20260911020600_pos_h160_point_zero_inventory_links.sql` amplía únicamente
  `point_zero_payload()` y `execute_point_zero()` con respaldo y eliminación
  de las dos dependencias.
- `20260911020700_pos_h160_point_zero_inventory_links_verification.sql`
  verifica el payload real, las FK, el trigger y los privilegios dentro de una
  transacción de sólo lectura; ejerce denegaciones de acceso y confirmación.
- `test-h160-point-zero-sql.mjs` reproduce ambas FK por separado y ejecuta la
  migración entregada, incluidas sus guardas de deriva, sobre PostgreSQL en
  memoria. Reutiliza el fixture H159 ampliado con las dependencias H133.
- El workflow H148 ejecuta el nuevo arnés en cada entrega afectada.

Las dos funciones se generaron desde `pg_get_functiondef` de la autoridad
enlazada. La migración comprueba los MD5 previos
`80ecd36acac5c871d43b1adb83b2de96` para el payload y
`7bbcd91094d2c62167892c3c701eacd6` para la ejecución. Una diferencia aborta el
despliegue. La revisión independiente confirmó que, al retirar exclusivamente
las adiciones H160, las definiciones coinciden con las anteriores, salvo el
terminador SQL del archivo. No hubo hallazgos bloqueantes.

No se modifica el cliente, el artefacto HTML ni los flujos de interfaz.

## Pruebas

| Comando o comprobación | Resultado |
|---|---|
| `node test-h160-point-zero-sql.mjs --baseline` | **3/11**; ocho fallos esperados demuestran payload incompleto y bloqueo de ejecución |
| `node test-h160-point-zero-sql.mjs` | **11/11** |
| `node test-h159-point-zero-sql.mjs` | **15/15**, usando las funciones corregidas |
| `node test-h98-punto-cero.mjs` | **24/24** |
| `node test-h133-inventory-v3.mjs` | **8/8** |
| `node test-migrations.mjs` | **31/31** |
| Verificación 207 en Supabase real | Payload de 23 familias, FK RESTRICT y trigger habilitado; privilegios conservados, acceso sin identidad/perfil denegado y confirmación exigida |

Los arneses SQL usan `BALAM_PGLITE_MODULE` para cargar PGlite. Las filas
comerciales son sintéticas y las dependencias administrativas/notificaciones
tienen sustitutos explícitos: estos resultados aislados no certifican RLS
remoto ni convergencia entre instalaciones. La verificación 207 complementa
esa prueba con la autoridad y las denegaciones reales, sin escribir datos
comerciales.

H160 cubre respaldo de las 23 familias, éxito con productos y ambos tipos de
enlace, inventario con mapa pero sin alias, idempotencia, conservación de la
huella protegida y del retiro de equipos. También provoca fallos después de
borrar hijos y durante la excepción interna de alias: comprueba reversión de
datos, purga y GUC, y confirma que la inmutabilidad sigue vigente al terminar.
Los cambios de alias y mapas invalidan el token previo.

Evidencias seguras, sin payload comercial:

- [Línea base SQL](evidence/h160-sql-before.json).
- [SQL corregido](evidence/h160-sql-after.json).
- [Regresión H159](evidence/h160-h159-regression.json).

## Despliegue y ejecución operativa

Las migraciones **206 y 207 están aplicadas en Supabase**. La verificación
emitió `payload=23-families`, `FK=RESTRICT`, `alias_guard=enabled`,
`grants=preserved`, `unauthenticated=denied`, `confirmation=required` y
`business_writes=0`. El despliegue de funciones no ejecuta Punto Cero.

La ejecución real autorizada terminó correctamente a las
**2026-09-12T00:07:48.895135Z**, 11/09/2026 a las 17:07 en Hermosillo.
Los 26 conteos del comprobante quedaron en cero, incluidos productos y piezas;
también quedaron en cero `barcode_aliases` e `inventory_v1_v2_map`. La época
avanzó de **9 a 10** y las **14 instalaciones conservaron su retiro**.

Las ocho categorías protegidas devolvieron `true` y la huella de conservación
permaneció idéntica:
`3334c3500d8fe4af3c4b565752042cf9a55b692fa7575d4ef8c7012aa730c8d0`.
También permanecieron idénticas las huellas de `inventory_contract_state`,
`inventory_v3_backups` e `inventory_v3_operations`.

El respaldo sellado nuevo es **`72a5453d-98b2-439a-8239-26d707711d9e`**, con
23 familias y huella de payload
`8eccdf79815f3b2882eb59c951712035fb6dca49457589a0c2d20211039e618f`.
La copia privada `RESPALDO-PUNTO-CERO-COMPLETO-20260911.json` mide **6,824,216
bytes**, con SHA-256
`933a630bc0da419b801c4cd39c7263a5875f3bfe751a9f595a7bce6a6685c9bb`.
El resultado íntegro está en el archivo privado `h160-execution-result.json`.
Estos archivos contienen datos del negocio y permanecen fuera del repositorio
publicado. La evidencia operativa segura se registra en
`evidence/h160-operation.json`.

La lectura independiente del 12/09/2026 a las **00:09:39 UTC** confirma todos
los conteos operativos, alias y mapas en cero; revisiones pendientes y órdenes
de reintento centrales en cero. La guarda real rechazó **14/14** solicitudes
de escritura de instalaciones retiradas con `DEVICE_RETIRED`, sin escrituras
comerciales y con rollback de la verificación.
La comparación posterior de las definiciones remotas coincide exactamente con
206; preview, creador de respaldo y trigger inmutable permanecen idénticos.
Los privilegios de las dos funciones conservan sus ACL previas. Evidencia:
[`h160-final-authority.json`](evidence/h160-final-authority.json).
No se infiere de este comprobante el estado físico del almacenamiento en los
equipos ausentes.

El commit técnico se envió a `main`. Los workflows H148 **34660905743**
(regresión y Pages) y H132 **34660905740** terminaron correctamente en el primer
intento, incluido el nuevo arnés H160. La publicación se verificó el
**12/09/2026 00:17:41 UTC**: **10/10** rutas HTTP 200 idénticas al artefacto
del commit, incluida la raíz sin parámetros. Evidencia:
[`h160-pages.json`](evidence/h160-pages.json). HTML/offline conservan SHA-256
`6678d9d1c2eac11f1b670017e8fec4c716e7f9b763c1f26e631e423aab22fd85`;
la corrección reside en las funciones del servidor ya aplicadas.

## Riesgo residual y pendientes

La matriz real A/B/C anterior pasó **29/29** sobre el mismo artefacto cliente,
que H160 no modifica. Ese resultado previo no certifica la adopción de la
nueva época tras este Punto Cero: las 14 instalaciones anteriores están
retiradas. La adopción en navegadores ausentes y el recorrido offline posterior
quedan **NO CERTIFICADOS** conforme a R-SYNC-16 y R-SYNC-17.

El retiro conserva el cerco de escritura del servidor; no acredita eliminación
física de colas, cachés ni archivos en equipos apagados o desconectados. El
respaldo JSON tiene integridad verificable, pero H98 no proporciona una RPC de
restauración automática. El rollback SQL protege la ejecución fallida; no
sustituye una restauración posterior a un Punto Cero completado.

Para prevenir una repetición, las pruebas de limpieza deben ejecutar las
dependencias y restricciones reales de los padres que eliminan. H160 deja
esa cobertura para alias y mapas; no convierte el esquema sintético del arnés
en una certificación de todas las relaciones futuras.

## Referencias

- `docs/03-known-risks.md`, H-160.
- [Punto Cero administrativo H98](punto-cero-administrativo.md).
- [Respaldo recuperable H159](punto-cero-respaldo-recuperable-h159.md).
- [Contrato de inventario V3 H133](migracion-inventario-barcode-v3-h133.md).
- `supabase/migrations/20260830017200_pos_h133_inventory_v3_contract.sql`.
- `docs/architect/playbooks/database.md`, R-DB-03 y R-DB-09.
- `docs/architect/playbooks/synchronization.md`, R-SYNC-16 y R-SYNC-17.
