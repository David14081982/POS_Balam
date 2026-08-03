// test-h70-clientes-ventas.mjs — H-70: la pantalla Clientes deriva las compras de
// cada cliente de sus VENTAS reales, no de contadores desnormalizados.
//
// Se ejecuta sobre el BUNDLE distribuido (index.html), que es el artefacto que
// usa el negocio, y no sobre la fuente modular.
//
// Cubre las tres causas demostradas:
//   1. La tabla leía `c.compras/c.total/c.ultima`, que sólo escribe `recordSale`
//      en la terminal que cobró. Nada los derivaba de la tabla de ventas.
//   2. El `useMemo` de la lista no se recalculaba cuando la nube reemplazaba
//      `DATA.clients`, así que los KPI decían la verdad y la tabla no.
//   3. El historial del cajón buscaba por NOMBRE, de modo que renombrar a un
//      cliente le borraba las compras y dos homónimos las mezclaban.
//
// La semilla apaga a propósito los contadores persistidos después de crear los
// documentos: si la pantalla vuelve a depender de ellos, esta prueba lo detecta.
//
// Los controles se localizan por `data-testid` (R-DEL-10), nunca por texto.
//
// Uso: node test-h70-clientes-ventas.mjs
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
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
await new Promise(r => server.listen(8823, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

// ── Cifras esperadas, escritas desde el CONTRATO y no desde la implementación ──
// Ana Ruiz (c-ana):  V1 1000 pagada · V3 700 CANCELADA · V4 1200 con devolución
//                    de 200 · V6 cortesía ($0) · cambio sobre V1 con +150
//   compras = 2 (V1 y V4; la cancelada no cuenta, la cortesía no es compra)
//   total   = 1000 + 150 + (1200 - 200) = 2150
// Beatriz Sol (c-bea): V2 500 histórica SIN clienteId · V7 apartado de 800
//   compras = 2 · total = 1300
// Ana Ruiz homónima (c-ana2): V5 300
//   compras = 1 · total = 300
const ESPERADO = {
  'c-ana': { compras: 2, total: 2150, ultima: '2026-07-20', documentos: 4 },
  'c-bea': { compras: 2, total: 1300, ultima: '2026-07-15', documentos: 2 },
  'c-ana2': { compras: 1, total: 300, ultima: '2026-07-12', documentos: 1 },
};
const FACTURADO = 2150 + 1300 + 300;

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1600, height: 1100 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort());
  // Arrancar YA en Clientes: es el caso real de quien deja la pantalla abierta y
  // recarga, que es donde la lista quedaba congelada antes del pull.
  await page.addInitScript(() => { localStorage.setItem('balam-page', 'clientes'); });
  await page.goto('http://127.0.0.1:8823/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.STORE, null, { timeout: 25000 });

  // ── Utilidades de lectura por contrato estable ────────────────────────────
  const num = (s) => Number(String(s == null ? '' : s).replace(/[^0-9.-]/g, '')) || 0;
  const filas = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="clients-row"]')].map(tr => ({
    id: tr.getAttribute('data-client-id'),
    nombre: (tr.querySelector('[data-testid="clients-cell-nombre"]') || {}).textContent || '',
    compras: (tr.querySelector('[data-testid="clients-cell-compras"]') || {}).textContent || '',
    total: (tr.querySelector('[data-testid="clients-cell-total"]') || {}).textContent || '',
    ultima: (tr.querySelector('[data-testid="clients-cell-ultima"]') || {}).textContent || '',
  })));
  const kpis = () => page.evaluate(() => {
    const v = id => { const el = document.querySelector(`[data-testid="${id}"]`); return el ? el.textContent : null; };
    return { registrados: v('clients-kpi-registrados'), facturado: v('clients-kpi-facturado'), recurrentes: v('clients-kpi-recurrentes') };
  });
  const filaDe = async (id) => (await filas()).find(f => f.id === id) || null;
  const irA = async (pantalla) => {
    await page.evaluate(p => {
      const btn = [...document.querySelectorAll('aside nav button')].find(x => x.getAttribute('title') && x.getAttribute('title').toLowerCase().includes(p));
      if (btn) btn.click();
    }, pantalla);
    await page.waitForTimeout(350);
  };

  // ── Semilla: un estado de negocio VÁLIDO creado por las autoridades reales ──
  console.log('\n──────── Semilla ────────');
  const seed = await page.evaluate(() => {
    const D = window.DATA;
    window.STORE.pushRows = () => {}; window.STORE.pushSale = () => {};
    window.STORE.pushConfig = () => {}; window.STORE.pushReturn = () => {};
    window.STORE.pushClient = () => {};
    window.CONFIG.setSetting('returns.limitEnabled', false);
    window.CONFIG.setSetting('client.recurrentThreshold', 2);

    D.sales.length = 0; D.returns.length = 0; D.exchanges.length = 0;
    D.payments.length = 0; D.products.length = 0; D.movements.length = 0;
    const [tA, tB] = [D.SIZES_LETRA[1], D.SIZES_LETRA[2]];
    D.products.push(D.hydrate({
      id: 'h70-p', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
      modelo: '970', nombre: 'GUAYABERA H70', orn: '—', ornColors: [], precio: 1000,
      costo: 0, pop: false, stock: D.mkStock([0, 40, 40], []),
    }));
    D.products.push(D.hydrate({
      id: 'h70-q', cat: '21', manga: 'ML', tela: 'LN', color: 'NE', cuello: 'NOR',
      modelo: '971', nombre: 'GUAYABERA H70 PREMIUM', orn: '—', ornColors: [], precio: 1150,
      costo: 0, pop: false, stock: D.mkStock([0, 20, 0], []),
    }));
    D.saveProducts();
    const P = D.products[0], Q = D.products[1];

    D.clients.length = 0;
    const generico = { id: 'c7', nombre: 'Público en general', tel: '—', compras: 0, total: 0, ultima: '', talla: '', notas: '', generic: true };
    const ana = { id: 'c-ana', nombre: 'Ana Ruiz', tel: '9990000001', compras: 0, total: 0, ultima: '', talla: 'M', notas: '', generic: false };
    const bea = { id: 'c-bea', nombre: 'Beatriz Sol', tel: '9990000002', compras: 0, total: 0, ultima: '', talla: 'L', notas: '', generic: false };
    const ana2 = { id: 'c-ana2', nombre: 'Ana Ruiz', tel: '9990000003', compras: 0, total: 0, ultima: '', talla: 'S', notas: '', generic: false };
    D.clients.push(ana, bea, ana2, generico);
    D.saveClients(false);

    const linea = (p, talla, unit, qty = 1) => ({ p, talla, qty, res: { unit, orig: unit, promos: [] } });
    const venta = (o) => D.recordSale(Object.assign({ sellerIds: [], itemCount: 1, ivaPct: 16, ivaIncluded: true }, o));
    const importes = (total, anticipo) => ({
      subtotal: Math.round((total / 1.16) * 100) / 100,
      iva: Math.round((total - total / 1.16) * 100) / 100,
      total, anticipo: anticipo == null ? total : anticipo,
      pagoEfectivo: anticipo == null ? total : anticipo, pagoOtro: 0,
    });

    const V1 = venta(Object.assign({ ticket: [linea(P, tA, 1000)], client: ana, metodo: 'Efectivo', estado: 'Pagado', fecha: '2026-07-10 10:00' }, importes(1000)));
    // Venta HISTÓRICA sin clienteId: se fabrica con la autoridad y después se le
    // retira la identidad, que es exactamente como llegan las ventas anteriores
    // al campo `cliente_id`.
    const V2 = venta(Object.assign({ ticket: [linea(P, tA, 500)], client: bea, metodo: 'Efectivo', estado: 'Pagado', fecha: '2026-07-11 10:00' }, importes(500)));
    delete V2.clienteId;
    const V5 = venta(Object.assign({ ticket: [linea(P, tA, 300)], client: ana2, metodo: 'Efectivo', estado: 'Pagado', fecha: '2026-07-12 10:00' }, importes(300)));
    const V7 = venta(Object.assign({ ticket: [linea(P, tA, 800)], client: bea, metodo: 'Apartado', estado: 'Apartado', fecha: '2026-07-15 10:00' }, importes(800, 200)));
    const V3 = venta(Object.assign({ ticket: [linea(P, tA, 700)], client: ana, metodo: 'Efectivo', estado: 'Pagado', fecha: '2026-07-18 10:00' }, importes(700)));
    const V6 = venta(Object.assign({ ticket: [linea(P, tA, 400)], client: ana, metodo: 'Cortesía', estado: 'Pagado', fecha: '2026-07-19 10:00' }, importes(400)));
    const V4 = venta(Object.assign({
      ticket: [linea(P, tA, 1000), linea(P, tB, 200)], client: ana,
      metodo: 'Efectivo', estado: 'Pagado', itemCount: 2, fecha: '2026-07-20 10:00',
    }, importes(1200)));
    D.saveSales();

    // Cancelación por la autoridad real (revierte comisión y marca 'Cancelado').
    const cancel = D.reverseSaleCommission(V3.folio, { motivo: 'prueba H-70' });
    // Devolución parcial de $200 sobre V4, por la autoridad real.
    const dev = D.recordReturn({ folio: V4.folio, metodo: 'Efectivo', lineas: [{ sku: P.sku, nombre: P.nombre, talla: tB, qty: 1 }] });
    // Cambio sobre V1: entrega una pieza de $1,150 por la de $1,000 → +150.
    const cam = D.recordExchange({
      origenFolio: V1.folio, usuario: 'prueba', metodoPago: 'Efectivo', fecha: '2026-07-21 10:00',
      lineas: [
        { lado: 'devuelto', productId: P.id, sku: P.sku, nombre: P.nombre, talla: tA, qty: 1, condicion: 'nueva' },
        { lado: 'entregado', productId: Q.id, sku: Q.sku, nombre: Q.nombre, talla: tA, qty: 1 },
      ],
    });

    // Contadores desnormalizados APAGADOS: simulan la terminal que no cobró esas
    // ventas. Si la pantalla vuelve a leerlos, todo saldrá en cero.
    D.clients.forEach(c => { c.compras = 0; c.total = 0; c.ultima = ''; });
    D.saveClients(false);

    return {
      folios: { V1: V1.folio, V2: V2.folio, V3: V3.folio, V4: V4.folio, V5: V5.folio, V6: V6.folio, V7: V7.folio },
      cancelada: cancel && cancel.ok === true && D.sales.find(s => s.folio === V3.folio).estado === 'Cancelado',
      devolucion: dev && dev.ok === true ? dev.ret.total : null,
      cambio: cam && cam.ok !== false ? (cam.exchange || cam).diferencia : null,
      cortesiaTotal: V6.total, apartadoTotal: V7.total, v2SinId: V2.clienteId === undefined,
      contadoresEnCero: D.clients.every(c => !c.compras && !c.total && !c.ultima),
    };
  });
  check('la semilla cancela por la autoridad real', seed.cancelada === true);
  check('la semilla devuelve $200 por la autoridad real', seed.devolucion === 200, `devuelto ${seed.devolucion}`);
  check('la semilla produce un cambio con diferencia de $150', seed.cambio === 150, `diferencia ${seed.cambio}`);
  check('la cortesía queda en $0 y el apartado en $800', seed.cortesiaTotal === 0 && seed.apartadoTotal === 800);
  check('la venta histórica quedó sin clienteId', seed.v2SinId === true);
  check('los contadores desnormalizados quedan en cero', seed.contadoresEnCero === true);

  // ── A) La autoridad de dominio ─────────────────────────────────────────────
  console.log('\n──────── A) Autoridad DATA.clientSalesSummary ────────');
  const existe = await page.evaluate(() => typeof window.DATA.clientSalesSummary === 'function'
    && typeof window.DATA.clientSalesSummaries === 'function');
  check('DATA publica la autoridad de compras del cliente', existe);

  const resumenes = existe ? await page.evaluate(() => {
    const D = window.DATA;
    const out = {};
    D.clients.filter(c => !c.generic).forEach(c => {
      const r = D.clientSalesSummary(c);
      out[c.id] = {
        compras: r.compras, total: r.total, ultima: r.ultima,
        documentos: r.ventas.length, folios: r.ventas.map(s => s.folio),
        devuelto: r.devuelto, cambios: r.cambios, apartados: r.apartados,
        cortesias: r.cortesias, canceladas: r.canceladas,
      };
    });
    return out;
  }) : {};

  // 1 · venta ligada por clienteId
  check('1 · cliente con venta por clienteId muestra compra, total y fecha', !!resumenes['c-ana']
    && resumenes['c-ana'].compras === ESPERADO['c-ana'].compras
    && resumenes['c-ana'].total === ESPERADO['c-ana'].total
    && resumenes['c-ana'].ultima === ESPERADO['c-ana'].ultima,
    JSON.stringify(resumenes['c-ana'] || null));
  // 2 · venta histórica sin clienteId
  check('2 · venta histórica sin clienteId se resuelve por nombre', !!resumenes['c-bea']
    && resumenes['c-bea'].compras === ESPERADO['c-bea'].compras
    && resumenes['c-bea'].total === ESPERADO['c-bea'].total,
    JSON.stringify(resumenes['c-bea'] || null));
  // 4 · cancelada fuera
  check('4 · la venta cancelada no incrementa métricas', !!resumenes['c-ana']
    && resumenes['c-ana'].canceladas === 1
    && resumenes['c-ana'].documentos === ESPERADO['c-ana'].documentos);
  // 5 · devolución
  check('5 · la devolución resta del gasto lo reembolsado y conserva la compra',
    !!resumenes['c-ana'] && resumenes['c-ana'].devuelto === 200 && resumenes['c-ana'].compras === 2);
  // cortesía y apartado
  check('la cortesía aparece en el historial pero no es compra ni suma',
    !!resumenes['c-ana'] && resumenes['c-ana'].cortesias === 1);
  check('el apartado cuenta como compra con su total', !!resumenes['c-bea'] && resumenes['c-bea'].apartados === 1);
  check('la diferencia del cambio suma al gasto y no es una compra más',
    !!resumenes['c-ana'] && resumenes['c-ana'].cambios === 150 && resumenes['c-ana'].compras === 2);
  // 10 · homónimos
  check('10 · dos clientes con el mismo nombre no mezclan ventas', !!resumenes['c-ana2']
    && resumenes['c-ana2'].compras === 1 && resumenes['c-ana2'].total === 300
    && !resumenes['c-ana'].folios.includes(seed.folios.V5)
    && !resumenes['c-ana2'].folios.includes(seed.folios.V1),
    JSON.stringify(resumenes['c-ana2'] || null));
  // 3 · renombrar
  const renombrado = existe ? await page.evaluate(() => {
    const D = window.DATA;
    const ana = D.clients.find(c => c.id === 'c-ana');
    ana.nombre = 'Ana Ruiz de Balam'; D.saveClients(false);
    const r = D.clientSalesSummary(ana);
    return { compras: r.compras, total: r.total };
  }) : null;
  check('3 · renombrar al cliente no pierde las ventas con clienteId',
    !!renombrado && renombrado.compras === 2 && renombrado.total === 2150, JSON.stringify(renombrado));
  await page.evaluate(() => {
    const D = window.DATA;
    const ana = D.clients.find(c => c.id === 'c-ana');
    ana.nombre = 'Ana Ruiz'; D.saveClients(false);
  });

  // 12 · coherencia con Reportes
  console.log('\n──────── B) Coherencia con Reportes ────────');
  const coherencia = existe ? await page.evaluate(() => {
    const D = window.DATA;
    const res = D.clients.filter(c => !c.generic).map(c => D.clientSalesSummary(c));
    const gastado = Math.round(res.reduce((a, r) => a + r.total, 0) * 100) / 100;
    const devuelto = Math.round(res.reduce((a, r) => a + r.devuelto, 0) * 100) / 100;
    const rep = D.revenueSummary();
    return { gastado, devuelto, importeVendido: rep.importeVendido, ventasSolas: rep.ventasSolas, difCambios: rep.difCambios };
  }) : null;
  // La identidad del contrato: Reportes informa el importe VENDIDO (bruto de
  // devoluciones, que reporta aparte) y Clientes el gasto NETO de cada persona.
  // Ambos leen los mismos documentos con la misma aritmética.
  check('12 · Clientes y Reportes cuadran sobre los mismos documentos',
    !!coherencia && Math.abs((coherencia.gastado + coherencia.devuelto) - coherencia.importeVendido) < 0.01,
    JSON.stringify(coherencia));

  // ── C) La pantalla ────────────────────────────────────────────────────────
  console.log('\n──────── C) Pantalla Clientes ────────');
  await irA('inventario'); await irA('clientes');
  const f0 = await filas(); const k0 = await kpis();
  check('la tabla expone sus filas por contrato estable', f0.length === 3, `${f0.length} filas`);
  const ana0 = f0.find(x => x.id === 'c-ana');
  check('la tabla muestra las compras derivadas de las ventas', !!ana0 && num(ana0.compras) === 2, JSON.stringify(ana0));
  check('la tabla muestra el total gastado derivado', !!ana0 && num(ana0.total) === 2150, JSON.stringify(ana0));
  check('la tabla muestra la última visita derivada', !!ana0 && /20\/07\/26/.test(ana0.ultima), JSON.stringify(ana0));

  // 11 · la suma de la columna coincide con el KPI
  const suma = f0.reduce((a, x) => a + num(x.total), 0);
  check('11 · la suma de «Total gastado» coincide con el KPI facturado',
    suma === FACTURADO && num(k0.facturado) === FACTURADO, `columna ${suma} · KPI ${k0.facturado}`);
  check('el KPI de recurrentes usa las compras derivadas', num(k0.recurrentes) === 2, `recurrentes ${k0.recurrentes}`);

  // 6 · venta nueva sin tocar el buscador
  const antes6 = await filaDe('c-ana');
  await page.evaluate(() => {
    const D = window.DATA;
    const P = D.products[0]; const talla = D.SIZES_LETRA[1];
    const ana = D.clients.find(c => c.id === 'c-ana');
    D.recordSale({
      ticket: [{ p: P, talla, qty: 1, res: { unit: 500, orig: 500, promos: [] } }],
      sellerIds: [], client: ana, metodo: 'Efectivo', estado: 'Pagado', itemCount: 1,
      subtotal: 431.03, iva: 68.97, total: 500, anticipo: 500, pagoEfectivo: 500, pagoOtro: 0,
      ivaPct: 16, ivaIncluded: true, fecha: '2026-07-25 10:00',
    });
  });
  await page.waitForTimeout(400);
  const despues6 = await filaDe('c-ana');
  check('6 · una venta nueva actualiza la tabla sin escribir en el buscador',
    !!despues6 && num(despues6.compras) === 3 && num(despues6.total) === 2650,
    `antes ${antes6 && antes6.compras}/${antes6 && antes6.total} · después ${despues6 && despues6.compras}/${despues6 && despues6.total}`);

  // 7 · pull remoto en el mismo montaje
  await page.evaluate(() => {
    const D = window.DATA;
    D.applyRemote('clients', [
      { id: 'c-ana', nombre: 'Ana Ruiz', tel: '9990000001', talla: 'M', notas: '', compras: 0, total: 0, ultima: '', generic: false },
      { id: 'c-bea', nombre: 'Beatriz Sol', tel: '9990000002', talla: 'L', notas: '', compras: 0, total: 0, ultima: '', generic: false },
      { id: 'c-ana2', nombre: 'Ana Ruiz', tel: '9990000003', talla: 'S', notas: '', compras: 0, total: 0, ultima: '', generic: false },
      { id: 'c-nube', nombre: 'Carlos Nube', tel: '9990000004', talla: 'M', notas: '', compras: 0, total: 0, ultima: '', generic: false },
      { id: 'c7', nombre: 'Público en general', tel: '—', compras: 0, total: 0, ultima: '', talla: '', notas: '', generic: true },
    ]);
    D.mergeRemote('sales', [{
      folio: 'H70-NUBE-1', fecha: '2026-07-28 12:00', clienteId: 'c-nube', cliente: 'Carlos Nube',
      vendedores: [], items: 1, total: 900, metodo: 'Efectivo', estado: 'Pagado', lineas: [],
    }], 'folio');
    window.dispatchEvent(new CustomEvent('configchange', { detail: { domain: true } }));
  });
  await page.waitForTimeout(450);
  const f7 = await filas(); const k7 = await kpis();
  const nube = f7.find(x => x.id === 'c-nube');
  check('7 · el pull remoto actualiza las filas en el mismo montaje',
    f7.length === 4 && !!nube && num(nube.compras) === 1 && num(nube.total) === 900,
    `${f7.length} filas · ${JSON.stringify(nube)}`);
  check('7 · el pull remoto actualiza también los KPI en el mismo montaje',
    num(k7.registrados) === 4 && num(k7.facturado) === FACTURADO + 500 + 900,
    `registrados ${k7.registrados} · facturado ${k7.facturado}`);
  const suma7 = f7.reduce((a, x) => a + num(x.total), 0);
  check('11b · columna y KPI siguen cuadrando después del pull',
    f7.length > 0 && suma7 === num(k7.facturado), `columna ${suma7} · KPI ${k7.facturado}`);

  // 8 · cambiar de pantalla y volver
  await irA('inventario'); await irA('clientes');
  const f8 = await filas(); const k8 = await kpis();
  check('8 · cambiar de pantalla y volver no modifica el resultado',
    f8.length > 0 && JSON.stringify(f8) === JSON.stringify(f7) && JSON.stringify(k8) === JSON.stringify(k7));

  // Historial del cajón por identidad
  console.log('\n──────── D) Cajón e historial ────────');
  const abrio = await page.evaluate(() => {
    const tr = document.querySelector('[data-testid="clients-row"][data-client-id="c-ana"]');
    if (!tr) return false;
    tr.click(); return true;
  });
  check('la fila del cliente se puede abrir por contrato estable', abrio);
  await page.waitForTimeout(400);
  const cajon = await page.evaluate(() => {
    const dr = document.querySelector('[data-testid="client-drawer"]');
    if (!dr) return null;
    return {
      compras: (dr.querySelector('[data-testid="client-drawer-compras"]') || {}).textContent || '',
      total: (dr.querySelector('[data-testid="client-drawer-total"]') || {}).textContent || '',
      folios: [...dr.querySelectorAll('[data-testid="client-history-row"]')].map(x => x.getAttribute('data-folio')),
    };
  });
  check('el cajón muestra las estadísticas derivadas',
    !!cajon && num(cajon.compras) === 3 && num(cajon.total) === 2650, JSON.stringify(cajon));
  check('el cajón lista el historial completo del cliente, cancelada incluida',
    !!cajon && cajon.folios.length === 5 && cajon.folios.includes(seed.folios.V3),
    JSON.stringify(cajon && cajon.folios));
  check('3b · el historial NO contiene la venta de la homónima',
    !!cajon && !cajon.folios.includes(seed.folios.V5));

  // 9 · editar después del pull modifica al cliente vigente
  console.log('\n──────── E) Edición después del pull ────────');
  const edicion = await page.evaluate(async () => {
    const D = window.DATA;
    let enviado = null;
    window.STORE.pushClient = (c) => { enviado = c && c.id; };
    window.STORE.pushRows = () => { enviado = 'ARREGLO_COMPLETO'; };
    const abrir = document.querySelector('[data-testid="client-edit-open"]');
    if (!abrir) return { nombreEnData: null, enviado: null, error: 'sin control de edición' };
    abrir.click();
    await new Promise(r => setTimeout(r, 250));
    const input = document.querySelector('[data-testid="client-edit-nombre"]');
    const guardar = document.querySelector('[data-testid="client-edit-save"]');
    if (!input || !guardar) return { nombreEnData: null, enviado: null, error: 'sin formulario de edición' };
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(input, 'Ana Ruiz Editada'); input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    guardar.click();
    await new Promise(r => setTimeout(r, 350));
    const vigente = D.clients.find(c => c.id === 'c-ana');
    return { nombreEnData: vigente ? vigente.nombre : null, enviado };
  });
  check('9 · editar un cliente después del pull modifica el cliente vigente de DATA',
    edicion.nombreEnData === 'Ana Ruiz Editada', JSON.stringify(edicion));
  await page.waitForTimeout(350);
  const f9 = await filaDe('c-ana');
  check('9b · la edición se ve en la tabla y conserva las ventas',
    !!f9 && f9.nombre.includes('Ana Ruiz Editada') && num(f9.compras) === 3 && num(f9.total) === 2650,
    JSON.stringify(f9));
  check('9c · la edición sube SÓLO ese cliente, no el arreglo completo',
    edicion.enviado === 'c-ana', `enviado: ${edicion.enviado}`);

  // ── F) Contrato: la fórmula no está duplicada en la pantalla ──────────────
  console.log('\n──────── F) Contrato de autoridad única ────────');
  const clientsSrc = readFileSync('balam/clients.jsx', 'utf8');
  const dataSrc = readFileSync('balam/data.jsx', 'utf8');
  check('la autoridad vive en DATA', /function clientSalesSummaries?\s*\(/.test(dataSrc));
  check('Clientes consume la autoridad y no reimplementa la pertenencia',
    /clientSalesSummar/.test(clientsSrc) && !/D\.sales\.filter/.test(clientsSrc));
  check('Clientes ya no lee los contadores desnormalizados',
    !/\bc\.compras\b/.test(clientsSrc) && !/\bc\.ultima\b/.test(clientsSrc));
  check('la pertenencia nunca depende sólo del nombre',
    /clienteId/.test(dataSrc.slice(dataSrc.indexOf('function clientSalesSummaries'), dataSrc.indexOf('function clientSalesSummaries') + 2600)));
} finally {
  await b.close(); server.close();
}

if (errs.length) { console.log('\nErrores de página:'); errs.forEach(e => console.log('  ' + e)); }
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
