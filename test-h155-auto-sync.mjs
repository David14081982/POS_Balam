// H155 regression: real CORE + STORE, isolated transport and persistent browser stores.
// No network, Supabase credentials, generated artifacts or test output files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const harness = readFileSync(new URL('test-store-queue.mjs', import.meta.url), 'utf8');
const freshEnv = new Function(harness.slice(harness.indexOf('function freshEnv()'), harness.indexOf('\nconst SRC =')) + '\nreturn freshEnv;')();
const source = ['balam/core.jsx', 'balam/store.jsx'].map(file => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
const dataSource = readFileSync(new URL('balam/data.jsx', import.meta.url), 'utf8');
const dataAckStart = dataSource.indexOf('  function applySyncResult(kind, rows, expected, operation)');
const dataAckSource = dataSource.slice(dataAckStart, dataSource.indexOf('\n  // H-65:', dataAckStart));
const realDataAck = new Function('products', 'saveProducts', 'requireCatalogResync',
  'const clients=[],sellers=[],promos=[],hydrate=row=>row,saveClients=()=>{},saveSellers=()=>{},savePromos=()=>{};let remoteApplying=false;'
  + dataAckSource + '\nreturn applySyncResult;');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 500 && !check(); i++) await pause(2); assert.equal(check(), true, 'transport boundary was not reached'); }
const owner = 'h155-a@example.test';
const manifest = { singleton: true, schema_version: 20260830017500, sync_protocol_min: 3,
  sync_protocol_current: 3, data_epoch: 1, domain_modes: { products: 'active', config: 'active' } };
const pending = (id = 1, extra = {}) => ({ id: `15500000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  type: 'upsert', kind: 'products', table: 'products', conflict: 'id', ownerId: owner,
  protocolVersion: 3, dataEpoch: 1, rowIds: ['edited-' + id],
  rows: [{ id: 'edited-' + id, nombre: 'Original intent', sync_base_version: 1, color: 'AZ' }],
  status: 'pending', ...extra });

// Request success and transaction completion are distinct, as in IndexedDB.
// All values are cloned; reopening STORE reuses only persistent stores.
function durableDB(rows, controls) {
  return { open() {
    const request = {};
    setTimeout(() => {
      request.result = { objectStoreNames: { contains: () => true }, close() {}, transaction(_store, mode) {
        const tx = {};
        const complete = () => setTimeout(() => tx.oncomplete?.(), 0);
        tx.objectStore = () => ({
          get(key) { const r = {}; setTimeout(() => { r.result = structuredClone(rows.get(key)); r.onsuccess?.(); complete(); }, 0); return r; },
          put(value, key) { const r = {}; setTimeout(() => {
            if (controls.failIDB) { r.error = new Error('IDB_WRITE_FAILED'); r.onerror?.(); tx.error = r.error; tx.onabort?.(); return; }
            rows.set(key, structuredClone(value)); r.onsuccess?.(); complete();
          }, 0); return r; },
          delete(key) { const r = {}; setTimeout(() => { rows.delete(key); r.onsuccess?.(); complete(); }, 0); return r; },
          openCursor() {
            const r = {}, entries = Array.from(rows.entries()); let index = 0;
            const next = () => setTimeout(() => {
              const entry = entries[index++];
              r.result = entry ? { key: entry[0], value: structuredClone(entry[1]), continue: next } : null;
              r.onsuccess?.(); if (!entry) complete();
            }, 0);
            next(); return r;
          },
        });
        return tx;
      } };
      request.onsuccess?.();
    }, 0);
    return request;
  } };
}

async function setup({ queue = [], controls = {}, previous, start = true } = {}) {
  const e = freshEnv(), timers = new Map(), events = [], idb = previous?.idb || new Map();
  let timerId = 0, channels = 0;
  const control = Object.assign({ online: true, writer: true, reject: true, archiveAck: true,
    completionAck: true, reviewRows: [], commands: [], profile: { email: owner, role: 'admin' } }, controls);
  if (previous) e.localStorage = previous.e.localStorage;
  else e.localStorage.setItem('balam_sync_queue', JSON.stringify(queue));
  const baseSet = e.localStorage.setItem.bind(e.localStorage);
  e.localStorage.setItem = (key, value) => {
    if (key.startsWith('balam_sync_quarantine_') && control.failArchive) throw new Error('QUOTA');
    baseSet(key, value);
  };
  e.window.indexedDB = durableDB(idb, control);
  e.window.crypto = webcrypto;
  e.window.AUTH = { current: () => control.profile, role: () => control.profile?.role || null, refreshPermissions: async () => true };
  e.window.dispatchEvent = event => { events.push(event); for (const fn of e.window.listeners[event.type] || []) fn(event); return true; };
  e.window.DATA.assertLocalWriter = () => { if (!control.writer) throw new Error('NOT_WRITER'); };
  e.window.DATA.awaitLocalWriter = async () => control.writer;
  if (control.bootstrapProbe) {
    control.bootstrapPasses = 0; control.folioBlocks = 0;
    e.window.DATA.reconcileLayawayProductLocks = () => { control.bootstrapPasses++; };
    e.window.DATA.folioBlockRequest = () => ({ needed: true, prefix: 'H155', date: '260911', count: 100, floor: 0 });
    e.window.DATA.applyFolioBlock = () => { control.folioBlocks++; };
  }
  e.window.DATA.products = [{ id: 'confirmed', nombre: 'Old', stockQuantity: 99 }];
  e.window.DATA.applyRemote = (kind, rows) => {
    if (kind === 'products') { e.window.DATA.products = rows; e.localStorage.setItem('h155_projection', JSON.stringify(rows)); }
    return true;
  };
  if (control.versionConflict) e.window.DATA.applySyncResult = (...args) => realDataAck(
    e.window.DATA.products,
    () => e.localStorage.setItem('h155_projection', JSON.stringify(e.window.DATA.products)),
    () => { control.catalogResyncRequested = true; })(...args);
  e.cloud.rowsByTable.system_manifest = [structuredClone(manifest)];
  e.cloud.rowsByTable.sync_domain_versions = [{ domain: 'products', version: 1 }, { domain: 'config', version: 1 }];
  e.cloud.rowsByTable.products = [{ id: 'confirmed', nombre: 'Confirmed', stock_quantity: 10, sync_version: 1 }];
  if (control.versionConflict) for (const op of queue) for (const row of op.rows || []) {
    e.cloud.rowsByTable.products.push({ ...row, precio: 100, stock_quantity: 3, stock: [], sync_version: 9 });
  }
  e.cloud.rowsByTable.settings = [{ key: 'storeName', value: 'Confirmed config' }];
  const originalFrom = e.client.from;
  e.client.from = table => {
    const query = originalFrom(table), originalSelect = query.select;
    query.select = (...args) => {
      const chain = originalSelect(...args);
      const wrapper = { then: (resolve, reject) => chain.then(async result => {
        if (control.readGate && control.readGate.table === table) await control.readGate.promise;
        if (table === 'system_manifest' && control.manifestFailure) return { data: null, error: { message: 'Failed to fetch manifest' } };
        if (table === 'products' && control.comparisonFailure) return { data: null, error: { code: '42501', message: 'permission denied' } };
        if (table === 'sync_quarantine_cases') return control.reviewFailure ? { data: null, error: { message: 'Failed to fetch reviews' } }
          : { data: control.reviewRows.filter(row => ['pending_review', 'approved', 'delivered', 'failed'].includes(row.status)), error: null };
        return result;
      }).then(resolve, reject) };
      for (const method of ['eq', 'in', 'gte', 'contains', 'order', 'range']) wrapper[method] = (...values) => { chain[method](...values); return wrapper; };
      wrapper.limit = () => wrapper;
      return wrapper;
    };
    return query;
  };
  e.client.auth.getSession = async () => ({ data: { session: control.profile ? { user: { id: control.profile.email, email: control.profile.email } } : null } });
  e.client.channel = () => {
    channels++; const channel = { on(_event, _filter, fn) { channel.notify = fn; return channel; }, subscribe(fn) { channel.status = fn; return channel; } }; return channel;
  };
  e.client.removeChannel = () => { channels--; };
  e.setRpc(async (name, args) => {
    if (name === 'get_sync_device_recovery') return control.recoveryFailure
      ? { data: null, error: { message: 'Failed to fetch recovery' } } : { data: null, error: null };
    if (name === 'save_products_checked_v2') {
      if (control.versionConflict) return { data: (args.p_rows || []).map(row =>
        e.cloud.rowsByTable.products.find(remote => remote.id === row.id)
          || { ...row, precio: 100, stock_quantity: 3, stock: [], sync_version: 9 }), error: null };
      if (control.reject) return { data: null, error: { code: 'P0001', message: 'REFERENCE_RECLASSIFICATION_REQUIRED' } };
      return { data: (args.p_rows || []).map(row => ({ ...row, sync_version: Number(row.sync_base_version) + 1 })), error: null };
    }
    if (name === 'report_sync_quarantine') {
      if (control.archiveAck && !control.reviewRows.some(row => row.operation_id === args.p_operation_id)) control.reviewRows.push({ operation_id: args.p_operation_id, status: 'pending_review' });
      return { data: control.archiveAck, error: null };
    }
    if (name === 'consume_sync_quarantine_decisions') {
      if (!control.commands.length) return { data: [], error: null };
      return { data: [control.commands.shift()], error: null };
    }
    if (name === 'complete_sync_quarantine') {
      if (control.completionAck) control.reviewRows.forEach(row => { if (row.operation_id === args.p_operation_id) row.status = args.p_ok ? 'completed' : 'failed'; });
      return { data: control.completionAck, error: null };
    }
    if (name === 'consume_sync_commands') return { data: [], error: null };
    if (name === 'reserve_folio_block') return { data: { ok: true, from: 1, to: 100 }, error: null };
    return { data: null, error: null };
  });
  e.cloud.directedRecoveryEnabled = true;
  const document = { hidden: false };
  const navigator = { get onLine() { return control.online; } };
  const Event = class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } };
  const S = new Function('window', 'localStorage', 'document', 'CustomEvent', 'setInterval', 'clearInterval', 'navigator', source + '\nreturn window.STORE;')(
    e.window, e.localStorage, document, Event, (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, id => timers.delete(id), navigator);
  if (control.recoveryFailure) e.localStorage.setItem('balam_device_recovery_v1', JSON.stringify({ device_id: e.window.CORE.getDeviceId(), state: 'ready' }));
  const state = { e, S, control, timers, idb, events, document, get channels() { return channels; },
    emit: type => e.window.dispatchEvent(new Event(type)),
    async tick() { for (const timer of Array.from(timers.values())) await timer.fn(); await pause(100); },
    async ready() { await S.init({}); await S.reconcileDomains(); await pause(30); },
    async close() { await S.setSession(null); control.profile = null; },
  };
  if (start) await state.ready();
  return state;
}

const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, pass: false }); console.error('FAIL ' + name + ': ' + error.message); }
}
const stock = x => x.e.window.DATA.products[0]?.stockQuantity;
const archives = x => [
  ...Array.from({ length: x.e.localStorage.length }, (_, i) => x.e.localStorage.key(i)).filter(key => key.startsWith('balam_sync_quarantine_')).map(key => JSON.parse(x.e.localStorage.getItem(key))),
  ...Array.from(x.idb.entries()).filter(([key]) => key.startsWith('balam_sync_quarantine_')).map(([, value]) => value),
];
const originals = x => archives(x).flatMap(value => value.operations || []);
const productCalls = x => x.e.rpcCalls.filter(call => call.name === 'save_products_checked_v2');

for (const failure of ['manifestFailure', 'recoveryFailure']) await test('automatic retry after initial ' + failure + ' with navigator continuously online', async () => {
  const x = await setup({ controls: { [failure]: true } });
  x.control[failure] = false; await x.tick();
  assert.equal(stock(x), 10); assert.equal(x.channels, 1);
  x.e.cloud.rowsByTable.products[0].stock_quantity = 20;
  x.e.cloud.rowsByTable.sync_domain_versions[0].version = 2;
  await x.tick(); assert.equal(stock(x), 20);
});
await test('recovered bootstrap resumes auth queue, locks and folios exactly once', async () => {
  const op = pending(88, { status: 'auth_required', diagnostic: { code: 'token_expired', policy: 'sign_in', retryable: false } });
  const x = await setup({ queue: [op], controls: { recoveryFailure: true, reject: false, bootstrapProbe: true } });
  assert.equal(productCalls(x).length, 0); assert.equal(x.control.bootstrapPasses, 0);
  x.control.recoveryFailure = false; await x.tick();
  assert.equal(x.S.pending, 0); assert.equal(productCalls(x).length, 1);
  assert.equal(x.control.bootstrapPasses, 1); assert.equal(x.control.folioBlocks, 1);
  await x.tick(); await x.tick();
  assert.equal(productCalls(x).length, 1); assert.equal(x.control.bootstrapPasses, 1); assert.equal(x.control.folioBlocks, 1);
});
await test('online event repairs bootstrap and repeated init/manual retain one service', async () => {
  const x = await setup({ controls: { manifestFailure: true } });
  x.control.manifestFailure = false; x.emit('online'); await pause(180);
  assert.equal(stock(x), 10); assert.equal(x.channels, 1);
  const counts = Object.fromEntries(Object.entries(x.e.window.listeners).map(([key, values]) => [key, values.length]));
  await Promise.all([x.S.init({}), x.S.init({}), x.S.synchronizeNow()]); await pause(100);
  assert.equal(x.channels, 1); assert.deepEqual(Object.fromEntries(Object.entries(x.e.window.listeners).map(([key, values]) => [key, values.length])), counts);
  assert.equal([...x.timers.values()].filter(timer => timer.ms === 60000).length, 2);
});
await test('manual recovery leaves automatic polling installed', async () => {
  const x = await setup({ controls: { manifestFailure: true } }); x.control.manifestFailure = false;
  await x.S.synchronizeNow(); assert.equal(stock(x), 10);
  x.e.cloud.rowsByTable.products[0].stock_quantity = 30; x.e.cloud.rowsByTable.sync_domain_versions[0].version = 2;
  await x.tick(); assert.equal(stock(x), 30); assert.equal(x.channels, 1);
});
await test('offline and non-writer ticks do not synchronize; activity protects products until idle', async () => {
  const x = await setup();
  x.e.cloud.rowsByTable.products[0].stock_quantity = 40; x.e.cloud.rowsByTable.sync_domain_versions[0].version = 2;
  x.control.online = false; await x.tick(); assert.equal(stock(x), 10);
  x.control.online = true; x.control.writer = false; await x.tick(); assert.equal(stock(x), 10);
  x.control.writer = true; const token = x.e.window.CORE.beginActivity(['products'], 'draft'); await x.tick(); assert.equal(stock(x), 10);
  x.e.window.CORE.endActivity(token); await pause(160); assert.equal(stock(x), 40);
});
await test('logout during failed bootstrap stops automatic work and preserves another owner queue', async () => {
  const x = await setup({ start: false, queue: [pending()], controls: { manifestFailure: true } });
  await x.S.setSession(x.control.profile); await pause(70); await x.close();
  x.control.manifestFailure = false; const before = x.e.calls.length + x.e.rpcCalls.length;
  x.emit('online'); x.emit('visibilitychange'); await x.tick();
  assert.equal(x.e.calls.length + x.e.rpcCalls.length, before); assert.equal(x.channels, 0);
  x.control.profile = { email: 'h155-b@example.test', role: 'admin' }; await x.S.setSession(x.control.profile); await pause(100);
  assert.equal(x.S.queueStatus().otherSessionPending, 1); assert.equal(originals(x).length, 0);
});
await test('a product response already in flight cannot apply after logout', async () => {
  const x = await setup(); await x.S.setSession(x.control.profile); await x.S.reconcileDomains();
  x.e.cloud.rowsByTable.products[0].stock_quantity = 50; x.e.cloud.rowsByTable.sync_domain_versions[0].version = 2;
  let release; x.control.readGate = { table: 'products', promise: new Promise(resolve => { release = resolve; }) };
  const before = x.e.calls.filter(call => call.table === 'products').length;
  const flight = x.S.reconcileDomains({ force: true });
  await until(() => x.e.calls.filter(call => call.table === 'products').length > before);
  await x.close(); release(); await flight;
  assert.equal(stock(x), 10); assert.equal(x.S.syncStatus().cursors.products, 1);
});
await test('losing the writer during a product read preserves projection and checkpoint', async () => {
  const x = await setup();
  x.e.cloud.rowsByTable.products[0].stock_quantity = 60; x.e.cloud.rowsByTable.sync_domain_versions[0].version = 2;
  let release; x.control.readGate = { table: 'products', promise: new Promise(resolve => { release = resolve; }) };
  const before = x.e.calls.filter(call => call.table === 'products').length;
  const flight = x.S.reconcileDomains({ force: true });
  await until(() => x.e.calls.filter(call => call.table === 'products').length > before);
  x.control.writer = false; release(); await flight;
  assert.equal(stock(x), 10); assert.equal(x.S.syncStatus().cursors.products, 1);
  x.control.readGate = null; x.control.writer = true; await x.tick(); assert.equal(stock(x), 60);
});
await test('permanent reference rejection archives originals and unlocks confirmed products without clean success', async () => {
  const queue = Array.from({ length: 7 }, (_, i) => pending(i + 1));
  const x = await setup({ queue }); await x.S.reconcileDomains({ force: true });
  assert.equal(x.S.pending, 0); assert.deepEqual(originals(x).map(op => op.rows), queue.map(op => op.rows));
  assert.equal(stock(x), 10); assert.equal(x.S.syncStatus().reviewPending, 7); assert.equal(x.S.syncStatus().synchronized, false);
  assert.equal(productCalls(x).length, 7); await x.tick(); assert.equal(productCalls(x).length, 7);
});
await test('obsolete product versions are preserved for review without freezing later inventory', async () => {
  const queue = Array.from({ length: 7 }, (_, i) => {
    const op = pending(i + 1); op.rows[0] = { ...op.rows[0], precio: 101, stock_quantity: 99, stock: [] }; return op;
  });
  const x = await setup({ queue, controls: { versionConflict: true } });
  await x.S.reconcileDomains({ force: true });
  assert.equal(x.control.catalogResyncRequested, true, 'real DATA ACK must observe the obsolete version');
  assert.equal(x.S.pending, 0); assert.equal(originals(x).length, 7);
  assert.deepEqual(originals(x).map(op => op.submittedRows), queue.map(op => op.rows));
  assert.equal(originals(x).every(op => op.diagnostic.code === 'product_version_conflict' && op.diagnostic.policy === 'review_conflict'), true);
  const fields = originals(x)[0].referenceReview.rows[0].fields;
  assert.deepEqual(fields.find(field => field.field === 'sync_base_version'), { field: 'sync_base_version', requested: 1, confirmed: 9 });
  assert.deepEqual(fields.find(field => field.field === 'precio'), { field: 'precio', requested: 101, confirmed: 100 });
  assert.deepEqual(fields.find(field => field.field === 'stock_quantity'), { field: 'stock_quantity', requested: 99, confirmed: 3 });
  x.e.cloud.rowsByTable.products[0].stock_quantity = 70; x.e.cloud.rowsByTable.sync_domain_versions[0].version = 2;
  await x.tick(); assert.equal(stock(x), 70); assert.equal(productCalls(x).length, 7);
  assert.equal(x.S.syncStatus().reviewPending, 7); assert.equal(x.S.syncStatus().synchronized, false);
  x.control.commands.push({ operation_id: queue[0].id, remote_epoch: 1 });
  await x.tick();
  assert.equal(productCalls(x).length, 8); assert.equal(x.S.pending, 0);
  assert.equal(x.control.reviewRows[0].status, 'failed'); assert.equal(originals(x).length, 7);
  assert.deepEqual(originals(x).map(op => op.submittedRows), queue.map(op => op.rows));
});
await test('archive eligibility excludes other conflicts, configuration, sales and transient retries', async () => {
  const diagnostic = { code: 'product_version_conflict', policy: 'review_conflict', retryable: false };
  const queue = [pending(1, { status: 'blocked_conflict', diagnostic: { ...diagnostic, code: 'operation_mismatch' } }),
    pending(2, { type: 'config', status: 'blocked_conflict', diagnostic, lookup: [], settings: [] }),
    pending(3, { type: 'sale', folio: 'H155-FOREIGN-TYPE', status: 'blocked_conflict', diagnostic }),
    pending(4, { status: 'retry_wait', diagnostic: { code: 'fetch_failed', policy: 'auto_retry', retryable: true } }),
    pending(5, { status: 'blocked_permission', diagnostic: { code: '42501', policy: 'review_permissions', retryable: false } })];
  const x = await setup({ queue, controls: { manifestFailure: true } });
  // Keep the transient RPC unavailable while allowing the manifest to recover.
  x.control.manifestFailure = false; x.control.reject = false;
  x.e.setRpc(async name => name === 'get_sync_device_recovery' ? { data: null, error: null }
    : { data: null, error: { message: 'Failed to fetch' } });
  await x.S.synchronizeNow();
  assert.equal(x.S.pending, 5); assert.equal(originals(x).length, 0);
});
for (const controls of [{ archiveAck: false }, { failArchive: true, failIDB: true }, { comparisonFailure: true }]) await test('archive failure preserves blocked queue ' + JSON.stringify(controls), async () => {
  const x = await setup({ queue: [pending()], controls }); await x.S.reconcileDomains({ force: true });
  assert.equal(x.S.pending, 1); assert.equal(x.S.queueStatus().deviceBlocked, 1); assert.equal(stock(x), 99);
  const count = productCalls(x).length; await x.S.flushQueue(); assert.equal(productCalls(x).length, count);
});
await test('a lost archive receipt retries reporting, never the rejected product write', async () => {
  const x = await setup({ queue: [pending()], controls: { archiveAck: false } });
  assert.equal(x.S.pending, 1); assert.equal(originals(x).length, 1);
  const frozen = structuredClone(originals(x)[0].submittedRows);
  x.control.archiveAck = true; await x.tick();
  assert.equal(x.S.pending, 0); assert.equal(productCalls(x).length, 1);
  assert.deepEqual(originals(x)[0].submittedRows, frozen); assert.equal(x.S.syncStatus().synchronized, false);
});
await test('IndexedDB-only archive survives offline reload and an authorized rejected replay', async () => {
  const x = await setup({ queue: [pending()], controls: { failArchive: true } });
  await x.S.reconcileDomains({ force: true }); assert.equal(x.S.pending, 0); assert.equal(originals(x).length, 1);
  const y = await setup({ previous: x, controls: { failArchive: true, online: false, reviewRows: structuredClone(x.control.reviewRows) } });
  assert.deepEqual(originals(y)[0].rows, pending().rows); assert.equal(productCalls(y).length, 0);
  y.control.online = true; y.control.commands.push({ operation_id: pending().id, remote_epoch: 1 });
  await y.tick(); assert.equal(productCalls(y).length, 1); assert.equal(y.S.pending, 0);
  assert.equal(originals(y).length, 1); assert.equal(y.control.reviewRows[0].status, 'failed'); assert.equal(stock(y), 10);
});
await test('successful replay with missing completion receipt retains durable original', async () => {
  const x = await setup({ queue: [pending()] }); await x.S.reconcileDomains({ force: true });
  x.control.reject = false; x.control.completionAck = false;
  x.control.commands.push({ operation_id: pending().id, remote_epoch: 1 }); await x.tick();
  assert.equal(x.S.pending, 0); assert.equal(originals(x).length, 1); assert.equal(x.S.syncStatus().synchronized, false);
});
await test('pending review on reload never emits or reports synchronized', async () => {
  const x = await setup({ controls: { reviewRows: [{ operation_id: 'prior-original', status: 'pending_review' }] } });
  assert.equal(x.S.syncStatus().reviewPending, 1); assert.equal(x.S.syncStatus().synchronized, false);
  assert.equal(x.events.some(event => event.detail?.synchronized === true), false);
  assert.equal(x.e.rpcCalls.some(call => call.name === 'report_sync_device' && call.args.p_last_synced_at), false);
});
await test('failed review lookup cannot certify the projection', async () => {
  const x = await setup({ controls: { reviewFailure: true } });
  assert.equal(x.S.syncStatus().synchronized, false);
  assert.equal(x.e.rpcCalls.some(call => call.name === 'report_sync_device' && call.args.p_last_synced_at), false);
});
for (const failure of ['throw', 'null']) await test('managed auth lookup ' + failure + ' keeps archived review unknown and never clean', async () => {
  const x = await setup({ queue: [pending()] });
  await x.S.setSession(x.control.profile); await x.tick();
  assert.equal(x.S.pending, 0); assert.equal(x.S.syncStatus().reviewPending, 1);
  const original = structuredClone(originals(x)[0]);
  const sessionLookup = x.e.client.auth.getSession;
  x.e.client.auth.getSession = async () => {
    if (failure === 'throw') throw new Error('AUTH_LOOKUP_UNAVAILABLE');
    return { data: { session: null } };
  };
  const eventCount = x.events.length, rpcCount = x.e.rpcCalls.length;
  await x.tick();
  assert.equal(x.S.syncStatus().reviewPending, null);
  assert.equal(x.S.syncStatus().synchronized, false);
  assert.equal(x.control.reviewRows[0].status, 'pending_review');
  assert.deepEqual(originals(x)[0], original);
  assert.equal(x.events.slice(eventCount).some(event => event.detail?.synchronized === true), false);
  assert.equal(x.e.rpcCalls.slice(rpcCount).some(call => call.name === 'report_sync_device' && call.args.p_last_synced_at), false);
  x.e.client.auth.getSession = sessionLookup; await x.tick();
  assert.equal(x.S.syncStatus().reviewPending, 1); assert.equal(x.S.syncStatus().synchronized, false);
});
await test('explicit unmanaged legacy transport remains usable without an authenticated review owner', async () => {
  const x = await setup({ controls: { profile: null } }); await x.tick();
  assert.equal(x.S.syncStatus().reviewPending, 0); assert.equal(x.S.syncStatus().synchronized, true);
  assert.equal(stock(x), 10); assert.equal(x.S.pending, 0);
});

console.log(JSON.stringify({ scope: 'synthetic transport; no production writes', passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length }));
process.exitCode = results.some(result => !result.pass) ? 1 : 0;
