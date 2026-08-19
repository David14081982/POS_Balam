# Limpieza selectiva segura de datos de prueba

**Riesgo:** H-113
**Estado:** CLIENTE PUBLICADO Y CERTIFICADO; HARD STOP ANTES DE LIMPIEZA REAL
**Fecha:** 17/08/2026
**Commit:** `8b7042f`

## Problema y reproducción

Configuración → Administración / Datos sólo ofrecía H-98, que elimina
inventario y operaciones como un Punto Cero completo. H-68 comunica igualmente
una purga total por época. No existía un contrato para retirar sólo operaciones
de prueba, conservar productos y restituir sus efectos exactos sobre inventario,
comisiones, cola offline y terminales antiguas.

El contrato inicial (`node test-h113-selective-cleanup.mjs`) falló 3 de 28
controles. La primera prueba funcional en PostgreSQL aislado descubrió además
que devoluciones y cancelaciones no persistían toda la evidencia financiera
congelada necesaria para recalcular vendedores. BALAM QA detectó después cinco
bordes adicionales: la guarda miraba documentos eliminados en vez de retenidos,
los ajustes no entraban al saldo, la lápida de préstamo usaba otro `kind`, el
respaldo omitía autoridades borradas y la UI confundía commit remoto con fallo
de convergencia local.

## Causa raíz

H-98 y H-68 son contratos cerrados de borrado total: pueden eliminar productos
después de borrar operaciones y no preservan una relación selectiva entre cada
documento y su efecto. Reutilizar su evento haría que un cliente H-68 antiguo
interpretara la limpieza parcial como purga completa. Además, SKU sólo identifica
V1 cuando existe una referencia legacy inequívoca; V2 y cambios requieren
`products.id`. La evidencia de comisión de devoluciones y cancelaciones existía
localmente, pero no cruzaba completa la frontera SQL.

## Diseño

- H-98 sigue siendo el único Punto Cero completo.
- H-113 acepta presets semánticos: Punto Cero completo, operaciones de prueba o
  selección personalizada. PostgreSQL normaliza dependencias; la UI no expone
  tablas internas.
- Preview, respaldo y ejecución son RPC distintas. El plan se sella con
  protocolo, época y SHA-256; execute lo recalcula, toma advisory lock y exige
  respaldo, frase exacta y cliente compatible.
- V1 se restaura por SKU sólo si hay una única referencia legacy. V2, cambios y
  reclasificaciones usan `products.id`. Faltantes, ambigüedad, evidencia
  retenida incompleta o stock negativo bloquean; nunca se recorta a cero.
- Productos, contadores de folio, configuración, permisos, auditoría y respaldos
  se conservan. Clientes son opt-in y no se borran si siguen referenciados.
- El evento vive en `selective_cleanup_events`, nunca en `test_data_purges`.
  Terminales incompatibles rebootstrap y la cola se poda por operación,
  documento o identidad exacta.
- H-116 reemplaza la incompatibilidad general por riesgo real de flota: una
  terminal apagada compatible o cercable sin cola conflictiva no bloquea; una
  operación intersectante, una cola sin detalle demostrable o un cliente
  anterior al cerco H-77 sí bloquean. El manifiesto, la época, el rebootstrap,
  la cuarentena y las lápidas siguen fallando cerrado.
- El saldo de vendedores se deriva de ventas, cambios, devoluciones,
  cancelaciones, ajustes y liquidaciones retenidos. Una liquidación `tipo=ajuste`
  es evidencia espejo del crédito y no se resta como pago.

## Solución

- `supabase/migrations/20260817014900_pos_h113_selective_cleanup.sql`: tablas de
  respaldo/operación/evento, RLS, evidencia financiera aditiva, plan, payload
  completo, preview, backup, execute, lápidas y comprobante.
- `supabase/migrations/20260817015000_pos_h113_selective_cleanup_verification.sql`:
  ACL, protocolo, identidad V1/V2, cobertura del respaldo, rollback y guardas.
- `balam/store.jsx`: protocolo selectivo, tres RPC, evidencia congelada, evento
  incompatible seguro, rebootstrap y poda exacta de cola. Un commit remoto
  confirmado nunca se presenta como rollback por un fallo local posterior.
- `balam/data.jsx`: aplicación local con snapshot/rollback y saldo financiero
  derivado, sin borrar productos ni folios.
- `balam/settings.jsx`: tarjeta separada, presets, preview elimina/conserva,
  stock actual/objetivo, cinco puertas y modal etiquetado.
- `test-h113-selective-cleanup*.mjs` y
  `test-h113-selective-cleanup-functional.sql`: contratos, UI y recorrido SQL.
- `test-h113-selective-cleanup-permissions.sql`: ACL, roles, propietarios,
  `search_path`, funciones internas y bloqueo obligatorio en producción.

## Preflight e instalación remota

Se auditó por lectura el proyecto vinculado `telohdbvbvsfmwyriflz`, sin aplicar
migraciones ni ejecutar RPC destructivas:

- El preflight encontró local y remoto coincidentes hasta `20260815014800`; el
  dry-run propuso exclusivamente `20260817014900` y `20260817015000`, en ese
  orden. Ambas se aplicaron el 17/08/2026 con `supabase db push --linked` bajo
  autorización expresa. Después, el historial local/remoto quedó alineado y un
  nuevo dry-run informó `Remote database is up to date`.
- El esquema remoto exacto de `pos`, sin datos, se clonó en PostgreSQL 18
  aislado. Allí ambas migraciones compilaron, verificaron y la funcional fue
  reaplicable. Las pruebas terminaron con `ROLLBACK`.
- La auditoría agregada real encontró 1 venta con 1 renglón, 1 pago, 1 reserva y
  1 movimiento; 0 devoluciones, cambios, préstamos, reclasificaciones, ajustes o
  liquidaciones. No se extrajeron documentos ni identificadores personales.
- La simulación real obtuvo 1 línea documentada, 0 problemas de identidad, 1
  objetivo de stock, suma actual 0, delta +1, objetivo 1 y 0 negativos. Ninguna
  línea V2 carece de `products.id`; no hay referencias huérfanas en los
  documentos vivos.
- Existen 1,420 productos en total; 222 referencias V1 y 42 V2 activas. Hay dos
  grupos de SKU duplicado, todos V2, sin mezcla V1/V2; H-113 nunca los resuelve
  por SKU.
- Hay cuatro terminales registradas, todas con época 2 y colas en cero, pero
  todas reportan esquema anterior a H-113. Por tanto, aun después de instalar la
  capacidad, el preview seguirá no ejecutable hasta que cada terminal use el
  cliente H-113 y publique su heartbeat compatible.
- Hay seis registros históricos de idempotencia sin documento vivo (3 ventas,
  2 devoluciones y 1 cambio). H-113 no los crea, no los selecciona y no los
  modifica; permanecen como riesgo histórico preexistente.
- H-98 conserva su RPC, su migración y su superficie de Punto Cero. H-113 usa
  tablas, evento y RPC independientes, por lo que un cliente H-68 no puede
  interpretar una limpieza selectiva como purga total.

Clasificación del deploy: migraciones aditivas. Crean tres tablas protegidas,
dos columnas `jsonb` nullable sin default ni backfill, políticas/ACL y funciones;
ajustan sólo la versión y fecha técnica de `pos.system_manifest`, además del
historial técnico de migraciones de Supabase. Los `DELETE`, restitución de stock,
incremento de época y demás cambios de negocio existen únicamente dentro de la
RPC de ejecución y no ocurren al instalar las migraciones.

La comprobación post-deploy confirmó `schema_version=20260817014900`, época 2 y
modo preproducción; las tres tablas H-113 están vacías y protegidas por RLS. No
hay privilegios de tabla para `anon`; `authenticated` sólo tiene `SELECT`, y las
RPC internas de plan/payload no son ejecutables directamente por ese rol. Las
seis funciones H-113 pertenecen a `postgres`, son `security definer` y conservan
`search_path` explícito. El hash remoto de `execute_point_zero` permaneció en
`622c560d4c564ffad15a6593095ccca7`, igual al preflight.

Huella agregada pre/post idéntica, excluyendo únicamente la forma de las dos
columnas nuevas nullable: 1,472 filas operativas,
`1a627bb781a12bdf4e13b5ee77de3c29`; 1,420 productos,
`3eed4cc3f6ec717d403a2745426fc33b`; stock,
`ae164da7056ba5a76e38685affb2a386`; suma V1 14,221 y V2 58. No cambió ninguna
fila de negocio, producto ni existencia.

## Pruebas

- `node test-h113-selective-cleanup.mjs`: 35/35; H-116 sustituye el bloqueo
  general por la clasificación de riesgo concreto sin alterar las guardas H-113.
- PostgreSQL 18 aislado: migración reaplicable, verificación posterior y prueba
  funcional aprobadas; el fixture termina con `ROLLBACK`. Confirmó V1 8→10,
  V2 A 4→5, V2 B con SKU duplicado intacto en 9, guarda de evidencia retenida,
  ajuste retenido exacto, respaldo completo, lápida `loan`, clientes/folios e
  idempotencia.
- `node test-h113-selective-cleanup-e2e.mjs`: 21/21; matriz 320, 360, 375, 390, 430,
  768, 1024, 1280 y 1440 px, sin overflow; cinco puertas, respaldo, comprobante,
  nombre accesible y cero errores de página. Evidencia en `.evidence-h113/`.
- Regresión: H-68 53/53; H-98 24/24; H-69 90/90; comisiones 10/10 y
  24/24; cambios 28/28; devoluciones 17/17; préstamos 117/117 y 69/69;
  cola 176/176; permisos de cliente 13/13 y 19/19; navegación 15/15.
- Esquema remoto clonado: verificación, funcional, reaplicación y
  `test-h113-selective-cleanup-permissions.sql` correctos, siempre con rollback.
- `node test-smoke.mjs bundle`: 17/17. La variante de desarrollo histórica
  agotó su espera de bootstrap; no afecta el bundle precompilado certificado y
  queda explícita como incidencia del arnés de desarrollo.
- `node build-offline.mjs` y `node test-build-reproducibility.mjs`: correctos.

## Riesgo residual y pendientes

La capacidad está instalada y verificada en Supabase. El cliente H-113 se
publicó desde el commit aislado `8b7042f`. El blob de Git y los bytes servidos
por GitHub Pages coinciden exactamente: 8,999,907 bytes y SHA-256
`f7388f3ee572395f9ea16bf3dc5ca49b2bf82a36d8c273bc94908a7097671db4`.
La UI pública read-only aprobó 13/13; BALAM QA no encontró defectos críticos,
altos ni medios. No se ejecutó Punto Cero, backup operativo ni RPC destructiva.
El diagnóstico remoto descrito aquí corresponde al contrato anterior a H-116.
Una vez publicada H-116, esos equipos se clasifican por capacidad de cerco y
operaciones pendientes reales, no por estar apagados o por heartbeat antiguo.
Instalar la capacidad no autoriza una limpieza posterior: la ejecución real
exige una autorización separada. Históricos retenidos sin evidencia financiera
completa continuarán bloqueados.

Después de publicar, el registro remoto conserva 0 terminales compatibles y 4
incompatibles (`20260808012700`: 1, `20260810013500`: 1,
`20260814014500`: 2). El cliente publicado sí declara
`SYNC_SCHEMA_VERSION=20260817014900`; cada terminal adoptará el protocolo cuando
abra/actualice el build y emita su heartbeat. No se forzó ni editó ningún
registro de terminal.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-113--la-limpieza-operativa-no-admite-alcance-selectivo-seguro-para-v1v2`
- `docs/fixes/punto-cero-administrativo.md`
- `docs/fixes/identidad-en-posventa.md`
- `docs/fixes/autoridad-comision-efectiva.md`
- `docs/architect/WORKFLOW.md`
