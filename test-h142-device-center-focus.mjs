// H142/S14: real SettingsScreen, focus hook, CORE and STORE guard in Chromium.
// All network is intercepted. Recovery stops at the first manifest read, so
// inventory/history are never replaced. Optional HEAD source gives the red case.
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const ref = process.env.BALAM_QA_SOURCE_REF;
const source = name => ref ? execFileSync('git', ['show', `${ref}:${name}`], { encoding: 'utf8' }) : read(name);
const shared = source('balam/shared.jsx');
const start = shared.indexOf('  function useSyncFocusActivity(');
const hook = shared.slice(start, shared.indexOf('\n  //', start));
const messages = shared.slice(shared.indexOf('  const MESSAGE_LEVEL ='), shared.indexOf('  function messageText('));
const settings = source('balam/settings.jsx');
// With BALAM_VERIFIED_HTML, test the supplied bundle's own component/hook;
// source injection is disabled so an artifact mismatch cannot be hidden.
const artifactOnly = !!process.env.BALAM_VERIFIED_HTML;
const html = artifactOnly ? readFileSync(process.env.BALAM_VERIFIED_HTML, 'utf8') : read('index.html');
const out = process.env.BALAM_QA_BROWSER_OUTPUT || join(tmpdir(), 'balam-h142-device-focus');
mkdirSync(out, { recursive: true });
let passed = 0, failed = 0;
const check = (name, ok, detail = {}) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); ok ? passed++ : failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function calls(page) { return page.evaluate(() => qa.calls); }
try {
  for (const width of [320, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
    await context.route('**/*', route => route.fulfill(route.request().url() === 'http://127.0.0.1:8932/'
      ? { status: 200, contentType: 'text/html', body: html }
      : { status: 401, contentType: 'application/json', body: '{}' }));
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8932/');
    await page.waitForFunction(() => window.DATA && window.STORE?.enabled);
    await page.evaluate(async ({ hook, messages, settings, artifactOnly }) => {
      const S = window.STORE, D = window.DATA;
      window.qa = { calls: [], manifestReads: 0, external: null, snapshots: () => JSON.stringify({ products: D.products, sales: D.sales, returns: D.returns, exchanges: D.exchanges }) };
      qa.before = qa.snapshots();
      // Export and update remain real STORE methods. Only observability and
      // transport are synthetic; manifest failure prevents any recovery writes.
      const status = S.syncStatus();
      S.syncStatus = () => ({ ...status, compatibility: 'must_rebootstrap', synchronized: false });
      S.syncFleetStatus = async () => ({ devices: [], activity: [], quarantine: [] });
      window.AUTH.canAccess = () => true;
      window.AUTH.isAdmin = () => true;
      const client = await S.getClient();
      const empty = () => {
        const p = Promise.resolve({ data: [], error: null });
        for (const key of ['eq','select','in','order','range','limit','gte','contains']) p[key] = () => p;
        return p;
      };
      client.from = table => {
        if (table === 'system_manifest') {
          qa.manifestReads++;
          const p = Promise.resolve({ data: [], error: { message: 'QA_MANIFEST_STOP' } });
          p.eq = () => p;
          return { select: () => p };
        }
        return { select: empty, upsert: empty, update: empty };
      };
      client.rpc = async () => ({ data: [], error: null });
      const recovery = S.rebootstrapFromCloud;
      S.rebootstrapFromCloud = async () => {
        const entry = { activity: window.CORE.activityStatus(), readsBefore: qa.manifestReads };
        qa.calls.push(entry);
        try { return await recovery(); }
        catch (error) { entry.error = error.message; throw error; }
        finally { entry.readsAfter = qa.manifestReads; }
      };
      if (!artifactOnly) {
        window.UI.useSyncFocusActivity = new Function('React','window','useEffect', hook + '\nreturn useSyncFocusActivity;')(React, window, React.useEffect);
        window.UI.messageAuthority = new Function('window', messages + '\nreturn messageAuthority;')(window);
        new Function('React','window', settings)(React, window);
      }
      const original = document.getElementById('root');
      if (original) original.style.display = 'none';
      const host = document.createElement('div'); host.id = 'qa-settings-host';
      host.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;min-width:0;background:white';
      document.body.append(host);
      qa.root = ReactDOM.createRoot(host); qa.root.render(React.createElement(window.SettingsScreen));
    }, { hook, messages, settings, artifactOnly });
    const host = page.locator('#qa-settings-host');
    // Only the historical red baseline lacks the new contracts. The working
    // source and verified artifacts must provide their own stable test IDs.
    if (ref && !artifactOnly) {
      await host.getByText('Detalles técnicos', { exact: true }).last().waitFor();
      await host.evaluate(root => {
      const card = root.querySelector('[data-testid="sync-health-card"], [data-testid="sync-health"]');
      if (!card) throw Error('QA_SYNC_CARD_MISSING');
      const exportButton = [...card.querySelectorAll('button')].find(b => b.textContent === 'Exportar recuperación');
      const updateButton = [...card.querySelectorAll('button')].find(b => b.textContent === 'Actualizar este equipo');
      exportButton.setAttribute('data-testid', 'sync-recovery-export');
      updateButton.setAttribute('data-testid', 'sync-recovery-update');
      exportButton.closest('details').setAttribute('data-testid', 'sync-recovery-tools');
      });
    } else await host.getByTestId('sync-recovery-tools').waitFor();
    await host.getByTestId('sync-recovery-tools').locator('summary').click();
    const download = page.waitForEvent('download');
    await host.getByTestId('sync-recovery-export').click();
    await download;
    const update = host.getByTestId('sync-recovery-update');
    await update.click();
    await page.waitForFunction(() => qa.calls.length === 1 && qa.calls[0].error);
    const first = (await calls(page))[0];
    check(`${width}: export then update reaches STORE transport without self-activity`, first.error === 'MANIFEST_UNAVAILABLE' && first.activity.active === 0 && first.readsAfter > first.readsBefore, first);
    const field = ref && !artifactOnly
      ? host.getByText('Nombre comercial', { exact: true }).locator('..').locator('input')
      : host.getByTestId('config-field-store.name');
    await field.focus();
    const focused = await page.evaluate(async () => {
      const activity = CORE.activityStatus();
      try { await STORE.rebootstrapFromCloud(); } catch (error) { return { activity, error: error.message }; }
    });
    check(`${width}: focused configuration still blocks recovery`, focused.error === 'ACTIVITY_ACTIVE' && focused.activity.domains.config > 0, focused);
    await page.evaluate(() => { qa.external = CORE.beginActivity(['sales'], { screen: 'qa-existing-sale' }); });
    await update.focus();
    const transition = await page.evaluate(() => CORE.activityStatus());
    check(`${width}: config-to-panel transition releases only its own token`, !transition.domains.config && transition.domains.sales === 1 && transition.active === 1, transition);
    await update.click();
    await page.waitForFunction(() => qa.calls.length === 3 && qa.calls[2].error);
    const external = (await calls(page))[2];
    check(`${width}: unrelated sales activity still blocks UI update`, external.error === 'ACTIVITY_ACTIVE' && external.readsBefore === external.readsAfter, external);
    await page.evaluate(() => CORE.endActivity(qa.external));
    await update.click();
    await page.waitForFunction(() => qa.calls.length === 4 && qa.calls[3].error);
    const final = (await calls(page))[3];
    check(`${width}: releasing external activity permits next UI attempt`, final.error === 'MANIFEST_UNAVAILABLE' && final.activity.active === 0, final);
    check(`${width}: inventory and commercial history unchanged`, await page.evaluate(() => qa.before === qa.snapshots()));
    const message = await page.evaluate(() => UI.messageAuthority('ACTIVITY_ACTIVE'));
    check(`${width}: activity error uses update-safety copy and retains technical details`, message.title === 'La actualización está en espera' && message.level === 'warning' && message.technicalDetails === 'ACTIVITY_ACTIVE', message);
    await field.focus();
    await page.evaluate(() => { qa.external = CORE.beginActivity(['sales'], { screen: 'qa-existing-sale' }); });
    await host.getByTestId('settings-section-demo').click();
    await page.waitForFunction(() => !CORE.activityStatus().domains.config);
    const demo = await page.evaluate(() => CORE.activityStatus());
    check(`${width}: administration exception releases local focus and preserves external activity`, demo.active === 1 && demo.domains.sales === 1 && !demo.domains.config, demo);
    await page.evaluate(() => CORE.endActivity(qa.external));
    await host.getByTestId('settings-section-negocio').click();
    await field.focus();
    check(`${width}: returning from administration re-enables configuration guard`, await page.evaluate(() => CORE.activityStatus().domains.config === 1));
    const bounds = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, host: document.getElementById('qa-settings-host').scrollWidth }));
    check(`${width}: settings stays within viewport`, bounds.document <= width + 1 && bounds.host <= width + 1, bounds);
    await page.screenshot({ path: join(out, `device-focus-${ref ? 'baseline' : 'working'}-${width}.png`) });
    await context.close();
  }
} finally { await browser.close(); }
console.log(`H142 device focus (${artifactOnly ? 'artifact' : ref || 'working'}): ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
