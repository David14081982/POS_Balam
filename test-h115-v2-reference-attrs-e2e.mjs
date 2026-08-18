// H-115 · Corte/Características generales deben llegar a cada referencia V2 existente.
// Supabase se intercepta: el recorrido demuestra UI → dominio → localStorage → reload → re-edición.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = resolve(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html');
  if (!path.startsWith(root) || !existsSync(path)) { res.writeHead(path.startsWith(root) ? 404 : 403); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
  createReadStream(path).pipe(res);
});
await new Promise(done => server.listen(8922, '127.0.0.1', done));

let pass = 0, fail = 0;
const ok = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  condition ? pass++ : fail++;
};
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  let remoteAttempts = 0;
  await context.route(/supabase\.co/, route => { remoteAttempts++; return route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }); });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
  await page.goto('http://127.0.0.1:8922/index.html');
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 60000 });
  await page.evaluate(() => {
    window.DATA.products.splice(0); window.DATA.persistProducts();
    [['producto','115','Modelo H115'],['corte','RECTO','Recto'],['corte','SLIM','Slim'],['corte','RELAX','Relax'],
      ['caracteristicas','LISO','Liso'],['caracteristicas','TEXTURA','Textura']]
      .forEach(([kind, code, label]) => window.CONFIG.addItem(kind, { code, label }));
    window.__h115Candidates = [];
    const create = window.DATA.createReference, update = window.DATA.updateReference;
    window.DATA.createReference = function(candidate, rows) {
      window.__h115Candidates.push({ op: 'create', attrs: JSON.parse(JSON.stringify(candidate.attrs || {})) });
      return create(candidate, rows);
    };
    window.DATA.updateReference = function(candidate) {
      window.__h115Candidates.push({ op: 'update', attrs: JSON.parse(JSON.stringify(candidate.attrs || {})) });
      return update(candidate);
    };
  });

  // A · Alta V2 con stock cero seleccionado.
  await page.getByTestId('inventory-new-product').click();
  await page.getByTestId('product-name').selectOption('115');
  await page.getByTestId('product-field-corte').selectOption('RECTO');
  await page.getByTestId('product-field-caracteristicas').selectOption('LISO');
  const firstStock = page.locator('[data-testid^="family-stock-"]').first();
  await firstStock.fill('1'); await firstStock.fill('0');
  await page.getByTestId('product-save').click();
  await page.getByTestId('product-form').waitFor({ state: 'detached' });
  const created = await page.evaluate(() => {
    const p = window.DATA.products[0];
    return { id: p.id, familyId: p.referenceFamilyId, attrs: p.attrs, stock: p.stockQuantity };
  });
  ok('A. alta V2 persiste Corte y Características', created.attrs.corte === 'RECTO' && created.attrs.caracteristicas === 'LISO' && created.stock === 0, JSON.stringify(created));

  // B · Edición general unlocked: ambos valores deben entrar al candidate y persistir.
  await page.getByTestId('inventory-product-family:' + created.familyId).click();
  await page.getByTestId('product-detail-edit').click();
  await page.getByTestId('product-field-corte').selectOption('SLIM');
  await page.getByTestId('product-field-caracteristicas').selectOption('TEXTURA');
  await page.getByTestId('product-save').click();
  await page.getByTestId('product-form').waitFor({ state: 'detached' });
  const unlocked = await page.evaluate(id => {
    const p = window.DATA.products.find(row => row.id === id);
    return { attrs: p.attrs, candidate: window.__h115Candidates.filter(x => x.op === 'update').at(-1), body: document.body.innerText };
  }, created.id);
  ok('B. el draft general lleva los valores nuevos', unlocked.candidate?.attrs?.corte === 'SLIM' && unlocked.candidate?.attrs?.caracteristicas === 'TEXTURA', JSON.stringify(unlocked.candidate));
  ok('B. unlocked persiste ambos valores', unlocked.attrs.corte === 'SLIM' && unlocked.attrs.caracteristicas === 'TEXTURA');
  ok('B. el éxito ya no es falso', /1 referencias guardadas/.test(unlocked.body));

  // C · Con stock/candado: ahora la guarda sí ve el cambio y el lote revierte.
  await page.evaluate(id => {
    const p = window.DATA.products.find(row => row.id === id);
    p.stockQuantity = 2; p.stock[0].stock = 2; p.physicalIdentityLocked = true; window.DATA.persistProducts();
  }, created.id);
  await page.reload(); await page.waitForFunction(id => window.DATA?.products?.some(row => row.id === id), created.id);
  await page.getByTestId('inventory-product-family:' + created.familyId).click();
  await page.getByTestId('product-detail-edit').click();
  await page.getByTestId('product-field-corte').selectOption('RECTO');
  await page.getByTestId('product-field-caracteristicas').selectOption('LISO');
  await page.getByTestId('product-save').click(); await page.waitForTimeout(250);
  const blocked = await page.evaluate(id => {
    const p = window.DATA.products.find(row => row.id === id);
    return { attrs: p.attrs, open: !!document.querySelector('[data-testid="product-form"]'), body: document.body.innerText };
  }, created.id);
  ok('C. stock bloquea y conserva ambos valores anteriores', blocked.open && blocked.attrs.corte === 'SLIM' && blocked.attrs.caracteristicas === 'TEXTURA', JSON.stringify(blocked.attrs));
  ok('C. no emite éxito falso', !/1 referencias guardadas/.test(blocked.body));
  page.once('dialog', dialog => dialog.accept()); await page.getByTestId('product-cancel').click();
  await page.getByTestId('product-detail-close').click();

  // D · Una excepción específica persiste. Si la familia queda mixta, ya no
  // existe un valor general autoritativo: seleccionar la opción vacía no debe
  // borrar silenciosamente el valor de la referencia.
  const variant = await page.evaluate(({ id, familyId }) => {
    const p = window.DATA.products.find(row => row.id === id);
    p.stockQuantity = 0; p.stock[0].stock = 0; p.physicalIdentityLocked = false;
    const size = window.CONFIG.list(p.sizeCategoryId).map(x => String(x.meta?.value ?? x.code)).find(x => x !== String(p.sizeCode));
    const second = window.DATA.createReference({ ...p, id: undefined, barcodeCode: undefined, physicalSignature: undefined,
      sizeCode: size, stockQuantity: 0, stock: [{ talla: size, escala: p.sizeScale, stock: 0 }],
      attrs: { ...p.attrs, corte: 'RECTO' }, referenceFamilyId: familyId, physicalIdentityLocked: false }, window.DATA.products);
    window.DATA.products.push(second); window.DATA.persistProducts(); return { id: second.id };
  }, { id: created.id, familyId: created.familyId });
  await page.reload(); await page.waitForFunction(id => window.DATA?.products?.some(row => row.id === id), variant.id);
  const editSpecial = async value => {
    await page.getByTestId('inventory-product-family:' + created.familyId).click();
    await page.getByTestId('product-detail-edit').click();
    const selects = page.getByText('Corte especial', { exact: true }).locator('..').locator('select');
    let target = selects.first();
    for (let i = 0; i < await selects.count(); i++) if (await selects.nth(i).inputValue() !== '') target = selects.nth(i);
    await target.selectOption(value); await page.getByTestId('product-save').click();
    await page.getByTestId('product-form').waitFor({ state: 'detached' });
  };
  await editSpecial('RELAX');
  ok('D. variante específica persiste', await page.evaluate(id => window.DATA.products.find(row => row.id === id).attrs.corte === 'RELAX', variant.id));
  await editSpecial('');
  ok('D. una familia mixta no borra el Corte al pedir valor general', await page.evaluate(id => window.DATA.products.find(row => row.id === id).attrs.corte === 'RELAX', variant.id));

  // E/F/G · reload, pull aislado, re-edición e inspección de cada products.attrs.
  await page.reload(); await page.waitForFunction(id => window.DATA?.products?.some(row => row.id === id), variant.id);
  await page.evaluate(async () => { if (window.STORE?.init) await window.STORE.init({ pull: true }).catch(() => {}); });
  await page.getByTestId('inventory-product-family:' + created.familyId).click();
  await page.getByTestId('product-detail-edit').click();
  const final = await page.evaluate(familyId => ({
    corte: document.querySelector('[data-testid="product-field-corte"]')?.value,
    caracteristicas: document.querySelector('[data-testid="product-field-caracteristicas"]')?.value,
    rows: window.DATA.products.filter(row => row.referenceFamilyId === familyId).map(row => ({ id: row.id, attrs: row.attrs })),
  }), created.familyId);
  ok('E. reload/pull/re-edición conserva la proyección mixta', final.corte === '' && final.caracteristicas === 'TEXTURA', JSON.stringify(final));
  ok('F. cada products.attrs conserva Corte/Características', final.rows.length === 2
    && final.rows.every(row => row.attrs.corte && row.attrs.caracteristicas === 'TEXTURA')
    && new Set(final.rows.map(row => row.attrs.corte)).size === 2);
  ok('G. Supabase permaneció aislado', remoteAttempts > 0);
  ok('sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
console.log(`\nH-115 E2E: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
