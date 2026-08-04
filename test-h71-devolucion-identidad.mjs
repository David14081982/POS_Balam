// test-h71-devolucion-identidad.mjs — H-71: la devolución restituye el inventario
// al producto que se vendió, no al que hoy comparte su SKU.
//
// El defecto: `recordReturn` localizaba el producto con
// `products.find(x => x.sku === l.sku)` y protegía la escritura con un `if (p)`
// mudo. La línea de la venta SÍ trae `productId` congelado desde H-32, pero esa
// función nunca lo miraba. Consecuencias medidas sobre el artefacto publicado:
//
//   · SKU cambiado tras la venta → se reembolsa y el stock NO regresa (19 → 19).
//   · Dos productos con el mismo SKU → el stock entra al AJENO (clon 3 → 4).
//
// Este arnés mide sobre el BUNDLE distribuido (index.html) y ejerce la regla en
// los dos sentidos (R-DEL-11): resuelve cuando hay identidad, y BLOQUEA sin
// tocar nada cuando la identidad es ambigua o inexistente.
//
// Uso: node test-h71-devolucion-identidad.mjs
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
await new Promise(r => server.listen(8846, '127.0.0.1', r));

let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort());
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto('http://127.0.0.1:8846/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 30000 });

  // Aísla la nube: ninguna operación sale del navegador.
  await page.evaluate(() => {
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'pushReturn', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    window.CORE.invokeSync = () => ({ ok: true });

    const D = window.DATA;
    window.__reset = function () {
      D.sales.length = 0; D.payments.length = 0; D.products.length = 0;
      if (D.returns) D.returns.length = 0;
      if (D.movements) D.movements.length = 0;
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
    window.__stock = (id, talla) => {
      const p = D.products.find(x => x.id === id); if (!p) return null;
      const s = D.resolveProductSizes(p).sizes.find(x => String(x.value) === String(talla));
      return s ? s.stock : null;
    };
    window.__vender = function (productoId, talla, qty) {
      const p = D.products.find(x => x.id === productoId);
      const lineas = [{ key: p.id + '-' + talla, p, talla, qty, res: D.resolveLineDiscount(p, talla) }];
      const quote = D.saleQuote(lineas, []);
      return D.recordSale({
        ticket: lineas, quote, sellerIds: D.sellers.length ? [D.sellers[0].id] : [],
        client: D.clients.find(c => c.generic), metodo: 'Efectivo', estado: 'Pagado',
        subtotal: quote.subtotal, iva: quote.iva, total: quote.finalTotal,
        pagoEfectivo: quote.finalTotal, pagoOtro: 0, pagoDetalle: { efectivo: quote.finalTotal },
        metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: qty,
      });
    };
    // Devuelve EXACTAMENTE como lo hace la pantalla: sin productId en la línea.
    window.__devolver = function (folio, indices) {
      const sale = D.sales.find(s => s.folio === folio);
      const motivo = (window.CONFIG.list('return_reason')[0] || {}).code || 'otro';
      const lineas = (indices || [0]).map(i => {
        const l = sale.lineas[i];
        return { sku: l.sku, nombre: l.nombre, talla: l.talla, qty: 1, motivo, precio: l.precio };
      });
      return D.recordReturn({ folio, lineas, metodo: 'Efectivo', notas: 'H-71' });
    };
    window.__clonar = function (id, skuDe, color) {
      const base = D.products.find(x => x.id === skuDe);
      const clon = D.hydrate({
        id, cat: '21', manga: 'MC', tela: 'ALG', color: color || 'RJ', cuello: 'NOR', modelo: '777',
        nombre: 'CLON ' + id, orn: '—', ornColors: [], precio: 5, costo: 1, pop: false,
        stock: D.mkStock([3, 3, 3, 3], []),
      });
      clon.sku = base.sku;
      D.products.unshift(clon);   // el clon queda PRIMERO: es a quien resuelve find()
      D.saveProducts(false);
      return clon.id;
    };
  });

  const run = (fn, arg) => page.evaluate(fn, arg);

  console.log('\n── A) Camino feliz: la devolución sigue funcionando ──────────────');
  const feliz = await run(() => {
    window.__reset();
    const s = window.__vender('P-ALFA', 'S', 2);
    const antes = window.__stock('P-ALFA', 'S');
    const r = window.__devolver(s.folio);
    return {
      ok: r.ok, error: r.error, total: r.ret && r.ret.total,
      antes, despues: window.__stock('P-ALFA', 'S'),
      productIdEnDocumento: r.ret && r.ret.lineas[0] && r.ret.lineas[0].productId,
      estadoVenta: window.DATA.sales.find(x => x.folio === s.folio).estado,
    };
  });
  check('la devolución normal se acepta', feliz.ok === true, feliz.error || '');
  check('restituye una pieza al producto vendido', feliz.despues === feliz.antes + 1, `${feliz.antes} → ${feliz.despues}`);
  check('el documento congela el productId resuelto', feliz.productIdEnDocumento === 'P-ALFA', String(feliz.productIdEnDocumento));
  check('la venta queda en devolución parcial', feliz.estadoVenta === 'Devolución parcial', feliz.estadoVenta);

  console.log('\n── B) SKU cambiado DESPUÉS de la venta (defecto D-1) ─────────────');
  const mutado = await run(() => {
    window.__reset();
    const s = window.__vender('P-BETA', 'L', 1);
    const antes = window.__stock('P-BETA', 'L');
    const p = window.DATA.products.find(x => x.id === 'P-BETA');
    p.sku = 'SKU-CAMBIADO-TRAS-LA-VENTA';
    window.DATA.hydrate(p); window.DATA.saveProducts(false);
    const r = window.__devolver(s.folio);
    return {
      ok: r.ok, error: r.error, skuCongelado: s.lineas[0].sku, skuHoy: p.sku,
      antes, despues: window.__stock('P-BETA', 'L'),
      productIdEnDocumento: r.ret && r.ret.lineas[0] && r.ret.lineas[0].productId,
      reembolso: r.ret && r.ret.total,
    };
  });
  check('la devolución se acepta pese al cambio de SKU', mutado.ok === true, mutado.error || '');
  check('el stock SÍ regresa al producto vendido', mutado.despues === mutado.antes + 1,
    `${mutado.antes} → ${mutado.despues} (SKU ${mutado.skuCongelado} → ${mutado.skuHoy})`);
  check('la identidad se resolvió por productId congelado', mutado.productIdEnDocumento === 'P-BETA',
    String(mutado.productIdEnDocumento));

  console.log('\n── C) Dos productos con el mismo SKU (defecto D-2) ───────────────');
  const dup = await run(() => {
    window.__reset();
    const s = window.__vender('P-BETA', 'M', 1);
    const vendidoAntes = window.__stock('P-BETA', 'M');
    window.__clonar('P-CLON', 'P-BETA');
    const clonAntes = window.__stock('P-CLON', 'M');
    const r = window.__devolver(s.folio);
    return {
      ok: r.ok, error: r.error,
      vendido: { antes: vendidoAntes, despues: window.__stock('P-BETA', 'M') },
      clon: { antes: clonAntes, despues: window.__stock('P-CLON', 'M') },
      productIdEnDocumento: r.ret && r.ret.lineas[0] && r.ret.lineas[0].productId,
    };
  });
  check('la devolución se acepta con SKU duplicado', dup.ok === true, dup.error || '');
  check('el stock entra al producto VENDIDO', dup.vendido.despues === dup.vendido.antes + 1,
    `vendido ${dup.vendido.antes} → ${dup.vendido.despues}`);
  check('el producto ajeno NO recibe stock', dup.clon.despues === dup.clon.antes,
    `clon ${dup.clon.antes} → ${dup.clon.despues}`);
  check('el documento apunta al producto vendido', dup.productIdEnDocumento === 'P-BETA',
    String(dup.productIdEnDocumento));

  console.log('\n── D) Compatibilidad: documento histórico sin productId ──────────');
  const historico = await run(() => {
    window.__reset();
    const s = window.__vender('P-ALFA', 'XS', 1);
    delete window.DATA.sales.find(x => x.folio === s.folio).lineas[0].productId;
    const antes = window.__stock('P-ALFA', 'XS');
    const r = window.__devolver(s.folio);
    return {
      ok: r.ok, error: r.error, antes, despues: window.__stock('P-ALFA', 'XS'),
      productIdEnDocumento: r.ret && r.ret.lineas[0] && r.ret.lineas[0].productId,
    };
  });
  check('una venta legada sin productId se devuelve por SKU inequívoco', historico.ok === true, historico.error || '');
  check('y su stock se restituye', historico.despues === historico.antes + 1,
    `${historico.antes} → ${historico.despues}`);
  check('el documento adopta el productId resuelto', historico.productIdEnDocumento === 'P-ALFA',
    String(historico.productIdEnDocumento));

  console.log('\n── E) Identidad ambigua: BLOQUEA sin tocar nada (R-DEL-11) ───────');
  const ambiguo = await run(() => {
    window.__reset();
    const s = window.__vender('P-ALFA', 'S', 1);
    delete window.DATA.sales.find(x => x.folio === s.folio).lineas[0].productId;
    window.__clonar('P-CLON', 'P-ALFA');
    const vendidoAntes = window.__stock('P-ALFA', 'S');
    const clonAntes = window.__stock('P-CLON', 'S');
    const r = window.__devolver(s.folio);
    return {
      ok: r.ok, error: r.error, code: r.code,
      vendido: { antes: vendidoAntes, despues: window.__stock('P-ALFA', 'S') },
      clon: { antes: clonAntes, despues: window.__stock('P-CLON', 'S') },
      devoluciones: (window.DATA.returns || []).length,
      estadoVenta: window.DATA.sales.find(x => x.folio === s.folio).estado,
    };
  });
  check('un SKU ambiguo sin productId se rechaza', ambiguo.ok === false, String(ambiguo.error));
  check('el rechazo trae código accionable', ambiguo.code === 'PRODUCT_SKU_AMBIGUOUS', String(ambiguo.code));
  check('no se movió el stock del vendido', ambiguo.vendido.despues === ambiguo.vendido.antes,
    `${ambiguo.vendido.antes} → ${ambiguo.vendido.despues}`);
  check('no se movió el stock del ajeno', ambiguo.clon.despues === ambiguo.clon.antes,
    `${ambiguo.clon.antes} → ${ambiguo.clon.despues}`);
  check('no se registró documento de devolución', ambiguo.devoluciones === 0, String(ambiguo.devoluciones));
  check('la venta conserva su estado', ambiguo.estadoVenta === 'Pagado', ambiguo.estadoVenta);

  console.log('\n── F) Producto ausente del catálogo: BLOQUEA sin reembolsar ──────');
  const ausente = await run(() => {
    window.__reset();
    const s = window.__vender('P-ALFA', 'M', 1);
    const D = window.DATA;
    const i = D.products.findIndex(x => x.id === 'P-ALFA');
    D.products.splice(i, 1); D.saveProducts(false);
    const r = window.__devolver(s.folio);
    return {
      ok: r.ok, error: r.error, code: r.code,
      devoluciones: (D.returns || []).length,
      estadoVenta: D.sales.find(x => x.folio === s.folio).estado,
    };
  });
  check('un producto ya inexistente rechaza la devolución', ausente.ok === false, String(ausente.error));
  check('el rechazo trae código accionable', ausente.code === 'PRODUCT_NOT_FOUND', String(ausente.code));
  check('no se registró documento ni se reembolsó', ausente.devoluciones === 0, String(ausente.devoluciones));
  check('la venta conserva su estado', ausente.estadoVenta === 'Pagado', ausente.estadoVenta);

  console.log('\n── G) Atomicidad: una línea irresoluble aborta TODA la devolución ─');
  const atomico = await run(() => {
    window.__reset();
    const D = window.DATA;
    const pA = D.products.find(x => x.id === 'P-ALFA');
    const pB = D.products.find(x => x.id === 'P-BETA');
    const lineas = [
      { key: 'a', p: pA, talla: 'S', qty: 1, res: D.resolveLineDiscount(pA, 'S') },
      { key: 'b', p: pB, talla: 'M', qty: 1, res: D.resolveLineDiscount(pB, 'M') },
    ];
    const quote = D.saleQuote(lineas, []);
    const s = D.recordSale({
      ticket: lineas, quote, sellerIds: [D.sellers[0].id], client: D.clients.find(c => c.generic),
      metodo: 'Efectivo', estado: 'Pagado', subtotal: quote.subtotal, iva: quote.iva, total: quote.finalTotal,
      pagoEfectivo: quote.finalTotal, pagoOtro: 0, pagoDetalle: { efectivo: quote.finalTotal },
      metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 2,
    });
    // La SEGUNDA línea deja de ser resoluble; la primera es impecable.
    delete D.sales.find(x => x.folio === s.folio).lineas[1].productId;
    const i = D.products.findIndex(x => x.id === 'P-BETA');
    D.products.splice(i, 1); D.saveProducts(false);
    const buenaAntes = window.__stock('P-ALFA', 'S');
    const r = window.__devolver(s.folio, [0, 1]);
    return {
      ok: r.ok, error: r.error,
      buena: { antes: buenaAntes, despues: window.__stock('P-ALFA', 'S') },
      devoluciones: (D.returns || []).length,
      estadoVenta: D.sales.find(x => x.folio === s.folio).estado,
    };
  });
  check('la devolución completa se rechaza', atomico.ok === false, String(atomico.error));
  check('la línea que SÍ resolvía tampoco se movió', atomico.buena.despues === atomico.buena.antes,
    `${atomico.buena.antes} → ${atomico.buena.despues}`);
  check('no quedó documento a medias', atomico.devoluciones === 0, String(atomico.devoluciones));
  check('la venta conserva su estado', atomico.estadoVenta === 'Pagado', atomico.estadoVenta);

  check('sin errores de consola durante el recorrido', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
