// H-99 · Contrato visual 60×40 con referencias V2 sintéticas. No persiste ni
// sincroniza productos y no modifica barcode_code, SKU, precio o stock.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve('.');
const evidence = resolve('.evidence-label-visual');
const artifactPath = process.env.BALAM_ARTIFACT_PATH ? resolve(process.env.BALAM_ARTIFACT_PATH) : null;
await mkdir(evidence, { recursive: true });
const server = createServer((request, response) => {
  let pathname = decodeURIComponent(request.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const file = pathname === '/index.html' && artifactPath ? artifactPath : join(root, pathname);
  if (!file.startsWith(root) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const testUrl = `http://127.0.0.1:${server.address().port}/`;

let passed = 0, failed = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? passed++ : failed++;
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 850 }, deviceScaleFactor: 2 });
  await context.route(/supabase\.co/, route => route.abort());
  const page = await context.newPage();
  await page.goto(testUrl, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.BARCODES && window.InventoryScreen);
  const fixtures = await page.evaluate(() => {
    const D = window.DATA;
    const rows = [
      ['short', '21-ADR-40', 'B000000000000991'],
      ['typical', '21-ADR-ML-ALG-BL-40', 'B000000000000992'],
      ['long', '21-ADR-ML-ALG-BL-MAO-DRO-REG-CARACTERISTICA-40', 'B000000000000993'],
    ].map(([kind, sku, barcodeCode], index) => D.hydrate({
      id: `h99-${kind}`, recordModel: 'v2', barcodeCode, sku,
      nombre: 'ADRIANO', modelo: 'ADR', cat: '21', manga: 'ML', tela: 'ALG',
      color: 'BL', cuello: 'MAO', orn: '—', ornColors: [], ornamentColorCodes: [],
      precio: 1150, costo: 400, stockQuantity: 1, sizeCode: '40', sizeScale: 'N',
      sizeCategoryId: 'size_number', attrs: { __sizeCategoryId: 'size_number' }, stock: [],
      physicalSignature: `H99|${index}`, physicalIdentityLocked: true,
    }));
    D.products.splice(0, D.products.length, ...rows);
    D.saveProducts = () => true;
    window.AUTH.canAccess = () => true;
    document.body.innerHTML = '<div id="h99-root"></div>';
    ReactDOM.createRoot(document.getElementById('h99-root')).render(React.createElement(window.InventoryScreen));
    return rows.map(row => ({ id: row.id, sku: row.sku, barcodeCode: row.barcodeCode }));
  });

  const measurements = [];
  for (const fixture of fixtures) {
    await page.getByTestId(`inventory-product-${fixture.id}`).click();
    await page.getByTestId('product-detail-labels').click();
    const unifiedPreview = page.getByTestId('label-preview-stage').first().locator('.bx-label');
    const legacyPreview = page.getByTestId('label-preview-barcode').first().locator('..');
    const previewLabel = await unifiedPreview.count() ? unifiedPreview : legacyPreview;
    await previewLabel.screenshot({ path: resolve(evidence, `preview-${fixture.id}.png`) });
    const previewResult = await previewLabel.evaluate(node => {
      const unified = node.classList.contains('bx-label');
      const part = (selector, index) => unified ? node.querySelector(selector) : node.children[index];
      const rect = (selector, index) => part(selector, index).getBoundingClientRect();
      const font = (selector, index) => parseFloat(part(selector, index).getAttribute('data-font-pt')) * 96 / 72;
      const geometry = selector => {
        const element = node.querySelector(selector);
        return ['x', 'y', 'width', 'height', 'data-font-pt'].map(name => element.getAttribute(name));
      };
      return {
        label: node.getBoundingClientRect(),
        name: rect('.bx-name', 0), barcode: rect('.bx-img', 1), sku: rect('.bx-meta', 2), price: rect('.bx-price', 3),
        fonts: { name: font('.bx-name', 0), sku: font('.bx-meta', 2), price: font('.bx-price', 3) },
        geometry: ['.bx-name', '.bx-img', '.bx-meta', '.bx-price'].map(geometry),
      };
    });
    const popupPromise = context.waitForEvent('page');
    await page.getByTestId('labels-open-printable').click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    const label = popup.locator('.bx-label').first();
    await label.screenshot({ path: resolve(evidence, `etiqueta-${fixture.id}.png`) });
    const result = await label.evaluate((node, expected) => {
      const q = selector => node.querySelector(selector);
      const px = selector => parseFloat(q(selector).getAttribute('data-font-pt')) * 96 / 72;
      const rect = selector => q(selector).getBoundingClientRect();
      const labelRect = node.getBoundingClientRect();
      const sku = q('.bx-meta');
      const barcode = q('.bx-img');
      const geometry = selector => ['x', 'y', 'width', 'height', 'data-font-pt'].map(name => q(selector).getAttribute(name));
      return {
        expected,
        text: node.innerText,
        namePx: px('.bx-name'), skuPx: px('.bx-meta'), pricePx: px('.bx-price'),
        label: { x: labelRect.x, y: labelRect.y, width: labelRect.width, height: labelRect.height },
        name: rect('.bx-name'), barcode: rect('.bx-img'), sku: rect('.bx-meta'), price: rect('.bx-price'),
        skuLines: getComputedStyle(sku).whiteSpace === 'nowrap' ? 1 : 2,
        skuOverflow: rect('.bx-meta').width > labelRect.width * 56 / 60 + 1,
        barcodeTextVisible: node.innerText.includes(expected.barcodeCode),
        technicalIdVisible: node.innerText.includes(expected.id),
        geometry: ['.bx-name', '.bx-img', '.bx-meta', '.bx-price'].map(geometry),
      };
    }, fixture);
    measurements.push({ ...result, preview: previewResult });
    await popup.close();
    await page.getByTestId('label-modal-close').click();
    await page.getByTestId('product-detail-close').click();
  }

  const typical = measurements.find(item => item.expected.id === 'h99-typical');
  const short = measurements.find(item => item.expected.id === 'h99-short');
  const long = measurements.find(item => item.expected.id === 'h99-long');
  check('etiqueta conserva proporción física 60×40', Math.abs(typical.label.width / typical.label.height - 1.5) < 0.02,
    `${typical.label.width.toFixed(1)}×${typical.label.height.toFixed(1)} px`);
  check('nombre recupera presencia visual', typical.namePx >= 18, `${typical.namePx}px`);
  check('precio vuelve a ser dominante', typical.pricePx >= 25 && typical.pricePx > typical.skuPx * 1.35,
    `precio ${typical.pricePx}px · SKU ${typical.skuPx}px`);
  check('SKU corto usa mayor tipografía que SKU largo', short.skuPx > long.skuPx,
    `corto ${short.skuPx}px · largo ${long.skuPx}px`);
  check('SKU largo cabe en una línea sin truncarse', long.skuLines === 1 && !long.skuOverflow && long.text.includes(long.expected.sku),
    `líneas ${long.skuLines} · overflow ${long.skuOverflow}`);
  check('precio no se reduce por SKU largo', long.pricePx === short.pricePx, `${short.pricePx}px / ${long.pricePx}px`);
  check('barcode conserva protagonismo y quiet zones', typical.barcode.width >= typical.label.width * 0.88 && typical.barcode.height >= 55,
    `${typical.barcode.width.toFixed(1)}×${typical.barcode.height.toFixed(1)} px`);
  check('barcode_code e identidad técnica permanecen ocultos', measurements.every(item => !item.barcodeTextVisible && !item.technicalIdVisible));
  check('orden vertical es nombre, barcode, SKU, precio', measurements.every(item =>
    item.name.bottom <= item.barcode.top && item.barcode.bottom <= item.sku.top && item.sku.bottom <= item.price.top));
  check('preview e impresión comparten proporción 60×40', measurements.every(item =>
    Math.abs(item.preview.label.width / item.preview.label.height - item.label.width / item.label.height) < 0.002));
  check('preview e impresión conservan posiciones relativas idénticas', measurements.every(item =>
    JSON.stringify(item.preview.geometry) === JSON.stringify(item.geometry)));
  check('preview e impresión usan la misma jerarquía tipográfica', measurements.every(item =>
    Math.abs(item.preview.fonts.name / item.namePx - 1) < 0.002 &&
    Math.abs(item.preview.fonts.sku / item.skuPx - 1) < 0.002 &&
    Math.abs(item.preview.fonts.price / item.pricePx - 1) < 0.002));
  console.log(JSON.stringify(measurements, null, 2));
} finally {
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 5000))]);
  server.close();
}
console.log(`\nH-99 etiqueta visual: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed ? 1 : 0);
