import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const root = resolve('.');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const file = join(root, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise(done => server.listen(8844, '127.0.0.1', done));

let pass = 0, fail = 0;
const check = (name, condition) => {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.addInitScript(() => localStorage.setItem('balam-page', 'config'));
  await page.goto('http://127.0.0.1:8844/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.SettingsScreen && window.CONFIG, null, { timeout: 30000 });
  await page.getByTestId('settings-section-beneficios').click();
  await page.getByTestId('benefit-card-MANUAL_PERCENT').waitFor();

  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="benefit-card-MANUAL_PERCENT"]')?.parentElement;
      return {
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        cardOverflow: root ? root.scrollWidth > root.clientWidth + 1 : true,
      };
    });
    check(`las tarjetas respetan su margen a ${width}px`, !layout.cardOverflow);
  }

  await page.getByTestId('benefit-card-MANUAL_PERCENT').locator('button[aria-expanded]').click();
  const clearLanguage = await page.getByTestId('benefit-card-MANUAL_PERCENT').evaluate(card => ({
    expanded: card.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded'),
    calculate: card.textContent.includes('¿Cómo se calcula?'),
    custom: card.textContent.includes('El vendedor escribe el valor'),
  }));
  check('la edición desplegable muestra lenguaje claro',
    clearLanguage.expanded === 'true' && clearLanguage.calculate && clearLanguage.custom);
  const beforeDuplicate = await page.evaluate(() => window.CONFIG.all('additional_benefit').length);
  await page.getByTestId('benefit-duplicate-MANUAL_PERCENT').click();
  await page.getByTestId('benefit-card-MANUAL_PERCENT_COPIA').waitFor();
  const duplicate = await page.evaluate(() => {
    const items = window.CONFIG.all('additional_benefit');
    const original = items.find(x => x.code === 'MANUAL_PERCENT');
    const copy = items.find(x => x.code === 'MANUAL_PERCENT_COPIA');
    const originalIndex = items.findIndex(x => x.code === original.code);
    const copyIndex = items.findIndex(x => x.code === copy.code);
    window.CONFIG.updateItem('additional_benefit', copy.code, { meta: { maxPercent: 37 } });
    return {
      count: items.length,
      label: copy.label,
      adjacent: copyIndex === originalIndex + 1,
      originalLimit: original.meta.maxPercent,
      copyLimit: window.CONFIG.find('additional_benefit', copy.code).meta.maxPercent,
    };
  });
  check('Duplicar crea una copia junto al original', duplicate.count === beforeDuplicate + 1 && duplicate.label.startsWith('Copia de ') && duplicate.adjacent);
  check('editar la copia no modifica el original', duplicate.originalLimit === 100 && duplicate.copyLimit === 37);
  check('sin errores de página', errors.length === 0);
} finally {
  await browser.close();
  await new Promise(done => server.close(done));
}

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
