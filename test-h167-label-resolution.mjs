// H-167: paridad de identidad y coste del índice efímero de Etiquetas.
// Se ejecuta la fuente real; el canvas controlado sólo aísla la resolución.
// La geometría/PNG/PDF reales pertenecen a las regresiones H-127/H-132/H-133.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`OK ${name}`); }
  catch (error) { failed++; console.log(`FAIL ${name}: ${error.message}`); }
}
const barcodeFromId = id => '3' + BigInt('0x' + id.replaceAll('-', '').slice(-20)).toString().padStart(25, '0');
const v2 = (n, extra = {}) => {
  const id = '16100000-0000-4000-8000-' + String(n).padStart(12, '0');
  return { id, recordModel: 'v2', barcodeCode: barcodeFromId(id), barcodeContract: 3,
    barcodeAliases: [], sizeCode: '38', stockQuantity: 1, nombre: 'H167', sku: 'MISMO-SKU', ...extra };
};
const v1 = (n, code, extra = {}) => ({ id: 'legacy-' + n, recordModel: 'v1', sku: code,
  codes: { '38': code }, sizes: [{ value: '38', active: true, stock: 1 }], ...extra });
const D = {
  products: [], isV2Reference: p => p.recordModel === 'v2', barcodeFromId,
  materializedSku: (p, size) => p.recordModel === 'v2' ? p.sku : (p.codes[size] || ''),
  resolveProductSizes: p => ({ sizes: p.sizes || [{ value: p.sizeCode, active: true, stock: p.stockQuantity }] }),
};
const sandbox = { window: { DATA: D, JsBarcode: canvas => { canvas.width = 364; canvas.height = 100; } },
  document: { createElement: () => ({}) }, React: { createElement() {}, useRef() {}, useEffect() {} } };
vm.runInNewContext(fs.readFileSync('balam/barcodes.jsx', 'utf8'), sandbox);
const B = sandbox.window.BARCODES;
const plain = value => JSON.parse(JSON.stringify(value));
const batch = () => typeof B.createLabelCertificationBatch === 'function'
  ? B.createLabelCertificationBatch() : { certify: B.certifySellableReference };
function parity(products, selected = products) {
  D.products = products;
  const before = JSON.stringify(products), prepared = batch();
  const results = selected.map(p => {
    const result = prepared.certify(p, '38');
    assert.deepEqual(plain(result), plain(B.certifySellableReference(p, '38')));
    return result;
  });
  assert.equal(JSON.stringify(products), before, 'la certificación modificó datos');
  return results;
}

check('existe la preparación efímera sin argumentos ni resultados inyectados', () => {
  assert.equal(typeof B.createLabelCertificationBatch, 'function');
  assert.deepEqual(Object.keys(B.createLabelCertificationBatch()), ['certify']);
});
check('V2 exacto conserva todas las garantías y SKU repetidos independientes', () => {
  assert.ok(parity([v2(1), v2(2)]).every(result => result.ok));
});
check('aliases repetidos y alias igual al barcode aportan una sola coincidencia', () => {
  const p = v2(1); p.barcodeAliases = [p.barcodeCode, p.barcodeCode, 'old', 'OLD'];
  assert.equal(parity([p])[0].matches.length, 1);
  assert.equal(B.resolve('old').hit.alias, true);
  assert.equal(B.resolve(p.barcodeCode).hit.alias, true);
});
check('una colisión fuera de la selección, incluso sin stock, bloquea', () => {
  const a = v2(1), b = v2(2, { stockQuantity: 0, barcodeAliases: [a.barcodeCode] });
  const [result] = parity([a, b], [a]);
  assert.ok(result.issues.includes('BARCODE_DUPLICATE'));
  assert.equal(result.matches.length, 2);
});
check('un tombstone no colisiona; una referencia V2 agotada sigue resolviendo', () => {
  const a = v2(1, { stockQuantity: 0 }), b = v2(2, { barcodeCode: a.barcodeCode, _deletedAt: '2026-09-12' });
  assert.equal(parity([null, a, b], [a])[0].ok, true);
});
check('dos filas V2 con el mismo barcode nunca eligen la primera', () => {
  const a = v2(1), b = v2(2, { barcodeCode: a.barcodeCode });
  assert.ok(parity([a, b]).every(result => result.issues.includes('BARCODE_DUPLICATE')));
});
check('V1 sigue localizable pero bloquea toda etiqueta nueva', () => {
  const [result] = parity([v1(1, 'LEGACY-38')]);
  assert.equal(result.resolveCode, 'OK'); assert.ok(result.issues.includes('V1_OPERATIONAL'));
});
check('V1 inactivo o sin stock no contribuye al índice', () => {
  const a = v1(1, 'LEGACY-38');
  const b = v1(2, 'LEGACY-38', { sizes: [{ value: '38', active: false, stock: 1 }] });
  const c = v1(3, 'LEGACY-38', { sizes: [{ value: '38', active: true, stock: 0 }] });
  assert.equal(parity([a, b, c], [a])[0].matches.length, 1);
});
check('dos tallas V1 que materializan el mismo código conservan ambigüedad', () => {
  const p = v1(1, 'LEGACY-38'); p.codes['40'] = p.codes['38'];
  p.sizes.push({ value: '40', active: true, stock: 1 });
  assert.equal(parity([p])[0].resolveCode, 'BARCODE_AMBIGUOUS');
});
check('apóstrofe literal tiene prioridad sobre la adaptación a guion', () => {
  const quote = v1(1, "EXACT'38"), dash = v1(2, 'EXACT-38');
  assert.equal(parity([quote, dash], [quote])[0].resolvedProductId, quote.id);
});
check('adaptación con apóstrofe se usa sólo cuando no hay literal', () => {
  const dash = v1(1, 'EXACT-38'), selected = v1(2, "EXACT'38");
  assert.equal(parity([dash], [selected])[0].resolvedProductId, dash.id);
});
check('ambigüedad literal con apóstrofe no se evade por guion', () => {
  const a = v1(1, "EXACT'38"), b = v1(2, "EXACT'38"), dash = v1(3, 'EXACT-38');
  assert.equal(parity([a, b, dash], [a])[0].resolveCode, 'BARCODE_AMBIGUOUS');
});
check('falta de barcode, contrato incorrecto y talla distinta siguen bloqueados', () => {
  const rows = [v2(1, { barcodeCode: '' }), v2(2, { barcodeContract: 2 }), v2(3, { sizeCode: '40' })];
  const results = parity(rows);
  assert.ok(results[0].issues.includes('BARCODE_MISSING'));
  assert.ok(results[1].issues.includes('BARCODE_CONTRACT_VERSION'));
  assert.ok(results[2].issues.includes('SIZE_MISMATCH'));
});
check('aliases se normalizan a mayúsculas sin recortar espacios históricos', () => {
  const a = v2(1, { barcodeAliases: [' literal '] }), selected = v1(2, 'LITERAL');
  assert.equal(parity([a], [selected])[0].resolveCode, 'BARCODE_NOT_FOUND');
});
check('un batch nuevo vuelve a observar las colisiones de la autoridad vigente', () => {
  const a = v2(1); D.products = [a]; assert.equal(batch().certify(a, '38').ok, true);
  D.products.push(v2(2, { barcodeAliases: [a.barcodeCode] }));
  assert.ok(batch().certify(a, '38').issues.includes('BARCODE_DUPLICATE'));
  assert.ok(B.certifySellableReference(a, '38', () => ({ ok: true })).issues.includes('BARCODE_DUPLICATE'));
});
check('el lote recorre una vez el catálogo y completa todas las certificaciones', () => {
  let visits = 0;
  D.products = Array.from({ length: 200 }, (_, i) => Object.defineProperty(v2(i + 1), '_deletedAt', {
    get() { visits++; return null; },
  }));
  const prepared = batch();
  const results = D.products.map(p => prepared.certify(p, '38'));
  assert.equal(results.filter(result => result.ok).length, 200);
  console.log(JSON.stringify({ products: 200, catalogVisits: visits, certified: results.length }));
  assert.equal(visits, 200, 'coste lineal por generación');
});

console.log(`H-167 resolución: ${passed} pasaron, ${failed} fallaron`);
process.exitCode = failed ? 1 : 0;
