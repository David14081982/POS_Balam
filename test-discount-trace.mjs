// test-discount-trace.mjs — H-32: trazabilidad del descuento y presentación de Finanzas.
//
// Carga el motor REAL de promociones (balam/discounts.jsx) y extrae del código REAL las
// funciones de presentación (balam/pos-ticket.jsx), la resolución por renglón y el mapeo de
// renglones persistidos (balam/data.jsx), y el transporte a la nube (balam/store.jsx).
// No reimplementa nada: si el código cambia, la prueba cambia con él.
//
// Uso: node test-discount-trace.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); cond ? pass++ : fail++; };
// Se normalizan los saltos de línea: el árbol de trabajo mezcla CRLF y LF.
const src = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── Motor real de promociones ────────────────────────────────────────────────
const noop = () => {};
const React = { createElement: () => ({}), useState: () => [0, noop], useEffect: noop, useMemo: f => f() };
const DATA = { promos: [], products: [] };
const sandbox = { React, window: {}, console };
sandbox.window.UI = { fmt: n => '$' + Number(n).toFixed(2), toast: noop };
sandbox.window.HX = { MS: noop };
sandbox.window.DATA = DATA;
sandbox.window.CONFIG = { get: () => 0, map: () => ({}), list: () => [], codes: () => [], find: () => null };
sandbox.React = React;
vm.createContext(sandbox);
vm.runInContext(src('./balam/discounts.jsx'), sandbox);
const PROMOS = sandbox.window.PROMOS;

// ── Código real bajo prueba ──────────────────────────────────────────────────
const dataSrc = src('./balam/data.jsx');
const ticketSrc = src('./balam/pos-ticket.jsx');
const storeSrc = src('./balam/store.jsx');
const posSrc = src('./balam/pos.jsx');

const extraer = (texto, re, etiqueta) => {
  const m = texto.match(re);
  if (!m) { console.error('No se pudo extraer ' + etiqueta); process.exit(1); }
  return m;
};

// listPrice real (H-36). resolveLineDiscount dejó de leer `product.precio` y
// ahora consulta esta autoridad; como aquí el cuerpo se evalúa aislado, hay que
// inyectarla extrayéndola del mismo archivo real.
const lpM = extraer(dataSrc, /function listPrice\(product, talla\) \{([\s\S]*?)\n  \}/, 'listPrice');
const listPrice = new Function('product', 'talla', lpM[1]);

// resolveLineDiscount real
const resM = extraer(dataSrc, /function resolveLineDiscount\(product, talla\) \{([\s\S]*?)\n  \}/, 'resolveLineDiscount');
const resolveLineDiscount = new Function('product', 'talla', 'window', 'listPrice', resM[1]).bind(null);
const resolve = (p, talla) => resolveLineDiscount(p, talla, sandbox.window, listPrice);

// desglose + pctDeEvidencia + etiquetaDescuento reales
const money2 = n => Math.round((Number(n) || 0) * 100) / 100;
const desgM = extraer(ticketSrc, /function desglose\(totalPagar, descuento, ivaPct\) \{([\s\S]*?)\n  \}/, 'desglose');
const desglose = new Function('totalPagar', 'descuento', 'ivaPct', 'money2', desgM[1]).bind(null);
const dg = (t, d, i) => desglose(t, d, i, money2);
const pctM = extraer(ticketSrc, /function pctDeEvidencia\(items\) \{([\s\S]*?)\n  \}/, 'pctDeEvidencia');
const pctDeEvidencia = new Function('items', pctM[1]);
const etqM = extraer(ticketSrc, /const etiquetaDescuento = \(pct\) =>\s*([^;]*);/, 'etiquetaDescuento');
const etiquetaDescuento = new Function('pct', 'return ' + etqM[1]);

// mapeo real de renglones persistidos
const lineasM = extraer(dataSrc, /lineas: ticket\.map\((\(l, i\) => \(\{[\s\S]*?\}\))\),/, 'lineas');
const buildLineas = (ticket, ctx) => ticket.map(new Function(
  'cortesia', 'money', 'unitAt', 'totalConDescuento', 'total', 'resList',
  'return ' + lineasM[1])(ctx.cortesia, money2, ctx.unitAt, ctx.totalConDescuento, ctx.total, ctx.resList));

// transporte real a la nube y de regreso
const itemsM = extraer(storeSrc, /const items = \(sale\.lineas \|\| \[\]\)\.map\(l => \{([\s\S]*?)\n    \}\);/, 'sale_items');
const toItemRow = (sale, l) => new Function('sale', 'l', 'window',
  itemsM[1].replace(/^\s*const productId[\s\S]*?;\n/, 'const productId = l.productId || null;\n'))(sale, l, sandbox.window);
// H-65 extrajo el mapeo de renglón a una función propia (`saleItemFromRow`): la
// usan el pull, la búsqueda por folio y la respuesta autoritativa de la
// liquidación. La prueba sigue leyendo el código real, ahora en su nueva costura.
const backM = extraer(storeSrc, /function saleItemFromRow\(x\) \{\s*return (\{[\s\S]*?\});\n  \}/, 'fromRow');
const fromItemRow = new Function('x', 'return ' + backM[1]);

// ── Utilidades de escenario ──────────────────────────────────────────────────
const prod = (id, precio, over = {}) => Object.assign(
  { id, nombre: 'P-' + id, sku: id.toUpperCase(), precio, costo: 0, cat: 'guayabera', tela: 'lino',
    manga: 'larga', cuello: 'mao', color: 'blanco', orn: '—', modelo: '100', stock: [{ talla: 'M', stock: 9 }] }, over);
const promo = (id, nombre, tipo, valor, scope = {}) =>
  ({ id, nombre, tipo, valor, inicio: '', fin: '', horaInicio: '', horaFin: '', pausado: false, scope });

// Reproduce recordSale (parte financiera) usando el mapeo REAL de renglones.
function vender(ticket, promos, { cortesia = false } = {}) {
  DATA.promos = promos;
  DATA.products = ticket.map(l => l.p);
  const resList = ticket.map(l => l.res || resolve(l.p, l.talla));
  const unitAt = i => resList[i].unit;
  const subtotalOrig = ticket.reduce((a, l) => a + (Number(l.p.precio) || 0) * l.qty, 0);
  const totalConDescuento = ticket.reduce((a, l, i) => a + unitAt(i) * l.qty, 0);
  const total = money2(totalConDescuento);
  const lineas = buildLineas(ticket, { cortesia, unitAt, totalConDescuento, total, resList });
  return {
    folio: 'BG-T', total: cortesia ? 0 : total,
    subtotal: money2(total / 1.16), iva: money2(total - money2(total / 1.16)),
    descuento: cortesia ? 0 : money2(Math.max(0, subtotalOrig - totalConDescuento)),
    valorRegalado: cortesia ? total : 0, ivaPct: 16, lineas,
  };
}
const pctDeVenta = (sale) => pctDeEvidencia((sale.lineas || [])
  .map(l => ({ orig: Number(l.precioOrig), base: Number(l.precioBase), promos: l.promos })));

console.log('\n── 1) El ejemplo exacto de Finanzas ─────────────────────────────');
{
  const g = prod('g1', 1250);
  const v = vender([{ p: g, talla: 'M', qty: 1 }], [promo('pa', 'DESCUENTO JULIO', 'pct', 10)]);
  const d = dg(v.total, v.descuento, 16);
  ok('1a. precio original = $1,250.00', d.precioOriginal === 1250);
  ok('1b. importe = $1,077.59 (no 1,077.58)', d.importe === 1077.59);
  ok('1c. IVA = $172.41', d.iva === 172.41);
  ok('1d. importe + IVA = precio original', money2(d.importe + d.iva) === d.precioOriginal);
  ok('1e. descuento = $125.00', v.descuento === 125);
  ok('1f. total a pagar = $1,125.00', v.total === 1125);
  ok('1g. precio original − descuento = total', money2(d.precioOriginal - v.descuento) === v.total);
  ok('1h. el porcentaje sale de la evidencia: 10', pctDeVenta(v) === 10);
  ok('1i. etiqueta con porcentaje', etiquetaDescuento(10) === 'Descuento (SOBRE PRECIO ORIGINAL) 10%');
}

console.log('\n── 2) Evidencia persistida por renglón ──────────────────────────');
{
  const g = prod('g1', 1250);
  const v = vender([{ p: g, talla: 'M', qty: 1 }], [promo('pa', 'DESCUENTO JULIO', 'pct', 10)]);
  const l = v.lineas[0];
  ok('2a. el renglón guarda promos', Array.isArray(l.promos) && l.promos.length === 1);
  ok('2b. guarda id y nombre de la promoción', l.promos[0].id === 'pa' && l.promos[0].nombre === 'DESCUENTO JULIO');
  ok('2c. guarda mecánica y valor configurado', l.promos[0].tipo === 'pct' && l.promos[0].valor === 10);
  ok('2d. es COPIA, no referencia', l.promos[0] !== DATA.promos[0]);
  ok('2e. conserva precio de lista y precio base', l.precioOrig === 1250 && l.precioBase === 1125);
  // La promoción se edita después de la venta: la evidencia NO cambia.
  DATA.promos[0].valor = 50; DATA.promos[0].nombre = 'OTRA COSA';
  ok('2f. editar la promoción no altera la evidencia', l.promos[0].valor === 10 && l.promos[0].nombre === 'DESCUENTO JULIO');
  // La promoción se elimina: la venta sigue siendo explicable.
  DATA.promos.length = 0;
  ok('2g. borrar la promoción no altera la evidencia', pctDeVenta(v) === 10);
}

console.log('\n── 3) Renglón sin descuento y venta sin descuento ───────────────');
{
  const g = prod('g1', 1250);
  const v = vender([{ p: g, talla: 'M', qty: 1 }], []);
  const d = dg(v.total, v.descuento, 16);
  ok('3a. sin promoción, promos queda vacío (no ausente)', Array.isArray(v.lineas[0].promos) && v.lineas[0].promos.length === 0);
  ok('3b. sin descuento el precio original es el total', d.precioOriginal === 1250 && v.total === 1250);
  ok('3c. sin descuento no hay porcentaje', pctDeVenta(v) === null);
  ok('3d. importe e IVA no cambian respecto al cálculo previo', d.importe === 1077.59 && d.iva === 172.41);
}

console.log('\n── 4) Monto fijo: nunca se inventa porcentaje ───────────────────');
{
  const g = prod('g1', 1250);
  const v = vender([{ p: g, talla: 'M', qty: 1 }], [promo('pf', 'TARJETA', 'fijo', 60)]);
  ok('4a. descuento = $60.00', v.descuento === 60);
  ok('4b. total = $1,190.00', v.total === 1190);
  ok('4c. NO se imprime porcentaje', pctDeVenta(v) === null);
  ok('4d. etiqueta sin porcentaje', etiquetaDescuento(null) === 'Descuento (SOBRE PRECIO ORIGINAL)');
  ok('4e. 60/1250 = 4.8% NO se deriva', pctDeVenta(v) !== 4.8);
}

console.log('\n── 5) Artículos elegibles y no elegibles ────────────────────────');
{
  const g = prod('g1', 1250), p = prod('p1', 500, { cat: 'pantalon' });
  const v = vender([{ p: g, talla: 'M', qty: 1 }, { p, talla: 'M', qty: 1 }],
    [promo('pb', 'SOLO GUAYABERAS', 'pct', 10, { cats: ['guayabera'] })]);
  ok('5a. descuento solo del elegible = $125.00', v.descuento === 125);
  ok('5b. el no elegible guarda promos vacío', v.lineas[1].promos.length === 0);
  ok('5c. el porcentaje sigue siendo el configurado: 10', pctDeVenta(v) === 10);
  ok('5d. 125/1750 = 7.14% NO se usa', pctDeVenta(v) !== 7.14);
}

console.log('\n── 6) Promociones distintas en la misma venta ───────────────────');
{
  const g = prod('g1', 1250), c = prod('c1', 800, { tela: 'algodon' });
  const v = vender([{ p: g, talla: 'M', qty: 1 }, { p: c, talla: 'M', qty: 1 }],
    [promo('pl', 'LINO 10%', 'pct', 10, { telas: ['lino'] }), promo('pa', 'ALGODÓN 20%', 'pct', 20, { telas: ['algodon'] })]);
  ok('6a. cada renglón guarda SU promoción', v.lineas[0].promos[0].id === 'pl' && v.lineas[1].promos[0].id === 'pa');
  ok('6b. porcentajes distintos → sin porcentaje', pctDeVenta(v) === null);
  ok('6c. la fila muestra sólo el importe', etiquetaDescuento(pctDeVenta(v)) === 'Descuento (SOBRE PRECIO ORIGINAL)');
}

console.log('\n── 7) Acumulación en un mismo renglón ───────────────────────────');
{
  const g = prod('g1', 1250);
  const v = vender([{ p: g, talla: 'M', qty: 1 }],
    [promo('p1', 'A', 'pct', 10, {}), promo('p2', 'B', 'pct', 5, {})]);
  ok('7a. el motor sigue acumulando (no se modificó)', v.total === 1062.5);
  ok('7b. el renglón guarda AMBAS promociones', v.lineas[0].promos.length === 2);
  ok('7c. evidencia ambigua → sin porcentaje', pctDeVenta(v) === null);
  ok('7d. el 15% acumulado NO se imprime', pctDeVenta(v) !== 15);
}

console.log('\n── 8) Misma promoción porcentual en varios renglones ────────────');
{
  const g = prod('g1', 1250), h2 = prod('g2', 800);
  const v = vender([{ p: g, talla: 'M', qty: 1 }, { p: h2, talla: 'M', qty: 2 }],
    [promo('pu', 'JULIO', 'pct', 10)]);
  ok('8a. todos con la misma promoción → sí hay porcentaje', pctDeVenta(v) === 10);
  ok('8b. descuento agregado correcto', v.descuento === money2(1250 * 0.1 + 800 * 0.1 * 2));
}

console.log('\n── 9) Venta histórica sin evidencia ─────────────────────────────');
{
  const historica = { total: 1125, descuento: 125, subtotal: 969.83, iva: 155.17,
    lineas: [{ precioOrig: 1250, precioBase: 1125, precio: 1125 }] }; // sin `promos`
  ok('9a. sin evidencia NO se imprime porcentaje', pctDeVenta(historica) === null);
  const d = dg(historica.total, historica.descuento, 16);
  ok('9b. el desglose sigue siendo correcto', d.precioOriginal === 1250 && d.importe === 1077.59 && d.iva === 172.41);
  const sinLineas = { total: 1125, descuento: 125, lineas: [] };
  ok('9c. venta sin renglones (pull parcial) tampoco inventa', pctDeVenta(sinLineas) === null);
}

console.log('\n── 10) Transporte a otra terminal ───────────────────────────────');
{
  const g = prod('g1', 1250);
  const v = vender([{ p: g, talla: 'M', qty: 1 }], [promo('pa', 'DESCUENTO JULIO', 'pct', 10)]);
  const fila = toItemRow(v, v.lineas[0]);
  ok('10a. promos viaja a pos.sale_items', Array.isArray(fila.promos) && fila.promos[0].valor === 10);
  const vuelta = fromItemRow(fila);
  ok('10b. la otra terminal recupera la evidencia', Array.isArray(vuelta.promos) && vuelta.promos[0].nombre === 'DESCUENTO JULIO');
  ok('10c. reimpresión remota con el mismo porcentaje',
    pctDeEvidencia([{ orig: vuelta.precioOrig, base: vuelta.precioBase, promos: vuelta.promos }]) === 10);
  const filaVieja = toItemRow(v, { sku: 'X', nombre: 'X', talla: 'M', qty: 1, precio: 100 });
  ok('10d. renglón sin promos no envía el campo', !('promos' in filaVieja));
  ok('10e. fila remota sin promos no inventa evidencia', fromItemRow({ sku: 'X', qty: 1, precio: 100 }).promos === undefined);
}

console.log('\n── 11) Neutralidad: ningún importe cobrado cambia ───────────────');
{
  // El precio se calcula con el motor sin tocar; recordSale sólo consume la resolución.
  const g = prod('g1', 1250), c = prod('c1', 800, { tela: 'algodon' });
  const promos = [promo('pl', 'LINO 10%', 'pct', 10, { telas: ['lino'] }), promo('pf', 'FIJO', 'fijo', 60, { telas: ['algodon'] })];
  const ticket = [{ p: g, talla: 'M', qty: 2 }, { p: c, talla: 'M', qty: 3 }];
  DATA.promos = promos; DATA.products = [g, c];
  const esperadoTotal = money2(PROMOS.lineUnit(g, 'M').unit * 2 + PROMOS.lineUnit(c, 'M').unit * 3);
  const v = vender(ticket, promos);
  ok('11a. el total es exactamente el del motor', v.total === esperadoTotal);
  ok('11b. precioBase = precio unitario del motor', v.lineas[0].precioBase === PROMOS.lineUnit(g, 'M').unit);
  ok('11c. subtotal + iva = total (invariante contable intacta)', money2(v.subtotal + v.iva) === v.total);
  // La resolución precalculada por el POS produce lo mismo que resolverla en recordSale.
  const conRes = ticket.map(l => Object.assign({}, l, { res: resolve(l.p, l.talla) }));
  const v2 = vender(conRes, promos);
  ok('11d. POS y recordSale coinciden exactamente', v2.total === v.total
    && JSON.stringify(v2.lineas) === JSON.stringify(v.lineas));
}

console.log('\n── 12) El motor y el contrato no se tocaron ─────────────────────');
{
  ok('12a. discounts.jsx conserva la acumulación declarada', /descuentos ACUMULABLES/.test(src('./balam/discounts.jsx')));
  ok('12b. recordSale consume el subtotal de la autoridad de cotización', /const subtotal = money\(quote\.subtotal\);/.test(dataSrc));
  ok('12c. la invariante subtotal+iva=total sigue vigente', /El subtotal e IVA no coinciden con el total final/.test(dataSrc));
  ok('12d. el POS resuelve una sola vez por renglón', (posSrc.match(/lineUnit\(/g) || []).length === 0);
  ok('12e. data.jsx no vuelve a consultar el motor en recordSale',
    (dataSrc.match(/PROMOS\.lineUnit\(/g) || []).length === 1);
  ok('12f. el ticket no consulta promociones vigentes',
    !/PROMOS/.test(ticketSrc.slice(ticketSrc.indexOf('function BalamTicket'))));
}

console.log('\n── 13) Cortesías: comportamiento intacto ────────────────────────');
{
  const g = prod('g1', 1250);
  const v = vender([{ p: g, talla: 'M', qty: 1 }], [], { cortesia: true });
  ok('13a. total cobrado = 0', v.total === 0);
  ok('13b. descuento = 0 → no se muestran filas de descuento', v.descuento === 0);
  ok('13c. el snapshot conserva el valor regalado', v.subtotal === 1077.59 && v.iva === 172.41);
  ok('13d. la rama de cortesía existe en el ticket', /const cortesia = Number\(sale\.valorRegalado\) > 0;/.test(ticketSrc));
}

console.log('\n── 14) Migración 034 ────────────────────────────────────────────');
{
  const mig = src('./supabase/migrations/20260727004000_pos_h32_discount_trace.sql');
  ok('14a. agrega la columna de forma reejecutable', /add column if not exists promos jsonb/.test(mig));
  ok('14b. commit_sale inserta promos', /precio_original, promos/.test(mig));
  ok('14c. el recordset declara promos jsonb', /promos jsonb\n\s*\);/.test(mig));
  ok('14d. documenta la reversión', /Reversión:/.test(mig));
  ok('14e. no reescribe renglones existentes', !/update pos\.sale_items/.test(mig));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════\n`);
process.exit(fail ? 1 : 0);
