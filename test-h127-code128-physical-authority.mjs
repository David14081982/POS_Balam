// H-127 · La validación debe medir el mismo Code128 que preview/PDF/impresión.
// Datos sintéticos: no persiste ni sincroniza inventario real.
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
  await page.waitForFunction(() => window.BARCODES?.ready());

  const result = await page.evaluate(() => {
    const B = window.BARCODES;
    const code222 = 'ABCDEFGHIJKLMNOPQ';
    const modulesCanvas = document.createElement('canvas');
    JsBarcode(modulesCanvas, code222, { ...B.BASE_OPTS, width: 1, height: 60, margin: 0, displayValue: false });
    const realCanvas = document.createElement('canvas');
    JsBarcode(realCanvas, code222, { ...B.BASE_OPTS, height: 60, margin: 4, displayValue: false });
    const oldModuleMm = 56 / modulesCanvas.width;
    const actualModuleMm = 56 * 2 / realCanvas.width;
    const inspect = typeof B.inspectLabelCode === 'function' ? code => B.inspectLabelCode(code) : () => null;
    return {
      raw: { modules: modulesCanvas.width, realWidthPx: realCanvas.width, oldModuleMm, actualModuleMm },
      contract: B.LABEL_60X40,
      dense222: inspect(code222),
      numeric16: inspect('1234567890123456'),
      alpha16: inspect('ABCDEFGHIJKLMNOP'),
      mixed16: inspect('B40728BF7CF1B48A'),
      hyphenated: inspect('8-752-PIL-NA-CF-27'),
      missing: inspect(''),
      invalid: inspect('\u0100'),
    };
  });

  console.log('Reproducción pre-corrección:', JSON.stringify(result.raw));
  check('la muestra objetivo tiene exactamente 222 módulos', result.raw.modules === 222, JSON.stringify(result.raw));
  check('el cálculo auxiliar anterior aprobaría, pero el render real cae bajo 0.25 mm',
    result.raw.oldModuleMm >= 0.25 && result.raw.actualModuleMm < 0.25,
    `${result.raw.oldModuleMm.toFixed(6)} / ${result.raw.actualModuleMm.toFixed(6)} mm`);
  check('existe una autoridad física única para 60×40', !!result.contract && !!result.dense222);
  check('222 módulos nunca se clasifican OK',
    result.dense222?.modules === 222 && result.dense222?.status === 'DENSE' && result.dense222?.ok === false,
    JSON.stringify(result.dense222));
  check('ningún resultado OK o NEAR queda bajo 0.25 mm',
    [result.numeric16, result.alpha16, result.mixed16, result.hyphenated]
      .filter(Boolean).every(item => !['OK', 'NEAR'].includes(item.status) || item.moduleMm >= 0.25));
  check('la autoridad expone módulos, X, altura, quiet zones y densidad PDF', (() => {
    const item = result.mixed16;
    return item && item.modules > 0 && item.moduleMm > 0 && item.barHeightMm > 0
      && item.quietZoneLeftMm > 0 && item.quietZoneRightMm > 0
      && item.pdfDpi > 300 && item.availableWidthMm === 56;
  })(), JSON.stringify(result.mixed16));
  check('casos numérico, alfabético, mixto y con guiones usan módulos reales',
    [result.numeric16, result.alpha16, result.mixed16, result.hyphenated]
      .every(item => item && Number.isInteger(item.modules) && item.modules > 0));
  check('entrada vacía se distingue de densidad', result.missing?.status === 'MISSING_BARCODE');
  check('carácter no codificable se distingue de densidad', result.invalid?.status === 'ENCODING_ERROR');
} finally {
  await browser.close();
  server.close();
}

console.log(`\nH-127 autoridad física: ${passed}/${passed + failed}`);
process.exit(failed ? 1 : 0);
