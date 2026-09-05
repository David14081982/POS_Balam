# Altas SQL con contrato V3 y familia conservados

**Riesgo:** H-138
**Estado:** RESUELTO
**Fecha:** 05/09/2026
**Commit:** `79fd5036dd73af7f4d9f556c647a83dd5012b47f`

## Problema y reproducción

Las filas existentes recibieron `barcode_contract=3` y familia durante H-133.
Las autoridades de alta seguían usando listas de columnas anteriores: ambas
omitían el contrato y `save_products_checked` también omitía la familia.
El cliente sí transportaba esos campos; habilitar STORE y revisar su solicitud
durable no ejercitaba la escritura SQL que los descartaba.

PostgreSQL local reprodujo las dos rutas con SKU comercial y barcode distintos:
rojo inicial 11/16. Se perdía el contrato en ambas altas y la familia en la
individual; `NULL <> 3` tampoco rechazaba el contrato ausente. Barcode, SKU e ID
se conservaban: este hallazgo no prueba por sí solo por qué la etiqueta real
`30328899392999898742908026` no encontró producto en el POS.

## Causa raíz

`pos.save_products_checked` y `pos.commit_reference_family_batch_h101_internal`
no evolucionaron junto con los campos incorporados por H-133. La guarda
`h133_guard_operational_inventory` usaba una comparación nullable. La definición
remota se leyó antes y después; la corrección se genera desde esa definición,
sin reescribir funciones enteras ni reinterpretar códigos comerciales.

## Diseño

- Ambas altas insertan el `barcode_contract` recibido del cliente vigente.
- La ruta individual inserta también `reference_family_id`; editar una fila
  existente conserva su familia, como antes.
- La guarda usa `IS DISTINCT FROM 3`: un alta activa sin contrato no se acepta.
- Los aliases existentes y las ramas de edición permanecen intactos. No se
  amplía la autoridad de modificar aliases desde las altas.
- Sin backfill, regeneración de códigos, SKU, IDs, familias, stock o documentos.
  Protocolo, versión esperada, permisos e idempotencia conservan sus guardas.

## Solución

- `20260905017600_pos_h138_registration_v3.sql`: reemplazos acotados sobre
  `pg_get_functiondef`, con rechazo ante diferencias inesperadas de fuente.
- `20260905017700_pos_h138_registration_v3_verification.sql`: comprobación de
  contrato y ejecución de la guarda real en tabla temporal, retirada al commit.
- `test-h138-registration-sql.mjs`: escritura individual/familiar, lectura de
  campos, reintento, edición, aliases, rechazo y rollback atómico.
- `test-h138-permissions.sql`: ACL y denegación sin identidad comercial.

## Pruebas

- SQL local: rojo inicial 11/16; verde ampliado 18/18. También 18/18 cargando
  las definiciones extraídas del servidor después de publicar, sin aplicar
  otra corrección local a esas definiciones.
- Motor PGlite 0.5.8 instalado fuera del repositorio. Ejecución:
  `BALAM_PGLITE_MODULE=<ruta>/@electric-sql/pglite/dist/index.js node test-h138-registration-sql.mjs`.
  `--baseline` ejecuta el código previo; `--live-defs=<export.json>` prueba
  definiciones exportadas. El arnés usa tablas aisladas y sustitutos de auth/
  protocolo: demuestra persistencia, no certifica RLS remoto por sí solo.
- H-136 navegador: 24/24 con alta por formulario, solicitud durable, traslado,
  etiqueta PDF, escaneo exacto, recarga y ocho viewports. Migraciones: 31/31.
- Permisos remotos antes/después: aprobados. El primer intento con transacción
  READ ONLY se detuvo en `FOR SHARE` de la guarda de protocolo; era una
  incompatibilidad del arnés, no una denegación fallida. Se corrigió a una
  transacción siempre revertida, con tiempos de bloqueo/ejecución limitados.
- Dry-run enumeró sólo `20260905017600` y `20260905017700`; ambas aplicadas.
  La verificación remota aceptó contrato correcto y rechazó ausencia/código
  ajeno usando la guarda real sobre una tabla temporal; no insertó productos
  comerciales.
- Huella completa de `pos.products` idéntica antes/después:
  `12d7cc06a38073d116ec63213414f806`; cero V2 activos con contrato distinto de 3.
  Propietarios, ACL y search_path idénticos; sólo cambiaron las tres funciones
  previstas. No hay cambios de cliente ni artefactos HTML que regenerar.

## Riesgo residual y pendientes

No se creó un producto comercial real para probar una venta remota. El guardado
positivo se ejerció en PostgreSQL aislado con las funciones publicadas; la
guarda y los permisos se comprobaron además contra el servidor real.
H-136 conserva pendiente la causa del incidente concreto. H-138 corrige un
defecto demostrado de altas futuras y no recupera una referencia desconocida.

## Referencias

- `docs/03-known-risks.md`, H-138 y H-136.
- `docs/fixes/migracion-inventario-barcode-v3-h133.md`.
- `docs/fixes/lectura-desconocida-pos-h136.md`.
