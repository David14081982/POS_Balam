// H-52 — descuento adicional: autoridad única, prorrateo y evidencia.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  cond ? pass++ : fail++;
};
const src = readFileSync(new URL('./balam/data.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const posSrc = readFileSync(new URL('./balam/pos.jsx', import.meta.url), 'utf8');
const ticketSrc = readFileSync(new URL('./balam/pos-ticket.jsx', import.meta.url), 'utf8');
const storeSrc = readFileSync(new URL('./balam/store.jsx', import.meta.url), 'utf8');
const settingsSrc = readFileSync(new URL('./balam/settings.jsx', import.meta.url), 'utf8');
const migrationSrc = readFileSync(new URL('./supabase/migrations/20260730006800_pos_h52_additional_discount.sql', import.meta.url), 'utf8');
const match = src.match(/function saleQuote\(ticket, applications\) \{([\s\S]*?)\n  \}/);
if (!match) {
  console.error('❌ H-52: falta la autoridad DATA.saleQuote(ticket, applications)');
  process.exit(1);
}
const money = n => Math.round((Number(n) || 0) * 100) / 100;
const extractedSaleQuote = new Function('ticket', 'applications', 'money', match[1]);
const saleQuote = (ticket, applications) => extractedSaleQuote(ticket, applications, money);

const lines = [
  { key: 'a', qty: 1, res: { orig: 1000, unit: 900, promos: [{ id: 'p10', nombre: '10%', tipo: 'pct', valor: 10 }] } },
  { key: 'b', qty: 1, res: { orig: 500, unit: 500, promos: [] } },
];

console.log('\n── Autoridad y secuencia ────────────────────────────────────────');
const pct = saleQuote(lines, [{
  id: 'ad-1', benefitCode: 'EMP50', benefitName: 'Empleado 50%',
  origin: 'Empleado', benefitType: 'percentage', value: 50, scope: 'ticket',
  combinable: true, reason: 'Beneficio laboral', appliedBy: 'vendedor@balam.mx',
  appliedAt: '2026-07-30T10:00:00-07:00',
}]);
check('precio original separado', pct.originalTotal === 1500);
check('descuento configurado separado', pct.configuredDiscountTotal === 100);
check('base adicional posterior a promociones', pct.beforeAdditionalTotal === 1400);
check('50% adicional = 700', pct.additionalDiscountTotal === 700);
check('total final = 700', pct.finalTotal === 700);
check('IVA incluido cuadra', money(pct.subtotal + pct.iva) === pct.finalTotal);
check('evidencia congelada', pct.applications[0].benefitName === 'Empleado 50%' && pct.applications[0].discountAmount === 700);

console.log('\n── Prorrateo determinista ───────────────────────────────────────');
const fixed = saleQuote(lines, [{
  id: 'ad-2', benefitCode: 'CARD500', benefitName: 'Tarjeta física $500',
  origin: 'Tarjeta física', benefitType: 'fixed', value: 500, scope: 'ticket',
  combinable: true, cardType: 'BALAM 500', cardFolio: 'BF-0001',
  onlineVerified: true, appliedBy: 'vendedor@balam.mx', appliedAt: '2026-07-30T10:00:00-07:00',
}]);
check('importe fijo aplicado completo', fixed.additionalDiscountTotal === 500);
check('prorrateo suma exactamente el descuento', money(fixed.lines.reduce((a, l) => a + l.additionalDiscount, 0)) === 500);
check('renglones suman exactamente total final', money(fixed.lines.reduce((a, l) => a + l.finalUnit * l.qty, 0)) === fixed.finalTotal);
check('valor pagado queda por renglón', fixed.lines.every(l => l.finalUnit >= 0 && l.finalUnit <= l.res.unit));

console.log('\n── Combinación y límites ────────────────────────────────────────');
const combined = saleQuote(lines, [
  { id: 'x', benefitName: '10%', origin: 'Promoción especial', benefitType: 'percentage', value: 10, scope: 'ticket', combinable: true },
  { id: 'y', benefitName: '$100', origin: 'Otro', benefitType: 'fixed', value: 100, scope: 'ticket', combinable: true, reason: 'Ajuste autorizado' },
]);
check('aplicaciones combinables son secuenciales', combined.additionalDiscountTotal === 240 && combined.finalTotal === 1160);
let rejected = false;
try {
  saleQuote(lines, [
    { id: 'x', benefitType: 'fixed', value: 10, scope: 'ticket', combinable: false },
    { id: 'y', benefitType: 'fixed', value: 10, scope: 'ticket', combinable: true },
  ]);
} catch (_) { rejected = true; }
check('no combinable rechaza segunda aplicación', rejected);

rejected = false;
try {
  saleQuote(lines, [{ id: 'card', origin: 'Tarjeta física', benefitType: 'fixed', value: 500, scope: 'ticket', cardFolio: 'BF-OFF', onlineVerified: false }]);
} catch (_) { rejected = true; }
check('tarjeta física sin verificación en línea se rechaza', rejected);

rejected = false;
try {
  saleQuote(lines, [{ id: 'bad', origin: 'Otro', benefitType: 'fixed', value: -1, scope: 'ticket', reason: '' }]);
} catch (_) { rejected = true; }
check('negativos y motivo ausente se rechazan', rejected);

check('DATA exporta saleQuote', /window\.DATA\s*=\s*\{[\s\S]*\bsaleQuote\b/.test(src));

console.log('\n── Consumidores y persistencia ──────────────────────────────────');
check('POS usa saleQuote como total de Resumen y Cobro', /const quote = resolved\.length \? D\.saleQuote/.test(posSrc) && /total: grandTotal[\s\S]*quote/.test(posSrc));
check('recordSale congela aplicaciones y reparto', /descuentosAdicionales:/.test(src) && /descuentoAdicional: cortesia/.test(src));
check('comisión usa el total final de la cotización', /const total = money\(quote\.finalTotal\)/.test(src) && /saleCommissionBase\(total, iva/.test(src));
check('modal está antes del cobro y tiene vista previa', /additional-discount-open/.test(ticketSrc) && /Antes del descuento adicional/.test(ticketSrc) && /Total resultante/.test(ticketSrc));
check('Cobrar venta informa el beneficio', /quote\.applications/.test(ticketSrc) && /Descuento adicional/.test(ticketSrc));
check('ticket enmascara el folio físico', /'••••' \+ folio\.slice\(-4\)/.test(ticketSrc));
check('Configuración ofrece la pantalla de beneficios', /Opciones que el vendedor puede aplicar después de las promociones/.test(settingsSrc) && /h\(BenefitEditor/.test(settingsSrc));
check('cola transporta snapshot y reparto', /descuentos_adicionales/.test(storeSrc) && /descuento_adicional/.test(storeSrc));
check('commit remoto consume cada tarjeta una sola vez', /physical_card_redemptions[\s\S]*folio text primary key/.test(migrationSrc) && /pg_advisory_xact_lock/.test(migrationSrc));
check('tarjeta física usa wrapper transaccional', /commit_sale_with_additional_discount/.test(storeSrc) && /v_result := pos\.commit_sale/.test(migrationSrc));
check('aplicar tarjeta obtiene reserva atómica real en línea', /await window\.STORE\.claimPhysicalCard/.test(ticketSrc) && /rpc\('claim_physical_card'/.test(storeSrc));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
