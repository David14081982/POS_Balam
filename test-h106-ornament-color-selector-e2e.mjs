// H-106: selector compartido legible con 68 colores, búsqueda y responsive.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.');
const evidence = resolve('.evidence-h106');
mkdirSync(evidence, { recursive: true });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const file = resolve(root, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html');
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).on('error', () => { res.writeHead(404); res.end(); }).pipe(res);
});
await new Promise(done => server.listen(8916, '127.0.0.1', done));

let passed = 0, failed = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? passed++ : failed++;
};

const primaryColors = [
  ['DRO', 'Dorado', '#caa83a'], ['AZ', 'Azul', '#3b6fb0'], ['AAC', 'Azul Acero', '#607d8b'],
  ['AMAR', 'Azul Marino', '#17365d'], ['CF', 'Café', '#5a4334'], ['CCHO', 'Café Chocolate', '#4b2e24'],
  ['BL', 'Blanco', '#ffffff'], ['NEG', 'Negro', '#1c1f24'], ['VMIL', 'Verde Militar', '#596b3f'],
  ['LREAL', 'Verde Extraordinariamente Profundo del Catálogo', '#294936'],
];
const activeColors = primaryColors.concat(Array.from({ length: 58 }, (_, index) => [
  `X${String(index + 1).padStart(2, '0')}`, `Color de prueba ${String(index + 1).padStart(2, '0')}`, `hsl(${index * 6} 55% 50%)`,
]));

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('balam-page', 'inventario'));
  await page.goto('http://127.0.0.1:8916/index.html');
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 60000 });
  const fixture = await page.evaluate(colors => {
    const snapshot = window.CONFIG.snapshot();
    snapshot.catalogs.ornament_color = colors.map(([code, label, hex]) => ({ code, label, active: true, meta: { hex } }))
      .concat([{ code: 'AZL', label: 'Azul', active: false, meta: { hex: '#3b6fb0' } }]);
    window.CONFIG.load(snapshot);
    const familyId = '10600000-0000-4000-8000-000000000106';
    const result = window.DATA.materializeReferenceFamily({
      referenceFamilyId: familyId, cat: '1', modelo: 'H106', nombre: 'SELECTOR H106', manga: 'MC',
      tela: 'ALG', color: 'BL', cuello: 'MAO', orn: 'Bordado Eléctrico', sizeCategoryId: 'size_number',
      precio: 1000, costo: 400, attrs: { producto: 'H106' },
    }, [
      { selectedForCreation: true, sizeCode: '38', sizeScale: 'N', stockQuantity: 1, ornamentColorCodes: ['DRO'] },
      { selectedForCreation: true, sizeCode: '38', sizeScale: 'N', stockQuantity: 1, ornamentColorCodes: ['AZ'] },
    ], [], familyId);
    result.references[1].ornamentColorCodes = ['AZL'];
    result.references[1].ornColors = ['AZL'];
    localStorage.setItem('balam_pos_products_v2', JSON.stringify(result.references));
    return { familyId, firstId: result.references[0].id };
  }, activeColors);
  await page.reload();
  await page.waitForFunction(id => window.DATA?.products?.some(row => row.id === id), fixture.firstId);
  await page.getByTestId('inventory-product-family:' + fixture.familyId).click();
  await page.getByTestId('product-detail-edit').click();
  await page.getByTestId('reference-family-grid').waitFor();

  const inspectOpenPanel = async (toggle, optionPrefix, screenshot) => {
    await toggle.click();
    const panel = page.getByRole('group', { name: 'Selector de colores de ornamento' });
    await panel.waitFor();
    const metrics = await panel.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const option = node.querySelector('[data-testid*="-color-AAC"]');
      const swatch = option && option.querySelector('[data-color-swatch]');
      const search = node.querySelector('input[type="search"]');
      return {
        width: rect.width, left: rect.left, right: rect.right,
        viewport: document.documentElement.clientWidth,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        optionText: option?.innerText || '', optionHeight: option?.getBoundingClientRect().height || 0,
        swatchBorder: swatch ? getComputedStyle(swatch).borderTopWidth : '',
        searchTop: search?.getBoundingClientRect().top || 0,
      };
    });
    await panel.screenshot({ path: resolve(evidence, screenshot) });
    check(`${optionPrefix}: panel tiene ancho útil propio`, metrics.width >= Math.min(360, metrics.viewport - 32), JSON.stringify(metrics));
    check(`${optionPrefix}: cada opción muestra código y nombre`, /AAC/.test(metrics.optionText) && /Azul Acero/.test(metrics.optionText), metrics.optionText);
    check(`${optionPrefix}: target y swatch son distinguibles`, metrics.optionHeight >= 44 && parseFloat(metrics.swatchBorder) >= 1, JSON.stringify(metrics));
    check(`${optionPrefix}: no hay overflow horizontal`, metrics.left >= 0 && metrics.right <= metrics.viewport && !metrics.pageOverflow, JSON.stringify(metrics));
    for (const [code, label] of primaryColors) {
      const option = page.getByTestId(optionPrefix + '-color-' + code);
      check(`${optionPrefix}: ${code} muestra su nombre`, (await option.innerText()).includes(label));
    }
    const search = panel.locator('input[type="search"]');
    await search.fill('CAFE CHOCOLATE');
    check(`${optionPrefix}: busca nombre sin distinguir acentos`, await page.getByTestId(optionPrefix + '-color-CCHO').isVisible().catch(() => false));
    await search.fill('VMIL');
    check(`${optionPrefix}: busca por código`, await page.getByTestId(optionPrefix + '-color-VMIL').isVisible().catch(() => false));
    await search.fill('');
    const multiOptions = ['AMAR', 'DRO'].map(code => page.getByTestId(optionPrefix + '-color-' + code));
    for (const option of multiOptions) if (await option.getAttribute('aria-pressed') !== 'true') await option.click();
    check(`${optionPrefix}: conserva multiselección`,
      (await Promise.all(multiOptions.map(option => option.getAttribute('aria-pressed')))).every(value => value === 'true')
      && await panel.locator('[aria-pressed="true"]').count() >= 2);
    return panel;
  };

  const variantToggle = page.locator('[data-testid^="family-variant-"][data-testid$="-colors"]').first();
  const variantPrefix = (await variantToggle.getAttribute('data-testid')).replace(/-colors$/, '');
  let panel = await inspectOpenPanel(variantToggle, variantPrefix, 'desktop-variante.png');
  const historical = page.getByTestId(variantPrefix + '-color-AZL');
  check('editar conserva AZL visible y marcado como histórico',
    await historical.count() === 1 && /Histórico/.test(await historical.innerText()));
  check('Blanco conserva borde visible',
    parseFloat(await page.getByTestId(variantPrefix + '-color-BL').locator('[data-color-swatch]').evaluate(node => getComputedStyle(node).borderTopWidth)) >= 1);
  check('el nombre largo conserva tooltip completo',
    (await page.getByTestId(variantPrefix + '-color-LREAL').getAttribute('title')).includes('Verde Extraordinariamente Profundo del Catálogo'));
  await panel.getByRole('button', { name: 'Cerrar selector de colores' }).click();
  await page.waitForFunction(testId => document.activeElement?.dataset?.testid === testId, await variantToggle.getAttribute('data-testid'));
  check('cerrar selector restaura foco al disparador', await variantToggle.evaluate(node => node === document.activeElement));

  await page.getByTestId('product-exceptions-toggle').click();
  await page.getByTestId('add-ornament-colors-by-size').click();
  panel = await inspectOpenPanel(page.getByTestId('ornament-group-0-color-toggle'), 'ornament-group-0', 'desktop-excepcion.png');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.activeElement?.dataset?.testid === 'ornament-group-0-color-toggle');
  check('Escape cierra sólo el selector y restaura foco',
    await panel.count() === 0 && await page.getByTestId('product-form').isVisible()
      && await page.getByTestId('ornament-group-0-color-toggle').evaluate(node => node === document.activeElement));

  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 780 });
    panel = await inspectOpenPanel(page.getByTestId('ornament-group-0-color-toggle'), 'ornament-group-0', `mobile-${width}.png`);
    await panel.getByRole('button', { name: 'Cerrar selector de colores' }).click();
  }
  check('sin errores de página', errors.length === 0, errors.join(' | '));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}

console.log(`\n${passed} pasaron, ${failed} fallaron`);
process.exit(failed ? 1 : 0);
