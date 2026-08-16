import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const root = resolve('.');
const artifact = process.env.BALAM_ARTIFACT_PATH;
const baseUrl = process.env.BALAM_BASE_URL;
const widths = [320, 360, 375, 390, 430];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const file = artifact && (pathname === '/' || pathname === '/index.html')
    ? resolve(artifact)
    : join(root, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': artifact && file === resolve(artifact) ? 'text/html' : (mime[extname(file)] || 'application/octet-stream') });
  createReadStream(file).pipe(res);
});
if (!baseUrl) await new Promise(done => server.listen(8908, '127.0.0.1', done));

let browser;
let passed = 0;
const failures = [];
const check = (condition, label, detail = '') => condition ? passed++ : failures.push(`${label}${detail ? ` · ${detail}` : ''}`);

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('balam-sidebar', '1'));
  await page.goto(baseUrl || 'http://127.0.0.1:8908/index.html');
  await page.waitForFunction(() => window.App && window.DATA && window.CONFIG);
  await page.evaluate(() => {
    const config = window.CONFIG;
    const original = config.codes;
    config.codes = function (kind) { return kind === 'payment_method' ? ['Efectivo'] : original.apply(this, arguments); };
    try { window.DATA.seedDemo(); } finally { config.codes = original; }
    localStorage.setItem('balam-page', 'pos');
  });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('button[title="Agregar"]'));
  await page.locator('button[title="Agregar"]').first().click();
  await page.locator('[role="dialog"] button').last().click();
  await page.getByTestId('pos-cart-open').click();
  await page.getByRole('button', { name: /Completar venta/i }).click();
  await page.waitForSelector('[data-testid="checkout-confirmar"]');

  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(80);
    const state = await page.evaluate(() => {
      const methods = [...document.querySelectorAll('[data-testid^="checkout-method-"]')];
      return {
        viewportOverflow: document.documentElement.scrollWidth - innerWidth,
        methods: methods.map(button => {
          const label = button.querySelector('span:last-child');
          const rect = button.getBoundingClientRect();
          return {
            name: button.dataset.testid.replace('checkout-method-', ''),
            complete: label.scrollWidth <= label.clientWidth + 0.5,
            clientWidth: label.clientWidth,
            scrollWidth: label.scrollWidth,
            inside: rect.left >= -0.5 && rect.right <= innerWidth + 0.5,
            target: rect.height >= 44,
          };
        }),
      };
    });
    check(state.methods.length >= 6, `${width}px conserva todos los métodos`, `métodos=${state.methods.length}`);
    check(state.viewportOverflow <= 0, `${width}px no crea overflow documental`, `exceso=${state.viewportOverflow}`);
    for (const method of state.methods) {
      check(method.complete, `${width}px muestra ${method.name} completo`, `${method.clientWidth}/${method.scrollWidth}px`);
      check(method.inside && method.target, `${width}px mantiene ${method.name} visible y táctil`);
    }
  }

  console.log(`H-108 métodos móviles: ${passed} pasaron, ${failures.length} fallaron`);
  failures.forEach(failure => console.error(`❌ ${failure}`));
  if (failures.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (!baseUrl) await new Promise(done => server.close(done));
}
