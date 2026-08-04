// verify-h73-publicado.mjs — H-73: verificación del ARTEFACTO PUBLICADO.
//
// No inspecciona el archivo: lo carga desde el sitio servido, monta el MISMO
// componente que imprime la aplicación y lee el texto que saldría al papel.
//   1. El sha256 de lo servido coincide con el artefacto del commit.
//   2. Un cambio con diferencia dice CAMBIO, su importe, el sentido y el método.
//   3. Ese comprobante NO usa vocabulario de apartado.
//   4. La cobranza de un apartado conserva el suyo.
//
// Uso: node verify-h73-publicado.mjs [url]
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const URL_SITIO = process.argv[2] || 'https://david14081982.github.io/POS_Balam/index.html';
let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };
const APARTADO_RE = /APARTADO|Saldo pendiente|LIQUIDADO|Mercancía apartada|Mercancía entregada|Pagado a la fecha/i;

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
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.BalamTicket, null, { timeout: 40000 });

  const textos = await page.evaluate(async () => {
    const D = window.DATA;
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'pushExchange', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    window.CORE.invokeSync = () => ({ ok: true });
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
    const barato = mk('V-BARATO', 'SENCILLA', 1000, '901', 'BL');
    const caro = mk('V-CARO', 'PREMIUM', 2000, '902', 'AZ');
    D.saveProducts(false);

    const li = [{ key: 'k', p: barato, talla: 'L', qty: 1, res: D.resolveLineDiscount(barato, 'L') }];
    const q = D.saleQuote(li, []);
    const venta = D.recordSale({
      ticket: li, quote: q, sellerIds: D.sellers.length ? [D.sellers[0].id] : [],
      client: D.clients.find(c => c.generic), metodo: 'Efectivo', estado: 'Pagado',
      subtotal: q.subtotal, iva: q.iva, total: q.finalTotal,
      pagoEfectivo: q.finalTotal, pagoOtro: 0, pagoDetalle: { efectivo: q.finalTotal },
      metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 1,
    });
    const camb = D.recordExchange({
      origenFolio: venta.folio, vendedorId: D.sellers[0].id, metodoPago: 'Efectivo',
      lineas: [
        { lado: 'devuelto', productId: barato.id, sku: barato.sku, nombre: barato.nombre, talla: 'L', qty: 1, motivo: 'talla', condicion: 'Sin uso, con etiqueta' },
        { lado: 'entregado', productId: caro.id, sku: caro.sku, nombre: caro.nombre, talla: 'S', qty: 1 },
      ],
    });

    const host = document.createElement('div'); host.id = 'v73'; document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    const pinta = (props) => new Promise(res => {
      root.render(React.createElement(window.BalamTicket, props));
      setTimeout(() => res((document.querySelector('#balam-ticket') || {}).innerText || ''), 500);
    });

    const cambio = await pinta({
      sale: D.sales.find(s => s.folio === venta.folio),
      exchange: camb.exchange, payment: camb.payment,
    });

    // Apartado: su vocabulario debe seguir intacto.
    const li2 = [{ key: 'k', p: caro, talla: 'M', qty: 1, res: D.resolveLineDiscount(caro, 'M') }];
    const q2 = D.saleQuote(li2, []);
    if (!D.clients.find(c => c.id === 'V-C')) D.clients.push({ id: 'V-C', nombre: 'Ana', tel: '9', compras: 0, total: 0, generic: false });
    const ap = D.recordSale({
      ticket: li2, quote: q2, sellerIds: [D.sellers[0].id], client: D.clients.find(c => c.id === 'V-C'),
      metodo: 'Apartado', estado: 'Apartado', subtotal: q2.subtotal, iva: q2.iva, total: q2.finalTotal,
      anticipo: 300, pagoEfectivo: 300, pagoOtro: 0, pagoDetalle: { efectivo: 300 },
      metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 1,
    });
    const pagoAp = (D.paymentsForSale(ap.folio) || []).find(p => p.tipo === 'anticipo');
    const apartado = await pinta({ sale: D.sales.find(s => s.folio === ap.folio), payment: pagoAp });

    return { cambio, apartado, diferencia: camb.exchange && camb.exchange.diferencia };
  });

  check('el cambio se registró con diferencia a cobrar', textos.diferencia === 1000, String(textos.diferencia));
  check('el comprobante del cambio dice CAMBIO', /CAMBIO/i.test(textos.cambio));
  check('declara el importe y el sentido de la diferencia',
    /\$1,000\.00/.test(textos.cambio) && /Diferencia (pagada|cobrada)/i.test(textos.cambio));
  check('declara el método utilizado',
    /Recibido en Efectivo/i.test(textos.cambio) && /Método de pago/i.test(textos.cambio));
  check('el comprobante del cambio se rotula «Transacción» y «Detalle de compra»',
    /TRANSACCIÓN/i.test(textos.cambio) && /Detalle de compra/i.test(textos.cambio));
  check('el comprobante del cambio NO usa vocabulario de apartado',
    !APARTADO_RE.test(textos.cambio), (textos.cambio.match(APARTADO_RE) || [''])[0]);
  check('la cobranza de un apartado conserva su vocabulario',
    /Anticipo de apartado/i.test(textos.apartado) && /APARTADO/i.test(textos.apartado)
    && /Saldo pendiente/i.test(textos.apartado));
  check('sin errores de consola en el artefacto publicado', errs.length === 0, errs.join(' | '));
} finally { await b.close(); }

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
