// H-100 · SKU visible materializado por talla, con paridad preview/PDF/impresión.
// Usa datos sintéticos; no persiste ni sincroniza inventario real.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve('.');
const evidence = resolve('.evidence-h100');
await mkdir(evidence, { recursive: true });
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
const readDownload = async download => {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
  await context.route(/supabase\.co/, route => route.abort());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.BARCODES && window.InventoryScreen);

  const fixture = await page.evaluate(() => {
    const D = window.DATA;
    const numeric = ['38', '40', '42'];
    const letter = ['M', 'L', 'XL'];
    const v1Sizes = numeric.concat(letter);
    const v1Base = {
      recordModel: 'v1', nombre: 'ADRIANO',
      sku: '1-ARO-MC-ALG-AMAR-TRA-ALF--T', modelo: 'ARO', cat: '10', manga: 'MC',
      tela: 'ALG', color: 'BL', cuello: 'NOR', orn: 'Alforza', precio: 1150,
    };
    const v1Numeric = D.hydrate({ ...v1Base, id: 'h100-v1-adriano-number',
      sizeCategoryId: 'size_number', attrs: { __sizeCategoryId: 'size_number' },
      stock: numeric.map(talla => ({ talla, escala: 'N', stock: 1 })) });
    const v1Letter = D.hydrate({ ...v1Base, id: 'h100-v1-adriano-letter',
      sizeCategoryId: 'size_letter', attrs: { __sizeCategoryId: 'size_letter' },
      stock: letter.map(talla => ({ talla, escala: 'L', stock: 1 })) });
    const base = { nombre: 'ADRIANO', modelo: 'ARO', cat: '10', manga: 'MC', tela: 'ALG',
      color: 'BL', cuello: 'NOR', orn: 'Alforza', ornamentColorCodes: [], precio: 1150, stockQuantity: 1 };
    const v2 = v1Sizes.map((sizeCode, index) => D.createReference({
      ...base, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      sizeCategoryId: numeric.includes(sizeCode) ? 'size_number' : 'size_letter',
      sizeCode,
      // Un import/borrador no es autoridad del SKU V2.
      sku: '1-ARO-MC-ALG-AMAR-TRA-ALF--T',
    }, []));
    D.products.splice(0, D.products.length, v1Numeric, v1Letter, ...v2);
    D.saveProducts = () => true;
    window.AUTH.canAccess = () => true;
    document.body.innerHTML = '<div id="h100-root"></div>';
    ReactDOM.createRoot(document.getElementById('h100-root')).render(React.createElement(window.InventoryScreen));
    return {
      sizes: v1Sizes,
      v1Expected: v1Sizes.map(size => `1-ARO-MC-ALG-AMAR-TRA-ALF-${size}`),
      v2Skus: v2.map(product => product.sku),
      v2Barcodes: v2.map(product => product.barcodeCode),
      v2Ids: v2.map(product => product.id),
    };
  });

  check('V2 persiste el SKU derivado y nunca el marcador recibido',
    fixture.v2Skus.every((sku, index) => sku.endsWith(`-${fixture.sizes[index]}`) && !sku.includes('--') && !sku.split('-').includes('T')),
    JSON.stringify(fixture.v2Skus));
  check('la autoridad única de SKU visible está publicada', await page.evaluate(() => typeof window.DATA.materializedSku === 'function'));
  check('Code128 V2 conserva exactamente barcode_code', await page.evaluate(expected => {
    return window.DATA.products.slice(2).every((product, index) => window.BARCODES.codeOf(product, product.sizeCode) === expected[index]);
  }, fixture.v2Barcodes));

  await page.getByTestId('inventory-labels').click();
  const previewSkus = await page.locator('[data-label-part="sku"]').allTextContents();
  check('preview materializa las primeras tallas V1', fixture.v1Expected.slice(0, 4).every(sku => previewSkus.includes(sku)), JSON.stringify(previewSkus));
  check('preview no contiene talla T ni segmento vacío', previewSkus.every(sku => !sku.split('-').includes('T') && !sku.includes('--')));

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('labels-download').click();
  const pdfBytes = await readDownload(await downloadPromise);
  await writeFile(join(evidence, 'etiquetas-adriano-multitalla.pdf'), pdfBytes);
  const pdf = pdfBytes.toString('latin1');
  check('PDF contiene V1 numéricas 38/40/42 y letras M/L/XL', fixture.v1Expected.every(sku => pdf.includes(sku)));
  check('PDF contiene los seis SKU V2 efectivos', fixture.v2Skus.every(sku => pdf.includes(sku)));
  check('PDF no contiene SKU final con T ni segmento vacío', !pdf.includes('ALF--T') && !pdf.includes('Alforza--'));

  const popupPromise = context.waitForEvent('page');
  await page.getByTestId('labels-open-printable').click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  const printSkus = await popup.locator('[data-label-part="sku"]').allTextContents();
  check('impresión coincide con la materialización esperada',
    fixture.v1Expected.every(sku => printSkus.includes(sku)) && fixture.v2Skus.every(sku => printSkus.includes(sku)));
  check('products.id permanece intacto', await page.evaluate(expected => window.DATA.products.slice(2).every((p, i) => p.id === expected[i]), fixture.v2Ids));
  await popup.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\nH-100 SKU materializado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed ? 1 : 0);
