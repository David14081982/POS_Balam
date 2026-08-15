import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.');
const out = resolve('.evidence-h101-ux');
const prefix = process.env.H101_CAPTURE_PREFIX || 'before';
mkdirSync(out, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const file = resolve(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html');
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).on('error', () => { res.writeHead(404); res.end(); }).pipe(res);
});
await new Promise(done => server.listen(8912, '127.0.0.1', done));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
  await page.goto('http://127.0.0.1:8912/index.html');
  await page.waitForFunction(() => window.DATA && window.CONFIG);
  const ids = await page.evaluate(() => {
    const D = window.DATA;
    const v1 = D.hydrate({ id: 'h101-ux-v1', recordModel: 'v1', cat: '1', modelo: 'ADR', nombre: 'ADRIANO V1', manga: 'MC', tela: 'LIN', color: 'BL', cuello: 'MAO', orn: 'Bordado Eléctrico', ornColors: ['DRO'], precio: 1250, costo: 500, sizeCategoryId: 'size_letter', attrs: { __sizeCategoryId: 'size_letter' }, stock: [{ talla: 'XS', escala: 'L', stock: 0 }, { talla: 'S', escala: 'L', stock: 0 }, { talla: 'M', escala: 'L', stock: 3 }, { talla: 'L', escala: 'L', stock: 5 }, { talla: 'XL', escala: 'L', stock: 2 }, { talla: '2XL', escala: 'L', stock: 1 }] });
    const familyId = '10100000-0000-4000-8000-000000000101';
    const common = { referenceFamilyId: familyId, cat: '1', modelo: 'ADR', nombre: 'ADRIANO V2', manga: 'MC', tela: 'LIN', color: 'BL', cuello: 'MAO', orn: 'Bordado Eléctrico', sizeCategoryId: 'size_letter', precio: 1250, costo: 500, attrs: { __sizeCategoryId: 'size_letter', corte: 'SLF', caracteristicas: '23' } };
    const v2 = D.materializeReferenceFamily(common, [
      { selectedForCreation: true, sizeCode: 'XS', sizeScale: 'L', stockQuantity: 0, ornamentColorCodes: ['DRO'] },
      { selectedForCreation: true, sizeCode: 'S', sizeScale: 'L', stockQuantity: 0, ornamentColorCodes: ['DRO'] },
      { selectedForCreation: true, sizeCode: 'M', sizeScale: 'L', stockQuantity: 3, ornamentColorCodes: ['DRO'] },
      { selectedForCreation: true, sizeCode: 'L', sizeScale: 'L', stockQuantity: 5, ornamentColorCodes: ['DRO'] },
      { selectedForCreation: true, sizeCode: 'XL', sizeScale: 'L', stockQuantity: 2, ornamentColorCodes: ['DRO'] },
      { selectedForCreation: true, sizeCode: '2XL', sizeScale: 'L', stockQuantity: 1, ornamentColorCodes: ['DRO'] },
    ], D.products, familyId).references;
    D.products.splice(0, D.products.length, v1, ...v2);
    D.persistProducts();
    return { v1: v1.id, v2: v2[0].id };
  });
  await page.reload();
  for (const [name, id] of Object.entries(ids)) {
    await page.getByTestId('inventory-product-' + id).click();
    await page.getByTestId('product-detail-edit').click();
    await page.getByTestId('product-form').screenshot({ path: resolve(out, `${prefix}-${name}.png`) });
    await page.locator('[aria-labelledby="product-section-stock"]').screenshot({ path: resolve(out, `${prefix}-${name}-stock.png`) });
    await page.getByTestId('product-cancel').click();
    await page.getByTestId('product-detail-close').click();
  }
} finally {
  await browser.close();
  server.close();
}
