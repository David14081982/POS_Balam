// test-h67-size-headers.mjs — Las columnas de talla del Excel se llaman como la TALLA,
// y las piezas se siguen localizando por la IDENTIDAD interna.
//
// La tienda tiene tallas cuyo código interno no es su nombre (H-64): la 38 es la
// identidad '0', la 40 es 'A', la 42 es 'B'. La exportación componía el encabezado con
// esa identidad y salían columnas «T0», «TA», «TB», que no significan nada para nadie.
//
// Este arnés:
//   · REPRODUCE el defecto ejecutando el módulo del commit anterior (fc4ac77) dentro de
//     la misma página, y afirma que ese código genera T0/TA/TB;
//   · verifica el archivo .xlsx REAL descargado por el navegador —encabezados, cantidades
//     y mapa de identidades—;
//   · vuelve a importar ese mismo archivo y comprueba que T38 escribe en la identidad '0';
//   · comprueba que un archivo anterior (encabezados por identidad, sin hoja «Catálogos»)
//     se sigue importando igual que siempre;
//   · comprueba que las etiquetas duplicadas BLOQUEAN exportación e importación.
//
//     node test-h67-size-headers.mjs
//
import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = path.resolve('.');
const EVIDENCIA = path.join(ROOT, '.evidence-h67');
const ARCHIVO = 'Inventario_H67.xlsx';
const COMMIT_ANTERIOR = 'fc4ac77'; // último commit ANTES de H-67; fijo a propósito
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8819, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

// Catálogo real de la tienda: identidad interna → etiqueta visible.
const PLAN = [['0', '38'], ['A', '40'], ['B', '42'], ['C', '44'], ['D', '46'], ['E', '48'], ['G', '50']];
const INACTIVA = ['F', '49'];

fs.mkdirSync(EVIDENCIA, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(String(e)));
await page.route(/supabase\.co/, r => r.abort());
await page.goto('http://127.0.0.1:8819/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG && window.XLSXIO && window.XLSX, null, { timeout: 30000 });

// ── Escenario: el catálogo y las existencias de la tienda ────────────────────────
const escenario = await page.evaluate(({ PLAN, INACTIVA }) => {
  const D = window.DATA, C = window.CONFIG;
  if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; }
  const snap = C.snapshot();
  snap.catalogs.size_number = PLAN.map(([code, label]) => ({ code, label, active: true, meta: {} }))
    .concat([{ code: INACTIVA[0], label: INACTIVA[1], active: false, meta: {} }]);
  snap.catalogs.size_letter = [
    { code: 'CH', label: 'CHICO', active: true, meta: {} },
    { code: 'M', label: 'MEDIANO', active: true, meta: {} },
    { code: 'G', label: 'GRANDE', active: true, meta: {} },
  ];
  C.load(snap);

  const mkNum = (id, piezas) => D.hydrate({
    id, cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo: id.slice(-3),
    nombre: 'CAMISA ' + id, orn: '—', ornColors: [], precio: 650, costo: 300, pop: false,
    attrs: { __sizeCategoryId: 'size_number' }, sizeCategoryId: 'size_number',
    stock: Object.keys(piezas).map(t => ({ talla: t, escala: 'N', stock: piezas[t] })),
  });
  const mkLetra = (id, piezas) => D.hydrate({
    id, cat: '21', manga: 'ML', tela: 'ALG', color: 'NE', cuello: 'NOR', modelo: id.slice(-3),
    nombre: 'BLUSA ' + id, orn: '—', ornColors: [], precio: 480, costo: 200, pop: false,
    attrs: { __sizeCategoryId: 'size_letter' }, sizeCategoryId: 'size_letter',
    stock: Object.keys(piezas).map(t => ({ talla: t, escala: 'L', stock: piezas[t] })),
  });
  // p1 incluye piezas en la talla INACTIVA ('F'): es el caso de H-63 y no debe perderse.
  window.__prods = [
    mkNum('p101', { '0': 5, 'A': 7, 'B': 3, 'C': 0, 'D': 0, 'E': 0, 'G': 2, 'F': 4 }),
    mkNum('p102', { '0': 11, 'A': 0, 'B': 6, 'C': 1, 'D': 0, 'E': 9, 'G': 0, 'F': 0 }),
    mkLetra('p103', { 'CH': 1, 'M': 6, 'G': 0 }),
  ];
  const piezas = window.__prods.reduce((s, p) => s + p.stock.reduce((a, v) => a + v.stock, 0), 0);
  return {
    headers: window.XLSXIO.headers(),
    columnas: window.XLSXIO.sizeColumns(),
    huellaAntes: JSON.stringify(window.__prods.map(p => [p.id, p.stock])),
    piezas,
  };
}, { PLAN, INACTIVA });

const numHeaders = escenario.columnas.numbers.map(i => i.header);
const letraHeaders = escenario.columnas.letters.map(i => i.header);
console.log('\nColumnas de talla (número):', numHeaders.join(', '));
console.log('Columnas de talla (letra) :', letraHeaders.join(', '), '\n');

// ── 1. El Excel REAL: se descarga desde el navegador y se lee del disco ──────────
const destino = path.join(EVIDENCIA, ARCHIVO);
const [descarga] = await Promise.all([
  page.waitForEvent('download', { timeout: 20000 }),
  page.evaluate(() => window.XLSXIO.exportInventory(window.__prods)),
]);
await descarga.saveAs(destino);
const bytes = fs.statSync(destino).size;
check('el navegador descarga un archivo .xlsx real', bytes > 3000, descarga.suggestedFilename() + ' · ' + bytes + ' bytes');

// Se vuelve a leer DEL DISCO, con el motor de Excel, como lo abriría el dueño.
const real = await page.evaluate(async (rel) => {
  const buf = await (await fetch(rel)).arrayBuffer();
  const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
  const inv = wb.Sheets['Inventario'];
  const filas = window.XLSX.utils.sheet_to_json(inv, { defval: '' });
  const encabezados = window.XLSX.utils.sheet_to_json(inv, { header: 1, defval: '' })[0];
  const cat = window.XLSX.utils.sheet_to_json(wb.Sheets['Catálogos'], { header: 1, defval: '' });
  const i = cat.findIndex(r => String((r && r[0]) || '').indexOf('MAPA DE COLUMNAS DE TALLA') === 0);
  const mapa = [];
  for (let k = i + 2; k < cat.length; k++) {
    const r = cat[k] || [];
    if (!String(r[0] || '').trim()) break;
    mapa.push({ columna: String(r[0]), identidad: String(r[1]), etiqueta: String(r[2]), kind: String(r[3]) });
  }
  return { hojas: wb.SheetNames, encabezados, filas, mapa };
}, '/.evidence-h67/' + ARCHIVO);

const ESPERADAS = ['T38', 'T40', 'T42', 'T44', 'T46', 'T48', 'T50'];
const PROHIBIDAS = ['T0', 'TA', 'TB', 'TC', 'TD', 'TE', 'TG'];
check('1 · el archivo real exporta T38, T40, T42, T44, T46, T48 y T50',
  ESPERADAS.every(h => real.encabezados.includes(h)),
  real.encabezados.filter(h => /^T/.test(h)).join(', '));
check('2 · el archivo real NO trae T0, TA, TB, TC, TD, TE ni TG',
  PROHIBIDAS.every(h => !real.encabezados.includes(h)),
  real.encabezados.filter(h => PROHIBIDAS.includes(h)).join(', ') || 'ninguna');

const f1 = real.filas.find(f => f['SKU'] && f['Modelo'] === 'CAMISA p101');
const f2 = real.filas.find(f => f['Modelo'] === 'CAMISA p102');
const f3 = real.filas.find(f => f['Modelo'] === 'BLUSA p103');
check('3 · las cantidades quedan en la columna lógica que les toca',
  f1 && f1['T38'] === 5 && f1['T40'] === 7 && f1['T42'] === 3 && f1['T50'] === 2,
  f1 ? `T38=${f1['T38']} T40=${f1['T40']} T42=${f1['T42']} T50=${f1['T50']}` : 'sin fila');
check('3b · el segundo producto también',
  f2 && f2['T38'] === 11 && f2['T42'] === 6 && f2['T44'] === 1 && f2['T48'] === 9,
  f2 ? `T38=${f2['T38']} T42=${f2['T42']} T44=${f2['T44']} T48=${f2['T48']}` : 'sin fila');

const todasCols = ESPERADAS.concat(['T49'], letraHeaders);
const totalArchivo = real.filas.reduce((s, f) => s + todasCols.reduce((a, h) => a + (Number(f[h]) || 0), 0), 0);
check('4 · el total de piezas exportadas no cambia', totalArchivo === escenario.piezas,
  `archivo=${totalArchivo} · inventario=${escenario.piezas}`);

check('10 · la talla INACTIVA conserva su columna y sus piezas',
  real.encabezados.includes('T49') && f1 && f1['T49'] === 4, f1 ? String(f1['T49']) : 'sin fila');
check('11 · Talla (Letra) sin regresiones', letraHeaders.join(',') === 'CHICO,MEDIANO,GRANDE'
  && f3 && f3['CHICO'] === 1 && f3['MEDIANO'] === 6, letraHeaders.join(',') + ' · ' + (f3 ? f3['MEDIANO'] : '—'));
const BASE = ['SKU', 'Modelo', 'Categoría', 'Manga', 'Material', 'Color Tela', 'No. Modelo', 'Ornamento', 'Colores Orn.', 'Cuello', 'Precio', 'Foto (URL)', 'Categoría por talla'];
check('12 · el resto de columnas del Excel queda intacto',
  BASE.every((h, i) => real.encabezados[i] === h) && f1 && f1['Categoría'] === '21' && f1['Manga'] === 'MC'
  && f1['Material'] === 'ALG' && f1['Color Tela'] === 'BL' && f1['Precio'] === 650 && f1['Categoría por talla'] === 'size_number',
  real.encabezados.slice(0, 13).join('|'));

// El archivo lleva su propio mapa columna → identidad: es lo que lo hace reimportable.
const mapa38 = real.mapa.find(m => m.columna === 'T38');
const mapa40 = real.mapa.find(m => m.columna === 'T40');
check('el archivo declara la identidad interna de cada columna',
  mapa38 && mapa38.identidad === '0' && mapa40 && mapa40.identidad === 'A',
  real.mapa.filter(m => m.kind === 'size_number').map(m => m.columna + '→' + m.identidad).join(' '));

// ── 2. Reimportar ESE MISMO archivo: T38 escribe en la identidad '0' ─────────────
const reimport = await page.evaluate(async (rel) => {
  const buf = await (await fetch(rel)).arrayBuffer();
  const file = new File([buf], 'inv.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  try {
    const res = await window.XLSXIO.parseFile(file);
    return { productos: res.products.map(p => ({ nombre: p.nombre, sku: p.sku, stock: p.stock })) };
  } catch (e) { return { error: String(e && e.message || e) }; }
}, '/.evidence-h67/' + ARCHIVO);

const rp1 = (reimport.productos || []).find(p => p.nombre === 'CAMISA p101') || { stock: [] };
const pieza = (p, talla) => (p.stock.find(v => String(v.talla) === talla) || {}).stock;
check('7 · al importar, T38 resuelve a la identidad interna 0', pieza(rp1, '0') === 5,
  reimport.error || ('talla 0 → ' + pieza(rp1, '0')));
check('8 · al importar, T40 resuelve a la identidad interna A', pieza(rp1, 'A') === 7,
  reimport.error || ('talla A → ' + pieza(rp1, 'A')));
check('la identidad importada NUNCA es la etiqueta', !rp1.stock.some(v => ['38', '40', '42'].includes(String(v.talla))),
  rp1.stock.map(v => v.talla).join(','));
check('5 · la talla interna 0 sigue leyendo stock[].talla = 0', pieza(rp1, '0') === 5);
check('6 · la talla interna A sigue leyendo stock[].talla = A', pieza(rp1, 'A') === 7);
check('la ida y vuelta conserva las piezas de la talla inactiva', pieza(rp1, 'F') === 4, String(pieza(rp1, 'F')));

// El export no toca el inventario guardado.
const huellaDespues = await page.evaluate(() => JSON.stringify(window.__prods.map(p => [p.id, p.stock])));
check('exportar e importar no mueve una sola pieza del inventario en memoria',
  huellaDespues === escenario.huellaAntes);

// ── 3. Archivo ANTERIOR (encabezados por identidad, sin hoja «Catálogos») ────────
const heredado = await page.evaluate(async () => {
  const wb = window.XLSX.utils.book_new();
  const fila = {
    'SKU': '21-MC-ALG-BL-T', 'Modelo': 'CAMISA HEREDADA', 'Categoría': '21', 'Manga': 'MC', 'Tela': 'ALG',
    'Color': 'BL', 'No. Modelo': '901', 'Ornamento': '—', 'Colores Orn.': '', 'Cuello': 'NOR', 'Precio': 700,
    'Foto (URL)': '', 'Categoría por talla': 'size_number',
    'T0': 9, 'TA': 2, 'TB': 0, 'TC': 0, 'TD': 0, 'TE': 0, 'TG': 0, 'TF': 0,
  };
  const H = Object.keys(fila);
  const ws = window.XLSX.utils.json_to_sheet([fila], { header: H });
  window.XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  const buf = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const file = new File([buf], 'viejo.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  try {
    const res = await window.XLSXIO.parseFile(file);
    const p = res.products[0];
    return { stock: p ? p.stock : [] };
  } catch (e) { return { error: String(e && e.message || e) }; }
});
const hp = { stock: heredado.stock || [] };
check('un archivo anterior (T0 = identidad 0) se importa igual que siempre',
  pieza(hp, '0') === 9 && pieza(hp, 'A') === 2, heredado.error || JSON.stringify(heredado.stock));

// ── 4. Archivo nuevo SIN su hoja «Catálogos»: se detiene, no se adivina ──────────
const sinMapa = await page.evaluate(async (rel) => {
  const buf = await (await fetch(rel)).arrayBuffer();
  const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
  const solo = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(solo, wb.Sheets['Inventario'], 'Inventario');
  const out = window.XLSX.write(solo, { bookType: 'xlsx', type: 'array' });
  const file = new File([out], 'sin-mapa.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  try {
    const res = await window.XLSXIO.parseFile(file);
    return { productos: res.products.length, piezas: res.products.reduce((s, p) => s + p.stock.reduce((a, v) => a + v.stock, 0), 0) };
  } catch (e) { return { bloqueado: true, balam: !!(e && e.balam), mensaje: String(e && e.message || e) }; }
}, '/.evidence-h67/' + ARCHIVO);
check('un archivo con columnas nuevas y sin hoja «Catálogos» se BLOQUEA (no vacía el stock)',
  sinMapa.bloqueado === true && sinMapa.balam === true, sinMapa.mensaje || JSON.stringify(sinMapa));

// ── 5. Etiquetas duplicadas: bloquean exportación e importación ──────────────────
const duplicadas = await page.evaluate(async (rel) => {
  const C = window.CONFIG, out = {};
  C.updateItem('size_number', 'A', { label: '38' }); // dos tallas activas llamadas «38»
  try { window.XLSXIO.headers(); out.exportOk = true; }
  catch (e) { out.exportBloqueado = true; out.balam = !!e.balam; out.mensaje = e.message; }
  const avisos = [];
  const realToast = window.UI.toast; window.UI.toast = (m) => avisos.push(m);
  const realWrite = window.XLSX.writeFile; let escribio = false; window.XLSX.writeFile = () => { escribio = true; };
  window.XLSXIO.exportInventory(window.__prods);
  window.UI.toast = realToast; window.XLSX.writeFile = realWrite;
  out.escribioArchivo = escribio;
  out.aviso = avisos[0] || '';
  const buf = await (await fetch(rel)).arrayBuffer();
  const file = new File([buf], 'inv.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  try { await window.XLSXIO.parseFile(file); out.importOk = true; }
  catch (e) { out.importBloqueado = true; out.importBalam = !!e.balam; }
  C.updateItem('size_number', 'A', { label: '40' }); // se restaura el escenario
  out.restaurado = window.XLSXIO.headers().includes('T40');
  return out;
}, '/.evidence-h67/' + ARCHIVO);
check('9a · dos tallas con la misma etiqueta bloquean la EXPORTACIÓN',
  duplicadas.exportBloqueado === true && duplicadas.escribioArchivo === false,
  duplicadas.mensaje || 'no bloqueó');
check('9b · el bloqueo avisa con un mensaje claro y accionable',
  /etiqueta «38»/.test(duplicadas.aviso || '') && /Configuración/.test(duplicadas.aviso || ''),
  duplicadas.aviso);
check('9c · dos tallas con la misma etiqueta bloquean la IMPORTACIÓN',
  duplicadas.importBloqueado === true && duplicadas.importBalam === true);
check('el escenario queda restaurado', duplicadas.restaurado === true);

// ── 6. REPRODUCCIÓN: el módulo del commit anterior genera T0, TA y TB ────────────
let anterior = null;
try { anterior = execSync(`git show ${COMMIT_ANTERIOR}:balam/xlsx-io.jsx`, { encoding: 'utf8', maxBuffer: 8e6 }); }
catch (e) { console.log('⚠ no se pudo recuperar el módulo anterior:', String(e.message).slice(0, 120)); }
if (anterior) {
  const viejo = await page.evaluate((src) => {
    // Se ejecuta el módulo ANTERIOR sobre el mismo catálogo: reemplaza window.XLSXIO.
    (0, eval)(src);
    const headers = window.XLSXIO.headers();
    const realSheet = window.XLSX.utils.json_to_sheet;
    let capturado = null;
    window.XLSX.utils.json_to_sheet = (data, opts) => { if (!capturado) capturado = data; return realSheet(data, opts); };
    const realWrite = window.XLSX.writeFile; window.XLSX.writeFile = () => {};
    window.XLSXIO.exportInventory(window.__prods);
    window.XLSX.utils.json_to_sheet = realSheet; window.XLSX.writeFile = realWrite;
    const fila = (capturado || []).find(f => f['Modelo'] === 'CAMISA p101') || {};
    // Columnas de talla del módulo ANTERIOR: las que no son de la base (no hay catálogos custom).
    const BASEH = ['SKU', 'Modelo', 'Categoría', 'Manga', 'Tela', 'Color', 'No. Modelo', 'Ornamento',
      'Colores Orn.', 'Cuello', 'Precio', 'Foto (URL)', 'Categoría por talla'];
    const tallas = headers.filter(h => BASEH.indexOf(h) < 0);
    const total = (capturado || []).reduce((s, f) => s + tallas.reduce((a, h) => a + (Number(f[h]) || 0), 0), 0);
    return { headers, t0: fila['T0'], tA: fila['TA'], tB: fila['TB'], total };
  }, anterior);
  check('REPRO · el código anterior genera T0, TA y TB',
    ['T0', 'TA', 'TB', 'TC', 'TD', 'TE', 'TG'].every(h => viejo.headers.includes(h)),
    viejo.headers.filter(h => /^T/.test(h)).join(', '));
  check('REPRO · el código anterior NO genera T38, T40 ni T42',
    !viejo.headers.includes('T38') && !viejo.headers.includes('T40'),
    viejo.headers.filter(h => /^T/.test(h)).join(', '));
  check('REPRO · las piezas ya estaban bien: sólo la columna estaba mal nombrada',
    viejo.t0 === 5 && viejo.tA === 7 && viejo.tB === 3 && viejo.total === escenario.piezas,
    `T0=${viejo.t0} TA=${viejo.tA} TB=${viejo.tB} total=${viejo.total} vs ${escenario.piezas}`);
}

check('sin errores de página', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\nArchivo real verificado: ${path.relative(ROOT, destino)}`);
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
await ctx.close(); await b.close(); server.close();
process.exit(fail ? 1 : 0);
