// test-exchange-model.mjs — H-37 (C4): el modelo del cambio.
//
// Contrato bajo prueba, gobernado por docs/04-contrato-del-cambio.md:
//   • `DATA.exchanges` existe y alimenta la costura de consumo que H-35 dejó.
//   • Un artículo ENTREGADO en un cambio entra al saldo como SUMINISTRO del
//     folio de origen, de modo que puede recambiarse una sola vez.
//   • `DATA.recognizedValue()` es la autoridad única del valor histórico
//     reconocido: sirve tanto para piezas de la venta como para piezas
//     entregadas en un cambio anterior, y nunca deriva del precio vigente.
//   • Con la colección vacía, el saldo es idéntico al de H-35.
//
// NO cubre commit_exchange (C5) ni interfaz (C6): están fuera de alcance.
//
// Uso: node test-exchange-model.mjs
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
    removeItem: k => storage.delete(k),
    clear: () => storage.clear(),
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
  const t = { D: sandbox.window.DATA, CONFIG };
  if (typeof t.D.applyFolioBlock === 'function') t.D.applyFolioBlock('BG', '260728', 1, 900);
  return t;
}

const balance = (t, folio) => (typeof t.D.saleLineBalance === 'function' ? t.D.saleLineBalance(folio) : []);
const lineOf = (rows, sku, talla) => rows.find(r => r.sku === sku && r.talla === talla) || {};
const recognized = (t, folio, sku, talla) =>
  (typeof t.D.recognizedValue === 'function' ? t.D.recognizedValue(folio, sku, talla) : undefined);

function producto(t, over = {}) {
  const p = Object.assign({
    id: 'p1', cat: 'GUA', manga: 'LAR', tela: 'LIN', color: 'BLA', cuello: 'NOR', modelo: '100',
    nombre: 'Guayabera', orn: '—', ornColors: [], precio: 350, costo: 0, pop: false,
    stock: TALLAS.map(talla => ({ talla, escala: 'L', stock: 20 })), sku: 'SKU-1',
  }, over);
  t.D.products.push(p);
  return p;
}
function vender(t, p, lineas) {
  const ticket = lineas.map(l => ({ p, talla: l.talla, qty: l.qty }));
  const total = ticket.reduce((a, l) => a + t.D.listPrice(l.p, l.talla) * l.qty, 0);
  return t.D.recordSale({
    ticket, sellerIds: [], client: null, metodo: 'Efectivo', estado: 'Pagado',
    total, itemCount: ticket.reduce((a, l) => a + l.qty, 0),
  });
}
// Documento de cambio según ADR-010. C4 sólo define el modelo: los documentos se
// insertan directamente, como hará commit_exchange en C5.
let seq = 0;
function cambiar(t, origenFolio, devuelto, entregado) {
  const doc = {
    id: 'cmb-' + (++seq), folio: 'CB-260728-000' + seq, origenFolio,
    fecha: '2026-07-28 11:00',
    lineas: [
      ...devuelto.map(l => Object.assign({ lado: 'devuelto' }, l)),
      ...entregado.map(l => Object.assign({ lado: 'entregado' }, l)),
    ],
  };
  // Antes de la corrección la colección no existe: el arnés reporta el fallo en
  // vez de abortar, para dejar una línea base contable.
  if (Array.isArray(t.D.exchanges)) t.D.exchanges.push(doc);
  return doc;
}

console.log('\n── A) Colección y costura ───────────────────────────────');
{
  const t = terminal();
  ok('1. DATA.exchanges existe como colección', Array.isArray(t.D.exchanges));
  ok('2. DATA.saveExchanges persiste la colección', typeof t.D.saveExchanges === 'function');
  ok('3. applyRemote acepta el dominio exchanges',
    /exchanges:\s*\[exchanges/.test(dataSrc) || /exchanges/.test(dataSrc.slice(dataSrc.indexOf('const M = {'), dataSrc.indexOf('const M = {') + 700)));
}

console.log('\n── B) Suministro: lo entregado entra al saldo ───────────');
{
  const t = terminal();
  const p = producto(t);
  const v = vender(t, p, [{ talla: 'M', qty: 1 }]);
  const antes = balance(t, v.folio);
  ok('4. la venta aporta su renglón como vendida', near(lineOf(antes, 'SKU-1', 'M').vendida, 1));

  cambiar(t, v.folio,
    [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, precio: 350 }],
    [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'G', qty: 1, precio: 450 }]);

  const b = balance(t, v.folio);
  const m = lineOf(b, 'SKU-1', 'M'), g = lineOf(b, 'SKU-1', 'G');
  ok('5. la pieza devuelta queda consumida y sin disponible',
    near(m.consumida, 1) && near(m.disponible, 0), `consumida=${m.consumida} disponible=${m.disponible}`);
  ok('6. la pieza ENTREGADA entra como suministro del folio de origen',
    near(g.vendida, 1), `vendida=${g.vendida}`);
  ok('7. la pieza entregada queda disponible para recambiarse',
    near(g.disponible, 1), `disponible=${g.disponible}`);

  cambiar(t, v.folio,
    [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'G', qty: 1, precio: 450 }],
    [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'CH', qty: 1, precio: 350 }]);

  const c = balance(t, v.folio);
  ok('8. tras recambiarla, la pieza intermedia ya no está disponible',
    near(lineOf(c, 'SKU-1', 'G').disponible, 0), `disponible=${lineOf(c, 'SKU-1', 'G').disponible}`);
  ok('9. la cadena A→B→C sigue anclada al folio de origen',
    near(lineOf(c, 'SKU-1', 'CH').vendida, 1) && near(lineOf(c, 'SKU-1', 'CH').disponible, 1));
  ok('10. ninguna unidad queda con disponible negativo',
    c.every(r => r.disponible >= 0 && r.consumida <= r.vendida),
    c.map(r => `${r.talla}:${r.vendida}-${r.consumida}`).join(' '));
}

console.log('\n── C) Retrocompatibilidad ──────────────────────────────');
{
  const t = terminal();
  const p = producto(t);
  const v = vender(t, p, [{ talla: 'M', qty: 3 }]);
  const b = balance(t, v.folio);
  ok('11. sin cambios registrados el saldo es el de H-35',
    near(lineOf(b, 'SKU-1', 'M').vendida, 3) && near(lineOf(b, 'SKU-1', 'M').disponible, 3)
      && near(lineOf(b, 'SKU-1', 'M').cambiada, 0));
  t.D.recordReturn({
    folio: v.folio, metodo: 'Efectivo', notas: '',
    lineas: [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, motivo: 'Talla', precio: 350 }],
  });
  const b2 = balance(t, v.folio);
  ok('12. una devolución sigue consumiendo igual',
    near(lineOf(b2, 'SKU-1', 'M').devuelta, 1) && near(lineOf(b2, 'SKU-1', 'M').disponible, 2));
}

console.log('\n── D) Autoridad del valor histórico reconocido ─────────');
{
  const t = terminal();
  const p = producto(t, { preciosTalla: { G: 450 } });
  const v = vender(t, p, [{ talla: 'M', qty: 1 }]);
  ok('13. la autoridad existe', typeof t.D.recognizedValue === 'function');
  ok('14. una pieza de la venta vale su precio congelado',
    near(recognized(t, v.folio, 'SKU-1', 'M'), 350), `= ${recognized(t, v.folio, 'SKU-1', 'M')}`);

  cambiar(t, v.folio,
    [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, precio: 350 }],
    [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'G', qty: 1, precio: 450 }]);
  ok('15. una pieza entregada en un cambio vale lo que se entregó',
    near(recognized(t, v.folio, 'SKU-1', 'G'), 450), `= ${recognized(t, v.folio, 'SKU-1', 'G')}`);

  p.preciosTalla = { G: 999 };
  ok('16. el valor reconocido NO se deriva del precio vigente',
    near(recognized(t, v.folio, 'SKU-1', 'G'), 450), `= ${recognized(t, v.folio, 'SKU-1', 'G')}`);
  ok('17. una pieza ajena a la venta vale 0',
    near(recognized(t, v.folio, 'SKU-OTRO', 'M'), 0));

  cambiar(t, v.folio,
    [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'G', qty: 1, precio: 450 }],
    [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'CH', qty: 1, precio: 300 }]);
  ok('18. el último cambio manda sobre el valor de la pieza',
    near(recognized(t, v.folio, 'SKU-1', 'CH'), 300), `= ${recognized(t, v.folio, 'SKU-1', 'CH')}`);
}

console.log('\n── E) Contratos de código y esquema ────────────────────');
{
  ok('19. DATA publica exchanges, saveExchanges y recognizedValue',
    /\bexchanges,/.test(dataSrc) && /saveExchanges/.test(dataSrc) && /recognizedValue/.test(dataSrc));
  ok('20. el valor reconocido se calcula en UN solo lugar del cliente',
    (dataSrc.match(/function recognizedValue/g) || []).length === 1);

  const store = read('./balam/store.jsx');
  ok('21. STORE mapea el dominio de cambios',
    /exchanges/.test(store) && /exchange_items|exchanges/.test(store));

  const mig = read('./supabase/migrations/20260728005300_pos_h37_exchange_model.sql');
  ok('22. la migración crea pos.exchanges y pos.exchange_items con lado',
    /create table if not exists pos\.exchanges/.test(mig)
      && /create table if not exists pos\.exchange_items/.test(mig)
      && /lado\b/.test(mig));
  ok('23. crea la vista de suministro pos.line_supply',
    /create or replace view pos\.line_supply/.test(mig));
  ok('24. sale_line_balance suma el suministro además de sale_items',
    /create or replace function pos\.sale_line_balance/.test(mig) && /line_supply/.test(mig));
  // La costura de consumo tambien necesita su rama: sin ella la pieza devuelta
  // en un cambio no restaria nada. El arnes lo comprobaba solo del lado del
  // suministro — el sintoma, no la defensa (AP-09).
  const consumo = read('./supabase/migrations/20260728005500_pos_h37_line_consumption_exchange.sql');
  ok('24b. line_consumption gana la rama de cambios (lado devuelto)',
    /create or replace view pos\.line_consumption/.test(consumo)
      && /union all/.test(consumo) && /lado = 'devuelto'/.test(consumo)
      && /security_invoker/.test(consumo));
  ok('25. la vista de suministro es interna, como line_consumption',
    /revoke all on pos\.line_supply/.test(mig) && /security_invoker/.test(mig));
  ok('26. amplía el tipo de pago de forma aditiva',
    /sale_payments/.test(mig) && /cambio/.test(mig) && !/drop table|truncate/i.test(mig));

  const ver = read('./supabase/migrations/20260728005600_pos_h37_exchange_model_verification.sql');
  ok('27. la verificación comprueba la defensa y limpia',
    /raise exception/.test(ver) && /line_supply/.test(ver) && /delete from pos\.exchanges/.test(ver));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
