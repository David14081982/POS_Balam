// H-128 · Mejora vertical sin alterar identidad ni fingir capacidad horizontal.
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
  const context = await browser.newContext();
  await context.route(/supabase\.co/, route => route.abort());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.BARCODES?.ready() && window.DATA);
  const result = await page.evaluate(() => {
    const B = BARCODES;
    const code = '8-752-PIL-NA-CF-27';
    const beforeContract = {
      ...B.LABEL_60X40,
      symbolBox: { ...B.LABEL_60X40.symbolBox },
      barcodeOptions: { ...B.LABEL_60X40.barcodeOptions, height: 60, margin: 4,
        marginTop: 4, marginBottom: 4 },
    };
    const before = B.inspectLabelCode(code, beforeContract);
    const after = B.inspectLabelCode(code);
    const safeContract = {
      ...B.LABEL_60X40,
      symbolBox: { ...B.LABEL_60X40.symbolBox, xMm: 0, widthMm: 60 },
      barcodeOptions: { ...B.LABEL_60X40.barcodeOptions, height: 100, margin: 0,
        marginLeft: 20, marginRight: 20, marginTop: 0, marginBottom: 0 },
    };
    const safe = B.inspectLabelCode(code, safeContract);
    const invalid = B.inspectLabelCode('SKU-AAÑ-CH');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const svgRendered = B.draw(svg, code, B.LABEL_60X40.barcodeOptions);
    const product = { recordModel: 'v1', sku: '8-752-PIL-NA-CF-T' };
    return {
      contract: B.LABEL_60X40,
      before,
      after,
      safe,
      invalid,
      svgRendered,
      svgRects: svg.querySelectorAll('rect').length,
      materialized: B.codeOf(product, '27'),
    };
  });

  check('la etiqueta conserva exactamente 60×40 mm',
    result.contract.labelWidthMm === 60 && result.contract.labelHeightMm === 40);
  check('la caja horizontal H-99 permanece en x=2 y ancho=56 mm',
    result.contract.symbolBox.xMm === 2 && result.contract.symbolBox.widthMm === 56);
  check('la mejora solicita barras de 100 px', result.contract.barcodeOptions.height === 100,
    JSON.stringify(result.contract.barcodeOptions));
  check('la mejora elimina sólo márgenes verticales internos',
    result.contract.barcodeOptions.marginTop === 0 && result.contract.barcodeOptions.marginBottom === 0);
  check('el caso real 752 conserva módulos, X y estado',
    result.after.modules === result.before.modules
      && Math.abs(result.after.moduleMm - result.before.moduleMm) < 1e-9
      && result.after.status === result.before.status,
    JSON.stringify({ before: result.before, after: result.after }));
  check('las barras del 752 ganan altura física', result.after.barHeightMm > result.before.barHeightMm,
    `${result.before.barHeightMm} → ${result.after.barHeightMm} mm`);
  check('ni el máximo 60 mm con quiet zones 10X recupera 233 módulos',
    result.safe.modules === 233 && result.safe.moduleMm < 0.25 && result.safe.status === 'DENSE',
    JSON.stringify(result.safe));
  check('el máximo seguro conserva al menos 10X por lado',
    result.safe.quietZoneLeftMm / result.safe.moduleMm >= 10 - 1e-9
      && result.safe.quietZoneRightMm / result.safe.moduleMm >= 10 - 1e-9);
  check('JsBarcode mantiene Ñ como error; no existe normalización implícita',
    result.invalid.status === 'ENCODING_ERROR');
  check('el SKU materializado no cambia', result.materialized === '8-752-PIL-NA-CF-27', result.materialized);
  check('JsBarcode puede representar el mismo símbolo como SVG',
    result.svgRendered && result.svgRects > 0, `${result.svgRects} rectángulos`);
} finally {
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 5000))]);
  server.close();
}

console.log(`\nH-128 recuperación geométrica V1: ${passed}/${passed + failed}`);
process.exit(failed ? 1 : 0);
