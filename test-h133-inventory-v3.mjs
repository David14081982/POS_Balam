// H-133 · BARCODE CONTRACT V3 y consumo repetido de una referencia, no de una unidad serial.
// Fixture aislado sobre el bundle productivo; no usa red ni modifica Supabase.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve('.');
const server = createServer((request, response) => {
  let pathname = decodeURIComponent(request.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const file = join(root, pathname);
  if (!file.startsWith(root) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));

let passed = 0, failed = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? passed++ : failed++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(/supabase\.co/, route => route.abort());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.BARCODES?.ready() && window.POSScreen);

  const fixture = await page.evaluate(() => {
    const D = window.DATA, B = window.BARCODES;
    const id = '010f9ebc-764c-4b7f-9094-c5d7da9dbcdc';
    const oldBarcode = '20000000000001';
    const barcode = D.barcodeFromId(id);
    const product = D.hydrate({
      id, recordModel: 'v2', referenceFamilyId: '010f9ebc-764c-4b7f-9094-c5d7da9dbcdd',
      barcodeCode: barcode, barcodeContract: 3, barcodeAliases: [oldBarcode],
      sku: '1-ANG-MC-AJSP-TRA-BL-38', nombre: 'ANGEL', modelo: 'ANG', cat: '1',
      manga: 'MC', tela: 'AJSP', color: 'BL', cuello: 'TRA', orn: '—', precio: 950,
      attrs: { __sizeCategoryId: 'size_number' }, sizeCategoryId: 'size_number',
      sizeCode: '38', sizeScale: 'N', stockQuantity: 10, physicalIdentityLocked: true,
    });
    D.products.splice(0, D.products.length, product);
    window.CONFIG.get = key => key === 'pos.validateStock' ? true : null;
    document.body.innerHTML = '<div id="h133-toasts"></div><div id="h133-root"></div>';
    ReactDOM.createRoot(document.getElementById('h133-toasts')).render(React.createElement(window.UI.ToastHost));
    ReactDOM.createRoot(document.getElementById('h133-root')).render(
      React.createElement(window.POSScreen, { layout: 'side', catalogView: 'grid' })
    );
    const physical = B.inspectLabelCode(barcode);
    const current = B.resolve(barcode);
    const alias = B.resolve(oldBarcode);
    return {
      id, barcode, oldBarcode,
      physical,
      currentId: current.ok && current.hit.productId,
      aliasId: alias.ok && alias.hit.productId,
      aliasFlag: alias.ok && alias.hit.alias,
      certified: B.certifySellableReference(product, '38'),
    };
  });

  check('el vector UUID produce el barcode V3 determinista de 26 dígitos',
    fixture.barcode === '30356530640881953395293404');
  check('Code128 usa pares numéricos compatibles con Code Set C', /^3[0-9]{25}$/.test(fixture.barcode));
  check('la etiqueta 60×40 queda OK con X >= 0.275 mm',
    fixture.physical.status === 'OK' && fixture.physical.moduleMm >= 0.275,
    `X=${fixture.physical.moduleMm.toFixed(6)} mm · ${fixture.physical.modules} módulos`);
  check('barcode actual y alias histórico resuelven al mismo products.id exacto',
    fixture.currentId === fixture.id && fixture.aliasId === fixture.id && fixture.aliasFlag === true);
  check('la referencia completa certifica barcode, etiqueta y talla exactos',
    fixture.certified.ok && fixture.certified.resolvedSize === '38');

  const input = page.getByTestId('pos-barcode-input');
  for (let scan = 1; scan <= 10; scan++) {
    await input.fill(fixture.barcode);
    await input.press('Enter');
  }
  const line = page.getByTestId(`ticket-line-${fixture.id}`);
  await line.waitFor();
  const tenText = await line.innerText();
  check('diez escaneos del mismo barcode agregan diez piezas de la misma referencia',
    /\b10\b/.test(tenText), tenText.replace(/\s+/g, ' '));

  await input.fill(fixture.barcode);
  await input.press('Enter');
  await page.getByTestId('toast').filter({ hasText: 'Sin stock' }).waitFor();
  const elevenText = await line.innerText();
  check('el escaneo once responde SIN EXISTENCIA y no consume la identidad',
    /\b10\b/.test(elevenText) && (await page.getByTestId('toast').filter({ hasText: 'Sin stock' }).count()) > 0);
  const afterZero = await page.evaluate(code => window.BARCODES.resolve(code), fixture.barcode);
  check('el barcode sigue resolviendo después de agotar las diez piezas',
    afterZero.ok && afterZero.hit.productId === fixture.id);
} finally {
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 5000))]);
  server.close();
}

console.log(`\nH-133 inventario V3: ${passed}/${passed + failed}`);
process.exit(failed ? 1 : 0);
