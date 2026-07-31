import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const source = readFileSync('balam/pos.jsx', 'utf8');
let pass = 0;
let fail = 0;

function check(name, condition) {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
}

check('el filtro de tallas expone un contrato estable',
  /testid:\s*'pos-size-filter'/.test(source));
check('el control activo conserva el fondo gold',
  /active\s*\?\s*'bg-gold text-on-gold border-gold shadow-e1'/.test(source));
check('FilterSelect restablece el fondo normal de cada option',
  /bg-surface text-on-surface/.test(source)
    && /React\.cloneElement\(child/.test(source));
check('el menú no fuerza estilos de hover o selección',
  !/option:(hover|checked)|option\s*\{[^}]*:(hover|checked)/s.test(source));
check('se conserva el select nativo',
  /h\('select'/.test(source) && !/role:\s*['"]listbox['"]/.test(source));

const root = resolve('.');
const server = createServer((req, res) => {
  const requested = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const file = join(root, decodeURIComponent(requested));
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404);
    res.end('nf');
    return;
  }
  const mime = extname(file) === '.html' ? 'text/html' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  createReadStream(file).pipe(res);
});
await new Promise(resolveListen => server.listen(8826, '127.0.0.1', resolveListen));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route(/supabase\.co/, route => route.abort());
  await page.addInitScript(() => localStorage.setItem('balam-page', 'pos'));
  await page.goto('http://127.0.0.1:8826/index.html', { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="pos-size-filter"]', {
    state: 'attached',
    timeout: 25000,
  });
  const colors = await page.locator('[data-testid="pos-size-filter"]').evaluate(select => {
    // Fuerza únicamente el estado visual activo para aislar la cascada; no
    // depende de que los catálogos locales de prueba contengan alguna talla.
    select.style.backgroundColor = '#D4AF38';
    return {
      option: getComputedStyle(select.options[0]).backgroundColor,
    };
  });
  check('Chrome calcula blanco para las opciones del menú',
    colors.option === 'rgb(255, 255, 255)', colors.option);
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
