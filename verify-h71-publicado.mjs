// verify-h71-publicado.mjs — H-71: verificación del ARTEFACTO PUBLICADO.
//
// No inspecciona el archivo: lo carga desde el sitio servido y le pregunta al
// programa en ejecución. Un `grep` sobre index.html no prueba que la devolución
// resuelva la identidad correctamente.
//
// Comprueba, en este orden:
//   1. El sha256 de lo servido coincide con el artefacto del commit.
//   2. Una devolución con el SKU cambiado tras la venta SÍ restituye el stock.
//   3. Con dos productos del mismo SKU, la pieza vuelve al que se vendió.
//   4. Una identidad ambigua BLOQUEA sin mover nada.
//
// Uso: node verify-h71-publicado.mjs [url]
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const URL_SITIO = process.argv[2] || 'https://david14081982.github.io/POS_Balam/index.html';
let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

// ── 1) Identidad del artefacto servido ───────────────────────────────────────
// Se compara contra el BLOB DEL COMMIT, no contra el archivo del disco: en
// Windows la copia de trabajo tiene CRLF y el repositorio guarda LF.
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
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'pushReturn', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    window.CORE.invokeSync = () => ({ ok: true });

    const reset = () => {
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
      mk('V-ALFA', 'VERIF ALFA', 1000, '901', 'BL');
      mk('V-BETA', 'VERIF BETA', 2000, '902', 'AZ');
      D.saveProducts(false);
    };
    const stock = (id, t) => {
      const p = D.products.find(x => x.id === id); if (!p) return null;
      const s = D.resolveProductSizes(p).sizes.find(x => String(x.value) === String(t));
      return s ? s.stock : null;
    };
    const vender = (id, talla) => {
      const p = D.products.find(x => x.id === id);
      const lineas = [{ key: 'k', p, talla, qty: 1, res: D.resolveLineDiscount(p, talla) }];
      const q = D.saleQuote(lineas, []);
      return D.recordSale({
        ticket: lineas, quote: q, sellerIds: D.sellers.length ? [D.sellers[0].id] : [],
        client: D.clients.find(c => c.generic), metodo: 'Efectivo', estado: 'Pagado',
        subtotal: q.subtotal, iva: q.iva, total: q.finalTotal,
        pagoEfectivo: q.finalTotal, pagoOtro: 0, pagoDetalle: { efectivo: q.finalTotal },
        metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 1,
      });
    };
    const devolver = (folio) => {
      const s = D.sales.find(x => x.folio === folio); const l = s.lineas[0];
      const motivo = (window.CONFIG.list('return_reason')[0] || {}).code || 'otro';
      return D.recordReturn({
        folio, metodo: 'Efectivo', notas: 'verif H-71',
        lineas: [{ sku: l.sku, nombre: l.nombre, talla: l.talla, qty: 1, motivo, precio: l.precio }],
      });
    };
    const clonar = (id, deId) => {
      const base = D.products.find(x => x.id === deId);
      const c = D.hydrate({
        id, cat: '21', manga: 'MC', tela: 'ALG', color: 'RJ', cuello: 'NOR', modelo: '777',
        nombre: 'CLON VERIF', orn: '—', ornColors: [], precio: 5, costo: 1, pop: false,
        stock: D.mkStock([3, 3, 3, 3], []),
      });
      c.sku = base.sku; D.products.unshift(c); D.saveProducts(false);
    };

    const out = {};

    // (2) SKU cambiado tras la venta
    reset();
    let s = vender('V-BETA', 'L');
    const antesMut = stock('V-BETA', 'L');
    const pb = D.products.find(x => x.id === 'V-BETA');
    pb.sku = 'SKU-MUTADO-VERIF'; D.hydrate(pb); D.saveProducts(false);
    let res = devolver(s.folio);
    out.skuCambiado = {
      ok: res.ok, antes: antesMut, despues: stock('V-BETA', 'L'),
      productId: res.ret && res.ret.lineas[0] && res.ret.lineas[0].productId,
    };

    // (3) SKU duplicado
    reset();
    s = vender('V-BETA', 'M');
    const vendidoAntes = stock('V-BETA', 'M');
    clonar('V-CLON', 'V-BETA');
    const clonAntes = stock('V-CLON', 'M');
    res = devolver(s.folio);
    out.skuDuplicado = {
      ok: res.ok, vendido: [vendidoAntes, stock('V-BETA', 'M')],
      clon: [clonAntes, stock('V-CLON', 'M')],
      productId: res.ret && res.ret.lineas[0] && res.ret.lineas[0].productId,
    };

    // (4) Identidad ambigua: bloquea sin tocar nada
    reset();
    s = vender('V-ALFA', 'S');
    delete D.sales.find(x => x.folio === s.folio).lineas[0].productId;
    clonar('V-CLON2', 'V-ALFA');
    const ambAntes = stock('V-ALFA', 'S');
    res = devolver(s.folio);
    out.ambiguo = {
      ok: res.ok, code: res.code, antes: ambAntes, despues: stock('V-ALFA', 'S'),
      documentos: (D.returns || []).length,
      estadoVenta: D.sales.find(x => x.folio === s.folio).estado,
    };
    return out;
  });

  check('la devolución existe y responde en el paquete publicado',
    r && r.skuCambiado && typeof r.skuCambiado.ok === 'boolean');
  check('SKU cambiado tras la venta: el stock SÍ regresa al producto vendido',
    r.skuCambiado.ok === true && r.skuCambiado.despues === r.skuCambiado.antes + 1,
    `${r.skuCambiado.antes} → ${r.skuCambiado.despues}`);
  check('SKU cambiado: el documento congela el productId correcto',
    r.skuCambiado.productId === 'V-BETA', String(r.skuCambiado.productId));
  check('SKU duplicado: el stock entra al producto vendido',
    r.skuDuplicado.vendido[1] === r.skuDuplicado.vendido[0] + 1,
    `vendido ${r.skuDuplicado.vendido.join(' → ')}`);
  check('SKU duplicado: el producto ajeno NO recibe stock',
    r.skuDuplicado.clon[1] === r.skuDuplicado.clon[0],
    `clon ${r.skuDuplicado.clon.join(' → ')}`);
  check('SKU duplicado: el documento apunta al producto vendido',
    r.skuDuplicado.productId === 'V-BETA', String(r.skuDuplicado.productId));
  check('identidad ambigua: la devolución se rechaza',
    r.ambiguo.ok === false && r.ambiguo.code === 'PRODUCT_SKU_AMBIGUOUS', String(r.ambiguo.code));
  check('identidad ambigua: no movió stock ni dejó documento',
    r.ambiguo.despues === r.ambiguo.antes && r.ambiguo.documentos === 0
    && r.ambiguo.estadoVenta === 'Pagado',
    `${r.ambiguo.antes} → ${r.ambiguo.despues} · ${r.ambiguo.documentos} doc · ${r.ambiguo.estadoVenta}`);
  check('sin errores de consola en el artefacto publicado', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
