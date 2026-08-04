// test-h74-codigos-de-talla.mjs — H-74: los códigos de talla pasan a ser la talla
// real, sin mover una sola pieza.
//
// El catálogo `size_number` guarda identidades históricas que no son la talla que
// representan: `0` es la 38, `A` la 40, `B` la 42, `s` la 0. `stock[].talla`,
// `preciosTalla`, `barcodeUrls` y el alcance de las promociones guardan esa
// identidad, y `BARCODES.codeOf` la imprime en la etiqueta, así que el código de
// barras de una prenda talla 38 dice «…-0».
//
// Contrato que se exige aquí:
//   · renombrar es ATÓMICO sobre catálogo, existencias, precios por talla,
//     códigos de barras y promociones;
//   · la huella de inventario —total, por producto y número de renglones— es
//     IDÉNTICA antes y después: se renombra, no se reubica;
//   · resuelve el orden solo (`0→38` antes que `s→0`, que colisionan);
//   · se NIEGA a correr si existe cualquier documento vivo, y entonces no toca
//     absolutamente nada;
//   · deja el catálogo ordenado por talla.
//
// Uso: node test-h74-codigos-de-talla.mjs
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
await new Promise(r => server.listen(8852, '127.0.0.1', r));

let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort());
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto('http://127.0.0.1:8852/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 30000 });

  await page.evaluate(() => {
    const D = window.DATA, C = window.CONFIG;
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'pushReturn', 'pushExchange', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    window.CORE.invokeSync = () => ({ ok: true });

    // Reproduce EL CATÁLOGO REAL: identidades históricas mezcladas con numéricas.
    window.__semilla = () => {
      D.sales.length = 0; D.payments.length = 0; D.products.length = 0;
      if (D.returns) D.returns.length = 0;
      if (D.exchanges) D.exchanges.length = 0;
      if (D.loans) D.loans.length = 0;
      if (D.movements) D.movements.length = 0;
      if (D.promos) D.promos.length = 0;
      const snap = C.snapshot();
      snap.catalogs.size_number = [
        { code: '36', label: '36', active: true, meta: {} },
        { code: '37', label: '37', active: true, meta: {} },
        { code: '0',  label: '38', active: true, meta: {} },   // ← la 38
        { code: '39', label: '39', active: true, meta: {} },
        { code: 'A',  label: '40', active: true, meta: {} },   // ← la 40
        { code: 'B',  label: '42', active: true, meta: {} },   // ← la 42
        { code: 's',  label: '0',  active: true, meta: {} },   // ← la 0 real
      ];
      C.load(snap);
      // En el catálogo real la talla numérica está «En SKU», por eso los SKUs de
      // producción llevan el marcador T (1-ARO-MC-AMAR-T). La semilla no lo trae.
      C.setCatalogMeta('size_number', { inSku: true });
      // Producto con existencias repartidas en las identidades históricas.
      const p = D.hydrate({
        id: 'P-MIG', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo: '901',
        nombre: 'GUAYABERA MIGRACION', orn: '—', ornColors: [], precio: 1000, costo: 100, pop: false,
        stock: [],
      });
      p.stock = [
        { talla: '36', escala: 'N', stock: 3 },
        { talla: '0',  escala: 'N', stock: 11 },
        { talla: 'A',  escala: 'N', stock: 7 },
        { talla: 'B',  escala: 'N', stock: 5 },
        { talla: 's',  escala: 'N', stock: 2 },
      ];
      p.attrs = Object.assign({}, p.attrs, { __sizeCategoryId: 'size_number' });
      p.sizeCategoryId = 'size_number';
      p.preciosTalla = { '0': 1777, 'A': 1888 };
      p.barcodeUrls = { '0': 'https://x/uno.png', 'B': 'https://x/dos.png' };
      D.products.push(p);
      D.saveProducts(false);
      if (D.promos) {
        D.promos.push({ id: 'pr1', nombre: 'Promo talla', tipo: 'pct', valor: 10, activa: true,
          scope: { tallas: ['0', 'B'] } });
        if (D.savePromos) D.savePromos(false);
      }
      return true;
    };
    window.__huella = () => {
      const p = D.products.find(x => x.id === 'P-MIG');
      return {
        total: (p.stock || []).reduce((a, v) => a + (Number(v.stock) || 0), 0),
        renglones: (p.stock || []).length,
        porTalla: (p.stock || []).map(v => v.talla + ':' + v.stock).sort().join(','),
        precios: JSON.stringify(p.preciosTalla || {}),
        barcodes: JSON.stringify(p.barcodeUrls || {}),
        promo: JSON.stringify(((D.promos || [])[0] || {}).scope || {}),
        catalogo: (C.all('size_number') || []).map(x => x.code + '=' + x.label).join(','),
      };
    };
    window.__MAPA = { '0': '38', 'A': '40', 'B': '42', 's': '0' };
  });

  const existe = await page.evaluate(() => typeof window.DATA.migrateSizeCodes);
  check('DATA publica la autoridad de migración de códigos de talla',
    existe === 'function', 'typeof = ' + existe);

  // ── A) Migración limpia ───────────────────────────────────────────────────
  console.log('\n── A) Renombra sin mover una sola pieza ──────────────────────────');
  const limpia = await page.evaluate(() => {
    window.__semilla();
    const antes = window.__huella();
    if (typeof window.DATA.migrateSizeCodes !== 'function') return { antes, sinAutoridad: true };
    const r = window.DATA.migrateSizeCodes({ kind: 'size_number', map: window.__MAPA, reorder: true });
    return { antes, despues: window.__huella(), r };
  });
  check('la migración se ejecuta', !limpia.sinAutoridad && limpia.r && limpia.r.ok === true,
    limpia.sinAutoridad ? 'no existe la autoridad' : JSON.stringify(limpia.r && limpia.r.error));
  check('el total de piezas no cambia',
    !!limpia.despues && limpia.despues.total === limpia.antes.total,
    `${limpia.antes.total} → ${limpia.despues && limpia.despues.total}`);
  check('el número de renglones de existencias no cambia',
    !!limpia.despues && limpia.despues.renglones === limpia.antes.renglones,
    `${limpia.antes.renglones} → ${limpia.despues && limpia.despues.renglones}`);
  check('las existencias quedan bajo la talla real',
    !!limpia.despues && limpia.despues.porTalla === '0:2,36:3,38:11,40:7,42:5',
    limpia.despues && limpia.despues.porTalla);
  check('los precios por talla se remapean',
    !!limpia.despues && limpia.despues.precios === '{"38":1777,"40":1888}', limpia.despues && limpia.despues.precios);
  check('las claves de códigos de barras se remapean',
    !!limpia.despues && /"38":"https:\/\/x\/uno\.png"/.test(limpia.despues.barcodes)
    && /"42":"https:\/\/x\/dos\.png"/.test(limpia.despues.barcodes), limpia.despues && limpia.despues.barcodes);
  check('el alcance de las promociones se remapea',
    !!limpia.despues && /"tallas":\["38","42"\]/.test(limpia.despues.promo), limpia.despues && limpia.despues.promo);
  check('la colisión s→0 se resuelve por orden (0 se libera antes)',
    !!limpia.despues && /(^|,)0=0(,|$)/.test(limpia.despues.catalogo) && /(^|,)38=38(,|$)/.test(limpia.despues.catalogo),
    limpia.despues && limpia.despues.catalogo);
  check('el catálogo queda ordenado por talla',
    !!limpia.despues && limpia.despues.catalogo === '0=0,36=36,37=37,38=38,39=39,40=40,42=42',
    limpia.despues && limpia.despues.catalogo);

  // ── B) El código de barras usa la talla real ──────────────────────────────
  console.log('\n── B) El código de barras imprime la talla real ──────────────────');
  const barras = await page.evaluate(() => {
    const D = window.DATA;
    const p = D.products.find(x => x.id === 'P-MIG');
    return { sku: p.sku, t38: window.BARCODES.codeOf(p, '38'), t40: window.BARCODES.codeOf(p, '40') };
  });
  check('el SKU conserva su marcador T', /(^|-)T(-|$)/.test(barras.sku), barras.sku);
  check('la etiqueta de la talla 38 dice 38, no 0', /-38$/.test(barras.t38), barras.t38);
  check('la etiqueta de la talla 40 dice 40, no A', /-40$/.test(barras.t40), barras.t40);

  // ── C) Con documentos vivos: se niega y no toca nada ──────────────────────
  console.log('\n── C) Con documentos vivos se niega sin tocar nada ───────────────');
  const conVenta = await page.evaluate(() => {
    window.__semilla();
    const D = window.DATA;
    const p = D.products.find(x => x.id === 'P-MIG');
    const li = [{ key: 'k', p, talla: '0', qty: 1, res: { orig: 1000, unit: 1000, promos: [] } }];
    const q = D.saleQuote(li, []);
    D.recordSale({ ticket: li, quote: q, sellerIds: D.sellers.length ? [D.sellers[0].id] : [],
      client: D.clients.find(c => c.generic), metodo: 'Efectivo', estado: 'Pagado',
      subtotal: q.subtotal, iva: q.iva, total: q.finalTotal, pagoEfectivo: q.finalTotal, pagoOtro: 0,
      pagoDetalle: { efectivo: q.finalTotal }, metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 1 });
    const antes = window.__huella();
    if (typeof D.migrateSizeCodes !== 'function') return { antes, sinAutoridad: true };
    const r = D.migrateSizeCodes({ kind: 'size_number', map: window.__MAPA, reorder: true });
    return { antes, despues: window.__huella(), r };
  });
  check('la migración se rechaza si hay documentos vivos',
    !conVenta.sinAutoridad && conVenta.r && conVenta.r.ok === false,
    conVenta.sinAutoridad ? 'no existe la autoridad' : JSON.stringify(conVenta.r));
  check('el rechazo trae código accionable',
    !!conVenta.r && conVenta.r.code === 'DOCUMENTS_PRESENT', String(conVenta.r && conVenta.r.code));
  check('el rechazo dice cuántos documentos hay y de qué tipo',
    !!conVenta.r && !!conVenta.r.documentos && conVenta.r.documentos.ventas === 1,
    JSON.stringify(conVenta.r && conVenta.r.documentos));
  check('no tocó absolutamente nada',
    !!conVenta.despues && JSON.stringify(conVenta.antes) === JSON.stringify(conVenta.despues),
    conVenta.despues && conVenta.despues.catalogo);

  // ── D) Mapa inválido: destino ocupado por un código que sobrevive ─────────
  console.log('\n── D) Un mapa imposible se rechaza sin tocar nada ────────────────');
  const malo = await page.evaluate(() => {
    window.__semilla();
    const D = window.DATA;
    const antes = window.__huella();
    if (typeof D.migrateSizeCodes !== 'function') return { antes, sinAutoridad: true };
    // 36 sobrevive y no se renombra: nadie puede tomar su código.
    const r = D.migrateSizeCodes({ kind: 'size_number', map: { '0': '36' }, reorder: false });
    return { antes, despues: window.__huella(), r };
  });
  check('un destino ocupado por un código que sobrevive se rechaza',
    !malo.sinAutoridad && malo.r && malo.r.ok === false, JSON.stringify(malo.r));
  check('y no tocó nada',
    !!malo.despues && JSON.stringify(malo.antes) === JSON.stringify(malo.despues));

  // ── E) El botón real de Configuración ─────────────────────────────────────
  console.log('\n── E) El recorrido real: Configuración → Catálogos → botón ───────');
  await page.evaluate(() => { window.__semilla(); window.confirm = () => true; });
  await page.evaluate(() => {
    const x = [...document.querySelectorAll('nav button')].find(e => /Configuraci/i.test(e.innerText));
    if (x) x.click();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const x = [...document.querySelectorAll('button')].find(e => /Cat[aá]logos/i.test(e.innerText));
    if (x) x.click();
  });
  await page.waitForTimeout(700);
  const antesBoton = await page.evaluate(() => window.__huella());
  const hayBoton = await page.evaluate(() => !!document.querySelector('[data-testid="migrar-codigos-talla"]'));
  check('la pantalla ofrece el botón de corrección', hayBoton === true);
  await page.evaluate(() => {
    const b = document.querySelector('[data-testid="migrar-codigos-talla"]');
    if (b) b.click();
  });
  await page.waitForTimeout(900);
  const trasBoton = await page.evaluate(() => window.__huella());
  check('el botón deja las existencias bajo la talla real',
    trasBoton.porTalla === '0:2,36:3,38:11,40:7,42:5', trasBoton.porTalla);
  check('el botón conserva el total de piezas',
    trasBoton.total === antesBoton.total, `${antesBoton.total} → ${trasBoton.total}`);
  check('el botón deja el catálogo ordenado',
    trasBoton.catalogo === '0=0,36=36,37=37,38=38,39=39,40=40,42=42', trasBoton.catalogo);
  const resumen = await page.evaluate(() => {
    const t = [...document.querySelectorAll('p')].map(e => e.textContent || '').filter(x => /Reimprime/i.test(x));
    return t.join(' | ');
  });
  check('el botón dice cuántas etiquetas hay que reimprimir', /Reimprime\s+4\s+etiqueta/i.test(resumen), resumen);

  check('sin errores de consola durante el recorrido', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
