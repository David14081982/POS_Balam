// test-exchange-reports.mjs — H-51: reportes explicables del módulo Cambios.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b) => Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) <= 0.005;
const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const dataSrc = read('./balam/data.jsx');
const reportsSrc = read('./balam/reports.jsx');

function terminal() {
  const storage = new Map();
  const localStorage = {
    getItem: k => storage.has(k) ? storage.get(k) : null,
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
  };
  const settings = {
    'folio.prefix': 'BG', 'commission.base': 'bruto',
    'returns.limitEnabled': false, 'returns.limitDays': 15,
    'returns.reverseCommission': false, 'discount.minMarginPct': 0,
  };
  const CONFIG = {
    get: k => settings[k], map: () => ({}), metaMap: () => ({}),
    codes: k => k === 'size_letter' ? ['M', 'G'] : [],
    list: k => k === 'payment_method'
      ? [{ code: 'Efectivo' }, { code: 'Tarjeta' }, { code: 'Apartado' }]
      : [], all: () => [], find: () => null,
    catalogMeta: () => null, allCatalogMeta: () => ({}), catalogLabel: k => k, skuParts: null,
  };
  const CORE = {
    getDeviceId: () => 'terminal-h51', registerCatalogProducts: () => {},
    registerSyncGateway: () => {}, invokeSync: () => {},
  };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-07-29T10:00:00'])); }
    static now() { return new FakeDate().getTime(); }
  }
  const sandbox = {
    console, localStorage, Date: FakeDate, setTimeout, clearTimeout,
    JSON, Math, Object, Array, String, Number, Boolean, isNaN, parseInt,
    parseFloat, BigInt, RegExp, Error, Set, Map,
  };
  sandbox.window = {
    CONFIG, CORE, localStorage, UI: { toast: () => {} },
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dataSrc, sandbox);
  const D = sandbox.window.DATA;
  D.applyFolioBlock('BG', '260729', 1, 900);
  const p = {
    id: 'p1', sku: 'SKU-1', nombre: 'Guayabera', cat: 'GUA', manga: 'LAR',
    tela: 'LIN', color: 'BLA', cuello: 'NOR', modelo: '100', precio: 350,
    costo: 0, pop: false, orn: '—', ornColors: [], preciosTalla: { G: 450 },
    stock: [{ talla: 'M', escala: 'L', stock: 20 }, { talla: 'G', escala: 'L', stock: 20 }],
  };
  D.products.push(p);
  D.sellers.length = 0;
  D.sellers.push({
    id: 'v1', nombre: 'Ana', role: 'vendedor', active: true, authStatus: 'active',
    comisionPct: 10, comisionAcum: 0, ventasMes: 0, ventasNum: 0,
  });
  const sale = D.recordSale({
    ticket: [{ p, talla: 'M', qty: 1 }], sellerIds: ['v1'], client: null,
    metodo: 'Efectivo', metodoPago: 'Efectivo', estado: 'Pagado',
    total: 350, itemCount: 1, fecha: '2026-07-29 09:00',
  });
  const result = D.recordExchange({
    origenFolio: sale.folio, fecha: '2026-07-29 10:00',
    lineas: [
      { lado: 'devuelto', productId: 'p1', sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, motivo: 'Talla', condicion: 'Sin uso' },
      { lado: 'entregado', productId: 'p1', sku: 'SKU-1', nombre: 'Guayabera', talla: 'G', qty: 1 },
    ],
    usuario: 'admin@balam.mx', vendedorId: 'v1', revisadoPor: 'Admin',
    metodoPago: 'Efectivo', notas: 'Cliente pidió talla mayor',
  });
  return { D, sale, exchange: result.exchange };
}

console.log('\n── A) Autoridades de reporte ────────────────────────────');
{
  const { D } = terminal();
  ok('1. conserva la autoridad del valor no aprovechado', typeof D.exchangeUnusedValue === 'function');
  ok('2. conserva la autoridad del ingreso por cambios', typeof D.exchangeRevenue === 'function');
  ok('3. existe la proyección de ventas cambiadas', typeof D.exchangeReport === 'function');
  ok('4. existe la proyección de comisiones por origen', typeof D.sellerCommissionReport === 'function');
}

console.log('\n── B) Venta cambiada explicable ─────────────────────────');
{
  const { D, sale, exchange } = terminal();
  const rows = typeof D.exchangeReport === 'function' ? D.exchangeReport() : [];
  const r = rows[0] || {};
  ok('5. devuelve el cambio registrado', rows.length === 1);
  ok('6. identifica la venta origen', r.origenFolio === sale.folio);
  ok('7. identifica el folio propio del cambio', r.folio === exchange.folio);
  ok('8. conserva quién atendió y quién revisó', r.vendedor === 'Ana' && r.revisadoPor === 'Admin');
  ok('9. separa lo devuelto', Array.isArray(r.devueltos) && r.devueltos.length === 1);
  ok('10. separa lo entregado', Array.isArray(r.entregados) && r.entregados.length === 1);
  ok('11. expone cantidades, talla y motivo',
    r.devueltos && r.devueltos[0].qty === 1 && r.devueltos[0].talla === 'M' && r.devueltos[0].motivo === 'Talla');
  ok('12. aplica el filtro al documento completo',
    typeof D.exchangeReport === 'function' && D.exchangeReport(() => false).length === 0);
}

console.log('\n── C) Comisión con origen ───────────────────────────────');
{
  const { D, sale, exchange } = terminal();
  const rows = typeof D.sellerCommissionReport === 'function' ? D.sellerCommissionReport() : [];
  const ana = rows.find(r => r.vendedorId === 'v1') || {};
  ok('13. presenta al vendedor elegible', ana.vendedor === 'Ana');
  ok('14. separa comisión de ventas', near(ana.ventas, sale.comision), 'ventas=' + ana.ventas);
  ok('15. separa comisión de excedentes', near(ana.cambios, exchange.comisionMonto), 'cambios=' + ana.cambios);
  ok('16. el total es la suma de ambos orígenes', near(ana.total, Number(ana.ventas) + Number(ana.cambios)));
  ok('17. excluir el cambio elimina sólo ese origen',
    (() => {
      const rr = typeof D.sellerCommissionReport === 'function'
        ? D.sellerCommissionReport(doc => doc.fecha === sale.fecha) : [];
      const x = rr.find(r => r.vendedorId === 'v1') || {};
      return near(x.ventas, sale.comision) && near(x.cambios, 0);
    })());
}

console.log('\n── D) Valor no aprovechado ──────────────────────────────');
{
  const { D } = terminal();
  ok('18. un cambio al alza no registra valor perdido', near(D.exchangeUnusedValue(), 0));
  D.exchanges.push({ id: 'baja', fecha: '2026-07-29 11:00', valorNoAprovechado: 75, diferencia: 0, lineas: [] });
  ok('19. totaliza el valor perdido', near(D.exchangeUnusedValue(), 75));
  ok('20. el filtro puede excluirlo', near(D.exchangeUnusedValue(() => false), 0));
}

console.log('\n── E) Pantalla con contratos estables ───────────────────');
ok('21. la pestaña Cambios tiene data-testid',
  /['"]data-testid['"]/.test(reportsSrc) && /['"]reports-tab-exchanges['"]/.test(reportsSrc));
ok('22. el historial tiene contrato estable', /['"]data-testid['"]:\s*['"]exchange-history-report['"]/.test(reportsSrc));
ok('23. el desglose de comisiones tiene contrato estable', /['"]data-testid['"]:\s*['"]exchange-commission-report['"]/.test(reportsSrc));
ok('24. el valor no aprovechado consume su autoridad',
  /exchangeUnusedValue\(/.test(reportsSrc) && /['"]data-testid['"]:\s*['"]exchange-unused-report['"]/.test(reportsSrc));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
