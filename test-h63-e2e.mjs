// H-63 E2E — La protección de tallas se ejerce por INTERACCIÓN REAL sobre el
// artefacto generado: se pulsa el interruptor de Configuración y se sueltan
// archivos Excel reales en el input de importación.
//
// Se ejecuta dos veces: contra index.html servido por HTTP y contra
// "POS Balam (offline).html" abierto por file:// con la red apagada.
//
// Contratos de localización: data-testid y data-active. El texto visible sólo se
// afirma donde ES el comportamiento —el aviso que el administrador debe LEER—,
// que es la excepción declarada de AP-11.
//
// Datos: fixtures propios en un perfil desechable. Ni el perfil real ni Supabase
// participan. Antes y después de cada escenario se compara la huella de todas
// las colecciones del negocio.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve('.');
let pass = 0, fail = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  condition ? pass++ : fail++;
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8893, '127.0.0.1', r));

// ── Fixtures ────────────────────────────────────────────────────────────────
// El estado de CONFIG se toma del propio artefacto y sólo se le sustituyen los
// dos catálogos de talla: así la semilla es un estado VÁLIDO del negocio
// (R-DEL-12) y no una maqueta mínima.
const SIZE_NUMBER = [
  { code: '40', label: '40', active: true, meta: {} },            // referenciado por precio
  { code: '42', label: '42', active: true, meta: {} },            // gemelo activo sin piezas
  { code: 'B', label: '42', active: true, meta: {} },             // histórico CON existencias
  { code: 'PZ', label: 'PIEZA', active: true, meta: {} },         // referenciado por código de barras
  { code: 'PR', label: '99', active: true, meta: {} },            // referenciado por promoción
  { code: 'X9', label: '98', active: true, meta: {} },            // sin referencia alguna
];
const SIZE_LETTER = [
  { code: 'CH', label: 'CHICO', active: true, meta: {} },         // CON existencias
  { code: 'GR', label: 'GRANDE', active: true, meta: {} },
  { code: 'B', label: 'B', active: true, meta: {} },              // mismo código que en Número
];
const PRODUCTS = [
  {
    id: 'h63-num', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', modelo: '901',
    nombre: 'FIXTURE NUMERO', orn: '—', ornColors: [], cuello: 'NOR', precio: 1000, costo: 400,
    sku: '21-ML-ALG-BL-T', pop: false, imagen: 'https://example.invalid/x.jpg',
    attrs: { __sizeCategoryId: 'size_number' }, sizeCategoryId: 'size_number',
    stock: [
      { talla: 'B', escala: 'N', stock: 6 },
      { talla: '42', escala: 'N', stock: 0 },
      { talla: 'PZ', escala: 'N', stock: 0 },
      { talla: 'PR', escala: 'N', stock: 0 },
      { talla: 'X9', escala: 'N', stock: 0 },
      { talla: '40', escala: 'N', stock: 0 },
    ],
    preciosTalla: { 40: 1150 },
    barcodeUrls: { PZ: 'https://example.invalid/pz.png' },
  },
  {
    id: 'h63-let', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', modelo: '902',
    nombre: 'FIXTURE LETRA', orn: '—', ornColors: [], cuello: 'NOR', precio: 800, costo: 300,
    sku: '21-ML-ALG-BL-L', pop: false, imagen: 'https://example.invalid/y.jpg',
    attrs: { __sizeCategoryId: 'size_letter' }, sizeCategoryId: 'size_letter',
    stock: [
      { talla: 'CH', escala: 'L', stock: 3 },
      { talla: 'GR', escala: 'L', stock: 0 },
      { talla: 'B', escala: 'L', stock: 0 },
    ],
    preciosTalla: {}, barcodeUrls: {},
  },
];
const PROMOS = [{
  id: 'promo-h63', nombre: 'Fixture talla 99', tipo: 'pct', valor: 10, pausado: false,
  scope: { cats: [], telas: [], mangas: [], cuellos: [], colores: [], tallas: ['PR'], modelos: [], orns: [] },
}];

const COLECCIONES = [
  'balam_pos_products_v2', 'balam_pos_promos_v1', 'balam_pos_sales_v1', 'balam_pos_returns_v1',
  'balam_pos_exchanges_v1', 'balam_pos_loans_v1', 'balam_pos_payments_v1', 'balam_pos_moves_v1',
  'balam_pos_clients_v1', 'balam_pos_sellers_v1', 'balam_pos_liq_v1',
];
const sha = v => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 16);

// Estado base de CONFIG, tomado del artefacto real una sola vez.
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const baseCtx = await browser.newContext();
await baseCtx.route(/supabase\.co/, r => r.abort());
const basePage = await baseCtx.newPage();
await basePage.goto('http://127.0.0.1:8893/index.html', { waitUntil: 'load' });
await basePage.waitForFunction(() => window.CONFIG && window.DATA, null, { timeout: 60000 });
const CONFIG_BASE = await basePage.evaluate(() => window.CONFIG.snapshot());
await baseCtx.close();
CONFIG_BASE.catalogs.size_number = SIZE_NUMBER;
CONFIG_BASE.catalogs.size_letter = SIZE_LETTER;

// ── Utilidades de escenario ─────────────────────────────────────────────────
async function abrir(destino) {
  const ctx = await browser.newContext();
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://127.0.0.1:8893') || u.startsWith('file://')) return route.continue();
    return route.abort();
  });
  if (destino.offline) await ctx.setOffline(true);
  const page = await ctx.newPage();
  const errores = [];
  page.on('pageerror', e => errores.push(String(e).slice(0, 200)));
  page.on('dialog', d => d.accept());
  await page.addInitScript(seed => {
    localStorage.setItem('balam_config_v1', seed.config);
    localStorage.setItem('balam_pos_products_v2', seed.products);
    localStorage.setItem('balam_pos_promos_v1', seed.promos);
    localStorage.setItem('balam-page', 'config');
    localStorage.setItem('balam-sidebar', '0');
    window.__cc = 0;
    window.addEventListener('configchange', () => { window.__cc++; });
  }, {
    config: JSON.stringify(CONFIG_BASE),
    products: JSON.stringify(PRODUCTS),
    promos: JSON.stringify(PROMOS),
  });
  await page.goto(destino.url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.CONFIG && window.DATA && window.SettingsScreen, null, { timeout: 60000 });
  await page.click('[data-testid="settings-section-producto"]').catch(() => {});
  // Sin contrato de pruebas —artefacto anterior a H-63— la batería debe poder
  // reportar sus fallos uno a uno en vez de abortar con una excepción.
  const contrato = await page.waitForSelector('[data-testid="catalog-toggle-size_number-B"]', { timeout: 30000 })
    .then(() => true).catch(() => false);
  return { ctx, page, errores, contrato };
}
const huella = page => page.evaluate(keys => {
  const o = {};
  keys.forEach(k => { o[k] = localStorage.getItem(k) || ''; });
  o.__config = localStorage.getItem('balam_config_v1') || '';
  return o;
}, COLECCIONES);
const igualdad = (a, b) => Object.keys(a).every(k => sha(a[k]) === sha(b[k]));
const soloCambio = (a, b, salvo) => Object.keys(a)
  .every(k => (k === salvo ? true : sha(a[k]) === sha(b[k])));
const activo = (page, kind, code) =>
  page.getAttribute(`[data-testid="catalog-row-${kind}-${code}"]`, 'data-active').catch(() => '(ausente)');
const clic = (page, sel) => page.click(sel, { timeout: 5000 }).catch(() => {});
const cc = page => page.evaluate(() => window.__cc);

// Suelta un Excel REAL en el input de importación: el archivo se construye con el
// mismo SheetJS del paquete y se entrega por DataTransfer, de modo que corre el
// manejador de verdad (FileReader → readWorkbook → importCatalogs).
async function importar(page, hojas) {
  await page.evaluate(sheets => {
    const X = window.XLSX;
    const wb = X.utils.book_new();
    sheets.forEach(([nombre, filas]) => {
      X.utils.book_append_sheet(wb, X.utils.json_to_sheet(filas), nombre);
    });
    const out = X.write(wb, { type: 'array', bookType: 'xlsx' });
    const file = new File([out], 'catalogos.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('[data-testid="catalog-import-input"]');
    if (!input) return; // artefacto sin contrato de pruebas: la batería lo reporta abajo
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, hojas);
  await page.waitForTimeout(900); // FileReader + parseo del libro
}
const fila = (code, label, activo) => ({ 'CÓDIGO': code, 'NOMBRE': label, 'ACTIVO': activo ? 'SI' : 'NO' });
const hojaNumeroCompleta = (mutar = f => f) => mutar(SIZE_NUMBER.map(it => fila(it.code, it.label, true)));

// ── La batería ──────────────────────────────────────────────────────────────
async function bateria(destino) {
  const et = destino.etiqueta;
  console.log(`\n──────── ${et} ────────`);

  // 0. El artefacto contiene y ejecuta la protección
  {
    const { ctx, page, errores, contrato } = await abrir(destino);
    check(`${et} · la tarjeta de catálogos expone el contrato de pruebas`, contrato);
    const api = await page.evaluate(() => ({
      autoridad: typeof window.CONFIG.sizeCodeReferences,
      gateway: typeof window.CORE.catalogPromotions,
      registro: typeof window.CORE.registerCatalogPromotions,
      escritura: typeof window.CORE.saveCatalogPromotions,
      refs: typeof window.CONFIG.sizeCodeReferences === 'function'
        ? window.CONFIG.sizeCodeReferences('size_number', 'B') : null,
    }));
    check(`${et} · el artefacto ejecuta la autoridad de referencias`,
      api.autoridad === 'function' && api.gateway === 'function' && !!api.refs && api.refs.stock === 6,
      JSON.stringify(api.refs));
    check(`${et} · el adaptador de promociones es sólo de lectura`,
      api.registro === 'function' && api.escritura === 'undefined');
    check(`${et} · la pantalla carga sin errores`, errores.length === 0, errores[0] || '');
    await ctx.close();
  }

  // 1. Interruptor manual: bloqueado
  {
    const { ctx, page } = await abrir(destino);
    const antes = await huella(page);
    const ccAntes = await cc(page);
    await clic(page, '[data-testid="catalog-toggle-size_number-B"]');
    await page.waitForSelector('[data-testid="toast"]', { timeout: 5000 }).catch(() => {});
    const aviso = await page.textContent('[data-testid="toast"]').catch(() => '');
    const despues = await huella(page);
    check(`${et} · 1· el interruptor deja la talla ACTIVA`, (await activo(page, 'size_number', 'B')) === 'true');
    check(`${et} · 1· el aviso nombra código, etiqueta, piezas y productos`,
      /\(B\)/.test(aviso) && /42/.test(aviso) && /6 pieza/.test(aviso) && /1 producto/.test(aviso),
      JSON.stringify(aviso));
    check(`${et} · 1· no se emite configchange`, (await cc(page)) === ccAntes);
    check(`${et} · 1· no se persiste ningún cambio`, igualdad(antes, despues));
    await ctx.close();
  }

  // 2. Camino permitido: talla sin referencias
  {
    const { ctx, page } = await abrir(destino);
    const antes = await huella(page);
    const ccAntes = await cc(page);
    await clic(page, '[data-testid="catalog-toggle-size_number-X9"]');
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="catalog-row-size_number-X9"]').getAttribute('data-active') === 'false',
      null, { timeout: 5000 }).catch(() => {});
    const apagada = (await activo(page, 'size_number', 'X9')) === 'false';
    const medio = await huella(page);
    check(`${et} · 2· una talla sin referencias sí se desactiva`, apagada);
    check(`${et} · 2· el cambio se persiste y sólo toca la configuración`,
      sha(medio.__config) !== sha(antes.__config) && soloCambio(antes, medio, '__config')
      && (await cc(page)) > ccAntes);
    await clic(page, '[data-testid="catalog-toggle-size_number-X9"]');
    await page.waitForFunction(() =>
      document.querySelector('[data-testid="catalog-row-size_number-X9"]').getAttribute('data-active') === 'true',
      null, { timeout: 5000 }).catch(() => {});
    check(`${et} · 2· y vuelve a activarse (comportamiento en los dos sentidos)`,
      (await activo(page, 'size_number', 'X9')) === 'true');
    await ctx.close();
  }

  // 3. Importación con ACTIVO=NO
  {
    const { ctx, page } = await abrir(destino);
    const antes = await huella(page);
    const ccAntes = await cc(page);
    await importar(page, [
      ['size_number', hojaNumeroCompleta(f => f.map(r => r['CÓDIGO'] === 'B' ? { ...r, ACTIVO: 'NO' } : r))],
      ['size_letter', SIZE_LETTER.map(it => fila(it.code, it.label, true)).reverse()],
    ]);
    const diag = await page.getAttribute('[data-testid="catalog-import-diag"]', 'data-diag').catch(() => null);
    const texto = await page.textContent('[data-testid="catalog-import-diag"]').catch(() => '');
    check(`${et} · 3· sale el diagnóstico de tallas bloqueadas`, diag === 'blocked-sizes', String(diag));
    check(`${et} · 3· el diagnóstico explica cuál talla y con cuánto inventario`,
      /\(código B\)/.test(texto) && /ACTIVO = NO/.test(texto) && /6 pieza/.test(texto));
    check(`${et} · 3· la talla sigue activa`, (await activo(page, 'size_number', 'B')) === 'true');
    check(`${et} · 3· ninguna otra hoja se aplicó (atomicidad)`,
      (await page.evaluate(() => window.CONFIG.all('size_letter').map(i => i.code).join(','))) === 'CH,GR,B');
    check(`${et} · 3· no se emite configchange ni se persiste`,
      (await cc(page)) === ccAntes && igualdad(antes, await huella(page)));
    await ctx.close();
  }

  // 4. Importación por ausencia
  {
    const { ctx, page } = await abrir(destino);
    const antes = await huella(page);
    const ccAntes = await cc(page);
    await importar(page, [
      ['size_number', hojaNumeroCompleta(f => f.filter(r => r['CÓDIGO'] !== 'B'))],
      ['size_letter', SIZE_LETTER.map(it => fila(it.code, it.label, true)).reverse()],
    ]);
    const diag = await page.getAttribute('[data-testid="catalog-import-diag"]', 'data-diag').catch(() => null);
    const texto = await page.textContent('[data-testid="catalog-import-diag"]').catch(() => '');
    check(`${et} · 4· la ausencia del código también rechaza el archivo`, diag === 'blocked-sizes', String(diag));
    check(`${et} · 4· el diagnóstico distingue el motivo «no viene en el archivo»`,
      /no viene en el archivo/.test(texto));
    check(`${et} · 4· no queda ningún cambio parcial`,
      (await activo(page, 'size_number', 'B')) === 'true'
      && (await page.evaluate(() => window.CONFIG.all('size_letter').map(i => i.code).join(','))) === 'CH,GR,B'
      && (await cc(page)) === ccAntes && igualdad(antes, await huella(page)));
    await ctx.close();
  }

  // 5. Importación válida
  {
    const { ctx, page } = await abrir(destino);
    const antes = await huella(page);
    const ccAntes = await cc(page);
    await importar(page, [
      ['size_number', hojaNumeroCompleta(f => [f[2], ...f.slice(0, 2), ...f.slice(3)])], // B al frente
      ['size_letter', SIZE_LETTER.map(it => fila(it.code, it.label, true)).reverse()],
      ['category', [fila('21', 'Guayabera', true)]],
    ]);
    const orden = await page.evaluate(() => ({
      num: window.CONFIG.all('size_number').map(i => i.code).join(','),
      let: window.CONFIG.all('size_letter').map(i => i.code).join(','),
      cat: window.CONFIG.all('category').map(i => i.code + ':' + (i.active !== false)).join(','),
    }));
    check(`${et} · 5· el archivo válido se aplica completo`,
      orden.num === 'B,40,42,PZ,PR,X9' && orden.let === 'B,GR,CH', JSON.stringify(orden));
    check(`${et} · 5· los demás catálogos se importan igual que siempre`,
      /^21:true/.test(orden.cat), orden.cat.slice(0, 60));
    check(`${et} · 5· se emite una sola actualización`, (await cc(page)) === ccAntes + 1);
    check(`${et} · 5· el negocio no cambia: sólo la configuración`,
      soloCambio(antes, await huella(page), '__config'));
    await ctx.close();
  }

  // 6. size_letter: diferencia cero
  {
    const { ctx, page } = await abrir(destino);
    await clic(page, '[data-testid="catalog-toggle-size_letter-CH"]');
    await page.waitForTimeout(300);
    check(`${et} · 6· size_letter se desactiva aunque tenga existencias (sin cambio)`,
      (await activo(page, 'size_letter', 'CH')) === 'false');
    await clic(page, '[data-testid="catalog-toggle-size_letter-B"]');
    await page.waitForTimeout(300);
    check(`${et} · 6· el código B de Letra no hereda la protección del B de Número`,
      (await activo(page, 'size_letter', 'B')) === 'false'
      && (await activo(page, 'size_number', 'B')) === 'true');
    const refs = await page.evaluate(() => ({
      num: window.CONFIG.sizeCodeReferences('size_number', 'B'),
      let: window.CONFIG.sizeCodeReferences('size_letter', 'B'),
    }));
    check(`${et} · 6· un código con forma de letra en Número sigue siendo talla numérica`,
      refs.num.stock === 6 && refs.let.total === 0, JSON.stringify(refs));
    const ccAntes = await cc(page);
    await importar(page, [['size_letter', [fila('GR', 'GRANDE', true)]]]);
    check(`${et} · 6· la importación de size_letter conserva su desactivación implícita`,
      (await page.evaluate(() => window.CONFIG.all('size_letter').map(i => i.code + ':' + (i.active !== false)).join(',')))
        .includes('CH:false') && (await cc(page)) === ccAntes + 1);
    await ctx.close();
  }

  // 7. Promociones
  {
    const { ctx, page } = await abrir(destino);
    const antes = await huella(page);
    await clic(page, '[data-testid="catalog-toggle-size_number-PR"]');
    await page.waitForSelector('[data-testid="toast"]', { timeout: 5000 }).catch(() => {});
    const aviso = await page.textContent('[data-testid="toast"]').catch(() => '');
    check(`${et} · 7· una promoción vigente bloquea el retiro de la talla`,
      (await activo(page, 'size_number', 'PR')) === 'true' && /promoci/i.test(aviso), JSON.stringify(aviso));
    const promos = await page.evaluate(() => JSON.stringify(window.DATA.promos));
    check(`${et} · 7· consultar promociones no modifica ninguna promoción`,
      sha(promos) === sha(JSON.stringify(PROMOS)) && igualdad(antes, await huella(page)));
    await ctx.close();
  }
}

await bateria({ etiqueta: 'index.html', url: 'http://127.0.0.1:8893/index.html' });
await bateria({
  etiqueta: 'offline',
  url: 'file:///' + path.join(ROOT, 'POS Balam (offline).html').replace(/\\/g, '/'),
  offline: true,
});

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
