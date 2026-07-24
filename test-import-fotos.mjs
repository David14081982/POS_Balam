// test-import-fotos.mjs — Excel de Inventario: columna "Foto (URL)" + importar ACTUALIZA por SKU.
// De punta a punta y por la interfaz real: exporta, escribe el .xlsx a disco, lo mete por el
// input de "Importar", confirma en la vista previa y revisa el inventario resultante.
// Cubre el riesgo del cambio: que reimportar NO duplique y que no borre costo/destacado/
// códigos de barras/foto (datos que la hoja no lleva).
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path'; import os from 'os';

const ROOT = path.resolve('.');
const TMP = path.join(os.tmpdir(), 'balam-test-import');
fs.mkdirSync(TMP, { recursive: true });
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/POS Balam.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8808, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => errs.push(String(e)));
await page.route(/supabase\.co/, r => r.abort());
await page.goto('http://127.0.0.1:8808/POS%20Balam.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG && window.XLSXIO && window.XLSX, null, { timeout: 30000 });

const FOTO_REAL = 'https://telohdbvbvsfmwyriflz.supabase.co/storage/v1/object/public/product-photos/prod-p1.jpg';

// ── Inventario de partida: foto real, foto genérica y foto incrustada ────────────────
const antes = await page.evaluate((FOTO_REAL) => {
  const D = window.DATA;
  if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; }
  D.products.length = 0;
  // Colores distintos a propósito: con la receta de fábrica el SKU NO lleva el No. Modelo,
  // así que dos prendas que solo difieren en modelo compartirían SKU.
  const mk = (id, modelo, nombre, color, extra) => Object.assign(D.hydrate({
    id, cat: '21', manga: 'MC', tela: 'ALG', color, cuello: 'NOR', modelo, nombre,
    orn: '—', ornColors: [], precio: 1000, pop: false, stock: D.mkStock([0, 7], []),
  }), extra || {});
  // p1: foto REAL subida + costo propio + destacado + código de barras guardado
  const p1 = mk('p1', '001', 'TIRA BORDADA', 'BL', { imagen: FOTO_REAL, costo: 777, pop: true, barcodeUrls: { M: 'https://x/bc.png' } });
  p1.attrs = { modelo: '001', temporada: 'VER' };
  const p2 = mk('p2', '002', 'CANDELA', 'AZ');                 // foto GENÉRICA (la pone hydrate)
  const p3 = mk('p3', '003', 'GALA', 'MR', { imagen: 'data:image/jpeg;base64,' + 'A'.repeat(60000) }); // INCRUSTADA
  D.products.push(p1, p2, p3); D.saveProducts();
  const skus = D.products.map(p => p.sku);
  return {
    total: D.products.length, skus, unicos: new Set(skus).size,
    p1Auto: D.isAutoImg(p1.imagen), p2Auto: D.isAutoImg(p2.imagen),
  };
}, FOTO_REAL);
check('fixture: 3 productos con SKU distinto', antes.total === 3 && antes.unicos === 3, antes.skus.join(' '));
check('fixture: la foto real NO se marca como genérica y la de relleno sí', antes.p1Auto === false && antes.p2Auto === true);

// ── Exportar → construir el .xlsx en el navegador → guardarlo a disco ────────────────
const xls = await page.evaluate(() => {
  const D = window.DATA;
  const real = window.XLSX.utils.json_to_sheet; let filas = null;
  window.XLSX.utils.json_to_sheet = (d, o) => { if (!filas) filas = d; return real(d, o); };
  const realW = window.XLSX.writeFile; window.XLSX.writeFile = () => {};
  window.XLSXIO.exportInventory(D.products);
  window.XLSX.utils.json_to_sheet = real; window.XLSX.writeFile = realW;
  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.json_to_sheet(filas, { header: window.XLSXIO.headers() });
  window.XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  return { fotos: filas.map(f => f['Foto (URL)']), headers: window.XLSXIO.headers(), b64: window.XLSX.write(wb, { bookType: 'xlsx', type: 'base64' }) };
});
check('existe la columna "Foto (URL)"', xls.headers.includes('Foto (URL)'));
check('A–K conservan su posición (Foto va después de Precio)', xls.headers[10] === 'Precio' && xls.headers[11] === 'Foto (URL)', xls.headers.slice(9, 12).join(' | '));
check('exporta la URL REAL', xls.fotos[0] === FOTO_REAL, xls.fotos[0]);
check('NO exporta la foto genérica', xls.fotos[1] === '', JSON.stringify(xls.fotos[1]));
check('NO exporta la foto incrustada (no cabe en Excel)', xls.fotos[2] === '', String(xls.fotos[2]).slice(0, 30));

const file1 = path.join(TMP, 'inv.xlsx');
fs.writeFileSync(file1, Buffer.from(xls.b64, 'base64'));
check('el .xlsx pesa poco (sin fotos incrustadas)', fs.statSync(file1).size < 200000, fs.statSync(file1).size + ' bytes');

// ── Reimportar EL MISMO archivo por la interfaz ──────────────────────────────────────
async function importar(ruta) {
  await page.evaluate(() => { const b = [...document.querySelectorAll('nav button')].find(x => /Inventario/.test(x.innerText)); if (b) b.click(); });
  await page.waitForTimeout(900);
  await page.setInputFiles('input[type=file][accept*=".xlsx"]', ruta);
  await page.waitForSelector('text=Previsualizar importación', { timeout: 15000 });
  const badges = await page.evaluate(() => document.body.innerText.match(/\d+ (nuevos|se actualizan)/g) || []);
  // El texto del botón lleva la ligadura del ícono y el estilo lo pone en mayúsculas
  // ("check IMPORTAR 4"): se busca sin anclar y sin distinguir may/min.
  const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /importar\s+\d+/i.test(x.innerText)); if (b) { b.click(); return true; } return false; });
  if (!clicked) throw new Error('No se encontró el botón de confirmar importación');
  await page.waitForSelector('text=Previsualizar importación', { state: 'detached', timeout: 10000 });
  await page.waitForTimeout(600);
  return badges;
}
const badges1 = await importar(file1);
check('la vista previa avisa que se ACTUALIZAN (no que son nuevos)', badges1.some(t => /se actualizan/.test(t)) && !badges1.some(t => /[1-9]\d* nuevos/.test(t)), JSON.stringify(badges1));

const d1 = await page.evaluate(() => {
  const D = window.DATA, p1 = D.products.find(p => p.id === 'p1');
  return {
    total: D.products.length, ids: D.products.map(p => p.id),
    costo: p1 && p1.costo, pop: p1 && p1.pop, bc: p1 && p1.barcodeUrls && p1.barcodeUrls.M,
    imagen: p1 && p1.imagen, attrs: p1 && p1.attrs,
    p2imgAuto: D.isAutoImg((D.products.find(p => p.id === 'p2') || {}).imagen),
  };
});
check('NO DUPLICA: siguen siendo 3 productos', d1.total === 3, 'total=' + d1.total);
check('conserva los IDs originales (no crea nuevos)', JSON.stringify(d1.ids) === JSON.stringify(['p1', 'p2', 'p3']), JSON.stringify(d1.ids));
check('conserva el costo capturado', d1.costo === 777, String(d1.costo));
check('conserva "destacado"', d1.pop === true, String(d1.pop));
check('conserva el código de barras guardado', d1.bc === 'https://x/bc.png', String(d1.bc));
check('conserva la foto real', d1.imagen === FOTO_REAL, String(d1.imagen).slice(0, 40));
check('la celda vacía NO borra la foto genérica del otro', d1.p2imgAuto === true);
check('attrs se fusiona (no pierde "temporada", que no tiene columna)', d1.attrs && d1.attrs.temporada === 'VER', JSON.stringify(d1.attrs));

// ── Editar el Excel: cambiar precio/stock y poner una foto nueva ─────────────────────
const NUEVA = 'https://telohdbvbvsfmwyriflz.supabase.co/storage/v1/object/public/product-photos/prod-p2.jpg';
const xls2 = await page.evaluate(({ b64, NUEVA }) => {
  const wb = window.XLSX.read(Uint8Array.from(atob(b64), c => c.charCodeAt(0)), { type: 'array' });
  const ws = wb.Sheets['Inventario'];
  const filas = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
  filas[1]['Foto (URL)'] = NUEVA;   // al que tenía genérica se le pone una real
  filas[0]['Precio'] = 1234;        // y se cambia un precio
  // Fila nueva: color distinto → SKU distinto → debe AGREGARSE, no actualizar.
  filas.push(Object.assign({}, filas[0], { SKU: '', 'Color': 'HU', 'No. Modelo': '099', 'Modelo': 'PRODUCTO NUEVO', 'Foto (URL)': NUEVA }));
  const ws2 = window.XLSX.utils.json_to_sheet(filas, { header: window.XLSXIO.headers() });
  const wb2 = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb2, ws2, 'Inventario');
  return window.XLSX.write(wb2, { bookType: 'xlsx', type: 'base64' });
}, { b64: xls.b64, NUEVA });
const file2 = path.join(TMP, 'inv2.xlsx');
fs.writeFileSync(file2, Buffer.from(xls2, 'base64'));

const badges2 = await importar(file2);
check('la vista previa distingue 1 nuevo y 3 que se actualizan', badges2.some(t => /1 nuevos/.test(t)) && badges2.some(t => /3 se actualizan/.test(t)), JSON.stringify(badges2));

const d2 = await page.evaluate(({ NUEVA }) => {
  const D = window.DATA;
  const p1 = D.products.find(p => p.id === 'p1'), p2 = D.products.find(p => p.id === 'p2');
  return { total: D.products.length, precio: p1 && p1.precio, p2img: p2 && p2.imagen, nuevoImg: (D.products.find(p => p.nombre === 'PRODUCTO NUEVO') || {}).imagen, nuevoOk: !!D.products.find(p => p.nombre === 'PRODUCTO NUEVO') };
}, { NUEVA });
check('el producto nuevo SÍ se agrega (4 en total)', d2.total === 4 && d2.nuevoOk, 'total=' + d2.total);
check('el precio editado se actualiza', d2.precio === 1234, String(d2.precio));
check('la foto nueva del Excel SÍ se carga', d2.p2img === NUEVA, String(d2.p2img).slice(0, 45));
check('el producto nuevo llega con su foto', d2.nuevoImg === NUEVA, String(d2.nuevoImg).slice(0, 45));
check('sin errores de página', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
