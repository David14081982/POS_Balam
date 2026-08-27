// H-126 · Un lector USB HID puede entregar apóstrofes cuando la etiqueta contiene
// guiones, según la distribución del teclado. La adaptación pertenece únicamente
// a la resolución de la lectura: nunca reescribe SKU, barcode_code ni inventario.
import fs from 'node:fs';
import vm from 'node:vm';

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? passed++ : failed++;
};

const products = [
  {
    id: 'h126-v1-dash', recordModel: 'v1',
    codes: { '38': '21-ML-ALG-38-128' },
    sizes: [{ value: '38', active: true, stock: 2 }],
  },
  {
    id: 'h126-v1-apostrophe', recordModel: 'v1',
    codes: { M: "ESPECIAL'M" },
    sizes: [{ value: 'M', active: true, stock: 1 }],
  },
  {
    id: '00000000-0000-4000-8000-000000000117', recordModel: 'v2',
    barcodeCode: 'B0123456789ABCDE', sizeCode: '42', stockQuantity: 1,
  },
];
const snapshot = JSON.stringify(products);
const DATA = {
  products,
  isV2Reference: product => product.recordModel === 'v2',
  materializedSku: (product, size) => product.codes[size],
  resolveProductSizes: product => ({ sizes: product.sizes || [] }),
};
const sandbox = {
  window: { DATA },
  React: { createElement() {}, useRef() {}, useEffect() {} },
  document: { createElement() { return {}; } },
  console,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('balam/barcodes.jsx', 'utf8'), sandbox);
const B = sandbox.window.BARCODES;

check('la etiqueta V1 conserva literalmente sus guiones',
  B.codeOf(products[0], '38') === '21-ML-ALG-38-128', B.codeOf(products[0], '38'));
check('la lectura exacta con guiones sigue resolviendo la pieza',
  B.resolve('21-ML-ALG-38-128').hit?.p?.id === 'h126-v1-dash');

const substituted = B.resolve("21'ML'ALG'38'128");
check('la lectura HID con apóstrofes resuelve el código equivalente con guiones',
  substituted.ok === true, substituted.code || 'sin resultado');
check('la adaptación devuelve la misma pieza y talla física',
  substituted.hit?.p?.id === 'h126-v1-dash' && substituted.hit?.talla === '38',
  JSON.stringify(substituted.hit || null));
check('find comparte la adaptación usada por Préstamos',
  B.find("21'ML'ALG'38'128")?.p?.id === 'h126-v1-dash');

check('un código real con apóstrofe conserva prioridad exacta',
  B.resolve("ESPECIAL'M").hit?.p?.id === 'h126-v1-apostrophe');
check('barcode_code V2 conserva su resolución exacta',
  B.resolve('B0123456789ABCDE').hit?.p?.id === products[2].id);
check('resolver lecturas no altera productos, SKU, códigos ni existencias',
  JSON.stringify(products) === snapshot);

console.log(`\nH-126 lector/teclado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed ? 1 : 0);
