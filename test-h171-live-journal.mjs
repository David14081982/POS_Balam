// H171 local evidence only. All browser HTTP is intercepted; no live authority.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { openLiveJournal, journalHash, LIVE_READ_RPCS } from './h171-live-journal.mjs';

const workspace = resolve('.');
const root = await fs.mkdtemp(join(workspace, '.h171-live-journal-test-'));
const identity = { run: randomUUID(), projectRef: 'telohdbvbvsfmwyriflz', artifactSha256: journalHash('synthetic local artifact') };
const origin = 'https://' + identity.projectRef + '.supabase.co';
const actorId = randomUUID();
const meta = { origin, actorId, contextName: 'A', checkpoint: 'local test' };
const results = [];
let fileNumber = 0;
const disk = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const descriptor = (extra = {}) => ({ kind: 'local-command', checkpoint: 'local test', requestId: randomUUID(), actorId,
  identities: { productId: 'synthetic-product' }, command: { type: 'upsert', rows: [{ id: 'synthetic-product', stock: 2 }] }, ...extra });
const request = (path, body, method = 'POST') => ({
  url: () => path.startsWith('http') ? path : origin + path,
  method: () => method,
  postDataJSON: () => structuredClone(body),
  headers: () => { throw Error('Journal must never inspect Auth headers'); },
});
const commandRequest = (id = randomUUID(), command = { type: 'upsert', kind: 'products', rows: [{ id: 'synthetic-product', stock: 2 }] }) =>
  request('/rest/v1/rpc/execute_online_command', { p_request_id: id, p_command: command });
async function newJournal(extra = {}) {
  const file = join(root, String(++fileNumber), 'journal.json');
  const options = { file, ...identity, ...extra };
  return { journal: await openLiveJournal(options), file, options };
}
async function checkCase(name, action) {
  try { await action(); results.push({ name, pass: true }); }
  catch (cause) { results.push({ name, pass: false, error: cause.message, stack: cause.stack }); }
}
async function deadline(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Concurrent callbacks were serialized or stalled')), 10000); })]); }
  finally { clearTimeout(timer); }
}
function fakeRoute(req) {
  const events = [];
  return { events, request: () => req,
    abort: async () => { events.push('abort'); },
    continue: async () => { events.push('continue'); },
    fetch: async () => { events.push('fetch'); return { ok: true }; },
    fulfill: async () => { events.push('fulfill'); },
  };
}
function instrumentedIo(events, fault = {}) {
  return { ...fs,
    async rename(from, to) {
      events.push({ method: 'rename', file: from });
      if (fault.armed && fault.point === 'rename') throw Object.assign(Error('injected disk failure'), { code: 'EIO' });
      return fs.rename(from, to);
    },
    async open(file, ...args) {
      const handle = await fs.open(file, ...args);
      return new Proxy(handle, { get(target, key) {
        const member = Reflect.get(target, key, target);
        if (typeof member !== 'function') return member;
        return async (...values) => {
          if (['writeFile', 'sync', 'close'].includes(key)) events.push({ method: key, file });
          if (key === 'sync' && fault.armed && ((fault.point === 'pending-sync' && file.endsWith('.pending')) || (fault.point === 'installed-sync' && file.endsWith('journal.json'))))
            throw Object.assign(Error('injected disk failure'), { code: 'EIO' });
          return member.apply(target, values);
        };
      } });
    },
  };
}

await checkCase('Direct mutation sees durable identity and command before its callback', async () => {
  const events = [], { journal, file } = await newJournal({ io: instrumentedIo(events) });
  try {
    events.length = 0;
    const draft = descriptor({ requestId: null });
    const value = await journal.beforeMutation(draft, async entry => {
      events.push({ method: 'send', file });
      const stored = await disk(file);
      assert.equal(stored.entries.length, 1);
      assert.deepEqual(stored.entries[0], entry);
      assert.match(entry.requestId, /^[0-9a-f-]{36}$/);
      assert.equal(entry.commandHash, journalHash(draft.command));
      assert.equal(entry.actorId, actorId);
      return 'confirmed by controlled callback';
    });
    assert.equal(value, 'confirmed by controlled callback');
    const pendingSync = events.findIndex(row => row.method === 'sync' && row.file === file + '.pending');
    const rename = events.findIndex(row => row.method === 'rename');
    const installedSync = events.findIndex(row => row.method === 'sync' && row.file === file);
    const send = events.findIndex(row => row.method === 'send');
    assert.ok(pendingSync >= 0 && pendingSync < rename && rename < installedSync && installedSync < send);
    const { checksum, ...body } = await disk(file);
    assert.equal(checksum, journalHash(body));
  } finally { await journal.close(); }
});

await checkCase('Concurrent preparation loses no intents and does not serialize HTTP callbacks', async () => {
  const { journal, file } = await newJournal();
  try {
    let started = 0, release;
    const allStarted = new Promise(resolve => { release = resolve; });
    const drafts = Array.from({ length: 24 }, (_, index) => descriptor({ identities: { productId: 'fixture-' + index } }));
    const mutations = drafts.map(draft => journal.beforeMutation(draft, async entry => {
      assert.ok((await disk(file)).entries.some(row => row.entryHash === entry.entryHash));
      if (++started === drafts.length) release();
      await allStarted;
      return entry.requestId;
    }));
    const ids = await deadline(Promise.all(mutations));
    assert.equal(new Set(ids).size, drafts.length);
    const stored = await disk(file);
    assert.deepEqual(stored.entries.map(row => row.sequence), Array.from({ length: 24 }, (_, i) => i + 1));
    for (const [index, row] of stored.entries.entries()) assert.equal(row.previousHash, stored.entries[index - 1]?.entryHash ?? null);
    assert.deepEqual(stored.entries.map(row => row.requestId).sort(), drafts.map(row => row.requestId).sort());
  } finally { await journal.close(); }
});

await checkCase('Reopen preserves history and rejects simultaneous ownership or changed identity', async () => {
  const { journal, options, file } = await newJournal();
  try {
    await journal.prepare(descriptor());
    await assert.rejects(openLiveJournal(options), { code: 'JOURNAL_ALREADY_OPEN_OR_LOCK_UNAVAILABLE' });
    const before = await disk(file);
    await journal.close();
    await assert.rejects(openLiveJournal({ ...options, run: randomUUID() }), { code: 'JOURNAL_IDENTITY_MISMATCH' });
    const reopened = await openLiveJournal(options);
    try {
      assert.deepEqual(reopened.snapshot().entries, before.entries);
      const next = await reopened.prepare(descriptor());
      assert.equal(next.sequence, 2);
      assert.equal(next.previousHash, before.entries[0].entryHash);
    } finally { await reopened.close(); }
  } finally { await journal.close(); }
});

await checkCase('Request object deduplicates across interceptors; changed command on the same receipt blocks', async () => {
  const { journal, file } = await newJournal();
  try {
    const id = randomUUID(), req = commandRequest(id);
    const [a, b] = await Promise.all([journal.beforeRoute(req, meta), journal.beforeRoute(req, { ...meta, checkpoint: 'later interceptor' })]);
    assert.equal(a.entry.entryHash, b.entry.entryHash);
    assert.equal((await disk(file)).entries.length, 1);
    const route = fakeRoute(commandRequest(id, { type: 'upsert', kind: 'products', rows: [{ id: 'synthetic-product', stock: 99 }] }));
    await journal.wrapRoute(r => r.continue(), meta)(route);
    assert.deepEqual(route.events, ['abort']);
    assert.equal(journal.failure, 'JOURNAL_REQUEST_ID_REUSED_WITH_DIFFERENT_COMMAND');
    await assert.rejects(journal.beforeRoute(req, meta), { code: journal.failure });
    assert.equal((await disk(file)).entries.length, 1);
  } finally { await journal.close(); }
});

for (const point of ['pending-sync', 'rename', 'installed-sync']) {
  await checkCase('A ' + point + ' failure blocks HTTP, poisons queued work and preserves recovery evidence', async () => {
    const fault = { point, armed: false }, events = [];
    const { journal, file, options } = await newJournal({ io: instrumentedIo(events, fault) });
    try {
      fault.armed = true;
      const route = fakeRoute(commandRequest());
      let sent = false;
      const attemptedRoute = journal.wrapRoute(r => r.continue(), meta)(route);
      // Queue another preparation before the first disk operation can finish.
      const queued = journal.beforeMutation(descriptor(), () => { sent = true; });
      const queuedRejection = assert.rejects(queued, { code: 'JOURNAL_PERSISTENCE_FAILED' });
      await Promise.all([attemptedRoute, queuedRejection]);
      assert.deepEqual(route.events, ['abort']);
      assert.equal(journal.failure, 'JOURNAL_PERSISTENCE_FAILED');
      await assert.rejects(journal.beforeMutation(descriptor(), () => { sent = true; }), { code: journal.failure });
      assert.equal(sent, false);
      await assert.rejects(journal.flush(), { code: journal.failure });
      const stored = await disk(file);
      assert.equal(stored.entries.length, point === 'installed-sync' ? 1 : 0);
      await journal.close();
      await assert.rejects(fs.stat(file + '.lock'), { code: 'ENOENT' });
      fault.armed = false;
      if (point !== 'installed-sync') {
        assert.ok((await fs.stat(file + '.pending')).size > 0);
        await assert.rejects(openLiveJournal(options), { code: 'JOURNAL_PENDING_RECOVERY_REQUIRED' });
      } else {
        const reopened = await openLiveJournal(options);
        try { assert.equal(reopened.snapshot().entries.length, 1); }
        finally { await reopened.close(); }
      }
    } finally { await journal.close(); }
  });
}

await checkCase('Tampered payload and hash chain cannot be reopened', async () => {
  const { journal, file, options } = await newJournal();
  try {
    await journal.prepare(descriptor()); await journal.close();
    const original = await disk(file);
    original.entries[0].command.rows[0].stock = 100;
    await fs.writeFile(file, JSON.stringify(original));
    await assert.rejects(openLiveJournal(options), { code: 'JOURNAL_CORRUPT' });
    const { checksum: _checksum, ...payload } = original;
    await fs.writeFile(file, JSON.stringify({ ...payload, checksum: journalHash(payload) }));
    await assert.rejects(openLiveJournal(options), { code: 'JOURNAL_CORRUPT' });
  } finally { await journal.close(); }
});

await checkCase('Auth principal UUID is persisted before provisioning and never includes credentials', async () => {
  const { journal, file } = await newJournal();
  try {
    const userId = randomUUID(), email = 'synthetic-principal@example.test';
    const entry = await journal.prepareAuthPrincipal({ userId, email });
    assert.equal((await disk(file)).entries[0].identities.userId, userId);
    assert.equal(entry.command.emailSha256, journalHash(email));
    const text = await fs.readFile(file, 'utf8');
    assert.equal(text.includes(email), false);
    assert.equal(text.includes('password'), false);
  } finally { await journal.close(); }
});

await checkCase('Account Edge writes retain only identity metadata, excluding password, body extras and headers', async () => {
  const { journal, file } = await newJournal();
  try {
    const requestId = randomUUID(), id = randomUUID(), email = 'synthetic-account@example.test';
    const req = request('/functions/v1/admin-users', { action: 'update', requestId, id, email,
      password: 'SYNTHETIC-CREDENTIAL-DO-NOT-RETAIN', avatar: 'SYNTHETIC-LARGE-AVATAR', unknownField: 'SYNTHETIC-EXTRA', expectedActorId: actorId });
    const { entry } = await journal.beforeRoute(req, meta);
    assert.deepEqual(entry.command, { requestId, action: 'update', targetUserId: id, emailSha256: journalHash(email) });
    assert.equal(entry.commandHash, journalHash(entry.command));
    const text = await fs.readFile(file, 'utf8');
    for (const excluded of [email, 'password', 'SYNTHETIC-CREDENTIAL', 'SYNTHETIC-LARGE-AVATAR', 'SYNTHETIC-EXTRA', 'authorization', 'apikey']) assert.equal(text.includes(excluded), false);
    await journal.beforeRoute(request('/functions/v1/admin-users', { action: 'resolve', requestId }), meta);
    assert.equal((await disk(file)).entries[1].kind, 'edge:admin-users:resolve');
  } finally { await journal.close(); }
});

await checkCase('Forbidden secret keys and Bearer values prevent preparation without disclosing them', async () => {
  for (const command of [{ password: 'SYNTHETIC-PRIVATE' }, { access_token: 'SYNTHETIC-PRIVATE' }, { nested: { Authorization: 'SYNTHETIC-PRIVATE' } }, { value: 'Bearer SYNTHETIC-PRIVATE' }]) {
    const { journal, file } = await newJournal();
    try {
      let sent = false;
      await assert.rejects(journal.beforeMutation(descriptor({ command }), () => { sent = true; }), cause => /^JOURNAL_SECRET_(FIELD|VALUE)_FORBIDDEN$/.test(cause.code) && !cause.message.includes('SYNTHETIC-PRIVATE'));
      assert.equal(sent, false);
      assert.equal((await disk(file)).entries.length, 0);
      assert.equal((await fs.readFile(file, 'utf8')).includes('SYNTHETIC-PRIVATE'), false);
    } finally { await journal.close(); }
  }
});

await checkCase('Presence, adoption and request resolution are journaled mutations; allowlisted reads and Auth sessions are not copied', async () => {
  const { journal, file } = await newJournal();
  try {
    const deviceId = randomUUID(), requestId = randomUUID();
    await journal.beforeRoute(request('/rest/v1/rpc/online_presence', { p_device_id: deviceId, p_client_build: 'local-test' }), meta);
    await journal.beforeRoute(request('/rest/v1/rpc/online_adoption_report', { p_device_id: deviceId, p_report: { state: 'ready', revision: 1 } }), meta);
    await journal.beforeRoute(request('/rest/v1/rpc/resolve_online_request', { p_request_id: requestId }), meta);
    assert.equal(LIVE_READ_RPCS.includes('resolve_online_request'), false);
    for (const name of LIVE_READ_RPCS) {
      const req = request('/rest/v1/rpc/' + name, null);
      req.postDataJSON = () => { throw Error('Do not capture read payloads'); };
      assert.equal((await journal.beforeRoute(req, meta)).readOnly, true);
    }
    const session = request('/auth/v1/token?grant_type=password', null);
    session.postDataJSON = () => { throw Error('Never capture Auth credentials'); };
    assert.equal((await journal.beforeRoute(session, meta)).readOnly, true);
    const entries = (await disk(file)).entries;
    assert.equal(entries.length, 3);
    assert.equal(entries[0].identities.deviceId, deviceId);
    assert.equal(entries[1].identities.deviceId, deviceId);
    assert.equal(entries[2].identities.requestId, requestId);
    assert.ok(entries.every(row => row.actorId === actorId));
  } finally { await journal.close(); }
});

await checkCase('Unknown RPC, Storage, REST, legacy archive and foreign writes all fail closed', async () => {
  const rejected = [
    request('/rest/v1/rpc/unknown_writer', { any: 'data' }),
    request('/rest/v1/rpc/online_account_apply', { any: 'data' }),
    request('/rest/v1/rpc/archive_online_legacy', { p_payload: 'SYNTHETIC-LEGACY' }),
    request('/rest/v1/products', { id: 'fixture' }),
    request('/storage/v1/object/product-photos/fixture.png', { any: 'data' }),
    request('/auth/v1/admin/users', { any: 'data' }),
    request('https://unknown.invalid/write', { any: 'data' }),
    request('http://127.0.0.1:8888/write', { any: 'data' }),
  ];
  for (const req of rejected) {
    const { journal, file } = await newJournal();
    try {
      const route = fakeRoute(req);
      await journal.wrapRoute(r => r.continue(), { ...meta, readOrigins: ['http://127.0.0.1:8888'] })(route);
      assert.deepEqual(route.events, ['abort']);
      assert.ok(journal.failure);
      assert.equal((await disk(file)).entries.length, 0);
    } finally { await journal.close(); }
  }
  const { journal } = await newJournal();
  try { assert.equal((await journal.beforeRoute(request('http://127.0.0.1:8888/index.html', null, 'GET'), { ...meta, readOrigins: ['http://127.0.0.1:8888'] })).readOnly, true); }
  finally { await journal.close(); }
});

await checkCase('Wrapped late handler persists before route.fetch and distinguishes errors before and after dispatch', async () => {
  for (const stage of ['success', 'before', 'after']) {
    const { journal, file } = await newJournal();
    try {
      const route = fakeRoute(commandRequest()), callbacks = [];
      const originalFetch = route.fetch;
      route.fetch = async () => { assert.equal((await disk(file)).entries.length, 1); return originalFetch(); };
      await journal.wrapRoute(async guarded => {
        if (stage === 'before') throw Error('controlled fixture index write failure');
        await guarded.fetch();
        if (stage === 'after') throw Error('controlled ACK handling failure');
        await guarded.fulfill({ body: '{}' });
      }, { ...meta, onBlocked: data => callbacks.push({ callback: 'blocked', ...data }), onFailed: data => callbacks.push({ callback: 'failed', ...data }) })(route);
      assert.equal((await disk(file)).entries.length, 1);
      if (stage === 'success') { assert.deepEqual(route.events, ['fetch', 'fulfill']); assert.equal(journal.failure, null); }
      else {
        assert.equal(journal.failure, 'JOURNAL_HANDLER_FAILED_' + stage.toUpperCase() + '_DISPATCH');
        assert.deepEqual(route.events, stage === 'before' ? ['abort'] : ['fetch', 'abort']);
        assert.equal(callbacks[0].callback, stage === 'before' ? 'blocked' : 'failed');
        assert.equal(callbacks[0].dispatched, stage === 'after');
      }
    } finally { await journal.close(); }
  }
});

await checkCase('Context route protects independent pages, reopened C and later interceptors before controlled response', async () => {
  const { journal, file } = await newJournal();
  let browser;
  try {
    browser = await chromium.launch({ ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }), headless: true });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    // Catch every other URL and abort it. No continue/fetch can reach real HTTP.
    await context.route('**/*', route => route.abort('blockedbyclient'));
    let guardedResponses = 0, lateResponses = 0;
    const forward = async route => {
      if (route.request().method() === 'POST') {
        const requestId = route.request().postDataJSON().p_request_id;
        assert.ok((await disk(file)).entries.some(row => row.requestId === requestId));
        guardedResponses++;
      }
      return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, contentType: 'application/json', body: '{"ok":true,"controlled":true}' });
    };
    await journal.installContextRoutes(context, { ...meta, forward });
    const pages = await Promise.all(['A', 'B', 'C'].map(() => context.newPage()));
    const submit = (page, requestId) => page.evaluate(async ({ origin, requestId }) => (await fetch(origin + '/rest/v1/rpc/execute_online_command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_request_id: requestId, p_command: { type: 'upsert', kind: 'products', rows: [{ id: 'synthetic-browser-product', stock: 3 }] } }),
    })).json(), { origin, requestId });
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const responses = await Promise.all(pages.map((page, index) => submit(page, ids[index])));
    assert.ok(responses.every(response => response.controlled));
    await pages[2].close();
    const reopenedC = await context.newPage(), reopenedId = randomUUID();
    assert.equal((await submit(reopenedC, reopenedId)).controlled, true);
    const lateHandler = journal.wrapRoute(async route => { lateResponses++; return forward(route); }, { ...meta, contextName: 'C reopened', checkpoint: 'late response-loss interceptor' });
    await context.route(origin + '/rest/v1/rpc/execute_online_command', lateHandler);
    const lateId = randomUUID();
    assert.equal((await submit(reopenedC, lateId)).controlled, true);
    assert.equal(lateResponses, 1);
    assert.equal(guardedResponses, 5);
    await journal.flush();
    assert.deepEqual((await disk(file)).entries.map(row => row.requestId).sort(), [...ids, reopenedId, lateId].sort());
    assert.equal((await disk(file)).entries.at(-1).contextName, 'C reopened');
    await context.close();
  } finally { if (browser) await browser.close(); await journal.close(); }
});

const failed = results.filter(row => !row.pass);
const summary = { scope: 'Local durable preparation and fully intercepted Chromium; no live Supabase', certified: false,
  journalSha256: journalHash(await fs.readFile(new URL('./h171-live-journal.mjs', import.meta.url), 'utf8')),
  testSha256: journalHash(await fs.readFile(import.meta.filename, 'utf8')),
  realSupabaseWrites: 0, tests: results.length, passed: results.length - failed.length, failed: failed.length, results };
if (failed.length) { summary.preservedFailureDirectory = root; process.exitCode = 1; }
else {
  // Delete only the exact test directory created by this process, inside BALAM.
  assert.equal(dirname(root), workspace);
  assert.ok(root.startsWith(workspace + sep) && root.includes('.h171-live-journal-test-'));
  await fs.rm(root, { recursive: true, force: true });
}
console.log(JSON.stringify(summary, null, 2));
