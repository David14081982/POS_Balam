// test-h75-cobro-del-cambio.mjs — H-75: la diferencia de un cambio se clasifica
// por su forma de pago real.
//
// El defecto: `recordExchange` armaba el cobro a mano y sólo reconocía el
// efectivo. Todo lo demás —tarjeta, transferencia, mixto— caía en el cajón
// `otro`, así que el dinero cobrado con tarjeta en un cambio NO aparecía en la
// columna Tarjeta de ningún corte de caja. `docs/trazabilidad-financiera.md`
// exige que cada movimiento identifique por separado efectivo, tarjeta,
// transferencia y otro, y que la suma cuadre con el monto.
//
// La autoridad correcta ya existía: `paymentParts()`, la misma que usa cualquier
// otro cobro. El cambio no la consumía.
//
// Uso: node test-h75-cobro-del-cambio.mjs
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
await new Promise(r => server.listen(8853, '127.0.0.1', r));

let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort());
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto('http://127.0.0.1:8853/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 30000 });

  await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'pushExchange', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    window.CORE.invokeSync = () => ({ ok: true });

    window.__reset = () => {
      D.sales.length = 0; D.payments.length = 0; D.products.length = 0;
      if (D.returns) D.returns.length = 0;
      if (D.exchanges) D.exchanges.length = 0;
      if (D.movements) D.movements.length = 0;
      const mk = (id, nombre, precio, modelo, color) => {
        const p = D.hydrate({
          id, cat: '21', manga: 'MC', tela: 'ALG', color, cuello: 'NOR', modelo, nombre,
          orn: '—', ornColors: [], precio, costo: 100, pop: false, stock: D.mkStock([20, 20, 20, 20], []),
        });
        D.products.push(p); return p;
      };
      mk('P-BARATO', 'SENCILLA', 1000, '901', 'BL');
      mk('P-CARO', 'PREMIUM', 2000, '902', 'AZ');
      D.saveProducts(false);
      (D.sales || []).forEach(s => { if (s._operationId) { try { D.releaseLayawayProductLock(s._operationId); } catch (e) {} } });
    };
    // Cambia una prenda de $1,000 por una de $2,000 → diferencia de $1,000.
    window.__cambioCon = (metodoPago, pagoDetalle) => {
      window.__reset();
      const pb = D.products.find(x => x.id === 'P-BARATO');
      const pc = D.products.find(x => x.id === 'P-CARO');
      const li = [{ key: 'k', p: pb, talla: 'L', qty: 1, res: D.resolveLineDiscount(pb, 'L') }];
      const q = D.saleQuote(li, []);
      const s = D.recordSale({
        ticket: li, quote: q, sellerIds: D.sellers.length ? [D.sellers[0].id] : [],
        client: D.clients.find(c => c.generic), metodo: 'Efectivo', estado: 'Pagado',
        subtotal: q.subtotal, iva: q.iva, total: q.finalTotal, pagoEfectivo: q.finalTotal, pagoOtro: 0,
        pagoDetalle: { efectivo: q.finalTotal }, metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 1,
      });
      const arg = {
        origenFolio: s.folio, vendedorId: D.sellers[0].id, metodoPago,
        lineas: [
          { lado: 'devuelto', productId: pb.id, sku: pb.sku, nombre: pb.nombre, talla: 'L', qty: 1, motivo: 'talla', condicion: 'Sin uso, con etiqueta' },
          { lado: 'entregado', productId: pc.id, sku: pc.sku, nombre: pc.nombre, talla: 'S', qty: 1 },
        ],
      };
      if (pagoDetalle) arg.pagoDetalle = pagoDetalle;
      const r = D.recordExchange(arg);
      const pago = r && r.payment;
      return {
        ok: r && r.ok, error: r && r.error,
        diferencia: r && r.exchange && r.exchange.diferencia,
        pago: pago ? {
          metodo: pago.metodo, monto: pago.monto, tipo: pago.tipo,
          efectivo: pago.efectivo, tarjeta: pago.tarjeta,
          transferencia: pago.transferencia, otro: pago.otro,
          suma: Math.round((pago.efectivo + pago.tarjeta + pago.transferencia + pago.otro) * 100) / 100,
        } : null,
      };
    };
  });

  const caso = (metodo, detalle) => page.evaluate(
    ([m, d]) => window.__cambioCon(m, d), [metodo, detalle || null]);

  console.log('\n── Cada forma de pago cae en SU columna ──────────────────────────');
  const efectivo = await caso('Efectivo');
  check('efectivo: el cambio se registra', efectivo.ok === true && efectivo.diferencia === 1000, String(efectivo.error));
  check('efectivo → columna Efectivo',
    !!efectivo.pago && efectivo.pago.efectivo === 1000 && efectivo.pago.otro === 0,
    JSON.stringify(efectivo.pago));

  const tarjeta = await caso('Tarjeta');
  check('tarjeta: el cambio se registra', tarjeta.ok === true, String(tarjeta.error));
  check('tarjeta → columna Tarjeta (no al cajón «otro»)',
    !!tarjeta.pago && tarjeta.pago.tarjeta === 1000 && tarjeta.pago.otro === 0,
    JSON.stringify(tarjeta.pago));

  const transf = await caso('Transferencia');
  check('transferencia: el cambio se registra', transf.ok === true, String(transf.error));
  check('transferencia → columna Transferencia',
    !!transf.pago && transf.pago.transferencia === 1000 && transf.pago.otro === 0,
    JSON.stringify(transf.pago));

  console.log('\n── Pago mixto: se reparte, no se amontona ───────────────────────');
  const mixto = await caso('Mixto', { efectivo: 400, tarjeta: 600 });
  check('mixto: el cambio se registra', mixto.ok === true, String(mixto.error));
  check('mixto se reparte entre las dos columnas',
    !!mixto.pago && mixto.pago.efectivo === 400 && mixto.pago.tarjeta === 600 && mixto.pago.otro === 0,
    JSON.stringify(mixto.pago));

  console.log('\n── Un método sin columna propia va a «otro», por decisión ────────');
  const otro = await caso('Depósito');
  check('un método no nombrado se registra igual', otro.ok === true, String(otro.error));
  check('y su dinero queda declarado en «otro»',
    !!otro.pago && otro.pago.otro === 1000 && otro.pago.efectivo === 0
    && otro.pago.tarjeta === 0 && otro.pago.transferencia === 0,
    JSON.stringify(otro.pago));

  console.log('\n── La invariante financiera se cumple siempre ────────────────────');
  const todos = [efectivo, tarjeta, transf, mixto, otro];
  check('en todos los casos la suma de componentes es el monto',
    todos.every(x => x.pago && x.pago.suma === x.pago.monto && x.pago.monto === 1000),
    todos.map(x => x.pago && x.pago.suma).join(' · '));
  check('en todos los casos el cobro se marca como de cambio',
    todos.every(x => x.pago && x.pago.tipo === 'cambio'));

  console.log('\n── La pantalla del Cambio entrega el desglose ────────────────────');
  const pantalla = await page.evaluate(() => {
    const src = String(window.ReturnsScreen);
    return { existe: typeof window.ReturnsScreen };
  });
  const plomeria = await page.evaluate(() => {
    // El cobro del cambio viaja por CheckoutModal, que ya calcula `pagoDetalle`.
    // Se comprueba que recordExchange lo ACEPTE y lo respete, que es el contrato
    // del que depende la pantalla.
    const r = window.__cambioCon('Mixto', { efectivo: 250, transferencia: 750 });
    return r.pago;
  });
  check('recordExchange respeta el desglose que envía el cobro',
    !!plomeria && plomeria.efectivo === 250 && plomeria.transferencia === 750 && plomeria.otro === 0,
    JSON.stringify(plomeria));

  check('sin errores de consola durante el recorrido', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
