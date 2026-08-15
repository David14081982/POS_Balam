// H-101 · Piloto UI local sobre el bundle: familia agrupada, edición masiva y stock cero.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = resolve(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html');
  if (!path.startsWith(root)) { res.writeHead(403); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
  createReadStream(path).on('error', () => { res.writeHead(404); res.end(); }).pipe(res);
});
await new Promise(done => server.listen(8911, '127.0.0.1', done));

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
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
  await page.goto('http://127.0.0.1:8911/index.html');
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 60000 });
  const pilot = await page.evaluate(() => {
    const D = window.DATA;
    const familyId = '10100000-0000-4000-8000-000000000101';
    const common = {
      referenceFamilyId: familyId, cat: '1', modelo: 'ADR', nombre: 'ADRIANO',
      manga: 'MC', tela: 'LIN', color: 'BL', cuello: 'MAO', orn: 'Bordado Eléctrico',
      sizeCategoryId: 'size_number', precio: 1150, costo: 500, pop: false,
      attrs: { producto: 'ADR', corte: 'SLF', caracteristicas: '23' },
    };
    const result = D.materializeReferenceFamily(common, [
      { selectedForCreation: true, sizeCode: '38', sizeScale: 'N', stockQuantity: 3, precio: 1150, ornamentColorCodes: ['DRO'] },
      { selectedForCreation: true, sizeCode: '40', sizeScale: 'N', stockQuantity: 5, precio: 1150, ornamentColorCodes: ['DRO'] },
      { selectedForCreation: true, sizeCode: '40', sizeScale: 'N', stockQuantity: 2, precio: 1150, ornamentColorCodes: ['AZL'] },
      { selectedForCreation: true, sizeCode: '42', sizeScale: 'N', stockQuantity: 8, precio: 1250, ornamentColorCodes: ['CF', 'DRO'] },
      { selectedForCreation: true, sizeCode: '44', sizeScale: 'N', stockQuantity: 0, precio: 1150, ornamentColorCodes: ['DRO'] },
    ], [], familyId);
    localStorage.setItem('balam_pos_products_v2', JSON.stringify(result.references));
    return { familyId, firstId: result.references[0].id };
  });
  await page.reload();
  await page.waitForFunction(id => window.DATA?.products?.some(row => row.id === id), pilot.firstId);
  await page.getByTestId('inventory-product-' + pilot.firstId).click();
  await page.getByTestId('product-detail-edit').click();
  await page.getByTestId('reference-family-grid').waitFor();

  const opened = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid^="family-row-"]')];
    const selected = rows.filter(row => row.querySelector('input[type="checkbox"]')?.checked);
    const summary = document.querySelectorAll('[data-testid^="family-summary-"]');
    const zero = [...document.querySelectorAll('[data-testid^="family-stock-"]')].some(input => Number(input.value) === 0
      && input.closest('[data-testid^="family-row-"]')?.querySelector('input[type="checkbox"]')?.checked);
    return { rows: rows.length, selected: selected.length, summary: summary.length, zero };
  });
  ok('1. Editar abre las cinco referencias hermanas', opened.selected === 5, JSON.stringify(opened));
  ok('2. la referencia existente con stock cero sigue visible', opened.zero);
  ok('3. el resumen efectivo contiene cinco referencias', opened.summary === 5);

  await page.getByTestId('product-general-price').fill('1250');
  const added = await page.evaluate(() => {
    const row = [...document.querySelectorAll('[data-testid^="family-row-"]')]
      .find(item => /(^|\s)46(\s|$)/.test(item.innerText));
    if (!row) return false;
    const box = row.querySelector('input[type="checkbox"]');
    box.click();
    return box.checked;
  });
  ok('4. se puede seleccionar una talla nueva con stock cero', added);
  await page.getByTestId('product-save').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="product-form"]'));
  const saved = await page.evaluate(familyId => {
    const rows = window.DATA.products.filter(row => row.referenceFamilyId === familyId && !row._deletedAt);
    return {
      count: rows.length,
      prices: rows.map(row => row.precio),
      zeroSizes: rows.filter(row => row.stockQuantity === 0).map(row => row.sizeCode).sort(),
      ids: rows.map(row => row.id), barcodes: rows.map(row => row.barcodeCode),
    };
  }, pilot.familyId);
  ok('5. agregar talla crea una sexta referencia sin cambiar las cinco existentes',
    saved.count === 6 && new Set(saved.ids).size === 6 && saved.ids.includes(pilot.firstId), JSON.stringify(saved));
  ok('6. edición masiva materializa precio 1250 en los seis IDs', saved.prices.every(value => value === 1250));
  ok('7. tallas 44 y 46 conservan referencias independientes en cero',
    JSON.stringify(saved.zeroSizes) === JSON.stringify(['44', '46']));
  ok('8. los seis barcodes son únicos', new Set(saved.barcodes).size === 6);
  ok('9. no hubo errores de página', errors.length === 0, errors.join(' | '));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
