// H-111 · BALAM QA del POS V1/V2 y preservación de products.id.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.'), evidence = resolve('.evidence-h111'); mkdirSync(evidence, { recursive: true });
const artifact = process.env.BALAM_ARTIFACT_PATH ? resolve(process.env.BALAM_ARTIFACT_PATH) : resolve(root, 'index.html');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => { const relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html'; const path = relative === 'index.html' ? artifact : resolve(root, relative); if (relative !== 'index.html' && !path.startsWith(root)) { res.writeHead(403); res.end(); return; } res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }); createReadStream(path).on('error', () => { res.writeHead(404); res.end(); }).pipe(res); });
await new Promise(done => server.listen(8917, '127.0.0.1', done));
let pass = 0, fail = 0; const ok = (name, value, detail = '') => { console.log(`${value ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`); value ? pass++ : fail++; }; let browser;

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('balam-page', 'pos'));
  await page.goto('http://127.0.0.1:8917/index.html'); await page.waitForFunction(() => window.DATA && window.CONFIG);
  const fixture = await page.evaluate(() => {
    const D = window.DATA;
    const legacy = { id: '11100000-0000-4000-8000-000000000101', recordModel: 'v1', cat: '1', modelo: 'VIC', nombre: 'H111 V1',
      manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'TRA', orn: 'BEL', ornColors: ['DRO'], precio: 990, costo: 0, pop: false,
      sku: 'H111-V1', imagen: '', attrs: { producto: 'VIC', corte: '-', caracteristicas: '66', __sizeCategoryId: 'size_letter' },
      stock: [{ talla: 'M', escala: 'L', stock: 4 }], preciosTalla: { M: 990 } };
    const rows = [legacy];
    const make = (familyId, name, specs) => { const family = []; for (const spec of specs) family.push(D.createReference({
      id: spec.id, referenceFamilyId: familyId, cat: '1', modelo: 'VIC', nombre: name, manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'TRA', orn: 'BEL',
      sizeCategoryId: 'size_number', sizeCode: spec.size, sizeScale: 'N', stockQuantity: spec.stock, precio: spec.price,
      ornamentColorCodes: [spec.color], attrs: { producto: 'VIC', corte: '-', caracteristicas: '66' },
    }, family)); rows.push(...family); return D.referenceFamilyProjection(familyId, family); };
    const simpleId = '11100000-0000-4000-8000-000000000201', complexId = '11100000-0000-4000-8000-000000000202';
    const simple = make(simpleId, 'H111 V2 SIMPLE', [
      { id: 'a1100000-0000-4000-8000-000000000211', size: '38', stock: 4, price: 1150, color: 'DRO' },
      { id: 'b1100000-0000-4000-8000-000000000212', size: '40', stock: 3, price: 1250, color: 'DRO' },
    ]);
    const complex = make(complexId, 'H111 V2 COMPLEJA', [
      { id: 'c1100000-0000-4000-8000-000000000221', size: '40', stock: 3, price: 1150, color: 'DRO' },
      { id: 'd1100000-0000-4000-8000-000000000222', size: '40', stock: 2, price: 1250, color: 'AZL' },
      { id: 'e1100000-0000-4000-8000-000000000223', size: '40', stock: 0, price: 1350, color: 'NEG' },
    ]);
    localStorage.setItem('balam_pos_products_v2', JSON.stringify(rows));
    localStorage.setItem('balam_pos_sellers_v1', JSON.stringify([{ id: 'h111-seller', nombre: 'Venta H111', iniciales: 'VH', color: '#131B2E', role: 'vendedor', active: true, _deletedAt: null }]));
    return { legacyId: legacy.id, simpleId, simple38Id: simple.references.find(row => row.sizeCode === '38').id, simple38Key: simple.sizeGroups.find(group => group.sizeCode === '38').key,
      complexId, complex40Key: complex.sizeGroups[0].key, goldId: complex.references.find(row => row.ornamentColorCodes.includes('DRO')).id,
      blueId: complex.references.find(row => row.ornamentColorCodes.includes('AZL')).id, zeroId: complex.references.find(row => row.stockQuantity === 0).id,
      sellerId: 'h111-seller' };
  });
  await page.reload();

  // A · V1 conserva el recorrido y la forma existentes.
  const legacyState = await page.evaluate(id => { const row = window.DATA.products.find(product => product.id === id); return row && { stock: window.DATA.totalStock(row), sizes: window.DATA.resolveProductSizes(row).sizes.filter(size => size.stock > 0).map(size => size.sizeId) }; }, fixture.legacyId);
  ok('A0. fixture V1 conserva stock y talla resolubles', legacyState && legacyState.stock === 4 && legacyState.sizes.length === 1, JSON.stringify(legacyState));
  await page.getByTestId('pos-product-' + fixture.legacyId).click();
  const legacyDialog = page.getByTestId('pos-size-picker'); await legacyDialog.waitFor();
  ok('A1. V1 conserva “Selecciona talla”', await legacyDialog.isVisible());
  ok('A2. V1 no recibe controles familiares', await legacyDialog.getByTestId('family-size-picker').count() === 0);
  await legacyDialog.getByTestId('legacy-size-pick-M').click();
  ok('A3. carrito V1 conserva products.id exacto', await page.getByTestId('ticket-line-' + fixture.legacyId).count() === 1);
  await page.reload();

  // B · familia V2 simple: una talla implica una referencia física exacta.
  await page.getByTestId('pos-product-family:' + fixture.simpleId).click();
  const simpleDialog = page.getByTestId('pos-family-size-picker'); await simpleDialog.waitFor();
  ok('B1. V2 simple usa el mismo primer nivel comercial', /Tallas disponibles/i.test(await simpleDialog.innerText()));
  await simpleDialog.getByTestId('family-size-pick-' + fixture.simple38Key).click();
  ok('B2. una talla simple agrega su products.id exacto', await page.getByTestId('ticket-line-' + fixture.simple38Id).count() === 1);
  await page.reload();

  // C · familia compleja: stock agregado primero y variante humana después.
  await page.getByTestId('pos-product-family:' + fixture.complexId).click();
  const sizeDialog = page.getByTestId('pos-family-size-picker'); await sizeDialog.waitFor();
  const sizeText = await sizeDialog.innerText();
  ok('C1. talla 40 muestra stock agregado positivo', /40[\s\S]*5 pz/.test(sizeText), sizeText.replace(/\n/g, ' | '));
  ok('C2. agotada no contamina precio/rango disponible', !sizeText.includes('1,350'));
  await sizeDialog.getByTestId('family-size-pick-' + fixture.complex40Key).click();
  const variantDialog = page.getByTestId('pos-family-variant-picker'); await variantDialog.waitFor();
  const variantText = await variantDialog.innerText();
  ok('C3. variantes muestran etiquetas humanas, stock y precio exactos', /Dorado/i.test(variantText) && /Azul/i.test(variantText) && /3 pz/.test(variantText) && /2 pz/.test(variantText));
  ok('C4. segundo nivel no expone UUID, SKU ni referencia agotada', !variantText.includes(fixture.goldId) && !variantText.includes(fixture.zeroId) && !/SKU|NEG|1,350/i.test(variantText));
  await variantDialog.getByTestId('family-variant-pick-' + fixture.blueId).click();
  ok('C5. carrito conserva la variante products.id exacta', await page.getByTestId('ticket-line-' + fixture.blueId).count() === 1);

  // Venta real por interfaz: el renglón persistido conserva el mismo products.id.
  await page.getByRole('button', { name: /Completar venta/i }).click();
  await page.getByTestId('checkout-recibido').fill('2000'); await page.getByTestId('checkout-confirmar').click();
  await page.getByTestId('seller-pick-' + fixture.sellerId).click(); await page.getByTestId('seller-pick-confirm').click();
  await page.getByText('Venta exitosa', { exact: true }).waitFor();
  const soldIdentity = await page.evaluate(id => { const sale = window.DATA.sales.at(-1); return { productId: sale.lineas[0].productId, stock: window.DATA.products.find(row => row.id === id).stockQuantity }; }, fixture.blueId);
  ok('C6. venta persiste products.id exacto y descuenta esa referencia', soldIdentity.productId === fixture.blueId && soldIdentity.stock === 1, JSON.stringify(soldIdentity));

  // BALAM QA responsive del flujo complejo equivalente.
  for (const width of [320, 360, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 850 }); await page.reload();
    await page.getByTestId('pos-product-family:' + fixture.complexId).click();
    await page.getByTestId('family-size-pick-' + fixture.complex40Key).click();
    const dialog = page.getByTestId('pos-family-variant-picker'); await dialog.waitFor();
    const layout = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
    ok(`QA ${width}px sin overflow horizontal`, layout.document <= layout.viewport, JSON.stringify(layout));
    await page.screenshot({ path: resolve(evidence, `pos-v2-variantes-${width}.png`), fullPage: true });
  }
  ok('QA sin errores de página', errors.length === 0, errors.join(' | '));
} finally { if (browser) await browser.close(); await new Promise(done => server.close(done)); }
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`); process.exit(fail ? 1 : 0);
