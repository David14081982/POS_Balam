import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.');
const server = createServer((req, res) => {
  const relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
  const file = resolve(root, relative);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' })[extname(file)] || 'application/octet-stream' });
  createReadStream(file).on('error', () => { res.writeHead(404); res.end(); }).pipe(res);
});
await new Promise(done => server.listen(8915, '127.0.0.1', done));

const checks = [];
const check = (name, condition, detail = '') => checks.push({ name, ok: Boolean(condition), detail });
const widths = [320, 360, 390, 430, 768, 1024, 1280, 1440];
let browser;

async function seed(page) {
  await page.waitForFunction(() => window.DATA && window.InventoryScreen);
  return page.evaluate(() => {
    const D = window.DATA;
    const v1 = D.hydrate({ id: 'h114-v1', recordModel: 'v1', cat: '1', modelo: 'H114', nombre: 'H114 V1', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'TRA', orn: 'BEL', precio: 100, sku: 'H114-V1', stock: [{ talla: 'M', stock: 3 }], attrs: { __sizeCategoryId: 'size_letter' } });
    const familyId = '11400000-0000-4000-8000-000000000114';
    const singletonId = '11400000-0000-4000-8000-000000000115';
    const common = { referenceFamilyId: familyId, cat: '1', modelo: 'H114', nombre: 'H114 V2 múltiple', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'TRA', orn: 'BEL', precio: 100, attrs: {}, sizeCategoryId: 'size_letter', sizeScale: 'L' };
    const refs = [
      D.createReference({ ...common, sizeCode: 'M', stockQuantity: 0, ornamentColorCodes: ['AZL'] }, []),
      D.createReference({ ...common, sizeCode: 'M', stockQuantity: 2, ornamentColorCodes: ['DRO'] }, []),
      D.createReference({ ...common, sizeCode: 'L', stockQuantity: 4, ornamentColorCodes: ['AZL'] }, []),
    ];
    const singleton = D.createReference({ ...common, referenceFamilyId: singletonId, nombre: 'H114 V2 singleton', sizeCode: 'L', stockQuantity: 1, ornamentColorCodes: ['AZL'] }, []);
    localStorage.setItem('balam_pos_products_v2', JSON.stringify([v1, ...refs, singleton]));
    return { v1Id: v1.id, familyId, singletonId, singletonRefId: singleton.id, refIds: refs.map(ref => ref.id) };
  });
}

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
    await page.goto('http://127.0.0.1:8915/index.html');
    const fixture = await seed(page);
    await page.reload();
    await page.getByTestId(`inventory-product-family:${fixture.familyId}`).click();
    await page.getByTestId('product-detail-delete').click();
    const modal = page.getByTestId('product-delete-modal');
    const fits = await modal.evaluate(node => node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().right <= innerWidth);
    check(`${width}px · modal sin desborde`, fits);
    check(`${width}px · alcances visibles`, await page.getByTestId('product-delete-reference-scope').isVisible() && await page.getByTestId('product-delete-family-scope').isVisible());
    const body = await page.locator('body').innerText();
    check(`${width}px · identidad técnica oculta`, !body.includes(fixture.familyId) && fixture.refIds.every(id => !body.includes(id)));
    check(`${width}px · sin error de página`, errors.length === 0, errors.join('; '));

    if (width === 390) {
      await page.getByTestId('product-delete-reference-scope').click();
      const labels = await page.locator('[data-testid^="product-delete-reference-"]').allInnerTexts();
      check('misma talla se distingue humanamente', labels.filter(label => label.includes('Talla M')).length === 2 && new Set(labels).size === labels.length, labels.join(' | '));
      await page.evaluate(() => {
        window.__h114Delete = null;
        window.DATA.removeProductScope = payload => { window.__h114Delete = payload; return { ok: true, count: payload.productIds.length }; };
      });
      await page.getByTestId('product-delete-reference-1').click();
      check('referencia exige confirmación', await page.getByTestId('product-delete-confirm').isVisible());
      await page.getByTestId('product-delete-confirm').click();
      const exact = await page.evaluate(() => window.__h114Delete);
      check('selección termina en un products.id exacto', exact.scope === 'reference' && exact.productIds.length === 1 && exact.productIds[0] === fixture.refIds[1]);

      await page.getByTestId(`inventory-product-family:${fixture.singletonId}`).click();
      await page.getByTestId('product-detail-delete').click();
      check('singleton va directo a confirmación', await page.getByTestId('product-delete-confirm').isVisible());
      await page.getByTestId('product-delete-confirm').click();
      const singleton = await page.evaluate(() => window.__h114Delete);
      check('singleton conserva products.id', singleton.productIds[0] === fixture.singletonRefId);

      await page.getByTestId(`inventory-product-family:${fixture.familyId}`).click();
      await page.getByTestId('product-detail-delete').click();
      await page.getByTestId('product-delete-family-scope').click();
      check('familia completa exige confirmación explícita', await page.getByTestId('product-delete-confirm').isVisible());
      await page.getByTestId('product-delete-confirm').click();
      const family = await page.evaluate(() => window.__h114Delete);
      check('familia conserva todos los products.id activos', family.scope === 'family'
        && family.productIds.slice().sort().join('|') === fixture.refIds.slice().sort().join('|'));

      await page.getByTestId(`inventory-product-${fixture.v1Id}`).click();
      await page.getByTestId('product-detail-delete').click();
      check('V1 también exige confirmación', await page.getByTestId('product-delete-confirm').isVisible());
      await page.getByTestId('product-delete-confirm').click();
      const v1 = await page.evaluate(() => window.__h114Delete);
      check('V1 conserva products.id exacto', v1.scope === 'reference' && v1.productIds[0] === fixture.v1Id);
    }
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
  await page.goto('http://127.0.0.1:8915/index.html');
  const fixture = await seed(page); await page.reload();
  const guards = await page.evaluate(({ refIds }) => {
    const D = window.DATA, id = refIds[0], product = D.products.find(row => row.id === id);
    const originalInvoke = window.CORE.invokeSync;
    window.CORE.invokeSync = (name, ...args) => name === 'queueStatus' ? { pending: 0, operations: [] } : originalInvoke(name, ...args);
    const stockZero = D.productDeletionGuard([id]);
    product.stockQuantity = 5; product.stock = [{ talla: product.sizeCode, stock: 5 }];
    const stockPositive = D.productDeletionGuard([id]);
    D.sales.push({ folio: 'H114-LAYAWAY', estado: 'Apartado', lineas: [{ productId: id, qty: 1 }] });
    const layaway = D.productDeletionGuard([id]); D.sales.length = 0;
    D.loans.push({ id: 'h114-loan', estado: 'pendiente', lineas: [{ productId: id, qty: 1, devueltas: 0 }] });
    const loan = D.productDeletionGuard([id]); D.loans.length = 0;
    D.sales.push({ folio: 'H114-RETURN', estado: 'Pagado', returnLimitDays: null, lineas: [{ lineId: 'H114-LINE', productId: id, sku: product.sku, talla: product.sizeCode, qty: 1 }] });
    const returnable = D.productDeletionGuard([id]);
    D.sales[0].returnLimitDays = 1; D.sales[0].returnExpiresAt = '2020-01-01';
    const expiredHistory = D.productDeletionGuard([id]); D.sales.length = 0;
    window.CORE.invokeSync = name => name === 'queueStatus' ? { pending: 1, operations: [{ type: 'upsert' }] } : undefined;
    const queue = D.productDeletionGuard([id]); window.CORE.invokeSync = originalInvoke;
    window.CORE.invokeSync = (name) => {
      if (name === 'queueStatus') return { pending: 0, operations: [] };
      if (name === 'deleteProductScope') throw new Error('cola no disponible');
      return undefined;
    };
    const beforeRollback = D.products.map(row => row.id).join('|');
    const rollbackResult = D.removeProductScope({ scope: 'reference', productIds: [id] });
    const rolledBack = beforeRollback === D.products.map(row => row.id).join('|');
    window.CORE.invokeSync = originalInvoke;
    return { stockZero, stockPositive, layaway, loan, returnable, expiredHistory, queue, rollbackResult, rolledBack };
  }, fixture);
  check('stock 0 permitido por autoridad V1', guards.stockZero.ok);
  check('stock positivo conserva autoridad V1', guards.stockPositive.ok && guards.stockPositive.stock === 5);
  check('apartado activo bloqueado', guards.layaway.code === 'LAYAWAY_ACTIVE');
  check('préstamo abierto bloqueado', guards.loan.code === 'PRODUCT_OPEN_LOAN');
  check('restitución vigente bloqueada', guards.returnable.code === 'PRODUCT_RETURNABLE_HISTORY');
  check('histórico vencido preservado y no bloquea', guards.expiredHistory.ok && guards.expiredHistory.history);
  check('cola pendiente bloqueada', guards.queue.code === 'PRODUCT_QUEUE_PENDING');
  check('fallo de cola revierte la mutación local', !guards.rollbackResult.ok && guards.rolledBack);

  const pull = await page.evaluate(({ refIds }) => {
    const D = window.DATA;
    const rows = D.products.map(row => ({ ...row, _deletedAt: refIds.includes(row.id) ? new Date().toISOString() : null }));
    const historicalBefore = JSON.stringify(D.sales);
    const ok = D.applyRemote('products', rows, { authoritative: true });
    return { ok, absent: refIds.every(id => !D.products.some(row => row.id === id)), historical: JSON.stringify(D.sales) === historicalBefore };
  }, fixture);
  check('pull/tombstone retira referencias', pull.ok && pull.absent);
  check('pull/tombstone preserva históricos', pull.historical);
  await page.reload();
  const absentAfterReload = await page.evaluate(ids => ids.every(id => !window.DATA.products.some(row => row.id === id)), fixture.refIds);
  check('reload conserva la baja', absentAfterReload);
  await context.close();

  const otherContext = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  await otherContext.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const otherPage = await otherContext.newPage();
  await otherPage.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
  await otherPage.goto('http://127.0.0.1:8915/index.html');
  const otherFixture = await seed(otherPage); await otherPage.reload();
  const otherTerminal = await otherPage.evaluate(ids => {
    const D = window.DATA;
    const rows = D.products.map(row => ({ ...row, _deletedAt: ids.includes(row.id) ? new Date().toISOString() : null }));
    D.applyRemote('products', rows, { authoritative: true });
    return ids.every(id => !D.products.some(row => row.id === id));
  }, otherFixture.refIds);
  check('otra terminal converge por tombstone', otherTerminal);
  await otherContext.close();

  const offlineContext = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  await offlineContext.route(/supabase\.co/, route => route.abort('internetdisconnected'));
  const offlinePage = await offlineContext.newPage();
  await offlinePage.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
  await offlinePage.goto('http://127.0.0.1:8915/index.html');
  await offlinePage.waitForFunction(() => window.STORE && window.DATA);
  const durable = await offlinePage.evaluate(async () => {
    await window.STORE.init({ pull: false });
    window.STORE.deleteProductScope({
      scope: 'reference', referenceFamilyId: null,
      targets: [{ id: 'h114-offline-exact', baseVersion: 7 }],
    });
    const raw = JSON.parse(localStorage.getItem('balam_sync_queue') || '[]');
    const op = raw.find(row => row.type === 'productDeleteScope');
    return !!op && op.rowIds.length === 1 && op.rowIds[0] === 'h114-offline-exact'
      && op.targets[0].baseVersion === 7;
  });
  check('offline conserva una operación durable exacta', durable);
  await offlinePage.reload({ waitUntil: 'domcontentloaded' });
  await offlinePage.waitForFunction(() => window.STORE && window.DATA);
  const survivesReload = await offlinePage.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('balam_sync_queue') || '[]');
    return raw.some(row => row.type === 'productDeleteScope' && row.rowIds[0] === 'h114-offline-exact');
  }).catch(() => false);
  check('cola offline sobrevive reload', survivesReload);
  await offlineContext.close();
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}

for (const result of checks) console.log(`${result.ok ? 'OK' : 'FAIL'} · ${result.name}${result.detail && !result.ok ? ` · ${result.detail}` : ''}`);
const failed = checks.filter(result => !result.ok);
console.log(`\nH-114 BALAM QA: ${checks.length - failed.length}/${checks.length} verificaciones aprobadas.`);
if (failed.length) process.exit(1);
