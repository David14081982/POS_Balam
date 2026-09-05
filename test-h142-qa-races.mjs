// Independent H-142 QA: current STORE and DATA confirmation function, fake
// transport only. No browser/server, live credentials, or business data writes.
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { webcrypto } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Optional read-only baseline: BALAM_QA_SOURCE_REF=HEAD runs the same cases
// against committed business source without checking out or editing any file.
const sourceRef = process.env.BALAM_QA_SOURCE_REF;
function readSource(file, encoding) {
  const normalized = String(file).replaceAll('\\', '/');
  const sourcePath = normalized.match(/(?:^|\/)(balam\/(?:core|store|data)\.jsx)$/)?.[1];
  if (sourceRef && sourcePath) return execFileSync('git', ['show', `${sourceRef}:${sourcePath}`], { encoding: 'utf8' });
  return readFileSync(file, encoding);
}

const harness = readFileSync('test-h142-sync-convergence.mjs', 'utf8');
const prefix = harness.slice(harness.indexOf('const root='), harness.indexOf('// Real STORE'));
const { setup, wait, until, product } = new Function('readFileSync', 'join', 'tmpdir', 'mkdirSync',
  prefix + '\nreturn {setup,wait,until,product};')(readSource, join, tmpdir, mkdirSync);
let passed = 0, failed = 0;
function check(name, condition, evidence) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(evidence)}`);
  condition ? passed++ : failed++;
}
function queue(env) { return JSON.parse(env.localStorage.getItem('balam_sync_queue') || '[]'); }
function deferred() { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; }
async function ready() {
  const ctx = setup({ live: true });
  ctx.env.window.crypto = webcrypto;
  ctx.env.window.AUTH.refreshPermissions = async () => {};
  await ctx.S.init({});
  await wait(80);
  return ctx;
}
async function finish(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('QA_RACE_TIMEOUT')), 5000);
  })]); } finally { clearTimeout(timer); }
}

// A protocol change is an independent fence, even when data_epoch is unchanged.
{
  const { env, S } = await ready();
  env.cloud.rowsByTable.system_manifest[0] = {
    ...env.cloud.rowsByTable.system_manifest[0], sync_protocol_min: 4, sync_protocol_current: 4,
  };
  await S.reconcileDomains();
  const status = S.syncStatus();
  check('QA1 same-epoch protocol upgrade fences current client',
    status.compatibility === 'client_outdated' && !status.synchronized, status);
}

// Recovery must not archive or replace a write whose RPC is still running.
{
  const { env, S } = await ready();
  const gate = deferred(); let entered = false, quarantines = 0;
  env.setRpc(async (name, args) => {
    if (name === 'report_sync_quarantine') quarantines++;
    if (name === 'save_products_checked_v2') {
      entered = true; await gate.promise;
      const rows = args.p_rows.map(row => ({ ...row, sync_version: Number(row.sync_base_version) + 1 }));
      env.cloud.rowsByTable.products.push(...rows);
      env.cloud.rowsByTable.sync_domain_versions = [{ domain: 'products', version: 2 }];
      return { data: rows, error: null };
    }
    return { data: [], error: null };
  });
  const p = product('qa-inflight'); env.window.DATA.products.push(p);
  S.pushRows('products', [p]); await until(() => entered);
  const recovery = S.rebootstrapFromCloud().then(value => ({ value }), error => ({ error: error.message }));
  await wait(160);
  const overlapping = await S.rebootstrapFromCloud().then(() => 'unexpected', error => error.message);
  const beforeRelease = {
    quarantines, pending: queue(env).map(op => op.rowIds),
    localIds: env.window.DATA.products.map(row => row.id),
  };
  gate.release(); const completed = await finish(recovery);
  check('QA2 recovery waits for an in-flight RPC before replacing state',
    beforeRelease.quarantines === 0
      && beforeRelease.pending.some(ids => ids?.includes(p.id))
      && beforeRelease.localIds.includes(p.id) && !completed.error
      && overlapping === 'RECOVERY_IN_PROGRESS',
    { beforeRelease, completed, overlapping });
}

// A capture made while quarantine telemetry awaits must stay in durable queue.
{
  const { env, S } = await ready();
  const old = product('qa-old'); env.window.DATA.products.push(old);
  env.localStorage.setItem('balam_sync_queue', JSON.stringify([{
    id: '14200000-0000-4000-8000-000000000071', ownerId: null,
    type: 'upsert', kind: 'products', table: 'products', rowIds: [old.id],
    rows: [{ id: old.id, nombre: old.nombre }], status: 'blocked_conflict',
  }]));
  const gate = deferred(); let entered = false;
  env.setRpc(async name => {
    if (name === 'report_sync_quarantine') { entered = true; await gate.promise; }
    if (name === 'save_products_checked_v2') return { data: null, error: { message: 'Failed to fetch' } };
    return { data: [], error: null };
  });
  const recovery = S.rebootstrapFromCloud().then(value => ({ value }), error => ({ error: error.message }));
  await until(() => entered);
  const fresh = product('qa-captured-during-quarantine'); env.window.DATA.products.push(fresh);
  await S.pushRows('products', [fresh]);
  gate.release(); const completed = await finish(recovery); await wait(50);
  const durable = queue(env);
  check('QA3 capture during quarantine reporting remains durable',
    durable.some(op => op.rowIds?.includes(fresh.id) && op.rows?.some(row => row.id === fresh.id))
      && env.window.DATA.products.some(row => row.id === fresh.id),
    { durable, completed, localIds: env.window.DATA.products.map(row => row.id) });
}

// Exercise DATA's actual confirmation function. Its persistence helpers are
// no-op seams; its conflict replacement and STORE's queue/replay are unmodified.
function installConfirmation(env) {
  const src = readSource('balam/data.jsx', 'utf8');
  const start = src.indexOf('  function applySyncResult(');
  const end = src.indexOf('  // H-65: aplica como una sola unidad', start);
  if (start < 0 || end < 0) throw Error('DATA_CONFIRMATION_SEAM_NOT_FOUND');
  const noop = () => {};
  env.window.DATA.applySyncResult = new Function(
    'products', 'clients', 'sellers', 'promos', 'saveProducts', 'saveClients',
    'saveSellers', 'savePromos', 'hydrate', 'requireCatalogResync',
    'let remoteApplying=false;\n' + src.slice(start, end) + '\nreturn applySyncResult;',
  )(env.window.DATA.products, [], [], [], noop, noop, noop, noop, row => row, noop);
}
{
  const { env, S } = await ready();
  installConfirmation(env);
  const gate = deferred(); let entered = false; const sends = [];
  env.setRpc(async (name, args) => {
    if (name === 'save_products_checked_v2') {
      sends.push(structuredClone(args.p_rows));
      if (sends.length === 1) {
        entered = true; await gate.promise;
        const rows = args.p_rows.map(row => ({ ...row, nombre: 'OTHER TERMINAL', sync_version: 2 }));
        env.cloud.rowsByTable.products = rows;
        return { data: rows, error: null };
      }
      return { data: args.p_rows.map(row => ({ ...row, sync_version: Number(row.sync_base_version) + 1 })), error: null };
    }
    return { data: [], error: null };
  });
  const p = { ...product('qa-two-edits'), _syncVersion: 1, nombre: 'FIRST EDIT' };
  env.window.DATA.products.push(p); S.pushRows('products', [p]); await until(() => entered);
  p.nombre = 'SECOND LOCAL EDIT'; await S.pushRows('products', [p]);
  gate.release(); await wait(200);
  const durable = queue(env);
  const retained = durable.find(op => op.rowIds?.includes(p.id)
    && op.rows?.some(row => row.nombre === 'SECOND LOCAL EDIT'));
  check('QA4 newer overlapping intent survives a rejected earlier write',
    sends.length === 1 && !!retained && retained.status === 'blocked_conflict',
    { sends, durable, local: env.window.DATA.products.find(row => row.id === p.id) });
}

// An uncertain response and a later edit need separate idempotency keys.
{
  const { env, S } = await ready(); installConfirmation(env);
  const sends = [], commits = new Map();
  env.setRpc(async (name, args) => {
    if (name !== 'save_products_checked_v2') return { data: [], error: null };
    sends.push(structuredClone(args));
    const previous = commits.get(args.p_operation_id);
    if (previous) return { data: previous, error: null };
    const rows = args.p_rows.map(row => ({ ...row, sync_version: Number(row.sync_base_version) + 1 }));
    commits.set(args.p_operation_id, rows);
    if (sends.length === 1) return { data: null, error: { message: 'Failed to fetch' } };
    return { data: rows, error: null };
  });
  const p = { ...product('qa-lost-ack'), _syncVersion: 1, nombre: 'FIRST EDIT' };
  env.window.DATA.products.push(p); await S.pushRows('products', [p]);
  await until(() => queue(env).some(op => op.status === 'retry_wait'));
  p.nombre = 'SECOND EDIT'; await S.pushRows('products', [p]);
  await until(() => queue(env).length === 0);
  check('QA5 lost acknowledgement replays original payload before later edit',
    sends.length === 3 && sends[0].p_operation_id === sends[1].p_operation_id
      && JSON.stringify(sends[0].p_rows) === JSON.stringify(sends[1].p_rows)
      && sends[2].p_operation_id !== sends[0].p_operation_id
      && sends[2].p_rows[0].sync_base_version === 2
      && p.nombre === 'SECOND EDIT' && p._syncVersion === 3,
    { sends, local: p });
}

console.log(`H142 independent QA (${sourceRef || 'working source'}): ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
