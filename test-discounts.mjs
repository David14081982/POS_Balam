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
sandbox.window.UI = UI; sandbox.window.HX = HX; sandbox.window.DATA = DATA;
sandbox.window.CONFIG = CONFIG; sandbox.window.PROMOS = null;
sandbox.React = React;
vm.createContext(sandbox);

const code = readFileSync(new URL('./balam/discounts.jsx', import.meta.url), 'utf8');
vm.runInContext(code, sandbox);
const PROMOS = sandbox.window.PROMOS;

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

// Desactivar el piso de margen salvo cuando se prueba explícitamente.
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

console.log('\n── D) PISO DE MARGEN (discount.minMarginPct=45) ─────────');
CONFIG_VALUES['discount.minMarginPct'] = 45;
// floor = costo/(1-0.45) = costo/0.55. costo=450 → floor=818.18
const r1 = PROMOS.applyStack(1000, [promo('pct', 40)], prod(1000, 450)); // 600 < 818.18 → topado
check('40% sobre $1000 costo $450 → topa en piso', r1.unit, 818.18);
console.log(`   capped=${r1.capped} (esperado true)`); r1.capped ? pass++ : fail++;
const r2 = PROMOS.applyStack(1000, [promo('pct', 10)], prod(1000, 450)); // 900 > 818.18 → no topa
check('10% sobre $1000 costo $450 → no topa', r2.unit, 900);
console.log(`   capped=${r2.capped} (esperado false)`); !r2.capped ? pass++ : fail++;
CONFIG_VALUES['discount.minMarginPct'] = 0;

console.log('\n── E) lineUnit con promos ACTIVAS por fecha/alcance ─────');
// Fechas LOCALES (no UTC) — el motor parsea new Date('YYYY-MM-DDThh:mm') en hora local.
const localDay = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hoy = new Date();
const ayer = localDay(hoy.getTime() - 86400000);
const manana = localDay(hoy.getTime() + 86400000);
const pYer = localDay(hoy.getTime() - 2 * 86400000);
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

console.log('\n── H) TICKET: reconstrucción IVA desde sale.total ───────');
function ticketTotals(total, ivaPct, incl) {
  const subtotal = incl ? total / (1 + ivaPct / 100) : total;
  const iva = incl ? total - subtotal : subtotal * (ivaPct / 100);
  const granTotal = incl ? total : subtotal + iva;
  return { subtotal, iva, granTotal };
}
// IVA incluido (default): granTotal debe IGUALAR lo cobrado en POS
const tIncl = ticketTotals(2250, 16, true);
check('IVA incluido: granTotal == total cobrado', tIncl.granTotal, 2250);
check('IVA incluido: subtotal+iva == granTotal', tIncl.subtotal + tIncl.iva, 2250);
// IVA NO incluido: granTotal del ticket vs lo cobrado en POS
const tExcl = ticketTotals(2250, 16, false);
check('IVA NO incl: granTotal ticket', tExcl.granTotal, 2610);

console.log('\n── I) FIX: POS grandTotal == total del ticket (ambos modos) ──');
// Réplica de la fórmula nueva en pos.jsx
const posGrandTotal = (subtotal, ivaPct, incl) => incl ? subtotal : Math.round(subtotal * (1 + ivaPct / 100) * 100) / 100;
// sale.total se sigue guardando como la BASE (subtotal con descuento) → ticket reconstruye.
const baseCobrada = 2250;
// IVA incluido (default): POS cobra subtotal, ticket imprime lo mismo
check('IVA incl: POS cobra == ticket', posGrandTotal(baseCobrada, 16, true), ticketTotals(baseCobrada, 16, true).granTotal);
// IVA NO incluido: POS ahora suma IVA y coincide con el ticket
check('IVA NO incl: POS cobra (con IVA)', posGrandTotal(baseCobrada, 16, false), 2610);
check('IVA NO incl: POS cobra == ticket', posGrandTotal(baseCobrada, 16, false), ticketTotals(baseCobrada, 16, false).granTotal);
// Sin IVA configurado (0%): cobro == base en ambos modos
check('IVA 0%: POS cobra == base', posGrandTotal(baseCobrada, 0, false), 2250);

console.log(`\n════════ RESULTADO: ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
