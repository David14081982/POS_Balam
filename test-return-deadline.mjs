// test-return-deadline.mjs — H-34: plazo de posventa configurable y CONGELADO en la venta.
//
// Contrato bajo prueba:
//   • Configuración → Devoluciones administra "aplicar límite" y "días permitidos".
//   • Cada venta conserva el plazo VIGENTE AL CREARSE. Cambiar la configuración
//     después NO altera ninguna venta anterior.
//   • `DATA.returnDeadline(sale)` es la autoridad única del estado del plazo.
//   • Una venta vencida no admite devolución; una venta sin límite nunca vence.
//   • Los apartados arrancan su plazo al liquidarse, no al reservarse.
//
// Carga el módulo REAL balam/data.jsx en un contexto aislado con localStorage,
// CONFIG y CORE simulados y reloj controlable (mismo patrón que test-folio-diario).
//
// Uso: node test-return-deadline.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const src = readFileSync(new URL('./balam/data.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── Terminal simulada ────────────────────────────────────────────────────────
function terminal({ storage = new Map(), clock = '2026-07-28T10:00:00', device = 'dev-uno',
                    limitEnabled = false, limitDays = 15 } = {}) {
  const localStorage = {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k),
    clear: () => storage.clear(),
  };
  const settings = {
    'folio.prefix': 'BG', 'commission.base': 'neto', 'commission.basePct': 0,
    'returns.reverseCommission': false,
    'returns.limitEnabled': limitEnabled, 'returns.limitDays': limitDays,
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
  const syncCalls = [];
  let dataRef = null;
  const CORE = {
    getDeviceId: () => device,
    registerCatalogProducts: () => {},
    registerSyncGateway: () => {},
    invokeSync: (method, ...args) => {
      syncCalls.push({ method, args });
      if (method !== 'settleLayaway' || !dataRef) return undefined;
      const sale = args[0], effects = args[1] || {};
      const remoteProducts = [...new Set((sale.lineas || []).map(line => line.productId))]
        .map(id => JSON.parse(JSON.stringify(dataRef.products.find(p => p.id === id))));
      remoteProducts.forEach(product => (sale.lineas || []).filter(line => line.productId === product.id)
        .forEach(line => {
          const variant = product.stock.find(row => row.talla === line.talla);
          if (variant) variant.stock -= Number(line.qty) || 0;
        }));
      const movementRows = (sale.lineas || []).map((line, index) => ({
        id: 34000 + index, fecha: effects.payment.fecha, tipo: 'Venta',
        producto: line.nombre, productId: line.productId, sku: line.sku,
        talla: line.talla, cant: -line.qty, ref: sale.folio,
      }));
      const applied = dataRef.applySaleCommitResult('h34-commit-' + sale.folio, sale.folio, {
        sale, products: remoteProducts, payments: [effects.payment],
        movements: movementRows, sellers: [], stockReserved: true,
        stockIdempotent: false, reservationOperationId: sale._operationId,
      });
      return Promise.resolve({ ok: applied.ok, paymentId: effects.payment.id });
    },
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
    // H-65: la terminal simulada es un navegador con Web Locks y una sola
    // pestaña. Sin este contrato, DATA falla cerrado y ninguna liquidación
    // ocurre — que es exactamente lo que debe pasar donde no existe.
    navigator: { locks: { request: (name, opts, fn) => Promise.resolve(fn()) } },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  dataRef = sandbox.window.DATA;
  const t = {
    D: sandbox.window.DATA, CONFIG, storage, syncCalls, device,
    setClock: iso => { nowIso = iso; },
    set: (k, v) => { settings[k] = v; },
  };
  t.D.applyFolioBlock('BG', '260728', 1, 900);
  return t;
}

// Antes de la corrección la autoridad no existe: el arnés debe reportar el fallo,
// no abortar la corrida (así queda una línea base contable).
const deadline = (t, sale) => (typeof t.D.returnDeadline === 'function'
  ? t.D.returnDeadline(sale)
  : { status: 'no_implementado', label: '', days: null, daysLeft: null, expiresAt: null });

function producto(t, over = {}) {
  const p = Object.assign({
    id: 'p1', cat: 'GUA', manga: 'LAR', tela: 'LIN', color: 'BLA', cuello: 'NOR', modelo: '100',
    nombre: 'Guayabera', orn: '—', ornColors: [], precio: 1000, costo: 0, pop: false,
    stock: [{ talla: 'M', escala: 'L', stock: 40 }], sku: 'SKU-1',
  }, over);
  t.D.products.push(p);
  t.D.saveProducts(false);
  return p;
}
function vender(t, { fecha, estado = 'Pagado', metodo = 'Efectivo', total = 1000, anticipo } = {}) {
  const p = t.D.products[0] || producto(t);
  return t.D.recordSale({
    ticket: [{ p, talla: 'M', qty: 1 }], sellerIds: [], client: null,
    metodo, estado, total, anticipo, itemCount: 1, fecha,
  });
}

// ── 1-3) Sin límite: contrato histórico intacto ──────────────────────────────
{
  const t = terminal({ limitEnabled: false }); producto(t);
  const s = vender(t);
  ok('1. sin límite la venta no congela días', s.returnLimitDays == null, String(s.returnLimitDays));
  ok('2. sin límite la venta no tiene fecha de vencimiento', s.returnExpiresAt == null, String(s.returnExpiresAt));
  const d = deadline(t, s);
  ok('3. returnDeadline informa estado sin_limite', d.status === 'sin_limite' && d.label === 'Sin límite', JSON.stringify(d));
}

// ── 4-6) Con límite: el plazo se congela desde la fecha de la venta ──────────
{
  const t = terminal({ limitEnabled: true, limitDays: 15 }); producto(t);
  const s = vender(t);
  ok('4. la venta congela los días permitidos', s.returnLimitDays === 15, String(s.returnLimitDays));
  ok('5. la fecha de vencimiento es fecha de venta + días', s.returnExpiresAt === '2026-08-12', String(s.returnExpiresAt));
  const d = deadline(t, s);
  ok('6. el mismo día de la venta quedan 15 días', d.status === 'vigente' && d.daysLeft === 15, JSON.stringify(d));
}

// ── 7-9) Cambiar la configuración NO altera ventas anteriores ───────────────
{
  const t = terminal({ limitEnabled: true, limitDays: 15 }); producto(t);
  const vieja = vender(t);
  t.set('returns.limitDays', 30);
  const nueva = vender(t);
  ok('7. la venta anterior conserva su plazo original', vieja.returnLimitDays === 15 && vieja.returnExpiresAt === '2026-08-12',
    `${vieja.returnLimitDays}/${vieja.returnExpiresAt}`);
  ok('8. la venta nueva nace con el plazo nuevo', nueva.returnLimitDays === 30 && nueva.returnExpiresAt === '2026-08-27',
    `${nueva.returnLimitDays}/${nueva.returnExpiresAt}`);
  t.set('returns.limitEnabled', false);
  ok('9. apagar el límite no libera ventas ya emitidas',
    deadline(t, vieja).status === 'vigente' && deadline(t, vieja).days === 15);
}

// ── 10-13) Etiquetas de vencimiento ─────────────────────────────────────────
{
  const t = terminal({ limitEnabled: true, limitDays: 15 }); producto(t);
  const s = vender(t);
  t.setClock('2026-07-31T09:00:00');
  ok('10. faltan 12 días', deadline(t, s).label === 'Vence en 12 días', deadline(t, s).label);
  t.setClock('2026-08-12T23:00:00');
  const hoy = deadline(t, s);
  ok('11. el último día dice "Vence hoy" y sigue vigente', hoy.label === 'Vence hoy' && hoy.status === 'vigente', JSON.stringify(hoy));
  t.setClock('2026-08-15T08:00:00');
  const venc = deadline(t, s);
  ok('12. tres días después está vencido', venc.status === 'vencido' && venc.label === 'Vencido hace 3 días', JSON.stringify(venc));
  t.setClock('2026-08-13T00:30:00');
  ok('13. el día siguiente al vencimiento ya no es vigente', deadline(t, s).status === 'vencido', deadline(t, s).label);
}

// ── 14-16) El plazo se deriva de la fecha GUARDADA en la venta ──────────────
{
  const t = terminal({ limitEnabled: true, limitDays: 10 }); producto(t);
  const s = vender(t, { fecha: '2026-07-01 12:00' });
  ok('14. una venta con fecha pasada vence desde ESA fecha', s.returnExpiresAt === '2026-07-11', String(s.returnExpiresAt));
  ok('15. con el reloj en julio 28 esa venta ya está vencida', deadline(t, s).status === 'vencido');
  const cruce = vender(t, { fecha: '2026-12-28 23:50' });
  ok('16. el plazo cruza el fin de año sin error de calendario', cruce.returnExpiresAt === '2027-01-07', String(cruce.returnExpiresAt));
}

// ── 17-19) La devolución respeta el plazo ───────────────────────────────────
{
  const t = terminal({ limitEnabled: true, limitDays: 15 }); producto(t);
  const s = vender(t);
  const linea = { sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, motivo: 'Talla' };
  t.setClock('2026-08-12T18:00:00');
  const enPlazo = t.D.recordReturn({ folio: s.folio, lineas: [linea], metodo: 'Efectivo' });
  ok('17. el último día del plazo la devolución se acepta', enPlazo.ok === true, enPlazo.error || '');

  const t2 = terminal({ limitEnabled: true, limitDays: 15 }); producto(t2);
  const s2 = vender(t2);
  t2.setClock('2026-08-20T10:00:00');
  const fuera = t2.D.recordReturn({ folio: s2.folio, lineas: [linea], metodo: 'Efectivo' });
  ok('18. fuera del plazo la devolución se rechaza', fuera.ok === false && /plazo/i.test(fuera.error || ''), fuera.error || '');
  ok('19. el rechazo no reingresó stock ni creó devolución',
    t2.D.returns.length === 0 && t2.D.products[0].stock[0].stock === 39,
    `${t2.D.returns.length} dev · stock ${t2.D.products[0].stock[0].stock}`);
}

// ── 20-21) Sin límite nunca vence, por antigua que sea la venta ─────────────
{
  const t = terminal({ limitEnabled: false }); producto(t);
  const s = vender(t, { fecha: '2019-01-05 10:00' });
  t.setClock('2026-07-28T10:00:00');
  ok('20. una venta sin límite de 2019 sigue vigente', deadline(t, s).status === 'sin_limite');
  const linea = { sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, motivo: 'Talla' };
  const r = t.D.recordReturn({ folio: s.folio, lineas: [linea], metodo: 'Efectivo' });
  ok('21. y admite devolución', r.ok === true, r.error || '');
}

// ── 22-23) Compatibilidad histórica: ventas anteriores a H-34 ──────────────
{
  const t = terminal({ limitEnabled: true, limitDays: 15 }); producto(t);
  const historica = {
    folio: 'BG-5-8TD4Q6N7QPWZQAZVUYPYCQP0H', fecha: '2026-07-01 11:00', cliente: 'Público en general',
    vendedores: [], items: 1, total: 1000, metodo: 'Efectivo', estado: 'Pagado',
    lineas: [{ sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, precio: 1000 }],
  };
  t.D.sales.push(historica);
  ok('22. una venta sin campos de plazo se trata como sin límite',
    deadline(t, historica).status === 'sin_limite', JSON.stringify(deadline(t, historica)));
  const linea = { sku: 'SKU-1', nombre: 'Guayabera', talla: 'M', qty: 1, motivo: 'Talla' };
  const r = t.D.recordReturn({ folio: historica.folio, lineas: [linea], metodo: 'Efectivo' });
  ok('23. y sigue siendo devolvible', r.ok === true, r.error || '');
}

// ── 24-26) Apartado: el plazo arranca al liquidar, no al reservar ───────────
{
  const t = terminal({ limitEnabled: true, limitDays: 15 }); producto(t);
  const s = vender(t, { metodo: 'Apartado', estado: 'Apartado', total: 1000, anticipo: 200 });
  ok('24. el apartado congela los días pero aún no la fecha',
    s.returnLimitDays === 15 && s.returnExpiresAt == null, `${s.returnLimitDays}/${s.returnExpiresAt}`);
  ok('25. su estado de plazo es "pendiente"', deadline(t, s).status === 'pendiente', JSON.stringify(deadline(t, s)));
  t.setClock('2026-08-20T10:00:00');
  const liquidated = await t.D.registrarPagoApartado(s.folio, { monto: 800, metodo: 'Efectivo', detalle: { efectivo: 800 } });
  ok('26. al liquidarse el plazo arranca desde la liquidación',
    liquidated.sale && liquidated.sale.estado === 'Pagado'
      && liquidated.sale.returnExpiresAt === '2026-09-04',
    `${(liquidated.sale || {}).estado}/${(liquidated.sale || {}).returnExpiresAt}`);
}

// ── 27-29) Normalización de la configuración ────────────────────────────────
{
  const t = terminal({ limitEnabled: true, limitDays: 0 }); producto(t);
  ok('27. cero días se trata como "sin límite" (no vence al instante)', vender(t).returnLimitDays == null);
  const t2 = terminal({ limitEnabled: true, limitDays: -5 }); producto(t2);
  ok('28. un valor negativo no produce plazo', vender(t2).returnLimitDays == null);
  const t3 = terminal({ limitEnabled: true, limitDays: '20' }); producto(t3);
  ok('29. un valor numérico en texto se normaliza', vender(t3).returnLimitDays === 20, String(vender(t3).returnLimitDays));
}

// ── 30-32) El plazo viaja a la nube ─────────────────────────────────────────
{
  const store = read('./balam/store.jsx');
  ok('30. pushSale envía el plazo congelado', /return_limit_days/.test(store) && /return_expires_at/.test(store));
  ok('31. el envío es condicional, como el resto de campos opcionales',
    /if \(sale\.returnLimitDays != null\) header\.return_limit_days/.test(store));
  ok('32. el pull reconstruye el plazo desde la fila remota',
    /returnLimitDays: r\.return_limit_days/.test(store) && /returnExpiresAt: r\.return_expires_at/.test(store));
}

// ── 33-35) Migración y verificación ─────────────────────────────────────────
{
  let mig = '', ver = '';
  try { mig = read('./supabase/migrations/20260728004500_pos_h34_return_deadline.sql'); } catch (e) { /* aún no existe */ }
  try { ver = read('./supabase/migrations/20260728004600_pos_h34_return_deadline_verification.sql'); } catch (e) { /* aún no existe */ }
  ok('33. la migración agrega las dos columnas a pos.sales',
    /add column if not exists return_limit_days/.test(mig) && /add column if not exists return_expires_at/.test(mig));
  ok('34. commit_sale persiste el plazo sin cambiar su firma',
    /create or replace function pos\.commit_sale/.test(mig) && /return_limit_days/.test(mig) && /return_expires_at/.test(mig));
  ok('35. existe la migración de verificación del contrato',
    /h34/.test(ver) && /return_expires_at/.test(ver));
}

// ── 36-38) Interfaz: configuración y filtros ────────────────────────────────
{
  const settings = read('./balam/settings.jsx');
  ok('36. Configuración → Devoluciones expone límite y días',
    /returns\.limitEnabled/.test(settings) && /returns\.limitDays/.test(settings));
  const returns = read('./balam/returns.jsx');
  ok('37. Devoluciones filtra por vigentes / vencidos / sin límite / todos',
    /vigente/.test(returns) && /vencido/.test(returns) && /sin_limite/.test(returns) && /todos/.test(returns));
  ok('38. Devoluciones muestra la etiqueta del plazo de cada venta',
    /returnDeadline/.test(returns));
}

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
