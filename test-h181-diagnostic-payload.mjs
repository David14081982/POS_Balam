// H-181: independent PNG decoding, CRC and synthetic Browser Print contract.
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { syntheticPng, buildDiagnosticManifest, validateDiagnosticRecord, DIAGNOSTIC } from './h181-thermer-diagnostic.mjs';

const table = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
const crc32 = bytes => (bytes.reduce((crc, byte) => table[(crc ^ byte) & 255] ^ (crc >>> 8), 0xffffffff) ^ 0xffffffff) >>> 0;
let checks = 0;
for (const height of [96, 2438]) {
  const png = syntheticPng(height); assert.deepEqual(png.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  const chunks = []; let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), end = offset + length + 12;
    assert.ok(end <= png.length, 'complete chunk');
    assert.equal(png.readUInt32BE(end - 4), crc32(png.subarray(offset + 4, end - 4)), 'CRC');
    chunks.push({ type: png.toString('ascii', offset + 4, offset + 8), data: png.subarray(offset + 8, end - 4) }); offset = end;
  }
  assert.equal(offset, png.length); assert.deepEqual(chunks.map(chunk => chunk.type), ['IHDR', 'IDAT', 'IEND']);
  const header = chunks[0].data; assert.equal(header.length, 13);
  assert.equal(header.readUInt32BE(0), 576); assert.equal(header.readUInt32BE(4), height);
  assert.deepEqual([...header.subarray(8)], [8,0,0,0,0], 'gray8, standard compression/filter, no interlace');
  const rows = inflateSync(chunks[1].data), pixels = Buffer.alloc(576 * height);
  assert.equal(rows.length, 577 * height);
  for (let y = 0; y < height; y++) {
    assert.equal(rows[y * 577], 1, 'Sub filter matches production'); let left = 0;
    for (let x = 0; x < 576; x++) { left = (left + rows[y * 577 + x + 1]) % 256; pixels[y * 576 + x] = left; }
  }
  assert.ok(pixels.every(value => value === 0 || value === 255));
  const black = pixels.reduce((count, value) => count + (value === 0 ? 1 : 0), 0);
  assert.ok(black > 1000 && black / pixels.length < 0.1, 'visible sparse black pattern');
  for (const y of [4, 5, height - 6, height - 5]) assert.equal(pixels[y * 576 + 200], 0, 'top/bottom marker');
  for (const y of [12, Math.floor(height / 2), height - 12]) {
    assert.equal(pixels[y * 576 + 4], 0); assert.equal(pixels[y * 576 + 571], 0);
  }
  assert.equal(pixels[0], 255); assert.equal(pixels[10 * 576 + 10], 255);
  assert.ok(png.length < 30000); assert.deepEqual(syntheticPng(height), png, 'deterministic fixture');
  checks++; console.log('PASS H181 synthetic gray8 PNG 576x' + height + ': CRC, zlib, Sub, sparse content');
}
assert.throws(() => syntheticPng(2437), /DIAGNOSTIC_HEIGHT/);
const urls = ['https://print.example/synthetic-small.png', 'https://print.example/synthetic-long.png'];
const manifest = buildDiagnosticManifest(urls), wire = JSON.parse(JSON.stringify(manifest));
assert.deepEqual(Object.keys(wire), ['0','1','2','3','4']);
assert.deepEqual(Object.values(wire).map(entry => entry.type), [0,1,0,1,0]);
assert.deepEqual(Object.values(wire).filter(entry => entry.type === 0),
  ['INICIO BALAM','IMAGEN LARGA','FIN BALAM'].map(content => ({ type: 0, content, bold: 0, align: 0, format: 0 })));
assert.deepEqual(wire['1'], { type: 1, path: urls[0], align: 0 });
assert.deepEqual(wire['3'], { type: 1, path: urls[1], align: 0 });
assert.ok(/^[\x00-\x7f]*$/.test(JSON.stringify(wire)), 'only synthetic ASCII text/URLs');
assert.throws(() => buildDiagnosticManifest([urls[0]]), /TWO_DIAGNOSTIC_IMAGES_REQUIRED/);
assert.throws(() => buildDiagnosticManifest(['javascript:alert(1)', urls[1]]), /DIAGNOSTIC_IMAGE_URL/);
checks++; console.log('PASS H181 manifest: ordered markers, two images, exact fields, synthetic ASCII only');

const id = '1790888888-12345678-1234-4234-8234-123456789abc';
const record = { schema: 'balam-h181-synthetic-diagnostic-v1', synthetic: true,
  projectRef: DIAGNOSTIC.projectRef, bucket: DIAGNOSTIC.bucket, id,
  names: [id + '-0.png', id + '-1.png', id + '.json'] };
assert.deepEqual(validateDiagnosticRecord(record), record.names);
for (const invalid of [
  { ...record, projectRef: 'other' }, { ...record, bucket: 'public' }, { ...record, synthetic: false },
  { ...record, id: '../another' }, { ...record, names: ['*'] },
  { ...record, names: [record.names[0], record.names[1], 'another.json'] },
]) assert.throws(() => validateDiagnosticRecord(invalid), /DIAGNOSTIC_RECORD/);
checks++; console.log('PASS H181 cleanup record: fixed project/bucket and exactly three owned names');
const imported = execFileSync(process.execPath, ['--input-type=module', '-e', "await import('./h181-thermer-diagnostic.mjs')"], { encoding: 'utf8', windowsHide: true });
assert.equal(imported, '', 'import has no CLI/network/log side effects');
checks++; console.log('PASS H181 import: no operator CLI or network execution');
console.log('PASS H181 diagnostic payload: ' + checks + '/' + checks + '; physical printing NOT_TESTED');
