// H-101 · A–G: familia administrativa mixta, altas normales y reclasificación explícita.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const file = resolve(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html');
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).on('error', () => { res.writeHead(404); res.end(); }).pipe(res);
});
await new Promise(done => server.listen(8914, '127.0.0.1', done));

let pass = 0, fail = 0;
const ok = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
};

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
  await page.goto('http://127.0.0.1:8914/index.html');
  await page.waitForFunction(() => window.DATA && window.CONFIG);

  const seeded = await page.evaluate(() => {
    const D = window.DATA;
    const modelKind = window.CONFIG.modeloKind();
    if (!window.CONFIG.list(modelKind).some(item => item.code === 'ADR')) {
      window.CONFIG.addItem(modelKind, { code: 'ADR', label: 'ADRIANO', active: true });
    }
    const common = {
      recordModel: 'v2', cat: '1', modelo: 'ADR', nombre: 'ADRIANO', manga: 'MC', tela: 'LIN',
      color: 'BL', cuello: 'MAO', orn: 'Bordado Eléctrico', precio: 1150, costo: 500, pop: false,
      ornamentColorCodes: ['DRO'], ornColors: ['DRO'],
      attrs: { producto: 'ADR', corte: 'SLF', caracteristicas: '23', __sizeCategoryId: 'size_letter' },
      sizeCategoryId: 'size_letter',
    };
    const familyId = '10110000-0000-4000-8000-000000000101';
    const zeroFamilyId = '10110000-0000-4000-8000-000000000102';
    const first = D.materializeReferenceFamily(common, [
      { selectedForCreation: true, sizeCategoryId: 'size_letter', sizeCode: 'M', sizeScale: 'L', stockQuantity: 3 },
      { selectedForCreation: true, sizeCategoryId: 'size_letter', sizeCode: 'L', sizeScale: 'L', stockQuantity: 4 },
      { selectedForCreation: true, sizeCategoryId: 'size_letter', sizeCode: 'XL', sizeScale: 'L', stockQuantity: 2 },
    ], [], familyId).references;
    const second = D.materializeReferenceFamily({ ...common, modelo: 'ADR0', nombre: 'ADRIANO CERO',
      ornamentColorCodes: ['AZL'], ornColors: ['AZL'] }, [
      { selectedForCreation: true, sizeCategoryId: 'size_letter', sizeCode: 'M', sizeScale: 'L', stockQuantity: 1 },
      { selectedForCreation: true, sizeCategoryId: 'size_letter', sizeCode: 'L', sizeScale: 'L', stockQuantity: 1 },
    ], first, zeroFamilyId).references;
    localStorage.setItem('balam_pos_products_v2', JSON.stringify(first.concat(second)));
    return {
      familyId, zeroFamilyId,
      initialIds: first.map(row => row.id), initialBarcodes: Object.fromEntries(first.map(row => [row.id, row.barcodeCode])),
      mId: first.find(row => row.sizeCode === 'M').id, lId: first.find(row => row.sizeCode === 'L').id,
      zeroMId: second.find(row => row.sizeCode === 'M').id, zeroInitialIds: second.map(row => row.id),
    };
  });
  await page.reload();
  await page.waitForFunction(id => window.DATA?.products?.some(row => row.id === id), seeded.mId);

  const openEdit = async id => {
    await page.getByTestId('inventory-product-' + id).click();
    await page.getByTestId('product-detail-edit').click();
    await page.getByTestId('reference-family-grid').waitFor();
  };
  const fillCompactSize = async (categoryId, label, quantity) => {
    const group = page.getByTestId('family-size-group-' + categoryId);
    const stockTestId = await group.evaluate((node, expected) => {
      const row = [...node.querySelectorAll('[data-testid^="family-row-"]')]
        .find(item => item.querySelector('label')?.innerText.trim() === expected);
      return row?.querySelector('[data-testid^="family-stock-"]')?.dataset.testid || '';
    }, label);
    if (!stockTestId) throw new Error(`No se encontró talla ${label} en ${categoryId}`);
    await page.getByTestId(stockTestId).fill(String(quantity));
  };
  const familySnapshot = familyId => page.evaluate(id => window.DATA.products
    .filter(row => row.referenceFamilyId === id && !row._deletedAt)
    .map(row => ({ id: row.id, barcode: row.barcodeCode, category: row.sizeCategoryId,
      size: row.sizeCode, scale: row.sizeScale, stock: row.stockQuantity, colors: row.ornamentColorCodes })), familyId);

  // A · alta normal en la misma escala.
  await openEdit(seeded.mId);
  await fillCompactSize('size_letter', '2XL', 1);
  await page.getByTestId('product-save').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="product-form"]'));
  const afterA = await familySnapshot(seeded.familyId);
  ok('A. agregar 2XL crea un ID nuevo y conserva M/L/XL', afterA.length === 4
    && afterA.some(row => row.size === '2XL' && row.category === 'size_letter')
    && seeded.initialIds.every(id => afterA.some(row => row.id === id)));
  ok('A. IDs y barcodes existentes permanecen intactos', seeded.initialIds.every(id =>
    afterA.find(row => row.id === id)?.barcode === seeded.initialBarcodes[id]));

  // B/G · el selector sólo cambia el conjunto de captura; no toca DATA hasta guardar.
  await openEdit(seeded.mId);
  const beforeSelector = JSON.stringify(await familySnapshot(seeded.familyId));
  await page.getByTestId('product-size-category').selectOption('size_number');
  await page.getByTestId('family-size-group-size_number').waitFor();
  const afterSelector = JSON.stringify(await familySnapshot(seeded.familyId));
  const selectorText = await page.getByTestId('reference-family-grid').innerText();
  ok('G. cambiar selector no muta referencias ni exige reclasificación', beforeSelector === afterSelector
    && !/Usa Reclasificar piezas/.test(selectorText));
  ok('B. la captura numérica convive con las referencias de letra visibles', await page.getByTestId('family-size-group-size_letter').count() === 1
    && await page.getByTestId('family-size-group-size_number').count() === 1);
  await fillCompactSize('size_number', '40', 2);
  await page.getByTestId('product-save').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="product-form"]'));
  const afterB = await familySnapshot(seeded.familyId);
  const numeric40 = afterB.find(row => row.category === 'size_number' && row.size === '40');
  ok('B. agregar 40 crea otra referencia V2 en la misma familia', afterB.length === 5 && !!numeric40
    && seeded.initialIds.every(id => afterB.some(row => row.id === id)));

  // C · convertir el mismo ID bloqueado sigue siendo reclasificación.
  const directConversion = await page.evaluate(id => {
    const current = window.DATA.products.find(row => row.id === id);
    const before = JSON.stringify(current);
    try {
      window.DATA.updateReference({ ...current, sizeCategoryId: 'size_number', sizeCode: '40', sizeScale: 'N',
        attrs: { ...(current.attrs || {}), __sizeCategoryId: 'size_number' } });
      return { code: null, unchanged: before === JSON.stringify(current) };
    } catch (error) {
      return { code: error.code, unchanged: before === JSON.stringify(current) };
    }
  }, seeded.lId);
  await page.getByTestId('inventory-product-' + seeded.lId).click();
  const reclassAction = await page.getByTestId('product-detail-reclassify').count();
  await page.getByTestId('product-detail-close').click();
  ok('C. convertir el mismo ID sigue bloqueado sin exponer reclasificación en Inventario', directConversion.code === 'REFERENCE_RECLASSIFICATION_REQUIRED'
    && directConversion.unchanged && reclassAction === 0, JSON.stringify(directConversion));

  // D/F · el borrador puede cambiar antes de confirmar; una variante 40/AZL crea otro ID.
  await openEdit(numeric40.id);
  await page.getByTestId('family-add-variant').click();
  const draftRowKey = await page.evaluate(() => {
    const container = [...document.querySelectorAll('[data-testid^="family-variant-"]')]
      .find(node => /^family-variant-draft-/.test(node.dataset.testid || '') && node.querySelector('select[data-testid^="family-variant-size-"]'));
    return (container?.dataset.testid || '').replace(/^family-variant-/, '');
  });
  const draftSize = page.getByTestId('family-variant-size-' + draftRowKey);
  const beforeDraftChange = JSON.stringify(await familySnapshot(seeded.familyId));
  await draftSize.selectOption('42');
  const changedDraftValue = await draftSize.inputValue();
  const afterDraftChange = JSON.stringify(await familySnapshot(seeded.familyId));
  ok('D. una referencia aún no guardada puede cambiar de talla', changedDraftValue === '42'
    && beforeDraftChange === afterDraftChange);
  await draftSize.selectOption('40');
  await page.getByTestId('family-variant-' + draftRowKey + '-colors').click();
  await page.getByTestId('family-variant-' + draftRowKey + '-color-DRO').click();
  await page.getByTestId('family-variant-' + draftRowKey + '-color-AZL').click();
  await page.getByTestId('family-variant-' + draftRowKey + '-colors-close').click();
  await page.getByTestId('product-save').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="product-form"]'));
  const afterF = await familySnapshot(seeded.familyId);
  const size40Rows = afterF.filter(row => row.category === 'size_number' && row.size === '40');
  ok('F. 40/DRO y 40/AZL son dos referencias físicas independientes', size40Rows.length === 2
    && new Set(size40Rows.map(row => row.id)).size === 2 && new Set(size40Rows.map(row => row.barcode)).size === 2
    && size40Rows.some(row => JSON.stringify(row.colors) === JSON.stringify(['DRO']))
    && size40Rows.some(row => JSON.stringify(row.colors) === JSON.stringify(['AZL'])), JSON.stringify(size40Rows));

  // E · alta explícita con existencia cero mediante una única acción agrupada.
  await openEdit(seeded.zeroMId);
  await page.getByTestId('family-zero-sizes-toggle').click();
  await page.getByTestId('family-zero-sizes-panel').getByRole('button', { name: 'XL', exact: true }).click();
  await page.getByTestId('product-save').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="product-form"]'));
  const afterE = await familySnapshot(seeded.zeroFamilyId);
  ok('E. agregar XL sin existencia crea un ID nuevo en cero', afterE.length === 3
    && afterE.some(row => row.size === 'XL' && row.stock === 0)
    && seeded.zeroInitialIds.every(id => afterE.some(row => row.id === id)));

  ok('Contrato mixto. No hubo errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
