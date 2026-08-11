// test-export-modelo.mjs — La columna "Modelo" del Excel de Inventario sale SIN ABREVIAR.
// Los productos importados desde Excel guardaron el codigo ('TB') como nombre; la exportacion
// ahora lo resuelve contra el catalogo "Modelo" (TB -> TIRA BORDADA). Verifica ademas que NO
// cambie ninguna otra columna, que 'No. Modelo' siga siendo el codigo y que el producto
// guardado no se modifique.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = path.resolve('.');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8807, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage();
page.on('pageerror', e => errs.push(String(e)));
await page.route(/supabase\.co/, r => r.abort());
await page.goto('http://127.0.0.1:8807/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG && window.XLSXIO, null, { timeout: 25000 });

const r = await page.evaluate(async () => {
  const D = window.DATA, C = window.CONFIG, out = {};
  if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; }

  // Autoridad "Modelo" publicada: H-94 usa `producto`; instalaciones antiguas
  // pueden conservar `modelo`, pero nunca se crea una segunda autoridad.
  out.kind = C.modeloKind();
  C.addItem(out.kind, { code: 'TB', label: 'TIRA BORDADA' });
  C.addItem(out.kind, { code: 'CAN', label: 'CANDELA REAL' });
  C.addItem(out.kind, { code: 'GAP', label: 'GALA PREMIUM' });
  C.setActive(out.kind, 'GAP', false); // dado de baja: sus productos igual deben exportarse

  const mk = (id, nombre, modelo) => D.hydrate({
    id, cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
    modelo, nombre, orn: '—', ornColors: [], precio: 1150, costo: 400, pop: false,
    stock: D.mkStock([0, 5], []),
  });
  // 1) importado por Excel: el nombre quedó siendo el código (el caso del dueño)
  // 2) dado de alta en pantalla: el nombre ya es la etiqueta
  // 3) modelo dado de baja
  // 4) código que NO está en el catálogo → debe conservar su nombre tal cual
  const prods = [
    mk('x1', 'TIRA BORDADA', 'TB'),
    mk('x2', 'CANDELA REAL', 'CAN'),
    mk('x3', 'GALA PREMIUM', 'GAP'),
    mk('x4', 'Nombre Libre', 'ZZZ'),
  ];
  prods.forEach(p => { p.attrs = { [out.kind]: p.modelo }; }); // como los guarda el alta de producto
  out.nombresAntes = prods.map(p => p.nombre);
  out.headers = window.XLSXIO.headers();

  // Captura las filas que se escriben a la hoja, sin descargar archivo
  await new Promise(res => { const t = setInterval(() => { if (window.XLSX) { clearInterval(t); res(); } }, 100); setTimeout(res, 8000); });
  const realSheet = window.XLSX.utils.json_to_sheet;
  let capturado = null; // filas completas de la hoja "Inventario"
  window.XLSX.utils.json_to_sheet = (data, opts) => { if (!capturado) capturado = data; return realSheet(data, opts); };
  const realWrite = window.XLSX.writeFile; window.XLSX.writeFile = () => {};
  window.XLSXIO.exportInventory(prods);
  window.XLSX.utils.json_to_sheet = realSheet; window.XLSX.writeFile = realWrite;

  out.filas = (capturado || []).map(f => ({
    sku: f['SKU'], modelo: f['Modelo'], noModelo: f['No. Modelo'],
    cat: f['Categoría'], manga: f['Manga'], tela: f['Material'], color: f['Color Tela'],
    orn: f['Ornamento'], cuello: f['Cuello'], precio: f['Precio'],
  }));
  out.nombresDespues = prods.map(p => p.nombre);

  // ── Ida y vuelta REAL: el Excel exportado se vuelve a importar ──────────────────
  // Es el riesgo del cambio: al quitar la columna duplicada, la importación debe seguir
  // resolviendo el catálogo "Modelo" desde la columna base (validCustom acepta el nombre).
  try {
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.json_to_sheet(capturado, { header: window.XLSXIO.headers() });
    window.XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    const buf = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const file = new File([buf], 'inv.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const res = await window.XLSXIO.parseFile(file);
  out.reimport = (res.products || []).map(p => ({ nombre: p.nombre, modelo: p.modelo, attrModelo: (p.attrs || {})[out.kind], sku: p.sku }));
  } catch (e) { out.reimportError = String(e); }
  return out;
});

if (r.filas.length !== 4) { console.log('No se capturaron las filas:', JSON.stringify(r).slice(0, 400)); }
const [f1, f2, f3, f4] = r.filas;
console.log(JSON.stringify(r.filas, null, 1));

check('existe una sola autoridad custom para Modelo', ['producto', 'modelo'].includes(r.kind), String(r.kind));
check('columna "Modelo" aparece UNA sola vez en los encabezados', r.headers.filter(h => h === 'Modelo').length === 1, 'veces=' + r.headers.filter(h => h === 'Modelo').length);
check('columna B sale SIN ABREVIAR (nombre del producto)', f1 && f1.modelo === 'TIRA BORDADA', f1 && f1.modelo);
check('columna G conserva el código', f1 && f1.noModelo === 'TB', f1 && f1.noModelo);
check('B y G ya NO son iguales', f1 && f1.modelo !== f1.noModelo);
check('el resto de productos también sale completo', f2 && f2.modelo === 'CANDELA REAL' && f3 && f3.modelo === 'GALA PREMIUM', [f2 && f2.modelo, f3 && f3.modelo].join(' / '));
check('modelo fuera del catálogo: sin cambios', f4 && f4.modelo === 'Nombre Libre', f4 && f4.modelo);
check('el resto de columnas NO cambia', !!f1 && f1.sku && f1.cat === '21' && f1.manga === 'MC' && f1.tela === 'ALG' && f1.color === 'BL' && f1.cuello === 'NOR' && f1.precio === 1150, JSON.stringify(f1));
check('el PRODUCTO guardado no se modifica', JSON.stringify(r.nombresAntes) === JSON.stringify(r.nombresDespues), r.nombresDespues.join('/'));
// Ida y vuelta: exportar → volver a importar ese mismo archivo
const ri = r.reimport || [];
const r1 = ri[0];
check('reimportar el Excel NO falla', !r.reimportError && ri.length === 4, r.reimportError || ('productos=' + ri.length));
check('reimport: conserva el nombre completo', r1 && r1.nombre === 'TIRA BORDADA', r1 && r1.nombre);
check('reimport: el catálogo "Modelo" se resuelve al código (SKU intacto)', r1 && r1.attrModelo === 'TB', r1 && r1.attrModelo);
check('reimport: el SKU sale igual que el original', r1 && f1 && r1.sku === f1.sku, [r1 && r1.sku, f1 && f1.sku].join(' vs '));
check('sin errores de página', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
