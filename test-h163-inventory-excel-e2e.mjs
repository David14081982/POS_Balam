// H163: real Inventory controls, workbook files, local persistence and scoped intent.
// Remote requests are blocked. The gateway records intent; this does not certify live sync.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomInt } from 'node:crypto';
import { chromium } from 'playwright-core';

const require = createRequire(import.meta.url);
const X = require('./balam/vendor/xlsx-0.20.3/xlsx.full.min.js');
const baseline = process.argv.includes('--baseline');
const artifact = process.env.BALAM_VERIFIED_HTML || 'index.html';
const output = process.env.BALAM_TEST_OUTPUT || path.join(os.tmpdir(), 'balam-h163-excel-e2e');
const privateConfig = process.env.H163_CONFIG_PATH;
const privateWorkbook = process.env.H163_WORKBOOK_PATH;
assert.equal(!!privateConfig, !!privateWorkbook, 'private regression requires both config and workbook paths');
const privateOnly = process.argv.includes('--private-only');
assert.ok(!privateOnly || privateWorkbook, '--private-only requires the private fixtures');
fs.mkdirSync(output, { recursive: true });
const artifactBytes = fs.readFileSync(artifact);
const checks = [], failures = [], pageErrors = [];
let remoteRequestsBlocked = 0, fileSequence = 0;
function check(name, condition, detail = '') {
  checks.push({ name, ok: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
  assert.ok(condition, name);
}
const bytesOf = book => Buffer.from(X.write(book, { bookType: 'xlsx', type: 'array' }));
function rewrite(bytes, edit) {
  const book = X.read(bytes, { type: 'buffer', cellStyles: true });
  const columns = book.Sheets.Inventario['!cols'];
  const headers = X.utils.sheet_to_json(book.Sheets.Inventario, { header: 1, defval: '' })[0];
  const rows = X.utils.sheet_to_json(book.Sheets.Inventario, { defval: '' });
  edit(rows, headers, columns || []);
  book.Sheets.Inventario = X.utils.json_to_sheet(rows, { header: headers });
  book.Sheets.Inventario['!cols'] = columns;
  return bytesOf(book);
}
const browser = await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE
  ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE, headless: true }
  : { channel: 'chrome', headless: true });

async function setup(configState) {
  const origin = `http://127.0.0.1:${randomInt(15000, 45000)}/`;
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', route => {
    if (route.request().url() === origin) return route.fulfill({ contentType: 'text/html', body: artifactBytes });
    remoteRequestsBlocked++; return route.abort();
  });
  await context.addInitScript(() => {
    if (!localStorage.getItem('h163-initialized')) {
      localStorage.setItem('balam-page', 'inventario');
      localStorage.setItem('balam_pos_products_v2', '[]');
      localStorage.setItem('h163-intents', '[]');
      localStorage.setItem('h163-initialized', '1');
    }
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(120000);
  page.on('pageerror', error => pageErrors.push(error.message));
  async function ready() {
    await page.waitForFunction(() => window.DATA && window.CONFIG && window.XLSXIO);
    await page.evaluate(async () => {
      await window.DATA.awaitLocalWriter(3000);
      window.CORE.registerSyncGateway({ pushRows: (kind, rows) => {
        const calls = JSON.parse(localStorage.getItem('h163-intents') || '[]');
        calls.push({ kind, ids: rows.map(row => row.id) });
        localStorage.setItem('h163-intents', JSON.stringify(calls));
      } });
    });
  }
  await page.goto(origin, { waitUntil: 'load' }); await ready();
  if (configState) await page.evaluate(cfg => { window.CONFIG.load(cfg); window.dispatchEvent(new CustomEvent('configchange')); }, configState);
  async function click(id) {
    if (baseline && !(await page.getByTestId(id).count())) {
      // Baseline only: identify the public export handler, never copy, icons or order.
      // The final run requires production test IDs without this instrumentation.
      const method = { 'inventory-xlsx-template': 'exportTemplate', 'inventory-xlsx-export': 'exportInventory' }[id];
      assert.ok(method, 'baseline has no structural fallback for ' + id);
      const matches = await page.evaluate(({ id, method }) => {
        const nodes = [...document.querySelectorAll('button')].filter(node => {
          const key = Object.keys(node).find(key => key.startsWith('__reactProps$'));
          return String(key && node[key]?.onClick).includes('.' + method + '(');
        });
        if (nodes.length === 1) nodes[0].setAttribute('data-testid', id);
        return nodes.length;
      }, { id, method });
      assert.equal(matches, 1, 'unique public export handler');
    }
    await page.getByTestId(id).click();
  }
  async function download(id) {
    const pending = page.waitForEvent('download'); await click(id);
    const file = await pending;
    const filename = path.join(output, `${++fileSequence}-${file.suggestedFilename()}`);
    await file.saveAs(filename); return fs.readFileSync(filename);
  }
  async function upload(bytes, name) {
    const file = { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bytes };
    if (baseline && !(await page.getByTestId('inventory-xlsx-import').count())) {
      await page.setInputFiles('input[type=file][accept*=".xlsx"]', file); return;
    }
    const chooser = page.waitForEvent('filechooser'); await click('inventory-xlsx-import');
    await (await chooser).setFiles(file);
  }
  async function state() {
    return page.evaluate(() => {
      const canon = rows => rows.map(window.XLSXIO.__test.canonicalProductState).sort((a, b) => a.id.localeCompare(b.id));
      return { memory: canon(window.DATA.products), cache: canon(JSON.parse(localStorage.getItem('balam_pos_products_v2') || '[]')),
        intents: JSON.parse(localStorage.getItem('h163-intents') || '[]') };
    });
  }
  async function confirm() { await click('inventory-import-confirm'); await page.getByTestId('inventory-import-confirm').waitFor({ state: 'detached' }); }
  async function cancel() { await click('inventory-import-cancel'); await page.getByTestId('inventory-import-confirm').waitFor({ state: 'detached' }); }
  async function reload() { await page.reload({ waitUntil: 'load' }); await ready(); }
  return { context, page, click, download, upload, state, confirm, cancel, reload };
}

async function responsivePreview(app, prefix) {
  for (const width of [320, 390, 768, 1440]) {
    await app.page.setViewportSize({ width, height: 1000 });
    await app.page.getByTestId('inventory-import-confirm').scrollIntoViewIfNeeded();
    const buttons = await app.page.evaluate(() => ['confirm', 'cancel'].map(action => {
      const node = document.querySelector(`[data-testid="inventory-import-${action}"]`);
      const box = node.getBoundingClientRect();
      const visible = box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
      return { action, visible, reachable: node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
    }));
    check(`${prefix}: confirmar y cancelar quedan visibles y accesibles a ${width}px`, buttons.every(button => button.visible && button.reachable), JSON.stringify(buttons));
    if (width === 320) {
      const scroll = app.page.getByTestId('inventory-import-table-scroll');
      await app.page.screenshot({ path: path.join(output, `${prefix}-preview-320-before-scroll.png`) });
      const pageScrollX = await app.page.evaluate(() => window.scrollX);
      await scroll.hover(); await app.page.mouse.wheel(5000, 0);
      await app.page.waitForFunction(() => {
        const node = document.querySelector('[data-testid="inventory-import-table-scroll"]');
        return node && node.scrollLeft > 0 && Math.abs(node.scrollWidth - node.clientWidth - node.scrollLeft) < 2;
      });
      const geometry = await scroll.evaluate(node => {
        const box = node.getBoundingClientRect(), last = node.querySelector('thead th:last-child').getBoundingClientRect();
        return { overflow: getComputedStyle(node).overflowX, pageScrollX: window.scrollX,
          lastVisible: last.left >= box.left && last.right <= box.right + 1,
          contained: box.left >= 0 && box.right <= innerWidth };
      });
      check(`${prefix}: rueda horizontal permite revisar las últimas columnas a 320px sin mover la página`,
        /auto|scroll/.test(geometry.overflow) && geometry.lastVisible && geometry.contained && geometry.pageScrollX === pageScrollX, JSON.stringify(geometry));
      await app.page.screenshot({ path: path.join(output, `${prefix}-preview-320-last-columns.png`) });
      await app.page.mouse.wheel(-5000, 0);
    }
    await app.page.screenshot({ path: path.join(output, `${prefix}-preview-${width}.png`) });
  }
}

async function syntheticCycle() {
  const app = await setup();
  const { page } = app;
  try {
    const template = await app.download('inventory-xlsx-template');
    const book = X.read(template, { type: 'buffer', cellStyles: true });
    check('Plantilla descargada contiene cero productos y las tres hojas del contrato',
      X.utils.sheet_to_json(book.Sheets.Inventario).length === 0 && book.SheetNames.length === 3);
    const fixture = await page.evaluate(() => {
      const D = window.DATA, IO = window.XLSXIO;
      const base = { cat: '21', manga: 'ML', tela: 'POL', color: 'AZ', cuello: 'ITA', modelo: 'V2X',
        nombre: 'REFERENCIA H163', orn: 'Bordado Eléctrico', sizeCategoryId: 'size_number', sizeScale: 'N',
        precio: 980.50, costo: 410.25, attrs: { __sizeCategoryId: 'size_number' } };
      return [['40', 'PLT', 7], ['40', 'DRO', 3], ['42', 'PLT', 5]].map(([sizeCode, color, stockQuantity]) => {
        const product = D.createReference({ ...base, sizeCode, ornamentColorCodes: [color], stockQuantity,
          preciosTalla: { [sizeCode]: 1100.75 } }, []);
        return IO.__test.rowFromProduct(product, IO.sizeColumns());
      });
    });
    const gridHeaders = await page.evaluate(() => {
      const cols = window.XLSXIO.sizeColumns();
      return cols.letters.concat(cols.numbers).map(column => column.header);
    });
    const filled = rewrite(template, (rows, headers, columns) => {
      rows.push(...fixture.map(row => Object.fromEntries(headers.map((header, index) =>
        [header, columns[index]?.hidden || header.startsWith('_BALAM_') ? '' : row[header]]))));
    });
    const filledRows = X.utils.sheet_to_json(X.read(filled, { type: 'buffer' }).Sheets.Inventario, { defval: '' });
    if (!baseline) check('Captura visible usa talla y existencia con todas las cuadrículas históricas vacías',
      filledRows.every(row => row['Talla referencia'] && Number.isFinite(row['Existencia referencia'])
        && gridHeaders.every(header => row[header] === '') && row['Colores Orn.'] === '' && row['Colores Orn. por talla'] === ''));
    const before = await app.state();
    await app.upload(filled, 'h163-visible-template.xlsx');
    const parsedModels = await page.evaluate(async base64 => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
      const parsed = await window.XLSXIO.parseFile(new File([bytes], 'h163-visible-template.xlsx'));
      return parsed.products.map(product => product.recordModel);
    }, filled.toString('base64'));
    check('Rellenar sólo campos visibles de Plantilla crea referencias V2', parsedModels.length === 3 && parsedModels.every(model => model === 'v2'), JSON.stringify(parsedModels));
    await page.getByTestId('inventory-import-creates').waitFor();
    check('Preview ofrece tres altas y permite confirmar',
      (await page.getByTestId('inventory-import-creates').textContent()).includes('3 altas') && await page.getByTestId('inventory-import-confirm').isEnabled());
    check('Tres SKU distintos no muestran un aviso de duplicados',
      new Set(fixture.map(row => row.SKU)).size === 3 && !(await page.getByTestId('inventory-import-warnings').count()));
    await responsivePreview(app, 'synthetic');
    check('Previsualizar no escribe inventario ni intención', JSON.stringify(await app.state()) === JSON.stringify(before));
    await app.cancel();
    check('Cancelar conserva memoria, caché e intenciones', JSON.stringify(await app.state()) === JSON.stringify(before));
    await app.upload(filled, 'h163-visible-template.xlsx');
    await page.getByTestId('inventory-import-confirm').waitFor(); await app.confirm();
    const created = await app.state();
    check('Confirmar guarda tres referencias y quince piezas', created.memory.length === 3 && created.memory.reduce((sum, row) => sum + row.stockQuantity, 0) === 15);
    check('Confirmar conserva precio, costo y precios especiales de las tres filas', created.memory.every(row => row.precio === 980.50 && row.costo === 410.25 && row.preciosTalla[row.sizeCode] === 1100.75));
    check('Confirmar conserva IDs y códigos únicos y persiste su estado completo', new Set(created.memory.map(row => row.id)).size === 3 && new Set(created.memory.map(row => row.barcodeCode)).size === 3 && JSON.stringify(created.memory) === JSON.stringify(created.cache));
    check('Alta envía una intención acotada a sus tres IDs', created.intents.length === 1 && created.intents[0].kind === 'products' && JSON.stringify([...created.intents[0].ids].sort()) === JSON.stringify(created.memory.map(row => row.id).sort()));
    await app.reload();
    check('Recarga conserva inventario, identidades, precios, existencias e intenciones', JSON.stringify(await app.state()) === JSON.stringify(created));
    const exported = await app.download('inventory-xlsx-export');
    await app.upload(exported, 'h163-exported-unchanged.xlsx');
    await page.getByTestId('inventory-import-confirm').waitFor(); await app.confirm();
    check('Exportar y reimportar sin cambios no escribe ni genera pendientes', JSON.stringify(await app.state()) === JSON.stringify(created));
    check('Sin cambios se comunica como resultado normal', /sin cambios/i.test(await page.getByTestId('inventory-import-feedback').textContent()));
    const edited = rewrite(exported, rows => { rows[0].Precio = 1025.75; rows[0]['Existencia referencia'] = 12; });
    const editedId = X.utils.sheet_to_json(X.read(exported, { type: 'buffer' }).Sheets.Inventario)[0]._BALAM_ID_PRODUCTO;
    await app.upload(edited, 'h163-price-stock-edited.xlsx');
    await page.getByTestId('inventory-import-confirm').waitFor(); await app.cancel();
    check('Cancelar cambios de precio y stock no escribe datos', JSON.stringify(await app.state()) === JSON.stringify(created));
    await app.upload(edited, 'h163-price-stock-edited.xlsx');
    await page.getByTestId('inventory-import-confirm').waitFor(); await app.confirm();
    const changed = await app.state(), changedRow = changed.memory.find(row => row.id === editedId);
    check('Importar cambios aplica exactamente el precio y stock solicitados', changedRow.precio === 1025.75 && changedRow.stockQuantity === 12 && changed.memory.length === 3);
    check('Importar cambios mantiene intactas las demás referencias', JSON.stringify(changed.memory.filter(row => row.id !== editedId)) === JSON.stringify(created.memory.filter(row => row.id !== editedId)));
    check('Actualizar sólo envía la referencia modificada', changed.intents.length === 2 && JSON.stringify(changed.intents[1]) === JSON.stringify({ kind: 'products', ids: [editedId] }));
    check('Actualización persiste antes de recargar', JSON.stringify(changed.memory) === JSON.stringify(changed.cache));
    await app.reload();
    check('Stock y precio modificados sobreviven a recarga', JSON.stringify(await app.state()) === JSON.stringify(changed));
    const currentExport = await app.download('inventory-xlsx-export');
    for (const [name, mutate, expectedText] of [
      ['producto inexistente', row => { row._BALAM_ID_PRODUCTO = 'c475ca64-d534-4ee2-9d63-0c4da17a2c69'; }, /ya no está en el inventario/i],
      ['valor de catálogo desconocido', row => { row['Color Tela'] = 'NO_EXISTE_H163'; }, /NO_EXISTE_H163|catálogo|color/i],
    ]) {
      const invalid = rewrite(currentExport, rows => mutate(rows[0]));
      await app.upload(invalid, 'h163-invalid.xlsx');
      await page.getByTestId('inventory-import-conflicts').waitFor();
      check(name + ' bloquea confirmar', await page.getByTestId('inventory-import-confirm').isDisabled());
      const rowText = await page.getByTestId('inventory-import-row-2').textContent();
      check(name + ' explica el problema en su fila', expectedText.test(rowText), rowText);
      await app.cancel();
      check(name + ' conserva memoria, caché e intenciones', JSON.stringify(await app.state()) === JSON.stringify(changed));
    }
    const malformed = rewrite(currentExport, rows => { rows[0]._BALAM_REFERENCE_FAMILY_ID = 'familia-invalida'; });
    const previousFeedback = await page.getByTestId('inventory-import-feedback').count()
      ? await page.getByTestId('inventory-import-feedback').textContent() : '';
    await app.upload(malformed, 'h163-malformed.xlsx');
    await page.waitForFunction(previous => {
      const text = document.querySelector('[data-testid="inventory-import-feedback"]')?.textContent || '';
      return text !== previous && /fila|archivo|formato|familia/i.test(text);
    }, previousFeedback);
    check('Error de lectura se comunica sin abrir un plan aplicable', !(await page.getByTestId('inventory-import-confirm').count()));
    check('Error de lectura no modifica inventario ni intenciones', JSON.stringify(await app.state()) === JSON.stringify(changed));
    await page.screenshot({ path: path.join(output, 'synthetic-final.png') });
    const quotaEdited = rewrite(currentExport, rows => { rows[0]['Existencia referencia'] = 13; });
    await app.upload(quotaEdited, 'h163-storage-quota.xlsx');
    await page.getByTestId('inventory-import-confirm').waitFor();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      window.__h163RestoreStorage = () => { Storage.prototype.setItem = original; };
      Storage.prototype.setItem = function (key, value) {
        if (key === 'balam_pos_products_v2') throw new DOMException('H163 isolated storage quota', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    try {
      await app.confirm();
      await page.waitForFunction(() => /necesita completar el guardado/i.test(document.querySelector('[data-testid="inventory-import-feedback"]')?.textContent || ''));
      const failedSave = await app.state();
      check('Cuota local informa guardado pendiente sin anunciar éxito',
        !/\d+ (alta|actualizaci)/i.test(await page.getByTestId('inventory-import-feedback').textContent()));
      check('Cuota local conserva cambio en memoria y deja la caché anterior',
        failedSave.memory.find(row => row.id === editedId).stockQuantity === 13
        && JSON.stringify(failedSave.cache) === JSON.stringify(changed.cache));
      check('Cuota local conserva la intención del único ID modificado en el registrador aislado',
        failedSave.intents.length === 3 && JSON.stringify(failedSave.intents[2]) === JSON.stringify({ kind: 'products', ids: [editedId] }));
      await page.screenshot({ path: path.join(output, 'synthetic-quota.png') });
    } finally { await page.evaluate(() => window.__h163RestoreStorage()); }
  } finally { await app.context.close(); }
}

async function privateCycle() {
  const cfg = JSON.parse(fs.readFileSync(privateConfig, 'utf8').replace(/^\uFEFF/, ''));
  const bytes = fs.readFileSync(privateWorkbook), app = await setup(cfg.catalogState);
  try {
    await app.upload(bytes, path.basename(privateWorkbook));
    await app.page.getByTestId('inventory-import-creates').waitFor();
    check('Archivo privado ofrece 973 altas sin conflictos', (await app.page.getByTestId('inventory-import-creates').textContent()).includes('973 altas') && !(await app.page.getByTestId('inventory-import-conflicts').count()));
    const warnings = app.page.getByTestId('inventory-import-warnings');
    check('Archivo privado mantiene advertencias neutrales agrupadas y comprensibles',
      !/No se pudo completar la acción/.test(await warnings.textContent())
      && await warnings.getAttribute('data-message-level') === 'neutral' && await warnings.getAttribute('open') === null
      && await app.page.getByTestId('inventory-import-confirm').isEnabled());
    await responsivePreview(app, 'private');
    await app.page.screenshot({ path: path.join(output, 'private-preview.png') });
    await app.confirm(); const created = await app.state();
    check('Archivo privado conserva 973 referencias, 251 familias y 3484 piezas', created.memory.length === 973 && new Set(created.memory.map(row => row.referenceFamilyId)).size === 251 && created.memory.reduce((sum, row) => sum + row.stockQuantity, 0) === 3484);
    const sourceRows = X.utils.sheet_to_json(X.read(bytes, { type: 'buffer' }).Sheets.Inventario, { defval: '' });
    check('Archivo privado conserva SKU, talla, precio, costo y precio especial fila por fila', await app.page.evaluate(rows =>
      window.DATA.products.every((product, index) => {
        const row = rows[index];
        return product.sku === row.SKU && product.sizeCode === String(row['Talla referencia'])
          && product.precio === Number(row.Precio) && product.costo === Number(row.Costo)
          && product.stockQuantity === Number(row['Existencia referencia'])
          && product.referenceFamilyId === row._BALAM_REFERENCE_FAMILY_ID
          && JSON.stringify(product.preciosTalla || {}) === JSON.stringify(JSON.parse(row['Precios especiales por talla'] || '{}'));
      }), sourceRows));
    await app.reload();
    check('Las 973 referencias persisten completas tras recargar', JSON.stringify(await app.state()) === JSON.stringify(created) && JSON.stringify(created.memory) === JSON.stringify(created.cache));
    const exported = await app.download('inventory-xlsx-export');
    await app.upload(exported, 'private-roundtrip.xlsx');
    await app.page.getByTestId('inventory-import-confirm').waitFor(); await app.confirm();
    check('Archivo privado exportado y reimportado no cambia datos ni genera intenciones', JSON.stringify(await app.state()) === JSON.stringify(created));
    await app.upload(bytes, 'private-second-create.xlsx');
    await app.page.getByTestId('inventory-import-conflicts').waitFor();
    check('Repetir altas privadas impide duplicar las 3484 piezas', await app.page.getByTestId('inventory-import-confirm').isDisabled());
    await app.cancel();
    check('Rechazar alta repetida conserva las 973 referencias', JSON.stringify(await app.state()) === JSON.stringify(created));
  } finally { await app.context.close(); }
}

try {
  if (!privateOnly) await syntheticCycle();
  if (privateWorkbook) await privateCycle();
  check('Recorrido completo no arroja errores de JavaScript', pageErrors.length === 0, pageErrors.join(' | '));
} catch (error) { failures.push(error.message); console.error(error.stack); }
finally { await browser.close(); }
const passed = checks.filter(check => check.ok).length;
const failed = checks.filter(check => !check.ok).length || (failures.length ? 1 : 0);
fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ baseline, artifact,
  artifactSha256: createHash('sha256').update(artifactBytes).digest('hex'), checks, failures,
  remoteRequestsBlocked, remoteRequestsAllowed: 0, privateWorkbookTested: !!privateWorkbook,
  scope: 'Isolated browser, real local persistence, recorded gateway intent. No real synchronization certification.' }, null, 2));
console.log(`${passed} pasaron, ${failed} fallaron`);
process.exitCode = failed ? 1 : 0;
