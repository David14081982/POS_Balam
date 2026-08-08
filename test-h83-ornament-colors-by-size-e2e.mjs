// H-83: flujo real sobre el bundle publicado localmente.
// Supabase queda interceptado; no escribe datos externos.
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
await new Promise(resolve => server.listen(8823, '127.0.0.1', resolve));

let pass = 0, fail = 0; const errors = [];
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  condition ? pass++ : fail++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });
  page.on('pageerror', error => errors.push(String(error)));
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto('http://127.0.0.1:8823/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.InventoryScreen, null, { timeout: 25000 });

  const fixture = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) {
      window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {};
      window.STORE.pushSale = () => {}; window.STORE.pushReturn = () => {};
      window.STORE.pushExchange = () => {};
    }
    D.products.length = 0;
    const sizes = D.SIZES_LETRA.slice(0, 5).map(String);
    const product = D.hydrate({
      id: 'h83-e2e-product', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'MAO',
      modelo: 'H83', nombre: 'GUAYABERA H83 DOS GRUPOS', orn: 'Bordado Eléctrico',
      ornColors: ['VI'], precio: 650, preciosTalla: {}, costo: 200, pop: false,
      attrs: { __sizeCategoryId: 'size_letter' }, sizeCategoryId: 'size_letter',
      stock: D.mkStock([10, 20, 30, 15, 12], []).filter(row => row.escala === 'L'),
    });
    D.products.push(product); D.saveProducts();
    return { sizes, stock: JSON.stringify(product.stock), precio: product.precio, sku: product.sku };
  });
  const [XS, S, M, L, XL] = fixture.sizes;

  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find(x => /Inventario/.test(x.innerText));
    if (button) button.click();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll('td')].find(x => /GUAYABERA H83 DOS GRUPOS/.test(x.innerText));
    if (cell) cell.click();
  });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /Editar producto/i }).click();
  await page.getByTestId('product-exceptions-toggle').click();
  await page.waitForSelector('[data-testid="ornament-colors-by-size"]');

  check('1. el alta/edición muestra el tercer mecanismo agrupado',
    await page.locator('[data-testid="ornament-colors-by-size"]').isVisible());
  check('2. un producto sin especiales inicia con cero grupos',
    await page.locator('[data-testid^="ornament-color-group-"]').count() === 0);

  await page.getByTestId('add-ornament-colors-by-size').click();
  for (const size of [XS, S, M]) await page.getByTestId(`ornament-group-0-size-${size}`).click();
  await page.getByTestId('ornament-group-0-color-toggle').click();
  for (const color of ['OR', 'CF']) await page.getByTestId(`ornament-group-0-color-${color}`).click();
  await page.getByTestId('ornament-group-0-color-close').click();
  await page.getByTestId('add-ornament-colors-by-size').click();
  for (const size of [L, XL]) await page.getByTestId(`ornament-group-1-size-${size}`).click();
  await page.getByTestId('ornament-group-1-color-toggle').click();
  await page.getByTestId('ornament-group-1-color-PL').click();

  const summaries = await page.locator('[data-testid^="ornament-color-group-"]').allInnerTexts();
  check('3. un grupo aplica a varias tallas', summaries[0].includes(XS) && summaries[0].includes(S) && summaries[0].includes(M), summaries[0]);
  check('4. varios grupos conviven y muestran sus códigos canónicos', summaries[1].includes(L) && summaries[1].includes(XL) && summaries[1].includes('PL'), summaries[1]);

  await page.getByRole('button', { name: /Guardar cambios/i }).click();
  await page.waitForTimeout(700);
  const saved = await page.evaluate(() => {
    const p = window.DATA.products.find(x => x.id === 'h83-e2e-product');
    return {
      map: p.attrs.__ornamentColorsBySize,
      stock: JSON.stringify(p.stock), precio: p.precio, sku: p.sku,
      persisted: localStorage.getItem('balam_pos_products_v2') || '',
    };
  });
  const expected = { [XS]: ['CF', 'OR'], [S]: ['CF', 'OR'], [M]: ['CF', 'OR'], [L]: ['PL'], [XL]: ['PL'] };
  // El orden esperado se toma del catálogo vivo, no se codifica en la UI.
  const canonicalExpected = await page.evaluate(expectedMap => {
    const p = window.DATA.products.find(x => x.id === 'h83-e2e-product');
    return window.DATA.sanitizeOrnamentColorsBySize(expectedMap, p);
  }, expected);
  check('5. guardar conserva exactamente talla → códigos', JSON.stringify(saved.map) === JSON.stringify(canonicalExpected), JSON.stringify(saved.map));
  check('6. no cambia stock', saved.stock === fixture.stock);
  check('7. no cambia precio', saved.precio === fixture.precio);
  check('8. no cambia SKU', saved.sku === fixture.sku);
  check('9. la persistencia local contiene el mapa reservado', saved.persisted.includes('__ornamentColorsBySize'));

  // Reabrir: el mapa canónico vuelve a dos filas agrupadas.
  await page.evaluate(() => {
    const cell = [...document.querySelectorAll('td')].find(x => /GUAYABERA H83 DOS GRUPOS/.test(x.innerText));
    if (cell) cell.click();
  });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Editar producto/i }).click();
  await page.getByTestId('product-exceptions-toggle').click();
  await page.waitForSelector('[data-testid="ornament-color-group-1"]');
  check('10. editar y volver a abrir reconstruye los dos grupos',
    await page.locator('[data-testid^="ornament-color-group-"]').count() === 2);

  // Solapamiento incompatible: XS ya usa OR+CF y se intenta asignar PL.
  await page.getByTestId('add-ornament-colors-by-size').click();
  await page.getByTestId(`ornament-group-2-size-${XS}`).click();
  await page.getByTestId('ornament-group-2-color-toggle').click();
  await page.getByTestId('ornament-group-2-color-PL').click();
  await page.getByRole('button', { name: /Guardar cambios/i }).click();
  await page.waitForTimeout(350);
  check('11. un solapamiento incompatible bloquea el guardado y nombra los grupos',
    /colores incompatibles en los grupos/i.test(await page.locator('body').innerText()));
  check('12. el bloqueo no aplicó último gana',
    await page.locator('[data-testid="ornament-color-group-2"]').isVisible());
  await page.getByTestId('ornament-group-2-delete').click();
  const ornamentSelect = page.locator('label').filter({ hasText: /^Ornamento$/i }).locator('..').locator('select');
  await ornamentSelect.selectOption('Alforza');
  check('13. un ornamento que no admite colores oculta el bloque',
    await page.locator('[data-testid="ornament-colors-by-size"]').count() === 0);
  await ornamentSelect.selectOption('Bordado Eléctrico');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: /^Cancelar$/i }).click();

  // POS: la talla muestra el resultado de DATA.effectiveOrnamentColors.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('nav button')].find(x => /Punto de venta/i.test(x.innerText));
    if (button) button.click();
  });
  await page.waitForTimeout(800);
  await page.locator('button[title="Agregar"]').click();
  await page.waitForSelector(`[data-testid="effective-ornament-colors-${XS}"]`);
  const posColors = await page.evaluate(sizes => Object.fromEntries(sizes.map(size => {
    const node = document.querySelector(`[data-testid="effective-ornament-colors-${size}"]`);
    return [size, node ? node.textContent.trim() : ''];
  })), [XS, L]);
  check('14. POS obtiene los colores efectivos correctos del grupo 1', posColors[XS] === canonicalExpected[XS].join(' + '), posColors[XS]);
  check('15. POS obtiene los colores efectivos correctos del grupo 2', posColors[L] === canonicalExpected[L].join(' + '), posColors[L]);

  const documentSnapshot = await page.evaluate(size => {
    const D = window.DATA, p = D.products.find(x => x.id === 'h83-e2e-product');
    const sale = D.recordSale({ ticket: [{ p, talla: size, qty: 1 }], sellerIds: [], client: null,
      metodo: 'Efectivo', estado: 'Pagado', itemCount: 1 });
    const frozen = JSON.stringify(sale.lineas[0].ornColors);
    p.attrs.__ornamentColorsBySize[size] = ['PL'];
    return { frozen, afterEdit: JSON.stringify(sale.lineas[0].ornColors), ornament: sale.lineas[0].ornamento };
  }, XS);
  check('16. el documento congela el ornamento y colores usados',
    documentSnapshot.ornament === 'Bordado Eléctrico'
      && documentSnapshot.frozen === JSON.stringify(canonicalExpected[XS])
      && documentSnapshot.afterEdit === documentSnapshot.frozen, JSON.stringify(documentSnapshot));
  check('17. no hubo excepciones de página', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close(); server.close();
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
