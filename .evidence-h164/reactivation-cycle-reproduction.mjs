import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(dir, '../balam/store.jsx'), 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a); return source.slice(a, b);
};
// Actual recovery and pull functions; only transport/domain fixtures are synthetic.
// The SQL denial is the response already observed by the independent readonly diagnosis.
const operation = { id: 'synthetic-current-epoch-intent', ownerId: 'synthetic-user',
  type: 'upsert', kind: 'products', table: 'products', dataEpoch: 10,
  createdAt: '2026-09-12T03:00:00.000Z', rows: [{ id: 'synthetic-product' }], rowIds: ['synthetic-product'] };
const queue = [operation];
const manifest = { data_epoch: 10, sync_protocol_min: 3, sync_protocol_current: 3,
  schema_version: 20260830017500, domain_modes: { products: 'active' } };
const metrics = { writeAttempts: 0, archived: 0, productFetches: 0, checkpointWrites: 0 };
const client = { from(table) { assert.equal(table, 'system_manifest');
  return { select() { return this; }, eq: async () => ({ data: [manifest], error: null }) }; } };
let context;
context = vm.createContext({
  window: { CORE: { activityStatus: () => ({ active: 0 }), domainBusy: () => false }, dispatchEvent() {} },
  CustomEvent: class {}, loadQ: () => queue, opBelongsToActiveSession: () => true,
  syncRecovering: false, syncReconcilePromise: null, sessionSeq: 1,
  sessionManaged: true, sessionIdentity: 'synthetic-user', hasLocalWriter: () => true,
  waitForFlushIdle: async () => {}, ensureClient: async () => client,
  SYNC_PROTOCOL_VERSION: 3, SYNC_SCHEMA_VERSION: 20260830017500,
  localStorage: { getItem: () => '10', setItem() { metrics.checkpointWrites++; } },
  syncManifest: manifest, syncCompatibility: 'must_rebootstrap',
  syncCursors: { products: 0 }, syncInvalid: new Map([['products', 1]]),
  MAP: { products: { table: 'products', fromRow: row => row } },
  DOMAIN_TABLE: { products: 'products' }, DOMAIN_ORDER: ['products'],
  readRemoteVersions: async () => ({ ok: true, rows: [{ domain: 'products', version: 1 }] }),
  fetchAllRows: async () => { metrics.productFetches++; return { data: [], error: null }; },
  reportQuarantineCases: async () => { metrics.archived++; return []; },
  writeQuarantineArchive: async () => { metrics.archived++; },
  saveSyncCursors: () => { metrics.checkpointWrites++; return true; },
  flushQueue: async () => {
    metrics.writeAttempts++;
    const diagnostic = context.classifyFailure({ code: 'P0001',
      message: 'Este equipo debe actualizar su información antes de guardar.', details: 'REBOOTSTRAP_REQUIRED' });
    Object.assign(operation, { status: diagnostic.status, diagnostic });
  },
  reconcileDomains: async () => {}, syncStatus: () => ({ pending: queue.length }),
});
for (const [a, b] of [
  ['  function classifyFailure(error, details) {', '  let lastApplyFailure = null;'],
  ['  const PENDING_DOMAIN_EFFECTS = {', '  // ── H-33: contador diario de folios'],
  ['  function domainBlocked(domain) {', '  async function readRemoteVersions(c) {'],
  ['  async function pullDomain(kind, opts) {', '  function commitReferenceReclassification('],
  ['  function isArchivableProductRejection(op) {', '  async function archiveRejectedReferences(c) {'],
  ['  async function rebootstrapFromCloud(options = {}) {', '  let syncUpdatePromise = null;'],
]) vm.runInContext(section(a, b), context);
const failures = [];
for (let i = 0; i < 2; i++) {
  try { await context.rebootstrapFromCloud(); assert.fail('Recovery unexpectedly completed'); }
  catch (error) { assert.equal(error.message, 'REBOOTSTRAP_DOMAIN_INCOMPLETE:products');
    failures.push({ error: error.message, domain: error.domain, result: error.result }); }
}
assert.equal(queue.length, 1);
assert.equal(queue[0].status, 'quarantined');
assert.equal(context.isArchivableProductRejection(queue[0]), false);
assert.equal(metrics.archived, 0);
assert.equal(metrics.productFetches, 0);
assert.equal(metrics.checkpointWrites, 0);
const result = {
  at: new Date().toISOString(), mode: 'actual-client-functions-synthetic-current-epoch-intent',
  networkReads: 0, networkWrites: 0, sourceSHA256: createHash('sha256').update(source).digest('hex'),
  sourceFunctions: ['rebootstrapFromCloud', 'pullDomain', 'domainBlocked', 'operationAffectsDomain', 'hasPendingFor', 'classifyFailure', 'isArchivableProductRejection'],
  attempts: failures, metrics, remainingIntent: { count: queue.length, epoch: queue[0].dataEpoch,
    status: queue[0].status, policy: queue[0].diagnostic.policy, autoArchivable: false },
  conclusion: 'Retrying recovery does not break the pending-write / reactivation-proof cycle.',
  limitations: 'SQL denial is a transport fixture grounded in observed server diagnostics; one products domain isolates the blocking subgraph. This does not inspect local payload, prove the actual intent creation date or certify a repair.',
};
fs.writeFileSync(path.join(dir, 'reactivation-cycle-reproduction.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
