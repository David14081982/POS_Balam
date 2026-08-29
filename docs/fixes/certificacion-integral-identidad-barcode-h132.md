# Certificación integral de identidad y barcode del inventario vendible

**Riesgo:** H-132
**Estado:** CORRECCIÓN PREVENTIVA VERDE; CERTIFICACIÓN VIVA BLOQUEADA
**Fecha:** 29/08/2026
**Commit:** Pendiente de commit

## Problema y reproducción

Operación reportó al mismo tiempo etiquetas V1 que codifican el SKU
materializado y resultan `DENSE`, SKU visibles repetidos entre referencias
físicas y un par de etiquetas homónimas donde sólo una llega al POS. La
evidencia H-127/H-128 proviene del export del 19/08/2026 y no prueba el estado
remoto actual ni la caché de la terminal que reprodujo la venta.

El criterio observable de cierre es 100 % de las combinaciones activas con
existencia trazadas sin inferencia como `products.id exacto → barcode_code
técnico único → etiqueta/PDF con ese valor → entrada HID canónica →
BARCODES.resolve() → mismo products.id+talla`. Una sola referencia sin esa
cadena mantiene H-132 abierto.

## Causa raíz

La reproducción roja H-132 quedó 0/7: `LabelModal` generaba preview, PNG y PDF
desde `BARCODES.codeOf()` sin una precondición ejecutable que exigiera modelo
V2, barcode único y resolución al `products.id+talla` seleccionado. Los
diagnósticos H-127 eran informativos y podían advertir densidad o ambigüedad,
pero no constituían una puerta de identidad. Ésa es la causa demostrada de que
el cliente pudiera producir una salida nueva sin certificar la cadena completa.

La causa concreta del «Código no encontrado» de ANGEL y la incidencia actual de
V1, duplicados o desalineación local/remota siguen sin clasificarse: requieren
el snapshot autenticado vivo y el snapshot de la terminal que reprodujo el
fallo. El texto reportado puede resolver correctamente si existe una referencia
V1 única compatible; no se atribuye a barcode ausente sin ese cruce.

## Diseño

### Matriz de capacidades equivalentes y ciclo de vida

| Etapa | V1 histórico | V2 vendible | Control H-132 |
|---|---|---|---|
| Entrada | SKU materializado+talla, sólo compatibilidad | `barcode_code` | HID canónico compartido H-130/H-131 |
| Autorización | lectura histórica | referencia activa visible por RLS | snapshot autenticado read-only |
| Validación | no autoriza etiquetas nuevas | barcode presente, formato técnico y único | certificación por combinación |
| Cancelación/regreso | no muta inventario | generación entera se bloquea ante una fila inválida | cero salida parcial engañosa |
| Mutación local | ninguna por certificar | ninguna por certificar | auditoría read-only |
| Persistencia/cola | se conserva | se conserva | no se escribe ni encola |
| Contrato remoto | fila histórica sin reinterpretar | `products.id`, talla, stock y barcode escalares | comparación exacta por ID |
| Pull/multiterminal/reload | adaptador sólo lectura | misma identidad tras sincronizar | remoto vs local explícito |
| Consumidores | POS/posventa históricos | POS, etiquetas, PDF, Excel y documentos | misma autoridad de certificación |
| Operación terminal | no se imprimen etiquetas vendibles nuevas | etiqueta sólo si certifica | fallo cerrado antes de PNG/PDF |
| Reversa/baja | histórico intacto | sin cambio de filas | no aplica: cambio cliente aditivo |
| Feedback/observabilidad | se enumera como deuda de migración | estado y causa por combinación | CSV/JSON + resumen ejecutivo |

La migración V1→V2, la transferencia de stock y la sustitución física de
etiquetas forman un ciclo posterior: deben ser atómicas, idempotentes, conservar
IDs e históricos V1 y terminar con aceptación de impresora/lector reales. No se
ejecutan bajo esta fase de certificación.

### Invariantes

1. SKU, nombre, familia, orden y caché nunca localizan una referencia V2.
2. Una salida de etiqueta usa el mismo valor certificado en preview, PNG, vista
   imprimible y PDF.
3. El valor certificado resuelve exactamente a `products.id` y talla; cero o
   múltiples coincidencias bloquean.
4. Una combinación V1 vendible se censará, pero no podrá generar una etiqueta
   nueva: necesita migración logística V2.
5. El nombre PDF es una ayuda humana y nunca una autoridad técnica.
6. La auditoría viva no modifica filas, stock, cola, configuración ni caché.

## Solución

- `BARCODES.certifySellableReference()` es la autoridad única por combinación:
  compara `codeOf`, `barcode_code`, unicidad, resolución exacta, talla, Code128
  y geometría física sin usar SKU, nombre, familia, orden o caché como identidad.
- `BARCODES.certifySellableInventory()` recorre todas las combinaciones activas
  con existencia y devuelve el mismo contrato para CI y auditoría.
- `LabelModal` falla cerrado para el lote completo antes de producir PNG, PDF,
  vista imprimible o upload si una combinación es V1 o no certifica. Conserva
  visibles los diagnósticos geométricos puros para explicar la deuda sin fingir
  un fallo de generación causado por la propia guarda.
- El nombre del PDF incluye nombre/modelo, SKU humano compartido o variado,
  tallas, número de referencias y sufijos abreviados. Sólo distingue archivos;
  no localiza productos ni sustituye ID/barcode.
- `audit-h132-live-inventory.mjs` consulta el endpoint Management API read-only
  o snapshots explícitos, bloquea Supabase dentro del navegador y emite CSV/JSON
  ignorados por Git. Cuenta V1/V2, piezas, `OK/NEAR/DENSE`, barcodes ausentes,
  duplicados/no resolubles, SKU visibles repetidos, ANGEL, divergencia
  local/remota, PDF y trazas HID. Sale distinto de cero ante una sola falla o
  si no recibió snapshot local comparable.
- `.github/workflows/h132-inventory-identity.yml` reconstruye en Windows/Chrome
  y ejecuta H-132 más las regresiones de diagnóstico, PDF y SKU en cada PR y
  push a `main`. Valida el contrato con fixtures; el censo real sigue exigiendo
  credencial read-only y snapshot local fuera de Git.
- No se cambió ninguna fila, stock, barcode, ID, cola ni histórico real.

Ejecución operativa en PowerShell, con un token Management API limitado a
`database_read` y un JSON local exportado desde la colección
`balam_pos_products_v2`/`DATA.products` de la terminal afectada:

```powershell
$env:SUPABASE_PROJECT_REF = '<project-ref>'
$env:SUPABASE_ACCESS_TOKEN = '<token-read-only>'
node audit-h132-live-inventory.mjs --local '<snapshot-local.json>' `
  --reported-code '1-ANG-MC-AJSP-TRA-BL-38'
```

También acepta `--snapshot '<pos-products-remoto.json>'` para QA reproducible
sin red. El token nunca se escribe en los reportes; el CSV, el resumen y el
snapshot remoto quedan bajo `.evidence-h132-live/`, ignorado por Git.

### Plan sistémico de migración — no ejecutado

El alcance es todo el inventario activo con existencia, sin filtro por categoría
o por los productos ya reportados:

1. Capturar en una misma ventana el snapshot read-only remoto y el snapshot
   local de cada terminal operacional; drenar o aislar previamente cualquier
   operación de inventario pendiente.
2. Ejecutar el certifier y congelar un manifiesto por cada combinación V1:
   ID V1, talla/escala, piezas, documentos que la citan, ID V2 destino nuevo o
   existente, `barcode_code` único esperado y número de etiquetas a sustituir.
   Cero inferencias por SKU y cero pares ambiguos.
3. Someter el manifiesto y su decisión de rollback a autorización. Es HARD STOP
   porque mover stock real, decidir el destino V2 y retirar etiquetas físicas
   cambia operación.
4. Implementar una RPC server-side transaccional e idempotente que bloquee las
   filas del manifiesto, vuelva a validar versiones y cantidades, cree o valide
   referencias V2, transfiera el stock exactamente una vez y conserve las filas
   V1 para documentos históricos. Debe abortar el lote completo ante cualquier
   desalineación; no se escribirá un bucle cliente fila por fila.
5. Hacer pull/reload en todas las terminales y exigir censo remoto/local verde.
   El total de piezas antes y después debe coincidir y V1 vendible debe quedar en
   cero para todo el inventario, no sólo para una familia.
6. Regenerar únicamente las etiquetas enumeradas por el manifiesto y verificar
   `barcode_code → products.id+talla` con la impresora y el lector reales. Una
   muestra fallida invalida el lote y activa el rollback acordado.
7. Publicar la guarda H-132 sólo después de la migración y aceptación física;
   repetir el certifier en CI y conservar únicamente el resumen no sensible.

Condiciones de salida: `V1 vendible = 0`, `fallos = 0`, divergencia local/remota
`= 0`, total de piezas conservado, cada etiqueta nueva V2 resuelve exactamente y
hardware firmado. Hasta entonces el estado no es «100 % certificado».

## Pruebas

- Roja H-132: 0/7 antes de crear la autoridad y la guarda.
- Verde H-132 identidad: 7/7.
- Certificador reproducible con snapshots: 2/2 escenarios; el escenario sano
  certifica dos referencias V2 con SKU visible repetido y el escenario roto
  detecta V1, barcode duplicado y divergencia local/remota.
- H-127: autoridad física 9/9 y diagnóstico UI 11/11.
- H-128: recuperación geométrica 11/11 y BALAM QA 9/9. La QA cubrió 320, 360,
  390, 430, 768, 1024, 1280 y 1440 px con capturas, cero overflow, cero errores
  inesperados y cero escrituras comerciales.
- H-99: visual 12/12 y PDF 23/23; MIME, estructura, 60×40, preview, impresión y
  Web Share conservados con el nombre distinguible.
- H-100: 10/10; el lote mixto bloquea V1 y, al retirar sus referencias, preview,
  PDF e impresión contienen sólo los seis V2 exactos.
- H-94: 49/49; H-130: 7/7; H-131: 23/23; contratos de módulos: 42/42.
- Build `node build-offline.mjs`: correcto; reproducibilidad 8/8; navegación
  15/15; arranque productivo 5/5; smoke del bundle 17/17. El smoke del HTML de
  desarrollo no arrancó porque sus CDN están inaccesibles en este entorno; el
  artefacto productivo embebido no depende de ellos. Pendiente la auditoría
  contra datos vivos.

## Riesgo residual y pendientes

El intento vivo terminó con
`SUPABASE_ACCESS_TOKEN_REQUIRED_FOR_READ_ONLY_QUERY`; no había una sesión
Management API delegable al proceso. Tampoco se recibió snapshot local de la
terminal. Por ello no existen conteos vivos verificables, no se certifica ANGEL
ni se afirma 100 %. Impresora y lector físicos permanecen `NOT_TESTED`.

La migración real V1→V2, transferencia de stock y reimpresión son HARD STOP.
Además, esta corrección no debe publicarse antes de coordinar la migración: la
guarda bloquearía correctamente nuevas etiquetas para toda referencia V1 que
continúe vendible.

## Referencias

- Riesgo: `docs/03-known-risks.md#h-132--inventario-vendible-sin-certificación-integral-de-identidad-y-barcode`
- `docs/fixes/autoridad-fisica-code128-h127.md`
- `docs/fixes/recuperacion-layout-v1-denso-h128.md`
- `docs/fixes/normalizacion-visible-lector-hid-h130.md`
- `docs/fixes/normalizacion-diagonal-lector-hid-h131.md`
- `docs/architect/decisions/ADR-013-identidad-de-referencia-fisica-v2.md`
