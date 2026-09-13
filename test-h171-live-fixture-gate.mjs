// Execute the real runner from an empty directory: the live gate must precede
// source/resume reads, output files, credential lookup, HTTP and provisioning.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve('.'), runner = resolve('test-h164-live-online.mjs');
const sandbox = fs.mkdtempSync(resolve(root, '.h171-gate-'));
const cleanEnv = { ...process.env };
for (const key of Object.keys(cleanEnv)) if (key.startsWith('BALAM_') || key.startsWith('SUPABASE_')) delete cleanEnv[key];
const execute = (extra, cwd = sandbox) => spawnSync(process.execPath, [runner], {
  cwd, env: { ...cleanEnv, ...extra }, encoding: 'utf8', timeout: 30000,
});
let passed = 0;
try {
  for (const [name, extra,code] of [
    ['new live run without verified workspace', {},'QA_VERIFIED_WORKSPACE_REQUIRED'],
    ['resume with unreadable journal', { BALAM_LIVE_RESUME_DIR: resolve(sandbox, 'missing-journal') },'QA_RESUME_REQUIRES_EXACT_RECONCILIATION'],
    ['retry with unreviewed case', { BALAM_LIVE_RETRY_REJECTED_CASE: 'unreviewed' },'QA_RESUME_REQUIRES_EXACT_RECONCILIATION'],
    ['environment cannot authorize retained fixtures', { BALAM_QA_ALLOW_RETAINED_HISTORY: '1' },'QA_RETAINED_HISTORY_FORBIDDEN'],
  ]) {
    const result = execute({ BALAM_ONLINE_LIVE: '1', BALAM_TEST_OUTPUT: resolve(sandbox, 'unexpected-output'), ...extra });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stdout, '');
    const rejection = JSON.parse(result.stderr.trim());
    assert.equal(rejection.code, code);
    assert.equal(rejection.certified, false); assert.equal(rejection.deliveryCertified, false);
    assert.deepEqual(fs.readdirSync(sandbox), [], 'Runner must not create evidence or provision before the policy gate');
    console.log('PASS ' + name + ': blocked before any source/resume read or side effect'); passed++;
  }
  const preflight = execute({ BALAM_LIVE_PREFLIGHT_ONLY: '1', BALAM_ONLINE_LIVE: '1',
    BALAM_TEST_OUTPUT: resolve(sandbox, 'unexpected-preflight-output') }, root);
  assert.equal(preflight.error, undefined); assert.equal(preflight.status, 0, preflight.stderr);
  const report = JSON.parse(preflight.stdout.trim());
  assert.equal(report.preflight, true); assert.equal(report.certified, false);
  assert.equal(report.deliveryCertified, false); assert.equal(report.liveExecutionBlocked, false);
  assert.equal(report.code,'EXACT_SELF_CLEANUP_IMPLEMENTED');
  assert.equal(report.authRequests, 0); assert.equal(report.businessWrites, 0);
  assert.match(report.artifactSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(fs.readdirSync(sandbox), []);
  console.log('PASS local artifact preflight remains read-only and explicitly not certified'); passed++;
  console.log(passed + ' PASS / 0 FAIL');
} finally {
  // This directory must be empty; leave unexpected effects intact as evidence.
  if (fs.readdirSync(sandbox).length === 0) fs.rmdirSync(sandbox);
}
