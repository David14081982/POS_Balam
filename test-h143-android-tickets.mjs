// H-143: transporte real del botón, interceptado sólo en la frontera Android.
// No comunica con Supabase ni con una impresora real.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const remote = process.argv.find(a => /^https?:/.test(a));
const root = process.cwd(), results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK' : 'FAIL'} ${name} ${detail}`); };
const server = remote ? null : createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0] === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'text/javascript');
  res.end(fs.readFileSync(file));
});
if (server) await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = remote || `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const android of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 768, height: 1024 },
      ...(android ? { userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', hasTouch: true } : {}) });
    await context.route(/supabase\.co/, r => r.abort());
    await context.addInitScript(() => {
      window.__nativePrints = 0; window.__intents = [];
      window.print = () => { window.__nativePrints++; };
      document.addEventListener('click', e => {
        const a = e.target.closest('a[href^="intent:"]');
        if (a) { e.preventDefault(); window.__intents.push({ href: a.href, active: navigator.userActivation.isActive }); }
      }, true);
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(url);
    await page.waitForFunction(() => window.DATA && window.ReportsScreen && window.BalamTicket);
    await page.evaluate(() => {
      const D = window.DATA;
      D.sales.length = 0; D.payments.length = 0; D.returns.length = 0;
      const sale = { id: 'h143-sale', folio: 'BG-260905-0143', fecha: '2026-09-05 10:00',
        estado: 'Pagado', metodo: 'Efectivo', cliente: 'Público en general', vendedor: 'José Muñoz',
        total: 1000, subtotal: 862.07, iva: 137.93, itemCount: 2,
        lineas: [{ productId: 'h143-v1', nombre: 'GUAYABERA HISTÓRICA Ñ', sku: 'SKU-V1-XS', talla: 'XS', qty: 1, precio: 500 },
          { productId: 'h143-v2', nombre: 'GUAYABERA V2', sku: 'SKU-V2-M', talla: 'M', qty: 1, precio: 500 }] };
      D.sales.push(sale);
      D.payments.push({ id: 'h143-pay', folio: sale.folio, fecha: sale.fecha, tipo: 'venta', monto: 1000, metodo: 'Efectivo',
        components: [{ methodCode: 'Efectivo', methodLabel: 'Efectivo', amount: 1000 }] });
      window.__business = JSON.stringify([D.sales, D.payments, D.products, D.movements, D.returns]);
      window.__host = document.createElement('div'); window.__host.id = 'h143-host'; document.body.appendChild(window.__host);
      window.__reactRoot = ReactDOM.createRoot(window.__host);
      window.__reactRoot.render(React.createElement(window.ReportsScreen));
    });
    await page.getByTestId('reports-tab-sales').click();
    await page.getByTestId('sales-reprint-BG-260905-0143').click();
    await page.locator('#balam-ticket').waitFor({ state: 'attached' });
    await page.waitForTimeout(250);
    check(`${android}: autoimpresión respeta plataforma`, await page.evaluate(a => window.__nativePrints === (a ? 0 : 1) && !window.__intents.length, android));
    const button = page.getByTestId('receipt-print');
    check(`${android}: acción manual accesible`, await button.count() === 1);
    if (!await button.count()) { await context.close(); continue; }
    await button.click();
    const sent = await page.evaluate(() => ({ intents: window.__intents, prints: window.__nativePrints }));
    check(`${android}: botón entrega al transporte correcto`, android ? sent.intents.length === 1 && sent.prints === 0 : sent.prints === 2 && !sent.intents.length);
    if (android) {
      const intent = sent.intents[0];
      const text = decodeURIComponent(intent.href.slice(7).split('#Intent;')[0]);
      check('RawBT: gesto activo y paquete explícito', intent.active && intent.href.endsWith('#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;'));
      check('RawBT: conserva V1/V2, acentos, folio y total', ['GUAYABERA HISTÓRICA Ñ', 'GUAYABERA V2', 'SKU-V1-XS', 'SKU-V2-M', 'José Muñoz', 'BG-260905-0143', '$1,000.00', 'BALAMGUAYABERAS.COM'].every(v => text.includes(v)));
      check('RawBT: sin iconos técnicos', !/landscape|payments|account_balance|credit_card/.test(text));
      await button.click();
      check('RawBT: reintento entrega exactamente el mismo documento', await page.evaluate(() => window.__intents.length === 2 && window.__intents[0].href === window.__intents[1].href));
      for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const box = await button.boundingBox();
        check(`Android ${width}: botón visible y pulsable`, !!box && box.x >= 0 && box.x + box.width <= width + 1 && box.height >= 44);
      }
      const safe = await page.evaluate(() => {
        const el = document.createElement('div'); el.textContent = 'José #Intent;package=evil; \u001b@\u0000 $50'; document.body.appendChild(el);
        const value = UI.receiptPrintText(el); el.remove(); return value;
      });
      check('texto no introduce comandos de impresora', !/[\x00-\x08\x0b-\x1f\x7f]/.test(safe) && safe.includes('José'));
      await page.getByTestId('receipt-print-system').click();
      check('Android: alternativa del sistema disponible', await page.evaluate(() => window.__nativePrints === 1));
      await context.setOffline(true);
      await button.click();
      check('Android: transporte funciona sin internet', await page.evaluate(() => window.__intents.length === 3));
      await context.setOffline(false);
      await page.screenshot({ path: path.join(root, 'h143-tablet-qa.png') });
    }
    check(`${android}: imprimir no muta negocio`, await page.evaluate(() => window.__business === JSON.stringify([DATA.sales, DATA.payments, DATA.products, DATA.movements, DATA.returns])));
    await page.getByTestId('sales-reprint-close').click();
    await page.getByTestId('reports-tab-metodos').click();
    const popupPromise = context.waitForEvent('page');
    await page.getByTestId('payment-method-ticket').click();
    const popup = await popupPromise; await popup.waitForLoadState();
    // document.write() elimina listeners del documento about:blank inicial.
    await popup.evaluate(() => document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="intent:"]');
      if (a) { e.preventDefault(); window.__intents.push({ href: a.href, active: navigator.userActivation.isActive }); }
    }, true));
    await popup.getByTestId('payment-ticket-print').click();
    check(`${android}: ticket por método comparte transporte`, await popup.evaluate(a => a ? window.__intents.length === 1 && window.__nativePrints === 0 : window.__nativePrints === 1, android));
    if (android) {
      const reportPayload = await popup.evaluate(() => decodeURIComponent(window.__intents[0].href.slice(7).split('#Intent;')[0]));
      check('Reportes: payload incluye neto y conciliación', /NETO/.test(reportPayload) && /CONCILIACIÓN/.test(reportPayload));
      check('Reportes: alternativa del sistema legible', await popup.getByTestId('payment-ticket-system').textContent() === 'Impresión del sistema');
      await popup.evaluate(() => { document.querySelector('main').textContent = ''; });
      await popup.getByTestId('payment-ticket-print').click();
      check('documento vacío: error visible y ningún envío', await popup.evaluate(() => __intents.length === 1 && /vacío/.test(document.getElementById('receipt-print-status').textContent)));
      await popup.evaluate(() => { document.querySelector('main').textContent = 'A'.repeat(500001); });
      await popup.getByTestId('payment-ticket-print').click();
      check('documento excesivo: se bloquea completo, nunca se trunca', await popup.evaluate(() => __intents.length === 1 && /demasiado largo/.test(document.getElementById('receipt-print-status').textContent)));
      await popup.evaluate(() => {
        document.querySelector('main').textContent = 'Folio prueba de error';
        HTMLAnchorElement.prototype.click = () => { throw new Error('No se pudo abrir RawBT'); };
      });
      await popup.getByTestId('payment-ticket-print').click();
      check('fallo al abrir: error visible y sin falso éxito', await popup.evaluate(() => __intents.length === 1 && /No se pudo abrir RawBT/.test(document.getElementById('receipt-print-status').textContent)));
      await popup.close();
      await page.setViewportSize({ width: 768, height: 1024 });
      const code = await page.evaluate(() => {
        const D = window.DATA;
        D.products.length = 0; D.sellers.length = 0;
        D.sellers.push({ id: 'h143-seller', nombre: 'José Muñoz', role: 'vendedor', active: true, comisionPct: 0 });
        if (!D.clients.some(c => c.generic)) D.clients.push({ id: 'h143-client', nombre: 'Público en general', generic: true });
        const p = D.hydrate({ id: 'h143-pos', cat: '21', modelo: 'H143', nombre: 'VENTA POS ANDROID',
          manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR', precio: 500, costo: 0, stock: D.mkStock([5,5], []) });
        D.products.push(p);
        window.__reactRoot.render(React.createElement(window.POSScreen));
        return BARCODES.codeOf(p, D.SIZES_LETRA[0]);
      });
      const pos = page.locator('#h143-host');
      await pos.getByTestId('pos-barcode-input').fill(code);
      await pos.getByTestId('pos-barcode-input').press('Enter');
      await pos.getByTestId('pos-cart-open').click();
      await page.getByTestId('pos-checkout-open').filter({ visible: true }).click();
      await page.getByTestId('checkout-recibido').fill('500');
      await page.getByTestId('checkout-confirmar').click();
      await page.getByTestId('seller-pick-h143-seller').click();
      await page.getByTestId('seller-pick-confirm').click();
      await page.getByTestId('receipt-print').waitFor();
      const before = await page.evaluate(() => ({ sent: __intents.length, business: JSON.stringify([DATA.sales,DATA.payments,DATA.products,DATA.movements]) }));
      await page.getByTestId('receipt-print').click();
      check('POS: cobro → vendedor → botón envía venta correcta sin duplicar', await page.evaluate(before => {
        const payload = decodeURIComponent(__intents.at(-1).href.slice(7).split('#Intent;')[0]);
        return __intents.length === before.sent + 1 && payload.includes('VENTA POS ANDROID') && payload.includes('$500.00')
          && before.business === JSON.stringify([DATA.sales,DATA.payments,DATA.products,DATA.movements]);
      }, before));
      await page.screenshot({ path: path.join(root, 'h143-pos-qa.png') });
      await page.evaluate(() => {
        const sale = DATA.sales.find(s => s.folio === 'BG-260905-0143'); sale.estado = 'Apartado'; sale.anticipo = 100; sale.saldo = 900;
        window.__reactRoot.render(React.createElement(window.LayawayScreen));
      });
      await page.getByTestId('layaway-reprint-BG-260905-0143').click();
      await page.getByTestId('receipt-print').waitFor();
      const beforeLayaway = await page.evaluate(() => __intents.length);
      await page.getByTestId('receipt-print').click();
      check('apartados Android: reimpresión manual permanece abierta', await page.evaluate(n => __intents.length === n + 1 && !!document.getElementById('balam-ticket'), beforeLayaway));
      await page.getByTestId('layaway-reprint-close').click();
      check('apartados Android: cerrar retira comprobante', await page.locator('#balam-ticket').count() === 0);
    }
    check(`${android}: sin excepciones`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
} finally { await browser.close(); if (server) await new Promise(r => server.close(r)); }
console.log(`${results.filter(r => r.ok).length}/${results.length} verificaciones`);
process.exitCode = results.some(r => !r.ok) ? 1 : 0;
