// H-99 · PDF real 60×40 desde las rutas individual y de Inventario.
// Usa referencias sintéticas y no persiste ni sincroniza datos.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve('.');
const evidence = resolve('.evidence-label-visual');
await mkdir(evidence, { recursive: true });
const artifact = process.env.BALAM_ARTIFACT_PATH ? resolve(process.env.BALAM_ARTIFACT_PATH) : null;
const server = createServer((request, response) => {
  let pathname = decodeURIComponent(request.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const file = pathname === '/index.html' && artifact ? artifact : join(root, pathname);
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
const inspectPdf = bytes => {
  const raw = bytes.toString('latin1');
  const startXrefMatch = raw.match(/startxref\s+(\d+)\s+%%EOF\s*$/);
  const xrefOffset = startXrefMatch ? Number(startXrefMatch[1]) : -1;
  const xrefEntries = [...raw.matchAll(/^(\d{10}) 00000 n\s*$/gm)].map(match => Number(match[1]));
  const objectOffsetsValid = xrefEntries.every((offset, index) => raw.slice(offset, offset + 20).startsWith(`${index + 1} 0 obj`));
  const jpegStreams = [...raw.matchAll(/\/Subtype\s*\/Image[\s\S]*?stream\n/g)].map(match => match.index + match[0].length);
  return {
    header: raw.startsWith('%PDF-'),
    eof: raw.trimEnd().endsWith('%%EOF'),
    xrefValid: xrefOffset >= 0 && raw.slice(xrefOffset, xrefOffset + 4) === 'xref' && objectOffsetsValid,
    pages: (raw.match(/\/Type\s*\/Page\b/g) || []).length,
    mediaBoxes: [...raw.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g)].map(match => [Number(match[1]), Number(match[2])]),
    images: (raw.match(/\/Subtype\s*\/Image\b/g) || []).length,
    jpegValid: jpegStreams.length > 0 && jpegStreams.every(offset => bytes[offset] === 0xff && bytes[offset + 1] === 0xd8),
    raw,
  };
};
const extractJpegs = bytes => {
  const raw = bytes.toString('latin1');
  const output = [];
  const pattern = /\/Subtype\s*\/Image[\s\S]*?\/Length\s+(\d+)[\s\S]*?stream\n/g;
  let match;
  while ((match = pattern.exec(raw))) {
    const start = match.index + match[0].length;
    output.push(bytes.subarray(start, start + Number(match[1])));
    pattern.lastIndex = start + Number(match[1]);
  }
  return output;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
  await context.route(/supabase\.co/, route => route.abort());
  await context.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.__h99LastBlob = blob; return create(blob); };
    window.__h99Shared = [];
    navigator.share = async payload => { window.__h99Shared.push(payload); };
    navigator.canShare = payload => !!(payload && payload.files && payload.files[0] && payload.files[0].type === 'application/pdf');
  });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.BARCODES && window.InventoryScreen);
  const fixtures = await page.evaluate(() => {
    const D = window.DATA;
    const rows = [
      ['one', 'ADRIÁNO / UNO', '21-ADR-40', 'B000000000000991', 850, 2],
      ['two', 'BÁRBARA', '21-BAR-ML-ALG-AZ-MAO-40', 'B000000000000992', 1250, 1],
      ['three', 'CATALINA', '21-CAT-ML-ALG-BL-MAO-DRO-REG-CARACTERISTICA-40', 'B000000000000993', 12345, 2],
    ].map(([kind, nombre, sku, barcodeCode, precio, stock], index) => D.hydrate({
      id: `h99-pdf-${kind}`, recordModel: 'v2', barcodeCode, sku, nombre,
      modelo: kind.toUpperCase(), cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'MAO',
      orn: '—', ornColors: [], ornamentColorCodes: [], precio, costo: 400, stockQuantity: stock,
      sizeCode: '40', sizeScale: 'N', sizeCategoryId: 'size_number', attrs: { __sizeCategoryId: 'size_number' },
      stock: [], physicalSignature: `H99PDF|${index}`, physicalIdentityLocked: true,
    }));
    D.products.splice(0, D.products.length, ...rows);
    D.saveProducts = () => true;
    window.AUTH.canAccess = () => true;
    document.body.innerHTML = '<div id="h99-pdf-root"></div>';
    ReactDOM.createRoot(document.getElementById('h99-pdf-root')).render(React.createElement(window.InventoryScreen));
    return rows.map(row => ({ id: row.id, familyId: row.referenceFamilyId, sku: row.sku, barcode: row.barcodeCode }));
  });

  // Ruta individual y cantidad > 1.
  await page.getByTestId(`inventory-product-family:${fixtures[0].familyId}`).click();
  await page.getByTestId('product-detail-labels').click();
  await page.getByTestId('labels-copies-input').fill('3');
  const individualDownload = page.waitForEvent('download');
  await page.getByTestId('labels-download').click();
  const individual = await individualDownload;
  const individualBytes = await readDownload(individual);
  const individualPdf = inspectPdf(individualBytes);
  const individualMime = await page.evaluate(() => window.__h99LastBlob && window.__h99LastBlob.type);
  check('individual descarga extensión PDF', individual.suggestedFilename().endsWith('.pdf'), individual.suggestedFilename());
  check('individual usa MIME application/pdf', individualMime === 'application/pdf', individualMime);
  check('individual tiene encabezado PDF real', individualPdf.header, individualBytes.subarray(0, 8).toString('latin1'));
  check('lector estructural valida xref y cierre PDF', individualPdf.eof && individualPdf.xrefValid);
  check('cantidad individual produce tres páginas', individualPdf.pages === 3, String(individualPdf.pages));
  check('nombre individual sanitiza caracteres incompatibles', individual.suggestedFilename().startsWith('BALAM_ADRIANO_UNO_'), individual.suggestedFilename());

  await page.getByTestId('label-modal-close').click();
  await page.getByTestId('product-detail-close').click();

  // Ruta Inventario: 3 referencias × una copia = un PDF de tres páginas.
  await page.getByTestId('inventory-labels').click();
  const multiDownload = page.waitForEvent('download');
  await page.getByTestId('labels-download').click();
  const multi = await multiDownload;
  const multiBytes = await readDownload(multi);
  await writeFile(join(evidence, 'etiquetas-h99-multipagina.pdf'), multiBytes);
  const multiPdf = inspectPdf(multiBytes);
  const multiMime = await page.evaluate(() => window.__h99LastBlob && window.__h99LastBlob.type);
  check('Inventario descarga un solo PDF', multi.suggestedFilename().startsWith('BALAM_Etiquetas_') && multi.suggestedFilename().endsWith('.pdf'), multi.suggestedFilename());
  check('PDF múltiple usa MIME correcto', multiMime === 'application/pdf', multiMime);
  check('PDF múltiple contiene tres páginas', multiPdf.pages === 3, String(multiPdf.pages));
  check('cada página mide 60×40 mm', multiPdf.mediaBoxes.length === 3 && multiPdf.mediaBoxes.every(([w, h]) => Math.abs(w - 170.0787) < 0.02 && Math.abs(h - 113.3858) < 0.02), JSON.stringify(multiPdf.mediaBoxes));
  check('cada página contiene render gráfico', multiPdf.images === 3, String(multiPdf.images));
  check('los streams gráficos son JPEG válidos', multiPdf.jpegValid);
  check('PDF conserva SKU corto, típico y largo', fixtures.every(item => multiPdf.raw.includes(item.sku)));
  check('PDF conserva precios de cientos, miles y precio grande', ['$850', '$1,250', '$12,345'].every(price => multiPdf.raw.includes(price)));
  check('PDF no expone barcode_code ni products.id como texto', fixtures.every(item => !multiPdf.raw.includes(item.barcode) && !multiPdf.raw.includes(item.id)));
  const pdfJpegs = extractJpegs(multiBytes);
  const barcodeStats = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const row = context.getImageData(24, 175, image.width - 48, 1).data;
    let black = 0, transitions = 0, previous = false;
    for (let i = 0; i < row.length; i += 4) {
      const current = row[i] < 80 && row[i + 1] < 80 && row[i + 2] < 80;
      if (current) black++;
      if (i && current !== previous) transitions++;
      previous = current;
    }
    return { black, transitions };
  }, pdfJpegs[0].toString('base64'));
  check('Code128 está gráficamente presente en el PDF', barcodeStats.black > 100 && barcodeStats.transitions > 30, JSON.stringify(barcodeStats));
  const previewJpeg = await page.getByTestId('label-preview-stage').first().locator('.bx-artwork').evaluate(async node => {
    const blob = new Blob([node.outerHTML], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image(); image.src = url; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 480;
      const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 720, 480); context.drawImage(image, 0, 0, 720, 480);
      const jpeg = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('JPEG')), 'image/jpeg', 0.96));
      const bytes = new Uint8Array(await jpeg.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    } finally { URL.revokeObjectURL(url); }
  });
  check('primera página PDF rasteriza exactamente el master del preview', pdfJpegs[0].equals(Buffer.from(previewJpeg, 'base64')));

  const share = page.getByTestId('labels-share');
  check('compartir PDF aparece cuando Web Share acepta archivos', await share.count() === 1);
  if (await share.count()) await share.click();
  const shared = await page.evaluate(() => {
    const file = window.__h99Shared[0] && window.__h99Shared[0].files[0];
    return file && { type: file.type, name: file.name };
  });
  check('Compartir entrega PDF, nunca HTML', shared && shared.type === 'application/pdf' && shared.name.endsWith('.pdf'), JSON.stringify(shared));

  // Cantidades por stock: 2 + 1 + 2 = cinco páginas en un solo archivo.
  await page.getByTestId('labels-copies-stock').click();
  const stockDownload = page.waitForEvent('download');
  await page.getByTestId('labels-download').click();
  const stock = await stockDownload;
  const stockPdf = inspectPdf(await readDownload(stock));
  check('varios productos y cantidades generan un PDF de cinco páginas', stockPdf.pages === 5, String(stockPdf.pages));

  // Sin Web Share, Descargar PDF permanece y nunca aparece un fallback HTML.
  await page.evaluate(() => { navigator.canShare = () => false; });
  await page.getByTestId('labels-copies-one').click();
  check('sin compartir archivos permanece Descargar PDF', await page.getByTestId('labels-download').isVisible() && await page.getByTestId('labels-share').count() === 0);

  const popupPromise = context.waitForEvent('page');
  await page.getByTestId('labels-open-printable').click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  check('Imprimir mantiene documento 60×40 y mismo master', await popup.locator('.bx-label[data-testid="label-master"]').count() === 3);
  check('vista imprimible no ofrece descarga HTML', await popup.locator('a[download$=".html"],#download,#share').count() === 0);
  await popup.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\nH-99 PDF etiquetas: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed ? 1 : 0);
