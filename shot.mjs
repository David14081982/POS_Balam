import { chromium } from 'playwright-core';

const URL = 'http://127.0.0.1:8777/POS%20Balam.html';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
// Esperar a que Babel/React rendericen el shell
await page.waitForTimeout(3500);

async function shot(navLabel, file) {
  if (navLabel) {
    try { await page.getByRole('button', { name: navLabel }).first().click({ timeout: 4000 }); }
    catch (e) { console.log('no pude click', navLabel, e.message); }
    await page.waitForTimeout(1500);
  }
  await page.screenshot({ path: file, fullPage: false });
  console.log('shot', file);
}

await shot(null, 'shot-dashboard.png');
await shot('Punto de venta', 'shot-pos.png');
await shot('Inventario', 'shot-inventario.png');
await shot('Clientes', 'shot-clientes.png');

console.log('\n--- CONSOLE ERRORS (' + errs.length + ') ---');
errs.slice(0, 25).forEach(e => console.log(e.slice(0, 200)));
await browser.close();
