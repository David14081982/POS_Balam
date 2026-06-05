// store.jsx — Seam de nube (Supabase). LOCAL-FIRST + cola offline.
// CONFIG/DATA son la fuente de verdad en runtime; STORE solo sincroniza.
//   - init({pull}): jala config + dominio (nube gana al abrir) y drena la cola.
//   - push*: intentan subir; si no hay red o falla, ENCOLAN (localStorage) y
//     reintentan al reconectar (evento 'online') o en el próximo init.
// Requiere migraciones pos_001/002/003 corridas. Sin clave secreta no hay DDL.
(function () {
  const SUPABASE_URL = 'https://telohdbvbvsfmwyriflz.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_-skU6PI0VrYa91UPHAEaIg_dhsi1l_I'; // publicable (anon), no secreta
  const SCHEMA = 'pos';
  const QKEY = 'balam_sync_queue';

  let sb = null, enabled = false;

  async function ensureClient() {
    if (sb) return sb;
    if (!window.supabase) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      }).catch(() => null);
    }
    if (!window.supabase) return null;
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      db: { schema: SCHEMA },
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'balam_auth' },
    });
    return sb;
  }
  // Sesión activa de Supabase Auth (la terminal está autenticada).
  async function hasSession() {
    const c = await ensureClient(); if (!c) return false;
    try { const { data } = await c.auth.getSession(); return !!(data && data.session); } catch (e) { return false; }
  }

  // ── Mappers local↔fila SQL ──────────────────────────────────────────────────
  const MAP = {
    products: {
      table: 'products', conflict: 'id',
      toRow: p => ({ id: p.id, cat: p.cat, manga: p.manga, tela: p.tela, color: p.color, cuello: p.cuello || 'NOR', modelo: String(p.modelo), nombre: p.nombre, orn: p.orn || '—', orn_colors: p.ornColors || [], precio: Number(p.precio) || 0, costo: Number(p.costo) || 0, pop: !!p.pop, stock: p.stock || [], imagen: p.imagen || null, sku: p.sku, barcode_urls: p.barcodeUrls || {} }),
      fromRow: r => ({ id: r.id, cat: r.cat, manga: r.manga, tela: r.tela, color: r.color, cuello: r.cuello, modelo: r.modelo, nombre: r.nombre, orn: r.orn, ornColors: r.orn_colors || [], precio: Number(r.precio) || 0, costo: Number(r.costo) || 0, pop: !!r.pop, stock: r.stock || [], imagen: r.imagen || undefined, barcodeUrls: r.barcode_urls || {} }),
    },
    clients: {
      table: 'clients', conflict: 'id',
      toRow: c => ({ id: c.id, nombre: c.nombre, tel: c.tel || null, email: c.email || null, direccion: c.direccion || null, talla: c.talla || null, notas: c.notas || null, compras: c.compras || 0, total: Number(c.total) || 0, ultima: c.ultima || null, nacimiento: c.nacimiento || null, generic: !!c.generic }),
      fromRow: r => ({ id: r.id, nombre: r.nombre, tel: r.tel || '—', email: r.email || undefined, direccion: r.direccion || undefined, talla: r.talla || '', notas: r.notas || '', compras: r.compras || 0, total: Number(r.total) || 0, ultima: r.ultima || '', nacimiento: r.nacimiento || '', generic: !!r.generic }),
    },
    sellers: {
      table: 'sellers', conflict: 'id',
      toRow: s => ({ id: s.id, nombre: s.nombre, iniciales: s.iniciales, color: s.color, comision_pct: Number(s.comisionPct) || 0, meta_mes: Number(s.metaMes) || 0, ventas_mes: Number(s.ventasMes) || 0, ventas_num: s.ventasNum || 0, comision_acum: Number(s.comisionAcum) || 0, bono: s.bono || null, email: s.email || null, password_hash: s.passwordHash || null, role: s.role || 'vendedor', avatar_url: s.avatar || null, active: s.active !== false }),
      fromRow: r => ({ id: r.id, nombre: r.nombre, iniciales: r.iniciales, color: r.color, comisionPct: Number(r.comision_pct) || 0, metaMes: Number(r.meta_mes) || 0, ventasMes: Number(r.ventas_mes) || 0, ventasNum: r.ventas_num || 0, comisionAcum: Number(r.comision_acum) || 0, bono: r.bono || 'Sin bono', email: r.email || undefined, passwordHash: r.password_hash || null, role: r.role || 'vendedor', avatar: r.avatar_url || null, active: r.active !== false }),
    },
    sales: {
      table: 'sales', conflict: 'folio',
      fromRow: r => ({ folio: r.folio, fecha: String(r.fecha).replace('T', ' ').slice(0, 16), cliente: r.cliente, vendedor: '', vendedores: r.vendedores || [], items: r.items || 0, total: Number(r.total) || 0, metodo: r.metodo, estado: r.estado, lineas: [] }),
    },
    promotions: {
      table: 'promotions', conflict: 'id',
      toRow: p => ({ id: p.id, nombre: p.nombre, tipo: p.tipo || 'pct', valor: Number(p.valor) || 0, inicio: p.inicio || null, fin: p.fin || null, hora_inicio: p.horaInicio || null, hora_fin: p.horaFin || null, pausado: !!p.pausado, scope: p.scope || {}, creado: p.creado || null }),
      fromRow: r => ({ id: r.id, nombre: r.nombre, tipo: r.tipo || 'pct', valor: Number(r.valor) || 0, inicio: r.inicio || '', fin: r.fin || '', horaInicio: r.hora_inicio || '', horaFin: r.hora_fin || '', pausado: !!r.pausado, scope: r.scope || {}, creado: r.creado || 0 }),
    },
    returns: {
      table: 'returns', conflict: 'id',
      fromRow: r => ({ id: r.id, folio: r.folio, fecha: r.fecha || '', cliente: r.cliente, vendedores: r.vendedores || [], metodo: r.metodo, total: Number(r.total) || 0, notas: r.notas || '', lineas: [] }),
    },
    liquidations: {
      table: 'liquidations', conflict: 'id',
      toRow: l => ({ id: l.id, seller_id: l.sellerId || null, seller: l.seller || null, monto: Number(l.monto) || 0, tipo: l.tipo || 'liquidacion', fecha: l.fecha || null }),
      fromRow: r => ({ id: r.id, sellerId: r.seller_id || '', seller: r.seller || '', monto: Number(r.monto) || 0, tipo: r.tipo || 'liquidacion', fecha: r.fecha || '' }),
    },
  };

  // ── Cola offline ────────────────────────────────────────────────────────────
  function loadQ() { try { return JSON.parse(localStorage.getItem(QKEY)) || []; } catch (e) { return []; } }
  function saveQ(q) { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) { /* */ } }
  function enqueue(op) {
    const q = loadQ();
    if (op.type === 'upsert') { const i = q.findIndex(x => x.type === 'upsert' && x.table === op.table); if (i >= 0) q[i] = op; else q.push(op); }
    else if (op.type === 'config') { const i = q.findIndex(x => x.type === 'config'); if (i >= 0) q[i] = op; else q.push(op); }
    else q.push(op); // sale / delete: idempotentes, se conservan en orden
    saveQ(q);
  }

  // Ejecuta una operación contra Supabase. Devuelve true si quedó persistida.
  async function applyOp(c, op) {
    try {
      if (op.type === 'upsert') { const r = await c.from(op.table).upsert(op.rows, { onConflict: op.conflict }); return !r.error; }
      if (op.type === 'delete') { const r = await c.from(op.table).delete().eq(op.col, op.val); return !r.error; }
      if (op.type === 'config') {
        const a = await c.from('lookup').upsert(op.lookup, { onConflict: 'kind,code' });
        const b = await c.from('settings').upsert(op.settings, { onConflict: 'key' });
        return !a.error && !b.error;
      }
      if (op.type === 'sale') {
        const s = await c.from('sales').upsert([op.header], { onConflict: 'folio' }); if (s.error) return false;
        if (op.items.length) { await c.from('sale_items').delete().eq('folio', op.folio); const i = await c.from('sale_items').insert(op.items); if (i.error) return false; }
        if (op.moves.length) { await c.from('movements').delete().eq('ref', op.folio).eq('tipo', 'Venta'); const mv = await c.from('movements').insert(op.moves); if (mv.error) return false; }
        return true;
      }
      if (op.type === 'return') {
        const s = await c.from('returns').upsert([op.header], { onConflict: 'id' }); if (s.error) return false;
        await c.from('return_items').delete().eq('return_id', op.id);
        if (op.items.length) { const i = await c.from('return_items').insert(op.items); if (i.error) return false; }
        if (op.moves && op.moves.length) { await c.from('movements').delete().eq('ref', op.folio).eq('tipo', 'Devolución'); const mv = await c.from('movements').insert(op.moves); if (mv.error) return false; }
        return true;
      }
    } catch (e) { return false; }
    return false;
  }

  // Intenta ahora; si no hay cliente o falla, encola para reintento.
  async function run(op) {
    if (!enabled) return;
    const c = await ensureClient();
    if (c) { const ok = await applyOp(c, op); if (ok) { flushQueue(); return; } }
    enqueue(op);
  }

  let flushing = false;
  async function flushQueue() {
    if (flushing) return;
    if (!loadQ().length) return;
    const c = await ensureClient(); if (!c) return;
    flushing = true;
    try {
      const q = loadQ(); const rest = [];
      for (const op of q) { const ok = await applyOp(c, op); if (!ok) rest.push(op); }
      saveQ(rest);
      if (q.length && !rest.length && window.UI && window.UI.toast) window.UI.toast('Cambios sincronizados con la nube', 'var(--accent)');
    } finally { flushing = false; }
  }

  // ── API de escritura (encolable) ────────────────────────────────────────────
  function pushRows(kind, arr) {
    if (!enabled) return;
    const m = MAP[kind]; if (!m || !m.toRow) return;
    return run({ type: 'upsert', table: m.table, conflict: m.conflict, rows: arr.map(m.toRow) });
  }
  function deleteRow(kind, id) {
    if (!enabled) return;
    const m = MAP[kind]; if (!m) return;
    return run({ type: 'delete', table: m.table, col: m.conflict, val: id });
  }
  function pushSale(sale) {
    if (!enabled) return;
    const header = { folio: sale.folio, fecha: (sale.fecha || '').replace(' ', 'T'), cliente: sale.cliente, vendedores: sale.vendedores || [], metodo: sale.metodo, estado: sale.estado, items: sale.items || 0, total: Number(sale.total) || 0 };
    const items = (sale.lineas || []).map(l => ({ folio: sale.folio, sku: l.sku, nombre: l.nombre, talla: l.talla, qty: l.qty, precio: Number(l.precio) || 0 }));
    const moves = (sale.lineas || []).map(l => ({ fecha: header.fecha, tipo: 'Venta', producto: l.nombre, sku: l.sku, cant: -l.qty, ref: sale.folio }));
    return run({ type: 'sale', folio: sale.folio, header, items, moves });
  }
  function pushReturn(ret) {
    if (!enabled) return;
    const header = { id: ret.id, folio: ret.folio, fecha: ret.fecha || null, cliente: ret.cliente, vendedores: ret.vendedores || [], metodo: ret.metodo || null, total: Number(ret.total) || 0, notas: ret.notas || null };
    const items = (ret.lineas || []).map(l => ({ return_id: ret.id, sku: l.sku, nombre: l.nombre, talla: l.talla, qty: l.qty, motivo: l.motivo || null, precio: Number(l.precio) || 0 }));
    // Reemplaza TODOS los movimientos 'Devolución' del folio (idempotente con devoluciones parciales).
    const moves = (window.DATA.movements || [])
      .filter(m => m.tipo === 'Devolución' && m.ref === ret.folio)
      .map(m => ({ fecha: String(m.fecha || '').replace(' ', 'T'), tipo: 'Devolución', producto: m.producto, sku: m.sku, cant: m.cant, ref: m.ref }));
    return run({ type: 'return', id: ret.id, folio: ret.folio, header, items, moves });
  }
  let pushTimer = null;
  function pushConfig(state) {
    if (!enabled) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      const lookup = [];
      Object.keys(state.catalogs).forEach(kind => state.catalogs[kind].forEach((it, i) =>
        lookup.push({ kind, code: it.code, label: it.label, active: it.active !== false, meta: it.meta || {}, sort_order: i, updated_at: new Date().toISOString() })));
      const settings = Object.keys(state.settings).map(key => ({ key, value: state.settings[key], updated_at: new Date().toISOString() }));
      run({ type: 'config', lookup, settings });
    }, 600); // debounce de ediciones rápidas
  }

  // ── Lectura / pull ──────────────────────────────────────────────────────────
  function toConfigState(lookup, settings) {
    const catalogs = {};
    (lookup || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).forEach(r => {
      (catalogs[r.kind] || (catalogs[r.kind] = [])).push({ code: r.code, label: r.label, active: r.active !== false, meta: r.meta || {} });
    });
    const s = {}; (settings || []).forEach(r => { s[r.key] = r.value; });
    return { v: 1, catalogs, settings: s };
  }
  async function pull() {
    const c = await ensureClient(); if (!c) return { ok: false, error: 'sin cliente' };
    const [lk, st] = await Promise.all([c.from('lookup').select('*'), c.from('settings').select('*')]);
    if (lk.error || st.error) return { ok: false, error: (lk.error || st.error).message };
    if (!lk.data.length && !st.data.length) return { ok: false, error: 'vacío — ¿corriste la migración?' };
    window.CONFIG.load(toConfigState(lk.data, st.data));
    return { ok: true };
  }
  async function pullDomain(kind) {
    const m = MAP[kind]; const c = await ensureClient(); if (!c || !m) return;
    const r = await c.from(m.table).select('*');
    if (r.error) return; // tabla no existe aún → modo local
    if (r.data && r.data.length) {
      if (kind === 'sales') {
        const it = await c.from('sale_items').select('*');
        const byFolio = {};
        (it.data || []).forEach(x => (byFolio[x.folio] || (byFolio[x.folio] = [])).push({ sku: x.sku, nombre: x.nombre, talla: x.talla, qty: x.qty, precio: Number(x.precio) || 0 }));
        const rows = r.data.map(raw => {
          const s = m.fromRow(raw); s.lineas = byFolio[raw.folio] || [];
          const vid = (raw.vendedores || [])[0];
          s.vendedor = (window.DATA.sellers.find(x => x.id === vid) || {}).nombre || s.vendedor || '';
          return s;
        });
        window.DATA.applyRemote('sales', rows); return;
      }
      if (kind === 'returns') {
        const it = await c.from('return_items').select('*');
        const byRid = {};
        (it.data || []).forEach(x => (byRid[x.return_id] || (byRid[x.return_id] = [])).push({ sku: x.sku, nombre: x.nombre, talla: x.talla, qty: x.qty, motivo: x.motivo || '', precio: Number(x.precio) || 0 }));
        const rows = r.data.map(raw => { const s = m.fromRow(raw); s.lineas = byRid[raw.id] || []; return s; });
        window.DATA.applyRemote('returns', rows); return;
      }
      if (m.fromRow) window.DATA.applyRemote(kind, r.data.map(m.fromRow));
    } else if (window.DATA[kind] && window.DATA[kind].length) {
      // Bootstrap: nube vacía + datos locales → súbelos.
      if (kind === 'sales') { for (const s of window.DATA.sales) await pushSale(s); }
      else if (kind === 'returns') { for (const rr of window.DATA.returns) await pushReturn(rr); }
      else if (m.toRow) await pushRows(kind, window.DATA[kind]);
    }
  }

  async function init(opts = {}) {
    enabled = true;
    window.addEventListener('online', flushQueue);
    if (opts.pull) {
      const r = await pull();
      if (window.UI && window.UI.toast) window.UI.toast(r.ok ? 'Configuración sincronizada (nube)' : 'Nube no disponible — modo local', r.ok ? 'var(--accent)' : 'var(--danger)');
      for (const k of ['products', 'clients', 'sellers', 'sales', 'promotions', 'returns', 'liquidations']) { try { await pullDomain(k); } catch (e) { /* tabla ausente */ } }
      try { window.dispatchEvent(new CustomEvent('configchange', { detail: { domain: true } })); } catch (e) { /* */ }
    }
    flushQueue(); // drena lo que quedó pendiente de una sesión offline previa
  }

  // Sube un PNG de código de barras al bucket 'barcodes' (Storage) y devuelve su URL pública.
  // Requiere sesión (las políticas del bucket exigen usuario autenticado). Lanza si falla.
  async function uploadBarcode(path, blob) {
    const c = await ensureClient();
    if (!c) throw new Error('Sin conexión con la nube');
    if (!(await hasSession())) throw new Error('Inicia sesión para guardar imágenes en la nube');
    const { error } = await c.storage.from('barcodes').upload(path, blob, { upsert: true, contentType: 'image/png' });
    if (error) throw new Error(error.message || 'Error al subir la imagen');
    const { data } = c.storage.from('barcodes').getPublicUrl(path);
    return (data && data.publicUrl) || null;
  }

  window.STORE = { init, pull, pushConfig, pushRows, pushSale, pushReturn, deleteRow, pullDomain, flushQueue, ensureClient, getClient: ensureClient, hasSession, uploadBarcode, get enabled() { return enabled; }, get pending() { return loadQ().length; } };
})();
