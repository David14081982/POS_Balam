// H-183: real commercial receipt routing and complete USB artifacts.
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
const queueOnly = process.argv.includes('--queue-only');
const html = baseline ? execFileSync('git', ['show', 'HEAD:index.html'], { maxBuffer: 20000000 }) : fs.readFileSync('index.html');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'balam-h183-usb-commercial-'));
const sha = value => createHash('sha256').update(value).digest('hex');
const evidence = { baseline, queueOnly, artifactSHA256: sha(html), results: [], hardware: 'NOT_TESTED', remoteBusinessWrites: 0 };
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
    document.body.innerHTML = '<div id="h183-root"></div>';
    window.__business = JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements]);
    __usbTest.activityTokens = {};
    const begin = CORE.beginActivity, end = CORE.endActivity;
    CORE.beginActivity = (domains, detail) => {
      const token = begin(domains, detail); __usbTest.activityTokens[token] = { domains, detail }; return token;
    };
    CORE.endActivity = token => {
      const result = end(token); if (result) delete __usbTest.activityTokens[token]; return result;
    };
    window.__root = ReactDOM.createRoot(document.getElementById('h183-root'));
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
        lineas: Array.from({ length: count }, (_, i) => ({ productId: 'h183-' + i, sku: 'H183-' + i,
          nombre: 'PRENDA H183 ' + (i + 1), talla: 'M', qty: 1, precio: 116 })) };
      function Receipt() {
        UI.useReceiptAutoPrint();
        return React.createElement(React.Fragment, null, React.createElement(BalamTicket, { sale }),
          React.createElement(UI.ReceiptPrintHelp), React.createElement(PrintManager.PrintStatus),
          React.createElement('button', { 'data-testid': 'h183-send', onClick: () => UI.printReceipt() }, 'Imprimir'));
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
    const button = document.createElement('button'); button.dataset.testid = 'h183-connect'; button.textContent = 'Conectar fixture USB';
    button.style.cssText = 'position:fixed;bottom:0;left:0;padding:10px;z-index:9999';
    button.onclick = () => USBReceipt.connect(); document.body.append(button);
  });
  await page.getByTestId('h183-connect').click();
  await page.waitForFunction(() => USBReceipt.snapshot().connected && !USBReceipt.snapshot().busy);
  await page.getByTestId('h183-connect').evaluate(node => node.remove());
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
    assert.equal(/data-document-id="([^"]+)"/.exec(data.renders[i].html)?.[1], folio);
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

async function measureAutomatic(page) {
  await connect(page);
  await page.evaluate(() => { __usbTest.measureClicks = true; __usbTest.postReceiptClicks = 0; });
  await render(page, 'H183-AUTO'); await done(page, 'H183-AUTO');
  const route = await page.evaluate(() => ({ jobs: PrintManager.history(), nativeDialogs: __native, usbTransfers: __usbTest.records.length,
    postReceiptClicks: __usbTest.postReceiptClicks, configAndBusinessPreserved: __business === JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements]),
    artifacts: __printArtifacts.map(a => ({ text: a.text, html: a.html })) }));
  const nativeCopies = route.artifacts.filter(a => a.text.includes('PRENDA H183 3') && a.text.includes('H183-AUTO')).length;
  evidence.route = { ...route, artifacts: route.artifacts.map(a => ({ text: a.text, hash: sha(a.html) })) };
  const usbCopies = route.usbTransfers ? (await verifyTicket(page, 'auto', 'H183-AUTO')).copies : 0;
  evidence.guarantees = { completeCopies: nativeCopies + usbCopies, stableBusiness: route.configAndBusinessPreserved,
    honestPhysicalStatus: route.jobs.every(j => j.physicalPrintConfirmed === false) };
  evidence.cost = { nativeDialogs: route.nativeDialogs, postReceiptClicks: route.postReceiptClicks };
  assert.equal(evidence.guarantees.completeCopies, 2); assert.equal(evidence.guarantees.stableBusiness, true); assert.equal(evidence.guarantees.honestPhysicalStatus, true);
  assert.equal(route.nativeDialogs, 0, 'Commercial receipt still opens system dialogs instead of USB');
  assert.equal(route.postReceiptClicks, 0, 'Connected automatic USB must require zero post-receipt interactions');
  assert.ok(route.usbTransfers > 0);
  if (!baseline) {
    const before = JSON.parse(fs.readFileSync('docs/fixes/evidence/h183-commercial-baseline.json'));
    assert.deepEqual(evidence.guarantees, before.guarantees, 'Fewer dialogs must preserve document/business/physical guarantees');
    assert.ok(evidence.cost.nativeDialogs < before.cost.nativeDialogs);
    assert.ok(evidence.cost.postReceiptClicks <= before.cost.postReceiptClicks);
  }
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
  evidence.browserVersion = browser.version();
  if (!queueOnly) {
  const { context, page } = await openPage({ enabled: true });
  await test('connected USB automatic commercial receipt avoids system dialogs without losing guarantees', () => measureAutomatic(page));
  if (!baseline) {
    await test('consecutive long receipt preserves all pixels and USB has priority over configured THERMER', async () => {
      await page.evaluate(() => CONFIG.load(CONFIG.prepareMutation('setSetting', ['print.thermer', true]).state));
      await resetCapture(page); await render(page, 'H183-LONG', 20); await done(page, 'H183-LONG');
      const result = await verifyTicket(page, 'long', 'H183-LONG');
      assert.equal(await page.evaluate(() => __usbTest.externalLaunch), 0); assert.equal(await page.evaluate(() => __native), 0);
      assert.ok(result.heights.every(height => height > 4000)); return result;
    });
    await test('automatic disabled waits for one manual action; duplicate activation never interleaves or resends', async () => {
      await page.evaluate(() => CONFIG.load(CONFIG.prepareMutation('setSetting', ['print.auto', false]).state));
      await resetCapture(page, 'hold'); await render(page, 'H183-MANUAL');
      assert.equal(await page.evaluate(() => PrintManager.history().filter(j => j.ticketId === 'H183-MANUAL').length), 0);
      await page.getByTestId('h183-send').dblclick();
      await page.waitForFunction(() => !!__usbTest.releaseTransfer);
      assert.equal(await page.evaluate(() => PrintManager.acknowledgeReturn()), false);
      assert.equal(await page.evaluate(() => PrintManager.history().filter(j => j.ticketId === 'H183-MANUAL').length), 1);
      assert.equal(await page.getByTestId('print-returned').count(), 0);
      assert.equal(await page.evaluate(() => CORE.domainBusy('config')), true);
      await page.evaluate(() => { __usbTest.mode = 'ok'; __usbTest.releaseTransfer(); }); await done(page, 'H183-MANUAL');
      return verifyTicket(page, 'manual', 'H183-MANUAL');
    });
    await test('one-copy setting delivers exactly one original document', async () => {
      await page.evaluate(() => CONFIG.load(CONFIG.prepareMutation('setSetting', ['print.twoCopies', false]).state));
      await resetCapture(page); await render(page, 'H183-SINGLE'); await page.getByTestId('h183-send').click(); await done(page, 'H183-SINGLE');
      return verifyTicket(page, 'single', 'H183-SINGLE', 1);
    });
    await test('disconnected USB blocks PDF and THERMER; reconnect alone never resends a waiting receipt', async () => {
      await page.evaluate(async () => {
        await USBReceipt.disconnect();
        const config = CONFIG.snapshot(); config.settings['print.auto'] = true; config.settings['print.twoCopies'] = true; CONFIG.load(config);
      });
      await resetCapture(page); await render(page, 'H183-DISCONNECTED');
      await page.waitForFunction(() => PrintManager.history().at(-1).stage === 'WAITING_TURN');
      assert.equal(await page.getByTestId('print-usb-connect').count(), 1);
      assert.deepEqual(await page.evaluate(() => [__native, __usbTest.records.length, __usbTest.externalLaunch]), [0,0,0]);
      await connect(page);
      assert.equal(await page.evaluate(() => __usbTest.records.length), 0);
      assert.equal(await page.evaluate(() => CORE.activityStatus().domains.config), 1);
      assert.equal(await page.evaluate(() => PrintManager.history().at(-1).stage), 'WAITING_TURN');
      await page.getByTestId('print-next').click(); await done(page, 'H183-DISCONNECTED');
      return verifyTicket(page, 'reconnect', 'H183-DISCONNECTED');
    });
    await test('receipt connect-and-print keeps device selection in a user gesture and sends the frozen job', async () => {
      await page.evaluate(() => USBReceipt.disconnect()); await resetCapture(page); await render(page, 'H183-CONNECT');
      await page.waitForFunction(() => PrintManager.history().at(-1).stage === 'WAITING_TURN');
      await page.getByTestId('print-usb-connect').click(); await done(page, 'H183-CONNECT');
      assert.ok(await page.evaluate(() => __usbTest.gestures.every(Boolean)));
      return verifyTicket(page, 'connect', 'H183-CONNECT');
    });
    await test('cancelling while permission is pending prevents late connection from sending', async () => {
      await page.evaluate(() => USBReceipt.disconnect()); await resetCapture(page, 'chooser-hold'); await render(page, 'H183-PERMISSION-CANCEL');
      await page.waitForFunction(() => PrintManager.history().at(-1).stage === 'WAITING_TURN');
      await page.getByTestId('print-usb-connect').click(); await page.waitForFunction(() => !!__usbTest.releaseChooser);
      await page.getByTestId('print-cancel').click();
      await page.evaluate(() => { __usbTest.mode = 'ok'; __usbTest.releaseChooser(); });
      await page.waitForFunction(() => !USBReceipt.snapshot().busy && !USBReceipt.snapshot().connected);
      assert.equal(await page.evaluate(() => __usbTest.records.length), 0);
      assert.equal(await page.evaluate(() => PrintManager.history().at(-1).stage), 'CANCELLED');
    });
    await test('cancel during rendering releases resources and cannot send a late raster', async () => {
      await connect(page); await resetCapture(page, 'renderer-hold'); await render(page, 'H183-CANCEL');
      await page.waitForFunction(() => !!__usbTest.releaseRenderer); await page.getByTestId('print-cancel').click();
      await page.evaluate(() => { __usbTest.mode = 'ok'; __usbTest.releaseRenderer(); });
      await page.waitForFunction(() => !document.querySelector('iframe'));
      assert.equal(await page.evaluate(() => PrintManager.history().at(-1).stage), 'CANCELLED');
      assert.equal(await page.evaluate(() => __usbTest.records.length), 0);
      assert.equal(await page.evaluate(() => CORE.activityStatus().active), 0);
    });
    await test('original snapshots remain intact when the source receipt unmounts during rendering', async () => {
      await resetCapture(page, 'renderer-hold'); await render(page, 'H183-UNMOUNT');
      await page.waitForFunction(() => !!__usbTest.releaseRenderer);
      await page.evaluate(() => {
        __root.render(React.createElement('div', { 'data-testid': 'h183-other-screen' }, 'Otra pantalla'));
        __usbTest.mode = 'ok'; __usbTest.releaseRenderer();
      });
      await done(page, 'H183-UNMOUNT');
      assert.equal(await page.locator('#balam-ticket').count(), 0);
      return verifyTicket(page, 'unmounted', 'H183-UNMOUNT');
    });
    await test('partial second copy is uncertain, cannot be acknowledged/retried and stops before another cut', async () => {
      await resetCapture(page, 'partial-second'); await render(page, 'H183-PARTIAL');
      await page.waitForFunction(() => PrintManager.history().at(-1).stage === 'FAILED' && !USBReceipt.snapshot().busy);
      const result = await page.evaluate(() => ({ records: __usbTest.records, state: USBReceipt.snapshot(), job: PrintManager.history().at(-1) }));
      assert.equal(result.job.result, 'UNCERTAIN'); assert.equal(result.job.copiesSent, 1);
      assert.equal(result.state.resetRequired, true); assert.equal(result.state.connected, false);
      assert.equal(result.job.physicalPrintConfirmed, false);
      assert.equal(result.records.filter(record => Buffer.from(record.data, 'base64').equals(TRAILER)).length, 1);
      assert.equal(await page.evaluate(id => PrintManager.retry(id), result.job.printJobId), false);
      assert.equal(await page.evaluate(() => PrintManager.acknowledgeReturn()), false);
      assert.equal(await page.evaluate(() => localStorage.getItem('balam.print.usb.uncertain')), '1');
      assert.equal(await page.locator('iframe').count(), 0);
    });
    await test('reset and reconnection after partial output do not replay the uncertain document', async () => {
      await page.evaluate(() => __settings()); await page.getByTestId('settings-section-impresion').click();
      const count = await page.evaluate(() => __usbTest.records.length);
      await page.getByTestId('usb-reset-ack').click();
      await page.waitForFunction(() => !USBReceipt.snapshot().resetRequired && !USBReceipt.snapshot().busy);
      await page.getByTestId('usb-connect').click(); await page.waitForFunction(() => USBReceipt.snapshot().connected && !USBReceipt.snapshot().busy);
      assert.equal(await page.evaluate(() => __usbTest.records.length), count);
      assert.equal(await page.evaluate(() => PrintManager.history().at(-1).result), 'UNCERTAIN');
      assert.equal(await page.evaluate(() => __native), 0);
    });
  }
  await context.close();
  }
  if (!baseline) {
    const queued = await openPage({ enabled: true });
    await test('uncertain job holds a queued successor across reset/reconnect until an explicit print action', async () => {
      const page = queued.page;
      await connect(page); await resetCapture(page, 'hold'); await render(page, 'H183-QUEUE-A');
      await page.waitForFunction(() => !!__usbTest.releaseTransfer);
      await render(page, 'H183-QUEUE-B', 5);
      await page.waitForFunction(() => !!PrintManager.history().find(j => j.ticketId === 'H183-QUEUE-B')?.payloadReadyAt);
      assert.equal(await page.evaluate(() => CORE.activityStatus().domains.config), 2);
      await page.evaluate(() => { __usbTest.mode = 'partial-second'; __usbTest.releaseTransfer(); });
      await page.waitForFunction(() => PrintManager.history().find(j => j.ticketId === 'H183-QUEUE-A')?.stage === 'FAILED' && !USBReceipt.snapshot().busy);
      assert.equal(await page.evaluate(() => PrintManager.history().find(j => j.ticketId === 'H183-QUEUE-A').result), 'UNCERTAIN');
      assert.equal(await page.evaluate(() => PrintManager.history().find(j => j.ticketId === 'H183-QUEUE-B').stage), 'WAITING_TURN');
      assert.equal(await page.evaluate(() => CORE.activityStatus().domains.config), 1);
      const before = await page.evaluate(() => __usbTest.records.length);
      await page.evaluate(() => __settings()); await page.getByTestId('settings-section-impresion').click();
      assert.equal(await page.getByTestId('usb-test-ticket').isDisabled(), true);
      assert.equal(await page.getByTestId('usb-use-for-tickets').isDisabled(), true);
      await page.getByTestId('usb-reset-ack').click();
      await page.waitForFunction(() => !USBReceipt.snapshot().resetRequired && !USBReceipt.snapshot().busy);
      await page.getByTestId('usb-connect').click();
      await page.waitForFunction(() => USBReceipt.snapshot().connected && !USBReceipt.snapshot().busy);
      assert.equal(await page.evaluate(() => __usbTest.records.length), before);
      assert.equal(await page.evaluate(() => PrintManager.history().find(j => j.ticketId === 'H183-QUEUE-B').stage), 'WAITING_TURN');
      await page.evaluate(() => {
        __usbTest.mode = 'ok'; __usbTest.records = []; __usbTest.trailers = 0; __usbTest.maxActive = 0;
        __usbTest.renders = __usbTest.renders.filter(entry => entry.html.includes('data-document-id="H183-QUEUE-B"'));
        __usbTest.unrelatedActivity = CORE.beginActivity(['config'], { screen: 'h183-unrelated-edit' });
      });
      await page.getByTestId('print-next').click(); await done(page, 'H183-QUEUE-B');
      const result = await verifyTicket(page, 'queued-successor', 'H183-QUEUE-B');
      const ownership = await page.evaluate(() => ({ preserved: !!__usbTest.activityTokens[__usbTest.unrelatedActivity],
        blocked: CORE.domainBusy('config'), screens: Object.values(__usbTest.activityTokens).map(activity => activity.detail?.screen) }));
      assert.equal(ownership.preserved, true, 'Printer cleanup must preserve unrelated edit protection');
      assert.equal(ownership.blocked, true);
      assert.equal(await page.evaluate(() => CORE.endActivity(__usbTest.unrelatedActivity)), true);
      assert.deepEqual(await page.evaluate(() => [__native, __usbTest.externalLaunch]), [0,0]);
      assert.equal(await page.evaluate(() => PrintManager.history().find(j => j.ticketId === 'H183-QUEUE-A').result), 'UNCERTAIN');
      return { ...result, activityOwnership: ownership };
    });
    await queued.context.close();
    if (!queueOnly) {
    const settings = await openPage();
    await test('USB is explicit and local: connection does not enable it; enabling keeps connection after Settings', async () => {
      const page = settings.page;
      await page.evaluate(() => __settings()); await page.getByTestId('settings-section-impresion').click();
      assert.equal(await page.getByTestId('usb-use-for-tickets').isChecked(), false);
      assert.equal(await page.getByTestId('usb-use-for-tickets').isDisabled(), true);
      await page.getByTestId('usb-connect').click(); await page.waitForFunction(() => USBReceipt.snapshot().connected && !USBReceipt.snapshot().busy);
      assert.equal(await page.getByTestId('usb-use-for-tickets').isChecked(), false);
      await page.getByTestId('usb-use-for-tickets').check();
      assert.equal(await page.evaluate(() => localStorage.getItem('balam.print.usb')), '1');
      for (const width of [390, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.getByTestId('usb-print-check').screenshot({ path: path.join(output, 'settings-' + width + '.png') });
      }
      await page.getByTestId('settings-section-negocio').click();
      assert.equal(await page.evaluate(() => USBReceipt.snapshot().connected), true);
      assert.equal(await page.evaluate(() => __business === JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements])), true);
      assert.deepEqual(settings.errors, []);
    });
    await test('reload retains only local USB preference without requesting permission or printing', async () => {
      await settings.page.reload(); await settings.page.waitForFunction(() => !!window.USBReceipt);
      assert.deepEqual(await settings.page.evaluate(() => [USBReceipt.snapshot().enabled, USBReceipt.snapshot().connected, __usbTest.requests, __usbTest.records.length, __native]), [true,false,0,0,0]);
    });
    await settings.context.close();
    const desktop = await openPage({ desktop: true });
    await test('PC default keeps the system renderer and has no USB activation', async () => {
      await render(desktop.page, 'H183-PC'); await done(desktop.page, 'H183-PC');
      assert.equal(await desktop.page.evaluate(() => __native), 2);
      assert.equal(await desktop.page.evaluate(() => USBReceipt.snapshot().enabled), false);
      assert.equal(await desktop.page.evaluate(() => __usbTest.requests), 0);
      assert.ok(await desktop.page.evaluate(() => __printArtifacts.every(a => a.text.includes('PRENDA H183 3'))));
    });
    await desktop.context.close();
    const thermer = await openPage();
    await test('legacy THERMER remains opt-in when local USB is disabled', async () => {
      await thermer.page.evaluate(() => {
        const config = CONFIG.snapshot(); config.settings['print.thermer'] = true; config.settings['print.auto'] = false; CONFIG.load(config);
        const original = CORE.invokeSync;
        CORE.invokeSync = (name, payload) => name === 'prepareThermerPrint' ? Promise.resolve({ url: 'https://print.example.test/packet', expiresAt: Date.now() + 600000 }) : original(name, payload);
      });
      await render(thermer.page, 'H183-THERMER');
      await thermer.page.waitForFunction(() => PrintManager.history().at(-1).stage === 'WAITING_TURN');
      assert.equal(await thermer.page.evaluate(() => PrintManager.history().at(-1).transport), 'thermer');
      await thermer.page.getByTestId('print-next').click();
      assert.deepEqual(await thermer.page.evaluate(() => [__usbTest.records.length, __native, __usbTest.externalLaunch]), [0,0,1]);
      await thermer.page.getByTestId('print-returned').click();
      assert.equal(await thermer.page.evaluate(() => PrintManager.history().at(-1).physicalPrintConfirmed), false);
    });
    await thermer.context.close();
    }
  }
} catch (error) {
  if (!evidence.results.some(result => !result.ok)) evidence.results.push({ name: 'setup', ok: false, error: error.message });
  process.exitCode = 1;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2));
  if (!queueOnly) fs.writeFileSync('docs/fixes/evidence/h183-commercial-' + (baseline ? 'baseline' : 'final') + '.json', JSON.stringify(evidence, null, 2));
  console.log(evidence.results.filter(result => result.ok).length + '/' + evidence.results.length + ' ' + output);
}
