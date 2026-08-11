// H-86 · Contrato canónico de Plantilla / Exportar / Importar.
// La primera sección es deliberadamente estructural para fijar en rojo el
// contrato ausente antes de implementar; las secciones conductuales se ejecutan
// sobre el bundle real después de regenerarlo.
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const xlsx = read('./balam/xlsx-io.jsx');
const inventory = read('./balam/inventory.jsx');

let pass = 0, fail = 0;
function check(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
}

check('publica una autoridad INVENTORY_XLSX_SCHEMA', /INVENTORY_XLSX_SCHEMA/.test(xlsx));
check('Plantilla y Exportar delegan en un solo escritor', /writeInventoryWorkbook\(\[\]/.test(xlsx) && /writeInventoryWorkbook\(products/.test(xlsx));
check('la plantilla no contiene fila EJEMPLO', !/EJEMPLO [^\n]+borra esta fila/.test(xlsx));
check('el esquema transporta precios especiales por talla', /Precios especiales por talla/.test(xlsx));
check('el esquema transporta costo y destacado', /['"]Costo['"]/.test(xlsx) && /['"]Destacado['"]/.test(xlsx));
check('el esquema transporta identidad y versión técnicas', /_BALAM_ID_PRODUCTO/.test(xlsx) && /_BALAM_VERSION_PRODUCTO/.test(xlsx));
check('el libro contiene hoja técnica _BALAM', /['_"]BALAM/.test(xlsx) && /schema_version/.test(xlsx));
check('el aplicador anterior por primer SKU fue retirado', !/if \(p\.sku && !bySku\[p\.sku\]\)/.test(inventory));
check('la vista previa muestra conflictos y campos modificados', /conflictos/i.test(inventory) && /campos modificados/i.test(inventory));
check('la confirmación consume un plan prevalidado', /applyImportPlan/.test(inventory));

const ROOT = path.resolve('.');
const ARTIFACT_PATH = String(process.env.H86_ARTIFACT_PATH || '').trim();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const file = pathname === '/index.html' && ARTIFACT_PATH ? path.resolve(ARTIFACT_PATH) : path.join(ROOT, pathname);
  const allowed = file.startsWith(ROOT) || (ARTIFACT_PATH && file === path.resolve(ARTIFACT_PATH));
  if (!allowed || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(8860, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
await page.route(/supabase\.co/, route => route.abort());
await page.addInitScript(() => localStorage.setItem('balam-page', 'inventory'));
await page.goto('http://127.0.0.1:8860/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG && window.XLSXIO && window.XLSX, null, { timeout: 30000 });

const result = await page.evaluate(async () => {
  const D = window.DATA, IO = window.XLSXIO, X = window.XLSX;
  if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; }
  const clone = value => JSON.parse(JSON.stringify(value));
  const stock = values => ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL']
    .map((talla, index) => ({ talla, escala: 'L', stock: Number(values[index]) || 0 }));
  const make = (id, sku, over) => D.hydrate(Object.assign({
    id, _syncVersion: 7, sku, cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'MAO',
    modelo: 'ADR', nombre: 'ADRIANA', orn: 'Bordado Eléctrico', ornColors: ['OR', 'CF'],
    precio: 650, costo: 275, pop: true, imagen: 'https://example.test/adriana.jpg',
    preciosTalla: { XL: 725 }, attrs: { __sizeCategoryId: 'size_letter', __ornamentColorsBySize: { XS: ['OR', 'CF'], XL: ['PL'] } },
    sizeCategoryId: 'size_letter', stock: stock([10, 20, 30, 15, 12]),
  }, over || {}));
  const toFile = (wb, name) => new File([X.write(wb, { bookType: 'xlsx', type: 'array' })], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const product = make('prod-h86', '21-MC-ALG-BL-T');
  const reference = D.createReference({
    cat: '21', manga: 'ML', tela: 'POL', color: 'AZ', cuello: 'ITA', modelo: 'V2X',
    nombre: 'REFERENCIA V2', orn: 'Bordado Eléctrico', ornamentColorCodes: ['PLT', 'DRO'],
    sizeCategoryId: 'size_number', sizeCode: '40', sizeScale: 'N', stockQuantity: 7,
    precio: 980, costo: 410, sku: '21-V2X-ML-POL-AZ-40', attrs: { __sizeCategoryId: 'size_number' },
  }, []);
  const template = IO.__test.inventoryWorkbook([]).wb;
  const exported = IO.__test.inventoryWorkbook([product]).wb;
  const templateHeaders = X.utils.sheet_to_json(template.Sheets.Inventario, { header: 1, defval: '' })[0];
  const exportHeaders = X.utils.sheet_to_json(exported.Sheets.Inventario, { header: 1, defval: '' })[0];
  const templateRows = X.utils.sheet_to_json(template.Sheets.Inventario, { defval: '' });
  const parsed = await IO.parseFile(toFile(exported, 'roundtrip.xlsx'));
  const plan = IO.planImport(parsed, [product], {});
  const applied = [clone(product)];
  const appliedResult = IO.applyImportPlan(plan, applied);
  const beforeState = IO.__test.canonicalProductState(product);
  const afterState = IO.__test.canonicalProductState(applied[0]);
  const v2Parsed = await IO.parseFile(toFile(IO.__test.inventoryWorkbook([reference]).wb, 'reference-v2.xlsx'));
  const v2Plan = IO.planImport(v2Parsed, [reference], {});
  const v2Applied = [clone(reference)];
  if (v2Plan.ok) IO.applyImportPlan(v2Plan, v2Applied);
  const v2RoundtripSame = JSON.stringify(IO.__test.canonicalProductState(reference))
    === JSON.stringify(IO.__test.canonicalProductState(v2Applied[0]));
  const wrongModel = clone(product); wrongModel.id = reference.id; wrongModel._syncVersion = 0;
  const modelMismatchPlan = IO.planImport(v2Parsed, [wrongModel], {});
  const samePhysical = D.createReference(Object.assign({}, clone(reference), {
    id: undefined, barcodeCode: undefined, physicalSignature: undefined,
  }), []);
  const physicalDuplicateBook = IO.__test.inventoryWorkbook([reference, samePhysical]).wb;
  const physicalDuplicateRows = X.utils.sheet_to_json(physicalDuplicateBook.Sheets.Inventario, { defval: '' });
  physicalDuplicateRows.forEach(row => { row._BALAM_ID_PRODUCTO = ''; row._BALAM_VERSION_PRODUCTO = ''; });
  physicalDuplicateBook.Sheets.Inventario = X.utils.json_to_sheet(physicalDuplicateRows, {
    header: X.utils.sheet_to_json(physicalDuplicateBook.Sheets.Inventario, { header: 1, defval: '' })[0],
  });
  const physicalDuplicateParsed = await IO.parseFile(toFile(physicalDuplicateBook, 'physical-duplicate-v2.xlsx'));
  const physicalDuplicatePlan = IO.planImport(physicalDuplicateParsed, [], {});
  const lockedBook = IO.__test.inventoryWorkbook([reference]).wb;
  const lockedRows = X.utils.sheet_to_json(lockedBook.Sheets.Inventario, { defval: '' });
  lockedRows[0]['Color Tela'] = 'BL';
  lockedBook.Sheets.Inventario = X.utils.json_to_sheet(lockedRows, {
    header: X.utils.sheet_to_json(lockedBook.Sheets.Inventario, { header: 1, defval: '' })[0],
  });
  const lockedParsed = await IO.parseFile(toFile(lockedBook, 'locked-v2.xlsx'));
  const lockedReference = clone(reference); lockedReference.stockQuantity = 0;
  lockedReference.stock = [{ talla: lockedReference.sizeCode, escala: lockedReference.sizeScale, stock: 0 }];
  lockedReference.physicalIdentityLocked = true;
  const lockedPlan = IO.planImport(lockedParsed, [lockedReference], {});

  // Mover columnas sin alterar encabezados ni mapa.
  const movedWb = X.read(X.write(exported, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
  const movedRows = X.utils.sheet_to_json(movedWb.Sheets.Inventario, { defval: '' });
  const movedHeaders = exportHeaders.slice().reverse();
  movedWb.Sheets.Inventario = X.utils.json_to_sheet(movedRows, { header: movedHeaders });
  const movedParsed = await IO.parseFile(toFile(movedWb, 'moved.xlsx'));

  // Heredado: sin metadatos ni campos H-86. La resolución es explícita y
  // costo/precio especial ausentes deben quedar PRESERVAR.
  const canonicalRow = IO.__test.rowFromProduct(product, IO.sizeColumns());
  const legacyRow = clone(canonicalRow);
  ['Precios especiales por talla', 'Costo', 'Destacado', '_BALAM_ID_PRODUCTO', '_BALAM_VERSION_PRODUCTO'].forEach(key => delete legacyRow[key]);
  const legacyHeaders = Object.keys(legacyRow);
  const legacyWb = X.utils.book_new();
  X.utils.book_append_sheet(legacyWb, X.utils.json_to_sheet([legacyRow], { header: legacyHeaders }), 'Inventario');
  const legacy = await IO.parseFile(toFile(legacyWb, 'legacy.xlsx'));
  const legacyBlocked = IO.planImport(legacy, [product], {});
  const legacyResolved = IO.planImport(legacy, [product], { 'row-0': product.id });

  // 239 filas / 222 SKU: 12 grupos duplicados, 29 productos implicados,
  // 17 filas excedentes. El plan debe ser inaplicable y dejar el arreglo vacío.
  const duplicateSizes = [3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2];
  const many = []; let sequence = 0;
  duplicateSizes.forEach((count, group) => {
    for (let n = 0; n < count; n++) many.push(make('', 'DUP-' + group, { _syncVersion: 0, nombre: `DUP ${group}-${n}`, modelo: String(sequence++) }));
  });
  for (let n = 0; n < 210; n++) many.push(make('', 'UNICO-' + n, { _syncVersion: 0, nombre: 'UNICO ' + n, modelo: String(sequence++) }));
  const manyParsed = await IO.parseFile(toFile(IO.__test.inventoryWorkbook(many).wb, '239.xlsx'));
  const manyPlan = IO.planImport(manyParsed, [], {});
  const emptyInventory = [];
  let applyBlocked = false;
  try { IO.applyImportPlan(manyPlan, emptyInventory); } catch (error) { applyBlocked = true; }

  // Versión incompatible y JSON inválido deben rechazarse antes del plan.
  const badVersion = X.read(X.write(exported, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
  const metaRows = X.utils.sheet_to_json(badVersion.Sheets._BALAM, { header: 1, defval: '' });
  const versionRow = metaRows.find(row => row[0] === 'schema_version'); versionRow[1] = 999;
  badVersion.Sheets._BALAM = X.utils.aoa_to_sheet(metaRows);
  let badVersionBlocked = false;
  try { await IO.parseFile(toFile(badVersion, 'bad-version.xlsx')); } catch (error) { badVersionBlocked = /incompatible/i.test(error.message); }
  const badJson = X.read(X.write(exported, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
  const badRows = X.utils.sheet_to_json(badJson.Sheets.Inventario, { defval: '' });
  badRows[0]['Precios especiales por talla'] = '{mal';
  badJson.Sheets.Inventario = X.utils.json_to_sheet(badRows, { header: exportHeaders });
  let badJsonBlocked = false;
  try { await IO.parseFile(toFile(badJson, 'bad-json.xlsx')); } catch (error) { badJsonBlocked = /JSON inválido/i.test(error.message); }
  const missingColumn = X.read(X.write(exported, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
  const missingRows = X.utils.sheet_to_json(missingColumn.Sheets.Inventario, { defval: '' });
  missingRows.forEach(row => delete row.Costo);
  missingColumn.Sheets.Inventario = X.utils.json_to_sheet(missingRows, { header: exportHeaders.filter(header => header !== 'Costo') });
  let missingColumnBlocked = false;
  try { await IO.parseFile(toFile(missingColumn, 'missing.xlsx')); } catch (error) { missingColumnBlocked = /columna obligatoria.*Costo/i.test(error.message); }
  const duplicatedHeader = X.read(X.write(exported, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
  const duplicatedAoa = X.utils.sheet_to_json(duplicatedHeader.Sheets.Inventario, { header: 1, defval: '' });
  duplicatedAoa[0][duplicatedAoa[0].indexOf('Costo')] = 'Precio';
  duplicatedHeader.Sheets.Inventario = X.utils.aoa_to_sheet(duplicatedAoa);
  let duplicatedHeaderBlocked = false;
  try { await IO.parseFile(toFile(duplicatedHeader, 'duplicate-header.xlsx')); } catch (error) { duplicatedHeaderBlocked = /repite la columna.*Precio/i.test(error.message); }
  const badSizeMap = X.read(X.write(exported, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
  const catalogAoa = X.utils.sheet_to_json(badSizeMap.Sheets['Catálogos'], { header: 1, defval: '' });
  const mapStart = catalogAoa.findIndex(row => String(row[0] || '').startsWith('MAPA DE COLUMNAS DE TALLA'));
  catalogAoa[mapStart + 2][1] = 'NO_EXISTE';
  badSizeMap.Sheets['Catálogos'] = X.utils.aoa_to_sheet(catalogAoa);
  let badSizeBlocked = false;
  try { await IO.parseFile(toFile(badSizeMap, 'bad-size.xlsx')); } catch (error) { badSizeBlocked = /talla|identidad/i.test(error.message); }
  const invalidCatalog = X.read(X.write(exported, { bookType: 'xlsx', type: 'array' }), { type: 'array' });
  const invalidRows = X.utils.sheet_to_json(invalidCatalog.Sheets.Inventario, { defval: '' });
  invalidRows[0]['Color Tela'] = 'NO_EXISTE';
  invalidCatalog.Sheets.Inventario = X.utils.json_to_sheet(invalidRows, { header: exportHeaders });
  const invalidParsed = await IO.parseFile(toFile(invalidCatalog, 'invalid-catalog.xlsx'));
  const invalidPlan = IO.planImport(invalidParsed, [product], {});
  const cloneSku = clone(product); cloneSku.id = 'prod-h86-clon';
  const duplicatedCurrentPlan = IO.planImport(parsed, [product, cloneSku], {});

  return {
    sheetsEqual: JSON.stringify(template.SheetNames) === JSON.stringify(exported.SheetNames),
    headersEqual: JSON.stringify(templateHeaders) === JSON.stringify(exportHeaders), templateRows: templateRows.length,
    hasRequired: ['Precios especiales por talla', 'Costo', 'Destacado', '_BALAM_ID_PRODUCTO', '_BALAM_VERSION_PRODUCTO'].every(header => exportHeaders.includes(header)),
    metadata: parsed.metadata, schema: parsed.schema, planOk: plan.ok, planUpdates: plan.updates,
    noChanges: plan.rows[0] && plan.rows[0].fields.length === 0,
    roundtripSame: JSON.stringify(beforeState) === JSON.stringify(afterState), appliedResult,
    v2PlanOk: v2Plan.ok, v2RoundtripSame, v2Conflicts: v2Plan.conflicts,
    v2Before: IO.__test.canonicalProductState(reference),
    v2After: IO.__test.canonicalProductState(v2Applied[0]),
    v2Identity: v2Applied[0] && { id: v2Applied[0].id, barcodeCode: v2Applied[0].barcodeCode,
      recordModel: v2Applied[0].recordModel, sizeCode: v2Applied[0].sizeCode,
      stockQuantity: v2Applied[0].stockQuantity },
    modelMismatchBlocked: !modelMismatchPlan.ok && modelMismatchPlan.conflicts.some(row => row.conflict.code === 'REFERENCE_MODEL_MISMATCH'),
    physicalDuplicateBlocked: !physicalDuplicatePlan.ok && physicalDuplicatePlan.conflicts.some(row => row.conflict.code === 'REFERENCE_SIGNATURE_DUPLICATE'),
    physicalDuplicateConflicts: physicalDuplicatePlan.conflicts.map(row => row.conflict),
    lockedEditBlocked: !lockedPlan.ok && lockedPlan.conflicts.some(row => row.conflict.code === 'REFERENCE_RECLASSIFICATION_REQUIRED'),
    v2Label: window.BARCODES.validateLabelCode(reference.barcodeCode),
    movedOk: movedParsed.schema === 'current' && movedParsed.warnings.some(warning => /posición/.test(warning)),
    legacyWarning: legacy.schema === 'legacy' && legacy.warnings.length > 0,
    legacyConflict: !legacyBlocked.ok && legacyBlocked.conflicts[0].conflict.code === 'ID_REQUIRED',
    legacyResolved: legacyResolved.ok && legacyResolved.nextProducts[0].costo === product.costo
      && JSON.stringify(legacyResolved.nextProducts[0].preciosTalla) === JSON.stringify(product.preciosTalla),
    manyRows: many.length, manyUnique: new Set(many.map(item => item.sku)).size,
    manyConflicts: manyPlan.conflicts.length, manyOk: manyPlan.ok, applyBlocked, emptyAfter: emptyInventory.length,
    badVersionBlocked, badJsonBlocked, missingColumnBlocked, duplicatedHeaderBlocked, badSizeBlocked,
    invalidCatalogBlocked: !invalidPlan.ok && invalidPlan.conflicts.some(row => row.conflict.code === 'UNKNOWN_CATALOG_VALUE'),
    duplicatedCurrentBlocked: !duplicatedCurrentPlan.ok && duplicatedCurrentPlan.conflicts.some(row => row.conflict.code === 'DUPLICATE_SKU_CURRENT'),
    manyB64: X.write(IO.__test.inventoryWorkbook(many).wb, { bookType: 'xlsx', type: 'base64' }),
  };
});

check('Plantilla y Exportar tienen exactamente las mismas hojas', result.sheetsEqual);
check('Plantilla y Exportar tienen exactamente las mismas columnas', result.headersEqual);
check('Plantilla contiene cero productos', result.templateRows === 0, String(result.templateRows));
check('el contrato incluye todos los campos H-86 obligatorios', result.hasRequired);
check('el archivo se reconoce como esquema canónico versionado', result.schema === 'current' && Number(result.metadata.schema_version) === 2);
check('round-trip por ID produce una actualización sin cambios', result.planOk && result.planUpdates === 1 && result.noChanges);
check('round-trip conserva el estado canónico completo', result.roundtripSame, JSON.stringify(result.appliedResult));
check('round-trip V2 conserva products.id, barcode, talla única y stock escalar',
  result.v2PlanOk && result.v2RoundtripSame && result.v2Identity.recordModel === 'v2'
  && !!result.v2Identity.id && !!result.v2Identity.barcodeCode
  && result.v2Identity.sizeCode === '40' && result.v2Identity.stockQuantity === 7,
  JSON.stringify({ identity: result.v2Identity, conflicts: result.v2Conflicts,
    before: result.v2Before, after: result.v2After }));
check('barcode V2 de 16 caracteres cabe en Code128 dentro de 60×40',
  result.v2Label.ok && result.v2Label.modules > 0 && result.v2Label.moduleMm >= 0.25,
  JSON.stringify(result.v2Label));
check('Excel no convierte un products.id V1 en referencia V2', result.modelMismatchBlocked);
check('dos altas V2 con la misma firma quedan como conflicto de plan, no abortan la vista previa', result.physicalDuplicateBlocked, JSON.stringify(result.physicalDuplicateConflicts));
check('Excel no cambia la firma de una referencia que tuvo stock aunque hoy esté en cero', result.lockedEditBlocked);
check('mover columnas sigue siendo válido y se informa', result.movedOk);
check('el heredado se reconoce y advierte explícitamente', result.legacyWarning);
check('ID vacío + SKU existente es conflicto', result.legacyConflict);
check('resolver el heredado conserva campos ausentes', result.legacyResolved);
check('fixture histórico reproduce 239 filas y 222 SKU', result.manyRows === 239 && result.manyUnique === 222, `${result.manyRows}/${result.manyUnique}`);
check('239/222 bloquea el plan completo', !result.manyOk && result.manyConflicts === 29, String(result.manyConflicts));
check('239/222 produce cero mutaciones', result.applyBlocked && result.emptyAfter === 0);
check('versión incompatible bloquea', result.badVersionBlocked);
check('JSON inválido bloquea', result.badJsonBlocked);
check('columna obligatoria ausente bloquea', result.missingColumnBlocked);
check('encabezado duplicado bloquea', result.duplicatedHeaderBlocked);
check('talla técnica no resoluble bloquea', result.badSizeBlocked);
check('código de catálogo inválido no recibe default', result.invalidCatalogBlocked);
check('SKU duplicado en el inventario actual bloquea', result.duplicatedCurrentBlocked);
check('sin errores de página', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

// Recorrido real de la pantalla: conflicto visible/botón bloqueado y archivo
// descargado por el botón Exportar que vuelve a entrar como actualización por ID.
await page.evaluate(() => {
  window.DATA.products.length = 0;
  const button = [...document.querySelectorAll('nav button')].find(item => /Inventario/.test(item.innerText));
  if (button) button.click();
});
await page.waitForTimeout(500);
await page.setInputFiles('input[type=file][accept*=".xlsx"]', {
  name: '239-222.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: Buffer.from(result.manyB64, 'base64'),
});
await page.waitForSelector('[data-testid="inventory-import-conflicts"]', { timeout: 15000 });
const conflictUi = await page.evaluate(() => ({
  text: document.querySelector('[data-testid="inventory-import-conflicts"]')?.textContent || '',
  disabled: !!document.querySelector('[data-testid="inventory-import-confirm"]')?.disabled,
  products: window.DATA.products.length,
}));
check('la UI muestra los conflictos del caso 239/222', /29 conflictos/.test(conflictUi.text), conflictUi.text);
check('la UI deshabilita confirmar y conserva cero productos', conflictUi.disabled && conflictUi.products === 0);
await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

await page.evaluate(() => {
  const D = window.DATA;
  D.products.splice(0, D.products.length, D.hydrate({
    id: 'real-download-h86', _syncVersion: 4, sku: '21-MC-ALG-BL-T', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'MAO',
    modelo: 'ADR', nombre: 'ADRIANA REAL', orn: 'Bordado Eléctrico', ornColors: ['OR', 'CF'], precio: 650, costo: 275, pop: true,
    imagen: 'https://example.test/real.jpg', preciosTalla: { XL: 725 }, attrs: { __sizeCategoryId: 'size_letter', __ornamentColorsBySize: { XS: ['OR', 'CF'], XL: ['PL'] } },
    sizeCategoryId: 'size_letter', stock: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'].map((talla, index) => ({ talla, escala: 'L', stock: index + 1 })),
  }));
  window.dispatchEvent(new CustomEvent('configchange'));
});
await page.waitForTimeout(300);
const evidenceDir = path.join(ROOT, '.evidence-h86'); mkdirSync(evidenceDir, { recursive: true });
const downloadPromise = page.waitForEvent('download');
await page.getByRole('button', { name: /Exportar/ }).first().click();
const download = await downloadPromise;
const downloadedPath = path.join(evidenceDir, download.suggestedFilename());
await download.saveAs(downloadedPath);
await page.setInputFiles('input[type=file][accept*=".xlsx"]', downloadedPath);
await page.waitForSelector('[data-testid="inventory-import-updates"]', { timeout: 15000 });
const realUi = await page.evaluate(() => ({
  updates: document.querySelector('[data-testid="inventory-import-updates"]')?.textContent || '',
  disabled: !!document.querySelector('[data-testid="inventory-import-confirm"]')?.disabled,
  noChanges: document.body.innerText.includes('Sin cambios'),
}));
check('el archivo realmente descargado vuelve como una actualización por ID', /1 actualizaciones/.test(realUi.updates) && !realUi.disabled, realUi.updates);
check('la vista previa del archivo descargado declara cero cambios', realUi.noChanges);
check('el archivo real descargado existe y no está vacío', existsSync(downloadedPath) && statSync(downloadedPath).size > 0, downloadedPath);

await browser.close(); server.close();
console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
