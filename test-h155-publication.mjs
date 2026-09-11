// H155: Pages must publish only the artifact that passed regression and its live certificate.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const workflow = require('yaml').parse(readFileSync('.github/workflows/h148-sync-authority.yml', 'utf8'));
const deliveryCondition = "github.ref == 'refs/heads/main' && github.event_name != 'pull_request' && !inputs.live";
const inventoryGuards = [
  'test-h132-inventory-identity-certification.mjs',
  'test-h132-live-certifier.mjs',
  'test-h127-label-diagnostics.mjs',
  'test-h99-label-pdf.mjs',
  'test-h100-materialized-label-sku.mjs',
];

function verifyDelivery(value) {
  const {regression, deploy} = value.jobs;
  assert.equal(deploy.needs, 'regression');
  assert.equal(deploy.if, deliveryCondition);
  assert.deepEqual(value.permissions, {contents: 'read'});
  assert.deepEqual(deploy.permissions, {pages: 'write', 'id-token': 'write'});
  assert.equal(deploy['continue-on-error'], undefined);
  assert.equal(regression['continue-on-error'], undefined);
  const steps = regression.steps;
  const gate = steps.findIndex(step => step.run === 'node test-h148-sync-certification.mjs docs/fixes/evidence/h148-live-matrix.json');
  const stage = steps.findIndex(step => step.name === 'Stage verified Pages files');
  const upload = steps.findIndex(step => step.uses === 'actions/upload-pages-artifact@v3');
  assert.ok(gate >= 0 && stage > gate && upload > stage);
  for (const guard of inventoryGuards) {
    const index = steps.findIndex(step => step.run === 'node ' + guard);
    assert.ok(index >= 0 && index < stage, 'inventory guard must run before publication: ' + guard);
    assert.equal(steps[index].if, undefined, 'inventory guard cannot be conditionally skipped: ' + guard);
  }
  assert.equal(steps[gate].if, "github.event_name != 'workflow_dispatch' || !inputs.live");
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
  return true;
}

verifyDelivery(workflow);
console.log('PASS publication depends on regression, final HTML certificate and main-only non-live artifact');
for (const [name, mutate] of [
  ['failed regression bypass', value => { value.jobs.deploy.if = 'always()'; }],
  ['soft certificate failure', value => { value.jobs.regression.steps.find(step => step.run?.includes('sync-certification.mjs docs/fixes/evidence'))['continue-on-error'] = true; }],
  ['artifact before certificate', value => { const steps = value.jobs.regression.steps; const upload = steps.splice(steps.findIndex(step => step.uses === 'actions/upload-pages-artifact@v3'), 1)[0]; steps.unshift(upload); }],
  ['missing inventory guard', value => { value.jobs.regression.steps = value.jobs.regression.steps.filter(step => step.run !== 'node test-h132-inventory-identity-certification.mjs'); }],
]) {
  const changed = structuredClone(workflow); mutate(changed);
  assert.throws(() => verifyDelivery(changed), undefined, 'failed to reject ' + name);
  console.log('PASS reject ' + name);
}
