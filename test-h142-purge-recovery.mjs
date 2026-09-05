// H142/S12 independent QA. Synthetic transport, real STORE and extracted DATA
// resetTestData body. No network, private captures, production rows or writes.
// Reset dependencies model empty stock deltas; stock rollback math is outside
// this suite. It checks ordering, durable quarantine and domain reconciliation.
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const sourceRef = process.env.BALAM_QA_SOURCE_REF;
const source = file => sourceRef ? execFileSync('git', ['show', `${sourceRef}:${file}`], { encoding: 'utf8' }) : read(file);
const harness = read('test-store-queue.mjs');
const freshEnv = new Function(harness.slice(harness.indexOf('function freshEnv()'), harness.indexOf('\nconst SRC =')) + '\nreturn freshEnv;')();
const dataSource = source('balam/data.jsx');
const resetBody = dataSource.slice(dataSource.indexOf('  function resetTestData(opts)'), dataSource.indexOf('\n  function seedDemo()', dataSource.indexOf('  function resetTestData(opts)')));
const domains = ['permissions','purges','config','sellers','products','clients','promotions','sales','payments','returns','exchanges','loans','liquidations','commissionAdjustments','movements','devices'];
let passed = 0, failed = 0;
const check = (name, condition, detail = {}) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); condition ? passed++ : failed++; };
const queue = env => JSON.parse(env.localStorage.getItem('balam_sync_queue') || '[]');
async function setup({ mark = false, purge = true, pending = false } = {}) {
  const env = freshEnv(), events = [], keys = new Set();
  const set = env.localStorage.setItem;
  env.localStorage.setItem = (key, value) => { keys.add(key); set(key, value); };
  env.window.crypto = webcrypto;
  env.window.AUTH = { current: () => null, role: () => 'admin', refreshPermissions: async () => {} };
  env.client.auth.getSession = async () => ({ data: { session: { user: { id: 'qa-user' } } } });
  env.localStorage.setItem('balam_sync_data_epoch', '1');
  if (mark) env.localStorage.setItem('balam_purge_seen', 'historical-purge');
  const tables = env.cloud.rowsByTable;
  tables.system_manifest = [{ singleton: true, schema_version: 20260830017500, sync_protocol_min: 3, sync_protocol_current: 3, data_epoch: 2, domain_modes: Object.fromEntries(domains.map(d => [d, 'active'])) }];
  tables.sync_domain_versions = domains.map(domain => ({ domain, version: 1 }));
  tables.products = [{ id: 'product-current', nombre: 'Synthetic', stock_quantity: 7, sync_version: 2 }];
  tables.sales = ['REAL-ONE','REAL-TWO'].map(folio => ({ folio, fecha: new Date().toISOString(), estado: 'Pagado', total: 10 }));
  for (const kind of ['products','clients','returns','exchanges','liquidations','payments','loans','promos']) env.window.DATA[kind] = [];
  const DATA = env.window.DATA;
  const apply = DATA.applyRemote;
  DATA.applyRemote = function(kind, rows, opts) {
    events.push({ kind, rows: rows.map(r => r.folio || r.id) });
    const applied = apply.call(this, kind, rows, opts);
    if (kind !== 'sales' && Array.isArray(this[kind])) this[kind].splice(0, this[kind].length, ...structuredClone(rows));
    return applied;
  };
  const reset = new Function('DATA', 'localStorage', `
    const { sales, returns, exchanges, liquidations, payments, loans, clients, sellers, movements, products, promos } = DATA;
    const seedClients = [], readLayawayProductLocks = () => [], testDataFootprint = () => ({ identidadAmbigua: [], ventas: sales.length, piezas: 7, configHuella: 'same' });
    const snapshotLocalDomain = () => ({}), restoreLocalDomain = () => {}, purgeStockDeltas = () => [], stockEntryByIdentity = () => null;
    const isPurgeMove = () => true, persistAllLocal = () => {}, totalPieces = () => 7, configFingerprint = () => 'same', syncUp = () => {};
    const LS_FOLIO='qa-folio', LS_FOLIO_V2='qa-folio-v2', LS_PERIODO='qa-period', LS_SALE_COMMIT_JOURNAL_LEGACY='qa-journal', LS_SALE_COMMIT_JOURNAL_PREFIX='qa-journal-';
    let remoteApplying = false, periodoInicio = '', pendingSaleCommitJournal = null;
    ${resetBody}
    return resetTestData;`)(DATA, env.localStorage);
  DATA.resetTestData = options => {
    events.push({ kind: 'reset', pending: queue(env).map(op => op.id), archives: [...keys].filter(k => k.startsWith('balam_sync_quarantine_')).map(k => JSON.parse(env.localStorage.getItem(k))) });
    return reset(options);
  };
  env.setRpc(async name => ({ data: name === 'test_data_purge_state' && purge ? { epoch: 'historical-purge', purged_at: '2020-01-01T00:00:00Z' } : [], error: null }));
  if (pending) env.localStorage.setItem('balam_sync_queue', JSON.stringify([{ id: 'old-local-operation', type: 'sale', folio: 'LOCAL-OLD', ownerId: null, createdAt: '2019-01-01T00:00:00Z', status: 'pending', header: { folio: 'LOCAL-OLD' }, items: [] }]));
  const S = new Function('window','localStorage','document','CustomEvent','setInterval','clearInterval','navigator', source('balam/core.jsx') + '\n' + source('balam/store.jsx') + '\nreturn window.STORE;')(
    env.window, env.localStorage, { hidden: false, createElement: () => ({}), head: { appendChild() {} } }, class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } }, () => 1, () => {}, { onLine: true });
  await S.init({});
  return { env, S, events };
}
for (const scenario of [{ name: 'no remote purge', purge: false }, { name: 'historical mark present', mark: true }, { name: 'historical mark absent', pending: true }]) {
  const { env, S, events } = await setup(scenario);
  const status = await S.rebootstrapFromCloud();
  check(`${scenario.name}: recovered current sales survive`, env.window.DATA.sales.length === 2 && status.synchronized, { sales: env.window.DATA.sales.map(s => s.folio), synchronized: status.synchronized });
  const resets = events.filter(e => e.kind === 'reset');
  check(`${scenario.name}: reset applied exactly when required`, resets.length === (scenario.pending ? 1 : 0), { resets: resets.length });
  if (scenario.pending) {
    check('quarantine is durable and active queue empty before reset', resets[0]?.pending.length === 0 && resets[0]?.archives.some(a => a.operations.some(op => op.id === 'old-local-operation')));
    check('purge precedes all business snapshots', events.findIndex(e => e.kind === 'reset') < events.findIndex(e => e.kind === 'sales'));
  }
}
// A purge cursor can be the only invalidated cursor (for example, a late event
// after the sales cursor already caught up). Reset must not invalidate local
// snapshots while leaving their confirmed cursors untouched.
{
  const { env, S, events } = await setup({ mark: true });
  await S.rebootstrapFromCloud();
  env.localStorage.removeItem('balam_purge_seen');
  env.cloud.rowsByTable.sync_domain_versions.find(r => r.domain === 'purges').version = 2;
  events.length = 0;
  const result = await S.reconcileDomains();
  check('incremental purge-only invalidation preserves current sales', env.window.DATA.sales.length === 2, { sales: env.window.DATA.sales.map(s => s.folio), result, status: S.syncStatus() });
  check('incremental purge reloads erased sales snapshot', events.some(e => e.kind === 'reset') && events.some(e => e.kind === 'sales'));
}
{
  const { env, S } = await setup({ mark: true });
  await S.rebootstrapFromCloud();
  env.localStorage.removeItem('balam_purge_seen');
  env.cloud.rowsByTable.sync_domain_versions.find(r => r.domain === 'purges').version = 2;
  env.setError('sales', { message: 'synthetic download failure' });
  await S.reconcileDomains();
  const failedStatus = S.syncStatus();
  check('failed post-purge download remains visibly unsynchronized', !failedStatus.synchronized && failedStatus.invalidDomains.some(d => (d.domain || d) === 'sales'), failedStatus);
  const cursorSnapshot = JSON.parse(env.localStorage.getItem('balam_sync_domain_cursors_v1') || '{}');
  check('failed sales cursor is not retained as confirmed', !failedStatus.cursors.sales && !cursorSnapshot.sales && cursorSnapshot.purges === 2, { cursors: failedStatus.cursors, persisted: cursorSnapshot });
  env.clearError('sales');
  await S.reconcileDomains();
  check('next reconciliation restores sales and clean status', env.window.DATA.sales.length === 2 && S.syncStatus().synchronized);
}
{
  const { env, S } = await setup({ mark: true });
  env.cloud.rowsByTable.sales.push({ folio: 'REAL-HISTORICAL', fecha: '2021-01-01T00:00:00Z', estado: 'Pagado', total: 10 });
  // The shared harness records filters without applying them. This focused
  // transport seam implements date/state filters so a window cannot masquerade
  // as a complete historical snapshot.
  const from = env.client.from;
  env.client.from = table => table !== 'sales' ? from(table) : { select() {
    const filters = []; let bounds;
    const query = {
      gte(key, value) { filters.push(row => row[key] >= value); return query; },
      eq(key, value) { filters.push(row => row[key] === value); return query; },
      order() { return query; }, range(start, end) { bounds = [start, end]; return query; },
      then(resolve, reject) {
        let rows = env.cloud.rowsByTable.sales.filter(row => filters.every(fn => fn(row)));
        if (bounds) rows = rows.slice(bounds[0], bounds[1] + 1);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    }; return query;
  } };
  await S.rebootstrapFromCloud();
  check('full recovery includes remote sales outside normal window', env.window.DATA.sales.length === 3);
  env.localStorage.removeItem('balam_purge_seen');
  env.cloud.rowsByTable.sync_domain_versions.find(r => r.domain === 'purges').version = 2;
  await S.reconcileDomains();
  check('incremental purge preserves remote historical sales', env.window.DATA.sales.some(s => s.folio === 'REAL-HISTORICAL'), { sales: env.window.DATA.sales.map(s => s.folio), synchronized: S.syncStatus().synchronized });
}
console.log(`H142 purge recovery: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
