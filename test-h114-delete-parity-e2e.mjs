import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
  const file = resolve(root, relative);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).on('error', () => { res.writeHead(404); res.end(); }).pipe(res);
});

await new Promise(done => server.listen(8914, '127.0.0.1', done));
let browser;
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
  await page.goto('http://127.0.0.1:8914/index.html');
  await page.waitForFunction(() => window.DATA && window.InventoryScreen);

  const fixture = await page.evaluate(() => {
    const D = window.DATA;
    const v1 = D.hydrate({ id: 'h114-v1', recordModel: 'v1', cat: '1', modelo: 'H114', nombre: 'H114 V1', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'TRA', orn: 'BEL', precio: 100, sku: 'H114-V1', stock: [{ talla: 'M', stock: 3 }], attrs: { __sizeCategoryId: 'size_letter' } });
    const familyId = '11400000-0000-4000-8000-000000000114';
    const common = { referenceFamilyId: familyId, cat: '1', modelo: 'H114', nombre: 'H114 V2', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'TRA', orn: 'BEL', precio: 100, attrs: {}, sizeCategoryId: 'size_letter', sizeScale: 'L' };
    const refs = [
      D.createReference({ ...common, sizeCode: 'M', stockQuantity: 0, ornamentColorCodes: ['AZL'] }, []),
      D.createReference({ ...common, sizeCode: 'M', stockQuantity: 2, ornamentColorCodes: ['DRO'] }, []),
      D.createReference({ ...common, sizeCode: 'L', stockQuantity: 4, ornamentColorCodes: ['AZL'] }, []),
    ];
    localStorage.setItem('balam_pos_products_v2', JSON.stringify([v1, ...refs]));
    return { v1Id: v1.id, familyId, refIds: refs.map(ref => ref.id) };
  });
  await page.reload();

  await page.getByTestId(`inventory-product-${fixture.v1Id}`).click();
  check('V1 conserva Eliminar', await page.getByTestId('product-detail-delete').count() === 1);
  await page.getByTestId('product-detail-close').click();

  await page.getByTestId(`inventory-product-family:${fixture.familyId}`).click();
  check('V2 expone Eliminar', await page.getByTestId('product-detail-delete').count() === 1);
  if (await page.getByTestId('product-detail-delete').count()) {
    await page.getByTestId('product-detail-delete').click();
    check('familia múltiple ofrece dos alcances', await page.getByTestId('product-delete-reference-scope').count() === 1 && await page.getByTestId('product-delete-family-scope').count() === 1);
  } else check('familia múltiple ofrece dos alcances', false);
  const bodyText = await page.locator('body').innerText();
  check('no expone identidad técnica', !bodyText.includes(fixture.familyId) && fixture.refIds.every(id => !bodyText.includes(id)));
  check('sin errores de página', pageErrors.length === 0);
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}

for (const result of checks) console.log(`${result.ok ? 'OK' : 'FAIL'} · ${result.name}`);
const failed = checks.filter(result => !result.ok);
console.log(`\nH-114 E2E: ${checks.length - failed.length}/${checks.length} verificaciones aprobadas.`);
if (failed.length) process.exit(1);
