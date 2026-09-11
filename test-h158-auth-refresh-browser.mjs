// Real distributed shell/AUTH; isolated browser identity and held permission RPC.
// All network requests intercepted. This is not Supabase A/B/C certification.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const artifact = process.argv[2] || 'index.html';
const html = readFileSync(artifact);
const out = process.env.BALAM_TEST_OUTPUT || join(tmpdir(), 'balam-h158-browser');
mkdirSync(out, { recursive: true });
const results = [];
async function check(name, test) {
  try { await test(); results.push({ name, ok: true }); }
  catch (error) { results.push({ name, ok: false, error: error.message }); }
  console.log(`${results.at(-1).ok ? 'PASS' : 'FAIL'} ${name}`);
}
const browser = await chromium.launch({ headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE
  ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.fulfill(
      route.request().url() === 'https://balam.test/index.html'
        ? { status: 200, contentType: 'text/html', body: html }
        : { status: 401, contentType: 'application/json', body: '{}' }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('balam-page', 'pos'));
    await page.goto('https://balam.test/index.html');
    await page.waitForFunction(() => window.AUTH?.isReady() && window.STORE);
    await page.evaluate(async () => {
      const c = await window.STORE.getClient();
      // Isolate auth rendering from device recovery/network initialization.
      // The real STORE caller is covered separately by its existing regressions.
      window.STORE.setSession = async () => {};
      const status = window.STORE.syncStatus;
      window.STORE.syncStatus = () => ({ ...status(), recoveryPhase: 'ready' });
      window.dispatchEvent(new CustomEvent('syncstatuschange'));
      const user = { id: '15600000-0000-4000-8000-000000000001', email: 'h158@example.test' };
      window.__refreshProbe = { entered: 0, denied: false };
      c.auth.getSession = async () => ({ data: { session: { user, access_token: 'synthetic' } } });
      c.rpc = async name => {
        if (name !== 'current_permission_snapshot') return { data: null, error: { message: 'Isolated test' } };
        const probe = window.__refreshProbe;
        probe.entered++;
        if (probe.hold) await new Promise(resolve => { probe.release = resolve; });
        return { error: null, data: {
          model_version: 'h56-screen-permissions-v1', permission_version: probe.denied ? 'denied' : 'allowed',
          verified_at: new Date().toISOString(), profile_status: 'active', base_role: 'admin',
          profile: { ...user, nombre: 'H158 Test', iniciales: 'QA', role: 'admin', active: true },
          permissions: window.SCREENS.all().map(screen => ({
            screen_key: screen.id, allowed: !probe.denied, source: 'role', role_code: 'admin', effect: null,
          })),
        } };
      };
      await window.AUTH.init();
    });
    const input = page.getByTestId('pos-barcode-input');
    await input.waitFor({ timeout: 5000 }).catch(async error => {
      console.log(await page.evaluate(() => ({ text: document.body.innerText.slice(-1800),
        page: localStorage.getItem('balam-page'), ready: window.AUTH.isReady(),
        hasSession: window.AUTH.hasSession(), access: window.AUTH.allowedScreens(),
        recovery: window.STORE.syncStatus().recoveryPhase })));
      throw error;
    });
    await page.addStyleTag({ content: '#__bundler_err{pointer-events:none!important}' });
    await input.fill('borrador H158');
    const navigationCount = await page.evaluate(() => performance.timeOrigin);
    await page.evaluate(() => {
      window.__refreshProbe.input = document.querySelector('[data-testid="pos-barcode-input"]');
      window.__refreshProbe.hold = true;
      window.__refreshProbe.refresh = window.AUTH.refreshPermissions();
    });
    await page.waitForFunction(() => typeof window.__refreshProbe.release === 'function');
    // Allow the actual authchange handler and React commit to run while RPC is held.
    await page.waitForTimeout(100);
    await page.screenshot({ path: join(out, `refresh-${width}.png`) });
    await check(`${width}: mantiene pantalla, nodo, foco y borrador durante la consulta`, async () => {
      assert.deepEqual(await page.evaluate(() => ({
        ready: window.AUTH.isReady(), mounted: window.__refreshProbe.input.isConnected,
        focused: document.activeElement === window.__refreshProbe.input,
        value: document.querySelector('[data-testid="pos-barcode-input"]')?.value,
        loading: document.body.innerText.includes('Cargando…'),
      })), { ready: true, mounted: true, focused: true, value: 'borrador H158', loading: false });
    });
    await page.evaluate(async () => {
      window.__refreshProbe.hold = false;
      window.__refreshProbe.release();
      window.__refreshProbe.persisted = await window.__refreshProbe.refresh;
    });
    await input.waitFor();
    await check(`${width}: conserva borrador y confirma caché tras la respuesta`, async () => {
      assert.equal(await input.inputValue(), 'borrador H158');
      assert.equal(await page.evaluate(() => window.__refreshProbe.persisted), true);
    });
    await check(`${width}: revocación real del snapshot retira acceso y pantalla`, async () => {
      await page.evaluate(async () => { window.__refreshProbe.denied = true; await window.AUTH.refreshPermissions(); });
      await page.waitForFunction(() => !document.querySelector('[data-testid="pos-barcode-input"]'));
      assert.equal(await page.evaluate(() => window.AUTH.canAccess('pos')), false);
    });
    await check(`${width}: sin navegación completa ni excepciones`, async () => {
      assert.equal(await page.evaluate(() => performance.timeOrigin), navigationCount);
      assert.deepEqual(errors, []);
    });
    await context.close();
  }
} finally { await browser.close(); }
const evidence = { artifact, sha256: createHash('sha256').update(html).digest('hex'),
  scope: 'Chrome, real bundle and AUTH, controlled permission RPC; NOT Supabase certification', results };
writeFileSync(join(out, 'results.json'), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
process.exitCode = results.some(result => !result.ok) ? 1 : 0;
