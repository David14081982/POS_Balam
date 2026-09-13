// H171 minimal fresh-session seam. No import/CLI effects, credentials or network client creation.
// The caller supplies its existing fixture, guarded transport and authority comparison.
import { journalHash } from './h171-live-journal.mjs';

const requireValue = (ok, code) => { if (!ok) throw new Error('SESSION_DELIVERY_' + code); };
const REAL_ACTOR = '3f24222e-fd74-4ed2-b56f-f298af574b1e';

/** Closes all pages in the old C context and replaces context/page on the SAME
 * terminal object so the runner's C and terminals[] references remain valid.
 * Credentials stay in memory and never enter observations or errors.
 * After return, the caller continues its existing UI/reload/report journey.
 */
export async function runFreshSessionDelivery({ browser, terminal, peers, address, fixtures, credentials,
  guardedBrowserRoute, waitReady, readOnlyConverge,
  contextFactory = options => browser.newContext(options), forward = route => route.continue() }) {
  requireValue(terminal?.name === 'C' && terminal.context && terminal.retired !== true, 'ACTIVE_C_REQUIRED');
  requireValue(Array.isArray(peers) && peers.length === 2 && peers[0].name === 'A' && peers[1].name === 'B' &&
    peers.every(t => t.context && t.context !== terminal.context && t.retired !== true), 'INDEPENDENT_A_B_REQUIRED');
  requireValue(/^[a-f0-9-]{36}$/.test(fixtures?.run || '') && fixtures.userId && fixtures.userId !== REAL_ACTOR &&
    Array.isArray(fixtures.installations) && fixtures.installations.length === 3 &&
    fixtures.installations[2] === 'qa-h164-' + fixtures.run + '-C', 'EXACT_FIXTURE_C_REQUIRED');
  requireValue(credentials?.email === fixtures.email && typeof credentials.password === 'string' && credentials.password.length > 0,
    'QA_CREDENTIALS_REQUIRED');
  requireValue(typeof guardedBrowserRoute === 'function' && typeof waitReady === 'function' &&
    typeof readOnlyConverge === 'function' && typeof contextFactory === 'function' && typeof forward === 'function', 'CALLBACKS_REQUIRED');
  const origin = new URL(address).origin;
  requireValue(new URL(address).hostname === '127.0.0.1', 'LOCAL_ARTIFACT_ADDRESS_REQUIRED');
  const installationId = fixtures.installations[2], oldContext = terminal.context, oldPages = oldContext.pages();
  let phase = 'close-old-context', pageErrors = 0;
  try {
    await oldContext.close();
    requireValue(oldPages.every(p => p.isClosed()), 'OLD_PAGES_NOT_CLOSED');
    phase = 'fresh-context';
    const context = await contextFactory({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    requireValue(context !== oldContext && !peers.some(t => t.context === context), 'CONTEXT_REUSED');
    // Keep the new context reachable by the runner's finally/cleanup even on failure.
    terminal.context = context;
    const empty = await context.storageState({ indexedDB: true });
    requireValue(empty.cookies.length === 0 && empty.origins.length === 0, 'FRESH_STORAGE_NOT_EMPTY');
    requireValue(typeof context.routeWebSocket === 'function', 'WEBSOCKET_CAGE_REQUIRED');
    await context.routeWebSocket('**', ws => ws.close({ code: 1000, reason: 'H171 fresh session uses authoritative reads' }));
    await context.route('**/*', guardedBrowserRoute(terminal, forward));
    await context.addInitScript(({ origin, installationId }) => {
      if (location.origin !== origin) return;
      window.__h171FreshSessionStorage = { localStorageCount: localStorage.length, sessionStorageCount: sessionStorage.length };
      localStorage.setItem('balam_device_id', installationId);
    }, { origin, installationId });
    const page = await context.newPage(); terminal.page = page;
    terminal.errors ||= []; terminal.revisionSignals = 0;
    page.setDefaultTimeout(60000);
    page.on('pageerror', () => { pageErrors++; terminal.errors.push('SESSION_DELIVERY_PAGE_ERROR'); });
    phase = 'load-artifact';
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AUTH?.isReady() && window.STORE);
    const initial = await page.evaluate(() => window.__h171FreshSessionStorage);
    requireValue(initial?.localStorageCount === 0 && initial.sessionStorageCount === 0, 'ORIGIN_STORAGE_NOT_EMPTY_BEFORE_BINDING');
    phase = 'ui-login';
    await page.locator('input[type="email"]').fill(credentials.email);
    await page.locator('input[type="password"]').fill(credentials.password);
    await page.locator('input[type="password"]').press('Enter');
    await page.getByTestId('nav-pos').waitFor({ state: 'attached' });
    await waitReady(terminal);
    requireValue(await page.evaluate(async ({ authId, profileId }) => {
      const { data, error } = await (await window.STORE.ensureClient()).auth.getSession();
      return !error && data?.session?.user?.id === authId && typeof profileId === 'string'
        && window.AUTH.current()?.id === profileId;
    }, { authId: fixtures.userId, profileId: fixtures.sellers?.[0] }), 'AUTH_OR_PROFILE_IDENTITY_MISMATCH');
    phase = 'authority-comparison';
    const comparison = await readOnlyConverge([...peers, terminal]);
    requireValue(pageErrors === 0, 'PAGE_ERROR');
    const evidence = { kind: 'fresh-browser-session', installationId, oldContextClosed: true,
      oldPagesClosed: oldPages.length, freshContext: true, cookiesBeforeLoad: 0, originsBeforeLoad: 0,
      localStorageBeforeInstallationBinding: 0, sessionStorageBeforeInstallationBinding: 0,
      serviceWorkersBlocked: true, websocketsBlocked: true, guardedTransportInstalled: true,
      loginViaUI: true, actorMatched: true, profileMatched: true, comparedTerminals: ['A','B','C'],
      comparisonSha256: journalHash(comparison ?? null), pointZeroExercised: false, certified: false };
    return { terminal, evidence };
  } catch {
    // Playwright fill errors can include input values; do not propagate the original error/cause.
    throw new Error('SESSION_DELIVERY_FAILED:' + phase);
  }
}

export const reopenFreshTerminal = runFreshSessionDelivery;
