// test-line-balance.mjs — H-35: autoridad única del saldo por renglón.
//
// Contrato bajo prueba:
//   • `DATA.saleLineBalance(folio)` es la única respuesta a «¿cuántas unidades
//     de este renglón siguen disponibles?».
//   • disponible = vendida − consumida, donde consumida suma TODAS las fuentes
//     (devoluciones hoy; cambios cuando existan) y nunca es negativa.
//   • Una unidad consumida no puede volver a consumirse por ninguna vía.
//   • Con la costura de cambios vacía, el saldo es idéntico al histórico.
//
// Carga el módulo REAL balam/data.jsx en un contexto aislado (mismo patrón que
// test-return-deadline.mjs / test-folio-diario.mjs).
//
// Uso: node test-line-balance.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const src = readFileSync(new URL('./balam/data.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const read = (rel) => { try { return readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } };

function terminal({ storage = new Map(), clock = '2026-07-28T10:00:00', device = 'dev-uno' } = {}) {
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
    clear: () => storage.clear(),
  };
  const settings = {
    'folio.prefix': 'BG', 'commission.base': 'neto', 'commission.basePct': 0,
    'returns.reverseCommission': false, 'returns.limitEnabled': false, 'returns.limitDays': 15,
  };
  const CONFIG = {
    get: k => settings[k],
    setSetting: (k, v) => { settings[k] = v; },
    map: () => ({}), metaMap: () => ({}), codes: kind => (kind === 'size_letter' ? ['CH', 'M', 'G'] : []),
    list: kind => (kind === 'payment_method'
      ? [{ code: 'Efectivo' }, { code: 'Tarjeta' }, { code: 'Apartado' }]
      : (kind === 'return_reason' ? [{ code: 'Talla' }] : [])),
    all: () => [], find: () => null,
  };
  const CORE = {
    getDeviceId: () => device,
    registerCatalogProducts: () => {}, registerSyncGateway: () => {},
    invokeSync: () => {},
  };
  let nowIso = clock;
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(nowIso); }
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
  vm.runInContext(src, sandbox);
  const t = { D: sandbox.window.DATA, CONFIG, storage, setClock: iso => { nowIso = iso; } };
  t.D.applyFolioBlock('BG', '260728', 1, 900);
  return t;
}

// La autoridad puede no existir antes de la corrección: el arnés reporta el
// fallo en vez de abortar, para dejar una línea base contable.
const balance = (t, folio, opts) => (typeof t.D.saleLineBalance === 'function'
  ? t.D.saleLineBalance(folio, opts) : []);
const lineOf = (rows, sku, talla) => rows.find(r => r.sku === sku && r.talla === talla) || {};

function producto(t, over = {}) {
  const p = Object.assign({
    id: 'p1', cat: 'GUA', manga: 'LAR', tela: 'LIN', color: 'BLA', cuello: 'NOR', modelo: '100',
    nombre: 'Guayabera', orn: '—', ornColors: [], precio: 1000, costo: 0, pop: false,
    stock: [{ talla: 'M', escala: 'L', stock: 40 }, { talla: 'G', escala: 'L', stock: 40 }], sku: 'SKU-1',
  }, over);
  t.D.products.push(p);
  return p;
}
function vender(t, lineas) {
  const p = t.D.products[0];
  const ticket = (lineas || [{ talla: 'M', qty: 3 }]).map(l => ({ p: l.p || p, talla: l.talla, qty: l.qty }));
  const total = ticket.reduce((a, l) => a + (Number(l.p.precio) || 0) * l.qty, 0);
  return t.D.recordSale({
    ticket, sellerIds: [], client: null, metodo: 'Efectivo', estado: 'Pagado',
    total, itemCount: ticket.reduce((a, l) => a + l.qty, 0),
  });
}
const devolver = (t, folio, sku, talla, qty) => t.D.recordReturn({
  folio, metodo: 'Efectivo',
  lineas: [{ sku, nombre: 'Guayabera', talla, qty, motivo: 'Talla' }],
});

// ── 1-3) Forma de la autoridad ───────────────────────────────────────────────
{
  const t = terminal(); producto(t);
  const s = vender(t, [{ talla: 'M', qty: 3 }]);
  const rows = balance(t, s.folio);
  ok('1. existe DATA.saleLineBalance', typeof t.D.saleLineBalance === 'function');
  ok('2. devuelve un renglón por (sku, talla) vendido', rows.length === 1 && rows[0].sku === 'SKU-1' && rows[0].talla === 'M',
    JSON.stringify(rows));
  const l = lineOf(rows, 'SKU-1', 'M');
  ok('3. expone vendida / devuelta / cambiada / consumida / disponible',
    l.vendida === 3 && l.devuelta === 0 && l.cambiada === 0 && l.consumida === 0 && l.disponible === 3,
    JSON.stringify(l));
}

// ── 4-7) Devoluciones parciales sucesivas y total ───────────────────────────
{
  const t = terminal(); producto(t);
  const s = vender(t, [{ talla: 'M', qty: 3 }]);
  devolver(t, s.folio, 'SKU-1', 'M', 1);
  ok('4. una parcial deja 2 disponibles', lineOf(balance(t, s.folio), 'SKU-1', 'M').disponible === 2,
    JSON.stringify(lineOf(balance(t, s.folio), 'SKU-1', 'M')));
  devolver(t, s.folio, 'SKU-1', 'M', 1);
  ok('5. la segunda parcial deja 1 disponible', lineOf(balance(t, s.folio), 'SKU-1', 'M').disponible === 1);
  const r3 = devolver(t, s.folio, 'SKU-1', 'M', 1);
  ok('6. la tercera agota el renglón y la venta queda Devuelta',
    r3.ok === true && lineOf(balance(t, s.folio), 'SKU-1', 'M').disponible === 0 && s.estado === 'Devuelto',
    `${s.estado}`);
  const extra = devolver(t, s.folio, 'SKU-1', 'M', 1);
  ok('7. una unidad más se rechaza', extra.ok === false, extra.error || '');
}

// ── 8-9) Sobredevolución en una sola operación ──────────────────────────────
{
  const t = terminal(); producto(t);
  const s = vender(t, [{ talla: 'M', qty: 2 }]);
  const r = devolver(t, s.folio, 'SKU-1', 'M', 3);
  ok('8. pedir más de lo vendido se rechaza', r.ok === false, r.error || '');
  ok('9. el rechazo no consumió saldo ni movió stock',
    lineOf(balance(t, s.folio), 'SKU-1', 'M').disponible === 2 && t.D.returns.length === 0);
}

// ── 10-11) Renglones independientes entre sí ────────────────────────────────
{
  const t = terminal(); producto(t);
  const s = vender(t, [{ talla: 'M', qty: 2 }, { talla: 'G', qty: 2 }]);
  devolver(t, s.folio, 'SKU-1', 'M', 2);
  const rows = balance(t, s.folio);
  ok('10. agotar una talla no afecta a la otra',
    lineOf(rows, 'SKU-1', 'M').disponible === 0 && lineOf(rows, 'SKU-1', 'G').disponible === 2,
    JSON.stringify(rows));
  ok('11. la venta queda en devolución parcial', s.estado === 'Devolución parcial', s.estado);
}

// ── 12-13) Exclusión de documento (reescritura de una devolución) ───────────
{
  const t = terminal(); producto(t);
  const s = vender(t, [{ talla: 'M', qty: 3 }]);
  const r = devolver(t, s.folio, 'SKU-1', 'M', 2);
  ok('12. sin exclusión el saldo descuenta esa devolución',
    lineOf(balance(t, s.folio), 'SKU-1', 'M').disponible === 1);
  ok('13. excluyendo su documento el saldo la ignora',
    lineOf(balance(t, s.folio, { excludeDocument: r.ret.id }), 'SKU-1', 'M').disponible === 3,
    JSON.stringify(lineOf(balance(t, s.folio, { excludeDocument: r.ret.id }), 'SKU-1', 'M')));
}

// ── 14-16) Ventas sin renglones e históricas ────────────────────────────────
{
  const t = terminal(); producto(t);
  const sinLineas = {
    folio: 'BG-260101-0001', fecha: '2026-01-01 10:00', cliente: 'Público en general',
    vendedores: [], items: 0, total: 500, metodo: 'Efectivo', estado: 'Pagado',
  };
  t.D.sales.push(sinLineas);
  ok('14. una venta sin renglones produce balance vacío', balance(t, sinLineas.folio).length === 0);
  const r = devolver(t, sinLineas.folio, 'SKU-1', 'M', 1);
  ok('15. y no admite devolución', r.ok === false, r.error || '');
  const historica = {
    folio: 'BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H', fecha: '2026-07-01 11:00', cliente: 'Cliente',
    vendedores: [], items: 2, total: 2000, metodo: 'Efectivo', estado: 'Pagado',
    lineas: [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 2, precio: 1000 }],
  };
  t.D.sales.push(historica);
  ok('16. una venta histórica con folio largo conserva su saldo',
    lineOf(balance(t, historica.folio), 'SKU-1', 'M').disponible === 2,
    JSON.stringify(balance(t, historica.folio)));
}

// ── 17-18) Devoluciones preexistentes (datos ya guardados) ─────────────────
{
  const t = terminal(); producto(t);
  const s = vender(t, [{ talla: 'M', qty: 4 }]);
  // Devolución escrita por una versión anterior, ya presente en la colección.
  t.D.returns.push({
    id: 'ret-viejo', folio: s.folio, fecha: '2026-07-28 09:00', cliente: 'x',
    vendedores: [], metodo: 'Efectivo', total: 1000, notas: '',
    lineas: [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, precio: 1000 }],
  });
  ok('17. una devolución preexistente descuenta saldo',
    lineOf(balance(t, s.folio), 'SKU-1', 'M').disponible === 3);
  const r = devolver(t, s.folio, 'SKU-1', 'M', 4);
  ok('18. y limita lo que se puede devolver después', r.ok === false, r.error || '');
}

// ── 19-22) Costura de cambios: hoy vacía, mañana contabilizada ─────────────
{
  const t = terminal(); producto(t);
  const s = vender(t, [{ talla: 'M', qty: 3 }]);
  ok('19. sin colección de cambios, cambiada es 0', lineOf(balance(t, s.folio), 'SKU-1', 'M').cambiada === 0);

  // La fase 4 creará DATA.exchanges. Aquí se simula para probar la costura:
  // un cambio que devolvió 1 pieza de esta venta.
  t.D.exchanges = [{
    id: 'exc-1', folio: 'CB-260728-0001', origenFolio: s.folio,
    lineas: [
      { lado: 'devuelto', sku: 'SKU-1', talla: 'M', qty: 1 },
      { lado: 'entregado', sku: 'SKU-1', talla: 'G', qty: 1 },
    ],
  }];
  const l = lineOf(balance(t, s.folio), 'SKU-1', 'M');
  ok('20. un cambio consume saldo por su renglón devuelto',
    l.cambiada === 1 && l.consumida === 1 && l.disponible === 2, JSON.stringify(l));
  ok('21. el renglón ENTREGADO del cambio no consume saldo de la venta',
    lineOf(balance(t, s.folio), 'SKU-1', 'G').disponible === undefined
      || lineOf(balance(t, s.folio), 'SKU-1', 'G').vendida === undefined,
    JSON.stringify(balance(t, s.folio)));

  // Coexistencia: 1 cambiada + 1 devuelta sobre la misma línea de 3.
  devolver(t, s.folio, 'SKU-1', 'M', 1);
  const l2 = lineOf(balance(t, s.folio), 'SKU-1', 'M');
  ok('22. devolución y cambio coexisten sobre la misma línea',
    l2.vendida === 3 && l2.devuelta === 1 && l2.cambiada === 1 && l2.disponible === 1, JSON.stringify(l2));
}

// ── 23-25) El doble consumo queda impedido ─────────────────────────────────
{
  const t = terminal(); producto(t);
  const s = vender(t, [{ talla: 'M', qty: 2 }]);
  t.D.exchanges = [{
    id: 'exc-2', folio: 'CB-260728-0002', origenFolio: s.folio,
    lineas: [{ lado: 'devuelto', sku: 'SKU-1', talla: 'M', qty: 2 }],
  }];
  ok('23. un cambio que consume todo deja el saldo en cero',
    lineOf(balance(t, s.folio), 'SKU-1', 'M').disponible === 0);
  const r = devolver(t, s.folio, 'SKU-1', 'M', 1);
  ok('24. devolver una unidad ya cambiada se rechaza', r.ok === false, r.error || '');
  ok('25. returnedQty sigue contando SÓLO devoluciones',
    t.D.returnedQty(s.folio, 'SKU-1', 'M') === 0, String(t.D.returnedQty(s.folio, 'SKU-1', 'M')));
}

// ── 26-28) La pantalla de Devoluciones consume la autoridad ────────────────
{
  const returns = read('./balam/returns.jsx');
  ok('26. Devoluciones calcula lo devolvible con saleLineBalance', /saleLineBalance/.test(returns));
  const data = read('./balam/data.jsx');
  ok('27. recordReturn valida contra el saldo disponible',
    /disponible/.test(data) && /saleLineBalance/.test(data));
  ok('28. existe la costura documentada de fuentes de consumo', /consumptionSources/.test(data));
}

// ── 29-38) Contrato SQL ────────────────────────────────────────────────────
{
  const mig = read('./supabase/migrations/20260728004700_pos_h35_line_balance.sql');
  const grants = read('./supabase/migrations/20260728004900_pos_h35_line_balance_grants.sql');
  const ver = read('./supabase/migrations/20260728005000_pos_h35_line_balance_verification.sql');
  ok('29. la migración crea la vista pos.line_consumption',
    /create or replace view pos\.line_consumption/.test(mig));
  ok('30. la migración crea pos.sale_line_balance', /create or replace function pos\.sale_line_balance/.test(mig));
  ok('31. commit_return consulta la autoridad y ya no agrupa return_items en línea',
    /create or replace function pos\.commit_return/.test(mig)
      && /sale_line_balance/.test(mig)
      && !/join pos\.returns r on r\.id = ri\.return_id\s*\n\s*where r\.folio = v_folio and r\.id <> v_return_id/.test(mig));
  ok('32. la firma de commit_return no cambia',
    /p_commit_id text,\s*\n\s*p_return jsonb,\s*\n\s*p_items jsonb,\s*\n\s*p_moves jsonb,\s*\n\s*p_stock_lines jsonb,/.test(mig));
  ok('33. las reglas de inventario, importes y comisiones siguen presentes',
    /invalid_stock_lines/.test(mig) && /invalid_stock_target/.test(mig)
      && /refund_exceeds_sale/.test(mig) && /comision_acum/.test(mig));
  ok('34. existe la migración de verificación', /h35/i.test(ver) && /sale_line_balance/.test(ver));

  // El esquema pos concede toda relación nueva a `authenticated` por privilegio
  // por defecto, así que `revoke from public` no basta: hicieron falta el
  // revoke nominal y security_invoker. Ambos quedan fijados aquí.
  ok('35. la corrección revoca la vista a authenticated y anon',
    /revoke all on pos\.line_consumption from authenticated/.test(grants)
      && /revoke all on pos\.line_consumption from anon/.test(grants));
  ok('36. la corrección activa security_invoker en la vista',
    /alter view pos\.line_consumption set \(security_invoker = true\)/.test(grants));
  ok('37. la corrección conserva la lectura de service_role',
    /grant select on pos\.line_consumption to service_role/.test(grants));
  ok('38. la verificación exige ausencia de permisos Y security_invoker',
    /has_table_privilege\('authenticated', 'pos\.line_consumption', 'select'\)/.test(ver)
      && /has_table_privilege\('anon', 'pos\.line_consumption', 'select'\)/.test(ver)
      && /security_invoker/.test(ver));
}

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
