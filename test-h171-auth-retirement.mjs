// Local fakes only. No credentials, network or production mutations.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import * as fs from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { openLiveJournal, journalHash } from './h171-live-journal.mjs';
import { AUTH_RETIREMENT as C, AUTH_INCOMING_FKS, buildAuthIdentityBaseline,
  buildAuthRetirementPreflightSql, createAuthRetirement } from './h171-auth-retirement.mjs';

const readJson = async path => JSON.parse((await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const provenance = await readJson('docs/fixes/evidence/h171-auth-tech-provenance.json');
const ids = [...provenance.exactAuthIds].sort();
const time = Date.parse('2026-09-14T00:00:00.000Z');
const hash = value => createHash('md5').update(value).digest('hex');
const scratchRoot = resolve('.evidence-h171-private');
await fs.mkdir(scratchRoot, { recursive: true });
const scratch = await fs.mkdtemp(join(scratchRoot, 'auth-retirement-test-'));
const checks = [];
let reviewedIdentityEvidence;
const checked = (name, fn) => test(name, async () => { await fn(); checks.push({ name, status: 'PASS' }); });
const users = () => new Map(ids.map((id, i) => [id, { id, email: `local-only-${i}@example.invalid`,
  created_at: new Date(time - 86_400_000).toISOString(),
  user_metadata: { balam_online_test: provenance.exactRuns[i % provenance.exactRuns.length] }, app_metadata: {} }]));
const baselines = map => [...map.values()].map(user => ({ id: user.id, emailMd5: hash(user.email),
  createdAt: user.created_at, qaMetadata: structuredClone(user.user_metadata) }));
function ready(identities) {
  return { projectRef: C.projectRef, ownerApprovalSha256: journalHash('LOCAL_FAKE_APPROVAL'),
    identityEvidence: { baselineSha256: journalHash(identities), auditSha256: journalHash('LOCAL_FAKE_AUDIT'),
      inventorySha256: journalHash('LOCAL_FAKE_INVENTORY') },
    commercial: { status: 'COMMITTED_AND_VERIFIED', removedRows: 149, remainingExactRows: 0,
      backupSha256: C.commercialBackupSha256, manifestMd5: C.commercialManifestMd5,
      evidenceSha256: journalHash('LOCAL_FAKE_COMMERCIAL'), postcheckSha256: journalHash('LOCAL_FAKE_POSTCHECK') },
    technical: { status: 'COMMITTED_AND_VERIFIED', removedRows: 317, remainingExactRows: 0,
      canonicalBackupSha256: C.canonicalBackupSha256, heldRecoveries: 2, protectedHistoryRows: 18, implicitCascadeRows: 0,
      evidenceSha256: journalHash('LOCAL_FAKE_TECHNICAL'), postcheckSha256: journalHash('LOCAL_FAKE_POSTCHECK') } };
}
function validPreflight() {
  return { project_ref: C.projectRef, at: new Date(time).toISOString(), read_only: 'on',
    real_actor_exists: true, real_actor_can_manage: true, protected_request_id: C.preservedRequestId,
    protected_request_md5: C.preservedRequestMd5,
    fk_catalog: AUTH_INCOMING_FKS.map(fk => ({ relation: fk.relation, effect: fk.effect,
      columns: [fk.column], referenced_columns: ['id'], validated: true })),
    fk_counts: ids.flatMap(id => AUTH_INCOMING_FKS.map(fk => ({ ...fk, id, rows: fk.relation.startsWith('auth.') ? 1 : 0 }))) };
}
async function fixture(options = {}) {
  const map = users(), identities = baselines(map), run = randomUUID();
  const file = join(scratch, run + '.json');
  const journalOptions = { file, run, projectRef: C.projectRef, artifactSha256: C.artifactSha256, ...(options.io ? { io: options.io } : {}) };
  let journal = await openLiveJournal(journalOptions);
  const calls = { gets: [], deletes: [] };
  const state = { map, identities, readiness: ready(identities), preflight: validPreflight(), now: time };
  const admin = {
    url: `https://${C.projectRef}.supabase.co/auth/v1`,
    async getUserById(id) { calls.gets.push(id);
      return options.get ? options.get(id, state, calls) : map.has(id)
        ? { data: { user: structuredClone(map.get(id)) }, error: null }
        : { data: { user: null }, error: { status: 404, message: 'Not found' } }; },
    async deleteUser(id, soft) {
      assert.equal(soft, false);
      // Read the actual installed journal file before allowing the fake side effect.
      const persisted = await readJson(file);
      assert.equal(persisted.entries.filter(e => e.kind === 'auth-retire-attempt' && e.identities.userId === id).length, 1);
      calls.deletes.push(id);
      if (options.remove) return options.remove(id, state, calls);
      map.delete(id); return { data: { user: { id } }, error: null };
    },
  };
  const make = overrides => createAuthRetirement({ admin, journal, provenance, identities,
    readiness: state.readiness, now: () => state.now, preflight: async () => structuredClone(state.preflight), ...overrides });
  return { ...state, state, calls, admin, file, make, get journal() { return journal; },
    async reopen() { await journal.close(); journal = await openLiveJournal(journalOptions); },
    close: () => journal.close() };
}
const withFixture = async (options, fn) => { const f = await fixture(options); try { await fn(f); } finally { await f.close(); } };

checked('exact eleven scope and real actor exclusion fail before any API call', () => withFixture({}, async f => {
  assert.throws(() => f.make({ provenance: { ...provenance, projectRef: 'anotherproject' } }), /SCOPE_MISMATCH/);
  assert.throws(() => f.make({ provenance: { ...provenance, exactAuthIds: [...ids.slice(1), C.realActorId] } }), /SCOPE_MISMATCH/);
  await assert.rejects(f.make().retireOne(C.realActorId), /TARGET_FORBIDDEN/);
  assert.deepEqual(f.calls, { gets: [], deletes: [] });
}));
checked('requires BALAM GoTrue admin and artifact-bound durable journal', () => withFixture({}, async f => {
  assert.throws(() => f.make({ admin: { ...f.admin, url: 'https://elsewhere.invalid/auth/v1' } }), /GOTRUE_ADMIN/);
  assert.throws(() => f.make({ journal: { ...f.journal, snapshot: () => ({ projectRef: 'foreign' }) } }), /JOURNAL_IDENTITY/);
}));
checked('149 and 317 commit plus verification evidence are mandatory', () => withFixture({}, async f => {
  for (const mutate of [r => r.commercial.status = 'ROLLED_BACK', r => r.technical.removedRows = 316,
    r => r.commercial.remainingExactRows = 1, r => r.technical.postcheckSha256 = '',
    r => r.ownerApprovalSha256 = '', r => r.identityEvidence.baselineSha256 = journalHash('wrong'),
    r => r.technical.heldRecoveries = 0]) {
    const readiness = structuredClone(f.readiness); mutate(readiness);
    await assert.rejects(f.make({ readiness }).retireOne(ids[0]), /AUTH_/);
  }
  assert.deepEqual(f.calls, { gets: [], deletes: [] });
}));
checked('eleven exact hard deletions persist intent first, verify404, and survive reopen without retry', () => withFixture({}, async f => {
  const first = await f.make().retireAll();
  assert.equal(first.complete, true); assert.equal(first.results.length, 11);
  assert.deepEqual(f.calls.deletes, ids);
  const encoded = await fs.readFile(f.file, 'utf8');
  assert.equal(encoded.includes('@example.invalid'), false);
  assert.equal(encoded.includes('Not found'), false);
  await f.reopen();
  assert.equal((await f.make().retireAll()).complete, true);
  assert.deepEqual(f.calls.deletes, ids);
}));
checked('already absent explicit404 is recorded without delete', () => withFixture({}, async f => {
  f.map.delete(ids[0]);
  assert.equal((await f.make().retireOne(ids[0])).alreadyAbsent, true);
  assert.equal(f.calls.deletes.length, 0);
}));
checked('completed real request7054 is preserved and its already absent QA target is never deleted again', () => withFixture({}, async f => {
  const target='6dd83591-9e6b-482f-95e0-78470766cbce';
  f.map.delete(target);
  f.state.preflight.protected_request_md5=C.preservedRequestMd5BeforeCompletion;
  await assert.rejects(f.make().retireOne(target), /PROTECTED_HISTORY_CHANGED/);
  assert.deepEqual(f.calls.deletes, []);
  f.state.preflight.protected_request_md5=C.preservedRequestMd5;
  const observation=await f.make().retireOne(target);
  assert.equal(observation.state,'ABSENT_VERIFIED');assert.equal(observation.alreadyAbsent,true);
  assert.deepEqual(f.calls.deletes, []);
}));
checked('committed delete with lost response reconciles absence and never repeats', () => withFixture({
  remove: (id, s) => { s.map.delete(id); throw new Error('LOCAL response lost'); },
}, async f => {
  assert.equal((await f.make().retireOne(ids[0])).state, 'ABSENT_VERIFIED');
  await f.reopen(); assert.equal((await f.make().reconcile(ids[0])).state, 'ABSENT_VERIFIED');
  assert.deepEqual(f.calls.deletes, [ids[0]]);
}));
checked('uncertain GET after deletion remains UNKNOWN and reconciliation performs reads only', () => withFixture({
  get: (id, state) => state.map.has(id) ? { data: { user: structuredClone(state.map.get(id)) }, error: null }
    : { data: { user: null }, error: { status: 503 } },
}, async f => {
  assert.equal((await f.make().retireOne(ids[0])).state, 'UNKNOWN');
  await f.reopen(); assert.equal((await f.make().reconcile(ids[0])).state, 'UNKNOWN');
  assert.deepEqual(f.calls.deletes, [ids[0]]);
}));
checked('uncertain delete which leaves user present stops bulk and cannot retry', () => withFixture({
  remove: () => ({ data: { user: null }, error: { status: 500, message: 'LOCAL sensitive error' } }),
}, async f => {
  const result = await f.make().retireAll();
  assert.equal(result.complete, false); assert.equal(result.results.length, 1);
  assert.equal(result.results[0].state, 'REVIEW_REQUIRED');
  await f.reopen(); assert.equal((await f.make().retireOne(ids[0])).state, 'REVIEW_REQUIRED');
  assert.deepEqual(f.calls.deletes, [ids[0]]);
  assert.equal((await fs.readFile(f.file, 'utf8')).includes('sensitive'), false);
}));
checked('null user200, GET500 and thrown404 are not verified absence', async () => {
  for (const get of [() => ({ data: { user: null }, error: null }),
    () => ({ data: { user: null }, error: { status: 500 } }), () => { throw { status: 404 }; }]) {
    await withFixture({ get }, async f => {
      await assert.rejects(f.make().retireOne(ids[0]), /GET_UNCERTAIN/); assert.equal(f.calls.deletes.length, 0);
    });
  }
});
checked('identity drift in email, QA marker or creation date prevents delete', async () => {
  for (const mutate of [u => u.email = 'different@example.invalid', u => u.user_metadata.balam_online_test = randomUUID(),
    u => u.created_at = new Date(time).toISOString(), u => u.app_metadata.balam_account_request_id = randomUUID()]) {
    await withFixture({}, async f => { mutate(f.map.get(ids[0]));
      await assert.rejects(f.make().retireOne(ids[0]), /LIVE_IDENTITY_MISMATCH/); assert.equal(f.calls.deletes.length, 0); });
  }
});
checked('all pos FK effects including SET NULL and CASCADE block when rows remain', async () => {
  for (const fk of AUTH_INCOMING_FKS.filter(fk => fk.relation.startsWith('pos.'))) {
    await withFixture({}, async f => {
      f.state.preflight.fk_counts.find(row => row.id === ids[0] && row.relation === fk.relation && row.column === fk.column).rows = 1;
      await assert.rejects(f.make().retireOne(ids[0]), /POS_DEPENDENCIES_REMAIN/); assert.equal(f.calls.deletes.length, 0);
    });
  }
});
checked('catalog additions, omissions, invalid constraints, missing counts and stale evidence fail closed', async () => {
  for (const mutate of [p => p.fk_catalog.push({ relation: 'foreign.history', columns: ['actor_id'], effect: 'n', referenced_columns: ['id'], validated: true }),
    p => p.fk_catalog.pop(), p => p.fk_catalog[0].validated = false, p => p.fk_counts.shift(),
    p => p.at = new Date(time - 120_001).toISOString(), p => p.read_only = 'off']) {
    await withFixture({}, async f => { mutate(f.state.preflight);
      await assert.rejects(f.make().retireOne(ids[0]), /AUTH_/); assert.equal(f.calls.deletes.length, 0); });
  }
});
checked('real actor and original7054 pending history are checked before and after delete', async () => {
  await withFixture({}, async f => { f.state.preflight.protected_request_md5 = '0'.repeat(32);
    await assert.rejects(f.make().retireOne(ids[0]), /PROTECTED_HISTORY_CHANGED/); assert.equal(f.calls.deletes.length, 0); });
  await withFixture({ remove: (id, s) => { s.map.delete(id); s.preflight.real_actor_exists = false; } }, async f => {
    const result = await f.make().retireOne(ids[0]);
    assert.equal(result.state, 'REVIEW_REQUIRED'); assert.equal(result.absenceObserved, true);
  });
});
checked('durable write failure occurs before dispatch and remains latched', async () => {
  let armed = false;
  const io = { ...fs, open: async (path, ...args) => {
    if (armed && String(path).endsWith('.pending')) throw Object.assign(new Error('LOCAL disk failure'), { code: 'EIO' });
    return fs.open(path, ...args);
  } };
  await withFixture({ io }, async f => { armed = true;
    await assert.rejects(f.make().retireOne(ids[0]), /JOURNAL_PERSISTENCE_FAILED/);
    assert.equal(f.calls.deletes.length, 0);
  });
});
checked('crash after durable intent before dispatch resumes by GET only', () => withFixture({}, async f => {
  await f.journal.prepare({ kind: 'auth-retire-attempt', checkpoint: 'LOCAL simulated crash', requestId: ids[0],
    identities: { userId: ids[0] }, command: { action: 'LOCAL intent with no dispatch' } });
  await f.reopen();
  assert.equal((await f.make().retireOne(ids[0])).state, 'REVIEW_REQUIRED');
  assert.equal(f.calls.deletes.length, 0);
}));
checked('failure to persist observation leaves durable attempt available for read-only reconciliation', () => withFixture({}, async f => {
  const broken = { ...f.journal, prepare: async () => { throw new Error('LOCAL observation disk failure'); } };
  await assert.rejects(f.make({ journal: broken }).retireOne(ids[0]), /observation disk failure/);
  await f.reopen();
  assert.equal((await f.make().reconcile(ids[0])).state, 'ABSENT_VERIFIED');
  assert.deepEqual(f.calls.deletes, [ids[0]]);
}));
checked('concurrent calls reject and never dispatch the same target twice', () => withFixture({}, async f => {
  const api = f.make();
  const result = await Promise.allSettled([api.retireOne(ids[0]), api.retireOne(ids[0])]);
  assert.equal(result.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(result.find(x => x.status === 'rejected').reason.code, 'AUTH_RETIREMENT_BUSY');
  assert.deepEqual(f.calls.deletes, [ids[0]]);
}));
checked('two factories sharing one journal still dispatch at most once', () => withFixture({}, async f => {
  await Promise.allSettled([f.make().retireOne(ids[0]), f.make().retireOne(ids[0])]);
  assert.equal(f.calls.deletes.length <= 1, true);
}));
checked('recorded intent is not dispatched after preflight expires during persistence', () => withFixture({}, async f => {
  const delayed = { ...f.journal, beforeMutation: (descriptor, mutate) => f.journal.beforeMutation(descriptor, entry => {
    f.state.now += 120_001; return mutate(entry);
  }) };
  await assert.rejects(f.make({ journal: delayed }).retireOne(ids[0]), /PREFLIGHT_EXPIRED/);
  assert.equal(f.calls.deletes.length, 0);
  f.state.now = time;
  assert.equal((await f.make().retireOne(ids[0])).state, 'REVIEW_REQUIRED');
  assert.equal(f.calls.deletes.length, 0);
}));
checked('reviewed identity projection covers eleven IDs and six QA runs with no raw email', async () => {
  const authorityAudit = await readJson('docs/fixes/evidence/h171/authority-audit-before.json');
  const inventory = await readJson('docs/fixes/evidence/h171/auth-tech-before.json');
  const identities = buildAuthIdentityBaseline({ provenance, authorityAudit, inventory });
  assert.deepEqual(identities.map(row => row.id), ids);
  assert.equal(identities.every(row => /^[a-f0-9]{32}$/.test(row.emailMd5)), true);
  assert.equal(identities.find(row => row.id === '54633260-578a-4228-b7d1-4e36e6c49144').qaMetadata.balam_sync_test,
    'b766e373-5279-4e4a-818e-0934a4f8757c');
  reviewedIdentityEvidence = { baselineSha256: journalHash(identities),
    auditSha256: createHash('sha256').update(await fs.readFile('docs/fixes/evidence/h171/authority-audit-before.json')).digest('hex'),
    inventorySha256: createHash('sha256').update(await fs.readFile('docs/fixes/evidence/h171/auth-tech-before.json')).digest('hex') };
});
checked('preflight SQL executes read-only against local PostgreSQL and inventories FK drift', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE SCHEMA auth; CREATE SCHEMA pos; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,created_at timestamptz,raw_user_meta_data jsonb,raw_app_meta_data jsonb);');
    const grouped = Map.groupBy(AUTH_INCOMING_FKS, row => row.relation);
    for (const [table, fks] of grouped) {
      const effects = { a: 'NO ACTION', c: 'CASCADE', n: 'SET NULL' };
      await db.exec(`CREATE TABLE ${table}(${fks.map(fk => `${fk.column} uuid REFERENCES auth.users(id) ON DELETE ${effects[fk.effect]}`).join(',')});`);
    }
    await db.exec(`CREATE TABLE pos.online_account_requests(request_id uuid PRIMARY KEY);
      CREATE FUNCTION pos.can_manage_screen_permissions(uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';`);
    await db.query('INSERT INTO auth.users VALUES($1,$2,$3,$4,$5)', [ids[0], 'sql-fixture@example.invalid', new Date(time), {}, {}]);
    await db.query('INSERT INTO auth.identities VALUES($1)', [ids[0]]);
    const sql = buildAuthRetirementPreflightSql(provenance);
    const before = (await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n;
    const results = await db.exec(sql);
    const report = results.find(result => result.rows[0]?.report)?.rows[0].report;
    assert.equal(report.read_only, 'on'); assert.equal(report.fk_catalog.length, 18); assert.equal(report.fk_counts.length, 198);
    assert.equal(report.fk_counts.find(row => row.id === ids[0] && row.relation === 'auth.identities').rows, 1);
    assert.equal(report.identities[0].email_md5, hash('sql-fixture@example.invalid'));
    assert.equal(JSON.stringify(report).includes('sql-fixture@example.invalid'), false);
    assert.equal((await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n, before);
    await db.exec('CREATE TABLE pos.new_dependency(owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL);');
    const changed = (await db.exec(sql)).find(result => result.rows[0]?.report)?.rows[0].report;
    assert.equal(changed.fk_catalog.length, 19);
    await fs.writeFile('docs/fixes/evidence/h171-auth-retirement-preflight.sql', sql);
  } finally { await db.close(); }
});

after(async () => {
  const proof = { at: new Date().toISOString(), scope: 'LOCAL_ONLY_NO_NETWORK_NO_AUTH_MUTATIONS',
    moduleSha256: journalHash(await fs.readFile('h171-auth-retirement.mjs', 'utf8')),
    testSha256: journalHash(await fs.readFile('test-h171-auth-retirement.mjs', 'utf8')),
    preflightSqlSha256: journalHash(await fs.readFile('docs/fixes/evidence/h171-auth-retirement-preflight.sql', 'utf8')),
    reviewedIdentityEvidence, checksPassed: checks.length, expectedChecks: 22, checks,
    limits: ['Injected GoTrue and fake readiness do not certify remote retirement.',
      'PGlite validates SELECT behavior on synthetic schema; live dependencies still require fresh remote evidence.',
      'SQL preflight and GoTrue deletion are separate transactions; no atomic cross-service lock is claimed.'] };
  await fs.writeFile('docs/fixes/evidence/h171-auth-retirement-local-validation.json', JSON.stringify(proof, null, 2) + '\n');
  const within = relative(scratchRoot, resolve(scratch));
  assert.ok(within && !within.startsWith('..') && !resolve(scratch).endsWith(scratchRoot));
  await fs.rm(scratch, { recursive: true, force: true });
});
