// H-68 — Borrar datos de prueba: qué se elimina, qué se conserva, cómo vuelve el
// inventario y por qué nada de lo borrado puede reaparecer desde otra terminal.
//
// Ejercita el artefacto REALMENTE distribuido (index.html). La autoridad remota
// —pos.purge_test_data()— se prueba contra la base en su propia migración de
// verificación; aquí se prueba la frontera del cliente: la reversión por
// identidad, la invalidación selectiva de la cola y que un fallo remoto no
// borre nada localmente.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve('c:/Users/david/Downloads/POS BALAM');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
// Artefacto del commit ANTERIOR: la reproducción del defecto corre sobre el
// paquete que el dueño tenía instalado, no sobre una copia del código a mano.
let previo = null;
try { previo = execSync('git show HEAD:index.html', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }); }
catch (e) { previo = null; }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  if (p === '/antes.html') {
    if (!previo) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(previo); return;
  }
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8868, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext();

// Cliente de Supabase simulado: la autoridad remota responde lo que cada caso
// necesita. Se instala con una trampa sobre window.supabase para que dé igual
// en qué momento el bundle pida el cliente.
await context.addInitScript(() => {
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
      getSession: async () => ({ data: { session: window.__session === false ? null : { user: { email: 'admin@balam.test' } } } }),
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
    configurable: true,
    get: () => ({ createClient: () => fake }),
    set: () => {},
  });
});

const page = await context.newPage();
page.on('pageerror', e => errs.push(String(e)));
await page.route(/supabase\.co/, r => r.abort());
await page.goto('http://127.0.0.1:8868/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.DATA.resetTestData && window.STORE && window.CONFIG,
  null, { timeout: 30000 });

// ── Escenario: se construye con el MOTOR REAL, nada se inventa ───────────────
const seed = await page.evaluate(() => {
  const D = window.DATA;
  const out = {};
  if (window.STORE) {
    window.STORE.pushSale = () => {}; window.STORE.pushReturn = () => {};
    window.STORE.pushExchange = () => {}; window.STORE.pushLoanOperation = () => {};
    window.STORE.pushRows = () => {}; window.STORE.settleCommission = () => {};
  }
  // SKU explícito y DISTINTO por producto: la receta configurable no incluye el
  // modelo, así que dos artículos con los mismos atributos comparten SKU y el
  // escenario dejaría de distinguirlos (la identidad ambigua se prueba aparte).
  const mk = (id, modelo, letras) => D.hydrate({
    id, cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo,
    nombre: 'Prenda ' + modelo, orn: '—', ornColors: [], precio: 500, costo: 200,
    pop: false, sku: 'H68-SKU-' + modelo, stock: D.mkStock(letras, []),
  });
  // Dos productos: uno para ventas/devoluciones/cambios y otro para el lado
  // «entregado» del cambio y el préstamo.
  const pA = mk('h68-a', '801', [0, 20]);
  const pB = mk('h68-b', '802', [0, 20]);
  D.products.push(pA, pB); D.saveProducts();
  const talla = pA.stock.find(v => v.stock > 0).talla;
  out.talla = talla;

  const vendedor = {
    id: 'h68-seller', nombre: 'Vendedor H68', iniciales: 'VH', color: '#333',
    comisionPct: 8, metaMes: 40000, ventasMes: 0, ventasNum: 0, comisionAcum: 0,
    bono: 'Sin bono', role: 'vendedor', email: 'v68@balam.test',
    passwordHash: 'HASH-H68-NO-BORRAR', active: true,
  };
  D.sellers.push(vendedor); D.saveSellers();
  D.promos.push({ id: 'h68-promo', nombre: 'Promo H68', tipo: 'pct', valor: 10, scope: {}, pausado: false, creado: Date.now() });
  D.savePromos();
  D.movements.unshift({ fecha: '2026-08-01 09:00', tipo: 'Entrada', producto: pA.nombre, productId: pA.id, sku: pA.sku, talla, cant: 20, ref: 'carga inicial' });
  D.saveMovements();

  out.stockInicialA = pA.stock.find(v => v.talla === talla).stock;
  out.stockInicialB = pB.stock.find(v => v.talla === talla).stock;
  out.huellaInicial = D.configFingerprint();
  out.piezasInicial = D.totalPieces();
  return out;
});

// 1) Venta cobrada · 2) Apartado · 3) Apartado liquidado · 4) Devolución
//    5) Cambio · 6) Préstamo — cada uno por su autoridad real.
const tras = await page.evaluate(({ talla }) => {
  const D = window.DATA;
  const pA = D.products.find(p => p.id === 'h68-a');
  const pB = D.products.find(p => p.id === 'h68-b');
  const cli = D.addClient({ nombre: 'Cliente H68', tel: '9999' });
  const out = {};

  // Venta cobrada de 4 piezas (descuenta).
  const venta = D.recordSale({ ticket: [{ p: pA, talla, qty: 4 }], sellerIds: ['h68-seller'], client: cli, metodo: 'Efectivo', estado: 'Pagado', total: 2000, itemCount: 4 });
  out.trasVenta = pA.stock.find(v => v.talla === talla).stock;

  // Apartado de 3 piezas: NUNCA descuenta.
  const apartado = D.recordSale({ ticket: [{ p: pA, talla, qty: 3 }], sellerIds: ['h68-seller'], client: cli, metodo: 'Apartado', estado: 'Apartado', total: 1500, anticipo: 0, pagoEfectivo: 0, pagoOtro: 0, itemCount: 3 });
  out.trasApartado = pA.stock.find(v => v.talla === talla).stock;

  // Apartado YA LIQUIDADO: es una venta cobrada con abonos. Descontó UNA vez.
  const liquidado = D.recordSale({ ticket: [{ p: pA, talla, qty: 2 }], sellerIds: ['h68-seller'], client: cli, metodo: 'Efectivo', estado: 'Pagado', total: 1000, itemCount: 2 });
  D.payments.unshift({ id: 'h68-abono-1', folio: liquidado.folio, fecha: '2026-08-01 10:00', tipo: 'abono', metodo: 'Efectivo', monto: 400, efectivo: 400, tarjeta: 0, transferencia: 0, otro: 0 });
  D.payments.unshift({ id: 'h68-abono-2', folio: liquidado.folio, fecha: '2026-08-01 11:00', tipo: 'liquidacion', metodo: 'Efectivo', monto: 600, efectivo: 600, tarjeta: 0, transferencia: 0, otro: 0 });
  D.savePayments(false);
  out.trasLiquidado = pA.stock.find(v => v.talla === talla).stock;

  // Devolución de 1 pieza de la venta (reingresa).
  const dev = D.recordReturn({ folio: venta.folio, lineas: [{ productId: pA.id, sku: pA.sku, nombre: pA.nombre, talla, qty: 1, motivo: 'talla', precio: 500 }], metodo: 'Efectivo' });
  out.devolucionOk = !!(dev && dev.ok);
  out.trasDevolucion = pA.stock.find(v => v.talla === talla).stock;

  // Cambio: entra 1 de A (devuelto) y sale 1 de B (entregado).
  const cam = D.recordExchange({
    origenFolio: venta.folio,
    lineas: [
      { lado: 'devuelto', productId: pA.id, sku: pA.sku, nombre: pA.nombre, talla, qty: 1, motivo: 'talla', condicion: 'nueva' },
      { lado: 'entregado', productId: pB.id, sku: pB.sku, nombre: pB.nombre, talla, qty: 1 },
    ],
    usuario: 'admin', vendedorId: 'h68-seller', metodoPago: 'Efectivo',
  });
  out.cambioOk = !!(cam && cam.ok);
  out.cambioError = cam && cam.error;
  out.trasCambioA = pA.stock.find(v => v.talla === talla).stock;
  out.trasCambioB = pB.stock.find(v => v.talla === talla).stock;

  // Préstamo: NO mueve existencias, pero es dato operativo.
  const pres = D.registrarPrestamo({ persona: { tipo: 'otro', nombre: 'Tienda vecina', tel: '5555' }, fecha: '2026-08-01', fechaEsperada: '2026-08-30', lineas: [{ productId: pB.id, sku: pB.sku, talla, qty: 2 }] });
  out.prestamoOk = !!(pres && pres.ok);
  out.prestamoError = (pres && pres.error) || null;
  out.trasPrestamoB = pB.stock.find(v => v.talla === talla).stock;

  // Comisión liquidada + cierre de periodo simulados (datos operativos).
  D.liquidations.push({ id: 'h68-liq', sellerId: 'h68-seller', seller: 'Vendedor H68', monto: 120, tipo: 'liquidacion', fecha: '2026-08-01 12:00' });
  D.liquidations.push({ id: 'h68-cut', sellerId: 'h68-seller', seller: 'Vendedor H68', monto: 300, tipo: 'corte', fecha: '2026-08-01 12:30' });

  const v = D.sellers.find(s => s.id === 'h68-seller');
  out.vendedorAntes = { ventasMes: v.ventasMes, ventasNum: v.ventasNum, comisionAcum: v.comisionAcum };
  out.huella = D.configFingerprint();
  out.resumen = D.testDataFootprint();
  out.folios = { venta: venta.folio, apartado: apartado.folio, liquidado: liquidado.folio };
  return out;
}, seed);

check('la venta cobrada descontó existencias', tras.trasVenta === seed.stockInicialA - 4, `${seed.stockInicialA}→${tras.trasVenta}`);
check('el apartado NO descontó existencias', tras.trasApartado === tras.trasVenta, `${tras.trasVenta}→${tras.trasApartado}`);
check('el apartado liquidado descontó una vez', tras.trasLiquidado === tras.trasApartado - 2, String(tras.trasLiquidado));
check('la devolución reingresó su pieza', tras.devolucionOk && tras.trasDevolucion === tras.trasLiquidado + 1, String(tras.trasDevolucion));
check('el cambio movió inventario en los dos sentidos',
  tras.cambioOk && tras.trasCambioA === tras.trasDevolucion + 1 && tras.trasCambioB === seed.stockInicialB - 1,
  `A=${tras.trasCambioA} B=${tras.trasCambioB} err=${tras.cambioError || '-'}`);
check('el préstamo no movió existencias', tras.prestamoOk && tras.trasPrestamoB === tras.trasCambioB,
  `${tras.trasPrestamoB} err=${tras.prestamoError || '-'}`);
check('la configuración no cambió al operar', tras.huella === seed.huellaInicial);
check('el resumen previo cuenta ventas, apartados, cambios y préstamos',
  tras.resumen.ventas === 2 && tras.resumen.apartados === 1 && tras.resumen.cambios === 1
  && tras.resumen.prestamos === 1 && tras.resumen.devoluciones === 1,
  JSON.stringify({ v: tras.resumen.ventas, a: tras.resumen.apartados, c: tras.resumen.cambios, p: tras.resumen.prestamos, d: tras.resumen.devoluciones }));
check('el resumen no está bloqueado ni tiene identidad ambigua',
  !tras.resumen.bloqueado && tras.resumen.identidadAmbigua.length === 0, String(tras.resumen.bloqueado));

// ── Un fallo remoto no borra NADA local ─────────────────────────────────────
const falla = await page.evaluate(async () => {
  const D = window.DATA;
  window.__rpc.responses['purge_test_data'] = { data: null, error: { message: 'timeout de red', code: '500' } };
  const antes = { ventas: D.sales.length, piezas: D.totalPieces(), huella: D.configFingerprint(), clientes: D.clients.length };
  const r = await window.STORE.purgeTestData();
  return {
    r, antes,
    despues: { ventas: D.sales.length, piezas: D.totalPieces(), huella: D.configFingerprint(), clientes: D.clients.length },
  };
});
check('un fallo de la autoridad remota no borra nada', falla.r.ok === false
  && falla.despues.ventas === falla.antes.ventas
  && falla.despues.piezas === falla.antes.piezas
  && falla.despues.clientes === falla.antes.clientes
  && falla.despues.huella === falla.antes.huella,
  JSON.stringify(falla.despues));

// ── Cola de sincronización: invalidación SELECTIVA ──────────────────────────
const cola = await page.evaluate(() => {
  const corte = '2026-08-02T12:00:00.000Z';
  const antes = '2026-08-02T10:00:00.000Z';
  const despues = '2026-08-02T14:00:00.000Z';
  const q = [
    { id: 'q1', type: 'sale', folio: 'A-1', createdAt: antes, ownerId: null },
    { id: 'q2', type: 'return', folio: 'A-1', createdAt: antes, ownerId: null },
    { id: 'q3', type: 'exchange', createdAt: antes, ownerId: null },
    { id: 'q4', type: 'loanOperation', createdAt: antes, ownerId: null },
    { id: 'q5', type: 'commissionSettle', createdAt: antes, ownerId: null },
    { id: 'q6', type: 'upsert', kind: 'clients', table: 'clients', rows: [], createdAt: antes, ownerId: null },
    { id: 'q7', type: 'upsert', kind: 'products', table: 'products', rows: [], createdAt: antes, ownerId: null },
    { id: 'q8', type: 'upsert', kind: 'liquidations', table: 'liquidations', rows: [], createdAt: antes, ownerId: null },
    { id: 'q9', type: 'config', createdAt: antes, ownerId: null },
    { id: 'q10', type: 'softDelete', kind: 'products', table: 'products', val: 'x', createdAt: antes, ownerId: null },
    { id: 'q11', type: 'sale', folio: 'B-1', createdAt: despues, ownerId: null },
  ];
  localStorage.setItem('balam_sync_queue', JSON.stringify(q));
  const r = window.STORE.pruneQueueForPurge(corte);
  const left = JSON.parse(localStorage.getItem('balam_sync_queue') || '[]').map(o => o.id);
  return { r, left };
});
check('descarta ventas, devoluciones, cambios, préstamos y comisiones pendientes',
  ['q1', 'q2', 'q3', 'q4', 'q5'].every(id => !cola.left.includes(id)), JSON.stringify(cola.left));
check('descarta las cargas masivas de datos borrados (clientes, liquidaciones)',
  !cola.left.includes('q6') && !cola.left.includes('q8'));
check('CONSERVA la configuración y las bajas de catálogo pendientes',
  cola.left.includes('q9') && cola.left.includes('q10'), JSON.stringify(cola.left));
check('CONSERVA lo capturado DESPUÉS de la limpieza', cola.left.includes('q11'));
check('reconstruye productos, vendedores y clientes en vez de perderlos',
  cola.r.rebuild.includes('products') && cola.r.rebuild.includes('clients'), JSON.stringify(cola.r.rebuild));

// ── La limpieza con autoridad remota ────────────────────────────────────────
const purga = await page.evaluate(async ({ talla }) => {
  const D = window.DATA;
  localStorage.removeItem('balam_sync_queue');
  window.__rpc.responses['purge_test_data'] = (args) => ({
    data: {
      ok: true, idempotent: false, purge_id: args.p_purge_id, epoch: 1754140800000,
      purged_at: new Date().toISOString(),
      eliminados: { ventas: 2, apartados: 1, abonos: 3, devoluciones: 1, cambios: 1, prestamos: 1, clientes: 1, movimientos: 8, comisiones: 1, cierres: 1 },
      conservados: { productos: 2, descuentos: 1, vendedores: 2 },
      piezas_antes: 0, piezas_despues: 0, config_intacta: true,
    },
    error: null,
  });
  const antes = {
    piezas: D.totalPieces(), huella: D.configFingerprint(),
    vendedor: JSON.parse(JSON.stringify(D.sellers.find(s => s.id === 'h68-seller'))),
    productos: D.products.map(p => ({ id: p.id, sku: p.sku, precio: p.precio, costo: p.costo, nombre: p.nombre, tallas: p.stock.map(v => v.talla + '/' + v.escala).join('|') })),
    promos: JSON.parse(JSON.stringify(D.promos)),
  };
  const r = await window.STORE.purgeTestData();
  const pA = D.products.find(p => p.id === 'h68-a');
  const pB = D.products.find(p => p.id === 'h68-b');
  const v = D.sellers.find(s => s.id === 'h68-seller');
  return {
    r, antes,
    despues: {
      sales: D.sales.length, returns: D.returns.length, exchanges: D.exchanges.length,
      payments: D.payments.length, loans: D.loans.length, liquidations: D.liquidations.length,
      clients: D.clients.length, soloGenerico: D.clients.every(c => c.generic),
      movsTipos: [...new Set(D.movements.map(m => m.tipo))],
      productos: D.products.length, promos: JSON.parse(JSON.stringify(D.promos)),
      stockA: pA.stock.find(x => x.talla === talla).stock,
      stockB: pB.stock.find(x => x.talla === talla).stock,
      piezas: D.totalPieces(), huella: D.configFingerprint(),
      vendedor: JSON.parse(JSON.stringify(v)),
      epoca: localStorage.getItem('balam_purge_seen'),
      ticket: localStorage.getItem('balam_purge_ticket'),
      productosDetalle: D.products.map(p => ({ id: p.id, sku: p.sku, precio: p.precio, costo: p.costo, nombre: p.nombre, tallas: p.stock.map(x => x.talla + '/' + x.escala).join('|') })),
    },
  };
}, seed).catch(e => ({ error: String(e) }));

if (purga.error) { check('la limpieza remota se ejecutó', false, purga.error); }

const d = purga.despues || {};
check('BORRA ventas, apartados y sus cobros', d.sales === 0 && d.payments === 0, `ventas=${d.sales} pagos=${d.payments}`);
check('BORRA devoluciones y cambios', d.returns === 0 && d.exchanges === 0, `dev=${d.returns} cam=${d.exchanges}`);
check('BORRA préstamos', d.loans === 0, String(d.loans));
check('BORRA comisiones y cierres', d.liquidations === 0, String(d.liquidations));
check('BORRA los clientes de prueba y deja el genérico', d.clients === 1 && d.soloGenerico, String(d.clients));
check('BORRA los movimientos de venta, devolución y cambio',
  !!d.movsTipos && !d.movsTipos.some(t => ['Venta', 'Devolución', 'Cambio (entra)', 'Cambio (sale)'].includes(t)),
  JSON.stringify(d.movsTipos));
check('CONSERVA el movimiento de inventario', !!d.movsTipos && d.movsTipos.includes('Entrada'), JSON.stringify(d.movsTipos));
check('RESTAURA las existencias al valor previo a las pruebas',
  d.stockA === seed.stockInicialA && d.stockB === seed.stockInicialB,
  `A=${d.stockA}/${seed.stockInicialA} B=${d.stockB}/${seed.stockInicialB}`);
check('el total de piezas vuelve al inicial', d.piezas === seed.piezasInicial, `${d.piezas} vs ${seed.piezasInicial}`);
check('CONSERVA los productos idénticos', d.productos === 2
  && JSON.stringify(d.productosDetalle) === JSON.stringify(purga.antes.productos),
  JSON.stringify(d.productosDetalle));
check('CONSERVA las reglas de descuento intactas',
  JSON.stringify(d.promos) === JSON.stringify(purga.antes.promos), JSON.stringify(d.promos));
check('CONSERVA al vendedor con su contraseña, % y meta',
  d.vendedor && d.vendedor.passwordHash === 'HASH-H68-NO-BORRAR' && d.vendedor.comisionPct === 8 && d.vendedor.metaMes === 40000,
  JSON.stringify(d.vendedor && { p: d.vendedor.passwordHash, c: d.vendedor.comisionPct, m: d.vendedor.metaMes }));
check('pone en cero ventas y comisiones del vendedor',
  d.vendedor && d.vendedor.ventasMes === 0 && d.vendedor.ventasNum === 0 && d.vendedor.comisionAcum === 0,
  JSON.stringify(d.vendedor && { vm: d.vendedor.ventasMes, vn: d.vendedor.ventasNum, ca: d.vendedor.comisionAcum }));
check('la huella de CONFIGURACIÓN es idéntica antes y después',
  d.huella === purga.antes.huella && d.huella === seed.huellaInicial,
  `${purga.antes.huella} → ${d.huella}`);
check('el informe declara la configuración intacta',
  !!(purga.r && purga.r.local && purga.r.local.configIntacta === true));
check('registra la época aplicada y suelta el ticket',
  d.epoca === '1754140800000' && !d.ticket, `epoca=${d.epoca} ticket=${d.ticket}`);
check('el informe trae el desglose por módulo',
  !!(purga.r && purga.r.remoto && purga.r.remoto.eliminados && purga.r.remoto.eliminados.ventas === 2));

// ── Idempotencia: la segunda ejecución no vuelve a mover existencias ────────
const segunda = await page.evaluate(async () => {
  const D = window.DATA;
  const antes = D.totalPieces();
  const huella = D.configFingerprint();
  const r = await window.STORE.purgeTestData();
  return { r, antes, despues: D.totalPieces(), huella, huellaDespues: D.configFingerprint() };
});
check('SEGUNDA ejecución: no vuelve a sumar ni restar existencias',
  segunda.despues === segunda.antes && segunda.huellaDespues === segunda.huella,
  `${segunda.antes} → ${segunda.despues}`);

// ── Limpieza propagada: una terminal que estuvo apagada ─────────────────────
// Vuelve a haber datos locales de prueba y una cola con operaciones suyas; la
// terminal enciende, lee la época y se limpia sola ANTES de subir nada.
const propagada = await page.evaluate(async ({ talla }) => {
  const D = window.DATA;
  localStorage.removeItem('balam_purge_seen');
  const pA = D.products.find(p => p.id === 'h68-a');
  const stock0 = pA.stock.find(v => v.talla === talla).stock;
  const cli = D.addClient({ nombre: 'Cliente apagado', tel: '1212' });
  D.recordSale({ ticket: [{ p: pA, talla, qty: 5 }], sellerIds: ['h68-seller'], client: cli, metodo: 'Efectivo', estado: 'Pagado', total: 2500, itemCount: 5 });
  const trasVenta = pA.stock.find(v => v.talla === talla).stock;
  localStorage.setItem('balam_sync_queue', JSON.stringify([
    { id: 'off-1', type: 'sale', folio: 'OFF-1', createdAt: '2026-08-02T09:00:00.000Z', ownerId: null },
    { id: 'off-2', type: 'config', createdAt: '2026-08-02T09:00:00.000Z', ownerId: null },
  ]));
  window.__rpc.responses['test_data_purge_state'] = {
    data: { purge_id: 'p-2', epoch: 1754227200000, purged_at: '2026-08-03T12:00:00.000Z' },
    error: null,
  };
  const r = await window.STORE.applyRemotePurge();
  const q = JSON.parse(localStorage.getItem('balam_sync_queue') || '[]').map(o => o.id);
  return {
    aplicada: !!r, stock0, trasVenta,
    stockFinal: pA.stock.find(v => v.talla === talla).stock,
    ventas: D.sales.length, clientes: D.clients.length,
    cola: q, epoca: localStorage.getItem('balam_purge_seen'),
  };
}, seed);
check('la terminal apagada aplica la limpieza al encender', propagada.aplicada && propagada.ventas === 0,
  `ventas=${propagada.ventas}`);
check('y restaura SUS existencias', propagada.stockFinal === propagada.stock0,
  `${propagada.trasVenta} → ${propagada.stockFinal} (esperado ${propagada.stock0})`);
check('invalida su venta pendiente y conserva su configuración pendiente',
  !propagada.cola.includes('off-1') && propagada.cola.includes('off-2'), JSON.stringify(propagada.cola));
check('deja la época registrada para no repetirla', propagada.epoca === '1754227200000', String(propagada.epoca));

const repetida = await page.evaluate(async () => {
  const D = window.DATA;
  const antes = D.totalPieces();
  const r = await window.STORE.applyRemotePurge();
  return { repitio: !!r, antes, despues: D.totalPieces() };
});
check('la misma época no se aplica dos veces', !repetida.repitio && repetida.despues === repetida.antes,
  `${repetida.antes} → ${repetida.despues}`);

// ── Identidad: la restauración usa productId, no la etiqueta visible ────────
const identidad = await page.evaluate(({ talla }) => {
  const D = window.DATA;
  const pA = D.products.find(p => p.id === 'h68-a');
  const antes = pA.stock.find(v => v.talla === talla).stock;
  // Dos productos con el MISMO SKU y un renglón sin productId: la limpieza no
  // puede adivinar a cuál devolver la pieza y se detiene antes de tocar nada.
  const clon = D.hydrate({ id: 'h68-clon', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo: '801', nombre: 'Clon', orn: '—', ornColors: [], precio: 500, costo: 200, pop: false, stock: D.mkStock([0, 5], []) });
  clon.sku = pA.sku;
  D.products.push(clon); D.saveProducts(false);
  D.sales.unshift({ folio: 'H68-LEGACY', fecha: '2026-08-01 10:00', cliente: 'x', vendedores: [], items: 1, total: 100, metodo: 'Efectivo', estado: 'Pagado', lineas: [{ sku: pA.sku, nombre: 'Prenda 801', talla, qty: 1 }] });
  D.saveSales();
  const resumen = D.testDataFootprint();
  const r = D.resetTestData();
  const despues = pA.stock.find(v => v.talla === talla).stock;
  // Se retira el escenario ambiguo para no contaminar lo que sigue.
  D.sales.length = 0; D.saveSales();
  const i = D.products.findIndex(p => p.id === 'h68-clon');
  if (i >= 0) D.products.splice(i, 1);
  D.saveProducts(false);
  return { bloqueado: resumen.bloqueado, ambiguos: resumen.identidadAmbigua.length, r, antes, despues };
}, seed);
check('un SKU que resuelve a dos productos BLOQUEA la limpieza',
  identidad.bloqueado === 'IDENTITY_AMBIGUOUS' && identidad.ambiguos === 1
  && identidad.r && identidad.r.ok === false && identidad.r.code === 'IDENTITY_AMBIGUOUS',
  JSON.stringify({ b: identidad.bloqueado, a: identidad.ambiguos, r: identidad.r && identidad.r.code }));
check('y no mueve ni una pieza mientras está bloqueada', identidad.despues === identidad.antes,
  `${identidad.antes} → ${identidad.despues}`);

// ── Una liquidación de apartado pendiente detiene la limpieza (H-65) ────────
const lock = await page.evaluate(() => {
  const D = window.DATA;
  const antes = D.totalPieces();
  localStorage.setItem('balam_pos_layaway_product_locks_v1', JSON.stringify([
    { operationId: 'h68-lock', folio: 'H68-LOCK', productIds: ['h68-a'], snapshots: [] },
  ]));
  const r = D.resetTestData();
  const footprint = D.testDataFootprint();
  localStorage.removeItem('balam_pos_layaway_product_locks_v1');
  return { r, bloqueado: footprint.bloqueado, antes, despues: D.totalPieces() };
});
check('una liquidación de apartado pendiente detiene la limpieza (H-65)',
  lock.r === false && lock.bloqueado === 'LAYAWAY_LOCK' && lock.despues === lock.antes,
  JSON.stringify({ r: lock.r, b: lock.bloqueado }));

// ── Dos pestañas: sólo la escritora puede limpiar ───────────────────────────
const page2 = await context.newPage();
page2.on('pageerror', e => errs.push('t2: ' + String(e)));
await page2.route(/supabase\.co/, r => r.abort());
await page2.goto('http://127.0.0.1:8868/index.html', { waitUntil: 'load' });
await page2.waitForFunction(() => window.DATA && window.DATA.resetTestData, null, { timeout: 30000 });
const dosTabs = await page2.evaluate(() => {
  const D = window.DATA;
  const antes = D.totalPieces();
  let error = null;
  try { D.resetTestData(); } catch (e) { error = String((e && e.message) || e); }
  return { escritora: D.isLocalWriter, error, antes, despues: D.totalPieces() };
});
check('una segunda pestaña no puede limpiar y no toca el inventario',
  dosTabs.escritora === false && !!dosTabs.error && dosTabs.despues === dosTabs.antes,
  JSON.stringify(dosTabs));

// ── Reproducción del defecto sobre el artefacto ANTERIOR ────────────────────
// Mismo escenario, paquete del commit previo: se demuestra qué quedaba sin
// borrar y por qué el inventario no volvía a su sitio.
if (!previo) {
  check('reproducción: se pudo leer el artefacto anterior', false, 'git show HEAD:index.html falló');
} else {
  const antesCtx = await browser.newContext();
  const pageAntes = await antesCtx.newPage();
  await pageAntes.route(/supabase\.co/, r => r.abort());
  await pageAntes.goto('http://127.0.0.1:8868/antes.html', { waitUntil: 'load' });
  await pageAntes.waitForFunction(() => window.DATA && window.DATA.resetTestData, null, { timeout: 30000 });
  const viejo = await pageAntes.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) {
      window.STORE.pushSale = () => {}; window.STORE.pushReturn = () => {};
      window.STORE.pushExchange = () => {}; window.STORE.pushLoanOperation = () => {};
      window.STORE.pushRows = () => {};
    }
    const mk = (id, modelo) => D.hydrate({
      id, cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo,
      nombre: 'Prenda ' + modelo, orn: '—', ornColors: [], precio: 500, costo: 200,
      pop: false, sku: 'H68-SKU-' + modelo, stock: D.mkStock([0, 20], []),
    });
    const pA = mk('h68-a', '801'), pB = mk('h68-b', '802');
    D.products.push(pA, pB); D.saveProducts();
    const talla = pA.stock.find(v => v.stock > 0).talla;
    const stock0A = pA.stock.find(v => v.talla === talla).stock;
    const stock0B = pB.stock.find(v => v.talla === talla).stock;
    D.promos.push({ id: 'h68-promo', nombre: 'Promo H68', tipo: 'pct', valor: 10, scope: {}, pausado: false, creado: 1 });
    D.savePromos();
    const cli = D.addClient({ nombre: 'Cliente H68', tel: '9999' });
    const venta = D.recordSale({ ticket: [{ p: pA, talla, qty: 4 }], sellerIds: [], client: cli, metodo: 'Efectivo', estado: 'Pagado', total: 2000, itemCount: 4 });
    const cam = D.recordExchange({
      origenFolio: venta.folio,
      lineas: [
        { lado: 'devuelto', productId: pA.id, sku: pA.sku, nombre: pA.nombre, talla, qty: 1, motivo: 'talla', condicion: 'nueva' },
        { lado: 'entregado', productId: pB.id, sku: pB.sku, nombre: pB.nombre, talla, qty: 1 },
      ],
      usuario: 'admin', metodoPago: 'Efectivo',
    });
    D.registrarPrestamo({ persona: { tipo: 'otro', nombre: 'Tienda vecina', tel: '5555' }, fecha: '2026-08-01', fechaEsperada: '2026-08-30', lineas: [{ productId: pB.id, sku: pB.sku, talla, qty: 2 }] });
    // Cola con una operación AJENA a los datos de prueba.
    localStorage.setItem('balam_sync_queue', JSON.stringify([
      { id: 'cfg', type: 'config', createdAt: '2026-08-02T09:00:00.000Z', ownerId: null },
    ]));
    D.resetTestData();
    return {
      cambioOk: !!(cam && cam.ok),
      cambiosVivos: D.exchanges.length,
      movimientosDeCambio: D.movements.filter(m => String(m.tipo || '').indexOf('Cambio') === 0).length,
      stockA: pA.stock.find(v => v.talla === talla).stock, stock0A,
      stockB: pB.stock.find(v => v.talla === talla).stock, stock0B,
      promos: D.promos.length,
      colaAjena: JSON.parse(localStorage.getItem('balam_sync_queue') || '[]').length,
      tieneAutoridadRemota: !!(window.STORE && window.STORE.purgeTestData),
      tieneHuella: typeof D.configFingerprint === 'function',
      tieneResumen: typeof D.testDataFootprint === 'function',
    };
  });
  check('ANTES · los cambios NO se borraban', viejo.cambioOk && viejo.cambiosVivos === 1, `cambios=${viejo.cambiosVivos}`);
  check('ANTES · sus movimientos de inventario quedaban huérfanos', viejo.movimientosDeCambio === 2, String(viejo.movimientosDeCambio));
  check('ANTES · el inventario NO volvía a su valor previo',
    viejo.stockA !== viejo.stock0A || viejo.stockB !== viejo.stock0B,
    `A=${viejo.stockA}/${viejo.stock0A} B=${viejo.stockB}/${viejo.stock0B}`);
  check('ANTES · borraba las reglas de descuento configuradas', viejo.promos === 0, String(viejo.promos));
  check('ANTES · vaciaba la cola entera, incluida una operación ajena', viejo.colaAjena === 0, String(viejo.colaAjena));
  check('ANTES · no existía autoridad transaccional ni resumen previo',
    !viejo.tieneAutoridadRemota && !viejo.tieneHuella && !viejo.tieneResumen,
    JSON.stringify(viejo));
  await antesCtx.close();
}

check('sin errores de página', errs.length === 0, errs.join(' | '));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
