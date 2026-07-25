// H-02 — folios visibles únicos entre terminales, incluso sin conexión.
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('.');
const server = http.createServer((req, res) => {
  const fp = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.slice(1)));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) {
    res.writeHead(404);
    res.end('nf');
    return;
  }
  res.writeHead(200, {
    'Content-Type': path.extname(fp) === '.html' ? 'text/html' : 'application/octet-stream',
  });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(resolve => server.listen(8816, '127.0.0.1', resolve));

let pass = 0;
let fail = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function terminal() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto('http://127.0.0.1:8816/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.DATA.nextFolio);
  return { context, page };
}

try {
  const a = await terminal();
  const b = await terminal();
  const [folioA, folioB] = await Promise.all([
    a.page.evaluate(() => window.DATA.nextFolio()),
    b.page.evaluate(() => window.DATA.nextFolio()),
  ]);
  check(
    'dos terminales con el mismo contador generan folios distintos',
    folioA !== folioB,
    `${folioA} / ${folioB}`,
  );

  const folioA2 = await a.page.evaluate(() => window.DATA.nextFolio());
  check(
    'una terminal conserva una secuencia legible y no repite su folio',
    folioA2 !== folioA,
    `${folioA} / ${folioA2}`,
  );

  const oldDevice = await a.page.evaluate(() => localStorage.getItem('balam_device_id'));
  await a.context.clearCookies();
  await a.page.evaluate(() => localStorage.clear());
  await a.page.reload({ waitUntil: 'load' });
  await a.page.waitForFunction(() => window.DATA && window.DATA.nextFolio);
  const afterReset = await a.page.evaluate(() => window.DATA.nextFolio());
  const newDevice = await a.page.evaluate(() => localStorage.getItem('balam_device_id'));
  check(
    'borrar el navegador crea otra identidad de terminal',
    !!oldDevice && !!newDevice && oldDevice !== newDevice,
    `${oldDevice} / ${newDevice}`,
  );
  check(
    'una reinstalación no reutiliza el folio anterior',
    afterReset !== folioA,
    `${folioA} / ${afterReset}`,
  );

  await a.context.close();
  await b.context.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
