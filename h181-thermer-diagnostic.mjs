// H-181: synthetic Browser Print probe. Importing this module performs no I/O.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const DIAGNOSTIC = Object.freeze({
  projectRef: 'telohdbvbvsfmwyriflz', bucket: 'balam-thermer-private', ttlSeconds: 600,
  base: 'https://telohdbvbvsfmwyriflz.supabase.co', width: 576,
  smallHeight: 96, longHeight: 2438,
  page: 'https://david14081982.github.io/POS_Balam/pwa/thermer-check.html',
});
const schema = 'balam-h181-synthetic-diagnostic-v1';
const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));
const fail = code => { throw new Error('H181_' + code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function chunk(type, content) {
  const bytes = Buffer.alloc(content.length + 12);
  bytes.writeUInt32BE(content.length, 0); bytes.write(type, 4, 4, 'ascii'); content.copy(bytes, 8);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(4, bytes.length - 4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, bytes.length - 4);
  return bytes;
}

// Same PNG transport format as receiptGraphic: gray8, black/white, Sub rows,
// zlib-compressed IDAT. Only borders and sparse marks; no receipt or business data.
export function syntheticPng(height) {
  if (![DIAGNOSTIC.smallHeight, DIAGNOSTIC.longHeight].includes(height)) fail('DIAGNOSTIC_HEIGHT');
  const width = DIAGNOSTIC.width, rows = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const offset = y * (width + 1); rows[offset] = 1; let previous = 0;
    for (let x = 0; x < width; x++) {
      const border = x >= 4 && x < width - 4 && y >= 4 && y < height - 4
        && (x < 6 || x >= width - 6 || y < 6 || y >= height - 6);
      const rule = y >= 16 && y < height - 16 && y % 96 < 2 && x >= 20 && x < width - 20;
      const mark = y >= 16 && y < height - 16 && y % 48 < 4
        && x >= 24 && x < width - 24 && x % 64 < 4;
      const gray = border || rule || mark ? 0 : 255;
      rows[offset + x + 1] = (gray - previous) & 255; previous = gray;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

export function buildDiagnosticManifest(imageUrls) {
  if (!Array.isArray(imageUrls) || imageUrls.length !== 2) fail('TWO_DIAGNOSTIC_IMAGES_REQUIRED');
  imageUrls.forEach(value => {
    let url; try { url = new URL(value); } catch { fail('DIAGNOSTIC_IMAGE_URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) fail('DIAGNOSTIC_IMAGE_URL');
  });
  const text = content => ({ type: 0, content, bold: 0, align: 0, format: 0 });
  return { '0': text('INICIO BALAM'), '1': { type: 1, path: imageUrls[0], align: 0 },
    '2': text('IMAGEN LARGA'), '3': { type: 1, path: imageUrls[1], align: 0 }, '4': text('FIN BALAM') };
}

export { syntheticPng as diagnosticPng, buildDiagnosticManifest as diagnosticManifest };

export function validateDiagnosticRecord(record) {
  if (!record || record.schema !== schema || record.synthetic !== true
    || record.projectRef !== DIAGNOSTIC.projectRef || record.bucket !== DIAGNOSTIC.bucket
    || !/^\d{10}-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.id || '')) fail('DIAGNOSTIC_RECORD');
  const expected = [record.id + '-0.png', record.id + '-1.png', record.id + '.json'];
  if (!Array.isArray(record.names) || record.names.length !== 3
    || record.names.some((name, index) => name !== expected[index])) fail('DIAGNOSTIC_RECORD_NAMES');
  return expected;
}

function signedUrl(value, name) {
  let url; try { url = new URL(value); } catch { fail('SIGNED_URL_INVALID'); }
  if (url.origin !== DIAGNOSTIC.base || url.username || url.password || url.hash
    || url.pathname !== '/storage/v1/object/sign/' + DIAGNOSTIC.bucket + '/' + name
    || [...url.searchParams.keys()].join(',') !== 'token' || !url.searchParams.get('token')) fail('SIGNED_URL_INVALID');
  return value;
}

async function operatorClient() {
  let keys;
  try {
    keys = JSON.parse(execFileSync(process.execPath,
      [path.join(sourceDirectory, 'node_modules/supabase/dist/supabase.js'), 'projects', 'api-keys',
        '--project-ref', DIAGNOSTIC.projectRef, '-o', 'json'],
      { cwd: sourceDirectory, encoding: 'utf8', windowsHide: true, timeout: 60000,
        maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch { fail('OPERATOR_KEYS_UNAVAILABLE'); }
  if (!Array.isArray(keys)) keys = keys?.keys || keys?.api_keys;
  const serviceKey = Array.isArray(keys) && keys.find(key => key.name === 'service_role')?.api_key;
  if (typeof serviceKey !== 'string' || !serviceKey) fail('OPERATOR_KEYS_UNAVAILABLE');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(DIAGNOSTIC.base, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function writeJson(filename, value) {
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

async function download(url, type) {
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (response.status !== 200 || !response.headers.get('content-type')?.includes(type)) fail('SIGNED_DOWNLOAD_FAILED');
  return Buffer.from(await response.arrayBuffer());
}

async function removeExact(store, names) {
  const result = await store.remove(names);
  if (result.error) fail('EXACT_CLEANUP_FAILED');
}

function outsideRepository(directory) {
  const relative = path.relative(sourceDirectory, directory);
  return relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
}

async function prepare() {
  const client = await operatorClient();
  const bucket = await client.storage.getBucket(DIAGNOSTIC.bucket);
  if (bucket.error || bucket.data?.public !== false) fail('PRIVATE_BUCKET_REQUIRED');
  if (!outsideRepository(fs.realpathSync(os.tmpdir()))) fail('EXTERNAL_TEMP_DIRECTORY_REQUIRED');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'balam-h181-diagnostic-'));
  const now = Math.floor(Date.now() / 1000), id = now + '-' + randomUUID();
  const names = [id + '-0.png', id + '-1.png', id + '.json'];
  const recordPath = path.join(directory, 'record.json');
  const record = { schema, synthetic: true, projectRef: DIAGNOSTIC.projectRef,
    bucket: DIAGNOSTIC.bucket, id, names, createdAt: new Date().toISOString(), expiresAt: (now + DIAGNOSTIC.ttlSeconds) * 1000 };
  validateDiagnosticRecord(record); writeJson(recordPath, record);
  const store = client.storage.from(DIAGNOSTIC.bucket), images = [syntheticPng(96), syntheticPng(2438)];
  try {
    const urls = [];
    for (let i = 0; i < images.length; i++) {
      fs.writeFileSync(path.join(directory, 'synthetic-' + i + '.png'), images[i], { mode: 0o600 });
      const upload = await store.upload(names[i], images[i], { contentType: 'image/png', cacheControl: '0', upsert: false });
      if (upload.error) fail('FIXTURE_UPLOAD_FAILED');
      const signed = await store.createSignedUrl(names[i], DIAGNOSTIC.ttlSeconds);
      if (signed.error) fail('FIXTURE_SIGN_FAILED');
      urls.push(signedUrl(signed.data?.signedUrl, names[i]));
    }
    const manifest = buildDiagnosticManifest(urls), manifestBytes = Buffer.from(JSON.stringify(manifest));
    const upload = await store.upload(names[2], manifestBytes, { contentType: 'application/json', cacheControl: '0', upsert: false });
    if (upload.error) fail('FIXTURE_UPLOAD_FAILED');
    const remaining = now + DIAGNOSTIC.ttlSeconds - Math.floor(Date.now() / 1000);
    if (remaining <= 0) fail('FIXTURE_EXPIRED_DURING_PREPARATION');
    const signed = await store.createSignedUrl(names[2], remaining);
    if (signed.error) fail('FIXTURE_SIGN_FAILED');
    const url = signedUrl(signed.data?.signedUrl, names[2]);
    const received = await download(url, 'application/json');
    if (!received.equals(manifestBytes)) fail('MANIFEST_BYTES_CHANGED');
    for (let i = 0; i < images.length; i++) {
      if (!(await download(urls[i], 'image/png')).equals(images[i])) fail('IMAGE_BYTES_CHANGED');
    }
    const link = DIAGNOSTIC.page + '#' + new URLSearchParams({ url, expires: String(record.expiresAt) });
    Object.assign(record, { url, link, status: 'READY' }); writeJson(recordPath, record);
    writeJson(path.join(directory, 'evidence.json'), {
      schema, synthetic: true, verifiedAt: new Date().toISOString(), expiresAt: record.expiresAt,
      privateBucket: true, anonymousSignedDownloads: 'PASS', exactManifestBytes: true,
      images: images.map((bytes, i) => ({ width: 576, height: [96,2438][i], byteLength: bytes.length, sha256: hash(bytes) })),
      manifestSha256: hash(manifestBytes), physicalPrinting: 'NOT_TESTED',
    });
    console.log('H181_DIAGNOSTIC_READY'); console.log('Registro: ' + recordPath); console.log(link);
  } catch (error) {
    try { await removeExact(store, names); record.status = 'FAILED_CLEANED'; }
    catch { record.status = 'CLEANUP_REQUIRED'; }
    writeJson(recordPath, record);
    console.error('Registro: ' + recordPath);
    if (record.status === 'CLEANUP_REQUIRED') fail('EXACT_CLEANUP_FAILED');
    throw error;
  }
}

async function cleanup(filename) {
  const resolved = fs.realpathSync(path.resolve(filename)), directory = path.dirname(resolved);
  const temporary = fs.realpathSync(os.tmpdir());
  if (path.basename(resolved) !== 'record.json' || path.dirname(directory) !== temporary
    || !/^balam-h181-diagnostic-[A-Za-z0-9]+$/.test(path.basename(directory))) fail('DIAGNOSTIC_RECORD_PATH');
  const record = JSON.parse(fs.readFileSync(resolved, 'utf8')), names = validateDiagnosticRecord(record);
  const client = await operatorClient();
  await removeExact(client.storage.from(DIAGNOSTIC.bucket), names);
  record.status = 'CLEANED'; record.cleanedAt = new Date().toISOString();
  delete record.url; delete record.link; writeJson(resolved, record);
  console.log('H181_DIAGNOSTIC_EXACT_CLEANUP_COMPLETE');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 1 && args[0] === '--prepare') await prepare();
    else if (args.length === 2 && args[0] === '--cleanup') await cleanup(args[1]);
    else { console.log('Uso: node h181-thermer-diagnostic.mjs --prepare | --cleanup <record.json>'); process.exitCode = 2; }
  } catch (error) {
    console.error(/^H181_[A-Z_]+$/.test(error.message || '') ? error.message : 'H181_DIAGNOSTIC_FAILED');
    process.exitCode = 1;
  }
}
