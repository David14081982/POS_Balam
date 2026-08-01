// H-66 — El código que ve el administrador y viaja en Excel es EDITABLE;
// la identidad con la que el inventario encuentra sus piezas es INMUTABLE.
//
// Diseño C: `internal_code` es la identidad estable de una talla; `code` es el
// código canónico de operación e intercambio; `label` es la etiqueta visible.
// Editar `code` NO debe mover una sola existencia.
//
// Este arnés se escribe ANTES de implementar y debe salir ROJO. Las
// comprobaciones que necesitan navegador se afirman sobre la fuente y quedan
// marcadas como estáticas: no sustituyen a la prueba de comportamiento.
//
// ⚠ ARNÉS DE REPRODUCCIÓN PREVIO A LA IMPLEMENTACIÓN — ROJO ESPERADO.
// No forma parte de la suite de regresión. Sin argumento explícito no afirma
// nada y termina en 0, para que ningún recorrido de `test-*.mjs` pueda teñir de
// rojo la rama principal por un arnés que TODAVÍA debe fallar.
//
//     node test-h66-canonical-code.mjs --reproduccion
//
import fs from 'fs';
import vm from 'vm';

if (!process.argv.includes('--reproduccion')) {
  console.log('H-66 · arnés de reproducción previo a la implementación (rojo esperado).');
  console.log('No pertenece a la suite de regresión. Para ejecutarlo:');
  console.log('    node test-h66-canonical-code.mjs --reproduccion');
  process.exit(0);
}

let pass = 0, fail = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  condition ? pass++ : fail++;
};

const core = fs.readFileSync('balam/core.jsx', 'utf8');
const config = fs.readFileSync('balam/config.jsx', 'utf8');
const data = fs.readFileSync('balam/data.jsx', 'utf8');
const xlsx = fs.readFileSync('balam/xlsx-io.jsx', 'utf8');
const store = fs.readFileSync('balam/store.jsx', 'utf8');
const settings = fs.readFileSync('balam/settings.jsx', 'utf8');

// Las diez tallas de la primera normalización: identidad histórica → canónico.
const PLAN = [
  ['s', '0'], ['0', '38'], ['A', '40'], ['B', '42'], ['C', '44'],
  ['D', '46'], ['E', '48'], ['F', '49'], ['G', '50'], ['H', '52'],
];

function escenario() {
  const memory = new Map();
  const sandbox = {
    window: { dispatchEvent() {} },
    localStorage: { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)) },
    CustomEvent: class {}, console,
  };
  vm.createContext(sandbox);
  vm.runInContext(core + '\n' + config, sandbox);
  const C = sandbox.window.CONFIG;
  const snap = C.snapshot();
  // Catálogo con la forma real de la tienda: identidad histórica en el código.
  snap.catalogs.size_number = PLAN.map(([interno], i) => ({
    code: interno, label: String(i), active: interno !== 'F', meta: {},
  }));
  snap.catalogs.size_letter = [{ code: 'CH', label: 'CHICO', active: true, meta: {} }];
  C.load(snap);
  const productos = [{
    id: 'p1', sku: '1-XXX-MC-BL-T', color: 'BL',
    attrs: { __sizeCategoryId: 'size_number' }, sizeCategoryId: 'size_number',
    stock: [{ talla: 'B', escala: 'N', stock: 6 }, { talla: '0', escala: 'N', stock: 3 }],
    preciosTalla: {}, barcodeUrls: {},
  }];
  sandbox.window.CORE.registerCatalogProducts({ list: () => productos, save: () => {} });
  if (typeof sandbox.window.CORE.registerCatalogPromotions === 'function') {
    sandbox.window.CORE.registerCatalogPromotions({ list: () => [] });
  }
  return { C, productos, huella: () => JSON.stringify(productos.map(p => [p.id, p.stock])) };
}

// ── 1. Contrato de identidad ────────────────────────────────────────────────
{
  const { C } = escenario();
  check('CONFIG resuelve el código canónico hacia la identidad',
    typeof C.internalCodeOf === 'function');
  check('CONFIG resuelve la identidad hacia el código canónico',
    typeof C.canonicalCodeOf === 'function');
  check('CONFIG publica una operación para editar el código canónico',
    typeof C.setCanonicalCode === 'function');
  check('CONFIG publica el historial de códigos canónicos',
    typeof C.canonicalHistory === 'function');
  check('CONFIG publica la versión del catálogo',
    typeof C.catalogVersion === 'function');
  check('el esquema del catálogo declara internal_code',
    /internal_?[Cc]ode/.test(config));
}

// ── 2. Editar el código canónico NO mueve existencias ───────────────────────
{
  const { C, productos, huella } = escenario();
  const antes = huella();
  const r = typeof C.setCanonicalCode === 'function'
    ? C.setCanonicalCode('size_number', 'B', '42') : { ok: false, error: 'sin API' };
  check('editar el código canónico se acepta', r && r.ok === true, JSON.stringify(r));
  check('stock[].talla queda BYTE A BYTE igual', huella() === antes);
  check('la identidad histórica no cambió',
    productos[0].stock.some(v => v.talla === 'B'));
  check('el catálogo expone el canónico nuevo',
    typeof C.canonicalCodeOf === 'function' && C.canonicalCodeOf('size_number', 'B') === '42');
  check('la identidad sigue resolviéndose desde el canónico',
    typeof C.internalCodeOf === 'function' && C.internalCodeOf('size_number', '42') === 'B');
}

// ── 3. internal_code es inmutable y el canónico es único ────────────────────
{
  const { C } = escenario();
  const inmutable = typeof C.setInternalCode === 'function'
    ? C.setInternalCode('size_number', 'B', 'X') : { ok: false, error: 'no existe' };
  check('no existe forma de editar la identidad', inmutable.ok !== true);
  if (typeof C.setCanonicalCode === 'function') {
    C.setCanonicalCode('size_number', 'B', '42');
    const dup = C.setCanonicalCode('size_number', 'C', '42');
    check('un código canónico repetido se rechaza', dup && dup.ok === false, JSON.stringify(dup));
  } else check('un código canónico repetido se rechaza', false, 'sin API');
}

// ── 4. Historial de códigos canónicos ───────────────────────────────────────
{
  const { C } = escenario();
  if (typeof C.setCanonicalCode === 'function' && typeof C.canonicalHistory === 'function') {
    C.setCanonicalCode('size_number', 'B', '42');
    C.setCanonicalCode('size_number', 'B', '042');
    const h = C.canonicalHistory('size_number', 'B') || [];
    check('el historial registra cada código canónico anterior',
      h.length === 2 && h.some(x => x.previous_code === '42'), JSON.stringify(h));
    check('el historial guarda versión, fecha, actor y operación',
      h.every(x => x.catalog_version != null && x.changed_at && 'actor_user_id' in x && x.operation_id));
    check('un canónico ya usado no se reasigna a otra talla',
      (C.setCanonicalCode('size_number', 'C', '42') || {}).ok === false);
  } else {
    check('el historial registra cada código canónico anterior', false, 'sin API');
    check('el historial guarda versión, fecha, actor y operación', false, 'sin API');
    check('un canónico ya usado no se reasigna a otra talla', false, 'sin API');
  }
}

// ── 5. Excel: encabezados por canónico, stock por identidad ─────────────────
check('la exportación compone el encabezado con el código canónico',
  /header:\s*\(prefix[^)]*\)\s*\+\s*String\(\s*(item\.)?code\s*\)/.test(xlsx));
check('la importación escribe la IDENTIDAD en stock[].talla, no el canónico',
  /talla:\s*item\.internal|talla:\s*internalCode|talla:\s*item\.identidad/.test(xlsx));
check('el archivo nuevo declara esquema, versión de catálogo y fecha',
  /_esquema/.test(xlsx) && /catalog_?[Vv]ersion/.test(xlsx) && /_exportado|fecha_exportacion/.test(xlsx));
check('un archivo sin marca NO se traduce solo: exige modo heredado',
  /heredad/i.test(xlsx) && /modoHeredado|legacyMode|importarHeredado/.test(xlsx));
check('dos columnas que resuelven a la misma identidad bloquean el archivo',
  /misma identidad|mismo internal|columnas conflictivas/i.test(xlsx));

// ── 6. Identidad estable en las autoridades ─────────────────────────────────
check('sizeId ya no es el código canónico editable',
  !/sizeId:\s*item\.code\b/.test(data));
check('filterKey se construye con la identidad estable',
  !/filterKey:.*encodeURIComponent\(String\(item\.code\)\)/.test(data));
check('resolveProductSizes sigue localizando por identidad',
  /meta,\s*'value'\)\s*\?\s*meta\.value\s*:\s*item\.code|internal/.test(data));

// ── 7. Sincronización e identidad en el servidor ────────────────────────────
check('el upsert de catálogo reconcilia por identidad, no por código canónico',
  /onConflict:\s*'kind,internal_code'/.test(store));
// Acotado a pushConfig: `expected_version` ya existe en store.jsx para los RPC de
// permisos, así que una búsqueda suelta daría un verde falso (AP-11).
check('el push de configuración viaja con expected_version',
  /function pushConfig\([\s\S]{0,900}?expected_?[Vv]ersion/.test(store));
check('una terminal desactualizada es rechazada por versión',
  /CATALOG_VERSION_CONFLICT|catalog_version_conflict/.test(store));

// ── 8. Interfaz de Configuración ────────────────────────────────────────────
check('Configuración muestra el identificador histórico sólo lectura',
  /Identificador histórico/.test(settings));
check('el campo editable NO se llama «código interno»',
  /Código de operación|Código de Excel|Código de operación\/Excel/.test(settings)
  && !/Código interno/.test(settings));
check('el cambio de canónico avisa que los productos NO cambian',
  /no cambian|no se modifican los productos/i.test(settings));

// ── 9. size_letter no cambia de comportamiento ──────────────────────────────
{
  const { C } = escenario();
  const antes = JSON.stringify(C.all('size_letter'));
  if (typeof C.setCanonicalCode === 'function') C.setCanonicalCode('size_number', 'B', '42');
  check('size_letter queda intacta al editar una talla numérica',
    JSON.stringify(C.all('size_letter')) === antes);
}

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
