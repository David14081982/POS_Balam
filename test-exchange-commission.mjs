// test-exchange-commission.mjs — H-47 (C7): la comisión del excedente del cambio.
//
// Contrato bajo prueba, gobernado por docs/04-contrato-del-cambio.md § 7 y por
// la decisión del dueño registrada en H-47:
//
//   • El intercambio en sí NUNCA genera comisión. Sólo el excedente de valor
//     —lo que el cliente paga de más— constituye venta nueva y comisiona.
//   • La comisión es del vendedor que ATENDIÓ el cambio, y se le acredita en el
//     acto, igual que en una venta normal.
//   • Pero el cambio NO es un pedido: no incrementa `ventasNum` ni `ventasMes`,
//     así que no altera el conteo de ventas, el ticket promedio ni las metas.
//   • Lo acreditado queda CONGELADO en el documento del cambio —monto, base y
//     porcentaje—, para que la reversa reste exactamente lo que se sumó y no lo
//     que la configuración vigente diría hoy (ADR-002).
//   • `reverseExchangeCommission` es la reversa. Hoy NO existe ninguna forma de
//     cancelar ni modificar un cambio: es la costura declarada para cuando
//     exista, y se prueba para que no sea código muerto.
//
// Uso: node test-exchange-commission.mjs
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
const storeSrc = read('./balam/store.jsx');
const mig = read('./supabase/migrations/20260730006500_pos_h47_exchange_commission.sql');
const migFn = read('./supabase/migrations/20260730006600_pos_h47_commit_exchange_sellers.sql');
const migVer = read('./supabase/migrations/20260730006700_pos_h47_exchange_commission_verification.sql');

const TALLAS = ['CH', 'M', 'G'];

function terminal(base = 'neto') {
  const storage = new Map();
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
    clear: () => storage.clear(),
  };
  const settings = {
    'folio.prefix': 'BG', 'commission.base': base, 'commission.basePct': 0,
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
  // Semilla VÁLIDA del negocio (R-DEL-12): catálogo con dos precios por talla,
  // una venta pagada y un vendedor con porcentaje real.
  const p = {
    id: 'p1', cat: 'GUA', manga: 'LAR', tela: 'LIN', color: 'BLA', cuello: 'NOR', modelo: '100',
    nombre: 'Guayabera', orn: '—', ornColors: [], precio: 350, costo: 0, pop: false,
    stock: TALLAS.map(talla => ({ talla, escala: 'L', stock: 20 })), sku: 'SKU-1',
    preciosTalla: { G: 450 },
  };
  t.D.products.push(p);
  t.D.sellers.length = 0;
  t.D.sellers.push({ id: 'v1', nombre: 'Vendedor del cambio', role: 'vendedor', active: true, comisionPct: 10, comisionAcum: 0, ventasMes: 0, ventasNum: 0 });
  t.D.sellers.push({ id: 'v2', nombre: 'Vendedor de la venta', role: 'vendedor', active: true, comisionPct: 10, comisionAcum: 0, ventasMes: 0, ventasNum: 0 });
  const venta = t.D.recordSale({
    ticket: [{ p, talla: 'M', qty: 1 }], sellerIds: ['v2'], client: null,
    metodo: 'Efectivo', estado: 'Pagado', total: 350, itemCount: 1,
  });
  t.p = p; t.venta = venta;
  t.v1 = () => t.D.sellers.find(s => s.id === 'v1');
  t.v2 = () => t.D.sellers.find(s => s.id === 'v2');
  return t;
}

// Cambio de talla M -> G: reconoce 350, entrega 450, excedente 100.
function cambiar(t, { vendedorId = 'v1', entregaTalla = 'G' } = {}) {
  return t.D.recordExchange({
    origenFolio: t.venta.folio,
    lineas: [
      { lado: 'devuelto', sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, motivo: 'Talla', condicion: 'Sin uso', productId: 'p1' },
      { lado: 'entregado', sku: 'SKU-1', nombre: 'Guayabera', talla: entregaTalla, qty: 1, productId: 'p1' },
    ],
    usuario: 'ana@balam.mx', vendedorId, revisadoPor: 'Ana', metodoPago: 'Efectivo',
  });
}

console.log('\n── A) La comisión del excedente se acredita ─────────────');
{
  const t = terminal('neto');
  const antes = t.v1().comisionAcum;
  const r = cambiar(t);
  ok('1. el cambio se registra', !!(r && r.ok), r && r.error);
  // Excedente 100 bruto; base 'neto' => 100/1.16 = 86.21; 10% => 8.62
  ok('2. acredita la comisión del excedente al vendedor que atendió',
    near(t.v1().comisionAcum - antes, 8.62), 'delta=' + (t.v1().comisionAcum - antes));
  // La venta original: 350 bruto, neto 301.72, 10% => 30.17. Debe quedar intacta.
  ok('3. no toca al vendedor de la venta original', near(t.v2().comisionAcum, 30.17),
    'acum=' + t.v2().comisionAcum);
}
{
  const t = terminal('bruto');
  const r = cambiar(t);
  ok('4. con base bruta comisiona el excedente completo',
    !!(r && r.ok) && near(t.v1().comisionAcum, 10), 'acum=' + t.v1().comisionAcum);
}

console.log('\n── B) Un cambio no es un pedido ─────────────────────────');
{
  const t = terminal('neto');
  const vNum = t.v1().ventasNum, vMes = t.v1().ventasMes;
  cambiar(t);
  ok('5. no incrementa el conteo de ventas (pedidos, ticket promedio)',
    t.v1().ventasNum === vNum, 'ventasNum=' + t.v1().ventasNum);
  ok('6. no incrementa las ventas del mes (metas del equipo)',
    near(t.v1().ventasMes, vMes), 'ventasMes=' + t.v1().ventasMes);
}

console.log('\n── C) Sin excedente no hay comisión ─────────────────────');
{
  const t = terminal('neto');
  const r = cambiar(t, { entregaTalla: 'CH' }); // 350 -> 350: sin excedente
  ok('7. un cambio sin excedente no acredita nada',
    !!(r && r.ok) && near(t.v1().comisionAcum, 0), 'acum=' + t.v1().comisionAcum);
  ok('8. y no congela comisión donde no la hubo',
    !!(r && r.ok) && near((r.exchange || {}).comisionMonto, 0));
}
{
  const t = terminal('neto');
  const r = cambiar(t, { vendedorId: null });
  ok('9. sin vendedor atribuido no acredita a nadie',
    !!(r && r.ok) && near(t.v1().comisionAcum, 0) && near((r.exchange || {}).comisionMonto, 0));
}

console.log('\n── D) Evidencia congelada (ADR-002) ─────────────────────');
{
  const t = terminal('neto');
  const r = cambiar(t);
  const e = (r || {}).exchange || {};
  ok('10. congela el monto acreditado', near(e.comisionMonto, 8.62), 'monto=' + e.comisionMonto);
  ok('11. congela la base usada', e.comisionBase === 'neto', 'base=' + e.comisionBase);
  ok('12. congela el porcentaje usado', near(e.comisionPct, 10), 'pct=' + e.comisionPct);
  ok('13. congela a quién se le acreditó', e.vendedorId === 'v1');
}

console.log('\n── E) La reversa resta lo que se sumó ───────────────────');
{
  const t = terminal('neto');
  const r = cambiar(t);
  ok('14. existe la reversa de la comisión del cambio',
    typeof t.D.reverseExchangeCommission === 'function');
  const antes = t.v1().comisionAcum;
  const rev = t.D.reverseExchangeCommission ? t.D.reverseExchangeCommission(r.exchange.id) : null;
  ok('15. la reversa se aplica y lo reporta', !!(rev && rev.ok), rev && rev.error);
  ok('16. resta exactamente el monto congelado',
    near(antes - t.v1().comisionAcum, 8.62), 'delta=' + (antes - t.v1().comisionAcum));
}
{
  // La reversa NO recalcula con la configuración vigente: si el dueño cambia la
  // base entre el registro y la reversa, se resta lo que de verdad se pagó.
  const t = terminal('neto');
  const r = cambiar(t);
  const antes = t.v1().comisionAcum;
  t.CONFIG.setSetting('commission.base', 'bruto');
  t.v1().comisionPct = 25;
  if (t.D.reverseExchangeCommission) t.D.reverseExchangeCommission(r.exchange.id);
  ok('17. no depende de la configuración vigente ni del porcentaje actual',
    near(antes - t.v1().comisionAcum, 8.62), 'delta=' + (antes - t.v1().comisionAcum));
}
{
  const t = terminal('neto');
  const r = cambiar(t);
  if (t.D.reverseExchangeCommission) t.D.reverseExchangeCommission(r.exchange.id);
  const tras = t.v1().comisionAcum;
  const dos = t.D.reverseExchangeCommission ? t.D.reverseExchangeCommission(r.exchange.id) : null;
  ok('18. es idempotente: no resta dos veces',
    near(t.v1().comisionAcum, tras), 'acum=' + t.v1().comisionAcum);
  ok('19. y avisa de que ya estaba revertida', !!(dos && !dos.ok && /revertid/i.test(dos.error || '')), dos && dos.error);
  ok('20. deja marca en el documento del cambio',
    !!(t.D.exchanges.find(x => x.id === r.exchange.id) || {}).comisionRevertida);
}
{
  // Si el acumulado ya se liquidó, la reversa no puede dejarlo en negativo.
  const t = terminal('neto');
  const r = cambiar(t);
  t.v1().comisionAcum = 0;
  if (t.D.reverseExchangeCommission) t.D.reverseExchangeCommission(r.exchange.id);
  ok('21. nunca deja el acumulado en negativo', t.v1().comisionAcum >= 0, 'acum=' + t.v1().comisionAcum);
}
{
  const t = terminal('neto');
  const rev = t.D.reverseExchangeCommission ? t.D.reverseExchangeCommission('no-existe') : null;
  ok('22. sobre un cambio inexistente no hace nada y lo dice',
    !!(rev && !rev.ok && /no encontrad|not_found/i.test(rev.error || '')), rev && rev.error);
}

console.log('\n── F) Sincronización y esquema ──────────────────────────');
ok('23. STORE transporta los tres campos congelados',
  /comision_monto: /.test(storeSrc) && /comision_base: /.test(storeSrc) && /comision_pct: /.test(storeSrc));
ok('24. STORE los relee de la nube',
  /comisionMonto: Number\(r\.comision_monto\)/.test(storeSrc) && /comisionBase: r\.comision_base/.test(storeSrc));
const recEx = dataSrc.slice(dataSrc.indexOf('function recordExchange'), dataSrc.indexOf('function reverseExchangeCommission'));
ok('25. recordExchange emite efectos de vendedor con su versión base',
  /base_version: baseVersion/.test(recEx)
    && /invokeSync\('pushExchange', exch, \{ payment, sellerEffects \}\)/.test(recEx));
ok('26. la migración añade las tres columnas y es aditiva',
  /add column if not exists comision_monto/.test(mig) && /add column if not exists comision_base/.test(mig)
    && /add column if not exists comision_pct/.test(mig) && !/drop table|truncate/i.test(mig));
ok('27. commit_exchange acepta los efectos de vendedor',
  /p_seller_effects jsonb default/.test(migFn) && /pos\.commit_exchange\(/.test(migFn));
// `commit_sale` no lanza excepcion por conflicto: RECONCILIA. Si la version ya
// avanzo uno sobre la base leida y el valor final coincide, el efecto ya se
// aplico y es un reenvio de la cola. Esta prueba afirma ese patron —el real— y
// no un error que la funcion hermana tampoco produce.
ok('28. aplica los efectos con la misma reconciliación de versión que commit_sale',
  /sync_version = coalesce\(v_effect\.base_version, 0\) \+ 1/.test(migFn)
    && /comision_acum = v_effect\.after_comision_acum/.test(migFn));
ok('28b. y NO toca ventas ni pedidos: un cambio no es un pedido',
  !/set ventas_mes|ventas_num =/.test(migFn.slice(migFn.indexOf('update pos.sellers'))));
ok('29. la verificación prueba acreditación y reversa contra la base real',
  /raise exception/.test(migVer) && /comision_monto/.test(migVer) && /delete from pos\.exchanges/.test(migVer));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
