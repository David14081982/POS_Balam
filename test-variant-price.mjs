// test-variant-price.mjs — H-36: precio general del artículo con excepciones por talla.
//
// Contrato bajo prueba:
//   • `DATA.listPrice(producto, talla)` es la única respuesta a «¿cuánto cuesta
//     esta talla antes de promociones?». Sin excepciones devuelve `producto.precio`.
//   • `DATA.priceRange(producto)` es una DERIVADA de listPrice sobre las tallas
//     con existencias; no reimplementa la resolución.
//   • El renglón es dueño de su precio (H-32): la resolución, el descuento de la
//     venta y `precioOrig` salen de la autoridad, nunca de `producto.precio`.
//   • Una excepción es un precio explícito: cambiar el precio general no la mueve.
//   • `{}` = todas las tallas valen el precio general. Es el estado histórico.
//
// Carga los módulos REALES balam/data.jsx y balam/discounts.jsx en un contexto
// aislado (mismo patrón que test-line-balance.mjs / test-return-deadline.mjs).
//
// Uso: node test-variant-price.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, eps = 0.005) => Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(b)) <= eps;
const read = (rel) => { try { return readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; } };

const dataSrc = read('./balam/data.jsx');
const promoSrc = read('./balam/discounts.jsx');

const TALLAS = ['XS', 'M', 'G', 'XL'];

function terminal({ minMargin = 0 } = {}) {
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
    'discount.minMarginPct': minMargin,
  };
  const CONFIG = {
    get: k => settings[k],
    setSetting: (k, v) => { settings[k] = v; },
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
  const nowIso = '2026-07-28T10:00:00';
  class FakeDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(nowIso); }
    static now() { return new FakeDate().getTime(); }
  }
  const noop = () => {};
  const React = { createElement: () => ({}), useState: () => [0, noop], useEffect: noop, useMemo: f => f() };
  const sandbox = {
    console, localStorage, Date: FakeDate, React,
    setTimeout, clearTimeout, JSON, Math, Object, Array, String, Number, Boolean,
    isNaN, parseInt, parseFloat, BigInt, RegExp, Error, Set, Map,
  };
  sandbox.window = {
    CONFIG, CORE, localStorage,
    UI: { toast: noop, fmt: n => '$' + Number(n).toFixed(2), ToastHost: noop },
    HX: { MS: noop },
    addEventListener: noop, removeEventListener: noop, dispatchEvent: () => true,
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(16).slice(2) },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(dataSrc, sandbox);
  vm.runInContext(promoSrc, sandbox);   // PROMOS necesita window.DATA ya publicado
  const t = { D: sandbox.window.DATA, P: sandbox.window.PROMOS, CONFIG, settings };
  if (typeof t.D.applyFolioBlock === 'function') t.D.applyFolioBlock('BG', '260728', 1, 900);
  return t;
}

// La autoridad puede no existir antes de la corrección: el arnés reporta el
// fallo en vez de abortar, para dejar una línea base contable.
const listPrice = (t, p, talla) => (typeof t.D.listPrice === 'function' ? t.D.listPrice(p, talla) : undefined);
const priceRange = (t, p) => (typeof t.D.priceRange === 'function' ? t.D.priceRange(p) : undefined);

function producto(t, over = {}) {
  const p = Object.assign({
    id: 'p1', cat: 'GUA', manga: 'LAR', tela: 'LIN', color: 'BLA', cuello: 'NOR', modelo: '100',
    nombre: 'Guayabera', orn: '—', ornColors: [], precio: 350, costo: 0, pop: false,
    stock: TALLAS.map(talla => ({ talla, escala: 'L', stock: 10 })),
    sku: 'GUA-LAR-LIN-BLA-T',
  }, over);
  t.D.products.push(p);
  return p;
}
function promo(tipo, valor, scope = {}) {
  return { id: 'pr-' + Math.random().toString(16).slice(2), nombre: 'Promo', tipo, valor,
    inicio: '', fin: '', horaInicio: '', horaFin: '', pausado: false, scope };
}
// Vende las líneas cobrando EXACTAMENTE lo que el negocio espera de cada talla.
function vender(t, lineas, esperadoPorLinea) {
  const ticket = lineas.map(l => ({ p: l.p, talla: l.talla, qty: l.qty }));
  const total = esperadoPorLinea.reduce((a, unit, i) => a + unit * lineas[i].qty, 0);
  return t.D.recordSale({
    ticket, sellerIds: [], client: null, metodo: 'Efectivo', estado: 'Pagado',
    total, itemCount: ticket.reduce((a, l) => a + l.qty, 0),
  });
}

console.log('\n── A) Autoridad listPrice ───────────────────────────────');
{
  const t = terminal();
  const p = producto(t);
  ok('1. sin excepciones, todas las tallas valen el precio general',
    TALLAS.every(talla => near(listPrice(t, p, talla), 350)),
    TALLAS.map(x => `${x}=${listPrice(t, p, x)}`).join(' '));

  p.preciosTalla = { XL: 450 };
  ok('2. la excepción aplica sólo a su talla', near(listPrice(t, p, 'XL'), 450));
  ok('3. las demás tallas conservan el precio general',
    near(listPrice(t, p, 'M'), 350) && near(listPrice(t, p, 'G'), 350));

  p.precio = 400;
  ok('4. cambiar el precio general NO arrastra la excepción',
    near(listPrice(t, p, 'XL'), 450) && near(listPrice(t, p, 'M'), 400));

  ok('5. talla ausente del mapa cae al precio general (lectura tolerante)',
    near(listPrice(t, p, 'TALLA-QUE-NO-EXISTE'), 400));

  p.precio = 350; p.preciosTalla = { XS: 0 };
  ok('6. una excepción de $0 es un precio explícito, no una ausencia',
    near(listPrice(t, p, 'XS'), 0));
}

console.log('\n── B) Rango del catálogo (derivada) ─────────────────────');
{
  const t = terminal();
  const p = producto(t);
  const r1 = priceRange(t, p) || {};
  ok('7. sin excepciones el rango es único', r1.unico === true && near(r1.min, 350) && near(r1.max, 350),
    JSON.stringify(r1));

  p.preciosTalla = { XL: 450 };
  const r2 = priceRange(t, p) || {};
  ok('8. con excepciones el rango es min–max', r2.unico === false && near(r2.min, 350) && near(r2.max, 450),
    JSON.stringify(r2));

  p.stock = p.stock.map(v => (v.talla === 'XL' ? { ...v, stock: 0 } : v));
  const r3 = priceRange(t, p) || {};
  ok('9. el rango sólo mira tallas con existencias', r3.unico === true && near(r3.max, 350),
    JSON.stringify(r3));

  p.stock = p.stock.map(v => ({ ...v, stock: 0 }));
  const r4 = priceRange(t, p) || {};
  ok('10. sin existencias el rango cae al precio general', near(r4.min, 350) && near(r4.max, 350),
    JSON.stringify(r4));
}

console.log('\n── C) Resolución del renglón ────────────────────────────');
{
  const t = terminal();
  const p = producto(t, { preciosTalla: { XL: 450 } });
  const rM = t.D.resolveLineDiscount(p, 'M');
  const rXL = t.D.resolveLineDiscount(p, 'XL');
  ok('11. resolveLineDiscount toma el precio de la talla', near(rM.orig, 350) && near(rXL.orig, 450),
    `M=${rM.orig} XL=${rXL.orig}`);
  ok('12. sin promoción, unit = orig de su talla', near(rM.unit, 350) && near(rXL.unit, 450));

  t.D.promos.push(promo('pct', 10));
  const dM = t.D.resolveLineDiscount(p, 'M');
  const dXL = t.D.resolveLineDiscount(p, 'XL');
  ok('13. la promoción porcentual aplica sobre el precio de la talla',
    near(dM.unit, 315) && near(dXL.unit, 405), `M=${dM.unit} XL=${dXL.unit}`);
  ok('14. la evidencia de la promoción se conserva por renglón (H-32)',
    Array.isArray(dXL.promos) && dXL.promos.length === 1 && dXL.promos[0].valor === 10);

  t.D.promos.length = 0;
  t.D.promos.push(promo('fijo', 100));
  const fM = t.D.resolveLineDiscount(p, 'M');
  const fXL = t.D.resolveLineDiscount(p, 'XL');
  ok('15. el monto fijo descuenta lo mismo en ambas tallas',
    near(fM.unit, 250) && near(fXL.unit, 350), `M=${fM.unit} XL=${fXL.unit}`);
}

console.log('\n── D) Piso de margen con costo del artículo ─────────────');
{
  const t = terminal({ minMargin: 45 });
  const p = producto(t, { precio: 350, costo: 158, preciosTalla: { XL: 450 } });
  t.D.promos.push(promo('pct', 40));
  const rXL = t.D.resolveLineDiscount(p, 'XL');
  // floor = 158/0.55 = 287.27, acotado por el precio de la talla. 450*0.6 = 270 < 287.27.
  ok('16. el piso usa el costo del artículo y acota contra el precio de la talla',
    near(rXL.unit, 287.27), `unit=${rXL.unit} (residual declarado en H-36)`);
  const rM = t.D.resolveLineDiscount(p, 'M');
  ok('17. el piso no altera la talla al precio general', near(rM.unit, 287.27), `unit=${rM.unit}`);
}

console.log('\n── E) Venta: descuento y evidencia congelada ────────────');
{
  const t = terminal();
  const p = producto(t, { preciosTalla: { XL: 450 } });
  const venta = vender(t, [{ p, talla: 'M', qty: 1 }, { p, talla: 'XL', qty: 1 }], [350, 450]);
  ok('18. sin promoción, la venta con tallas de distinto precio no genera descuento',
    near(venta.descuento, 0), `descuento=${venta.descuento}`);
  const lM = (venta.lineas || []).find(l => l.talla === 'M') || {};
  const lXL = (venta.lineas || []).find(l => l.talla === 'XL') || {};
  ok('19. precioOrig congela el precio de SU talla',
    near(lM.precioOrig, 350) && near(lXL.precioOrig, 450),
    `M=${lM.precioOrig} XL=${lXL.precioOrig}`);
  ok('20. el total cobrado corresponde a los precios por talla', near(venta.total, 800));
}
{
  // Excepción MÁS BARATA que el precio general: es el caso que hoy inventaría
  // un descuento inexistente, porque subtotalOrig usa el precio del artículo.
  const t = terminal();
  const p = producto(t, { preciosTalla: { XS: 300 } });
  const venta = vender(t, [{ p, talla: 'M', qty: 1 }, { p, talla: 'XS', qty: 1 }], [350, 300]);
  ok('21. una excepción más barata NO inventa un descuento', near(venta.descuento, 0),
    `descuento=${venta.descuento} (esperado 0)`);
}
{
  const t = terminal();
  const p = producto(t, { preciosTalla: { XL: 450 } });
  t.D.promos.push(promo('pct', 10));
  const venta = vender(t, [{ p, talla: 'M', qty: 1 }, { p, talla: 'XL', qty: 1 }], [315, 405]);
  ok('22. con promoción el descuento suma (orig − unit) de cada talla',
    near(venta.descuento, 80), `descuento=${venta.descuento} (esperado 35+45)`);
}

console.log('\n── F) Compatibilidad histórica ──────────────────────────');
{
  const t = terminal();
  const p = producto(t);                    // sin preciosTalla, como los 240 reales
  ok('23. un artículo sin el campo se comporta exactamente como hoy',
    near(listPrice(t, p, 'XL'), 350) && near(t.D.resolveLineDiscount(p, 'XL').orig, 350));
  const venta = vender(t, [{ p, talla: 'XL', qty: 2 }], [350]);
  ok('24. su venta conserva importes y evidencia previos',
    near(venta.total, 700) && near(venta.descuento, 0)
      && near(((venta.lineas || [])[0] || {}).precioOrig, 350));

  const q = producto(t, { id: 'p2', sku: 'GUA-COR-LIN-BLA-T', preciosTalla: {} });
  ok('25. un mapa vacío equivale a "sin excepciones"', near(listPrice(t, q, 'XL'), 350));
}

console.log('\n── G) Saneo del mapa ────────────────────────────────────');
{
  const t = terminal();
  const p = producto(t, { preciosTalla: { XL: 450, 'NO-EXISTE': 999, M: -5 } });
  if (typeof t.D.hydrate === 'function') t.D.hydrate(p);
  const pt = p.preciosTalla || {};
  ok('26. se poda la talla que el catálogo ya no tiene', pt['NO-EXISTE'] === undefined,
    JSON.stringify(pt));
  ok('27. no sobrevive un precio negativo', pt.M === undefined || Number(pt.M) >= 0,
    JSON.stringify(pt));
  ok('28. la excepción válida se conserva', near(pt.XL, 450));
}

console.log('\n── H) Contratos de código y esquema ─────────────────────');
{
  const data = dataSrc;
  ok('29. DATA publica listPrice y priceRange',
    /listPrice\s*[,:(]/.test(data) && /priceRange\s*[,:(]/.test(data));
  // Patrones exactos y buscados en TODO el archivo: una ventana corta daba un
  // falso positivo, que es justamente lo que AP-09 previene.
  ok('30. recordSale ya no deriva subtotalOrig ni precioOrig de l.p.precio',
    !/subtotalOrig\s*=\s*ticket\.reduce\([^)]*Number\(l\.p\.precio\)/.test(data)
      && !/precioOrig:\s*Number\(l\.p\.precio\)/.test(data));
  // El motor debe PREFERIR la resolución del llamador y, en su defecto, la
  // autoridad. Conserva `p.precio` como último recurso sólo para llamadores
  // directos con un DATA parcial (test-discounts.mjs, que no se modifica).
  const lu = promoSrc.slice(promoSrc.indexOf('function lineUnit('), promoSrc.indexOf('function lineUnit(') + 400);
  ok('31. el motor recibe el precio de lista: origIn primero, autoridad después',
    /lineUnit\(p, talla, origIn\)/.test(lu) && /origIn != null/.test(lu) && /D\.listPrice\(p, talla\)/.test(lu));

  const ticket = read('./balam/pos-ticket.jsx');
  ok('32. el ticket no cae al precio del artículo', !/l\.p\.precio/.test(ticket));

  const inv = read('./balam/inventory.jsx');
  ok('33. Inventario captura excepciones por GRUPO de tallas, no una por talla',
    /preciosTalla/.test(inv) && /Precios especiales por talla/.test(inv));
  ok('34. la etiqueta imprime el precio de su talla', /listPrice\(\s*s\.p\s*,\s*s\.talla\s*\)/.test(inv));

  const store = read('./balam/store.jsx');
  ok('35. STORE transporta precios_talla de forma condicional',
    /precios_talla/.test(store) && /preciosTalla/.test(store));

  const pos = read('./balam/pos.jsx');
  ok('36. el catálogo del POS muestra el rango', /priceRange/.test(pos));

  const mig = read('./supabase/migrations/20260728005100_pos_h36_variant_price.sql');
  // El CHECK debe ser una expresión escalar: PostgreSQL rechaza subconsultas
  // dentro de una restricción (0A000). El primer intento de despliegue murió
  // exactamente ahí, y este arnés sólo comprobaba que el texto tuviera las
  // palabras correctas — el síntoma, no la defensa (AP-09).
  const chk = mig.slice(mig.indexOf('add constraint products_precios_talla_valid'));
  ok('37. la migración agrega la columna con default vacío y un CHECK sin subconsulta',
    /add column if not exists precios_talla/.test(mig) && /default '\{\}'/.test(mig)
      && !/\bselect\b/i.test(chk) && !/\bexists\b/i.test(chk));
  const ver = read('./supabase/migrations/20260728005200_pos_h36_variant_price_verification.sql');
  ok('38. la verificación comprueba la defensa: vendedor rechazado y datos intactos',
    /restrict_seller_product_update|42501/.test(ver) && /raise exception/.test(ver));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
