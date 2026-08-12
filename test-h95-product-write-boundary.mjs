// H-95 · Frontera de escritura de productos.
// Ejecuta CONFIG/DATA reales. Verifica que invalidaciones y diagnósticos no
// concedan permiso implícito de escritura ni muten la semántica V1.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const coreSrc = read('./balam/core.jsx');
const configSrc = read('./balam/config.jsx');
const dataSrc = read('./balam/data.jsx');
const settingsSrc = read('./balam/settings.jsx');
let pass = 0, fail = 0;
function ok(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
}
const clone = value => JSON.parse(JSON.stringify(value));

function runtime(label) {
  const memory = new Map();
  const listeners = Object.create(null);
  const writes = [];
  const localStorage = {
    get length() { return memory.size; },
    key(index) { return [...memory.keys()][index] || null; },
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, String(value)); },
    removeItem(key) { memory.delete(key); },
    clear() { memory.clear(); },
  };
  const sandbox = {
    console, localStorage, Date, setTimeout, clearTimeout, JSON, Math, Object,
    Array, String, Number, Boolean, isNaN, parseInt, parseFloat, RegExp, Error,
    Set, Map, Promise,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  };
  sandbox.window = {
    localStorage,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter(item => item !== fn);
    },
    dispatchEvent(event) {
      (listeners[event.type] || []).slice().forEach(fn => fn(event));
      return true;
    },
    UI: { toast() {} },
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000095' },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(coreSrc, sandbox);
  vm.runInContext(configSrc, sandbox);
  const C = sandbox.window.CONFIG;
  const catalog = C.snapshot();
  catalog.catalogs.category = [
    { code: '1', label: 'Guayabera', active: true, meta: {} },
    { code: 'OLD', label: 'Guayabera', active: false, meta: {} },
  ];
  C.load(clone(catalog));
  const legacy = {
    id: `${label}-v1`, sku: `${label}-SKU`, recordModel: 'v1',
    cat: 'OLD', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
    modelo: 'LEG', nombre: 'LEGACY', orn: '—', ornColors: [],
    precio: 100, costo: 40, pop: false, stock: [], attrs: {},
    barcodeUrls: {}, preciosTalla: {},
  };
  localStorage.setItem('balam_pos_products_v2', JSON.stringify([legacy]));
  sandbox.window.CORE.registerSyncGateway({
    pushRows(kind, rows) {
      if (kind === 'products') writes.push({ kind, ids: (rows || []).map(row => row.id), rows: clone(rows || []) });
    },
    pushConfig() {},
  });
  vm.runInContext(dataSrc, sandbox);
  const D = sandbox.window.DATA;
  const startupWrites = clone(writes);
  writes.length = 0;
  const makeOrphan = () => {
    D.products[0].cat = 'OLD';
    writes.length = 0;
    return clone(D.products[0]);
  };
  return { sandbox, C, D, writes, startupWrites, catalog, makeOrphan };
}

const one = runtime('A');
ok('H. relevo/arranque de escritor produce 0 escrituras products', one.startupWrites.length === 0,
  JSON.stringify(one.startupWrites.map(write => write.ids)));

one.makeOrphan();
one.C.load(clone(one.catalog));
ok('C. CONFIG.load remoto produce 0 escrituras products', one.writes.length === 0);

one.makeOrphan();
one.sandbox.window.dispatchEvent(new one.sandbox.CustomEvent('configchange', { detail: { version: 95 } }));
ok('D. configchange produce 0 escrituras products', one.writes.length === 0);

one.makeOrphan();
one.sandbox.window.dispatchEvent(new one.sandbox.CustomEvent('configchange', { detail: { domain: 'config', realtime: true } }));
ok('E. invalidación Realtime CONFIG produce 0 escrituras products', one.writes.length === 0);

one.makeOrphan();
const remote = clone(one.D.products[0]);
one.D.applyRemote('products', [remote], { authoritative: true });
ok('F. pull autoritativo produce 0 escrituras products', one.writes.length === 0);

const beforeDiagnostic = one.makeOrphan();
const diagnostic = one.D.remapOrphanCodes();
ok('G. remapOrphanCodes detecta la reparación', diagnostic.fixed === 1,
  JSON.stringify(diagnostic.detail));
ok('G2. remapOrphanCodes produce 0 escrituras automáticas', one.writes.length === 0);
ok('G3. el diagnóstico no aplica la reparación', one.D.products[0].cat === beforeDiagnostic.cat);

const terminalA = runtime('TA');
const terminalB = runtime('TB');
terminalA.makeOrphan(); terminalB.makeOrphan();
terminalA.C.load(clone(terminalA.catalog));
terminalB.C.load(clone(terminalB.catalog));
ok('I. dos terminales reciben CONFIG sin write-back cruzado',
  terminalA.writes.length === 0 && terminalB.writes.length === 0);

const semantic = runtime('SEM');
const before = semantic.makeOrphan();
semantic.C.load(clone(semantic.catalog));
const after = clone(semantic.D.products[0]);
const keys = ['id','sku','cat','manga','tela','color','cuello','modelo','nombre','orn','ornColors','precio','costo','stock','attrs'];
const project = product => Object.fromEntries(keys.map(key => [key, product[key]]));
ok('L. V1 permanece semánticamente idéntico durante CONFIG/invalidez',
  JSON.stringify(project(before)) === JSON.stringify(project(after)),
  `${before.cat} → ${after.cat}`);

// La reparación administrativa debe ser una operación en dos fases: preview
// por ID concreto y aplicación de ESE plan después de confirmar en la UI.
ok('M. DATA publica preview administrativo separado de apply',
  typeof one.D.previewOrphanFix === 'function' && typeof one.D.applyOrphanFix === 'function');
if (typeof one.D.previewOrphanFix === 'function') {
  one.makeOrphan();
  const plan = one.D.previewOrphanFix(one.D.products[0].id, 'cat', 'OLD', '1');
  ok('M2. preview congela ID y cambio exactos sin mutar',
    plan.ok && plan.productId === one.D.products[0].id && plan.from === 'OLD'
      && plan.to === '1' && one.D.products[0].cat === 'OLD' && one.writes.length === 0);
  const legacyApply = one.D.applyOrphanFix(one.D.products[0].id, 'cat', 'OLD', '1');
  ok('M3. una aplicación sin plan de preview queda bloqueada',
    !legacyApply.ok && legacyApply.code === 'ORPHAN_FIX_PREVIEW_REQUIRED');
  const applied = one.D.applyOrphanFix(plan);
  ok('M4. aplicar el plan modifica exclusivamente el ID confirmado',
    applied.ok && one.D.products[0].cat === '1'
      && one.writes.length === 1
      && JSON.stringify(one.writes[0].ids) === JSON.stringify([one.D.products[0].id]));
}
ok('M5. Configuración exige confirmación visible entre preview y apply',
  /previewOrphanFix[\s\S]{0,600}window\.confirm[\s\S]{0,600}applyOrphanFix/.test(settingsSrc));

one.writes.length = 0;
one.D.persistProducts();
ok('N. persistProducts sólo actualiza almacenamiento local', one.writes.length === 0);

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
