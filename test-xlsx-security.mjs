// H-12 — versión trazable, lectura centralizada y límites para archivos Excel.
import { chromium } from 'playwright-core';
import { createHash } from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';

const ROOT = path.resolve('.');
const VENDOR = path.join(ROOT, 'balam', 'vendor', 'xlsx-0.20.3', 'xlsx.full.min.js');
const EXPECTED_SHA256 = 'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41';
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const source = fs.readFileSync('POS Balam.html', 'utf8');
const stableSource = fs.readFileSync('balam/_source.html', 'utf8');
const offlineSource = fs.readFileSync('POS Balam (offline).html', 'utf8');
const ioSource = fs.readFileSync('balam/xlsx-io.jsx', 'utf8');
const settingsSource = fs.readFileSync('balam/settings.jsx', 'utf8');
check('la aplicación usa la copia local versionada', source.includes('balam/vendor/xlsx-0.20.3/xlsx.full.min.js'));
check('no queda la versión vulnerable en fuentes ni artefacto offline',
  !source.includes('xlsx@0.18.5') && !stableSource.includes('xlsx@0.18.5')
  && !ioSource.includes('xlsx@0.18.5') && !offlineSource.includes('xlsx@0.18.5'));
check('la copia local conserva el SHA-256 fijado',
  createHash('sha256').update(fs.readFileSync(VENDOR)).digest('hex') === EXPECTED_SHA256);
check('Configuración usa la frontera central de lectura',
  settingsSource.includes('IO.readWorkbook(file)') && !settingsSource.includes('X.read(reader.result'));

const server = http.createServer((req, res) => {
  let requested = decodeURIComponent(req.url.split('?')[0]);
  if (requested === '/') requested = '/index.html';
  const file = path.join(ROOT, requested);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(8812, '127.0.0.1', resolve));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const pageErrors = [];
const resourceErrors = [];
page.on('pageerror', err => pageErrors.push(String(err)));
page.on('requestfailed', req => resourceErrors.push(`${req.url()} · ${req.failure() && req.failure().errorText}`));
page.on('response', res => { if (res.status() >= 400) resourceErrors.push(`${res.status()} · ${res.url()}`); });
await page.route(/supabase\.co/, route => route.abort());
await page.goto('http://127.0.0.1:8812/index.html', { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.XLSX && window.XLSXIO, null, { timeout: 30000 });
} catch (err) {
  console.error('Errores de página:', pageErrors);
  console.error('Errores de recursos:', resourceErrors);
  throw err;
}

const result = await page.evaluate(async () => {
  const X = window.XLSX, IO = window.XLSXIO;
  const out = { version: X.version, limits: IO.limits };
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet([{
    SKU: 'SEGURA-1', Modelo: 'PRUEBA', Categoría: '21', Manga: 'MC',
    Tela: 'ALG', Color: 'BL', Precio: 100,
  }]), 'Inventario');
  const valid = new File(
    [X.write(wb, { bookType: 'xlsx', type: 'array' })],
    'inventario.xlsx',
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  );
  out.valid = await IO.parseFile(valid).then(r => r.products.length === 1).catch(e => String(e));

  const legacy = new File(
    [X.write(wb, { bookType: 'xls', type: 'array' })],
    'inventario.xls',
    { type: 'application/vnd.ms-excel' },
  );
  out.legacy = await IO.readWorkbook(legacy).then(r => r.SheetNames[0]).catch(e => String(e));

  const csv = new File(['SKU,Modelo,Precio\nCSV-1,PRUEBA,100'], 'inventario.csv', { type: 'text/csv' });
  out.csv = await IO.readWorkbook(csv).then(r => r.SheetNames.length === 1).catch(e => String(e));

  const oversized = new File([new Uint8Array(IO.limits.maxFileBytes + 1)], 'grande.xlsx');
  out.oversized = await IO.readWorkbook(oversized).then(() => 'aceptado').catch(e => e.message);

  const many = X.utils.book_new();
  for (let i = 0; i < IO.limits.maxSheets + 1; i++) {
    X.utils.book_append_sheet(many, X.utils.aoa_to_sheet([[i]]), `H${i + 1}`);
  }
  const manyFile = new File([X.write(many, { bookType: 'xlsx', type: 'array' })], 'hojas.xlsx');
  out.manySheets = await IO.readWorkbook(manyFile).then(() => 'aceptado').catch(e => e.message);

  const wide = X.utils.book_new();
  const wideSheet = { A1: { t: 's', v: 'inicio' }, IW1: { t: 's', v: 'fin' }, '!ref': 'A1:IW1' };
  X.utils.book_append_sheet(wide, wideSheet, 'Ancha');
  const wideFile = new File([X.write(wide, { bookType: 'xlsx', type: 'array' })], 'ancha.xlsx');
  out.wide = await IO.readWorkbook(wideFile).then(() => 'aceptado').catch(e => e.message);

  const tall = X.utils.book_new();
  X.utils.book_append_sheet(tall, { A1: { t: 'n', v: 1 }, A50001: { t: 'n', v: 2 }, '!ref': 'A1:A50001' }, 'Alta');
  const tallFile = new File([X.write(tall, { bookType: 'xlsx', type: 'array' })], 'alta.xlsx');
  out.tall = await IO.readWorkbook(tallFile).then(() => 'aceptado').catch(e => e.message);

  const denseRange = X.utils.book_new();
  X.utils.book_append_sheet(denseRange,
    { A1: { t: 'n', v: 1 }, IV4000: { t: 'n', v: 2 }, '!ref': 'A1:IV4000' }, 'Celdas');
  const denseFile = new File([X.write(denseRange, { bookType: 'xlsx', type: 'array' })], 'celdas.xlsx');
  out.cells = await IO.readWorkbook(denseFile).then(() => 'aceptado').catch(e => e.message);

  const pollution = X.utils.book_new();
  X.utils.book_append_sheet(pollution, X.utils.aoa_to_sheet([['__proto__'], ['valor']]), 'Datos');
  const pollutedFile = new File([X.write(pollution, { bookType: 'xlsx', type: 'array' })], 'proto.xlsx');
  await IO.readWorkbook(pollutedFile);
  out.prototypeClean = ({}).valor === undefined;
  return out;
});

const offlinePage = await browser.newPage();
const offlineExternal = [];
await offlinePage.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
  offlineExternal.push(route.request().url());
  route.abort();
});
await offlinePage.goto('http://127.0.0.1:8812/POS%20Balam%20(offline).html', { waitUntil: 'load' });
await offlinePage.waitForFunction(() => window.XLSX && window.XLSXIO, null, { timeout: 30000 });
const offlineVersion = await offlinePage.evaluate(() => window.XLSX.version);

check('se ejecuta SheetJS 0.20.3', result.version === '0.20.3', result.version);
check('un inventario XLSX válido sigue importando', result.valid === true, String(result.valid));
check('un XLS histórico válido sigue leyendo', result.legacy === 'Inventario', String(result.legacy));
check('un CSV histórico válido sigue leyendo', result.csv === true, String(result.csv));
check('un archivo mayor de 10 MB se rechaza antes del parser', /10 MB/.test(result.oversized), result.oversized);
check('más de 32 hojas se rechazan', /32 hojas/.test(result.manySheets), result.manySheets);
check('más de 256 columnas se rechazan', /256 columnas/.test(result.wide), result.wide);
check('más de 50 000 filas se rechazan', /50000 filas/.test(result.tall), result.tall);
check('más de 1 000 000 de celdas declaradas se rechazan', /1000000 celdas/.test(result.cells), result.cells);
check('una cabecera __proto__ no contamina Object.prototype', result.prototypeClean === true);
check('el artefacto offline incorpora SheetJS 0.20.3', offlineVersion === '0.20.3', offlineVersion);
check('el artefacto offline no solicita SheetJS externo',
  !offlineExternal.some(url => /xlsx|sheetjs/i.test(url)), offlineExternal.filter(url => /xlsx|sheetjs/i.test(url)).join(' | '));
check('no hubo errores de página', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
