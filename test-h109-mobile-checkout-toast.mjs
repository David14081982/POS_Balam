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
if (!baseUrl) await new Promise(done => server.listen(8909, '127.0.0.1', done));

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
  await page.goto(baseUrl || 'http://127.0.0.1:8909/index.html');
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
  await page.getByTestId('checkout-method-Apartado').click();

  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => window.UI.toast('Nube no disponible — modo local', 'var(--danger)'));
    await page.waitForSelector('[data-testid="toast"]');
    const state = await page.evaluate(() => {
      const cta = document.querySelector('[data-testid="checkout-confirmar"]');
      const toast = [...document.querySelectorAll('[data-testid="toast"]')].at(-1);
      const a = cta.getBoundingClientRect();
      const b = toast.getBoundingClientRect();
      const overlapWidth = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const overlapHeight = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const center = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2);
      return {
        overlapArea: overlapWidth * overlapHeight,
        centerCovered: !!center?.closest('[data-testid="toast"]'),
        toastInside: b.left >= -0.5 && b.right <= innerWidth + 0.5 && b.top >= -0.5 && b.bottom <= innerHeight + 0.5,
        ctaInside: a.left >= -0.5 && a.right <= innerWidth + 0.5 && a.top >= -0.5 && a.bottom <= innerHeight + 0.5,
        ctaRect: { left: a.left, top: a.top, right: a.right, bottom: a.bottom },
        toastRect: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
      };
    });
    console.log(`${width}px ${JSON.stringify(state)}`);
    check(state.overlapArea === 0 && !state.centerCovered, `${width}px toast no cubre Confirmar cobro`, JSON.stringify(state));
    check(state.toastInside && state.ctaInside, `${width}px toast y CTA permanecen en viewport`, JSON.stringify(state));
    await page.waitForTimeout(2700);
  }

  console.log(`H-109 toast móvil: ${passed} pasaron, ${failures.length} fallaron`);
  failures.forEach(failure => console.error(`❌ ${failure}`));
  if (failures.length) process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (!baseUrl) await new Promise(done => server.close(done));
}
