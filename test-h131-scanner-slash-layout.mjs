// H-131 · Un lector HID configurado como teclado US puede entregar la posición
// física Slash como "-" bajo la distribución de Windows. La adaptación debe
// preservar el símbolo comercial R/P y resolver cada identidad V1 exacta.
import fs from 'node:fs';
import vm from 'node:vm';

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? passed++ : failed++;
};

const baseSkus = [
  '5-PA1---R/P-NA-CAR-T',
  '5-PGO8---R/P-NA-GRSO-T',
  '5-PB2---R/P-NA-BG-T',
  '5-PAB9---R/P-NA-ABT-T',
  '5-PAM13---R/P-NA-AMAR-T',
  '5-PN14---R/P-NA-NEG-T',
  '5-PKC3---R/P-NA-CCAP-T',
  '5-PCO4---R/P-NA-COSC-T',
  '1-PPC5---R/P-NA-PLTC-T',
  '5-PVC10---R/P-NA-VCLA-T',
  '5-PVBC11---R/P-NA-VBOC-T',
  '5-PVB012---R/P-NA-VBOO-T',
  '5-PGC7---R/P-NA-GRSC-T',
  '5-PPO6---R/P-NA-PLTO-T',
];

function materialize(base, size = '34') {
  const tokens = base.split('-').filter(Boolean);
  return tokens.map(token => token === 'T' ? size : token).join('-');
}

const products = baseSkus.map((base, index) => ({
  id: `h131-${index + 1}`,
  recordModel: 'v1',
  base,
  codes: { '34': materialize(base) },
  sizes: [{ value: '34', active: true, stock: 1 }],
}));
const snapshot = JSON.stringify(products);
const DATA = {
  products,
  isV2Reference: product => product.recordModel === 'v2',
  materializedSku: (product, size) => product.codes[size],
  resolveProductSizes: product => ({ sizes: product.sizes || [] }),
};
const sandbox = {
  window: { DATA, requestAnimationFrame: callback => callback() },
  React: { createElement() {}, useRef() {}, useEffect() {} },
  document: { createElement() { return {}; } },
  console,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('balam/barcodes.jsx', 'utf8'), sandbox);
const B = sandbox.window.BARCODES;

check('conserva H-130: Minus interpretado como apóstrofe produce guion',
  B.scannerChar({ key: "'", code: 'Minus' }) === '-');
check('conserva un apóstrofe físico real',
  B.scannerChar({ key: "'", code: 'Quote' }) === "'");
check('conserva una diagonal ya interpretada correctamente',
  B.scannerChar({ key: '/', code: 'Slash' }) === '/');
check('conserva un guion ya interpretado correctamente',
  B.scannerChar({ key: '-', code: 'Minus' }) === '-');
check('Slash interpretado por Windows como guion recupera la diagonal',
  B.scannerChar({ key: '-', code: 'Slash' }) === '/');
check('la ruta heredada keyCode 191 recupera la diagonal cuando falta code',
  B.scannerChar({ key: '-', keyCode: 191 }) === '/');
check('una combinación modificada no se reinterpreta',
  B.scannerChar({ key: '-', code: 'Slash', ctrlKey: true }) === '-');

let committed = null;
let prevented = false;
const target = { value: 'R', selectionStart: 1, selectionEnd: 1, setSelectionRange() {} };
const consumed = B.consumeScannerInputKey({
  key: '-', code: 'Slash', target,
  preventDefault() { prevented = true; },
}, value => { committed = value; });
check('la entrada directa muestra R/ antes de resolver',
  consumed && prevented && committed === 'R/', JSON.stringify({ consumed, prevented, committed }));

function scannerEvent(char) {
  if (char === '-') return { key: "'", code: 'Minus' };
  if (char === '/') return { key: '-', code: 'Slash' };
  return { key: char, code: /^[A-Z]$/.test(char) ? `Key${char}` : /^\d$/.test(char) ? `Digit${char}` : '' };
}

for (const product of products) {
  const expected = product.codes['34'];
  const received = Array.from(expected).map(char => scannerEvent(char).key).join('');
  const canonical = Array.from(expected).map(char => B.scannerChar(scannerEvent(char))).join('');
  const result = B.resolve(canonical);
  check(`${product.base} conserva R/P y resuelve la talla 34 exacta`,
    canonical === expected && result.ok && result.hit.productId === product.id && result.hit.talla === '34',
    JSON.stringify({ received, canonical, result: result.code || result.hit?.productId }));
}

check('resolver las lecturas no altera SKU, productos ni existencias',
  JSON.stringify(products) === snapshot);

console.log(`\nH-131 Slash HID/R-P: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed ? 1 : 0);
