// test-ticket-print.mjs — H-41: el comprobante impreso no se corta.
//
// El defecto: `#balam-ticket` estaba `position: fixed`, así que no formaba parte del
// flujo del documento. Al imprimir, la altura imprimible era la de la ventana y todo
// lo que sobrepasaba —el historial de pagos, que va al pie— no llegaba al papel. Con
// cada abono el comprobante crecía y el corte caía en otro sitio: de ahí que dos
// tickets del mismo apartado se vieran distintos.
//
// Este arnés mide sobre el BUNDLE distribuido (index.html) en medio `print` e imprime
// a PDF de verdad. Comprueba que el ticket está en el flujo, que el documento tiene
// una página de altura variable (H-135) y que nada del contenido queda fuera.
//
// Uso: node test-ticket-print.mjs
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
await new Promise(r => server.listen(8833, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };
// Altura carta previa al arreglo: conserva el umbral del caso largo de H-41.
const ALTO_HOJA = 1056;
const cabeEntero = m => m.hojas === 1 && Math.abs(m.anchoMm - 80) < 0.4
  && m.altoMm * 96 / 25.4 >= m.alturaTicket - 2;

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort());
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await page.goto('http://127.0.0.1:8833/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 25000 });

  // Mide el comprobante montado tal y como se imprimiría, y cuenta las hojas del PDF.
  async function medirImpresion(etiqueta) {
    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const t = document.querySelector('#balam-ticket');
      if (!t) return null;
      const cs = getComputedStyle(t);
      const root = document.getElementById('root');
      return {
        position: cs.position,
        hijoDeBody: t.parentElement === document.body,
        alturaTicket: Math.round(t.getBoundingClientRect().height),
        alturaDocumento: Math.round(document.documentElement.scrollHeight),
        appOculta: root ? getComputedStyle(root).display === 'none' : false,
        montados: document.querySelectorAll('#balam-ticket').length,
        texto: t.innerText,
      };
    });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const raw = pdf.toString('latin1');
    const counts = [...raw.matchAll(/\/Count\s+(\d+)/g)].map(x => Number(x[1]));
    m.hojas = counts.length ? Math.max(...counts) : 0;
    const box = raw.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    m.anchoMm = box ? Number(box[1]) * 25.4 / 72 : 0;
    m.altoMm = box ? Number(box[2]) * 25.4 / 72 : 0;
    await page.emulateMedia({ media: 'screen' });
    await page.waitForTimeout(150);
    console.log(`   · ${etiqueta}: ticket ${m.alturaTicket}px · documento ${m.alturaDocumento}px · ${m.hojas} hoja(s)`);
    return m;
  }

  const rot = el => { const l = el.innerText.split('\n').map(s => s.trim()).filter(Boolean); return l.length ? l[l.length - 1] : ''; };
  const clickBtn = (p) => page.evaluate((p) => {
    const re = new RegExp(p, 'i');
    const r = el => { const l = el.innerText.split('\n').map(s => s.trim()).filter(Boolean); return l.length ? l[l.length - 1] : ''; };
    const b = [...document.querySelectorAll('button')].find(x => re.test(r(x)));
    if (b) b.click(); return !!b;
  }, p);
  const setNum = v => page.evaluate(v => {
    const inp = document.querySelector('input[type="number"]'); if (!inp) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(inp, v); inp.dispatchEvent(new Event('input', { bubbles: true })); return true;
  }, v);

  // ── Semilla: apartado de varias piezas, para que el comprobante sea largo ────
  const seed = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; window.STORE.pushSale = () => {}; }
    D.sales.length = 0; D.payments.length = 0; D.products.length = 0;
    const mk = (id, nombre, precio, modelo) => D.products.push(D.hydrate({
      id, cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo,
      nombre, orn: '—', ornColors: [], precio, costo: 0, pop: false, stock: D.mkStock([9, 9, 9], []),
    }));
    mk('t1', 'GUAYABERA LINO BLANCA', 1850, '901');
    mk('t2', 'GUAYABERA MANGA LARGA AZUL', 2100, '902');
    D.saveProducts();
    const [p1, p2] = D.products, t = D.SIZES_LETRA[1];
    const cliente = { id: 'c-h41', nombre: 'María Fernanda Uc Canché', generic: false, tel: '999 123 4567' };
    if (!D.clients.find(c => c.id === cliente.id)) D.clients.push(cliente);
    const v = D.recordSale({
      ticket: [{ p: p1, talla: t, qty: 2, res: { unit: 1850, orig: 1850, promos: [] } }, { p: p2, talla: t, qty: 1, res: { unit: 2100, orig: 2100, promos: [] } }],
      sellerIds: D.sellers.length ? [D.sellers[0].id] : [], client: cliente,
      metodo: 'Apartado', estado: 'Apartado', subtotal: 5000, iva: 800, total: 5800,
      anticipo: 1000, pagoEfectivo: 1000, pagoOtro: 0, pagoDetalle: { efectivo: 1000 },
      metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 3,
    });
    return { folio: v.folio };
  });
  await page.evaluate(() => { const b = [...document.querySelectorAll('nav button')].find(x => /Apartados/i.test(x.innerText)); if (b) b.click(); });
  await page.waitForTimeout(800);

  async function abonar(monto, metodo) {
    await clickBtn('^abonar$');
    await page.waitForTimeout(400);
    await setNum(String(monto));
    await clickBtn('^' + metodo + '$');
    await page.waitForTimeout(250);
    await clickBtn('registrar abono');
    await page.waitForTimeout(700);
  }
  const cerrar = async () => { await clickBtn('^listo$'); await page.waitForTimeout(500); };

  console.log('\n── A) El comprobante está en el flujo del documento ──────');
  await abonar(1500, 'tarjeta');
  const m1 = await medirImpresion('1er abono');
  check('el comprobante existe al imprimir', !!m1 && m1.montados === 1);
  check('el comprobante cuelga directo de <body>', m1.hijoDeBody, 'portal fuera de los contenedores con scroll');
  check('el comprobante NO es position:fixed al imprimir', m1.position === 'static', `position=${m1.position}`);
  check('la app no se imprime', m1.appOculta);
  check('el documento mide lo que mide el comprobante', Math.abs(m1.alturaDocumento - m1.alturaTicket) <= 2,
    `documento ${m1.alturaDocumento}px vs ticket ${m1.alturaTicket}px`);

  console.log('\n── B) Nada del comprobante se queda fuera del papel ──────');
  check('el comprobante es más alto que una hoja (caso del defecto)', m1.alturaTicket > ALTO_HOJA, `${m1.alturaTicket}px > ${ALTO_HOJA}px`);
  check('el PDF contiene todo en una página térmica continua', cabeEntero(m1),
    `${m1.hojas} hoja(s) · ${m1.anchoMm.toFixed(2)} × ${m1.altoMm.toFixed(2)} mm`);
  check('el historial de pagos entra en lo impreso', /historial de pagos/i.test(m1.texto) && /total pagado/i.test(m1.texto));
  check('el pie del comprobante entra en lo impreso', /balamguayaberas\.com/i.test(m1.texto));
  await cerrar();

  console.log('\n── C) Cada abono conserva el historial completo ──────────');
  await abonar(1200, 'transferencia');
  const m2 = await medirImpresion('2º abono');
  check('el 2º comprobante también trae el historial', /historial de pagos/i.test(m2.texto));
  check('el 2º comprobante lista los tres movimientos',
    /anticipo · efectivo/i.test(m2.texto) && /abono · tarjeta/i.test(m2.texto) && /abono · transferencia/i.test(m2.texto));
  check('el 2º comprobante suma los tres', /total pagado \(3 movimientos\)/i.test(m2.texto) && /\$3,700\.00/.test(m2.texto));
  check('el 2º comprobante sigue cabiendo entero', cabeEntero(m2), `${m2.hojas} hoja(s) para ${m2.alturaTicket}px`);
  await cerrar();

  await abonar(900, 'efectivo');
  const m3 = await medirImpresion('3er abono');
  check('el 3er comprobante trae los cuatro movimientos', /total pagado \(4 movimientos\)/i.test(m3.texto) && /\$4,600\.00/.test(m3.texto));
  check('el 3er comprobante marca el pago de hoy', /\(este pago\)/i.test(m3.texto));
  check('el 3er comprobante sigue cabiendo entero', cabeEntero(m3), `${m3.hojas} hoja(s) para ${m3.alturaTicket}px`);
  check('el comprobante crece con cada abono y no se recorta', m3.alturaTicket > m1.alturaTicket,
    `${m1.alturaTicket}px → ${m3.alturaTicket}px`);
  await cerrar();

  console.log('\n── D) El ticket de venta del POS hereda el arreglo ───────');
  // Una venta larga sufría el mismo corte: se comprueba con el ticket del Punto de venta.
  const ventaLarga = await page.evaluate(() => {
    const D = window.DATA;
    const p = D.products[0], t = D.SIZES_LETRA[1];
    const lineas = [];
    for (let i = 0; i < 6; i++) lineas.push({ p, talla: D.SIZES_LETRA[i % 3], qty: 1, res: { unit: 1850, orig: 1850, promos: [] } });
    const v = D.recordSale({
      ticket: lineas, sellerIds: D.sellers.length ? [D.sellers[0].id] : [],
      client: D.clients.find(c => c.generic) || D.clients[0],
      metodo: 'Efectivo', estado: 'Pagado', subtotal: 9568.97, iva: 1531.03, total: 11100,
      pagoEfectivo: 11100, pagoOtro: 0, pagoDetalle: { efectivo: 11100 }, metodoPago: 'Efectivo',
      ivaPct: 16, ivaIncluded: true, itemCount: 6,
    });
    // Se monta el mismo componente del POS, sin pasar por la pantalla de cobro.
    const host = document.createElement('div');
    host.id = 'h41-host';
    document.body.appendChild(host);
    ReactDOM.createRoot(host).render(React.createElement(window.BalamTicket, { sale: v }));
    return { folio: v.folio };
  });
  await page.waitForTimeout(600);
  const mv = await medirImpresion('venta de 6 renglones');
  check('el ticket de venta también cuelga de <body>', mv.hijoDeBody);
  check('el ticket de venta cabe entero en el papel', cabeEntero(mv),
    `${mv.hojas} hoja(s) para ${mv.alturaTicket}px`);
  check('el ticket de venta conserva su formato de siempre',
    /detalle de compra/i.test(mv.texto) && /total a pagar/i.test(mv.texto) && /método de pago/i.test(mv.texto));
  check('el ticket de venta no habla de cobranza', !/abono a apartado/i.test(mv.texto) && !/saldo pendiente/i.test(mv.texto));
  check('la venta larga es el caso que antes se cortaba', mv.alturaTicket > ALTO_HOJA, `${mv.alturaTicket}px`);

  check('sin errores de consola durante el recorrido', errs.length === 0, errs.join(' | '));
  console.log(`\n   folio del apartado: ${seed.folio} · venta: ${ventaLarga.folio}`);
} finally {
  await b.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
