// H-174: editar una familia protegida cuyo `modelo` histórico (0TB) difiere
// de su catálogo Modelo (producto=TB) no debe reenviar un modelo distinto.
// Frontera remota controlada que replica la guarda SQL; cero escrituras reales.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const results = [];
async function test(name, run) {
  try { await run(); results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, ok: false }); console.log('FAIL ' + name + ': ' + error.message); }
}
const remote = process.argv.find(arg => /^https?:\/\//.test(arg));
const html = remote ? null : fs.readFileSync('index.html');
const server = remote ? null : http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end(html); });
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = remote || 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE
  ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE, headless: true } : { channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().url().startsWith(new URL(url).origin) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    window.__roots = []; let rd;
    Object.defineProperty(window, 'ReactDOM', { configurable: true, get: () => rd, set: value => {
      rd = value; let create;
      Object.defineProperty(value, 'createRoot', { configurable: true, get: () => create,
        set: fn => { create = (...args) => { const root = fn(...args); window.__roots.push(root); return root; }; } });
    } });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.AUTH?.isReady() && window.DATA && window.InventoryScreen);
  const fixture = await page.evaluate(() => {
    const D = window.DATA, C = window.CONFIG;
    C.load(C.prepareMutation('reset', []).state);
    C.load(C.prepareMutation('addItem', ['producto', { code: 'TB', label: 'TIRA BORDADA' }]).state);
    const family = '17400000-0000-4000-8000-000000000099';
    const common = { nombre: 'TIRA BORDADA', modelo: 'TB', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', orn: '—',
      ornamentColorCodes: [], ornColors: [], precio: 450, costo: 200, sizeCategoryId: 'size_number',
      attrs: { producto: 'TB', __sizeCategoryId: 'size_number' }, referenceFamilyId: family };
    const products = ['38', '40'].map((size, index) => {
      const row = D.createReference({ ...common, id: '17400000-0000-4000-8000-00000000000' + (index + 1), sizeCode: size, sizeScale: 'N', stockQuantity: 3 }, []);
      // Dato histórico real: columna modelo con prefijo, catálogo Modelo sin él.
      return { ...row, modelo: '0TB', physicalIdentityLocked: true };
    });
    // Otra familia sin existencias ni operaciones: su modelo sí es editable.
    const free = D.createReference({ ...common, id: '17400000-0000-4000-8000-000000000003', referenceFamilyId: '17400000-0000-4000-8000-000000000098',
      sizeCode: '42', sizeScale: 'N', stockQuantity: 0 }, []);
    products.push({ ...free, modelo: '0TB', physicalIdentityLocked: false });
    const keys = ['products', 'sellers', 'clients', 'sales', 'movements', 'promotions', 'liquidations', 'returns', 'payments', 'exchanges', 'loans', 'commissionAdjustments'];
    const snapshot = Object.fromEntries(keys.map(key => [key, key === 'products' ? products : []]));
    snapshot.commissionContext = { periodStart: '', sellerBases: [] };
    window.__snapshot = snapshot; window.__sent = []; D.replaceFromOnline(snapshot);
    // Réplica de pos.h94_guard_used_reference_identity sobre la fila persistida.
    const PROTECTED = ['physicalSignature', 'cat', 'manga', 'tela', 'color', 'cuello', 'modelo', 'orn', 'sizeCategoryId', 'sizeCode', 'sizeScale'];
    const stable = value => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
    const save = async rows => {
      window.__sent.push(JSON.parse(JSON.stringify(rows)));
      for (const row of rows) {
        const old = window.__snapshot.products.find(item => item.id === row.id);
        if (!old || !(old.physicalIdentityLocked || Number(old.stockQuantity) !== 0)) continue;
        const colors = list => JSON.stringify([...(list || [])].sort());
        const changed = PROTECTED.filter(key => String(old[key] ?? '') !== String(row[key] ?? ''));
        if (colors(old.ornamentColorCodes) !== colors(row.ornamentColorCodes)) changed.push('ornamentColorCodes');
        if (stable(old.attrs) !== stable(row.attrs)) changed.push('attrs');
        if (changed.length) { window.__rejected = changed; throw Object.assign(new Error('REFERENCE_RECLASSIFICATION_REQUIRED'), { code: 'P0001' }); }
      }
      window.__snapshot.products = window.__snapshot.products.map(item => rows.find(row => row.id === item.id) || item);
      D.replaceFromOnline(window.__snapshot); return { ok: true };
    };
    window.CORE.registerSyncGateway({ assertBusinessReady: () => true, pushRows: (kind, rows) => save(rows), pushProductFamilyBatch: (id, rows) => save(rows) });
    window.AUTH.canAccess = () => true; window.AUTH.isAdmin = () => true;
    window.__roots.forEach(root => root.unmount()); document.body.innerHTML = '<div id="h174-toast"></div><div id="h174"></div>';
    ReactDOM.createRoot(document.getElementById('h174-toast')).render(React.createElement(window.UI.ToastHost));
    ReactDOM.createRoot(document.getElementById('h174')).render(React.createElement(window.InventoryScreen));
    return { family, ids: products.map(row => row.id), modelKind: C.modeloKind(), loaded: D.products.filter(row => row.referenceFamilyId === family).map(row => [row.id, row.modelo, row.attrs.producto, row.physicalIdentityLocked]) };
  });

  await test('Fixture: familia protegida con modelo 0TB y catálogo Modelo TB', () => {
    assert.equal(fixture.modelKind, 'producto');
    assert.deepEqual(fixture.loaded.map(row => row.slice(1)), [['0TB', 'TB', true], ['0TB', 'TB', true]]);
  });

  await test('Editar precio de la familia guarda sin P0001 y conserva el modelo', async () => {
    await page.getByTestId('inventory-product-family:' + fixture.family).click();
    await page.getByTestId('product-detail-edit').click();
    await page.getByTestId('product-general-price').fill('520');
    await page.getByTestId('product-save').click();
    await page.getByTestId('product-form').waitFor({ state: 'detached', timeout: 5000 }).catch(async () => {
      throw new Error('formulario sigue abierto: ' + JSON.stringify(await page.evaluate(() => ({ rejected: window.__rejected,
        sent: (window.__sent.at(-1) || []).map(row => row.modelo) }))));
    });
    const saved = await page.evaluate(family => window.__snapshot.products.filter(row => row.referenceFamilyId === family).map(row => [row.modelo, row.precio, row.attrs.producto]), fixture.family);
    assert.deepEqual(saved.map(row => row.slice(0, 3)), [['0TB', 520, 'TB'], ['0TB', 520, 'TB']]);
    const sent = await page.evaluate(() => window.__sent.at(-1).map(row => row.modelo));
    assert.deepEqual(sent, ['0TB', '0TB']);
  });

  await test('DATA.updateReference conserva el modelo persistido de una referencia protegida', async () => {
    const result = await page.evaluate(id => {
      const next = window.DATA.updateReference({ ...window.DATA.products.find(row => row.id === id), modelo: 'TB', precio: 530 });
      return [next.modelo, next.precio];
    }, fixture.ids[0]);
    assert.deepEqual(result, ['0TB', 530]);
  });

  await test('Un cambio físico real en una referencia protegida sigue bloqueado', async () => {
    const code = await page.evaluate(id => {
      try { window.DATA.updateReference({ ...window.DATA.products.find(row => row.id === id), color: 'NEG' }); return 'ACCEPTED'; }
      catch (error) { return error.code; }
    }, fixture.ids[0]);
    assert.equal(code, 'REFERENCE_RECLASSIFICATION_REQUIRED');
  });

  await test('Una referencia sin existencias ni operaciones sí puede corregir su modelo', async () => {
    const result = await page.evaluate(id => window.DATA.updateReference({ ...window.DATA.products.find(row => row.id === id), modelo: 'TB' }).modelo, fixture.ids[2]);
    assert.equal(result, 'TB');
  });

  await test('Sin errores de página', () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const failed = results.filter(result => !result.ok).length;
console.log(`\nH-174: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
