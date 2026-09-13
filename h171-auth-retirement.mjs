// Node-only, dependency-injected H171 Auth retirement. Importing/running this
// file performs no I/O. The caller owns GoTrue credentials and remote evidence.
import { createHash } from 'node:crypto';
import { journalHash } from './h171-live-journal.mjs';

export const AUTH_RETIREMENT = Object.freeze({
  projectRef: 'telohdbvbvsfmwyriflz',
  artifactSha256: 'cf32a52c56c5cacadc536bc151993f2efc5bcebbd2608089cee0a0bc92139437',
  scopeSha256: '476edcffad4114a194a0add09ff082a25996fd76b5734f1613e89ec75a5e18b6',
  realActorId: '3f24222e-fd74-4ed2-b56f-f298af574b1e',
  preservedRequestId: '70549527-4867-4342-94d2-38e770b0f2a9',
  // Existing real-actor delete7054 completed after commercial149, independently
  // of this adapter. Preserve that completed history; never reset/replay it.
  // Evidence: h171/request7054-completion-inspection.json.
  preservedRequestMd5: '8fdc987d8fe491f467f968da4c5306e0',
  preservedRequestMd5BeforeCompletion: '331b08f4f73f7480c93f57ffd3bf88e1',
  commercialBackupSha256: '6a6c9b084af4432c22f313a5bb908ab54a9e1104c47ba6ea09b597252d92d825',
  commercialManifestMd5: 'dab9b6aec5240e1d00501207313bd6e2',
  canonicalBackupSha256: 'b37b3f4cf8518d5ab87754a48e60c62fab9418a23d396157cbe80530ba86b326',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const MD5 = /^[a-f0-9]{32}$/;
const META = ['balam_online_test', 'balam_sync_test', 'balam_account_request_id'];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireValue = (ok, code) => { if (!ok) fail(code); };
const md5 = text => createHash('md5').update(text).digest('hex');
const reportOf = value => value?.rows?.[0]?.report || value;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

export const AUTH_INCOMING_FKS = Object.freeze([
  ...['identities', 'mfa_factors', 'oauth_authorizations', 'oauth_consents',
    'one_time_tokens', 'sessions', 'webauthn_challenges', 'webauthn_credentials']
    .map(table => ({ relation: 'auth.' + table, column: 'user_id', effect: 'c' })),
  { relation: 'pos.capability_operation_audit', column: 'actor_user_id', effect: 'a' },
  ...['permission_roles', 'role_screen_permissions', 'screen_permission_catalog_state',
    'user_capability_overrides', 'user_permission_role_assignments', 'user_screen_permission_overrides']
    .map(table => ({ relation: 'pos.' + table, column: 'updated_by', effect: 'n' })),
  ...['user_capability_overrides', 'user_permission_role_assignments', 'user_screen_permission_overrides']
    .map(table => ({ relation: 'pos.' + table, column: 'user_id', effect: 'c' })),
].map(Object.freeze));
const fkKey = row => `${row.relation}|${row.column}|${row.effect}`;
const fkKeys = AUTH_INCOMING_FKS.map(fkKey).sort();

function exactScope(provenance) {
  const ids = [...(provenance?.exactAuthIds || [])].sort();
  requireValue(provenance?.projectRef === AUTH_RETIREMENT.projectRef && ids.length === 11 &&
    new Set(ids).size === 11 && ids.every(id => UUID.test(id)) &&
    !ids.includes(AUTH_RETIREMENT.realActorId) && journalHash(ids.join('\n')) === AUTH_RETIREMENT.scopeSha256,
  'AUTH_RETIREMENT_SCOPE_MISMATCH');
  return ids;
}

// These are projections of reviewed evidence, not proof of permission by themselves.
// H148's early UNKNOWN label was superseded by the combined provenance document.
export function buildAuthIdentityBaseline({ provenance, authorityAudit, inventory }) {
  const ids = exactScope(provenance);
  const audit = reportOf(authorityAudit), census = reportOf(inventory);
  return ids.map(id => {
    const candidates = (audit?.auth_candidates || []).filter(row => row.user_id === id);
    const metadata = (census?.auth_metadata || []).filter(row => row.id === id);
    requireValue(candidates.length === 1 && metadata.length === 1, 'AUTH_IDENTITY_EVIDENCE_INCOMPLETE');
    return { id, emailMd5: candidates[0].email_md5, createdAt: metadata[0].created_at,
      qaMetadata: Object.fromEntries(META.filter(k => own(metadata[0].qa_metadata, k))
        .map(k => [k, metadata[0].qa_metadata[k]])) };
  });
}

export function createAuthRetirement({ admin, journal, provenance, identities, readiness, preflight,
  now = () => Date.now(), maxPreflightAgeMs = 120_000 }) {
  const ids = exactScope(provenance), permitted = new Set(ids);
  const assertAdmin = () => requireValue(typeof admin?.getUserById === 'function' && typeof admin?.deleteUser === 'function' &&
    admin.url?.replace(/\/$/, '') === `https://${AUTH_RETIREMENT.projectRef}.supabase.co/auth/v1`,
  'AUTH_GOTRUE_ADMIN_REQUIRED');
  assertAdmin();
  requireValue(typeof journal?.beforeMutation === 'function' && typeof journal?.prepare === 'function' &&
    typeof journal?.snapshot === 'function' && typeof journal?.assertHealthy === 'function', 'AUTH_DURABLE_JOURNAL_REQUIRED');
  const initialJournal = journal.snapshot();
  requireValue(initialJournal.projectRef === AUTH_RETIREMENT.projectRef &&
    initialJournal.artifactSha256 === AUTH_RETIREMENT.artifactSha256, 'AUTH_JOURNAL_IDENTITY_MISMATCH');
  requireValue(typeof preflight === 'function' && typeof now === 'function' &&
    Number.isFinite(maxPreflightAgeMs) && maxPreflightAgeMs > 0 && maxPreflightAgeMs <= 120_000,
  'AUTH_PREFLIGHT_REQUIRED');
  const baseline = structuredClone(identities || []).sort((a, b) => a.id.localeCompare(b.id));
  requireValue(baseline.length === 11 && baseline.every((row, i) => row.id === ids[i] &&
    MD5.test(row.emailMd5) && Number.isFinite(Date.parse(row.createdAt)) &&
    row.qaMetadata && Object.keys(row.qaMetadata).length > 0 &&
    Object.entries(row.qaMetadata).every(([k, v]) => META.includes(k) && UUID.test(v) &&
      (k === 'balam_account_request_id' || provenance.exactRuns.includes(v)))), 'AUTH_IDENTITY_BASELINE_INVALID');
  const identityMap = new Map(baseline.map(row => [row.id, row]));
  const proof = structuredClone(readiness || {});
  function assertReady() {
    journal.assertHealthy();
    requireValue(proof.projectRef === AUTH_RETIREMENT.projectRef && SHA.test(proof.ownerApprovalSha256 || '') &&
      proof.identityEvidence?.baselineSha256 === journalHash(baseline) &&
      SHA.test(proof.identityEvidence?.auditSha256 || '') && SHA.test(proof.identityEvidence?.inventorySha256 || ''),
    'AUTH_RETIREMENT_EVIDENCE_REQUIRED');
    for (const [kind, count] of [['commercial', 149], ['technical', 317]]) {
      const item = proof[kind];
      requireValue(item?.status === 'COMMITTED_AND_VERIFIED' && item.removedRows === count &&
        item.remainingExactRows === 0 && SHA.test(item.evidenceSha256 || '') && SHA.test(item.postcheckSha256 || ''),
      'AUTH_PRIOR_CLEANUP_NOT_VERIFIED');
    }
    requireValue(proof.commercial.backupSha256 === AUTH_RETIREMENT.commercialBackupSha256 &&
      proof.commercial.manifestMd5 === AUTH_RETIREMENT.commercialManifestMd5 &&
      proof.technical.canonicalBackupSha256 === AUTH_RETIREMENT.canonicalBackupSha256 &&
      proof.technical.heldRecoveries === 2 && proof.technical.protectedHistoryRows === 18 &&
      proof.technical.implicitCascadeRows === 0, 'AUTH_CLEANUP_SCOPE_MISMATCH');
  }
  const evidenceSha256 = journalHash(proof);
  let busy = false;
  const attempts = id => journal.snapshot().entries.filter(e => e.kind === 'auth-retire-attempt' && e.identities?.userId === id);
  function assertTarget(id) {
    requireValue(permitted.has(id) && id !== AUTH_RETIREMENT.realActorId, 'AUTH_TARGET_FORBIDDEN');
  }
  async function inspect(id) {
    const response = reportOf(await preflight(id));
    const age = now() - Date.parse(response?.at);
    requireValue(response?.project_ref === AUTH_RETIREMENT.projectRef && response.read_only === 'on' &&
      Number.isFinite(age) && age >= -5000 && age <= maxPreflightAgeMs, 'AUTH_PREFLIGHT_STALE_OR_FOREIGN');
    requireValue(response.real_actor_exists === true && response.real_actor_can_manage === true &&
      response.protected_request_id === AUTH_RETIREMENT.preservedRequestId &&
      response.protected_request_md5 === AUTH_RETIREMENT.preservedRequestMd5,
    'AUTH_PROTECTED_HISTORY_CHANGED');
    const catalog = response.fk_catalog;
    requireValue(Array.isArray(catalog) && catalog.length === fkKeys.length &&
      catalog.every(fk => fk.validated === true && JSON.stringify(fk.referenced_columns) === '["id"]' &&
        Array.isArray(fk.columns) && fk.columns.length === 1) &&
      JSON.stringify(catalog.map(fk => fkKey({ ...fk, column: fk.columns[0] })).sort()) === JSON.stringify(fkKeys),
    'AUTH_FK_CATALOG_CHANGED');
    const counts = response.fk_counts?.filter(row => row.id === id);
    requireValue(counts?.length === fkKeys.length && JSON.stringify(counts.map(fkKey).sort()) === JSON.stringify(fkKeys) &&
      counts.every(row => Number.isSafeInteger(row.rows) && row.rows >= 0), 'AUTH_FK_COUNTS_INCOMPLETE');
    requireValue(counts.every(row => row.relation.startsWith('auth.') || row.rows === 0), 'AUTH_POS_DEPENDENCIES_REMAIN');
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
    const expected = identityMap.get(id);
    const actualMeta = {};
    for (const k of META) {
      const source = k === 'balam_account_request_id' ? user.app_metadata : user.user_metadata;
      if (own(source, k)) actualMeta[k] = source[k];
    }
    requireValue(user.id === id && typeof user.email === 'string' && md5(user.email) === expected.emailMd5 &&
      Date.parse(user.created_at) === Date.parse(expected.createdAt) &&
      journalHash(actualMeta) === journalHash(expected.qaMetadata), 'AUTH_LIVE_IDENTITY_MISMATCH');
  }
  async function record(id, observation, extra = {}) {
    const result = { id, state: observation.state, status: observation.status ?? null, ...extra };
    await journal.prepare({ kind: 'auth-retire-observation', checkpoint: 'H171 Auth absence observation',
      identities: { userId: id }, command: result });
    return result;
  }
  async function reconcileInternal(id) {
    // A durable attempt makes DELETE permanently ineligible in this ledger,
    // even if the process died between recording intent and dispatching it.
    const observation = await lookup(id);
    let protectedState;
    try { protectedState = await inspect(id); }
    catch (cause) { return record(id, { state: 'REVIEW_REQUIRED' }, { absenceObserved: observation.state === 'ABSENT_VERIFIED', reason: cause.code || 'AUTH_POSTCHECK_FAILED' }); }
    return record(id, observation.state === 'PRESENT' ? { state: 'REVIEW_REQUIRED', status: 200 } : observation,
      { reconciled: true, preflightSha256: protectedState.sha256 });
  }
  async function retireInternal(id) {
    assertTarget(id); assertReady();
    if (attempts(id).length) return reconcileInternal(id);
    const checked = await inspect(id);
    const present = await lookup(id);
    if (present.state === 'ABSENT_VERIFIED') return record(id, present, { alreadyAbsent: true, preflightSha256: checked.sha256 });
    requireValue(present.state === 'PRESENT', 'AUTH_GET_UNCERTAIN_NO_DELETE');
    assertIdentity(present.user, id);
    // Recheck SQL after the live identity read and immediately before the durable intent.
    const lastCheck = await inspect(id);
    let dispatchStarted = false;
    try {
      await journal.beforeMutation({ kind: 'auth-retire-attempt', checkpoint: 'H171 exact QA Auth retirement',
        requestId: id, identities: { userId: id }, command: { action: 'GoTrueAdmin.deleteUser', userId: id,
          shouldSoftDelete: false, identitySha256: journalHash(identityMap.get(id)), evidenceSha256,
          preflightSha256: lastCheck.sha256, scopeSha256: AUTH_RETIREMENT.scopeSha256 } }, async () => {
        requireValue(attempts(id).length === 1, 'AUTH_DUPLICATE_DURABLE_ATTEMPT');
        requireValue(now() - Date.parse(lastCheck.response.at) <= maxPreflightAgeMs, 'AUTH_PREFLIGHT_EXPIRED_BEFORE_DISPATCH');
        assertAdmin();
        dispatchStarted = true;
        // No automatic retry, including errors which might follow a committed deletion.
        await admin.deleteUser(id, false);
      });
    } catch (cause) {
      if (!dispatchStarted) throw cause;
      // The raw SDK response/error is deliberately never written to the ledger.
    }
    return reconcileInternal(id);
  }
  async function exclusive(work) {
    requireValue(!busy, 'AUTH_RETIREMENT_BUSY'); busy = true;
    try { return await work(); } finally { busy = false; }
  }
  return Object.freeze({
    retireOne: id => exclusive(() => retireInternal(id)),
    reconcile: id => exclusive(async () => { assertTarget(id); journal.assertHealthy();
      requireValue(attempts(id).length > 0, 'AUTH_NO_RECORDED_ATTEMPT'); return reconcileInternal(id); }),
    retireAll: () => exclusive(async () => {
      const results = [];
      for (const id of ids) { const result = await retireInternal(id); results.push(result);
        if (result.state !== 'ABSENT_VERIFIED') break; }
      return { complete: results.length === 11 && results.every(r => r.state === 'ABSENT_VERIFIED'), results };
    }),
  });
}

// Only SELECTs inside a read-only transaction. Counts include Auth-owned
// dependents without ever reading their bodies, sessions, credentials or keys.
export function buildAuthRetirementPreflightSql(provenance) {
  const ids = exactScope(provenance);
  const targets = ids.map(id => `('${id}'::uuid)`).join(',');
  const counts = AUTH_INCOMING_FKS.map(fk => `SELECT t.id, '${fk.relation}'::text relation,
 '${fk.column}'::text "column", '${fk.effect}'::text effect, count(d.${fk.column}) rows
 FROM targets t LEFT JOIN ${fk.relation} d ON d.${fk.column}=t.id GROUP BY t.id`).join('\nUNION ALL\n');
  return `-- H171 exact Auth retirement preflight; no mutation or credentials.
BEGIN READ ONLY;
SET LOCAL statement_timeout='60s';
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO, MDY';
WITH targets(id) AS (VALUES ${targets}), fk_counts AS (${counts}),
fk_catalog AS (
 SELECT n.nspname||'.'||r.relname relation, c.confdeltype::text effect, c.convalidated validated,
  (SELECT jsonb_agg(a.attname ORDER BY u.ord) FROM unnest(c.conkey) WITH ORDINALITY u(attnum,ord)
   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=u.attnum) columns,
  (SELECT jsonb_agg(a.attname ORDER BY u.ord) FROM unnest(c.confkey) WITH ORDINALITY u(attnum,ord)
   JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=u.attnum) referenced_columns
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
 WHERE c.contype='f' AND c.confrelid='auth.users'::regclass
)
SELECT jsonb_build_object('audit','H171 Auth retirement preflight','at',clock_timestamp(),
 'project_ref','${AUTH_RETIREMENT.projectRef}','read_only',current_setting('transaction_read_only'),
 'real_actor_exists',EXISTS(SELECT 1 FROM auth.users WHERE id='${AUTH_RETIREMENT.realActorId}'::uuid),
 'real_actor_can_manage',pos.can_manage_screen_permissions('${AUTH_RETIREMENT.realActorId}'::uuid),
 'protected_request_id','${AUTH_RETIREMENT.preservedRequestId}',
 'protected_request_md5',(SELECT md5(to_jsonb(t)::text) FROM pos.online_account_requests t WHERE request_id='${AUTH_RETIREMENT.preservedRequestId}'::uuid),
 'fk_catalog',(SELECT jsonb_agg(to_jsonb(t) ORDER BY relation,columns::text) FROM fk_catalog t),
 'fk_counts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id,relation,"column") FROM fk_counts t),
 'identities',(SELECT jsonb_agg(jsonb_build_object('id',u.id,'email_md5',md5(u.email),
  'created_at',u.created_at,'qa_metadata',jsonb_strip_nulls(jsonb_build_object(
   'balam_online_test',u.raw_user_meta_data->'balam_online_test',
   'balam_sync_test',u.raw_user_meta_data->'balam_sync_test',
   'balam_account_request_id',u.raw_app_meta_data->'balam_account_request_id'))) ORDER BY u.id)
  FROM auth.users u JOIN targets t ON t.id=u.id)
) report;
COMMIT;
`;
}
