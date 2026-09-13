// Execute the runner's actual helpers through VM; never execute its live entrypoint.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import vm from 'node:vm';
import { openLiveJournal, journalHash } from './h171-live-journal.mjs';

const workspace = resolve('.'), runnerPath = resolve('test-h164-live-online.mjs');
const source = await fs.readFile(runnerPath, 'utf8');
const root = await fs.mkdtemp(join(workspace, '.h171-runner-journal-test-'));
const projectRef = 'telohdbvbvsfmwyriflz', url = 'https://' + projectRef + '.supabase.co';
const address = 'http://127.0.0.1:43171/client/', userId = randomUUID();
const serviceKey = 'SYNTHETIC-NODE-PROVISIONING-KEY';
const stepKey = 'Synthetic scenario / Exact action';
const fixtureStart = source.indexOf('function remember('), fixtureEnd = source.indexOf('\nsave();', fixtureStart);
const routeStart = source.indexOf('const readRpcs ='), routeEnd = source.indexOf('function validateRejectedPaymentRetry', routeStart);
assert.ok(fixtureStart >= 0 && fixtureEnd > fixtureStart && routeStart >= 0 && routeEnd > routeStart);
const factory = vm.runInThisContext(`(scope => {
  const { mutationJournal, url, address, userId, serviceKey, fixtures, currentStep, currentCase, save, randomUUID } = scope;
  ${source.slice(fixtureStart, fixtureEnd)}
  ${source.slice(routeStart, routeEnd)}
  return { guardedBrowserRoute, journalMutation };
})`, { filename: 'h171-extracted-runner-guards.mjs' });
const finalStart = source.lastIndexOf('\nfinally {');
assert.ok(finalStart > source.indexOf('result.scenariosPassed=true'));
const finish = vm.runInThisContext(`(async scope => {
  const { result, baseline, userId, browser, server, mutationJournal, cleanupLifecycle, digest, readFileSync, runnerPath, save, process, console, out } = scope;
  try {} ${source.slice(finalStart).replaceAll('import.meta.filename', 'runnerPath')}
  return result;
})`, { filename: 'h171-extracted-runner-finally.mjs' });

const results = [];
let number = 0;
const disk = file => JSON.parse(readFileSync(file, 'utf8'));
const makeRequest = (path, body = {}, headers = {}, method = 'POST') => ({
  url: () => path.startsWith('http') ? path : url + path, method: () => method,
  headers: () => ({ apikey: 'synthetic-publishable', ...headers }), postDataJSON: () => structuredClone(body),
});
const commandRequest = (headers = {}) => makeRequest('/rest/v1/rpc/execute_online_command', {
  p_request_id: randomUUID(), p_command: { type: 'upsert', kind: 'clients', rows: [{ id: 'synthetic-client', nombre: 'Synthetic fixture' }] },
}, headers);
function makeRoute(request) {
  const events = [];
  return { events, request: () => request,
    continue: async () => { events.push('continue'); }, fetch: async () => { events.push('fetch'); return { ok: true }; },
    fulfill: async () => { events.push('fulfill'); }, abort: async () => { events.push('abort'); },
  };
}
async function scope({ failSaveAt = 0 } = {}) {
  const file = join(root, String(++number), 'journal.json');
  const journal = await openLiveJournal({ file, run: randomUUID(), projectRef, artifactSha256: journalHash('synthetic artifact') });
  const fixtures = { requestIds: [], clients: [], sales: [], returns: [], exchanges: [], loans: [], promotions: [], operationIds: [], checkpoints: { [stepKey]: { requestIds: [] } } };
  const observed = { saves: 0, journalGuards: 0, terminalCalls: 0 };
  const bridge = { ...journal, wrapRoute(handler, meta) {
    const wrapped = journal.wrapRoute(handler, meta);
    return async route => { observed.journalGuards++; return wrapped(route); };
  } };
  const methods = factory({ mutationJournal: bridge, url, address, userId, serviceKey, fixtures,
    currentStep: stepKey, currentCase: 'Synthetic scenario', randomUUID,
    save() {
      observed.saves++;
      assert.ok(disk(file).entries.length > 0, 'The real remember/save path must run after durable preparation');
      if (observed.saves === failSaveAt) throw Error('SYNTHETIC_FIXTURE_WRITE_FAILURE');
    },
  });
  const terminal = { name: 'C reopened', errors: [] };
  return { file, journal, fixtures, observed, terminal, ...methods };
}
async function checkCase(name, action) {
  try { await action(); results.push({ name, pass: true }); }
  catch (cause) { results.push({ name, pass: false, error: cause.message, stack: cause.stack }); }
}

await checkCase('Actual runner guard persists before the legacy fixture index and terminal continue', async () => {
  const f = await scope();
  try {
    const req = commandRequest(), route = makeRoute(req), requestId = req.postDataJSON().p_request_id;
    await f.guardedBrowserRoute(f.terminal, async guarded => {
      f.observed.terminalCalls++;
      assert.equal(disk(f.file).entries[0].requestId, requestId);
      assert.deepEqual(f.fixtures.requestIds, [requestId]);
      assert.deepEqual(f.fixtures.checkpoints[stepKey].requestIds, [requestId]);
      assert.deepEqual(f.fixtures.clients, ['synthetic-client']);
      return guarded.continue();
    })(route);
    assert.deepEqual(route.events, ['continue']);
    assert.equal(f.observed.saves, 3); assert.equal(f.observed.terminalCalls, 1);
    assert.equal(disk(f.file).entries[0].contextName, 'C reopened');
    assert.equal(disk(f.file).entries[0].checkpoint, stepKey);
  } finally { await f.journal.close(); }
});

for (const failSaveAt of [1, 3]) {
  await checkCase('Actual fixture save failure at write ' + failSaveAt + ' aborts before terminal HTTP', async () => {
    const f = await scope({ failSaveAt });
    try {
      const route = makeRoute(commandRequest());
      await f.guardedBrowserRoute(f.terminal, guarded => { f.observed.terminalCalls++; return guarded.continue(); })(route);
      assert.deepEqual(route.events, ['abort']); assert.equal(f.observed.terminalCalls, 0);
      assert.equal(disk(f.file).entries.length, 1, 'Keep prepared identity even if auxiliary fixture persistence fails');
      assert.equal(f.journal.failure, 'JOURNAL_HANDLER_FAILED_BEFORE_DISPATCH');
      assert.equal((await fs.readFile(f.file, 'utf8')).includes('SYNTHETIC_FIXTURE_WRITE_FAILURE'), false);
    } finally { await f.journal.close(); }
  });
}

for (const [name, headers] of [
  ['apikey', { apikey: serviceKey }],
  ['Authorization Bearer', { authorization: 'Bearer ' + serviceKey }],
]) {
  await checkCase('Provisioning key in ' + name + ' is blocked by the actual runner before journal inspection', async () => {
    const f = await scope();
    try {
      const route = makeRoute(commandRequest(headers));
      await f.guardedBrowserRoute(f.terminal, guarded => { f.observed.terminalCalls++; return guarded.continue(); })(route);
      assert.deepEqual(route.events, ['abort']); assert.equal(f.observed.terminalCalls, 0);
      assert.equal(f.observed.journalGuards, 0); assert.equal(f.observed.saves, 0);
      assert.equal(disk(f.file).entries.length, 0); assert.equal(f.terminal.errors.length, 1);
      assert.equal((await fs.readFile(f.file, 'utf8')).includes(serviceKey), false);
    } finally { await f.journal.close(); }
  });
}

await checkCase('Actual runner permits local asset reads and rejects writes or a different local origin', async () => {
  for (const [path, method, allowed] of [
    [address + 'index.html', 'GET', true], [address + 'app.js', 'HEAD', true],
    [address + 'write', 'POST', false], ['http://127.0.0.1:43172/index.html', 'GET', false],
  ]) {
    const f = await scope();
    try {
      const route = makeRoute(makeRequest(path, {}, {}, method));
      await f.guardedBrowserRoute(f.terminal, guarded => guarded.continue())(route);
      assert.deepEqual(route.events, allowed ? ['continue'] : ['abort']);
      assert.equal(disk(f.file).entries.length, 0); assert.equal(f.observed.saves, 0);
    } finally { await f.journal.close(); }
  }
});

await checkCase('Actual runner late interceptor enters durable guard before route.fetch', async () => {
  const f = await scope();
  try {
    const route = makeRoute(commandRequest());
    await f.guardedBrowserRoute(f.terminal, async guarded => {
      assert.equal(disk(f.file).entries.length, 1);
      await guarded.fetch(); await guarded.abort('failed');
    })(route);
    assert.deepEqual(route.events, ['fetch', 'abort']); assert.equal(f.journal.failure, null);
  } finally { await f.journal.close(); }
});

await checkCase('Actual Node helper persists null-request-id Auth intent before its API callback', async () => {
  const f = await scope();
  try {
    const targetUserId = randomUUID();
    const result = await f.journalMutation('auth-create', { userId: targetUserId }, { emailSha256: journalHash('synthetic@example.test') }, async () => {
      const row = disk(f.file).entries[0];
      assert.equal(row.identities.userId, targetUserId); assert.equal(row.actorId, userId);
      assert.equal(row.checkpoint, stepKey); assert.match(row.requestId, /^[0-9a-f-]{36}$/);
      return { id: targetUserId };
    });
    assert.equal(result.id, targetUserId);
  } finally { await f.journal.close(); }
});

function finishingScope(f, extra = {}) {
  const result = { certified: false, deliveryCertified: false, cleanupVerified: false, scenariosPassed: true, cases: [] };
  return { result, baseline: {}, userId, mutationJournal: f.journal, runnerPath, out: root,
    browser: { async close() {} }, server: null, cleanupLifecycle: null, digest: journalHash,
    readFileSync: () => source, save() {}, process: { exitCode: 0 }, console: { log() {} }, ...extra };
}

await checkCase('Actual finalization releases the journal despite browser close failure and never certifies retained fixtures', async () => {
  const f = await scope();
  try {
    const finishing = finishingScope(f, { browser: { async close() { throw Error('SYNTHETIC_BROWSER_CLOSE_FAILURE'); } } });
    await finish(finishing);
    assert.equal(existsSync(f.file + '.lock'), false);
    assert.equal(finishing.result.browserCloseFailure, 'SYNTHETIC_BROWSER_CLOSE_FAILURE');
    assert.equal(finishing.result.scenariosPassed, true);
    assert.equal(finishing.result.certified, false); assert.equal(finishing.result.deliveryCertified, false);
    assert.equal(finishing.result.cleanupVerified, false); assert.equal(finishing.process.exitCode, 1);
  } finally { await f.journal.close(); }
});

await checkCase('Actual finalization releases the journal if reading the certifier hash fails', async () => {
  const f = await scope();
  try {
    const finishing = finishingScope(f, { readFileSync() { throw Error('SYNTHETIC_CERTIFIER_READ_FAILURE'); } });
    try { await finish(finishing); }
    catch (cause) { assert.equal(cause.message, 'SYNTHETIC_CERTIFIER_READ_FAILURE'); }
    assert.equal(existsSync(f.file + '.lock'), false, 'Metadata failure must not leave the journal owner lock');
    assert.equal(finishing.result.certified, false); assert.equal(finishing.result.deliveryCertified, false);
  } finally { await f.journal.close(); }
});

await checkCase('Certification requires cleanup after all browser emitters close and before the durable journal closes',async()=>{
  const f=await scope(),order=[];
  try {
    const finishing=finishingScope(f,{browser:{async close(){order.push('browser-closed');}},
      cleanupLifecycle:{async finalize(){assert.deepEqual(order,['browser-closed']);f.journal.assertHealthy();order.push('cleanup');return {cleanupVerified:true};}}});
    await finish(finishing);
    assert.deepEqual(order,['browser-closed','cleanup']);assert.equal(finishing.result.certified,true);
    assert.equal(finishing.result.cleanupVerified,true);assert.equal(existsSync(f.file+'.lock'),false);
  }finally{await f.journal.close();}
});
await checkCase('Cleanup failure retains explicit blockers and releases the journal without certification',async()=>{
  const f=await scope();
  try {
    const finishing=finishingScope(f,{cleanupLifecycle:{async finalize(){throw Error('SYNTHETIC_PROTECTED_HASH_CHANGED');}}});
    await finish(finishing);assert.equal(finishing.result.certified,false);assert.equal(finishing.result.cleanupVerified,false);
    assert.equal(finishing.result.cleanupFailure,'SYNTHETIC_PROTECTED_HASH_CHANGED');assert.equal(finishing.process.exitCode,1);
    assert.equal(existsSync(f.file+'.lock'),false);
  }finally{await f.journal.close();}
});
await checkCase('A failed scenario still cleans its proven fixtures but cannot certify the matrix',async()=>{
  const f=await scope();
  try {
    const finishing=finishingScope(f,{cleanupLifecycle:{async finalize(){return {cleanupVerified:true};}}});
    finishing.result.scenariosPassed=false;finishing.result.failure='SYNTHETIC_SCENARIO_FAILURE';
    await finish(finishing);assert.equal(finishing.result.cleanupVerified,true);assert.equal(finishing.result.certified,false);
    assert.equal(finishing.process.exitCode,1);
  }finally{await f.journal.close();}
});

const failed = results.filter(row => !row.pass);
const report = { scope: 'Actual runner helpers extracted through VM, real local journal, fake routes; no live entrypoint',
  runnerSha256: journalHash(source), journalSha256: journalHash(await fs.readFile(new URL('./h171-live-journal.mjs', import.meta.url), 'utf8')),
  testSha256: journalHash(await fs.readFile(import.meta.filename, 'utf8')), certified: false, realSupabaseWrites: 0,
  tests: results.length, passed: results.length - failed.length, failed: failed.length, results };
if (failed.length) { report.preservedFailureDirectory = root; process.exitCode = 1; }
else {
  assert.equal(dirname(root), workspace); assert.ok(root.startsWith(workspace + sep) && root.includes('.h171-runner-journal-test-'));
  await fs.rm(root, { recursive: true, force: true });
}
const evidence = resolve(process.env.BALAM_RUNNER_JOURNAL_EVIDENCE || 'docs/fixes/evidence/h171/runner-journal-integration.json');
await fs.mkdir(dirname(evidence), { recursive: true }); await fs.writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
