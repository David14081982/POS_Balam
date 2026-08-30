// H-132/H-133 · Análisis read-only del manifiesto V1→V2 y BARCODE CONTRACT V3.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

const snapshotPath = resolve(process.argv[2] || '.evidence-h132-live/pre-migration/snapshot-remoto-products.json');
const outputPath = resolve(process.argv[3] || '.evidence-h132-live/v3-manifest-analysis.json');
if (!existsSync(snapshotPath)) throw new Error(`SNAPSHOT_NOT_FOUND:${snapshotPath}`);
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
if (!Array.isArray(snapshot.data) || !snapshot.config) throw new Error('SNAPSHOT_OR_CONFIG_INVALID');

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
let analysis;
try {
  const context = await browser.newContext();
  await context.route(/supabase\.co/, route => route.abort());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.BARCODES?.ready() && window.CONFIG);
  analysis = await page.evaluate(({ rows, config }) => {
    const D = window.DATA, B = window.BARCODES;
    window.CONFIG.load(config);
    const hydrate = row => D.hydrate({
      id: row.id, recordModel: row.record_model || 'v1', referenceFamilyId: row.reference_family_id || null,
      cat: row.cat, manga: row.manga, tela: row.tela, color: row.color, cuello: row.cuello,
      modelo: row.modelo, nombre: row.nombre, orn: row.orn, ornColors: row.orn_colors || [],
      ornamentColorCodes: row.ornament_color_codes || [], precio: Number(row.precio) || 0,
      costo: Number(row.costo) || 0, stock: row.stock || [],
      stockQuantity: row.stock_quantity == null ? null : Number(row.stock_quantity),
      sizeCode: row.size_code || null, sizeScale: row.size_scale || null,
      sizeCategoryId: row.size_category_id || row.attrs?.__sizeCategoryId || null,
      sku: row.sku || '', barcodeCode: row.barcode_code || null,
      physicalSignature: row.physical_signature || null, attrs: row.attrs || {},
      _syncVersion: Number(row.sync_version) || 0, _deletedAt: row.deleted_at || null,
    });
    const products = rows.map(hydrate);
    const byId = new Map(products.map(product => [String(product.id), product]));
    D.products.splice(0, D.products.length, ...products);
    const barcodeV3 = id => {
      const hex = String(id || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
      if (hex.length < 20) throw new Error(`V3_UUID_SOURCE_INVALID:${id}`);
      return `3${BigInt(`0x${hex.slice(-20)}`).toString().padStart(25, '0')}`;
    };
    const migrated = [];
    rows.filter(row => String(row.record_model || 'v1').toLowerCase() !== 'v2').forEach(row => {
      const product = byId.get(String(row.id));
      const historical = new Set((row.historical_size_codes || []).map(String));
      const resolved = D.resolveProductSizes(product).sizes;
      (row.stock || []).forEach(item => {
        const size = String(item.talla == null ? item.size_code || '' : item.talla);
        const scale = String(item.escala || '');
        const stock = Math.max(0, Number(item.stock) || 0);
        if (stock <= 0 && !historical.has(size)) return;
        const resolvedSize = resolved.find(candidate => String(candidate.value) === size
          && (!scale || String(candidate.scale || '') === scale));
        const sizeCategoryId = resolvedSize?.categoryId || product.sizeCategoryId
          || product.attrs?.__sizeCategoryId || (scale === 'L' ? 'size_letter' : scale === 'N' ? 'size_number' : '');
        const attrs = { ...(product.attrs || {}), __sizeCategoryId: sizeCategoryId };
        const visibleSku = D.materializedSku(product, size);
        const candidate = {
          ...product, recordModel: 'v2', sizeCategoryId, sizeCode: size, sizeScale: scale,
          stockQuantity: stock, stock: [{ talla: size, escala: scale, stock }], attrs,
          sku: visibleSku, ornamentColorCodes: D.effectiveOrnamentColors(product, size),
        };
        migrated.push({
          sourceProductId: String(row.id), sizeScale: scale, rawSizeValue: size,
          sourceSyncVersion: Number(row.sync_version) || 0,
          stock, historicalOnly: stock === 0, visibleSku, listPrice: D.listPrice(product, size),
          sizeCategoryId, ornamentColorCodes: candidate.ornamentColorCodes,
          physicalSignature: D.physicalSignature(candidate),
        });
      });
    });
    const existing = rows.filter(row => String(row.record_model || '').toLowerCase() === 'v2').map(row => ({
      productId: String(row.id), visibleSku: String(row.sku || ''), stock: Math.max(0, Number(row.stock_quantity) || 0),
      sourceSyncVersion: Number(row.sync_version) || 0,
      physicalSignature: String(row.physical_signature || ''), oldBarcode: String(row.barcode_code || ''),
      newBarcode: barcodeV3(row.id), size: String(row.size_code || ''),
    }));
    const signatureGroups = new Map();
    migrated.forEach(row => {
      const group = signatureGroups.get(row.physicalSignature) || [];
      group.push({ type: 'migrated', sourceProductId: row.sourceProductId, sizeScale: row.sizeScale, size: row.rawSizeValue });
      signatureGroups.set(row.physicalSignature, group);
    });
    existing.forEach(row => {
      const group = signatureGroups.get(row.physicalSignature) || [];
      group.push({ type: 'existing', productId: row.productId, size: row.size });
      signatureGroups.set(row.physicalSignature, group);
    });
    const signatureCollisions = [...signatureGroups.entries()].filter(([, group]) => group.length > 1)
      .map(([physicalSignature, group]) => ({ physicalSignature, group }));
    const barcodeGroups = new Map();
    existing.forEach(row => { const group = barcodeGroups.get(row.newBarcode) || []; group.push(row.productId); barcodeGroups.set(row.newBarcode, group); });
    const barcodeCollisions = [...barcodeGroups.entries()].filter(([, ids]) => ids.length > 1)
      .map(([barcode, productIds]) => ({ barcode, productIds }));
    const skuGroups = new Map();
    migrated.forEach(row => { const list = skuGroups.get(row.visibleSku) || []; list.push(`v1:${row.sourceProductId}:${row.sizeScale}:${row.rawSizeValue}`); skuGroups.set(row.visibleSku, list); });
    existing.forEach(row => { const list = skuGroups.get(row.visibleSku) || []; list.push(`v2:${row.productId}`); skuGroups.set(row.visibleSku, list); });
    const duplicateVisibleSkus = [...skuGroups.entries()].filter(([, refs]) => refs.length > 1)
      .map(([visibleSku, references]) => ({ visibleSku, references }));
    const samples = ['30000000000000000000000001', '36044629197024704817971200', '31208925819614629174706175']
      .map(code => ({ code, ...B.inspectLabelCode(code) }));
    return {
      source: { products: rows.length, configKinds: Object.keys(config.catalogMeta || {}).length },
      contract: { version: 3, format: '3 + UUID trailing 80 bits decimal padded to 25 digits', digits: 26, codeSet: 'C' },
      migrated: {
        references: migrated.length, sellable: migrated.filter(row => row.stock > 0).length,
        historicalOnly: migrated.filter(row => row.historicalOnly).length,
        pieces: migrated.reduce((sum, row) => sum + row.stock, 0),
      },
      existing: { references: existing.length, sellable: existing.filter(row => row.stock > 0).length,
        pieces: existing.reduce((sum, row) => sum + row.stock, 0) },
      after: { activeV2: migrated.length + existing.length, sellableReferences: migrated.filter(row => row.stock > 0).length + existing.filter(row => row.stock > 0).length,
        pieces: migrated.reduce((sum, row) => sum + row.stock, 0) + existing.reduce((sum, row) => sum + row.stock, 0) },
      signatureCollisions, barcodeCollisions, duplicateVisibleSkus,
      existingManifest: existing,
      samples,
      manifest: migrated,
    };
  }, { rows: snapshot.data, config: snapshot.config });
} finally {
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 5000))]);
  server.close();
}

const deterministicUuid = seed => {
  const hex = createHash('sha256').update(`BALAM:H133:${seed}`, 'utf8').digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
};
const barcodeV3 = id => {
  const hex = String(id || '').replace(/[^a-f0-9]/gi, '').toLowerCase();
  if (hex.length !== 32) throw new Error(`V3_UUID_SOURCE_INVALID:${id}`);
  return `3${BigInt(`0x${hex.slice(-20)}`).toString().padStart(25, '0')}`;
};
analysis.manifest = analysis.manifest.map(row => {
  const targetProductId = deterministicUuid(`${row.sourceProductId}\u001f${row.sizeScale}\u001f${row.rawSizeValue}`);
  const referenceFamilyId = deterministicUuid(`FAMILY\u001f${row.sourceProductId}`);
  return Object.assign({}, row, { targetProductId, referenceFamilyId, barcodeCode: barcodeV3(targetProductId) });
});
const targetIds = new Set(analysis.manifest.map(row => row.targetProductId));
const targetBarcodes = new Set(analysis.manifest.map(row => row.barcodeCode));
if (targetIds.size !== analysis.manifest.length) throw new Error('TARGET_UUID_COLLISION');
if (targetBarcodes.size !== analysis.manifest.length) throw new Error('TARGET_BARCODE_COLLISION');
const postgresJsonbText = value => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(', ')}]`;
  if (typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}: ${postgresJsonbText(value[key])}`).join(', ')}}`;
  return JSON.stringify(value);
};
const canonicalManifest = postgresJsonbText({ existing: analysis.existingManifest, migrated: analysis.manifest });
analysis.manifestHash = createHash('sha256').update(canonicalManifest, 'utf8').digest('hex');

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(analysis, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  source: analysis.source,
  contract: analysis.contract,
  migrated: analysis.migrated,
  existing: analysis.existing,
  after: analysis.after,
  signatureCollisions: analysis.signatureCollisions.length,
  barcodeCollisions: analysis.barcodeCollisions.length,
  targetIds: targetIds.size,
  targetBarcodes: targetBarcodes.size,
  manifestHash: analysis.manifestHash,
  duplicateVisibleSkuGroups: analysis.duplicateVisibleSkus.length,
  samples: analysis.samples.map(sample => ({ code: sample.code, status: sample.status, modules: sample.modules, moduleMm: sample.moduleMm,
    quietZoneLeftMm: sample.quietZoneLeftMm, quietZoneRightMm: sample.quietZoneRightMm, barHeightMm: sample.barHeightMm })),
}, null, 2));
process.exit(analysis.signatureCollisions.length || analysis.barcodeCollisions.length ? 1 : 0);
