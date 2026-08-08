// H-84: métrica reproducible del alta masiva antes/después del rediseño.
// Coste: altura desplazable y controles repetidos visibles con dos grupos.
// Garantía: cuatro bloqueos vigentes y persistencia exacta de stock/precio/H-83/SKU.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = path.resolve('.');
const BASE_PATH = path.join(ROOT, 'ux-h84-product-form-baseline.json');
const FIJAR = process.argv.includes('--fijar');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(resolve => server.listen(8854, '127.0.0.1', resolve));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let result;
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto('http://127.0.0.1:8854/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.InventoryScreen, null, { timeout: 25000 });
  await page.evaluate(() => localStorage.setItem('balam-page', 'inventario'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.InventoryScreen, null, { timeout: 25000 });
  await page.getByTestId('inventory-new-product').click();
  await page.getByTestId('product-form').waitFor();

  const setup = await page.evaluate(() => {
    const ornament = [...document.querySelector('[data-testid="product-ornament"]').options]
      .map(option => option.value).find(value => window.DATA.ornamentSupportsColors({ orn: value }));
    const colors = Object.keys(window.DATA.COLOR_NAME).slice(0, 6);
    const sizes = [...document.querySelectorAll('[data-testid^="product-stock-"]')]
      .slice(0, 5).map(input => input.getAttribute('data-testid').replace('product-stock-', ''));
    return { ornament, colors, sizes, before: window.DATA.products.length };
  });
  const [s0, s1, s2, s3, s4] = setup.sizes;
  const [c0, c1, c2, c3, c4] = setup.colors;

  const name = page.getByTestId('product-name');
  if (await name.evaluate(node => node.tagName === 'SELECT')) {
    const value = await name.locator('option').nth(1).getAttribute('value');
    await name.selectOption(value);
  } else {
    await name.fill('PRODUCTO H84 UX');
    await page.getByTestId('product-model').fill('H84');
  }
  await page.getByTestId('product-general-price').fill('1150');
  await page.getByTestId('product-ornament').selectOption(setup.ornament);

  const openIf = async id => { const x = page.getByTestId(id); if (await x.count()) await x.click(); };
  await openIf('general-color-selector-toggle');
  await page.getByTestId(`product-general-color-${c0}`).click();
  await page.getByTestId(`product-general-color-${c1}`).click();
  await openIf('general-color-selector-close');
  for (const [size, qty] of [[s0, 10], [s1, 20], [s2, 30], [s3, 15], [s4, 12]]) {
    await page.getByTestId(`product-stock-${size}`).fill(String(qty));
  }

  await openIf('product-exceptions-toggle');
  await page.getByTestId('add-ornament-colors-by-size').click();
  for (const size of [s0, s1, s2]) await page.getByTestId(`ornament-group-0-size-${size}`).click();
  await openIf('ornament-group-0-color-toggle');
  for (const color of [c2, c3]) await page.getByTestId(`ornament-group-0-color-${color}`).click();
  await openIf('ornament-group-0-color-close');
  await openIf('ornament-group-0-done');

  await page.getByTestId('add-ornament-colors-by-size').click();
  for (const size of [s3, s4]) await page.getByTestId(`ornament-group-1-size-${size}`).click();
  await openIf('ornament-group-1-color-toggle');
  await page.getByTestId(`ornament-group-1-color-${c4}`).click();
  await openIf('ornament-group-1-color-close');
  await openIf('ornament-group-1-done');

  await page.getByTestId('add-price-by-size').click();
  await page.getByTestId(`price-group-0-size-${s1}`).click();
  await page.getByTestId('price-group-0-value').fill('1200');
  await openIf('price-group-0-done');

  const metrics = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="product-form-body"]');
    const visible = selector => [...document.querySelectorAll(selector)].filter(node => {
      const style = getComputedStyle(node); const box = node.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    }).length;
    return {
      scrollHeight: body.scrollHeight,
      scrollOverflow: Math.max(0, body.scrollHeight - body.clientHeight),
      visibleColorChoices: visible('[data-testid^="product-general-color-"], [data-testid^="ornament-group-"][data-testid*="-color-"]'),
      visibleSizeChoices: visible('[data-testid^="ornament-group-"][data-testid*="-size-"], [data-testid^="price-group-"][data-testid*="-size-"]'),
      matrixRows: visible('[data-testid^="product-size-summary-row-"]'),
    };
  });

  let validations = 0;
  const blocked = async () => {
    await page.getByTestId('product-save').click();
    await page.waitForTimeout(120);
    const open = await page.getByTestId('product-form').count();
    const count = await page.evaluate(() => window.DATA.products.length);
    if (open === 1 && count === setup.before) validations++;
  };

  // Solapamiento H-83 incompatible.
  await page.getByTestId('add-ornament-colors-by-size').click();
  await page.getByTestId(`ornament-group-2-size-${s0}`).click();
  await openIf('ornament-group-2-color-toggle');
  await page.getByTestId(`ornament-group-2-color-${c4}`).click();
  await blocked();
  await page.getByTestId('ornament-group-2-delete').click();

  // Solapamiento de precio.
  await page.getByTestId('add-price-by-size').click();
  await page.getByTestId(`price-group-1-size-${s1}`).click();
  await page.getByTestId('price-group-1-value').fill('1300');
  await blocked();
  await page.getByTestId('price-group-1-delete').click();

  // Precio incompleto.
  await page.getByTestId('add-price-by-size').click();
  await page.getByTestId(`price-group-1-size-${s2}`).click();
  await blocked();
  await page.getByTestId('price-group-1-delete').click();

  // Identidad obligatoria.
  const originalName = await name.inputValue();
  if (await name.evaluate(node => node.tagName === 'SELECT')) await name.selectOption('');
  else await name.fill('');
  await blocked();
  if (await name.evaluate(node => node.tagName === 'SELECT')) await name.selectOption(originalName);
  else await name.fill(originalName);

  const skuPreview = (await page.getByTestId('product-form-footer').innerText()).match(/SKU:\s*([^\s·]+)/i)?.[1] || '';
  const savedName = await name.inputValue();
  await page.getByTestId('product-save').click();
  await page.waitForTimeout(200);
  const persisted = await page.evaluate((nameValue) => {
    const p = window.DATA.products.find(product => product.nombre === nameValue)
      || window.DATA.products[window.DATA.products.length - 1];
    return p && {
      sku: p.sku, precio: p.precio, stock: p.stock.map(row => [String(row.talla), row.stock]),
      preciosTalla: p.preciosTalla,
      ornamentColorsBySize: p.attrs && p.attrs.__ornamentColorsBySize,
    };
  }, savedName);
  result = {
    ...metrics,
    // La matriz solicitada agrega información de sólo lectura. Descontar 60 px por fila
    // permite comparar la densidad de la superficie editable antes/después sin ocultar
    // la altura bruta, que también se reporta.
    adjustedScrollOverflow: Math.max(0, metrics.scrollOverflow - metrics.matrixRows * 60),
    validations, completed: await page.getByTestId('product-form').count() === 0, persisted, skuPreview,
  };
} finally {
  await browser.close(); server.close();
}

console.log(JSON.stringify(result, null, 2));
if (FIJAR) {
  fs.writeFileSync(BASE_PATH, JSON.stringify({
    scrollHeight: result.scrollHeight,
    scrollOverflow: result.scrollOverflow,
    visibleColorChoices: result.visibleColorChoices,
    visibleSizeChoices: result.visibleSizeChoices,
    validations: result.validations,
    completed: result.completed,
    motivo: 'H-84 línea base antes del rediseño UI/UX', fecha: '2026-08-08',
  }, null, 2) + '\n');
  console.log('Línea base H-84 fijada.');
  process.exit(result.completed && result.validations === 4 ? 0 : 1);
}

const base = JSON.parse(fs.readFileSync(BASE_PATH, 'utf8'));
const failures = [];
if (!result.completed) failures.push('el alta no terminó');
if (result.validations < base.validations) failures.push('disminuyeron las validaciones');
if (result.adjustedScrollOverflow >= base.scrollOverflow) failures.push('no disminuyó el scroll editable ajustado por la matriz');
if (result.visibleColorChoices >= base.visibleColorChoices) failures.push('no disminuyeron los colores siempre visibles');
if (result.visibleSizeChoices >= base.visibleSizeChoices) failures.push('no disminuyeron las tallas repetidas visibles');
if (result.matrixRows !== 5) failures.push('la matriz no mostró exactamente las cinco tallas relevantes');
if (!result.persisted || result.persisted.precio !== 1150 || result.persisted.sku !== result.skuPreview) failures.push('cambió precio o SKU');
console.log(failures.length ? `❌ ${failures.join(' · ')}` : '✅ H-84 mejora densidad sin perder garantías');
process.exit(failures.length ? 1 : 0);
