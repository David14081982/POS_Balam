// test-folio-diario.mjs — H-33: folio comercial corto {PREFIJO}-{AAMMDD}-{0001},
// folio provisional con código de terminal y alias histórico del folio impreso.
//
// Carga el módulo REAL balam/data.jsx dentro de un contexto aislado con
// localStorage, CONFIG y CORE simulados, y con un reloj controlable. No
// reimplementa la generación del folio: prueba la autoridad única real.
//
// Uso: node test-folio-diario.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const src = readFileSync(new URL('./balam/data.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── Terminal simulada ────────────────────────────────────────────────────────
// `storage` puede compartirse entre dos arranques (misma terminal que recarga) o
// crearse vacío (terminal distinta / reinstalación). `device` distingue terminales.
function terminal({ storage = new Map(), prefix = 'BG', clock = '2026-07-27T10:00:00', device = 'dev-uno' } = {}) {
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
    clear: () => storage.clear(),
  };
  const settings = { 'folio.prefix': prefix, 'commission.base': 'neto', 'commission.basePct': 0, 'returns.reverseCommission': false };
  const CONFIG = {
    get: k => settings[k],
    setSetting: (k, v) => { settings[k] = v; },
    map: () => ({}), metaMap: () => ({}), codes: kind => (kind === 'size_letter' ? ['CH', 'M', 'G'] : []),
    list: kind => (kind === 'payment_method' ? [{ code: 'Efectivo' }, { code: 'Tarjeta' }, { code: 'Apartado' }] : []),
    all: () => [], find: () => null,
  };
  const syncCalls = [];
  const CORE = {
    getDeviceId: () => device,
    registerCatalogProducts: () => {},
    registerSyncGateway: () => {},
    invokeSync: (method, ...args) => { syncCalls.push({ method, args }); },
  };
  let nowIso = clock;
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(nowIso); }
    static now() { return new FakeDate().getTime(); }
  }
  const sandbox = {
    console, localStorage, Date: FakeDate,
    setTimeout, clearTimeout, JSON, Math, Object, Array, String, Number, Boolean, isNaN, parseInt, parseFloat, BigInt, RegExp, Error, Set, Map,
  };
  sandbox.window = {
    CONFIG, CORE, localStorage, UI: { toast: () => {} },
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true,
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return {
    D: sandbox.window.DATA,
    CONFIG, storage, syncCalls, device,
    setClock: iso => { nowIso = iso; },
  };
}

// Venta mínima real: producto con existencias, pago en efectivo.
function producto(t, over = {}) {
  const p = Object.assign({
    id: 'p1', cat: 'GUA', manga: 'LAR', tela: 'LIN', color: 'BLA', cuello: 'NOR', modelo: '100',
    nombre: 'Guayabera', orn: '—', ornColors: [], precio: 1000, costo: 0, pop: false,
    stock: [{ talla: 'M', escala: 'L', stock: 40 }], sku: 'SKU-1',
  }, over);
  t.D.products.push(p);
  return p;
}
function vender(t, { fecha } = {}) {
  const p = t.D.products[0] || producto(t);
  return t.D.recordSale({
    ticket: [{ p, talla: 'M', qty: 1 }], sellerIds: [], client: null,
    metodo: 'Efectivo', estado: 'Pagado', total: 1000, itemCount: 1, fecha,
  });
}
// Terminal conectada: el contador diario ya le entregó un bloque.
function conBloque(t, date, from = 1, to = 50, prefix = 'BG') { t.D.applyFolioBlock(prefix, date, from, to); return t; }

// ── 1-3) Consecutivo diario y reinicio por día (terminal con bloque) ─────────
{
  const t = terminal(); producto(t); conBloque(t, '260727');
  const a = vender(t), b = vender(t);
  ok('1. primera venta del día usa el consecutivo 0001', a.folio === 'BG-260727-0001', a.folio);
  ok('2. la segunda venta del mismo día avanza a 0002', b.folio === 'BG-260727-0002', b.folio);
  t.setClock('2026-07-28T09:00:00');
  conBloque(t, '260728');
  const c = vender(t);
  ok('3. al cambiar de día el consecutivo reinicia en 0001', c.folio === 'BG-260728-0001', c.folio);
  ok('3b. el folio no contiene identificadores técnicos', /^BG-\d{6}-\d{4}$/.test(c.folio) && !c.folio.includes(c._operationId), c.folio);
  ok('3c. la identidad técnica sigue existiendo y es distinta del folio',
    typeof c._operationId === 'string' && c._operationId.length > 10 && c._operationId !== c.folio);
  ok('3d. con bloque disponible el folio NO lleva sufijo de terminal',
    [a, b, c].every(s => t.D.parseFolio(s.folio).provisional === false));
}

// ── 4-5) Prefijo configurable ────────────────────────────────────────────────
{
  const t = terminal({ prefix: 'AB' }); producto(t); conBloque(t, '260727', 1, 50, 'AB');
  const a = vender(t);
  ok('4. el prefijo configurado se usa tal cual', a.folio === 'AB-260727-0001', a.folio);

  t.CONFIG.setSetting('folio.prefix', ' cd-x ');
  t.D.applyFolioBlock('CDX', '260727', 1, 50);
  const b = vender(t);
  ok('4b. el prefijo se normaliza (mayúsculas, sin espacios ni signos)', b.folio === 'CDX-260727-0001', b.folio);
  ok('5. cambiar el prefijo NO altera la venta anterior', a.folio === 'AB-260727-0001', a.folio);
  ok('5b. el prefijo largo se acota a 6 caracteres',
    t.D.normalizeFolioPrefix('abcdefghij') === 'ABCDEF', t.D.normalizeFolioPrefix('abcdefghij'));
  ok('5c. un prefijo vacío o inválido conserva un valor utilizable',
    t.D.normalizeFolioPrefix('  ') === 'BG' && t.D.normalizeFolioPrefix('---') === 'BG');
  ok('5d. la vista previa muestra el folio real del día',
    t.D.folioPreview('bg') === 'BG-260727-0001', t.D.folioPreview('bg'));
}

// ── 6) Compatibilidad histórica H-02 ─────────────────────────────────────────
{
  const t = terminal(); producto(t); conBloque(t, '260727');
  const historico = { folio: 'BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H', fecha: '2026-07-20 10:00', total: 100, lineas: [], estado: 'Pagado' };
  t.D.sales.push(historico);
  const nueva = vender(t);
  ok('6. una venta histórica con folio largo permanece intacta',
    t.D.sales.find(s => s.folio === 'BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H') === historico);
  ok('6b. el folio histórico no altera el consecutivo del día nuevo', nueva.folio === 'BG-260727-0001', nueva.folio);
  ok('6c. el folio histórico no se interpreta como formato nuevo', t.D.parseFolio(historico.folio) === null);
  ok('6d. el folio nuevo sí se interpreta',
    JSON.stringify(t.D.parseFolio('BG-260727-0007')) === JSON.stringify({ prefix: 'BG', date: '260727', seq: 7, terminal: null, provisional: false }));
  ok('6e. una venta histórica se localiza por su folio exacto',
    t.D.findSaleByFolio('BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H') === historico);
}

// ── 7) Dos ventas seguidas dentro del mismo instante ─────────────────────────
{
  const t = terminal(); producto(t); conBloque(t, '260727');
  const folios = [vender(t).folio, vender(t).folio, vender(t).folio];
  ok('7. tres ventas en el mismo instante reciben folios distintos y consecutivos',
    new Set(folios).size === 3 && folios.join(',') === 'BG-260727-0001,BG-260727-0002,BG-260727-0003', folios.join(' '));
}

// ── 8) Dos terminales con bloques reservados ─────────────────────────────────
{
  const a = terminal({ device: 'dev-a' }); producto(a);
  const b = terminal({ device: 'dev-b' }); producto(b);
  a.D.applyFolioBlock('BG', '260727', 1, 10);
  b.D.applyFolioBlock('BG', '260727', 11, 20);
  const fa = [vender(a).folio, vender(a).folio];
  const fb = [vender(b).folio, vender(b).folio];
  ok('8. dos terminales con bloques del servidor no colisionan',
    new Set(fa.concat(fb)).size === 4 && fa[0] === 'BG-260727-0001' && fb[0] === 'BG-260727-0011',
    fa.concat(fb).join(' '));
  a.D.applyFolioBlock('BG', '260727', 21, 22);
  ok('8b. un bloque nuevo continúa la numeración sin repetir', vender(a).folio === 'BG-260727-0021');
  ok('8c. un bloque atrasado se rechaza y no repite números',
    a.D.applyFolioBlock('BG', '260727', 5, 9) === false);
}

// ── 9) Dos terminales SIN bloque y SIN conexión ──────────────────────────────
{
  const a = terminal({ device: 'dev-uno' }); producto(a);
  const b = terminal({ device: 'dev-dos' }); producto(b);
  const fa = vender(a), fb = vender(b);
  const pa = a.D.parseFolio(fa.folio), pb = b.D.parseFolio(fb.folio);
  ok('9. sin bloque el folio es provisional y lleva código de terminal',
    pa.provisional && pb.provisional && /^BG-260727-0001-[A-Z0-9]{3}$/.test(fa.folio), `${fa.folio} / ${fb.folio}`);
  ok('9a. dos terminales offline sin bloque NO imprimen la misma cadena',
    fa.folio !== fb.folio, `${fa.folio} / ${fb.folio}`);
  ok('9b. los códigos de terminal son distintos entre terminales',
    pa.terminal !== pb.terminal, `${pa.terminal} / ${pb.terminal}`);
  ok('9c. el código de terminal es estable en la misma terminal',
    a.D.terminalCode('dev-uno') === a.D.terminalCode('dev-uno')
      && a.D.terminalCode('dev-uno') === b.D.terminalCode('dev-uno'));
  ok('9d. el folio provisional sigue siendo corto', fa.folio.length === 18, `${fa.folio.length}`);
  ok('9e. el folio provisional consecutivo avanza en la misma terminal',
    vender(a).folio === 'BG-260727-0002-' + pa.terminal);
  ok('9f. la venta pide reposición del bloque en segundo plano',
    a.syncCalls.some(c => c.method === 'ensureFolioBlock'));
  const req = a.D.folioBlockRequest();
  ok('9g. la solicitud de bloque declara prefijo, día y piso conocido',
    req.prefix === 'BG' && req.date === '260727' && req.floor >= 2 && req.needed === true,
    JSON.stringify(req));
  // Al llegar el bloque, las ventas siguientes ya no llevan sufijo y las
  // provisionales NO se renombran.
  a.D.applyFolioBlock('BG', '260727', 30, 40);
  const conRed = vender(a);
  ok('9h. con bloque nuevo la venta siguiente vuelve al formato limpio',
    conRed.folio === 'BG-260727-0030', conRed.folio);
  ok('9i. la venta provisional anterior conserva su folio impreso',
    a.D.sales.some(s => s.folio === fa.folio));
}

// ── 10) Reinstalación ────────────────────────────────────────────────────────
{
  const compartido = new Map();
  const primera = terminal({ storage: compartido }); producto(primera);
  primera.D.applyFolioBlock('BG', '260727', 1, 10);
  const antes = [vender(primera).folio, vender(primera).folio];
  compartido.clear();
  const limpia = terminal({ storage: compartido }); producto(limpia);
  limpia.D.applyFolioBlock('BG', '260727', 11, 20);
  const despues = vender(limpia).folio;
  ok('10. tras reinstalar, el bloque del servidor evita reutilizar un folio',
    !antes.includes(despues) && despues === 'BG-260727-0011', `${antes.join(' ')} / ${despues}`);

  const compartido2 = new Map();
  const sinBloque = terminal({ storage: compartido2 }); producto(sinBloque);
  sinBloque.D.sales.push({ folio: 'BG-260727-0004', fecha: '2026-07-27 09:00', total: 1, lineas: [] });
  ok('10b. sin bloque, el mayor folio conocido del día es el piso',
    sinBloque.D.parseFolio(vender(sinBloque).folio).seq === 5);
}

// ── 11) Más de 9999 ventas en un día ─────────────────────────────────────────
{
  const t = terminal(); producto(t);
  t.D.applyFolioBlock('BG', '260727', 9999, 10002);
  const f = [vender(t).folio, vender(t).folio, vender(t).folio];
  ok('11. el consecutivo pasa de 9999 sin truncar ni repetir',
    f.join(',') === 'BG-260727-9999,BG-260727-10000,BG-260727-10001', f.join(' '));
  ok('11b. un folio de cinco dígitos se sigue interpretando',
    t.D.parseFolio('BG-260727-10000').seq === 10000);
}

// ── 12) Medianoche ───────────────────────────────────────────────────────────
{
  const t = terminal({ clock: '2026-07-27T23:59:59' }); producto(t);
  conBloque(t, '260727');
  const a = vender(t);
  ok('12. una venta a las 23:59 usa el día que se guarda en la venta',
    a.folio === 'BG-260727-0001' && a.fecha.startsWith('2026-07-27'), `${a.folio} / ${a.fecha}`);
  t.setClock('2026-07-28T00:00:01');
  conBloque(t, '260728');
  const b = vender(t);
  ok('12b. la venta siguiente, ya pasada la medianoche, abre el día nuevo',
    b.folio === 'BG-260728-0001' && b.fecha.startsWith('2026-07-28'), `${b.folio} / ${b.fecha}`);
  const c = vender(t, { fecha: '2026-07-26 18:30' });
  ok('12c. una venta con fecha explícita usa ese día en el folio',
    t.D.parseFolio(c.folio).date === '260726' && c.fecha === '2026-07-26 18:30', `${c.folio} / ${c.fecha}`);
}

// ── 13) Pagos, movimientos y devoluciones ligados a la venta ────────────────
{
  const t = terminal(); producto(t); conBloque(t, '260727');
  const v = vender(t);
  const pagos = t.D.paymentsForSale(v.folio);
  const movs = t.D.movements.filter(m => m.ref === v.folio);
  ok('13. el pago de la venta queda ligado al folio nuevo', pagos.length === 1 && pagos[0].monto === 1000);
  ok('13b. el movimiento de inventario referencia el folio nuevo', movs.length === 1 && movs[0].cant === -1);
  const dev = t.D.recordReturn({
    folio: v.folio,
    lineas: [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, motivo: 'Talla', precio: 1000 }],
    metodo: 'Efectivo',
  });
  ok('13c. la devolución se registra contra el mismo folio y no crea otro',
    dev.ok === true && dev.ret.folio === v.folio && t.D.returnsForFolio(v.folio).length === 1,
    dev.error || (dev.ret && dev.ret.folio));
  ok('13d. la devolución no cambió el folio de la venta', t.D.sales[0].folio === v.folio);
}

// ── 14) Longitud imprimible ──────────────────────────────────────────────────
{
  const t = terminal(); producto(t); conBloque(t, '260727');
  const f = vender(t).folio;
  ok('14. el folio cabe en una línea de ticket', f.length === 14 && f.length <= 20, `${f} (${f.length})`);
  ok('14b. es más corto que el formato anterior', f.length < 'BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H'.length);
}

// ── 15) Alias histórico del folio impreso ────────────────────────────────────
{
  const t = terminal(); producto(t); // sin bloque: folio provisional impreso
  const v = vender(t);
  const impreso = v.folio;
  ok('15. el folio impreso es provisional y definitivo mientras no haya conflicto',
    t.D.saleFolioAliases(v).length === 0 && t.D.findSaleByFolio(impreso) === v, impreso);

  // Residuo: la nube rechaza el folio (otra terminal con el mismo código) y la
  // venta se reidentifica con un número del contador.
  const rekeyed = t.D.rekeySaleFolio(v._operationId, impreso, 'BG-260727-0022');
  ok('15a. la reidentificación sólo ocurre antes de confirmar en la nube', rekeyed === true);
  ok('15b. el folio impreso queda guardado como alias, no se pierde',
    t.D.saleFolioAliases(v).join(',') === impreso && v.folio === 'BG-260727-0022',
    `${v.folio} ← ${t.D.saleFolioAliases(v).join(',')}`);
  ok('15c. el alias persiste en el almacenamiento local',
    JSON.parse(t.storage.get('balam_pos_sales_v1'))[0].folioAliases.includes(impreso));
  ok('15d. la búsqueda por el folio impreso encuentra la venta', t.D.findSaleByFolio(impreso) === v);
  ok('15e. la búsqueda por el folio vigente también la encuentra',
    t.D.findSaleByFolio('BG-260727-0022') === v);
  ok('15f. el mensaje de folio actual se activa sólo al resolver por alias',
    t.D.folioAliasHit(v, impreso) === impreso && t.D.folioAliasHit(v, 'BG-260727-0022') === null);
  ok('15g. pagos y movimientos siguieron a la venta',
    t.D.paymentsForSale('BG-260727-0022').length === 1
      && t.D.movements.filter(m => m.ref === 'BG-260727-0022').length === 1
      && t.D.paymentsForSale(impreso).length === 0);
  // Devolución presentando el ticket impreso.
  const sale = t.D.findSaleByFolio(impreso);
  const dev = t.D.recordReturn({
    folio: sale.folio,
    lineas: [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, motivo: 'Talla', precio: 1000 }],
    metodo: 'Efectivo',
  });
  ok('15h. se puede devolver presentando el ticket impreso',
    dev.ok === true && dev.ret.folio === 'BG-260727-0022', dev.error || dev.ret.folio);
  ok('15i. una venta ya confirmada en la nube nunca se renombra',
    (() => { const s = t.D.sales[0]; s._syncStatus = 'synced'; return t.D.rekeySaleFolio(s._operationId, s.folio, 'BG-260727-0099') === false; })());
}

// ── 16) El alias NO se resuelve contra la venta ajena ────────────────────────
{
  const t = terminal(); producto(t); conBloque(t, '260727');
  const ajena = vender(t); // BG-260727-0001, de otra terminal tras el pull
  const propia = vender(t);
  t.D.rekeySaleFolio(propia._operationId, propia.folio, 'BG-260727-0050');
  propia.folioAliases = ['BG-260727-0001']; // mismo texto que el folio vigente de `ajena`
  ok('16. una cadena que es folio vigente de otra venta resuelve a ESA venta',
    t.D.findSaleByFolio('BG-260727-0001') === ajena, ajena.folio);
  ok('16b. el alias sólo resuelve cuando ninguna venta tiene ese folio vigente',
    t.D.findSaleByFolio('BG-260727-0050') === propia);
}

// ── 17) Búsqueda mixta (misma expresión real de Devoluciones) ───────────────
{
  const t = terminal(); producto(t); conBloque(t, '260727');
  const nueva = vender(t);
  nueva.folioAliases = ['BG-260727-0007-K7Q'];
  const viejo = { folio: 'BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H', cliente: 'Ana' };
  const buscar = (term) => [t.D.sales[0], viejo].filter(s =>
    !term
    || String(s.folio).toLowerCase().includes(term)
    || t.D.saleFolioAliases(s).some(a => String(a).toLowerCase().includes(term))
    || String(s.cliente || '').toLowerCase().includes(term));
  ok('17. la búsqueda encuentra el folio nuevo', buscar('260727-0001').length === 1);
  ok('17b. la búsqueda sigue encontrando un folio antiguo', buscar('bg-5-8td4').length === 1);
  ok('17c. la búsqueda encuentra por el folio impreso conservado como alias',
    buscar('0007-k7q').length === 1 && buscar('0007-k7q')[0] === nueva);
  ok('17d. ambos formatos conviven en el mismo listado', buscar('bg-').length === 2, nueva.folio);
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
