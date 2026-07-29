// test-layaway-screen.mjs — H-40: recorrido funcional de la pantalla de Apartados
// sobre el BUNDLE distribuido (index.html), no sobre la fuente.
//
// Cubre el flujo que el negocio va a usar de punta a punta:
//   apartado creado en el POS → pantalla en el menú lateral → KPIs de cartera →
//   filtros → captura de un abono parcial con forma de pago → comprobante térmico →
//   validaciones de captura → liquidación → efectos de dominio (stock, estado) →
//   salidas (Excel y listado impreso).
//
// Las aserciones sobre texto van sin distinguir mayúsculas: la tipografía Heritage
// aplica `text-transform: uppercase` y `innerText` devuelve el texto ya transformado.
//
// Supabase queda interceptado: no se escribe una sola fila en la nube.
//
// Uso: node test-layaway-screen.mjs
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
await new Promise(r => server.listen(8821, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort());
  // La impresión abriría un diálogo nativo que bloquea el navegador headless.
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await page.goto('http://127.0.0.1:8821/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 25000 });

  // Utilidades de interacción. Los rótulos se comparan sin distinguir mayúsculas y
  // sobre la ÚLTIMA línea del botón: los botones Heritage anteponen el nombre del
  // ícono Material como texto ("payments\nAbonar").
  const texto = () => page.evaluate(() => document.body.innerText);
  const clickBtn = (patron) => page.evaluate((p) => {
    const re = new RegExp(p, 'i');
    const rotulo = el => { const l = el.innerText.split('\n').map(s => s.trim()).filter(Boolean); return l.length ? l[l.length - 1] : ''; };
    const b = [...document.querySelectorAll('button')].find(x => re.test(rotulo(x)));
    if (b) b.click();
    return !!b;
  }, patron.source || patron);
  const setNumero = (valor) => page.evaluate((v) => {
    const inp = document.querySelector('input[type="number"]');
    if (!inp) return false;
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(inp, v); inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, valor);

  // ── Semilla: un apartado real creado por la autoridad de dominio ────────────
  const seed = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; window.STORE.pushSale = () => {}; }
    D.sales.length = 0; D.payments.length = 0; D.products.length = 0;
    // Plazo de devolución activo: así se comprueba que la liquidación lo arranca (H-34).
    window.CONFIG.setSetting('returns.limitEnabled', true);
    window.CONFIG.setSetting('returns.limitDays', 15);
    const talla = D.SIZES_LETRA[1];
    D.products.push(D.hydrate({
      id: 'h40', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
      modelo: '940', nombre: 'GUAYABERA H40', orn: '—', ornColors: [], precio: 1000,
      costo: 0, pop: false, stock: D.mkStock([0, 5, 0], []),
    }));
    D.saveProducts();
    const p = D.products[0];
    const cliente = { id: 'cli-h40', nombre: 'Cliente Apartado', generic: false };
    if (!D.clients.find(c => c.id === cliente.id)) D.clients.push(cliente);
    const venta = D.recordSale({
      ticket: [{ p, talla, qty: 2, res: { unit: 1000, orig: 1000, promos: [] } }],
      sellerIds: D.sellers.length ? [D.sellers[0].id] : [], client: cliente,
      metodo: 'Apartado', estado: 'Apartado', subtotal: 1724.14, iva: 275.86, total: 2000,
      anticipo: 500, pagoEfectivo: 500, pagoOtro: 0, pagoDetalle: { efectivo: 500 },
      metodoPago: 'Efectivo', ivaPct: 16, ivaIncluded: true, itemCount: 2,
    });
    return { folio: venta.folio, talla, saldo: venta.saldo, stock: D.stockOf(p, talla), plazo: venta.returnExpiresAt || null, limite: venta.returnLimitDays };
  });
  check('el apartado nace con saldo y sin descontar inventario', seed.saldo === 1500 && seed.stock === 5, `saldo ${seed.saldo} · stock ${seed.stock}`);
  check('el plazo de devolución queda congelado mientras haya saldo', seed.limite === 15 && seed.plazo === null);

  console.log('\n── A) La pantalla existe en el menú lateral ─────────────');
  const navOk = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav button')].find(x => /Apartados/i.test(x.innerText));
    if (btn) btn.click();
    return !!btn;
  });
  await page.waitForTimeout(800);
  check('«Apartados» aparece en el menú lateral', navOk);
  const cabecera = await texto();
  check('la pantalla propia se abre y no el panel', /saldo por cobrar/i.test(cabecera) && /piezas comprometidas/i.test(cabecera));
  check('la pantalla lista el apartado sembrado', cabecera.includes(seed.folio));

  console.log('\n── B) KPIs de la cartera ────────────────────────────────');
  check('KPI de saldo por cobrar', /saldo por cobrar/i.test(cabecera) && /\$1,500/.test(cabecera));
  check('KPI de anticipos y abonos cobrados', /anticipos y abonos/i.test(cabecera) && /\$500/.test(cabecera) && /de \$2,000 comprometidos/i.test(cabecera));
  check('KPI de piezas comprometidas', /piezas comprometidas/i.test(cabecera) && /aún no descontadas/i.test(cabecera));
  check('KPI de antigüedad', /apartado más antiguo/i.test(cabecera));
  check('la fila muestra el avance de pago', /25% pagado · \$500 de \$2,000/i.test(cabecera));

  console.log('\n── C) Filtros ───────────────────────────────────────────');
  check('existe el filtro «Solo anticipo»', await clickBtn(/^solo anticipo$/));
  await page.waitForTimeout(350);
  check('«Solo anticipo» conserva el apartado sin abonos', (await texto()).includes(seed.folio));
  await clickBtn(/^con abonos$/);
  await page.waitForTimeout(350);
  check('«Con abonos» lo excluye mientras no tenga abonos', !(await texto()).includes(seed.folio));
  await clickBtn(/^todos$/);
  await page.waitForTimeout(350);
  check('«Todos» lo devuelve a la lista', (await texto()).includes(seed.folio));

  console.log('\n── D) Acciones de la fila ───────────────────────────────');
  // Detalle desplegable: mercancía e historial sin salir de la pantalla.
  const abrioDetalle = await page.evaluate(() => {
    const b = document.querySelector('button[title="Ver detalle y pagos"]');
    if (b) b.click();
    return !!b;
  });
  await page.waitForTimeout(400);
  const detalle = await texto();
  check('la fila despliega su detalle', abrioDetalle && /mercancía apartada/i.test(detalle));
  check('el detalle muestra la mercancía real', /guayabera h40/i.test(detalle) && /talla/i.test(detalle));
  check('el detalle muestra el historial de pagos', /historial de pagos/i.test(detalle) && /anticipo · efectivo/i.test(detalle));
  await page.evaluate(() => { const b = document.querySelector('button[title="Ocultar detalle"]'); if (b) b.click(); });
  await page.waitForTimeout(300);
  check('el detalle se puede cerrar', !/mercancía apartada/i.test(await texto()));

  // Reimpresión sin cobrar: monta el ticket y lo manda a la impresora.
  const antes = await page.evaluate(() => window.__printed || 0);
  const reimprimio = await page.evaluate(() => {
    const b = document.querySelector('button[title^="Reimprimir"]');
    if (b) b.click();
    return !!b;
  });
  await page.waitForTimeout(600);
  const trasReimprimir = await page.evaluate(() => ({
    impresiones: window.__printed || 0,
    montado: !!document.querySelector('#balam-ticket'),
  }));
  check('la fila reimprime el comprobante sin cobrar', reimprimio && trasReimprimir.impresiones === antes + 1);
  check('el ticket se desmonta tras reimprimir', !trasReimprimir.montado);

  console.log('\n── D2) Captura del abono ────────────────────────────────');
  check('la fila ofrece abonar', await clickBtn(/^abonar$/));
  await page.waitForTimeout(500);
  const modal = await texto();
  check('el modal de abono abre con el saldo del apartado', /abonar a apartado/i.test(modal) && /saldo pendiente/i.test(modal));
  check('el modal ofrece formas de pago', /forma de pago/i.test(modal) && /efectivo/i.test(modal) && /tarjeta/i.test(modal));
  check('el modal propone liquidar el total', /liquidar todo/i.test(modal));

  // Validación de captura: un monto mayor al saldo no se puede confirmar.
  const puso = await setNumero('99999');
  await page.waitForTimeout(300);
  const btnBloqueado = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /registrar abono|liquidar apartado/i.test(x.innerText));
    return b ? b.disabled : null;
  });
  check('un abono mayor al saldo queda bloqueado en la captura', puso && btnBloqueado === true);

  // Abono parcial con tarjeta.
  await setNumero('600');
  check('el modal permite elegir tarjeta como forma del abono', await clickBtn(/^tarjeta$/));
  await page.waitForTimeout(350);
  const previo = await texto();
  check('el modal anticipa el saldo resultante', /saldo después del abono/i.test(previo) && /\$900/.test(previo));
  await clickBtn(/registrar abono/);
  await page.waitForTimeout(800);

  const trasAbono = await page.evaluate((folio) => {
    const D = window.DATA;
    const s = D.sales.find(x => x.folio === folio);
    const pagos = D.paymentsForSale(folio);
    const ult = pagos[pagos.length - 1];
    return {
      estado: s.estado, saldo: s.saldo,
      tipo: ult.tipo, metodo: ult.metodo, monto: ult.monto, tarjeta: ult.tarjeta,
      texto: document.body.innerText,
      ticket: document.querySelector('#balam-ticket') ? document.querySelector('#balam-ticket').innerText : '',
    };
  }, seed.folio);
  check('el abono se asienta con su forma de pago', trasAbono.tipo === 'abono' && trasAbono.metodo === 'Tarjeta' && trasAbono.monto === 600 && trasAbono.tarjeta === 600);
  check('el saldo baja y el apartado sigue abierto', trasAbono.saldo === 900 && trasAbono.estado === 'Apartado');
  check('se confirma el abono en pantalla', /abono registrado/i.test(trasAbono.texto));

  console.log('\n── E) Comprobante impreso ───────────────────────────────');
  check('el comprobante es el ticket del negocio, no un formato aparte',
    /balam/i.test(trasAbono.ticket) && /importe/i.test(trasAbono.ticket) && /iva \(16%\)/i.test(trasAbono.ticket) && /total a pagar/i.test(trasAbono.ticket));
  check('el comprobante declara el pago recibido hoy',
    /abono a apartado/i.test(trasAbono.ticket) && /\$600\.00/.test(trasAbono.ticket) && /recibido en tarjeta/i.test(trasAbono.ticket));
  check('el comprobante trae la mercancía real con su precio',
    /mercancía apartada/i.test(trasAbono.ticket) && /guayabera h40/i.test(trasAbono.ticket) && /\$2,000\.00/.test(trasAbono.ticket));
  check('el comprobante trae pagado y saldo', /pagado a la fecha/i.test(trasAbono.ticket) && /\$1,100\.00/.test(trasAbono.ticket) && /saldo pendiente/i.test(trasAbono.ticket) && /\$900\.00/.test(trasAbono.ticket));
  check('el historial de pagos va al pie con fecha, concepto y método',
    /historial de pagos/i.test(trasAbono.ticket) && /anticipo · efectivo/i.test(trasAbono.ticket) && /abono · tarjeta/i.test(trasAbono.ticket));
  check('el historial marca el pago de este comprobante y suma el total',
    /este pago/i.test(trasAbono.ticket) && /total pagado \(2 movimientos\)/i.test(trasAbono.ticket));
  check('el comprobante identifica el apartado y al cliente', trasAbono.ticket.includes(seed.folio) && /cliente apartado/i.test(trasAbono.ticket));
  check('el comprobante avisa que la mercancía se entrega al liquidar', /se entrega al liquidar el saldo/i.test(trasAbono.ticket));
  const impreso = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(x => /imprimir comprobante/i.test(x.innerText));
    if (b) b.click();
    return window.__printed || 0;
  });
  check('el botón de impresión envía el comprobante', impreso >= 1);
  await clickBtn(/^listo$/);
  await page.waitForTimeout(500);

  console.log('\n── F) Liquidación ───────────────────────────────────────');
  await clickBtn(/^abonar$/);
  await page.waitForTimeout(500);
  await clickBtn(/liquidar todo/);
  await page.waitForTimeout(350);
  const textoLiquida = await texto();
  check('liquidar el saldo se anuncia antes de confirmar',
    /liquidar apartado/i.test(textoLiquida) && /se descuenta el inventario/i.test(textoLiquida));
  await clickBtn(/liquidar apartado/);
  await page.waitForTimeout(900);

  const trasLiquidar = await page.evaluate((seed) => {
    const D = window.DATA;
    const s = D.sales.find(x => x.folio === seed.folio);
    const p = D.products.find(x => x.id === 'h40');
    const pagos = D.paymentsForSale(seed.folio);
    return {
      estado: s.estado, saldo: s.saldo, anticipo: s.anticipo,
      stock: D.stockOf(p, seed.talla), plazo: s.returnExpiresAt || null,
      tipoUlt: pagos[pagos.length - 1].tipo,
      ticket: document.querySelector('#balam-ticket') ? document.querySelector('#balam-ticket').innerText : '',
    };
  }, seed);
  check('la liquidación deja la venta pagada y sin saldo', trasLiquidar.estado === 'Pagado' && trasLiquidar.saldo === 0 && trasLiquidar.anticipo === 2000);
  check('la liquidación descuenta el inventario', trasLiquidar.stock === 3, `stock ${trasLiquidar.stock}`);
  check('la liquidación arranca el plazo de devolución', !!trasLiquidar.plazo);
  check('el último pago se marca como liquidación', trasLiquidar.tipoUlt === 'liquidacion');
  check('el comprobante de liquidación lo dice', /liquidación de apartado/i.test(trasLiquidar.ticket) && /liquidado/i.test(trasLiquidar.ticket));
  check('el comprobante de liquidación declara la entrega', /mercancía entregada/i.test(trasLiquidar.ticket));
  check('el comprobante de liquidación cierra el historial completo',
    /total pagado \(3 movimientos\)/i.test(trasLiquidar.ticket) && /\$2,000\.00/.test(trasLiquidar.ticket));
  await clickBtn(/^listo$/);
  await page.waitForTimeout(600);
  check('el apartado liquidado sale de la cartera', /no hay apartados abiertos/i.test(await texto()));

  console.log('\n── G) Salidas del reporte ───────────────────────────────');
  const salidas = await page.evaluate(() => ({
    excel: typeof window.XLSXIO.exportLayaways === 'function',
    botonExcel: [...document.querySelectorAll('button')].some(x => /exportar excel/i.test(x.innerText)),
    botonPrint: [...document.querySelectorAll('button')].some(x => /imprimir listado/i.test(x.innerText)),
  }));
  check('existe la exportación a Excel de apartados', salidas.excel);
  check('la pantalla ofrece exportar a Excel', salidas.botonExcel);
  check('la pantalla ofrece imprimir el listado', salidas.botonPrint);

  // El listado impreso se arma en una ventana propia (mismo idioma que las etiquetas
  // de Inventario). Se intercepta window.open para verificar el documento generado.
  const listado = await page.evaluate(() => {
    const D = window.DATA;
    const base = D.sales[0];
    D.sales.push(Object.assign({}, base, {
      folio: 'H40-PRINT', estado: 'Apartado', total: 800, anticipo: 300, saldo: 500,
      cliente: 'Cliente Impreso <script>', items: 1,
    }));
    D.saveSales();
    let html = '';
    const real = window.open;
    window.open = () => ({ document: { write: s => { html += s; }, close: () => {} } });
    window.dispatchEvent(new Event('configchange'));
    return new Promise(res => setTimeout(() => {
      const b = [...document.querySelectorAll('button')].find(x => /imprimir listado/i.test(x.innerText));
      if (b) b.click();
      window.open = real;
      setTimeout(() => res(html), 100);
    }, 500));
  });
  check('el listado impreso trae encabezado, totales y filas',
    /apartados por cobrar/i.test(listado) && /saldo por cobrar/i.test(listado) && /H40-PRINT/.test(listado) && /totales/i.test(listado),
    listado ? '' : 'documento vacío');
  check('el listado impreso escapa el contenido del negocio', /Cliente Impreso &lt;script&gt;/.test(listado));
  check('el listado impreso no pide red', !/<script[^>]*src=/i.test(listado) && !/https?:\/\//.test(listado));

  check('sin errores de consola durante el recorrido', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
