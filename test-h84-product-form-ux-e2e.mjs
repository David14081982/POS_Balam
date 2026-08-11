// H-84: contrato UI/UX del formulario masivo. Supabase queda interceptado.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = path.resolve('.');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(resolve => server.listen(8855, '127.0.0.1', resolve));

let pass = 0, fail = 0; const pageErrors = [];
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  condition ? pass++ : fail++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto('http://127.0.0.1:8855/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.InventoryScreen, null, { timeout: 25000 });
  const fixture = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) {
      window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {};
      window.STORE.pushSale = () => {}; window.STORE.pushReturn = () => {}; window.STORE.pushExchange = () => {};
    }
    D.products.length = 0;
    const sizes = D.SIZES_LETRA.slice(0, 5).map(String);
    const [xs, s, m, l, xl] = sizes;
    const product = D.hydrate({
      id: 'h84-existing-product', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'MAO',
      modelo: 'H84', nombre: 'GUAYABERA H84 UX', orn: 'Bordado Eléctrico', ornColors: ['VI'],
      precio: 650, preciosTalla: { [s]: 725, [xl]: 700 }, costo: 200, pop: false,
      attrs: {
        __sizeCategoryId: 'size_letter',
        __ornamentColorsBySize: { [xs]: ['CF', 'OR'], [s]: ['CF', 'OR'], [l]: ['PL'], [xl]: ['PL'] },
      },
      sizeCategoryId: 'size_letter',
      stock: D.mkStock([10, 20, 30, 15, 12], []).filter(row => row.escala === 'L'),
    });
    D.products.push(product); D.saveProducts();
    localStorage.setItem('balam-page', 'inventario');
    return { sizes, stock: JSON.stringify(product.stock), price: product.precio, sku: product.sku };
  });
  const [XS, S, M, L, XL] = fixture.sizes;
  await page.reload({ waitUntil: 'load' });
  await page.getByTestId('inventory-product-h84-existing-product').click();
  await page.getByTestId('product-detail-edit').click();
  await page.getByTestId('product-form').waitFor();
  await page.waitForFunction(() => document.activeElement?.dataset?.testid === 'product-name', null, { timeout: 1500 }).catch(() => {});
  const initialFocus = await page.evaluate(() => ({ testid: document.activeElement?.dataset?.testid || '', tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim().slice(0, 30) }));
  check('1. edición abre el formulario único con foco inicial',
    initialFocus.testid === 'product-name', JSON.stringify(initialFocus));
  check('2. la existencia masiva conserva exactamente sus valores',
    JSON.stringify(await Promise.all(fixture.sizes.map(size => page.getByTestId(`product-stock-${size}`).inputValue()))) === JSON.stringify(['10', '20', '30', '15', '12']));
  check('3. la matriz muestra por defecto sólo tallas relevantes',
    await page.locator('[data-testid^="product-size-summary-row-"]').count() === 5);
  const xsSummary = await page.getByTestId(`product-size-summary-row-${XS}`).innerText();
  const lSummary = await page.getByTestId(`product-size-summary-row-${L}`).innerText();
  check('4. la matriz resuelve color y precio efectivos sin editar', xsSummary.includes('CF + OR') && xsSummary.includes('650'), xsSummary.replace(/\n/g, ' / '));
  check('5. la matriz muestra la excepción de otro grupo', lSummary.includes('PL') && lSummary.includes('650'), lSummary.replace(/\n/g, ' / '));
  await page.getByTestId('product-summary-show-all').click();
  const allRows = await page.locator('[data-testid^="product-size-summary-row-"]').count();
  check('6. Mostrar todas incluye tallas con existencia cero', allRows > 5 && await page.getByTestId('product-size-summary-row-2XL').isVisible(), String(allRows));

  await page.getByTestId('product-exceptions-toggle').click();
  const priceGroupCount = await page.locator('[data-testid^="price-group-"]').evaluateAll(nodes =>
    nodes.filter(node => /^price-group-\d+$/.test(node.dataset.testid || '')).length);
  check('7. reabrir edición reconstruye grupos múltiples compactados',
    await page.locator('[data-testid^="ornament-color-group-"]').count() === 2 &&
    priceGroupCount === 2);
  check('8. los grupos configurados no dejan catálogos editables siempre visibles',
    await page.locator('[data-testid^="ornament-group-"][data-testid*="-color-"]').count() === 0 &&
    await page.locator('[data-testid^="price-group-"][data-testid$="-value"]').count() === 0);

  await page.getByTestId('product-save').focus(); await page.keyboard.press('Tab');
  check('9. Tab queda atrapado dentro del modal',
    await page.evaluate(() => document.activeElement?.dataset?.testid === 'product-form-close'));
  await page.keyboard.press('Escape'); await page.getByTestId('product-form').waitFor({ state: 'detached' });
  check('10. Escape sin cambios cierra y restaura el foco',
    await page.evaluate(() => document.activeElement?.dataset?.testid === 'product-detail-edit'));

  await page.getByTestId('product-detail-edit').click();
  await page.getByTestId('product-general-price').fill('651');
  let dirtyText = '';
  page.once('dialog', async dialog => { dirtyText = dialog.message(); await dialog.dismiss(); });
  await page.getByTestId('product-cancel').click();
  check('11. cancelar con cambios advierte y permite continuar editando',
    /sin guardar/i.test(dirtyText) && await page.getByTestId('product-form').isVisible(), dirtyText);
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('product-cancel').click(); await page.getByTestId('product-form').waitFor({ state: 'detached' });
  const unchanged = await page.evaluate(() => {
    const p = window.DATA.products.find(item => item.id === 'h84-existing-product');
    return { price: p.precio, stock: JSON.stringify(p.stock), sku: p.sku };
  });
  check('12. descartar no altera precio, stock ni SKU', unchanged.price === fixture.price && unchanged.stock === fixture.stock && unchanged.sku === fixture.sku);

  await page.getByTestId('product-detail-edit').click();
  const category = page.getByTestId('product-size-category');
  const originalCategory = await category.inputValue();
  const otherCategory = await category.locator('option').evaluateAll((options, current) => options.map(x => x.value).find(value => value && value !== current), originalCategory);
  let categoryWarning = '';
  if (otherCategory) {
    page.once('dialog', async dialog => { categoryWarning = dialog.message(); await dialog.dismiss(); });
    await category.selectOption(otherCategory);
  }
  check('13. cambiar familia con stock/excepciones advierte antes de borrar',
    !otherCategory || (/eliminará/i.test(categoryWarning) && await category.inputValue() === originalCategory), categoryWarning || 'una sola familia configurada');
  await page.keyboard.press('Escape'); await page.getByTestId('product-form').waitFor({ state: 'detached' });
  await page.getByTestId('product-detail-close').click();

  await page.getByTestId('inventory-new-product').click();
  await page.getByTestId('product-save').click(); await page.waitForTimeout(250);
  check('14. el error aparece inline y lleva el foco al control responsable',
    await page.getByTestId('product-name').getAttribute('aria-invalid') === 'true' &&
    await page.evaluate(() => document.activeElement?.dataset?.testid === 'product-name'));

  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  const mobile = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="product-form"]');
    const body = document.querySelector('[data-testid="product-form-body"]');
    const rect = panel.getBoundingClientRect();
    return { width: rect.width, height: rect.height, overflow: body.scrollWidth - body.clientWidth };
  });
  check('15. responsive móvil ocupa la pantalla sin desbordamiento horizontal', mobile.width <= 390 && mobile.height <= 844 && mobile.overflow <= 1, JSON.stringify(mobile));
  check('16. una referencia V2 nueva captura exactamente una talla y un stock escalar',
    await page.getByTestId('product-reference-size').count() === 1
    && await page.getByTestId('product-reference-stock').count() === 1
    && await page.locator('[data-testid^="product-stock-"]').count() === 0);
  await page.getByTestId('product-cancel').click(); await page.setViewportSize({ width: 1440, height: 900 });

  check('17. Inventario permanece operativo', await page.getByTestId('inventory-new-product').isVisible());
  await page.getByRole('button', { name: /Punto de venta/i }).click(); await page.waitForTimeout(500);
  check('18. POS permanece operativo', await page.locator('button[title="Agregar"]').count() > 0);
  check('19. no hubo excepciones de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  await browser.close(); server.close();
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
