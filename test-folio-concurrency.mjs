// H-02 / H-33 — folio visible corto y único entre terminales, incluso sin conexión.
//
// Contrato vigente (H-33): el folio comercial es {PREFIJO}-{AAMMDD}-{0001} y NO
// contiene identidad técnica. La unicidad entre terminales la garantiza el
// contador diario de Supabase: cada terminal reserva un bloque y lo consume sin
// red. Sin bloque reservado el folio es PROVISIONAL y puede coincidir con el de
// otra terminal; ese caso se resuelve al sincronizar (`folio_conflict`) antes de
// que la venta exista en la nube, y está cubierto por test-store-queue 30f-30k.
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('.');
const server = http.createServer((req, res) => {
  const fp = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.slice(1)));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) {
    res.writeHead(404);
    res.end('nf');
    return;
  }
  res.writeHead(200, {
    'Content-Type': path.extname(fp) === '.html' ? 'text/html' : 'application/octet-stream',
  });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(resolve => server.listen(8816, '127.0.0.1', resolve));

let pass = 0;
let fail = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function terminal() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto('http://127.0.0.1:8816/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.DATA.nextFolio);
  return { context, page };
}

try {
  const a = await terminal();
  const b = await terminal();

  const hoy = await a.page.evaluate(() => window.DATA.businessDate());

  // 0) Dos terminales SIN bloque y SIN conexión: el folio provisional lleva el
  //    código de esta terminal, así que jamás se imprimen dos cadenas iguales.
  const [provA, provB] = await Promise.all([
    a.page.evaluate(() => window.DATA.nextFolio()),
    b.page.evaluate(() => window.DATA.nextFolio()),
  ]);
  check(
    'dos terminales sin bloque y sin conexión no imprimen la misma cadena',
    provA !== provB
      && new RegExp(`^[A-Z0-9]{1,6}-${hoy}-\\d{4,}-[A-Z0-9]{3}$`).test(provA)
      && new RegExp(`^[A-Z0-9]{1,6}-${hoy}-\\d{4,}-[A-Z0-9]{3}$`).test(provB),
    `${provA} / ${provB}`,
  );
  const codigos = await Promise.all([
    a.page.evaluate(() => window.DATA.parseFolio(window.DATA.nextFolio()).terminal),
    b.page.evaluate(() => window.DATA.parseFolio(window.DATA.nextFolio()).terminal),
  ]);
  check(
    'cada terminal conserva su propio código y se distingue del resto',
    codigos[0] !== codigos[1] && codigos.every(c => /^[A-Z0-9]{3}$/.test(c)),
    codigos.join(' / '),
  );

  // 1) Con bloque reservado, el formato comercial va limpio y sin identidad técnica.
  // El bloque llega por encima de lo ya entregado en modo provisional.
  const bloqueAceptado = await a.page.evaluate(d => window.DATA.applyFolioBlock('BG', d, 10, 30), hoy);
  const folioA = await a.page.evaluate(() => window.DATA.nextFolio());
  check('un bloque del servidor por encima del piso local se acepta', bloqueAceptado === true);
  check(
    'con bloque, el folio visible es PREFIJO-AAMMDD-0001 sin sufijo',
    new RegExp(`^[A-Z0-9]{1,6}-${hoy}-\\d{4,}$`).test(folioA) && folioA.length <= 20,
    folioA,
  );

  // 2) Una terminal nunca repite un número dentro del día.
  const folioA2 = await a.page.evaluate(() => window.DATA.nextFolio());
  check(
    'una terminal conserva una secuencia legible y no repite su folio',
    folioA2 !== folioA,
    `${folioA} / ${folioA2}`,
  );

  // 3) Dos terminales offline con bloques reservados del contador diario.
  await a.page.evaluate(d => window.DATA.applyFolioBlock('BG', d, 101, 110), hoy);
  await b.page.evaluate(d => window.DATA.applyFolioBlock('BG', d, 111, 120), hoy);
  const [bloqueA, bloqueB] = await Promise.all([
    a.page.evaluate(() => [window.DATA.nextFolio(), window.DATA.nextFolio()]),
    b.page.evaluate(() => [window.DATA.nextFolio(), window.DATA.nextFolio()]),
  ]);
  const todos = bloqueA.concat(bloqueB);
  check(
    'dos terminales sin conexión, con bloques reservados, no colisionan',
    new Set(todos).size === 4 && bloqueA[0].endsWith('-0101') && bloqueB[0].endsWith('-0111'),
    todos.join(' '),
  );

  // 4) Sin bloque vigente la terminal declara que necesita reserva; el folio
  //    provisional sigue siendo corto y la venta nunca se bloquea.
  const provisional = await b.page.evaluate(d => {
    window.DATA.applyFolioBlock('BG', d, 121, 121);
    const folio = window.DATA.nextFolio(); // agota el bloque
    return { folio, req: window.DATA.folioBlockRequest() };
  }, hoy);
  check(
    'al agotarse el bloque la terminal pide reposición y sigue emitiendo folio corto',
    provisional.req.needed === true && /-\d{4,}$/.test(provisional.folio),
    `${provisional.folio} · left=${provisional.req.left}`,
  );

  // 5) Reinstalación: identidad de terminal nueva y ningún folio reutilizado.
  const oldDevice = await a.page.evaluate(() => localStorage.getItem('balam_device_id'));
  await a.context.clearCookies();
  await a.page.evaluate(() => localStorage.clear());
  await a.page.reload({ waitUntil: 'load' });
  await a.page.waitForFunction(() => window.DATA && window.DATA.nextFolio);
  const afterReset = await a.page.evaluate(d => {
    // El contador remoto ya avanzó: el servidor entrega el siguiente rango libre.
    window.DATA.applyFolioBlock('BG', d, 201, 210);
    return window.DATA.nextFolio();
  }, hoy);
  const newDevice = await a.page.evaluate(() => localStorage.getItem('balam_device_id'));
  check(
    'borrar el navegador crea otra identidad de terminal',
    !!oldDevice && !!newDevice && oldDevice !== newDevice,
    `${oldDevice} / ${newDevice}`,
  );
  check(
    'una reinstalación no reutiliza un folio existente',
    !todos.includes(afterReset) && afterReset !== folioA && afterReset.endsWith('-0201'),
    `${folioA} / ${afterReset}`,
  );

  // 6) Alias del folio impreso en la interfaz real: ticket y Devoluciones.
  const alias = await b.page.evaluate(d => {
    const D = window.DATA;
    // Venta provisional ya impresa que después se reidentifica.
    const impreso = `BG-${d}-0301-K7Q`;
    D.sales.unshift({
      folio: impreso, _operationId: 'op-alias', _syncStatus: 'pending',
      fecha: `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)} 12:00`,
      cliente: 'Cliente alias', vendedor: '—', vendedores: [], items: 1,
      subtotal: 862.07, iva: 137.93, total: 1000, descuento: 0, ivaPct: 16, ivaIncluded: true,
      anticipo: 1000, saldo: 0, pagoEfectivo: 1000, pagoOtro: 0,
      metodo: 'Efectivo', estado: 'Pagado',
      lineas: [{ sku: 'SKU-ALIAS', nombre: 'Prenda', talla: 'M', qty: 1, precio: 1000, precioBase: 1000, precioOrig: 1000, promos: [] }],
    });
    D.saveSales();
    const ok = D.rekeySaleFolio('op-alias', impreso, `BG-${d}-0400`);
    const sale = D.findSaleByFolio(impreso);
    return {
      ok, impreso, vigente: sale && sale.folio,
      aliases: D.saleFolioAliases(sale),
      aviso: D.folioAliasHit(sale, impreso),
      devolvible: D.isReturnable(sale),
    };
  }, hoy);
  check(
    'el folio impreso sigue resolviendo a su venta tras la reidentificación',
    alias.ok && alias.vigente === `BG-${hoy}-0400` && alias.aliases.includes(alias.impreso)
      && alias.aviso === alias.impreso && alias.devolvible,
    `${alias.impreso} → ${alias.vigente}`,
  );

  // El ticket reimpreso conserva el folio que tiene el cliente en la mano.
  const ticket = await b.page.evaluate(() => {
    const sale = window.DATA.sales.find(s => s._operationId === 'op-alias');
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.ReactDOM.createRoot(host).render(window.React.createElement(window.BalamTicket, { sale }));
    return new Promise(r => setTimeout(() => r((document.querySelector('#balam-ticket') || host).innerText), 400));
  });
  check(
    'la reimpresión muestra el folio vigente y el folio impreso original',
    ticket.includes(`BG-${hoy}-0400`) && /ticket impreso/i.test(ticket) && ticket.includes(alias.impreso),
    ticket.split('\n').filter(l => l.includes(hoy) || l.includes('Ticket impreso')).join(' | '),
  );

  // Devoluciones: buscar por el folio impreso avisa con qué quedó registrada.
  await b.page.evaluate(() => { localStorage.setItem('balam-page', 'devoluciones'); localStorage.setItem('balam-sidebar', '0'); });
  await b.page.reload({ waitUntil: 'load' });
  await b.page.waitForFunction(() => document.querySelector('header h1')
    && document.querySelector('header h1').textContent.trim() === 'Devoluciones', null, { timeout: 30000 });
  await b.page.waitForTimeout(600);
  await b.page.fill('input[placeholder="Buscar por folio o cliente…"]', alias.impreso);
  await b.page.waitForTimeout(600);
  const pantalla = await b.page.evaluate(() => document.body.innerText);
  check(
    'Devoluciones encuentra la venta por el folio impreso y avisa el folio actual',
    pantalla.includes(alias.impreso) && pantalla.includes(`registrado como BG-${hoy}-0400`),
    pantalla.split('\n').filter(l => l.includes('registrado como')).join(' | ') || '(sin aviso)',
  );

  await a.context.close();
  await b.context.close();
} finally {
  await browser.close();
  server.close();
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
