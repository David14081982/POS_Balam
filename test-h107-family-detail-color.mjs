// H-107 · V1 conserva Color tela y la proyección familiar V2 lo resuelve desde CONFIG.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.');
const evidence = resolve('.evidence-h107');
mkdirSync(evidence, { recursive: true });
const artifact = process.env.BALAM_ARTIFACT_PATH
  ? resolve(process.env.BALAM_ARTIFACT_PATH) : resolve(root, 'index.html');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
  const path = relative === 'index.html' ? artifact : resolve(root, relative);
  if (relative !== 'index.html' && !path.startsWith(root)) { res.writeHead(403); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
  createReadStream(path).on('error', () => { res.writeHead(404); res.end(); }).pipe(res);
});

await new Promise(done => server.listen(8917, '127.0.0.1', done));
let pass = 0, fail = 0;
const ok = (name, value, detail = '') => {
  console.log(`${value ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  value ? pass++ : fail++;
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
  await page.goto('http://127.0.0.1:8917/index.html');
  await page.waitForFunction(() => window.DATA && window.CONFIG);
  const fixture = await page.evaluate(() => {
    const D = window.DATA;
    const v1 = {
      id: 'h107-v1-bl', recordModel: 'v1', cat: '10', modelo: 'VIC1', nombre: 'VICTOR V1',
      manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', orn: 'Bordado Eléctrico', precio: 1250,
      stock: [{ talla: 'M', escala: 'L', stock: 2 }], attrs: { producto: 'VIC1' },
    };
    const familyId = '10700000-0000-4000-8000-000000000107';
    const base = { referenceFamilyId: familyId, cat: '10', modelo: 'VIC2', nombre: 'VICTOR V2', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', orn: 'Bordado Eléctrico', precio: 1250, attrs: { producto: 'VIC2', corte: '-', caracteristicas: '66' } };
    const refs = [];
    for (const [size, stock] of [['S', 2], ['M', 3]]) {
      refs.push(D.createReference({ ...base, sizeCategoryId: 'size_letter', sizeCode: size, sizeScale: 'L', stockQuantity: stock, ornamentColorCodes: ['AZL'] }, refs));
    }
    localStorage.setItem('balam_pos_products_v2', JSON.stringify([v1, ...refs]));
    return { v1Id: v1.id, familyId };
  });
  await page.reload();

  const colorCardText = async () => {
    const label = page.getByRole('dialog', { name: 'Detalle del producto' }).getByText('Color Tela', { exact: true });
    return (await label.locator('..').innerText()).replace(/\s+/g, ' ').trim();
  };

  await page.getByTestId('inventory-product-' + fixture.v1Id).click();
  const v1Color = await colorCardText();
  ok('A. V1 muestra BLANCO', /Color Tela Blanco/i.test(v1Color), v1Color);
  await page.getByTestId('product-detail-close').click();

  await page.getByTestId('inventory-product-family:' + fixture.familyId).click();
  const v2Color = await colorCardText();
  ok('B. V2 familiar BL muestra BLANCO', /Color Tela Blanco/i.test(v2Color), v2Color);
  const detailText = await page.getByRole('dialog', { name: 'Detalle del producto' }).innerText();
  ok('C. atributos ya visibles conservan su mapeo', ['VICTOR V2', 'Guayabera Blanca', 'Manga Larga', 'Algodón', 'Normal / Clásico', 'Bordado Eléctrico'].every(value => detailText.includes(value)), detailText.replace(/\s+/g, ' '));
  for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 820 });
    const color = await colorCardText();
    const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
    ok(`D.${width}. detalle V2 legible y sin overflow`, /Color Tela Blanco/i.test(color) && overflow === 0, `${color} · overflow=${overflow}`);
    if (width === 320 || width === 1440) await page.screenshot({ path: resolve(evidence, `detail-v2-color-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const projection = await page.evaluate(id => {
    const p = window.DATA.referenceFamilyProjection(id);
    return { nombre: p.nombre, modelo: p.modelo, cat: p.cat, manga: p.manga, tela: p.tela, color: p.color, cuello: p.cuello, orn: p.orn, colorName: p.colorName, colorHex: p.colorHex, commonAttributes: p.commonAttributes, mixedAttributes: p.mixedAttributes };
  }, fixture.familyId);
  ok('E. la proyección conserva campos y atributos comunes', projection.nombre === 'VICTOR V2' && projection.modelo === 'VIC2' && projection.cat === '10' && projection.manga === 'ML' && projection.tela === 'ALG' && projection.color === 'BL' && projection.cuello === 'NOR' && projection.orn === 'Bordado Eléctrico' && projection.commonAttributes.corte === '-' && projection.commonAttributes.caracteristicas === '66', JSON.stringify(projection));
  ok('F. la proyección resuelve nombre y swatch', projection.colorName === 'Blanco' && /^#/.test(projection.colorHex || ''), JSON.stringify(projection));
  const catalog = await page.evaluate(() => ({
    label: window.CONFIG.catalogLabel('color'),
    item: window.CONFIG.find('color', 'BL'),
  }));
  ok('G. CONFIG conserva Color Tela = BLANCO', catalog.label === 'Color Tela' && catalog.item?.label === 'Blanco', JSON.stringify(catalog));
  const separation = await page.evaluate(id => {
    const p = window.DATA.referenceFamilyProjection(id);
    return { fabricColor: p.color, ornamentColorGroups: p.ornamentColorGroups };
  }, fixture.familyId);
  ok('H. Color tela y AZL histórico siguen separados', separation.fabricColor === 'BL' && separation.ornamentColorGroups.flat().includes('AZL'), JSON.stringify(separation));
  const mixed = await page.evaluate(() => {
    const D = window.DATA, familyId = '10700000-0000-4000-8000-000000000108', refs = [];
    const base = { referenceFamilyId: familyId, cat: '10', modelo: 'MIX', nombre: 'MIXTA', manga: 'ML', tela: 'ALG', cuello: 'NOR', orn: 'Bordado Eléctrico', precio: 1, attrs: { producto: 'MIX' }, sizeCategoryId: 'size_letter', sizeScale: 'L', stockQuantity: 1 };
    refs.push(D.createReference({ ...base, color: 'BL', sizeCode: 'S', ornamentColorCodes: ['AZL'] }, refs));
    refs.push(D.createReference({ ...base, color: 'AZ', sizeCode: 'M', ornamentColorCodes: ['AZL'] }, refs));
    const p = D.referenceFamilyProjection(familyId, refs);
    return { color: p.color, colorName: p.colorName, colorHex: p.colorHex };
  });
  ok('I. familia mixta no recibe un color común inventado', mixed.color === null && mixed.colorName == null && mixed.colorHex == null, JSON.stringify(mixed));
  await page.screenshot({ path: resolve(evidence, 'detail-v2-color-1280.png'), fullPage: true });
  ok('J. recorrido sin errores de página', pageErrors.length === 0, pageErrors.join(' | '));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
