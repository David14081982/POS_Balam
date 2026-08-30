// H-128 · BALAM QA visual/functional sobre etiquetas sintéticas V1/V2.
// No persiste, no sincroniza y no imprime; las capturas se guardan fuera del repo.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const evidenceDir = resolve(process.argv[2] || '.evidence-h128-qa');
await mkdir(evidenceDir, { recursive: true });
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let remoteRequests = 0;
  let commercialWrites = 0;
  await context.route(/supabase\.co/, route => {
    remoteRequests++;
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method())
      && /\/(rest\/v1|rpc|storage\/v1)\//.test(request.url())) commercialWrites++;
    route.abort();
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.BARCODES?.ready() && window.InventoryScreen);
  // El arranque intenta hidratar la sesión remota; este arnés bloquea Supabase.
  // Separamos ese tráfico esperado del flujo aislado de etiquetas.
  await page.waitForTimeout(1500);
  const consoleErrorsAtMount = consoleErrors.length;
  await page.evaluate(() => {
    const D = DATA;
    const v1 = (id, name, model, sku, size) => D.hydrate({
      id, recordModel: 'v1', nombre: name, modelo: model, sku,
      cat: sku.split('-')[0], manga: 'MC', tela: 'ALG', color: 'NEG', cuello: 'TRA', orn: '—', precio: 850,
      attrs: { __sizeCategoryId: /^\d+$/.test(size) ? 'size_number' : 'size_letter' },
      sizeCategoryId: /^\d+$/.test(size) ? 'size_number' : 'size_letter',
      stock: [{ talla: size, escala: /^\d+$/.test(size) ? 'N' : 'L', stock: 1 }],
    });
    const v2Id = '00000000-0000-4000-8000-000000000128';
    const v2 = D.hydrate({
      id: v2Id, recordModel: 'v2',
      referenceFamilyId: '00000000-0000-4000-8000-000000000129', barcodeCode: D.barcodeFromId(v2Id),
      sku: '1-VIC-ML-ALG-TRA-BL-44', nombre: 'VICTOR', modelo: 'VIC', cat: '1', manga: 'ML',
      tela: 'ALG', color: 'BL', cuello: 'TRA', orn: '—', precio: 1250,
      attrs: { __sizeCategoryId: 'size_number' }, sizeCategoryId: 'size_number',
      sizeCode: '44', sizeScale: 'N', stockQuantity: 1,
    });
    D.products.splice(0, D.products.length,
      v1('h128-v1-752', '752', '752', '8-752-PIL-NA-CF-T', '34'),
      v1('h128-v1-769', '769', '769', '8-769-PIL-NA-CF-T', '34'),
      v1('h128-v1-pvc10', 'PVC10', 'PVC10', '5-PVC10-R/P-NA-VCLA-T', '34'),
      v1('h128-v1-long', 'LUCAS', 'LUC', '1-LUC-MC-ALG-TRA-VMENF-T', '38'),
      v1('h128-v1-enye', 'HUGO', 'HUG', '1-HUG-MC-ALG-TRA-AAÑ-T', '36'),
      v2,
    );
    D.saveProducts = () => true;
    AUTH.canAccess = () => true;
    document.body.innerHTML = '<div id="h128-qa-root"></div>';
    ReactDOM.createRoot(document.getElementById('h128-qa-root')).render(React.createElement(InventoryScreen));
  });
  await page.getByTestId('inventory-labels').click();
  const warning = await page.getByTestId('labels-legibility-warning').innerText();
  check('la auditoría muestra juntos 752, 769, PVC10 y el extremo LUCAS',
    ['752', '769', 'PVC10', 'LUCAS'].every(value => warning.includes(value)), warning);
  check('Ñ queda separada como codificación y conserva el texto literal',
    warning.includes('HUGO') && warning.includes('Codificación:') && warning.includes('AAÑ'));
  check('la UI no recomienda alterar SKU o identidad',
    !warning.includes('acorta el SKU') && !warning.includes('cambia el barcode'));
  const heights = await page.evaluate(() => {
    const values = ['8-752-PIL-NA-CF-27', '8-769-PIL-NA-CF-27', '5-PVC10-R/P-NA-VCLA-32',
      '1-LUC-MC-ALG-TRA-VMENF-38', DATA.barcodeFromId('00000000-0000-4000-8000-000000000128')];
    return values.map(code => ({ code, ...BARCODES.inspectLabelCode(code) }));
  });
  check('todos los símbolos codificables usan la autoridad vertical H-128',
    heights.every(item => item.canvasHeightPx === 108 && item.barHeightMm > 0), JSON.stringify(heights));
  check('la mejora no reclasifica las muestras V1',
    heights.slice(0, 4).every(item => item.status === 'DENSE'));
  check('la muestra V3 queda en banda OK',
    heights.at(-1)?.status === 'OK');

  const viewports = [320, 360, 390, 430, 768, 1024, 1280, 1440];
  const layoutResults = [];
  for (const width of viewports) {
    await page.setViewportSize({ width, height: width <= 430 ? 760 : 900 });
    layoutResults.push(await page.getByTestId('label-modal').evaluate((node, width) => ({
      width,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      modalOverflow: node.scrollWidth > node.clientWidth + 1,
      warningVisible: !!node.querySelector('[data-testid="labels-legibility-warning"]'),
      actionsVisible: !!node.querySelector('[data-testid="labels-open-printable"]'),
    }), width));
    if ([360, 1280].includes(width)) {
      await page.screenshot({ path: join(evidenceDir, `h128-etiquetas-${width}px.png`), fullPage: true });
      const previewStages = page.getByTestId('label-preview-stage');
      for (let index = 0; index < await previewStages.count(); index++) {
        await previewStages.nth(index).screenshot({
          path: join(evidenceDir, `h128-preview-${width}px-${index + 1}.png`),
        });
      }
    }
  }
  check('el modal permanece usable en 320–1440 px sin overflow de página',
    layoutResults.every(item => !item.pageOverflow && item.warningVisible && item.actionsVisible),
    JSON.stringify(layoutResults));
  const flowConsoleErrors = consoleErrors.slice(consoleErrorsAtMount);
  const unexpectedConsoleErrors = flowConsoleErrors.filter(message => message !== 'Failed to load resource: net::ERR_FAILED');
  check('no hubo errores inesperados de página o consola durante el flujo',
    pageErrors.length === 0 && unexpectedConsoleErrors.length === 0,
    JSON.stringify({ pageErrors, unexpectedConsoleErrors, blockedStartupRequests: remoteRequests }));
  check('el recorrido no intentó escrituras comerciales en Supabase', commercialWrites === 0, String(commercialWrites));
} finally {
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 5000))]);
  server.close();
}

console.log(`\nH-128 BALAM QA etiquetas: ${passed}/${passed + failed}`);
process.exit(failed ? 1 : 0);
