// H142/S13: real Chromium localStorage + IndexedDB, real CORE/STORE source.
// DATA/transport use the existing synthetic queue harness. No business database,
// external traffic or private captures. Reload creates a fresh JS runtime.
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const harness = read('test-store-queue.mjs');
const fresh = harness.slice(harness.indexOf('function freshEnv()'), harness.indexOf('\nconst SRC ='));
const source = read('balam/core.jsx') + '\n' + read('balam/store.jsx');
let passed = 0, failed = 0;
const check = (name, ok, detail = {}) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); ok ? passed++ : failed++; };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function boot(page, { first = true, failDB = false, abortDB = false, decide = false } = {}) {
  return page.evaluate(async ({ fresh, source, first, failDB, abortDB, decide }) => {
    const env = new Function(fresh + '\nreturn freshEnv();')();
    env.localStorage = localStorage;
    env.window.indexedDB = indexedDB;
    env.window.crypto = crypto;
    env.window.AUTH = { current: () => null, role: () => 'admin', refreshPermissions: async () => {} };
    env.client.auth.getSession = async () => ({ data: { session: { user: { id: 'qa-user' } } } });
    const audit = { archiveCommitted: false, removalAfterCommit: null, attempts: 0, completed: [], decided: false };
    const raw = { id: 'qa-product', nombre: 'Synthetic', stock_quantity: 7, sync_base_version: 0 };
    const op = { id: 'qa-durable-operation', type: 'upsert', kind: 'products', table: 'products', ownerId: null, rowIds: [raw.id], rows: [raw], submittedRows: [raw], status: 'pending', createdAt: '2021-01-01T00:00:00Z' };
    if (first) {
      localStorage.setItem('balam_sync_data_epoch', '1');
      localStorage.setItem('balam_sync_queue', JSON.stringify([op]));
    }
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith('balam_sync_quarantine_')) throw new DOMException('Synthetic quota', 'QuotaExceededError');
      if (key === 'balam_sync_queue' && value === '[]' && first) audit.removalAfterCommit = audit.archiveCommitted;
      return set.call(this, key, value);
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if (String(key).startsWith('balam_sync_quarantine_')) this.transaction.addEventListener('complete', () => { audit.archiveCommitted = true; }, { once: true });
      const request = put.call(this, value, key);
      if (abortDB && String(key).startsWith('balam_sync_quarantine_')) this.transaction.abort();
      return request;
    };
    if (failDB) env.window.indexedDB = { open() { throw new DOMException('Synthetic disk failure', 'UnknownError'); } };
    const tables = env.cloud.rowsByTable;
    tables.system_manifest = [{ singleton: true, schema_version: 20260830017500, sync_protocol_min: 3, sync_protocol_current: 3, data_epoch: 2, domain_modes: { products: 'active' } }];
    tables.sync_domain_versions = [{ domain: 'products', version: 1 }];
    tables.products = [{ ...raw, sync_version: 1 }];
    env.window.DATA.products = [];
    const apply = env.window.DATA.applyRemote;
    env.window.DATA.applyRemote = function(kind, rows, opts) {
      if (kind === 'products') this.products.splice(0, this.products.length, ...rows);
      return apply.call(this, kind, rows, opts);
    };
    env.setRpc(async (name, args) => {
      if (name === 'consume_sync_quarantine_decisions' && decide && !audit.decided) {
        audit.decided = true;
        return { data: [{ operation_id: op.id, remote_epoch: 2 }], error: null };
      }
      if (name === 'save_products_checked_v2') {
        audit.attempts++;
        // A replay is acknowledged with the same immutable payload and version.
        return { data: args.p_rows.map(r => ({ ...r, sync_version: Number(r.sync_base_version) + 1 })), error: null };
      }
      if (name === 'complete_sync_quarantine') audit.completed.push(args);
      return { data: [], error: null };
    });
    const S = new Function('window','localStorage','document','CustomEvent','setInterval','clearInterval','navigator', source + '\nreturn window.STORE;')(
      env.window, localStorage, document, CustomEvent, () => 1, () => {}, navigator);
    window.qa = { S, env, audit };
    await S.init({});
    if (!first) { await S.reconcileDomains(); return { ready: true }; }
    try { await S.rebootstrapFromCloud(); return { ok: true }; }
    catch (error) { return { error: error.message }; }
  }, { fresh, source, first, failDB, abortDB, decide });
}
async function archives(page) {
  return page.evaluate(async () => {
    const req = indexedDB.open('balam_sync', 1);
    const db = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
    const rows = await new Promise((resolve, reject) => {
      const result = [], tx = db.transaction('durable_queue', 'readonly');
      const cursor = tx.objectStore('durable_queue').openCursor();
      cursor.onsuccess = () => { const c = cursor.result; if (!c) return; if (String(c.key).startsWith('balam_sync_quarantine_')) result.push({ key: c.key, value: c.value }); c.continue(); };
      tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error);
    }); db.close(); return rows;
  });
}
try {
  for (const mode of ['fallback', 'unavailable', 'aborted']) {
    const failDB = mode === 'unavailable', abortDB = mode === 'aborted';
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>H142 isolated storage QA</title>' }));
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:8931/');
    const recovery = await boot(page, { failDB, abortDB });
    const state = await page.evaluate(() => ({ queue: JSON.parse(localStorage.getItem('balam_sync_queue') || '[]'), audit: qa.audit, status: qa.S.syncStatus() }));
    if (failDB || abortDB) {
      check(`IDB ${mode} and LS quota: recovery refuses destructive continuation`, recovery.error === 'QUARANTINE_STORAGE_UNAVAILABLE', recovery);
      check(`IDB ${mode} and LS quota: original queue remains intact`, state.queue.length === 1 && state.queue[0].id === 'qa-durable-operation' && state.audit.attempts === 0);
    } else {
      const stored = await archives(page);
      check('quota fallback commits archive before removing active queue', recovery.ok && state.audit.removalAfterCommit === true && state.queue.length === 0, { recovery, removalAfterCommit: state.audit.removalAfterCommit });
      check('real IndexedDB contains exact original operation', stored.length === 1 && stored[0].value.operations[0].id === 'qa-durable-operation' && stored[0].value.operations[0].submittedRows[0].stock_quantity === 7);
      await page.reload();
      check('reload retains durable archive before recovery decision', (await archives(page))[0]?.value.operations.length === 1);
      await boot(page, { first: false, decide: true });
      await page.waitForFunction(() => qa.audit.completed.some(c => c.p_ok === true));
      await page.waitForFunction(() => qa.S.pending === 0);
      const replay = await page.evaluate(() => ({ attempts: qa.audit.attempts, completed: qa.audit.completed }));
      // Finishing the heartbeat also waits for removal from the archive.
      await page.evaluate(() => qa.S.reconcileDomains());
      const resolved = await archives(page);
      check('reload finds archive and restores authorized replay once', replay.attempts === 1 && replay.completed.some(c => c.p_ok === true), { attempts: replay.attempts, completed: replay.completed.length });
      check('resolved operation removed durably from IndexedDB archive', resolved.every(a => a.value.operations.length === 0));
    }
    await context.close();
  }
} finally { await browser.close(); }
console.log(`H142 quarantine storage browser: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
