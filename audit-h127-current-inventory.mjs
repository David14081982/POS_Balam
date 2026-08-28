// H-127 · Auditoría read-only de todas las etiquetas con existencia de un
// export canónico BALAM. No importa, no persiste y no sincroniza el archivo.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve, join } from 'node:path';

const input = process.argv[2] && resolve(process.argv[2]);
const outputDir = resolve(process.argv[3] || '.evidence-h127');
if (!input || !existsSync(input)) {
  console.error('Uso: node audit-h127-current-inventory.mjs <Inventario_Balam.xlsx> [directorio-salida]');
  process.exit(2);
}
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

const bytes = readFileSync(input);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let result;
try {
  const context = await browser.newContext();
  await context.route(/supabase\.co/, route => route.abort());
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.XLSXIO && window.XLSX && window.BARCODES?.ready());
  result = await page.evaluate(async base64 => {
    const binary = atob(base64);
    const content = Uint8Array.from(binary, character => character.charCodeAt(0));
    const workbook = await XLSXIO.readWorkbook(new File([content], 'Inventario_Balam.xlsx'));
    const inventory = XLSX.utils.sheet_to_json(workbook.Sheets.Inventario, { defval: '' });
    const catalogRows = XLSX.utils.sheet_to_json(workbook.Sheets['Catálogos'], { header: 1, defval: '' });
    const metadataRows = XLSX.utils.sheet_to_json(workbook.Sheets._BALAM, { header: 1, defval: '' });
    const metadata = {};
    metadataRows.slice(2).forEach(row => { if (row[0]) metadata[String(row[0])] = row[1]; });
    const sizeMap = catalogRows
      .filter(row => ['size_letter', 'size_number'].includes(row[3]))
      .map(row => ({ header: String(row[0]), value: String(row[1]), kind: String(row[3]) }));
    const sizesOf = row => row._BALAM_MODELO_REFERENCIA === 'v2'
      ? [{ value: String(row['Talla referencia']), stock: Number(row['Existencia referencia']) || 0 }]
      : sizeMap.filter(size => size.kind === row['Categoría por talla'] && Number(row[size.header]) > 0)
        .map(size => ({ value: size.value, stock: Number(row[size.header]) || 0 }));
    const codeOf = (row, size) => row._BALAM_MODELO_REFERENCIA === 'v2'
      ? String(row._BALAM_BARCODE_CODE || '').toUpperCase()
      : DATA.materializedSku({ recordModel: 'v1', sku: row.SKU }, size);

    // El resolver operativo considera todas las referencias V2 activas, incluso
    // sin stock, y sólo las tallas V1 con existencia. Esta frecuencia reproduce
    // esa frontera sin mutar DATA.products ni depender del catálogo local actual.
    const resolutionCodes = [];
    inventory.forEach(row => {
      const v2 = row._BALAM_MODELO_REFERENCIA === 'v2';
      if (v2) {
        const code = codeOf(row, String(row['Talla referencia']));
        if (code) resolutionCodes.push(code);
      } else {
        sizesOf(row).filter(size => size.stock > 0).forEach(size => {
          const code = codeOf(row, size.value); if (code) resolutionCodes.push(code);
        });
      }
    });
    const frequency = resolutionCodes.reduce((counts, code) => {
      counts[code] = (counts[code] || 0) + 1; return counts;
    }, Object.create(null));

    const rows = [];
    inventory.forEach(row => sizesOf(row).filter(size => size.stock > 0).forEach(size => {
      const v2 = row._BALAM_MODELO_REFERENCIA === 'v2';
      const code = codeOf(row, size.value);
      const physical = BARCODES.inspectLabelCode(code);
      const generated = !['MISSING_BARCODE', 'ENCODING_ERROR', 'GENERATION_ERROR'].includes(physical.status)
        ? !!BARCODES.toPNGDataURL(code, BARCODES.LABEL_60X40.barcodeOptions) : false;
      const flags = [];
      if (!v2) flags.push('V1_LEGACY');
      if (code && frequency[code] > 1) flags.push('AMBIGUOUS');
      if (v2 && code && !/^B[A-F0-9]{15}$/.test(code)) flags.push('ANOMALOUS_BARCODE');
      if (!generated && !['MISSING_BARCODE', 'ENCODING_ERROR', 'GENERATION_ERROR'].includes(physical.status)) flags.push('GENERATION_ERROR');
      rows.push({
        id: String(row._BALAM_ID_PRODUCTO || ''),
        recordModel: v2 ? 'V2' : 'V1',
        familyId: String(row._BALAM_REFERENCE_FAMILY_ID || ''),
        model: String(row['No. Modelo'] || ''),
        name: String(row.Modelo || ''),
        visibleSku: v2 ? String(row.SKU || '') : DATA.materializedSku({ recordModel: 'v1', sku: row.SKU }, size.value),
        size: size.value,
        stock: size.stock,
        barcodeCode: v2 ? String(row._BALAM_BARCODE_CODE || '') : '',
        code128Text: code,
        characters: physical.chars,
        modules: physical.modules,
        availableWidthMm: physical.availableWidthMm,
        effectiveXmm: physical.moduleMm,
        effectiveBarHeightMm: physical.barHeightMm,
        encodedWidthMm: physical.encodedWidthMm || 0,
        barHeightToEncodedWidth: physical.encodedWidthMm ? physical.barHeightMm / physical.encodedWidthMm : 0,
        embeddedQuietLeftMm: physical.embeddedQuietZoneLeftMm || 0,
        embeddedQuietRightMm: physical.embeddedQuietZoneRightMm || 0,
        outerQuietLeftMm: physical.outerQuietZoneLeftMm || 0,
        outerQuietRightMm: physical.outerQuietZoneRightMm || 0,
        quietLeftMm: physical.quietZoneLeftMm || 0,
        quietRightMm: physical.quietZoneRightMm || 0,
        canvasWidthPx: physical.canvasWidthPx || 0,
        canvasHeightPx: physical.canvasHeightPx || 0,
        pdfDpiX: physical.pdfDpiX,
        pdfDpiY: physical.pdfDpiY,
        pdfModulePx: physical.pdfModulePx || 0,
        physicalStatus: physical.status,
        generationStatus: generated ? 'GENERATED' : physical.status,
        classifications: [physical.status, ...flags].join('|'),
        reason: physical.reason || '',
      });
    }));
    return { metadata, workbookRows: inventory.length, rows, contract: BARCODES.LABEL_60X40 };
  }, bytes.toString('base64'));
} finally {
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 5000))]);
  server.close();
}

const rows = result.rows;
const count = predicate => rows.filter(predicate).length;
const sumStock = list => list.reduce((total, row) => total + Number(row.stock || 0), 0);
const uniqueCodes = list => new Set(list.map(row => row.code128Text).filter(Boolean)).size;
const physicalStatuses = ['OK', 'NEAR', 'DENSE', 'ENCODING_ERROR', 'MISSING_BARCODE', 'GENERATION_ERROR'];
const physical = Object.fromEntries(physicalStatuses.map(status => [status, count(row => row.physicalStatus === status)]));
const riskRows = rows.filter(row => ['DENSE', 'ENCODING_ERROR', 'MISSING_BARCODE', 'GENERATION_ERROR'].includes(row.physicalStatus)
  || row.classifications.includes('AMBIGUOUS') || row.classifications.includes('GENERATION_ERROR'));
const nearRows = rows.filter(row => row.physicalStatus === 'NEAR');
const summary = {
  input: { file: basename(input), bytes: bytes.length, sha256 },
  metadata: result.metadata,
  contract: result.contract,
  workbookRows: result.workbookRows,
  stockedBaseLabels: rows.length,
  stockedPieces: sumStock(rows),
  uniqueCodes: uniqueCodes(rows),
  physical,
  byRecordModel: Object.fromEntries(['V1', 'V2'].map(model => {
    const list = rows.filter(row => row.recordModel === model);
    return [model, { baseLabels: list.length, stockPieces: sumStock(list), uniqueCodes: uniqueCodes(list),
      OK: count(row => row.recordModel === model && row.physicalStatus === 'OK'),
      NEAR: count(row => row.recordModel === model && row.physicalStatus === 'NEAR'),
      DENSE: count(row => row.recordModel === model && row.physicalStatus === 'DENSE'),
      ENCODING_ERROR: count(row => row.recordModel === model && row.physicalStatus === 'ENCODING_ERROR') }];
  })),
  risk: { baseLabels: riskRows.length, stockLabels: sumStock(riskRows), uniqueCodes: uniqueCodes(riskRows) },
  near: { baseLabels: nearRows.length, stockLabels: sumStock(nearRows), uniqueCodes: uniqueCodes(nearRows) },
  flags: {
    V1_LEGACY: count(row => row.classifications.includes('V1_LEGACY')),
    AMBIGUOUS: count(row => row.classifications.includes('AMBIGUOUS')),
    ANOMALOUS_BARCODE: count(row => row.classifications.includes('ANOMALOUS_BARCODE')),
  },
  encodingErrors: rows.filter(row => row.physicalStatus === 'ENCODING_ERROR'),
  photoCases: rows.filter(row => (['769', '752', 'PVC10'].includes(row.model))
    || (row.name === 'VICTOR' && row.recordModel === 'V2' && row.size === '44')),
};

const columns = [
  'id', 'recordModel', 'familyId', 'model', 'name', 'visibleSku', 'size', 'stock', 'barcodeCode', 'code128Text',
  'characters', 'modules', 'availableWidthMm', 'effectiveXmm', 'effectiveBarHeightMm', 'encodedWidthMm',
  'barHeightToEncodedWidth', 'embeddedQuietLeftMm', 'embeddedQuietRightMm', 'outerQuietLeftMm', 'outerQuietRightMm',
  'quietLeftMm', 'quietRightMm', 'canvasWidthPx', 'canvasHeightPx', 'pdfDpiX', 'pdfDpiY', 'pdfModulePx',
  'physicalStatus', 'generationStatus', 'classifications', 'reason',
];
const rounded = value => typeof value === 'number' && !Number.isInteger(value) ? Number(value.toFixed(6)) : value;
const csvCell = value => `"${String(rounded(value) ?? '').replaceAll('"', '""')}"`;
const csv = [columns.map(csvCell).join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\n') + '\n';
const reportBase = `auditoria-code128-${String(result.metadata.generated_at || 'actual').slice(0, 10)}`;
const csvPath = join(outputDir, `${reportBase}.csv`);
const jsonPath = join(outputDir, `${reportBase}-resumen.json`);
await writeFile(csvPath, csv, 'utf8');
await writeFile(jsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ csvPath, jsonPath, summary }, null, 2));
