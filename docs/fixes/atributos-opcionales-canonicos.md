# Atributos opcionales canónicos

**Riesgo:** H-86
**Estado:** RESUELTO Y PUBLICADO
**Fecha:** 11/08/2026
**Commit técnico:** `27456bb504732babeea66449584c70ecb6f3e89b`

## Problema y reproducción

`attrs.caracteristicas = ""` sobrevivía en DATA y en el fingerprint, pero Excel
lo retiraba al importar. El round-trip cambiaba la huella aunque el negocio no
hubiera cambiado. Espacios también podían producir otra firma física H-94.

La prueba roja `node test-h86-optional-attrs-canonical.mjs` quedó **8/17**:
fallaron vacío, `null`, espacios, múltiples opcionales, obligatorio vacío,
igualdad semántica, huella y firma física.

## Causa raíz

No existía una autoridad de representación. `hydrate()` aceptaba `attrs`
literalmente, Excel aplicaba `if (value)` por su cuenta y
`canonicalProductState()` volvía a copiar el objeto crudo. Tres rutas respondían
de forma distinta a la misma pregunta de negocio.

## Diseño

`DATA.canonicalProductAttrs()` interpreta exclusivamente kinds custom conocidos
por CONFIG. Para los opcionales, ausencia, `null`, vacío y espacios significan
sin valor y la clave se omite. Claves `__*`, atributos históricos desconocidos
y datos no gobernados se conservan literalmente. Con `validateRequired`, un
catálogo obligatorio sin valor produce `CUSTOM_ATTRIBUTE_REQUIRED`.

La lectura histórica permanece compatible: `hydrate()` canonicaliza opcionales
pero no rechaza V1 incompleto. Alta, edición y el esquema Excel canónico sí
activan la validación estricta. En el adaptador Excel heredado, una columna que
no existía sigue significando preservar.

## Solución

- `balam/data.jsx`: autoridad compartida consumida por hidratación, firma física,
  snapshots, dimensiones estadísticas, SKU, alta/edición y persistencia.
- `balam/xlsx-io.jsx`: escritor, parser, estado semántico y fingerprint delegan
  en DATA; el preflight sigue siendo atómico y sin mutaciones ante conflicto.
- `test-h86-optional-attrs-canonical.mjs`: cubre los catorce casos aprobados y
  conserva el contrato de Características.
- `docs/architect/authorities/inventory.md`: registra la pregunta y su única
  autoridad.

No se modificaron Supabase, CONFIG remota, productos, SKU, barcodes, stock ni
migraciones. H94-PILOT permaneció detenido.

## Pruebas

- H-86 atributos: **17/17**; H-86 Excel: **42/42**.
- H-94 referencias: **48/48**; CONFIG H-94: **30/30**; H-95: **16/16**.
- H-83 autoridad/E2E: **32/32 + 17/17**; H-84 formulario: **19/19**.
- Importación con fotos **23/23**; exportación Modelo **14/14**; seguridad XLSX
  **17/17**.
- Cola **168/168**; sincronización viva **20/20**; convergencia **7/7**;
  contratos **42/42**.
- Build reproducible **8/8**; smoke bundle **17/17**; `git diff --check` limpio.
- Dry-run Supabase: `Remote database is up to date`.
- Preflight remoto de sólo lectura: 1,378 V1, 0 V2, 0 H94-PILOT, 3,334 piezas,
  huella V1 `d8bd3f2ed327f3e330c814d0bf9e8731`; último equipo con cola 0,
  bloqueos 0 y cursor CONFIG 46/46.

## Riesgo residual y pendientes

Ninguno conocido dentro de H-86. GitHub Pages run `31555048380` terminó en
`success`. El HTML servido mide 8,960,138 bytes y tiene SHA-256
`B8EA359CEA4E91929FC9C20528E63AEB77CF1EFDAD548E947448C887BA8755A1`;
coincide con el build tras normalizar 171 CRLF. Sobre esos bytes pasaron H-86
atributos 17/17, H-86 original 42/42, H-94 48/48 y smoke 17/17.

La lectura remota final repitió exactamente 1,378 V1, 0 V2, 0 H94-PILOT,
3,334 piezas y huella `d8bd3f2ed327f3e330c814d0bf9e8731`; products/CONFIG
permanecen en 40/46. El último equipo reporta cola 0, bloqueos 0 y cursor CONFIG
46/46. H94-PILOT sigue detenido y requiere autorización separada.

## Referencias

- Riesgo: `docs/03-known-risks.md` § H-86.
- `docs/02-architecture.md` § Contrato Excel canónico de Inventario.
- `docs/architect/authorities/inventory.md`.
