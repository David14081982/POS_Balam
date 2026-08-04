// test-h72-identidad-posventa.mjs — H-72: la posventa identifica la pieza por la
// línea histórica de la venta, nunca por SKU, y bloquea sin efectos parciales.
//
// Cubre tres huecos que H-71 dejó registrados fuera de alcance:
//
//   A2 · La restitución de una devolución se saltaba en silencio cuando el código
//        de talla del renglón ya no estaba en el catálogo (`stockVariantOf` → null
//        y un `if (e)` mudo). Debe restituir por identidad cruda de existencias y
//        BLOQUEAR si esa identidad es inexistente o ambigua.
//   A3 · `recordExchange` resolvía la pieza con `x.sku === l.sku` y llegaba a
//        valorar en $0 una pieza cuya identidad no resolvía.
//   D-8 · La pantalla del Cambio derivaba el producto del renglón devuelto con
//        `D.products.find(x => x.sku === r.sku)`, así que con un SKU duplicado
//        mostraba la foto del clon y el botón «misma prenda» abría el clon.
//
// Mide sobre el BUNDLE distribuido (index.html) y afirma cada bloqueo en los dos
// sentidos (R-DEL-11), incluida la ausencia de efectos parciales.
//
// Uso: node test-h72-identidad-posventa.mjs
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = path.resolve('.');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8847, '127.0.0.1', r));

let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort());
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto('http://127.0.0.1:8847/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 30000 });

  await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'pushReturn', 'pushExchange', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    // Contador de la costura de sincronización: una operación bloqueada no debe
    // encolar nada.
    window.__sync = [];
    window.CORE.invokeSync = (op) => { window.__sync.push(op); return { ok: true }; };

    window.__reset = () => {
      D.sales.length = 0; D.payments.length = 0; D.products.length = 0;
      if (D.returns) D.returns.length = 0;
      if (D.exchanges) D.exchanges.length = 0;
      if (D.movements) D.movements.length = 0;
      window.__sync.length = 0;
      const mk = (id, nombre, precio, modelo, color) => {
        const p = D.hydrate({
          id, cat: '21', manga: 'MC', tela: 'ALG', color, cuello: 'NOR', modelo, nombre,
          orn: '—', ornColors: [], precio, costo: 100, pop: false, stock: D.mkStock([20, 20, 20, 20], []),
        });
        D.products.push(p); return p;
      };
      mk('P-ALFA', 'GUAYABERA LINO BLANCA', 1000, '901', 'BL');
      mk('P-BETA', 'GUAYABERA MANGA LARGA AZUL', 2000, '902', 'AZ');
      D.saveProducts(false);
    };
    window.__rawStock = (id, talla) => {
      const p = D.products.find(x => x.id === id); if (!p) return null;
      return (p.stock || []).filter(v => String(v.talla) === String(talla))
        .reduce((a, v) => a + (Number(v.stock) || 0), 0);
    };
    window.__vender = (id, talla, qty) => {
      const p = D.products.find(x => x.id === id);
      const lineas = [{ key: 'k', p, talla, qty: qty || 1, res: D.resolveLineDiscount(p, talla) }];
      const q = D.saleQuote(lineas, []);
      return D.recordSale({
        ticket: lineas, quote: q, sellerIds: D.sellers.length ? [D.sellers[0].id] : [],
        client: D.clients.find(c => c.generic), metodo: 'Efectivo', estado: 'Pagado',
        subtotal: q.subtotal, iva: q.iva, total: q.finalTotal,
        pagoEfectivo: q.finalTotal, pagoOtro: 0, pagoDetalle: { efectivo: q.finalTotal },
        metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: qty || 1,
      });
    };
    window.__devolver = (folio) => {
      const s = D.sales.find(x => x.folio === folio); const l = s.lineas[0];
      const motivo = (window.CONFIG.list('return_reason')[0] || {}).code || 'otro';
      return D.recordReturn({
        folio, metodo: 'Efectivo', notas: 'H-72',
        lineas: [{ sku: l.sku, nombre: l.nombre, talla: l.talla, qty: 1, motivo, precio: l.precio }],
      });
    };
    window.__clonar = (id, deId) => {
      const base = D.products.find(x => x.id === deId);
      const c = D.hydrate({
        id, cat: '21', manga: 'MC', tela: 'ALG', color: 'RJ', cuello: 'NOR', modelo: '777',
        nombre: 'CLON ' + id, orn: '—', ornColors: [], precio: 5, costo: 1, pop: false,
        stock: D.mkStock([3, 3, 3, 3], []),
      });
      c.sku = base.sku; D.products.unshift(c); D.saveProducts(false);
      return c;
    };
    // Foto instantánea de TODO lo que una operación bloqueada no debe alterar.
    window.__huella = () => ({
      productos: JSON.stringify(D.products.map(p => [p.id, (p.stock || []).map(v => v.talla + ':' + v.escala + ':' + v.stock).join(',')])),
      ventas: JSON.stringify(D.sales.map(s => [s.folio, s.estado, s.total, s.saldo])),
      pagos: (D.payments || []).length,
      devoluciones: (D.returns || []).length,
      cambios: (D.exchanges || []).length,
      movimientos: (D.movements || []).length,
      sync: window.__sync.length,
    });
  });

  const ev = (fn, arg) => page.evaluate(fn, arg);

  // ── A2) Talla que ya no está en el catálogo ────────────────────────────────
  console.log('\n── A2) La devolución restituye aunque el código de talla ya no exista ──');
  const tallaAusente = await ev(() => {
    window.__reset();
    const D = window.DATA;
    const p = D.products.find(x => x.id === 'P-ALFA');
    // Existencias reales en una talla que el catálogo ya no lista (escenario H-64).
    p.stock.push({ talla: 'ZZZ', escala: 'L', stock: 5 });
    D.saveProducts(false);
    const lineas = [{ key: 'k', p, talla: 'ZZZ', qty: 1, res: { orig: 1000, unit: 1000, promos: [] } }];
    const q = D.saleQuote(lineas, []);
    const s = D.recordSale({
      ticket: lineas, quote: q, sellerIds: [D.sellers[0].id], client: D.clients.find(c => c.generic),
      metodo: 'Efectivo', estado: 'Pagado', subtotal: q.subtotal, iva: q.iva, total: q.finalTotal,
      pagoEfectivo: q.finalTotal, pagoOtro: 0, pagoDetalle: { efectivo: q.finalTotal },
      metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 1,
    });
    const enCatalogo = D.resolveProductSizes(p).sizes.some(x => String(x.value) === 'ZZZ');
    const antes = window.__rawStock('P-ALFA', 'ZZZ');
    const r = window.__devolver(s.folio);
    return { enCatalogo, ok: r.ok, error: r.error, antes, despues: window.__rawStock('P-ALFA', 'ZZZ') };
  });
  check('la talla del renglón no está en el catálogo (precondición)', tallaAusente.enCatalogo === false);
  check('la devolución se acepta', tallaAusente.ok === true, tallaAusente.error || '');
  check('la pieza SÍ regresa a las existencias', tallaAusente.despues === tallaAusente.antes + 1,
    `${tallaAusente.antes} → ${tallaAusente.despues}`);

  // ── A2b) Identidad de existencias ambigua → bloquea sin tocar nada ─────────
  console.log('\n── A2b) Identidad de existencias ambigua: bloquea sin efectos ──────────');
  const ambiguo = await ev(() => {
    window.__reset();
    const D = window.DATA;
    const p = D.products.find(x => x.id === 'P-ALFA');
    p.stock.push({ talla: 'ZZZ', escala: 'L', stock: 5 });
    D.saveProducts(false);
    const lineas = [{ key: 'k', p, talla: 'ZZZ', qty: 1, res: { orig: 1000, unit: 1000, promos: [] } }];
    const q = D.saleQuote(lineas, []);
    const s = D.recordSale({
      ticket: lineas, quote: q, sellerIds: [D.sellers[0].id], client: D.clients.find(c => c.generic),
      metodo: 'Efectivo', estado: 'Pagado', subtotal: q.subtotal, iva: q.iva, total: q.finalTotal,
      pagoEfectivo: q.finalTotal, pagoOtro: 0, pagoDetalle: { efectivo: q.finalTotal },
      metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 1,
    });
    // Segundo renglón crudo con la MISMA talla y la MISMA escala: nadie puede
    // decidir a cuál de los dos regresa la pieza.
    p.stock.push({ talla: 'ZZZ', escala: 'L', stock: 2 });
    D.saveProducts(false);
    const huella = window.__huella();
    const r = window.__devolver(s.folio);
    return { ok: r.ok, error: r.error, code: r.code, huella, despues: window.__huella() };
  });
  check('la devolución con existencias ambiguas se rechaza', ambiguo.ok === false, String(ambiguo.error));
  check('el rechazo trae código accionable', ambiguo.code === 'STOCK_IDENTITY_AMBIGUOUS', String(ambiguo.code));
  check('no hubo NINGÚN efecto parcial (stock, venta, pagos, docs, cola)',
    JSON.stringify(ambiguo.huella) === JSON.stringify(ambiguo.despues),
    JSON.stringify(ambiguo.despues));

  // ── A3) recordExchange: identidad histórica, nunca SKU, nunca $0 ──────────
  console.log('\n── A3) El cambio identifica la pieza devuelta por la línea de la venta ──');
  const cambioDup = await ev(() => {
    window.__reset();
    const D = window.DATA;
    const s = window.__vender('P-BETA', 'M', 1);
    const pB = D.products.find(x => x.id === 'P-BETA');
    const pA = D.products.find(x => x.id === 'P-ALFA');
    const clon = window.__clonar('P-CLON', 'P-BETA');
    const vendidoAntes = window.__rawStock('P-BETA', 'M');
    const clonAntes = window.__rawStock('P-CLON', 'M');
    // La pantalla arma el renglón devuelto con el productId que resolvió por SKU:
    // con un duplicado, ése es el CLON (defecto D-8 alimentando A3).
    const r = D.recordExchange({
      origenFolio: s.folio, vendedorId: D.sellers[0].id, metodoPago: 'Efectivo',
      lineas: [
        { lado: 'devuelto', productId: clon.id, sku: pB.sku, nombre: pB.nombre, talla: 'M', qty: 1, motivo: 'talla', condicion: 'Sin uso, con etiqueta' },
        { lado: 'entregado', productId: pA.id, sku: pA.sku, nombre: pA.nombre, talla: 'S', qty: 1 },
      ],
    });
    const dev = r.exchange && r.exchange.lineas.find(l => l.lado === 'devuelto');
    return {
      ok: r.ok, error: r.error,
      productIdDevuelto: dev && dev.productId,
      vendido: [vendidoAntes, window.__rawStock('P-BETA', 'M')],
      clon: [clonAntes, window.__rawStock('P-CLON', 'M')],
    };
  });
  check('el cambio con SKU duplicado se registra', cambioDup.ok === true, String(cambioDup.error));
  check('la pieza devuelta se identifica con la línea de la venta, no con el clon',
    cambioDup.productIdDevuelto === 'P-BETA', String(cambioDup.productIdDevuelto));
  check('las existencias vuelven al producto vendido',
    cambioDup.vendido[1] === cambioDup.vendido[0] + 1, `vendido ${cambioDup.vendido.join(' → ')}`);
  check('el producto ajeno no recibe existencias',
    cambioDup.clon[1] === cambioDup.clon[0], `clon ${cambioDup.clon.join(' → ')}`);

  const cambioCero = await ev(() => {
    window.__reset();
    const D = window.DATA;
    const s = window.__vender('P-BETA', 'L', 1);
    const pB = D.products.find(x => x.id === 'P-BETA');
    const skuViejo = pB.sku;
    pB.sku = 'SKU-MUTADO'; D.hydrate(pB); D.saveProducts(false);
    const huella = window.__huella();
    // Ni productId ni SKU vigente: la identidad no resuelve por ningún camino.
    const r = D.recordExchange({
      origenFolio: s.folio, vendedorId: D.sellers[0].id, metodoPago: 'Efectivo',
      lineas: [
        { lado: 'devuelto', sku: skuViejo, nombre: pB.nombre, talla: 'L', qty: 1, motivo: 'talla', condicion: 'Sin uso, con etiqueta' },
        { lado: 'entregado', sku: skuViejo, nombre: pB.nombre, talla: 'M', qty: 1 },
      ],
    });
    const lineas = r.exchange ? r.exchange.lineas.map(l => ({ lado: l.lado, productId: l.productId, precio: l.precio })) : null;
    return { ok: r.ok, error: r.error, code: r.code, lineas, huella, despues: window.__huella() };
  });
  check('un renglón entregado sin identidad resoluble rechaza el cambio',
    cambioCero.ok === false, String(cambioCero.error));
  check('nunca se registra una pieza valorada en $0 por identidad irresoluble',
    !cambioCero.lineas || !cambioCero.lineas.some(l => Number(l.precio) === 0),
    JSON.stringify(cambioCero.lineas));
  check('el cambio bloqueado no dejó NINGÚN efecto parcial',
    JSON.stringify(cambioCero.huella) === JSON.stringify(cambioCero.despues),
    JSON.stringify(cambioCero.despues));

  // ── D-8) La pantalla del Cambio, recorrida de verdad ──────────────────────
  console.log('\n── D-8) La pantalla del Cambio identifica la prenda por la venta ───────');
  // El modal de talla no muestra el nombre de la prenda, así que las dos se
  // distinguen por lo que el cajero SÍ lee ahí: precio y piezas disponibles.
  // Vendida: $2,000.00 y 20 pz. Clon del mismo SKU: $5.00 y 3 pz.
  const semilla = await ev(() => {
    window.__reset();
    const D = window.DATA;
    const s = window.__vender('P-BETA', 'M', 1);
    window.__clonar('P-CLON', 'P-BETA');   // queda PRIMERO: es a quien resolvía find()
    return { folio: s.folio };
  });
  await page.evaluate(() => {
    const x = [...document.querySelectorAll('nav button')].find(e => /Devoluciones/.test(e.innerText));
    if (x) x.click();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="operacion-cambio"]');
    if (el) el.click();
  });
  await page.waitForTimeout(500);
  await page.evaluate((f) => {
    const x = [...document.querySelectorAll('button')].find(e => e.innerText.includes(f));
    if (x) x.click();
  }, semilla.folio);
  await page.waitForFunction(() => !!document.querySelector('[data-testid="cambio-panel"]'), null, { timeout: 15000 });
  await page.evaluate(() => { const c = document.querySelector('input[type=checkbox]'); if (c) c.click(); });
  await page.waitForTimeout(400);
  const pantalla = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="cambio-misma-prenda"]');
    if (b) b.click();
    return { habia: !!b };
  });
  await page.waitForTimeout(500);
  // Se lee SÓLO el modal abierto: el catálogo de la izquierda lista todos los
  // productos —clon incluido—, así que mirar la página entera no probaría nada.
  const abierto = await page.evaluate(() => {
    const overlay = [...document.querySelectorAll('div.fixed.inset-0')].pop();
    return { texto: overlay ? (overlay.innerText || '') : '(sin modal)' };
  });
  check('la pantalla ofrece «misma prenda» sobre el renglón devuelto', pantalla.habia === true);
  check('«misma prenda» abre la prenda VENDIDA, no el clon del mismo SKU',
    /\$2,000\.00/.test(abierto.texto) && !/\$5\.00/.test(abierto.texto),
    /\$5\.00/.test(abierto.texto) ? 'abrió el clon ($5.00 · 3 pz)' : abierto.texto.replace(/\n/g, ' / ').slice(0, 160));

  check('sin errores de consola durante el recorrido', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
