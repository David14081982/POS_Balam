// H-128 · Simulación read-only de geometrías 60×40 sobre el inventario vigente.
// No importa, no persiste, no sincroniza y no modifica identidades comerciales.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, resolve, join } from 'node:path';

const input = process.argv[2] && resolve(process.argv[2]);
const outputDir = resolve(process.argv[3] || '.evidence-h128');
if (!input || !existsSync(input)) {
  console.error('Uso: node audit-h128-v1-layout-recovery.mjs <Inventario_Balam.xlsx> [directorio-salida]');
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
const inputSha256 = createHash('sha256').update(bytes).digest('hex');
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
    const contract = BARCODES.LABEL_60X40;
    const options = (height, horizontalMargin, verticalMargin = horizontalMargin) => ({
      ...contract.barcodeOptions,
      height,
      margin: 0,
      marginLeft: horizontalMargin,
      marginRight: horizontalMargin,
      marginTop: verticalMargin,
      marginBottom: verticalMargin,
    });
    const layout = (id, medium, xMm, widthMm, height, horizontalMargin, verticalMargin, note) => ({
      id, medium, note,
      contract: {
        ...contract,
        symbolBox: { ...contract.symbolBox, xMm, widthMm },
        barcodeOptions: options(height, horizontalMargin, verticalMargin),
      },
    });
    const layouts = [
      layout('PNG_H127_56_H60', 'PNG · impresión/PDF JPEG previos', 2, 56, 60, 4, 4,
        'Línea base H-127 previa a H-128'),
      layout('PNG_56_H80', 'PNG', 2, 56, 80, 4, 0,
        'Mismo ancho y quiet zones; barras más altas'),
      layout('PNG_H128_56_H100_IMPLEMENTADO', 'PNG · impresión/PDF JPEG', 2, 56, 100, 4, 0,
        'H-128: mismo ancho y quiet zones; máximo vertical conservador'),
      layout('PNG_SAFE_59_H100_QZ10X', 'PNG', 0.5, 59, 100, 20, 0,
        'Reserva 0.5 mm por lado y quiet zones internas exactas de 10X'),
      layout('PNG_SAFE_MAX_60_H100_QZ10X', 'PNG', 0, 60, 100, 20, 0,
        'Máximo matemático de la etiqueta; sin tolerancia de corte'),
      layout('SVG_SAFE_MAX_60_H100_QZ10X', 'SVG/vector', 0, 60, 100, 20, 0,
        'Geometría equivalente; JsBarcode puede renderizar SVG'),
      layout('PDF_VECTOR_SAFE_MAX_60_H100_QZ10X', 'PDF vector simulado', 0, 60, 100, 20, 0,
        'Sólo equivalencia geométrica; el PDF vigente incrusta JPEG'),
      layout('INADMISIBLE_60_H100_QZ2X', 'PNG · control negativo', 0, 60, 100, 4, 0,
        'Sacrifica quiet zones; no es candidato de producción'),
    ];

    const rows = [];
    inventory.forEach(row => sizesOf(row).filter(size => size.stock > 0).forEach(size => {
      const recordModel = row._BALAM_MODELO_REFERENCIA === 'v2' ? 'V2' : 'V1';
      const code = codeOf(row, size.value);
      const baseline = BARCODES.inspectLabelCode(code);
      const simulations = Object.fromEntries(layouts.map(candidate => {
        const physical = BARCODES.inspectLabelCode(code, candidate.contract);
        const quietLeftX = physical.moduleMm ? physical.quietZoneLeftMm / physical.moduleMm : 0;
        const quietRightX = physical.moduleMm ? physical.quietZoneRightMm / physical.moduleMm : 0;
        return [candidate.id, {
          status: physical.status,
          modules: physical.modules,
          moduleMm: physical.moduleMm,
          barHeightMm: physical.barHeightMm,
          quietLeftX,
          quietRightX,
          quietZonesValid: ['ENCODING_ERROR', 'MISSING_BARCODE', 'GENERATION_ERROR'].includes(physical.status)
            ? null : quietLeftX >= 10 - 1e-9 && quietRightX >= 10 - 1e-9,
          reason: physical.reason || '',
        }];
      }));
      rows.push({
        recordModel,
        model: String(row['No. Modelo'] || ''),
        name: String(row.Modelo || ''),
        size: size.value,
        stock: size.stock,
        visibleSku: recordModel === 'V2' ? String(row.SKU || '') : code,
        code128Text: code,
        baselineStatus: baseline.status,
        baselineModules: baseline.modules,
        simulations,
      });
    }));
    return {
      metadata,
      workbookRows: inventory.length,
      authority: contract,
      layouts: layouts.map(({ id, medium, note, contract: candidate }) => ({
        id, medium, note,
        symbolBox: candidate.symbolBox,
        barcodeOptions: candidate.barcodeOptions,
      })),
      rows,
    };
  }, bytes.toString('base64'));
} finally {
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 5000))]);
  server.close();
}

const statuses = ['OK', 'NEAR', 'DENSE', 'ENCODING_ERROR'];
const v1 = result.rows.filter(row => row.recordModel === 'V1');
const baselineDense = v1.filter(row => row.baselineStatus === 'DENSE');
const countBy = (rows, status, layoutId) => rows.filter(row => row.simulations[layoutId].status === status).length;
const summaries = result.layouts.map(layout => {
  const encoded = v1.map(row => row.simulations[layout.id]).filter(item => item.quietZonesValid !== null);
  const quietZonesValid = encoded.every(item => item.quietZonesValid);
  const rawExitDense = baselineDense.filter(row => row.simulations[layout.id].status !== 'DENSE').length;
  const compliantExitDense = baselineDense.filter(row => {
    const item = row.simulations[layout.id];
    return item.status !== 'DENSE' && item.moduleMm >= result.authority.minModuleMm && item.quietZonesValid;
  }).length;
  return {
    layout: layout.id,
    medium: layout.medium,
    widthMm: layout.symbolBox.widthMm,
    requestedBarHeightPx: layout.barcodeOptions.height,
    horizontalQuietModules: layout.barcodeOptions.marginLeft / layout.barcodeOptions.width,
    quietZonesValid,
    minimumObservedQuietZoneX: encoded.length
      ? Math.min(...encoded.map(item => Math.min(item.quietLeftX, item.quietRightX))) : 0,
    ...Object.fromEntries(statuses.map(status => [status, countBy(v1, status, layout.id)])),
    rawExitDense,
    compliantExitDense,
    admissibleForProduction: quietZonesValid && !layout.id.startsWith('INADMISIBLE_'),
    note: layout.note,
  };
});

const pickFirst = predicate => baselineDense
  .filter(predicate)
  .sort((a, b) => a.code128Text.localeCompare(b.code128Text))[0];
const prioritized = [
  ['769', pickFirst(row => row.model === '769')],
  ['752', pickFirst(row => row.model === '752')],
  ['PVC10', pickFirst(row => row.model === 'PVC10')],
  ['V1 típico · mediana de módulos', pickFirst(row => row.baselineModules === 288)],
  ['V1 largo extremo', baselineDense.slice().sort((a, b) => b.baselineModules - a.baselineModules || a.code128Text.localeCompare(b.code128Text))[0]],
].filter(([, row]) => row).map(([caseName, row]) => ({ caseName, ...row }));

const moduleDistribution = Object.fromEntries([...new Set(baselineDense.map(row => row.baselineModules))]
  .sort((a, b) => a - b)
  .map(modules => [modules, {
    baseLabels: baselineDense.filter(row => row.baselineModules === modules).length,
    stockPieces: baselineDense.filter(row => row.baselineModules === modules)
      .reduce((total, row) => total + Number(row.stock || 0), 0),
  }]));
const encodingErrors = v1.filter(row => row.baselineStatus === 'ENCODING_ERROR').map(row => ({
  model: row.model,
  name: row.name,
  size: row.size,
  stock: row.stock,
  code128Text: row.code128Text,
  containsLiteralEnye: row.code128Text.includes('Ñ'),
  codePoints: Array.from(row.code128Text).map(character => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`),
  reason: row.simulations.PNG_H127_56_H60.reason,
}));
const report = {
  input: { file: basename(input), bytes: bytes.length, sha256: inputSha256 },
  metadata: result.metadata,
  workbookRows: result.workbookRows,
  authority: result.authority,
  theoreticalCapacity: {
    labelWidthMm: 60,
    minimumXmm: 0.25,
    quietZoneModulesEachSide: 10,
    maximumDataModules: Math.floor(60 / 0.25 - 20),
    minimumObservedDenseModules: Math.min(...baselineDense.map(row => row.baselineModules)),
  },
  baseline: {
    stockedCombinations: result.rows.length,
    V1: Object.fromEntries(statuses.map(status => [status, v1.filter(row => row.baselineStatus === status).length])),
    V2: Object.fromEntries(statuses.map(status => [status, result.rows.filter(row => row.recordModel === 'V2' && row.baselineStatus === status).length])),
  },
  moduleDistribution,
  layouts: summaries,
  prioritized,
  encodingErrors,
  conclusion: {
    v1ResolvedOnlyByCompliantLayout: Math.max(...summaries.filter(row => row.admissibleForProduction).map(row => row.compliantExitDense)),
    v1StillDenseAtMaximumSafeWidth: summaries.find(row => row.layout === 'PNG_SAFE_MAX_60_H100_QZ10X').DENSE,
    v1EncodingErrors: encodingErrors.length,
  },
};

const columns = [
  'layout', 'medium', 'widthMm', 'requestedBarHeightPx', 'horizontalQuietModules', 'quietZonesValid',
  'minimumObservedQuietZoneX', 'OK', 'NEAR', 'DENSE', 'ENCODING_ERROR', 'rawExitDense',
  'compliantExitDense', 'admissibleForProduction', 'note',
];
const cell = value => `"${String(typeof value === 'number' ? Number(value.toFixed(6)) : value).replaceAll('"', '""')}"`;
const csv = [columns.map(cell).join(','), ...summaries.map(row => columns.map(column => cell(row[column])).join(','))].join('\n') + '\n';
const date = String(result.metadata.generated_at || 'actual').slice(0, 10);
const jsonPath = join(outputDir, `h128-layout-v1-${date}-resumen.json`);
const csvPath = join(outputDir, `h128-layout-v1-${date}.csv`);
await writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
await writeFile(csvPath, csv, 'utf8');
console.log(JSON.stringify({ jsonPath, csvPath, report }, null, 2));
