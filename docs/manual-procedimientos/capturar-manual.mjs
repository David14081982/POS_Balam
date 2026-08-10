import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const root = resolve('.');
const out = resolve('docs/manual-procedimientos/img');
mkdirSync(out, { recursive: true });
const mime = { '.html': 'text/html', '.jsx': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const file = join(root, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(8894, '127.0.0.1', r));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1.5 });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"offline"}' }));
  const page = await context.newPage();
  await page.addInitScript(() => { localStorage.setItem('balam-sidebar', '1'); localStorage.setItem('balam-page', 'inventario'); });
  await page.goto('http://127.0.0.1:8894/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.App && window.DATA && window.CONFIG);
  await page.evaluate(() => {
    const cfg = window.CONFIG;
    const original = cfg.codes;
    cfg.codes = function (kind) {
      if (kind === 'payment_method') return ['Efectivo', 'Tarjeta', 'Transferencia'];
      return original.apply(this, arguments);
    };
    try { return window.DATA.seedDemo(); } finally { cfg.codes = original; }
  });
  await page.reload({ waitUntil: 'load' });
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });

  const shot = async (name, locator) => {
    await page.waitForTimeout(300);
    const target = locator || page.locator('main');
    await target.screenshot({ path: join(out, `${name}.png`) });
    console.log(`captura ${name}`);
  };
  const go = async id => {
    await page.evaluate(next => localStorage.setItem('balam-page', next), id);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.App && window.DATA);
    const titles = { inventario: 'Inventario', config: 'Configuración', vendedores: 'Vendedores y comisiones' };
    if (titles[id]) await page.waitForFunction(t => document.querySelector('header h1')?.textContent.trim() === t, titles[id], { timeout: 20000 });
  };

  await page.getByTestId('inventory-new-product').click();
  await page.getByTestId('product-form').waitFor();
  await shot('01-nuevo-producto', page.getByTestId('product-form'));
  await page.getByTestId('product-size-category').selectOption({ index: 1 });
  const stockInputs = page.locator('[data-testid^="product-stock-"]');
  for (let i = 0; i < Math.min(5, await stockInputs.count()); i++) await stockInputs.nth(i).fill(String([10,20,35,15,8][i]));
  await shot('02-existencias', page.locator('[aria-labelledby="product-section-stock"]'));
  await shot('03-ornamento', page.locator('[aria-labelledby="product-section-ornament"]'));
  await page.getByTestId('product-exceptions-toggle').click();
  await shot('04-excepciones-talla', page.locator('[aria-labelledby="product-section-exceptions"]'));
  await shot('05-matriz-talla', page.getByTestId('product-size-summary'));
  await page.keyboard.press('Escape');

  await go('inventario');
  await shot('06-inventario-importar-exportar', page.locator('main'));
  const etiquetas = page.locator('button').filter({ hasText: /^Etiquetas$/ }).last();
  if (await etiquetas.count()) { await etiquetas.click(); await page.waitForTimeout(400); await shot('07-etiquetas', page.locator('main')); }

  await go('config');
  const vendCfg = page.locator('button').filter({ hasText: /Vendedores/ }).last();
  if (await vendCfg.count()) await vendCfg.click();
  await shot('08-config-comisiones', page.locator('main'));
  const usersCfg = page.locator('button').filter({ hasText: /Usuarios/ }).last();
  if (await usersCfg.count()) await usersCfg.click();
  await shot('09-ficha-vendedor', page.locator('main'));

  await go('vendedores');
  await shot('10-reporte-comisiones', page.locator('main'));
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
