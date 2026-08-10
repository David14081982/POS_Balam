import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright-core';

const root = process.cwd();
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const port = 41989;
const origin = `http://127.0.0.1:${port}`;
const base = `${origin}/POS_Balam/`;
const passed = [];
const pass = name => { passed.push(name); console.log(`PASS ${String(passed.length).padStart(2, '0')} · ${name}`); };

const appSource = await readFile(join(root, 'balam', 'app.jsx'), 'utf8');
const pwaSource = await readFile(join(root, 'balam', 'pwa.jsx'), 'utf8');
assert.match(appSource, /window\.PWA\.InstallAction[^\n]+surface:\s*'login'/);
assert.doesNotMatch(appSource.slice(appSource.indexOf('function LoginScreen'), appSource.indexOf('function JaguarMark')), /beforeinstallprompt|requestInstall\(/);
assert.match(pwaSource, /getState: \(\) => state, useSnapshot, InstallAction, Control/);
pass('login y topbar consumen una sola autoridad PWA');

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const allowed = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/icon-maskable-512.png', 'pwa/apple-touch-icon.png', 'pwa/favicon-64.png']);
const server = createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  if (!url.pathname.startsWith('/POS_Balam/')) { response.writeHead(404); response.end(); return; }
  const relative = url.pathname.slice('/POS_Balam/'.length) || 'index.html';
  if (!allowed.has(relative)) { response.writeHead(404); response.end(); return; }
  const body = await readFile(join(root, relative));
  const headers = { 'Content-Type': mime[extname(relative)] || 'application/octet-stream', 'Cache-Control': 'no-store' };
  if (relative === 'sw.js') headers['Service-Worker-Allowed'] = '/POS_Balam/';
  response.writeHead(200, headers);
  response.end(body);
});
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));

function fakePrompt({ outcome, install = false }) {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  Object.defineProperty(event, 'prompt', { value: () => {
    window.__h89PromptCalls = (window.__h89PromptCalls || 0) + 1;
    window.__h89PromptActivation = navigator.userActivation ? navigator.userActivation.isActive : true;
    if (install) setTimeout(() => window.dispatchEvent(new Event('appinstalled')), 0);
    return Promise.resolve();
  } });
  Object.defineProperty(event, 'userChoice', { value: Promise.resolve({ outcome, platform: 'web' }) });
  window.dispatchEvent(event);
}

async function mountLoginAction(page) {
  await page.evaluate(() => {
    const previous = document.querySelector('#h89-login-surface');
    if (previous) previous.remove();
    const target = document.createElement('div');
    target.id = 'h89-login-surface';
    target.style.cssText = 'width:min(100%,384px);margin:16px auto;padding:24px;background:#0E1424';
    document.body.appendChild(target);
    ReactDOM.createRoot(target).render(React.createElement(PWA.InstallAction, { surface: 'login' }));
  });
}

let context;
let iosBrowser;
try {
  context = await chromium.launchPersistentContext('', { executablePath: chromePath, headless: true, viewport: { width: 430, height: 780 } });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PWA?.getState().ready);
  await mountLoginAction(page);

  await page.waitForFunction(() => window.PWA?.getState().canInstall, null, { timeout: 15000 });
  await page.evaluate(fakePrompt, { outcome: 'dismissed' });
  await page.getByTestId('pwa-login-install-action').waitFor();
  assert.match(await page.getByTestId('pwa-login-install-action').innerText(), /INSTALAR BALAM/i);
  pass('sin sesión y canInstall=true muestra Instalar BALAM');

  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 640 });
    const geometry = await page.getByTestId('pwa-login-install-action').evaluate(button => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    assert.ok(geometry.width > 0 && geometry.height >= 44 && geometry.overflow <= 0, `${width}: ${JSON.stringify(geometry)}`);
  }
  pass('acción de login es operable en 320/360/390/430');

  await page.getByTestId('pwa-login-install-action').click();
  await page.waitForFunction(() => PWA.getState().lastInstallOutcome === 'dismissed');
  assert.equal(await page.evaluate(() => window.__h89PromptCalls), 1);
  assert.equal(await page.evaluate(() => window.__h89PromptActivation), true);
  pass('clic invoca prompt una vez dentro del gesto directo');
  assert.equal(await page.getByTestId('pwa-login-install-action').count(), 0);
  assert.equal(await page.evaluate(() => PWA.getState().canInstall), false);
  pass('canInstall=false oculta la acción de login');
  assert.ok(await page.evaluate(() => !!window.App && PWA.getState().lastInstallOutcome === 'dismissed'));
  pass('cancelar conserva la app y registra dismissed');

  await page.evaluate(fakePrompt, { outcome: 'accepted', install: true });
  await page.getByTestId('pwa-login-install-action').click();
  await page.waitForFunction(() => PWA.getState().standalone && PWA.getState().lastInstallOutcome === 'accepted');
  assert.equal(await page.getByTestId('pwa-login-install-action').count(), 0);
  pass('aceptar registra resultado y oculta la acción instalada');
  assert.equal(await page.getByTestId('pwa-install-action').count(), 0);
  pass('standalone oculta acciones de instalación');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PWA?.getState().ready);
  await page.evaluate(fakePrompt, { outcome: 'dismissed' });
  await page.getByTestId('pwa-install-action').waitFor();
  pass('topbar conserva la acción compartida cuando corresponde');

  iosBrowser = await chromium.launch({ executablePath: chromePath, headless: true });
  const iosContext = await iosBrowser.newContext({
    viewport: { width: 390, height: 780 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await iosContext.addInitScript(() => {
    const original = window.addEventListener.bind(window);
    window.addEventListener = (type, listener, options) => {
      if (type === 'beforeinstallprompt') return;
      return original(type, listener, options);
    };
  });
  const iosPage = await iosContext.newPage();
  await iosPage.goto(base, { waitUntil: 'domcontentloaded' });
  await iosPage.waitForFunction(() => window.PWA?.getState().ready && window.PWA.getState().installKind === 'ios');
  await mountLoginAction(iosPage);
  await iosPage.getByTestId('pwa-login-install-action').waitFor();
  assert.equal(await iosPage.getByTestId('pwa-login-ios-hint').innerText(), 'Compartir → Añadir a pantalla de inicio');
  await iosPage.getByTestId('pwa-login-install-action').click();
  const instructions = await iosPage.getByTestId('pwa-install-instructions').innerText();
  assert.match(instructions, /Compartir.+Añadir a pantalla de inicio/s);
  pass('iOS muestra instrucciones y no simula beforeinstallprompt');
  await iosContext.close();
} finally {
  const timeout = ms => new Promise(resolve => setTimeout(resolve, ms));
  if (iosBrowser) await Promise.race([iosBrowser.close().catch(() => {}), timeout(5000)]);
  if (context) await Promise.race([context.close().catch(() => {}), timeout(5000)]);
  if (server.closeAllConnections) server.closeAllConnections();
  await Promise.race([new Promise(resolve => server.close(resolve)), timeout(5000)]);
}

console.log(`RESULTADO H-89 LOGIN: ${passed.length}/${passed.length}`);
process.exit(0);
