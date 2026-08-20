import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const server = http.createServer((req, res) => {
  let requestPath = decodeURIComponent(req.url.split('?')[0]);
  if (requestPath === '/') requestPath = '/index.html';
  const filePath = path.join(root, requestPath);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath)) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': requestPath.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
});
await new Promise(resolve => server.listen(8895, '127.0.0.1', resolve));

let passed = 0, failed = 0;
const errors = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  ok ? passed++ : failed++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
page.on('pageerror', error => errors.push(String(error)));
await page.route(/supabase\.co|googleapis\.com|gstatic\.com/, route => route.abort());
await page.goto('http://127.0.0.1:8895/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.SettingsScreen && window.STORE && window.AUTH);
await page.evaluate(() => {
  const devices = Array.from({ length: 7 }, (_, index) => ({
    device_id: index === 0 ? 'equipo-david' : `device-${index}`,
    display_name: index === 0 ? 'Equipo David' : `Equipo ${index + 1}`,
    device_type: 'pc', queue_pending: 0, queue_blocked: 0,
    status: 'online', connection: index === 0 ? 'unknown' : 'disconnected',
    staleEpoch: false, client_build: '20260820016800',
    last_seen_at: '2026-08-19T12:00:00Z', last_synced_at: null,
  }));
  const activity = [{
    device_id: 'equipo-david', operation_id: 'h125-bg-260812-0006',
    user_email: 'admin@balamguayaberas.com', operation_type: 'exchange',
    reference: 'BG-260812-0006', summary: 'Cambio de mercancia - BG-260812-0006',
    status: 'blocked', requires_action: true, requires_attention: false,
    historical_incident: true, admin_action: 'review', action_status: 'completed',
    diagnostic: { code: 'commit_mismatch', message: 'commit_mismatch' },
    updated_at: '2026-08-19T12:00:00Z',
  }];
  window.AUTH.canAccess = () => true;
  window.AUTH.isAdmin = () => true;
  window.SCREENS.childrenOf = () => [{
    id: 'config.store', section: 'negocio', title: 'Negocio', icon: 'store',
  }];
  window.STORE.syncStatus = () => ({ synchronized: true, compatibility: 'ok',
    pending: 0, blocked: 0, invalidDomains: [], dataEpoch: 1, realtime: 'connected' });
  window.STORE.syncFleetStatus = async () => ({
    devices, activity, quarantine: [], current: 7, stale: 0,
    attention: 0, disconnected: 7,
  });
  document.body.innerHTML = '<div id="h125-root"></div>';
  ReactDOM.createRoot(document.getElementById('h125-root')).render(React.createElement(window.SettingsScreen));
});

try {
  await page.getByTestId('sync-health').waitFor({ timeout: 8000 });
} catch (error) {
  console.error('H125_RENDER_ERRORS', errors.join(' | '));
  console.error('H125_RENDER_BODY', (await page.locator('body').innerText()).slice(0, 2000));
  throw error;
}
let body = await page.getByTestId('sync-health').innerText();
const summaryCards = page.getByTestId('sync-health').locator('div.grid').first().locator(':scope > div');
check('summary reports zero actionable incidents', /^0\b/.test(await summaryCards.nth(3).innerText()));
const activityTab = page.getByText('Actividad reciente', { exact: true });
const tabs = activityTab.locator('xpath=..').locator('button');
check('attention tab has no historical count', !(await tabs.nth(2).innerText()).includes('(1)'));

await activityTab.click();
body = await page.getByTestId('sync-health').innerText();
check('BG-260812-0006 remains auditable in recent activity', body.includes('BG-260812-0006'));
check('incident is explicitly historical', body.includes('Incidencia hist'));
check('historical incident offers no retry', !body.includes('Autorizar reintento'));
check('historical incident offers no disabled reviewed button', !body.includes('Revisado'));

await tabs.nth(2).click();
body = await page.getByTestId('sync-health').innerText();
check('attention tab is empty', body.includes('No hay incidencias'));
check('BG-260812-0006 is absent from attention tab', !body.includes('BG-260812-0006'));
check('mobile viewport has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
check('browser has no runtime errors', errors.length === 0);

await browser.close();
server.close();
console.log(`\nH-125 E2E: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
