// H-99 · PDF real 60×40 desde las rutas individual y de Inventario.
// H-188: precio global, lote de 881 y recarga; confirmación remota simulada.
// Usa referencias sintéticas y no escribe en Supabase.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve('.');
const evidence = process.env.BALAM_TEST_OUTPUT ? resolve(process.env.BALAM_TEST_OUTPUT) : null;
if (evidence) await mkdir(evidence, { recursive: true });
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
const rasterPreview = locator => locator.evaluate(async node => {
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

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
  await context.route(/supabase\.co/, route => route.abort());
  await context.addInitScript(() => {
    window.__h99Roots = []; let reactDom;
    Object.defineProperty(window, 'ReactDOM', { configurable: true, get: () => reactDom, set: value => {
      reactDom = value; let createRoot;
      Object.defineProperty(value, 'createRoot', { configurable: true, get: () => createRoot, set: implementation => {
        createRoot = (...args) => { const root = implementation(...args); __h99Roots.push(root); return root; };
      } });
    } });
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { window.__h99LastBlob = blob; return create(blob); };
    window.__h99Shared = [];
    navigator.share = async payload => { window.__h99Shared.push(payload); };
    navigator.canShare = payload => !!(payload && payload.files && payload.files[0] && payload.files[0].type === 'application/pdf');
  });
  const page = await context.newPage();
  page.on('pageerror', error => console.error('Browser error:', error.message));
  const commands = [];
  let remoteConfig;
  await page.exposeFunction('__confirmLabelConfig', command => {
    if (command.type !== 'config') throw new Error('Unexpected write: ' + command.type);
    commands.push(structuredClone(command));
    remoteConfig = structuredClone(command.state);
    return structuredClone(remoteConfig);
  });
  async function setup(reload = false) {
    if (reload) await page.reload({ waitUntil: 'load' });
    else await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.AUTH?.isReady() && window.DATA && window.BARCODES && window.InventoryScreen && window.SettingsScreen);
    if (!remoteConfig) {
      remoteConfig = await page.evaluate(() => CONFIG.prepareMutation('reset', []).state);
      delete remoteConfig.settings['print.labelsShowPrice']; // Cuenta anterior a H-188.
    }
    return page.evaluate(state => {
    __h99Roots.forEach(root => root.unmount());
    const D = window.DATA;
    CONFIG.load(state);
    const invoke = CORE.invokeSync;
    CORE.invokeSync = (method, ...args) => {
      if (method === 'serverNow') return new Date('2026-11-04T19:00:00Z');
      if (method === 'assertBusinessReady') return true;
      if (method !== 'execute') return invoke(method, ...args);
      return (async () => { CONFIG.load(await __confirmLabelConfig(args[0])); return { ok: true }; })();
    };
    const rows = [
      ['one', 'ADRIÁNO / UNO', '21-ADR-38', 850, 2],
      ['two', 'BÁRBARA', '21-BAR-ML-ALG-AZ-MAO-40', 1250, 1],
      ['three', 'CATALINA', '21-CAT-ML-ALG-BL-MAO-DRO-REG-CARACTERISTICA-42', 12345, 2],
    ].map(([kind, nombre, sku, precio, stock], index) => {
      const id = `99000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      return D.hydrate({
      id, recordModel: 'v2', barcodeCode: D.barcodeFromId(id), barcodeContract: 3, sku, nombre,
      modelo: kind.toUpperCase(), cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'MAO',
      orn: '—', ornColors: [], ornamentColorCodes: [], precio, costo: 400, stockQuantity: stock,
      sizeCode: ['38', '40', '42'][index], sizeScale: 'N', sizeCategoryId: 'size_number', attrs: { __sizeCategoryId: 'size_number' },
      stock: [], physicalSignature: `H99PDF|${index}`, physicalIdentityLocked: true,
    }); });
    // DATA expone snapshots: instalar la semilla completa por su frontera vigente.
    const keys = ['products', 'sellers', 'clients', 'sales', 'movements', 'promotions', 'liquidations', 'returns', 'payments', 'exchanges', 'loans', 'commissionAdjustments'];
    const snapshot = Object.fromEntries(keys.map(key => [key, []]));
    snapshot.products = rows;
    snapshot.commissionContext = { periodStart: '', sellerBases: [] };
    window.__h99Fixture = snapshot;
    D.replaceFromOnline(snapshot);
    D.saveProducts = () => true;
    window.AUTH.canAccess = () => true;
    window.AUTH.isAdmin = () => true;
    document.body.innerHTML = '<div id="h99-pdf-root"></div>';
    window.__h99Root = ReactDOM.createRoot(document.getElementById('h99-pdf-root'));
    __h99Root.render(React.createElement(window.InventoryScreen));
    return rows.map(row => ({ id: row.id, familyId: row.referenceFamilyId, sku: row.sku, barcode: row.barcodeCode }));
    }, remoteConfig);
  }
  async function mount(screen) {
    await page.evaluate(name => __h99Root.render(React.createElement(window[name])), screen);
    if (screen === 'SettingsScreen') await page.getByTestId('settings-section-impresion').click();
    else await page.getByTestId('inventory-labels').waitFor();
  }
  const fixtures = await setup();
  await mount('SettingsScreen');
  const priceSwitch = page.getByTestId('config-toggle-print.labelsShowPrice');
  const switchExists = await priceSwitch.count() === 1;
  check('H-188: un switch global en Configuración → Impresión', switchExists);
  check('H-188: cuenta histórica muestra precio por defecto sin escribir configuración',
    await page.evaluate(() => CONFIG.get('print.labelsShowPrice') === true && !Object.hasOwn(CONFIG.snapshot().settings, 'print.labelsShowPrice')) && commands.length === 0);
  if (!process.argv.includes('--before')) {
  await mount('InventoryScreen');

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
  if (evidence) await writeFile(join(evidence, 'etiquetas-h99-multipagina.pdf'), multiBytes);
  const multiPdf = inspectPdf(multiBytes);
  const multiMime = await page.evaluate(() => window.__h99LastBlob && window.__h99LastBlob.type);
  check('Inventario descarga un solo PDF distinguible',
    multi.suggestedFilename().startsWith('BALAM_VARIOS_')
      && multi.suggestedFilename().includes('_REFS-3_')
      && multi.suggestedFilename().endsWith('.pdf'), multi.suggestedFilename());
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
  const previewJpeg = await rasterPreview(page.getByTestId('label-preview-stage').first().locator('.bx-artwork'));
  check('primera página PDF rasteriza exactamente el master del preview', pdfJpegs[0].equals(Buffer.from(previewJpeg, 'base64')));
  const mastersWithoutPrice = await page.locator('[data-testid="label-preview-stage"] .bx-artwork').evaluateAll(nodes => nodes.map(node => {
    const copy = node.cloneNode(true); copy.querySelector('[data-label-part="price"]').remove(); return copy.outerHTML;
  }));

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

  if (switchExists) {
    await page.getByTestId('label-modal-close').click();
    await mount('SettingsScreen');
    await priceSwitch.click();
    await page.waitForFunction(() => CONFIG.get('print.labelsShowPrice') === false);
    await mount('InventoryScreen');
    await page.getByTestId(`inventory-product-family:${fixtures[0].familyId}`).click();
    await page.getByTestId('product-detail-labels').click();
    const noPricePreview = page.getByTestId('label-preview-stage').first().locator('.bx-artwork');
    await noPricePreview.waitFor();
    const noPriceRaster = Buffer.from(await rasterPreview(noPricePreview), 'base64');
    const hiddenDownload = page.waitForEvent('download');
    await page.getByTestId('labels-download').click();
    const hiddenBytes = await readDownload(await hiddenDownload);
    check('H-188: individual sin precio conserva exactamente SVG, barcode y PDF 60×40',
      await noPricePreview.evaluate(node => node.outerHTML) === mastersWithoutPrice[0]
      && await page.getByTestId('labels-with-price').count() === 0
      && inspectPdf(hiddenBytes).pages === 1 && !inspectPdf(hiddenBytes).raw.includes('$850')
      && extractJpegs(hiddenBytes)[0].equals(noPriceRaster));
    await page.getByTestId('label-modal-close').click();
    await page.getByTestId('product-detail-close').click();
    await page.evaluate(() => {
      const snapshot = structuredClone(__h99Fixture);
      snapshot.products.forEach((product, index) => { product.stockQuantity = [293, 294, 294][index]; });
      DATA.replaceFromOnline(snapshot);
    });
    await page.getByTestId('inventory-labels').click();
    await page.getByTestId('labels-copies-stock').click();
    const hiddenMasters = page.locator('[data-testid="label-preview-stage"] .bx-artwork');
    const hiddenRasters = [];
    for (let i = 0; i < 3; i++) hiddenRasters.push(Buffer.from(await rasterPreview(hiddenMasters.nth(i)), 'base64'));
    const batchDownload = page.waitForEvent('download');
    await page.getByTestId('labels-download').click();
    const batchBytes = await readDownload(await batchDownload), batchPdf = inspectPdf(batchBytes);
    const batchPopup = page.waitForEvent('popup');
    await page.getByTestId('labels-open-printable').click();
    const print = await batchPopup;
    await print.waitForFunction(() => document.querySelectorAll('[data-testid="label-master"]').length === 881);
    const batchIntact = await print.locator('.bx-artwork').evaluateAll((nodes, masters) => nodes.every(node => masters.includes(node.outerHTML)), mastersWithoutPrice);
    check('H-188: 881 etiquetas de tallas 38/40/42 sin precio en HTML, gráficos y texto PDF',
      batchIntact && batchPdf.pages === 881 && batchPdf.images === 881 && batchPdf.xrefValid
      && batchPdf.mediaBoxes.every(([w, h]) => Math.abs(w - 170.0787) < 0.02 && Math.abs(h - 113.3858) < 0.02)
      && ['$850', '$1,250', '$12,345'].every(price => !batchPdf.raw.includes(price))
      && fixtures.every((fixture, index) => batchPdf.raw.split(fixture.sku).length - 1 === [293, 294, 294][index])
      && extractJpegs(batchBytes).every(jpeg => hiddenRasters.some(raster => raster.equals(jpeg))));
    await print.close();
    const writesBeforeReload = commands.length;
    await setup(true);
    await mount('SettingsScreen');
    const persisted = await priceSwitch.count() === 1 && await page.evaluate(() => CONFIG.get('print.labelsShowPrice') === false);
    await mount('InventoryScreen');
    await page.getByTestId('inventory-labels').click();
    await page.getByTestId('label-preview-stage').first().waitFor();
    check('H-188: recarga real conserva el ajuste confirmado y todas las etiquetas sin precio',
      persisted && commands.length === writesBeforeReload && commands.length === 1
      && remoteConfig.settings['print.labelsShowPrice'] === false
      && await page.locator('[data-testid="label-preview-stage"] [data-label-part="price"]').count() === 0);
  }
  }
} finally {
  await browser.close();
  server.close();
}

console.log(`\nH-99 PDF etiquetas: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed ? 1 : 0);
