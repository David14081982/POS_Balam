// H-90 · Autoridad monetaria dinámica y reporte conciliable.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b) => Math.abs(Number(a) - Number(b)) <= 0.005;
const source = readFileSync(new URL('./balam/data.jsx', import.meta.url), 'utf8');
const storeSource = readFileSync(new URL('./balam/store.jsx', import.meta.url), 'utf8');
const reportSource = readFileSync(new URL('./balam/reports.jsx', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('./supabase/migrations/20260809013000_pos_h90_dynamic_money_components.sql', import.meta.url), 'utf8');
const guardMigrationSource = readFileSync(new URL('./supabase/migrations/20260809013200_pos_h90_money_components_guard.sql', import.meta.url), 'utf8');

function terminal() {
  const storage = new Map();
  const localStorage = {
    getItem: k => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k), clear: () => storage.clear(),
  };
  const methods = [
    { code: 'Efectivo', label: 'Efectivo', active: true },
    { code: 'Tarjeta', label: 'Tarjeta', active: true },
    { code: 'Transferencia', label: 'Transferencia', active: true },
    { code: 'Mixto', label: 'Mixto', active: true },
    { code: 'Apartado', label: 'Apartado', active: true },
    { code: 'Cortesía', label: 'Cortesía', active: true },
    { code: 'MP', label: 'Mercado Pago', active: true },
  ];
  const CONFIG = {
    get: key => ({ 'folio.prefix': 'BG', 'commission.base': 'neto', 'commission.basePct': 0,
      'returns.reverseCommission': false, 'returns.limitEnabled': false, 'returns.limitDays': 15 }[key]),
    list: kind => kind === 'payment_method' ? methods.filter(x => x.active !== false) : kind === 'return_reason' ? [{ code: 'Talla' }] : [],
    all: kind => kind === 'payment_method' ? methods : [],
    find: (kind, code) => kind === 'payment_method' ? methods.find(x => x.code === code) || null : null,
    codes: kind => kind === 'payment_method' ? methods.filter(x => x.active !== false).map(x => x.code) : [],
    map: () => ({}), metaMap: () => ({}), catalogMeta: () => null, allCatalogMeta: () => ({}), catalogLabel: k => k,
  };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-08-09T10:00:00'])); }
    static now() { return new FakeDate().getTime(); }
  }
  const sandbox = { console, localStorage, Date: FakeDate, setTimeout, clearTimeout, JSON, Math, Object, Array,
    String, Number, Boolean, isNaN, parseInt, parseFloat, BigInt, RegExp, Error, Set, Map };
  sandbox.window = { CONFIG, CORE: { getDeviceId: () => 'h90', registerCatalogProducts: () => {}, registerSyncGateway: () => {}, invokeSync: () => {} },
    UI: { toast: () => {} }, localStorage, addEventListener: () => {}, dispatchEvent: () => true,
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const D = sandbox.window.DATA;
  D.applyFolioBlock('BG', '260809', 1, 99);
  const product = { id: 'p-h90', sku: 'H90', nombre: 'Prenda', precio: 500, costo: 0, cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo: 'H90', orn: '—', stock: [{ talla: 'M', escala: 'L', stock: 10 }] };
  D.products.push(product);
  D.sellers.length = 0; D.sellers.push({ id: 'v1', nombre: 'Vendedor', role: 'vendedor', active: true, comisionPct: 0, ventasMes: 0, ventasNum: 0, comisionAcum: 0 });
  return { D, methods, product };
}

console.log('\n── A) Componentes dinámicos ──');
const t = terminal();
const sale = t.D.recordSale({ ticket: [{ p: t.product, talla: 'M', qty: 3 }], sellerIds: ['v1'], client: null,
  metodo: 'Mixto', estado: 'Pagado', total: 1500, itemCount: 3, pagoEfectivo: 300, pagoOtro: 1200,
  pagoDetalle: [
    { methodCode: 'Efectivo', methodLabel: 'Efectivo', amount: 300 },
    { methodCode: 'Tarjeta', methodLabel: 'Tarjeta', amount: 500 },
    { methodCode: 'MP', methodLabel: 'Mercado Pago', amount: 400 },
    { methodCode: 'Transferencia', methodLabel: 'Transferencia', amount: 300 },
  ] });
const payment = t.D.paymentsForSale(sale.folio)[0];
ok('1. el pago congela cuatro componentes', payment && payment.components && payment.components.length === 4, JSON.stringify(payment && payment.components));
ok('2. Mixto no recibe dinero como destino', !(payment.components || []).some(x => x.methodCode === 'Mixto'));

console.log('\n── B) Reporte y snapshot ──');
let report = t.D.paymentMethodReport({ from: '2026-08-09', to: '2026-08-09' });
const by = code => (report.methods || []).find(x => x.methodCode === code) || {};
ok('3. efectivo exacto', near(by('Efectivo').entries, 300));
ok('4. tarjeta exacta', near(by('Tarjeta').entries, 500));
ok('5. método configurable exacto', near(by('MP').entries, 400) && by('MP').methodLabel === 'Mercado Pago');
ok('6. transferencia exacta', near(by('Transferencia').entries, 300));
ok('7. conciliación exacta', report.reconciliation && report.reconciliation.ok && near(report.net, 1500));
t.methods.find(x => x.code === 'MP').label = 'Billetera renombrada';
report = t.D.paymentMethodReport({ from: '2026-08-09', to: '2026-08-09' });
ok('8. renombrar CONFIG no altera historia', ((report.methods || []).find(x => x.methodCode === 'MP') || {}).methodLabel === 'Mercado Pago');

console.log('\n── C) Devolución por salida real ──');
const ret = t.D.recordReturn({ folio: sale.folio,
  lineas: [{ sku: 'H90', nombre: 'Prenda', talla: 'M', qty: 1, motivo: 'Talla', precio: 500 }],
  metodo: 'Mixto', refundComponents: [
    { methodCode: 'Efectivo', methodLabel: 'Efectivo', amount: 200 },
    { methodCode: 'Tarjeta', methodLabel: 'Tarjeta', amount: 300 },
  ] });
ok('9. devolución congela componentes', ret.ok && ret.ret.components && ret.ret.components.length === 2);
report = t.D.paymentMethodReport({ from: '2026-08-09', to: '2026-08-09' });
ok('10. efectivo resta 200', near(by.call(null, 'Efectivo').entries || 0, 300) && near(((report.methods || []).find(x => x.methodCode === 'Efectivo') || {}).refunds, 200));
ok('11. tarjeta resta 300', near(((report.methods || []).find(x => x.methodCode === 'Tarjeta') || {}).refunds, 300));
ok('12. neto conciliado después del reembolso', report.reconciliation.ok && near(report.net, 1000));
const sameDistribution = t.D.sameMethodRefundComponents(sale, 500);
ok('12a. “Mismo método” reparte sobre evidencia exacta y conserva centavos', sameDistribution
  && sameDistribution.length === 4 && near(sameDistribution.reduce((sum, part) => sum + part.amount, 0), 500));
{
  const x = terminal();
  const s = x.D.recordSale({ ticket: [{ p: x.product, talla: 'M', qty: 1 }], sellerIds: ['v1'], client: null,
    metodo: 'Efectivo', estado: 'Pagado', total: 500, itemCount: 1 });
  const stockBefore = x.D.stockOf(x.product, 'M');
  const rejected = x.D.recordReturn({ folio: s.folio,
    lineas: [{ sku: 'H90', nombre: 'Prenda', talla: 'M', qty: 1, motivo: 'Talla', precio: 500 }],
    metodo: 'Mixto', refundComponents: [{ methodCode: 'Efectivo', amount: 200 }, { methodCode: 'Tarjeta', amount: 299 }] });
  ok('12b. reembolso descuadrado falla antes de cualquier efecto', !rejected.ok
    && x.D.stockOf(x.product, 'M') === stockBefore && s.estado === 'Pagado' && x.D.returns.length === 0);
}

console.log('\n── D) Compatibilidad histórica prudente ──');
t.D.payments.push({ id: 'legacy-paypal', folio: 'LEG-1', fecha: '2026-08-09 11:00', tipo: 'venta', metodo: 'PayPal', monto: 100, efectivo: 0, tarjeta: 0, transferencia: 0, otro: 100 });
t.D.payments.push({ id: 'legacy-mixed', folio: 'LEG-2', fecha: '2026-08-09 12:00', tipo: 'venta', metodo: 'Mixto', monto: 100, efectivo: 40, tarjeta: 0, transferencia: 0, otro: 60 });
report = t.D.paymentMethodReport({ from: '2026-08-09', to: '2026-08-09' });
ok('13. pago simple otro conserva identidad inequívoca', near(((report.methods || []).find(x => x.methodCode === 'PayPal') || {}).entries, 100));
ok('14. bolsa otro de mixto queda sin distribución', near(report.undistributed, 60));
ok('15. la conciliación incluye lo no distribuido', report.reconciliation.ok && near(report.reconciliation.difference, 0));

console.log('\n── E) Persistencia, pantalla e impresión ──');
ok('16. Supabase agrega componentes sin reescribir historia', /add column if not exists components jsonb/i.test(migrationSource) && /components is null or/i.test(migrationSource));
ok('17. la base valida suma, identidad y etiqueta', /money_components_valid/.test(migrationSource) && /methodCode/.test(migrationSource) && /methodLabel/.test(migrationSource));
ok('17b. la base rechaza campos o tipos ausentes sin semántica NULL', /is distinct from 'number'/.test(guardMigrationSource) && /is distinct from 'object'/.test(guardMigrationSource));
ok('18. STORE transporta y recupera componentes', /moneyWireMethod\(p\.metodo, p\.components\)/.test(storeSource) && /r\.components/.test(storeSource));
ok('19. Reportes consume la autoridad única', /D\.paymentMethodReport\(\{ from, to \}\)/.test(reportSource));
ok('20. existe la salida A4 específica', /Reporte de ingresos por método de pago/.test(reportSource) && /payment-method-print/.test(reportSource));
ok('21. la conciliación pendiente queda visible', /Conciliación pendiente/.test(reportSource) && /payment-method-reconciliation/.test(reportSource));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
