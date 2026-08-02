// test-reset-propaga.mjs — La limpieza de datos de prueba VIAJA entre terminales.
// Simula Supabase (servidor falso con estado) y ejercita STORE.init({pull:true}):
// una marca nueva en pos.settings hace que ESTA terminal borre sus datos de prueba y
// restaure su stock, una sola vez, sin tocar inventario y sin pisar ventas sin subir.
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
await new Promise(r => server.listen(8803, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage();
page.on('pageerror', e => errs.push(String(e)));
await page.addInitScript(() => {
  const baseUrl = 'https://telohdbvbvsfmwyriflz.supabase.co';
  function request(path, method, body) {
    return fetch(baseUrl + '/rest/v1/' + path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    }).then(async response => {
      let data = null;
      try { data = JSON.parse(await response.text()); } catch (error) { /* vacío */ }
      return {
        data,
        error: response.ok ? null : { message: response.statusText, status: response.status },
      };
    });
  }
  function from(table) {
    let method = 'GET';
    let body;
    const builder = {
      select: () => builder,
      order: () => builder,
      range: () => builder,
      gte: () => builder,
      eq: () => builder,
      is: () => builder,
      in: () => builder,
      ilike: () => builder,
      upsert: rows => { method = 'POST'; body = rows; return builder; },
      insert: rows => { method = 'POST'; body = rows; return builder; },
      update: rows => { method = 'PATCH'; body = rows; return builder; },
      delete: () => { method = 'DELETE'; return builder; },
      maybeSingle: () => request(table, method, body).then(result => ({
        ...result,
        data: Array.isArray(result.data) ? (result.data[0] || null) : result.data,
      })),
      then: (resolve, reject) => request(table, method, body).then(resolve, reject),
    };
    return builder;
  }
  const client = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    from,
    rpc: (name, args) => request('rpc/' + name, 'POST', args),
    storage: { from: () => ({}) },
    functions: { invoke: async () => ({ data: null, error: null }) },
  };
  window.supabase = { createClient: () => client };
});

// ── Nube falsa CON ESTADO: lo que se sube queda guardado y lo devuelve el siguiente GET.
// Así se comprueba el ORDEN (limpiar y subir ANTES de bajar el dominio): si se invirtiera,
// el pull traería el stock viejo y pisaría la restauración.
const db = { lookup: [], settings: [], products: [], clients: [], sellers: [], sales: [], promotions: [], returns: [], liquidations: [], sale_items: [], return_items: [], movements: [] };
const seenPosts = [];
// OJO: Playwright prueba las rutas en orden INVERSO al registrado. La jaula genérica va
// PRIMERO para que la ruta específica de /rest/v1/ (registrada después) tenga prioridad.
await page.route(/supabase\.co/, r => r.abort());
await page.route(/supabase\.co\/rest\/v1\//, async route => {
  const req = route.request();
  const table = new URL(req.url()).pathname.split('/rest/v1/')[1].split('?')[0];
  const m = req.method();
  if (m === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(db[table] || []) });
  if (m === 'POST' || m === 'PATCH') {
    let rows = []; try { rows = JSON.parse(req.postData() || '[]'); } catch (e) { /* */ }
    if (table === 'rpc/commit_sale'
        || table === 'rpc/commit_sale_checked'
        || table === 'rpc/commit_sale_with_additional_discount_checked') {
      const existingSale = db.sales.findIndex(item => item.folio === rows.p_sale.folio);
      if (existingSale >= 0) db.sales[existingSale] = rows.p_sale;
      else db.sales.push(rows.p_sale);
      db.sale_items = db.sale_items.filter(item => item.folio !== rows.p_sale.folio);
      db.sale_items.push(...(rows.p_items || []));
      const products = [];
      if (rows.p_reserve_stock) (rows.p_stock_lines || []).forEach(line => {
        const product = db.products.find(item => item.id === line.product_id);
        const size = product && (product.stock || []).find(item => item.talla === line.talla);
        if (size) {
          size.stock -= Number(line.qty) || 0;
          product.version = (Number(product.version) || 0) + 1;
          if (!products.includes(product)) products.push(product);
        }
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true, products, clients: [], sellers: [],
        stock_reserved: rows.p_reserve_stock === true,
        stock_idempotent: false,
        reservation_operation_id: rows.p_reserve_stock === true ? rows.p_operation_id : null,
      }) });
    }
    if (table === 'rpc/commit_return' || table === 'rpc/commit_return_checked') {
      db.returns.push(rows.p_return);
      db.return_items.push(...(rows.p_items || []));
      const products = [];
      (rows.p_stock_lines || []).forEach(line => {
        const product = db.products.find(item => item.id === line.product_id);
        const size = product && (product.stock || []).find(item => item.talla === line.talla);
        if (size) {
          size.stock += Number(line.qty) || 0;
          product.version = (Number(product.version) || 0) + 1;
          if (!products.includes(product)) products.push(product);
        }
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, products, clients: [], sellers: [] }) });
    }
    if (table === 'rpc/save_products_checked') {
      const productRows = Array.isArray(rows.p_rows) ? rows.p_rows : [];
      seenPosts.push('products');
      productRows.forEach(row => {
        const index = db.products.findIndex(item => item.id === row.id);
        if (index >= 0) db.products[index] = row;
        else db.products.push(row);
      });
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (!Array.isArray(rows)) rows = [rows];
    seenPosts.push(table);
    const key = table === 'sales' ? 'folio' : (table === 'settings' || table === 'lookup') ? 'key' : 'id';
    db[table] = db[table] || [];
    rows.forEach(r => { const i = db[table].findIndex(x => x[key] === r[key]); if (i >= 0) db[table][i] = r; else db[table].push(r); });
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  }
  return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
});

await page.goto('http://127.0.0.1:8803/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.STORE && window.CONFIG, null, { timeout: 25000 });

// lookup/settings reales de esta instalación → la nube falsa devuelve config VÁLIDA
const cfg = await page.evaluate(() => {
  const C = window.CONFIG, lookup = [];
  ['category', 'fabric', 'sleeve', 'neck', 'color', 'ornament', 'size_letter', 'size_number', 'payment_method', 'sale_status', 'movement_type', 'return_reason']
    .forEach(kind => (C.all(kind) || []).forEach((it, i) => lookup.push({ kind, code: it.code, label: it.label, active: it.active !== false, meta: it.meta || {}, sort_order: i })));
  const s = C.settings(), settings = Object.keys(s).map(k => ({ key: k, value: s[k] }));
  settings.push({ key: '_catalogMeta', value: C.allCatalogMeta() });
  return { lookup, settings };
});
db.lookup = cfg.lookup;
const baseSettings = cfg.settings;
const setMark = v => { db.settings = baseSettings.concat(v === null ? [] : [{ key: '_resetMark', value: v }]); };

// ── Fixture: inventario real + datos de prueba (venta, devolución, promo, cliente)
const sembrar = () => page.evaluate(() => {
  const D = window.DATA;
  let p = D.products.find(x => x.id === 'prop-inv-1');
  if (!p) {
    p = D.hydrate({ id: 'prop-inv-1', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo: '888', nombre: 'Guayabera Prop', orn: '—', ornColors: [], precio: 500, costo: 200, pop: false, stock: D.mkStock([0, 10], []) });
    // Fixture local: no encolar un snapshot de producto junto con la venta,
    // porque el RPC transaccional es la única autoridad del descuento remoto.
    D.products.push(p);
  }
  let sel = D.sellers.find(x => x.id === 'v-prop');
  if (!sel) { sel = { id: 'v-prop', nombre: 'Vendedor Prop', iniciales: 'VP', color: '#333', comisionPct: 10, metaMes: 0, ventasMes: 0, ventasNum: 0, comisionAcum: 0, bono: 'Sin bono', role: 'vendedor', active: true }; D.sellers.push(sel); D.saveSellers(); }
  const talla = p.stock.find(v => v.stock > 0).talla;
  const s1 = D.recordSale({ ticket: [{ p, talla, qty: 3 }], sellerIds: [sel.id], client: null, metodo: 'Efectivo', estado: 'Pagado', total: 1500, itemCount: 3 });
  D.recordReturn({ folio: s1.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 1, motivo: 'talla', precio: 500 }], metodo: 'Efectivo' });
  D.promos.push({ id: 'promo-prop', nombre: 'Promo prop', tipo: 'pct', valor: 10, scope: {}, pausado: false, creado: Date.now() }); D.savePromos();
  return { talla, stock: p.stock.find(v => v.talla === talla).stock, sales: D.sales.length };
});
const estado = () => page.evaluate(() => {
  const D = window.DATA, p = D.products.find(x => x.id === 'prop-inv-1');
  const e = p && p.stock.find(v => v.stock >= 0 && v.talla === (p.stock.find(z => z.talla) || {}).talla);
  return {
    sales: D.sales.length, returns: D.returns.length, promos: D.promos.length,
    products: D.products.length, productoVive: !!p,
    stock: p ? p.stock.reduce((a, v) => a + (Number(v.stock) || 0), 0) : -1,
    seen: localStorage.getItem('balam_reset_seen'),
    marcaEnConfig: window.CONFIG.get('_resetMark'),
    cola: window.STORE.pending,
  };
});
const init = () => page.evaluate(() => window.STORE.init({ pull: true }));
// Sube lo capturado (sesión anterior con internet): la nube falsa queda igual que la terminal.
const sincronizar = async () => { await page.evaluate(() => window.STORE.flushQueue()); await page.waitForTimeout(300); };
// Simula correr LIMPIAR-PRUEBAS.sql: vacía lo transaccional de la nube y deja la marca.
// pos.products NO se toca (igual que el SQL real).
const correrSQL = mark => {
  db.sales = []; db.sale_items = []; db.returns = []; db.return_items = [];
  db.promotions = []; db.liquidations = []; db.movements = []; db.clients = [];
  setMark(mark);
};

// ══ 1) Marca NUEVA → la terminal se limpia sola y restaura su stock ═══════════════
const f1 = await sembrar();
const antes = await estado();
check('fixture: venta+devolución dejaron el stock en 8', antes.stock === 8, String(antes.stock));
check('fixture: hay ventas/devoluciones/promos de prueba', antes.sales === 1 && antes.returns === 1 && antes.promos === 1);

await sincronizar();   // la terminal ya subió sus pruebas (sesión anterior con internet)
check('la nube falsa recibió las ventas de prueba', db.sales.length === 1, `sales=${db.sales.length}`);
correrSQL(1000);       // ahora el dueño corre el SQL: nube limpia + marca
db.products = [];      // la nube aún no tiene el stock restaurado (nadie pulsó el botón)
seenPosts.length = 0;
await init();
const d1 = await estado();
check('marca nueva → ventas borradas', d1.sales === 0, `sales=${d1.sales}`);
check('marca nueva → devoluciones borradas', d1.returns === 0);
check('marca nueva → descuentos borrados', d1.promos === 0);
check('STOCK RESTAURADO a 10 (no lo pisó el pull)', d1.stock === 10, `got=${d1.stock} exp=10`);
check('INVENTARIO intacto (el producto vive)', d1.productoVive);
check('la marca queda registrada en la terminal', d1.seen === '1000', String(d1.seen));
check('subió el stock restaurado a la nube', seenPosts.includes('products'), JSON.stringify([...new Set(seenPosts)]));
check('la nube recibió el stock ya restaurado', (db.products[0] && db.products[0].stock.reduce((a, v) => a + v.stock, 0)) === 10, JSON.stringify(db.products.length));
check('_resetMark NO contamina la configuración', d1.marcaEnConfig === undefined, String(d1.marcaEnConfig));

// ══ 2) MISMA marca → no vuelve a limpiar (sin doble restauración) ═════════════════
const f2 = await sembrar();
await sincronizar();
const antes2 = await estado();
await init();
const d2 = await estado();
check('misma marca → NO vuelve a limpiar', d2.sales === antes2.sales && d2.sales > 0, `sales=${d2.sales}`);
check('misma marca → NO duplica la restauración de stock', d2.stock === antes2.stock, `got=${d2.stock} exp=${antes2.stock}`);

// ══ 3) Cola pendiente (ventas capturadas sin internet) → NO se limpia ═════════════
correrSQL(2000);   // el dueño vuelve a correr el SQL: nube limpia + marca nueva
await page.evaluate(() => {
  // Op pendiente que la nube falsa rechazará: simula trabajo local sin subir.
  const q = [{ id: 'op-pendiente', type: 'upsert', table: 'no_existe', conflict: 'id', rows: [{ id: 'x' }] }];
  localStorage.setItem('balam_sync_queue', JSON.stringify(q));
});
await page.route(/rest\/v1\/no_existe/, r => r.fulfill({ status: 400, contentType: 'application/json', body: '{"message":"nope"}' }));
await init();
const d3 = await estado();
check('con ventas sin subir → NO se limpia (protege lo capturado)', d3.sales === antes2.sales && d3.sales > 0, `sales=${d3.sales}`);
check('la marca NO se marca como aplicada (se reintentará)', d3.seen === '1000', String(d3.seen));

// ══ 4) Cola drenada → la limpieza pendiente sí se aplica ══════════════════════════
await page.evaluate(() => localStorage.removeItem('balam_sync_queue'));
await init();
const d4 = await estado();
check('cola limpia → ahora sí aplica la limpieza pendiente', d4.sales === 0, `sales=${d4.sales}`);
check('y registra la marca nueva', d4.seen === '2000', String(d4.seen));
check('stock restaurado otra vez a 10', d4.stock === 10, `got=${d4.stock}`);

// ══ 5) Sin marca en la nube → nunca limpia (instalaciones que no corrieron el SQL) ═
setMark(null);
const f5 = await sembrar();
await sincronizar();
const antes5 = await estado();
await init();
const d5 = await estado();
check('sin marca → NO limpia nada', d5.sales === antes5.sales && d5.sales > 0, `sales=${d5.sales}`);

check('sin errores de página', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
