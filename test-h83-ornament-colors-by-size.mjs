// H-83: colores de ornamento efectivos por talla.
//
// La prueba carga DATA real en memoria. Antes de la corrección debe quedar roja:
// el producto sólo conoce `ornColors` general y los documentos no congelan el
// valor efectivo de la talla.
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const dataSrc = read('./balam/data.jsx');
const inventorySrc = read('./balam/inventory.jsx');
const xlsxSrc = read('./balam/xlsx-io.jsx');
const storeSrc = read('./balam/store.jsx');
const posSrc = read('./balam/pos.jsx');
const ticketSrc = read('./balam/pos-ticket.jsx');
const migrationPath = './supabase/migrations/20260808012600_pos_h83_ornament_colors_by_size.sql';
const verificationPath = './supabase/migrations/20260808012700_pos_h83_ornament_colors_by_size_verification.sql';
const migrationSrc = read(migrationPath);

let pass = 0, fail = 0;
function ok(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const COLORS = [
  { code: 'DRO', label: 'Dorado', active: true, meta: { hex: '#caa83a' } },
  { code: 'CF', label: 'Café', active: true, meta: { hex: '#5a4334' } },
  { code: 'PLT', label: 'Plateado', active: true, meta: { hex: '#c8ccd2' } },
];
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];

function terminal() {
  const storage = new Map();
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key), clear: () => storage.clear(),
  };
  const settings = {
    'folio.prefix': 'BG', 'commission.base': 'neto',
    'returns.limitEnabled': false, 'returns.reverseCommission': false,
  };
  const catalogs = {
    color: COLORS,
    ornament: [
      { code: 'PEDAL', label: 'Bordado pedal', active: true, meta: {} },
      { code: 'ALFORZA', label: 'Alforza', active: true, meta: { allowsColors: false } },
      { code: '—', label: 'Sin ornamento', active: true, meta: { allowsColors: false } },
    ],
    size_letter: SIZES.map(code => ({ code, label: code, active: true, meta: {} })),
    size_number: [],
    payment_method: [{ code: 'Efectivo' }, { code: 'Apartado' }],
    return_reason: [{ code: 'Talla' }],
  };
  const CONFIG = {
    get: key => settings[key], setSetting: (key, value) => { settings[key] = value; },
    map: kind => Object.fromEntries((catalogs[kind] || []).filter(x => x.active !== false).map(x => [x.code, x.label])),
    metaMap: (kind, field) => Object.fromEntries((catalogs[kind] || []).filter(x => x.active !== false).map(x => [x.code, (x.meta || {})[field]])),
    codes: kind => (catalogs[kind] || []).filter(x => x.active !== false).map(x => x.code),
    list: kind => (catalogs[kind] || []).filter(x => x.active !== false),
    all: kind => (catalogs[kind] || []).slice(),
    find: (kind, code) => (catalogs[kind] || []).find(x => String(x.code) === String(code)) || null,
    sizeCategories: () => [{ id: 'size_letter', label: 'Talla (Letra)', scale: 'L' }],
    catalogMeta: kind => kind === 'size_letter' ? { sizeScale: 'L' } : null,
    allCatalogMeta: () => ({}), catalogLabel: kind => kind, skuParts: () => [],
  };
  const noop = () => {};
  const sandbox = {
    console, localStorage, Date, setTimeout, clearTimeout, JSON, Math, Object,
    Array, String, Number, Boolean, isNaN, parseInt, parseFloat, RegExp, Error,
    Set, Map, Promise,
  };
  sandbox.window = {
    CONFIG, localStorage,
    CORE: {
      getDeviceId: () => 'h83-device', registerCatalogProducts: noop,
      registerSyncGateway: noop, invokeSync: noop,
    },
    UI: { toast: noop, fmt: n => '$' + Number(n).toFixed(2) },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
    crypto: { randomUUID: () => '11111111-1111-4111-8111-111111111111' },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dataSrc, sandbox);
  if (typeof sandbox.window.DATA.applyFolioBlock === 'function') {
    sandbox.window.DATA.applyFolioBlock('BG', new Date().toISOString().slice(2, 10).replace(/-/g, ''), 1, 100);
  }
  return { D: sandbox.window.DATA, sandbox };
}

function product(over = {}) {
  return Object.assign({
    id: 'h83-product', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL',
    cuello: 'MAO', modelo: 'ADR', nombre: 'Adriana', orn: 'PEDAL',
    ornColors: ['DRO', 'CF'], precio: 650, preciosTalla: { XL: 700 },
    sku: '1-ADR-MC-BC-T', attrs: { __sizeCategoryId: 'size_letter' },
    sizeCategoryId: 'size_letter',
    stock: SIZES.map(talla => ({ talla, escala: 'L', stock: 10 })),
  }, over);
}

const { D, sandbox } = terminal();
const effective = (p, talla) => typeof D.effectiveOrnamentColors === 'function'
  ? D.effectiveOrnamentColors(p, talla) : undefined;
const sanitize = (map, p) => typeof D.sanitizeOrnamentColorsBySize === 'function'
  ? D.sanitizeOrnamentColorsBySize(map, p) : undefined;

console.log('\n── Autoridad y forma canónica ──');
ok('1. DATA publica effectiveOrnamentColors', typeof D.effectiveOrnamentColors === 'function');
ok('2. DATA publica sanitizeOrnamentColorsBySize', typeof D.sanitizeOrnamentColorsBySize === 'function');

const p = product({ attrs: {
  __sizeCategoryId: 'size_letter',
  __ornamentColorsBySize: { XS: ['CF', 'DRO', 'CF'], S: ['DRO', 'CF'], L: ['PLT'] },
} });
const canonical = sanitize(p.attrs.__ornamentColorsBySize, p) || {};
ok('3. los colores se deduplican y ordenan canónicamente', same(canonical.XS, ['DRO', 'CF']), JSON.stringify(canonical));
ok('4. distinto orden de entrada produce exactamente la misma configuración', same(canonical.XS, canonical.S));
ok('5. una talla con especial usa sus colores', same(effective(p, 'L'), ['PLT']), JSON.stringify(effective(p, 'L')));
ok('6. una talla sin especial hereda los colores generales', same(effective(p, 'M'), ['DRO', 'CF']), JSON.stringify(effective(p, 'M')));
ok('7. un color ajeno al catálogo no sobrevive', !JSON.stringify(sanitize({ XS: ['NO-EXISTE', 'DRO'] }, p) || {}).includes('NO-EXISTE'));
ok('8. una talla ajena a la categoría no sobrevive', !Object.prototype.hasOwnProperty.call(sanitize({ XXL: ['DRO'] }, p) || {}, 'XXL'));
ok('9. un grupo vacío no anula la herencia', same(effective(product({ attrs: { __sizeCategoryId: 'size_letter', __ornamentColorsBySize: { M: [] } } }), 'M'), ['DRO', 'CF']));
ok('10. sin ornamento no hay colores efectivos', same(effective(product({ orn: '—' }), 'XS'), []));
ok('11. un ornamento que declara no admitir colores devuelve vacío', same(effective(product({ orn: 'ALFORZA' }), 'XS'), []));

console.log('\n── Persistencia e invariantes ──');
const before = product({ attrs: { __sizeCategoryId: 'size_letter', __ornamentColorsBySize: { XS: ['CF', 'DRO'], L: ['PLT'] } } });
const stockBefore = JSON.stringify(before.stock), priceBefore = JSON.stringify(before.preciosTalla), skuBefore = before.sku;
const hydrated = D.hydrate(before);
ok('12. hydrate conserva el mapa sólo en attrs reservado', !!(hydrated.attrs || {}).__ornamentColorsBySize && hydrated.ornamentColorsBySize === undefined);
ok('13. hydrate conserva exactamente la matriz de stock', JSON.stringify(hydrated.stock) === stockBefore);
ok('14. hydrate conserva exactamente preciosTalla', JSON.stringify(hydrated.preciosTalla) === priceBefore);
ok('15. hydrate conserva exactamente el SKU', hydrated.sku === skuBefore);

console.log('\n── Documento histórico ──');
D.products.push(hydrated);
let sale;
try {
  sale = D.recordSale({
    ticket: [{ p: hydrated, talla: 'XS', qty: 1 }], sellerIds: [], client: null,
    metodo: 'Efectivo', estado: 'Pagado', itemCount: 1,
  });
} catch (error) { sale = { error: error.message, lineas: [] }; }
const sold = (sale.lineas || [])[0] || {};
ok('16. la venta congela el ornamento utilizado', sold.ornamento === 'PEDAL', JSON.stringify(sold));
ok('17. la venta congela los colores efectivos de la talla', same(sold.ornColors, ['DRO', 'CF']), JSON.stringify(sold));
hydrated.ornColors = ['PLT'];
hydrated.attrs.__ornamentColorsBySize = { XS: ['PLT'] };
ok('18. editar el producto después no cambia la evidencia vendida', same(sold.ornColors, ['DRO', 'CF']));

const returnResult = D.recordReturn({
  folio: sale.folio,
  lineas: [{ sku: sold.sku, nombre: sold.nombre, talla: sold.talla, qty: 1, motivo: 'Talla' }],
  metodo: 'Efectivo', notas: 'H-83',
});
const returned = returnResult.ret && returnResult.ret.lineas[0];
ok('19. una devolución conserva la evidencia congelada de la venta',
  returned && returned.ornamento === 'PEDAL' && same(returned.ornColors, ['DRO', 'CF']), JSON.stringify(returned));

const terminalExchange = terminal();
const exchangeProduct = terminalExchange.D.hydrate(product({ attrs: {
  __sizeCategoryId: 'size_letter', __ornamentColorsBySize: { XS: ['DRO', 'CF'], L: ['PLT'] },
} }));
terminalExchange.D.products.push(exchangeProduct);
const exchangeSale = terminalExchange.D.recordSale({
  ticket: [{ p: exchangeProduct, talla: 'XS', qty: 1 }], sellerIds: [], client: null,
  metodo: 'Efectivo', estado: 'Pagado', itemCount: 1,
});
const exchangeResult = terminalExchange.D.recordExchange({
  origenFolio: exchangeSale.folio,
  lineas: [
    { lado: 'devuelto', productId: exchangeProduct.id, sku: exchangeProduct.sku, nombre: exchangeProduct.nombre, talla: 'XS', qty: 1, condicion: 'Nueva' },
    { lado: 'entregado', productId: exchangeProduct.id, sku: exchangeProduct.sku, nombre: exchangeProduct.nombre, talla: 'L', qty: 1 },
  ], usuario: 'H-83', notas: 'H-83',
});
const exchangeLines = (exchangeResult.exchange && exchangeResult.exchange.lineas) || [];
ok('20. un cambio conserva evidencia para la pieza recibida y la entregada',
  same((exchangeLines[0] || {}).ornColors, ['DRO', 'CF']) && same((exchangeLines[1] || {}).ornColors, ['PLT']), JSON.stringify(exchangeResult));

console.log('\n── Contratos de interfaz, Excel y sincronización ──');
ok('21. el formulario ofrece el bloque agrupado y su contrato estable',
  /Colores de ornamento/.test(inventorySrc) && /data-testid[^\n]+ornament-colors-by-size/.test(inventorySrc));
ok('22. la interfaz bloquea superposiciones; no aplica último gana',
  /colores incompatibles[^\n]+grupos/i.test(inventorySrc));
ok('23. el Excel transporta la relación talla → colores', /Colores Orn\. por talla/.test(xlsxSrc));
ok('24. la importación conserva el contenedor extensible attrs', /__ornamentColorsBySize/.test(xlsxSrc));

vm.runInContext(xlsxSrc, sandbox);
const cols = {
  letters: SIZES.map(value => ({ kind: 'size_letter', value, label: value, header: value, legacyHeader: value })),
  numbers: [], fileMap: null, hasOrnamentColorsBySize: true,
};
const excelSource = product({ attrs: {
  __sizeCategoryId: 'size_letter', __ornamentColorsBySize: { XS: ['DRO', 'CF'], L: ['PLT'] },
} });
const excelRow = sandbox.window.XLSXIO.__test.rowFromProduct(excelSource, cols);
const excelRoundTrip = sandbox.window.XLSXIO.__test.buildProduct(excelRow, 0, cols);
ok('25. exportar e importar conserva exactamente talla → códigos',
  same(excelRoundTrip.attrs.__ornamentColorsBySize, { XS: ['DRO', 'CF'], L: ['PLT'] }), JSON.stringify(excelRoundTrip.attrs));
const oldCols = { ...cols, hasOrnamentColorsBySize: false };
const oldRow = { ...excelRow }; delete oldRow['Colores Orn. por talla'];
const oldImport = sandbox.window.XLSXIO.__test.buildProduct(oldRow, 0, oldCols);
ok('26. un Excel histórico no expresa un borrado del mapa existente',
  !Object.prototype.hasOwnProperty.call(oldImport.attrs, '__ornamentColorsBySize'));

ok('27. STORE conserva attrs como la única fuente sincronizada',
  /__ornamentColorsBySize/.test(storeSrc) || (/const attrs = Object\.assign\(\{\}, p\.attrs/.test(storeSrc) && /attrs: r\.attrs \|\| \{\}/.test(storeSrc)));
ok('28. el renglón remoto transporta el snapshot de ornamento',
  /ornamento/.test(storeSrc) && /orn_colors/.test(storeSrc.slice(storeSrc.indexOf('function pushSale'))));
ok('29. POS consulta la autoridad efectiva por talla',
  /effectiveOrnamentColors\(p, size\.value\)/.test(posSrc));
ok('30. el ticket imprime exclusivamente la evidencia congelada cuando existe',
  /ornamentEvidence\(l\)/.test(ticketSrc) && /ticket-ornament-evidence/.test(ticketSrc));
ok('31. la migración aditiva conserva snapshots en venta, devolución y cambio',
  existsSync(new URL(migrationPath, import.meta.url)) && existsSync(new URL(verificationPath, import.meta.url))
    && /alter table pos\.sale_items/.test(migrationSrc)
    && /alter table pos\.return_items/.test(migrationSrc)
    && /alter table pos\.exchange_items/.test(migrationSrc));
ok('32. las fronteras H-83 delegan en los RPC comerciales vigentes',
  /pos\.h83_commit_sale_delegate/.test(migrationSrc)
    && /pos\.h83_commit_return_delegate/.test(migrationSrc)
    && /pos\.h83_commit_exchange_delegate/.test(migrationSrc));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
