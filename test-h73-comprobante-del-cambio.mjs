// test-h73-comprobante-del-cambio.mjs — H-73: el comprobante habla del tipo real
// de operación.
//
// El defecto: `BalamTicket` decidía su vocabulario con `conCobranza = esApartado
// || !!payment` y con `info(payment ? 'Apartado' : 'Transacción')`. La costura
// `payment` nació para la cobranza de apartados (H-40) y el Cambio la reutilizó
// para acusar dinero (C6), así que una venta de contado con un cambio cobrado
// salía impresa diciendo «APARTADO», «MERCANCÍA ENTREGADA», «Pagado a la fecha»
// y «Saldo pendiente · LIQUIDADO», y además OCULTABA el método de pago.
//
// El dato para distinguirlos ya existía y nadie lo miraba: el apartado etiqueta
// sus pagos como `anticipo`/`abono`/`liquidacion` y el cambio como `cambio`.
//
// Mide sobre el BUNDLE distribuido (index.html), montando el MISMO componente que
// imprime la aplicación y leyendo el texto que sale al papel.
//
// Uso: node test-h73-comprobante-del-cambio.mjs
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
await new Promise(r => server.listen(8849, '127.0.0.1', r));

let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };
// Vocabulario que SÓLO pertenece a la cobranza de un apartado.
const APARTADO_RE = /APARTADO|Saldo pendiente|LIQUIDADO|Mercancía apartada|Mercancía entregada|Pagado a la fecha/i;

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort());
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto('http://127.0.0.1:8849/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.BalamTicket, null, { timeout: 30000 });

  await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'pushReturn', 'pushExchange', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    // La liquidación de apartado necesita una nube que confirme, para poder
    // comprobar que SU vocabulario sigue intacto.
    window.CORE.invokeSync = (op, sale, ctx) => {
      if (op === 'settleLayaway') {
        const target = D.sales.find(s => s.folio === sale.folio);
        if (target) {
          Object.assign(target, {
            estado: 'Pagado', anticipo: sale.anticipo, saldo: 0,
            lineas: sale.lineas, _stockReserved: true, _syncStatus: 'synced',
          });
          D.saveSales();
        }
        if (ctx && ctx.payment && !D.payments.find(p => p.id === ctx.payment.id)) {
          D.payments.unshift(ctx.payment); D.savePayments(false);
        }
        return { ok: true, paymentId: ctx && ctx.payment && ctx.payment.id };
      }
      if (op === 'hasPendingLayaway') return false;
      return { ok: true };
    };

    window.__mount = (props) => {
      const prev = document.getElementById('h73-host');
      if (prev) { prev.__root && prev.__root.unmount(); prev.remove(); }
      const host = document.createElement('div'); host.id = 'h73-host';
      document.body.appendChild(host);
      const root = ReactDOM.createRoot(host); host.__root = root;
      root.render(React.createElement(window.BalamTicket, props));
    };
    window.__texto = () => {
      const t = document.querySelector('#balam-ticket');
      return t ? t.innerText : '(sin ticket)';
    };
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
      mk('P-BARATO', 'GUAYABERA SENCILLA', 1000, '901', 'BL');
      mk('P-CARO', 'GUAYABERA PREMIUM', 2000, '902', 'AZ');
      D.saveProducts(false);
      if (!D.clients.find(c => c.id === 'C-H73')) {
        D.clients.push({ id: 'C-H73', nombre: 'Ana Poot', tel: '999', compras: 0, total: 0, generic: false });
      }
      (D.layawayProductLockSnapshot ? [] : []).forEach(() => {});
      D.sales.forEach(s => { if (s._operationId) { try { D.releaseLayawayProductLock(s._operationId); } catch (e) {} } });
    };
    window.__vender = (id, talla, extra) => {
      const p = D.products.find(x => x.id === id);
      const li = [{ key: 'k', p, talla, qty: 1, res: D.resolveLineDiscount(p, talla) }];
      const q = D.saleQuote(li, []);
      const base = {
        ticket: li, quote: q, sellerIds: D.sellers.length ? [D.sellers[0].id] : [],
        client: (extra && extra.clienteRegistrado) ? D.clients.find(c => c.id === 'C-H73') : D.clients.find(c => c.generic),
        metodo: 'Efectivo', estado: 'Pagado', subtotal: q.subtotal, iva: q.iva, total: q.finalTotal,
        pagoEfectivo: q.finalTotal, pagoOtro: 0, pagoDetalle: { efectivo: q.finalTotal },
        metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 1,
      };
      return D.recordSale(Object.assign(base, (extra && extra.venta) || {}));
    };
    window.__cambiar = (folio, deId, deTalla, aId, aTalla) => {
      const pd = D.products.find(x => x.id === deId);
      const pa = D.products.find(x => x.id === aId);
      return D.recordExchange({
        origenFolio: folio, vendedorId: D.sellers[0].id, metodoPago: 'Efectivo',
        lineas: [
          { lado: 'devuelto', productId: pd.id, sku: pd.sku, nombre: pd.nombre, talla: deTalla, qty: 1, motivo: 'talla', condicion: 'Sin uso, con etiqueta' },
          { lado: 'entregado', productId: pa.id, sku: pa.sku, nombre: pa.nombre, talla: aTalla, qty: 1 },
        ],
      });
    };
  });

  const ver = async (fn, arg) => {
    const meta = await page.evaluate(fn, arg);
    await page.waitForTimeout(350);
    const texto = await page.evaluate(() => window.__texto());
    return { meta, texto };
  };

  // ── 1) Cambio con diferencia A FAVOR DEL NEGOCIO (el cliente paga) ────────
  console.log('\n── 1) Cambio con diferencia a favor del negocio ──────────────────');
  const favorNegocio = await ver(() => {
    window.__reset();
    const s = window.__vender('P-BARATO', 'L');
    const r = window.__cambiar(s.folio, 'P-BARATO', 'L', 'P-CARO', 'S');
    window.__mount({ sale: window.DATA.sales.find(x => x.folio === s.folio), exchange: r.exchange, payment: r.payment });
    return { ok: r.ok, diferencia: r.exchange && r.exchange.diferencia, metodo: r.payment && r.payment.metodo };
  });
  check('el cambio se registró con diferencia a cobrar',
    favorNegocio.meta.ok === true && favorNegocio.meta.diferencia === 1000, String(favorNegocio.meta.diferencia));
  check('1a. el comprobante dice CAMBIO', /CAMBIO/i.test(favorNegocio.texto));
  check('1b. muestra el importe de la diferencia', /\$1,000\.00/.test(favorNegocio.texto));
  check('1c. declara el sentido del pago (diferencia cobrada al cliente)',
    /Diferencia pagada|Diferencia cobrada/i.test(favorNegocio.texto));
  // El acuse dice cómo se recibió la diferencia; el bloque «Método de pago» dice
  // cómo se pagó la venta. La costura de apartado ocultaba el segundo.
  check('1d. muestra el método de pago utilizado',
    /Recibido en Efectivo/i.test(favorNegocio.texto) && /Método de pago/i.test(favorNegocio.texto));
  check('1e. NO usa vocabulario de apartado',
    !APARTADO_RE.test(favorNegocio.texto),
    (favorNegocio.texto.match(APARTADO_RE) || [''])[0]);
  check('1f. el renglón de la venta se titula «Transacción»',
    /TRANSACCIÓN/i.test(favorNegocio.texto));
  check('1g. el detalle conserva su título de venta',
    /Detalle de compra/i.test(favorNegocio.texto));

  // ── 2) Cambio con diferencia A FAVOR DEL CLIENTE (sobrante no aprovechado) ─
  console.log('\n── 2) Cambio con diferencia a favor del cliente ──────────────────');
  const favorCliente = await ver(() => {
    window.__reset();
    const s = window.__vender('P-CARO', 'L');
    const r = window.__cambiar(s.folio, 'P-CARO', 'L', 'P-BARATO', 'S');
    window.__mount({ sale: window.DATA.sales.find(x => x.folio === s.folio), exchange: r.exchange, payment: r.payment });
    return { ok: r.ok, noAprovechado: r.exchange && r.exchange.valorNoAprovechado, hayPago: !!r.payment };
  });
  check('el cambio se registró con sobrante a favor del cliente',
    favorCliente.meta.ok === true && favorCliente.meta.noAprovechado === 1000,
    String(favorCliente.meta.noAprovechado));
  check('2a. el comprobante dice CAMBIO', /CAMBIO/i.test(favorCliente.texto));
  check('2b. declara el saldo no aprovechado y que no se reembolsa',
    /no aprovechado/i.test(favorCliente.texto) && /no reembolsable/i.test(favorCliente.texto));
  check('2c. NO usa vocabulario de apartado',
    !APARTADO_RE.test(favorCliente.texto),
    (favorCliente.texto.match(APARTADO_RE) || [''])[0]);
  check('2d. muestra el método de pago de la venta', /Método de pago/i.test(favorCliente.texto));

  // ── 3) Cambio SIN diferencia ──────────────────────────────────────────────
  console.log('\n── 3) Cambio sin diferencia ──────────────────────────────────────');
  const sinDif = await ver(() => {
    window.__reset();
    const s = window.__vender('P-CARO', 'L');
    const r = window.__cambiar(s.folio, 'P-CARO', 'L', 'P-CARO', 'S');
    window.__mount({ sale: window.DATA.sales.find(x => x.folio === s.folio), exchange: r.exchange, payment: r.payment });
    return { ok: r.ok, diferencia: r.exchange && r.exchange.diferencia, noAprovechado: r.exchange && r.exchange.valorNoAprovechado };
  });
  check('el cambio sin diferencia se registró',
    sinDif.meta.ok === true && sinDif.meta.diferencia === 0 && sinDif.meta.noAprovechado === 0);
  check('3a. el comprobante dice CAMBIO', /CAMBIO/i.test(sinDif.texto));
  check('3b. no anuncia diferencia ni sobrante',
    !/Diferencia pagada|Diferencia cobrada/i.test(sinDif.texto) && !/no aprovechado/i.test(sinDif.texto));
  check('3c. NO usa vocabulario de apartado',
    !APARTADO_RE.test(sinDif.texto), (sinDif.texto.match(APARTADO_RE) || [''])[0]);
  check('3d. muestra el método de pago de la venta', /Método de pago/i.test(sinDif.texto));

  // ── 4) El apartado CONSERVA su vocabulario (los tres momentos reales) ─────
  console.log('\n── 4) Anticipo, abono y liquidación conservan su vocabulario ─────');
  const anticipo = await ver(() => {
    window.__reset();
    const D = window.DATA;
    const s = window.__vender('P-CARO', 'M', {
      clienteRegistrado: true,
      venta: { metodo: 'Apartado', estado: 'Apartado', anticipo: 300, pagoEfectivo: 300, pagoOtro: 0, pagoDetalle: { efectivo: 300 }, metodoPago: 'Efectivo' },
    });
    const pago = (D.paymentsForSale(s.folio) || []).find(p => p.tipo === 'anticipo');
    window.__mount({ sale: D.sales.find(x => x.folio === s.folio), payment: pago });
    window.__folioApartado = s.folio;
    return { tipo: pago && pago.tipo, saldo: s.saldo };
  });
  check('4a. el anticipo se acusa como anticipo de apartado',
    anticipo.meta.tipo === 'anticipo' && /Anticipo de apartado/i.test(anticipo.texto));
  check('4b. el apartado sigue diciendo APARTADO', /APARTADO/i.test(anticipo.texto));
  check('4c. y sigue mostrando mercancía apartada y saldo pendiente',
    /Mercancía apartada/i.test(anticipo.texto) && /Saldo pendiente/i.test(anticipo.texto));

  const abono = await ver(() => {
    const D = window.DATA;
    const folio = window.__folioApartado;
    const r = D.registrarPagoApartado(folio, { monto: 500, metodo: 'Tarjeta' });
    const pago = (D.paymentsForSale(folio) || []).find(p => p.tipo === 'abono');
    window.__mount({ sale: D.sales.find(x => x.folio === folio), payment: pago });
    return { ok: r.ok, tipo: pago && pago.tipo };
  });
  check('4d. el abono se acusa como abono a apartado',
    abono.meta.tipo === 'abono' && /Abono a apartado/i.test(abono.texto));
  check('4e. el abono conserva el vocabulario de apartado',
    /APARTADO/i.test(abono.texto) && /Saldo pendiente/i.test(abono.texto));

  const liquidacion = await ver(async () => {
    const D = window.DATA;
    const folio = window.__folioApartado;
    const sale = D.sales.find(x => x.folio === folio);
    const r = await D.registrarPagoApartado(folio, { monto: sale.saldo, metodo: 'Efectivo' });
    const pago = (D.paymentsForSale(folio) || []).find(p => p.tipo === 'liquidacion');
    window.__mount({ sale: D.sales.find(x => x.folio === folio), payment: pago });
    return { ok: r.ok, tipo: pago && pago.tipo };
  });
  check('4f. la liquidación se acusa como liquidación de apartado',
    liquidacion.meta.tipo === 'liquidacion' && /Liquidación de apartado/i.test(liquidacion.texto));
  check('4g. la liquidación conserva mercancía entregada y LIQUIDADO',
    /Mercancía entregada/i.test(liquidacion.texto) && /LIQUIDADO/.test(liquidacion.texto));

  // ── 5) Una venta simple no cambió ────────────────────────────────────────
  console.log('\n── 5) La venta de contado sigue igual ────────────────────────────');
  const venta = await ver(() => {
    window.__reset();
    const s = window.__vender('P-BARATO', 'S');
    window.__mount({ sale: window.DATA.sales.find(x => x.folio === s.folio) });
    return { folio: s.folio };
  });
  check('5a. la venta simple dice Transacción y Detalle de compra',
    /TRANSACCIÓN/i.test(venta.texto) && /Detalle de compra/i.test(venta.texto));
  check('5b. la venta simple no usa vocabulario de apartado',
    !APARTADO_RE.test(venta.texto), (venta.texto.match(APARTADO_RE) || [''])[0]);
  check('5c. la venta simple muestra su método de pago', /Método de pago/i.test(venta.texto));

  check('sin errores de consola durante el recorrido', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
