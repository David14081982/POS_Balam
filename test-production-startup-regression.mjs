// H-60: ventas históricas pueden renderizar antes de que llegue el catálogo.
// El bundle debe conservar la pantalla y mostrar un placeholder explícito.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const root = resolve('.');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const file = join(root, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404); res.end('nf'); return;
  }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise(done => server.listen(8810, '127.0.0.1', done));

let pass = 0, fail = 0;
const check = (name, value, detail = '') => {
  console.log(`${value ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  value ? pass++ : fail++;
};

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route(/supabase\.co/, route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Supabase simulado por H-60' }),
  }));
  await page.addInitScript(() => {
    localStorage.setItem('balam-page', 'dashboard');
    localStorage.setItem('balam_pos_products_v2', '[]');
    localStorage.setItem('balam_pos_sales_v1', JSON.stringify([{
      folio: 'BG-H60', fecha: '2026-07-31 00:00', cliente: 'Histórico',
      vendedor: 'Administrador', metodo: 'Efectivo', estado: 'Pagado',
      total: 500, items: 1, lineas: [],
    }]));
  });
  await page.goto('http://127.0.0.1:8810/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.App && window.DATA && window.UI, null, { timeout: 30000 });
  await page.waitForTimeout(500);
  check('1. Dashboard renderiza con ventas y catálogo temporalmente vacío', errors.length === 0, errors.join(' | '));
  check('2. ProductThumb no accede a modelo de un producto inexistente',
    !errors.some(error => /modelo/.test(error)));
  check('3. La ausencia se representa explícitamente, no se oculta',
    await page.locator('[data-testid="product-thumb-missing"]').count() === 1);
  const historical = await page.evaluate(() => {
    const snapshot = window.CONFIG.snapshot();
    snapshot.catalogMeta.size_letter = { label: 'Talla (Letra)' };
    snapshot.catalogMeta.size_number = { label: 'Talla (Número)' };
    window.CONFIG.load(snapshot);
    window.DATA.applyRemote('products', [{
      id: 'agotado-historico', nombre: 'Agotado', modelo: '0',
      attrs: { __sizeCategoryId: 'size_number' },
      stock: [{ talla: '40', escala: 'N', stock: 0 }],
    }]);
    const loaded = window.DATA.products[0];
    return {
      categories: window.CONFIG.sizeCategories(),
      persisted: loaded && loaded.attrs && loaded.attrs.__sizeCategoryId,
      derived: loaded && loaded.sizeCategoryId,
    };
  });
  check('4. Metadatos históricos conservan ambas categorías estructurales',
    historical.categories.some(x => x.id === 'size_letter' && x.scale === 'L')
      && historical.categories.some(x => x.id === 'size_number' && x.scale === 'N'));
  check('5. Un producto agotado conserva la categoría persistida al hidratar',
    historical.persisted === 'size_number' && historical.derived === 'size_number');
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
