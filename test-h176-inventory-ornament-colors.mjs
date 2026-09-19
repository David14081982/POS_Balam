// H-176: Inventario muestra, bajo el nombre del color de tela, círculos
// flotantes con los colores de ornamento de cada prenda. Navegador aislado.
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
  // La columna Color / Orn. sólo existe en la tabla; en celular Inventario usa tarjetas sin color.
  for (const width of [1280, 1024]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
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
      const orn = C.all('ornament').find(item => item.meta && item.meta.allowsColors !== false && item.meta.colorMode !== 'none').code;
      const colors = C.all('ornament_color').filter(item => item.meta && item.meta.hex).slice(0, 3);
      const common = { nombre: 'H176 BORDADA', modelo: 'H176', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', orn,
        precio: 450, costo: 200, sizeCategoryId: 'size_number', attrs: { __sizeCategoryId: 'size_number' } };
      const family = '17600000-0000-4000-8000-000000000099', plain = '17600000-0000-4000-8000-000000000098';
      const products = [
        D.createReference({ ...common, id: '17600000-0000-4000-8000-000000000001', referenceFamilyId: family, sizeCode: '38', stockQuantity: 2, ornamentColorCodes: [colors[0].code, colors[1].code] }, []),
        // El tercer color sólo está en una talla agotada: Inventario también la muestra.
        D.createReference({ ...common, id: '17600000-0000-4000-8000-000000000002', referenceFamilyId: family, sizeCode: '40', stockQuantity: 0, ornamentColorCodes: [colors[1].code, colors[2].code] }, []),
        D.createReference({ ...common, id: '17600000-0000-4000-8000-000000000003', referenceFamilyId: plain, nombre: 'H176 LISA', orn: '—', sizeCode: '38', stockQuantity: 1, ornamentColorCodes: [] }, []),
      ];
      const keys = ['products', 'sellers', 'clients', 'sales', 'movements', 'promotions', 'liquidations', 'returns', 'payments', 'exchanges', 'loans', 'commissionAdjustments'];
      const snapshot = Object.fromEntries(keys.map(key => [key, key === 'products' ? products : []]));
      snapshot.commissionContext = { periodStart: '', sellerBases: [] };
      D.replaceFromOnline(snapshot);
      window.AUTH.canAccess = () => true; window.AUTH.isAdmin = () => true;
      window.__roots.forEach(root => root.unmount()); document.body.innerHTML = '<div id="h176"></div>';
      ReactDOM.createRoot(document.getElementById('h176')).render(React.createElement(window.InventoryScreen));
      return { family, plain, expected: colors.map(item => ({ code: item.code, label: item.label, hex: item.meta.hex })) };
    });
    const row = page.getByTestId('inventory-product-family:' + fixture.family);
    await row.waitFor();

    await test(`${width}px: la familia muestra un círculo por color de ornamento, sin repetir`, async () => {
      const codes = await row.locator('[data-ornament-color]').evaluateAll(nodes => nodes.map(node => node.dataset.ornamentColor));
      assert.deepEqual(codes.sort(), fixture.expected.map(item => item.code).sort());
    });
    await test(`${width}px: cada círculo usa el HEX y nombre del catálogo, con sombra flotante`, async () => {
      const dots = await row.locator('[data-ornament-color]').evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect();
        return { code: node.dataset.ornamentColor, title: node.title, bg: style.backgroundColor, shadow: style.boxShadow, radius: style.borderRadius, w: box.width, h: box.height };
      }));
      const hex = value => { const [r, g, b] = value.match(/\d+/g).map(Number); return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join(''); };
      for (const dot of dots) {
        const expected = fixture.expected.find(item => item.code === dot.code);
        assert.equal(hex(dot.bg), expected.hex.toLowerCase());
        assert.equal(dot.title, expected.label);
        assert.match(dot.shadow, /rgba\(0, 0, 0, 0\.25\) 0px 2px 4px/);
        assert.equal(dot.radius, '50%'); assert.equal(Math.round(dot.w), 16); assert.equal(Math.round(dot.h), 16);
      }
    });
    await test(`${width}px: los círculos quedan enseguida debajo del nombre del color`, async () => {
      const layout = await row.evaluate(tr => {
        const cell = tr.querySelector('[data-testid="inventory-ornament-colors"]').closest('td');
        const name = [...cell.querySelectorAll('span')].find(node => !node.dataset.ornamentColor && node.textContent.trim());
        const strip = cell.querySelector('[data-testid="inventory-ornament-colors"]');
        const a = name.getBoundingClientRect(), b = strip.getBoundingClientRect();
        const tops = new Set([...strip.children].map(node => Math.round(node.getBoundingClientRect().top)));
        return { gap: b.top - a.bottom, nameLeft: a.left, stripLeft: b.left, text: name.textContent.trim(), rows: tops.size };
      });
      assert.ok(layout.gap >= 0 && layout.gap <= 12, JSON.stringify(layout));
      assert.equal(layout.rows, 1, 'los círculos deben quedar en una sola fila');
      assert.ok(Math.abs(layout.stripLeft - layout.nameLeft) <= 2, JSON.stringify(layout));
    });
    await test(`${width}px: una prenda sin ornamento no muestra círculos`, async () => {
      assert.equal(await page.getByTestId('inventory-product-family:' + fixture.plain).locator('[data-ornament-color]').count(), 0);
    });
    await test(`${width}px: sin errores de página`, () => assert.deepEqual(errors, []));
    if (width === 1280 && process.env.H176_SHOT) await row.screenshot({ path: process.env.H176_SHOT });
    await context.close();
  }
} finally {
  await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const failed = results.filter(result => !result.ok).length;
console.log(`\nH-176: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
