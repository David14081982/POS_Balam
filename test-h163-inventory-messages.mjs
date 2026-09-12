import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const baseline = process.argv.includes('--baseline');
const source = baseline
  ? execFileSync('git', ['show', 'f529b0c:balam/shared.jsx'], { encoding: 'utf8' })
  : fs.readFileSync('balam/shared.jsx', 'utf8');
const element = (type, props, ...children) => ({ type, props: props || {}, children });
const sandbox = {
  console, setTimeout: () => 1, clearTimeout() {}, navigator: {},
  document: { getElementById: () => ({}), head: { appendChild() {} }, createElement: () => ({}) },
  React: { createElement: element, cloneElement: element, useState: value => [value, () => {}],
    useEffect() {}, useRef: value => ({ current: value }) },
};
sandbox.window = sandbox;
sandbox.AUTH = { isAdmin: () => false, role: () => 'vendedor' };
vm.createContext(sandbox); vm.runInContext(source, sandbox);
const UI = sandbox.UI;
const message = (code, extra = {}) => UI.messageAuthority({ context: 'inventory_import', code, ...extra });
const checks = [];
function check(name, run) {
  try { run(); checks.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, ok: false }); console.log(`FAIL ${name}: ${error.message}`); }
}

check('shared SKU is allowed information, without a failure instruction', () => {
  const result = message('SKU_DUPLICATE_WARNING');
  assert.equal(result.level, 'neutral');
  assert.match(result.title, /pueden compartir/);
  assert.doesNotMatch(UI.messageText(result), /no se pudo|detuvo|formato|inténtalo/i);
});
check('legacy string shared-SKU warning has the same safe classification', () => {
  assert.equal(UI.messageAuthority('SKU_DUPLICATE_WARNING: 2 referencias comparten el SKU ABC').level, 'neutral');
});
check('missing inventory is explained as missing product, with a new-product path', () => {
  const result = message('ID_NOT_FOUND');
  assert.match(result.title, /ya no está en el inventario/);
  assert.match(result.action, /darlo de alta/);
  assert.doesNotMatch(result.title, /formato/);
});
check('an obsolete export directs the user to an up-to-date export', () => {
  const result = message('VERSION_CONFLICT');
  assert.match(result.title, /después de exportar/);
  assert.match(result.action, /Exporta el inventario actual/);
});
check('unknown catalog value identifies the row, visible field and exact code', () => {
  const result = message('UNKNOWN_CATALOG_VALUE', { rowNumber: 6, header: 'Colores de ornamento V2', value: 'AZL' });
  assert.match(result.title, /Fila 6.*Colores de ornamento/);
  assert.match(result.explanation, /«AZL».*no está activo/);
  assert.doesNotMatch(result.title, /V2|formato/);
});
check('invalid amount provides the actionable cell and reason', () => {
  const result = message('INVENTORY_ROW_INVALID', { rowNumber: 3, header: 'Precio', reason: 'debe ser un número mayor o igual a cero.' });
  assert.match(result.title, /Fila 3.*Precio/);
  assert.match(result.explanation, /mayor o igual a cero/);
});
check('invalid technical cell does not expose technical vocabulary as the main explanation', () => {
  const result = message('INVENTORY_ROW_INVALID', { rowNumber: 3, header: '_BALAM_REFERENCE_FAMILY_ID', reason: 'debe ser un UUID v4 válido.' });
  assert.doesNotMatch([result.title, result.explanation, result.action].join(' '), /_BALAM|UUID|v4/);
  assert.match(result.technicalDetails, /UUID/);
});
check('real duplicate references remain blocking and distinct from a shared SKU', () => {
  for (const code of ['DUPLICATE_ID_FILE', 'BARCODE_DUPLICATE', 'REFERENCE_SIGNATURE_DUPLICATE']) {
    assert.equal(message(code).level, 'danger');
    assert.match(message(code).title, /más de una vez/);
  }
});
check('barcode and physical collisions also direct review to existing inventory', () => {
  for (const code of ['BARCODE_DUPLICATE', 'REFERENCE_SIGNATURE_DUPLICATE']) {
    const result = message(code, { rowNumber: 2, message: 'Una fila coincide con una referencia actual.' });
    assert.equal(result.level, 'danger');
    assert.match(result.action, /Inventario/);
    assert.match(result.action, /archivo/);
    assert.doesNotMatch(result.action, /Conserva una sola fila/);
    assert.match(result.technicalDetails, /Una fila coincide con una referencia actual/);
  }
});
check('physical reclassification is not described as a format failure', () => {
  assert.match(message('REFERENCE_RECLASSIFICATION_REQUIRED').title, /reclasificar/);
  assert.doesNotMatch(message('REFERENCE_RECLASSIFICATION_REQUIRED').title, /formato/);
});
check('ambiguous current SKU directs repair to inventory rather than Excel rows', () => {
  const result = message('DUPLICATE_SKU_CURRENT');
  assert.match(result.title, /productos actuales/);
  assert.match(result.action, /en Inventario/);
  assert.doesNotMatch(result.action, /una sola fila/);
});
check('incomplete local storage is not reported as successful import', () => {
  const result = message('INVENTORY_IMPORT_STORAGE_PENDING');
  assert.equal(result.level, 'warning');
  assert.match(result.title, /completar el guardado/);
});
check('a pending payment explains why inventory cannot be edited yet', () => {
  const result = message('LAYAWAY_PRODUCT_LOCKED');
  assert.equal(result.level, 'danger');
  assert.match(result.action, /termine el cobro/);
  assert.doesNotMatch(result.action, /eliminar/);
});
check('same code outside inventory import retains its existing classification', () => {
  assert.equal(UI.messageAuthority({ code: 'ID_NOT_FOUND' }).title, 'El archivo no tiene el formato esperado');
  assert.equal(UI.messageAuthority({ context: 'product_delete', code: 'product_not_found' }).title, 'El producto ya no está en el inventario');
});
check('template/download failure preserves an actionable safe reason', () => {
  const result = UI.messageAuthority({ context: 'inventory_template', code: 'INVENTORY_EXPORT_FAILED', reason: 'Dos tallas comparten la etiqueta «38».' });
  assert.match(result.title, /descargar/);
  assert.match(result.explanation, /«38»/);
});
check('technical details remain unavailable to the seller', () => {
  const element = UI.HumanMessage({ message: { context: 'inventory_import', code: 'ID_NOT_FOUND', message: 'private technical detail' } });
  assert.doesNotMatch(JSON.stringify(element), /private technical detail/);
  sandbox.AUTH = { isAdmin: () => true, role: () => 'admin' };
  assert.match(JSON.stringify(UI.HumanMessage({ message: { context: 'inventory_import', code: 'ID_NOT_FOUND', message: 'private technical detail' } })), /private technical detail/);
});

const passed = checks.filter(row => row.ok).length;
console.log(`H163 inventory messages: ${passed}/${checks.length} passed${baseline ? ' (baseline)' : ''}`);
if (passed !== checks.length) process.exitCode = 1;
