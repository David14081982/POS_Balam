// H-186: motor real, precios V1/V2 y configuración; sin red ni escrituras comerciales.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const noop = () => {};
let now = new Date('2026-10-10T12:00:00-07:00');
const context = vm.createContext({
  console, Date, setTimeout, clearTimeout,
  React: { createElement: noop, useState: noop, useEffect: noop, useMemo: fn => fn() },
  window: {
    UI: { fmt: value => '$' + Number(value).toFixed(2), toast: noop }, HX: { MS: noop },
    CORE: { invokeSync: name => name === 'serverNow' ? now : null,
      registerCatalogProducts: noop, registerCatalogPromotions: noop, registerMonetaryDocuments: noop },
    dispatchEvent: noop, addEventListener: noop,
  },
});
for (const name of ['config', 'data']) vm.runInContext(readFileSync(new URL(`./balam/${name}.jsx`, import.meta.url), 'utf8'), context);
const C = context.window.CONFIG;
const D = { ...context.window.DATA, promos: [] };
let fixtureProducts = [], fixtureProductRevision = 0;
Object.defineProperties(D, {
  products: { get: () => fixtureProducts, set: rows => { fixtureProducts = rows; fixtureProductRevision++; } },
  productRevision: { get: () => fixtureProductRevision },
  commercialProjectionRevision: { get: () => fixtureProductRevision + ':' + C.version },
});
context.window.DATA = D;
vm.runInContext(readFileSync(new URL('./balam/discounts.jsx', import.meta.url), 'utf8'), context);
const P = context.window.PROMOS;
const promo = (tipo, valor, scope = {}) => ({ id: `test-${tipo}-${valor}`, nombre: 'Aniversario', tipo, valor,
  inicio: '2026-10-10', fin: '2026-10-19', pausado: false, scope });
const joel = { id: 'joel-40', sku: 'TEST-JOEL-40', nombre: 'JOEL', recordModel: 'v2', precio: 1250, costo: 563,
  cat: '1', sizeCategoryId: 'size_number', sizeCode: '40', stockQuantity: 3 };
let passed = 0, failed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}

test('La semilla y la pantalla ya no ofrecen un piso de margen', () => {
  assert.equal(C.get('discount.minMarginPct'), undefined);
  assert.equal(readFileSync(new URL('./balam/settings.jsx', import.meta.url), 'utf8').includes("k: 'discount.minMarginPct'"), false);
});
const legacyConfig = C.snapshot();
legacyConfig.settings['discount.minMarginPct'] = 50;
C.load(legacyConfig);
test('JOEL conserva costo563 y configuración histórica50 sin limitar promociones autorizadas', () => {
  const original = JSON.stringify(joel);
  for (const [pct, total] of [[10, 1125], [30, 875], [50, 625], [60, 500], [70, 375], [100, 0]]) {
    assert.equal(P.applyStack(1250, [promo('pct', pct)], joel).unit, total, `${pct}%`);
  }
  assert.equal(JSON.stringify(joel), original);
  assert.equal(C.get('discount.minMarginPct'), 50);
});
test('El precio no depende de costo nulo, cero, inválido o superior al precio', () => {
  for (const costo of [undefined, null, 0, -1, 'sin-costo', 563, 1250, 999999]) {
    assert.equal(P.applyStack(1250, [promo('pct', 60)], { ...joel, costo }).unit, 500);
  }
});
test('Acumulación suma porcentajes, limita la suma a100 y después resta fijos', () => {
  const stack = [promo('pct', 10), promo('pct', 20), promo('fijo', 100), promo('fijo', 25)];
  assert.equal(P.applyStack(1250, stack, joel).unit, 750);
  assert.equal(P.applyStack(1250, stack.slice().reverse(), joel).unit, 750);
  assert.equal(P.applyStack(1250, [promo('pct', 60), promo('pct', 60)], joel).unit, 0);
  assert.equal(P.applyStack(1250, [promo('fijo', 2000)], joel).unit, 0);
});
test('Redondeo decimal half-up coincide con PostgreSQL numeric en medio centavo', () => {
  assert.equal(P.applyStack(0.15, [promo('pct', 90)], joel).unit, 0.02);
  assert.equal(P.applyStack(10.05, [promo('pct', 10)], joel).unit, 9.05);
  assert.equal(P.applyStack(10.05, [promo('pct', 10), promo('fijo', 0.01)], joel).unit, 9.04);
  assert.equal(P.applyStack(100, [promo('pct', 0.1), promo('pct', 0.2)], joel).unit, 99.7);
  assert.equal(P.applyStack(1, [promo('fijo', 0.1), promo('fijo', 0.2)], joel).unit, 0.7);
});
test('Cada promoción valida tipo, porcentaje0..100 y fijo no negativo, finitos y dos decimales', () => {
  for (const value of [-1, 100.01, 101, Infinity, NaN, '', 'abc', null, true, 0.001]) {
    assert.throws(() => P.applyStack(1250, [promo('pct', value)], joel), undefined, String(value));
  }
  for (const value of [-1, Infinity, NaN, '', 'abc', null, true, 0.001]) {
    assert.throws(() => P.applyStack(1250, [promo('fijo', value)], joel), undefined, String(value));
  }
  assert.throws(() => P.applyStack(1250, [promo('desconocido', 10)], joel));
  assert.equal(P.validate(promo('pct', '30.00')), 30);
  assert.equal(P.applyStack(1250, [promo('pct', 0)], joel).unit, 1250);
  assert.equal(P.applyStack(1250, [promo('fijo', 0)], joel).unit, 1250);
});
test('Vista previa y POS resuelven el precio de la talla V1 filtrada, no precio general', () => {
  const v1 = { id: 'v1', sku: 'TEST-V1', precio: 350, costo: 563, sizeCategoryId: 'size_letter',
    preciosTalla: { XL: 450 }, stock: [{ talla: 'M', escala: 'L', stock: 2 }, { talla: 'XL', escala: 'L', stock: 1 }] };
  const p = promo('pct', 30, { tallas: ['XL'] });
  D.products = [v1]; D.promos = [p];
  const result = P.previewDraft(p);
  assert.equal(result.count, 1);
  assert.equal(result.examples.length, 1);
  assert.equal(result.examples[0].talla, 'XL');
  assert.equal(result.examples[0].orig, 450);
  assert.equal(result.examples[0].unit, 315);
  assert.equal(result.examples[0].unit, P.lineUnit(v1, 'XL').unit);
  assert.equal(P.lineUnit(v1, 'M').unit, 350);
});
test('Conteo V2 es por referencia y conserva alcance por talla aunque stock sea cero', () => {
  const p = promo('pct', 30, { tallas: ['40'] });
  D.products = [{ ...joel, stockQuantity: 0 }, { ...joel, id: 'other-40', stockQuantity: 1 }, { ...joel, id: 'other-42', sizeCode: '42' }];
  D.promos = [p];
  const result = P.previewDraft(p);
  assert.equal(result.count, 2);
  assert.equal(result.examples.length, 2);
  for (const example of result.examples) {
    assert.equal(example.talla, '40');
    assert.equal(example.unit, P.lineUnit(example.p, example.talla).unit);
    assert.equal(example.unit, 875);
  }
});
test('La edición inválida informa error en la vista previa sin inventar un descuento', () => {
  D.products = [joel];
  const result = P.previewDraft(promo('pct', 101));
  assert.ok(result.error);
  assert.equal(result.examples.length, 0);
  assert.equal(result.count, 1);
});
test('Vigencia Hermosillo y pausa preservan el contrato de promociones activas', () => {
  const p = promo('pct', 30);
  for (const [date, expected] of [
    ['2026-10-09T23:59:59-07:00', 'Programado'], ['2026-10-10T00:00:00-07:00', 'Activo'],
    ['2026-10-19T23:59:00-07:00', 'Activo'], ['2026-10-20T00:00:00-07:00', 'Finalizado'],
  ]) { now = new Date(date); assert.equal(P.estado(p), expected); }
  assert.equal(P.estado({ ...p, pausado: true }), 'Pausado');
  now = null; assert.equal(P.estado(p), 'Sin conexión');
});

console.log(`H-186 promociones: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
