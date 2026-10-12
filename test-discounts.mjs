// test-discounts.mjs — Prueba quirúrgica del motor real de descuentos (balam/discounts.jsx)
// Carga el IIFE real con mocks mínimos y ejercita PROMOS.applyStack / lineUnit / estado / match.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ── Mocks de los globals que discounts.jsx espera ────────────────────────────
let CONFIG_VALUES = { 'discount.minMarginPct': 45 };
const noop = () => {};
const React = { createElement: () => ({}), useState: () => [0, noop], useEffect: noop, useMemo: (f) => f() };
const DATA = { promos: [], products: [] };
const CONFIG = {
  get: (k) => CONFIG_VALUES[k],
  map: () => ({}), list: () => [], codes: () => [], find: () => null,
};
const UI = { fmt: (n) => '$' + Number(n).toFixed(2), toast: noop, ToastHost: noop };
const HX = { MS: noop };

const sandbox = {
  React, window: {}, console,
};
sandbox.window.addEventListener = noop;
sandbox.window.dispatchEvent = noop;
// H-187: fixed server instant crosses the UTC day; independent of runner timezone.
sandbox.window.CORE = { invokeSync: name => name === 'serverNow' ? new Date('2026-10-11T21:00:00-07:00') : null,
  registerCatalogProducts: noop, registerCatalogPromotions: noop, registerMonetaryDocuments: noop };
sandbox.window.UI = UI; sandbox.window.HX = HX; sandbox.window.DATA = DATA;
sandbox.window.CONFIG = CONFIG; sandbox.window.PROMOS = null;
sandbox.React = React;
vm.createContext(sandbox);

// H-186: usar autoridades reales de moneda y precio; el catálogo del arnés
// sigue siendo explícito para sus pruebas de alcance.
for (const name of ['config', 'data']) {
  vm.runInContext(readFileSync(new URL(`./balam/${name}.jsx`, import.meta.url), 'utf8'), sandbox);
}
Object.assign(DATA, sandbox.window.DATA, { products: [], promos: [] });
sandbox.window.DATA = DATA;
sandbox.window.CONFIG = CONFIG;

const code = readFileSync(new URL('./balam/discounts.jsx', import.meta.url), 'utf8');
vm.runInContext(code, sandbox);
const PROMOS = sandbox.window.PROMOS;
const settingsCode = readFileSync(new URL('./balam/settings.jsx', import.meta.url), 'utf8');

// ── Utilidades de prueba ─────────────────────────────────────────────────────
let pass = 0, fail = 0;
function near(a, b, eps = 0.005) { return Math.abs(a - b) <= eps; }
function check(name, got, exp) {
  const ok = near(got, exp);
  console.log(`${ok ? '✅' : '❌'} ${name}: got=${Number(got).toFixed(2)} exp=${Number(exp).toFixed(2)}`);
  ok ? pass++ : fail++;
}
const prod = (precio, costo) => ({ precio, costo, cat: 'guayabera', tela: 'lino', manga: 'larga', cuello: 'mao', color: 'blanco', orn: '—', modelo: '100', stock: [{ talla: 'M', stock: 5, escala: 'L' }] });
const promo = (tipo, valor, scope = {}) => ({ id: 'p' + Math.random(), nombre: 't', tipo, valor, inicio: '', fin: '', horaInicio: '', horaFin: '', pausado: false, scope });

// La clave histórica se conserva, pero H-186 ya no la usa para fijar precios.
CONFIG_VALUES['discount.minMarginPct'] = 0;

console.log('\n── A) Descuento PORCENTUAL ──────────────────────────────');
check('10% de $1000', PROMOS.applyStack(1000, [promo('pct', 10)], prod(1000)).unit, 900);
check('33% de $980', PROMOS.applyStack(980, [promo('pct', 33)], prod(980)).unit, 656.60);
check('15% de $980 (caso memoria ALG)', PROMOS.applyStack(980, [promo('pct', 15)], prod(980)).unit, 833);
check('100% de $500', PROMOS.applyStack(500, [promo('pct', 100)], prod(500)).unit, 0);
check('0% de $750', PROMOS.applyStack(750, [promo('pct', 0)], prod(750)).unit, 750);

console.log('\n── B) Descuento MONTO FIJO ($) ──────────────────────────');
check('$100 fijo sobre $1000', PROMOS.applyStack(1000, [promo('fijo', 100)], prod(1000)).unit, 900);
check('$250 fijo sobre $980', PROMOS.applyStack(980, [promo('fijo', 250)], prod(980)).unit, 730);
check('$ fijo > precio (no negativo)', PROMOS.applyStack(300, [promo('fijo', 500)], prod(300)).unit, 0);

console.log('\n── C) ACUMULABLES (% + $ y orden) ───────────────────────');
// El motor aplica % primero, luego resta $.
check('10% + $100 sobre $1000 = 1000*0.9-100', PROMOS.applyStack(1000, [promo('pct', 10), promo('fijo', 100)], prod(1000)).unit, 800);
check('10% + 20% (suma a 30%) sobre $1000', PROMOS.applyStack(1000, [promo('pct', 10), promo('pct', 20)], prod(1000)).unit, 700);
check('60% + 60% (cap 100%) sobre $1000', PROMOS.applyStack(1000, [promo('pct', 60), promo('pct', 60)], prod(1000)).unit, 0);
check('$100 + $50 fijos sobre $1000', PROMOS.applyStack(1000, [promo('fijo', 100), promo('fijo', 50)], prod(1000)).unit, 850);

console.log('\n── D) COSTO Y MARGEN HISTÓRICOS NO LIMITAN PROMOCIONES ───');
CONFIG_VALUES['discount.minMarginPct'] = 45;
const r1 = PROMOS.applyStack(1000, [promo('pct', 40)], prod(1000, 450));
check('40% sobre $1000 costo $450', r1.unit, 600);
const r2 = PROMOS.applyStack(1000, [promo('pct', 10)], prod(1000, 450));
check('10% sobre $1000 costo $450', r2.unit, 900);
const r3 = PROMOS.applyStack(1000, [promo('fijo', 300)], prod(1000, 450));
check('$300 fijo se aplica completo', r3.unit, 700);
const r4 = PROMOS.applyStack(1000, [promo('pct', 40)], prod(1000, 0));
check('costo cero conserva el descuento histórico', r4.unit, 600);
check('costo inválido conserva el descuento histórico',
  PROMOS.applyStack(1000, [promo('pct', 40)], prod(1000, 'sin-costo')).unit, 600);
const r5 = PROMOS.applyStack(1000, [promo('pct', 40)], prod(1000, 1000));
check('costo igual al precio permite descuento autorizado', r5.unit, 600);
CONFIG_VALUES['discount.minMarginPct'] = 100;
const r6 = PROMOS.applyStack(1000, [promo('pct', 10)], prod(1000, 450));
check('margen histórico100% no cambia descuento', r6.unit, 900);
CONFIG_VALUES['discount.minMarginPct'] = 45;
const marginProduct = Object.assign(prod(1000, 450), { id: 'margin-product', sku: 'MARGIN' });
const marginPromo = promo('pct', 40);
DATA.products = [marginProduct];
DATA.promos = [marginPromo];
const marginLine = PROMOS.lineUnit(marginProduct, 'M');
const marginPreview = PROMOS.previewDraft(marginPromo).examples[0];
check('POS lineUnit aplica descuento autorizado', marginLine.unit, 600);
check('vista previa coincide con POS', marginPreview.unit, 600);
CONFIG_VALUES['discount.minMarginPct'] = 0;

console.log('\n── E) lineUnit con promos ACTIVAS por fecha/alcance ─────');
// Fechas comerciales relativas al instante fijo del servidor (11/10 en Hermosillo,
// 12/10 en UTC). No derivarlas del calendario local del runner.
const ayer = '2026-10-10';
const manana = '2026-10-12';
const pYer = '2026-10-09';
DATA.promos = [
  Object.assign(promo('pct', 20, { cats: ['guayabera'] }), { inicio: ayer, fin: manana }),   // Activa
  Object.assign(promo('pct', 50, {}), { inicio: manana, fin: '' }),                            // Programada (futuro)
  Object.assign(promo('fijo', 999, {}), { inicio: pYer, fin: ayer }),                          // Finalizada
  Object.assign(promo('pct', 30, { cats: ['pantalon'] }), { inicio: ayer, fin: manana }),      // Activa pero otro alcance
];
const lu = PROMOS.lineUnit(prod(1000), 'M');
check('lineUnit: solo aplica la promo 20% activa y en alcance', lu.unit, 800);
check('lineUnit.off', lu.off, 200);
console.log(`   promos aplicadas=${lu.promos.length} (esperado 1)`); lu.promos.length === 1 ? pass++ : fail++;

console.log('\n── F) estado() por fechas ───────────────────────────────');
const st = (p) => PROMOS.estado(p);
console.log('   Activa →', st(DATA.promos[0]), st(DATA.promos[0]) === 'Activo' ? '✅' : '❌'); st(DATA.promos[0]) === 'Activo' ? pass++ : fail++;
console.log('   Programada →', st(DATA.promos[1]), st(DATA.promos[1]) === 'Programado' ? '✅' : '❌'); st(DATA.promos[1]) === 'Programado' ? pass++ : fail++;
console.log('   Finalizada →', st(DATA.promos[2]), st(DATA.promos[2]) === 'Finalizado' ? '✅' : '❌'); st(DATA.promos[2]) === 'Finalizado' ? pass++ : fail++;
const paused = Object.assign(promo('pct', 10, {}), { pausado: true, inicio: ayer, fin: manana });
console.log('   Pausada →', st(paused), st(paused) === 'Pausado' ? '✅' : '❌'); st(paused) === 'Pausado' ? pass++ : fail++;

console.log('\n── G) SUBTOTAL / DESCUENTO del POS (multi-línea + qty) ───');
DATA.promos = [Object.assign(promo('pct', 10, {}), { inicio: ayer, fin: manana })];
const ticket = [
  { p: prod(1000), talla: 'M', qty: 2 },
  { p: prod(500), talla: 'M', qty: 1 },
];
const unitOf = (l) => PROMOS.lineUnit(l.p, l.talla).unit;
const subtotalOrig = ticket.reduce((a, l) => a + l.p.precio * l.qty, 0);
const subtotal = ticket.reduce((a, l) => a + unitOf(l) * l.qty, 0);
const discount = Math.max(0, subtotalOrig - subtotal);
check('subtotalOrig (1000*2 + 500)', subtotalOrig, 2500);
check('subtotal con 10% off', subtotal, 2250);
check('descuento total', discount, 250);

console.log('\n── H) FINANZAS: IVA 16% incluido en el total ────────────');
function ticketTotals(total) {
  const importe = Math.round((total / 1.16) * 100) / 100;
  const iva = Math.round((total - importe) * 100) / 100;
  return { importe, iva, total };
}
const fin = ticketTotals(1150);
check('Importe de $1,150', fin.importe, 991.38);
check('IVA incluido de $1,150', fin.iva, 158.62);
check('Importe + IVA = total', fin.importe + fin.iva, 1150);

console.log('\n── I) DESCUENTO ANTES DEL DESGLOSE DE IVA ──────────────');
const precioOriginal = 1200, descuentoFin = 50;
const totalFin = precioOriginal - descuentoFin;
const desglose = ticketTotals(totalFin);
check('$1,200 − $50 = total cobrado', totalFin, 1150);
check('total descontado no vuelve a sumar IVA', desglose.total, 1150);
check('desglose fiscal conserva total', desglose.importe + desglose.iva, totalFin);

console.log('\n── J) CONFIGURACIÓN ADMINISTRABLE ──────────────────────');
const marginSettingRemoved = !settingsCode.includes("k: 'discount.minMarginPct'");
console.log(`${marginSettingRemoved ? '✅' : '❌'} control de margen mínimo retirado de Configuración`);
marginSettingRemoved ? pass++ : fail++;

console.log(`\n════════ RESULTADO: ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
