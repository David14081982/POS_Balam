// Local injected API only; real durable journal files. No credentials or remote network.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import * as fs from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { openLiveJournal, journalHash } from './h171-live-journal.mjs';
import { AUTH_INCOMING_FKS } from './h171-auth-retirement.mjs';
import { recordedSnapshotCatalog } from './h171-live-snapshot.mjs';
import { LIVE_AUTH_CLEANUP as C, buildLiveAuthIdentityEvidence, createLiveCleanupAuth } from './h171-live-cleanup-auth.mjs';

const read = async file => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const catalog = recordedSnapshotCatalog({ authorityAudit: await read('docs/fixes/evidence/h171/authority-audit-before.json'),
  cleanupCatalog: await read('docs/fixes/evidence/h171/cleanup-catalog-before.json') });
const time = Date.parse('2026-09-14T10:00:00.000Z'), sha = x => journalHash(x), md5 = x => createHash('md5').update(x).digest('hex');
const scratchRoot = resolve('.evidence-h171-private');
await fs.mkdir(scratchRoot, { recursive: true });
const scratch = await fs.mkdtemp(join(scratchRoot, 'new-auth-test-')), checks = [];
const checked = (name, fn) => test(name, async () => { await fn(); checks.push({ name, status: 'PASS' }); });
function advanceRevision(state, delta = 7) {
  const r = state.preflight.snapshot_revision;
  r.value = String(BigInt(r.value) + BigInt(delta)); r.full_row_md5 = md5('local revision:' + r.value);
  state.preflight.pos_fingerprints.find(t => t.table === 'online_snapshot_revision').full_rows_md5 = md5(r.full_row_md5);
}

async function fixture(options = {}) {
  const run = randomUUID(), actorId = randomUUID(), accountId = randomUUID(), artifactSha256 = sha('local final candidate');
  const file = join(scratch, run + '.json'), journalOptions = { file, run, projectRef: C.projectRef, artifactSha256,
    ...(options.io ? { io: options.io } : {}) };
  let journal = await openLiveJournal(journalOptions);
  const map = new Map([
    [actorId, { id: actorId, email: 'local-principal@example.invalid', created_at: new Date(time - 300000).toISOString(),
      user_metadata: { balam_online_test: run }, app_metadata: { provider: 'email', providers: ['email'] } }],
    [accountId, { id: accountId, email: 'local-account@example.invalid', created_at: new Date(time - 240000).toISOString(),
      user_metadata: {}, app_metadata: { provider: 'email', balam_account_request_id: randomUUID() } }],
  ]);
  const entries = [];
  entries.push(await journal.prepare({ kind: 'auth-create', checkpoint: 'local principal intent', actorId,
    identities: { userId: actorId }, command: { qaRun: run, emailSha256: sha(map.get(actorId).email) } }));
  if (!options.principalOnly) entries.push(await journal.prepare({ kind: 'edge:admin-users:create', checkpoint: 'local account intent', actorId,
    requestId: map.get(accountId).app_metadata.balam_account_request_id,
    identities: { userId: accountId }, command: { action: 'create', emailSha256: sha(map.get(accountId).email) } }));
  if (options.principalOnly) map.delete(accountId);
  const binding = { projectRef: C.projectRef, run, actorId, artifactSha256 };
  const authBaseline = { format: 'balam-live-auth-baseline-v1', ...binding, snapshotSha256: sha('baseline snapshot'),
    complete: true, ids: [C.realActorId], fileSha256: sha('baseline file') };
  const plan = { format: 'balam-live-cleanup-plan-v1', ...binding, reconciled: true, reconciliationSha256: sha('reconciled receipts'),
    journalSha256: sha(journal.snapshot()), fixturesSha256: sha('fixture file'), cleanupManifestComplete: true,
    authCleanupManifestComplete: true, readyForReview: true, blockers: [], holds: [],
    backup: { baselineSha256: authBaseline.snapshotSha256, currentSha256: sha('current snapshot'),
      baselineFileSha256: authBaseline.fileSha256, currentFileSha256: sha('current file') },
    authBaseline, authBaselineSha256: sha(authBaseline), external: { auth: 'HELD_SEPARATE_GOTRUE' },
    targets: [{ table: options.principalOnly ? 'sellers' : 'online_account_requests', pk_json_text: JSON.stringify(options.principalOnly
      ? { id: 'local-principal-profile' } : { actor_id: actorId, request_id: entries[1].requestId }),
      full_row_md5: md5('local canonical deleted row') }],
    authTargets: (options.principalOnly ? [actorId] : [actorId, accountId]).map((id, i) => ({ id, emailSha256: sha(map.get(id).email),
      marker: i ? { namespace: 'app_metadata', key: 'balam_account_request_id', value: entries[i].requestId }
        : { namespace: 'user_metadata', key: 'balam_online_test', value: run },
      provenance: { actorId, run, requestId: entries[i].requestId, sequence: entries[i].sequence,
        intentSha256: entries[i].entryHash, receiptSha256: sha('local receipt' + i), kind: i ? 'SERVER_TERMINAL_RECEIPT' : 'OBSERVED_NODE_INTENT_NOT_SERVER_RECEIPT' },
      status: 'PROVEN_NEW_SEPARATE_GOTRUE' })), liveGateOpened: false, certified: false };
  if (options.zeroPos) plan.targets = [];
  const identityEvidence = buildLiveAuthIdentityEvidence({ plan, users: [...map.values()], observedAt: new Date(time - 1000).toISOString() });
  const identityFile = join(scratch, run + '-identity.json');
  await fs.writeFile(identityFile, JSON.stringify(identityEvidence));
  const identityEvidenceFileSha256 = sha(await fs.readFile(identityFile, 'utf8'));
  const postcheck = { at: new Date(time).toISOString(), readOnly: true, sourceUrl: `https://${C.projectRef}.supabase.co/`,
    remainingExactRows: 0, exactRowsChecked: plan.targets.length,
    protectedRequest: { id: C.preservedRequestId, fullRowMd5: md5('local CURRENT preserved request') },
    posCatalogSha256: sha('pos schema'), authDependencyCatalogSha256: sha('auth dependency schema'),
    posFingerprints: catalog.map(t => ({ table: t.table, row_count: 0, full_rows_md5: md5('') })),
    nonTargetAuthIds: [...authBaseline.ids], foreignAuthFingerprint: { row_count: 1, full_rows_md5: md5('full foreign auth hash') },
    storageOwnerCatalog: ['owner', 'owner_id'].map(column => ({ relation: 'storage.objects', column, type: column === 'owner' ? 'uuid' : 'text' })) };
  postcheck.snapshotRevision = { value: '1000', full_row_md5: md5('local revision:1000'), other_fields_md5: md5('singleton:true'),
    delta_per_delete: 7, contract_sha256: sha('local validated H166 FK-trigger-function contract') };
  Object.assign(postcheck.posFingerprints.find(t => t.table === 'online_snapshot_revision'),
    { row_count: 1, full_rows_md5: md5(postcheck.snapshotRevision.full_row_md5) });
  const proof = { format: 'balam-live-auth-sql-proof-v1', ...binding, planSha256: sha(plan), journalSha256: plan.journalSha256,
    status: 'COMMITTED_AND_VERIFIED', commitConfirmed: true, sqlSha256: sha('sql'), sqlManifestSha256: sha('sql manifest'),
    resultFileSha256: sha('result file'), postcheckFileSha256: sha('postcheck file'),
    result: { format: 'balam-new-fixture-cleanup-result-v1', project_ref: C.projectRef, run,
      plan_sha256: sha('sql manifest'), removed_rows: plan.targets.length, outside_tables_checked: 63, auth_sql_unchanged: true,
      removed_manifest: plan.targets.map(t => ({ table_name: t.table, pk: JSON.parse(t.pk_json_text), row_md5: t.full_row_md5 })) }, postcheck };
  const fresh = () => ({ project_ref: C.projectRef, source_url: postcheck.sourceUrl, at: new Date(time).toISOString(), read_only: 'on',
    current_user: 'postgres', session_user: 'postgres', database: 'postgres', real_actor_exists: true, real_actor_can_manage: true,
    protected_request: postcheck.protectedRequest, pos_catalog_sha256: postcheck.posCatalogSha256,
    auth_dependency_catalog_sha256: postcheck.authDependencyCatalogSha256, pos_fingerprints: postcheck.posFingerprints,
    snapshot_revision: postcheck.snapshotRevision,
    foreign_auth_fingerprint: postcheck.foreignAuthFingerprint, non_target_auth_ids: postcheck.nonTargetAuthIds,
    fk_catalog: AUTH_INCOMING_FKS.map(f => ({ relation: f.relation, columns: [f.column], effect: f.effect, referenced_columns: ['id'], validated: true })),
    fk_counts: [actorId, accountId].flatMap(id => AUTH_INCOMING_FKS.map(f => ({ ...f, id, rows: f.relation.startsWith('auth.') ? 1 : 0 }))),
    storage_owner_catalog_complete: true, storage_owner_catalog: postcheck.storageOwnerCatalog,
    storage_owner_counts: [actorId, accountId].flatMap(id => postcheck.storageOwnerCatalog.map(c => ({ ...c, id, rows: 0 }))) });
  const state = { plan, proof, identityEvidence, identityEvidenceFileSha256, map, preflight: structuredClone(fresh()), now: time };
  const calls = { gets: [], deletes: [], preflights: [] };
  const admin = { url: `https://${C.projectRef}.supabase.co/auth/v1`,
    async getUserById(id) { calls.gets.push(id); return options.get ? options.get(id, state, calls)
      : map.has(id) ? { data: { user: structuredClone(map.get(id)) }, error: null } : { data: { user: null }, error: { status: 404 } }; },
    async deleteUser(id, soft) {
      assert.equal(soft, false);
      const installed = await read(file);
      assert.equal(installed.entries.filter(e => e.kind === C.attemptKind && e.identities.userId === id).length, 1);
      calls.deletes.push(id);
      if (options.remove) return options.remove(id, state, calls);
      map.delete(id); advanceRevision(state); return { data: { user: { id } }, error: null };
    } };
  const make = extra => createLiveCleanupAuth({ admin, journal, plan, identityEvidence, identityEvidenceFileSha256, proof,
    now: () => state.now, preflight: async id => { calls.preflights.push(id); return structuredClone(state.preflight); }, ...extra });
  return { state, plan, proof, identityEvidence, identityEvidenceFileSha256, map, admin, calls, actorId, accountId, file, make,
    get journal() { return journal; }, close: () => journal.close(),
    reopen: async () => { await journal.close(); journal = await openLiveJournal(journalOptions); } };
}
const withFixture = async (options, fn) => { const f = await fixture(options); try { await fn(f); } finally { await f.close(); } };

checked('pure identity projection contains no raw email or metadata and binds two exact markers', () => withFixture({}, async f => {
  const encoded = JSON.stringify(f.identityEvidence);
  assert.equal(encoded.includes('@example.invalid'), false); assert.equal(encoded.includes('provider'), false);
  assert.equal(f.identityEvidence.identities.length, 2);
  assert.equal(f.calls.deletes.length, 0);
  const users = [...f.map.values()].map(v => structuredClone(v)); users[1].app_metadata.balam_account_request_id = randomUUID();
  assert.throws(() => buildLiveAuthIdentityEvidence({ plan: f.plan, users, observedAt: new Date(time).toISOString() }), /IDENTITY_PROVENANCE/);
}));
checked('foreign project, real actor, preexisting UUID and incomplete plan fail before API', () => withFixture({}, async f => {
  for (const mutate of [p => p.projectRef = 'foreign', p => p.actorId = C.realActorId,
    p => { p.authBaseline.ids.push(f.accountId); p.authBaselineSha256 = sha(p.authBaseline); },
    p => p.authTargets = [], p => p.authTargets[1].status = 'HELD', p => p.cleanupManifestComplete = false,
    p => p.blockers.push({ code: 'UNKNOWN' }), p => p.authBaselineSha256 = sha('wrong')]) {
    const plan = structuredClone(f.plan); mutate(plan); assert.throws(() => f.make({ plan }), /LIVE_AUTH_/);
  }
  await assert.rejects(f.make().retireOne(C.realActorId), /TARGET_FORBIDDEN/);
  assert.deepEqual(f.calls.deletes, []); assert.deepEqual(f.calls.gets, []);
}));
checked('admin endpoint, run, artifact and exact journal prefix are mandatory', () => withFixture({}, async f => {
  assert.throws(() => f.make({ admin: { ...f.admin, url: 'https://foreign.invalid/auth/v1' } }), /GOTRUE/);
  for (const change of [s => s.run = randomUUID(), s => s.artifactSha256 = sha('other'), s => s.entries[0].command.qaRun = randomUUID()]) {
    const snapshot = f.journal.snapshot(); change(snapshot);
    assert.throws(() => f.make({ journal: { ...f.journal, snapshot: () => snapshot } }), /JOURNAL_/);
  }
}));
checked('SQL commit, independent postcheck, full scope and canonical hashes are required', () => withFixture({}, async f => {
  for (const mutate of [p => p.status = 'ROLLED_BACK', p => p.commitConfirmed = false, p => p.postcheckFileSha256 = '',
    p => p.planSha256 = sha('other'), p => p.result.removed_rows = 0,
    p => p.result.removed_manifest[0].row_md5 = md5('changed'), p => p.postcheck.remainingExactRows = 1,
    p => p.postcheck.posFingerprints.pop(), p => p.postcheck.posFingerprints[0].table = 'fake_table',
    p => p.postcheck.nonTargetAuthIds = [], p => p.result.auth_sql_unchanged = false]) {
    const proof = structuredClone(f.proof); mutate(proof); assert.throws(() => f.make({ proof }), /LIVE_AUTH_/);
  }
  assert.deepEqual(f.calls.deletes, []);
}));
checked('durable prior PRESENT identity is required even when Auth is already absent', () => withFixture({}, async f => {
  f.map.delete(f.accountId);
  for (const mutate of [e => e.identities.pop(), e => e.identities[1].observedState = 'ABSENT',
    e => e.planSha256 = sha('foreign'), e => e.identities[1].qaMarkers = {}]) {
    const identityEvidence = structuredClone(f.identityEvidence); mutate(identityEvidence);
    assert.throws(() => f.make({ identityEvidence }), /LIVE_AUTH_/);
  }
  assert.throws(() => f.make({ identityEvidenceFileSha256: '' }), /BACKED_IDENTITY/);
  const result = await f.make().retireOne(f.accountId);
  assert.equal(result.state, 'ABSENT_VERIFIED'); assert.equal(result.alreadyAbsent, true); assert.equal(result.deletionAttributed, false);
  assert.deepEqual(f.calls.deletes, []);
}));
checked('two ordered hard deletions have durable intent before dispatch, explicit404 and no certification', () => withFixture({}, async f => {
  const result = await f.make().retireAll();
  assert.equal(result.authAbsenceVerified, true); assert.equal(result.certified, false);
  assert.equal(result.liveGateOpened, false); assert.equal(result.sqlAndAuthAtomic, false);
  assert.deepEqual(f.calls.deletes, [f.accountId, f.actorId]);
  await f.reopen(); assert.equal((await f.make().retireAll()).authAbsenceVerified, true);
  assert.deepEqual(f.calls.deletes, [f.accountId, f.actorId]);
  const encoded = await fs.readFile(f.file, 'utf8');
  assert.equal(encoded.includes('@example.invalid'), false); assert.equal(encoded.includes('providers'), false);
}));
checked('a lost DELETE response performs GET reconciliation, without automatic resend', () => withFixture({
  remove(id, state) { state.map.delete(id); advanceRevision(state); throw new Error('sensitive transport body'); },
}, async f => {
  assert.equal((await f.make().retireOne(f.accountId)).state, 'ABSENT_VERIFIED');
  await f.reopen(); assert.equal((await f.make().reconcile(f.accountId)).state, 'ABSENT_VERIFIED');
  assert.deepEqual(f.calls.deletes, [f.accountId]); assert.equal((await fs.readFile(f.file, 'utf8')).includes('sensitive'), false);
}));
checked('recorded intent before a crash permits only GET even if no DELETE was sent', () => withFixture({}, async f => {
  await f.journal.prepare({ kind: C.attemptKind, checkpoint: 'local crash boundary', actorId: f.actorId,
    requestId: f.accountId, identities: { userId: f.accountId }, command: { action: 'GoTrueAdmin.deleteUser' } });
  await f.reopen(); const result = await f.make().retireOne(f.accountId);
  assert.equal(result.state, 'REVIEW_REQUIRED'); assert.deepEqual(f.calls.deletes, []);
}));
checked('uncertain deletion with account present stops bulk and cannot retry', () => withFixture({
  remove() { return { data: { user: null }, error: { status: 500, message: 'sensitive server body' } }; },
}, async f => {
  const result = await f.make().retireAll(); assert.equal(result.authAbsenceVerified, false); assert.equal(result.results.length, 1);
  assert.equal(result.results[0].state, 'REVIEW_REQUIRED');
  await f.reopen(); await f.make().retireOne(f.accountId); assert.deepEqual(f.calls.deletes, [f.accountId]);
}));
checked('null user200, GET500 and thrown404 never mean verified absence', async () => {
  for (const get of [() => ({ data: { user: null }, error: null }), () => ({ data: { user: null }, error: { status: 500 } }),
    () => { throw { status: 404 }; }]) await withFixture({ get }, async f => {
    await assert.rejects(f.make().retireOne(f.accountId), /GET_UNCERTAIN/); assert.deepEqual(f.calls.deletes, []);
  });
});
checked('GET failure after DELETE cannot explain revision advance and later reconciliation is read only', () => withFixture({
  get(id, state) { return state.map.has(id) ? { data: { user: structuredClone(state.map.get(id)) } }
    : { data: { user: null }, error: { status: 503 } }; },
}, async f => {
  assert.equal((await f.make().retireOne(f.accountId)).state, 'REVIEW_REQUIRED');
  await f.reopen(); assert.equal((await f.make().reconcile(f.accountId)).state, 'REVIEW_REQUIRED');
  assert.deepEqual(f.calls.deletes, [f.accountId]);
}));
checked('email, createdAt, exact marker or any metadata drift blocks DELETE', async () => {
  for (const mutate of [u => u.email = 'foreign@example.invalid', u => u.created_at = new Date(time).toISOString(),
    u => u.app_metadata.balam_account_request_id = randomUUID(), u => u.user_metadata.balam_sync_test = randomUUID(),
    u => u.app_metadata.provider = 'external']) await withFixture({}, async f => {
    mutate(f.map.get(f.accountId)); await assert.rejects(f.make().retireOne(f.accountId), /LIVE_IDENTITY_CHANGED/);
    assert.deepEqual(f.calls.deletes, []);
  });
});
checked('all ten POS FK effects including CASCADE and SET NULL require zero rows', async () => {
  for (const fk of AUTH_INCOMING_FKS.filter(f => f.relation.startsWith('pos.'))) await withFixture({}, async f => {
    f.state.preflight.fk_counts.find(c => c.id === f.accountId && c.relation === fk.relation && c.column === fk.column).rows = 1;
    await assert.rejects(f.make().retireOne(f.accountId), /POS_DEPENDENCIES_REMAIN/); assert.deepEqual(f.calls.deletes, []);
  });
});
checked('unknown Auth families, changed FK catalog and incomplete counts require review', async () => {
  for (const mutate of [p => p.fk_catalog.push({ relation: 'auth.unknown', columns: ['user_id'], effect: 'c', referenced_columns: ['id'], validated: true }),
    p => p.fk_catalog.pop(), p => p.fk_catalog[0].effect = 'n', p => p.fk_catalog[0].validated = false,
    p => p.fk_counts.pop(), p => p.auth_dependency_catalog_sha256 = sha('new dependency')]) await withFixture({}, async f => {
    mutate(f.state.preflight); await assert.rejects(f.make().retireOne(f.accountId), /LIVE_AUTH_/); assert.deepEqual(f.calls.deletes, []);
  });
});
checked('Storage owner or owner_id references, missing counts and new owner columns block', async () => {
  for (const mutate of [p => p.storage_owner_counts.find(c => c.column === 'owner_id').rows = 1,
    p => p.storage_owner_counts.find(c => c.column === 'owner').rows = 1, p => p.storage_owner_counts.shift(),
    p => p.storage_owner_catalog_complete = false,
    p => p.storage_owner_catalog.push({ relation: 'storage.buckets', column: 'owner_id', type: 'text' })]) await withFixture({}, async f => {
    mutate(f.state.preflight); await assert.rejects(f.make().retireOne(f.actorId), /STORAGE_/); assert.deepEqual(f.calls.deletes, []);
  });
});
checked('fresh PostgreSQL owner context, correct source and complete foreign protections are required', async () => {
  for (const mutate of [p => p.at = new Date(time - 120001).toISOString(), p => p.read_only = 'off',
    p => p.source_url = 'https://foreign.invalid/', p => p.current_user = 'authenticated', p => p.real_actor_can_manage = false,
    p => p.protected_request.fullRowMd5 = md5('changed'), p => p.pos_fingerprints[0].full_rows_md5 = md5('changed'),
    p => p.foreign_auth_fingerprint.full_rows_md5 = md5('changed'), p => p.non_target_auth_ids.push(randomUUID())]) await withFixture({}, async f => {
    mutate(f.state.preflight); await assert.rejects(f.make().retireOne(f.accountId), /LIVE_AUTH_/); assert.deepEqual(f.calls.deletes, []);
  });
});
checked('protection drift after a successful DELETE records review and preserves observed absence', () => withFixture({
  remove(id, state) { state.map.delete(id); state.preflight.pos_fingerprints[0].full_rows_md5 = md5('changed'); },
}, async f => {
  const result = await f.make().retireAll(); assert.equal(result.authAbsenceVerified, false);
  assert.equal(result.results[0].state, 'REVIEW_REQUIRED'); assert.equal(result.results[0].absenceObserved, true);
  assert.deepEqual(f.calls.deletes, [f.accountId]);
}));
checked('disk persistence failure before durable intent prevents any dispatch', async () => {
  let fail = false;
  const io = { ...fs, async open(path, ...args) { if (fail && String(path).endsWith('.pending')) throw new Error('local disk failure'); return fs.open(path, ...args); } };
  await withFixture({ io }, async f => {
    const adapter = f.make(); fail = true;
    await assert.rejects(adapter.retireOne(f.accountId), /JOURNAL_/); assert.deepEqual(f.calls.deletes, []);
  });
});
checked('endpoint drift immediately before dispatch leaves durable intent and never resends', () => withFixture({}, async f => {
  const wrapped = { ...f.journal, async beforeMutation(descriptor, work) {
    return f.journal.beforeMutation(descriptor, () => { f.admin.url = 'https://foreign.invalid/auth/v1'; return work(); });
  } };
  await assert.rejects(f.make({ journal: wrapped }).retireOne(f.accountId), /GOTRUE/);
  assert.deepEqual(f.calls.deletes, []); f.admin.url = `https://${C.projectRef}.supabase.co/auth/v1`;
  await f.reopen(); assert.equal((await f.make().retireOne(f.accountId)).state, 'REVIEW_REQUIRED');
  assert.deepEqual(f.calls.deletes, []);
}));
checked('concurrent invocations cannot dispatch a second deletion', () => withFixture({}, async f => {
  let release; const held = new Promise(r => { release = r; });
  const adapter = f.make({ preflight: async () => { await held; return structuredClone(f.state.preflight); } });
  const first = adapter.retireOne(f.accountId);
  await assert.rejects(adapter.retireOne(f.actorId), /BUSY/); release();
  assert.equal((await first).state, 'ABSENT_VERIFIED'); assert.deepEqual(f.calls.deletes, [f.accountId]);
}));
checked('early failure with only one proven principal never invents another Auth target', () => withFixture({ principalOnly: true }, async f => {
  assert.equal(f.plan.authTargets.length, 1); assert.equal(f.identityEvidence.identities.length, 1);
  const result = await f.make().retireAll(); assert.equal(result.authAbsenceVerified, true); assert.equal(result.results.length, 1);
  assert.deepEqual(f.calls.deletes, [f.actorId]);
}));
checked('exact H166 revision advances survive reopen; metadata, rewind and excess advance remain protected', async () => {
  for (const mutate of [s => advanceRevision(s, 1), s => advanceRevision(s, -1),
    s => s.preflight.snapshot_revision.other_fields_md5 = md5('changed'),
    s => s.preflight.snapshot_revision.contract_sha256 = sha('changed'),
    s => s.preflight.snapshot_revision.delta_per_delete = 8]) await withFixture({}, async f => {
    mutate(f.state); await assert.rejects(f.make().retireOne(f.accountId), /REVISION_/); assert.deepEqual(f.calls.deletes, []);
  });
  await withFixture({}, async f => {
    await f.make().retireOne(f.accountId); assert.equal(f.state.preflight.snapshot_revision.value, '1007');
    await f.reopen(); assert.equal((await f.make().retireOne(f.actorId)).state, 'ABSENT_VERIFIED');
    assert.equal(f.state.preflight.snapshot_revision.value, '1014');
    assert.deepEqual(f.calls.deletes, [f.accountId, f.actorId]);
  });
});
checked('an intent without explicit404 cannot justify seven revision increments', () => withFixture({}, async f => {
  await f.journal.prepare({ kind: C.attemptKind, checkpoint: 'local intent only', actorId: f.actorId,
    requestId: f.accountId, identities: { userId: f.accountId }, command: { action: 'GoTrueAdmin.deleteUser' } });
  advanceRevision(f.state); const result = await f.make().reconcile(f.accountId);
  assert.equal(result.state, 'REVIEW_REQUIRED'); assert.equal(result.reason, 'LIVE_AUTH_REVISION_UNEXPLAINED_DELTA');
  assert.deepEqual(f.calls.deletes, []);
}));
checked('already absent without an attempt cannot attribute a new revision delta to this adapter', () => withFixture({}, async f => {
  f.map.delete(f.accountId); advanceRevision(f.state);
  await assert.rejects(f.make().retireOne(f.accountId), /REVISION_UNEXPLAINED/); assert.deepEqual(f.calls.deletes, []);
}));
checked('separate factories sharing one durable journal still dispatch at most once', () => withFixture({}, async f => {
  let release; const barrier = new Promise(r => { release = r; });
  const preflight = async () => { await barrier; return structuredClone(f.state.preflight); };
  const first = f.make({ preflight }).retireOne(f.accountId), second = f.make({ preflight }).retireOne(f.accountId);
  release(); await Promise.allSettled([first, second]);
  assert.deepEqual(f.calls.deletes, [f.accountId]);
  await f.reopen(); assert.equal((await f.make().reconcile(f.accountId)).state, 'ABSENT_VERIFIED');
  assert.deepEqual(f.calls.deletes, [f.accountId]);
}));
checked('preflight expiration after durable persistence blocks dispatch and leaves reconciliation only', () => withFixture({}, async f => {
  const wrapped = { ...f.journal, async beforeMutation(descriptor, work) {
    return f.journal.beforeMutation(descriptor, () => { f.state.now += 120001; return work(); });
  } };
  await assert.rejects(f.make({ journal: wrapped }).retireOne(f.accountId), /PREFLIGHT_STALE/);
  assert.deepEqual(f.calls.deletes, []); f.state.now = time;
  await f.reopen(); assert.equal((await f.make().retireOne(f.accountId)).state, 'REVIEW_REQUIRED');
  assert.deepEqual(f.calls.deletes, []);
}));
checked('zero POS targets still require committed and verified SQL result with exact empty manifest', () => withFixture({ principalOnly: true, zeroPos: true }, async f => {
  assert.deepEqual(f.plan.targets, []); assert.equal(f.proof.result.removed_rows, 0);
  assert.deepEqual(f.proof.result.removed_manifest, []); assert.equal(f.proof.postcheck.exactRowsChecked, 0);
  for (const mutate of [p => p.status = 'NO_CHANGES_ASSUMED', p => p.commitConfirmed = false,
    p => p.result.removed_manifest = null, p => p.result.removed_rows = 1,
    p => p.postcheckFileSha256 = '', p => p.postcheck.posFingerprints.pop()]) {
    const proof = structuredClone(f.proof); mutate(proof); assert.throws(() => f.make({ proof }), /LIVE_AUTH_/);
  }
  const noAuth = structuredClone(f.plan); noAuth.authTargets = [];
  assert.throws(() => f.make({ plan: noAuth }), /EXACT_NEW_TARGETS_REQUIRED/);
  const result = await f.make().retireAll(); assert.equal(result.authAbsenceVerified, true);
  assert.deepEqual(f.calls.deletes, [f.actorId]);
}));

after(async () => {
  await fs.writeFile('docs/fixes/evidence/h171-live-cleanup-auth-local-validation.json', JSON.stringify({
    at: new Date().toISOString(), scope: 'LOCAL_ONLY_INJECTED_GOTRUE_DURABLE_JOURNAL_NO_NETWORK',
    moduleSha256: sha(await fs.readFile('h171-live-cleanup-auth.mjs', 'utf8')),
    testSha256: sha(await fs.readFile('test-h171-live-cleanup-auth.mjs', 'utf8')),
    checksPassed: checks.length, expectedChecks: 27, checks, certified: false,
    limitations: ['This does not certify a remote SQL commit or GoTrue deletion.',
      'The caller must validate and durably preserve original commit, postcheck and identity artifacts.',
      'Fresh SELECT and GoTrue DELETE are separate transactions; concurrent changes can require review.'],
  }, null, 2) + '\n');
  const within = relative(scratchRoot, resolve(scratch));
  assert.ok(within && !within.startsWith('..') && resolve(scratch) !== scratchRoot);
  await fs.rm(scratch, { recursive: true, force: true });
});
