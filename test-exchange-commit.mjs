// test-exchange-commit.mjs — H-38 (C5): la transacción del cambio.
//
// Contrato bajo prueba, gobernado por docs/04-contrato-del-cambio.md:
//   • `DATA.recordExchange()` cierra el ciclo local y entrega el documento a
//     pos.commit_exchange(), la única autoridad transaccional.
//   • El cambio NUNCA devuelve efectivo: si lo entregado vale menos, el sobrante
//     se registra como valor no aprovechado y no se emite pago.
//   • El plazo (H-34) y el saldo (H-35/H-37) son compuertas reales.
//   • La venta origen conserva intacta su evidencia financiera.
//
// NO cubre interfaz (C6) ni reportes (C7).
//
// Uso: node test-exchange-commit.mjs
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
    'returns.reverseCommission': false, 'returns.limitEnabled': false,
    'returns.limitDays': 15, 'discount.minMarginPct': 0,
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
    getDeviceId: () => 'dev-uno', registerCatalogProducts: () => {},
    registerSyncGateway: () => {}, invokeSync: (m, ...a) => { enviados.push({ m, a }); },
  };
  const enviados = [];
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super('2026-07-28T10:00:00'); }
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
  const t = { D: sandbox.window.DATA, CONFIG, enviados };
  if (typeof t.D.applyFolioBlock === 'function') t.D.applyFolioBlock('BG', '260728', 1, 900);
  return t;
}
const escenario = (over = {}) => {
  const t = terminal();
  const p = Object.assign({
    id: 'p1', cat: 'GUA', manga: 'LAR', tela: 'LIN', color: 'BLA', cuello: 'NOR',
    modelo: '100', nombre: 'Guayabera', orn: '—', ornColors: [], precio: 350, costo: 0,
    pop: false, stock: TALLAS.map(talla => ({ talla, escala: 'L', stock: 5 })),
    sku: 'SKU-1', preciosTalla: { G: 450 },
  }, over);
  t.D.products.push(p);
  const v = t.D.recordSale({
    ticket: [{ p, talla: 'M', qty: 1 }], sellerIds: [], client: null,
    metodo: 'Efectivo', estado: 'Pagado', total: 350, itemCount: 1,
  });
  return { t, p, v };
};
const cam = (t, folio, dev, ent, extra = {}) => (typeof t.D.recordExchange === 'function'
  ? t.D.recordExchange(Object.assign({
      origenFolio: folio,
      lineas: [
        ...dev.map(l => Object.assign({ lado: 'devuelto', sku: 'SKU-1', nombre: 'Guayabera', productId: 'p1' }, l)),
        ...ent.map(l => Object.assign({ lado: 'entregado', sku: 'SKU-1', nombre: 'Guayabera', productId: 'p1' }, l)),
      ],
    }, extra))
  : { ok: false, error: 'sin_autoridad' });
const stockDe = (p, talla) => (p.stock.find(v => v.talla === talla) || {}).stock;

console.log('\n── A) La transacción local ──────────────────────────────');
{
  const { t, p, v } = escenario();
  ok('1. DATA.recordExchange existe', typeof t.D.recordExchange === 'function');
  const r = cam(t, v.folio, [{ talla: 'M', qty: 1 }], [{ talla: 'G', qty: 1 }]);
  ok('2. el cambio se registra', r.ok === true, r.error || '');
  ok('3. valoración: reconocido 350, entregado 450, diferencia 100',
    near(r.exchange && r.exchange.valorReconocido, 350)
      && near(r.exchange && r.exchange.valorEntregado, 450)
      && near(r.exchange && r.exchange.diferencia, 100));
  ok('4. la base de comisión es sólo el excedente',
    near(r.exchange && r.exchange.baseComision, 100));
  ok('5. el cobro entra al ledger con tipo cambio y el folio del cambio',
    !!r.payment && r.payment.tipo === 'cambio' && r.payment.folio === r.exchange.folio
      && near(r.payment.monto, 100));
  ok('6. inventario en dos sentidos', stockDe(p, 'M') === 5 && stockDe(p, 'G') === 4,
    `M=${stockDe(p, 'M')} G=${stockDe(p, 'G')}`);
  ok('7. el documento se entrega a la autoridad transaccional',
    t.enviados.some(e => e.m === 'pushExchange'));
}

console.log('\n── B) El cambio nunca devuelve efectivo ─────────────────');
{
  const { t, v } = escenario();
  const r = cam(t, v.folio, [{ talla: 'M', qty: 1 }], [{ talla: 'CH', qty: 1 }]);
  ok('8. con sobrante no hay diferencia a cobrar', r.ok && near(r.exchange.diferencia, 0));
  ok('9. el sobrante se registra como valor no aprovechado',
    r.ok && near(r.exchange.valorNoAprovechado, 0), 'CH vale lo mismo que M');
  const { t: t2, v: v2 } = escenario();
  const caro = t2.D.products[0];
  caro.preciosTalla = { M: 450, CH: 350 };
  const v3 = t2.D.recordSale({
    ticket: [{ p: caro, talla: 'M', qty: 1 }], sellerIds: [], client: null,
    metodo: 'Efectivo', estado: 'Pagado', total: 450, itemCount: 1,
  });
  const r2 = cam(t2, v3.folio, [{ talla: 'M', qty: 1 }], [{ talla: 'CH', qty: 1 }]);
  ok('10. entregar algo más barato produce valor no aprovechado',
    r2.ok && near(r2.exchange.valorNoAprovechado, 100) && near(r2.exchange.diferencia, 0),
    r2.ok ? `no aprovechado=${r2.exchange.valorNoAprovechado}` : r2.error);
  ok('11. no se emite ningún pago cuando sobra valor', r2.ok && !r2.payment);
  ok('12. la base de comisión es 0 cuando no hay excedente',
    r2.ok && near(r2.exchange.baseComision, 0));
  void v2;
}

console.log('\n── C) Compuertas ───────────────────────────────────────');
{
  const { t, v } = escenario();
  cam(t, v.folio, [{ talla: 'M', qty: 1 }], [{ talla: 'G', qty: 1 }]);
  const r = cam(t, v.folio, [{ talla: 'M', qty: 1 }], [{ talla: 'G', qty: 1 }]);
  ok('13. el saldo impide consumir dos veces la misma pieza',
    r.ok === false && r.error === 'invalid_exchange_quantity', r.error || 'la aceptó');
  const r2 = cam(t, v.folio, [{ talla: 'G', qty: 1 }], [{ talla: 'CH', qty: 1 }]);
  ok('14. la pieza recibida en el cambio anterior sí puede recambiarse',
    r2.ok === true, r2.error || '');
  const r3 = cam(t, v.folio, [{ talla: 'CH', qty: 1 }], []);
  ok('15. un cambio exige las dos mitades',
    r3.ok === false && r3.error === 'invalid_items', r3.error || 'lo aceptó');
  const r4 = cam(t, 'FOLIO-INEXISTENTE', [{ talla: 'M', qty: 1 }], [{ talla: 'G', qty: 1 }]);
  ok('16. sin venta origen no hay cambio',
    r4.ok === false && r4.error === 'sale_not_found', r4.error || '');
}
{
  const t = terminal();
  t.CONFIG.setSetting('returns.limitEnabled', true);
  t.CONFIG.setSetting('returns.limitDays', 1);
  const p = { id: 'p1', cat: 'GUA', manga: 'LAR', tela: 'LIN', color: 'BLA', cuello: 'NOR',
    modelo: '100', nombre: 'Guayabera', orn: '—', ornColors: [], precio: 350, costo: 0,
    pop: false, stock: TALLAS.map(talla => ({ talla, escala: 'L', stock: 5 })), sku: 'SKU-1' };
  t.D.products.push(p);
  const v = t.D.recordSale({
    ticket: [{ p, talla: 'M', qty: 1 }], sellerIds: [], client: null,
    metodo: 'Efectivo', estado: 'Pagado', total: 350, itemCount: 1,
    fecha: '2026-06-01 10:00',
  });
  const r = cam(t, v.folio, [{ talla: 'M', qty: 1 }], [{ talla: 'G', qty: 1 }]);
  ok('17. el plazo de posventa vencido bloquea el cambio (H-34)',
    r.ok === false && r.error === 'exchange_window_closed', r.error || 'lo aceptó');
}

console.log('\n── D) La venta origen no se toca ───────────────────────');
{
  const { t, v } = escenario();
  const antes = { total: v.total, subtotal: v.subtotal, descuento: v.descuento };
  cam(t, v.folio, [{ talla: 'M', qty: 1 }], [{ talla: 'G', qty: 1 }]);
  const s = t.D.sales.find(x => x.folio === v.folio);
  ok('18. importes de la venta origen intactos',
    near(s.total, antes.total) && near(s.subtotal, antes.subtotal) && near(s.descuento, antes.descuento));
  ok('19. el cobro del cambio no aparece entre los pagos de la venta',
    t.D.paymentsForSale(v.folio).every(pg => pg.tipo !== 'cambio'));
}

console.log('\n── E) Contratos de la autoridad transaccional ──────────');
{
  const mig = read('./supabase/migrations/20260728005700_pos_h38_commit_exchange.sql');
  ok('20. existe pos.commit_exchange con sus cinco parámetros',
    /create or replace function pos\.commit_exchange/.test(mig)
      && /p_commit_id/.test(mig) && /p_exchange/.test(mig) && /p_items/.test(mig)
      && /p_moves/.test(mig) && /p_payment/.test(mig));
  ok('21. exige perfil operativo', /is_active_admin\(\) or pos\.is_active_seller\(\)/.test(mig));
  ok('22. serializa y es idempotente por clave y hash',
    /pg_advisory_xact_lock/.test(mig) && /exchange_commits/.test(mig)
      && /commit_mismatch/.test(mig) && /md5\(/.test(mig));
  ok('23. bloquea por plazo, por saldo y por inventario',
    /exchange_window_closed/.test(mig) && /invalid_exchange_quantity/.test(mig)
      && /insufficient_stock/.test(mig));
  ok('24. el dinero se calcula en el servidor',
    /pos\.line_recognized_value/.test(mig) && /pos\.list_price/.test(mig));
  ok('25. valida el cobro contra su propio cálculo',
    /payment_required/.test(mig) && /payment_mismatch/.test(mig));
  // El arnés comprobaba que los códigos existieran, no DÓNDE se emiten: la
  // primera versión los devolvía después de escribir el documento y dejaba
  // estado parcial. Verificar el síntoma y no la defensa (AP-09).
  const fix = read('./supabase/migrations/20260728005900_pos_h38_commit_exchange_payment_order.sql');
  const cuerpo = fix.slice(fix.indexOf('create or replace function pos.commit_exchange'));
  ok('25b. el cobro se valida ANTES de la primera escritura',
    cuerpo.indexOf('payment_required') < cuerpo.indexOf('insert into pos.exchanges')
      && cuerpo.indexOf('payment_mismatch') < cuerpo.indexOf('insert into pos.exchanges'));
  ok('26. nunca emite un pago cuando sobra valor',
    /v_diferencia > 0 and p_payment is not null/.test(mig)
      && /valor_no_aprovechado/.test(mig));
  ok('27. las autoridades de valoración son internas',
    /revoke all on function pos\.line_recognized_value[\s\S]{0,120}authenticated/.test(mig)
      && /revoke all on function pos\.list_price[\s\S]{0,120}authenticated/.test(mig));
  ok('28. mueve inventario en los dos sentidos dentro de la transacción',
    /case when x\.lado = 'devuelto' then x\.qty else -x\.qty end/.test(mig));
  ok('29. no toca commit_sale ni commit_return',
    !/create or replace function pos\.(commit_sale|commit_return)/.test(mig));

  const ver = read('./supabase/migrations/20260728006000_pos_h38_commit_exchange_verification.sql');
  ok('30. la verificación ejercita la vía real y limpia',
    /request\.jwt\.claims/.test(ver) && /raise exception/.test(ver)
      && /delete from pos\.exchanges/.test(ver) && /nunca sale efectivo/.test(ver));

  const store = read('./balam/store.jsx');
  ok('31. STORE encola el cambio y llama a la frontera checked',
    /pushExchange/.test(store) && /rpc\('commit_exchange_checked'/.test(store));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
