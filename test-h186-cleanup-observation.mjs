// Cleanup-only recovery of one owned device. Actual reconciler, canonical
// PostgreSQL snapshots and planner; no network, business RPC or remote mutation.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { durableJson } from './h171-live-authority-io.mjs';
import { createLiveCleanupPlanFixture } from './test-h171-live-cleanup-plan.mjs';
import { createLiveReconciler } from './h171-live-reconciliation.mjs';
import { createLiveCleanupLifecycle } from './h171-live-cleanup-lifecycle.mjs';
import { journalHash } from './h171-live-journal.mjs';
import { SNAPSHOT_PROJECT, SNAPSHOT_ACTOR } from './h171-live-snapshot.mjs';

const f = await createLiveCleanupPlanFixture({ keepJournalOpen: true, sourceUrl: `https://${SNAPSHOT_PROJECT}.supabase.co/`,
  beforeBaseline: ({ db }) => db.exec("SET TimeZone='UTC';SET DateStyle='ISO, MDY';") });
let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}
try {
  const input = f.input(), deviceId = f.fixtures.installations[0];
  await f.journal.prepare({ kind: 'rpc:online_presence', actorId: f.actorId,
    requestId: randomUUID(), identities: { deviceId }, checkpoint: 'recovery fixture',
    command: { p_device_id: deviceId, p_client_build: '2026-09-12-h166-online' } });
  await f.journal.prepare({ kind: 'rpc:online_adoption_report', actorId: f.actorId,
    requestId: randomUUID(), identities: { deviceId }, checkpoint: 'recovery fixture',
    command: { p_device_id: deviceId, p_report: { revision: 1, state: 'working', stage: 'presence', remainingLegacy: 0, archivedCount: 0 } } });
  input.journalSnapshot = f.journal.snapshot();
  const last = input.journalSnapshot.entries.at(-1), epoch = Date.parse(last.preparedAt);
  const adoption = { revision: 1, state: 'ready', stage: 'complete', remainingLegacy: 0, archivedCount: 0,
    snapshotAt: new Date(epoch + 1).toISOString(), serverTime: new Date(epoch + 2).toISOString() };
  await f.change(input, 'sync_devices', { device_id: deviceId }, { status: 'online', metadata: { online_only: true, online_adoption: adoption } });
  const row = f.find(input.currentSnapshot, 'sync_devices', { device_id: deviceId });
  const observation = { format: 'balam-cleanup-device-observation-v1', projectRef: SNAPSHOT_PROJECT,
    run: f.run, actorId: f.actorId, artifactSha256: input.journalSnapshot.artifactSha256,
    journalSha256: journalHash(input.journalSnapshot), baselineFileSha256: input.backup.baselineFileSha256,
    deviceId, observedAtUtc: new Date(epoch + 3).toISOString(),
    deviceRowJsonText: row.restorable_row_json_text || row.row_json_text, deviceFullRowMd5: row.full_row_md5,
    adoptionFunctionSha256: 'c056734ed233905ea5a74c2d03914eac74576412d7434b686129fc1864f7f2a8',
    mismatchSequences: [last.sequence] };
  const originalBaseline = { snapshot: input.baselineSnapshot, fileSha256: input.backup.baselineFileSha256 };
  const reconcile = (value = input, proof = observation, baseline = originalBaseline) => {
    const clients = f.readClients(value);
    return createLiveReconciler({ ...clients, expectedProjectRef: SNAPSHOT_PROJECT, expectedActorId: f.actorId,
      protectedAuthIds: [SNAPSHOT_ACTOR] }).reconcile({ snapshot: value.journalSnapshot, fixtures: value.fixtures,
        ...(proof ? { recoveryDeviceObservation: proof, originalBaseline: baseline } : {}) });
  };
  let recovered;
  await test('Default reconciliation retains the unmatched telemetry blocker', async () => {
    const report = await reconcile(input, null);
    assert.equal(report.reconciled, false); assert.deepEqual(report.blockers, [{ code: 'DEVICE_ADOPTION_MISMATCH', sequence: last.sequence }]);
  });
  await test('Explicit observation reconciles only cleanup and preserves the original mismatch without ACK', async () => {
    const before = journalHash(input.journalSnapshot); recovered = await reconcile();
    assert.equal(recovered.reconciled, true); assert.equal(recovered.certified, false);
    assert.equal(recovered.certificationEligible, false); assert.equal(recovered.cleanupRecovery.reportUnattributed, true);
    assert.equal(recovered.cleanupRecovery.acknowledgementClaimed, false);
    assert.deepEqual(recovered.cleanupRecovery.originalBlockers, [{ code: 'DEVICE_ADOPTION_MISMATCH', sequence: last.sequence }]);
    assert.equal(recovered.entries.at(-1).originalBlocker, 'DEVICE_ADOPTION_MISMATCH');
    assert.equal(recovered.entries.at(-1).acknowledgementClaimed, false);
    assert.equal(journalHash(input.journalSnapshot), before);
  });
  await test('Canonical64-table plan accepts the exact new device and binds the recovery proof', async () => {
    const plan = f.plan({ ...input, reconciliation: recovered });
    assert.equal(plan.readyForReview, true); assert.equal(plan.certified, false);
    assert.equal(plan.certificationEligible, false);
    assert.equal(plan.cleanupRecovery.observationSha256, journalHash(observation));
    assert.ok(plan.targets.some(t => t.table === 'sync_devices' && JSON.parse(t.pk_json_text).device_id === deviceId));
  });
  for (const [name, mutate] of [
    ['foreign device', x => { x.deviceId = 'foreign'; }],
    ['foreign actor', x => { x.actorId = randomUUID(); }],
    ['different journal', x => { x.journalSha256 = '0'.repeat(64); }],
    ['different original baseline', x => { x.baselineFileSha256 = '0'.repeat(64); }],
    ['unreviewed function', x => { x.adoptionFunctionSha256 = '0'.repeat(64); }],
    ['unknown proof field', x => { x.allowUnknown = true; }],
    ['wrong mismatch sequence', x => { x.mismatchSequences = [1]; }],
    ['observation before server report', x => { x.observedAtUtc = new Date(epoch).toISOString(); }],
    ['changed full row', x => { const body = JSON.parse(x.deviceRowJsonText); body.status = 'revoked';
      x.deviceRowJsonText = JSON.stringify(body); x.deviceFullRowMd5 = createHash('md5').update(x.deviceRowJsonText).digest('hex'); }],
    ['unknown telemetry field', x => { const body = JSON.parse(x.deviceRowJsonText); body.metadata.online_adoption.unreviewed = true;
      x.deviceRowJsonText = JSON.stringify(body); x.deviceFullRowMd5 = createHash('md5').update(x.deviceRowJsonText).digest('hex'); }],
  ]) await test('Rejects ' + name, async () => {
    const changed = structuredClone(observation); mutate(changed);
    const report = await reconcile(input, changed); assert.equal(report.reconciled, false);
    assert.ok(report.blockers.length > 0); assert.equal(report.cleanupRecovery, undefined);
  });
  await test('A device present in the original baseline is never eligible', async () => {
    const baseline = structuredClone(originalBaseline);
    const table = baseline.snapshot.tables.find(t => t.table === 'sync_devices');
    table.rows.push(structuredClone(row)); table.row_count++;
    const report = await reconcile(input, observation, baseline); assert.equal(report.reconciled, false);
  });
  await test('An actor present in the original baseline is never eligible', async () => {
    const baseline = structuredClone(originalBaseline); baseline.snapshot.auth_user_ids.push(f.actorId);
    assert.equal((await reconcile(input, observation, baseline)).reconciled, false);
  });
  await test('Telemetry preceding the original baseline is ineligible', async () => {
    const baseline = structuredClone(originalBaseline); baseline.snapshot.at = new Date(epoch + 3).toISOString();
    assert.equal((await reconcile(input, observation, baseline)).reconciled, false);
  });
  await test('Original mismatch evidence cannot be altered after reconciliation', () => {
    const changed = structuredClone(recovered); changed.originalReconciliation.blockers = [];
    assert.throws(() => f.plan({ ...input, reconciliation: changed }), /PLAN_RECOVERY/);
  });
  await test('Removing the recovery proof cannot turn observed telemetry into ordinary reconciliation', () => {
    const changed = structuredClone(recovered); delete changed.cleanupRecovery;
    assert.throws(() => f.plan({ ...input, reconciliation: changed }), /PLAN_RECOVERY_PROOF_REQUIRED/);
  });
  await test('A nonterminal commercial request cannot be excused by a telemetry observation', async () => {
    const changed = structuredClone(input), receipt = changed.currentSnapshot.tables.find(t => t.table === 'online_requests').rows[0];
    await f.change(changed, 'online_requests', JSON.parse(receipt.pk_json_text), { state: 'executing' });
    const report = await reconcile(changed); assert.equal(report.reconciled, false);
    assert.ok(report.blockers.some(x => x.code === 'REQUEST_NOT_TERMINAL'));
  });
  await test('Changed canonical device after observation is blocked before a cleanup plan', async () => {
    const changed = structuredClone(input);
    await f.change(changed, 'sync_devices', { device_id: deviceId }, { queue_pending: 7 });
    assert.throws(() => f.plan({ ...changed, reconciliation: recovered }), /RECOVERY.*ROW|ROW.*RECOVERY/);
  });
  await test('An unexplained mutation outside the device remains a64-table diff blocker', async () => {
    const changed = structuredClone(input); await f.change(changed, 'products', { id: 'real-product' }, { stock_quantity: 36 });
    const report = await reconcile(changed), plan = f.plan({ ...changed, reconciliation: report });
    assert.equal(plan.readyForReview, false); assert.ok(plan.blockers.some(x => x.table === 'products'));
  });
  await test('Lifecycle rejects recovery options without an original baseline before I/O', async () => {
    let calls = 0;
    await assert.rejects(createLiveCleanupLifecycle({ recoveryDeviceObservation: observation,
      io: { capture() { calls++; throw Error('UNEXPECTED_CAPTURE'); } } }), /RECOVERY.*ORIGINAL_BASELINE/);
    assert.equal(calls, 0);
  });
  await test('Real lifecycle review approval binds the exact observation and cannot execute a changed proof', async () => {
    const privateRoot = resolve('.evidence-h171-private');
    await fs.mkdir(privateRoot, { recursive: true });
    const directory = await fs.mkdtemp(join(privateRoot, 'cleanup-observation-test-'));
    try {
      const baseline = await durableJson(join(directory, 'original-baseline.json'), input.baselineSnapshot);
      const auth = await durableJson(join(directory, 'original-auth.json'), input.authBaseline);
      const original = { baselineFile: baseline.file, baselineSha256: baseline.sha256,
        authBaselineFile: auth.file, authBaselineSha256: auth.sha256 };
      const proof = { ...observation, baselineFileSha256: baseline.sha256 };
      let writes = 0;
      const runReview = async (proofValue, options = { execute: false }) => {
        const output = join(directory, randomUUID()); await fs.mkdir(output);
        const clients = f.readClients(input);
        const lifecycle = await createLiveCleanupLifecycle({ ...clients, journal: f.journal, fixtures: input.fixtures,
          artifactSha256: input.journalSnapshot.artifactSha256, clientBuild: '2026-09-12-h166-online',
          originalBaseline: original, recoveryDeviceObservation: proofValue,
          io: { catalog: input.catalog, sourceUrl: input.sourceUrl, directory: output,
            async capture() { return { snapshot: input.currentSnapshot, evidence: { sha256: input.backup.currentFileSha256 } }; },
            async query() { writes++; throw Error('UNEXPECTED_MUTATION'); } },
          readAuthPreflight() { throw Error('UNEXPECTED_AUTH_MUTATION'); } });
        return lifecycle.finalize(options);
      };
      const first = await runReview(proof);
      const changed = { ...proof, observedAtUtc: new Date(epoch + 4).toISOString() };
      const second = await runReview(changed);
      assert.equal(first.certificationEligible, false); assert.equal(first.recoveredUnattributedTelemetry, true);
      assert.equal(first.binding.cleanupRecovery.observationSha256, journalHash(proof));
      assert.notEqual(first.reviewSha256, second.reviewSha256);
      await assert.rejects(runReview(changed, { execute: true, approvedReviewSha256: first.reviewSha256 }), /RECOVERY_REVIEW_CHANGED/);
      assert.equal(writes, 0); assert.equal(journalHash(f.journal.snapshot()), journalHash(input.journalSnapshot));
    } finally {
      assert.ok(resolve(directory).startsWith(resolve('.evidence-h171-private') + sep));
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
} finally { await f.close(); }
console.log(JSON.stringify({ suite: 'H186 cleanup-only device observation', passed, failed, networkRequests: 0, remoteWrites: 0 }));
process.exitCode = failed ? 1 : 0;
