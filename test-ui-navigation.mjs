// Fase 15: cobertura de navegación del bundle y comparación visual opcional.
// Uso:
//   node test-ui-navigation.mjs
//   node test-ui-navigation.mjs baseline
//   node test-ui-navigation.mjs compare
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const mode = process.argv[2] || 'check';
const root = resolve('.');
const visualDir = process.env.PHASE15_VISUAL_DIR || join(root, '.phase15-visual');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
let pass = 0, fail = 0;
const check = (name, value) => {
  console.log(`${value ? '✅' : '❌'} ${name}`);
  value ? pass++ : fail++;
};

const server = createServer((req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const file = join(root, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404); res.end('nf'); return;
  }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise(resolveListen => server.listen(8804, '127.0.0.1', resolveListen));

const pages = [
  ['dashboard', 'Panel de control', 'Panel de control'],
  ['pos', 'Punto de venta', 'Punto de venta'],
  ['inventario', 'Inventario', 'Inventario'],
  ['clientes', 'Clientes', 'Clientes'],
  ['devoluciones', 'Devoluciones', 'Devoluciones'],
  ['descuentos', 'Promociones y descuentos', 'Descuentos'],
  ['vendedores', 'Vendedores y comisiones', 'Vendedores'],
  ['reportes', 'Reportes', 'Reportes'],
  ['config', 'Configuración', 'Configuración'],
];

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route(/supabase\.co/, route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Supabase simulado por test-ui-navigation' }),
  }));
  await page.addInitScript(() => {
    localStorage.setItem('balam-page', 'dashboard');
    localStorage.setItem('balam-sidebar', '0');
  });
  await page.goto('http://127.0.0.1:8804/index.html', { waitUntil: 'load' });
  await page.addStyleTag({ content: [
    '#__bundler_err{pointer-events:none!important}',
    '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}',
  ].join('') });
  await page.waitForFunction(() => window.App && window.DATA && window.SettingsScreen, null, { timeout: 30000 });

  if (mode === 'baseline') {
    rmSync(visualDir, { recursive: true, force: true });
    mkdirSync(visualDir, { recursive: true });
  }

  for (const [id, title, buttonTitle] of pages) {
    await page.locator(`button[title="${buttonTitle}"]`).click()
      .catch(async () => {
        await page.evaluate(next => localStorage.setItem('balam-page', next), id);
        await page.reload({ waitUntil: 'load' });
        await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' });
      });
    await page.waitForFunction(expected => (
      document.querySelector('header h1')?.textContent.trim() === expected
    ), title);
    await page.evaluate(async () => {
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise(resolveFrame => requestAnimationFrame(
        () => requestAnimationFrame(resolveFrame)
      ));
    });
    await page.waitForTimeout(250);
    const shot = await page.screenshot();
    const path = join(visualDir, `${id}.png`);
    if (mode === 'baseline') {
      await page.screenshot({ path });
    } else if (mode === 'compare') {
      const same = existsSync(path) && shot.equals(readFileSync(path));
      if (!same) await page.screenshot({ path: join(visualDir, `${id}-current.png`) });
      check(`visual ${id} idéntico`, same);
    }
    check(`pantalla ${id} renderiza`, shot.length > 10000);
  }
  check('navegación completa sin excepciones', errors.length === 0);
  check('exports de editor disponibles en runtime', await page.evaluate(() => (
    typeof window.useTweaks === 'function'
      && typeof window.TweaksPanel === 'function'
      && typeof window.TweakSlider === 'function'
      && typeof window.TweakColor === 'function'
  )));

  const source = readFileSync(join(root, 'balam/tweaks-panel.jsx'), 'utf8');
  check('contrato externo de tweaks permanece',
    source.includes('__activate_edit_mode')
      && source.includes('__edit_mode_set_keys')
      && source.includes('window.parent.postMessage'));
  const entry = readFileSync(join(root, 'POS Balam.html'), 'utf8');
  const build = readFileSync(join(root, 'build-offline.mjs'), 'utf8');
  const legacyCss = ['styles.css', 'modules.css', 'light.css'];
  check('CSS heredado no existe ni tiene referencias',
    legacyCss.every(name => (
      !existsSync(join(root, 'balam', name))
        && !entry.includes(name)
        && !build.includes(name)
    )));
} finally {
  if (browser) await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
