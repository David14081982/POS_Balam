// H-144: el artefacto gráfico, no sólo la llamada a imprimir.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import { createServer } from 'node:http';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };
const remote = process.argv.find(a => /^https?:/.test(a));
const server = remote ? null : createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(fs.readFileSync('index.html')); });
if (server) await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  // Referencia a 3x: evita ampliar letras ya rasterizadas a 1x antes de binarizar.
  const context = await browser.newContext({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 3, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', hasTouch: true });
  await context.route(/supabase\.co/, r => r.abort());
  const page = await context.newPage(), errors = [], requests = [], cached = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(remote || `http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.BalamTicket && window.UI);
  await page.evaluate(() => {
    window.__intents = [];
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="intent:"]');
      if (a) { e.preventDefault(); __intents.push({ href: a.href, active: navigator.userActivation.isActive }); }
    }, true);
    window.__sale = { folio: 'BG-260905-0144', fecha: '2026-09-05 12:00', estado: 'Pagado', metodo: 'Efectivo', total: 500, subtotal: 431.03, iva: 68.97, vendedor: 'José Muñoz',
      lineas: [{ productId: 'h144-v1', nombre: 'Guayabera histórica Ñ', sku: 'SKU-V1-XS', talla: 'XS', qty: 1, precio: 500 }] };
    const host = document.createElement('div'); document.body.appendChild(host);
    window.__root = ReactDOM.createRoot(host);
    window.__render = () => __root.render(React.createElement(React.Fragment, null,
      React.createElement(BalamTicket, { sale: __sale }), React.createElement(UI.ReceiptPrintHelp),
      React.createElement('button', { 'data-testid': 'h144-print', onClick: () => UI.printReceipt() }, 'Imprimir')));
    __render();
    window.__business = JSON.stringify([DATA.sales, DATA.payments, DATA.products, DATA.movements, DATA.returns]);
  });
  await page.locator('#balam-ticket').waitFor({ state: 'attached' });
  await page.waitForFunction(() => /con el diseño|No se pudo|El diseño/.test(document.querySelector('[data-testid="receipt-design-status"]')?.textContent || ''));
  await page.getByTestId('h144-print').click();
  const intent = await page.evaluate(() => __intents.at(-1));
  check('Android entrega un documento gráfico conservando el gesto', !!intent?.active && intent.href.startsWith('intent:data:image/png;base64,'));
  if (intent) {
    const png = intent.href.slice(7).split('#Intent;')[0];
    fs.writeFileSync('h144-android.png', Buffer.from(png.split(',')[1], 'base64'));
    await page.emulateMedia({ media: 'print' });
    await page.locator('#balam-ticket').screenshot({ path: 'h144-chrome.png' });
    await page.pdf({ path: 'h144-chrome.pdf', preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    check('PNG codificado íntegro', png.startsWith('data:image/png;base64,iVBORw0KGgo'));
  }
  page.on('response', r => {
    if (/^https?:/.test(r.url()) && !r.url().includes('supabase.co')) (r.fromServiceWorker() ? cached : requests).push(r.url());
  });
  page.on('requestfailed', r => { if (/^https?:/.test(r.url()) && !r.url().includes('supabase.co')) requests.push(r.url()); });
  const metrics = [];
  async function compare(name, selector = '#balam-ticket') {
    const prepared = await page.evaluate(async selector => {
      const state = UI.prepareReceipt(document.querySelector(selector));
      await state.promise;
      return { error: state.error?.message, png: state.png };
    }, selector);
    check(name + ': diseño preparado completo', !!prepared.png, prepared.error || '');
    if (!prepared.png) return;
    const before = await page.evaluate(() => __intents.length);
    await page.getByTestId('h144-print').click();
    check(name + ': botón envía exactamente la imagen preparada con gesto', await page.evaluate(({ before, png }) => __intents.length === before + 1 && __intents.at(-1).active && __intents.at(-1).href === 'intent:' + png + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;', { before, png: prepared.png }));
    await page.emulateMedia({ media: 'print' });
    const box = await page.locator(selector).boundingBox();
    const crop = await page.locator(selector).evaluate(root => {
      const content = root.matches('#balam-ticket, #balam-return-receipt') ? root.firstElementChild : root;
      const padding = getComputedStyle(content);
      return { left: Math.max(0, parseFloat(padding.paddingLeft) - 1), right: Math.max(0, parseFloat(padding.paddingRight) - 1) };
    });
    const printStyle = await page.addStyleTag({ content: `${selector} * { border-color: #000 !important }` });
    const reference = await page.locator(selector).screenshot();
    await printStyle.evaluate(el => el.remove());
    await page.emulateMedia({ media: 'screen' });
    const metric = await page.evaluate(async ({ actual, reference, box, crop }) => {
      const a = new Image(), b = new Image(); a.src = actual; b.src = reference;
      await Promise.all([a.decode(), b.decode()]);
      const canvas = document.createElement('canvas'); canvas.width = a.width; canvas.height = a.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(a, 0, 0); const aa = ctx.getImageData(0, 0, a.width, a.height).data;
      ctx.clearRect(0, 0, a.width, a.height);
      ctx.drawImage(b, crop.left * b.width / box.width, 0, (box.width - crop.left - crop.right) * b.width / box.width, b.height, 0, 0, a.width, a.height);
      const bb = ctx.getImageData(0, 0, a.width, a.height).data;
      let delta = 0, ink = 0, grayPixels = 0, inkLeft = a.width, inkRight = 0;
      for (let i = 0; i < aa.length; i += 4) {
        const black = bb[i] * 0.2126 + bb[i + 1] * 0.7152 + bb[i + 2] * 0.0722 < 200 ? 0 : 255;
        bb[i] = bb[i + 1] = bb[i + 2] = black;
        delta += Math.abs(aa[i] - bb[i]) + Math.abs(aa[i + 1] - bb[i + 1]) + Math.abs(aa[i + 2] - bb[i + 2]);
        if (aa[i] > 0 && aa[i] < 255) grayPixels++;
        if (aa[i] < 200) { ink++; const x = (i / 4) % a.width; inkLeft = Math.min(inkLeft, x); inkRight = Math.max(inkRight, x); }
      }
      // SVG y screenshot redondean a píxeles distintos. Comparación bidireccional
      // con tolerancia espacial de 2 puntos, sin tolerar contenido ausente.
      let missing = 0, referenceInk = 0;
      for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
        const i = (y * a.width + x) * 4;
        if (bb[i] === 0) referenceInk++;
        if (aa[i] !== bb[i]) {
          const target = aa[i] === 0 ? bb : aa;
          let found = false;
          for (let dy = -2; dy <= 2 && !found; dy++) for (let dx = -2; dx <= 2; dx++) {
            if (x + dx >= 0 && x + dx < a.width && y + dy >= 0 && y + dy < a.height && target[((y + dy) * a.width + x + dx) * 4] === 0) { found = true; break; }
          }
          if (!found) missing++;
        }
      }
      return { width: a.width, height: a.height, expectedHeight: box.height * 576 / (box.width - crop.left - crop.right), meanError: delta / (a.width * a.height * 3), missingRatio: missing / (ink + referenceInk), inkRatio: ink / referenceInk, ink, grayPixels, inkWidth: inkRight - inkLeft + 1, bytes: actual.length };
    }, { actual: prepared.png, reference: 'data:image/png;base64,' + reference.toString('base64'), box, crop });
    check(name + ': geometría coincide con Chrome sin recortar', metric.width === 576 && Math.abs(metric.height - metric.expectedHeight) < 3, metric);
    check(name + ': paridad visual con raster de Chrome', metric.missingRatio < 0.01 && Math.abs(metric.inkRatio - 1) < 0.1 && metric.ink > 3000, metric);
    check(name + ': H145 aprovecha al menos 71 mm del cabezal', metric.inkWidth >= 568, metric.inkWidth / 8);
    check(name + ': H145 texto con negro sólido sin grises', metric.grayPixels === 0, metric.grayPixels);
    fs.writeFileSync('h144-' + name + '.png', Buffer.from(prepared.png.split(',')[1], 'base64'));
    metrics.push({ name, ...metric });
    return prepared.png;
  }
  await compare('historico-v1');
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,128,128);
    ctx.fillStyle = '#131b2e'; ctx.fillRect(5,5,118,118); ctx.fillStyle = '#fff'; ctx.font = 'bold 80px serif'; ctx.fillText('B',35,92);
    CONFIG.setSetting('store.logo', canvas.toDataURL('image/png'));
    __render();
  });
  await page.locator('#balam-ticket img').waitFor({ state: 'attached' });
  await compare('logo-personalizado');
  const logoPNG = await page.evaluate(() => CONFIG.get('store.logo'));
  for (const [name, count, kind] of [['larga-v2',24,'sale'], ['corta-despues',1,'sale'], ['abono',6,'payment'], ['cambio',6,'exchange'], ['devolucion',12,'return']]) {
    await page.evaluate(({ count, kind }) => {
      const lines = Array.from({ length: count }, (_, i) => ({ productId: 'ref-' + i, line_id: 'line-' + i, nombre: 'PRENDA ' + (i+1) + ' GUAYABERA ARTESANAL', sku: '21-GUAYABERA-MC-LINO-AZUL-' + i, talla: 'M', qty: 1, precio: 500, precioOrig: 500, precioBase: 500, promos: [], ornamento: 'ALFORZAS', ornColors: ['AZUL MARINO'] }));
      __sale = { ...__sale, total: count * 500, subtotal: count * 500 / 1.16, iva: count * 500 * 0.16 / 1.16, lineas: lines, estado: kind === 'payment' ? 'Apartado' : 'Pagado', saldo: kind === 'payment' ? count * 500 - 100 : 0,
        receiptSnapshot: { version: 1, sellerName: 'José Muñoz', store: { name: 'Balam Guayaberas', footer: 'Gracias por su compra' }, lines: lines.map(l => ({ name: l.nombre, sku: l.sku, sizeLabel: l.talla, colorLabel: 'Azul' })) } };
      const props = { sale: __sale };
      if (kind === 'payment') props.payment = { id: 'p-h144', folio: __sale.folio, fecha: __sale.fecha, tipo: 'abono', metodo: 'Efectivo', monto: 100 };
      if (kind === 'exchange') props.exchange = { folio: 'CMB-H144', origenFolio: __sale.folio, diferencia: 0, lineas: [{ ...lines[0], lado: 'devuelto' }, { ...lines[0], lado: 'entregado' }] };
      if (kind === 'return') props.returnDoc = { id: 'DEV-H144', folio: __sale.folio, fecha: __sale.fecha, metodo: 'Efectivo', total: __sale.total, lineas: lines };
      __root.render(React.createElement(React.Fragment, null,
        React.createElement(kind === 'return' ? BalamReturnReceipt : BalamTicket, props),
        React.createElement(UI.ReceiptPrintHelp), React.createElement('button', { 'data-testid': 'h144-print', onClick: () => UI.printReceipt() }, 'Imprimir')));
    }, { count, kind });
    const selector = kind === 'return' ? '#balam-return-receipt' : '#balam-ticket';
    await page.waitForFunction(({ selector, count }) => document.querySelector(selector)?.textContent.includes('PRENDA ' + count), { selector, count });
    await compare(name, selector);
  }
  check('corta posterior no conserva la altura larga', metrics.find(m => m.name === 'corta-despues')?.height < metrics.find(m => m.name === 'larga-v2')?.height);
  await page.evaluate(() => { __render(); });
  await page.locator('#balam-ticket').waitFor({ state: 'attached' });
  await context.setOffline(true);
  for (const width of [320,360,390,430,768,1024,1280,1440]) {
    await page.setViewportSize({ width, height: 900 });
    const value = await page.evaluate(async () => { const s = UI.prepareReceipt(); await s.promise; return { png: s.png, error: s.error?.message }; });
    check('offline ancho ' + width + ': gráfico completo', !!value.png, value.error || '');
  }
  check('preparación sin tráfico de red; recursos PWA en cache identificados', requests.length === 0, { network: requests, serviceWorker: cached });
  await page.evaluate(() => { __sale = { ...__sale, folio: 'BG-260905-0145' }; __render(); });
  await page.waitForFunction(() => document.querySelector('#balam-ticket')?.textContent.includes('BG-260905-0145'));
  const beforePrepare = await page.evaluate(() => __intents.length);
  await page.getByTestId('h144-print').click();
  await page.evaluate(() => UI.prepareReceipt().promise);
  check('clic durante preparación no abre aplicaciones después de perder el gesto', await page.evaluate(n => __intents.length === n, beforePrepare));
  await page.getByTestId('h144-print').click();
  check('clic posterior envía el nuevo folio preparado', await page.evaluate(n => __intents.length === n + 1 && __intents.at(-1).active, beforePrepare));
  await page.evaluate(() => { document.querySelector('#balam-ticket img').src = 'data:image/png;base64,invalid'; });
  const broken = await page.evaluate(async () => { const s = UI.prepareReceipt(); await s.promise; return { png: s.png, error: s.error?.message }; });
  check('logo inválido bloquea imagen incompleta con error legible', !broken.png && /No se pudo preparar el diseño/.test(broken.error || ''));
  await page.evaluate(logo => { document.querySelector('#balam-ticket img').src = logo; }, logoPNG);
  const pending = await page.evaluate(async () => {
    const count = __intents.length;
    const state = UI.prepareReceipt(); __root.unmount(); await state.promise;
    return { unchanged: __intents.length === count, remaining: document.querySelectorAll('iframe').length };
  });
  check('cerrar durante preparación no imprime y libera recursos', pending.unchanged && pending.remaining === 0);
  check('sin mutación de documentos ni stock', await page.evaluate(() => __business === JSON.stringify([DATA.sales, DATA.payments, DATA.products, DATA.movements, DATA.returns])));
  check('sin frames temporales tras preparar', await page.locator('iframe').count() === 0);
  check('sin excepciones', errors.length === 0, errors);
  fs.writeFileSync('h144-visual-metrics.json', JSON.stringify(metrics, null, 2));
} finally { await browser.close(); if (server) await new Promise(r => server.close(r)); }
console.log(`${results.filter(Boolean).length}/${results.length}`);
process.exitCode = results.every(Boolean) ? 0 : 1;
