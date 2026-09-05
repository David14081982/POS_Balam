// H142 independent browser QA. Every request is intercepted; synthetic local
// products only. Exercises V1/V2 draft retention and inventory repaint/reload.
import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const html = readFileSync('index.html', 'utf8');
const out = process.env.BALAM_QA_BROWSER_OUTPUT
  || join(tmpdir(), 'balam-h142-qa-browser');
mkdirSync(out, { recursive: true });
const results = [], evidence = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail || {})}`); };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function metrics(page) {
  return page.evaluate(() => ({
    width: innerWidth, documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    overflow: [...document.querySelectorAll('main, [role="dialog"], [data-testid="product-form"]')]
      .filter(el => el.getClientRects().length)
      .map(el => ({ name: el.getAttribute('data-testid') || el.tagName, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth })),
  }));
}
function noOverflow(m) { return m.documentWidth <= m.width + 1 && m.bodyWidth <= m.width + 1 && m.overflow.every(el => el.scrollWidth <= el.clientWidth + 1); }
const rows = page => page.locator('[data-testid^="inventory-product-"]:visible');
const countKpi = page => page.locator('article[data-responsive-kpi]').filter({ hasText: 'Productos / familias' }).locator('[data-kpi-value]');
try {
  for (const width of [320, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    let intercepted = 0;
    await context.route('**/*', route => {
      intercepted++;
      return route.fulfill(route.request().url() === 'http://127.0.0.1:8927/'
        ? { status: 200, contentType: 'text/html', body: html }
        : { status: 401, contentType: 'application/json', body: '{}' });
    });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await page.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
    await page.goto('http://127.0.0.1:8927/');
    await page.waitForFunction(() => window.DATA && window.STORE?.enabled);
    const fixture = await page.evaluate(() => {
      const D = window.DATA, C = window.CONFIG;
      const modelKind = C.modeloKind();
      // The fresh offline profile has no business model catalog. Supply one
      // synthetic item through CONFIG's remote-load seam, within this profile.
      const config = C.snapshot();
      config.catalogs[modelKind] = [{ code: 'QA142', label: 'MODELO QA', active: true }];
      for (const [kind, code, label] of [['category', '1', 'Camisa QA'], ['fabric', 'LIN', 'Lino QA']]) {
        const entries = config.catalogs[kind] || (config.catalogs[kind] = []);
        if (!entries.some(item => item.code === code)) entries.push({ code, label, active: true });
      }
      C.load(config);
      const model = C.list(modelKind).find(item => item.active !== false);
      if (!model) throw Error('QA_MODEL_CATALOG_EMPTY');
      const modelAttrs = { [modelKind]: model.code };
      const v1 = D.hydrate({ id: 'h142-qa-v1', recordModel: 'v1', cat: '1', modelo: model.code, nombre: model.label, manga: 'MC', tela: 'LIN', color: 'BL', cuello: 'MAO', orn: 'BEL', precio: 100, costo: 40, stock: [{ talla: 'M', escala: 'L', stock: 3 }], attrs: { ...modelAttrs, __sizeCategoryId: 'size_letter' } });
      const familyId = '14200000-0000-4000-8000-000000000081';
      const v2 = D.createReference({ referenceFamilyId: familyId, cat: '1', modelo: model.code, nombre: model.label, manga: 'MC', tela: 'LIN', color: 'BL', cuello: 'MAO', orn: 'BEL', precio: 100, costo: 40, attrs: modelAttrs, sizeCategoryId: 'size_number', sizeScale: 'N', sizeCode: '38', stockQuantity: 3, ornamentColorCodes: ['DRO'] }, []);
      D.products.splice(0, D.products.length, v1, v2); D.persistProducts();
      return { v1Id: v1.id, v2Id: v2.id, familyId };
    });
    await page.waitForFunction(() => document.querySelector('[data-kpi-value]')?.textContent === '2');
    check(`${width}: initial V1/V2 list and KPI`, await rows(page).count() === 2 && await countKpi(page).innerText() === '2');
    const remoteId = await page.evaluate(() => {
      const D = window.DATA, next = JSON.parse(JSON.stringify(D.products));
      const third = D.createReference({ ...next.find(p => p.recordModel === 'v2'), id: undefined, barcodeCode: undefined, referenceFamilyId: '14200000-0000-4000-8000-000000000082', sizeCode: '40', stockQuantity: 4 }, []);
      next.push(third); D.applyRemote('products', next, { authoritative: true }); return third.id;
    });
    await page.waitForFunction(() => document.querySelector('[data-kpi-value]')?.textContent === '3');
    check(`${width}: datachange updates list and KPI`, await rows(page).count() === 3 && await countKpi(page).innerText() === '3');
    const inventoryMetrics = await metrics(page);
    check(`${width}: inventory horizontal bounds`, noOverflow(inventoryMetrics), inventoryMetrics);
    await page.screenshot({ path: join(out, `inventory-${width}.png`), fullPage: true });
    for (const model of ['v1', 'v2']) {
      const id = model === 'v1' ? fixture.v1Id : fixture.v2Id;
      const testId = model === 'v1' ? `inventory-product-${id}` : `inventory-product-family:${fixture.familyId}`;
      await page.getByTestId(testId).click();
      await page.getByTestId('product-detail-edit').click();
      check(`${width}: ${model} fixture rehydrates catalog selection`, !!await page.getByTestId('product-name').inputValue());
      await page.getByTestId('product-general-price').fill('321');
      await page.evaluate(id => {
        const D = window.DATA, next = JSON.parse(JSON.stringify(D.products));
        next.find(p => p.id === id).precio = 150;
        D.applyRemote('products', next, { authoritative: true });
      }, id);
      await page.waitForTimeout(100);
      const draftValue = await page.getByTestId('product-general-price').inputValue();
      const authoritativePrice = await page.evaluate(id => window.DATA.products.find(p => p.id === id).precio, id);
      check(`${width}: ${model} draft survives datachange`, draftValue === '321' && authoritativePrice === 150, { draftValue, authoritativePrice });
      const formMetrics = await metrics(page);
      check(`${width}: ${model} editor horizontal bounds`, noOverflow(formMetrics), formMetrics);
      await page.screenshot({ path: join(out, `editor-${model}-${width}.png`), fullPage: true });
      await page.getByTestId('product-cancel').click();
      if (await page.getByTestId('product-detail-close').count()) await page.getByTestId('product-detail-close').click();
    }
    await page.reload(); await page.waitForFunction(() => window.DATA && window.STORE?.enabled);
    await page.waitForFunction(() => document.querySelector('[data-kpi-value]')?.textContent === '3');
    const persisted = await page.evaluate(({ fixture, remoteId }) => ({
      ids: window.DATA.products.map(p => p.id),
      prices: [fixture.v1Id, fixture.v2Id].map(id => window.DATA.products.find(p => p.id === id)?.precio),
      remotePresent: window.DATA.products.some(p => p.id === remoteId),
    }), { fixture, remoteId });
    check(`${width}: reload preserves remote data and canceled drafts`,
      persisted.ids.length === 3 && persisted.remotePresent && persisted.prices.every(price => price === 150)
        && await rows(page).count() === 3 && await countKpi(page).innerText() === '3', persisted);
    await page.screenshot({ path: join(out, `reload-${width}.png`), fullPage: true });
    check(`${width}: no page errors`, errors.length === 0, errors);
    evidence.push({ width, intercepted, pageErrors: errors });
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(join(out, 'results.json'), JSON.stringify({ sha256: createHash('sha256').update(html).digest('hex'), scope: 'Synthetic fixtures; all requests fulfilled locally; no real business writes', results, evidence }, null, 2));
}
console.log(`H142 independent browser QA: ${results.filter(r => r.ok).length}/${results.length}`);
process.exitCode = results.some(r => !r.ok) ? 1 : 0;
