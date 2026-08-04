// verify-h74-publicado.mjs — H-74: verificación del ARTEFACTO PUBLICADO.
//
// No inspecciona el archivo: lo carga desde el sitio servido y ejerce la
// corrección dentro del paquete que el dueño va a usar.
//   1. El sha256 de lo servido coincide con el artefacto del commit.
//   2. La migración renombra sin mover una sola pieza.
//   3. El código de barras pasa a imprimir la talla real.
//   4. Con documentos vivos se niega y no toca absolutamente nada.
//
// Uso: node verify-h74-publicado.mjs [url]
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
    const D = window.DATA, C = window.CONFIG;
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    window.CORE.invokeSync = () => ({ ok: true });

    const semilla = () => {
      D.sales.length = 0; D.payments.length = 0; D.products.length = 0;
      if (D.returns) D.returns.length = 0;
      if (D.exchanges) D.exchanges.length = 0;
      if (D.loans) D.loans.length = 0;
      if (D.movements) D.movements.length = 0;
      if (D.promos) D.promos.length = 0;
      const snap = C.snapshot();
      snap.catalogs.size_number = [
        { code: '36', label: '36', active: true, meta: {} },
        { code: '0', label: '38', active: true, meta: {} },
        { code: 'A', label: '40', active: true, meta: {} },
        { code: 's', label: '0', active: true, meta: {} },
      ];
      C.load(snap);
      C.setCatalogMeta('size_number', { inSku: true });
      const p = D.hydrate({
        id: 'V-MIG', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo: '901',
        nombre: 'VERIF MIGRACION', orn: '—', ornColors: [], precio: 1000, costo: 100, pop: false, stock: [],
      });
      p.stock = [
        { talla: '36', escala: 'N', stock: 3 },
        { talla: '0', escala: 'N', stock: 11 },
        { talla: 'A', escala: 'N', stock: 7 },
        { talla: 's', escala: 'N', stock: 2 },
      ];
      p.attrs = Object.assign({}, p.attrs, { __sizeCategoryId: 'size_number' });
      p.sizeCategoryId = 'size_number';
      p.preciosTalla = { '0': 1777 };
      p.barcodeUrls = { 'A': 'https://x/a.png' };
      D.products.push(p); D.saveProducts(false);
      return p;
    };
    const huella = () => {
      const p = D.products.find(x => x.id === 'V-MIG');
      return JSON.stringify({
        t: (p.stock || []).reduce((a, v) => a + (Number(v.stock) || 0), 0),
        r: (p.stock || []).map(v => v.talla + ':' + v.stock).sort().join(','),
        pr: p.preciosTalla, bc: p.barcodeUrls,
        cat: (C.all('size_number') || []).map(x => x.code + '=' + x.label).join(','),
      });
    };
    const MAPA = { '0': '38', 'A': '40', 's': '0' };
    const out = {};

    semilla();
    const antes = huella();
    const total0 = JSON.parse(antes).t;
    const res = D.migrateSizeCodes({ kind: 'size_number', map: MAPA, reorder: true });
    const p = D.products.find(x => x.id === 'V-MIG');
    out.limpia = {
      ok: res.ok, error: res.error, total0,
      totalDespues: (p.stock || []).reduce((a, v) => a + (Number(v.stock) || 0), 0),
      porTalla: (p.stock || []).map(v => v.talla + ':' + v.stock).sort().join(','),
      precios: JSON.stringify(p.preciosTalla), barcodes: JSON.stringify(p.barcodeUrls),
      catalogo: (C.all('size_number') || []).map(x => x.code + '=' + x.label).join(','),
      sku: p.sku, code38: window.BARCODES.codeOf(p, '38'), code40: window.BARCODES.codeOf(p, '40'),
    };

    const pr = semilla();
    const li = [{ key: 'k', p: pr, talla: '0', qty: 1, res: { orig: 1000, unit: 1000, promos: [] } }];
    const q = D.saleQuote(li, []);
    D.recordSale({
      ticket: li, quote: q, sellerIds: D.sellers.length ? [D.sellers[0].id] : [],
      client: D.clients.find(c => c.generic), metodo: 'Efectivo', estado: 'Pagado',
      subtotal: q.subtotal, iva: q.iva, total: q.finalTotal, pagoEfectivo: q.finalTotal, pagoOtro: 0,
      pagoDetalle: { efectivo: q.finalTotal }, metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 1,
    });
    const antesDoc = huella();
    const res2 = D.migrateSizeCodes({ kind: 'size_number', map: MAPA, reorder: true });
    out.conDocumentos = { ok: res2.ok, code: res2.code, documentos: res2.documentos, intacto: antesDoc === huella() };
    return out;
  });

  check('la migración se ejecuta en el paquete publicado', r.limpia.ok === true, String(r.limpia.error));
  check('no se movió una sola pieza', r.limpia.totalDespues === r.limpia.total0,
    `${r.limpia.total0} → ${r.limpia.totalDespues}`);
  check('las existencias quedan bajo la talla real',
    r.limpia.porTalla === '0:2,36:3,38:11,40:7', r.limpia.porTalla);
  check('precios y códigos de barras se remapean',
    r.limpia.precios === '{"38":1777}' && /"40":"https:\/\/x\/a\.png"/.test(r.limpia.barcodes),
    r.limpia.precios + ' · ' + r.limpia.barcodes);
  check('el catálogo queda ordenado y sin códigos falsos',
    r.limpia.catalogo === '0=0,36=36,38=38,40=40', r.limpia.catalogo);
  check('el código de barras imprime la talla real',
    /-38$/.test(r.limpia.code38) && /-40$/.test(r.limpia.code40),
    `${r.limpia.code38} · ${r.limpia.code40}`);
  check('con documentos vivos se niega', r.conDocumentos.ok === false
    && r.conDocumentos.code === 'DOCUMENTS_PRESENT', String(r.conDocumentos.code));
  check('y no tocó absolutamente nada', r.conDocumentos.intacto === true);
  check('sin errores de consola en el artefacto publicado', errs.length === 0, errs.join(' | '));
} finally { await b.close(); }

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
