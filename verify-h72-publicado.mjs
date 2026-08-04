// verify-h72-publicado.mjs — H-72: verificación del ARTEFACTO PUBLICADO.
//
// No inspecciona el archivo: lo carga desde el sitio servido y le pregunta al
// programa en ejecución. Comprueba, en este orden:
//   1. El sha256 de lo servido coincide con el artefacto del commit.
//   2. La devolución restituye aunque el código de talla ya no esté en el catálogo.
//   3. Existencias ambiguas BLOQUEAN sin efectos parciales.
//   4. El cambio identifica la pieza devuelta por la línea de la venta.
//   5. Una identidad irresoluble rechaza el cambio y nunca registra una prenda en $0.
//
// Uso: node verify-h72-publicado.mjs [url]
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const URL_SITIO = process.argv[2] || 'https://david14081982.github.io/POS_Balam/index.html';
let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const blob = execFileSync('git', ['show', 'HEAD:index.html'], { maxBuffer: 64 * 1024 * 1024 });
const local = createHash('sha256').update(blob).digest('hex');
const bytes = Buffer.from(await (await fetch(URL_SITIO, { cache: 'no-store' })).arrayBuffer());
const servido = createHash('sha256').update(bytes).digest('hex');
check('el sitio sirve exactamente el artefacto del commit', servido === local,
  `servido ${servido.slice(0, 16)}… · commit ${local.slice(0, 16)}…`);
console.log(`   sha256 publicado: ${servido} (${bytes.length} bytes)`);

const b = await chromium.launch({ channel: 'chrome', headless: true });
const errs = [];
try {
  const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto(URL_SITIO, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 40000 });

  const r = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'pushReturn', 'pushExchange', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    window.__sync = [];
    window.CORE.invokeSync = (op) => { window.__sync.push(op); return { ok: true }; };

    const mk = (id, nombre, precio, modelo, color) => {
      const p = D.hydrate({
        id, cat: '21', manga: 'MC', tela: 'ALG', color, cuello: 'NOR', modelo, nombre,
        orn: '—', ornColors: [], precio, costo: 100, pop: false, stock: D.mkStock([20, 20, 20, 20], []),
      });
      D.products.push(p); return p;
    };
    const reset = () => {
      D.sales.length = 0; D.payments.length = 0; D.products.length = 0;
      if (D.returns) D.returns.length = 0;
      if (D.exchanges) D.exchanges.length = 0;
      if (D.movements) D.movements.length = 0;
      window.__sync.length = 0;
      mk('V-ALFA', 'VERIF ALFA', 1000, '901', 'BL');
      mk('V-BETA', 'VERIF BETA', 2000, '902', 'AZ');
      D.saveProducts(false);
    };
    const raw = (id, t) => {
      const p = D.products.find(x => x.id === id); if (!p) return null;
      return (p.stock || []).filter(v => String(v.talla) === String(t))
        .reduce((a, v) => a + (Number(v.stock) || 0), 0);
    };
    const venderLinea = (p, talla, res) => {
      const li = [{ key: 'k', p, talla, qty: 1, res: res || D.resolveLineDiscount(p, talla) }];
      const q = D.saleQuote(li, []);
      return D.recordSale({
        ticket: li, quote: q, sellerIds: D.sellers.length ? [D.sellers[0].id] : [],
        client: D.clients.find(c => c.generic), metodo: 'Efectivo', estado: 'Pagado',
        subtotal: q.subtotal, iva: q.iva, total: q.finalTotal,
        pagoEfectivo: q.finalTotal, pagoOtro: 0, pagoDetalle: { efectivo: q.finalTotal },
        metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 1,
      });
    };
    const devolver = (folio) => {
      const s = D.sales.find(x => x.folio === folio); const l = s.lineas[0];
      const m = (window.CONFIG.list('return_reason')[0] || {}).code || 'otro';
      return D.recordReturn({
        folio, metodo: 'Efectivo', notas: 'verif-h72',
        lineas: [{ sku: l.sku, nombre: l.nombre, talla: l.talla, qty: 1, motivo: m, precio: l.precio }],
      });
    };
    const huella = () => JSON.stringify({
      p: D.products.map(p => [p.id, (p.stock || []).map(v => v.talla + ':' + v.escala + ':' + v.stock).join(',')]),
      v: D.sales.map(s => [s.folio, s.estado, s.total]),
      pg: (D.payments || []).length, dv: (D.returns || []).length,
      cb: (D.exchanges || []).length, mv: (D.movements || []).length, sy: window.__sync.length,
    });
    const out = {};

    // (2) talla fuera del catálogo
    reset();
    let p = D.products.find(x => x.id === 'V-ALFA');
    p.stock.push({ talla: 'ZZZ', escala: 'L', stock: 5 }); D.saveProducts(false);
    let s = venderLinea(p, 'ZZZ', { orig: 1000, unit: 1000, promos: [] });
    const antes2 = raw('V-ALFA', 'ZZZ');
    let res = devolver(s.folio);
    out.tallaFuera = { ok: res.ok, antes: antes2, despues: raw('V-ALFA', 'ZZZ') };

    // (3) existencias ambiguas
    reset();
    p = D.products.find(x => x.id === 'V-ALFA');
    p.stock.push({ talla: 'ZZZ', escala: 'L', stock: 5 }); D.saveProducts(false);
    s = venderLinea(p, 'ZZZ', { orig: 1000, unit: 1000, promos: [] });
    p.stock.push({ talla: 'ZZZ', escala: 'L', stock: 2 }); D.saveProducts(false);
    const hA = huella();
    res = devolver(s.folio);
    out.ambiguo = { ok: res.ok, code: res.code, intacto: hA === huella() };

    // (4) cambio con SKU duplicado
    reset();
    const pB = D.products.find(x => x.id === 'V-BETA');
    const pA = D.products.find(x => x.id === 'V-ALFA');
    s = venderLinea(pB, 'M');
    const clon = D.hydrate({
      id: 'V-CLON', cat: '21', manga: 'MC', tela: 'ALG', color: 'RJ', cuello: 'NOR', modelo: '777',
      nombre: 'CLON VERIF', orn: '—', ornColors: [], precio: 5, costo: 1, pop: false,
      stock: D.mkStock([3, 3, 3, 3], []),
    });
    clon.sku = pB.sku; D.products.unshift(clon); D.saveProducts(false);
    const vAntes = raw('V-BETA', 'M'), cAntes = raw('V-CLON', 'M');
    res = D.recordExchange({
      origenFolio: s.folio, vendedorId: D.sellers[0].id, metodoPago: 'Efectivo',
      lineas: [
        { lado: 'devuelto', productId: clon.id, sku: pB.sku, nombre: pB.nombre, talla: 'M', qty: 1, motivo: 'talla', condicion: 'Sin uso, con etiqueta' },
        { lado: 'entregado', productId: pA.id, sku: pA.sku, nombre: pA.nombre, talla: 'S', qty: 1 },
      ],
    });
    const dev = res.exchange && res.exchange.lineas.find(l => l.lado === 'devuelto');
    out.cambioDup = {
      ok: res.ok, productId: dev && dev.productId,
      vendido: [vAntes, raw('V-BETA', 'M')], clon: [cAntes, raw('V-CLON', 'M')],
    };

    // (5) identidad irresoluble
    reset();
    const pB2 = D.products.find(x => x.id === 'V-BETA');
    s = venderLinea(pB2, 'L');
    const skuViejo = pB2.sku;
    pB2.sku = 'SKU-MUTADO'; D.hydrate(pB2); D.saveProducts(false);
    const hB = huella();
    res = D.recordExchange({
      origenFolio: s.folio, vendedorId: D.sellers[0].id, metodoPago: 'Efectivo',
      lineas: [
        { lado: 'devuelto', sku: skuViejo, nombre: pB2.nombre, talla: 'L', qty: 1, motivo: 'talla', condicion: 'Sin uso, con etiqueta' },
        { lado: 'entregado', sku: skuViejo, nombre: pB2.nombre, talla: 'M', qty: 1 },
      ],
    });
    out.cambioCero = { ok: res.ok, sinDocumento: !res.exchange, intacto: hB === huella() };
    return out;
  });

  check('la devolución restituye con la talla fuera del catálogo',
    r.tallaFuera.ok === true && r.tallaFuera.despues === r.tallaFuera.antes + 1,
    `${r.tallaFuera.antes} → ${r.tallaFuera.despues}`);
  check('existencias ambiguas bloquean con código accionable',
    r.ambiguo.ok === false && r.ambiguo.code === 'STOCK_IDENTITY_AMBIGUOUS', String(r.ambiguo.code));
  check('el bloqueo por ambigüedad no dejó efectos parciales', r.ambiguo.intacto === true);
  check('el cambio identifica la pieza devuelta por la línea de la venta',
    r.cambioDup.productId === 'V-BETA', String(r.cambioDup.productId));
  check('el cambio devuelve las existencias al producto vendido',
    r.cambioDup.vendido[1] === r.cambioDup.vendido[0] + 1, `vendido ${r.cambioDup.vendido.join(' → ')}`);
  check('el producto ajeno no recibe existencias',
    r.cambioDup.clon[1] === r.cambioDup.clon[0], `clon ${r.cambioDup.clon.join(' → ')}`);
  check('una identidad irresoluble rechaza el cambio, sin documento ni $0',
    r.cambioCero.ok === false && r.cambioCero.sinDocumento === true);
  check('el cambio bloqueado no dejó efectos parciales', r.cambioCero.intacto === true);
  check('sin errores de consola en el artefacto publicado', errs.length === 0, errs.join(' | '));
} finally { await b.close(); }

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
