// H-104 · contrato A–H del SKU visual familiar en Inventario.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (name, value) => { console.log(`${value ? '✅' : '❌'} ${name}`); value ? pass++ : fail++; };

function runtime() {
  const mem = new Map(); let n = 0; const noop = () => {};
  const localStorage = { getItem: key => mem.get(key) || null, setItem: (key, value) => mem.set(key, String(value)), removeItem: key => mem.delete(key) };
  const s = { console, localStorage, Date, setTimeout, clearTimeout, JSON, Math, Object, Array, String, Number, Boolean, isNaN, parseInt, parseFloat, RegExp, Error, Set, Map, Promise, CustomEvent: class {} };
  s.window = { localStorage, dispatchEvent: noop, addEventListener: noop, removeEventListener: noop, CORE: { catalogProducts: () => [], saveCatalogProducts: noop, registerCatalogProducts: noop, registerSyncGateway: noop, invokeSync: noop, getDeviceId: () => 'h104' }, UI: { toast: noop }, crypto: { randomUUID: () => `${(++n).toString(16).padStart(8, '0')}-0000-4000-8000-000000000104` } };
  s.globalThis = s; vm.createContext(s); vm.runInContext(read('./balam/config.jsx'), s); vm.runInContext(read('./balam/data.jsx'), s); return s.window.DATA;
}

const DATA = runtime();
const visual = typeof DATA.familyVisualSku === 'function' ? DATA.familyVisualSku : () => '';
let familySeq = 0;
const makeFamily = specs => {
  const familyId = `10400000-0000-4000-8000-${(++familySeq).toString().padStart(12, '0')}`;
  const rows = [];
  for (const spec of specs) rows.push(DATA.createReference({
    referenceFamilyId: familyId, cat: '1', modelo: 'VIC', nombre: 'VICTOR', manga: 'ML',
    tela: spec.tela || 'ALG', color: 'BL', cuello: 'TRA', orn: 'BEL',
    sizeCategoryId: 'size_number', sizeCode: spec.size, sizeScale: 'N',
    stockQuantity: spec.stock, precio: 1250, ornamentColorCodes: [spec.color],
    attrs: { producto: 'VIC', corte: '-', caracteristicas: '66' },
  }, rows));
  return DATA.referenceFamilyProjection(familyId, rows);
};

const A = makeFamily([{ size: '40', color: 'DRO', stock: 3 }]);
ok('A. una referencia disponible conserva su SKU real', visual(A) === A.availableReferences[0].sku);
const B = makeFamily([{ size: '38', color: 'DRO', stock: 2 }, { size: '40', color: 'DRO', stock: 3 }, { size: '42', color: 'DRO', stock: 1 }]);
ok('B. varias tallas sustituyen sólo talla por T', visual(B).endsWith('-DRO-T') && !visual(B).includes('[VAR]'));
const C = makeFamily([{ size: '40', color: 'DRO', stock: 3 }, { size: '40', color: 'AZL', stock: 2 }]);
ok('C. misma talla con colores distintos usa VAR, no T', visual(C).includes('-[VAR]-40') && !visual(C).endsWith('-T'));
const Dcase = makeFamily([{ size: '40', color: 'DRO', stock: 3 }, { size: '42', color: 'AZL', stock: 2 }]);
ok('D. color y talla distintos producen VAR y T', visual(Dcase).includes('-[VAR]-T'));
const E = makeFamily([{ size: '40', color: 'DRO', tela: 'LIN', stock: 1 }, { size: '40', color: 'AZL', tela: 'ALG', stock: 1 }]);
ok('E. dos segmentos variables conservan dos VAR y talla común', (visual(E).match(/\[VAR\]/g) || []).length === 2 && visual(E).endsWith('-40'));
const F = makeFamily([{ size: '38', color: 'DRO', tela: 'LIN', stock: 1 }, { size: '42', color: 'AZL', tela: 'ALG', stock: 1 }]);
ok('F. material/color/talla variables producen dos VAR y T', (visual(F).match(/\[VAR\]/g) || []).length === 2 && visual(F).endsWith('-T'));
const G = makeFamily([{ size: '38', color: 'DRO', stock: 2 }, { size: '40', color: 'AZL', stock: 0 }]);
ok('G. referencias agotadas no participan', visual(G) === G.availableReferences[0].sku);
const legacy = { recordModel: 'v1', sku: '1-ML-ALG-BL-007' };
ok('H. V1 conserva exactamente su SKU', visual(legacy) === legacy.sku);

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
