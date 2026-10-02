// H-182: generated Settings UI and real receipt raster at the USB boundary.
// Native permission and printer are simulated; this never certifies paper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const baseline = process.argv.includes('--baseline');
const html = baseline ? execFileSync('git', ['show', 'HEAD:index.html'], { maxBuffer: 20000000 }) : fs.readFileSync('index.html');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'balam-h182-usb-ui-'));
const evidence = { baseline, artifactSHA256: createHash('sha256').update(html).digest('hex'), results: [], hardware: 'NOT_TESTED', remoteBusinessWrites: 0 };
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const test = async (name, work) => {
  try { const details = await work(); evidence.results.push({ name, ok: true, ...details }); console.log('PASS ' + name); }
  catch (error) { evidence.results.push({ name, ok: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); throw error; }
};
let browser;

function installFixture({ supported }) {
  window.__usbTest = { requests: 0, gestures: [], records: [], calls: [], renders: [], mode: 'ok', active: 0, maxActive: 0, trailers: 0, nativePrint: 0, externalLaunch: 0 };
  const f = window.__usbTest;
  window.print = () => { f.nativePrint++; };
  document.addEventListener('click', event => {
    if (event.target.matches?.('a[href^="intent:"],a[href^="my.bluetoothprint.scheme:"]')) { event.preventDefault(); f.externalLaunch++; }
  }, true);
  const alternate = { alternateSetting: 0, interfaceClass: 7, interfaceSubclass: 1, interfaceProtocol: 2,
    endpoints: [{ endpointNumber: 9, type: 'bulk', direction: 'out', packetSize: 64 }] };
  const config = { configurationValue: 5, interfaces: [{ interfaceNumber: 4, claimed: false, alternate, alternates: [alternate] }] };
  const device = {
    productName: 'END-80TEUX SYNTHETIC', vendorId: 0x1234, productId: 0x5678, serialNumber: 'PRIVATE-TEST-SERIAL',
    opened: false, configuration: null, configurations: [config],
    async open() { f.calls.push(['open']); this.opened = true; },
    async selectConfiguration(value) { if (value !== 5) throw Error('Wrong configuration'); f.calls.push(['configuration', value]); this.configuration = config; },
    async claimInterface(value) { if (value !== 4 || !this.opened) throw Error('Wrong interface'); f.calls.push(['claim', value]); config.interfaces[0].claimed = true; },
    async selectAlternateInterface(face, value) { if (face !== 4 || value !== 0) throw Error('Wrong alternate'); f.calls.push(['alternate', face, value]); },
    async close() { f.calls.push(['close']); this.opened = false; config.interfaces[0].claimed = false; },
    async transferOut(endpoint, data) {
      if (endpoint !== 9 || !this.opened || !config.interfaces[0].claimed) throw Error('Wrong transfer target');
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
  const usb = new EventTarget();
  usb.requestDevice = async options => {
    f.requests++; f.gestures.push(navigator.userActivation.isActive); f.options = options;
    if (f.mode === 'cancel') throw new DOMException('No device selected', 'NotFoundError');
    if (f.mode === 'chooser-hold') await new Promise(resolve => { f.releaseChooser = resolve; });
    return device;
  };
  f.device = device;
  Object.defineProperty(navigator, 'usb', { configurable: true, value: supported ? usb : undefined });
  window.__usbRoots = [];
  let dom;
  Object.defineProperty(window, 'ReactDOM', { configurable: true, get: () => dom, set: value => {
    dom = value; let create;
    Object.defineProperty(value, 'createRoot', { configurable: true, get: () => create, set: implementation => {
      create = (...args) => { const root = implementation(...args); window.__usbRoots.push(root); return root; };
    } });
  } });
}

async function openSettings(supported = true) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 900 }, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', serviceWorkers: 'block' });
  await context.addInitScript(installFixture, { supported });
  await context.route('**/*', route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', error => { errors.push(error.message); console.log('PAGE_ERROR ' + error.message); });
  console.log('SETUP loading generated artifact');
  await page.goto(base);
  await page.waitForFunction(() => window.SettingsScreen && window.BalamTicket && window.AUTH?.isReady(), null, { timeout: 30000 });
  if (baseline) return { context, page, errors };
  console.log('SETUP mounting actual Settings');
  await page.evaluate(() => { __usbRoots.forEach(root => root.unmount()); });
  console.log('SETUP bootstrap unmounted');
  await page.evaluate(() => {
    CONFIG.load(CONFIG.prepareMutation('reset', []).state);
    AUTH.canAccess = () => true; AUTH.isAdmin = () => true;
    STORE.assertBusinessReady = () => true;
    STORE.serverNow = () => new Date('2026-10-01T12:00:00Z');
    STORE.syncStatus = () => ({ ready: true, connection: 'online' });
    STORE.syncFleetStatus = async () => ({ devices: [], history: [] });
    STORE.execute = () => { throw Error('Diagnostic must not write commercial data'); };
    document.body.innerHTML = '<div id="h182-settings"></div>';
    __usbTest.business = JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements]);
    const renderer = UI.receiptGraphic;
    UI.receiptGraphic = async (snapshot, audit, signal) => {
      const entry = { html: snapshot.html, text: snapshot.text, png: null };
      __usbTest.renders.push(entry);
      if (__usbTest.mode === 'renderer-fail') throw Error('PRIVATE renderer stack');
      if (__usbTest.mode === 'renderer-hold') await new Promise(resolve => { __usbTest.releaseRenderer = resolve; });
      const png = await renderer(snapshot, audit, signal); entry.png = png; return png;
    };
    window.__settingsRoot = ReactDOM.createRoot(document.getElementById('h182-settings'));
    __settingsRoot.render(React.createElement(SettingsScreen));
  });
  console.log('SETUP Settings mounted; opening print section');
  await page.getByTestId('settings-section-impresion').click();
  return { context, page, errors };
}
const settled = page => page.waitForFunction(() => window.USBReceipt && !USBReceipt.snapshot().busy && !document.querySelector('[data-testid="usb-connect"]').disabled);
const connected = page => page.waitForFunction(() => USBReceipt.snapshot().connected && !USBReceipt.snapshot().busy && !document.querySelector('[data-testid="usb-test-ticket"]').disabled);
const completed = page => page.waitForFunction(() => USBReceipt.snapshot().lastJob?.result === 'TRANSFERRED' && !USBReceipt.snapshot().busy && !document.querySelector('[data-testid="usb-test-ticket"]').disabled);
async function resetCapture(page, mode = 'ok') {
  await page.evaluate(mode => { Object.assign(__usbTest, { records: [], renders: [], trailers: 0, mode, maxActive: 0, releaseTransfer: null }); }, mode);
}
async function noResources(page) {
  assert.equal(await page.locator('#balam-ticket,[data-usb-receipt-fixture],iframe').count(), 0, 'Diagnostic roots and rendering frames must be released');
}

// Independently decode the renderer's grayscale PNG, including PNG row filters.
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
    const filter = rows[y * (width + 1)]; assert.ok(filter === 0 || filter === 1, 'Expected renderer None/Sub filter');
    for (let x = 0; x < width; x++) pixels[y * width + x] = (rows[y * (width + 1) + x + 1] + (filter === 1 && x ? pixels[y * width + x - 1] : 0)) & 255;
  }
  assert.ok(pixels.some(value => value === 0)); assert.ok(pixels.every(value => value === 0 || value === 255));
  return { png, width, height, pixels };
}
const INIT = Buffer.from([27,64,27,97,0,29,76,0,0,29,87,64,2]);
const TRAILER = Buffer.from([27,100,3,29,86,66,0]);
function decodeCopies(records) {
  assert.ok(records.length > 3); const first = Buffer.from(records[0].data, 'base64'); assert.deepEqual(first, INIT);
  const copies = []; let bands = [], rows = 0;
  for (const record of records.slice(1)) {
    const bytes = Buffer.from(record.data, 'base64');
    assert.equal(record.endpoint, 9); assert.equal(record.accepted, bytes.length, 'Complete raster test requires fully accepted transfers');
    if (bytes.equals(TRAILER)) { copies.push({ height: rows, raster: Buffer.concat(bands) }); bands = []; rows = 0; continue; }
    assert.deepEqual(bytes.subarray(0, 4), Buffer.from([29,118,48,0]), 'No resizing, text or spacing inside raster');
    const stride = bytes.readUInt16LE(4), height = bytes.readUInt16LE(6);
    assert.equal(stride, 72); assert.ok(height > 0 && height <= 32); assert.equal(bytes.length, 8 + stride * height);
    bands.push(bytes.subarray(8)); rows += height;
  }
  assert.equal(rows, 0, 'Each complete copy must end with one trailer'); assert.equal(copies.length, 2);
  return copies;
}
async function verifyTicket(page, name) {
  const data = await page.evaluate(() => ({ records: __usbTest.records, renders: __usbTest.renders,
    maxActive: __usbTest.maxActive, state: USBReceipt.snapshot() }));
  assert.equal(data.renders.length, 2); assert.equal(data.maxActive, 1);
  assert.equal(data.state.lastJob.copiesSent, 2); assert.equal(data.state.lastJob.physicalPrintConfirmed, false);
  const copies = decodeCopies(data.records), folios = [];
  for (let i = 0; i < 2; i++) {
    const original = pngPixels(data.renders[i].png), copy = copies[i];
    assert.equal(original.width, 576); assert.equal(copy.height, original.height);
    assert.equal(copy.raster.length, 72 * original.height);
    const received = Buffer.alloc(576 * original.height);
    for (let y = 0; y < original.height; y++) for (let x = 0; x < 576; x++) {
      received[y * 576 + x] = copy.raster[y * 72 + (x >> 3)] & (0x80 >> (x & 7)) ? 0 : 255;
    }
    assert.deepEqual(received, original.pixels, 'Every reconstructed USB raster pixel must equal the original PNG');
    assert.ok(data.renders[i].html.includes(i ? 'COPIA TIENDA' : 'COPIA CLIENTE'));
    assert.ok(data.renders[i].html.includes('PRUEBA USB · SIN VALOR COMERCIAL'));
    const folio = /data-document-id="([^"]+)"/.exec(data.renders[i].html)?.[1]; assert.ok(folio?.startsWith('PRUEBA-USB-')); folios.push(folio);
    fs.writeFileSync(path.join(output, name + '-' + i + '.png'), original.png);
  }
  assert.equal(folios[0], folios[1]); await noResources(page);
  return { folio: folios[0], heights: copies.map(copy => copy.height), bytes: data.state.lastJob.bytesSent };
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
  const { context, page, errors } = await openSettings();
  const hasModule = await page.evaluate(() => !!window.USBReceipt && !!window.USBPrintCheck);
  if (baseline || !hasModule) {
    await test('Settings exposes optional WebUSB diagnostic', async () => { assert.ok(hasModule, 'No WebUSB diagnostic in the baseline artifact'); });
  } else {
    await test('real Settings opens without chooser or print; responsive at 360 and 1024 px', async () => {
      assert.deepEqual(await page.evaluate(() => [__usbTest.requests, __usbTest.records.length, __usbTest.nativePrint, __usbTest.externalLaunch]), [0,0,0,0]);
      assert.equal(await page.getByTestId('usb-test-ticket').isDisabled(), true);
      assert.equal(await page.getByTestId('usb-use-for-tickets').isChecked(), false);
      assert.equal(await page.getByTestId('usb-use-for-tickets').isDisabled(), true);
      for (const width of [360, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.getByTestId('usb-print-check').screenshot({ path: path.join(output, 'settings-' + width + '.png') });
      }
      await noResources(page);
    });
    await test('cancelled device selection stays disconnected; subsequent gesture connects exact USB interface', async () => {
      await resetCapture(page, 'cancel'); await page.getByTestId('usb-connect').click(); await settled(page);
      assert.equal(await page.evaluate(() => USBReceipt.snapshot().connected), false);
      assert.equal(await page.evaluate(() => __usbTest.records.length), 0);
      await resetCapture(page); await page.getByTestId('usb-connect').click(); await connected(page);
      const detail = await page.evaluate(() => ({ gestures: __usbTest.gestures, device: USBReceipt.snapshot().device, calls: __usbTest.calls }));
      assert.deepEqual(detail.gestures, [true, true]);
      assert.equal(detail.device.configuration, 5); assert.equal(detail.device.interfaceNumber, 4); assert.equal(detail.device.endpoint, 9);
      assert.ok(detail.calls.some(call => call[0] === 'claim' && call[1] === 4));
      assert.equal(await page.getByTestId('usb-use-for-tickets').isChecked(), false, 'Connecting must not change the commercial transport');
      assert.equal(await page.getByTestId('usb-use-for-tickets').isDisabled(), false);
      const diagnostics = await page.getByTestId('usb-diagnostics').locator('pre').textContent();
      assert.equal(diagnostics.includes('PRIVATE-TEST-SERIAL'), false);
    });
    await test('text is sent once with correct framing and no app/system dialog', async () => {
      await resetCapture(page); await page.getByTestId('usb-test-text').click(); await completed(page);
      const records = await page.evaluate(() => __usbTest.records);
      assert.equal(records.length, 3); assert.deepEqual(Buffer.from(records[0].data, 'base64'), INIT);
      assert.equal(Buffer.from(records[1].data, 'base64').toString(), 'PRUEBA USB BALAM\nSIN VALOR COMERCIAL\nFIN DE PRUEBA\n');
      assert.deepEqual(Buffer.from(records[2].data, 'base64'), TRAILER);
    });
    let first;
    await test('both real ticket copies survive pixel-for-pixel; double tap does not interleave', async () => {
      await resetCapture(page, 'hold'); await page.getByTestId('usb-test-ticket').click();
      await page.waitForFunction(() => !!__usbTest.releaseTransfer);
      assert.equal(await page.getByTestId('usb-test-ticket').isDisabled(), true);
      assert.equal(await page.getByTestId('usb-use-for-tickets').isDisabled(), true);
      await page.evaluate(() => document.querySelector('[data-testid="usb-test-ticket"]').click());
      await page.evaluate(() => { __usbTest.mode = 'ok'; __usbTest.releaseTransfer(); }); await completed(page);
      first = await verifyTicket(page, 'first'); return first;
    });
    await test('consecutive long ticket has a new frozen folio and two independent intact copies', async () => {
      await page.evaluate(() => {
        __usbTest.originalConfig = CONFIG.snapshot();
        const large = JSON.parse(JSON.stringify(__usbTest.originalConfig));
        large.settings['ticket.footer'] = 'PRUEBA DE TICKET LARGO. Conservar todas las líneas, acentos y el diseño del comprobante. '.repeat(14);
        CONFIG.load(large);
      });
      await resetCapture(page); await page.getByTestId('usb-test-ticket').click(); await completed(page);
      const second = await verifyTicket(page, 'second'); assert.notEqual(second.folio, first.folio);
      assert.ok(second.heights[0] > first.heights[0]); assert.ok(second.heights[1] > first.heights[1]);
      await page.evaluate(() => CONFIG.load(__usbTest.originalConfig)); return second;
    });
    await test('renderer failure is explicit, sends nothing and releases the demo', async () => {
      await resetCapture(page, 'renderer-fail'); await page.getByTestId('usb-test-ticket').click();
      await connected(page);
      assert.match(await page.getByTestId('usb-status').textContent(), /No se pudo preparar/);
      assert.doesNotMatch(await page.getByTestId('usb-status').textContent(), /PRIVATE|stack/);
      assert.equal(await page.evaluate(() => __usbTest.records.length), 0); await noResources(page);
    });
    await test('partial second copy stops without another cut; reset is required in UI', async () => {
      await resetCapture(page, 'partial-second'); await page.getByTestId('usb-test-ticket').click();
      await page.waitForFunction(() => USBReceipt.snapshot().resetRequired && !USBReceipt.snapshot().busy && document.querySelector('[data-testid="usb-reset-ack"]')?.disabled === false);
      const result = await page.evaluate(() => ({ records: __usbTest.records, state: USBReceipt.snapshot() }));
      assert.equal(result.state.lastJob.result, 'UNCERTAIN'); assert.equal(result.state.lastJob.errorCode, 'USB_PARTIAL');
      assert.equal(result.state.lastJob.copiesSent, 1);
      assert.equal(await page.evaluate(() => localStorage.getItem('balam.print.usb.uncertain')), '1');
      assert.equal(result.records.filter(record => Buffer.from(record.data, 'base64').equals(TRAILER)).length, 1);
      const last = result.records.at(-1); assert.equal(last.accepted, Buffer.from(last.data, 'base64').length - 1);
      assert.equal(await page.getByTestId('usb-connect').isDisabled(), true); assert.equal(await page.getByTestId('usb-test-ticket').isDisabled(), true);
      assert.match(await page.getByTestId('usb-print-check').textContent(), /apaga y enciende/i);
      await page.getByTestId('usb-reset-ack').click(); await settled(page); await noResources(page);
      assert.equal(await page.evaluate(() => localStorage.getItem('balam.print.usb.uncertain')), null);
    });
    await test('disconnect cancels preparation without late output and resources can be reused', async () => {
      await resetCapture(page); await page.getByTestId('usb-connect').click(); await connected(page);
      await resetCapture(page, 'renderer-hold'); await page.getByTestId('usb-test-ticket').click();
      await page.waitForFunction(() => !!__usbTest.releaseRenderer);
      await page.getByTestId('usb-disconnect').click();
      await page.evaluate(() => { __usbTest.mode = 'ok'; __usbTest.releaseRenderer(); }); await settled(page);
      assert.equal(await page.evaluate(() => __usbTest.records.length), 0); await noResources(page);
      await page.getByTestId('usb-connect').click(); await connected(page);
    });
    await test('leaving the print settings closes USB; no commercial mutation or alternate print transport', async () => {
      await page.getByTestId('settings-section-negocio').click();
      await page.waitForFunction(() => !USBReceipt.snapshot().connected && !USBReceipt.snapshot().busy);
      const result = await page.evaluate(() => ({ before: __usbTest.business,
        after: JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements]),
        nativePrint: __usbTest.nativePrint, externalLaunch: __usbTest.externalLaunch, opened: __usbTest.device.opened }));
      assert.equal(result.after, result.before); assert.equal(result.nativePrint, 0); assert.equal(result.externalLaunch, 0); assert.equal(result.opened, false);
      await noResources(page); assert.deepEqual(errors, []);
    });
    await test('enabled USB connection survives navigation; local mode never changes shared business configuration', async () => {
      await page.getByTestId('settings-section-impresion').click();
      await page.getByTestId('usb-connect').click(); await connected(page);
      await page.getByTestId('usb-use-for-tickets').check();
      const before = await page.evaluate(() => ({ calls: __usbTest.calls.length, records: __usbTest.records.length }));
      assert.equal(await page.evaluate(() => localStorage.getItem('balam.print.usb')), '1');
      await page.getByTestId('settings-section-negocio').click();
      assert.deepEqual(await page.evaluate(() => ({ enabled: USBReceipt.snapshot().enabled, connected: USBReceipt.snapshot().connected,
        opened: __usbTest.device.opened, calls: __usbTest.calls.length, records: __usbTest.records.length })),
      { enabled: true, connected: true, opened: true, ...before });
      await page.getByTestId('settings-section-impresion').click(); await connected(page);
      assert.equal(await page.getByTestId('usb-use-for-tickets').isChecked(), true);
      await page.getByTestId('usb-print-check').screenshot({ path: path.join(output, 'usb-enabled.png') });
      await resetCapture(page); await page.getByTestId('usb-test-text').click(); await completed(page);
      assert.equal(await page.evaluate(() => JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements]) === __usbTest.business), true);
    });
    await test('leaving Settings cancels an owned late chooser even with persistent USB mode enabled', async () => {
      await page.getByTestId('usb-disconnect').click(); await settled(page);
      await resetCapture(page, 'chooser-hold'); await page.getByTestId('usb-connect').click();
      await page.waitForFunction(() => !!__usbTest.releaseChooser);
      const opens = await page.evaluate(() => __usbTest.calls.filter(call => call[0] === 'open').length);
      await page.getByTestId('settings-section-negocio').click();
      await page.evaluate(() => { __usbTest.mode = 'ok'; __usbTest.releaseChooser(); });
      await page.waitForFunction(() => !USBReceipt.snapshot().busy);
      assert.equal(await page.evaluate(() => USBReceipt.snapshot().connected), false);
      assert.equal(await page.evaluate(() => __usbTest.calls.filter(call => call[0] === 'open').length), opens);
      assert.equal(await page.evaluate(() => __usbTest.records.length), 0);
      await page.getByTestId('settings-section-impresion').click();
      assert.equal(await page.getByTestId('usb-use-for-tickets').isChecked(), true);
      assert.equal(await page.getByTestId('usb-use-for-tickets').isDisabled(), false);
      await page.getByTestId('usb-connect').click(); await connected(page);
    });
    await test('leaving Settings during its own diagnostic stops transfers and retains durable uncertainty', async () => {
      await resetCapture(page, 'hold'); await page.getByTestId('usb-test-text').click();
      await page.waitForFunction(() => !!__usbTest.releaseTransfer);
      await page.getByTestId('settings-section-negocio').click();
      await page.evaluate(() => { __usbTest.mode = 'ok'; __usbTest.releaseTransfer(); });
      await page.waitForFunction(() => !USBReceipt.snapshot().busy);
      assert.equal(await page.evaluate(() => __usbTest.records.length), 1);
      assert.equal(await page.evaluate(() => USBReceipt.snapshot().lastJob.result), 'UNCERTAIN');
      assert.equal(await page.evaluate(() => localStorage.getItem('balam.print.usb.uncertain')), '1');
      await page.getByTestId('settings-section-impresion').click();
      await page.getByTestId('usb-reset-ack').click(); await settled(page);
      await page.getByTestId('usb-use-for-tickets').uncheck();
      assert.equal(await page.evaluate(() => localStorage.getItem('balam.print.usb')), null);
      assert.equal(await page.evaluate(() => USBReceipt.snapshot().enabled), false);
      assert.deepEqual(errors, []);
    });
    await context.close();
    const unsupported = await openSettings(false);
    await test('unsupported browser explains USB compatibility and never requests permission', async () => {
      assert.equal(await unsupported.page.getByTestId('usb-connect').isDisabled(), true);
      assert.match(await unsupported.page.getByTestId('usb-print-check').textContent(), /navegador no permite/);
      assert.equal(await unsupported.page.evaluate(() => __usbTest.requests), 0); assert.deepEqual(unsupported.errors, []);
    });
    await unsupported.context.close();
  }
} catch (error) {
  console.log('ERROR ' + error.message);
  if (!evidence.results.some(result => !result.ok)) evidence.results.push({ name: 'browser setup', ok: false, error: error.message });
  process.exitCode = 1;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(evidence, null, 2));
  console.log(evidence.results.filter(result => result.ok).length + '/' + evidence.results.length + ' ' + output);
}
