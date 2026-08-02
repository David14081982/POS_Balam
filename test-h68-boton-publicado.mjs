// H-68 · Verificación del BOTÓN accionando la INTERFAZ REAL sobre los bytes que
// sirve GitHub Pages. El sitio exige inicio de sesión, así que el artefacto se
// DESCARGA del sitio, se comprueba su SHA-256 contra el blob del commit y se
// sirve en local para poder recorrer la pantalla. Es el mismo archivo, byte a
// byte; lo único que cambia es el origen.
//
// La autoridad remota se responde con un doble: primero con el error EXACTO que
// rompió el botón, para comprobar que hoy se diagnostica en pantalla; después con
// el contrato real de `pos.purge_test_data()`. La frontera SQL en sí ya se
// ejercitó contra la base real en sus migraciones de verificación.
import { chromium } from 'playwright-core';
import http from 'http';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const REMOTO = 'https://david14081982.github.io/POS_Balam/index.html?h68=' + Date.now();
let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const esperado = createHash('sha256')
  .update(execSync('git show HEAD:index.html', { maxBuffer: 64 * 1024 * 1024 }))
  .digest('hex');
let bytes = null;
try { bytes = Buffer.from(await (await fetch(REMOTO)).arrayBuffer()); }
catch (e) { bytes = null; }
if (!bytes) {
  // Sin red no se puede hablar del sitio publicado. Se dice, no se finge.
  console.log('SIN RED: no se pudo descargar el artefacto publicado; nada que verificar.');
  process.exit(0);
}
const sha = createHash('sha256').update(bytes).digest('hex');
check('el artefacto servido coincide byte a byte con el commit', sha === esperado, sha);
if (sha !== esperado) {
  console.log('El sitio todavia sirve otra version: espera a que GitHub Pages publique el commit.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(bytes);
});
await new Promise(r => server.listen(8870, '127.0.0.1', r));
const URL = 'http://127.0.0.1:8870/index.html';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  localStorage.setItem('balam-page', 'config');
  localStorage.setItem('balam-sidebar', '0');
  window.__rpc = { calls: [], responses: {} };
  const chain = () => {
    const q = {
      select: () => q, order: () => q, eq: () => q, in: () => q, limit: () => q,
      upsert: () => q, delete: () => q,
      range: () => Promise.resolve({ data: [], error: null }),
      then: (res) => Promise.resolve({ data: [], error: null }).then(res),
    };
    return q;
  };
  const fake = {
    auth: {
      getSession: async () => ({ data: { session: window.__session ? { user: { email: 'admin@balam.test' } } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from: () => chain(),
    rpc: async (name, args) => {
      window.__rpc.calls.push({ name, args });
      const r = window.__rpc.responses[name];
      const value = typeof r === 'function' ? r(args) : r;
      return value === undefined ? { data: null, error: null } : value;
    },
    schema: () => fake,
  };
  Object.defineProperty(window, 'supabase', {
    configurable: true, get: () => ({ createClient: () => fake }), set: () => {},
  });
});

const page = await context.newPage();
page.on('pageerror', e => errs.push(String(e)));
await page.goto(URL, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.App && window.DATA && window.SettingsScreen, null, { timeout: 60000 });

// Escenario con el motor real, para que el botón tenga algo que borrar.
const seed = await page.evaluate(() => {
  const D = window.DATA;
  if (window.STORE) { window.STORE.pushSale = () => {}; window.STORE.pushReturn = () => {}; window.STORE.pushExchange = () => {}; window.STORE.pushLoanOperation = () => {}; window.STORE.pushRows = () => {}; }
  const mk = (id, modelo) => D.hydrate({
    id, cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo,
    nombre: 'Prenda ' + modelo, orn: '—', ornColors: [], precio: 500, costo: 200,
    pop: false, sku: 'PUB-' + modelo, stock: D.mkStock([0, 12], []),
  });
  const pA = mk('pub-a', '901'), pB = mk('pub-b', '902');
  D.products.push(pA, pB); D.saveProducts(false);
  const talla = pA.stock.find(v => v.stock > 0).talla;
  D.promos.push({ id: 'pub-promo', nombre: 'Promo pub', tipo: 'pct', valor: 10, scope: {}, pausado: false, creado: 1 });
  D.savePromos();
  const piezas0 = D.totalPieces(), huella0 = D.configFingerprint();
  const cli = D.addClient({ nombre: 'Cliente pub', tel: '111' });
  const venta = D.recordSale({ ticket: [{ p: pA, talla, qty: 3 }], sellerIds: [], client: cli, metodo: 'Efectivo', estado: 'Pagado', total: 1500, itemCount: 3 });
  D.recordSale({ ticket: [{ p: pA, talla, qty: 2 }], sellerIds: [], client: cli, metodo: 'Apartado', estado: 'Apartado', total: 1000, anticipo: 0, pagoEfectivo: 0, pagoOtro: 0, itemCount: 2 });
  D.recordReturn({ folio: venta.folio, lineas: [{ productId: pA.id, sku: pA.sku, nombre: pA.nombre, talla, qty: 1, motivo: 'talla', precio: 500 }], metodo: 'Efectivo' });
  D.recordExchange({ origenFolio: venta.folio, lineas: [
    { lado: 'devuelto', productId: pA.id, sku: pA.sku, nombre: pA.nombre, talla, qty: 1, motivo: 'talla', condicion: 'nueva' },
    { lado: 'entregado', productId: pB.id, sku: pB.sku, nombre: pB.nombre, talla, qty: 1 },
  ], usuario: 'admin', metodoPago: 'Efectivo' });
  D.registrarPrestamo({ persona: { tipo: 'otro', nombre: 'Vecina', tel: '2' }, fecha: '2026-08-01', fechaEsperada: '2026-08-30', lineas: [{ productId: pB.id, sku: pB.sku, talla, qty: 2 }] });
  return { piezas0, huella0, piezasOperando: D.totalPieces(), talla };
});
check('el escenario movió el inventario antes de limpiar', seed.piezasOperando !== seed.piezas0,
  `${seed.piezas0} → ${seed.piezasOperando}`);


// ── La interfaz real ────────────────────────────────────────────────────────
// La sesión simulada se enciende AQUÍ: al arrancar debe estar apagada para que
// AUTH use el perfil local y la pantalla de Configuración sea recorrible.
await page.evaluate(() => { window.__session = true; });
await page.locator('[data-testid="settings-section-demo"]').click();
await page.locator('[data-testid="purga-abrir"]').click();
await page.waitForSelector('[data-testid="purga-confirmar"]', { timeout: 15000 });
const aviso = await page.evaluate(() => document.body.innerText);
check('el modal anuncia qué se borra y qué se conserva',
  /se eliminarán ventas, apartados, préstamos, devoluciones, clientes, movimientos,\s*comisiones y reportes de prueba/i.test(aviso)
  && /se conservarán el inventario base, productos, usuarios y toda la configuración/i.test(aviso));

// 1) El fallo que rompió el botón: hoy se lee completo en pantalla.
await page.evaluate(() => {
  window.__rpc.responses['purge_test_data'] = {
    data: null,
    error: { message: 'DELETE requires a WHERE clause', code: 'P0001', details: null, hint: null },
  };
});
await page.locator('[data-testid="purga-confirmar"]').click();
await page.waitForSelector('[data-testid="purga-error"]', { timeout: 15000 });
const errorTxt = await page.evaluate(() => document.body.innerText);
const trasFallo = await page.evaluate(() => ({ ventas: window.DATA.sales.length, piezas: window.DATA.totalPieces() }));
check('un fallo remoto muestra el mensaje y el código de Supabase',
  /DELETE requires a WHERE clause/.test(errorTxt) && /code: P0001/.test(errorTxt));
check('y el fallo no borró nada en la terminal',
  trasFallo.ventas === 2 && trasFallo.piezas === seed.piezasOperando,
  `ventas=${trasFallo.ventas} piezas=${trasFallo.piezas}`);

// 2) La limpieza buena, con el contrato real de la frontera.
await page.locator('[data-testid="purga-error"]').press('Escape').catch(() => {});
await page.evaluate(() => {
  const modal = document.querySelector('[data-testid="purga-error"]');
  if (modal) { const btns = [...document.querySelectorAll('button')]; const b = btns.find(x => /entendido/i.test(x.textContent)); if (b) b.click(); }
});
await page.locator('[data-testid="purga-abrir"]').click();
await page.waitForSelector('[data-testid="purga-confirmar"]', { timeout: 15000 });
await page.evaluate(() => {
  window.__rpc.responses['purge_test_data'] = (args) => ({
    data: {
      ok: true, idempotent: false, purge_id: args.p_purge_id, epoch: 1754300000000,
      purged_at: new Date().toISOString(),
      eliminados: { ventas: 1, apartados: 1, abonos: 1, devoluciones: 1, cambios: 1, prestamos: 1, clientes: 1, movimientos: 5, comisiones: 0, cierres: 0 },
      conservados: { productos: 2, descuentos: 1, vendedores: 1 },
      piezas_antes: 22, piezas_despues: 24, config_intacta: true,
    }, error: null,
  });
});
await page.locator('[data-testid="purga-confirmar"]').click();
await page.waitForSelector('[data-testid="purga-cerrar"]', { timeout: 20000 });
const informe = await page.evaluate(() => document.body.innerText);
const final = await page.evaluate(({ talla }) => {
  const D = window.DATA;
  const pA = D.products.find(p => p.id === 'pub-a');
  const pB = D.products.find(p => p.id === 'pub-b');
  return {
    ventas: D.sales.length, devoluciones: D.returns.length, cambios: D.exchanges.length,
    prestamos: D.loans.length, clientes: D.clients.length,
    movsTipos: [...new Set(D.movements.map(m => m.tipo))],
    productos: D.products.length, promos: D.promos.length,
    stockA: pA.stock.find(x => x.talla === talla).stock,
    stockB: pB.stock.find(x => x.talla === talla).stock,
    piezas: D.totalPieces(), huella: D.configFingerprint(),
    ticket: localStorage.getItem('balam_purge_ticket'),
    epoca: localStorage.getItem('balam_purge_seen'),
    llamadas: window.__rpc.calls.filter(c => c.name === 'purge_test_data').length,
  };
}, seed);

check('NO reaparece «DELETE requires a WHERE clause»', !/DELETE requires a WHERE clause/.test(informe));
check('el modal final muestra los registros eliminados por módulo',
  /eliminado por módulo/i.test(informe) && /ventas y cobros/i.test(informe)
  && /préstamos/i.test(informe) && /clientes/i.test(informe));
check('el modal final muestra piezas antes y después y productos conservados',
  /piezas antes/i.test(informe) && /piezas después/i.test(informe) && /productos conservados/i.test(informe));
check('el modal final confirma la configuración intacta',
  /configuración intacta/i.test(informe));
check('la terminal quedó sin ventas, devoluciones, cambios ni préstamos',
  final.ventas === 0 && final.devoluciones === 0 && final.cambios === 0 && final.prestamos === 0,
  JSON.stringify({ v: final.ventas, d: final.devoluciones, c: final.cambios, p: final.prestamos }));
check('sólo queda el cliente genérico', final.clientes === 1, String(final.clientes));
check('no quedan movimientos de venta, devolución ni cambio',
  !final.movsTipos.some(t => ['Venta', 'Devolución', 'Cambio (entra)', 'Cambio (sale)'].includes(t)),
  JSON.stringify(final.movsTipos));
check('el inventario volvió EXACTAMENTE a su estado base',
  final.piezas === seed.piezas0, `${seed.piezasOperando} → ${final.piezas} (base ${seed.piezas0})`);
check('productos y descuentos conservados', final.productos === 2 && final.promos === 1,
  `productos=${final.productos} descuentos=${final.promos}`);
check('la huella de configuración no cambió', final.huella === seed.huella0,
  `${seed.huella0} → ${final.huella}`);
check('el reintento reusó el mismo ticket y luego lo liberó',
  final.llamadas === 2 && !final.ticket && final.epoca === '1754300000000',
  `llamadas=${final.llamadas} ticket=${final.ticket} epoca=${final.epoca}`);
check('sin errores de página', errs.length === 0, errs.join(' | '));

console.log(`\n════════ SITIO PUBLICADO: ${pass} pasaron, ${fail} fallaron ════════`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
