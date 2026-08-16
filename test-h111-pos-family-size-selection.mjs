// H-111 · contrato A–C del selector comercial por talla en POS.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const posSource = read('./balam/pos.jsx');
let pass = 0, fail = 0;
const ok = (name, value) => { console.log(`${value ? '✅' : '❌'} ${name}`); value ? pass++ : fail++; };

function runtime() {
  const mem = new Map(); let n = 0; const noop = () => {};
  const localStorage = { getItem: key => mem.get(key) || null, setItem: (key, value) => mem.set(key, String(value)), removeItem: key => mem.delete(key) };
  const sandbox = { console, localStorage, Date, setTimeout, clearTimeout, JSON, Math, Object, Array, String, Number, Boolean, isNaN, parseInt, parseFloat, RegExp, Error, Set, Map, Promise, CustomEvent: class {} };
  sandbox.window = { localStorage, dispatchEvent: noop, addEventListener: noop, removeEventListener: noop, CORE: { catalogProducts: () => [], saveCatalogProducts: noop, registerCatalogProducts: noop, registerSyncGateway: noop, invokeSync: noop, getDeviceId: () => 'h111' }, UI: { toast: noop }, crypto: { randomUUID: () => `${(++n).toString(16).padStart(8, '0')}-0000-4000-8000-000000000111` } };
  sandbox.globalThis = sandbox; vm.createContext(sandbox);
  vm.runInContext(read('./balam/config.jsx'), sandbox); vm.runInContext(read('./balam/data.jsx'), sandbox);
  return sandbox.window.DATA;
}

const D = runtime();
function family(id, specs) {
  const rows = [];
  for (const spec of specs) rows.push(D.createReference({
    referenceFamilyId: id, cat: '1', modelo: 'VIC', nombre: spec.name || 'H111 V2', manga: 'ML',
    tela: 'ALG', color: 'BL', cuello: 'TRA', orn: 'BEL', sizeCategoryId: 'size_number',
    sizeCode: spec.size, sizeScale: 'N', stockQuantity: spec.stock, precio: spec.price,
    ornamentColorCodes: [spec.color], attrs: { producto: 'VIC', corte: '-', caracteristicas: '66' },
  }, rows));
  return D.referenceFamilyProjection(id, rows);
}

const simple = family('11100000-0000-4000-8000-000000000001', [
  { size: '38', stock: 4, price: 1150, color: 'DRO' },
  { size: '40', stock: 3, price: 1250, color: 'DRO' },
]);
const complex = family('11100000-0000-4000-8000-000000000002', [
  { size: '40', stock: 3, price: 1150, color: 'DRO' },
  { size: '40', stock: 2, price: 1250, color: 'AZL' },
  { size: '40', stock: 0, price: 1350, color: 'NEG' },
]);

ok('A1. V1 conserva el modal compacto existente', /function SizeModal[\s\S]*resolveProductSizes\(p\)/.test(posSource));
ok('A2. V1 conserva selección por talla y producto exacto', /onPick\(p, size\.value\)/.test(posSource));
ok('B1. V2 simple proyecta tallas y stock positivo', simple.availableSizes.length === 2 && simple.availableSizes[0].stock === 4 && simple.availableSizes[1].stock === 3);
ok('B2. POS familiar entra por el selector comercial de talla', !/sizePick\.isFamilyProjection[\s\S]{0,180}ReferenceFamilyPicker/.test(posSource) && /family-size-pick-/.test(posSource));
ok('B3. talla simple entrega la única referencia exacta', /availableReferences\.length === 1[\s\S]{0,240}onPick\(availableReferences\[0\]/.test(posSource));
ok('C1. talla 40 agrega sólo stock positivo 3 + 2', complex.availableSizes.length === 1 && complex.availableSizes[0].stock === 5);
ok('C2. talla compleja abre “Selecciona variante”', /Selecciona variante/.test(posSource) && /family-variant-pick-/.test(posSource));
ok('C3. variantes usan atributos humanos y entregan products.id exacto', /humanCatalogValue[\s\S]*CONFIG\.find/.test(posSource) && /onPick\(reference, reference\.sizeCode\)/.test(posSource));
ok('C4. POS no resuelve una venta familiar por SKU', !/find[^\n]+sku|family\s*\[\s*0\s*\]/i.test(posSource));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
