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
      upsert: (rows) => exec('upsert', rows),
      insert: (rows) => exec('insert', rows),
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
      applyRemote(kind, rows) { this.applied.push({ kind, n: rows.length }); },
      mergeRemote(kind, rows, key) { this.merged.push({ kind, rows, key }); rows.forEach(r => this.sales.push(r)); },
    },
    CONFIG: { load() {}, get() { return null; } },
  };
  return { localStorage, window, calls, cloud, client,
    setFail: t => failTables.add(t), clearFail: t => failTables.delete(t),
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
    anticipo: 300, saldo: 700, pagoEfectivo: 0, pagoOtro: 0, lineas: [],
  });
  await sleep(40);
  const row = (env.cloud.rowsByTable.sales || [])[0];
  ok('10a. pushSale envía total/anticipo/saldo exactos', row && row.total === 1000 && row.anticipo === 300 && row.saldo === 700);
  env.window.DATA.merged.length = 0;
  env.cloud.rowsByTable.sales = [row];
  await S.pullDomain('sales');
  const back = env.window.DATA.merged[0] && env.window.DATA.merged[0].rows[0];
  ok('10b. otra terminal reconstruye el snapshot exacto', back && back.total === 1000 && back.anticipo === 300 && back.saldo === 700);
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
