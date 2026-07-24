// test-filtros-inventario.mjs — Los filtros por catálogo del Inventario son LISTAS DESPLEGABLES
// y siguen filtrando igual que la franja de botones que había antes.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = path.resolve('.');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/POS Balam.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8810, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
page.on('pageerror', e => errs.push(String(e)));
await page.route(/supabase\.co/, r => r.abort());
await page.goto('http://127.0.0.1:8810/POS%20Balam.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 25000 });

// Tela filtrable (como en la tienda) + productos de dos telas distintas
await page.evaluate(() => {
  const D = window.DATA, C = window.CONFIG;
  if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; }
  C.setCatalogMeta('fabric', Object.assign({}, C.catalogMeta('fabric'), { filterable: true }));
  D.products.length = 0;
  const mk = (id, tela, color, nombre) => D.hydrate({
    id, cat: '21', manga: 'MC', tela, color, cuello: 'NOR', modelo: id.slice(-3), nombre,
    orn: '—', ornColors: [], precio: 1000, pop: false, stock: D.mkStock([0, 5], []),
  });
  D.products.push(mk('f001', 'ALG', 'BL', 'ALGODON UNO'), mk('f002', 'ALG', 'AZ', 'ALGODON DOS'), mk('f003', 'POL', 'MR', 'POLIESTER UNO'));
  D.saveProducts();
});
await page.evaluate(() => { const b = [...document.querySelectorAll('nav button')].find(x => /Inventario/.test(x.innerText)); if (b) b.click(); });
await page.waitForTimeout(1200);

const filtros = () => page.evaluate(() => {
  const wraps = [...document.querySelectorAll('select')].filter(s => [...s.options].some(o => o.value === 'all'));
  return wraps.map(s => ({
    etiqueta: (s.parentElement.querySelector('label') || {}).innerText || '',
    valor: s.value, opciones: [...s.options].map(o => o.text),
  }));
});
const visibles = () => page.evaluate(() => [...document.querySelectorAll('td')].map(t => t.innerText.trim()).filter(t => /^(ALGODON|POLIESTER) (UNO|DOS)$/.test(t)));

const f0 = await filtros();
check('el filtro de catálogo es un <select>, no una franja de botones', f0.length === 1, 'selects=' + f0.length);
check('lleva ETIQUETA con el nombre del catálogo', /tela/i.test(f0[0] && f0[0].etiqueta), JSON.stringify(f0[0] && f0[0].etiqueta));
check('arranca en "Todas"', f0[0] && f0[0].valor === 'all', f0[0] && f0[0].valor);
check('la primera opción es "Todas" y trae el catálogo', f0[0] && f0[0].opciones[0] === 'Todas' && f0[0].opciones.length > 2, JSON.stringify((f0[0] || {}).opciones || []).slice(0, 70));
check('ya NO quedan franjas de botones de catálogo', await page.evaluate(() => ![...document.querySelectorAll('button')].some(x => x.innerText.trim().toUpperCase() === 'ALGODÓN')));

const v0 = await visibles();
check('sin filtro se ven los 3 productos', v0.length === 3, JSON.stringify(v0));

// Filtrar por ALG
await page.selectOption('select >> nth=0', 'ALG').catch(async () => {
  await page.evaluate(() => { const s = [...document.querySelectorAll('select')].find(x => [...x.options].some(o => o.value === 'all')); s.value = 'ALG'; s.dispatchEvent(new Event('change', { bubbles: true })); });
});
await page.waitForTimeout(700);
const v1 = await visibles();
check('al elegir ALGODÓN filtra a 2 productos', v1.length === 2 && v1.every(t => /ALGODON/.test(t)), JSON.stringify(v1));
check('aparece el botón "Limpiar" con el filtro activo', await page.evaluate(() => [...document.querySelectorAll('button')].some(x => /limpiar/i.test(x.innerText))));

// Limpiar
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /limpiar/i.test(x.innerText)); if (b) b.click(); });
await page.waitForTimeout(700);
const v2 = await visibles();
check('"Limpiar" regresa a los 3 productos', v2.length === 3, JSON.stringify(v2));
check('el desplegable vuelve a "Todas"', (await filtros())[0].valor === 'all');

// El buscador sigue funcionando junto al filtro
await page.fill('input[placeholder*="Buscar"]', 'POLIESTER');
await page.waitForTimeout(700);
check('el buscador sigue funcionando', (await visibles()).length === 1, JSON.stringify(await visibles()));

const shot = 'C:/Users/david/AppData/Local/Temp/claude/c--Users-david-Downloads-POS-BALAM/678cc16d-63c1-47dd-9f8a-3e02db1afdda/scratchpad/filtros.png';
await page.fill('input[placeholder*="Buscar"]', '');
await page.waitForTimeout(400);
await page.locator('div.p-10').first().screenshot({ path: shot }).catch(() => {});
check('sin errores de página', errs.length === 0, errs.slice(0, 2).join(' | '));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
