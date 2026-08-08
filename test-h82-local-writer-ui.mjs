import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('.');
const sourceData = fs.readFileSync(path.join(ROOT, 'balam/data.jsx'), 'utf8');
const sourceApp = fs.readFileSync(path.join(ROOT, 'balam/app.jsx'), 'utf8');
let pass = 0;
let fail = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
};

check('la contención visual se confirma consultando Web Locks',
  sourceData.includes('navigator.locks.query()'));
check('DATA expone contención sin convertirla en permiso de escritura',
  sourceData.includes('get localWriterContended()'));
check('el arranque distingue preparación de otra pestaña',
  sourceApp.includes('Preparando almacenamiento local'));
check('el rebase tiene mensaje propio',
  sourceApp.includes('Actualizando datos locales'));
check('el gate conserva un contrato estable de prueba',
  sourceApp.includes("'data-testid': 'local-writer-gate'"));

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.slice(1)));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': path.extname(file) === '.html' ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(8847, '127.0.0.1', resolve));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const startupContext = await browser.newContext();
  await startupContext.addInitScript(() => {
    const request = navigator.locks.request.bind(navigator.locks);
    navigator.locks.request = (...args) => new Promise((resolve, reject) => {
      setTimeout(() => request(...args).then(resolve, reject), 450);
    });
  });
  const startup = await startupContext.newPage();
  await startup.route(/supabase\.co/, route => route.abort());
  await startup.goto('http://127.0.0.1:8847/', { waitUntil: 'load' });
  const startupGate = startup.getByTestId('local-writer-gate');
  await startupGate.waitFor({ state: 'visible' });
  check('una sola pestaña esperando muestra preparación, no otro propietario',
    (await startupGate.getAttribute('data-writer-state')) === 'waiting'
      && (await startupGate.getAttribute('data-writer-contended')) === 'false'
      && (await startupGate.textContent()).includes('Preparando almacenamiento local'));
  await startup.waitForFunction(() => window.DATA.localWriterState === 'writer');
  check('la preparación desaparece sola al concederse el lock',
    await startupGate.count() === 0);
  await startupContext.close();

  const context = await browser.newContext();
  const writer = await context.newPage();
  await writer.route(/supabase\.co/, route => route.abort());
  await writer.goto('http://127.0.0.1:8847/', { waitUntil: 'load' });
  await writer.waitForFunction(() => window.DATA && window.DATA.localWriterState === 'writer');

  const reader = await context.newPage();
  await reader.route(/supabase\.co/, route => route.abort());
  await reader.goto('http://127.0.0.1:8847/', { waitUntil: 'load' });
  await reader.waitForFunction(() => window.DATA && window.DATA.localWriterState === 'waiting');
  await reader.waitForTimeout(450);

  const contention = await reader.evaluate(async () => ({
    state: window.DATA.localWriterState,
    contended: window.DATA.localWriterContended,
    writer: window.DATA.isLocalWriter,
    locks: await navigator.locks.query(),
  }));
  check('dos pestañas conservan un solo escritor',
    contention.state === 'waiting' && contention.writer === false
      && contention.locks.held.length === 1 && contention.locks.pending.length === 1);
  check('la segunda pestaña confirma propietario real', contention.contended === true);
  const readerGate = reader.getByTestId('local-writer-gate');
  check('sólo la contención confirmada muestra otra pestaña',
    (await readerGate.getAttribute('data-writer-contended')) === 'true'
      && (await readerGate.textContent()).includes('Otra pestaña está operando'));

  const before = Date.now();
  await writer.close();
  await reader.waitForFunction(() => window.DATA.localWriterState === 'writer');
  const takeoverMs = Date.now() - before;
  check('cerrar la escritora entrega el lock automáticamente', takeoverMs < 2000,
    `${takeoverMs} ms`);
  check('el relevo limpia la contención visual',
    await reader.evaluate(() => window.DATA.localWriterContended === false));
  check('el gate desaparece al tomar el relevo', await readerGate.count() === 0);
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
