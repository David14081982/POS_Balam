// Execute the runner's actual helpers through VM; never execute its live entrypoint.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { chromium } from 'playwright-core';
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

const startedAt = new Date().toISOString(), results = [], browserEvidence = [];
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

await checkCase('Actual runner forwards the H186 quote RPC without preparing a mutation or altering fixtures', async () => {
  const f = await scope();
  try {
    const payload = { p_inputs: [{ key: 'synthetic-quote', productId: 'synthetic-product', talla: '24', qty: 3 }],
      p_applications: [], p_courtesy: false };
    const route = makeRoute(makeRequest('/rest/v1/rpc/quote_sale', payload));
    await f.guardedBrowserRoute(f.terminal, guarded => { f.observed.terminalCalls++; return guarded.continue(); })(route);
    assert.deepEqual(route.events, ['continue']);
    assert.equal(f.journal.failure, null); assert.equal(f.observed.terminalCalls, 1);
    assert.equal(f.observed.saves, 0); assert.equal(disk(f.file).entries.length, 0);
    assert.deepEqual(f.fixtures.requestIds, []); assert.deepEqual(f.fixtures.sales, []);
  } finally { await f.journal.close(); }
});

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
    browser: { contexts: () => [], async close() {} }, server: null, cleanupLifecycle: null, digest: journalHash,
    readFileSync: () => source, save() {}, process: { exitCode: 0 }, console: { log() {} }, ...extra };
}

await checkCase('Actual finalization releases the journal despite browser close failure and never certifies retained fixtures', async () => {
  const f = await scope();
  try {
    const finishing = finishingScope(f, { browser: { contexts: () => [], async close() { throw Error('SYNTHETIC_BROWSER_CLOSE_FAILURE'); } } });
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
    const finishing=finishingScope(f,{browser:{contexts:()=>[],async close(){order.push('browser-closed');}},
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

await checkCase('All contexts acknowledge offline and close before browser shutdown and cleanup', async () => {
  const f = await scope(), order = [], count = 3;
  try {
    const contexts = Array.from({ length: count }, (_, index) => ({
      async setOffline(value) { assert.equal(value, true); order.push('offline-' + index); },
      async close() { assert.equal(order.filter(value => value.startsWith('offline-')).length, count); order.push('context-' + index); },
    }));
    const finishing = finishingScope(f, { browser: { contexts: () => contexts, async close() { assert.equal(order.filter(value => value.startsWith('context-')).length, count); order.push('browser'); } },
      cleanupLifecycle: { async finalize() { assert.equal(order.at(-1), 'browser'); order.push('cleanup'); return { cleanupVerified: true }; } } });
    await finish(finishing);
    assert.deepEqual(order, ['offline-0', 'offline-1', 'offline-2', 'context-0', 'context-1', 'context-2', 'browser', 'cleanup']);
    assert.deepEqual(finishing.result.browserQuiescence, { contexts: 3, offlineConfirmed: 3, closedConfirmed: 3 });
    assert.equal(finishing.result.certified, true);
  } finally { await f.journal.close(); }
});

await checkCase('Finalization waits for the slowest offline acknowledgement before closing any context', async () => {
  const f = await scope(), calls = [];
  let release, reached;
  const pending = new Promise(resolve => release = resolve), waiting = new Promise(resolve => reached = resolve);
  try {
    const contexts = [
      { async setOffline() { calls.push('slow-start'); reached(); await pending; calls.push('slow-ack'); }, async close() { calls.push('slow-close'); } },
      { async setOffline() { calls.push('fast-ack'); }, async close() { calls.push('fast-close'); } },
    ];
    const finishing = finishingScope(f, { browser: { contexts: () => contexts, async close() { calls.push('browser'); } } });
    const closing = finish(finishing); await waiting;
    assert.deepEqual(calls, ['slow-start', 'fast-ack']);
    release(); await closing;
    assert.deepEqual(calls, ['slow-start', 'fast-ack', 'slow-ack', 'slow-close', 'fast-close', 'browser']);
    assert.equal(finishing.result.quiescenceFailure, undefined);
  } finally { release(); await f.journal.close(); }
});

for (const failure of ['offline', 'context-close']) {
  await checkCase('A ' + failure + ' failure closes remaining contexts but blocks cleanup and certification', async () => {
    const f = await scope(), calls = [];
    try {
      const contexts = [0, 1].map(index => ({
        async setOffline() { calls.push('offline-' + index); if (index === 0 && failure === 'offline') throw Error('SYNTHETIC_OFFLINE_FAILURE'); },
        async close() { calls.push('context-' + index); if (index === 0 && failure === 'context-close') throw Error('SYNTHETIC_CONTEXT_CLOSE_FAILURE'); },
      }));
      const finishing = finishingScope(f, { browser: { contexts: () => contexts, async close() { calls.push('browser'); } },
        cleanupLifecycle: { async finalize() { calls.push('UNSAFE_CLEANUP'); return { cleanupVerified: true }; } } });
      await finish(finishing);
      assert.deepEqual(calls, ['offline-0', 'offline-1', 'context-0', 'context-1', 'browser']);
      assert.equal(finishing.result.quiescenceFailure, 'BROWSER_QUIESCENCE_FAILED');
      assert.equal(finishing.result.cleanupVerified, false); assert.equal(finishing.result.certified, false);
      assert.equal(finishing.process.exitCode, 1); assert.equal(existsSync(f.file + '.lock'), false);
    } finally { await f.journal.close(); }
  });
}

await checkCase('Real Chromium cannot dispatch an unjournaled follow-up POST while actual runner finalization closes it', async () => {
  const f = await scope(), received = [], routeErrors = [];
  const environment = { TEMP: process.env.TEMP, TMP: process.env.TMP };
  let browser, releaseSnapshot, snapshotHeldResolve;
  const snapshotHeld = new Promise(resolve => snapshotHeldResolve = resolve);
  const server = http.createServer(async (request, response) => {
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Local journal shutdown regression</title>'); return; }
    if (request.url === '/snapshot') {
      let released = false; releaseSnapshot = () => { if (!released) { released = true; response.end('{"ok":true}'); } }; snapshotHeldResolve(); return;
    }
    if (request.method === 'POST') {
      let body = ''; for await (const bytes of request) body += bytes;
      received.push({ path: request.url, body }); response.end('{"ok":true}'); return;
    }
    response.end('ok');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const temporary = join(root, 'browser-tmp'); await fs.mkdir(temporary); process.env.TEMP = temporary; process.env.TMP = temporary;
    browser = await chromium.launch({ headless: true, ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }) });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const request = route.request();
      if (!request.url().startsWith(origin + '/')) { await route.abort(); return; }
      try {
        if (request.method() === 'POST') {
          const command = { path: new URL(request.url()).pathname, body: request.postData() };
          await f.journal.beforeMutation({ kind: 'local-shutdown-probe', checkpoint: 'local-read / follow-up POST', command }, () => route.continue());
        } else await route.continue();
      } catch (error) { routeErrors.push(error.message.split('\n')[0]); }
    });
    const page = await context.newPage(); await page.goto(origin);
    await page.evaluate(() => { window.localShutdownProbe = (async () => {
      await fetch('/working', { method: 'POST', body: 'working' });
      await fetch('/snapshot'); await fetch('/ready', { method: 'POST', body: 'ready' });
    })().catch(() => {}); });
    let timeout;
    try { await Promise.race([snapshotHeld, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('LOCAL_SNAPSHOT_NOT_REACHED')), 10000); })]); }
    finally { clearTimeout(timeout); }
    const finishing = finishingScope(f, { browser: {
      contexts: () => [{ setOffline: value => context.setOffline(value), close: async () => { releaseSnapshot(); await context.close(); } }],
      close: async () => { releaseSnapshot(); await browser.close(); },
    }, cleanupLifecycle: { async finalize() { return { cleanupVerified: true }; } } });
    await finish(finishing);
    const intents = disk(f.file).entries.map(entry => entry.command);
    assert.ok(received.some(row => row.path === '/working'), 'The positive control must reach the actual local HTTP server');
    const unknown = received.filter(row => !intents.some(intent => intent.path === row.path && intent.body === row.body));
    browserEvidence.push({ browserVersion: browser.version(), transport: 'HTTP localhost only',
      received: received.length, durableIntents: intents.length, unjournaledReceived: unknown.length,
      quiescence: finishing.result.browserQuiescence, routeErrors: routeErrors.length });
    assert.deepEqual(unknown, [], 'Every HTTP POST observed by the local server must have a prior durable intent');
    assert.equal(finishing.result.certified, true); assert.equal(finishing.result.quiescenceFailure, undefined);
    assert.deepEqual(finishing.result.browserQuiescence, { contexts: 1, offlineConfirmed: 1, closedConfirmed: 1 });
    assert.equal(routeErrors.length, 0);
  } finally {
    await browser?.close().catch(() => {}); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await f.journal.close();
    for (const [key, value] of Object.entries(environment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

const failed = results.filter(row => !row.pass);
const report = { startedAt, completedAt: new Date().toISOString(),
  scope: 'Actual runner helpers extracted through VM, real local journal, fake routes and real Chromium with localhost HTTP; no live entrypoint',
  runnerSha256: journalHash(source), journalSha256: journalHash(await fs.readFile(new URL('./h171-live-journal.mjs', import.meta.url), 'utf8')),
  testSha256: journalHash(await fs.readFile(import.meta.filename, 'utf8')), certified: false, realSupabaseWrites: 0,
  tests: results.length, passed: results.length - failed.length, failed: failed.length, browserEvidence, results };
if (failed.length) { report.preservedFailureDirectory = root; process.exitCode = 1; }
else {
  assert.equal(dirname(root), workspace); assert.ok(root.startsWith(workspace + sep) && root.includes('.h171-runner-journal-test-'));
  await fs.rm(root, { recursive: true, force: true });
}
const evidence = resolve(process.env.BALAM_RUNNER_JOURNAL_EVIDENCE || 'docs/fixes/evidence/h171/runner-journal-integration.json');
await fs.mkdir(dirname(evidence), { recursive: true }); await fs.writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
