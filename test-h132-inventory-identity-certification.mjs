// H-132 · Toda etiqueta vendible debe cerrar identidad V2 antes de generar PNG/PDF.
// Fixtures aislados; no usa red, Supabase, cola ni datos reales.
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
  await page.waitForFunction(() => window.DATA && window.BARCODES?.ready() && window.InventoryScreen);

  const result = await page.evaluate(() => {
    const D = window.DATA, B = window.BARCODES;
    const v1 = D.hydrate({
      id: '13200000-0000-4000-8000-000000000001', recordModel: 'v1',
      sku: '1-ANG-MC-AJSP-TRA-BL-T', nombre: 'ANGEL', modelo: 'ANG', cat: '1',
      manga: 'MC', tela: 'AJSP', color: 'BL', cuello: 'TRA', orn: '—', precio: 950,
      attrs: { __sizeCategoryId: 'size_number' }, sizeCategoryId: 'size_number',
      stock: [{ talla: '38', escala: 'N', stock: 1 }],
    });
    const makeV2 = (id, sizeCode, barcodeCode) => D.hydrate({
      id, recordModel: 'v2', referenceFamilyId: '13200000-0000-4000-8000-000000000099',
      barcodeCode, sku: '1-ANG-MC-AJSP-TRA-BL-38/40', nombre: 'ANGEL', modelo: 'ANG', cat: '1',
      manga: 'MC', tela: 'AJSP', color: 'BL', cuello: 'TRA', orn: '—', precio: 950,
      attrs: { __sizeCategoryId: 'size_number' }, sizeCategoryId: 'size_number',
      sizeCode, sizeScale: 'N', stockQuantity: 1, physicalSignature: `ANGEL|${sizeCode}`,
      physicalIdentityLocked: true,
    });
    const v2a = makeV2('13200000-0000-4000-8000-000000000002', '38', 'B000000000001321');
    const v2b = makeV2('13200000-0000-4000-8000-000000000003', '40', 'B000000000001322');
    D.products.splice(0, D.products.length, v1, v2a, v2b);
    const certify = typeof B.certifySellableReference === 'function'
      ? (product, size) => B.certifySellableReference(product, size) : () => null;
    const one = certify(v1, '38');
    const two = certify(v2a, '38');
    const three = certify(v2b, '40');
    v2b.barcodeCode = v2a.barcodeCode;
    const duplicated = certify(v2b, '40');
    v2b.barcodeCode = 'B000000000001322';
    return {
      hasAuthority: typeof B.certifySellableReference === 'function',
      v1: one,
      v2a: two,
      v2b: three,
      duplicated,
      repeatedSku: v2a.sku === v2b.sku,
    };
  });

  check('existe una autoridad única de certificación por referencia vendible', result.hasAuthority);
  check('V1 vendible se censa pero no autoriza una etiqueta nueva',
    result.v1?.ok === false && result.v1?.issues?.includes('V1_OPERATIONAL'));
  check('dos referencias con SKU visible repetido conservan identidad técnica independiente',
    result.repeatedSku && result.v2a?.ok === true && result.v2b?.ok === true
      && result.v2a?.productId !== result.v2b?.productId
      && result.v2a?.barcodeCode !== result.v2b?.barcodeCode);
  check('la certificación V2 cierra codeOf, etiqueta y resolve al ID+talla exactos',
    result.v2a?.ok === true
      && result.v2a?.codeOf === result.v2a?.barcodeCode
      && result.v2a?.labelCode === result.v2a?.barcodeCode
      && result.v2a?.resolvedProductId === result.v2a?.productId
      && result.v2a?.resolvedSize === result.v2a?.size);
  check('barcode duplicado bloquea y nunca elige la primera coincidencia',
    result.duplicated?.ok === false && result.duplicated?.issues?.includes('BARCODE_DUPLICATE'));

  await page.evaluate(() => {
    const D = window.DATA;
    window.AUTH.canAccess = () => true;
    D.saveProducts = () => true;
    document.body.innerHTML = '<div id="h132-root"></div>';
    ReactDOM.createRoot(document.getElementById('h132-root')).render(React.createElement(window.InventoryScreen));
  });
  await page.getByTestId('inventory-labels').click();
  const block = page.getByTestId('labels-certification-block');
  const blockText = await block.count() ? await block.innerText() : '';
  check('una selección con V1 bloquea toda salida antes de PNG/PDF',
    await block.count() === 1
      && blockText.includes('ANGEL') && blockText.includes('V1')
      && await page.getByTestId('labels-download').isDisabled()
      && await page.getByTestId('labels-open-printable').isDisabled(), blockText);
  await page.getByTestId('label-modal-close').click();

  await page.evaluate(() => {
    const D = window.DATA;
    D.products.splice(0, 1); // quedan sólo las dos referencias V2 con SKU visible repetido
    document.getElementById('h132-root').remove();
    const host = document.createElement('div'); host.id = 'h132-root-v2'; document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(window.InventoryScreen));
  });
  await page.getByTestId('inventory-labels').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="labels-download"]')?.disabled === false);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('labels-download').click();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  check('el nombre PDF distingue humanamente familia, tallas y referencias sin ser autoridad',
    filename.includes('ANGEL') && filename.includes('38-40')
      && filename.includes('REFS-2') && filename.endsWith('.pdf'), filename);
} finally {
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 5000))]);
  server.close();
}

console.log(`\nH-132 certificación de identidad: ${passed}/${passed + failed}`);
process.exit(failed ? 1 : 0);
