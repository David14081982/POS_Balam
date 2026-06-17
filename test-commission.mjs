// test-commission.mjs — Verifica el cálculo de comisión neto/bruto (réplica exacta de recordSale).
let pass = 0, fail = 0;
const near = (a, b, e = 0.005) => Math.abs(a - b) <= e;
const check = (name, got, exp) => { const ok = near(got, exp); console.log(`${ok ? '✅' : '❌'} ${name}: got=${got.toFixed(2)} exp=${exp.toFixed(2)}`); ok ? pass++ : fail++; };

// Réplica EXACTA del bloque de comisión en balam/data.jsx recordSale.
function comision({ total, n = 1, ivaPct, incl, base, pct }) {
  const share = total / n;
  const neto = incl ? share / (1 + ivaPct / 100) : share;
  const bruto = incl ? share : share * (1 + ivaPct / 100);
  const b = base === 'bruto' ? bruto : neto;
  return Math.round(b * (pct / 100) * 100) / 100;
}

console.log('── IVA INCLUIDO (default): total=1160 incluye 16% (neto 1000), pct=5% ──');
check('neto  → 5% de 1000', comision({ total: 1160, ivaPct: 16, incl: true, base: 'neto', pct: 5 }), 50);
check('bruto → 5% de 1160', comision({ total: 1160, ivaPct: 16, incl: true, base: 'bruto', pct: 5 }), 58);

console.log('\n── IVA NO INCLUIDO: total=1000 (neto), iva 16%, pct=5% ──');
check('neto  → 5% de 1000', comision({ total: 1000, ivaPct: 16, incl: false, base: 'neto', pct: 5 }), 50);
check('bruto → 5% de 1160', comision({ total: 1000, ivaPct: 16, incl: false, base: 'bruto', pct: 5 }), 58);

console.log('\n── Consistencia: misma comisión sin importar el modo de IVA ──');
const inclNeto = comision({ total: 1160, ivaPct: 16, incl: true, base: 'neto', pct: 5 });
const exclNeto = comision({ total: 1000, ivaPct: 16, incl: false, base: 'neto', pct: 5 });
check('neto incl == neto no-incl (mismo neto real)', inclNeto, exclNeto);
const inclBruto = comision({ total: 1160, ivaPct: 16, incl: true, base: 'bruto', pct: 5 });
const exclBruto = comision({ total: 1000, ivaPct: 16, incl: false, base: 'bruto', pct: 5 });
check('bruto incl == bruto no-incl (mismo bruto real)', inclBruto, exclBruto);

console.log('\n── IVA 0% y % distintos ──');
check('iva 0% neto == bruto', comision({ total: 1000, ivaPct: 0, incl: true, base: 'neto', pct: 5 }), comision({ total: 1000, ivaPct: 0, incl: true, base: 'bruto', pct: 5 }));
check('pct 4% neto de 1000', comision({ total: 1160, ivaPct: 16, incl: true, base: 'neto', pct: 4 }), 40);
check('pct 0% → 0', comision({ total: 1160, ivaPct: 16, incl: true, base: 'neto', pct: 0 }), 0);

console.log('\n── Reparto entre 2 vendedores (share = total/2) ──');
// neto de la mitad: total 2320 incl 16% → neto 2000, /2 = 1000 por vendedor → 5% = 50 c/u
check('2 vendedores, neto, 5% c/u', comision({ total: 2320, n: 2, ivaPct: 16, incl: true, base: 'neto', pct: 5 }), 50);

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
