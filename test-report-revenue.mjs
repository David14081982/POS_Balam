// test-report-revenue.mjs — H-49 (C7): el importe vendido cuadra con lo cobrado.
//
// Contrato bajo prueba, por decisión del dueño del 30/07/2026:
//
//   • La diferencia que un cliente paga en un cambio SÍ es ingreso: entrega un
//     producto de mayor valor. Suma al importe vendido.
//   • Pero NO es un pedido: no incrementa el conteo de ventas, no altera el
//     ticket promedio y no mueve las metas del equipo, porque proviene de una
//     operación que ya existía.
//   • El reporte muestra un renglón propio, «Diferencias cobradas por cambios»,
//     para que se vea de dónde viene ese ingreso.
//
// La aritmética del ingreso vive en UNA autoridad —`DATA.revenueSummary`— y no
// repartida por las pantallas: hoy la suma de ventas está escrita seis veces en
// `balam/*.jsx`, y añadir el cambio en una sola habría creado la séptima
// divergencia (`AP-01`, `ADR-003`).
//
// Uso: node test-report-revenue.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b) => Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) <= 0.005;
const read = (rel) => { try { return readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } };
const dataSrc = read('./balam/data.jsx');
const repSrc = read('./balam/reports.jsx');

const TALLAS = ['CH', 'M', 'G'];

function terminal() {
  const storage = new Map();
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k), clear: () => storage.clear(),
  };
  const settings = {
    'folio.prefix': 'BG', 'commission.base': 'neto', 'commission.basePct': 0,
    'returns.reverseCommission': false, 'returns.limitEnabled': false, 'returns.limitDays': 15,
    'discount.minMarginPct': 0,
  };
  const CONFIG = {
    get: k => settings[k], setSetting: (k, v) => { settings[k] = v; },
    map: () => ({}), metaMap: () => ({}),
    codes: kind => (kind === 'size_letter' ? TALLAS.slice() : []),
    list: kind => (kind === 'payment_method'
      ? [{ code: 'Efectivo' }, { code: 'Tarjeta' }, { code: 'Apartado' }]
      : (kind === 'return_reason' ? [{ code: 'Talla' }] : [])),
    all: () => [], find: () => null,
    catalogMeta: () => null, allCatalogMeta: () => ({}), catalogLabel: k => k, skuParts: null,
  };
  const CORE = {
    getDeviceId: () => 'dev-uno',
    registerCatalogProducts: () => {}, registerSyncGateway: () => {}, invokeSync: () => {},
  };
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super('2026-07-30T10:00:00'); }
    static now() { return new FakeDate().getTime(); }
  }
  const sandbox = {
    console, localStorage, Date: FakeDate,
    setTimeout, clearTimeout, JSON, Math, Object, Array, String, Number, Boolean,
    isNaN, parseInt, parseFloat, BigInt, RegExp, Error, Set, Map,
  };
  sandbox.window = {
    CONFIG, CORE, localStorage, UI: { toast: () => {} },
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dataSrc, sandbox);
  const t = { D: sandbox.window.DATA, CONFIG };
  if (typeof t.D.applyFolioBlock === 'function') t.D.applyFolioBlock('BG', '260730', 1, 900);
  const p = {
    id: 'p1', cat: 'GUA', manga: 'LAR', tela: 'LIN', color: 'BLA', cuello: 'NOR', modelo: '100',
    nombre: 'Guayabera', orn: '—', ornColors: [], precio: 350, costo: 0, pop: false,
    stock: TALLAS.map(talla => ({ talla, escala: 'L', stock: 20 })), sku: 'SKU-1',
    preciosTalla: { G: 450 },
  };
  t.D.products.push(p);
  t.D.sellers.length = 0;
  t.D.sellers.push({ id: 'v1', nombre: 'Vendedor', role: 'vendedor', active: true, comisionPct: 0, comisionAcum: 0, ventasMes: 0, ventasNum: 0 });
  t.p = p;
  t.vender = (talla) => t.D.recordSale({
    ticket: [{ p, talla, qty: 1 }], sellerIds: ['v1'], client: null,
    metodo: 'Efectivo', estado: 'Pagado', total: t.D.listPrice(p, talla), itemCount: 1,
  });
  t.cambiar = (folio, de, a) => t.D.recordExchange({
    origenFolio: folio,
    lineas: [
      { lado: 'devuelto', sku: 'SKU-1', nombre: 'Guayabera', talla: de, qty: 1, motivo: 'Talla', condicion: 'Sin uso', productId: 'p1' },
      { lado: 'entregado', sku: 'SKU-1', nombre: 'Guayabera', talla: a, qty: 1, productId: 'p1' },
    ],
    usuario: 'ana@balam.mx', vendedorId: 'v1', revisadoPor: 'Ana', metodoPago: 'Efectivo',
  });
  return t;
}

console.log('\n── A) Existe una autoridad del ingreso ──────────────────');
{
  const t = terminal();
  ok('1. DATA.revenueSummary existe', typeof t.D.revenueSummary === 'function');
  ok('2. DATA.exchangeRevenue existe', typeof t.D.exchangeRevenue === 'function');
  const r = t.D.revenueSummary ? t.D.revenueSummary() : {};
  ok('3. sin operaciones, todo en cero',
    near(r.ventasSolas, 0) && near(r.difCambios, 0) && near(r.importeVendido, 0) && r.pedidos === 0);
}

console.log('\n── B) Una venta sola ────────────────────────────────────');
{
  const t = terminal();
  t.vender('M'); // 350
  const r = t.D.revenueSummary ? t.D.revenueSummary() : {};
  ok('4. el importe vendido es la venta', near(r.importeVendido, 350), 'importe=' + r.importeVendido);
  ok('5. sin cambios, la diferencia es cero', near(r.difCambios, 0));
  ok('6. un pedido', r.pedidos === 1, 'pedidos=' + r.pedidos);
  ok('7. el ticket promedio es la venta', near(r.ticketProm, 350), 'ticket=' + r.ticketProm);
}

console.log('\n── C) La diferencia del cambio SUMA al importe ──────────');
{
  const t = terminal();
  const v = t.vender('M');        // 350
  const c = t.cambiar(v.folio, 'M', 'G'); // 450 - 350 = 100 de diferencia
  ok('8. el cambio se registro', !!(c && c.ok), c && c.error);
  const r = t.D.revenueSummary ? t.D.revenueSummary() : {};
  ok('9. la diferencia aparece por separado', near(r.difCambios, 100), 'dif=' + r.difCambios);
  ok('10. las ventas solas no cambian', near(r.ventasSolas, 350), 'ventas=' + r.ventasSolas);
  ok('11. el importe vendido SUMA la diferencia', near(r.importeVendido, 450), 'importe=' + r.importeVendido);
}

console.log('\n── D) Pero un cambio NO es un pedido ────────────────────');
{
  const t = terminal();
  const v = t.vender('M');
  t.cambiar(v.folio, 'M', 'G');
  const r = t.D.revenueSummary ? t.D.revenueSummary() : {};
  ok('12. el conteo de pedidos NO sube', r.pedidos === 1, 'pedidos=' + r.pedidos);
  // El ticket promedio se calcula sobre VENTAS, no sobre el importe total: si
  // usara el importe, un cambio inflaria el promedio sin haber vendido a nadie mas.
  ok('13. el ticket promedio NO se infla', near(r.ticketProm, 350), 'ticket=' + r.ticketProm);
  ok('14. y las metas del vendedor siguen intactas',
    near((t.D.sellers.find(s => s.id === 'v1') || {}).ventasMes, 350),
    'ventasMes=' + (t.D.sellers.find(s => s.id === 'v1') || {}).ventasMes);
}

console.log('\n── E) Cuadra con lo cobrado ─────────────────────────────');
{
  const t = terminal();
  const v = t.vender('M');
  t.cambiar(v.folio, 'M', 'G');
  const cobrado = (t.D.payments || []).reduce((a, p) => a + (Number(p.monto) || 0), 0);
  const r = t.D.revenueSummary ? t.D.revenueSummary() : {};
  ok('15. el dinero cobrado coincide con el importe vendido',
    near(cobrado, r.importeVendido), 'cobrado=' + cobrado + ' vendido=' + r.importeVendido);
}
{
  // Un cambio a la BAJA no cobra nada: el cliente pierde el sobrante. No puede
  // aparecer como ingreso, ni positivo ni negativo.
  const t = terminal();
  const v = t.vender('G');           // 450
  t.cambiar(v.folio, 'G', 'M');      // se lleva 350: pierde 100
  const r = t.D.revenueSummary ? t.D.revenueSummary() : {};
  ok('16. un cambio a la baja no aporta ingreso', near(r.difCambios, 0), 'dif=' + r.difCambios);
  ok('17. ni resta del importe vendido', near(r.importeVendido, 450), 'importe=' + r.importeVendido);
  ok('18. el valor no aprovechado se informa aparte', near(r.noAprovechado, 100), 'perdido=' + r.noAprovechado);
}

console.log('\n── F) Filtro por periodo ────────────────────────────────');
{
  const t = terminal();
  const v = t.vender('M');
  t.cambiar(v.folio, 'M', 'G');
  const nada = t.D.revenueSummary ? t.D.revenueSummary(() => false) : {};
  ok('19. acepta un filtro y lo aplica a ventas y cambios',
    near(nada.importeVendido, 0) && near(nada.difCambios, 0),
    'importe=' + nada.importeVendido + ' dif=' + nada.difCambios);
  const todo = t.D.revenueSummary ? t.D.revenueSummary(() => true) : {};
  ok('20. con el filtro abierto, el total completo', near(todo.importeVendido, 450));
}

console.log('\n── G) El reporte consume la autoridad ───────────────────');
ok('21. el resumen usa revenueSummary y no rehace la suma',
  /D\.revenueSummary\(/.test(repSrc));
ok('22. muestra el renglón «Diferencias cobradas por cambios»',
  /Diferencias cobradas por cambios/.test(repSrc));
ok('23. el ticket promedio sale de la autoridad, no del importe total',
  /ticketProm/.test(repSrc) && !/ventasBrutas \/ pedidos/.test(repSrc));
ok('24. la variación mensual también cuenta el ingreso del cambio',
  /exchangeRevenue\(|revenueSummary\(/.test(repSrc.slice(repSrc.indexOf('const monthAgg'), repSrc.indexOf('const monthAgg') + 400)));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
