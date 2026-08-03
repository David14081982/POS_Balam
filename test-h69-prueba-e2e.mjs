// test-h69-prueba-e2e.mjs — H-69 · Recorrido completo con el perfil REAL de
// produccion que reporto el defecto.
//
// El perfil y la politica NO son inventados: se copian tal cual los devolvio la
// lectura de la base el 03/08/2026.
//
//   PRUEBA | 8946790c-8cbc-45b0-ad50-0cb74a0b0126 | role=vendedor | active
//   comision_pct=0.00 | override=NULL | version=1 | nivel=NULL | meta=0.00
//   commission.basePct=3 · goalPct=4 · surplusPct=5 · umbral=120 · base=neto
//
// Se comprueba lo que el dueno pidio: que ANTES de cobrar la ficha diga 3 %, que
// la venta congele ese 3 %, que suba el acumulado, que Vendedores, el detalle y
// Reportes den el MISMO importe, que otra terminal resuelva igual y que un
// reintento no duplique nada.
import http from 'http'; import fs from 'fs'; import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve('.');
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'node_modules/playwright-core/index.mjs')).href);
const server = http.createServer((req, res) => {
  const fp = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0].slice(1)));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': path.extname(fp) === '.html' ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8885, '127.0.0.1', r));

let pass = 0, fail = 0;
const ck = (n, c, d = '') => { console.log(`${c ? '✅' : '❌'} ${n}${c || !d ? '' : ' · ' + d}`); c ? pass++ : fail++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errores = [];
page.on('pageerror', e => errores.push(String(e)));
await page.route(/supabase\.co/, r => r.abort());
await page.goto('http://127.0.0.1:8885/', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG && window.SellersScreen);

const out = await page.evaluate(async () => {
  const D = window.DATA, C = window.CONFIG, R = [];
  const ck = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });
  const cerca = (a, b, e = 0.02) => Math.abs(Number(a) - Number(b)) <= e;

  // Politica REAL de produccion tras las migraciones del 03/08.
  C.setSetting('commission.basePct', 3);
  C.setSetting('commission.goalPct', 4);
  C.setSetting('commission.surplusPct', 5);
  C.setSetting('commission.surplusThresholdPct', 120);
  C.setSetting('commission.base', 'neto');

  // Fila REAL de PRUEBA.
  const PRUEBA = {
    id: '8946790c-8cbc-45b0-ad50-0cb74a0b0126', nombre: 'PRUEBA', iniciales: 'PR',
    color: '#64748b', comisionPct: 0, commissionOverridePct: null, sellerLevelCode: null,
    commissionPolicyVersion: 1, metaMes: 0, ventasMes: 0, ventasNum: 0, comisionAcum: 0,
    bono: 'Sin bono', role: 'vendedor', email: null, passwordHash: null, active: true,
  };
  D.sellers.push(PRUEBA);
  const S = () => D.sellers.find(x => x.id === PRUEBA.id) || {};

  // ── 1) ANTES de cobrar, la ficha dice 3 % ─────────────────────────────────
  const pol = D.resolveSellerCommission(S());
  ck('1 · la ficha de PRUEBA muestra 3 % antes de cobrar', pol.effectivePct === 3, pol.effectivePct + '%');
  ck('1 · el origen es el porcentaje base de la tienda', pol.source === 'general', pol.source);
  ck('1 · la etiqueta de origen es legible',
    D.commissionSourceLabel(pol.source) === 'Porcentaje base de la tienda',
    D.commissionSourceLabel(pol.source));
  ck('1 · es elegible como vendedor del POS', D.isEligibleSeller(S()) === true);

  // ── 2) Venta de $1,150, la misma cifra que reporto el dueno ───────────────
  const pushes = [];
  window.STORE.pushSale = (sale, eff) => pushes.push({ folio: sale.folio, comision: sale.comision, eff });
  window.STORE.pushRows = () => {}; window.STORE.settleCommission = () => {};
  const tallas = C.codes('size_letter');
  const p = D.hydrate({ id: 'pr-1', cat: '21', manga: 'ML', tela: 'ALG', color: C.codes('color')[0],
    cuello: 'NOR', modelo: 'PR1', nombre: 'Camisa PRUEBA', precio: 1150, costo: 300,
    sizeCategoryId: 'size_letter', attrs: { __sizeCategoryId: 'size_letter' },
    stock: tallas.map(t => ({ talla: t, escala: 'L', stock: 20 })) });
  D.products.push(p);
  const cli = { id: 'pr-c', nombre: 'Cliente PRUEBA', tel: '1', compras: 0, total: 0, generic: false };
  D.clients.push(cli);
  const talla = tallas[1];
  const ticket = [{ p, talla, qty: 1, res: D.resolveLineDiscount(p, talla) }];
  const q = D.saleQuote(ticket, []);
  const venta = D.recordSale({ ticket, additionalDiscounts: [], quote: q, sellerIds: [PRUEBA.id],
    client: cli, metodo: 'Efectivo', estado: 'Pagado', subtotal: q.subtotal, iva: q.iva,
    total: q.finalTotal, anticipo: q.finalTotal, pagoEfectivo: q.finalTotal, pagoOtro: 0,
    metodoPago: 'Efectivo', pagoDetalle: { efectivo: q.finalTotal }, ivaPct: 16,
    ivaIncluded: true, itemCount: 1 });

  const neto = Math.round((1150 / 1.16) * 100) / 100;      // 991.38
  const esperada = Math.round(neto * 3) / 100;              // 29.74
  ck('2 · el total es $1,150', venta.total === 1150, venta.total);
  ck('2 · la base comisionable es el neto sin IVA', cerca((venta.comisiones[0] || {}).base, neto),
    `${(venta.comisiones[0] || {}).base} vs ${neto}`);
  ck('2 · la venta congela el 3 %', (venta.comisiones[0] || {}).pct === 3, (venta.comisiones[0] || {}).pct);
  ck('2 · la comision registrada NO es cero', venta.comision > 0, venta.comision);
  ck('2 · la comision es el 3 % del neto', cerca(venta.comision, esperada),
    `${venta.comision} vs ${esperada}`);
  ck('2 · congela el seller_id, no el nombre',
    (venta.comisiones[0] || {}).sellerId === PRUEBA.id, (venta.comisiones[0] || {}).sellerId);
  ck('2 · congela origen y version de politica',
    (venta.comisiones[0] || {}).source === 'general' && (venta.comisiones[0] || {}).policyVersion === 1);

  // ── 3) Sube el acumulado y viaja el delta ────────────────────────────────
  ck('3 · aumenta comision_acum', cerca(S().comisionAcum, esperada), S().comisionAcum);
  const eff = ((pushes[0] || {}).eff || {}).sellerEffects || [];
  ck('3 · el delta enviado a pos.sellers lleva la comision',
    eff.length === 1 && cerca(eff[0].comision_acum_delta, esperada), JSON.stringify(eff));
  ck('3 · el delta identifica al vendedor por id', (eff[0] || {}).id === PRUEBA.id);

  // ── 4) Vendedores, detalle y Reportes: el MISMO importe ──────────────────
  const periodo = D.currentPeriodPredicate();
  const led = D.commissionLedger(periodo).find(r => r.vendedorId === PRUEBA.id) || {};
  const detalle = D.saleFrozenCommissions(venta)
    .filter(c => c.sellerId === PRUEBA.id).reduce((a, c) => a + c.monto, 0);
  ck('4 · Vendedores (pendiente) = la comision de la venta', cerca(led.pendiente, esperada), led.pendiente);
  ck('4 · detalle de la venta = la misma cifra', cerca(detalle, esperada), detalle);
  ck('4 · Reportes (generado) = la misma cifra', cerca(led.generado, esperada), led.generado);
  ck('4 · el acumulado y el saldo derivado no descuadran',
    cerca(led.descuadre || 0, 0), led.descuadre);

  // ── 5) Otra terminal obtiene el mismo porcentaje ─────────────────────────
  // Se simula la confirmacion remota: la fila del vendedor se REEMPLAZA con la
  // que devuelve la nube, como en una segunda terminal tras el pull.
  const congelado = JSON.stringify(venta.comisiones);
  D.applyRemote('sellers', D.sellers.map(x => Object.assign({}, x,
    { _syncVersion: (Number(x._syncVersion) || 0) + 1 })));
  const polB = D.resolveSellerCommission(S());
  ck('5 · otra terminal resuelve el mismo 3 %', polB.effectivePct === 3 && polB.source === 'general',
    `${polB.effectivePct} ${polB.source}`);
  ck('5 · lo congelado en la venta no cambia tras el pull',
    JSON.stringify(D.sales.find(x => x.folio === venta.folio).comisiones) === congelado);

  // ── 6) El reintento no duplica ───────────────────────────────────────────
  const antes = S().comisionAcum;
  D.markSaleSync(venta.folio, 'synced');
  ck('6 · el reintento no duplica el acumulado', cerca(S().comisionAcum, antes), S().comisionAcum);
  ck('6 · el reintento no altera lo congelado',
    JSON.stringify(D.sales.find(x => x.folio === venta.folio).comisiones) === congelado);

  // ── 7) La escalera queda lista para cuando se fije meta ──────────────────
  D.updateUser(PRUEBA.id, { metaMes: 10000 });
  const conMeta = D.commissionEntryFor(S(), 13000, { priorBase: 0 });
  // 10 000 @3 % = 300 · 2 000 @4 % = 80 · 1 000 @5 % = 50 -> 430
  ck('7 · con meta, la escalera 3/4/5 se aplica por tramos', conMeta.monto === 430, conMeta.monto);
  D.updateUser(PRUEBA.id, { metaMes: 0 });

  return { R, folio: venta.folio, comision: venta.comision, base: (venta.comisiones[0] || {}).base };
});

out.R.forEach(r => ck(r.n, r.ok, r.d));
ck('sin errores de pagina', errores.length === 0, errores.join(' | '));
console.log(`\nVenta de control: ${out.folio} · base ${out.base} · comision ${out.comision}`);
await browser.close(); server.close();
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
