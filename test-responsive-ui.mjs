import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const ROOT = resolve('.');
const PUBLIC_URL = process.env.BALAM_BASE_URL;
const WIDTHS = [320, 360, 375, 390, 430, 600, 768, 1024, 1280, 1440];
const SCREENS = ['dashboard', 'pos', 'inventario', 'clientes', 'apartados', 'prestamos', 'devoluciones', 'descuentos', 'vendedores', 'reportes', 'config'];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const file = join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
if (!PUBLIC_URL) await new Promise(resolveServer => server.listen(8898, '127.0.0.1', resolveServer));

let browser;
const failures = [];
let passed = 0;
const check = (ok, message, detail = '') => {
  if (ok) { passed++; return; }
  failures.push(message + (detail ? ` · ${detail}` : ''));
};

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  await page.addInitScript(() => { localStorage.setItem('balam-sidebar', '1'); });
  await page.goto(PUBLIC_URL || 'http://127.0.0.1:8898/index.html');
  await page.waitForFunction(() => window.App && window.DATA, null, { timeout: 60000 });
  await page.evaluate(() => {
    const config = window.CONFIG;
    const original = config.codes;
    config.codes = function (kind) { return kind === 'payment_method' ? ['Efectivo', 'Tarjeta', 'Transferencia'] : original.apply(this, arguments); };
    try { window.DATA.seedDemo(); } finally { config.codes = original; }
    if (window.DATA.products[0]) {
      window.DATA.products[0].nombre = 'Guayabera ceremonial de edición extraordinaria con nombre completo recuperable';
      window.DATA.products[0].sku = 'SKU-H87-EXTRAORDINARIAMENTE-LARGO-0000000001';
    }
    if (window.DATA.clients[0]) window.DATA.clients[0].nombre = 'María Fernanda del Carmen Apellido Extraordinariamente Largo';
  });

  for (const screen of SCREENS) {
    await page.evaluate(id => localStorage.setItem('balam-page', id), screen);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.App && window.DATA, null, { timeout: 60000 });
    for (const width of WIDTHS) {
      const height = width <= 430 ? 640 : width <= 768 ? 800 : 900;
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(50);
      const state = await page.evaluate(({ width, screen }) => {
        const visible = element => {
          const rect = element.getBoundingClientRect();
          const css = getComputedStyle(element);
          return rect.width > 0 && rect.height > 0 && css.display !== 'none' && css.visibility !== 'hidden';
        };
        const primary = [...document.querySelectorAll('main button')].filter(visible);
        const kpis = [...document.querySelectorAll('[data-responsive-kpi]')].filter(visible);
        const badKpi = kpis.filter(card => {
          const cr = card.getBoundingClientRect();
          return [...card.querySelectorAll('[data-kpi-value]')].some(value => {
            const vr = value.getBoundingClientRect();
            return vr.left < cr.left - 1 || vr.right > cr.right + 1;
          });
        });
        const small = width < 768 ? [...document.querySelectorAll('main button, header button, aside nav button')].filter(visible).filter(element => {
          const rect = element.getBoundingClientRect();
          return rect.height < 43.5 || (element.hasAttribute('aria-label') && rect.width < 43.5);
        }) : [];
        return {
          screen, width,
          overflow: document.documentElement.scrollWidth - width,
          primary: primary.length,
          badKpi: badKpi.length,
          small: small.length,
        };
      }, { width, screen });
      check(state.overflow <= 0, `${screen} ${width}px sin scroll documental`, `exceso ${state.overflow}px`);
      check(state.primary > 0, `${screen} ${width}px conserva acciones`);
      check(state.badKpi === 0, `${screen} ${width}px contiene sus KPI`, `${state.badKpi} fuera`);
      check(state.small === 0, `${screen} ${width}px conserva targets táctiles`, `${state.small} menores de 44px`);
    }
  }

  await page.evaluate(() => localStorage.setItem('balam-page', 'inventario'));
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('[data-responsive-kpi]').length === 4);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    for (const amount of ['$9', '$999', '$999,999', '$2,106,660', '$99,999,999']) {
      const result = await page.evaluate(amount => {
        const card = [...document.querySelectorAll('[data-responsive-kpi]')][3];
        const value = card.querySelector('[data-kpi-value]');
        value.textContent = amount;
        const cr = card.getBoundingClientRect();
        const vr = value.getBoundingClientRect();
        return { inside: vr.left >= cr.left - 1 && vr.right <= cr.right + 1, font: parseFloat(getComputedStyle(value).fontSize), unit: card.innerText.includes('MXN') };
      }, amount);
      check(result.inside && result.font >= 21 && result.unit, `KPI ${amount} en ${width}px`, JSON.stringify(result));
    }
  }

  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByTestId('inventory-new-product').click();
  const modal = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="product-form"]');
    const rect = panel.getBoundingClientRect();
    const footer = panel.querySelector('[data-testid$="-footer"]')?.getBoundingClientRect();
    return { within: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight, footer: !footer || (footer.top < innerHeight && footer.bottom > 0) };
  });
  check(modal.within && modal.footer, 'modal complejo dentro del viewport y footer accesible', JSON.stringify(modal));
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => !!document.activeElement.closest('[data-testid="product-form"]')), 'foco permanece dentro del modal');
  await page.keyboard.press('Escape');

  console.log(`Responsive H-87: ${passed} pasaron, ${failures.length} fallaron`);
  failures.forEach(failure => console.error('❌ ' + failure));
  if (failures.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (!PUBLIC_URL) await new Promise(resolveServer => server.close(resolveServer));
}
