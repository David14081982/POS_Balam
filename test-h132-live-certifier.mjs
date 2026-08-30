// H-132 · El certificador debe ser reproducible sin tocar Supabase.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const temp = mkdtempSync(join(tmpdir(), 'balam-h132-certifier-'));
const uuid = suffix => `10000000-0000-4000-8000-${suffix.padStart(12, '0')}`;
const barcodeV3 = id => {
  const hex = String(id).replace(/-/g, '');
  return '3' + BigInt(`0x${hex.slice(-20)}`).toString().padStart(25, '0');
};
const v2 = ({ id, size, stock, barcode, sku = '1-ANG-MC-AJSP-TRA-BL' }) => ({
  id: uuid(id),
  record_model: 'v2',
  reference_family_id: uuid('900'),
  cat: 'dama',
  manga: 'MC',
  tela: 'AJSP',
  color: 'BL',
  cuello: 'TRA',
  modelo: 'ANGEL',
  nombre: 'ANGEL',
  orn: '',
  orn_colors: [],
  ornament_color_codes: [],
  precio: 500,
  costo: 250,
  stock: [],
  stock_quantity: stock,
  size_code: size,
  size_scale: 'N',
  size_category_id: null,
  sku,
  barcode_code: barcode,
  barcode_contract: 3,
  barcode_aliases: [],
  physical_signature: null,
  attrs: {},
  sync_version: 1,
  deleted_at: null,
});
const v1 = ({ id, stock = 1 }) => ({
  id: uuid(id),
  record_model: 'v1',
  reference_family_id: null,
  cat: 'dama',
  manga: 'MC',
  tela: 'AJSP',
  color: 'BL',
  cuello: 'TRA',
  modelo: 'ANGEL',
  nombre: 'ANGEL LEGADO',
  orn: '',
  orn_colors: [],
  ornament_color_codes: [],
  precio: 500,
  costo: 250,
  stock: [{ talla: '38', escala: 'N', stock }],
  stock_quantity: null,
  size_code: null,
  size_scale: null,
  size_category_id: null,
  sku: '1-ANG-MC-AJSP-TRA-BL',
  barcode_code: null,
  barcode_contract: null,
  barcode_aliases: [],
  physical_signature: null,
  attrs: {},
  sync_version: 1,
  deleted_at: null,
});
const localShape = row => ({
  id: row.id,
  recordModel: row.record_model,
  referenceFamilyId: row.reference_family_id,
  sku: row.sku,
  barcodeCode: row.barcode_code,
  barcodeContract: row.barcode_contract,
  barcodeAliases: row.barcode_aliases,
  sizeCode: row.size_code,
  stockQuantity: row.stock_quantity,
  stock: row.stock,
  _deletedAt: row.deleted_at,
});

function run(name, remoteRows, localRows, reportedCode) {
  const remote = join(temp, `${name}-remote.json`);
  const local = join(temp, `${name}-local.json`);
  const output = join(temp, `${name}-output`);
  writeFileSync(remote, JSON.stringify({ capturedAt: '2026-08-29T00:00:00.000Z', data: remoteRows }));
  writeFileSync(local, JSON.stringify({ data: localRows }));
  const result = spawnSync(process.execPath, [
    'audit-h132-live-inventory.mjs', '--snapshot', remote, '--local', local,
    '--output', output, '--reported-code', reportedCode,
  ], { cwd: process.cwd(), encoding: 'utf8', timeout: 120000 });
  return {
    ...result,
    report: JSON.parse(readFileSync(join(output, 'resumen-inventario-vendible.json'), 'utf8')),
  };
}

const healthy = [
  v2({ id: '1', size: '38', stock: 1, barcode: barcodeV3(uuid('1')) }),
  v2({ id: '2', size: '40', stock: 2, barcode: barcodeV3(uuid('2')) }),
];
const good = run('healthy', healthy, healthy.map(localShape), barcodeV3(uuid('1')));
assert.equal(good.status, 0, good.stderr || good.stdout);
assert.deepEqual({
  references: good.report.summary.totalReferences,
  combinations: good.report.summary.totalCombinations,
  pieces: good.report.summary.totalPieces,
  certified: good.report.summary.certified,
  repeatedSkuGroups: good.report.summary.duplicateVisibleSkuGroups,
  failures: good.report.summary.failures,
  angelCombinations: good.report.summary.angel.combinations,
  angelScans: good.report.summary.angel.scans,
}, {
  references: 2, combinations: 2, pieces: 3, certified: 2,
  repeatedSkuGroups: 1, failures: 0, angelCombinations: 2, angelScans: 2,
});
assert.equal(good.report.traces[0].cause, 'OK');

const broken = [
  v1({ id: '3' }),
  v2({ id: '4', size: '38', stock: 1, barcode: barcodeV3(uuid('4')) }),
  v2({ id: '5', size: '40', stock: 1, barcode: barcodeV3(uuid('4')) }),
];
const localBroken = structuredClone(broken);
localBroken[1].stock_quantity = 9;
const bad = run('broken', broken, localBroken, '1-ANG-MC-AJSP-TRA-BL-38');
assert.equal(bad.status, 1, 'el certificador debe fallar cerrado');
assert.equal(bad.report.summary.v1.combinations, 1);
assert.equal(bad.report.summary.barcodeDuplicate, 2);
assert.equal(bad.report.summary.localRemoteMismatch, 1);
assert.equal(bad.report.summary.failures, 3);
assert.equal(bad.report.summary.labelsNeedRegeneration, 3);
assert.equal(bad.report.summary.hardwareCertified, false);
// Ese texto es un localizador V1 válido si la referencia histórica existe. Sin
// el snapshot vivo no es lícito atribuir el "no encontrado" a otra causa.
assert.equal(bad.report.traces[0].cause, 'OK');

console.log('H-132 live certifier: 2/2 scenarios OK');
