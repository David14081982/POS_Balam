// H-85: comprobantes históricos, reimpresión y superficies de impresión.
// Ejecuta el bundle distribuido. Supabase queda interceptado: ninguna prueba
// escribe datos remotos.
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('.');
const REMOTE_URL = /^https?:\/\//.test(process.argv[2] || '') ? process.argv[2] : '';
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = REMOTE_URL ? null : http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
if (server) await new Promise(resolve => server.listen(8871, '127.0.0.1', resolve));

let pass = 0, fail = 0;
const errors = [];
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
};
const source = name => fs.readFileSync(path.join(ROOT, name), 'utf8');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.addInitScript(() => {
    window.__printed = 0;
    window.print = () => { window.__printed += 1; };
  });
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto(REMOTE_URL || 'http://127.0.0.1:8871/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.BalamTicket, null, { timeout: 25000 });

  const seeded = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) {
      window.STORE.pushRows = () => {};
      window.STORE.pushSale = () => {};
      window.STORE.pushReturn = () => {};
      window.STORE.pushConfig = () => {};
    }
    D.products.length = 0; D.sales.length = 0; D.returns.length = 0;
    D.payments.length = 0; D.movements.length = 0; D.sellers.length = 0;
    D.sellers.push({ id: 'h85-seller', nombre: 'Vendedora Histórica', role: 'vendedor', active: true, comisionPct: 0 });
    const p = D.hydrate({
      id: 'h85-original', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
      modelo: 'H85', nombre: 'GUAYABERA HISTÓRICA', orn: 'PEDAL', ornColors: ['DRO'],
      precio: 500, costo: 0, stock: D.mkStock([20, 20], []),
    });
    D.products.push(p);
    const size = D.SIZES_LETRA[0];
    const sale = D.recordSale({
      ticket: [{ p, talla: size, qty: 2 }], sellerIds: ['h85-seller'], client: null,
      metodo: 'Efectivo', estado: 'Pagado', total: 1000, itemCount: 2,
    });
    return { folio: sale.folio, productId: p.id, sku: p.sku, size };
  });

  console.log('\n── A) Documento histórico cerrado ──');
  const historical = await page.evaluate(async seed => {
    const D = window.DATA;
    const sale = D.findSaleByFolio(seed.folio);
    const p = D.products.find(x => x.id === seed.productId);
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    const render = async () => {
      root.render(React.createElement(window.BalamTicket, { sale }));
      await new Promise(resolve => setTimeout(resolve, 80));
      return document.getElementById('balam-ticket').innerText;
    };
    const before = await render();
    p.nombre = 'NOMBRE EDITADO'; p.color = 'RJ'; p.colorName = 'ROJO'; p.precio = 9999;
    p.orn = 'OTRO'; p.ornColors = ['AZ'];
    const afterEdit = await render();
    const clone = D.hydrate({ id: 'h85-clone', cat: '21', manga: 'MC', tela: 'ALG', color: 'AZ', cuello: 'MAO',
      modelo: 'CLON', nombre: 'CLON AJENO', orn: 'CLON', ornColors: ['NE'], precio: 1,
      stock: D.mkStock([1], []), sku: seed.sku });
    clone.sku = seed.sku; clone.colorName = 'AZUL DEL CLON'; D.products.unshift(clone);
    const afterClone = await render();
    root.unmount(); host.remove();
    return {
      before, afterEdit, afterClone,
      snapshot: sale.receiptSnapshot || null,
      line: sale.lineas[0],
    };
  }, seeded);
  check('1. venta → editar producto → reimprimir produce texto idéntico', historical.before === historical.afterEdit);
  check('2. SKU duplicado no aporta datos del clon', historical.before === historical.afterClone && !/AZUL DEL CLON|CLON AJENO/.test(historical.afterClone));
  check('2b. la venta nueva conserva un snapshot visual versionado', historical.snapshot && historical.snapshot.version === 1, JSON.stringify(historical.snapshot));

  console.log('\n── B) Reimpresión de contado sin efectos ──');
  await page.evaluate(() => {
    const old = document.getElementById('h85-reports-host'); if (old) old.remove();
    const host = document.createElement('div'); host.id = 'h85-reports-host'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(window.ReportsScreen, {}));
  });
  await page.waitForTimeout(350);
  const salesTab = page.getByTestId('reports-tab-sales');
  check('3. Historial ofrece la pestaña estable de ventas', await salesTab.count() === 1);
  if (await salesTab.count()) await salesTab.click();
  await page.waitForTimeout(350);
  const reprint = page.getByTestId(`sales-reprint-${seeded.folio}`);
  check('3b. la venta histórica de contado ofrece reimpresión', await reprint.count() === 1);
  const effectsBefore = await page.evaluate(() => ({
    sales: window.DATA.sales.length, returns: window.DATA.returns.length,
    payments: window.DATA.payments.length, movements: window.DATA.movements.length,
    stock: JSON.stringify(window.DATA.products.map(p => [p.id, p.stock])), printed: window.__printed,
  }));
  if (await reprint.count()) await reprint.click();
  await page.waitForTimeout(500);
  const effectsAfter = await page.evaluate(() => ({
    sales: window.DATA.sales.length, returns: window.DATA.returns.length,
    payments: window.DATA.payments.length, movements: window.DATA.movements.length,
    stock: JSON.stringify(window.DATA.products.map(p => [p.id, p.stock])), printed: window.__printed,
    ticket: document.getElementById('balam-ticket') ? document.getElementById('balam-ticket').innerText : '',
  }));
  check('3c. reimprimir monta el documento histórico y llama a imprimir', effectsAfter.printed === effectsBefore.printed + 1 && /GUAYABERA HISTÓRICA/.test(effectsAfter.ticket));
  check('12. reimprimir no crea documentos, pagos, movimientos ni stock',
    effectsAfter.sales === effectsBefore.sales && effectsAfter.returns === effectsBefore.returns &&
    effectsAfter.payments === effectsBefore.payments && effectsAfter.movements === effectsBefore.movements &&
    effectsAfter.stock === effectsBefore.stock);
  const closeReprint = page.getByTestId('sales-reprint-close');
  if (await closeReprint.count()) await closeReprint.click();

  console.log('\n── C) Reportes tiene documento propio ──');
  await page.evaluate(() => {
    window.__reportDocs = [];
    window.open = () => {
      const record = { html: '', printed: 0, focused: 0, closed: 0 };
      window.__reportDocs.push(record);
      return {
        document: { write: html => { record.html += html; }, close: () => {} },
        focus: () => { record.focused += 1; }, print: () => { record.printed += 1; },
        close: () => { record.closed += 1; },
      };
    };
  });
  // Volver a Resumen para sus dos salidas.
  const summaryTab = page.getByTestId('reports-tab-summary');
  if (await summaryTab.count()) await summaryTab.click();
  await page.waitForTimeout(250);
  const reportPrint = page.getByTestId('report-print');
  const reportPdf = page.getByTestId('report-pdf');
  if (await reportPrint.count()) await reportPrint.click();
  await page.waitForTimeout(450);
  if (await reportPdf.count()) await reportPdf.click();
  await page.waitForTimeout(450);
  const reportDocs = await page.evaluate(() => window.__reportDocs || []);
  check('4. Reportes → Imprimir genera contenido visible propio', reportDocs[0] && /Reporte Balam|Ventas brutas/i.test(reportDocs[0].html) && reportDocs[0].printed === 1);
  check('5. Reportes → PDF genera contenido visible propio', reportDocs[1] && /Reporte Balam|Ventas brutas/i.test(reportDocs[1].html) && reportDocs[1].printed === 1);

  console.log('\n── D) Comprobante de devolución directa ──');
  const returned = await page.evaluate(seed => {
    const D = window.DATA, sale = D.findSaleByFolio(seed.folio);
    const line = sale.lineas[0];
    const result = D.recordReturn({ folio: sale.folio, lineas: [{
      productId: line.productId, sku: line.sku, nombre: line.nombre,
      talla: line.talla, qty: 1, motivo: 'Talla', precio: line.precio,
    }], metodo: 'Efectivo', notas: 'H-85' });
    if (!result.ok) return { ok: false, error: result.error };
    const host = document.createElement('div'); host.id = 'h85-return-host'; document.body.appendChild(host);
    if (window.BalamReturnReceipt) ReactDOM.createRoot(host).render(React.createElement(window.BalamReturnReceipt, { sale, returnDoc: result.ret }));
    return { ok: true, id: result.ret.id, folio: result.ret.folio, total: result.ret.total };
  }, seeded);
  await page.waitForTimeout(250);
  const returnText = await page.evaluate(() => (document.getElementById('balam-return-receipt') || {}).innerText || '');
  check('6. devolución directa genera comprobante distinto y completo', returned.ok &&
    /DEVOLUCI[ÓO]N/.test(returnText) && returnText.includes(returned.id) && returnText.includes(returned.folio) &&
    /GUAYABERA HISTÓRICA/.test(returnText) && /1/.test(returnText) && /\$500\.00/.test(returnText) && /Efectivo/.test(returnText));
  check('6b. comprobante de devolución no usa vocabulario de cambio', !/CAMBIO DE MERCANC[IÍ]A|Diferencia pagada/i.test(returnText));

  console.log('\n── E) Autoridad única de print.auto ──');
  const autoResult = await page.evaluate(async () => {
    if (!window.UI.useReceiptAutoPrint) return null;
    const run = async enabled => {
      window.CONFIG.setSetting('print.auto', enabled);
      const host = document.createElement('div'); document.body.appendChild(host);
      const Probe = () => { window.UI.useReceiptAutoPrint(); return null; };
      const root = ReactDOM.createRoot(host); const before = window.__printed;
      root.render(React.createElement(Probe));
      await new Promise(resolve => setTimeout(resolve, 500));
      const delta = window.__printed - before; root.unmount(); host.remove(); return delta;
    };
    return { off: await run(false), on: await run(true) };
  });
  check('7. Cambio con print.auto OFF no imprime solo', autoResult && autoResult.off === 0, JSON.stringify(autoResult));
  check('8. Cambio con print.auto ON imprime exactamente una vez', autoResult && autoResult.on === 1, JSON.stringify(autoResult));
  const returnsSource = source('balam/returns.jsx');
  check('8b. Cambios consume la autoridad compartida de autoimpresión', /useReceiptAutoPrint\(\)/.test(returnsSource));

  console.log('\n── F) Contratos de persistencia y compatibilidad ──');
  const ticketSource = source('balam/pos-ticket.jsx');
  const ticketBody = ticketSource.slice(ticketSource.indexOf('function BalamTicket'), ticketSource.lastIndexOf('window.TicketPanel'));
  check('1b. BalamTicket no consulta products.find por SKU', !ticketBody.includes('D.products.find'));
  check('2c. STORE transporta receipt_snapshot', /receipt_snapshot/.test(source('balam/store.jsx')));
  check('2d. existe migración aditiva del snapshot', fs.readdirSync(path.join(ROOT, 'supabase/migrations')).some(name => /h85.*receipt/i.test(name)));

  check('sin excepciones de página', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  if (server) server.close();
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
