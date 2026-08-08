// test-smoke.mjs — Humo e2e en Chrome real: bootea la app, verifica cero errores de página
// y recorre inventario → formulario de producto → migración de fotos (nube SIMULADA) →
// fusión de ventas (mergeRemote real). Las peticiones a *.supabase.co se BLOQUEAN:
// nunca toca datos reales.
// Uso:  node test-smoke.mjs          → archivo de desarrollo (POS Balam.html, Babel runtime)
//       node test-smoke.mjs bundle   → bundle de deploy (index.html, precompilado)
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const BUNDLE = process.argv[2] === 'bundle';
const ENTRY = BUNDLE ? 'index.html' : 'POS Balam.html';
const ROOT = path.resolve('.');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/' + ENTRY;
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8803, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [], supabaseRequests = [];
const check = (name, cond, extra = '') => { console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' · ' + extra : ''}`); cond ? pass++ : fail++; };

let b = null;
try {
b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage();
page.on('pageerror', e => errs.push(String(e)));
await page.route(/supabase\.co/, route => {
  supabaseRequests.push(route.request().url());
  return route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Supabase simulado por test-smoke' }),
  });
}); // jaula: responde localmente; cero tráfico a la nube real

// Siembra: 1 producto con foto INCRUSTADA (formato viejo) antes de que cargue la app.
// Debe ser una imagen válida: un fixture truncado dispara el overlay de errores
// de recursos del bundle y convierte el recorrido en un falso negativo.
const FAKE_IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
await page.addInitScript((img) => {
  const prod = { id: 'mig-test-1', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR',
    modelo: '900', nombre: 'Prueba Migración', orn: '—', ornColors: [], precio: 500, costo: 200,
    pop: false, stock: [], sku: 'MIG-TEST-900', imagen: img };
  localStorage.setItem('balam_pos_products_v2', JSON.stringify([prod]));
}, FAKE_IMG);

const t0 = Date.now();
await page.goto('http://127.0.0.1:8803/' + encodeURIComponent(ENTRY), { waitUntil: 'load' });
// El bundle registra también errores genéricos de recursos en su panel. El
// smoke conserva el panel visible para diagnóstico, pero evita que esa capa
// auxiliar bloquee los controles; las excepciones JS reales siguen en errs.
await page.addStyleTag({ content: '#__bundler_err { pointer-events: none !important; }' });
await page.waitForFunction(() => window.App && window.DATA && window.SettingsScreen && window.InventoryScreen
  && window.STORE && window.STORE.uploadProductPhoto && window.STORE.fetchSaleByFolio, null, { timeout: 30000 });
const cageStatus = await page.evaluate(async () => (
  await fetch('https://smoke-test.supabase.co/rest/v1/probe')
).status);
check(`1. la app bootea (${BUNDLE ? 'bundle precompilado' : 'dev con Babel'})`, true, (Date.now() - t0) + ' ms');
if (BUNDLE) {
  check('1b. Babel NO está en runtime (precompilado)', await page.evaluate(() => !window.Babel));
  check('1c. React en modo producción', await page.evaluate(() => !document.querySelector('script[src*=development]')));
}
check('2. sin errores de página al arrancar', errs.length === 0, errs.join(' | ').slice(0, 200));

// Neutraliza sync + simula sesión y nube de Storage DENTRO de la página.
await page.evaluate(() => {
  window.STORE.pushRows = () => {}; window.STORE.pushSale = () => {}; window.STORE.pushConfig = () => {};
  window.STORE.hasSession = async () => true;
  window.__uploads = [];
  window.STORE.uploadProductPhoto = async (p) => { window.__uploads.push(p); return 'https://cdn.fake/product-photos/' + p; };
});

// ── mergeRemote (motor real): la fusión conserva el histórico local ──
const mg = await page.evaluate(() => {
  const D = window.DATA;
  D.sales.length = 0;
  D.sales.push({ folio: 'BG-OLD', fecha: '2024-01-01 10:00', estado: 'Pagado', total: 100, items: 1, lineas: [] });
  D.sales.push({ folio: 'BG-NEW', fecha: '2026-07-01 10:00', estado: 'Apartado', total: 200, items: 1, lineas: [] });
  // pull parcial simulado: actualiza BG-NEW (ahora Pagado) y agrega BG-XTRA; BG-OLD NO viene.
  D.mergeRemote('sales', [
    { folio: 'BG-NEW', fecha: '2026-07-01 10:00', estado: 'Pagado', total: 200, items: 1, lineas: [] },
    { folio: 'BG-XTRA', fecha: '2026-07-02 09:00', estado: 'Pagado', total: 300, items: 1, lineas: [] },
  ], 'folio');
  return { n: D.sales.length, old: !!D.sales.find(s => s.folio === 'BG-OLD'),
    updated: (D.sales.find(s => s.folio === 'BG-NEW') || {}).estado, first: D.sales[0].folio };
});
check('3. mergeRemote conserva el histórico no incluido en el pull', mg.n === 3 && mg.old === true);
check('4. mergeRemote actualiza la fila que sí vino (nube gana)', mg.updated === 'Pagado');
check('5. queda ordenado por fecha desc', mg.first === 'BG-XTRA');

// ── Pantalla Inventario: tabla y formulario de producto ──
await page.getByRole('button', { name: 'Inventario' }).first().click();
await page.waitForSelector('text=Prueba Migración', { timeout: 10000 });
check('6. Inventario lista el producto sembrado', true);
await page.getByRole('button', { name: /Nuevo producto/i }).click();
await page.getByTestId('product-form').waitFor({ timeout: 10000 });
check('7. el formulario de producto abre y renderiza', true);
await page.getByRole('button', { name: 'Cancelar' }).click();

// ── Configuración → Inventario: migración de fotos a Storage ──
await page.getByRole('button', { name: 'Configuración' }).click();
await page.getByRole('button', { name: /^Inventario$/ }).last().click();
await page.waitForSelector('text=Fotos de producto', { timeout: 10000 });
const cardTxt = await page.locator('text=formato antiguo').textContent().catch(() => '');
check('8. la tarjeta detecta la foto incrustada', /Quedan 1 en formato antiguo/.test(cardTxt || ''));
await page.getByRole('button', { name: /Subir ahora \(1\)/ }).click();
await page.waitForSelector('text=ya viven en la nube', { timeout: 15000 });
const after = await page.evaluate(() => ({
  imagen: window.DATA.products.find(p => p.id === 'mig-test-1').imagen,
  saved: JSON.parse(localStorage.getItem('balam_pos_products_v2'))[0].imagen,
  uploads: window.__uploads,
}));
check('9. la foto migró a URL y quedó persistida', after.imagen === 'https://cdn.fake/product-photos/prod-mig-test-1.jpg' && after.saved === after.imagen);
check('10. subida única con ruta idempotente', after.uploads.length === 1 && after.uploads[0] === 'prod-mig-test-1.jpg');

// ── Devoluciones: botón de búsqueda en la nube para folios fuera de ventana ──
await page.getByRole('button', { name: 'Devoluciones' }).first().click();
await page.waitForSelector('text=Selecciona la venta a devolver', { timeout: 10000 });
await page.locator('input[placeholder*="folio"]').fill('BG-VIEJO-999');
await page.waitForSelector('text=Buscar folio en el histórico', { timeout: 10000 });
check('11. folio no local ofrece búsqueda en la nube', true);
await page.evaluate(() => {
  window.STORE.fetchSaleByFolio = async (f) => {
    const s = { folio: 'BG-VIEJO-999', fecha: '2023-05-05 12:00', cliente: 'Cliente Antiguo', vendedor: '', vendedores: [], items: 1, total: 700, metodo: 'Efectivo', estado: 'Pagado', lineas: [{ sku: 'S', nombre: 'P', talla: 'M', qty: 1, precio: 700 }] };
    window.DATA.mergeRemote('sales', [s], 'folio');
    return window.DATA.sales.find(x => x.folio === s.folio);
  };
});
await page.getByRole('button', { name: /Buscar folio en el histórico/ }).click();
await page.waitForSelector('text=Cliente Antiguo', { timeout: 10000 });
check('12. la venta recuperada de la nube aparece lista para devolver', true);

check('13. cero errores de página en todo el recorrido', errs.length === 0, errs.join(' | ').slice(0, 200));
const overlayText = await page.locator('#__bundler_err').textContent().catch(() => '');
const overlayPointerEvents = await page.locator('#__bundler_err').evaluate(
  el => getComputedStyle(el).pointerEvents
).catch(() => 'none');
check('14. el panel diagnóstico no bloquea la interacción', overlayPointerEvents === 'none',
  (overlayText || 'sin panel').slice(0, 200));
check('15. Supabase quedó confinado a respuestas locales simuladas',
  cageStatus === 401 && supabaseRequests.length >= 1,
  `${supabaseRequests.length} solicitud(es) interceptada(s)`);

} catch (e) {
  fail++;
  console.error('❌ smoke interrumpido:', e && e.stack ? e.stack : e);
} finally {
  if (b) await b.close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
}
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
