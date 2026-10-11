import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// H186 / R-DEL-15: measure defensive catalog reads, complete catalog coverage,
// and correct scope decisions together. No browser, network, or business writes.
const root = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(root, 'balam', 'discounts.jsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const baselinePath = path.join(root, 'docs', 'fixes', 'evidence', 'h186', 'model-universe-baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceHash = hash(source);
const startedAt = new Date().toISOString();
const results = [];
let measured = null;

function load(options = {}) {
  const state = { rows: structuredClone(options.rows || [{ id: 'a', modelo: 'A', precio: 1250 }]),
    draftRows: null, productRevision: 1, dataRevision: 1,
    configVersion: options.configVersion === undefined ? 1 : options.configVersion,
    preparing: false, reads: 0, promos: [] };
  const C = { get version() { return state.configVersion; }, get preparing() { return state.preparing; }, codes: () => [] };
  function data() {
    const D = {
      get products() {
        state.reads++;
        const rows = state.preparing && state.draftRows ? state.draftRows : state.rows;
        // The performance fixture has only flat scalar fields. Its fresh row and
        // array copies retain the defensive getter contract without timing GC.
        return options.flatCopies ? rows.map(row => ({ ...row })) : structuredClone(rows);
      },
      get promos() { return structuredClone(state.promos); },
      get revision() { return options.noRevision ? undefined : state.dataRevision; },
      resolveProductSizes: p => ({ sizes: (p.sizes || ['M']).map(value => ({ value, active: true })) }),
      moneyRound: x => Math.round((x + Number.EPSILON) * 100) / 100,
      moneyRatio: (x, n, d) => Math.round((x * n / d + Number.EPSILON) * 100) / 100,
      listPrice: p => p.precio,
    };
    if (!options.noProjection) Object.defineProperty(D, 'commercialProjectionRevision', {
      get: () => state.productRevision + ':' + state.configVersion,
    });
    return D;
  }
  const window = { DATA: data(), CONFIG: C, UI: {}, HX: {}, CORE: { invokeSync: () => new Date('2026-10-11T01:00:00Z') } };
  const marker = source.indexOf('window.PROMOS =');
  assert.ok(marker >= 0, 'Promotion engine export exists');
  const engine = source.slice(0, source.indexOf('\n', marker)) + '\n})();';
  vm.runInNewContext(engine, { window, React: {}, Date, Number, Set, String, Array, Object, Math }, { timeout: 10000 });
  return { state, window, engine: window.PROMOS, freshData: data };
}
function check(name, action) {
  const start = performance.now();
  try {
    action(); results.push({ name, status: 'PASS', elapsedMs: Math.round(performance.now() - start) });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name, status: 'FAIL', message: error.message }); console.error('FAIL ' + name + ': ' + error.message);
  }
}
const scoped = models => ({ tipo: 'pct', valor: 30, scope: { modelos: models } });
const match = (h, models, model) => h.engine.productMatch(scoped(models), { modelo: model });

check('Read-count guardian preserves all 976 correct decisions and completes the catalog', () => {
  const h = load({ flatCopies: true, rows: Array.from({ length: 976 }, (_, i) => ({ id: String(i), modelo: 'M' + i, precio: 1250 })) });
  let visited = 0, correct = 0;
  const affected = h.window.DATA.products.filter(p => {
    visited++;
    const actual = h.engine.productMatch(scoped(['M975']), p);
    if (actual === (p.id === '975')) correct++;
    return actual;
  });
  measured = { cost: { productGetterReads: h.state.reads }, guarantee: { references: 976, visited, correct, affected: affected.length },
    completeness: { completed: true } };
  assert.deepEqual(affected.map(p => p.id), ['975']);
  assert.equal(visited, baseline.guarantee.visited);
  assert.equal(correct, baseline.guarantee.correct);
  assert.equal(measured.completeness.completed, baseline.completeness.completed);
  assert.ok(h.state.reads <= baseline.cost.productGetterReads, 'Catalog copy cost exceeded the versioned baseline');
  assert.equal(h.state.reads, 2, 'One outer snapshot plus one cached model universe');
  for (let i = 0; i < 100; i++) assert.equal(match(h, ['M975'], 'M975'), true);
  assert.equal(h.state.reads, 2, 'Warm matches must not copy the full catalog');
});

check('Empty scopes are lazy and read no product catalog', () => {
  const h = load();
  assert.equal(h.engine.productMatch({ scope: {} }, { modelo: 'A' }), true);
  assert.equal(match(h, [], 'A'), true);
  assert.equal(h.state.reads, 0);
});

check('Partial, complete and typed model selections preserve their meaning', () => {
  const h = load({ rows: ['A', 'B', 1, undefined].map(modelo => ({ modelo })) });
  assert.equal(match(h, ['A'], 'A'), true);
  assert.equal(match(h, ['A'], 'B'), false);
  assert.equal(match(h, ['1'], 1), true);
  assert.equal(match(h, [1], 1), false);
  assert.equal(match(h, ['A', 'B', '1', 'undefined'], 'unrepresented'), true);
  assert.equal(match(h, ['a'], 'A'), false);
});

check('Adding and deleting confirmed models invalidates select-all semantics', () => {
  const h = load();
  assert.equal(match(h, ['A'], 'B'), true);
  h.state.rows.push({ id: 'b', modelo: 'B' }); h.state.productRevision++;
  assert.equal(match(h, ['A'], 'B'), false);
  h.state.rows.pop(); h.state.productRevision++;
  assert.equal(match(h, ['A'], 'B'), true);
  assert.equal(h.state.reads, 3);
});

check('Editing a model without changing array length invalidates the universe', () => {
  const h = load();
  assert.equal(match(h, ['A'], 'unknown'), true);
  h.state.rows[0].modelo = 'B'; h.state.productRevision++;
  assert.equal(match(h, ['A'], 'unknown'), false);
  assert.equal(match(h, ['B'], 'unknown'), true);
  assert.equal(h.state.reads, 2);
});

check('Config version invalidates the projection without changing product revision', () => {
  const h = load();
  assert.equal(match(h, ['A'], 'unknown'), true);
  h.state.rows[0].modelo = 'B'; h.state.configVersion++;
  assert.equal(match(h, ['A'], 'unknown'), false);
  assert.equal(match(h, ['B'], 'unknown'), true);
  assert.equal(h.state.reads, 2);
});

check('Warm config preparation bypasses the memo and rolls back to the confirmed universe', () => {
  const h = load();
  assert.equal(match(h, ['A'], 'unknown'), true);
  h.state.preparing = true; h.state.draftRows = [{ modelo: 'B' }];
  assert.equal(match(h, ['A'], 'unknown'), false);
  h.state.draftRows = [{ modelo: 'A' }];
  assert.equal(match(h, ['A'], 'unknown'), true);
  assert.equal(h.state.reads, 3);
  h.state.preparing = false;
  assert.equal(match(h, ['A'], 'unknown'), true);
  assert.equal(h.state.reads, 3);
});

check('Cold config preparation cannot seed a memo with unconfirmed draft models', () => {
  const h = load();
  h.state.preparing = true; h.state.draftRows = [{ modelo: 'B' }];
  assert.equal(match(h, ['B'], 'unknown'), true);
  h.state.preparing = false;
  assert.equal(match(h, ['A'], 'unknown'), true);
  assert.equal(match(h, ['B'], 'unknown'), false);
  assert.equal(h.state.reads, 2);
});

check('Replacing the DATA object invalidates a numerically identical revision', () => {
  const h = load();
  assert.equal(match(h, ['A'], 'unknown'), true);
  h.state.rows[0].modelo = 'B'; h.window.DATA = h.freshData();
  assert.equal(match(h, ['A'], 'unknown'), false);
  assert.equal(h.state.reads, 2);
});

check('Legacy numeric revision fallback tracks both data and config changes', () => {
  const h = load({ noProjection: true });
  assert.equal(match(h, ['A'], 'unknown'), true);
  assert.equal(match(h, ['A'], 'unknown'), true);
  assert.equal(h.state.reads, 1);
  h.state.rows[0].modelo = 'B'; h.state.dataRevision++;
  assert.equal(match(h, ['A'], 'unknown'), false);
  h.state.rows[0].modelo = 'A'; h.state.configVersion++;
  assert.equal(match(h, ['A'], 'unknown'), true);
  assert.equal(h.state.reads, 3);
});

check('Missing or invalid revision contracts never permit a persistent memo', () => {
  for (const options of [{ noProjection: true, noRevision: true }, { noProjection: true, configVersion: NaN }]) {
    const h = load(options);
    assert.equal(match(h, ['A'], 'unknown'), true);
    h.state.rows[0].modelo = 'B';
    assert.equal(match(h, ['A'], 'unknown'), false);
    assert.equal(h.state.reads, 2);
  }
});

check('Unrelated data changes do not recopy the confirmed commercial projection', () => {
  const h = load();
  assert.equal(match(h, ['A'], 'unknown'), true);
  h.state.dataRevision++;
  assert.equal(match(h, ['A'], 'unknown'), true);
  assert.equal(h.state.reads, 1);
});

check('Model and size scoped discounts preserve 30, 60, 100 percent and stacked totals', () => {
  const product = { id: 'joel', modelo: 'JOEL', precio: 1250, sizes: ['M', 'L'] };
  const h = load({ rows: [product, { modelo: 'OTHER', precio: 900 }] });
  for (const [promos, expected] of [
    [[{ tipo: 'pct', valor: 30 }], 875], [[{ tipo: 'pct', valor: 60 }], 500], [[{ tipo: 'pct', valor: 100 }], 0],
    [[{ tipo: 'pct', valor: 20 }, { tipo: 'pct', valor: 30 }, { tipo: 'fijo', valor: 50 }], 575],
  ]) {
    h.state.promos = promos.map((p, i) => ({ ...p, id: 'p' + i, scope: { modelos: ['JOEL'], tallas: ['M'] } }));
    assert.equal(h.engine.lineUnit(product, 'M').unit, expected);
    assert.equal(h.engine.lineUnit(product, 'L').unit, 1250);
    assert.equal(h.engine.lineUnit({ modelo: 'OTHER', precio: 900 }, 'M').unit, 900);
  }
});

check('An empty confirmed model universe preserves membership without repeated copies', () => {
  const h = load({ rows: [] });
  assert.equal(match(h, ['A'], 'A'), true);
  assert.equal(match(h, ['A'], 'B'), false);
  assert.equal(match(h, ['A'], undefined), false);
  assert.equal(h.state.reads, 1);
});

assert.equal(hash(fs.readFileSync(sourcePath)), sourceHash, 'Production source changed during the guard');
const report = { status: results.every(x => x.status === 'PASS') ? 'PASS' : 'FAIL', startedAt, finishedAt: new Date().toISOString(),
  scope: 'LOCAL_VM_PRODUCTION_SOURCE', network: 'NOT_USED', sourceSha256: sourceHash,
  baselineBefore: baseline, measured, passed: results.filter(x => x.status === 'PASS').length,
  failed: results.filter(x => x.status === 'FAIL').length, cases: results };
const fixIndex = process.argv.indexOf('--fijar');
if (fixIndex >= 0) {
  const reason = process.argv[fixIndex + 1];
  assert.ok(reason && !reason.startsWith('--'), '--fijar requires a reason');
  assert.equal(report.failed, 0, 'Cannot refix a baseline with failed regressions');
  const next = { ...baseline, status: 'OPTIMIZATION_GUARD_GREEN', recordedAt: report.finishedAt,
    recordedAtMeaning: 'Production-source guard and regressions completed successfully before this baseline was refixed.',
    reason, sourceSha256: sourceHash, ...measured,
    previous: { recordedAt: baseline.recordedAt, reason: baseline.reason, sourceSha256: baseline.sourceSha256,
      cost: baseline.cost, guarantee: baseline.guarantee, completeness: baseline.completeness } };
  fs.writeFileSync(baselinePath, JSON.stringify(next, null, 2) + '\n');
  report.baselineRefixed = next;
}
const outIndex = process.argv.indexOf('--out');
if (outIndex >= 0) {
  const output = path.resolve(root, process.argv[outIndex + 1] || '');
  assert.ok(output.startsWith(root + path.sep), 'Evidence must stay within the repository');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ status: report.status, passed: report.passed, failed: report.failed, measured, sourceSha256: sourceHash }));
if (report.failed) process.exitCode = 1;
