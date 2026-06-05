import { chromium } from 'playwright-core';
import path from 'path';
import url from 'url';

const file = url.pathToFileURL(path.resolve('POS Balam (offline).html')).href;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push('PAGEERR: ' + e.message));

console.log('loading', file);
await page.goto(file, { waitUntil: 'load' });
await page.waitForTimeout(5000); // unpack + babel + render

await page.screenshot({ path: 'shot-bundle-dashboard.png' });
console.log('shot dashboard');
try { await page.getByRole('button', { name: 'Punto de venta' }).first().click({ timeout: 4000 }); await page.waitForTimeout(2500); } catch (e) { console.log('nav fail', e.message); }
await page.screenshot({ path: 'shot-bundle-pos.png' });
console.log('shot pos');
try { await page.getByRole('button', { name: 'Inventario' }).first().click({ timeout: 4000 }); await page.waitForTimeout(2000); } catch (e) { console.log('nav fail', e.message); }
await page.screenshot({ path: 'shot-bundle-inventario.png' });
console.log('shot inventario');

console.log('\n--- ERRORS (' + errs.length + ') ---');
errs.slice(0, 20).forEach(e => console.log(e.slice(0, 180)));
await browser.close();
