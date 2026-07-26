// test-store-queue.mjs — Unitarias del seam de nube (balam/store.jsx REAL con stubs).
// Verifica la lógica crítica de sincronización SIN navegador ni red:
//   cola durable (encolar antes de subir, sobrevive al refresh), no-pisado del pull
//   sobre tablas con cambios pendientes, coalescencia de ediciones rápidas, migración
//   de colas viejas, reintentos con aviso, subidas a Storage (barcodes/product-photos)
//   y pull PAGINADO de ventas (ventana + apartados, merge, fetchSaleByFolio).
// Uso: node test-store-queue.mjs
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond) => { console.log(`${cond ? '✅' : '❌'} ${name}`); cond ? pass++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Stubs de entorno (localStorage + supabase-js encadenable) ───────────────────
function freshEnv() {
  const store = new Map();
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
  const calls = [];            // registro cronológico de llamadas a la "nube"
  const cloud = { rowsByTable: {} }; // último payload upsertado / filas a servir por tabla
  const failTables = new Set();
  const rpcCalls = [];
  let rpcHandler = async (name, args) => {
    if (name === 'commit_sale') {
      if (['sales', 'sale_items', 'movements', 'sale_payments'].some(t => failTables.has(t))) {
        return { data: null, error: { message: 'falla transaccional simulada' } };
      }
      cloud.rowsByTable.sales = [args.p_sale];
      cloud.rowsByTable.sale_items = args.p_items || [];
      cloud.rowsByTable.movements = args.p_moves || [];
      cloud.rowsByTable.sale_payments = args.p_payments || [];
    }
    if (name === 'commit_return' || name === 'commit_legacy_return') {
      if (['returns', 'return_items', 'movements'].some(t => failTables.has(t))) {
        return { data: null, error: { message: 'falla transaccional simulada' } };
      }
      cloud.rowsByTable.returns = [args.p_return];
      cloud.rowsByTable.return_items = args.p_items || [];
      cloud.rowsByTable.movements = args.p_moves || [];
    }
    return { data: { ok: true, products: [], clients: [], sellers: [] }, error: null };
  };
  let gate = null;             // promesa que detiene las escrituras (subida "en vuelo")

  function mkQuery(table) {
    const exec = async (metodo, arg, filtro) => {
      calls.push({ table, metodo, filtro });
      if (gate) await gate;
      if (metodo === 'upsert' || metodo === 'insert') {
        if (failTables.has(table)) return { error: { message: 'falla simulada' } };
        cloud.rowsByTable[table] = arg;
        return { error: null };
      }
      if (metodo === 'select') return { data: (cloud.rowsByTable[table] || []).slice(), error: null };
      return { error: null, data: [] };
    };
    return {
      upsert: (rows) => {
        const p = exec('upsert', rows);
        // PostgREST permite pedir representación después del upsert. STORE la
        // usa para confirmar sync_version y detectar conflictos H-06.
        p.select = () => p.then(r => ({ ...r, data: rows }));
        return p;
      },
      insert: (rows) => exec('insert', rows),
      update: (patch) => ({
        eq: (col, value) => ({
          select: async () => {
            calls.push({ table, metodo: 'update', filtro: `eq:${col}:${value}` });
            const rows = cloud.rowsByTable[table] || [];
            const current = rows.find(row => row[col] === value) || { [col]: value };
            const updated = { ...current, ...patch, sync_version: (Number(current.sync_version) || 0) + 1 };
            cloud.rowsByTable[table] = rows.some(row => row[col] === value)
              ? rows.map(row => row[col] === value ? updated : row)
              : rows.concat(updated);
            return { data: [updated], error: null };
          },
        }),
      }),
      // select devuelve un thenable ENCADENABLE (.gte/.eq/.in), como supabase-js.
      select: () => {
        const filtros = [];
        const p = new Promise(res => setTimeout(() => res(null), 0)).then(() => exec('select', null, filtros.join('&')));
        p.gte = (c, v) => { filtros.push('gte:' + c); return p; };
        p.eq = (c, v) => { filtros.push('eq:' + c + ':' + v); return p; };
        p.in = (c, v) => { filtros.push('in:' + c + ':' + v.length); return p; };
        return p;
      },
      delete: () => ({ eq: () => { const p = exec('delete'); p.eq = () => exec('delete'); return p; } }),
    };
  }
  const client = {
    from: mkQuery,
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return rpcHandler(name, args); },
    auth: { getSession: async () => ({ data: { session: null } }) },
    storage: { from: () => ({}) },
  };
  const window = {
    listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    supabase: { createClient: () => client },
    UI: { toasts: [], toast(msg) { this.toasts.push(msg); } },
    DATA: {
      movements: [], sellers: [], sales: [], applied: [], merged: [],
      saveSales() {},
      applyRemote(kind, rows) { this.applied.push({ kind, n: rows.length }); },
      applySyncResult() { return { conflicts: 0 }; },
      markSaleSync(folio, status, detail) {
        const sale = this.sales.find(s => s.folio === folio);
        if (!sale) return false;
        const changed = sale._syncStatus !== status;
        sale._syncStatus = status; sale._syncDetail = detail;
        if (status === 'synced') sale._stockReserved = true;
        return changed;
      },
      mergeRemote(kind, rows, key) { this.merged.push({ kind, rows, key }); rows.forEach(r => this.sales.push(r)); },
    },
    CONFIG: { load() {}, get() { return null; } },
  };
  return { localStorage, window, calls, cloud, client, rpcCalls,
    setFail: t => failTables.add(t), clearFail: t => failTables.delete(t),
    setRpc: fn => { rpcHandler = fn; },
    hold: () => { let release; gate = new Promise(r => { release = () => { gate = null; r(); }; }); return release; } };
}

const SRC = readFileSync(new URL('balam/store.jsx', import.meta.url), 'utf8');
function loadStore(env) {
  const fn = new Function('window', 'localStorage', 'document', 'CustomEvent', SRC + '\nreturn window.STORE;');
  return fn(env.window, env.localStorage, { createElement: () => ({}), head: { appendChild: () => {} } }, class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } });
}

// ── 1) Refresh con subida en vuelo: la op sobrevive en la cola ────────────────
{
  const env = freshEnv();
  const S = loadStore(env);
  await S.init({});
  const release = env.hold();
  S.pushRows('products', [{ id: 'p1', modelo: '1', stock: [], precio: 1, costo: 1 }]);
  await sleep(20);
  ok('1a. op persistida en cola ANTES de que la red responda', S.pending === 1);
  release(); // el contexto viejo se descarta ("refresh")
  const S2 = loadStore(env);
  await S2.init({});
  await sleep(50);
  ok('1b. tras recargar, la cola se drenó a la nube', S2.pending === 0);
  ok('1c. el producto llegó a la nube', (env.cloud.rowsByTable.products || []).length === 1);
}

// ── 2) init drena la cola ANTES del pull + migración de ops sin id ────────────
{
  const env = freshEnv();
  const S = loadStore(env);
  env.localStorage.setItem('balam_sync_queue', JSON.stringify([
    { type: 'upsert', table: 'products', conflict: 'id', rows: [{ id: 'pOld', nombre: 'viejo' }] },
  ]));
  await S.init({ pull: true });
  const iUp = env.calls.findIndex(c => c.table === 'products' && c.metodo === 'upsert');
  const iSel = env.calls.findIndex(c => c.table === 'products' && c.metodo === 'select');
  ok('2a. migración: op sin id se procesó y la cola quedó vacía', S.pending === 0);
  ok('2b. el upsert pendiente corrió ANTES del select del pull', iUp >= 0 && iSel > iUp);
  ok('2c. el pull aplicó products a DATA (nube→local)', env.window.DATA.applied.some(a => a.kind === 'products'));
}

// ── 3) pullDomain NO pisa una tabla con cambios locales sin subir ─────────────
{
  const env = freshEnv();
  const S = loadStore(env);
  await S.init({});
  env.setFail('products');
  S.pushRows('products', [{ id: 'pNew', modelo: '2', stock: [], precio: 1, costo: 1 }]);
  await sleep(30);
  ok('3a. op fallida quedó en cola', S.pending === 1);
  env.cloud.rowsByTable.products = [{ id: 'viejo-en-nube' }];
  await S.pullDomain('products');
  ok('3b. pullDomain se saltó la tabla sucia (no llamó applyRemote)', !env.window.DATA.applied.some(a => a.kind === 'products'));
  env.clearFail('products');
  await S.flushQueue();
  await sleep(30);
  ok('3c. al volver la red, el cambio local subió', (env.cloud.rowsByTable.products || [])[0] && env.cloud.rowsByTable.products[0].id === 'pNew');
  await S.pullDomain('products');
  ok('3d. ya sin pendientes, el pull vuelve a aplicar normal', env.window.DATA.applied.some(a => a.kind === 'products'));
}

// ── 4) Coalescencia: upsert reemplazado en vuelo no se pierde ni se duplica ───
{
  const env = freshEnv();
  const S = loadStore(env);
  await S.init({});
  const release = env.hold();
  S.pushRows('products', [{ id: 'v1', modelo: '1', stock: [], precio: 1, costo: 1 }]);
  await sleep(10);
  S.pushRows('products', [{ id: 'v2', modelo: '1', stock: [], precio: 1, costo: 1 }]);
  await sleep(10);
  ok('4a. la cola coalesce ediciones rápidas (1 op, la última)', S.pending === 1);
  release();
  await sleep(60);
  ok('4b. estado final en la nube = último snapshot (v2)', (env.cloud.rowsByTable.products || [])[0] && env.cloud.rowsByTable.products[0].id === 'v2');
  ok('4c. cola vacía al terminar', S.pending === 0);
}

// ── 5) Reintento con aviso: falla → recuperación → toast (una sola vez) ───────
{
  const env = freshEnv();
  const S = loadStore(env);
  await S.init({});
  env.setFail('clients');
  S.pushRows('clients', [{ id: 'c1', nombre: 'Ana' }]);
  await sleep(30);
  ok('5a. sin toast mientras sigue fallando', env.window.UI.toasts.length === 0);
  env.clearFail('clients');
  await S.flushQueue();
  await sleep(30);
  ok('5b. recuperado: toast "sincronizados" una vez', env.window.UI.toasts.filter(t => /sincronizados/.test(t)).length === 1);
  S.pushRows('clients', [{ id: 'c2', nombre: 'Luis' }]);
  await sleep(30);
  ok('5c. guardado normal (sin fallo previo) NO genera toast', env.window.UI.toasts.filter(t => /sincronizados/.test(t)).length === 1);
}

// ── 6) Ops encoladas DURANTE un flush no se pierden ───────────────────────────
{
  const env = freshEnv();
  const S = loadStore(env);
  await S.init({});
  const release = env.hold();
  S.pushRows('products', [{ id: 'a', modelo: '1', stock: [], precio: 1, costo: 1 }]);
  await sleep(10);
  S.pushRows('sellers', [{ id: 's1', nombre: 'X', iniciales: 'X', color: '#000' }]);
  await sleep(10);
  release();
  await sleep(80);
  ok('6a. ambas tablas llegaron a la nube', !!env.cloud.rowsByTable.products && !!env.cloud.rowsByTable.sellers);
  ok('6b. cola vacía', S.pending === 0);
}

// ── 7) uploadProductPhoto / uploadBarcode (contrato de Storage) ────────────────
{
  const env = freshEnv();
  const uploads = [];
  env.client.auth.getSession = async () => ({ data: { session: env.hasSess ? {} : null } });
  env.client.storage.from = (bucket) => ({
    upload: async (path, blob, opts) => { uploads.push({ bucket, path, ct: opts.contentType, upsert: opts.upsert }); return { error: null }; },
    getPublicUrl: (path) => ({ data: { publicUrl: 'https://cdn.test/' + path } }),
  });
  const S = loadStore(env);
  env.hasSess = false;
  let threw = false;
  try { await S.uploadProductPhoto('a.jpg', {}); } catch (e) { threw = true; }
  ok('7a. sin sesión, uploadProductPhoto lanza (no sube nada)', threw && uploads.length === 0);
  env.hasSess = true;
  const url = await S.uploadProductPhoto('prod-x1.jpg', {});
  ok('7b. con sesión sube al bucket product-photos con upsert', uploads.length === 1 && uploads[0].bucket === 'product-photos' && uploads[0].upsert === true && uploads[0].ct === 'image/jpeg');
  ok('7c. devuelve la URL pública', url === 'https://cdn.test/prod-x1.jpg');
  const url2 = await S.uploadBarcode('BG-1-M.png', {});
  ok('7d. uploadBarcode conserva su contrato (bucket barcodes, PNG)', uploads[1].bucket === 'barcodes' && uploads[1].ct === 'image/png' && url2 === 'https://cdn.test/BG-1-M.png');
}

// ── 8) Pull PAGINADO de ventas: ventana + apartados, dedup, merge (no replace) ─
{
  const env = freshEnv();
  const S = loadStore(env);
  await S.init({});
  env.cloud.rowsByTable.sales = [
    { folio: 'BG-1', fecha: '2026-07-01T10:00:00', vendedores: [], estado: 'Pagado', items: 1, total: 100, metodo: 'Efectivo', cliente: 'A' },
    { folio: 'BG-2', fecha: '2026-06-01T10:00:00', vendedores: [], estado: 'Apartado', items: 1, total: 200, metodo: 'Efectivo', cliente: 'B' },
  ];
  env.cloud.rowsByTable.sale_items = [
    { folio: 'BG-1', sku: 'S1', nombre: 'P1', talla: 'M', qty: 1, precio: 100 },
  ];
  await S.pullDomain('sales');
  const merged = env.window.DATA.merged.find(m => m.kind === 'sales');
  ok('8a. ventas van por mergeRemote (fusión), NUNCA por applyRemote (reemplazo)', !!merged && !env.window.DATA.applied.some(a => a.kind === 'sales'));
  ok('8b. dedup ventana∪apartados: 2 folios únicos (el stub sirve ambos queries)', merged && merged.rows.length === 2 && merged.key === 'folio');
  ok('8c. la consulta de ventas filtra (gte fecha / eq estado), ya no baja todo', env.calls.some(c => c.table === 'sales' && /gte:fecha/.test(c.filtro)) && env.calls.some(c => c.table === 'sales' && /eq:estado:Apartado/.test(c.filtro)));
  ok('8d. sale_items se pide por folios (in), no la tabla completa', env.calls.some(c => c.table === 'sale_items' && /in:folio/.test(c.filtro)));
  const bg1 = merged && merged.rows.find(r => r.folio === 'BG-1');
  ok('8e. los renglones se adjuntan a su venta', bg1 && bg1.lineas.length === 1 && bg1.lineas[0].sku === 'S1');
}

// ── 9) fetchSaleByFolio: folio viejo bajo demanda ──────────────────────────────
{
  const env = freshEnv();
  const S = loadStore(env);
  await S.init({});
  env.cloud.rowsByTable.sales = [{ folio: 'BG-9', fecha: '2020-01-01T10:00:00', vendedores: [], estado: 'Pagado', items: 1, total: 50, metodo: 'Efectivo', cliente: 'X' }];
  env.cloud.rowsByTable.sale_items = [{ folio: 'BG-9', sku: 'S9', nombre: 'P9', talla: 'L', qty: 1, precio: 50 }];
  const s = await S.fetchSaleByFolio('BG-9');
  ok('9a. encuentra el folio, lo fusiona y lo devuelve con renglones', !!s && s.folio === 'BG-9' && s.lineas.length === 1 && env.window.DATA.merged.some(m => m.kind === 'sales'));
  env.cloud.rowsByTable.sales = [];
  const n = await S.fetchSaleByFolio('NO-EXISTE');
  ok('9b. folio inexistente → null (sin explotar)', n === null);
}

// ── 10) H-03: snapshot monetario de apartado ida/vuelta ──────────────
{
  const env = freshEnv();
  const S = loadStore(env);
  await S.init({});
  S.pushSale({
    folio: 'BG-H03', fecha: '2026-07-25 10:00', cliente: 'Ana', vendedores: [],
    metodo: 'Apartado', estado: 'Apartado', items: 1,
    subtotal: 1000, iva: 0, total: 1000, ivaPct: 0, ivaIncluded: true,
    anticipo: 300, saldo: 700, pagoEfectivo: 0, pagoOtro: 0, descuento: 50,
    lineas: [{ sku: 'S1', nombre: 'P1', talla: 'M', qty: 1, precio: 1150, precioBase: 1150, precioOrig: 1200 }],
  });
  await sleep(40);
  const row = (env.cloud.rowsByTable.sales || [])[0];
  ok('10a. pushSale envía total/anticipo/saldo exactos', row && row.total === 1000 && row.anticipo === 300 && row.saldo === 700);
  const item = (env.cloud.rowsByTable.sale_items || [])[0];
  ok('10b. descuento y precios explicativos llegan a la nube', row && row.descuento === 50 && item && item.precio === 1150 && item.precio_base === 1150 && item.precio_original === 1200);
  env.window.DATA.merged.length = 0;
  env.cloud.rowsByTable.sales = [row];
  await S.pullDomain('sales');
  const back = env.window.DATA.merged[0] && env.window.DATA.merged[0].rows[0];
  ok('10c. otra terminal reconstruye el snapshot exacto', back && back.total === 1000 && back.anticipo === 300 && back.saldo === 700 && back.descuento === 50 && back.lineas[0].precioOrig === 1200);
}

// ── 11) Historial de pagos entre terminales ───────────────────────────
{
  const env = freshEnv();
  env.window.DATA.payments = [];
  const S = loadStore(env);
  await S.init({});
  S.pushRows('payments', [
    { id: 'pay-1', folio: 'BG-H03', fecha: '2026-07-25 10:00', tipo: 'anticipo', metodo: 'Efectivo', monto: 300, efectivo: 300, tarjeta: 0, transferencia: 0, otro: 0 },
    { id: 'pay-2', folio: 'BG-H03', fecha: '2026-07-26 10:00', tipo: 'abono', metodo: 'Tarjeta', monto: 200, efectivo: 0, tarjeta: 200, transferencia: 0, otro: 0 },
  ]);
  await sleep(40);
  const cloudPay = env.cloud.rowsByTable.sale_payments || [];
  ok('11a. historial identifica cada componente de pago', cloudPay.length === 2 && cloudPay[0].efectivo === 300 && cloudPay[1].tarjeta === 200);
  await S.pullDomain('payments');
  ok('11b. otra terminal recibe el historial de pagos', env.window.DATA.applied.some(a => a.kind === 'payments' && a.n === 2));
}

// ── 12) Vendedor no puede saltarse la reserva atómica con pushRows ───────────
{
  const env = freshEnv();
  env.window.AUTH = { role: () => 'vendedor' };
  env.window.DATA.products = [{ id: 'p-staff', modelo: '1', stock: [{ talla: 'M', stock: 2 }], precio: 100, costo: 50 }];
  env.cloud.rowsByTable.products = [{ id: 'p-staff', modelo: '1', stock: [{ talla: 'M', stock: 3 }], sync_version: 0 }];
  const S = loadStore(env);
  await S.init({});
  S.pushRows('products', env.window.DATA.products);
  await sleep(40);
  ok('12a. vendedor no envía UPDATE directo de inventario', !env.calls.some(c => c.table === 'products' && c.metodo === 'update'));
  ok('12b. vendedor no usa UPSERT de inventario', !env.calls.some(c => c.table === 'products' && c.metodo === 'upsert'));
  ok('12c. no se crea una operación de stock fuera de la venta', S.pending === 0);
}

// ── 13) H-01: reserva atómica antes de crear la venta ────────────────────────
{
  const env = freshEnv();
  const sale = {
    folio: 'BG-H01', fecha: '2026-07-25 12:00', cliente: 'Público',
    vendedores: ['s1'], metodo: 'Efectivo', estado: 'Pagado', items: 1,
    total: 100, _operationId: 'op-h01-stable', _stockRequired: true,
    _syncStatus: 'pending',
    lineas: [{ productId: 'p-last', sku: 'LAST', nombre: 'Última', talla: 'M', qty: 1, precio: 100 }],
  };
  env.window.DATA.sales = [sale];
  env.window.DATA.products = [{ id: 'p-last', sku: 'LAST', _syncVersion: 1, stock: [{ talla: 'M', stock: 0 }] }];
  env.setRpc(async () => ({
    data: { ok: false, error: 'insufficient_stock', shortages: [{ product_id: 'p-last', talla: 'M', requested: 1, available: 0 }] },
    error: null,
  }));
  const S = loadStore(env);
  await S.init({});
  S.pushSale(sale);
  await sleep(40);
  ok('13a. sin stock remoto no se inserta la venta', !env.calls.some(c => c.table === 'sales' && c.metodo === 'upsert'));
  ok('13b. la venta queda pendiente y recuperable en cola', S.pending === 1 && sale._syncStatus === 'stock_pending');
  ok('13c. el commit usa product_id/talla/cantidad e id estable', env.rpcCalls[0]?.name === 'commit_sale'
    && env.rpcCalls[0].args.p_operation_id === 'op-h01-stable'
    && env.rpcCalls[0].args.p_stock_lines[0].product_id === 'p-last');

  env.setRpc(async () => ({
    data: {
      ok: true, idempotent: false,
      products: [{ id: 'p-last', sku: 'LAST', stock: [{ talla: 'M', stock: 0 }], sync_version: 2 }],
    },
    error: null,
  }));
  await S.flushQueue();
  await sleep(40);
  ok('13d. al existir stock/reintentar, la venta se persiste y sale de cola',
    env.rpcCalls.length === 2 && env.rpcCalls[1].name === 'commit_sale' && S.pending === 0);
  ok('13e. el reintento conserva la misma clave idempotente',
    env.rpcCalls.length === 2 && env.rpcCalls.every(c => c.args.p_operation_id === 'op-h01-stable'));
}

// ── 14) H-04: un fallo intermedio revierte la venta completa ────────────────
{
  const env = freshEnv();
  const sale = {
    folio: 'BG-H04', fecha: '2026-07-25 13:00', cliente: 'Ana',
    vendedores: ['s1'], metodo: 'Efectivo', estado: 'Pagado', items: 1,
    total: 100, _operationId: 'op-h04-partial', _stockRequired: true,
    _syncStatus: 'pending',
    lineas: [{ productId: 'p-h04', sku: 'H04', nombre: 'Parcial', talla: 'M', qty: 1, precio: 100 }],
  };
  env.window.DATA.sales = [sale];
  env.setFail('sale_items');
  const S = loadStore(env);
  await S.init({});
  S.pushSale(sale);
  await sleep(50);
  ok('14a. H-04: la venta completa viaja en un único RPC',
    env.rpcCalls[0]?.name === 'commit_sale'
      && env.rpcCalls[0].args.p_sale.folio === 'BG-H04'
      && env.rpcCalls[0].args.p_items.length === 1);
  ok('14b. H-04: el fallo no deja cabecera ni renglones parciales',
    !env.cloud.rowsByTable.sales && !env.cloud.rowsByTable.sale_items);
  ok('14c. H-04: la operación completa permanece recuperable en cola',
    S.pending === 1);
}

// ── 15) H-04: un fallo revierte la devolución completa ──────────────────────
{
  const env = freshEnv();
  const ret = {
    id: 'ret-h04-partial', folio: 'BG-H04-RET', fecha: '2026-07-25 14:00',
    cliente: 'Ana', vendedores: ['s1'], metodo: 'Efectivo', total: 100,
    notas: '', lineas: [{ sku: 'H04', nombre: 'Parcial', talla: 'M', qty: 1, motivo: 'Talla', precio: 100 }],
  };
  env.window.DATA.movements = [
    { fecha: ret.fecha, tipo: 'Devolución', producto: 'Parcial', sku: 'H04', cant: 1, ref: ret.folio },
  ];
  env.setFail('return_items');
  const S = loadStore(env);
  await S.init({});
  S.pushReturn(ret);
  await sleep(50);
  ok('15a. H-04: la devolución completa viaja en un único RPC',
    env.rpcCalls[0]?.name === 'commit_return'
      && env.rpcCalls[0].args.p_return.id === ret.id
      && env.rpcCalls[0].args.p_items.length === 1);
  ok('15b. H-04: el fallo no deja cabecera ni renglones parciales',
    !env.cloud.rowsByTable.returns && !env.cloud.rowsByTable.return_items);
  ok('15c. H-04: la operación completa permanece recuperable en cola',
    S.pending === 1);
  const commitId = env.rpcCalls[0].args.p_commit_id;
  env.clearFail('return_items');
  await S.flushQueue();
  await sleep(40);
  ok('15d. H-04: el reintento confirma cabecera y renglones juntos',
    S.pending === 0
      && env.cloud.rowsByTable.returns?.length === 1
      && env.cloud.rowsByTable.return_items?.length === 1);
  ok('15e. H-04: el reintento conserva la misma clave idempotente',
    env.rpcCalls.length === 2
      && env.rpcCalls.every(c => c.args.p_commit_id === commitId));
}

// ── 16) H-04: cola legacy adopta objetivos versionados exactos ───────────────
{
  const env = freshEnv();
  env.window.DATA.products = [{ id: 'p-legacy', sku: 'LEG', stock: [{ talla: 'M', stock: 4 }], _syncVersion: 7 }];
  env.window.DATA.clients = [{ id: 'c-legacy', nombre: 'Ana', total: 300, _syncVersion: 2 }];
  env.window.DATA.sellers = [{ id: 's-legacy', ventasMes: 300, comisionAcum: 15, _syncVersion: 5 }];
  env.window.DATA.sales = [{ folio: 'BG-LEG', estado: 'Devolución parcial', clienteId: 'c-legacy', cliente: 'Ana', vendedores: ['s-legacy'] }];
  env.localStorage.setItem('balam_sync_queue', JSON.stringify([{
    id: 'old-return-op', type: 'return', idReturn: 'unused',
    id: 'old-return-op', folio: 'BG-LEG',
    header: { id: 'ret-legacy', folio: 'BG-LEG', total: 100 },
    items: [{ return_id: 'ret-legacy', sku: 'LEG', talla: 'M', qty: 1, precio: 100 }],
    moves: [{ fecha: '2026-07-25T14:00', tipo: 'Devolución', sku: 'LEG', cant: 1, ref: 'BG-LEG' }],
  }]));
  const S = loadStore(env);
  await S.init({});
  await sleep(40);
  const call = env.rpcCalls.find(c => c.name === 'commit_legacy_return');
  ok('16a. legacy: la operación antigua usa el RPC de adopción',
    !!call && call.args.p_commit_id === 'old-return-op');
  ok('16b. legacy: transporta objetivos y versiones de stock, cliente y vendedor',
    call && call.args.p_targets.complete === true
      && call.args.p_targets.products[0].base_version === 7
      && call.args.p_targets.products[0].stock[0].stock === 4
      && call.args.p_targets.client.base_version === 2
      && call.args.p_targets.client.total === 300
      && call.args.p_targets.sellers[0].base_version === 5
      && call.args.p_targets.sellers[0].ventas_mes === 300);
}

// ── 17) H-02: un folio antiguo en conflicto se reidentifica y reintenta ──────
{
  const env = freshEnv();
  const operationId = '550e8400-e29b-41d4-a716-446655440000';
  const sale = {
    folio: 'BG-1043', fecha: '2026-07-25 15:00', cliente: 'Ana',
    vendedores: [], metodo: 'Apartado', estado: 'Apartado', items: 1,
    total: 100, _operationId: operationId, _stockRequired: false,
    _syncStatus: 'pending',
    lineas: [{ productId: 'p-h02', sku: 'H02', nombre: 'Único', talla: 'M', qty: 1, precio: 100 }],
  };
  env.window.DATA.sales = [sale];
  env.window.DATA.payments = [{ id: 'pay-h02', folio: sale.folio }];
  env.window.DATA.movements = [{ tipo: 'Venta', ref: sale.folio, sku: 'H02' }];
  env.window.DATA.returns = [];
  env.window.DATA.collisionSafeFolio = (folio) => folio + '-A5E3K8V2J7Q9';
  env.window.DATA.rekeySaleFolio = (id, oldFolio, newFolio) => {
    if (id !== operationId || sale.folio !== oldFolio) return false;
    sale.folio = newFolio;
    env.window.DATA.payments.forEach(x => { if (x.folio === oldFolio) x.folio = newFolio; });
    env.window.DATA.movements.forEach(x => { if (x.ref === oldFolio) x.ref = newFolio; });
    return true;
  };
  let attempt = 0;
  env.setRpc(async (name, args) => {
    if (name !== 'commit_sale') return { data: { ok: true }, error: null };
    attempt++;
    if (attempt === 1) return { data: { ok: false, error: 'folio_conflict' }, error: null };
    return { data: { ok: true, products: [], clients: [], sellers: [] }, error: null };
  });
  const S = loadStore(env);
  await S.init({});
  S.pushSale(sale, { payments: env.window.DATA.payments });
  await sleep(70);
  ok('17a. H-02: el conflicto usa la misma identidad inmutable en el reintento',
    env.rpcCalls.length === 2
      && env.rpcCalls.every(c => c.args.p_operation_id === operationId));
  ok('17b. H-02: folio, renglones, pagos y movimientos se reidentifican juntos',
    sale.folio === 'BG-1043-A5E3K8V2J7Q9'
      && env.rpcCalls[1].args.p_sale.folio === sale.folio
      && env.rpcCalls[1].args.p_items.every(x => x.folio === sale.folio)
      && env.rpcCalls[1].args.p_payments.every(x => x.folio === sale.folio)
      && env.rpcCalls[1].args.p_moves.every(x => x.ref === sale.folio));
  ok('17c. H-02: el reintento exitoso vacía la cola', S.pending === 0);
}

// 18) H-09: logout/login no mezcla ni reemplaza colas entre identidades
{
  const env = freshEnv();
  let profile = { email: 'admin-a@balam.test', role: 'admin' };
  env.window.AUTH = { current: () => profile };
  env.setFail('products');
  const S = loadStore(env);
  await S.setSession(profile);
  S.pushRows('products', [{ id: 'p-a', nombre: 'Pendiente A' }]);
  await sleep(40);

  let queue = JSON.parse(env.localStorage.getItem('balam_sync_queue'));
  ok('18a. H-09: la operación conserva al usuario A como propietario',
    queue.length === 1 && queue[0].ownerId === 'admin-a@balam.test');

  profile = null;
  await S.setSession(null);
  profile = { email: 'vendedor-b@balam.test', role: 'vendedor' };
  env.clearFail('products');
  await S.setSession(profile);
  await sleep(40);
  queue = JSON.parse(env.localStorage.getItem('balam_sync_queue'));
  ok('18b. H-09: iniciar B no envía ni elimina la operación de A',
    queue.length === 1 && queue[0].ownerId === 'admin-a@balam.test'
      && !(env.cloud.rowsByTable.products || []).some(x => x.id === 'p-a'));

  S.pushRows('products', [{ id: 'p-b', nombre: 'Cambio B' }]);
  await sleep(40);
  queue = JSON.parse(env.localStorage.getItem('balam_sync_queue'));
  ok('18c. H-09: B sincroniza sin reemplazar la operación de A',
    queue.length === 1 && queue[0].ownerId === 'admin-a@balam.test'
      && (env.cloud.rowsByTable.products || []).some(x => x.id === 'p-b'));

  profile = null;
  await S.setSession(null);
  profile = { email: 'admin-a@balam.test', role: 'admin' };
  await S.setSession(profile);
  await sleep(40);
  ok('18d. H-09: al volver A, su cola se reanuda y queda vacía',
    S.pending === 0 && (env.cloud.rowsByTable.products || []).some(x => x.id === 'p-a'));
}

// 19) H-09: una cola sin propietario se pone en cuarentena
{
  const env = freshEnv();
  let profile = { email: 'admin-b@balam.test', role: 'admin' };
  env.window.AUTH = { current: () => profile };
  env.localStorage.setItem('balam_sync_queue', JSON.stringify([{
    type: 'upsert', table: 'products', conflict: 'id',
    rows: [{ id: 'p-legacy-owner', nombre: 'Sin propietario' }],
  }]));
  const S = loadStore(env);
  await S.setSession(profile);
  await sleep(40);
  let queue = JSON.parse(env.localStorage.getItem('balam_sync_queue'));
  ok('19a. H-09: la cola histórica no se atribuye al primer login',
    queue.length === 1 && queue[0].ownerId === '__legacy_unclaimed__'
      && !(env.cloud.rowsByTable.products || []).some(x => x.id === 'p-legacy-owner'));
  ok('19b. H-09: la terminal avisa que requiere revisión administrativa',
    env.window.UI.toasts.some(msg => msg.includes('cuarentena')));

  const claim = S.claimLegacyQueue();
  await sleep(40);
  ok('19c. H-09: el administrador puede reclamarla de forma explícita',
    claim.ok && claim.claimed === 1 && S.pending === 0
      && (env.cloud.rowsByTable.products || []).some(x => x.id === 'p-legacy-owner'));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
