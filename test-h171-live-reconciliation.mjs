// H171 local PostgreSQL canonicalization and controlled read clients. No live HTTP.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import { openLiveJournal, journalHash } from './h171-live-journal.mjs';
import { createLiveReconciler, postgresJsonbText, postgresJsonbHash } from './h171-live-reconciliation.mjs';

const workspace = resolve('.'), root = await fs.mkdtemp(join(workspace, '.h171-reconciliation-test-'));
const projectRef = 'telohdbvbvsfmwyriflz', origin = 'https://' + projectRef + '.supabase.co';
const results = []; let number = 0;
const edgeSource = await fs.readFile('supabase/functions/admin-users/index.ts', 'utf8');
const edgeStart = edgeSource.indexOf('const canonical ='), edgeEnd = edgeSource.indexOf('const initials =', edgeStart);
assert.ok(edgeStart >= 0 && edgeEnd > edgeStart);
const actualProfileRequestId = vm.runInThisContext('(function(){' + stripTypeScriptTypes(edgeSource.slice(edgeStart, edgeEnd)) + ';return profileRequestId;})()');
async function fixture() {
  const run = randomUUID(), actorId = randomUUID(), prefix = 'qa-h164-' + run;
  const journal = await openLiveJournal({ file: join(root, String(++number), 'journal.json'), run, projectRef, artifactSha256: journalHash('local artifact') });
  const manifest = { run, prefix, userId: actorId, email: prefix + '@example.test',
    installations: ['A', 'B', 'C'].map(letter => prefix + '-' + letter), sellers: [prefix + '-admin', ...['A', 'B', 'C'].map(letter => prefix + '-seller-' + letter)], createdAccountIds: [] };
  const users = new Map([[actorId, { id: actorId, email: manifest.email, user_metadata: { balam_online_test: run }, app_metadata: {}, banned_until: null }]]);
  const tables = { online_requests: [], online_account_requests: [], sync_devices: manifest.installations.map(device_id => ({ device_id, user_id: actorId, client_build: 'synthetic-build', status: 'online', metadata: { online_only: true } })) };
  const calls = [], counters = { forbidden: 0 };
  const forbid = () => { counters.forbidden++; throw Error('NO MUTATION OR BROAD AUTH LOOKUP ALLOWED'); };
  const db = { url: origin + '/rest/v1', schemaName: 'pos', rpc: forbid,
    from(table) {
      const filters = {}, query = { select() { return query; }, eq(key, value) { filters[key] = value; return query; },
        async limit(count) {
          calls.push({ table, filters: structuredClone(filters), count });
          const data = (tables[table] || []).filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
          return { data: structuredClone(data.slice(0, count)), error: null };
        }, insert: forbid, upsert: forbid, update: forbid, delete: forbid,
      }; return query;
    },
  };
  const admin = { supabaseUrl: origin, auth: { admin: { async getUserById(id) {
    calls.push({ authUserId: id }); return users.has(id) ? { data: { user: structuredClone(users.get(id)) }, error: null } : { data: {}, error: { code: 'user_not_found' } };
  }, createUser: forbid, updateUserById: forbid, deleteUser: forbid, listUsers: forbid } } };
  async function add(kind, command, identities = {}, requestId = randomUUID()) {
    return journal.prepare({ kind, checkpoint: 'controlled scenario', actorId, requestId, command, identities });
  }
  async function online(command, state = 'confirmed', response = {}) {
    const signed = { ...command, expectedActorId: actorId }, requestId = randomUUID();
    const entry = await add('rpc:execute_online_command', signed, { requestId }, requestId);
    const receipt = { actor_id: actorId, request_id: requestId, device_id: manifest.installations[0], command_kind: signed.type,
      command_hash: postgresJsonbHash(signed), state, response: { ok: state === 'confirmed', requestId,
        ...(state === 'confirmed' ? { result: response } : { error: { code: 'CONTROLLED_REJECTION' } }) } };
    tables.online_requests.push(receipt); return { entry, receipt };
  }
  async function reconcile(options = {}) {
    const client = createLiveReconciler({ db, admin, expectedProjectRef: projectRef, expectedActorId: actorId, ...options });
    const report = await client.reconcile({ snapshot: journal.snapshot(), fixtures: manifest });
    assert.equal(counters.forbidden, 0); assert.equal(report.certified, false); assert.equal(report.cleanupVerified, false);
    assert.equal(report.cleanupManifestComplete, false); return report;
  }
  return { run, actorId, prefix, journal, manifest, users, tables, calls, counters, db, admin, add, online, reconcile };
}
async function checkCase(name, action) {
  try { await action(); results.push({ name, pass: true }); }
  catch (cause) { results.push({ name, pass: false, error: cause.message, stack: cause.stack }); }
}

await checkCase('Command canonicalization matches local PostgreSQL jsonb text for actual wire shapes and numeric edge cases', async () => {
  const pg = new PGlite();
  try {
    for (const value of [
      { type: 'folio', prefix: 'VTA', businessDate: '2026-09-12', documentKind: 'sale', floor: 0, expectedActorId: randomUUID() },
      { type: 'sale', header: { folio: 'QA-TEST-1', total: 348, descuentos_adicionales: [] }, items: [{ qty: 3, precio: 116, product_id: 'synthetic' }], expectedActorId: randomUUID() },
      { type: 'config', settings: [{ key: 'qa.h164.synthetic', value: 'synthetic' }], lookup: [], expectedVersion: 4 },
      { z: 1e21, aa: 1e-7, é: 3.25, '😀': '\b\n\t"\\', a: -0, long: -1.25e30, short: 5e-324, max: Number.MAX_VALUE },
      [null, true, false, { zz: -1e-23, abc: [1, 2.5], a: 'BALAM' }],
    ]) {
      const { rows } = await pg.query('select $1::jsonb::text as canonical', [JSON.stringify(value)]);
      assert.equal(postgresJsonbText(value), rows[0].canonical);
      assert.equal(postgresJsonbHash(value), journalHash(rows[0].canonical));
    }
  } finally { await pg.close(); }
});

await checkCase('Lost client ACK reconciles from exact confirmed sale receipt and exports server child IDs', async () => {
  const f = await fixture();
  try {
    const operationId = randomUUID(), folio = 'SYNTHETIC-001';
    const { entry } = await f.online({ type: 'sale', operationId, header: { folio }, items: [{ product_id: 'synthetic-product', qty: 3, precio: 116 }], reserveStock: true }, 'confirmed',
      { ok: true, idempotent: false, products: [{ id: 'synthetic-product', stock: 9 }], clients: [], sellers: [] });
    f.tables.sales = [{ folio, operation_id: operationId, total: 348 }];
    f.tables.sale_items = [{ id: 1711, folio, product_id: 'synthetic-product', qty: 3 }];
    f.tables.sale_payments = [{ id: 'synthetic-payment', folio, monto: 348 }];
    f.tables.movements = [{ id: 1712, ref: folio, cant: -3 }];
    f.tables.sale_commits = [{ commit_id: entry.requestId, operation_id: operationId, folio }];
    f.tables.stock_reservations = [{ operation_id: operationId, folio }];
    await f.add('rpc:resolve_online_request', { p_request_id: entry.requestId }, { requestId: entry.requestId }, entry.requestId);
    const report = await f.reconcile();
    assert.equal(report.reconciled, true); assert.equal(report.entries.length, 2);
    for (const [table, pk] of [['sale_items', { id: 1711 }], ['sale_payments', { id: 'synthetic-payment' }], ['movements', { id: 1712 }], ['sale_commits', { commit_id: entry.requestId }]])
      assert.ok(report.identities.rows.some(row => row.table === table && JSON.stringify(row.pk) === JSON.stringify(pk)));
    assert.ok(report.identities.rows.every(row => row.ownership === 'UNCLASSIFIED'));
    assert.ok(f.calls.filter(call => call.table === 'online_requests').every(call => call.filters.actor_id === f.actorId));
  } finally { await f.journal.close(); }
});

for (const [name, mutate, code] of [
  ['absent receipt', f => { f.tables.online_requests = []; }, 'REQUEST_ABSENT_UNCERTAIN'],
  ['executing receipt', f => { f.tables.online_requests[0].state = 'executing'; }, 'REQUEST_NOT_TERMINAL'],
  ['another actor receipt', f => { f.tables.online_requests[0].actor_id = randomUUID(); }, 'REQUEST_ABSENT_UNCERTAIN'],
  ['different command under the same request', f => { f.tables.online_requests[0].command_hash = '0'.repeat(64); }, 'RECEIPT_COMMAND_MISMATCH'],
  ['inconsistent response identity', f => { f.tables.online_requests[0].response.requestId = randomUUID(); }, 'RECEIPT_STATE_RESPONSE_MISMATCH'],
]) {
  await checkCase(name + ' remains uncertain with no replay or resolver RPC', async () => {
    const f = await fixture();
    try {
      await f.online({ type: 'folio', prefix: 'VTA' }, 'confirmed', { ok: true, folio: 'SYNTHETIC-001' }); mutate(f);
      const report = await f.reconcile(); assert.equal(report.reconciled, false); assert.ok(report.blockers.some(row => row.code === code));
      assert.equal(f.counters.forbidden, 0); assert.equal(report.identities.rows.length, 0);
    } finally { await f.journal.close(); }
  });
}

await checkCase('Rejected and authoritative cancellation receipts are terminal without inventing successful writes', async () => {
  const f = await fixture();
  try {
    await f.online({ type: 'upsert', kind: 'products', rows: [{ id: 'synthetic-product' }] }, 'rejected');
    const requestId = randomUUID();
    await f.add('rpc:resolve_online_request', { p_request_id: requestId }, { requestId }, requestId);
    f.tables.online_requests.push({ actor_id: f.actorId, request_id: requestId, command_hash: null, state: 'cancelled',
      response: { ok: false, requestId, notExecuted: true, error: { code: 'REQUEST_NOT_EXECUTED' } } });
    const report = await f.reconcile(); assert.equal(report.reconciled, true);
    assert.deepEqual(report.entries.map(row => row.authorityState), ['rejected', 'cancelled']);
    assert.deepEqual(report.identities.rows, []);
  } finally { await f.journal.close(); }
});

await checkCase('Run, journal chain and fixture identity mismatch reject before any read', async () => {
  for (const mutation of [f => { f.manifest.run = randomUUID(); }, f => { f.manifest.userId = randomUUID(); }, f => { f.manifest.installations[0] = 'other-device'; }]) {
    const f = await fixture();
    try {
      await f.online({ type: 'folio' }, 'confirmed', { folio: 'SYNTHETIC-1' }); mutation(f);
      const report = await f.reconcile(); assert.equal(report.reconciled, false); assert.equal(f.calls.length, 0);
    } finally { await f.journal.close(); }
  }
  const f = await fixture();
  try {
    await f.online({ type: 'folio' }, 'confirmed', { folio: 'SYNTHETIC-1' });
    const snapshot = f.journal.snapshot(); snapshot.entries[0].command.prefix = 'tampered';
    const report = await createLiveReconciler({ db: f.db, admin: f.admin, expectedProjectRef: projectRef, expectedActorId: f.actorId }).reconcile({ snapshot, fixtures: f.manifest });
    assert.equal(report.reconciled, false); assert.equal(f.calls.length, 0);
  } finally { await f.journal.close(); }
});

await checkCase('A different configured project or schema is refused before any SDK operation', async () => {
  const f = await fixture();
  try {
    assert.throws(() => createLiveReconciler({ db: f.db, admin: { ...f.admin, supabaseUrl: 'https://different.invalid' }, expectedProjectRef: projectRef, expectedActorId: f.actorId }), { code: 'CLIENT_PROJECT_MISMATCH' });
    assert.throws(() => createLiveReconciler({ db: { ...f.db, schemaName: 'public' }, admin: f.admin, expectedProjectRef: projectRef, expectedActorId: f.actorId }), { code: 'CLIENT_SCHEMA_MISMATCH' });
    assert.equal(f.calls.length, 0);
  } finally { await f.journal.close(); }
});

await checkCase('A real/protected Auth identity cannot be promoted to QA by its email alone', async () => {
  for (const protectedIdentity of [false, true]) {
    const f = await fixture();
    try {
      await f.add('auth-create', { qaRun: f.run, emailSha256: journalHash(f.manifest.email) }, { userId: f.actorId });
      if (!protectedIdentity) f.users.get(f.actorId).user_metadata = {};
      const report = await f.reconcile({ protectedAuthIds: protectedIdentity ? [f.actorId] : [] });
      assert.equal(report.reconciled, false); assert.equal(report.identities.authUsers.length, 0);
      assert.equal(f.calls.length, protectedIdentity ? 0 : 1);
    } finally { await f.journal.close(); }
  }
});

async function preparedAccount(f) {
  const requestId = randomUUID(), id = randomUUID(), email = f.prefix + '-account@example.test';
  const command = { type: 'profileUpdate', kind: 'sellers', rows: [{ id: null, nombre: f.prefix + ' Account', email, role: 'vendedor' }], accountRequestId: requestId, expectedActorId: f.actorId };
  await f.add('edge:admin-users:create', { requestId, action: 'create', emailSha256: journalHash(email) }, { requestId }, requestId);
  f.tables.online_account_requests.push({ actor_id: f.actorId, request_id: requestId, action: 'create', state: 'completed', target_user_id: id,
    payload: { action: 'create', id: null, email, profileCommand: command }, result: { ok: true, id, requestId } });
  f.users.set(id, { id, email, user_metadata: {}, app_metadata: { balam_account_request_id: requestId } });
  f.tables.sellers = [{ id, email, role: 'vendedor', active: true }];
  const childId = await actualProfileRequestId(requestId);
  const childCommand = structuredClone(command); childCommand.rows[0].id = id;
  f.tables.online_requests.push({ actor_id: f.actorId, request_id: childId, state: 'confirmed', command_kind: 'profileUpdate', command_hash: postgresJsonbHash(childCommand),
    response: { ok: true, requestId: childId, result: [{ id, email, active: true }] } });
  return { requestId, id, childId };
}

await checkCase('Lost account ACK discovers exact Auth target and the server-generated profile request without listUsers', async () => {
  const f = await fixture();
  try {
    const account = await preparedAccount(f);
    assert.deepEqual(f.manifest.createdAccountIds, [], 'Simulate the client never receiving target UUID');
    const report = await f.reconcile(); assert.equal(report.reconciled, true);
    assert.ok(report.identities.authUsers.some(row => row.id === account.id));
    assert.ok(report.identities.requests.some(row => row.requestId === account.childId));
    assert.equal(JSON.stringify(report).includes(f.prefix + '-account@example.test'), false);
    assert.equal(f.counters.forbidden, 0);
  } finally { await f.journal.close(); }
});

await checkCase('Account needs_review, foreign target marker or protected target remains blocked', async () => {
  for (const mode of ['needs_review', 'wrong-marker', 'protected']) {
    const f = await fixture();
    try {
      const account = await preparedAccount(f);
      if (mode === 'needs_review') f.tables.online_account_requests[0].state = 'needs_review';
      if (mode === 'wrong-marker') f.users.get(account.id).app_metadata.balam_account_request_id = randomUUID();
      const report = await f.reconcile({ protectedAuthIds: mode === 'protected' ? [account.id] : [] });
      assert.equal(report.reconciled, false); assert.equal(report.identities.authUsers.some(row => row.id === account.id), false);
    } finally { await f.journal.close(); }
  }
});

await checkCase('Node profiles, roles and retirement verify final state while a password rotation stays unverifiable', async () => {
  const f = await fixture();
  try {
    const profile = { id: f.prefix + '-admin', nombre: f.prefix + ' Admin', email: f.manifest.email, role: 'admin', active: true, sync_base_version: 0 };
    await f.add('auth-create', { emailSha256: journalHash(f.manifest.email), qaRun: f.run }, { userId: f.actorId });
    await f.add('profile-provisioning', { rows: [profile] }, { profileIds: [profile.id] });
    await f.add('role-provisioning', { role_code: 'admin', active: true }, { userId: f.actorId });
    await f.add('qa-retirement-sql', { sqlSha256: journalHash('controlled retirement SQL') }, { userIds: [f.actorId], profileIds: [profile.id] });
    await f.add('auth-ban', { ban_duration: '876000h' }, { userId: f.actorId });
    f.users.get(f.actorId).banned_until = '2999-01-01T00:00:00Z';
    f.tables.sellers = [{ ...profile, active: false, sync_base_version: 20 }];
    f.tables.user_permission_role_assignments = [{ user_id: f.actorId, role_code: 'admin', active: true }];
    let report = await f.reconcile(); assert.equal(report.reconciled, true); assert.ok(report.entries.every(row => row.state === 'OBSERVED_FINAL_STATE' && row.acknowledgementClaimed === false));
    f.tables.sellers[0].role = 'vendedor';
    report = await f.reconcile(); assert.equal(report.reconciled, false); assert.ok(report.blockers.some(row => row.code === 'PROFILE_FINAL_CONTENT_MISMATCH'));
    f.tables.sellers[0].role = 'admin';
    await f.add('auth-login-rotation', { credentialRotation: true, ban_duration: 'none' }, { userId: f.actorId });
    report = await f.reconcile(); assert.equal(report.reconciled, false); assert.ok(report.blockers.some(row => row.code === 'UNVERIFIABLE_CREDENTIAL_CHANGE'));
  } finally { await f.journal.close(); }
});

await checkCase('Exact devices reconcile final adoption state and reject an actor change', async () => {
  const f = await fixture();
  try {
    const id = f.manifest.installations[0], before = { revision: 1, state: 'working', stage: 'snapshot', remainingLegacy: 0, archivedCount: 0 };
    const after = { ...before, state: 'ready', stage: 'complete', snapshotAt: '2026-09-12T00:00:00Z' };
    await f.add('rpc:online_presence', { p_device_id: id, p_client_build: 'synthetic-build' }, { deviceId: id });
    await f.add('rpc:online_adoption_report', { p_device_id: id, p_report: before }, { deviceId: id });
    const last = await f.add('rpc:online_adoption_report', { p_device_id: id, p_report: after }, { deviceId: id });
    f.tables.sync_devices[0].metadata.online_adoption = { ...after, serverTime: '2026-09-12T00:00:01Z' };
    let report = await f.reconcile(); assert.equal(report.reconciled, true); assert.equal(report.entries[1].supersededBy, last.sequence);
    f.tables.sync_devices[0].user_id = randomUUID();
    report = await f.reconcile(); assert.equal(report.reconciled, false); assert.ok(report.blockers.every(row => row.code === 'DEVICE_QA_PROVENANCE_MISMATCH'));
  } finally { await f.journal.close(); }
});

await checkCase('Unknown intent/command and a confirmed resolver without original command never reconcile', async () => {
  const f = await fixture();
  try {
    await f.add('unregistered-node-write', {}, {});
    await f.online({ type: 'unregistered-command' }, 'rejected');
    const requestId = randomUUID(); await f.add('rpc:resolve_online_request', { p_request_id: requestId }, { requestId }, requestId);
    f.tables.online_requests.push({ actor_id: f.actorId, request_id: requestId, command_kind: 'sale', state: 'confirmed', response: { ok: true, requestId, result: { ok: true } } });
    const report = await f.reconcile(); assert.equal(report.reconciled, false);
    assert.deepEqual(report.blockers.map(row => row.code), ['INTENT_TYPE_UNSUPPORTED', 'COMMAND_TYPE_UNSUPPORTED', 'RESOLUTION_ORIGINAL_COMMAND_MISSING']);
  } finally { await f.journal.close(); }
});

await checkCase('Direct abandoned account preparation reconciles only its exact hash and terminal advance', async () => {
  const f = await fixture();
  try {
    const requestId = randomUUID(), payload = { action: 'create', email: f.prefix + '-startup@example.test', nombre: f.prefix + ' Startup', role: 'vendedor' };
    await f.add('account-prepare', payload, { requestId, userId: f.actorId }, requestId);
    await f.add('account-advance', { state: 'rejected', targetUserId: null }, { requestId, userId: f.actorId }, requestId);
    const receipt = { actor_id: f.actorId, request_id: requestId, action: 'create', payload, payload_hash: journalHash(payload),
      state: 'rejected', target_user_id: null, result: { ok: false, error: 'controlled abandonment before Auth write' } };
    f.tables.online_account_requests.push(receipt);
    let report = await f.reconcile(); assert.equal(report.reconciled, true); assert.deepEqual(report.entries.map(row => row.authorityState), ['rejected', 'rejected']);
    receipt.payload_hash = '0'.repeat(64);
    report = await f.reconcile(); assert.equal(report.reconciled, false); assert.ok(report.blockers.some(row => row.code === 'ACCOUNT_PREPARATION_HASH_MISMATCH'));
    receipt.payload_hash = journalHash(payload); receipt.state = 'prepared'; receipt.result = null;
    report = await f.reconcile(); assert.equal(report.reconciled, false); assert.ok(report.blockers.every(row => row.code === 'ACCOUNT_NOT_TERMINAL'));
  } finally { await f.journal.close(); }
});

await checkCase('Permission receipt exports exact composite override PKs only for a verified created QA account', async () => {
  const f = await fixture();
  try {
    const account = await preparedAccount(f);
    await f.online({ type: 'permissions', rpc: 'admin_apply_user_screen_permissions_checked', args: {
      p_target_user_id: account.id, p_role_code: 'vendedor', p_overrides: { reportes: 'deny' }, p_expected_version: 'synthetic-before', p_screen_keys: ['reportes'] },
    }, 'confirmed', { ok: true, permission_version: 'synthetic-after' });
    f.tables.user_permission_role_assignments = [{ user_id: account.id, role_code: 'vendedor', active: true }];
    f.tables.user_screen_permission_overrides = [{ user_id: account.id, screen_key: 'reportes', effect: 'deny' }];
    const report = await f.reconcile(); assert.equal(report.reconciled, true);
    assert.ok(report.identities.rows.some(row => row.table === 'user_screen_permission_overrides' && row.pk.user_id === account.id && row.pk.screen_key === 'reportes'));
    assert.equal(f.counters.forbidden, 0);
  } finally { await f.journal.close(); }
});

await checkCase('Batch responses export child entity IDs and rejected batches do not admit unknown child commands', async () => {
  const f = await fixture();
  try {
    await f.online({ type: 'batch', commands: [
      { type: 'upsert', kind: 'products', rows: [{ id: 'synthetic-product' }] },
      { type: 'upsert', kind: 'clients', rows: [{ id: 'synthetic-client' }] },
    ] }, 'confirmed', [{ ok: true, products: [{ id: 'synthetic-product' }] }, [{ id: 'synthetic-client' }]]);
    let report = await f.reconcile(); assert.equal(report.reconciled, true);
    assert.ok(report.identities.rows.some(row => row.table === 'products' && row.pk.id === 'synthetic-product'));
    assert.ok(report.identities.rows.some(row => row.table === 'clients' && row.pk.id === 'synthetic-client'));
    await f.online({ type: 'batch', commands: [{ type: 'unregistered-command' }] }, 'rejected');
    report = await f.reconcile(); assert.equal(report.reconciled, false); assert.ok(report.blockers.some(row => row.code === 'COMMAND_TYPE_UNSUPPORTED'));
  } finally { await f.journal.close(); }
});

await checkCase('A changed exact row observed twice is detected instead of silently replacing its first hash', async () => {
  const f = await fixture();
  try {
    const id = f.manifest.installations[0];
    await f.add('rpc:online_presence', { p_device_id: id, p_client_build: 'synthetic-build' }, { deviceId: id });
    await f.add('rpc:online_presence', { p_device_id: id, p_client_build: 'synthetic-build' }, { deviceId: id });
    let reads = 0;
    const originalFrom = f.db.from;
    f.db.from = table => {
      const query = originalFrom(table), originalLimit = query.limit;
      query.limit = async count => {
        if (table === 'sync_devices' && ++reads === 2) f.tables.sync_devices[0].last_seen_at = '2026-09-12T00:00:01Z';
        return originalLimit(count);
      }; return query;
    };
    const report = await f.reconcile(); assert.equal(report.reconciled, false);
    assert.ok(report.blockers.some(row => row.code === 'OBSERVED_ROW_CHANGED_DURING_RECONCILIATION'));
  } finally { await f.journal.close(); }
});

await checkCase('A full PostgREST page is uncertain rather than silently accepting truncated children', async () => {
  const f = await fixture();
  try {
    const folio = 'SYNTHETIC-PAGE-LIMIT';
    const { entry } = await f.online({ type: 'sale', header: { folio } }, 'confirmed', { ok: true, products: [], clients: [], sellers: [] });
    f.tables.sales = [{ folio, total: 1000 }];
    f.tables.sale_items = Array.from({ length: 1000 }, (_, id) => ({ id: id + 1, folio, qty: 1 }));
    f.tables.sale_commits = [{ commit_id: entry.requestId, folio }];
    const report = await f.reconcile(); assert.equal(report.reconciled, false);
    assert.ok(report.blockers.some(row => row.code === 'EXACT_SCOPE_ROW_LIMIT'));
  } finally { await f.journal.close(); }
});

function exactFixturePlan(f) {
  f.manifest.products = Array.from({ length: 9 }, () => randomUUID());
  const productIds = f.manifest.products.slice(7);
  f.manifest.coreJourney = { schema: 'h171-core-ui-v1', productIds, referenceFamilyId: productIds[0], initialStocks: [3, 2], unitPrice: 116 };
  return { kind: 'fixture-plan', checkpoint: 'bootstrap / exact product identities before provisioning', requestId: f.run,
    identities: { productIds: f.manifest.products, coreJourneyProductIds: productIds },
    command: { run: f.run, coreJourney: structuredClone(f.manifest.coreJourney) } };
}
await checkCase('Exact fixture-plan is metadata only and never creates a receipt or commercial ownership claim', async () => {
  const f = await fixture();
  try {
    const plan = exactFixturePlan(f);
    await f.journal.prepare(plan);
    // A resumed run can repeat the immutable plan; UI result fields are not metadata.
    f.manifest.coreJourney.steps = { pass: true }; f.manifest.coreJourney.print = { pass: true };
    await f.journal.prepare(plan);
    const report = await f.reconcile(); assert.equal(report.reconciled, true);
    assert.equal(report.entries.length, 2);
    for (const entry of report.entries) {
      assert.equal(entry.state, 'METADATA_ONLY'); assert.equal(entry.acknowledgementClaimed, false);
      assert.equal(entry.observedMutations, false); assert.equal(entry.identityAttribution, 'NONE');
    }
    for (const collection of ['rows', 'requests', 'devices', 'folios']) assert.deepEqual(report.identities[collection], []);
    assert.equal(f.calls.filter(call => call.table).length, 0); // Only exact QA principal identity is read.
    assert.deepEqual(f.calls, [{ authUserId: f.actorId }]);
  } finally { await f.journal.close(); }
});
await checkCase('Foreign or mutable fixture-plan metadata is rejected before any authority read', async () => {
  for (const mutate of [
    plan => { plan.command.run = randomUUID(); },
    plan => { plan.identities.productIds = [...plan.identities.productIds]; plan.identities.productIds[0] = randomUUID(); },
    plan => { plan.command.coreJourney.referenceFamilyId = randomUUID(); },
    plan => { plan.command.coreJourney.initialStocks = [100, 100]; },
    plan => { plan.command.mutates = true; },
    plan => { plan.contextName = 'browser'; },
    plan => { plan.actorId = randomUUID(); },
  ]) {
    const f = await fixture();
    try {
      const plan = exactFixturePlan(f); mutate(plan); await f.journal.prepare(plan);
      const report = await f.reconcile(); assert.equal(report.reconciled, false);
      assert.ok(report.blockers.some(row => /^FIXTURE_PLAN_(METADATA|CONTEXT)_MISMATCH$/.test(row.code)));
      assert.deepEqual(report.identities.rows, []); assert.deepEqual(f.calls, []);
    } finally { await f.journal.close(); }
  }
});

const failed = results.filter(row => !row.pass);
const report = { scope: 'Local PGlite canonicalization; actual durable journal; controlled exact SELECT and Auth-read clients',
  moduleSha256: journalHash(await fs.readFile(new URL('./h171-live-reconciliation.mjs', import.meta.url), 'utf8')),
  accountEdgeSourceSha256: journalHash(edgeSource),
  testSha256: journalHash(await fs.readFile(import.meta.filename, 'utf8')), certified: false, realSupabaseWrites: 0,
  tests: results.length, passed: results.length - failed.length, failed: failed.length, results };
if (failed.length) { report.preservedFailureDirectory = root; process.exitCode = 1; }
else { assert.equal(dirname(root), workspace); assert.ok(root.startsWith(workspace + sep) && root.includes('.h171-reconciliation-test-')); await fs.rm(root, { recursive: true, force: true }); }
const evidence = resolve(process.env.BALAM_RECONCILIATION_EVIDENCE || 'docs/fixes/evidence/h171/live-reconciliation.json');
await fs.mkdir(dirname(evidence), { recursive: true }); await fs.writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
