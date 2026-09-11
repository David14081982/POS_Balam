// H155: real React consumers and DATA/CONFIG; all external transport is blocked.
// Default: current POS/settings sources over the local runtime, without rebuilding.
// BALAM_VERIFIED_HTML: exercise only the supplied final bundle, without source overlays.
import {chromium} from 'playwright-core';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const html = readFileSync(process.env.BALAM_VERIFIED_HTML || 'index.html', 'utf8');
const browser = await chromium.launch({headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE
  ? {executablePath: process.env.BALAM_CHROME_EXECUTABLE} : {channel: 'chrome'})});
let passed = 0, failed = 0;
const results = [];
const errors = [];
async function check(name, fn) {
  try { await fn(); passed++; results.push({name, pass: true}); console.log('PASS ' + name); }
  catch (error) { failed++; results.push({name, pass: false, error: error.message}); console.error('FAIL ' + name + ': ' + error.message); }
}
try {
  const context = await browser.newContext({viewport: {width: 1280, height: 900}, serviceWorkers: 'block'});
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url === 'http://127.0.0.1:9155/') return route.fulfill({contentType: 'text/html', body: html});
    return /^(blob:|data:)/.test(url) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:9155/');
  await page.waitForFunction(() => window.DATA?.isLocalWriter && window.POSScreen && window.SettingsScreen);
  if (!process.env.BALAM_VERIFIED_HTML) {
    for (const file of ['balam/pos.jsx', 'balam/settings.jsx']) await page.addScriptTag({content: readFileSync(file, 'utf8')});
  }
  await page.evaluate(() => {
    const D = window.DATA, C = window.CONFIG;
    window.AUTH.canAccess = () => true;
    const host = document.createElement('div'); host.id = 'h155-ui';
    const blur = document.createElement('button'); blur.dataset.testid = 'h155-blur'; blur.textContent = 'Outside form';
    document.body.replaceChildren(host, blur);
    window.__h155 = {writes: [], baseline: C.snapshot()};
    const TicketPanel = window.TicketPanel;
    window.TicketPanel = props => {
      window.__h155.ticket = props;
      return React.createElement(TicketPanel, props);
    };
    window.CORE.registerSyncGateway({pushConfig: state => window.__h155.writes.push(structuredClone(state.settings))});
    const common = {cat: '1', modelo: 'PRE', nombre: 'H155 initial', manga: 'ML', tela: 'ALG', color: 'BL',
      cuello: 'TRA', orn: 'BEL', precio: 100, costo: 25, attrs: {}, sizeCategoryId: 'size_letter',
      sizeScale: 'L', sizeCode: 'M', stockQuantity: 4, ornamentColorCodes: ['AZL']};
    window.__h155.v2 = ['BL', 'AZL'].map((color, i) => D.createReference({...common, color,
      id: '15500000-0000-4000-8000-00000000000' + (i + 1),
      referenceFamilyId: '15500000-0000-4000-8000-000000000010'}, []));
    window.__h155.v1 = {id: 'h155-v1', sku: 'H155-LEGACY-T', nombre: 'H155 initial', cat: '1', modelo: 'PRE',
      tela: 'ALG', color: 'BL', colorName: 'Blanco', precio: 100, costo: 25, orn: 'BEL', attrs: {},
      sizeCategoryId: 'size_letter', stock: [{escala: 'L', talla: 'M', stock: 4}]};
    window.__h155.mount = (screen, view = 'grid') => {
      window.__h155.root?.unmount();
      window.__h155.root = ReactDOM.createRoot(host);
      window.__h155.root.render(React.createElement(screen === 'pos' ? window.POSScreen : window.SettingsScreen,
        {layout: 'side', catalogView: view}));
    };
    window.__h155.remoteConfig = (key, value) => {
      const next = C.snapshot(); next.settings[key] = value; C.load(next);
    };
  });
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const mountPOS = async (kind = 'v1', view = 'grid') => {
    await page.evaluate(({kind, view}) => {
      window.__h155.root?.unmount(); window.__h155.root = null;
      window.DATA.applyRemote('products', structuredClone(kind === 'v1' ? [window.__h155.v1] : window.__h155.v2), {authoritative: true});
      window.DATA.applyRemote('promos', [], {authoritative: true});
      window.__h155.mount('pos', view);
    }, {kind, view});
    await page.getByTestId('pos-barcode-input').waitFor(); await settle();
  };
  const remoteProducts = async patch => {
    await page.evaluate(patch => {
      const rows = window.DATA.products.map(p => ({...structuredClone(p), ...patch}));
      if ('stockQuantity' in patch) rows.forEach(p => { if (p.stock) p.stock.forEach(s => s.stock = patch.stockQuantity); });
      assertApply(window.DATA.applyRemote('products', rows, {authoritative: true}));
      function assertApply(ok) { if (!ok) throw Error('Authoritative projection was not applied'); }
    }, patch);
    await settle();
  };
  for (const [kind, view] of [['v1', 'grid'], ['v2', 'list']]) await check(kind + ' ' + view + ' refreshes an open catalog from datachange without changing filters', async () => {
    await mountPOS(kind, view);
    await page.getByTestId('pos-barcode-input').fill('H155');
    await remoteProducts({nombre: 'H155 remote', precio: 250, stockQuantity: 7});
    assert.equal(await page.evaluate(() => window.DATA.products[0].precio), 250);
    const card = page.getByTestId(kind === 'v1' ? 'pos-product-h155-v1' : 'pos-product-family:15500000-0000-4000-8000-000000000010');
    assert.match(await card.innerText(), /H155 remote/);
    assert.match(await card.innerText(), /250/);
    assert.equal(await page.getByTestId('pos-barcode-input').inputValue(), 'H155');
  });
  await check('remote removal clears catalog and an open size selection', async () => {
    await mountPOS();
    await page.getByTestId('pos-product-add-h155-v1').click();
    await page.getByTestId('pos-size-picker').waitFor();
    await page.evaluate(() => window.DATA.applyRemote('products', [], {authoritative: true})); await settle();
    assert.equal(await page.getByTestId('pos-product-h155-v1').count(), 0);
    assert.equal(await page.getByTestId('pos-size-picker').count(), 0);
  });
  await check('a new selection uses the current identity while an existing ticket retains its price', async () => {
    await mountPOS();
    await page.getByTestId('pos-product-add-h155-v1').click();
    await page.getByTestId('pos-size-picker').waitFor();
    await remoteProducts({nombre: 'H155 selected current', precio: 300});
    const size = page.getByTestId(/^legacy-size-pick-/).first();
    assert.match(await size.innerText(), /300/);
    await size.click();
    const line = page.getByTestId('ticket-line-h155-v1');
    await line.waitFor(); assert.match(await line.innerText(), /300/);
    await remoteProducts({nombre: 'H155 later price', precio: 400});
    assert.match(await line.innerText(), /300/); assert.doesNotMatch(await line.innerText(), /400|H155 later price/);
    assert.match(await page.getByTestId('pos-product-h155-v1').innerText(), /400/);
  });
  await check('V2 variant selection follows current references without resetting the chosen size', async () => {
    await mountPOS('v2');
    await page.getByTestId('pos-product-add-family:15500000-0000-4000-8000-000000000010').click();
    await page.getByTestId(/^family-size-pick-/).first().click();
    await page.getByTestId('pos-family-variant-picker').waitFor();
    await remoteProducts({precio: 325});
    const variant = page.getByTestId('family-variant-pick-15500000-0000-4000-8000-000000000001');
    assert.match(await variant.innerText(), /325/);
    await variant.click();
    assert.match(await page.getByTestId('ticket-line-15500000-0000-4000-8000-000000000001').innerText(), /325/);
  });
  await check('a click before React processes datachange still resolves the current product', async () => {
    await mountPOS(); await page.getByTestId('pos-product-add-h155-v1').click();
    await page.getByTestId('pos-size-picker').waitFor();
    await page.evaluate(() => {
      const button = document.querySelector('[data-testid^="legacy-size-pick-"]');
      window.DATA.applyRemote('products', [{...window.DATA.products[0], nombre: 'H155 race current', precio: 320}], {authoritative: true});
      button.click(); // Same task: the DOM callback still closes over the old object.
    }); await settle();
    const line = page.getByTestId('ticket-line-h155-v1');
    assert.match(await line.innerText(), /H155 race current/); assert.match(await line.innerText(), /320/);
  });
  await check('a click racing a confirmed deletion cannot add the removed reference', async () => {
    await mountPOS(); await page.getByTestId('pos-product-add-h155-v1').click();
    await page.getByTestId('pos-size-picker').waitFor();
    await page.evaluate(() => {
      const button = document.querySelector('[data-testid^="legacy-size-pick-"]');
      window.DATA.applyRemote('products', [], {authoritative: true}); button.click();
    }); await settle();
    assert.equal(await page.getByTestId('ticket-line-h155-v1').count(), 0);
  });
  await check('increasing an existing line validates current stock without changing its agreed price', async () => {
    await mountPOS(); await page.getByTestId('pos-product-add-h155-v1').click();
    await page.getByTestId(/^legacy-size-pick-/).first().click();
    const line = page.getByTestId('ticket-line-h155-v1'); const original = await line.innerText();
    await remoteProducts({precio: 200, stockQuantity: 1});
    // Observe the public TicketPanel contract; keep rendering the real component.
    await page.evaluate(() => { const props = window.__h155.ticket; props.onQty(props.ticket[0].key, 1); }); await settle();
    assert.equal(await line.innerText(), original);
  });
  await check('an open V2 selection removes unavailable references and never displays an infinite price', async () => {
    await mountPOS('v2');
    await page.getByTestId('pos-product-add-family:15500000-0000-4000-8000-000000000010').click();
    await page.getByTestId(/^family-size-pick-/).first().click();
    await page.getByTestId('pos-family-variant-picker').waitFor();
    await remoteProducts({stockQuantity: 0});
    assert.equal(await page.getByTestId(/^family-variant-pick-/).count(), 0);
    assert.equal(await page.getByTestId(/^family-size-pick-/).count(), 0);
    assert.doesNotMatch(await page.locator('#h155-ui').innerText(), /Infinity|∞/);
  });
  const mountConfig = async () => {
    await page.evaluate(() => {
      window.__h155.root?.unmount(); window.__h155.root = null;
      window.CONFIG.load(window.__h155.baseline);
      window.__h155.remoteConfig('store.name', 'H155 initial store');
      window.__h155.writes = []; window.__h155.mount('config');
    });
    await page.getByTestId('config-field-store.name').waitFor(); await settle();
  };
  const blur = () => page.getByTestId('h155-blur').click();
  const configValue = key => page.evaluate(key => window.CONFIG.get(key), key);
  const writeCount = () => page.evaluate(() => window.__h155.writes.length);
  await check('previously edited text follows remote CONFIG and untouched blur cannot rewrite it', async () => {
    await mountConfig(); const field = page.getByTestId('config-field-store.name');
    await field.fill('H155 local saved'); await blur();
    assert.equal(await configValue('store.name'), 'H155 local saved');
    await page.evaluate(() => { window.__h155.writes = []; window.__h155.remoteConfig('store.name', 'H155 remote store'); }); await settle();
    assert.equal(await field.inputValue(), 'H155 remote store');
    await field.focus(); await blur();
    assert.equal(await configValue('store.name'), 'H155 remote store'); assert.equal(await writeCount(), 0);
  });
  await check('focus without edits follows remote text and creates no configuration intent', async () => {
    await mountConfig(); const field = page.getByTestId('config-field-store.name'); await field.focus();
    await page.evaluate(() => window.__h155.remoteConfig('store.name', 'H155 remote focused')); await settle();
    assert.equal(await field.inputValue(), 'H155 remote focused');
    await blur(); assert.equal(await configValue('store.name'), 'H155 remote focused'); assert.equal(await writeCount(), 0);
  });
  await check('remote changes preserve an active draft and its deliberate blur saves once', async () => {
    await mountConfig(); const field = page.getByTestId('config-field-store.name'); await field.fill('H155 active draft');
    await page.evaluate(() => window.__h155.remoteConfig('store.name', 'H155 concurrent remote')); await settle();
    assert.equal(await field.inputValue(), 'H155 active draft'); assert.equal(await writeCount(), 0);
    await blur(); assert.equal(await configValue('store.name'), 'H155 active draft'); assert.equal(await writeCount(), 1);
    await field.focus(); await blur(); assert.equal(await writeCount(), 1);
  });
  await check('an abandoned edit returning to its original text does not overwrite concurrent CONFIG', async () => {
    await mountConfig(); const field = page.getByTestId('config-field-store.name'); await field.fill('H155 draft');
    await page.evaluate(() => window.__h155.remoteConfig('store.name', 'H155 remote wins')); await settle();
    await field.fill('H155 initial store'); await blur();
    assert.equal(await configValue('store.name'), 'H155 remote wins'); assert.equal(await field.inputValue(), 'H155 remote wins');
    assert.equal(await writeCount(), 0);
  });
  await check('numeric settings preserve number type, clamp bounds and avoid unchanged writes', async () => {
    await mountConfig(); await page.getByTestId('settings-section-ventas').click();
    const field = page.getByTestId('config-field-discount.minMarginPct'); await field.waitFor();
    await field.fill('150'); await blur(); assert.equal(await configValue('discount.minMarginPct'), 100); assert.equal(await field.inputValue(), '100');
    await field.fill('-5'); await blur(); assert.equal(await configValue('discount.minMarginPct'), 0);
    await field.fill('12.5'); await blur(); assert.equal(await configValue('discount.minMarginPct'), 12.5);
    await page.evaluate(() => { window.__h155.writes = []; window.__h155.remoteConfig('discount.minMarginPct', 45); }); await settle();
    assert.equal(await field.inputValue(), '45'); await field.focus(); await blur(); assert.equal(await writeCount(), 0);
    assert.equal(await configValue('discount.minMarginPct'), 45);
  });
  await check('folio prefix remote update survives an untouched blur without a new intent', async () => {
    await mountConfig(); const field = page.getByTestId('config-field-folio.prefix');
    await field.fill('qa155a'); await blur(); assert.equal(await configValue('folio.prefix'), 'QA155A');
    await page.evaluate(() => { window.__h155.writes = []; window.__h155.remoteConfig('folio.prefix', 'QA155B'); }); await settle();
    await field.focus(); await blur();
    assert.equal(await configValue('folio.prefix'), 'QA155B'); assert.equal(await field.inputValue(), 'QA155B');
    assert.equal(await writeCount(), 0);
  });
  await check('folio prefix draft and normalization survive concurrent configuration', async () => {
    await mountConfig(); const field = page.getByTestId('config-field-folio.prefix');
    await field.fill('xy!9');
    await page.evaluate(() => window.__h155.remoteConfig('folio.prefix', 'REMOTE')); await settle();
    assert.equal(await field.inputValue(), 'xy!9'); assert.equal(await writeCount(), 0);
    await blur(); assert.equal(await configValue('folio.prefix'), 'XY9'); assert.equal(await field.inputValue(), 'XY9');
    assert.equal(await writeCount(), 1);
    await page.evaluate(() => { window.__h155.writes = []; window.__h155.remoteConfig('folio.prefix', 'AFTER'); }); await settle();
    assert.equal(await field.inputValue(), 'AFTER');
    const preview = await page.evaluate(() => window.DATA.folioPreview('AFTER'));
    assert.ok((await page.locator('#h155-ui').innerText()).includes(preview));
  });
  await check('unmount releases activity and consumers have no runtime errors', async () => {
    await page.evaluate(() => window.__h155.root.unmount()); await settle();
    assert.equal(await page.evaluate(() => window.CORE.activityStatus().active), 0);
    assert.deepEqual(errors, []);
  });
} finally { await browser.close(); }
console.log(JSON.stringify({passed, failed, results, mode: process.env.BALAM_VERIFIED_HTML ? 'final-bundle' : 'current-sources',
  htmlSha256: createHash('sha256').update(html).digest('hex'),
  ...(!process.env.BALAM_VERIFIED_HTML ? {sourceSha256: Object.fromEntries(['balam/pos.jsx', 'balam/settings.jsx']
    .map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]))} : {})}));
if (failed) process.exitCode = 1;
