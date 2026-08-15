// H-104 · BALAM QA real sobre la columna SKU de Inventario.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.'), evidence = resolve('.evidence-h104'); mkdirSync(evidence, { recursive: true });
const artifact = process.env.BALAM_ARTIFACT_PATH ? resolve(process.env.BALAM_ARTIFACT_PATH) : resolve(root, 'index.html');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => { const relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html'; const path = relative === 'index.html' ? artifact : resolve(root, relative); if (relative !== 'index.html' && !path.startsWith(root)) { res.writeHead(403); res.end(); return; } res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }); createReadStream(path).on('error', () => { res.writeHead(404); res.end(); }).pipe(res); });
await new Promise(done => server.listen(8914, '127.0.0.1', done));
let pass = 0, fail = 0; const ok = (name, value, detail = '') => { console.log(`${value ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`); value ? pass++ : fail++; }; let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
  await page.goto('http://127.0.0.1:8914/index.html'); await page.waitForFunction(() => window.DATA && window.CONFIG);
  const fixture = await page.evaluate(() => {
    const D = window.DATA, rows = [];
    const make = (familyId, name, specs) => { const family = []; for (const spec of specs) family.push(D.createReference({ referenceFamilyId: familyId, cat: '1', modelo: 'VIC', nombre: name, manga: 'ML', tela: spec.tela || 'ALG', color: 'BL', cuello: 'TRA', orn: 'BEL', sizeCategoryId: 'size_number', sizeCode: spec.size, sizeScale: 'N', stockQuantity: spec.stock, precio: 1250, ornamentColorCodes: [spec.color], attrs: { producto: 'VIC', corte: '-', caracteristicas: '66' } }, family)); rows.push(...family); return D.familyVisualSku(D.referenceFamilyProjection(familyId, family)); };
    const bId = '10400000-0000-4000-8000-000000000201', cId = '10400000-0000-4000-8000-000000000202';
    const expectedB = make(bId, 'H104 TALLAS', [{ size: '38', color: 'DRO', stock: 2 }, { size: '40', color: 'DRO', stock: 3 }, { size: '42', color: 'DRO', stock: 1 }]);
    const expectedC = make(cId, 'H104 VARIANTES', [{ size: '40', color: 'DRO', stock: 3 }, { size: '40', color: 'AZL', stock: 2 }]);
    localStorage.setItem('balam_pos_products_v2', JSON.stringify(rows)); return { bId, cId, expectedB, expectedC };
  });
  for (const width of [320, 360, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 850 }); await page.reload();
    const mobile = width < 768, testId = mobile ? 'inventory-sku-mobile' : 'inventory-sku-desktop';
    const b = page.getByTestId('inventory-product-family:' + fixture.bId).getByTestId(testId);
    const c = page.getByTestId('inventory-product-family:' + fixture.cId).getByTestId(testId);
    await b.waitFor(); const bText = await b.innerText(), cText = await c.innerText();
    ok(`${width}px muestra T en columna SKU`, bText.includes(fixture.expectedB), bText);
    ok(`${width}px muestra VAR y talla común`, cText.includes(fixture.expectedC), cText);
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    ok(`${width}px sin overflow global`, overflow === 0, String(overflow));
    await page.screenshot({ path: resolve(evidence, `inventario-sku-${width}.png`), fullPage: true });
    await b.screenshot({ path: resolve(evidence, `inventario-sku-row-${width}.png`) });
  }
  ok('navegación abre el detalle', await page.getByTestId('inventory-product-family:' + fixture.bId).click().then(() => page.getByTestId('product-detail-close').isVisible()));
  ok('DetailDrawer conserva su autoridad H-102', (await page.locator('body').innerText()).includes('Varios SKU'));
  ok('flujo sin errores de página', errors.length === 0, errors.join(' | '));
} finally { if (browser) await browser.close(); await new Promise(done => server.close(done)); }
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`); process.exit(fail ? 1 : 0);
