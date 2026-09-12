import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Read-only execution of actual client functions with synthetic in-memory inputs.
// No browser profile, credentials, Supabase endpoint, or business payload is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = name => fs.readFileSync(path.join(root, 'balam', name), 'utf8');
const core = source('core.jsx'), store = source('store.jsx');
const section = (start, end) => {
  const a = store.indexOf(start), b = store.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Source boundaries: ${start}`);
  return store.slice(a, b);
};
const now = Date.now();
const memoryStorage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), clear: () => data.clear() };
};
const loadCore = localStorage => {
  const context = vm.createContext({ window: {}, localStorage });
  vm.runInContext(core, context);
  return context.window.CORE;
};
const storage = memoryStorage(), firstCore = loadCore(storage);
const first = firstCore.getDeviceId();
assert.equal(firstCore.getDeviceId(), first);
assert.equal(loadCore(storage).getDeviceId(), first);
assert.notEqual(loadCore(memoryStorage()).getDeviceId(), first);
storage.clear();
assert.notEqual(loadCore(storage).getDeviceId(), first);
const unavailable = { getItem() { throw new Error('Storage unavailable'); } };
const volatileA = loadCore(unavailable), volatileB = loadCore(unavailable);
assert.equal(volatileA.getDeviceId(), volatileA.getDeviceId());
assert.notEqual(volatileA.getDeviceId(), volatileB.getDeviceId());

const manifest = { data_epoch: 10, sync_protocol_min: 3, sync_protocol_current: 3,
  schema_version: 20260830017500, domain_modes: { products: 'active' } };
const devices = Array.from({ length: 14 }, (_, i) => ({
  device_id: `synthetic-installation-${i}`, status: i < 3 ? 'online' : 'revoked',
  last_seen_at: new Date(i < 3 ? now : now - 86400000 * 100).toISOString(),
  last_synced_at: new Date(i < 3 ? now : now - 86400000 * 100).toISOString(),
  data_epoch: i < 3 ? 10 : 9, protocol_version: 3, schema_version: 20260830017500,
  cursors: { products: 1 }, queue_pending: i === 13 ? 1 : 0, queue_blocked: i === 13 ? 1 : 0,
}));
const history = [{ device_id: 'synthetic-installation-13', operation_id: 'synthetic-rejected',
  requires_action: true, admin_action: null }];
const query = data => ({ select() { return this; }, order() { return this; },
  limit() { return this; }, then(resolve) { resolve({ data, error: null }); } });
const fleetClient = { from(table) { return query(table === 'sync_devices' ? devices : table === 'sync_activity' ? history : []); } };
const fleetContext = vm.createContext({ ensureClient: async () => fleetClient, syncManifest: manifest,
  SYNC_SCHEMA_VERSION: 20260830017500, readRemoteVersions: async () => ({ ok: true, rows: [{ domain: 'products', version: 1 }] }),
  domainMode: domain => manifest.domain_modes[domain], Date });
vm.runInContext(section('  async function syncFleetStatus() {', '  async function decideSyncQuarantine('), fleetContext);
const fleet = await vm.runInContext('syncFleetStatus()', fleetContext);
assert.equal(fleet.devices.length, 14);
assert.equal(fleet.devices.filter(d => d.status !== 'revoked').length, 3);
assert.equal(fleet.devices.at(-1).connection, 'unknown');
assert.equal(fleet.devices.at(-1).queue_pending, 1);
assert.equal(fleet.devices.at(-1).queue_blocked, 1);
assert.equal(fleet.activity[0].requires_attention, true);

const events = [], reported = [];
const heartbeatClient = {
  from() { return { select() { return this; }, eq() { return this; },
    in: async () => ({ data: [], error: null }) }; },
  async rpc(name, payload) { assert.equal(name, 'report_sync_device'); reported.push(payload); return { data: false, error: null }; },
};
const queue = { devicePending: 0, deviceBlocked: 0, operations: [], durability: 'localStorage', otherSessionPending: 0 };
const heartbeatContext = vm.createContext({
  syncHeartbeatPromise: null, sessionSeq: 1, enabled: true, hasLocalWriter: () => true,
  syncManifest: manifest, syncReviewPending: 0, syncActivityUser: async () => ({ id: 'synthetic-user' }),
  reportStoredQuarantineArchives: async () => {}, consumeSyncCommands: async () => {},
  consumeSyncQuarantineDecisions: async () => {}, sessionManaged: true, queueStatus: () => queue,
  window: { CORE: { getDeviceId: () => 'synthetic-retired' }, dispatchEvent: event => events.push(event) },
  CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  SYNC_CLIENT_BUILD: '2026-09-11-h155', SYNC_PROTOCOL_VERSION: 3, SYNC_SCHEMA_VERSION: 20260830017500,
  syncCursors: { products: 1 }, syncCompatibility: 'ok', syncLastSuccess: null,
  recoveryPhase: 'ready', recoveryError: null, syncLastVersionCheck: now,
  navigator: { onLine: true }, syncPullErrors: new Map(), syncCheckpointError: null,
  syncRealtimeState: 'subscribed', syncInvalid: new Map(), syncReconcilePromise: null,
  syncRemoteVersions: [{ domain: 'products', version: 1 }],
  domainMode: domain => manifest.domain_modes[domain], syncFullDomains: new Set(), syncRecovering: false,
});
vm.runInContext(section('  function syncStatus() {', '  function recoverySnapshot() {'), heartbeatContext);
vm.runInContext(section('  function heartbeatDevice(c) {', '  async function consumeSyncCommands(c) {'), heartbeatContext);
assert.equal(vm.runInContext('syncStatus().synchronized', heartbeatContext), true);
await heartbeatContext.heartbeatDevice(heartbeatClient);
const afterHeartbeat = vm.runInContext('syncStatus()', heartbeatContext);
assert.equal(reported.length, 1);
assert.equal(afterHeartbeat.synchronized, true);
assert.ok(afterHeartbeat.lastSuccess);
assert.equal(events.at(-1).detail.synchronized, true);

const classificationContext = vm.createContext({ Date });
vm.runInContext(section('  function classifyFailure(error, details) {', '  let lastApplyFailure = null;'), classificationContext);
const retiredFailure = classificationContext.classifyFailure({ code: 'P0001',
  message: 'Este equipo fue retirado. Un administrador debe reactivarlo.', details: 'DEVICE_RETIRED' });
assert.equal(retiredFailure.category, 'unknown');
assert.equal(retiredFailure.policy, 'auto_retry');
assert.equal(retiredFailure.retryable, true);

const result = {
  checkedAt: new Date().toISOString(), mode: 'synthetic-in-memory-actual-functions',
  productionReads: 0, productionWrites: 0, userProfileReads: 0,
  limitations: 'These checks reproduce client mechanisms; they do not diagnose the current physical device or certify distributed convergence.',
  sourceSHA256: Object.fromEntries(['core.jsx', 'store.jsx', 'settings.jsx'].map(name => [name, createHash('sha256').update(source(name)).digest('hex')])),
  identity: { function: 'CORE.getDeviceId', sameStorageReloadStable: true,
    differentStorageCreatesDifferentInstallation: true, clearedStorageCreatesDifferentInstallation: true,
    unavailableStorageStableWithinPageOnly: true, hardwareIdentityExists: false },
  fleet: { function: 'STORE.syncFleetStatus', syntheticActive: 3, syntheticRetired: 11,
    returnedRegisteredCount: fleet.devices.length, retiredIncludedInDefaultList: true,
    staleRetiredCounts: { pending: fleet.devices.at(-1).queue_pending, blocked: fleet.devices.at(-1).queue_blocked },
    staleRetiredIncidentStillActionable: fleet.activity[0].requires_attention,
    expected: 'Distinguish operating devices, historical installations, and unverified stale counters.' },
  retiredHeartbeat: { functions: ['STORE.heartbeatDevice', 'STORE.syncStatus'],
    simulatedServerResponse: { data: false, error: null },
    actual: { synchronized: afterHeartbeat.synchronized, compatibility: afterHeartbeat.compatibility,
      lastSuccessRecorded: Boolean(afterHeartbeat.lastSuccess), emittedSynchronized: events.at(-1).detail.synchronized },
    expected: 'A rejected retired-device heartbeat must not produce a successful operational synchronization status.',
    serverContract: '20260910019800_pos_h154_device_retirement.sql:678 returns false for revoked; :585 rejects business writes with DEVICE_RETIRED.' },
  retiredWriteClassification: { function: 'STORE.classifyFailure', serverCode: 'P0001',
    serverDetail: 'DEVICE_RETIRED', actual: { category: retiredFailure.category,
      status: retiredFailure.status, policy: retiredFailure.policy, retryable: retiredFailure.retryable },
    expected: 'Administrative retirement is a non-transient device state requiring an explicit administrative recovery action.' },
  status: 'CLIENT DEFECT MECHANISMS REPRODUCED; NO FIX APPLIED; DISTRIBUTED CERTIFICATION NOT RUN',
};
fs.writeFileSync(path.join(root, '.evidence-h164', 'device-queue-reproduction.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
