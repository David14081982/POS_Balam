// H-90 · metadatos de origen y salida térmica del reporte por método.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
};
const source = readFileSync(new URL('./balam/data.jsx', import.meta.url), 'utf8');
const reportsSource = readFileSync(new URL('./balam/reports.jsx', import.meta.url), 'utf8');
const baselineSource = execFileSync('git', ['show', '700faaae879b38c60d551082ec02e1f53141858e:balam/data.jsx'], { encoding: 'utf8' });

function terminal(dataSource) {
  const storage = new Map();
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key), clear: () => storage.clear(),
  };
  const methods = [
    { code: 'Efectivo', label: 'Efectivo', active: true },
    { code: 'Tarjeta', label: 'Tarjeta', active: true },
    { code: 'Transferencia', label: 'Transferencia', active: true },
    { code: 'MP', label: 'Mercado Pago Empresarial con nombre extraordinariamente largo', active: true },
  ];
  const CONFIG = {
    get: () => null,
    list: kind => kind === 'payment_method' ? methods : [],
    all: kind => kind === 'payment_method' ? methods : [],
    find: (kind, code) => kind === 'payment_method' ? methods.find(item => item.code === code) || null : null,
    codes: kind => kind === 'payment_method' ? methods.map(item => item.code) : [],
    map: () => ({}), metaMap: () => ({}), catalogMeta: () => null,
    allCatalogMeta: () => ({}), catalogLabel: key => key,
  };
  const sandbox = {
    console, localStorage, Date, setTimeout, clearTimeout, JSON, Math, Object, Array,
    String, Number, Boolean, isNaN, parseInt, parseFloat, BigInt, RegExp, Error, Set, Map,
  };
  sandbox.window = {
    CONFIG, localStorage, UI: { toast: () => {} },
    CORE: {
      getDeviceId: () => 'h90-ticket', registerCatalogProducts: () => {},
      registerCatalogPromotions: () => {}, registerMonetaryDocuments: () => {},
      registerSyncGateway: () => {}, invokeSync: () => {},
    },
    addEventListener: () => {}, dispatchEvent: () => true,
    crypto: { randomUUID: () => 'uuid-h90-ticket' },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dataSource, sandbox);
  return sandbox.window.DATA;
}

function seed(D) {
  const part = (methodCode, methodLabel, amount) => ({ methodCode, methodLabel, amount });
  D.payments.length = 0; D.returns.length = 0; D.sales.length = 0; D.exchanges.length = 0;
  D.payments.push(
    { id: 'sale-mixed', folio: 'V-1', fecha: '2026-08-09 09:00', tipo: 'venta', metodo: 'Mixto', monto: 1000,
      components: [part('Efectivo', 'Efectivo', 300), part('Tarjeta', 'Tarjeta', 700)] },
    { id: 'layaway-deposit', folio: 'A-1', fecha: '2026-08-09 10:00', tipo: 'anticipo', metodo: 'Tarjeta', monto: 200,
      components: [part('Tarjeta', 'Tarjeta', 200)] },
    { id: 'layaway-payment', folio: 'A-1', fecha: '2026-08-09 11:00', tipo: 'abono', metodo: 'Efectivo', monto: 300,
      components: [part('Efectivo', 'Efectivo', 300)] },
    { id: 'layaway-settlement', folio: 'A-1', fecha: '2026-08-09 12:00', tipo: 'liquidacion', metodo: 'Transferencia', monto: 500,
      components: [part('Transferencia', 'Transferencia', 500)] },
    { id: 'exchange-positive', folio: 'C-1', fecha: '2026-08-09 13:00', tipo: 'cambio', metodo: 'Mixto', monto: 250,
      components: [part('Efectivo', 'Efectivo', 50), part('MP', 'Mercado Pago Empresarial con nombre extraordinariamente largo', 200)] },
  );
  D.returns.push({ id: 'return-1', folio: 'V-1', fecha: '2026-08-09 14:00', total: 100, metodo: 'Tarjeta',
    components: [part('Tarjeta', 'Tarjeta', 100)] });
  D.sales.push({ id: 'courtesy-1', folio: 'K-1', fecha: '2026-08-09 15:00', metodo: 'Cortesía', total: 0 });
  // Cambio sin diferencia, cambio con valor no aprovechado y un reintento del
  // documento no crean una segunda fila monetaria H-90.
  D.exchanges.push(
    { id: 'exchange-zero', fecha: '2026-08-09 16:00', diferencia: 0, valorNoAprovechado: 0 },
    { id: 'exchange-unused', fecha: '2026-08-09 17:00', diferencia: -300, valorNoAprovechado: 300 },
    { id: 'exchange-positive', fecha: '2026-08-09 13:00', diferencia: 250, valorNoAprovechado: 0 },
    { id: 'exchange-positive', fecha: '2026-08-09 13:00', diferencia: 250, valorNoAprovechado: 0 },
  );
}

const legacy = terminal(baselineSource);
const current = terminal(source);
seed(legacy); seed(current);
const options = { from: '2026-08-09', to: '2026-08-09' };
const before = legacy.paymentMethodReport(options);
const after = current.paymentMethodReport(options);
const monetary = report => ({
  from: report.from, to: report.to, entries: report.entries, refunds: report.refunds,
  net: report.net, methods: report.methods, principal: report.principal,
  courtesies: report.courtesies, undistributed: report.undistributed,
  undistributedEntries: report.undistributedEntries,
  undistributedRefunds: report.undistributedRefunds,
  reconciliation: report.reconciliation,
});

console.log('\n── A) Compatibilidad monetaria H-90 ──');
check('1. todas las cifras monetarias son idénticas antes/después',
  JSON.stringify(monetary(after)) === JSON.stringify(monetary(before)));
check('2. methods permanece idéntico, incluido Mixto distribuido',
  JSON.stringify(after.methods) === JSON.stringify(before.methods));
check('3. conciliación permanece idéntica',
  JSON.stringify(after.reconciliation) === JSON.stringify(before.reconciliation));
check('4. sólo aparecen los tres campos raíz nuevos', (() => {
  const prior = new Set(Object.keys(before));
  return Object.keys(after).filter(key => !prior.has(key)).sort().join(',') === 'exchangeEntries,operations,origins';
})(), Object.keys(after).join(','));

console.log('\n── B) Operaciones y orígenes ──');
check('5. venta simple/mixta cuenta una sola operación', after.origins && after.origins.sales === 1);
check('6. anticipo + abono + liquidación son tres movimientos de apartado', after.origins && after.origins.layaways === 3);
check('7. diferencia positiva cuenta un cambio monetario', after.origins && after.origins.exchanges === 1);
check('8. cambio cero y valor no aprovechado no crean operación monetaria', after.origins && after.origins.exchanges === 1);
check('9. devolución cuenta como origen sin aumentar entradas', after.origins && after.origins.returns === 1 && after.entries === 2250);
check('10. total usa documentos monetarios únicos, no métodos', after.operations === 6, String(after.operations));
check('11. reintento/reimpresión sin nueva fila monetaria no duplica', after.operations === 6 && after.origins.exchanges === 1);
check('12. exchangeEntries suma sólo pagos tipo cambio', after.exchangeEntries === 250, String(after.exchangeEntries));

console.log('\n── C) Contrato de presentación ──');
const paymentBody = reportsSource.slice(reportsSource.indexOf('function PaymentMethodReport'), reportsSource.indexOf('// ── Shell con pestañas'));
check('13. Reportes no lee colecciones monetarias directamente',
  !/D\.(payments|returns|exchanges|sales)\b/.test(paymentBody));
check('14. existe acción térmica estable', /payment-method-ticket/.test(reportsSource));
check('15. ticket usa 80 mm y no 60×40', /size\s*:\s*80mm\s+auto/.test(reportsSource) && !/60mm\s+40mm/.test(paymentBody));
check('16. ticket no autoimprime ni se autocierra', !/onload[^\n]*(print|close)/i.test(paymentBody));
check('17. pantalla, A4 y ticket parten de un snapshot H-90 compartido', /paymentMethodReportView/.test(paymentBody));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
