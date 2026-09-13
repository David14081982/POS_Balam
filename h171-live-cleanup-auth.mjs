// Node-only, injected GoTrue cleanup for the 1–2 proven NEW identities of one H171 run.
// Import/CLI performs no I/O. This adapter neither opens the live gate nor grants authorization.
import { journalHash } from './h171-live-journal.mjs';
import { createHash } from 'node:crypto';
import { AUTH_INCOMING_FKS } from './h171-auth-retirement.mjs';
import { SNAPSHOT_PROJECT, SNAPSHOT_ACTOR, SNAPSHOT_TABLES_SHA256 } from './h171-live-snapshot.mjs';

export const LIVE_AUTH_CLEANUP = Object.freeze({ projectRef: SNAPSHOT_PROJECT, realActorId: SNAPSHOT_ACTOR,
  preservedRequestId: '70549527-4867-4342-94d2-38e770b0f2a9',
  attemptKind: 'live-cleanup-auth-attempt', observationKind: 'live-cleanup-auth-observation' });
const SHA = /^[a-f0-9]{64}$/, MD5 = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NAME = /^[a-z_][a-z0-9_]*$/;
const need = (ok, code) => { if (!ok) throw Object.assign(new Error('LIVE_AUTH_' + code), { code: 'LIVE_AUTH_' + code }); };
const same = (a, b) => journalHash(a) === journalHash(b);
const md5 = value => createHash('md5').update(value).digest('hex');
const reportOf = value => value?.rows?.[0]?.report || value;
const fkKey = row => `${row.relation}|${row.column}|${row.effect}`;
const fkKeys = AUTH_INCOMING_FKS.map(fkKey).sort();
const ownerKey = row => `${row.relation}|${row.column}|${row.type}`;
const sourceUrl = `https://${SNAPSHOT_PROJECT}.supabase.co/`;
const posHashes = rows => [...rows].sort((a,b) => a.table.localeCompare(b.table));
const markers = user => Object.fromEntries([
  ['user_metadata.balam_online_test', user.user_metadata?.balam_online_test],
  ['user_metadata.balam_sync_test', user.user_metadata?.balam_sync_test],
  ['app_metadata.balam_account_request_id', user.app_metadata?.balam_account_request_id],
].filter(([, value]) => value !== undefined));
const expectedMarkers = target => ({ [target.marker.namespace + '.' + target.marker.key]: target.marker.value });

function assertPlan(plan) {
  need(plan?.format === 'balam-live-cleanup-plan-v1' && plan.projectRef === SNAPSHOT_PROJECT &&
    UUID.test(plan.run || '') && UUID.test(plan.actorId || '') && plan.actorId !== SNAPSHOT_ACTOR &&
    [plan.artifactSha256, plan.journalSha256, plan.reconciliationSha256, plan.fixturesSha256,
      plan.backup?.baselineSha256, plan.backup?.currentSha256, plan.backup?.baselineFileSha256,
      plan.backup?.currentFileSha256].every(v => SHA.test(v || '')), 'PLAN_BINDING');
  need(plan.reconciled === true && plan.cleanupManifestComplete === true && plan.authCleanupManifestComplete === true &&
    plan.readyForReview === true && Array.isArray(plan.blockers) && !plan.blockers.length &&
    Array.isArray(plan.targets) && Array.isArray(plan.holds) &&
    plan.external?.auth === 'HELD_SEPARATE_GOTRUE', 'COMPLETE_REVIEWED_PLAN_REQUIRED');
  const base = plan.authBaseline;
  need(base?.format === 'balam-live-auth-baseline-v1' && base.projectRef === plan.projectRef && base.run === plan.run &&
    base.actorId === plan.actorId && base.artifactSha256 === plan.artifactSha256 && base.complete === true &&
    base.snapshotSha256 === plan.backup.baselineSha256 && SHA.test(base.fileSha256 || '') &&
    plan.authBaselineSha256 === journalHash(base) && Array.isArray(base.ids) && base.ids.every(id => UUID.test(id)) &&
    new Set(base.ids).size === base.ids.length && base.ids.includes(SNAPSHOT_ACTOR), 'BASELINE_AUTH_REQUIRED');
  const targets = plan.authTargets;
  need(Array.isArray(targets) && targets.length >= 1 && targets.length <= 2 && new Set(targets.map(t => t.id)).size === targets.length &&
    targets.some(t => t.id === plan.actorId), 'EXACT_NEW_TARGETS_REQUIRED');
  for (const t of targets) {
    const p = t.provenance, principal = t.id === plan.actorId;
    need(UUID.test(t.id || '') && t.id !== SNAPSHOT_ACTOR && !base.ids.includes(t.id) &&
      t.status === 'PROVEN_NEW_SEPARATE_GOTRUE' && SHA.test(t.emailSha256 || '') &&
      p?.actorId === plan.actorId && p.run === plan.run && UUID.test(p.requestId || '') &&
      SHA.test(p.intentSha256 || '') && SHA.test(p.receiptSha256 || '') && Number.isSafeInteger(p.sequence) && p.sequence > 0,
    'TARGET_PROVENANCE_OR_BASELINE');
    need(t.marker?.namespace === (principal ? 'user_metadata' : 'app_metadata') &&
      t.marker.key === (principal ? 'balam_online_test' : 'balam_account_request_id') &&
      t.marker.value === (principal ? plan.run : p.requestId), 'TARGET_MARKER');
  }
  return targets;
}

/** Pure projection of explicit successful GET results. Persist the returned object
 * privately before SQL/Auth cleanup; pass that file's SHA separately to the factory.
 * Never persist the input users. No email, tokens, credentials or raw metadata escape. */
export function buildLiveAuthIdentityEvidence({ plan, users, observedAt }) {
  const targets = assertPlan(plan);
  need(Array.isArray(users) && users.length === targets.length && new Set(users.map(u => u.id)).size === targets.length &&
    Number.isFinite(Date.parse(observedAt)), 'IDENTITY_OBSERVATION_REQUIRED');
  const identities = targets.map(t => {
    const user = users.find(u => u.id === t.id);
    need(user && typeof user.email === 'string' && journalHash(user.email.trim().toLowerCase()) === t.emailSha256 &&
      Number.isFinite(Date.parse(user.created_at)) && same(markers(user), expectedMarkers(t)), 'IDENTITY_PROVENANCE_MISMATCH');
    return { id: t.id, emailSha256: t.emailSha256, createdAt: user.created_at, qaMarkers: markers(user),
      metadataSha256: journalHash({ user: user.user_metadata || {}, app: user.app_metadata || {} }),
      observedState: 'PRESENT' };
  });
  return { format: 'balam-live-auth-identities-v1', projectRef: plan.projectRef, run: plan.run, actorId: plan.actorId,
    artifactSha256: plan.artifactSha256, planSha256: journalHash(plan), journalSha256: plan.journalSha256,
    observedAt, identities };
}

/** No remote client is created here. proof is the executor's bound, backed
 * COMMIT + independent read-only postcheck, not a permission flag. See companion doc. */
export function createLiveCleanupAuth({ admin, journal, plan: inputPlan, identityEvidence: inputIdentity,
  identityEvidenceFileSha256, proof: inputProof, preflight, now = () => Date.now(), maxPreflightAgeMs = 120_000 }) {
  const plan = structuredClone(inputPlan), targets = assertPlan(plan), planSha256 = journalHash(plan);
  const ids = targets.map(t => t.id), permitted = new Set(ids), identityEvidence = structuredClone(inputIdentity || {});
  const proof = structuredClone(inputProof || {});
  need(typeof journal?.beforeMutation === 'function' && typeof journal?.prepare === 'function' &&
    typeof journal?.snapshot === 'function' && typeof journal?.assertHealthy === 'function', 'DURABLE_JOURNAL_REQUIRED');
  need(typeof preflight === 'function' && typeof now === 'function' && Number.isFinite(maxPreflightAgeMs) &&
    maxPreflightAgeMs > 0 && maxPreflightAgeMs <= 120_000, 'FRESH_PREFLIGHT_REQUIRED');
  function assertAdmin() {
    need(typeof admin?.getUserById === 'function' && typeof admin?.deleteUser === 'function' &&
      admin.url?.replace(/\/$/, '') === `https://${SNAPSHOT_PROJECT}.supabase.co/auth/v1`, 'GOTRUE_ADMIN_REQUIRED');
  }
  function assertJournal() {
    journal.assertHealthy(); const s = journal.snapshot();
    need(s.format === 'balam-live-journal-v1' && s.projectRef === plan.projectRef && s.run === plan.run &&
      s.artifactSha256 === plan.artifactSha256 && Array.isArray(s.entries), 'JOURNAL_IDENTITY');
    // SQL cleanup and Auth observations append to this same ledger. Bind the exact
    // pre-cleanup prefix used by the assembler; never reassemble a destructive scope.
    const prefix = s.entries.findIndex((_, i) => journalHash({ ...s, entries: s.entries.slice(0, i + 1) }) === plan.journalSha256) + 1;
    need(prefix > 0, 'JOURNAL_PLAN_PREFIX_CHANGED');
    for (const t of targets) {
      const e = s.entries[t.provenance.sequence - 1];
      need(e && e.sequence <= prefix && e.entryHash === t.provenance.intentSha256 &&
        e.actorId === plan.actorId && e.requestId === t.provenance.requestId, 'JOURNAL_TARGET_INTENT_CHANGED');
      if (t.id === plan.actorId) need(e.kind === 'auth-create' && e.identities?.userId === t.id &&
        e.command?.qaRun === plan.run && e.command.emailSha256 === t.emailSha256, 'JOURNAL_PRINCIPAL_PROVENANCE');
    }
    return s;
  }
  assertAdmin(); assertJournal();
  need(identityEvidence.format === 'balam-live-auth-identities-v1' && identityEvidence.projectRef === plan.projectRef &&
    identityEvidence.run === plan.run && identityEvidence.actorId === plan.actorId && identityEvidence.artifactSha256 === plan.artifactSha256 &&
    identityEvidence.planSha256 === planSha256 && identityEvidence.journalSha256 === plan.journalSha256 &&
    SHA.test(identityEvidenceFileSha256 || '') && Number.isFinite(Date.parse(identityEvidence.observedAt)) &&
    Array.isArray(identityEvidence.identities) && identityEvidence.identities.length === ids.length &&
    new Set(identityEvidence.identities.map(t => t.id)).size === ids.length, 'BACKED_IDENTITY_EVIDENCE_REQUIRED');
  const identityMap = new Map(identityEvidence.identities.map(row => [row.id, row]));
  for (const t of targets) {
    const row = identityMap.get(t.id);
    need(row?.observedState === 'PRESENT' && row.emailSha256 === t.emailSha256 && SHA.test(row.metadataSha256 || '') &&
      Number.isFinite(Date.parse(row.createdAt)) && same(row.qaMarkers, expectedMarkers(t)), 'PREVIOUS_IDENTITY_MISMATCH');
  }
  need(proof.format === 'balam-live-auth-sql-proof-v1' && proof.projectRef === plan.projectRef && proof.run === plan.run &&
    proof.actorId === plan.actorId && proof.artifactSha256 === plan.artifactSha256 && proof.planSha256 === planSha256 &&
    proof.journalSha256 === plan.journalSha256 && proof.status === 'COMMITTED_AND_VERIFIED' && proof.commitConfirmed === true &&
    [proof.sqlSha256, proof.sqlManifestSha256, proof.resultFileSha256, proof.postcheckFileSha256].every(v => SHA.test(v || '')),
  'SQL_COMMIT_AND_POSTCHECK_REQUIRED');
  const result = proof.result, post = proof.postcheck;
  need(result?.format === 'balam-new-fixture-cleanup-result-v1' && result.project_ref === plan.projectRef && result.run === plan.run &&
    result.plan_sha256 === proof.sqlManifestSha256 && result.removed_rows === plan.targets.length &&
    result.outside_tables_checked === 63 && result.auth_sql_unchanged === true && Array.isArray(result.removed_manifest), 'SQL_RESULT_BINDING');
  const removed = result.removed_manifest.map(t => ({ table: t.table_name, pk: t.pk, hash: t.row_md5 }));
  const intended = plan.targets.map(t => ({ table: t.table, pk: JSON.parse(t.pk_json_text), hash: t.full_row_md5 }));
  need(intended.every(t => NAME.test(t.table) && MD5.test(t.hash)) &&
    new Set(intended.map(t => journalHash({ table: t.table, pk: t.pk }))).size === intended.length, 'SQL_TARGETS_INVALID');
  need(same(removed.map(journalHash).sort(), intended.map(journalHash).sort()), 'SQL_REMOVED_MANIFEST_MISMATCH');
  need(post?.readOnly === true && post.sourceUrl === sourceUrl && Number.isFinite(Date.parse(post.at)) &&
    post.remainingExactRows === 0 && post.exactRowsChecked === plan.targets.length &&
    post.protectedRequest?.id === LIVE_AUTH_CLEANUP.preservedRequestId && MD5.test(post.protectedRequest.fullRowMd5 || '') &&
    SHA.test(post.posCatalogSha256 || '') && SHA.test(post.authDependencyCatalogSha256 || '') &&
    Array.isArray(post.posFingerprints) && post.posFingerprints.length === 64 && new Set(post.posFingerprints.map(t => t.table)).size === 64 &&
    post.posFingerprints.every(t => NAME.test(t.table) && Number.isSafeInteger(t.row_count) && t.row_count >= 0 && MD5.test(t.full_rows_md5)) &&
    journalHash(post.posFingerprints.map(t => t.table).sort().join('\n')) === SNAPSHOT_TABLES_SHA256 &&
    Array.isArray(post.nonTargetAuthIds) && same([...post.nonTargetAuthIds].sort(), [...plan.authBaseline.ids].sort()) &&
    post.foreignAuthFingerprint?.row_count === plan.authBaseline.ids.length && MD5.test(post.foreignAuthFingerprint.full_rows_md5 || ''),
  'SQL_POSTCHECK_PROTECTION_REQUIRED');
  const ownerCatalog = post.storageOwnerCatalog;
  need(Array.isArray(ownerCatalog) && ownerCatalog.length >= 2 && new Set(ownerCatalog.map(ownerKey)).size === ownerCatalog.length &&
    ownerCatalog.every(c => /^storage\.[a-z_][a-z0-9_]*$/.test(c.relation) && ['owner', 'owner_id'].includes(c.column) && ['uuid','text'].includes(c.type)) &&
    ['owner', 'owner_id'].every(column => ownerCatalog.some(c => c.relation === 'storage.objects' && c.column === column)), 'STORAGE_CATALOG_REQUIRED');
  const revision = post.snapshotRevision;
  function validRevision(r, fingerprints) {
    const table = fingerprints.find(t => t.table === 'online_snapshot_revision');
    return r && typeof r.value === 'string' && /^[0-9]+$/.test(r.value) && MD5.test(r.other_fields_md5 || '') &&
      MD5.test(r.full_row_md5 || '') && r.delta_per_delete === 7 && SHA.test(r.contract_sha256 || '') &&
      table?.row_count === 1 && table.full_rows_md5 === md5(r.full_row_md5);
  }
  // Live H166 contract: five SET NULL and two CASCADE statement invalidations,
  // including statements that affect zero rows. The read-only validator proves
  // this from the complete FK/trigger/function catalogue; never assume arbitrary advances.
  need(validRevision(revision, post.posFingerprints), 'REVISION_BASELINE_REQUIRED');
  const evidenceSha256 = journalHash({ identityEvidence, identityEvidenceFileSha256, proof });
  const attempts = id => journal.snapshot().entries.filter(e => e.identities?.userId === id &&
    (e.kind === LIVE_AUTH_CLEANUP.attemptKind || e.command?.action === 'GoTrueAdmin.deleteUser'));
  const assertTarget = id => need(permitted.has(id) && id !== SNAPSHOT_ACTOR && !plan.authBaseline.ids.includes(id), 'TARGET_FORBIDDEN');
  function assertAge(at) {
    const age = now() - Date.parse(at);
    need(Number.isFinite(age) && age >= -5000 && age <= maxPreflightAgeMs, 'PREFLIGHT_STALE');
  }
  async function inspect(id, absenceObserved = false) {
    const response = reportOf(await preflight(id)); assertAge(response?.at);
    need(response?.project_ref === plan.projectRef && response.source_url === sourceUrl && response.read_only === 'on' &&
      response.current_user === 'postgres' && response.session_user === 'postgres' && response.database === 'postgres', 'PREFLIGHT_CONTEXT');
    need(response.real_actor_exists === true && response.real_actor_can_manage === true &&
      same(response.protected_request, post.protectedRequest) && response.pos_catalog_sha256 === post.posCatalogSha256 &&
      response.auth_dependency_catalog_sha256 === post.authDependencyCatalogSha256 &&
      Array.isArray(response.pos_fingerprints) && response.pos_fingerprints.length === 64 &&
      same(posHashes(response.pos_fingerprints.filter(t => t.table !== 'online_snapshot_revision')),
        posHashes(post.posFingerprints.filter(t => t.table !== 'online_snapshot_revision'))) &&
      same(response.foreign_auth_fingerprint, post.foreignAuthFingerprint) && Array.isArray(response.non_target_auth_ids) &&
      same([...response.non_target_auth_ids].sort(), [...post.nonTargetAuthIds].sort()), 'PROTECTED_STATE_CHANGED');
    const currentRevision = response.snapshot_revision;
    need(validRevision(currentRevision, response.pos_fingerprints) && currentRevision.other_fields_md5 === revision.other_fields_md5 &&
      currentRevision.contract_sha256 === revision.contract_sha256, 'REVISION_CONTRACT_CHANGED');
    const verified = new Set(journal.snapshot().entries.filter(e => e.kind === LIVE_AUTH_CLEANUP.observationKind &&
      e.command?.planSha256 === planSha256 && e.command.state === 'ABSENT_VERIFIED' && e.command.attemptRecorded === true &&
      permitted.has(e.identities?.userId) && attempts(e.identities.userId).length > 0).map(e => e.identities.userId));
    if (absenceObserved && attempts(id).length > 0) verified.add(id);
    need(BigInt(currentRevision.value) === BigInt(revision.value) + BigInt(revision.delta_per_delete * verified.size) &&
      (verified.size > 0 || currentRevision.full_row_md5 === revision.full_row_md5), 'REVISION_UNEXPLAINED_DELTA');
    const catalog = response.fk_catalog;
    need(Array.isArray(catalog) && catalog.length === fkKeys.length && catalog.every(f => f.validated === true &&
      same(f.referenced_columns, ['id']) && Array.isArray(f.columns) && f.columns.length === 1) &&
      same(catalog.map(f => fkKey({ ...f, column: f.columns[0] })).sort(), fkKeys), 'FK_CATALOG_CHANGED');
    const counts = response.fk_counts?.filter(c => c.id === id);
    need(counts?.length === fkKeys.length && same(counts.map(fkKey).sort(), fkKeys) &&
      counts.every(c => Number.isSafeInteger(c.rows) && c.rows >= 0), 'FK_COUNTS_INCOMPLETE');
    need(counts.every(c => c.relation.startsWith('auth.') || c.rows === 0), 'POS_DEPENDENCIES_REMAIN');
    need(response.storage_owner_catalog_complete === true && Array.isArray(response.storage_owner_catalog) &&
      same(response.storage_owner_catalog.map(ownerKey).sort(), ownerCatalog.map(ownerKey).sort()), 'STORAGE_CATALOG_CHANGED');
    const owners = response.storage_owner_counts?.filter(c => c.id === id);
    need(owners?.length === ownerCatalog.length && same(owners.map(ownerKey).sort(), ownerCatalog.map(ownerKey).sort()) &&
      owners.every(c => c.rows === 0), 'STORAGE_OWNERSHIP_REMAINS_OR_UNKNOWN');
    return { response, sha256: journalHash(response) };
  }
  async function lookup(id) {
    assertAdmin();
    try {
      const value = await admin.getUserById(id);
      if (value?.error?.status === 404 && !value?.data?.user) return { state: 'ABSENT_VERIFIED', status: 404 };
      if (!value?.error && value?.data?.user?.id === id) return { state: 'PRESENT', user: value.data.user };
      return { state: 'UNKNOWN', status: Number.isInteger(value?.error?.status) ? value.error.status : null };
    } catch { return { state: 'UNKNOWN', status: null }; }
  }
  function assertIdentity(user, id) {
    const row = identityMap.get(id);
    need(user.id === id && typeof user.email === 'string' && journalHash(user.email.trim().toLowerCase()) === row.emailSha256 &&
      user.created_at === row.createdAt && same(markers(user), row.qaMarkers) &&
      journalHash({ user: user.user_metadata || {}, app: user.app_metadata || {} }) === row.metadataSha256, 'LIVE_IDENTITY_CHANGED');
  }
  async function record(id, observation, extra = {}) {
    const result = { id, state: observation.state, status: observation.status ?? null, deletionAttributed: false, ...extra };
    await journal.prepare({ kind: LIVE_AUTH_CLEANUP.observationKind, actorId: plan.actorId,
      checkpoint: 'H171 new Auth absence observation', identities: { userId: id },
      command: { ...result, planSha256, evidenceSha256 } });
    return result;
  }
  async function reconcileInternal(id) {
    const observation = await lookup(id);
    let checked;
    try { checked = await inspect(id, observation.state === 'ABSENT_VERIFIED'); }
    catch (cause) { return record(id, { state: 'REVIEW_REQUIRED' }, { absenceObserved: observation.state === 'ABSENT_VERIFIED',
      reason: /^LIVE_AUTH_[A-Z_]+$/.test(cause.code || '') ? cause.code : 'LIVE_AUTH_POSTCHECK_UNAVAILABLE', reconciled: true }); }
    return record(id, observation.state === 'PRESENT' ? { state: 'REVIEW_REQUIRED', status: 200 } : observation,
      { reconciled: true, attemptRecorded: attempts(id).length > 0, preflightSha256: checked.sha256 });
  }
  async function retireInternal(id) {
    assertTarget(id); assertJournal();
    if (attempts(id).length) return reconcileInternal(id);
    const checked = await inspect(id), present = await lookup(id);
    if (present.state === 'ABSENT_VERIFIED') {
      const absentCheck = await inspect(id);
      return record(id, present, { alreadyAbsent: true, preflightSha256: absentCheck.sha256 });
    }
    need(present.state === 'PRESENT', 'GET_UNCERTAIN_NO_DELETE'); assertIdentity(present.user, id);
    const last = await inspect(id), finalIdentity = await lookup(id);
    need(finalIdentity.state === 'PRESENT', 'FINAL_GET_UNCERTAIN_NO_DELETE'); assertIdentity(finalIdentity.user, id);
    let dispatchStarted = false;
    try {
      await journal.beforeMutation({ kind: LIVE_AUTH_CLEANUP.attemptKind, checkpoint: 'H171 exact NEW Auth retirement',
        requestId: id, actorId: plan.actorId, identities: { userId: id }, command: { action: 'GoTrueAdmin.deleteUser',
          userId: id, shouldSoftDelete: false, run: plan.run, projectRef: plan.projectRef, artifactSha256: plan.artifactSha256,
          planSha256, evidenceSha256, identitySha256: journalHash(identityMap.get(id)), preflightSha256: last.sha256 } }, async () => {
        assertJournal(); need(attempts(id).length === 1, 'DUPLICATE_DURABLE_ATTEMPT'); assertAge(last.response.at); assertAdmin();
        dispatchStarted = true; await admin.deleteUser(id, false);
      });
    } catch (cause) { if (!dispatchStarted) throw cause; /* Never repeat an uncertain DELETE. */ }
    return reconcileInternal(id);
  }
  let busy = false;
  async function exclusive(work) { need(!busy, 'BUSY'); busy = true; try { return await work(); } finally { busy = false; } }
  return Object.freeze({ retireOne: id => exclusive(() => retireInternal(id)),
    reconcile: id => exclusive(async () => { assertTarget(id); assertJournal();
      need(attempts(id).length > 0, 'NO_RECORDED_ATTEMPT'); return reconcileInternal(id); }),
    retireAll: () => exclusive(async () => { const results = [];
      // The account is removed first, keeping the run principal available longest.
      for (const id of [...ids].sort((a,b) => Number(a === plan.actorId) - Number(b === plan.actorId))) {
        const result = await retireInternal(id); results.push(result); if (result.state !== 'ABSENT_VERIFIED') break;
      }
      return { authAbsenceVerified: results.length === ids.length && results.every(r => r.state === 'ABSENT_VERIFIED'),
        certified: false, liveGateOpened: false, sqlAndAuthAtomic: false, results };
    }) });
}
