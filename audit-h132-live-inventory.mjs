// H-132 · Certificador exhaustivo de inventario vendible.
// Lee Supabase mediante el endpoint oficial read-only o un snapshot explícito.
// No importa, no persiste, no sincroniza, no llama RPC y no modifica filas.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve, join } from 'node:path';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const snapshotPath = option('--snapshot') ? resolve(option('--snapshot')) : null;
const localPath = option('--local') ? resolve(option('--local')) : null;
const outputDir = resolve(option('--output') || '.evidence-h132-live');
const projectRef = process.env.SUPABASE_PROJECT_REF
  || (existsSync('supabase/.temp/project-ref') ? readFileSync('supabase/.temp/project-ref', 'utf8').trim() : '');
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || '';
const reportedCodes = args.flatMap((arg, index) => arg === '--reported-code' ? [args[index + 1]] : []).filter(Boolean);

const INVENTORY_QUERY = `select
  p.id::text,
  p.record_model,
  p.reference_family_id::text,
  p.cat,
  p.manga,
  p.tela,
  p.color,
  p.cuello,
  p.modelo,
  p.nombre,
  p.orn,
  p.orn_colors,
  p.ornament_color_codes,
  p.precio,
  p.costo,
  p.stock,
  p.stock_quantity,
  p.size_code,
  p.size_scale,
  p.size_category_id,
  p.sku,
  p.barcode_code,
  p.physical_signature,
  p.attrs,
  p.sync_version,
  p.deleted_at
from pos.products p
where p.deleted_at is null
order by p.id`;

function asRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload && payload.data)) return payload.data;
  if (Array.isArray(payload && payload.result)) return payload.result;
  if (Array.isArray(payload && payload.rows)) return payload.rows;
  if (Array.isArray(payload && payload.products)) return payload.products;
  throw new Error('REMOTE_QUERY_RESPONSE_UNRECOGNIZED');
}

async function fetchRemoteRows() {
  if (snapshotPath) {
    if (!existsSync(snapshotPath)) throw new Error(`SNAPSHOT_NOT_FOUND:${snapshotPath}`);
    const payload = JSON.parse(readFileSync(snapshotPath, 'utf8'));
    return { rows: asRows(payload), source: `snapshot:${basename(snapshotPath)}`, capturedAt: payload.capturedAt || null };
  }
  if (!projectRef) throw new Error('SUPABASE_PROJECT_REF_REQUIRED');
  if (!accessToken) throw new Error('SUPABASE_ACCESS_TOKEN_REQUIRED_FOR_READ_ONLY_QUERY');
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query/read-only`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: INVENTORY_QUERY, parameters: [] }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`REMOTE_QUERY_${response.status}:${text.slice(0, 300)}`);
  return { rows: asRows(JSON.parse(text)), source: `supabase:${projectRef}`, capturedAt: new Date().toISOString() };
}

function readLocalRows() {
  if (!localPath) return null;
  if (!existsSync(localPath)) throw new Error(`LOCAL_SNAPSHOT_NOT_FOUND:${localPath}`);
  const payload = JSON.parse(readFileSync(localPath, 'utf8'));
  return asRows(payload);
}

const remote = await fetchRemoteRows();
const localRows = readLocalRows();
await mkdir(outputDir, { recursive: true });

const root = resolve('.');
const server = createServer((request, response) => {
  let pathname = decodeURIComponent(request.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const file = join(root, pathname);
  if (!file.startsWith(root) || !existsSync(file)) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { 'Content-Type': pathname.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
  createReadStream(file).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let audit;
try {
  const context = await browser.newContext();
  await context.route(/supabase\.co/, route => route.abort());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.BARCODES?.ready());
  audit = await page.evaluate(({ remoteRows, localRows, reportedCodes }) => {
    const D = window.DATA, B = window.BARCODES;
    const clientRow = row => D.hydrate({
      id: row.id,
      recordModel: row.record_model || 'v1',
      referenceFamilyId: row.reference_family_id || null,
      cat: row.cat,
      manga: row.manga,
      tela: row.tela,
      color: row.color,
      cuello: row.cuello,
      modelo: row.modelo,
      nombre: row.nombre,
      orn: row.orn,
      ornColors: row.orn_colors || [],
      ornamentColorCodes: row.ornament_color_codes || [],
      precio: Number(row.precio) || 0,
      costo: Number(row.costo) || 0,
      stock: Array.isArray(row.stock) ? row.stock : [],
      stockQuantity: row.stock_quantity == null ? null : Number(row.stock_quantity),
      sizeCode: row.size_code || null,
      sizeScale: row.size_scale || null,
      sizeCategoryId: row.size_category_id || (row.attrs || {}).__sizeCategoryId || null,
      sku: row.sku || '',
      barcodeCode: row.barcode_code || null,
      physicalSignature: row.physical_signature || null,
      attrs: row.attrs || {},
      _syncVersion: Number(row.sync_version) || 0,
      _deletedAt: row.deleted_at || null,
    });
    const products = remoteRows.map(clientRow);
    D.products.splice(0, D.products.length, ...products);
    const byId = new Map(products.map(product => [String(product.id), product]));
    const localById = new Map((localRows || []).map(row => [String(row.id), row]));
    // El snapshot local puede ser el JSON crudo de pos.products o la colección
    // camelCase de localStorage/DATA. Ambos se llevan a la misma forma estable.
    const field = (row, snake, camel) => row[snake] !== undefined ? row[snake] : row[camel];
    const stable = row => JSON.stringify({
      record_model: String(field(row, 'record_model', 'recordModel') || 'v1').toLowerCase(),
      reference_family_id: field(row, 'reference_family_id', 'referenceFamilyId') || null,
      sku: row.sku || '',
      barcode_code: field(row, 'barcode_code', 'barcodeCode') || null,
      size_code: field(row, 'size_code', 'sizeCode') || null,
      stock_quantity: field(row, 'stock_quantity', 'stockQuantity') == null
        ? null : Number(field(row, 'stock_quantity', 'stockQuantity')),
      stock: row.stock || [],
      deleted_at: field(row, 'deleted_at', '_deletedAt') || null,
    });
    const localState = remoteRow => {
      if (!localRows) return 'NOT_PROVIDED';
      const local = localById.get(String(remoteRow.id));
      if (!local) return 'MISSING_LOCAL';
      return stable(local) === stable(remoteRow) ? 'MATCH' : 'MISMATCH';
    };
    const combinations = [];
    remoteRows.forEach(row => {
      const product = byId.get(String(row.id));
      const v2 = (row.record_model || 'v1') === 'v2';
      const sizes = v2
        ? [{ size: String(row.size_code || ''), stock: Number(row.stock_quantity) || 0 }]
        : (Array.isArray(row.stock) ? row.stock : []).map(item => ({
          size: String(item.talla != null ? item.talla : item.size_code || ''), stock: Number(item.stock) || 0,
        }));
      sizes.filter(item => item.stock > 0).forEach(item => combinations.push({ row, product, ...item }));
    });
    const hidRoundTrip = value => Array.from(String(value || '')).map(character => {
      if (character === '-') return B.scannerChar({ key: "'", code: 'Minus' });
      if (character === '/') return B.scannerChar({ key: '-', code: 'Slash' });
      return B.scannerChar({ key: character, code: '' });
    }).join('');
    const rows = combinations.map(({ row, product, size, stock }) => {
      const certificate = B.certifySellableReference(product, size);
      const category = window.CONFIG.find('category', product.cat);
      const local = localState(row);
      const issues = certificate.issues.slice();
      if (local === 'MISSING_LOCAL') issues.push('REFERENCE_NOT_SYNCHRONIZED');
      if (local === 'MISMATCH') issues.push('LOCAL_REMOTE_MISMATCH');
      const scannerInput = hidRoundTrip(certificate.labelCode);
      if (scannerInput !== certificate.labelCode) issues.push('HID_NORMALIZATION_MISMATCH');
      return {
        productId: certificate.productId,
        referenceFamilyId: certificate.referenceFamilyId,
        recordModel: certificate.recordModel,
        product: certificate.product,
        category: category && category.label || product.cat || '',
        size,
        stock,
        visibleSku: certificate.visibleSku,
        barcodeCode: certificate.barcodeCode,
        codeOf: certificate.codeOf,
        labelCode: certificate.labelCode,
        previewCode: certificate.labelCode,
        pdfCode: certificate.labelCode,
        scannerInput,
        modules: certificate.physical.modules,
        moduleMm: certificate.physical.moduleMm,
        physicalState: certificate.physical.status,
        hardwareState: 'NOT_TESTED',
        remoteState: 'ACTIVE_SELLABLE',
        localState: local,
        resolveCode: certificate.resolveCode,
        resolvedProductId: certificate.resolvedProductId,
        resolvedSize: certificate.resolvedSize,
        matches: certificate.matches,
        warnings: certificate.warnings,
        issues: [...new Set(issues)],
        status: issues.length ? 'FAILED' : 'CERTIFIED',
      };
    });
    const traceCode = code => {
      const normalized = String(code || '').trim().toUpperCase();
      const scannerInput = hidRoundTrip(normalized);
      const resolution = B.resolve(scannerInput);
      let cause = 'OK';
      if (resolution.code === 'BARCODE_AMBIGUOUS') cause = 'AMBIGÜEDAD';
      else if (!resolution.ok) {
        const remoteV2 = products.find(product => String(product.barcodeCode || '').toUpperCase() === scannerInput);
        const remoteV1 = rows.find(row => row.codeOf === scannerInput);
        cause = remoteV2 || remoteV1 ? 'RESOLVER_DEFECTUOSO' : 'BARCODE_NO_PERSISTIDO_O_ETIQUETA_INCORRECTA';
      }
      return {
        labelOrPdfText: normalized, rawScannerLayout: normalized, normalizedHid: scannerInput,
        resolveCode: resolution.ok ? 'OK' : resolution.code,
        localIndexMatches: (resolution.matches || []).map(match => ({ productId: match.productId, size: match.talla })),
        expectedProductId: rows.find(row => row.labelCode === normalized)?.productId || null,
        remoteMatches: rows.filter(row => row.barcodeCode === normalized || row.codeOf === normalized).map(row => row.productId),
        cause,
      };
    };
    return { rows, traces: reportedCodes.map(traceCode) };
  }, { remoteRows: remote.rows, localRows, reportedCodes });
} finally {
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 5000))]);
  server.close();
}

const rows = audit.rows;
const unique = (items, key) => new Set(items.map(item => item[key]).filter(Boolean));
const sum = items => items.reduce((total, item) => total + Number(item.stock || 0), 0);
const count = predicate => rows.filter(predicate).length;
const skuGroups = new Map();
rows.forEach(row => {
  const list = skuGroups.get(row.visibleSku) || [];
  list.push(row); skuGroups.set(row.visibleSku, list);
});
const duplicateVisibleSkus = [...skuGroups.entries()].filter(([, list]) => unique(list, 'productId').size > 1).map(([visibleSku, list]) => ({
  visibleSku,
  products: [...new Set(list.map(row => row.product))],
  productIds: [...unique(list, 'productId')],
  barcodeCodes: [...unique(list, 'barcodeCode')],
  sizes: [...new Set(list.map(row => row.size))],
  states: [...new Set(list.map(row => row.status))],
  scans: list.map(row => ({ productId: row.productId, barcode: row.barcodeCode, scans: row.resolveCode === 'OK' })),
}));
const angel = rows.filter(row => /ANGEL|(^|-)ANG($|-)/i.test(`${row.product} ${row.visibleSku}`));
const failures = rows.filter(row => row.status !== 'CERTIFIED');
const summary = {
  capturedAt: remote.capturedAt,
  source: remote.source,
  localSnapshot: localPath ? basename(localPath) : null,
  totalReferences: unique(rows, 'productId').size,
  totalCombinations: rows.length,
  totalPieces: sum(rows),
  certified: rows.length - failures.length,
  v1: {
    products: unique(rows.filter(row => row.recordModel === 'V1'), 'productId').size,
    combinations: count(row => row.recordModel === 'V1'),
    pieces: sum(rows.filter(row => row.recordModel === 'V1')),
    dense: count(row => row.recordModel === 'V1' && row.physicalState === 'DENSE'),
    encodingError: count(row => row.recordModel === 'V1' && row.physicalState === 'ENCODING_ERROR'),
    physicallyLegible: count(row => row.recordModel === 'V1' && ['OK', 'NEAR'].includes(row.physicalState)),
  },
  v2: {
    products: unique(rows.filter(row => row.recordModel === 'V2'), 'productId').size,
    combinations: count(row => row.recordModel === 'V2'),
    pieces: sum(rows.filter(row => row.recordModel === 'V2')),
    OK: count(row => row.recordModel === 'V2' && row.physicalState === 'OK'),
    NEAR: count(row => row.recordModel === 'V2' && row.physicalState === 'NEAR'),
    DENSE: count(row => row.recordModel === 'V2' && row.physicalState === 'DENSE'),
  },
  labelsNeedRegeneration: sum(failures),
  duplicateVisibleSkuGroups: duplicateVisibleSkus.length,
  barcodeAbsent: count(row => !row.barcodeCode),
  barcodeDuplicate: count(row => row.issues.includes('BARCODE_DUPLICATE')),
  barcodeNotResolved: count(row => row.issues.includes('BARCODE_UNRESOLVED')),
  pdfAuthorityMismatch: count(row => row.recordModel === 'V2' && row.pdfCode !== row.barcodeCode),
  localRemoteMismatch: count(row => ['MISSING_LOCAL', 'MISMATCH'].includes(row.localState)),
  localSnapshotMissing: !localRows,
  angel: {
    products: unique(angel, 'productId').size,
    combinations: angel.length,
    v1: count(row => angel.includes(row) && row.recordModel === 'V1'),
    v2: count(row => angel.includes(row) && row.recordModel === 'V2'),
    scans: count(row => angel.includes(row) && row.resolveCode === 'OK'),
    notFound: count(row => angel.includes(row) && row.resolveCode !== 'OK'),
  },
  failures: failures.length,
  hardwareCertified: false,
};

const report = { summary, duplicateVisibleSkus, angel, traces: audit.traces };
const columns = [
  'productId', 'referenceFamilyId', 'recordModel', 'product', 'category', 'size', 'stock', 'visibleSku',
  'barcodeCode', 'codeOf', 'labelCode', 'previewCode', 'pdfCode', 'scannerInput', 'modules', 'moduleMm',
  'physicalState', 'hardwareState', 'remoteState', 'localState', 'resolveCode', 'resolvedProductId',
  'resolvedSize', 'status', 'warnings', 'issues',
];
const csvCell = value => `"${String(Array.isArray(value) ? value.join('|') : value ?? '').replaceAll('"', '""')}"`;
const csv = [columns.map(csvCell).join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\n') + '\n';
await writeFile(join(outputDir, 'censo-inventario-vendible.csv'), csv, 'utf8');
await writeFile(join(outputDir, 'resumen-inventario-vendible.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
await writeFile(join(outputDir, 'snapshot-remoto-products.json'), JSON.stringify({ capturedAt: remote.capturedAt, source: remote.source, data: remote.rows }, null, 2) + '\n', 'utf8');

console.log(JSON.stringify(summary, null, 2));
// Certificación total exige snapshot local comparable y cero fallos. La prueba
// de hardware se informa aparte porque software no puede fingirla.
process.exit(summary.failures || summary.localSnapshotMissing ? 1 : 0);
