// H-101 UX · Nuevo producto con experiencia V1 y persistencia V2.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const file = resolve(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html');
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).on('error', () => { res.writeHead(404); res.end(); }).pipe(res);
});
await new Promise(done => server.listen(8913, '127.0.0.1', done));

let pass = 0, fail = 0;
const ok = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
};
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('balam-page', 'inventario'); });
  await page.goto('http://127.0.0.1:8913/index.html');
  await page.waitForFunction(() => window.DATA && window.CONFIG);
  await page.evaluate(() => {
    const kind = window.CONFIG.modeloKind();
    if (!window.CONFIG.list(kind).some(item => item.code === 'ADR')) {
      window.CONFIG.addItem(kind, { code: 'ADR', label: 'ADRIANO', active: true });
    }
  });
  await page.getByTestId('inventory-new-product').click();
  await page.getByTestId('product-form').waitFor();

  await page.getByTestId('product-name').selectOption({ index: 1 });
  await page.getByTestId('product-general-price').fill('1250');
  await page.getByTestId('product-size-category').selectOption('size_letter');
  const ornamentValue = await page.getByTestId('product-ornament').evaluate(select => {
    const option = [...select.options].find(item => item.value && item.value !== '—');
    return option?.value || '';
  });
  if (ornamentValue) await page.getByTestId('product-ornament').selectOption(ornamentValue);
  await page.getByTestId('general-color-selector-toggle').click();
  await page.getByTestId('product-general-color-DRO').click();
  await page.getByTestId('product-general-color-AZL').click();
  await page.getByTestId('general-color-selector-close').click();

  const rowTestId = async size => page.evaluate(value => {
    const row = [...document.querySelectorAll('[data-testid^="family-row-"]')]
      .find(node => node.querySelector('label')?.innerText.trim() === value);
    return row?.dataset.testid || '';
  }, size);
  const setStock = async (size, quantity) => {
    const rowId = await rowTestId(size);
    await page.locator(`[data-testid="${rowId}"] [data-testid^="family-stock-"]`).fill(String(quantity));
  };
  for (const size of ['XS', 'S']) {
    const rowId = await rowTestId(size);
    await page.locator(`[data-testid="${rowId}"] [data-testid^="family-zero-toggle-"]`).click();
  }
  await setStock('M', 3); await setStock('L', 5); await setStock('XL', 2); await setStock('2XL', 1);

  await page.getByTestId('product-exceptions-toggle').click();
  await page.getByTestId('add-price-by-size').click();
  await page.getByTestId('price-group-0-value').fill('1350');
  await page.getByTestId('price-group-0-size-2XL').click();
  await page.getByTestId('price-group-0-done').click();
  await page.getByTestId('add-ornament-colors-by-size').click();
  await page.getByTestId('ornament-group-0-size-XL').click();
  await page.getByTestId('ornament-group-0-color-toggle').click();
  await page.getByTestId('ornament-group-0-color-DRO').click();
  await page.getByTestId('ornament-group-0-color-close').click();
  await page.getByTestId('ornament-group-0-done').click();

  const projected = await page.evaluate(() => ({
    cards: document.querySelectorAll('[data-testid="reference-family-grid"] input[type="checkbox"]').length,
    summary: [...document.querySelectorAll('[data-testid^="family-summary-"]')]
      .filter(node => node.dataset.testid !== 'family-summary-details-toggle').length,
    copy: /\bCOPY\b/.test(document.querySelector('[data-testid="reference-family-grid"]')?.innerText || ''),
    total: document.querySelector('[data-testid="reference-family-summary"]')?.innerText || '',
  }));
  ok('1. Nuevo usa cuadrícula compacta sin cards/checkboxes/COPY', projected.cards === 0 && !projected.copy);
  ok('2. el resumen proyecta seis tallas antes de guardar', projected.summary === 6, JSON.stringify(projected));
  ok('3. el resumen efectivo muestra 11 piezas', /Piezas:\s*11/.test(projected.total));

  const widths = [320, 360, 390, 430, 768, 1024, 1280];
  const layout = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    layout.push(await page.evaluate(w => {
      const form = document.querySelector('[data-testid="product-form"]');
      const grid = document.querySelector('[data-testid="family-compact-stock-grid"]');
      return { width: w, formOverflow: form.scrollWidth - form.clientWidth, gridOverflow: grid.scrollWidth - grid.clientWidth };
    }, width));
  }
  ok('4. no hay overflow horizontal entre 320 y 1280', layout.every(row => row.formOverflow <= 1 && row.gridOverflow <= 1), JSON.stringify(layout));
  await page.setViewportSize({ width: 1280, height: 900 });

  const before = await page.evaluate(() => window.DATA.products.map(row => row.id));
  await page.getByTestId('product-save').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="product-form"]'));
  const saved = await page.evaluate(ids => {
    const rows = window.DATA.products.filter(row => !ids.includes(row.id));
    return rows.map(row => ({ id: row.id, family: row.referenceFamilyId, size: row.sizeCode,
      stock: row.stockQuantity, price: row.precio, colors: row.ornamentColorCodes, model: row.recordModel,
      barcode: row.barcodeCode }));
  }, before);
  const bySize = Object.fromEntries(saved.map(row => [row.size, row]));
  ok('5. Nuevo materializa seis referencias V2 independientes', saved.length === 6 && saved.every(row => row.model === 'v2') && new Set(saved.map(row => row.id)).size === 6, JSON.stringify(saved));
  ok('6. las seis referencias comparten una familia y barcodes únicos', new Set(saved.map(row => row.family)).size === 1 && new Set(saved.map(row => row.barcode)).size === 6);
  ok('7. stock exacto XS0/S0/M3/L5/XL2/2XL1', ['XS:0','S:0','M:3','L:5','XL:2','2XL:1'].every(pair => { const [size, qty] = pair.split(':'); return bySize[size]?.stock === Number(qty); }));
  ok('8. 2XL materializa precio especial 1350 y las demás 1250', bySize['2XL']?.price === 1350 && saved.filter(row => row.size !== '2XL').every(row => row.price === 1250));
  ok('9. XL materializa DRO y las demás DRO+AZL', JSON.stringify(bySize.XL?.colors) === JSON.stringify(['DRO']) && saved.filter(row => row.size !== 'XL').every(row => JSON.stringify((row.colors || []).slice().sort()) === JSON.stringify(['AZL','DRO'])));
  ok('10. no hubo errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
