// test-h69-commissions.mjs — H-69 · Sistema de comisiones de vendedores.
//
// Ejercita el MOTOR REAL del bundle publicado, nunca una réplica de la fórmula.
// El arnés anterior (`test-commission.mjs`) reimplementaba el cálculo, y por eso
// nunca pudo detectar que `recordSale` ignoraba la autoridad: es `AP-09` en el
// instrumento. Aquí todo se pregunta al producto.
import http from 'http'; import fs from 'fs'; import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve('.');
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'node_modules/playwright-core/index.mjs')).href);
const server = http.createServer((req, res) => {
  const fp = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.slice(1)));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': path.extname(fp) === '.html' ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8879, '127.0.0.1', r));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.route(/supabase\.co/, r => r.abort());
await page.goto('http://127.0.0.1:8879/', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.DATA.recordSale && window.DATA.commissionLedger);

const out = await page.evaluate(async () => {
  const D = window.DATA, C = window.CONFIG;
  const R = [];
  const near = (a, b, e = 0.02) => Math.abs(Number(a) - Number(b)) <= e;
  const ck = (name, cond, detail = '') => R.push({ name, ok: !!cond, detail: String(detail) });
  const eq = (name, got, exp) => ck(name, near(got, exp), `got=${got} exp=${exp}`);

  const sent = { rows: [], settle: [], close: [], adj: [] };
  window.STORE.pushSale = () => {};
  window.STORE.pushReturn = () => {};
  window.STORE.pushExchange = () => {};
  window.STORE.pushRows = (kind, arr) => { if (kind === 'sellers') sent.rows.push(arr); };
  window.STORE.settleCommission = a => sent.settle.push(a);
  window.STORE.closeCommissionPeriod = a => sent.close.push(a);
  window.STORE.applyCommissionAdjustment = a => sent.adj.push(a);
  window.STORE.hasPendingLayaway = () => false;
  window.STORE.deleteRow = () => {};
  window.STORE.settleLayaway = async (draft, eff) => {
    const remoteProducts = (draft.lineas || []).map(line => {
      const cur = D.products.find(p => p.id === line.productId);
      const rp = JSON.parse(JSON.stringify(cur));
      const v = rp.stock.find(x => x.talla === line.talla); if (v) v.stock -= Number(line.qty) || 0;
      rp._syncVersion = (Number(cur._syncVersion) || 0) + 1; return rp;
    });
    const remoteSellers = (eff.sellerEffects || []).map(e => {
      const cur = D.sellers.find(s => s.id === e.id);
      return Object.assign({}, cur, {
        ventasMes: e.after_ventas_mes, ventasNum: e.after_ventas_num,
        comisionAcum: e.after_comision_acum, _syncVersion: (Number(cur._syncVersion) || 0) + 1,
      });
    });
    const r = D.applySaleCommitResult('h69-' + draft.folio, draft.folio, {
      sale: draft, products: remoteProducts,
      payments: D.paymentsForSale(draft.folio).concat(eff.payment),
      movements: (draft.lineas || []).map((l, i) => ({ id: 70000 + i, fecha: eff.payment.fecha, tipo: 'Venta', producto: l.nombre, productId: l.productId, sku: l.sku, talla: l.talla, cant: -l.qty, ref: draft.folio })),
      sellers: remoteSellers, stockReserved: true, stockIdempotent: false,
      reservationOperationId: draft._operationId,
    });
    return { ok: r.ok === true };
  };

  // ── Semillas: estado VÁLIDO del negocio, no el mínimo que compila (R-DEL-12)
  const tallas = C.codes('size_letter'), colores = C.codes('color');
  const mk = (id, precio, color) => D.hydrate({
    id, cat: '21', manga: 'ML', tela: 'ALG', color, cuello: 'NOR', modelo: id.toUpperCase(),
    nombre: 'Camisa ' + id, precio, costo: precio * 0.3, sizeCategoryId: 'size_letter',
    attrs: { __sizeCategoryId: 'size_letter' },
    stock: tallas.map(t => ({ talla: t, escala: 'L', stock: 200 })),
  });
  const P1 = mk('h69a', 1160, colores[0]), P2 = mk('h69b', 2320, colores[1] || colores[0]);
  D.products.push(P1, P2);
  const talla = tallas[1];
  const cli = { id: 'h69c', nombre: 'Cliente H69', tel: '9990000001', compras: 0, total: 0, generic: false };
  D.clients.push(cli);

  // Nivel comercial CON porcentaje definido, para probar la fuente `nivel`.
  C.addItem('seller_role', { code: 'h69lvl', label: 'Nivel H69', meta: { minPct: 0, commissionPct: 6 } });

  const seller = (id, extra) => {
    const s = Object.assign({
      id, nombre: 'V-' + id, iniciales: 'VX', color: '#333', comisionPct: 0,
      commissionOverridePct: null, sellerLevelCode: null, commissionPolicyVersion: 1,
      metaMes: 0, ventasMes: 0, ventasNum: 0, comisionAcum: 0, bono: 'Sin bono',
      role: 'vendedor', active: true,
    }, extra || {});
    D.sellers.push(s); return s;
  };
  const S = id => D.sellers.find(x => x.id === id) || {};
  const base = { general: seller('gen'), ovr: seller('ovr', { commissionOverridePct: 8 }),
    lvl: seller('lvl', { sellerLevelCode: 'h69lvl' }), meta: seller('meta', { metaMes: 10000 }),
    dos: seller('dos'), leg: seller('leg', { comisionPct: 5, commissionPolicyVersion: 0 }) };

  const venta = ({ prod = P1, qty = 1, ids, metodo = 'Efectivo', estado = 'Pagado', anticipo = null, ad = [] }) => {
    const ticket = [{ p: prod, talla, qty, res: D.resolveLineDiscount(prod, talla) }];
    const q = D.saleQuote(ticket, ad);
    const anti = anticipo == null ? q.finalTotal : anticipo;
    return D.recordSale({
      ticket, additionalDiscounts: ad, quote: q, sellerIds: ids, client: cli, metodo, estado,
      subtotal: q.subtotal, iva: q.iva, total: q.finalTotal, anticipo: anti,
      pagoEfectivo: anti, pagoOtro: 0, metodoPago: metodo === 'Apartado' ? 'Efectivo' : metodo,
      pagoDetalle: { efectivo: anti }, ivaPct: 16, ivaIncluded: true, itemCount: qty,
    });
  };
  const mia = (sale, id) => D.saleFrozenCommissions(sale).filter(c => c.sellerId === id)
    .reduce((a, c) => a + c.monto, 0);

  // ── 1 · Venta normal ────────────────────────────────────────────────────────
  const v1 = venta({ ids: [base.general.id] });
  eq('1 · venta normal: 3% de 1000 neto', v1.comision, 30);
  ck('1 · congela seller_id', (v1.comisiones[0] || {}).sellerId === base.general.id);
  ck('1 · congela origen de politica', (v1.comisiones[0] || {}).source === 'general', (v1.comisiones[0] || {}).source);
  ck('1 · congela version de politica', (v1.comisiones[0] || {}).policyVersion === 1);
  eq('1 · congela base comisionable', (v1.comisiones[0] || {}).base, 1000);
  eq('1 · congela porcentaje efectivo', (v1.comisiones[0] || {}).pct, 3);

  // ── 2 · Venta con descuento ─────────────────────────────────────────────────
  const v2 = venta({ prod: P2, ids: [base.general.id], ad: [{ benefitType: 'percentage', value: 10, scope: 'ticket', origin: 'Promoción', reason: 'H69', combinable: true, benefitId: 'b1', benefitName: 'D10' }] });
  eq('2 · descuento: base = neto DESPUES del descuento', (v2.comisiones[0] || {}).base, 2088 / 1.16);
  eq('2 · descuento: comision 3% del neto con descuento', v2.comision, 54);

  // ── 3 · Dos vendedores ──────────────────────────────────────────────────────
  const v3 = venta({ prod: P2, ids: [base.general.id, base.dos.id] });
  eq('3 · dos vendedores: base repartida', (v3.comisiones[0] || {}).base, 1000);
  eq('3 · dos vendedores: cada uno 3% de su mitad', (v3.comisiones[1] || {}).monto, 30);
  eq('3 · dos vendedores: total de la venta', v3.comision, 60);
  ck('3 · dos vendedores: la suma de bases es la base de la venta',
    near(v3.comisiones.reduce((a, c) => a + c.base, 0), 2320 / 1.16));

  // ── 8 · Cortesía ────────────────────────────────────────────────────────────
  const v8 = venta({ ids: [base.general.id], metodo: 'Cortesía' });
  eq('8 · cortesia no comisiona', v8.comision, 0);
  ck('8 · cortesia no congela renglones', (v8.comisiones || []).length === 0);

  // ── 9 · Porcentaje personalizado ────────────────────────────────────────────
  const v9 = venta({ ids: [base.ovr.id] });
  eq('9 · personalizada 8%', v9.comision, 80);
  ck('9 · origen personalizada', (v9.comisiones[0] || {}).source === 'personalizada');

  // ── 10 · Nivel de comisión ──────────────────────────────────────────────────
  const v10 = venta({ ids: [base.lvl.id] });
  eq('10 · nivel 6%', v10.comision, 60);
  ck('10 · origen nivel', (v10.comisiones[0] || {}).source === 'nivel', (v10.comisiones[0] || {}).source);

  // ── 11/12 · Meta alcanzada y excedente sobre 120% ───────────────────────────
  // Meta 10 000. Escalera 3 / 4 / 5, umbral 12 000.
  const pol = D.resolveSellerCommission(S('meta'));
  ck('11 · escalera 3/4/5', pol.basePct === 3 && pol.goalPct === 4 && pol.surplusPct === 5,
    `${pol.basePct}/${pol.goalPct}/${pol.surplusPct}`);
  // Primera venta: 8 000 de base -> todo al 3% = 240
  const m1 = D.commissionEntryFor(S('meta'), 8000, { priorBase: 0 });
  eq('11 · bajo meta: todo al 3%', m1.monto, 240);
  // Segunda: de 8 000 a 13 000 -> 2 000@3% + 2 000@4% + 1 000@5% = 60+80+50 = 190
  const m2 = D.commissionEntryFor(S('meta'), 5000, { priorBase: 8000 });
  eq('12 · cruza meta y umbral: tramos marginales', m2.monto, 190);
  ck('12 · desglose de tres tramos', m2.tramos.length === 3, JSON.stringify(m2.tramos.map(t => t.pct)));
  ck('12 · tramos con las tasas correctas',
    m2.tramos[0].pct === 3 && m2.tramos[1].pct === 4 && m2.tramos[2].pct === 5);
  // Por encima del umbral, todo al 5%
  const m3 = D.commissionEntryFor(S('meta'), 1000, { priorBase: 20000 });
  eq('12 · muy por encima del umbral: 5% plano', m3.monto, 50);
  // Sin meta, la escalera no se activa
  const m0 = D.commissionEntryFor(S('gen'), 50000, { priorBase: 0 });
  eq('11 · sin meta: 3% plano aunque venda mucho', m0.monto, 1500);

  // La escalera se recorre de verdad al vender: dos ventas seguidas del mismo
  // vendedor con meta avanzan por los tramos.
  const antesMeta = D.sellerPeriodBase(base.meta.id);
  const vm1 = venta({ prod: P2, ids: [base.meta.id] });      // base 2000
  const vm2 = venta({ prod: P2, ids: [base.meta.id] });      // base 2000
  ck('11 · la base del periodo avanza sola', near(D.sellerPeriodBase(base.meta.id), antesMeta + 4000),
    D.sellerPeriodBase(base.meta.id));
  eq('11 · dos ventas bajo meta siguen al 3%', vm1.comision + vm2.comision, 120);

  // ── 4 · Apartado liquidado ──────────────────────────────────────────────────
  const v4 = venta({ ids: [base.general.id], metodo: 'Apartado', estado: 'Apartado', anticipo: 100 });
  eq('4 · apartado no comisiona al apartarse', v4.comision, 0);
  const liq4 = await D.registrarPagoApartado(v4.folio, { monto: 1060, metodo: 'Efectivo', detalle: { efectivo: 1060 } });
  const v4f = D.sales.find(x => x.folio === v4.folio);
  ck('4 · apartado liquidado', liq4.ok === true, liq4.error || '');
  eq('4 · apartado comisiona al liquidarse', v4f.comision, 30);
  ck('4 · apartado congela su desglose', (v4f.comisiones || []).length === 1);

  // ── 5 · Cambio con excedente ────────────────────────────────────────────────
  const v5 = venta({ ids: [base.general.id] });
  const camb = D.recordExchange({
    origenFolio: v5.folio, vendedorId: base.general.id, usuario: 'admin', revisadoPor: 'admin',
    lineas: [
      { lado: 'devuelto', productId: P1.id, sku: P1.sku, nombre: P1.nombre, talla, qty: 1, condicion: 'Nueva', motivo: 'Cambio' },
      { lado: 'entregado', productId: P2.id, sku: P2.sku, nombre: P2.nombre, talla, qty: 1 },
    ], metodoPago: 'Efectivo',
  });
  ck('5 · cambio registrado', camb.ok === true, camb.error || '');
  eq('5 · cambio: solo la diferencia positiva comisiona', camb.exchange.comisionMonto, 30);
  eq('5 · cambio: base = diferencia neta', camb.exchange.comisionBaseImporte, 1000);
  ck('5 · cambio congela origen y version',
    camb.exchange.comisionSource === 'general' && camb.exchange.comisionPolicyVersion === 1);
  // Diferencia negativa: no comisiona
  const v5b = venta({ prod: P2, ids: [base.general.id] });
  const camb2 = D.recordExchange({
    origenFolio: v5b.folio, vendedorId: base.general.id, usuario: 'admin', revisadoPor: 'admin',
    lineas: [
      { lado: 'devuelto', productId: P2.id, sku: P2.sku, nombre: P2.nombre, talla, qty: 1, condicion: 'Nueva', motivo: 'Cambio' },
      { lado: 'entregado', productId: P1.id, sku: P1.sku, nombre: P1.nombre, talla, qty: 1 },
    ], metodoPago: 'Efectivo',
  });
  eq('5 · cambio a la baja no comisiona', camb2.exchange.comisionMonto, 0);

  // ── 5b · Reversa de comision de cambio (antes declarada y sin conectar) ─────
  const accAntesRev = Number(S('gen').comisionAcum) || 0;
  const rev = D.reverseExchangeCommission(camb.exchange.id);
  ck('5b · reversa de cambio conectada', rev.ok === true, rev.error || '');
  eq('5b · reversa de cambio resta lo congelado', accAntesRev - (Number(S('gen').comisionAcum) || 0), 30);
  const rev2 = D.reverseExchangeCommission(camb.exchange.id);
  ck('5b · reversa de cambio no se repite', rev2.ok === false && rev2.error === 'comision_ya_revertida');

  // ── 6 · Devolución parcial y total ──────────────────────────────────────────
  const v6 = venta({ prod: P2, qty: 2, ids: [base.general.id] });   // total 4640, base 4000
  eq('6 · venta de dos piezas', v6.comision, 120);
  const acc6 = Number(S('gen').comisionAcum) || 0;
  const d1 = D.recordReturn({ folio: v6.folio, lineas: [{ sku: P2.sku, nombre: P2.nombre, talla, qty: 1, motivo: 'Defecto' }], metodo: 'Efectivo' });
  ck('6 · devolucion parcial ok', d1.ok === true, d1.error || '');
  eq('6 · parcial revierte la mitad de lo CONGELADO', acc6 - (Number(S('gen').comisionAcum) || 0), 60);
  ck('6 · la devolucion congela lo que revirtio', (d1.ret.comisiones || []).length === 1);
  const acc6b = Number(S('gen').comisionAcum) || 0;
  const d2 = D.recordReturn({ folio: v6.folio, lineas: [{ sku: P2.sku, nombre: P2.nombre, talla, qty: 1, motivo: 'Defecto' }], metodo: 'Efectivo' });
  ck('6 · devolucion total ok', d2.ok === true, d2.error || '');
  eq('6 · total revierte exactamente el saldo restante', acc6b - (Number(S('gen').comisionAcum) || 0), 60);
  eq('6 · la venta conserva su comision congelada', D.sales.find(x => x.folio === v6.folio).comision, 120);

  // La reversa NO usa el porcentaje de hoy: se cambia la politica y se comprueba.
  const v6b = venta({ prod: P2, ids: [base.general.id] });          // 3% -> 60
  D.updateUser(base.general.id, { commissionOverridePct: 50 });     // el dueno sube el %
  const acc6c = Number(S('gen').comisionAcum) || 0;
  const d3 = D.recordReturn({ folio: v6b.folio, lineas: [{ sku: P2.sku, nombre: P2.nombre, talla, qty: 1, motivo: 'Defecto' }], metodo: 'Efectivo' });
  eq('6 · la reversa usa lo congelado, no el % vigente', acc6c - (Number(S('gen').comisionAcum) || 0), 60);
  D.updateUser(base.general.id, { commissionOverridePct: null });   // se restituye

  // ── 7 · Cancelación ─────────────────────────────────────────────────────────
  const v7 = venta({ ids: [base.dos.id] });
  const acc7 = Number(S('dos').comisionAcum) || 0;
  const can = D.reverseSaleCommission(v7.folio, { motivo: 'prueba' });
  ck('7 · cancelacion revierte', can.ok === true, can.error || '');
  eq('7 · cancelacion resta la comision original', acc7 - (Number(S('dos').comisionAcum) || 0), 30);
  ck('7 · cancelacion marca la venta', D.sales.find(x => x.folio === v7.folio).estado === 'Cancelado');
  ck('7 · cancelacion no se repite', D.reverseSaleCommission(v7.folio).ok === false);

  // ── 13 · Venta offline y 14 · reintento sin duplicar ────────────────────────
  const accOff = Number(S('gen').comisionAcum) || 0;
  const vOff = venta({ ids: [base.general.id] });
  eq('13 · venta offline acredita igual', (Number(S('gen').comisionAcum) || 0) - accOff, 30);
  ck('13 · venta offline queda pendiente de sincronizar', vOff._syncStatus === 'pending');
  const antesReintento = Number(S('gen').comisionAcum) || 0;
  const congeladasAntes = JSON.stringify(vOff.comisiones);
  D.markSaleSync(vOff.folio, 'synced');
  ck('14 · reintento no duplica el acumulado', near(Number(S('gen').comisionAcum) || 0, antesReintento));
  ck('14 · reintento no altera lo congelado',
    JSON.stringify(D.sales.find(x => x.folio === vOff.folio).comisiones) === congeladasAntes);

  // ── 15/16 · Liquidación y segundo intento ───────────────────────────────────
  const pendGen = D.commissionLedger(D.currentPeriodPredicate()).find(r => r.vendedorId === base.general.id);
  const acumGen = Number(S('gen').comisionAcum) || 0;
  ck('15 · el saldo derivado coincide con el acumulado', near(pendGen.pendiente, acumGen),
    `ledger=${pendGen.pendiente} acum=${acumGen}`);
  const liq = D.liquidarComision(base.general.id);
  eq('15 · liquidacion paga el pendiente', liq, acumGen);
  eq('15 · el acumulado queda en cero', Number(S('gen').comisionAcum) || 0, 0);
  const liq2 = D.liquidarComision(base.general.id);
  eq('16 · segundo intento no paga de nuevo', liq2, 0);
  ck('16 · no se duplica la fila de liquidacion',
    (D.liquidations || []).filter(l => l.sellerId === base.general.id && l.tipo === 'liquidacion' && l.monto > 0).length === 1);

  // ── 17/18 · Cierre mensual y reporte DESPUÉS del cierre ─────────────────────
  const antesCierre = D.commissionLedger(() => true);
  const generadoAntes = antesCierre.reduce((a, r) => a + r.generado, 0);
  const ventasAntes = D.sales.length;
  const cierre = D.cerrarMes();
  const despues = D.commissionLedger(() => true);
  const generadoDespues = despues.reduce((a, r) => a + r.generado, 0);
  ck('17 · el cierre liquida el pendiente', cierre.total >= 0);
  ck('17 · el cierre deja el acumulado en cero',
    D.sellers.every(s => (Number(s.comisionAcum) || 0) === 0));
  ck('18 · el cierre NO borra las ventas', D.sales.length === ventasAntes);
  ck('18 · el cierre NO borra la comision generada del reporte',
    near(generadoDespues, generadoAntes), `antes=${generadoAntes} despues=${generadoDespues}`);
  ck('18 · tras el cierre el pendiente derivado es cero',
    despues.every(r => near(r.pendiente, 0)), JSON.stringify(despues.map(r => [r.vendedor, r.pendiente])));

  // ── 19 · Las tres pantallas muestran el mismo numero ────────────────────────
  const periodo = D.currentPeriodPredicate();
  const led = D.commissionLedger(periodo);
  const vSel = venta({ ids: [base.general.id] });
  const led2 = D.commissionLedger(periodo);
  const filaGen = led2.find(r => r.vendedorId === base.general.id) || { pendiente: 0 };
  eq('19 · Vendedores/Reportes/XLSX consumen la misma cifra', filaGen.pendiente, Number(S('gen').comisionAcum) || 0);
  ck('19 · sellerCommissionReport delega en la autoridad',
    JSON.stringify(D.sellerCommissionReport(periodo)) === JSON.stringify(D.commissionLedger(periodo)));

  // ── 20 · Segunda terminal ───────────────────────────────────────────────────
  // Una confirmación remota reemplaza la fila del vendedor. La evidencia
  // congelada de la venta NO puede depender de ese objeto.
  const congeladaAntes = JSON.stringify(vSel.comisiones);
  D.applyRemote('sellers', D.sellers.map(s => Object.assign({}, s, {
    comisionAcum: 999, ventasMes: 777, _syncVersion: (Number(s._syncVersion) || 0) + 1,
  })));
  ck('20 · segunda terminal no altera lo congelado en la venta',
    JSON.stringify(D.sales.find(x => x.folio === vSel.folio).comisiones) === congeladaAntes);
  ck('20 · segunda terminal se refleja en el acumulado', (Number(S('gen').comisionAcum) || 0) === 999);

  // ── 21 · COMMISSION_RPC_REQUIRED ────────────────────────────────────────────
  // La frontera de COLUMNAS se prueba donde de verdad ocurre: sobre el STORE
  // real, en `test-store-queue.mjs` 37b-37g y 38a-38d. Aqui, en DATA, las claves
  // son camelCase, asi que buscar `comision_acum` pasaria SIEMPRE y no probaria
  // nada (`AP-09`). Lo que si pertenece a esta capa es que DATA rechace mutar
  // los tres campos financieros y si acepte la politica.
  sent.rows.length = 0;
  const accDosAntes = Number(S('dos').comisionAcum) || 0;
  D.updateUser(base.dos.id, { comisionAcum: 12345, ventasMes: 999, ventasNum: 7, nombre: 'V-dos renombrado' });
  ck('21 · updateUser NO deja escribir comisionAcum', (Number(S('dos').comisionAcum) || 0) === accDosAntes,
    S('dos').comisionAcum);
  ck('21 · updateUser NO deja escribir ventasNum', (S('dos').ventasNum || 0) !== 7);
  ck('21 · updateUser SI aplica el resto del perfil', S('dos').nombre === 'V-dos renombrado');
  D.updateUser(base.dos.id, { commissionOverridePct: 7, metaMes: 5000 });
  ck('21 · updateUser SI aplica el porcentaje personalizado', S('dos').commissionOverridePct === 7);
  ck('21 · updateUser SI aplica la meta', S('dos').metaMes === 5000);
  ck('21 · fijar politica saca al perfil de heredada', (() => {
    D.updateUser(base.leg.id, { commissionOverridePct: 9 });
    const p = D.resolveSellerCommission(S('leg'));
    return p.source === 'personalizada' && p.effectivePct === 9 && S('leg').commissionPolicyVersion >= 1;
  })());
  ck('21 · el guardado de perfil se encola', sent.rows.length > 0, sent.rows.length);

  // ── 22 · Ajuste histórico: propone, no paga ─────────────────────────────────
  // Se fabrica una venta histórica con comisión cero, como las reales.
  const vh = venta({ ids: [base.dos.id] });
  const vhDoc = D.sales.find(x => x.folio === vh.folio);
  vhDoc.comision = 0; vhDoc.comisiones = [];
  const prev = D.commissionAdjustmentPreview();
  ck('22 · la vista previa encuentra la venta sin comision',
    prev.renglones.some(r => r.folio === vh.folio), prev.renglones.length);
  const rgl = prev.renglones.find(r => r.folio === vh.folio) || {};
  ck('22 · el renglon trae folio, vendedor, neta, %, comision',
    rgl.folio && rgl.vendedor && rgl.ventaNeta > 0 && rgl.pct > 0 && rgl.comision > 0,
    JSON.stringify(rgl));
  const accAntesAjuste = Number(S('dos').comisionAcum) || 0;
  ck('22 · la vista previa NO paga', (Number(S('dos').comisionAcum) || 0) === accAntesAjuste);
  const draft = D.commissionAdjustmentDraft(prev, { motivo: 'H-69' });
  ck('22 · el borrador es un documento aparte', !!draft.id && !!draft.operationId && draft.estado === 'borrador');
  const ledgerAntesAjuste = D.commissionLedger(() => true).find(x => x.vendedorId === base.dos.id);
  const ap1 = D.applyCommissionAdjustment(draft);
  ck('22 · el ajuste se aplica', ap1.ok === true, ap1.error || '');
  const ledgerConAjuste = D.commissionLedger(() => true).find(x => x.vendedorId === base.dos.id);
  const ajusteDos = draft.porVendedor.find(x => x.sellerId === base.dos.id).comision;
  eq('22 · el ajuste retenido integra el saldo derivado',
    ledgerConAjuste.pendiente - ledgerAntesAjuste.pendiente, ajusteDos);
  D.liquidations.unshift({ id: 'adj-espejo-h69', sellerId: base.dos.id,
    seller: S('dos').nombre, monto: ajusteDos, tipo: 'ajuste', fecha: draft.fecha });
  eq('22 · la fila espejo tipo ajuste no se resta como pago',
    D.commissionLedger(() => true).find(x => x.vendedorId === base.dos.id).pendiente,
    ledgerConAjuste.pendiente);
  const ap2 = D.applyCommissionAdjustment(draft);
  ck('22 · el ajuste es idempotente', ap2.ok === false && ap2.idempotente === true);
  ck('22 · el ajuste NO reescribe la venta', D.sales.find(x => x.folio === vh.folio).comision === 0);
  const prev2 = D.commissionAdjustmentPreview();
  ck('22 · lo ya ajustado no se vuelve a proponer',
    !prev2.renglones.some(r => r.folio === vh.folio && r.sellerId === base.dos.id));

  // ── 23 · Compatibilidad: venta anterior a H-69 ──────────────────────────────
  const legacy = { folio: 'H69-LEGACY', fecha: '2026-07-01 10:00', cliente: 'X', vendedores: [base.leg.id],
    total: 1160, iva: 160, comision: 50, comisionBase: 'neto', estado: 'Pagado', lineas: [] };
  D.sales.push(legacy);
  const recon = D.saleFrozenCommissions(legacy);
  eq('23 · venta historica reconstruye su comision', recon[0].monto, 50);
  eq('23 · venta historica reconstruye su base', recon[0].base, 1000);
  ck('23 · venta historica se declara reconstruida', recon[0].reconstruida === true);
  ck('23 · venta historica NO usa el % de hoy', recon[0].source === 'historica');

  return R;
});

await browser.close(); server.close();
let pass = 0, fail = 0;
out.forEach(r => {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}${r.ok || !r.detail ? '' : ' · ' + r.detail}`);
  r.ok ? pass++ : fail++;
});
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
