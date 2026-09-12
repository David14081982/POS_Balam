// H155/H162: Pages requires regression; real A/B/C certification is an explicit manual run.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const workflow = require('yaml').parse(readFileSync('.github/workflows/h148-sync-authority.yml', 'utf8'));
const deliveryCondition = "github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && !inputs.live";
const liveCondition = "github.event_name == 'workflow_dispatch' && inputs.live && github.ref == 'refs/heads/main'";
const certificateSelfTest = 'node test-h148-sync-certification.mjs --self-test';
const inventoryGuards = [
  'test-h132-inventory-identity-certification.mjs',
  'test-h132-live-certifier.mjs',
  'test-h127-label-diagnostics.mjs',
  'test-h99-label-pdf.mjs',
  'test-h100-materialized-label-sku.mjs',
];

function verifyDelivery(value) {
  const {regression, deploy} = value.jobs;
  const live = value.jobs['live-certification'];
  assert.equal(deploy.needs, 'regression');
  assert.equal(regression.needs, undefined, 'regression cannot depend on live certification');
  assert.equal(regression.if, undefined);
  assert.equal(deploy.if, deliveryCondition);
  assert.deepEqual(value.permissions, {contents: 'read'});
  assert.deepEqual(deploy.permissions, {pages: 'write', 'id-token': 'write'});
  assert.equal(deploy['continue-on-error'], undefined);
  assert.equal(regression['continue-on-error'], undefined);
  const steps = regression.steps;
  for (const [jobName, job] of Object.entries(value.jobs)) {
    if (jobName === 'live-certification') continue;
    assert.ok(!job.steps?.some(step => step.run?.includes('test-h148-sync-certification.mjs')
      && step.run !== certificateSelfTest), 'real certificate must remain in the manual job');
    assert.ok(!job.steps?.some(step => step.run?.includes('test-h148-live-convergence.mjs')),
      'real A/B/C must remain in the manual job');
  }
  const build = steps.findIndex(step => step.run === 'node build-offline.mjs');
  const stage = steps.findIndex(step => step.name === 'Stage verified Pages files');
  const upload = steps.findIndex(step => step.uses === 'actions/upload-pages-artifact@v3');
  assert.ok(build >= 0 && stage > build && upload > stage);
  for (const [index, step] of steps.entries()) {
    if (!/^node test-/.test(step.run || '')) continue;
    assert.ok(index > build && index < stage, 'regression must test the build before publication: ' + step.run);
    assert.equal(step.if, undefined, 'regression cannot be conditionally skipped: ' + step.run);
  }
  for (const guard of inventoryGuards) {
    const index = steps.findIndex(step => step.run === 'node ' + guard);
    assert.ok(index >= 0 && index < stage, 'inventory guard must run before publication: ' + guard);
    assert.equal(steps[index].if, undefined, 'inventory guard cannot be conditionally skipped: ' + guard);
  }
  assert.ok(steps.some(step => step.run === certificateSelfTest), 'strict validator self-test remains in regression');
  assert.ok(steps.slice(0, upload + 1).every(step => !step['continue-on-error']));
  assert.equal(steps[stage].if, deliveryCondition);
  assert.equal(steps[upload].if, deliveryCondition);
  assert.equal(steps[upload].with.path, '_site');
  for (const file of ['index.html', 'POS Balam (offline).html', 'sw.js', 'manifest.webmanifest', 'pwa']) {
    assert.ok(steps[stage].run.includes(file), 'missing delivered file: ' + file);
  }
  assert.deepEqual(deploy.steps, [{uses: 'actions/deploy-pages@v4', id: 'deployment'}]);
  assert.equal(deploy.environment.name, 'github-pages');
  assert.ok(steps.some(step => step.run === 'node test-h155-ui-sync.mjs' && step.env?.BALAM_VERIFIED_HTML === 'index.html'));
  assert.equal(value.on.workflow_dispatch.inputs.live.type, 'boolean');
  assert.equal(value.on.workflow_dispatch.inputs.live.default, false);
  assert.equal(live.if, liveCondition);
  assert.equal(live['continue-on-error'], undefined);
  const liveBuild = live.steps.findIndex(step => step.run === 'node build-offline.mjs');
  const liveRun = live.steps.findIndex(step => step.run === 'node test-h148-live-convergence.mjs');
  const liveValidation = live.steps.findIndex(step => step.run === 'node test-h148-sync-certification.mjs sync-evidence/matrix.json');
  assert.ok(liveBuild >= 0 && liveRun > liveBuild && liveValidation > liveRun);
  for (const index of [liveBuild, liveRun, liveValidation]) {
    assert.equal(live.steps[index].if, undefined);
    assert.equal(live.steps[index]['continue-on-error'], undefined);
  }
  return true;
}

verifyDelivery(workflow);
console.log('PASS publication requires regression and main-only non-live artifact; strict A/B/C certification remains manual');
for (const [name, mutate] of [
  ['failed regression bypass', value => { value.jobs.deploy.if = 'always()'; }],
  ['real certificate required for publication', value => { value.jobs.regression.steps.unshift({run: 'node test-h148-sync-certification.mjs docs/fixes/evidence/h148-live-matrix.json'}); }],
  ['soft regression failure', value => { value.jobs.regression.steps.find(step => step.run === 'node test-h155-ui-sync.mjs')['continue-on-error'] = true; }],
  ['artifact before regression', value => { const steps = value.jobs.regression.steps; const upload = steps.splice(steps.findIndex(step => step.uses === 'actions/upload-pages-artifact@v3'), 1)[0]; steps.unshift(upload); }],
  ['missing inventory guard', value => { value.jobs.regression.steps = value.jobs.regression.steps.filter(step => step.run !== 'node test-h132-inventory-identity-certification.mjs'); }],
  ['automatic real A/B/C', value => { value.jobs['live-certification'].if = "github.ref == 'refs/heads/main'"; }],
  ['live enabled by default', value => { value.on.workflow_dispatch.inputs.live.default = true; }],
  ['deploy depends on live certification', value => { value.jobs.deploy.needs = ['regression', 'live-certification']; }],
  ['soft manual certificate failure', value => { value.jobs['live-certification'].steps.find(step => step.run?.includes('sync-evidence/matrix.json'))['continue-on-error'] = true; }],
]) {
  const changed = structuredClone(workflow); mutate(changed);
  assert.throws(() => verifyDelivery(changed), undefined, 'failed to reject ' + name);
  console.log('PASS reject ' + name);
}
