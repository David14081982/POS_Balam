// H-163: real reader/planner in an isolated browser; no business writes or network.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const sourceMode = process.env.H163_SOURCE === '1';
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(new URL('./index.html', import.meta.url)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = String(process.env.BALAM_CHROME_EXECUTABLE || '').trim();
const browser = await chromium.launch(executablePath
  ? { executablePath, headless: true } : { channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(origin + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.XLSXIO && window.XLSX);
  if (sourceMode) await page.addScriptTag({ content: readFileSync(new URL('./balam/xlsx-io.jsx', import.meta.url), 'utf8') });
  const results = await page.evaluate(async () => {
    const D = window.DATA, C = window.CONFIG, IO = window.XLSXIO, X = window.XLSX;
    const clone = value => JSON.parse(JSON.stringify(value));
    const initial = C.snapshot(), originalProducts = JSON.stringify(D.products), results = [];
    if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; }
    const check = async (name, fn) => {
      try { await fn(); results.push({ name, ok: true }); }
      catch (error) { results.push({ name, ok: false, error: error.message }); }
      finally { C.load(clone(initial)); }
    };
    const assert = (ok, message = 'contract failed') => { if (!ok) throw new Error(message); };
    const reference = (size = 'XS', extra = {}) => D.createReference(Object.assign({
      cat: '21', manga: 'ML', tela: 'POL', color: 'AZ', cuello: 'ITA', modelo: 'H163', nombre: 'H163',
      orn: C.all('ornament').find(item => item.meta.allowsColors).code, ornamentColorCodes: ['PLT', 'DRO'],
      sizeCategoryId: 'size_letter', sizeCode: size, sizeScale: 'L', stockQuantity: 7,
      precio: 980, costo: 410, attrs: { __sizeCategoryId: 'size_letter' }, _syncVersion: 4,
    }, extra), []);
    const first = reference(), second = reference('S');
    const file = wb => new File([X.write(wb, { bookType: 'xlsx', type: 'array' })], 'h163.xlsx');
    const parse = wb => IO.parseFile(file(wb));
    const book = products => IO.__test.inventoryWorkbook(products).wb;
    const editRows = (wb, edit) => {
      const headers = X.utils.sheet_to_json(wb.Sheets.Inventario, { header: 1, defval: '' })[0];
      const rows = X.utils.sheet_to_json(wb.Sheets.Inventario, { defval: '' });
      edit(rows);
      wb.Sheets.Inventario = X.utils.json_to_sheet(rows, { header: headers });
      return wb;
    };
    const makeNew = row => Object.keys(row).filter(key => key.startsWith('_BALAM_')).forEach(key => { row[key] = ''; });
    const freshBook = (products, scalarOnly = false) => {
      const wb = book([]), rows = products.map(product => IO.__test.rowFromProduct(product, IO.sizeColumns()));
      rows.forEach(row => {
        makeNew(row);
        if (scalarOnly) IO.sizeColumns().letters.concat(IO.sizeColumns().numbers).forEach(item => { row[item.header] = ''; });
      });
      return editRows(wb, output => output.push(...rows));
    };
    const expectBlocked = (parsed, current, code) => {
      const before = JSON.stringify(current), plan = IO.planImport(parsed, current, {});
      assert(!plan.ok && plan.conflicts.some(row => row.conflict.code === code), JSON.stringify(plan.conflicts.map(row => row.conflict)));
      let blocked = false;
      try { IO.applyImportPlan(plan, current); } catch { blocked = true; }
      assert(blocked && JSON.stringify(current) === before, 'blocked plan mutated inventory');
    };
    await check('visible template creates V2 with scalar stock and independent identities', async () => {
      const parsed = await parse(freshBook([first, second], true)), plan = IO.planImport(parsed, [], {});
      assert(plan.ok && plan.creates === 2, JSON.stringify(plan.conflicts));
      assert(parsed.products.every(p => p.recordModel === 'v2' && p.stockQuantity === 7 && p.stock.length === 1 && p.stock[0].stock === 7), JSON.stringify(parsed.products.map(p => [p.recordModel, p.stockQuantity, p.stock])));
      for (const key of ['id', 'barcodeCode', 'referenceFamilyId']) assert(new Set(parsed.products.map(p => p[key])).size === 2 && parsed.products.every(p => p[key] !== first[key] && p[key] !== second[key]), key);
      assert(parsed.products.every(p => p.barcodeContract === 3 && p.physicalSignature), 'V3 barcode/physical contract');
    });
    await check('template explains scalar capture and publishes active ornament colors', () => {
      const wb = book([]), rows = X.utils.sheet_to_json(wb.Sheets['Catálogos'], { header: 1, defval: '' });
      const text = rows.flat().join('\n');
      assert(text.includes('Existencia referencia') && text.includes('Talla referencia') && text.includes('Colores de ornamento V2'));
      assert(rows.some(row => row[0] === 'PLT' && row[1] === C.find('ornament_color', 'PLT').label));
      const headers = X.utils.sheet_to_json(wb.Sheets.Inventario, { header: 1, defval: '' })[0];
      assert(wb.Sheets.Inventario['!cols'][headers.indexOf('XS')].hidden && !wb.Sheets.Inventario['!cols'][headers.indexOf('Existencia referencia')].hidden);
    });
    await check('new template missing size is a contextual row error', async () => {
      const wb = editRows(freshBook([first], true), rows => { rows[0]['Talla referencia'] = ''; });
      let error; try { await parse(wb); } catch (caught) { error = caught; }
      assert(error?.code === 'INVENTORY_ROW_INVALID' && error.rowNumber === 2 && error.header === 'Talla referencia' && error.reason);
    });
    await check('new template requires an explicit scalar quantity', async () => {
      const wb = editRows(freshBook([first], true), rows => { rows[0]['Existencia referencia'] = ''; });
      let error; try { await parse(wb); } catch (caught) { error = caught; }
      assert(error?.code === 'INVENTORY_ROW_INVALID' && error.header === 'Existencia referencia');
    });
    await check('new template accepts explicit zero stock', async () => {
      const wb = editRows(freshBook([first], true), rows => { rows[0]['Existencia referencia'] = 0; });
      const parsed = await parse(wb), plan = IO.planImport(parsed, [], {});
      assert(plan.ok && plan.creates === 1 && plan.rows[0].after.stockQuantity === 0);
    });
    await check('new template never discards stock captured in another size', async () => {
      const wb = editRows(freshBook([first], true), rows => { rows[0].S = 3; });
      let error; try { await parse(wb); } catch (caught) { error = caught; }
      assert(error?.code === 'INVENTORY_ROW_INVALID' && error.header === 'Talla referencia');
    });
    await check('invalid numeric cell reports exact row and visible field', async () => {
      const wb = editRows(book([first]), rows => { rows[0].Precio = 'invalid'; });
      let error; try { await parse(wb); } catch (caught) { error = caught; }
      assert(error?.code === 'INVENTORY_ROW_INVALID' && error.rowNumber === 2 && error.header === 'Precio' && error.reason);
    });
    await check('roundtrip v4/v5 is unchanged and emits zero IDs', async () => {
      const migrated = reference('M', { referenceFamilyId: 'bfdb4fe0-5227-5cee-bfa0-6408495e7e9d' });
      const current = [clone(first), migrated], before = IO.__test.inventoryStateFingerprint(current);
      const plan = IO.planImport(await parse(book(current)), current, {}), applied = IO.applyImportPlan(plan, current);
      assert(plan.ok && plan.updates === 2 && plan.unchangedCount === 2 && plan.changedUpdates === 0 && plan.rows.every(row => row.unchanged));
      assert(applied.productIds.length === 0 && IO.__test.inventoryStateFingerprint(current) === before);
    });
    await check('mixed roundtrip sends only the genuinely changed ID', async () => {
      const current = clone([first, second]), wb = editRows(book(current), rows => { rows[1].Precio = 1000; });
      const plan = IO.planImport(await parse(wb), current, {}), applied = IO.applyImportPlan(plan, current);
      assert(plan.unchangedCount === 1 && plan.changedUpdates === 1 && applied.productIds.length === 1 && applied.productIds[0] === second.id);
      assert(current.find(p => p.id === second.id).precio === 1000 && current.find(p => p.id === first.id).precio === 980);
    });
    await check('family-only edit remains a write despite no commercial field summary', async () => {
      const family = 'bfdb4fe0-5227-5cee-bfa0-6408495e7e9d';
      const current = [clone(first)], wb = editRows(book(current), rows => { rows[0]._BALAM_REFERENCE_FAMILY_ID = family; });
      const plan = IO.planImport(await parse(wb), current, {}), applied = IO.applyImportPlan(plan, current);
      assert(plan.changedUpdates === 1 && plan.unchangedCount === 0 && applied.productIds[0] === first.id && current[0].referenceFamilyId === family);
    });
    await check('inactive size can roundtrip only its exact existing reference', async () => {
      const cfg = clone(initial); cfg.catalogs.size_letter.find(item => item.code === 'XS').active = false; C.load(cfg);
      const catalogs = X.utils.sheet_to_json(book([]).Sheets['Catálogos'], { header: 1, defval: '' });
      const activeStart = catalogs.findIndex(row => row[0] === 'TALLAS ACTIVAS (col. Talla referencia)');
      const activeEnd = catalogs.findIndex((row, i) => i > activeStart && row[0] === 'NOTAS');
      assert(activeStart >= 0 && !catalogs.slice(activeStart + 2, activeEnd).some(row => row[0] === 'XS' && row[2] === 'size_letter'));
      const parsed = await parse(book([first])), plan = IO.planImport(parsed, [first], {});
      assert(plan.ok && plan.unchangedCount === 1 && plan.rows[0].after.stockQuantity === 7);
      expectBlocked(parsed, [], 'ID_NOT_FOUND');
    });
    await check('changing an existing row to an inactive size stays blocked', async () => {
      const cfg = clone(initial); cfg.catalogs.size_letter.find(item => item.code === 'XS').active = false; C.load(cfg);
      const wb = editRows(book([second]), rows => { rows[0]['Talla referencia'] = 'XS'; });
      expectBlocked(await parse(wb), [second], 'REFERENCE_SIZE_INVALID');
    });
    await check('new reference using inactive size remains blocked', async () => {
      const cfg = clone(initial); cfg.catalogs.size_letter.find(item => item.code === 'XS').active = false; C.load(cfg);
      let error; try { await parse(freshBook([first], true)); } catch (caught) { error = caught; }
      assert(error?.code === 'INVENTORY_ROW_INVALID' && error.header === 'Talla referencia');
    });
    for (const [kind, code, header] of [['ornament_color', 'PLT', 'Colores de ornamento V2'], ['fabric', 'POL', 'Material']]) {
      await check(`inactive ${kind} preserves existing value and blocks a new use`, async () => {
        const cfg = clone(initial); cfg.catalogs[kind].find(item => item.code === code).active = false; C.load(cfg);
        const existing = IO.planImport(await parse(book([first])), [first], {});
        assert(existing.ok && existing.unchangedCount === 1);
        const parsed = await parse(freshBook([first], true)), next = IO.planImport(parsed, [], {});
        assert(!next.ok && next.conflicts[0].conflict.code === 'UNKNOWN_CATALOG_VALUE' && next.conflicts[0].conflict.header === header && next.conflicts[0].conflict.value === code);
      });
    }
    await check('explicit legacy V1 and its SKU resolution remain intact', async () => {
      const legacy = D.hydrate({ id: 'h163-legacy', sku: 'H163-LEGACY', _syncVersion: 4, cat: '21', manga: 'ML', tela: 'POL', color: 'AZ', cuello: 'ITA', modelo: 'LEGACY', nombre: 'LEGACY', orn: first.orn, precio: 980, costo: 410, attrs: { __sizeCategoryId: 'size_letter' }, sizeCategoryId: 'size_letter', stock: [{ talla: 'XS', escala: 'L', stock: 7 }] });
      const wb = book([legacy]), parsed = await parse(wb), plan = IO.planImport(parsed, [legacy], {});
      assert(parsed.products[0].recordModel === 'v1' && plan.ok && plan.rows[0].fields.length === 0);
      delete wb.Sheets._BALAM; wb.SheetNames = wb.SheetNames.filter(name => name !== '_BALAM');
      editRows(wb, rows => { rows[0]._BALAM_ID_PRODUCTO = ''; rows[0]._BALAM_VERSION_PRODUCTO = ''; });
      const old = await parse(wb);
      expectBlocked(old, [legacy], 'ID_REQUIRED');
      assert(IO.planImport(old, [legacy], { 'row-0': legacy.id }).ok);
    });
    await check('duplicate legacy SKUs block without claiming they are permitted', async () => {
      const legacy = D.hydrate({ id: 'h163-legacy-a', sku: 'H163-DUP', _syncVersion: 4, cat: '21', manga: 'ML', tela: 'POL', color: 'AZ', cuello: 'ITA', modelo: 'LEGACY', nombre: 'LEGACY', orn: first.orn, precio: 980, costo: 410, attrs: { __sizeCategoryId: 'size_letter' }, sizeCategoryId: 'size_letter', stock: [{ talla: 'XS', escala: 'L', stock: 7 }] });
      const duplicate = Object.assign(clone(legacy), { id: 'h163-legacy-b' });
      const plan = IO.planImport(await parse(book([legacy, duplicate])), [legacy, duplicate], {});
      assert(!plan.ok && plan.conflicts.every(row => row.conflict.code === 'DUPLICATE_SKU_FILE'));
      assert(!plan.warnings.some(warning => String(warning).includes('SKU_DUPLICATE_WARNING')));
    });
    await check('duplicate V2 commercial SKUs remain permitted and explained', async () => {
      const cfg = clone(initial); cfg.catalogMeta.effective_size.inSku = false; C.load(cfg);
      const a = reference(), b = reference('S');
      assert(a.sku === b.sku, 'fixture must share a commercial SKU');
      const plan = IO.planImport(await parse(book([a, b])), [a, b], {});
      assert(plan.ok && plan.warnings.filter(warning => String(warning).includes('SKU_DUPLICATE_WARNING')).length === 1);
    });
    await check('schema 2 remains readable without family column', async () => {
      const wb = book([first]), metadata = X.utils.sheet_to_json(wb.Sheets._BALAM, { header: 1, defval: '' });
      metadata.find(row => row[0] === 'schema_version')[1] = 2; wb.Sheets._BALAM = X.utils.aoa_to_sheet(metadata);
      const rows = X.utils.sheet_to_json(wb.Sheets.Inventario, { defval: '' }); rows.forEach(row => delete row._BALAM_REFERENCE_FAMILY_ID);
      wb.Sheets.Inventario = X.utils.json_to_sheet(rows, { header: Object.keys(rows[0]) });
      const parsed = await parse(wb), plan = IO.planImport(parsed, [first], {});
      assert(plan.ok && plan.rows[0].after.referenceFamilyId === first.referenceFamilyId);
    });
    await check('missing ID and newer version still reject atomically', async () => {
      const parsed = await parse(book([first]));
      expectBlocked(parsed, [], 'ID_NOT_FOUND');
      expectBlocked(parsed, [Object.assign(clone(first), { _syncVersion: 5 })], 'VERSION_CONFLICT');
    });
    const lockKey = 'balam_pos_layaway_product_locks_v1';
    const withLock = async fn => {
      localStorage.setItem(lockKey, JSON.stringify([{ operationId: 'h163-private-lock', folio: 'H163', productIds: [first.id], productSnapshots: [first] }]));
      try { await fn(); } finally { localStorage.removeItem(lockKey); }
    };
    await check('layaway lock blocks real edits in preflight but permits no-op', () => withLock(async () => {
      const same = IO.planImport(await parse(book([first])), [first], {});
      assert(same.ok && same.unchangedCount === 1 && IO.applyImportPlan(same, [clone(first)]).productIds.length === 0);
      const wb = editRows(book([first]), rows => { rows[0].Precio = 1000; });
      expectBlocked(await parse(wb), [first], 'LAYAWAY_PRODUCT_LOCKED');
    }));
    await check('layaway lock acquired after preview blocks before any mutation', async () => {
      const current = [clone(first)], wb = editRows(book(current), rows => { rows[0].Precio = 1000; });
      const plan = IO.planImport(await parse(wb), current, {}); assert(plan.ok);
      await withLock(() => {
        const before = JSON.stringify(current); let error;
        try { IO.applyImportPlan(plan, current); } catch (caught) { error = caught; }
        assert(error?.code === 'LAYAWAY_PRODUCT_LOCKED' && JSON.stringify(current) === before);
      });
    });
    await check('stale preview cannot apply', async () => {
      const current = [clone(first)], plan = IO.planImport(await parse(book(current)), current, {});
      current[0].precio++; const before = JSON.stringify(current); let blocked = false;
      try { IO.applyImportPlan(plan, current); } catch { blocked = true; }
      assert(blocked && JSON.stringify(current) === before);
    });
    assert(JSON.stringify(D.products) === originalProducts, 'global products changed');
    return results;
  });
  results.forEach(result => console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.error ? ': ' + result.error : ''}`));
  const passed = results.filter(result => result.ok).length;
  console.log(`H-163 XLSX (${sourceMode ? 'source over bundle' : 'bundle'}): ${passed}/${results.length}`);
  process.exitCode = passed === results.length ? 0 : 1;
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
