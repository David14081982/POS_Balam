// H-127 · Diagnóstico por etiqueta/talla sin modificar identidades.
// Fixtures sintéticos; no persiste, no sincroniza y no toca Supabase.
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
  const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
  await context.route(/supabase\.co/, route => route.abort());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.BARCODES && window.InventoryScreen);

  const mount = async phase => page.evaluate(phase => {
    const D = window.DATA;
    const v1 = (id, stock) => D.hydrate({
      id, recordModel: 'v1', sku: '5-PVC10---R/P-NA-VCLA-T', nombre: 'PVC10', modelo: 'PVC10',
      cat: '5', manga: '-', tela: 'R/P', color: 'VCLA', cuello: 'NA', orn: '—', precio: 590,
      attrs: { __sizeCategoryId: 'size_number' }, sizeCategoryId: 'size_number', stock,
    });
    const v2 = (id, family, barcodeCode, sku, name = 'VICTOR') => {
      const product = D.hydrate({
        id, recordModel: 'v2', referenceFamilyId: family, barcodeCode: barcodeCode || undefined,
        sku, nombre: name, modelo: name === 'VICTOR' ? 'VIC' : name, cat: '1', manga: 'ML', tela: 'ALG',
        color: 'BL', cuello: 'TRA', orn: '—', precio: 1250, attrs: { __sizeCategoryId: 'size_number' },
        sizeCategoryId: 'size_number', sizeCode: '40', sizeScale: 'N', stockQuantity: 1,
      });
      product.barcodeCode = barcodeCode;
      return product;
    };
    let rows;
    if (phase === 'base' || phase === 'ambiguous') {
      const primary = v1('h127-private-v1-primary', [
        { talla: '34', escala: 'N', stock: 2 }, { talla: '36', escala: 'N', stock: 1 },
      ]);
      const nearV2 = v2('00000000-0000-4000-8000-000000000127', 'h127-family-near',
        'B40728BF7CF1B48A', '1-VIC-ML-ALG-TRA-BL-40');
      rows = [primary, nearV2];
      if (phase === 'ambiguous') rows.push(v1('h127-private-v1-duplicate', [{ talla: '34', escala: 'N', stock: 1 }]));
    } else if (phase === 'errors') {
      rows = [
        v2('10000000-0000-4000-8000-000000000127', 'h127-family-invalid', 'Ā', 'SKU-INVALIDO', 'NO CODIFICABLE'),
        v2('20000000-0000-4000-8000-000000000127', 'h127-family-missing', '', 'SKU-SIN-BARCODE', 'SIN BARCODE'),
        v2('30000000-0000-4000-8000-000000000127', 'h127-family-custom', 'CUSTOM123', 'SKU-CUSTOM', 'CUSTOM'),
      ];
    } else {
      rows = [v2('40000000-0000-4000-8000-000000000127', 'h127-family-generation',
        'B1234567890ABCDE', 'SKU-GENERACION', 'GENERACION')];
      if (!window.__h127OriginalPng) window.__h127OriginalPng = window.BARCODES.toPNGDataURL;
      window.BARCODES.toPNGDataURL = () => '';
    }
    D.products.splice(0, D.products.length, ...rows);
    D.saveProducts = () => true;
    window.AUTH.canAccess = () => true;
    let host = document.getElementById('h127-root');
    if (!host) { document.body.innerHTML = '<div id="h127-root"></div>'; host = document.getElementById('h127-root'); }
    if (!window.__h127Root) window.__h127Root = ReactDOM.createRoot(host);
    window.__h127Root.render(React.createElement(window.InventoryScreen, { key: phase }));
  }, phase);

  await mount('base');
  await page.getByTestId('inventory-labels').click();
  await page.getByTestId('labels-copies-stock').click();
  const warning = page.getByTestId('labels-legibility-warning');
  const warningText = await warning.innerText();
  const nearText = await page.getByTestId('labels-density-near').innerText();
  const modalText = await page.getByTestId('label-modal').innerText();
  check('stock distingue tres etiquetas de dos códigos únicos', warningText.includes('3 etiqueta(s) · 2 código(s) único(s)'), warningText);
  check('el problema se lista por producto y talla sin UUID',
    warningText.includes('PVC10 · talla 34') && warningText.includes('PVC10 · talla 36')
      && !modalText.includes('h127-private-v1-primary'));
  check('la causa informa densidad, X, módulos y alto efectivo',
    warningText.includes('Densidad: X 0.199 mm') && warningText.includes('277 módulos') && warningText.includes('barras 6.0 mm'));
  check('V2 muestra SKU largo pero diagnostica el barcode logístico real',
    nearText.includes('SKU 1-VIC-ML-ALG-TRA-BL-40') && nearText.includes('Code128 B40728BF7CF1B48A')
      && nearText.includes('X 0.260 mm'));
  check('desaparecen la causa universal y la recomendación de alterar SKU',
    !modalText.includes('demasiado largos') && !modalText.includes('acorta el SKU'));
  await page.setViewportSize({ width: 360, height: 760 });
  const responsive = await page.getByTestId('label-modal').evaluate(node => ({
    body: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
    warningVisible: !!node.querySelector('[data-testid="labels-legibility-warning"]'),
  }));
  check('diagnóstico por talla permanece visible a 360 px sin overflow de página',
    responsive.warningVisible && responsive.body <= responsive.viewport + 1, JSON.stringify(responsive));
  await page.getByTestId('label-modal-close').click();

  await page.setViewportSize({ width: 1200, height: 850 });
  await mount('ambiguous');
  await page.getByTestId('inventory-labels').click();
  const ambiguousText = await page.getByTestId('labels-legibility-warning').innerText();
  check('ambigüedad se distingue de densidad y no elige una referencia',
    ambiguousText.includes('Ambigüedad:') && ambiguousText.includes('2 referencias') && ambiguousText.includes('Densidad:'));
  check('la lista ambigua tampoco muestra identidades técnicas',
    !ambiguousText.includes('h127-private-v1-primary') && !ambiguousText.includes('h127-private-v1-duplicate'));
  await page.getByTestId('label-modal-close').click();

  await mount('errors');
  await page.getByTestId('inventory-labels').click();
  const errorsText = await page.getByTestId('labels-legibility-warning').innerText();
  const anomalyNode = page.getByTestId('labels-barcode-anomaly');
  const anomalyText = await anomalyNode.count() ? await anomalyNode.innerText() : '';
  if (!anomalyText) console.log('Modal de errores:', await page.getByTestId('label-modal').innerText());
  check('faltante y no codificable tienen causas separadas',
    errorsText.includes('Falta el barcode logístico V2') && errorsText.includes('Codificación:'));
  check('barcode V2 personalizado codificable se informa como anomalía, no densidad',
    anomalyText.includes('CUSTOM123') && anomalyText.includes('barcode V2 personalizado') && !anomalyText.includes('Densidad:'));
  await page.getByTestId('label-modal-close').click();

  await mount('generation');
  await page.getByTestId('inventory-labels').click();
  const generationText = await page.getByTestId('labels-legibility-warning').innerText();
  check('fallo de PNG se distingue como error de generación',
    generationText.includes('Generación: no se pudo producir el PNG'));
  await page.evaluate(() => { window.BARCODES.toPNGDataURL = window.__h127OriginalPng; });
} finally {
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 5000))]);
  server.close();
}

console.log(`\nH-127 diagnóstico UI: ${passed}/${passed + failed}`);
process.exit(failed ? 1 : 0);
