// H-110 · Certificación preproducción V2 en una sola sesión aislada.
//
// El navegador parte de un perfil efímero, intercepta toda conexión Supabase y
// restaura byte por byte el estado local capturado antes de crear el fixture.
// No escribe evidencias: PDF y XLSX se validan directamente desde memoria.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve('.');
const fixturePrefix = 'CERT-PREPROD-V2-H110';
const fixture = {
  prefix: fixturePrefix,
  modelCode: 'CERTV2H110',
  name: `${fixturePrefix} FAMILIA`,
  sellerId: 'cert-preprod-v2-h110-seller',
  sellerName: 'CERTV2 Operador',
  clientId: 'cert-preprod-v2-h110-client',
  clientName: 'CERTV2 Cliente',
};
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jsx': 'text/babel', '.css': 'text/css' };
const server = createServer((request, response) => {
  let pathname = decodeURIComponent(request.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const file = join(root, pathname);
  if (!file.startsWith(root) || !existsSync(file)) { response.writeHead(404); response.end('nf'); return; }
  response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));

let passed = 0;
let failed = 0;
const pageErrors = [];
const remoteAttempts = [];
const remoteResponses = [];
const steps = [];
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? passed++ : failed++;
  if (!condition) {
    const error = new Error(`${name}${detail ? `: ${detail}` : ''}`);
    error.certificationAssertion = true;
    throw error;
  }
};
const readDownload = async download => {
  try {
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch (error) {
    const temporaryPath = await download.path();
    if (!temporaryPath) throw error;
    return readFile(temporaryPath);
  }
};
const nav = async (page, label) => {
  await page.locator('nav button').filter({ hasText: label }).click();
  await page.waitForTimeout(350);
  steps.push(label);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let context;
let cleanupResult = null;
try {
  context = await browser.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  context.on('response', response => { if (/supabase\.co/.test(response.url())) remoteResponses.push(response.url()); });
  await context.route(/supabase\.co/, route => {
    remoteAttempts.push({ method: route.request().method(), url: route.request().url() });
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.addInitScript(() => {
    window.print = () => { window.__certPrints = (window.__certPrints || 0) + 1; };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.XLSXIO && window.BARCODES, null, { timeout: 30000 });

  const setup = await page.evaluate(fx => {
    const D = window.DATA;
    const arrays = {};
    Object.entries(D).forEach(([key, value]) => { if (Array.isArray(value)) arrays[key] = JSON.stringify(value); });
    const storage = {};
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index); storage[key] = localStorage.getItem(key);
    }
    window.__certH110 = {
      arrays, storage,
      auth: window.AUTH,
      storeMethods: {},
      modelKind: window.CONFIG.modeloKind ? window.CONFIG.modeloKind() : null,
    };
    if (window.STORE) Object.keys(window.STORE).forEach(key => {
      if (typeof window.STORE[key] === 'function' && /^(push|sync|fetch|pull)/i.test(key)) {
        window.__certH110.storeMethods[key] = window.STORE[key];
        window.STORE[key] = async () => ({ ok: true, isolated: true });
      }
    });
    window.AUTH = Object.assign({}, window.AUTH || {}, {
      current: () => ({ nombre: fx.sellerName, email: 'cert-v2-h110@example.invalid' }),
      canAccess: () => true,
    });
    const modelKind = window.__certH110.modelKind;
    if (modelKind) {
      const added = window.CONFIG.addItem(modelKind, { code: fx.modelCode, label: fx.name, meta: { certificationFixture: fx.prefix } });
      if (!added.ok) throw new Error('No se pudo crear el modelo sintético: ' + added.error);
    }
    D.sellers.push({ id: fx.sellerId, nombre: fx.sellerName, iniciales: 'CV', color: '#73510d', role: 'vendedor', active: true, comisionPct: 0 });
    D.clients.push({ id: fx.clientId, nombre: fx.clientName, tel: '000 110 0110', compras: 0, total: 0, ultima: '', talla: '', notas: fx.prefix, generic: false });
    D.saveSellers(); D.saveClients();
    return { modelKind, baselineArrayNames: Object.keys(arrays), baselineStorageKeys: Object.keys(storage).sort() };
  }, fixture);
  check('0. el aislamiento capturó estado reversible', setup.baselineArrayNames.includes('products') && !!setup.modelKind);

  // 1. Alta real de una familia V2 desde Inventario.
  await nav(page, 'Inventario');
  await page.getByTestId('inventory-new-product').click();
  await page.getByTestId('product-form').waitFor();
  await page.getByTestId('product-name').selectOption(fixture.modelCode);
  await page.getByTestId('product-general-price').fill('640');
  const productSelects = page.locator('[data-testid^="product-field-"]');
  for (let index = 0; index < await productSelects.count(); index++) {
    const select = productSelects.nth(index);
    if (await select.inputValue()) continue;
    const value = await select.locator('option').evaluateAll(options => (options.find(option => option.value) || {}).value || '');
    if (value) await select.selectOption(value);
  }
  const ornament = page.getByTestId('product-ornament');
  if (!await ornament.inputValue()) {
    const value = await ornament.locator('option').evaluateAll(options => (options.find(option => option.value) || {}).value || '');
    if (value) await ornament.selectOption(value);
  }
  const sizeCategory = page.getByTestId('product-size-category');
  const category = await sizeCategory.locator('option').evaluateAll(options => (options.find(option => option.value) || {}).value || '');
  await sizeCategory.selectOption(category);
  const stockInputs = page.locator('[data-testid^="family-stock-"]');
  check('1. alta expone captura familiar V2', await stockInputs.count() >= 2);
  await stockInputs.nth(0).fill('5');
  await stockInputs.nth(1).fill('5');
  await page.getByTestId('product-save').click();
  await page.getByTestId('product-form').waitFor({ state: 'detached' });
  const created = await page.evaluate(fx => {
    const refs = window.DATA.products.filter(product => product.nombre === fx.name && product.recordModel === 'v2');
    return { ids: refs.map(row => row.id), familyId: refs[0] && refs[0].referenceFamilyId,
      barcodes: refs.map(row => row.barcodeCode), skus: refs.map(row => row.sku), sizes: refs.map(row => String(row.sizeCode)), stocks: refs.map(row => row.stockQuantity) };
  }, fixture);
  check('2. el alta creó sólo dos referencias identificables', created.ids.length === 2 && created.ids.every(Boolean), JSON.stringify(created.ids));
  check('3. las referencias nacen con identidad física y stock sintético', created.barcodes.every(Boolean) && created.stocks.every(value => value === 5));

  // 2. Inventario y Detalle.
  const familyRow = page.getByTestId(`inventory-product-family:${created.familyId}`);
  await familyRow.waitFor();
  check('4. Inventario proyecta una sola familia', await familyRow.count() === 1);
  await familyRow.click();
  await page.getByRole('dialog', { name: 'Detalle del producto' }).waitFor();
  const detailText = await page.getByRole('dialog', { name: 'Detalle del producto' }).innerText();
  check('5. Detalle conserva las dos referencias exactas', created.sizes.every(size => detailText.includes(size)) && /Varios SKU/.test(detailText), detailText.replace(/\s+/g, ' ').slice(0, 240));
  await page.getByTestId('product-detail-close').click();

  // 3. POS y venta: tres piezas de la primera referencia exacta.
  await nav(page, 'Punto de venta');
  const scan = page.getByPlaceholder(/Escanea código de barras/);
  for (let index = 0; index < 3; index++) { await scan.fill(created.barcodes[0]); await scan.press('Enter'); await page.waitForTimeout(120); }
  const cartText = await page.locator('aside').filter({ hasText: 'Resumen de venta' }).innerText();
  check('6. POS agregó tres piezas por barcode de referencia', cartText.includes(fixture.name) && /remove\s+3\s+add/i.test(cartText), cartText.replace(/\s+/g, ' ').slice(0, 220));
  await page.getByRole('button', { name: 'Completar venta', exact: true }).click();
  await page.getByTestId('checkout-method-Efectivo').click();
  await page.getByTestId('checkout-recibido').fill('5000');
  await page.getByTestId('checkout-confirmar').click();
  const sellerDialog = page.locator('[role="dialog"]').last();
  await sellerDialog.locator('button').filter({ hasText: 'CERTV2' }).click();
  await sellerDialog.getByRole('button', { name: 'Confirmar vendedor', exact: true }).click();
  await page.getByText('Venta exitosa', { exact: true }).waitFor();
  const sale = await page.evaluate(fx => {
    const row = window.DATA.sales.find(item => (item.sellerIds || []).includes(fx.sellerId) || item.vendedorId === fx.sellerId || String(item.vendedor || '').includes('CERTV2'));
    return row && { id: row.id, folio: row.folio, total: row.total, lineas: row.lineas };
  }, fixture);
  check('7. venta persistió identidad de la referencia', !!sale && sale.lineas.some(line => line.productId === created.ids[0]), sale && sale.folio);
  await page.locator('[role="dialog"]').last().getByRole('button', { name: 'Nueva venta', exact: true }).click();

  // 4. Devolución de una pieza sobre la misma venta.
  await nav(page, 'Devoluciones');
  await page.getByTestId('operacion-devolucion').click();
  await page.getByPlaceholder(/Buscar por folio/).fill(sale.folio);
  await page.getByRole('button', { name: new RegExp(sale.folio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  const returnCard = page.locator('div.bg-surface-container-lowest').filter({ hasText: fixture.name }).first();
  await returnCard.locator('button').first().click();
  await returnCard.locator('select').selectOption({ index: 1 });
  await page.getByTestId('return-confirm').click();
  await page.getByText('Devolucion registrada', { exact: true }).waitFor();
  const returned = await page.evaluate(folio => {
    const row = window.DATA.returns.find(item => item.folio === folio || item.origenFolio === folio || item.saleFolio === folio);
    return row && { id: row.id, total: row.total, lineas: row.lineas };
  }, sale.folio);
  check('8. devolución consumió exactamente una pieza', !!returned && returned.lineas.reduce((sum, line) => sum + Number(line.qty || 0), 0) === 1);
  await page.getByRole('button', { name: 'Listo', exact: true }).click();

  // 5. Cambio de otra pieza por la segunda referencia de la misma familia.
  await page.getByTestId('operacion-cambio').click();
  await page.getByPlaceholder(/Buscar por folio/).fill(sale.folio);
  await page.getByRole('button', { name: new RegExp(sale.folio.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).click();
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByTestId('cambio-escaner').fill(created.barcodes[1]);
  await page.getByTestId('cambio-escaner').press('Enter');
  await page.getByTestId('cambio-accion').click();
  await page.getByTestId('cambio-vendedor').filter({ hasText: 'CERTV2' }).click();
  await page.getByText('Cambio registrado', { exact: true }).waitFor();
  const exchanged = await page.evaluate(folio => {
    const row = window.DATA.exchanges.find(item => item.origenFolio === folio);
    return row && { id: row.id, folio: row.folio, lineas: row.lineas };
  }, sale.folio);
  check('9. cambio enlazó entrega y recepción por products.id', !!exchanged && exchanged.lineas.some(line => line.productId === created.ids[1]));
  await page.locator('[role="dialog"]').last().getByRole('button', { name: 'Listo', exact: true }).click();

  // 6. Préstamo sobre la segunda referencia exacta.
  await nav(page, 'Préstamos');
  await page.getByTestId('loans-nuevo').click();
  await page.getByTestId('prestamo-buscar-producto').fill(fixture.name);
  await page.getByTestId(`prestamo-producto-family:${created.familyId}`).click();
  await page.getByTestId(`reference-family-pick-${created.ids[1]}`).click();
  await page.getByTestId('prestamo-persona').fill('CERTV2');
  await page.getByTestId(`prestamo-candidato-${fixture.clientId}`).click();
  await page.getByTestId('prestamo-plazo-7').click();
  await page.getByTestId('prestamo-nota').fill(fixture.prefix);
  await page.getByTestId('prestamo-confirmar').click();
  const loan = await page.evaluate(fx => {
    const row = window.DATA.loans.find(item => String(item.notas || item.nota || '').includes(fx.prefix) || (item.persona && item.persona.nombre === fx.clientName));
    return row && { id: row.id, folio: row.folio, lineas: row.lineas };
  }, fixture);
  check('10. préstamo conserva referencia física exacta', !!loan && loan.lineas.some(line => line.productId === created.ids[1] || line.barcodeCode === created.barcodes[1]));

  // 7. Etiquetas PDF desde Detalle, sin guardar archivo en el checkout.
  await nav(page, 'Inventario');
  await page.getByTestId(`inventory-product-family:${created.familyId}`).click();
  await page.getByTestId('product-detail-labels').click();
  check('11. etiquetas ofrece ambas referencias exactas', await page.locator('[data-testid^="label-reference-select-"]').count() === 2);
  const labelDownloadPromise = page.waitForEvent('download');
  await page.getByTestId('labels-download').click();
  const labelDownload = await labelDownloadPromise;
  const labelBytes = await readDownload(labelDownload);
  const labelRaw = labelBytes.toString('latin1');
  check('12. etiquetas generan PDF real sólo en memoria', labelRaw.startsWith('%PDF-') && labelRaw.trimEnd().endsWith('%%EOF'), `${labelBytes.length} bytes`);
  await page.getByTestId('label-modal-close').click();
  await page.getByTestId('product-detail-close').click();

  // 8. Excel real desde el botón de Inventario, leído en memoria.
  const excelDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const excelDownload = await excelDownloadPromise;
  const excelBytes = await readDownload(excelDownload);
  const excelCheck = await page.evaluate(([base64, ids, name]) => {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const workbook = window.XLSX.read(bytes, { type: 'array' });
    const text = workbook.SheetNames.map(sheet => JSON.stringify(window.XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: '' }))).join('\n');
    return { sheets: workbook.SheetNames, hasName: text.includes(name), ids: ids.map(id => text.includes(id)) };
  }, [excelBytes.toString('base64'), created.ids, fixture.name]);
  check('13. Excel contiene la familia y ambos products.id', excelCheck.hasName && excelCheck.ids.every(Boolean), excelCheck.sheets.join(', '));

  // 9. Limpieza exacta, incluso de contadores, colas y configuración local.
  cleanupResult = await page.evaluate(async fx => {
    const D = window.DATA;
    const snapshot = window.__certH110;
    Object.entries(snapshot.arrays).forEach(([key, json]) => {
      if (!Array.isArray(D[key])) return;
      const rows = JSON.parse(json);
      D[key].splice(0, D[key].length, ...(key === 'products' ? rows.map(row => D.hydrate(row)) : rows));
    });
    if (snapshot.modelKind && window.CONFIG.find(snapshot.modelKind, fx.modelCode)) {
      const removed = window.CONFIG.removeItem(snapshot.modelKind, fx.modelCode);
      if (!removed.ok) throw new Error('No se pudo retirar catálogo fixture: ' + removed.error);
    }
    localStorage.clear();
    Object.entries(snapshot.storage).forEach(([key, value]) => localStorage.setItem(key, value));
    if (window.STORE) Object.entries(snapshot.storeMethods).forEach(([key, value]) => { window.STORE[key] = value; });
    window.AUTH = snapshot.auth;
    const arraysExact = Object.entries(snapshot.arrays).every(([key, json]) => JSON.stringify(D[key]) === json);
    const storageNow = {};
    for (let index = 0; index < localStorage.length; index++) { const key = localStorage.key(index); storageNow[key] = localStorage.getItem(key); }
    const storageExact = JSON.stringify(Object.keys(storageNow).sort().map(key => [key, storageNow[key]]))
      === JSON.stringify(Object.keys(snapshot.storage).sort().map(key => [key, snapshot.storage[key]]));
    let indexedDbResidue = [];
    if (indexedDB.databases) {
      for (const info of await indexedDB.databases()) {
        if (!info.name) continue;
        const db = await new Promise((resolveDb, reject) => { const req = indexedDB.open(info.name); req.onsuccess = () => resolveDb(req.result); req.onerror = () => reject(req.error); });
        for (const storeName of Array.from(db.objectStoreNames)) {
          const values = await new Promise((resolveRows, reject) => { const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll(); req.onsuccess = () => resolveRows(req.result); req.onerror = () => reject(req.error); });
          if (JSON.stringify(values).includes(fx.prefix) || JSON.stringify(values).includes(fx.modelCode)) indexedDbResidue.push(`${info.name}/${storeName}`);
        }
        db.close();
      }
    }
    const allData = JSON.stringify(Object.fromEntries(Object.entries(D).filter(([, value]) => Array.isArray(value))));
    return { arraysExact, storageExact, indexedDbResidue,
      catalogRemoved: !snapshot.modelKind || !window.CONFIG.find(snapshot.modelKind, fx.modelCode),
      fixtureResidue: allData.includes(fx.prefix) || allData.includes(fx.sellerId) || allData.includes(fx.clientId),
    };
  }, fixture);
  check('14. limpieza restauró exactamente todas las colecciones DATA', cleanupResult.arraysExact);
  check('15. limpieza restauró exactamente localStorage', cleanupResult.storageExact);
  check('16. limpieza retiró catálogo e IndexedDB del fixture', cleanupResult.catalogRemoved && !cleanupResult.fixtureResidue && cleanupResult.indexedDbResidue.length === 0, JSON.stringify(cleanupResult));
  check('17. ninguna escritura alcanzó Supabase', remoteResponses.length === 0,
    `${remoteAttempts.length} intento(s) bloqueado(s), 0 alcanzaron red`);
  check('18. recorrido único cubrió los ocho módulos', ['Inventario', 'Punto de venta', 'Devoluciones', 'Préstamos'].every(step => steps.includes(step)), steps.join(' → '));
  check('19. el navegador no emitió errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) {
  console.error(`❌ Certificación interrumpida: ${error.stack || error}`);
  if (!error.certificationAssertion) failed++;
  // Si una aserción corta el flujo, intenta la misma restauración antes de cerrar
  // el contexto. El perfil es efímero, pero el contrato exige probar la limpieza.
  if (context) {
    const pages = context.pages();
    const page = pages[0];
    if (page && !page.isClosed()) {
      try {
        cleanupResult = await page.evaluate(fx => {
          const D = window.DATA, snapshot = window.__certH110;
          if (!D || !snapshot) return { emergency: false };
          Object.entries(snapshot.arrays).forEach(([key, json]) => {
            if (!Array.isArray(D[key])) return;
            const rows = JSON.parse(json);
            D[key].splice(0, D[key].length, ...(key === 'products' ? rows.map(row => D.hydrate(row)) : rows));
          });
          if (snapshot.modelKind && window.CONFIG.find(snapshot.modelKind, fx.modelCode)) window.CONFIG.removeItem(snapshot.modelKind, fx.modelCode);
          localStorage.clear(); Object.entries(snapshot.storage).forEach(([key, value]) => localStorage.setItem(key, value));
          return { emergency: true };
        }, fixture);
        console.log('🧹 Limpieza de emergencia ejecutada');
      } catch (cleanupError) { console.error('❌ Limpieza de emergencia falló:', cleanupError); }
    }
  }
} finally {
  if (context) await context.close();
  await browser.close();
  server.close();
}

console.log(`\n${passed} pasaron, ${failed} fallaron · fixture ${fixturePrefix}`);
process.exit(failed ? 1 : 0);
