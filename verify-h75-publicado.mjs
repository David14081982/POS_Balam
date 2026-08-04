// verify-h75-publicado.mjs — H-75: verificación del ARTEFACTO PUBLICADO.
//
// Carga el sitio servido y cobra la diferencia de un cambio con cada forma de
// pago, comprobando que cada peso caiga en SU columna.
//   1. El sha256 de lo servido coincide con el artefacto del commit.
//   2. Tarjeta → tarjeta · Transferencia → transferencia · Mixto se reparte.
//   3. Un método sin columna propia queda declarado en «otro».
//   4. En todos los casos la suma de componentes es el monto.
//
// Uso: node verify-h75-publicado.mjs [url]
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const URL_SITIO = process.argv[2] || 'https://david14081982.github.io/POS_Balam/index.html';
let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const blob = execFileSync('git', ['show', 'HEAD:index.html'], { maxBuffer: 64 * 1024 * 1024 });
const local = createHash('sha256').update(blob).digest('hex');
const bytes = Buffer.from(await (await fetch(URL_SITIO, { cache: 'no-store' })).arrayBuffer());
const servido = createHash('sha256').update(bytes).digest('hex');
check('el sitio sirve exactamente el artefacto del commit', servido === local,
  `servido ${servido.slice(0, 16)}… · commit ${local.slice(0, 16)}…`);
console.log(`   sha256 publicado: ${servido} (${bytes.length} bytes)`);

const b = await chromium.launch({ channel: 'chrome', headless: true });
const errs = [];
try {
  const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto(URL_SITIO, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 40000 });

  const r = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'pushExchange', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    window.CORE.invokeSync = () => ({ ok: true });

    const cobra = (metodoPago, pagoDetalle) => {
      D.sales.length = 0; D.payments.length = 0; D.products.length = 0;
      if (D.exchanges) D.exchanges.length = 0;
      if (D.movements) D.movements.length = 0;
      const mk = (id, nombre, precio, modelo, color) => {
        const p = D.hydrate({
          id, cat: '21', manga: 'MC', tela: 'ALG', color, cuello: 'NOR', modelo, nombre,
          orn: '—', ornColors: [], precio, costo: 100, pop: false, stock: D.mkStock([20, 20, 20, 20], []),
        });
        D.products.push(p); return p;
      };
      const pb = mk('V-BARATO', 'SENCILLA', 1000, '901', 'BL');
      const pc = mk('V-CARO', 'PREMIUM', 2000, '902', 'AZ');
      D.saveProducts(false);
      const li = [{ key: 'k', p: pb, talla: 'L', qty: 1, res: D.resolveLineDiscount(pb, 'L') }];
      const q = D.saleQuote(li, []);
      const s = D.recordSale({
        ticket: li, quote: q, sellerIds: D.sellers.length ? [D.sellers[0].id] : [],
        client: D.clients.find(c => c.generic), metodo: 'Efectivo', estado: 'Pagado',
        subtotal: q.subtotal, iva: q.iva, total: q.finalTotal, pagoEfectivo: q.finalTotal,
        pagoOtro: 0, pagoDetalle: { efectivo: q.finalTotal }, metodoPago: 'Efectivo',
        ivaPct: 16, ivaIncluded: true, itemCount: 1,
      });
      const arg = {
        origenFolio: s.folio, vendedorId: D.sellers[0].id, metodoPago,
        lineas: [
          { lado: 'devuelto', productId: pb.id, sku: pb.sku, nombre: pb.nombre, talla: 'L', qty: 1, motivo: 'talla', condicion: 'Sin uso, con etiqueta' },
          { lado: 'entregado', productId: pc.id, sku: pc.sku, nombre: pc.nombre, talla: 'S', qty: 1 },
        ],
      };
      if (pagoDetalle) arg.pagoDetalle = pagoDetalle;
      const res = D.recordExchange(arg);
      const p = res && res.payment;
      return p ? {
        metodo: p.metodo, monto: p.monto, efectivo: p.efectivo, tarjeta: p.tarjeta,
        transferencia: p.transferencia, otro: p.otro,
        suma: Math.round((p.efectivo + p.tarjeta + p.transferencia + p.otro) * 100) / 100,
      } : { error: res && res.error };
    };
    return {
      efectivo: cobra('Efectivo'),
      tarjeta: cobra('Tarjeta'),
      transferencia: cobra('Transferencia'),
      mixto: cobra('Mixto', { efectivo: 400, tarjeta: 600 }),
      otro: cobra('Depósito'),
    };
  });

  check('efectivo cae en la columna Efectivo', r.efectivo.efectivo === 1000 && r.efectivo.otro === 0, JSON.stringify(r.efectivo));
  check('tarjeta cae en la columna Tarjeta', r.tarjeta.tarjeta === 1000 && r.tarjeta.otro === 0, JSON.stringify(r.tarjeta));
  check('transferencia cae en la columna Transferencia', r.transferencia.transferencia === 1000 && r.transferencia.otro === 0, JSON.stringify(r.transferencia));
  check('un pago mixto se reparte entre sus columnas',
    r.mixto.efectivo === 400 && r.mixto.tarjeta === 600 && r.mixto.otro === 0, JSON.stringify(r.mixto));
  check('un método sin columna propia queda declarado en «otro»',
    r.otro.otro === 1000 && r.otro.efectivo === 0 && r.otro.tarjeta === 0, JSON.stringify(r.otro));
  const todos = [r.efectivo, r.tarjeta, r.transferencia, r.mixto, r.otro];
  check('la suma de componentes es el monto en los cinco casos',
    todos.every(x => x.suma === x.monto && x.monto === 1000),
    todos.map(x => x.suma).join(' · '));
  check('sin errores de consola en el artefacto publicado', errs.length === 0, errs.join(' | '));
} finally { await b.close(); }

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
