// H-184: real commercial receipt routing and complete USB artifacts.
// Permission/USB are mocked. This does not certify physical paper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { installPrintTransport } from './test-print-transport.mjs';

const baseline = process.argv.includes('--baseline');
const baselineRef = process.env.BALAM_BASELINE_REF || 'HEAD';
const html = baseline ? execFileSync('git', ['show', baselineRef + ':index.html'], { maxBuffer: 20000000 }) : fs.readFileSync('index.html');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'balam-h184-usb-commercial-'));
const sha = value => createHash('sha256').update(value).digest('hex');
const evidence = { baseline, ...(baseline ? { baselineRef } : {}), artifactSHA256: sha(html), results: [], hardware: 'NOT_TESTED', remoteBusinessWrites: 0 };
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let diagnosticPage;
const test = async (name, work) => {
  try { const details = await work(); evidence.results.push({ name, ok: true, ...details }); console.log('PASS ' + name); }
  catch (error) {
    const state = await diagnosticPage?.evaluate(() => ({ jobs: window.PrintManager?.history(), usb: window.USBReceipt?.snapshot(),
      activity: window.CORE?.activityStatus(), activityTokens: window.__usbTest?.activityTokens, focus: document.activeElement?.outerHTML?.slice(0, 300), fixture: window.__usbTest && { mode: __usbTest.mode, records: __usbTest.records.length,
        trailers: __usbTest.trailers, heldTransfer: !!__usbTest.releaseTransfer, renders: __usbTest.renders.map(r => ({ ready: !!r.png, folio: /data-document-id="([^"]+)"/.exec(r.html)?.[1] })) } })).catch(() => null);
    evidence.results.push({ name, ok: false, error: error.message, errorStack: error.stack, state });
    console.log('FAIL ' + name + ': ' + error.stack); console.log('FAIL_STATE ' + JSON.stringify(state)); throw error;
  }
};
let browser;

function installFixture({ enabled, desktop, supported }) {
  if (enabled) localStorage.setItem('balam.print.usb', '1');
  const f = window.__usbTest = { requests: 0, gestures: [], records: [], calls: [], renders: [], mode: 'ok', active: 0, maxActive: 0, trailers: 0, externalLaunch: 0, remoteCalls: 0, measureClicks: false, postReceiptClicks: 0 };
  document.addEventListener('click', event => {
    if (f.measureClicks && event.isTrusted) f.postReceiptClicks++;
    if (event.target.matches?.('a[href^="intent:"],a[href^="my.bluetoothprint.scheme:"]')) { event.preventDefault(); f.externalLaunch++; }
  }, true);
  const alternate = { alternateSetting: 0, interfaceClass: 7, interfaceSubclass: 1, interfaceProtocol: 2,
    endpoints: [{ endpointNumber: 9, type: 'bulk', direction: 'out', packetSize: 64 }] };
  const config = { configurationValue: 5, interfaces: [{ interfaceNumber: 4, claimed: false, alternate, alternates: [alternate] }] };
  const device = {
    productName: 'END-80TEUX SYNTHETIC', vendorId: 0x1234, productId: 0x5678, serialNumber: 'PRIVATE-TEST-SERIAL',
    opened: false, configuration: null, configurations: [config],
    async open() { f.calls.push(['open']); this.opened = true; },
    async selectConfiguration(value) { assertTarget(value === 5); f.calls.push(['configuration', value]); this.configuration = config; },
    async claimInterface(value) { assertTarget(value === 4 && this.opened); f.calls.push(['claim', value]); config.interfaces[0].claimed = true; },
    async selectAlternateInterface(face, value) { assertTarget(face === 4 && value === 0); f.calls.push(['alternate', face, value]); },
    async close() { f.calls.push(['close']); this.opened = false; config.interfaces[0].claimed = false; },
    async transferOut(endpoint, data) {
      assertTarget(endpoint === 9 && this.opened && config.interfaces[0].claimed);
      const bytes = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
      f.active++; f.maxActive = Math.max(f.maxActive, f.active);
      const record = { endpoint, data: btoa(String.fromCharCode(...bytes)), accepted: bytes.length };
      f.records.push(record);
      try {
        if (f.mode === 'hold' && !f.releaseTransfer) await new Promise(resolve => { f.releaseTransfer = resolve; });
        if (f.mode === 'partial-second' && f.trailers === 1 && bytes[0] === 29 && bytes[1] === 118) {
          record.accepted--; return { status: 'ok', bytesWritten: record.accepted };
        }
        if (bytes[0] === 27 && bytes[1] === 100) f.trailers++;
        return { status: 'ok', bytesWritten: bytes.length };
      } finally { f.active--; }
    },
  };
  function assertTarget(condition) { if (!condition) throw Error('Wrong USB transport target'); }
  const usb = new EventTarget();
  usb.requestDevice = async options => {
    f.requests++; f.gestures.push(navigator.userActivation.isActive); f.options = options;
    if (f.mode === 'cancel') throw new DOMException('No device selected', 'NotFoundError');
    if (f.mode === 'chooser-hold') await new Promise(resolve => { f.releaseChooser = resolve; });
    return device;
  };
  f.device = device;
  Object.defineProperty(navigator, 'usb', { configurable: true, value: supported ? usb : undefined });
  window.__roots = [];
  let dom;
  Object.defineProperty(window, 'ReactDOM', { configurable: true, get: () => dom, set: value => {
    dom = value; let create;
    Object.defineProperty(value, 'createRoot', { configurable: true, get: () => create, set: implementation => {
      create = (...args) => { const root = implementation(...args); __roots.push(root); return root; };
    } });
  } });
}

async function openPage({ enabled = false, desktop = false, supported = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, hasTouch: !desktop,
    userAgent: desktop ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' : 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await context.addInitScript(installPrintTransport, { counter: '__native', hold: false });
  await context.addInitScript(installFixture, { enabled, desktop, supported });
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  diagnosticPage = page;
  await page.goto(base);
  await page.waitForFunction(() => window.SettingsScreen && window.BalamTicket && window.AUTH?.isReady());
  await page.evaluate(() => {
    __roots.forEach(root => root.unmount());
    const config = CONFIG.prepareMutation('reset', []).state;
    config.settings['print.auto'] = true; config.settings['print.twoCopies'] = true; config.settings['print.thermer'] = false;
    CONFIG.load(config);
    AUTH.canAccess = () => true; AUTH.isAdmin = () => true;
    STORE.assertBusinessReady = () => true;
    STORE.serverNow = () => new Date('2026-10-02T12:00:00Z');
    STORE.syncStatus = () => ({ ready: true, connection: 'online' });
    STORE.syncFleetStatus = async () => ({ devices: [], history: [] });
    STORE.execute = () => { throw Error('Printing must not execute business'); };
    document.body.innerHTML = '<div id="h184-root"></div>';
    window.__business = JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements]);
    __usbTest.activityTokens = {};
    const begin = CORE.beginActivity, end = CORE.endActivity;
    CORE.beginActivity = (domains, detail) => {
      const token = begin(domains, detail); __usbTest.activityTokens[token] = { domains, detail }; return token;
    };
    CORE.endActivity = token => {
      const result = end(token); if (result) delete __usbTest.activityTokens[token]; return result;
    };
    window.__root = ReactDOM.createRoot(document.getElementById('h184-root'));
    const renderer = UI.receiptGraphic;
    UI.receiptGraphic = async (snapshot, audit, signal) => {
      const entry = { html: snapshot.html, text: snapshot.text, png: null }; __usbTest.renders.push(entry);
      if (__usbTest.mode === 'renderer-fail') throw Error('PRIVATE renderer stack');
      if (__usbTest.mode === 'renderer-hold') await new Promise(resolve => { __usbTest.releaseRenderer = resolve; });
      const png = await renderer(snapshot, audit, signal); entry.png = png; return png;
    };
    window.__settings = () => __root.render(React.createElement(React.Fragment, null,
      React.createElement(SettingsScreen), React.createElement(PrintManager.PrintStatus)));
    window.__render = (folio, count = 3) => {
      const sale = { folio, fecha: '2026-10-02 12:00', vendedor: 'PRUEBA', metodo: 'Tarjeta', estado: 'Pagado',
        total: count * 116, subtotal: count * 100, iva: count * 16, ivaPct: 16, ivaIncluded: true, descuento: 0, saldo: 0,
        lineas: Array.from({ length: count }, (_, i) => ({ productId: 'h184-' + i, sku: 'H183-' + i,
          nombre: 'PRENDA H183 ' + (i + 1), talla: 'M', qty: 1, precio: 116 })) };
      function Receipt() {
        UI.useReceiptAutoPrint();
        return React.createElement(React.Fragment, null, React.createElement(BalamTicket, { sale }),
          React.createElement(UI.ReceiptPrintHelp), React.createElement(PrintManager.PrintStatus),
          React.createElement('button', { 'data-testid': 'h184-send', onClick: () => UI.printReceipt() }, 'Imprimir'));
      }
      __root.render(React.createElement(Receipt, { key: folio }));
    };
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  return { context, page, errors };
}

const render = async (page, folio, count = 3) => {
  await page.evaluate(args => __render(...args), [folio, count]);
  await page.waitForFunction(f => document.getElementById('balam-ticket')?.dataset.documentId === f, folio);
};
const done = (page, folio) => page.waitForFunction(f => {
  const jobs = PrintManager.history().filter(j => j.ticketId === f);
  return jobs.length > 0 && jobs.every(j => j.stage === 'COMPLETED');
}, folio);
const connect = async page => {
  await page.evaluate(() => {
    const button = document.createElement('button'); button.dataset.testid = 'h184-connect'; button.textContent = 'Conectar fixture USB';
    button.style.cssText = 'position:fixed;bottom:0;left:0;padding:10px;z-index:9999';
    button.onclick = () => USBReceipt.connect(); document.body.append(button);
  });
  await page.getByTestId('h184-connect').click();
  await page.waitForFunction(() => USBReceipt.snapshot().connected && !USBReceipt.snapshot().busy);
  await page.getByTestId('h184-connect').evaluate(node => node.remove());
};
async function resetCapture(page, mode = 'ok') {
  await page.evaluate(mode => Object.assign(__usbTest, { records: [], renders: [], trailers: 0, mode, maxActive: 0, releaseTransfer: null, releaseRenderer: null }), mode);
}

// Independent PNG decoder; compare every receipt pixel with the USB stream.
function pngPixels(dataUrl) {
  const png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  assert.equal(png[24], 8); assert.equal(png[25], 0); assert.equal(png[28], 0);
  const compressed = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') compressed.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const rows = inflateSync(Buffer.concat(compressed)); assert.equal(rows.length, (width + 1) * height);
  const pixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) {
    const filter = rows[y * (width + 1)]; assert.ok(filter === 0 || filter === 1);
    for (let x = 0; x < width; x++) pixels[y * width + x] = (rows[y * (width + 1) + x + 1] + (filter === 1 && x ? pixels[y * width + x - 1] : 0)) & 255;
  }
  assert.ok(pixels.some(value => value === 0)); assert.ok(pixels.every(value => value === 0 || value === 255));
  return { png, width, height, pixels };
}
const INIT = Buffer.from([27,64,27,97,0,29,76,0,0,29,87,64,2]);
const TRAILER = Buffer.from([27,100,3,29,86,66,0]);
function decodeCopies(records, expected) {
  assert.ok(records.length > 3); assert.deepEqual(Buffer.from(records[0].data, 'base64'), INIT);
  const copies = []; let bands = [], rows = 0;
  for (const record of records.slice(1)) {
    const bytes = Buffer.from(record.data, 'base64');
    assert.equal(record.endpoint, 9); assert.equal(record.accepted, bytes.length);
    if (bytes.equals(TRAILER)) { copies.push({ height: rows, raster: Buffer.concat(bands) }); bands = []; rows = 0; continue; }
    assert.deepEqual(bytes.subarray(0, 4), Buffer.from([29,118,48,0]), 'No resizing, text or spacing between raster bands');
    const stride = bytes.readUInt16LE(4), height = bytes.readUInt16LE(6);
    assert.equal(stride, 72); assert.ok(height > 0 && height <= 32); assert.equal(bytes.length, 8 + stride * height);
    bands.push(bytes.subarray(8)); rows += height;
  }
  assert.equal(rows, 0); assert.equal(copies.length, expected);
  return copies;
}
async function verifyTicket(page, name, folio, expected = 2) {
  const data = await page.evaluate(() => ({ records: __usbTest.records, renders: __usbTest.renders,
    maxActive: __usbTest.maxActive, state: USBReceipt.snapshot(), jobs: PrintManager.history() }));
  assert.equal(data.renders.length, expected); assert.equal(data.maxActive, 1);
  assert.equal(data.state.lastJob.copiesSent, expected); assert.equal(data.state.lastJob.physicalPrintConfirmed, false);
  const copies = decodeCopies(data.records, expected);
  const job = data.jobs.filter(j => j.ticketId === folio).at(-1);
  assert.equal(job.transport, 'usb'); assert.equal(job.stage, 'COMPLETED'); assert.equal(job.physicalPrintConfirmed, false);
  for (let i = 0; i < expected; i++) {
    const original = pngPixels(data.renders[i].png), copy = copies[i];
    assert.equal(original.width, 576); assert.equal(copy.height, original.height);
    assert.equal(copy.raster.length, 72 * original.height);
    const received = Buffer.alloc(576 * original.height);
    for (let y = 0; y < original.height; y++) for (let x = 0; x < 576; x++) {
      received[y * 576 + x] = copy.raster[y * 72 + (x >> 3)] & (0x80 >> (x & 7)) ? 0 : 255;
    }
    assert.deepEqual(received, original.pixels, 'Entire USB copy must equal original renderer PNG');
    if (expected === 2) assert.ok(data.renders[i].html.includes(i ? 'COPIA TIENDA' : 'COPIA CLIENTE'));
    assert.equal(/data-document-id="([^"]+)"/.exec(data.renders[i].html)?.[1], folio || undefined);
    assert.equal(job.copies[i].documentHash, sha(data.renders[i].html));
    assert.equal(job.copies[i].payloadHash, sha(data.renders[i].png));
    fs.writeFileSync(path.join(output, name + '-' + i + '.png'), original.png);
  }
  assert.equal(await page.locator('iframe').count(), 0, 'Rendering frames must be released');
  // Settings has its own focus/edit activity. Certify ownership of the printer
  // resources without requiring unrelated screens to release their protection.
  await page.waitForFunction(() => !Object.values(__usbTest.activityTokens)
    .some(activity => ['receipt-usb', 'usb-print-check'].includes(activity.detail?.screen)));
  const activities = await page.evaluate(() => ({ real: CORE.activityStatus(), tokens: __usbTest.activityTokens }));
  assert.equal(activities.real.active, Object.keys(activities.tokens).length, 'Observed ownership must match real CORE activities');
  return { heights: copies.map(copy => copy.height), bytes: data.state.lastJob.bytesSent, copies: expected, payloadHash: job.payloadHash };
}

async function mountReports(page) {
  return page.evaluate(() => {
    const now = new Date(), fecha = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0') + ' 12:00';
    const folio = 'H184-HISTORICAL';
    const line = { lineId: '18400000-0000-4000-8000-000000000001', productId: '18400000-0000-4000-8000-000000000002',
      sku: 'H184-HIST', nombre: 'PRENDA HISTORICA H184', talla: 'M', qty: 1, precio: 348, precioOrig: 348, precioBase: 348, promos: [] };
    const sale = { folio, fecha, cliente: 'CLIENTE H184', vendedor: 'VENDEDOR H184', vendedores: [], estado: 'Pagado', metodo: 'Tarjeta',
      items: 1, subtotal: 300, iva: 48, ivaPct: 16, ivaIncluded: true, total: 348, anticipo: 348, saldo: 0, pagoEfectivo: 0,
      pagoOtro: 348, descuento: 0, descuentoAdicional: 0, comisiones: [], lineas: [line], _operationId: '18400000-0000-4000-8000-000000000003', _stockReserved: true,
      receiptSnapshot: { version: 1, store: { name: 'TIENDA HISTORICA H184', footer: 'PIE HISTORICO H184' }, sellerName: 'VENDEDOR CONGELADO H184',
        lines: [{ lineId: line.lineId, productId: line.productId, sku: line.sku, name: line.nombre, sizeCode: 'M', sizeLabel: 'MEDIANA HISTORICA', colorLabel: 'BLANCO HISTORICO', ornamentColors: [], attributes: [] }] } };
    const payment = { id: '18400000-0000-4000-8000-000000000004', folio, fecha, monto: 348, efectivo: 0, tarjeta: 348, transferencia: 0, otro: 0,
      metodo: 'Tarjeta', tipo: 'venta', components: [{ methodCode: 'Tarjeta', methodLabel: 'Tarjeta', amount: 348 }] };
    const snapshot = Object.fromEntries(['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'].map(key => [key, []]));
    snapshot.sales = [sale]; snapshot.payments = [payment]; snapshot.commissionContext = { periodStart: '', sellerBases: [] };
    DATA.replaceFromOnline(snapshot);
    __usbTest.business = JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements, DATA.returns, DATA.exchanges]);
    __root.render(React.createElement(React.Fragment, null, React.createElement(ReportsScreen), React.createElement(PrintManager.PrintStatus)));
    return { folio, fecha };
  });
}

async function openMethodTicket(page, context) {
  await page.getByTestId('reports-tab-metodos').click();
  const popupReady = context.waitForEvent('page');
  await page.getByTestId('payment-method-ticket').click();
  const popup = await popupReady; await popup.waitForLoadState('domcontentloaded');
  await popup.locator('[data-payment-method-ticket]').waitFor();
  return popup;
}

async function seedReceiptKinds(page) {
  return page.evaluate(() => {
    const today = new Date(), fecha = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0') + ' 12:00';
    const line = { lineId: '18400000-0000-4000-8000-000000000010', productId: '18400000-0000-4000-8000-000000000011', sku: 'H184-PRENDA', nombre: 'PRENDA ORIGINAL H184', talla: 'M', qty: 1, precio: 348, precioOrig: 348, precioBase: 348, promos: [], ornamento: 'BORDADO ORIGINAL', ornColors: ['BLANCO'] };
    const base = { fecha, vendedor: 'VENDEDOR ORIGINAL', cliente: 'CLIENTE REGISTRADO H184', clienteId: '18400000-0000-4000-8000-000000000012', vendedores: [], estado: 'Pagado', metodo: 'Efectivo',
      total: 348, subtotal: 300, iva: 48, ivaPct: 16, ivaIncluded: true, descuento: 0, descuentoAdicional: 0, anticipo: 348, saldo: 0, items: 1, comisiones: [], lineas: [line],
      receiptSnapshot: { version: 1, store: { name: 'TIENDA ORIGINAL', footer: 'PIE ORIGINAL COMPLETO H184' }, sellerName: 'VENDEDOR ORIGINAL',
        lines: [{ lineId: line.lineId, productId: line.productId, sku: line.sku, name: line.nombre, sizeCode: 'M', sizeLabel: 'MEDIANA ORIGINAL', colorLabel: 'BLANCO ORIGINAL', ornamentLabel: 'BORDADO ORIGINAL', ornamentColors: [{ code: 'BLANCO', label: 'BLANCO ORIGINAL' }], attributes: [] }] } };
    const payment = (folio, tipo, monto, index = 1) => ({ id: folio + '-' + tipo + '-' + index, folio, tipo, monto, metodo: 'Efectivo',
      fecha: fecha.slice(0, 11) + '12:0' + index, efectivo: monto, tarjeta: 0, transferencia: 0, otro: 0, components: [{ methodCode: 'Efectivo', methodLabel: 'Efectivo', amount: monto }] });
    const defs = {};
    for (const kind of ['apartado', 'anticipo', 'abono', 'liquidacion']) {
      const folio = 'H184-' + kind.toUpperCase(), saldo = ['apartado', 'anticipo'].includes(kind) ? 232 : kind === 'abono' ? 116 : 0;
      const sale = { ...base, folio, metodo: 'Apartado', estado: saldo ? 'Apartado' : 'Pagado', anticipo: 348 - saldo, saldo };
      const payments = [payment(folio, 'anticipo', 116)];
      if (!['apartado', 'anticipo'].includes(kind)) payments.push(payment(folio, kind, kind === 'abono' ? 116 : 232, 2));
      defs[kind] = { props: { sale, ...(kind === 'apartado' ? {} : { payment: payments.at(-1) }) }, payments, id: folio, type: kind === 'apartado' ? 'layaway' : 'payment' };
    }
    for (const [kind, amount] of [['cambio-cobrado', 116], ['cambio-sobrante', -116], ['cambio-igual', 0]]) {
      const sale = { ...base, folio: 'H184-ORIGIN-' + kind.toUpperCase() }, folio = 'H184-' + kind.toUpperCase();
      const exchange = { id: folio, folio, origenFolio: sale.folio, fecha, diferencia: Math.max(0, amount), valorNoAprovechado: Math.max(0, -amount),
        lineas: [{ ...line, lado: 'devuelto' }, { ...line, lineId: '18400000-0000-4000-8000-000000000013', productId: '18400000-0000-4000-8000-000000000014', sku: 'H184-RECIBIDA', nombre: 'PRENDA RECIBIDA H184', talla: 'L', precio: 348 + amount, lado: 'entregado' }] };
      const payments = [payment(sale.folio, 'venta', 348)];
      const paid = amount > 0 ? payment(folio, 'cambio', amount, 2) : null;
      if (paid) payments.push(paid);
      defs[kind] = { props: { sale, exchange, ...(paid ? { payment: paid } : {}) }, payments, id: folio, type: 'exchange' };
    }
    const sale = { ...base, folio: 'H184-RETURN-ORIGIN' }, returnDoc = { id: 'H184-RETURN', folio: sale.folio, fecha, cliente: sale.cliente, metodo: 'Efectivo', total: 348, lineas: [line] };
    defs.devolucion = { props: { sale, returnDoc }, payments: [payment(sale.folio, 'venta', 348)], id: returnDoc.id, type: 'return' };
    window.__h184Docs = defs;
    window.__h184Mount = (kind, mount = true) => {
      const doc = defs[kind], snapshot = Object.fromEntries(['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'].map(key => [key, []]));
      snapshot.sales = [doc.props.sale]; snapshot.payments = doc.payments; snapshot.commissionContext = { periodStart: '', sellerBases: [] };
      snapshot.clients = [{ id: base.clienteId, nombre: base.cliente, active: true, generic: false }];
      if (doc.props.exchange) snapshot.exchanges = [doc.props.exchange];
      if (doc.props.returnDoc) snapshot.returns = [doc.props.returnDoc];
      DATA.replaceFromOnline(snapshot);
      __usbTest.business = JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements, DATA.returns, DATA.exchanges]);
      if (!mount) return doc.id;
      function Receipt() {
        UI.useReceiptAutoPrint();
        return React.createElement(React.Fragment, null,
          React.createElement(kind === 'devolucion' ? BalamReturnReceipt : BalamTicket, doc.props),
          React.createElement(UI.ReceiptPrintHelp), React.createElement(PrintManager.PrintStatus),
          React.createElement('button', { 'data-testid': 'h184-print', onClick: () => UI.printReceipt({ source: 'h184-confirmed-receipt' }) }, 'Imprimir'));
      }
      __root.render(React.createElement(Receipt, { key: kind }));
      return doc.id;
    };
    return Object.fromEntries(Object.entries(defs).map(([kind, doc]) => [kind, { id: doc.id, type: doc.type }]));
  });
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
  evidence.browserVersion = browser.version();
  const { context, page } = await openPage({ enabled: true });
  await connect(page);
  await mountReports(page);
  const popup = await openMethodTicket(page, context);
  await test('real payment-method thermal ticket uses USB and retains its one unlabelled copy', async () => {
    const before = await popup.locator('[data-payment-method-ticket]').innerText();
    assert.match(before, /348\.00/); assert.match(before, /TARJETA|Tarjeta/);
    assert.deepEqual(await page.evaluate(() => [__native, __usbTest.records.length]), [0, 0]);
    await popup.evaluate(() => {
      window.__h184PrintActions = 0;
      document.addEventListener('click', event => {
        if (event.isTrusted && event.target.closest?.('[data-testid="payment-ticket-print"]')) window.__h184PrintActions++;
      }, true);
    });
    await popup.getByTestId('payment-ticket-print').click();
    await page.waitForFunction(() => PrintManager.history().some(j => j.documentType === 'payment-method-report' && j.stage === 'COMPLETED'));
    const sent = await page.evaluate(() => ({ job: PrintManager.history().at(-1), nativeDialogs: __native, usbTransfers: __usbTest.records.length,
      nativeArtifacts: __printArtifacts.map(a => ({ text: a.text, html: a.html })), businessPreserved: __usbTest.business === JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements, DATA.returns, DATA.exchanges]) }));
    evidence.report = { ...sent, nativeArtifacts: sent.nativeArtifacts.map(a => ({ text: a.text, hash: sha(a.html) })) };
    evidence.cost = { nativeDialogs: sent.nativeDialogs, buttonActions: await popup.evaluate(() => window.__h184PrintActions) };
    evidence.guarantees = { oneCopy: sent.job.totalCopies === 1, businessPreserved: sent.businessPreserved, honestPhysicalStatus: sent.job.physicalPrintConfirmed === false };
    assert.deepEqual(evidence.guarantees, { oneCopy: true, businessPreserved: true, honestPhysicalStatus: true });
    assert.equal(sent.job.transport, 'usb', 'The real 80 mm report still uses the system transport despite USB being selected');
    assert.equal(sent.nativeDialogs, 0); assert.ok(sent.usbTransfers > 0);
    const original = JSON.parse(fs.readFileSync('docs/fixes/evidence/h184-thermal-baseline.json'));
    assert.deepEqual(evidence.guarantees, original.guarantees);
    assert.ok(evidence.cost.nativeDialogs < original.cost.nativeDialogs);
    assert.equal(evidence.cost.buttonActions, 1);
    const result = await verifyTicket(page, 'payment-method', null, 1);
    const rendered = await page.evaluate(() => __usbTest.renders[0]);
    assert.ok(rendered.html.includes('data-payment-method-ticket'));
    assert.equal(/COPIA (CLIENTE|TIENDA)/.test(rendered.html), false);
    assert.ok(rendered.text.includes('348.00'));
    assert.equal(rendered.text.replace(/\s+/g, ' ').trim(), before.replace(/\s+/g, ' ').trim(), 'Complete source text, including origins, reconciliation and footer, must reach the renderer');
    return result;
  });
  if (!baseline) {
    await test('report reprint sends the same frozen complete image with one copy and no business changes', async () => {
      const first = await page.evaluate(() => PrintManager.history().at(-1).copies[0].payloadHash);
      await resetCapture(page); await popup.getByTestId('payment-ticket-print').click();
      await page.waitForFunction(() => PrintManager.history().at(-1).stage === 'COMPLETED' && __usbTest.records.length > 0);
      const result = await verifyTicket(page, 'payment-method-reprint', null, 1);
      assert.equal(await page.evaluate(() => PrintManager.history().at(-1).copies[0].payloadHash), first);
      assert.equal(await page.evaluate(() => __usbTest.business === JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements, DATA.returns, DATA.exchanges])), true);
      return result;
    });
    await test('report popup can close after capture without losing any raster rows', async () => {
      await resetCapture(page, 'renderer-hold'); await popup.getByTestId('payment-ticket-print').click();
      await page.waitForFunction(() => !!__usbTest.releaseRenderer); await popup.close();
      await page.evaluate(() => { __usbTest.mode = 'ok'; __usbTest.releaseRenderer(); });
      await page.waitForFunction(() => PrintManager.history().at(-1).stage === 'COMPLETED' && __usbTest.records.length > 0);
      return verifyTicket(page, 'closed-report-popup', null, 1);
    });
    await test('disconnected report returns to BALAM and connects with a valid main-window gesture after popup activation expires', async () => {
      await resetCapture(page); await page.evaluate(() => USBReceipt.disconnect());
      const disconnectedPopup = await openMethodTicket(page, context);
      // Expire the opening gesture: a later click in this opener-less popup must
      // never try to authorize a USB device owned by the main window.
      await page.waitForFunction(() => !navigator.userActivation.isActive);
      await disconnectedPopup.getByTestId('payment-ticket-print').click();
      await disconnectedPopup.getByTestId('print-usb-return').waitFor();
      assert.equal(await disconnectedPopup.getByTestId('print-usb-connect').count(), 0);
      // Playwright evaluate() itself supplies userGesture:true. Observe without
      // granting the permission that this case is supposed to be measuring.
      const observer = await context.newCDPSession(page);
      const activation = await observer.send('Runtime.evaluate', { expression: 'navigator.userActivation.isActive', returnByValue: true, userGesture: false });
      await observer.detach(); assert.equal(activation.result.value, false);
      const pending = await page.evaluate(() => ({ native: __native, calls: __usbTest.requests,
        renders: __usbTest.renders.map(r => r.png), records: __usbTest.records.length, jobs: PrintManager.history() }));
      assert.equal(pending.native, 0); assert.equal(pending.records, 0);
      assert.equal(pending.renders.length, 1); assert.ok(pending.renders[0]);
      const capturedHash = sha(pending.renders[0]);
      await Promise.all([disconnectedPopup.waitForEvent('close'), disconnectedPopup.getByTestId('print-usb-return').click()]);
      await page.getByTestId('print-usb-connect').click();
      await page.waitForFunction(() => PrintManager.history().at(-1).stage === 'COMPLETED' && __usbTest.records.length > 0);
      const result = await verifyTicket(page, 'disconnected-report', null, 1);
      const actual = await page.evaluate(() => ({ job: PrintManager.history().at(-1), native: __native,
        calls: __usbTest.requests, gesture: __usbTest.gestures.at(-1) }));
      assert.equal(actual.calls, pending.calls + 1); assert.equal(actual.gesture, true);
      assert.equal(actual.native, 0); assert.equal(actual.job.copies[0].payloadHash, capturedHash);
      return { ...result, mainWindowChooserGesture: actual.gesture, systemDialogs: actual.native };
    });
    await test('A4 report retains its system destination, one copy and full report with USB selected', async () => {
      await resetCapture(page);
      const popupReady = context.waitForEvent('page'); await page.getByTestId('payment-method-print').click(); const a4 = await popupReady;
      await page.waitForFunction(() => PrintManager.history().at(-1).source === 'reportes-a4' && PrintManager.history().at(-1).stage === 'COMPLETED');
      const state = await page.evaluate(() => ({ job: PrintManager.history().at(-1), usbBytes: __usbTest.records.length, artifact: __printArtifacts.at(-1) }));
      assert.equal(state.job.transport, 'browser'); assert.equal(state.job.totalCopies, 1); assert.equal(state.usbBytes, 0);
      assert.equal(state.job.pageWidth, null); assert.match(state.artifact.text, /348\.00/); assert.equal(sha(state.artifact.html), state.job.payloadHash);
      await a4.close();
    });
    const kinds = await seedReceiptKinds(page);
    for (const [kind, definition] of Object.entries(kinds)) {
      await test(kind + ': confirmed original emits two full USB copies with its own financial meaning', async () => {
        await resetCapture(page); await page.evaluate(kind => __h184Mount(kind), kind); await done(page, definition.id);
        const result = await verifyTicket(page, kind, definition.id);
        const original = await page.evaluate(() => ({ text: __usbTest.renders[0].text, job: PrintManager.history().at(-1),
          unchanged: __usbTest.business === JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements, DATA.returns, DATA.exchanges]) }));
        assert.equal(original.job.documentType, definition.type); assert.equal(original.unchanged, true);
        assert.match(original.text, /PRENDA ORIGINAL H184/);
        if (kind === 'apartado') { assert.match(original.text, /Mercanc[i\u00ed]a apartada/i); assert.match(original.text, /Saldo pendiente/i); assert.match(original.text, /232\.00/); }
        if (kind === 'anticipo') { assert.match(original.text, /Anticipo de apartado/i); assert.match(original.text, /232\.00/); }
        if (kind === 'abono') { assert.match(original.text, /Abono a apartado/i); assert.match(original.text, /116\.00/); }
        if (kind === 'liquidacion') { assert.match(original.text, /Liquidaci[oó]n de apartado/i); assert.match(original.text, /Mercanc[ií]a entregada/i); }
        if (kind.startsWith('cambio')) {
          assert.match(original.text, /PRENDA RECIBIDA H184/); assert.doesNotMatch(original.text, /Anticipo de apartado|Abono a apartado|Saldo pendiente/i);
          if (kind === 'cambio-cobrado') assert.match(original.text, /Diferencia pagada/i);
          if (kind === 'cambio-sobrante') assert.match(original.text, /no reembolsable/i);
          if (kind === 'cambio-igual') assert.doesNotMatch(original.text, /Diferencia pagada|no aprovechado/i);
        }
        if (kind === 'devolucion') { assert.match(original.text, /DEVOLUCI[OÓ]N/); assert.match(original.text, /REEMBOLSO/); assert.match(original.text, /348\.00/); }
        return result;
      });
    }
    await test('real layaway reprint survives immediate source unmount and prints its last payment', async () => {
      await resetCapture(page);
      await page.evaluate(() => {
        __h184Mount('abono', false);
        // Seed without triggering a receipt: the existing LayawayScreen owns reprint.
        ReactDOM.flushSync(() => __root.render(React.createElement(React.Fragment, null, React.createElement(LayawayScreen), React.createElement(PrintManager.PrintStatus))));
      });
      await page.getByTestId('layaway-reprint-H184-ABONO').click();
      await page.waitForFunction(() => PrintManager.history().at(-1).source === 'apartados-reimpresion' && PrintManager.history().at(-1).stage === 'COMPLETED');
      const result = await verifyTicket(page, 'layaway-reprint', 'H184-ABONO');
      assert.equal(await page.locator('#balam-ticket').count(), 0);
      assert.match(await page.evaluate(() => __usbTest.renders[0].text), /Abono a apartado/i);
      return result;
    });
    await test('real Reports reprint preserves historical identity and business state over USB', async () => {
      await resetCapture(page); const fixture = await mountReports(page);
      await page.getByTestId('reports-tab-sales').click(); await page.getByTestId('sales-reprint-' + fixture.folio).click(); await done(page, fixture.folio);
      const result = await verifyTicket(page, 'historical-reprint', fixture.folio);
      const text = await page.evaluate(() => __usbTest.renders[0].text);
      assert.match(text, /PRENDA HISTORICA H184/); assert.match(text, /VENDEDOR CONGELADO H184/); assert.match(text, /MEDIANA HISTORICA/);
      assert.equal(await page.evaluate(() => __usbTest.business === JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements, DATA.returns, DATA.exchanges])), true);
      await page.getByTestId('sales-reprint-close').click(); return result;
    });
  }
  if (!popup.isClosed()) await popup.close(); await context.close();
} catch (error) {
  if (!evidence.results.some(result => !result.ok)) evidence.results.push({ name: 'setup', ok: false, error: error.message, errorStack: error.stack });
  console.log(error.stack); process.exitCode = 1;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2));
  fs.writeFileSync('docs/fixes/evidence/h184-thermal-' + (baseline ? 'baseline' : 'final') + '.json', JSON.stringify(evidence, null, 2));
  console.log(evidence.results.filter(result => result.ok).length + '/' + evidence.results.length + ' ' + output);
}
