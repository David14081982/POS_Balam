// H-130 · La adaptación HID debe ocurrir antes de presentar o acumular la tecla.
// No cambia identidades: una tecla Quote real y los códigos persistidos quedan intactos.
import fs from 'node:fs';
import vm from 'node:vm';

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? passed++ : failed++;
};

const products = [{
  id: 'h130-v1', recordModel: 'v1',
  codes: { '38': '21-ML-ALG-38-128' },
  sizes: [{ value: '38', active: true, stock: 2 }],
}];
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

check('existe una autoridad compartida para la tecla del lector', typeof B.scannerChar === 'function');
check('Minus interpretado como apóstrofe se presenta como guion',
  typeof B.scannerChar === 'function' && B.scannerChar({ key: "'", code: 'Minus' }) === '-');
check('un guion ya correcto permanece igual',
  typeof B.scannerChar === 'function' && B.scannerChar({ key: '-', code: 'Minus' }) === '-');
check('una tecla Quote real conserva el apóstrofe literal',
  typeof B.scannerChar === 'function' && B.scannerChar({ key: "'", code: 'Quote' }) === "'");

let committed = null;
let prevented = false;
const target = { value: '21-ML', selectionStart: 2, selectionEnd: 5 };
const consumed = typeof B.consumeScannerInputKey === 'function' && B.consumeScannerInputKey({
  key: "'", code: 'Minus', target,
  preventDefault() { prevented = true; },
}, value => { committed = value; });
check('la entrada consume la tecla incompatible antes del valor visible', consumed === true && prevented === true);
check('la sustitución respeta selección y escribe un guion', committed === '21-', String(committed));
check('la corrección no altera producto, SKU, código ni stock', JSON.stringify(products) === snapshot);

console.log(`\nH-130 autoridad HID visible: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed ? 1 : 0);
