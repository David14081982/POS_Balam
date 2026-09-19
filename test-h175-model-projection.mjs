// H-175: con catálogo Modelo, `modelo` es la proyección de su código en toda
// alta y edición V2 (Inventario y Excel); una referencia protegida conserva el
// valor persistido. Navegador aislado; sin red ni escrituras comerciales.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const remote = process.argv.find(arg => /^https?:\/\//.test(arg));
const server = remote ? null : http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(readFileSync(new URL('./index.html', import.meta.url)));
});
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = remote ? new URL(remote).origin : `http://127.0.0.1:${server.address().port}`;
const executablePath = String(process.env.BALAM_CHROME_EXECUTABLE || '').trim();
const browser = await chromium.launch(executablePath ? { executablePath, headless: true } : { channel: 'chrome', headless: true });
let results = [];
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(remote || origin + '/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.XLSXIO && window.XLSX);
  results = await page.evaluate(async () => {
    const D = window.DATA, C = window.CONFIG, IO = window.XLSXIO, X = window.XLSX, out = [];
    const check = async (name, fn) => {
      try { await fn(); out.push({ name, ok: true }); } catch (error) { out.push({ name, ok: false, error: error.message }); }
    };
    const assert = (ok, message) => { if (!ok) throw new Error(message); };
    C.load(C.prepareMutation('reset', []).state);
    C.load(C.prepareMutation('addItem', ['producto', { code: 'TB', label: 'TIRA BORDADA' }]).state);
    const base = (extra = {}) => Object.assign({ nombre: 'TIRA BORDADA', modelo: '0TB', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL',
      cuello: 'NOR', orn: '—', ornamentColorCodes: [], precio: 450, costo: 200, sizeCategoryId: 'size_number', sizeCode: '38', sizeScale: 'N',
      stockQuantity: 0, attrs: { producto: 'TB', __sizeCategoryId: 'size_number' } }, extra);
    const keys = ['products', 'sellers', 'clients', 'sales', 'movements', 'promotions', 'liquidations', 'returns', 'payments', 'exchanges', 'loans', 'commissionAdjustments'];
    const load = products => {
      const snapshot = Object.fromEntries(keys.map(key => [key, key === 'products' ? products : []]));
      snapshot.commissionContext = { periodStart: '', sellerBases: [] };
      D.replaceFromOnline(snapshot);
    };
    const book = rows => {
      const wb = IO.__test.inventoryWorkbook([]).wb;
      const headers = X.utils.sheet_to_json(wb.Sheets.Inventario, { header: 1, defval: '' })[0];
      wb.Sheets.Inventario = X.utils.json_to_sheet(rows, { header: headers });
      return new File([X.write(wb, { bookType: 'xlsx', type: 'array' })], 'h175.xlsx');
    };
    const rowOf = (product, edit) => { const row = IO.__test.rowFromProduct(product, IO.sizeColumns()); edit(row); return row; };

    await check('Alta V2 con «No. Modelo» distinto guarda el código del catálogo Modelo', () => {
      const created = D.createReference(base({ id: '17500000-0000-4000-8000-000000000001' }), []);
      assert(created.modelo === 'TB' && created.attrs.producto === 'TB', JSON.stringify([created.modelo, created.attrs.producto]));
    });
    await check('Alta sin catálogo Modelo conserva el modelo capturado', () => {
      const created = D.createReference(base({ id: '17500000-0000-4000-8000-000000000002', modelo: 'H175', attrs: { __sizeCategoryId: 'size_number' } }), []);
      assert(created.modelo === 'H175', created.modelo);
    });
    await check('Alta por Excel con «No. Modelo» 0TB crea modelo TB', async () => {
      const sample = D.createReference(base({ id: '17500000-0000-4000-8000-000000000003' }), []);
      const row = rowOf(sample, r => { Object.keys(r).filter(k => k.startsWith('_BALAM_')).forEach(k => { r[k] = ''; }); r['No. Modelo'] = '0TB'; });
      const plan = IO.planImport(await IO.parseFile(book([row])), [], {});
      assert(plan.ok && plan.creates === 1, JSON.stringify(plan.conflicts.map(c => c.conflict)));
      const created = plan.rows[0].after || IO.applyImportPlan(plan, []).products[0];
      assert(created.modelo === 'TB', JSON.stringify(created.modelo));
    });

    // Referencias persistidas: protegida con dato histórico y libre con dato histórico.
    const guarded = { ...D.createReference(base({ id: '17500000-0000-4000-8000-000000000010', sizeCode: '40', stockQuantity: 3 }), []), modelo: '0TB', physicalIdentityLocked: true, _syncVersion: 2 };
    const free = { ...D.createReference(base({ id: '17500000-0000-4000-8000-000000000011', sizeCode: '42', referenceFamilyId: '17500000-0000-4000-8000-000000000098' }), []), modelo: '0TB', physicalIdentityLocked: false, _syncVersion: 2 };
    const normalized = { ...guarded, id: '17500000-0000-4000-8000-000000000012', sizeCode: '44', barcodeCode: null, sku: null, modelo: 'TB' };
    load([guarded, free, D.createReference({ ...normalized, stockQuantity: 2 }, [])]);
    const current = () => D.products.map(p => JSON.parse(JSON.stringify(p)));

    await check('Edición en Inventario: protegida conserva 0TB; libre se normaliza a TB', () => {
      const a = D.updateReference({ ...D.products.find(p => p.id === guarded.id), precio: 500 });
      const b = D.updateReference({ ...D.products.find(p => p.id === free.id), modelo: '0TB', precio: 500 });
      assert(a.modelo === '0TB' && b.modelo === 'TB', JSON.stringify([a.modelo, b.modelo]));
    });
    await check('Excel sobre referencia protegida no cambia su modelo ni la bloquea', async () => {
      const products = current(), target = products.find(p => p.id === guarded.id);
      const row = rowOf(target, r => { r['No. Modelo'] = 'TB'; r['Precio'] = 510; });
      const plan = IO.planImport(await IO.parseFile(book([row])), products, {});
      assert(plan.ok, JSON.stringify(plan.conflicts.map(c => c.conflict)));
      const after = plan.rows[0].after;
      assert(after && after.modelo === '0TB' && Number(after.precio) === 510, JSON.stringify(after && [after.modelo, after.precio]));
    });
    await check('Excel antiguo con 0TB sobre referencia ya normalizada no genera cambio', async () => {
      const products = current(), target = products.find(p => p.modelo === 'TB' && p.stockQuantity > 0);
      const row = rowOf(target, r => { r['No. Modelo'] = '0TB'; });
      const plan = IO.planImport(await IO.parseFile(book([row])), products, {});
      assert(plan.ok && plan.rows[0].unchanged, JSON.stringify({ conflicts: plan.conflicts.map(c => c.conflict), fields: plan.rows[0].fields }));
    });
    await check('Excel sobre referencia libre proyecta el catálogo Modelo', async () => {
      const products = current(), target = products.find(p => p.id === free.id);
      const row = rowOf(target, r => { r['No. Modelo'] = '0TB'; r['Precio'] = 520; });
      const plan = IO.planImport(await IO.parseFile(book([row])), products, {});
      assert(plan.ok && plan.rows[0].after.modelo === 'TB', JSON.stringify(plan.rows[0].after && plan.rows[0].after.modelo));
    });
    await check('Exportar e importar el inventario completo no genera cambios ni conflictos', async () => {
      // Estado posterior a la migración: todas las referencias ya dicen TB.
      load(current().map(p => ({ ...p, modelo: 'TB' })));
      const products = current(), wb = IO.__test.inventoryWorkbook(products).wb;
      const exported = X.utils.sheet_to_json(wb.Sheets.Inventario, { defval: '' });
      assert(exported.length === products.length && exported.every(row => row['No. Modelo'] === 'TB'), JSON.stringify(exported.map(row => row['No. Modelo'])));
      const file = new File([X.write(wb, { bookType: 'xlsx', type: 'array' })], 'h175-roundtrip.xlsx');
      const plan = IO.planImport(await IO.parseFile(file), products, {});
      assert(plan.ok && plan.creates === 0 && plan.unchangedCount === products.length,
        JSON.stringify({ conflicts: plan.conflicts.map(c => c.conflict), unchanged: plan.unchangedCount, total: products.length }));
    });
    await check('Un cambio físico real por Excel sigue bloqueado en una protegida', async () => {
      const products = current(), target = products.find(p => p.id === guarded.id);
      const row = rowOf(target, r => { r['Color Tela'] = C.all('color').find(item => item.code !== target.color).code; });
      const plan = IO.planImport(await IO.parseFile(book([row])), products, {});
      assert(!plan.ok && plan.conflicts.some(c => c.conflict.code === 'REFERENCE_RECLASSIFICATION_REQUIRED'), JSON.stringify(plan.conflicts.map(c => c.conflict)));
    });
    return out;
  });
  results.push({ name: 'Sin errores de página', ok: errors.length === 0, error: errors.join(' | ') });
} finally {
  await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
results.forEach(result => console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}${result.ok ? '' : ': ' + result.error}`));
const failed = results.filter(result => !result.ok).length;
console.log(`\nH-175: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
