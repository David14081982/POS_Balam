// H-65 — dominio real del bundle con autoridad remota controlada en memoria.
// No usa red ni escribe Supabase.
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('.');
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.slice(1)));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': path.extname(file) === '.html' ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(8835, '127.0.0.1', resolve));

let pass = 0, fail = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  condition ? pass++ : fail++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto('http://127.0.0.1:8835/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.STORE);

  const result = await page.evaluate(async () => {
    const D = window.DATA, S = window.STORE;
    S.pushRows = () => {}; S.pushSale = () => {}; S.pushConfig = () => {};
    const clone = value => JSON.parse(JSON.stringify(value));
    const outcomes = {};

    function reset({ exact = true, firstStock = 3, secondStock = 7 } = {}) {
      D.products.length = 0; D.sales.length = 0; D.payments.length = 0;
      D.movements.length = 0;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key === 'balam_pos_sale_commit_journal_v1'
            || (key && key.startsWith('balam_pos_sale_commit_journal_v2:'))) localStorage.removeItem(key);
      }
      localStorage.removeItem('balam_pos_layaway_product_locks_v1');
      D.clearCatalogResync('h65-cache');
      D.clearCatalogResync('products-cache');
      D.clearCatalogResync('product-conflict');
      const base = D.emptyStock();
      const variant = base.find(v => v.escala === 'N') || base[0];
      const talla = variant.talla;
      const mk = (id, stock) => {
        const matrix = clone(base); matrix.find(v => v.talla === talla && v.escala === variant.escala).stock = stock;
        return D.hydrate({
          id, sku: 'SKU-DUP-H65', modelo: id, nombre: id,
          cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR',
          orn: '—', ornColors: [], precio: 100, costo: 40, stock: matrix,
          sizeCategoryId: variant.escala === 'N' ? 'size_number' : 'size_letter',
          attrs: { __sizeCategoryId: variant.escala === 'N' ? 'size_number' : 'size_letter' },
          _syncVersion: 10,
        });
      };
      const p1 = mk('h65-product-exact', firstStock);
      const p2 = mk('h65-product-duplicate', secondStock);
      D.products.push(p1, p2);
      const sale = {
        folio: 'BG-H65-E2E', fecha: '2026-08-01 12:00', cliente: 'H65',
        vendedores: [], metodo: 'Apartado', estado: 'Apartado', items: 1,
        subtotal: 86.21, iva: 13.79, total: 100, anticipo: 0, saldo: 100,
        pagoEfectivo: 0, pagoOtro: 0, descuento: 0,
        _operationId: '11111111-1111-4111-8111-111111111165',
        _stockRequired: false, _stockReserved: false, _syncStatus: 'synced',
        lineas: [{ ...(exact ? { productId: p1.id } : {}), sku: p1.sku, nombre: p1.nombre, talla, qty: 1, precio: 100 }],
      };
      D.sales.push(sale);
      D.saveProducts(false); D.saveSales(); D.savePayments(false); D.saveMovements();
      return { sale, p1, p2, talla };
    }

    function applyServer(draft, effects, { stock, idempotent, commitId = 'h65-e2e-commit' }) {
      const current = D.products.find(p => p.id === draft.lineas[0].productId);
      const remote = clone(current);
      remote.stock.find(v => v.talla === draft.lineas[0].talla).stock = stock;
      remote._syncVersion = (Number(current._syncVersion) || 0) + (idempotent ? 0 : 1);
      return D.applySaleCommitResult(commitId, draft.folio, {
        sale: clone(draft), products: [remote], payments: [clone(effects.payment)],
        movements: [{
          id: 65100, fecha: effects.payment.fecha, tipo: 'Venta',
          producto: draft.lineas[0].nombre, productId: draft.lineas[0].productId,
          sku: draft.lineas[0].sku, talla: draft.lineas[0].talla,
          cant: -1, ref: draft.folio,
        }],
        sellers: [], stockReserved: true, stockIdempotent: idempotent,
        reservationOperationId: draft._operationId,
      });
    }
    function hasSaleCommitJournal() {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key === 'balam_pos_sale_commit_journal_v1'
            || (key && key.startsWith('balam_pos_sale_commit_journal_v2:'))) return true;
      }
      return false;
    }

    // Red/stock insuficiente: la intención puede quedar pendiente, el dominio no.
    let ctx = reset();
    const beforePending = clone({ sale: ctx.sale, products: D.products, payments: D.payments, movements: D.movements });
    S.settleLayaway = async () => ({ ok: false, pending: true, error: 'network_error' });
    const pending = await D.registrarPagoApartado(ctx.sale.folio, { monto: 100, metodo: 'Efectivo', detalle: { efectivo: 100 } });
    outcomes.pending = { result: pending, unchanged: JSON.stringify(beforePending) === JSON.stringify({ sale: ctx.sale, products: D.products, payments: D.payments, movements: D.movements }) };

    // Liquidación fresca: el servidor devuelve exactamente un descuento y un movimiento.
    ctx = reset();
    S.settleLayaway = async (draft, effects) => ({ ok: applyServer(draft, effects, { stock: 2, idempotent: false }).ok });
    const fresh = await D.registrarPagoApartado(ctx.sale.folio, { monto: 100, metodo: 'Tarjeta', detalle: { tarjeta: 100 } });
    outcomes.fresh = {
      ok: fresh.ok, state: D.sales[0].estado, stock1: D.stockOf(D.products.find(p => p.id === ctx.p1.id), ctx.talla),
      stock2: D.stockOf(D.products.find(p => p.id === ctx.p2.id), ctx.talla),
      payments: D.paymentsForSale(ctx.sale.folio).length,
      moves: D.movements.filter(m => m.ref === ctx.sale.folio && m.tipo === 'Venta').length,
    };

    // Reserva previa: respuesta idempotente mantiene 3; nunca existe un 3→2 local temporal.
    ctx = reset({ firstStock: 3 });
    S.settleLayaway = async (draft, effects) => ({ ok: applyServer(draft, effects, { stock: 3, idempotent: true }).ok });
    const prior = await D.registrarPagoApartado(ctx.sale.folio, { monto: 100, metodo: 'Transferencia', detalle: { transferencia: 100 } });
    const priorSale = D.sales.find(s => s.folio === ctx.sale.folio);
    outcomes.prior = {
      ok: prior.ok, stock: D.stockOf(D.products.find(p => p.id === ctx.p1.id), ctx.talla),
      moves: D.movements.filter(m => m.ref === ctx.sale.folio && m.tipo === 'Venta').length,
      idempotent: priorSale._syncDetail && priorSale._syncDetail.stockIdempotent,
      operation: priorSale._syncDetail && priorSale._syncDetail.reservationOperationId,
    };

    // Fallback histórico ambiguo: bloquea antes de invocar STORE.
    ctx = reset({ exact: false }); let calls = 0;
    const ambiguousBefore = clone({ sale: ctx.sale, products: D.products });
    S.settleLayaway = async () => { calls++; return { ok: true }; };
    const ambiguous = await D.registrarPagoApartado(ctx.sale.folio, { monto: 100, metodo: 'Efectivo', detalle: { efectivo: 100 } });
    outcomes.ambiguous = {
      ok: ambiguous.ok, code: ambiguous.code, calls,
      unchanged: JSON.stringify(ambiguousBefore) === JSON.stringify({ sale: ctx.sale, products: D.products }),
    };

    // Reintento tras red: la identidad de la venta no cambia y no aparece éxito definitivo.
    ctx = reset(); const operations = [];
    S.settleLayaway = async draft => { operations.push(draft._operationId); return { ok: false, pending: true, error: 'offline' }; };
    const retry1 = await D.registrarPagoApartado(ctx.sale.folio, { monto: 100, metodo: 'Efectivo', detalle: { efectivo: 100 } });
    const retry2 = await D.registrarPagoApartado(ctx.sale.folio, { monto: 100, metodo: 'Efectivo', detalle: { efectivo: 100 } });
    outcomes.retry = { retry1, retry2, operations, payments: D.payments.length, moves: D.movements.length };

    // Una falla entre las cinco escrituras de cache revierte memoria, conserva
    // el journal y permite aplicar el mismo resultado autoritativo al reintentar.
    ctx = reset(); let captured = null;
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'balam_pos_payments_v1') throw new DOMException('quota', 'QuotaExceededError');
      return nativeSetItem.call(this, key, value);
    };
    S.settleLayaway = async (draft, effects) => {
      captured = { draft: clone(draft), effects: clone(effects) };
      const applied = applyServer(draft, effects, { stock: 2, idempotent: false });
      return { ok: applied.ok, pending: !applied.ok };
    };
    const cacheFailure = await D.registrarPagoApartado(ctx.sale.folio, { monto: 100, metodo: 'Efectivo', detalle: { efectivo: 100 } });
    Storage.prototype.setItem = nativeSetItem;
    outcomes.cacheFailure = {
      result: cacheFailure,
      saleState: D.sales.find(s => s.folio === ctx.sale.folio).estado,
      stock: D.stockOf(D.products.find(p => p.id === ctx.p1.id), ctx.talla),
      payments: D.payments.length,
      moves: D.movements.length,
      journal: hasSaleCommitJournal(),
      gate: D.catalogResyncRequired,
    };
    const cacheReplay = applyServer(captured.draft, captured.effects, { stock: 2, idempotent: true });
    outcomes.cacheReplay = {
      ok: cacheReplay.ok,
      saleState: D.sales.find(s => s.folio === ctx.sale.folio).estado,
      stock: D.stockOf(D.products.find(p => p.id === ctx.p1.id), ctx.talla),
      payments: D.payments.length,
      moves: D.movements.length,
      journal: hasSaleCommitJournal(),
      gate: D.catalogResyncRequired,
    };

    // Una liquidación final incierta congela cualquier abono posterior del
    // mismo folio. La intención final ya está durable y no puede degradarse a
    // un pushSale genérico de Apartado.
    ctx = reset();
    S.settleLayaway = async () => ({ ok: false, pending: true, error: 'offline' });
    const finalPending = await D.registrarPagoApartado(ctx.sale.folio,
      { monto: 100, metodo: 'Efectivo', detalle: { efectivo: 100 } });
    const beforeLatePayment = JSON.stringify({
      sales: D.sales, products: D.products, payments: D.payments, movements: D.movements,
    });
    const latePayment = await D.registrarPagoApartado(ctx.sale.folio,
      { monto: 50, metodo: 'Efectivo', detalle: { efectivo: 50 } });
    outcomes.latePayment = {
      finalPending, latePayment,
      unchanged: beforeLatePayment === JSON.stringify({
        sales: D.sales, products: D.products, payments: D.payments, movements: D.movements,
      }),
    };
    D.releaseLayawayProductLock(ctx.sale._operationId);

    // Incluso si un rechazo/auth libera el lock de producto, la operación H65
    // durable del folio sigue bloqueando nuevos abonos.
    ctx = reset();
    const nativeHasPendingLayaway = S.hasPendingLayaway;
    S.hasPendingLayaway = () => true;
    const beforeQueuedPayment = JSON.stringify({ sales: D.sales, payments: D.payments });
    const queuedPayment = await D.registrarPagoApartado(ctx.sale.folio,
      { monto: 50, metodo: 'Tarjeta', detalle: { tarjeta: 50 } });
    S.hasPendingLayaway = nativeHasPendingLayaway;
    outcomes.queuedPayment = {
      result: queuedPayment,
      unchanged: beforeQueuedPayment === JSON.stringify({ sales: D.sales, payments: D.payments }),
    };

    // El rebase bajo el lease conserva cambios durables no relacionados que
    // llegaron antes de aplicar la respuesta autoritativa.
    ctx = reset();
    S.settleLayaway = async (draft, effects) => {
      const cachedProducts = JSON.parse(localStorage.getItem('balam_pos_products_v2'));
      cachedProducts.find(product => product.id === ctx.p2.id)
        .stock.find(row => row.talla === ctx.talla).stock = 11;
      localStorage.setItem('balam_pos_products_v2', JSON.stringify(cachedProducts));
      const cachedSales = JSON.parse(localStorage.getItem('balam_pos_sales_v1') || '[]');
      cachedSales.push({ folio: 'BG-H65-UNRELATED', fecha: '2026-08-01 11:00', estado: 'Pagado', lineas: [] });
      localStorage.setItem('balam_pos_sales_v1', JSON.stringify(cachedSales));
      localStorage.setItem('balam_pos_payments_v1', JSON.stringify([
        { id: 'pay-unrelated', folio: 'BG-H65-UNRELATED', fecha: '2026-08-01 11:00', tipo: 'venta' },
      ]));
      localStorage.setItem('balam_pos_moves_v1', JSON.stringify([
        { id: 65001, ref: 'BG-H65-UNRELATED', fecha: '2026-08-01 11:00', tipo: 'Venta', cant: -1 },
      ]));
      const cachedSellers = JSON.parse(localStorage.getItem('balam_pos_sellers_v1') || '[]');
      cachedSellers.push({ id: 'seller-h65-unrelated', nombre: 'Otro', role: 'vendedor', active: true });
      localStorage.setItem('balam_pos_sellers_v1', JSON.stringify(cachedSellers));
      const applied = applyServer(draft, effects, { stock: 2, idempotent: false, commitId: 'h65-rebase' });
      return { ok: applied.ok, pending: !applied.ok };
    };
    const rebased = await D.registrarPagoApartado(ctx.sale.folio,
      { monto: 100, metodo: 'Efectivo', detalle: { efectivo: 100 } });
    outcomes.rebase = {
      ok: rebased.ok,
      unrelatedStock: D.stockOf(D.products.find(product => product.id === ctx.p2.id), ctx.talla),
      sale: D.sales.some(row => row.folio === 'BG-H65-UNRELATED'),
      payment: D.payments.some(row => row.id === 'pay-unrelated'),
      movement: D.movements.some(row => row.id === 65001),
      seller: D.sellers.some(row => row.id === 'seller-h65-unrelated'),
    };

    // Un pull de producto pendiente actualiza también el snapshot del lock; un
    // guardado posterior de otro producto no restaura la versión pre-pull.
    ctx = reset();
    const refreshLock = D.acquireLayawayProductLock(ctx.sale);
    const pulledProducts = clone(D.products);
    pulledProducts.find(product => product.id === ctx.p1.id)
      .stock.find(row => row.talla === ctx.talla).stock = 4;
    D.applyRemote('products', pulledProducts);
    D.products.find(product => product.id === ctx.p2.id)
      .stock.find(row => row.talla === ctx.talla).stock = 8;
    const savedAfterPull = D.saveProducts(false);
    outcomes.lockRefresh = {
      acquired: refreshLock, saved: savedAfterPull,
      targetStock: D.stockOf(D.products.find(product => product.id === ctx.p1.id), ctx.talla),
      otherStock: D.stockOf(D.products.find(product => product.id === ctx.p2.id), ctx.talla),
    };
    D.releaseLayawayProductLock(ctx.sale._operationId);

    // Mientras la autoridad remota decide una liquidación, el mismo producto
    // no puede recibir otra mutación local que luego sería borrada por el snapshot.
    ctx = reset();
    const lockAcquired = D.acquireLayawayProductLock(ctx.sale);
    let lockError = null;
    try {
      D.recordSale({
        ticket: [{ p: ctx.p1, talla: ctx.talla, qty: 1 }], sellerIds: [], client: null,
        metodo: 'Efectivo', estado: 'Pagado', pagoEfectivo: 100, pagoOtro: 0,
        itemCount: 1,
      });
    } catch (e) { lockError = e; }
    const removeBlocked = D.removeProduct(ctx.p1.id) === false;
    const resetProductsBlocked = D.resetProducts() === false;
    const resetEmptyBlocked = D.resetEmpty() === false;
    const resetTestsBlocked = D.resetTestData() === false;
    const demoBlocked = D.seedDemo();
    outcomes.lock = {
      acquired: lockAcquired,
      code: lockError && lockError.code,
      stock: D.stockOf(D.products.find(p => p.id === ctx.p1.id), ctx.talla),
      sales: D.sales.length,
      moves: D.movements.length,
      adminMutationsBlocked: removeBlocked && resetProductsBlocked && resetEmptyBlocked
        && resetTestsBlocked && demoBlocked && demoBlocked.ok === false,
    };
    D.releaseLayawayProductLock(ctx.sale._operationId);

    // Conflicto de versión: el snapshot remoto gana y la terminal queda
    // bloqueada hasta completar una resincronización del catálogo.
    ctx = reset();
    const conflicted = clone(ctx.p1);
    conflicted.stock.find(v => v.talla === ctx.talla).stock = 4;
    conflicted._syncVersion = 99;
    const conflictResult = D.applySyncResult('products', [conflicted], { [ctx.p1.id]: 10 }, 'h65-conflict');
    outcomes.conflict = {
      conflicts: conflictResult.conflicts,
      requiresResync: conflictResult.requiresResync,
      gate: D.catalogResyncRequired,
      stock: D.stockOf(D.products.find(p => p.id === ctx.p1.id), ctx.talla),
    };
    ctx = reset();
    localStorage.setItem('balam_pos_sale_commit_journal_v2:foreign-commit', JSON.stringify({
      version: 1, commitId: 'foreign-commit', folio: 'BG-H65-FOREIGN',
      reservationOperationId: 'foreign-operation', productIds: [], sellerIds: [],
      products: [], sales: [], payments: [], movements: [], sellers: [],
    }));
    const foreignDraft = Object.assign({}, clone(ctx.sale), {
      estado: 'Pagado', anticipo: 100, saldo: 0, _stockRequired: true,
    });
    const foreignJournal = applyServer(foreignDraft, {
      payment: { id: 'foreign-test-payment', folio: ctx.sale.folio, fecha: '2026-08-01 12:00', tipo: 'liquidacion' },
    }, { stock: 2, idempotent: false, commitId: 'wanted-commit' });
    localStorage.removeItem('balam_pos_sale_commit_journal_v2:foreign-commit');
    outcomes.foreignJournal = {
      result: foreignJournal,
      saleState: D.sales.find(row => row.folio === ctx.sale.folio).estado,
      stock: D.stockOf(D.products.find(product => product.id === ctx.p1.id), ctx.talla),
    };
    D.clearCatalogResync();
    return outcomes;
  });

  check('error de red no presenta éxito definitivo', result.pending.result.ok === false && result.pending.result.pending === true);
  check('error de red no muta venta, stock, pago ni movimiento', result.pending.unchanged);
  check('liquidación normal queda Pagada', result.fresh.ok && result.fresh.state === 'Pagado');
  check('liquidación normal descuenta exactamente una vez', result.fresh.stock1 === 2);
  check('productId exacto no toca el producto con SKU duplicado', result.fresh.stock2 === 7);
  check('liquidación normal crea un pago y un movimiento', result.fresh.payments === 1 && result.fresh.moves === 1);
  check('reserva previa idempotente conserva el stock remoto', result.prior.ok && result.prior.stock === 3);
  check('reserva previa no duplica movimiento', result.prior.moves === 1);
  check('respuesta explícita conserva idempotencia y operationId', result.prior.idempotent === true && result.prior.operation === '11111111-1111-4111-8111-111111111165');
  check('fallback SKU ambiguo bloquea antes de STORE', result.ambiguous.ok === false && result.ambiguous.code === 'PRODUCT_SKU_AMBIGUOUS' && result.ambiguous.calls === 0);
  check('fallback ambiguo no muta venta ni productos', result.ambiguous.unchanged);
  check('segundo intento de interfaz conserva el operationId y no duplica la RPC pendiente',
    result.retry.operations.length === 1
      && result.retry.operations[0] === '11111111-1111-4111-8111-111111111165');
  check('reintento pendiente no crea pagos ni movimientos locales', result.retry.retry1.ok === false && result.retry.retry2.ok === false && result.retry.payments === 0 && result.retry.moves === 0);
  check('falla parcial de caché revierte venta, inventario, pago y movimiento',
    result.cacheFailure.result.ok === false && result.cacheFailure.saleState === 'Apartado'
      && result.cacheFailure.stock === 3 && result.cacheFailure.payments === 0
      && result.cacheFailure.moves === 0);
  check('falla parcial conserva journal y obliga a resincronizar', result.cacheFailure.journal && result.cacheFailure.gate);
  check('replay de caché aplica una sola unidad coherente y retira el journal',
    result.cacheReplay.ok && result.cacheReplay.saleState === 'Pagado'
      && result.cacheReplay.stock === 2 && result.cacheReplay.payments === 1
      && result.cacheReplay.moves === 1 && !result.cacheReplay.journal && !result.cacheReplay.gate);
  check('liquidación final pendiente bloquea un abono posterior sin mutar cachés',
    result.latePayment.finalPending.pending === true
      && result.latePayment.latePayment.pending === true && result.latePayment.unchanged);
  check('operación H65 durable bloquea abonos aunque su lock haya sido liberado',
    result.queuedPayment.result.pending === true && result.queuedPayment.unchanged);
  check('rebase autoritativo conserva las cinco colecciones no relacionadas',
    result.rebase.ok && result.rebase.unrelatedStock === 11 && result.rebase.sale
      && result.rebase.payment && result.rebase.movement && result.rebase.seller);
  check('pull remoto rebaja el snapshot del lock antes de otro guardado',
    result.lockRefresh.acquired && result.lockRefresh.saved
      && result.lockRefresh.targetStock === 4 && result.lockRefresh.otherStock === 8);
  check('producto en liquidación queda bloqueado para otra venta local',
    result.lock.acquired && result.lock.code === 'LAYAWAY_PRODUCT_LOCKED'
      && result.lock.stock === 3 && result.lock.sales === 1 && result.lock.moves === 0);
  check('borrados y restablecimientos respetan el bloqueo de liquidación', result.lock.adminMutationsBlocked);
  check('conflicto de versión aplica el snapshot remoto, no una cantidad local silenciosa', result.conflict.conflicts === 1 && result.conflict.stock === 4);
  check('conflicto de versión obliga a resincronizar antes de otra venta', result.conflict.requiresResync === true && result.conflict.gate === true);
  check('journal durable de otro commit bloquea sin tocar venta ni stock',
    result.foreignJournal.result.ok === false
      && result.foreignJournal.result.error === 'CACHE_JOURNAL_CONFLICT'
      && result.foreignJournal.saleState === 'Apartado' && result.foreignJournal.stock === 3,
    JSON.stringify(result.foreignJournal));

  // Dos pestañas del mismo origen: sólo la primera escribe. La segunda no toca
  // ninguna caché y, al cerrar la primera, toma el lease después de rebasar.
  const page2 = await context.newPage();
  await page2.route(/supabase\.co/, route => route.abort());
  await page2.goto('http://127.0.0.1:8835/', { waitUntil: 'load' });
  await page2.waitForFunction(() => window.DATA && window.DATA.localWriterState === 'waiting');
  const secondary = await page2.evaluate(() => {
    const keys = ['balam_pos_products_v2', 'balam_pos_sales_v1', 'balam_pos_payments_v1', 'balam_pos_moves_v1', 'balam_pos_sellers_v1'];
    const before = keys.map(key => localStorage.getItem(key));
    let code = null;
    try { window.DATA.removeProduct(window.DATA.products[0].id); }
    catch (error) { code = error && error.code; }
    return {
      state: window.DATA.localWriterState, code,
      unchanged: JSON.stringify(before) === JSON.stringify(keys.map(key => localStorage.getItem(key))),
    };
  });
  check('pestaña secundaria queda en lectura y no muta ninguna caché',
    secondary.state === 'waiting' && secondary.code === 'LOCAL_WRITER_REQUIRED' && secondary.unchanged);
  await page.close();
  await page2.waitForFunction(() => window.DATA && window.DATA.localWriterState === 'writer', null, { timeout: 10000 });
  const takeover = await page2.evaluate(() => {
    const pairs = [
      ['balam_pos_products_v2', window.DATA.products], ['balam_pos_sales_v1', window.DATA.sales],
      ['balam_pos_payments_v1', window.DATA.payments], ['balam_pos_moves_v1', window.DATA.movements],
      ['balam_pos_sellers_v1', window.DATA.sellers],
    ];
    return pairs.every(([key, rows]) => {
      const stored = JSON.parse(localStorage.getItem(key) || '[]');
      return stored.every(row => rows.some(current => current.id === row.id
        || (row.folio && current.folio === row.folio)));
    });
  });
  check('relevo cross-tab rebasa cachés antes de habilitar escritura', takeover);
  await page2.close();

  const unsupportedContext = await browser.newContext();
  await unsupportedContext.addInitScript(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  });
  const unsupportedPage = await unsupportedContext.newPage();
  await unsupportedPage.route(/supabase\.co/, route => route.abort());
  await unsupportedPage.goto('http://127.0.0.1:8835/', { waitUntil: 'load' });
  await unsupportedPage.waitForFunction(() => window.DATA && window.STORE && window.STORE.enabled);
  const unsupported = await unsupportedPage.evaluate(async () => {
    const sale = {
      folio: 'BG-H65-NOLOCK', _operationId: 'h65-no-web-lock',
      lineas: [{ productId: 'p-no-lock', sku: 'NOLOCK', talla: 'M', qty: 1 }],
    };
    const acquired = window.DATA.acquireLayawayProductLock(sale);
    const settled = await window.STORE.settleLayaway(sale, {
      payment: { id: 'pay-no-lock', folio: sale.folio, tipo: 'liquidacion', monto: 1 },
      sellerEffects: [],
    });
    return { state: window.DATA.localWriterState, acquired, settled, pending: window.STORE.pending };
  });
  check('navegador sin Web Locks falla cerrado sin encolar ni invocar H65',
    unsupported.state === 'unsupported' && unsupported.acquired === false
      && unsupported.settled.error.code === 'local_writer_required' && unsupported.pending === 0);
  await unsupportedContext.close();
} finally {
  await browser.close(); server.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
