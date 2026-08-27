// H-126 · Recorrido real de las tres superficies que consumen el lector.
// Usa el bundle como entorno y carga las fuentes modificadas antes de renderizar
// cada pantalla. Todos los datos son sintéticos y Supabase queda bloqueado.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve('.');
const evidence = resolve('.evidence-h126');
const bundleOnly = process.argv.includes('--bundle');
await mkdir(evidence, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.jsx': 'text/javascript' };
const server = createServer((request, response) => {
  let pathname = decodeURIComponent(request.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const file = join(root, pathname);
  if (!file.startsWith(root) || !existsSync(file)) { response.writeHead(404); response.end('nf'); return; }
  response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));

let passed = 0;
let failed = 0;
const errors = [];
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? passed++ : failed++;
};
const widths = [320, 360, 390, 430, 768, 1024, 1280, 1440];
async function responsive(page, surface, testId) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
    await page.waitForTimeout(80);
    const state = await page.evaluate(id => {
      const input = document.querySelector(`[data-testid="${id}"]`);
      const rect = input?.getBoundingClientRect();
      return {
        overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
        visible: !!rect && rect.width > 0 && rect.right > 0 && rect.left < document.documentElement.clientWidth,
      };
    }, testId);
    check(`${surface} ${width}px mantiene visible el lector y sin overflow`, state.visible && state.overflow <= 1,
      `visible=${state.visible} overflow=${state.overflow}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function pageWith(...sources) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/supabase\.co/, route => route.abort());
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.BARCODES && window.ReactDOM);
  if (!bundleOnly) {
    for (const source of ['balam/barcodes.jsx', ...sources]) await page.addScriptTag({ path: resolve(source) });
  }
  await page.evaluate(() => {
    window.__h126ScanFixture = () => {
      const D = window.DATA;
      D.products.splice(0, D.products.length);
      const product = D.hydrate({
        id: 'h126-e2e', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
        modelo: '917', nombre: 'CAMISA LECTOR H126', orn: '—', ornColors: [], precio: 900,
        costo: 0, pop: false, stock: D.mkStock([0, 3, 0], []),
      });
      D.products.push(product);
      const size = product.stock.find(row => row.stock > 0).talla;
      const code = window.BARCODES.codeOf(product, size);
      return { product, size, code, scanned: code.split('-').join("'"), snapshot: JSON.stringify(product) };
    };
  });
  return { context, page };
}

try {
  console.log('\n── POS: entrada directa y captura global ───────────────');
  {
    const { context, page } = await pageWith('balam/pos.jsx');
    const fixture = await page.evaluate(() => {
      const value = window.__h126ScanFixture();
      document.body.innerHTML = '<div id="h126-root"></div>';
      window.__h126Root = ReactDOM.createRoot(document.getElementById('h126-root'));
      window.__h126Root.render(React.createElement(window.POSScreen, {}));
      window.__h126Fixture = value;
      return { size: value.size, code: value.code, scanned: value.scanned };
    });
    const input = page.getByTestId('pos-barcode-input');
    await input.waitFor();
    await input.fill(fixture.scanned);
    await input.press('Enter');
    await page.waitForTimeout(250);
    const direct = await page.getByTestId('pos-cart-open').getAttribute('aria-label');
    check('POS acepta apóstrofes del lector y agrega la pieza exacta', /1 art[ií]culos/i.test(direct || ''), direct || 'sin carrito');
    check('POS deja el campo listo para la siguiente lectura', await input.inputValue() === '');

    await page.evaluate(scanned => {
      document.activeElement?.blur();
      for (const key of scanned) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }, fixture.scanned);
    await page.waitForTimeout(250);
    const global = await page.getByTestId('pos-cart-open').getAttribute('aria-label');
    check('POS global acepta la misma ráfaga aunque el buscador no tenga foco', /2 art[ií]culos/i.test(global || ''), global || 'sin carrito');
    check('POS no altera el producto al resolver ambas lecturas', await page.evaluate(() => JSON.stringify(window.__h126Fixture.product) === window.__h126Fixture.snapshot));
    await responsive(page, 'POS', 'pos-barcode-input');
    await page.screenshot({ path: join(evidence, 'pos-lector-390.png'), fullPage: true });
    await context.close();
  }

  console.log('\n── Préstamos: entrada directa y captura global ─────────');
  {
    const { context, page } = await pageWith('balam/loans.jsx');
    const fixture = await page.evaluate(() => {
      const value = window.__h126ScanFixture();
      window.DATA.loans.splice(0, window.DATA.loans.length);
      if (window.STORE) window.STORE.pushRows = () => {};
      document.body.innerHTML = '<div id="h126-root"></div>';
      window.__h126Root = ReactDOM.createRoot(document.getElementById('h126-root'));
      window.__h126Root.render(React.createElement(window.LoansScreen));
      window.__h126Fixture = value;
      return { sku: value.product.sku, size: value.size, scanned: value.scanned };
    });
    await page.getByTestId('loans-nuevo').click();
    const input = page.getByTestId('prestamo-buscar-producto');
    await input.fill(fixture.scanned);
    await input.press('Enter');
    await page.waitForTimeout(250);
    check('Préstamos agrega directamente la talla contenida en la lectura',
      await page.getByTestId(`prestamo-mas-${fixture.sku}|${fixture.size}`).count() === 1);
    check('Préstamos limpia el buscador después de resolver', await input.inputValue() === '');

    const person = page.getByTestId('prestamo-persona');
    await person.fill('Rodrigo');
    await person.focus();
    await page.evaluate(scanned => {
      const element = document.querySelector('[data-testid="prestamo-persona"]');
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      for (const key of scanned) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        set.call(element, element.value + key);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }, fixture.scanned);
    await page.waitForTimeout(300);
    check('Préstamos global suma la segunda pieza', /2 pieza\(s\)/i.test(await page.locator('body').innerText()));
    check('la ráfaga no queda escrita en el nombre de la persona', await person.inputValue() === 'Rodrigo', await person.inputValue());
    check('Préstamos no altera el producto al resolver', await page.evaluate(() => JSON.stringify(window.__h126Fixture.product) === window.__h126Fixture.snapshot));
    await responsive(page, 'Préstamos', 'prestamo-buscar-producto');
    await page.screenshot({ path: join(evidence, 'prestamos-lector-390.png'), fullPage: true });
    await context.close();
  }

  console.log('\n── Cambios: lector dentro del flujo de posventa ─────────');
  {
    const { context, page } = await pageWith('balam/returns.jsx');
    const fixture = await page.evaluate(() => {
      const value = window.__h126ScanFixture();
      const D = window.DATA;
      D.sales.splice(0, D.sales.length);
      D.exchanges.splice(0, D.exchanges.length);
      if (window.STORE) { window.STORE.pushSale = () => {}; window.STORE.pushExchange = () => {}; }
      const sale = D.recordSale({
        ticket: [{ p: value.product, talla: value.size, qty: 1 }], sellerIds: [], client: null,
        metodo: 'Efectivo', estado: 'Pagado', total: 900, itemCount: 1,
      });
      try { localStorage.removeItem('balam_ultima_operacion'); } catch (error) {}
      window.AUTH.current = () => ({ nombre: 'Ana Cajera', email: 'ana@balam.mx' });
      document.body.innerHTML = '<div id="h126-root"></div>';
      window.__h126Root = ReactDOM.createRoot(document.getElementById('h126-root'));
      window.__h126Root.render(React.createElement(window.ReturnsScreen));
      window.__h126Fixture = value;
      return { folio: sale.folio, scanned: value.scanned, snapshot: JSON.stringify(value.product) };
    });
    await page.getByTestId('operacion-cambio').click();
    await page.getByTestId('returns-sale-search').fill(fixture.folio);
    await page.getByTestId(`return-sale-${fixture.folio}`).click();
    const input = page.getByTestId('cambio-escaner');
    await input.fill(fixture.scanned);
    await input.press('Enter');
    await page.waitForTimeout(250);
    check('Cambios agrega la pieza escaneada con apóstrofes', await page.getByTestId('cambio-quitar').count() === 1);
    check('Cambios limpia el escáner después de resolver', await input.inputValue() === '');
    check('Cambios no altera SKU ni producto al resolver', await page.evaluate(snapshot => JSON.stringify(window.__h126Fixture.product) === snapshot, fixture.snapshot));
    await responsive(page, 'Cambios', 'cambio-escaner');
    await page.screenshot({ path: join(evidence, 'cambios-lector-390.png'), fullPage: true });
    await context.close();
  }

  check('el recorrido termina sin errores de página', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}

console.log(`\nH-126 E2E lector/teclado: ${passed} pasaron, ${failed} fallaron`);
process.exit(failed ? 1 : 0);
