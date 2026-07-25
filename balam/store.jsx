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
  // Marca de limpieza de datos de prueba: fila reservada de pos.settings que escribe
  // supabase/LIMPIAR-PRUEBAS.sql. Cada terminal recuerda en RESET_SEEN la última que aplicó;
  // si la nube trae una más nueva, se limpia sola (ver applyResetMark).
  const RESET_MARK_KEY = '_resetMark';
  const RESET_SEEN = 'balam_reset_seen';

  let sb = null, enabled = false, lastResetMark = null;

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
      // attrs (Fase 2): valores de catálogos custom. Se envía SOLO si el producto tiene alguno,
      // así las instalaciones que aún no corrieron la migración pos_008 (columna attrs) no se rompen.
      toRow: p => { const row = { id: p.id, cat: p.cat, manga: p.manga, tela: p.tela, color: p.color, cuello: p.cuello || 'NOR', modelo: String(p.modelo), nombre: p.nombre, orn: p.orn || '—', orn_colors: p.ornColors || [], precio: Number(p.precio) || 0, costo: Number(p.costo) || 0, pop: !!p.pop, stock: p.stock || [], imagen: p.imagen || null, sku: p.sku, barcode_urls: p.barcodeUrls || {} }; if (p.attrs && Object.keys(p.attrs).length) row.attrs = p.attrs; return row; },
      fromRow: r => ({ id: r.id, cat: r.cat, manga: r.manga, tela: r.tela, color: r.color, cuello: r.cuello, modelo: r.modelo, nombre: r.nombre, orn: r.orn, ornColors: r.orn_colors || [], precio: Number(r.precio) || 0, costo: Number(r.costo) || 0, pop: !!r.pop, stock: r.stock || [], imagen: r.imagen || undefined, barcodeUrls: r.barcode_urls || {}, attrs: r.attrs || {} }),
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
      fromRow: r => ({ folio: r.folio, fecha: String(r.fecha).replace('T', ' ').slice(0, 16), cliente: r.cliente, vendedor: '', vendedores: r.vendedores || [], items: r.items || 0, subtotal: r.subtotal == null ? undefined : Number(r.subtotal), iva: r.iva == null ? undefined : Number(r.iva), total: Number(r.total) || 0, descuento: r.descuento == null ? undefined : Number(r.descuento), ivaPct: r.iva_pct == null ? undefined : Number(r.iva_pct), ivaIncluded: r.iva_included == null ? undefined : !!r.iva_included, anticipo: r.anticipo == null ? undefined : Number(r.anticipo), saldo: r.saldo == null ? undefined : Number(r.saldo), pagoEfectivo: r.pago_efectivo == null ? undefined : Number(r.pago_efectivo), pagoOtro: r.pago_otro == null ? undefined : Number(r.pago_otro), metodo: r.metodo, estado: r.estado, valorRegalado: Number(r.valor_regalado) || 0, lineas: [] }),
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
  // Devuelve si la cola quedó persistida (false = localStorage lleno; el llamador decide el respaldo).
  function saveQ(q) { try { localStorage.setItem(QKEY, JSON.stringify(q)); return true; } catch (e) { return false; } }
  // Descarta operaciones pendientes sin enviarlas (lo usa el reset de la simulación local).
  function clearQueue() { try { localStorage.removeItem(QKEY); } catch (e) { /* */ } }
  let opSeq = 0;
  const newOpId = () => 'op' + Date.now().toString(36) + '-' + (++opSeq) + '-' + Math.random().toString(36).slice(2, 6);
  function enqueue(op) {
    const q = loadQ();
    if (op.type === 'upsert') { const i = q.findIndex(x => x.type === 'upsert' && x.table === op.table); if (i >= 0) q[i] = op; else q.push(op); }
    else if (op.type === 'config') { const i = q.findIndex(x => x.type === 'config'); if (i >= 0) q[i] = op; else q.push(op); }
    else q.push(op); // sale / delete: idempotentes, se conservan en orden
    return saveQ(q);
  }
  // Ops pendientes que tocan una tabla: la copia LOCAL es más nueva que la nube.
  function hasPendingFor(table) {
    return loadQ().some(op => op.table === table
      || (op.type === 'sale' && table === 'sales')
      || (op.type === 'return' && table === 'returns'));
  }

  // Ejecuta una operación contra Supabase. Devuelve true si quedó persistida.
  async function applyOp(c, op) {
    try {
      if (op.type === 'upsert') { const r = await c.from(op.table).upsert(op.rows, { onConflict: op.conflict }); return !r.error; }
      if (op.type === 'delete') { const r = await c.from(op.table).delete().eq(op.col, op.val); return !r.error; }
      if (op.type === 'config') {
        const a = await c.from('lookup').upsert(op.lookup, { onConflict: 'kind,code' });
        if (a.error) return false;
        // Reconciliar borrados: el upsert NO elimina filas. Quita de pos.lookup lo que ya no está en
        // local (categorías/atributos/catálogos borrados); sin esto "revivían" en el siguiente pull.
        // Guard op.lookup.length: nunca vaciar la tabla por un estado vacío accidental.
        if (op.lookup.length) {
          const cur = await c.from('lookup').select('kind,code');
          if (!cur.error && cur.data) {
            const keep = new Set(op.lookup.map(r => r.kind + ' ' + r.code));
            for (const r of cur.data) {
              if (!keep.has(r.kind + ' ' + r.code)) await c.from('lookup').delete().eq('kind', r.kind).eq('code', r.code);
            }
          }
        }
        const b = await c.from('settings').upsert(op.settings, { onConflict: 'key' });
        return !b.error;
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

  // Encola PRIMERO y luego sube vía flushQueue (ejecutor único). Antes se intentaba la
  // red primero y solo se encolaba al fallar: si la página se recargaba con la subida
  // en vuelo, la operación moría sin rastro y el pull del siguiente arranque pisaba lo
  // capturado. Persistida antes de volar, sobrevive al refresh y se reintenta sola.
  async function run(op) {
    if (!enabled) return;
    op.id = newOpId();
    if (enqueue(op)) { flushQueue(); return; }
    // Sin espacio en localStorage para respaldar la op: intento directo (mejor esfuerzo).
    const c = await ensureClient(); if (!c) return;
    await applyOp(c, op);
  }

  let flushing = false, flushAgain = false;
  async function flushQueue() {
    if (flushing) { flushAgain = true; return; } // otra pasada al terminar la actual
    { // migra ops persistidas por una versión anterior (sin id)
      const q0 = loadQ(); let mig = false;
      q0.forEach(o => { if (!o.id) { o.id = newOpId(); mig = true; } });
      if (mig) saveQ(q0);
    }
    if (!loadQ().length) return;
    const c = await ensureClient(); if (!c) return;
    flushing = true;
    let recovered = false;
    try {
      // Una op a la vez, releyendo la cola de storage en cada paso: run() puede encolar
      // o reemplazar ops mientras una subida está en vuelo, y el viejo "saveQ(rest)"
      // final las pisaba. El retiro por id nunca borra una op reemplazada (id nuevo).
      const failed = new Set(); // fallidas en esta pasada: se saltan, quedan para reintento
      for (;;) {
        const op = loadQ().find(o => !failed.has(o.id));
        if (!op) break;
        const ok = await applyOp(c, op);
        const cur = loadQ();
        if (ok) {
          if (op.retry) recovered = true;
          saveQ(cur.filter(o => o.id !== op.id));
        } else {
          failed.add(op.id);
          const t = cur.find(o => o.id === op.id);
          if (t && !t.retry) { t.retry = true; saveQ(cur); }
        }
      }
      // Mismo aviso de siempre, solo cuando se recuperó un pendiente (no en cada guardado).
      if (recovered && !loadQ().length && window.UI && window.UI.toast) window.UI.toast('Cambios sincronizados con la nube', 'var(--accent)');
    } finally {
      flushing = false;
      if (flushAgain) { flushAgain = false; flushQueue(); }
    }
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
    // No rellena snapshots ausentes en ventas históricas: sólo las ventas creadas con el
    // contrato H-03 escriben estos campos.
    if (sale.subtotal != null) header.subtotal = Number(sale.subtotal) || 0;
    if (sale.iva != null) header.iva = Number(sale.iva) || 0;
    if (sale.ivaPct != null) header.iva_pct = Number(sale.ivaPct) || 0;
    if (sale.ivaIncluded != null) header.iva_included = !!sale.ivaIncluded;
    if (sale.anticipo != null) header.anticipo = Number(sale.anticipo) || 0;
    if (sale.saldo != null) header.saldo = Number(sale.saldo) || 0;
    if (sale.pagoEfectivo != null) header.pago_efectivo = Number(sale.pagoEfectivo) || 0;
    if (sale.pagoOtro != null) header.pago_otro = Number(sale.pagoOtro) || 0;
    if (sale.descuento != null) header.descuento = Number(sale.descuento) || 0;
    // valor_regalado (cortesías) solo se envía si aplica, así no rompe instalaciones sin la migración pos_009.
    if (Number(sale.valorRegalado) > 0) header.valor_regalado = Number(sale.valorRegalado);
    const items = (sale.lineas || []).map(l => {
      const row = { folio: sale.folio, sku: l.sku, nombre: l.nombre, talla: l.talla, qty: l.qty, precio: Number(l.precio) || 0 };
      if (l.precioBase != null) row.precio_base = Number(l.precioBase) || 0;
      if (l.precioOrig != null) row.precio_original = Number(l.precioOrig) || 0;
      return row;
    });
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
      // Metadatos de catálogo (label / inForm / inSku / orden del SKU) viajan como una fila
      // reservada de settings (value jsonb), así persisten en la nube sin tocar el esquema.
      if (state.catalogMeta) settings.push({ key: '_catalogMeta', value: state.catalogMeta, updated_at: new Date().toISOString() });
      run({ type: 'config', lookup, settings });
    }, 600); // debounce de ediciones rápidas
  }

  // ── Lectura / pull ──────────────────────────────────────────────────────────
  function toConfigState(lookup, settings) {
    const catalogs = {};
    (lookup || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).forEach(r => {
      (catalogs[r.kind] || (catalogs[r.kind] = [])).push({ code: r.code, label: r.label, active: r.active !== false, meta: r.meta || {} });
    });
    const s = {}; let catalogMeta;
    // _resetMark queda FUERA de la config: es la marca de limpieza, no un ajuste de la tienda.
    // Si entrara, pushConfig la reenviaría y una terminal con config vieja podría pisarla,
    // dejando a las demás sin limpiar.
    (settings || []).forEach(r => {
      if (r.key === '_catalogMeta') catalogMeta = r.value;
      else if (r.key !== RESET_MARK_KEY) s[r.key] = r.value;
    });
    return { v: 1, catalogs, catalogMeta, settings: s };
  }
  async function pull() {
    const c = await ensureClient(); if (!c) return { ok: false, error: 'sin cliente' };
    const [lk, st] = await Promise.all([c.from('lookup').select('*'), c.from('settings').select('*')]);
    if (lk.error || st.error) return { ok: false, error: (lk.error || st.error).message };
    if (!lk.data.length && !st.data.length) return { ok: false, error: 'vacío — ¿corriste la migración?' };
    const mk = (st.data || []).find(r => r.key === RESET_MARK_KEY);
    lastResetMark = mk ? String(mk.value) : null;
    window.CONFIG.load(toConfigState(lk.data, st.data));
    return { ok: true };
  }
  // Registra la marca vigente como YA aplicada en esta terminal (sin limpiar nada). La usa el
  // botón manual de Configuración: si no, el siguiente arranque volvería a avisar la limpieza.
  function markResetApplied() {
    try { if (lastResetMark) localStorage.setItem(RESET_SEEN, lastResetMark); } catch (e) { /* */ }
  }
  // Limpieza propagada: si la nube trae una marca que esta terminal no ha aplicado, borra AQUÍ
  // los datos de prueba y restaura el stock. Sin esto la limpieza no viaja entre equipos —
  // pullDomain no borra lo local cuando la nube llega vacía (a propósito: una caída de red no
  // debe vaciar una terminal) y el pull de ventas FUSIONA, nunca quita.
  // Corre ANTES del pull de dominio y sube lo restaurado antes de bajar nada: si se pulara
  // primero, esta terminal recibiría el stock viejo y la restauración se perdería o se
  // aplicaría dos veces.
  // pendingAtBoot = cuántas ops había en la cola ANTES del flushQueue de este arranque.
  async function applyResetMark(pendingAtBoot) {
    if (!lastResetMark) return false;                  // instalación sin marca → nada que hacer
    let seen = null;
    try { seen = localStorage.getItem(RESET_SEEN); } catch (e) { return false; } // sin storage: no tocar
    if (seen === lastResetMark) return false;          // ya aplicada aquí
    // Había trabajo local sin subir al arrancar = se capturó sin internet. NO se limpia:
    //   1) resetTestData descarta la cola y esas ventas —que pueden ser REALES— se perderían;
    //   2) el flushQueue de este arranque ya las subió a la nube recién limpiada, así que
    //      borrarlas aquí las dejaría vivas allá y volverían en el siguiente pull.
    // Se pospone al próximo arranque: la cola ya estará vacía y la limpieza se aplicará
    // entera. Quien quiera forzarla usa el botón de Configuración.
    if (pendingAtBoot || loadQ().length) return false;
    if (!(window.DATA && window.DATA.resetTestData)) return false;
    try { window.DATA.resetTestData(); } catch (e) { return false; }
    try { localStorage.setItem(RESET_SEEN, lastResetMark); } catch (e) { /* */ }
    try { await flushQueue(); } catch (e) { /* offline: el stock restaurado queda en cola */ }
    if (window.UI && window.UI.toast) window.UI.toast('Datos de prueba borrados en esta terminal — inventario intacto', 'var(--accent)');
    return true;
  }
  // Renglones (sale_items/return_items) SOLO de las claves bajadas, en lotes de 100
  // (antes se bajaba la tabla completa — crecía sin límite con el historial).
  async function fetchItemsIn(c, table, col, keys) {
    const out = [];
    for (let i = 0; i < keys.length; i += 100) {
      const r = await c.from(table).select('*').in(col, keys.slice(i, i + 100));
      if (!r.error && r.data) out.push.apply(out, r.data);
    }
    return out;
  }
  // Filas de venta locales desde filas SQL + sus renglones (compartido: pull y fetch por folio).
  function saleRowsFrom(raws, itemRows) {
    const byFolio = {};
    (itemRows || []).forEach(x => (byFolio[x.folio] || (byFolio[x.folio] = [])).push({ sku: x.sku, nombre: x.nombre, talla: x.talla, qty: x.qty, precio: Number(x.precio) || 0, precioBase: x.precio_base == null ? undefined : Number(x.precio_base), precioOrig: x.precio_original == null ? undefined : Number(x.precio_original) }));
    return raws.map(raw => {
      const s = MAP.sales.fromRow(raw); s.lineas = byFolio[raw.folio] || [];
      const vid = (raw.vendedores || [])[0];
      s.vendedor = (window.DATA.sellers.find(x => x.id === vid) || {}).nombre || s.vendedor || '';
      return s;
    });
  }
  // Ventas: pull PAGINADO — la ventana reciente (sync.salesWindowDays, def. 365 días) más
  // TODOS los apartados (son pocos y el Panel/Notificaciones los necesitan para completarlos).
  // El resultado se FUSIONA en lo local (mergeRemote): un equipo con meses de historial lo
  // CONSERVA para reportes; reemplazar (applyRemote) lo borraría. Folios más viejos que la
  // ventana se traen bajo demanda con fetchSaleByFolio (pantalla de Devoluciones).
  async function pullSales(c) {
    const days = Number(window.CONFIG && window.CONFIG.get && window.CONFIG.get('sync.salesWindowDays')) || 365;
    const cutoff = new Date(Date.now() - days * 864e5).toISOString();
    const [rec, apart] = await Promise.all([
      c.from('sales').select('*').gte('fecha', cutoff),
      c.from('sales').select('*').eq('estado', 'Apartado'),
    ]);
    if (rec.error || apart.error) return; // tabla ausente / sin permiso → modo local
    const uniq = {};
    (rec.data || []).concat(apart.data || []).forEach(x => { uniq[x.folio] = x; });
    const raws = Object.values(uniq);
    if (!raws.length) return;
    const items = await fetchItemsIn(c, 'sale_items', 'folio', raws.map(x => x.folio));
    if (hasPendingFor('sales')) return; // capturaron durante el vuelo: no pisar
    window.DATA.mergeRemote('sales', saleRowsFrom(raws, items), 'folio');
  }
  // Trae UNA venta (con renglones) por folio desde la nube y la fusiona en lo local.
  // Devuelve la venta o null. Tolerante a minúsculas (reintenta en MAYÚSCULAS).
  async function fetchSaleByFolio(folio) {
    const c = await ensureClient(); if (!c) return null;
    const f = String(folio || '').trim(); if (!f) return null;
    let r = await c.from('sales').select('*').eq('folio', f);
    if ((r.error || !(r.data || []).length) && f !== f.toUpperCase()) r = await c.from('sales').select('*').eq('folio', f.toUpperCase());
    if (r.error || !(r.data || []).length) return null;
    const items = await fetchItemsIn(c, 'sale_items', 'folio', r.data.map(x => x.folio));
    const rows = saleRowsFrom(r.data, items);
    if (!hasPendingFor('sales')) window.DATA.mergeRemote('sales', rows, 'folio');
    return window.DATA.sales.find(s => s.folio === rows[0].folio) || rows[0];
  }

  async function pullDomain(kind) {
    const m = MAP[kind]; const c = await ensureClient(); if (!c || !m) return;
    // Cambios locales sin subir para esta tabla → NO aplicar la nube (la pisaría con datos
    // viejos). Se re-chequea tras el fetch: el usuario pudo capturar durante el vuelo.
    if (hasPendingFor(m.table)) return;
    if (kind === 'sales') { await pullSales(c); return; }
    const r = await c.from(m.table).select('*');
    if (r.error) return; // tabla no existe aún → modo local
    if (hasPendingFor(m.table)) return;
    if (r.data && r.data.length) {
      if (kind === 'returns') {
        const itRows = await fetchItemsIn(c, 'return_items', 'return_id', r.data.map(x => x.id));
        const byRid = {};
        itRows.forEach(x => (byRid[x.return_id] || (byRid[x.return_id] = [])).push({ sku: x.sku, nombre: x.nombre, talla: x.talla, qty: x.qty, motivo: x.motivo || '', precio: Number(x.precio) || 0 }));
        const rows = r.data.map(raw => { const s = m.fromRow(raw); s.lineas = byRid[raw.id] || []; return s; });
        window.DATA.applyRemote('returns', rows); return;
      }
      if (m.fromRow) window.DATA.applyRemote(kind, r.data.map(m.fromRow));
    }
    // Nube vacía: NO auto-subir lo local. (Antes un "bootstrap" re-subía window.DATA[kind] cuando la
    // nube estaba vacía, lo que hacía IMPOSIBLE vaciarla: cada recarga la repoblaba desde cualquier
    // equipo con datos locales. El sync local→nube ya ocurre por acciones explícitas (alta/edición,
    // ventas) vía la cola; un vaciado intencional de la nube ahora SÍ se respeta.)
  }

  async function init(opts = {}) {
    enabled = true;
    // Al reconectar: drena la cola y, además, migra fotos incrustadas que hayan quedado.
    window.addEventListener('online', () => { flushQueue(); autoMigratePhotos().catch(() => { /* */ }); });
    // Drenar la cola ANTES del pull: los cambios de la sesión anterior llegan primero a la
    // nube y el pull ya regresa el estado completo. (Antes el pull corría primero y
    // reemplazaba lo local, "des-haciendo" capturas cuya subida quedó pendiente.)
    // Se mide la cola ANTES de drenarla: la limpieza propagada la necesita para saber si
    // había capturas sin subir (ver applyResetMark); después del flush ya no se distingue.
    const pendingAtBoot = loadQ().length;
    try { await flushQueue(); } catch (e) { /* offline: la cola queda para el reintento */ }
    if (opts.pull) {
      // Config local sin subir (op 'config' aún en cola): conservarla, no pisarla con la nube.
      const cfgPending = loadQ().some(op => op.type === 'config');
      const r = cfgPending ? { ok: true, skipped: true } : await pull();
      if (window.UI && window.UI.toast) window.UI.toast(r.skipped ? 'Cambios locales pendientes de subir — se conservan' : (r.ok ? 'Configuración sincronizada (nube)' : 'Nube no disponible — modo local'), r.ok ? 'var(--accent)' : 'var(--danger)');
      // Limpieza pendiente de otra terminal: se aplica AQUÍ antes de bajar el dominio.
      try { await applyResetMark(pendingAtBoot); } catch (e) { /* nunca bloquear el arranque */ }
      // Dominios en PARALELO (antes: 7 round-trips en serie; con red lenta el número de
      // inventario tardaba en llegar). 'sales' va después: su fromRow resuelve el nombre
      // del vendedor contra DATA.sellers, que debe estar ya sincronizado.
      await Promise.all(['products', 'clients', 'sellers', 'promotions', 'returns', 'liquidations'].map(k => pullDomain(k).catch(() => { /* tabla ausente */ })));
      try { await pullDomain('sales'); } catch (e) { /* tabla ausente */ }
      try { window.dispatchEvent(new CustomEvent('configchange', { detail: { domain: true } })); } catch (e) { /* */ }
      // Migración de fotos incrustadas EN SEGUNDO PLANO (no se espera): sube las que quedaron en
      // formato viejo sin que el usuario tenga que pulsar nada. Va después del pull para operar
      // sobre el inventario ya sincronizado.
      autoMigratePhotos().catch(() => { /* se reintenta al próximo arranque */ });
    }
    flushQueue(); // por si algo quedó pendiente (p. ej. un fallo durante el arranque)
  }

  // Sube una imagen a un bucket de Storage y devuelve su URL pública.
  // Requiere sesión (las políticas de los buckets exigen usuario autenticado). Lanza si falla.
  async function uploadImage(bucket, path, blob, contentType) {
    const c = await ensureClient();
    if (!c) throw new Error('Sin conexión con la nube');
    if (!(await hasSession())) throw new Error('Inicia sesión para guardar imágenes en la nube');
    const { error } = await c.storage.from(bucket).upload(path, blob, { upsert: true, contentType });
    if (error) throw new Error(error.message || 'Error al subir la imagen');
    const { data } = c.storage.from(bucket).getPublicUrl(path);
    return (data && data.publicUrl) || null;
  }
  // Migra AUTOMÁTICAMENTE a la nube las fotos que quedaron incrustadas (data:image/…): las que
  // se subieron antes de esta función o cuando no había sesión/red. Corre solo en segundo plano
  // al arrancar (y al reconectar), así el usuario ya no tiene que pulsar "Migrar fotos" nunca.
  // Idempotente y reanudable: ruta prod-<id>.jpg con upsert; una foto ya migrada no se repite y
  // un fallo se reintenta en el siguiente arranque. No bloquea el arranque ni interrumpe nada.
  let migratingPhotos = false;
  async function autoMigratePhotos() {
    if (migratingPhotos || !enabled) return 0;
    const D = window.DATA; if (!D || !Array.isArray(D.products)) return 0;
    const pend = D.products.filter(p => /^data:image\//.test(p.imagen || ''));
    if (!pend.length) return 0;
    // Sin cliente o sin sesión no se puede subir a Storage: se deja para un próximo arranque
    // (el usuario ya está autenticado en la terminal; esto solo salta si abrió sin sesión).
    const c = await ensureClient(); if (!c) return 0;
    if (!(await hasSession())) return 0;
    migratingPhotos = true;
    let ok = 0;
    try {
      for (const p of pend) {
        try {
          const blob = await (await fetch(p.imagen)).blob();
          const url = await uploadProductPhoto('prod-' + p.id + '.jpg', blob);
          if (!url) continue;
          p.imagen = url; ok++;
          if (ok % 5 === 0 && D.saveProducts) D.saveProducts(); // persistir + sincronizar por lotes
        } catch (e) { /* una foto falló: se reintenta en el próximo arranque */ }
      }
      if (ok && D.saveProducts) D.saveProducts();
      if (ok && window.UI && window.UI.toast) window.UI.toast(`${ok} foto(s) de producto guardadas en la nube`, 'var(--accent)');
    } finally { migratingPhotos = false; }
    return ok;
  }

  // PNG de etiqueta de código de barras → bucket 'barcodes' (mismo contrato de siempre).
  function uploadBarcode(path, blob) { return uploadImage('barcodes', path, blob, 'image/png'); }
  // Foto de producto (JPEG 600px del alta) → bucket 'product-photos' (migración pos_010).
  // El producto guarda solo la URL; la foto deja de viajar incrustada en cada guardado.
  function uploadProductPhoto(path, blob) { return uploadImage('product-photos', path, blob, 'image/jpeg'); }

  // Llama una Edge Function con fetch DIRECTO y devuelve SIEMPRE el cuerpo real de la respuesta.
  // A diferencia de supabase-js .invoke(), aquí leemos el JSON aunque el status sea 4xx/5xx, así el
  // usuario ve el mensaje verdadero de la función ("Solo un administrador…", "Sesión inválida", etc.)
  // y nunca el genérico "Edge Function returned a non-2xx status code".
  // Devuelve { ok, status, body } — body.error trae el motivo si falló.
  async function callFunction(name, payload) {
    const c = await ensureClient();
    if (!c) return { ok: false, status: 0, body: { error: 'Sin conexión con la nube' } };
    let token = SUPABASE_KEY;
    try { const { data } = await c.auth.getSession(); if (data && data.session && data.session.access_token) token = data.session.access_token; } catch (e) { /* sin sesión: se envía la anon y la función responderá 401 */ }
    try {
      const resp = await fetch(SUPABASE_URL + '/functions/v1/' + name, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token },
        body: JSON.stringify(payload || {}),
      });
      let body = {};
      try { body = await resp.json(); } catch (e) { body = { error: 'La función respondió algo que no se pudo leer (código ' + resp.status + ')' }; }
      return { ok: resp.ok, status: resp.status, body: body || {} };
    } catch (e) {
      return { ok: false, status: 0, body: { error: 'No se pudo conectar con la función "' + name + '": ' + (e.message || e) } };
    }
  }

  window.STORE = { init, pull, pushConfig, pushRows, pushSale, pushReturn, deleteRow, pullDomain, fetchSaleByFolio, flushQueue, clearQueue, markResetApplied, autoMigratePhotos, ensureClient, getClient: ensureClient, hasSession, callFunction, uploadBarcode, uploadProductPhoto, get enabled() { return enabled; }, get pending() { return loadQ().length; } };
})();
