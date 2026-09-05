// Eventos de ciclo de vida controlados, Web Locks reales y bundle distribuido.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import fs from 'node:fs';
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'OK' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };
const remote = process.argv.find(a => /^https?:/.test(a));
const server = remote ? null : createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(fs.readFileSync('index.html')); });
if (server) await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = remote || `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 768, height: 1024 }, userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', hasTouch: true });
  await context.route(/supabase\.co/, r => r.abort());
  // Sólo el gate de AUTH de la prueba pública: nunca se autentica ni escribe en nube.
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      if (!window.AUTH) return;
      AUTH.isReady = () => true; AUTH.hasSession = () => true;
      AUTH.current = () => ({ id: 'h147-local-test', role: 'admin' });
      window.dispatchEvent(new Event('authchange'));
    });
  });
  async function open() {
    const p = await context.newPage(); p.on('pageerror', e => errors.push(String(e)));
    await p.goto(url); await p.waitForFunction(() => window.DATA && window.App);
    return p;
  }
  const page = await open(); await page.waitForFunction(() => DATA.isLocalWriter);
  await page.evaluate(() => {
    window.__transitions = [];
    window.addEventListener('localwriterchange', () => __transitions.push(DATA.localWriterState));
    window.__navigation = document.getElementById('balam-navigation');
    window.__business = JSON.stringify([DATA.products, DATA.sales, DATA.payments, DATA.movements]);
  });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  await page.waitForTimeout(350);
  check('salida cancelada conserva escritor y no entra en espera', await page.evaluate(() => DATA.isLocalWriter && !__transitions.includes('waiting')));
  check('la pantalla y sus borradores no se desmontan', await page.evaluate(() => !!__navigation && __navigation === document.getElementById('balam-navigation') && !document.querySelector('[data-testid="local-writer-gate"]')));
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(350);
  check('regreso de aplicación externa permite operar', await page.evaluate(() => DATA.isLocalWriter));
  check('imprimir y volver no cambia datos comerciales', await page.evaluate(() => __business === JSON.stringify([DATA.products, DATA.sales, DATA.payments, DATA.movements])));
  await page.reload(); await page.waitForFunction(() => DATA.isLocalWriter);
  // pageshow puede adelantarse al finally de la solicitud que se libera.
  await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
  await page.waitForTimeout(350);
  check('restauración inmediata no pierde la solicitud de relevo', await page.evaluate(() => DATA.isLocalWriter));
  await page.reload(); await page.waitForFunction(() => DATA.isLocalWriter);
  const reader = await open(); await reader.waitForFunction(() => DATA.localWriterState === 'waiting');
  await reader.waitForTimeout(400);
  check('segunda pestaña sigue sin permiso', await reader.evaluate(() => !DATA.isLocalWriter && DATA.localWriterContended));
  check('gate usa SVG local sin ligaduras visibles', await reader.getByTestId('local-writer-gate').locator('svg').count() === 1);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await reader.waitForFunction(() => DATA.isLocalWriter);
  check('salida real entrega el lock a la otra pestaña', await page.evaluate(() => !DATA.isLocalWriter));
  await reader.evaluate(() => {
    const rows = JSON.parse(localStorage.getItem('balam_pos_sales_v1') || '[]');
    rows.push({ folio: 'H147-DURABLE', fecha: '2026-09-05', total: 0, estado: 'Pagado', lineas: [] });
    localStorage.setItem('balam_pos_sales_v1', JSON.stringify(rows));
  });
  await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); for (let i=0;i<5;i++) dispatchEvent(new Event('focus')); });
  await page.waitForTimeout(400);
  const locks = await page.evaluate(() => navigator.locks.query());
  const relevant = list => list.filter(x => x.name === 'balam-pos-local-writer-v1');
  check('regresar no roba el lock ni duplica solicitudes', relevant(locks.held).length === 1 && relevant(locks.pending).length === 1 && !await page.evaluate(() => DATA.isLocalWriter), locks);
  await reader.close(); await page.waitForFunction(() => DATA.isLocalWriter);
  check('relevo relee el documento durable antes de operar', await page.evaluate(() => DATA.sales.some(s => s.folio === 'H147-DURABLE')));
  for (let i=0;i<3;i++) {
    await page.evaluate(() => { dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    await page.waitForTimeout(150);
  }
  check('varios ciclos de salida/regreso conservan un escritor', await page.evaluate(async () => DATA.isLocalWriter && (await navigator.locks.query()).held.filter(x => x.name === 'balam-pos-local-writer-v1').length === 1));
  const suspended = await open(); await suspended.waitForFunction(() => DATA.localWriterState === 'waiting');
  await suspended.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.waitForTimeout(250);
  check('página que salió mientras esperaba no toma el relevo', await suspended.evaluate(async () => !DATA.isLocalWriter && !(await navigator.locks.query()).held.some(x => x.name === 'balam-pos-local-writer-v1')));
  await page.evaluate(() => { dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(250);
  check('foco y visibilidad recuperan espera sin pageshow', await page.evaluate(() => DATA.isLocalWriter));
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await page.waitForTimeout(150);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(250);
  check('visibilidad sola recupera sin foco ni pageshow', await page.evaluate(() => DATA.isLocalWriter));
  await suspended.close();
  // Fallo real de rebase: foco/pageshow nunca deben saltarse el bloqueo.
  await page.evaluate(() => { localStorage.setItem('balam_pos_sales_v1', '{'); dispatchEvent(new PageTransitionEvent('pagehide')); });
  await page.waitForTimeout(150);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow')));
  await page.waitForFunction(() => DATA.localWriterState === 'blocked');
  await page.evaluate(() => { dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); dispatchEvent(new PageTransitionEvent('pageshow')); });
  await page.waitForTimeout(150);
  check('cache inválida permanece bloqueada y no se borra', await page.evaluate(() => !DATA.isLocalWriter && DATA.localWriterState === 'blocked' && localStorage.getItem('balam_pos_sales_v1') === '{'));
  await page.screenshot({ path: 'h147-gate-qa.png' });
  check('sin excepciones de navegador', errors.length === 0, errors);
  await context.close();
} finally { await browser.close(); if (server) await new Promise(r => server.close(r)); }
console.log(`${results.filter(Boolean).length}/${results.length}`);
process.exitCode = results.every(Boolean) ? 0 : 1;
