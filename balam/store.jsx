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
  const QDB = 'balam_sync', QSTORE = 'durable_queue';
  // Marca de limpieza de datos de prueba: fila reservada de pos.settings que escribe
  // supabase/LIMPIAR-PRUEBAS.sql. Cada terminal recuerda en RESET_SEEN la última que aplicó;
  // si la nube trae una más nueva, se limpia sola (ver applyResetMark).
  const RESET_MARK_KEY = '_resetMark';
  const RESET_SEEN = 'balam_reset_seen';

  let sb = null, enabled = false, lastResetMark = null;
  let sessionIdentity = null, sessionManaged = false, onlineSubscribed = false, legacyWarned = false;
  let sessionSeq = 0;
  function activeOwnerId() {
    if (sessionIdentity) return sessionIdentity;
    try {
      const p = window.AUTH && window.AUTH.current && window.AUTH.current();
      return p && p.email ? String(p.email).trim().toLowerCase() : null;
    } catch (e) { return null; }
  }
  function opBelongsToActiveSession(op) {
    return (op.ownerId == null ? null : String(op.ownerId).toLowerCase())
      === activeOwnerId();
  }

  async function ensureClient() {
    if (sb) return sb;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null;
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
      table: 'products', conflict: 'id', localKey: 'products',
      // attrs (Fase 2): valores de catálogos custom. Se envía SOLO si el producto tiene alguno,
      // así las instalaciones que aún no corrieron la migración pos_008 (columna attrs) no se rompen.
      toRow: p => {
        const row = { id: p.id, cat: p.cat, manga: p.manga, tela: p.tela, color: p.color, cuello: p.cuello || 'NOR', modelo: String(p.modelo), nombre: p.nombre, orn: p.orn || '—', orn_colors: p.ornColors || [], precio: Number(p.precio) || 0, costo: Number(p.costo) || 0, pop: !!p.pop, stock: p.stock || [], imagen: p.imagen || null, sku: p.sku, barcode_urls: p.barcodeUrls || {}, sync_base_version: Number(p._syncVersion) || 0, sync_device_id: window.CORE.getDeviceId() };
        const attrs = Object.assign({}, p.attrs || {});
        // La aplicación usa la autoridad central. El fallback conserva el
        // contrato modular de STORE en arneses/carga aislada donde DATA todavía
        // no está montado; attrs persistido mantiene la precedencia.
        const categoryId = window.DATA && typeof window.DATA.resolveProductSizes === 'function'
          ? window.DATA.resolveProductSizes(p).categoryId
          : (attrs.__sizeCategoryId || p.sizeCategoryId || null);
        if (categoryId) attrs.__sizeCategoryId = categoryId;
        else delete attrs.__sizeCategoryId;
        if (Object.keys(attrs).length) row.attrs = attrs;
        if (p.preciosTalla && Object.keys(p.preciosTalla).length) row.precios_talla = p.preciosTalla;
        return row;
      },
      fromRow: r => ({ id: r.id, cat: r.cat, manga: r.manga, tela: r.tela, color: r.color, cuello: r.cuello, modelo: r.modelo, nombre: r.nombre, orn: r.orn, ornColors: r.orn_colors || [], precio: Number(r.precio) || 0, costo: Number(r.costo) || 0, pop: !!r.pop, stock: r.stock || [], imagen: r.imagen || undefined, barcodeUrls: r.barcode_urls || {}, attrs: r.attrs || {}, sizeCategoryId: (r.attrs || {}).__sizeCategoryId || null, preciosTalla: r.precios_talla || {}, _syncVersion: Number(r.sync_version) || 0, _deletedAt: r.deleted_at || null }),
    },
    clients: {
      table: 'clients', conflict: 'id', localKey: 'clients',
      toRow: c => ({ id: c.id, nombre: c.nombre, tel: c.tel || null, email: c.email || null, direccion: c.direccion || null, talla: c.talla || null, notas: c.notas || null, compras: c.compras || 0, total: Number(c.total) || 0, ultima: c.ultima || null, nacimiento: c.nacimiento || null, generic: !!c.generic, sync_base_version: Number(c._syncVersion) || 0, sync_device_id: window.CORE.getDeviceId() }),
      fromRow: r => ({ id: r.id, nombre: r.nombre, tel: r.tel || '—', email: r.email || undefined, direccion: r.direccion || undefined, talla: r.talla || '', notas: r.notas || '', compras: r.compras || 0, total: Number(r.total) || 0, ultima: r.ultima || '', nacimiento: r.nacimiento || '', generic: !!r.generic, _syncVersion: Number(r.sync_version) || 0, _deletedAt: r.deleted_at || null }),
    },
    sellers: {
      table: 'sellers', conflict: 'id', localKey: 'sellers',
      toRow: s => ({ id: s.id, nombre: s.nombre, iniciales: s.iniciales, color: s.color, comision_pct: Number(s.comisionPct) || 0, commission_override_pct: s.commissionOverridePct == null || !Number.isFinite(Number(s.commissionOverridePct)) ? null : Number(s.commissionOverridePct), seller_level_code: s.sellerLevelCode == null ? null : String(s.sellerLevelCode), commission_policy_version: Number(s.commissionPolicyVersion) || 0, meta_mes: Number(s.metaMes) || 0, ventas_mes: Number(s.ventasMes) || 0, ventas_num: s.ventasNum || 0, comision_acum: Number(s.comisionAcum) || 0, bono: s.bono || null, email: s.email || null, password_hash: s.passwordHash || null, role: s.role || 'vendedor', avatar_url: s.avatar || null, active: s.active !== false, sync_base_version: Number(s._syncVersion) || 0, sync_device_id: window.CORE.getDeviceId() }),
      fromRow: r => ({ id: r.id, nombre: r.nombre, iniciales: r.iniciales, color: r.color, comisionPct: Number(r.comision_pct) || 0, commissionOverridePct: r.commission_override_pct == null ? null : Number(r.commission_override_pct), sellerLevelCode: r.seller_level_code == null ? null : String(r.seller_level_code), commissionPolicyVersion: Number(r.commission_policy_version) || 0, metaMes: Number(r.meta_mes) || 0, ventasMes: Number(r.ventas_mes) || 0, ventasNum: r.ventas_num || 0, comisionAcum: Number(r.comision_acum) || 0, bono: r.bono || 'Sin bono', email: r.email || undefined, passwordHash: r.password_hash || null, role: r.role || 'vendedor', avatar: r.avatar_url || null, active: r.active !== false, _syncVersion: Number(r.sync_version) || 0, _deletedAt: r.deleted_at || null }),
    },
    sales: {
      table: 'sales', conflict: 'folio',
      fromRow: r => ({ folio: r.folio, folioAliases: Array.isArray(r.folio_aliases) ? r.folio_aliases : undefined, _operationId: r.operation_id || undefined, _stockReserved: !!r.operation_id && r.estado !== 'Apartado' && r.estado !== 'Cancelado', _syncStatus: 'synced', fecha: String(r.fecha).replace('T', ' ').slice(0, 16), clienteId: r.cliente_id || undefined, cliente: r.cliente, vendedor: '', vendedores: r.vendedores || [], items: r.items || 0, subtotal: r.subtotal == null ? undefined : Number(r.subtotal), iva: r.iva == null ? undefined : Number(r.iva), total: Number(r.total) || 0, descuento: r.descuento == null ? undefined : Number(r.descuento), descuentoAdicional: r.descuento_adicional == null ? undefined : Number(r.descuento_adicional), totalAntesDescuentoAdicional: r.total_antes_descuento_adicional == null ? undefined : Number(r.total_antes_descuento_adicional), descuentosAdicionales: Array.isArray(r.descuentos_adicionales) ? r.descuentos_adicionales : undefined, ivaPct: r.iva_pct == null ? undefined : Number(r.iva_pct), ivaIncluded: r.iva_included == null ? undefined : !!r.iva_included, anticipo: r.anticipo == null ? undefined : Number(r.anticipo), saldo: r.saldo == null ? undefined : Number(r.saldo), pagoEfectivo: r.pago_efectivo == null ? undefined : Number(r.pago_efectivo), pagoOtro: r.pago_otro == null ? undefined : Number(r.pago_otro), metodo: r.metodo, estado: r.estado, valorRegalado: Number(r.valor_regalado) || 0, returnLimitDays: r.return_limit_days == null ? null : Number(r.return_limit_days), returnExpiresAt: r.return_expires_at || null, lineas: [] }),
    },
    promotions: {
      table: 'promotions', conflict: 'id', localKey: 'promos',
      toRow: p => ({ id: p.id, nombre: p.nombre, tipo: p.tipo || 'pct', valor: Number(p.valor) || 0, inicio: p.inicio || null, fin: p.fin || null, hora_inicio: p.horaInicio || null, hora_fin: p.horaFin || null, pausado: !!p.pausado, scope: p.scope || {}, creado: p.creado || null, sync_base_version: Number(p._syncVersion) || 0, sync_device_id: window.CORE.getDeviceId() }),
      fromRow: r => ({ id: r.id, nombre: r.nombre, tipo: r.tipo || 'pct', valor: Number(r.valor) || 0, inicio: r.inicio || '', fin: r.fin || '', horaInicio: r.hora_inicio || '', horaFin: r.hora_fin || '', pausado: !!r.pausado, scope: r.scope || {}, creado: r.creado || 0, _syncVersion: Number(r.sync_version) || 0, _deletedAt: r.deleted_at || null }),
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
    payments: {
      table: 'sale_payments', conflict: 'id',
      toRow: p => ({ id: p.id, folio: p.folio, fecha: p.fecha, tipo: p.tipo, metodo: p.metodo, monto: Number(p.monto) || 0, efectivo: Number(p.efectivo) || 0, tarjeta: Number(p.tarjeta) || 0, transferencia: Number(p.transferencia) || 0, otro: Number(p.otro) || 0 }),
      fromRow: r => ({ id: r.id, folio: r.folio, fecha: r.fecha || '', tipo: r.tipo, metodo: r.metodo, monto: Number(r.monto) || 0, efectivo: Number(r.efectivo) || 0, tarjeta: Number(r.tarjeta) || 0, transferencia: Number(r.transferencia) || 0, otro: Number(r.otro) || 0 }),
    },
    // H-37 (C4): documentos de cambio. Los renglones viajan embebidos en la
    // cabecera igual que los de una devolución, y el commit transaccional que
    // los escribirá en pos.exchange_items pertenece a C5.
    exchanges: {
      table: 'exchanges', conflict: 'id',
      toRow: e => ({
        id: e.id, folio: e.folio, origen_folio: e.origenFolio || e.saleFolio || null,
        fecha: e.fecha || null, usuario: e.usuario || null,
        valor_reconocido: Number(e.valorReconocido) || 0,
        valor_entregado: Number(e.valorEntregado) || 0,
        diferencia: Number(e.diferencia) || 0,
        valor_no_aprovechado: Number(e.valorNoAprovechado) || 0,
        base_comision: Number(e.baseComision) || 0,
        comision_monto: Number(e.comisionMonto) || 0,
        comision_base: e.comisionBase || null,
        comision_pct: Number(e.comisionPct) || 0,
        comision_revertida: e.comisionRevertida || null,
        notas: e.notas || null,
      }),
      fromRow: r => ({
        id: r.id, folio: r.folio, origenFolio: r.origen_folio || undefined,
        fecha: r.fecha || '', usuario: r.usuario || undefined,
        vendedorId: r.vendedor_id || undefined, revisadoPor: r.revisado_por || undefined,
        valorReconocido: Number(r.valor_reconocido) || 0,
        valorEntregado: Number(r.valor_entregado) || 0,
        diferencia: Number(r.diferencia) || 0,
        valorNoAprovechado: Number(r.valor_no_aprovechado) || 0,
        baseComision: Number(r.base_comision) || 0,
        comisionMonto: Number(r.comision_monto) || 0,
        comisionBase: r.comision_base || undefined,
        comisionPct: Number(r.comision_pct) || 0,
        comisionRevertida: r.comision_revertida || undefined,
        notas: r.notas || '', lineas: [],
      }),
    },
    movements: {
      table: 'movements', conflict: 'id',
      fromRow: r => ({
        id: r.id,
        fecha: String(r.fecha || '').replace('T', ' ').slice(0, 16),
        tipo: r.tipo,
        producto: r.producto || '',
        sku: r.sku || '',
        cant: Number(r.cant) || 0,
        ref: r.ref || '',
      }),
    },
  };
  function kindForTable(table) {
    return Object.keys(MAP).find(kind => MAP[kind].table === table) || null;
  }

  // ── Cola offline ────────────────────────────────────────────────────────────
  let volatileQueue = null, queueDurability = 'localStorage', storageWarned = false, backupNotified = false;
  let backupChain = Promise.resolve(), queueHydrated = false;
  function openQueueDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('indexeddb_unavailable'));
      const req = window.indexedDB.open(QDB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(QSTORE)) req.result.createObjectStore(QSTORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('indexeddb_open_failed'));
    });
  }
  async function queueBackup(mode, value) {
    const db = await openQueueDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QSTORE, 'readwrite');
      const store = tx.objectStore(QSTORE);
      const req = mode === 'put' ? store.put(value, QKEY) : store.delete(QKEY);
      req.onerror = () => reject(req.error || new Error('indexeddb_write_failed'));
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('indexeddb_tx_failed')); };
    });
  }
  async function readQueueBackup() {
    const db = await openQueueDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(QSTORE, 'readonly');
      const req = tx.objectStore(QSTORE).get(QKEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('indexeddb_read_failed'));
      tx.oncomplete = () => db.close();
    });
  }
  function persistQueueBackup(q) {
    const snapshot = JSON.parse(JSON.stringify(q));
    queueDurability = 'indexedDB-pending';
    backupChain = backupChain.catch(() => {}).then(() => queueBackup('put', snapshot))
      .then(() => {
        if (volatileQueue) queueDurability = 'indexedDB';
        if (!backupNotified && window.UI && window.UI.toast) {
          backupNotified = true;
          window.UI.toast('Almacenamiento principal lleno: la cola quedó protegida en el respaldo local.', 'var(--accent)');
        }
        emitSyncStatus();
        return true;
      }).catch(() => {
        queueDurability = 'memory';
        if (!storageWarned && window.UI && window.UI.toast) {
          storageWarned = true;
          window.UI.toast('No hay espacio durable para la cola. No cierres esta pestaña; libera almacenamiento y reintenta.', 'var(--danger)');
        }
        emitSyncStatus();
        return false;
      });
    return backupChain;
  }
  async function hydrateDurableQueue() {
    if (queueHydrated) return;
    queueHydrated = true;
    await backupChain;
    try {
      const backup = await readQueueBackup();
      if (Array.isArray(backup)) {
        volatileQueue = backup;
        queueDurability = 'indexedDB';
      }
    } catch (e) { /* IndexedDB no disponible: localStorage conserva el contrato histórico */ }
  }
  function emitSyncStatus() {
    try { window.dispatchEvent(new CustomEvent('syncstatuschange', { detail: queueStatus() })); } catch (e) { /* */ }
  }
  function loadStoredQ() { try { return JSON.parse(localStorage.getItem(QKEY)) || []; } catch (e) { return []; } }
  function loadQ() { return volatileQueue || loadStoredQ(); }
  // Si la cuota impide persistir, conserva la cola completa en memoria y avisa:
  // nunca degrada silenciosamente a una escritura de red sin respaldo.
  function saveQ(q) {
    try {
      localStorage.setItem(QKEY, JSON.stringify(q));
      volatileQueue = null; queueDurability = 'localStorage';
      backupChain = backupChain.catch(() => {}).then(() => queueBackup('delete')).catch(() => false);
      emitSyncStatus();
      return true;
    } catch (e) {
      volatileQueue = q;
      persistQueueBackup(q);
      emitSyncStatus();
      return false;
    }
  }
  // Descarta operaciones pendientes sin enviarlas (lo usa el reset de la simulación local).
  function clearQueue() {
    volatileQueue = null; queueDurability = 'localStorage';
    try { localStorage.removeItem(QKEY); } catch (e) { /* */ }
    backupChain = backupChain.catch(() => {}).then(() => queueBackup('delete')).catch(() => false);
    emitSyncStatus();
  }
  let opSeq = 0;
  const newOpId = () => 'op' + Date.now().toString(36) + '-' + (++opSeq) + '-' + Math.random().toString(36).slice(2, 6);
  function enqueue(op) {
    const q = loadQ();
    if (op.ownerId === undefined) op.ownerId = activeOwnerId();
    op.status = 'pending';
    op.attempts = Number(op.attempts) || 0;
    op.createdAt = op.createdAt || new Date().toISOString();
    delete op.diagnostic;
    if (op.type === 'upsert') { const i = q.findIndex(x => x.type === 'upsert' && x.table === op.table && x.ownerId === op.ownerId); if (i >= 0) q[i] = op; else q.push(op); }
    else if (op.type === 'config') { const i = q.findIndex(x => x.type === 'config' && x.ownerId === op.ownerId); if (i >= 0) q[i] = op; else q.push(op); }
    else q.push(op); // sale / delete: idempotentes, se conservan en orden
    saveQ(q);
    return true;
  }
  function classifyFailure(error, details) {
    const raw = error || {};
    const code = String(raw.code || raw.error || (details && details.error) || 'unknown_error');
    const message = String(raw.message || raw.error_description || (details && details.message) || code);
    const httpStatus = Number(raw.status || raw.statusCode || 0) || null;
    const lower = (code + ' ' + message).toLowerCase();
    let category = 'unknown', status = 'retry_wait', policy = 'auto_retry', retryable = true;
    if (code === 'insufficient_stock') {
      category = 'inventory'; status = 'waiting_inventory'; policy = 'wait_inventory';
    } else if (httpStatus === 401 || /jwt|not authenticated|unauthorized/.test(lower)) {
      category = 'auth'; status = 'auth_required'; policy = 'sign_in'; retryable = false;
    } else if (httpStatus === 403 || code === '42501' || /row-level security|permission denied|forbidden/.test(lower)) {
      category = 'permission'; status = 'blocked_permission'; policy = 'review_permissions'; retryable = false;
    } else if (/^(42p01|42703|pgrst)/i.test(code) || /schema cache|column .* does not exist|relation .* does not exist/.test(lower)) {
      category = 'schema'; status = 'blocked_schema'; policy = 'apply_migration'; retryable = false;
    } else if (/^23/.test(code)) {
      category = 'constraint'; status = 'blocked_data'; policy = 'review_data'; retryable = false;
    } else if (/commit_mismatch|legacy_.*conflict|legacy_context_incomplete|invalid_return|folio_conflict/.test(lower)) {
      category = 'conflict'; status = 'blocked_conflict'; policy = 'review_conflict'; retryable = false;
    } else if (httpStatus >= 500) {
      category = 'server';
    } else if (raw instanceof TypeError || /failed to fetch|network|load failed|fetch failed/.test(lower)) {
      category = 'network';
    }
    return {
      category, code, message, httpStatus, status, policy, retryable,
      details: details || raw.details || null,
      at: new Date().toISOString(),
    };
  }
  let lastApplyFailure = null;
  function failOp(error, details) {
    lastApplyFailure = classifyFailure(error, details);
    return false;
  }
  function isAutomaticallyEligible(op) {
    return !/^blocked_/.test(op.status || '') && op.status !== 'auth_required';
  }
  function queueStatus() {
    const operations = loadQ().filter(opBelongsToActiveSession).map(op => ({
      id: op.id, type: op.type, table: op.table || null, folio: op.folio || null,
      status: op.status || 'pending', attempts: Number(op.attempts) || 0,
      createdAt: op.createdAt || null, lastAttemptAt: op.lastAttemptAt || null,
      diagnostic: op.diagnostic || null,
    }));
    return {
      durability: queueDurability,
      pending: operations.length,
      blocked: operations.filter(op => /^blocked_/.test(op.status || '')).length,
      retrying: operations.filter(op => op.status === 'retry_wait' || op.status === 'waiting_inventory').length,
      operations,
    };
  }
  function retryOperation(id) {
    const q = loadQ(), op = q.find(x => x.id === id && opBelongsToActiveSession(x));
    if (!op) return false;
    op.status = 'pending'; delete op.diagnostic;
    saveQ(q); flushQueue();
    return true;
  }
  function resumeAuthenticatedOperations() {
    const q = loadQ(); let changed = false;
    q.forEach(op => {
      if (opBelongsToActiveSession(op) && op.status === 'auth_required') {
        op.status = 'pending';
        delete op.diagnostic;
        changed = true;
      }
    });
    if (changed) saveQ(q);
  }
  // Ops pendientes que tocan una tabla: la copia LOCAL es más nueva que la nube.
  function hasPendingFor(table) {
    return loadQ().some(op => opBelongsToActiveSession(op) && (op.table === table
      || (op.type === 'sale' && table === 'sales')
      || (op.type === 'return' && table === 'returns')
      || ((op.type === 'sale' || op.type === 'return') && table === 'movements')));
  }

  // ── H-33: contador diario de folios ─────────────────────────────────────────
  // `pos.reserve_folio_block()` incrementa atómicamente el contador de
  // (prefijo, día) y devuelve un rango exclusivo para esta terminal. Con bloque
  // reservado, una venta offline ya nace con folio corto y definitivo.
  function folioDateIso(yymmdd) {
    const d = String(yymmdd || '');
    return /^\d{6}$/.test(d) ? '20' + d.slice(0, 2) + '-' + d.slice(2, 4) + '-' + d.slice(4, 6) : null;
  }
  async function reserveFolioNumbers(c, prefix, date, count, floor) {
    const iso = folioDateIso(date);
    if (!c || !iso) return null;
    const r = await c.rpc('reserve_folio_block', {
      p_prefix: prefix, p_business_date: iso,
      p_count: Math.max(1, Number(count) || 1), p_floor: Math.max(0, Number(floor) || 0),
    });
    if (r.error || !r.data || !r.data.ok) return null;
    const from = Number(r.data.from) || 0, to = Number(r.data.to) || 0;
    return from > 0 && to >= from ? { from, to } : null;
  }
  let folioReserving = null;
  // Repone el bloque cuando queda poco o cambió el día. Nunca bloquea una venta:
  // si no hay red o el contador no existe, la terminal sigue con folio provisional.
  function ensureFolioBlock(force) {
    if (!enabled || folioReserving) return folioReserving || Promise.resolve(null);
    const D = window.DATA;
    if (!D || !D.folioBlockRequest || !D.applyFolioBlock) return Promise.resolve(null);
    const req = D.folioBlockRequest();
    if (!req.needed && !force) return Promise.resolve(null);
    folioReserving = (async () => {
      try {
        const c = await ensureClient();
        if (!c || !(await hasSession())) return null;
        const range = await reserveFolioNumbers(c, req.prefix, req.date, req.count, req.floor);
        if (!range) return null;
        D.applyFolioBlock(req.prefix, req.date, range.from, range.to);
        return range;
      } catch (e) { return null; } finally { folioReserving = null; }
    })();
    return folioReserving;
  }
  // Folio de reemplazo cuando la nube rechaza el actual. Un folio con formato
  // H-33 recibe otro número del contador (corto y único); un folio histórico
  // conserva la reidentificación por token de H-02.
  async function replacementFolio(c, op) {
    const D = window.DATA || {};
    const parsed = D.parseFolio && D.parseFolio(op.folio);
    if (parsed && D.folioFromParts) {
      const range = await reserveFolioNumbers(c, parsed.prefix, parsed.date, 1, parsed.seq);
      if (range) return D.folioFromParts(parsed.prefix, parsed.date, range.from);
    }
    return D.collisionSafeFolio ? D.collisionSafeFolio(op.folio, op.operationId) : null;
  }

  function rekeyQueuedSaleFolio(operationId, oldFolio, newFolio) {
    const q = loadQ();
    let changed = false;
    q.forEach(pending => {
      if (pending.type === 'sale' && pending.operationId === operationId && pending.folio === oldFolio) {
        pending.folio = newFolio;
        pending.header.folio = newFolio;
        (pending.items || []).forEach(x => { x.folio = newFolio; });
        (pending.moves || []).forEach(x => { x.ref = newFolio; });
        (pending.payments || []).forEach(x => { x.folio = newFolio; });
        pending.folioRekeyed = true;
        changed = true;
      } else if (pending.type === 'return' && pending.folio === oldFolio) {
        pending.folio = newFolio;
        pending.header.folio = newFolio;
        (pending.moves || []).forEach(x => { x.ref = newFolio; });
        changed = true;
      }
    });
    if (changed) saveQ(q);
    return changed;
  }

  // Ejecuta una operación contra Supabase. Devuelve true si quedó persistida.
  async function applyOp(c, op) {
    lastApplyFailure = null;
    try {
      if (op.type === 'commissionSettle' || op.type === 'commissionClose') {
        const name = op.type === 'commissionSettle'
          ? 'settle_commission_checked'
          : 'close_commission_period_checked';
        const args = { p_operation_id: op.operationId };
        if (op.type === 'commissionSettle') args.p_seller_id = op.sellerId;
        const r = await c.rpc(name, args);
        if (r.error) return failOp(r.error);
        await pullDomain('sellers');
        await pullDomain('liquidations');
        return true;
      }
      if (op.type === 'loanOperation') {
        const committed = await c.rpc('commit_loan_operation', {
          p_operation_id: op.id,
          p_action: op.action,
          p_loan: op.loan,
          p_expected_version: Number(op.expectedVersion) || 0,
        });
        if (committed.error || !committed.data) {
          return failOp(committed.error || { code: 'empty_response', message: 'El préstamo no devolvió confirmación' });
        }
        const local = window.DATA && (window.DATA.loans || []).find(x => x.id === op.loan.id);
        if (local && committed.data._loanVersion != null) {
          local._loanVersion = Number(committed.data._loanVersion) || 0;
          if (window.DATA.saveLoans) window.DATA.saveLoans();
        }
        return true;
      }
      if (op.type === 'staffUpdate') {
        const m = MAP[op.kind];
        const remote = [];
        for (const row of op.rows) {
          const patch = { ...row };
          delete patch[op.conflict];
          const r = await c.from(op.table).update(patch)
            .eq(op.conflict, row[op.conflict]).select('*');
          if (r.error || !(r.data || []).length) return failOp(r.error || { code: 'empty_response', message: 'La actualización no devolvió la fila esperada' });
          remote.push.apply(remote, r.data.map(m.fromRow));
        }
        if (m && window.DATA && window.DATA.applySyncResult) {
          const expected = {};
          op.rows.forEach(row => { expected[row.id] = Number(row.sync_base_version) || 0; });
          const result = window.DATA.applySyncResult(op.kind, remote, expected, 'upsert') || {};
          rebaseQueuedVersions(op.table, remote);
          if (result.conflicts && window.UI && window.UI.toast) {
            window.UI.toast(`${result.conflicts} cambio(s) no se aplicaron porque otra terminal guardó una versión más reciente`, 'var(--danger)');
          }
        }
        return true;
      }
      if (op.type === 'upsert') {
        op.kind = op.kind || kindForTable(op.table);
        const m = MAP[op.kind];
        // Reconstituye el snapshot justo antes de enviarlo. Si otra operación en
        // vuelo confirmó una versión, la op compactada usa esa versión nueva.
        if (m && m.localKey && window.DATA && Array.isArray(window.DATA[m.localKey])) {
          op.rows = window.DATA[m.localKey].map(m.toRow);
        }
        const r = op.kind === 'products'
          ? await c.rpc('save_products_checked', { p_operation_id: op.id, p_rows: op.rows })
          : await c.from(op.table).upsert(op.rows, { onConflict: op.conflict }).select('*');
        if (r.error) return failOp(r.error);
        if (m && m.fromRow && window.DATA && window.DATA.applySyncResult) {
          const expected = {};
          op.rows.forEach(row => { expected[row.id] = Number(row.sync_base_version) || 0; });
          const remote = (r.data || []).map(m.fromRow);
          const result = window.DATA.applySyncResult(op.kind, remote, expected, 'upsert') || {};
          rebaseQueuedVersions(op.table, remote);
          if (result.conflicts && window.UI && window.UI.toast) {
            window.UI.toast(`${result.conflicts} cambio(s) no se aplicaron porque otra terminal guardó una versión más reciente`, 'var(--danger)');
          }
        }
        return true;
      }
      if (op.type === 'delete') { const r = await c.from(op.table).delete().eq(op.col, op.val); return r.error ? failOp(r.error) : true; }
      if (op.type === 'softDelete') {
        const r = op.kind === 'products'
          ? await c.rpc('delete_product_checked', {
              p_operation_id: op.id, p_id: op.val,
              p_base_version: Number(op.baseVersion) || 0,
              p_device_id: window.CORE.getDeviceId(),
            })
          : await c.rpc('soft_delete_entity', {
              p_entity: op.table, p_id: op.val,
              p_base_version: Number(op.baseVersion) || 0,
              p_device_id: window.CORE.getDeviceId(),
            });
        if (r.error) return failOp(r.error);
        const m = MAP[op.kind];
        const raw = Array.isArray(r.data) ? r.data[0] : r.data;
        if (raw && m && m.fromRow && window.DATA && window.DATA.applySyncResult) {
          const remote = m.fromRow(raw);
          const result = window.DATA.applySyncResult(op.kind, [remote], { [op.val]: Number(op.baseVersion) || 0 }, 'delete') || {};
          rebaseQueuedVersions(op.table, [remote]);
          if (result.conflicts && window.UI && window.UI.toast) {
            window.UI.toast('No se eliminó: otra terminal modificó el registro. Se restauró la versión más reciente.', 'var(--danger)');
          }
        }
        return true;
      }
      if (op.type === 'config') {
        const a = await c.from('lookup').upsert(op.lookup, { onConflict: 'kind,code' });
        if (a.error) return failOp(a.error);
        // Reconciliar borrados: el upsert NO elimina filas. Quita de pos.lookup lo que ya no está en
        // local (categorías/atributos/catálogos borrados); sin esto "revivían" en el siguiente pull.
        // Guard op.lookup.length: nunca vaciar la tabla por un estado vacío accidental.
        if (op.lookup.length) {
          const cur = await c.from('lookup').select('kind,code');
          if (!cur.error && cur.data) {
            const keep = new Set(op.lookup.map(r => r.kind + '\u001f' + r.code));
            for (const r of cur.data) {
              if (!keep.has(r.kind + '\u001f' + r.code)) await c.from('lookup').delete().eq('kind', r.kind).eq('code', r.code);
            }
          }
        }
        const b = await c.from('settings').upsert(op.settings, { onConflict: 'key' });
        return b.error ? failOp(b.error) : true;
      }
      if (op.type === 'sale') {
        const expectedProducts = {};
        (window.DATA && window.DATA.products || []).forEach(p => {
          if ((op.stockLines || []).some(l => l.product_id === p.id)) expectedProducts[p.id] = Number(p._syncVersion) || 0;
        });
        const saleRpc = Array.isArray(op.header && op.header.descuentos_adicionales)
          ? 'commit_sale_with_additional_discount_checked' : 'commit_sale_checked';
        const committed = await c.rpc(saleRpc, {
          p_commit_id: op.id,
          p_operation_id: op.operationId,
          p_sale: op.header,
          p_items: op.items || [],
          p_moves: op.moves || [],
          p_payments: op.payments || [],
          p_stock_lines: op.stockLines || [],
          p_reserve_stock: !!op.reserveStock,
          p_client_effect: op.clientEffect || null,
          p_seller_effects: op.sellerEffects || [],
        });
        if (committed.error || !committed.data) return failOp(committed.error || { code: 'empty_response', message: 'La venta no devolvió confirmación' });
        if (!committed.data.ok) {
          const rekeys = Number(op.folioRekeys) || (op.folioRekeyed ? 1 : 0);
          if (committed.data.error === 'folio_conflict'
              && rekeys < 3
              && window.DATA && window.DATA.rekeySaleFolio) {
            const newFolio = await replacementFolio(c, op);
            if (newFolio && window.DATA.rekeySaleFolio(op.operationId, op.folio, newFolio)
                && rekeyQueuedSaleFolio(op.operationId, op.folio, newFolio)) {
              op.folio = newFolio;
              op.header.folio = newFolio;
              (op.items || []).forEach(x => { x.folio = newFolio; });
              (op.moves || []).forEach(x => { x.ref = newFolio; });
              (op.payments || []).forEach(x => { x.folio = newFolio; });
              op.folioRekeyed = true;
              op.folioRekeys = rekeys + 1;
              if (window.UI && window.UI.toast) {
                window.UI.toast(`Este ticket se registró posteriormente como ${newFolio}`, 'var(--accent)');
              }
              return applyOp(c, op);
            }
          }
          const stockPending = committed.data.error === 'insufficient_stock';
          const changed = window.DATA && window.DATA.markSaleSync
            ? window.DATA.markSaleSync(op.folio, stockPending ? 'stock_pending' : 'sync_error', committed.data)
            : false;
          if (changed && window.UI && window.UI.toast) {
            window.UI.toast(stockPending
              ? 'Venta pendiente: la nube ya no tiene existencias suficientes'
              : 'Venta pendiente: existe un conflicto que requiere revisión', 'var(--danger)');
          }
          return failOp({ code: committed.data.error, message: committed.data.error }, committed.data);
        }
        const reconcile = (kind, rows, expected) => {
          const m = MAP[kind];
          if (!rows.length || !m || !m.fromRow || !window.DATA || !window.DATA.applySyncResult) return;
          const remote = rows.map(m.fromRow);
          window.DATA.applySyncResult(kind, remote, expected, 'sale');
          rebaseQueuedVersions(m.table, remote);
        };
        reconcile('products', committed.data.products || [], expectedProducts);
        const expectedClient = {};
        if (op.clientEffect) expectedClient[op.clientEffect.id] = Number(op.clientEffect.base_version) || 0;
        reconcile('clients', committed.data.clients || [], expectedClient);
        const expectedSellers = {};
        (op.sellerEffects || []).forEach(e => { expectedSellers[e.id] = Number(e.base_version) || 0; });
        reconcile('sellers', committed.data.sellers || [], expectedSellers);
        // Alias histórico: el folio ya impreso se lee de la venta local —la fuente
        // durable— y se persiste ANTES de dar la venta por sincronizada, así la
        // operación permanece en cola hasta que la nube conserve el ticket del
        // cliente. Reintentar es inocuo: el commit es idempotente por hash.
        const aliases = (window.DATA && window.DATA.saleFolioAliases
          ? window.DATA.saleFolioAliases((window.DATA.sales || []).find(s => s.folio === op.folio))
          : []);
        if (aliases.length) {
          const aliased = await c.from('sales')
            .update({ folio_aliases: aliases })
            .eq('folio', op.folio).select('folio');
          if (aliased.error || !(aliased.data || []).length) {
            return failOp(aliased.error || { code: 'alias_not_stored', message: 'No se pudo conservar el folio impreso como alias' });
          }
        }
        if (window.DATA && window.DATA.markSaleSync) window.DATA.markSaleSync(op.folio, 'synced', { stockReserved: !!op.reserveStock });
        return true;
      }
      // H-38 (C5): el cambio viaja como UNA operacion durable y se confirma con
      // una sola llamada a pos.commit_exchange_checked(). El dinero lo calcula el
      // servidor: el cliente no envia valores, solo lo que entrega y recibe.
      if (op.type === 'exchange') {
        const committed = await c.rpc('commit_exchange_checked', {
          p_commit_id: op.key || op.id,
          p_exchange: op.header,
          p_items: op.items || [],
          p_moves: op.moves || [],
          p_payment: op.payment || null,
          // H-47: la comision del excedente se acredita DENTRO de la misma
          // transaccion que el cambio, con guarda de version por vendedor.
          p_seller_effects: op.seller_effects || [],
        });
        if (committed.error || !committed.data || !committed.data.ok) {
          return failOp(committed.error || {
            code: (committed.data && committed.data.error) || 'empty_response',
            message: (committed.data && committed.data.error) || 'El cambio no devolvio confirmacion',
          });
        }
        if (window.DATA && window.DATA.applySyncResult) {
          window.DATA.applySyncResult({ products: committed.data.products || [] });
        }
        return true;
      }
      if (op.type === 'return') {
        const expectedProducts = {};
        const productSources = op.legacy
          ? ((op.legacyTargets && op.legacyTargets.products) || [])
          : ((window.DATA && window.DATA.products) || []).filter(p => (op.stockLines || []).some(l => l.product_id === p.id));
        productSources.forEach(p => { expectedProducts[p.id] = Number(p.base_version ?? p._syncVersion) || 0; });
        const common = {
          p_commit_id: op.id,
          p_return: op.header,
          p_items: op.items || [],
          p_moves: op.moves || [],
        };
        const committed = op.legacy
          ? await c.rpc('commit_legacy_return', {
              ...common, p_targets: op.legacyTargets || { complete: false },
            })
          : await c.rpc('commit_return_checked', {
              ...common,
              p_stock_lines: op.stockLines || [],
              p_client_effect: op.clientEffect || null,
              p_seller_effects: op.sellerEffects || [],
              p_legacy: false,
            });
        if (committed.error || !committed.data || !committed.data.ok) {
          return failOp(committed.error || {
            code: committed.data && committed.data.error || 'empty_response',
            message: committed.data && committed.data.error || 'La devolución no devolvió confirmación',
          }, committed.data);
        }
        const reconcile = (kind, rows, expected) => {
          const m = MAP[kind];
          if (!rows.length || !m || !m.fromRow || !window.DATA || !window.DATA.applySyncResult) return;
          const remote = rows.map(m.fromRow);
          window.DATA.applySyncResult(kind, remote, expected, 'return');
          rebaseQueuedVersions(m.table, remote);
        };
        reconcile('products', committed.data.products || [], expectedProducts);
        const expectedClient = {};
        const clientSource = op.legacy ? op.legacyTargets && op.legacyTargets.client : op.clientEffect;
        if (clientSource) expectedClient[clientSource.id] = Number(clientSource.base_version) || 0;
        reconcile('clients', committed.data.clients || [], expectedClient);
        const expectedSellers = {};
        const sellerSources = op.legacy ? ((op.legacyTargets && op.legacyTargets.sellers) || []) : (op.sellerEffects || []);
        sellerSources.forEach(e => { expectedSellers[e.id] = Number(e.base_version) || 0; });
        reconcile('sellers', committed.data.sellers || [], expectedSellers);
        if (committed.data.sale_state && window.DATA) {
          const sale = (window.DATA.sales || []).find(x => x.folio === op.folio);
          if (sale) { sale.estado = committed.data.sale_state; window.DATA.saveSales(); }
        }
        return true;
      }
    } catch (e) { return failOp(e); }
    return failOp({ code: 'unsupported_operation', message: `Operación no soportada: ${op.type || 'sin tipo'}` });
  }

  function rebaseQueuedVersions(table, remoteRows) {
    if (!remoteRows || !remoteRows.length) return;
    const versions = {};
    remoteRows.forEach(r => { versions[r.id] = Number(r._syncVersion ?? r.sync_version) || 0; });
    const q = loadQ(); let changed = false;
    q.forEach(op => {
      if (!opBelongsToActiveSession(op)) return;
      if (op.type === 'softDelete' && op.table === table && versions[op.val] > (Number(op.baseVersion) || 0)) {
        op.baseVersion = versions[op.val]; changed = true;
      }
    });
    if (changed) saveQ(q);
  }

  // Encola PRIMERO y luego sube vía flushQueue (ejecutor único). Antes se intentaba la
  // red primero y solo se encolaba al fallar: si la página se recargaba con la subida
  // en vuelo, la operación moría sin rastro y el pull del siguiente arranque pisaba lo
  // capturado. Persistida antes de volar, sobrevive al refresh y se reintenta sola.
  async function run(op) {
    if (!enabled) return;
    op.id = newOpId();
    op.ownerId = activeOwnerId();
    enqueue(op);
    await backupChain;
    flushQueue();
  }

  let flushing = false, flushAgain = false;
  async function flushQueue() {
    if (flushing) { flushAgain = true; return; } // otra pasada al terminar la actual
    { // migra ops persistidas por una versión anterior (sin id)
      const q0 = loadQ(); let mig = false;
      q0.forEach(o => {
        if (!o.id) { o.id = newOpId(); mig = true; }
        if (!o.status) { o.status = 'pending'; mig = true; }
        if (o.attempts == null) { o.attempts = o.retry ? 1 : 0; mig = true; }
        if (!o.createdAt) { o.createdAt = new Date().toISOString(); mig = true; }
        // Una cola histórica no permite saber qué cuenta la creó. Con sesión
        // administrada se pone en cuarentena: nunca se atribuye automáticamente.
        if (o.ownerId === undefined && activeOwnerId()) {
          o.ownerId = '__legacy_unclaimed__'; mig = true;
        }
        if (o.type === 'upsert' && !o.kind) {
          o.kind = kindForTable(o.table); mig = true;
        }
        if (o.type === 'sale') {
          if (!o.operationId) { o.operationId = o.id; mig = true; }
          if (o.header && !o.header.operation_id) {
            o.header.operation_id = o.operationId; mig = true;
          }
          if (!Array.isArray(o.stockLines)) {
            o.stockLines = (o.items || []).map(item => {
              const productId = item.product_id
                || (((window.DATA && window.DATA.products) || []).find(p => p.sku === item.sku) || {}).id;
              return productId && Number(item.qty) > 0
                ? { product_id: productId, talla: item.talla, qty: Number(item.qty) }
                : null;
            }).filter(Boolean);
            const state = o.header && o.header.estado;
            o.reserveStock = o.stockLines.length > 0 && state !== 'Apartado' && state !== 'Cancelado';
            mig = true;
          }
          if (!Array.isArray(o.payments)) { o.payments = []; mig = true; }
          if (!o.clientEffect) { o.clientEffect = null; mig = true; }
          if (!Array.isArray(o.sellerEffects)) { o.sellerEffects = []; mig = true; }
        }
        if (o.type === 'return') {
          if (!Array.isArray(o.stockLines)) { o.stockLines = []; o.legacy = true; mig = true; }
          if (!o.clientEffect) { o.clientEffect = null; mig = true; }
          if (!Array.isArray(o.sellerEffects)) { o.sellerEffects = []; mig = true; }
          if (o.legacy && !o.legacyTargets) {
            const data = window.DATA || {};
            const sale = (data.sales || []).find(s => s.folio === o.folio);
            const products = [];
            const seenProducts = new Set();
            (o.items || []).forEach(item => {
              const product = (data.products || []).find(p => p.id === item.product_id || p.sku === item.sku);
              if (!product || seenProducts.has(product.id)) return;
              seenProducts.add(product.id);
              products.push({
                id: product.id, base_version: Number(product._syncVersion) || 0,
                stock: product.stock || [],
              });
              if (!item.product_id) item.product_id = product.id;
            });
            let client = null;
            if (sale && sale.cliente) {
              const row = (data.clients || []).find(c => !c.generic
                && ((sale.clienteId && c.id === sale.clienteId)
                  || (!sale.clienteId && c.nombre === sale.cliente)));
              if (row) client = {
                id: row.id, base_version: Number(row._syncVersion) || 0,
                total: Number(row.total) || 0,
              };
            }
            const sellers = ((sale && sale.vendedores) || []).map(id => {
              const row = (data.sellers || []).find(s => s.id === id);
              return row ? {
                id: row.id, base_version: Number(row._syncVersion) || 0,
                ventas_mes: Number(row.ventasMes) || 0,
                comision_acum: Number(row.comisionAcum) || 0,
              } : null;
            }).filter(Boolean);
            o.legacyTargets = {
              products, client, sellers,
              complete: !!sale && products.length === new Set((o.items || []).map(i => i.product_id).filter(Boolean)).size
                && (o.items || []).every(i => !!i.product_id),
            };
            mig = true;
          }
        }
        // Las colas antiguas borraban físicamente. Se convierten a tombstone;
        // base 0 coincide con las filas históricas al instalar la migración.
        if (o.type === 'delete') {
          const kind = kindForTable(o.table);
          if (kind && MAP[kind].localKey) {
            o.type = 'softDelete'; o.kind = kind; o.baseVersion = 0; mig = true;
          }
        }
      });
      if (mig) saveQ(q0);
      if (!legacyWarned && q0.some(o => o.ownerId === '__legacy_unclaimed__')) {
        legacyWarned = true;
        if (window.UI && window.UI.toast) {
          window.UI.toast('Hay cambios antiguos en cuarentena; un administrador debe revisar y reclamarlos.', 'var(--danger)');
        }
      }
    }
    if (!loadQ().length) return;
    flushing = true;
    let recovered = false;
    try {
      const c = await ensureClient(); if (!c) return;
      // Una op a la vez, releyendo la cola de storage en cada paso: run() puede encolar
      // o reemplazar ops mientras una subida está en vuelo, y el viejo "saveQ(rest)"
      // final las pisaba. El retiro por id nunca borra una op reemplazada (id nuevo).
      const failed = new Set(); // fallidas en esta pasada: se saltan, quedan para reintento
      for (;;) {
        const queue = loadQ();
        // Una devolución NO puede adelantarse a la venta que la origina: mientras
        // esa venta siga en cola —pendiente, fallida o con folio sin resolver— la
        // nube podría atribuirla a otra venta que comparta el folio impreso.
        const salesInFlight = new Set(queue
          .filter(o => o.type === 'sale' && opBelongsToActiveSession(o))
          .map(o => o.folio));
        const op = queue.find(o => opBelongsToActiveSession(o)
          && isAutomaticallyEligible(o) && !failed.has(o.id)
          && !(o.type === 'return' && salesInFlight.has(o.folio)));
        if (!op) break;
        const ok = await applyOp(c, op);
        const cur = loadQ();
        if (ok) {
          if (op.retry) recovered = true;
          saveQ(cur.filter(o => o.id !== op.id));
        } else {
          failed.add(op.id);
          const t = cur.find(o => o.id === op.id);
          if (t) {
            t.retry = true;
            t.attempts = (Number(t.attempts) || 0) + 1;
            t.lastAttemptAt = new Date().toISOString();
            t.diagnostic = lastApplyFailure || classifyFailure({ code: 'unknown_error' });
            t.status = t.diagnostic.status;
            saveQ(cur);
          }
        }
      }
      // Mismo aviso de siempre, solo cuando se recuperó un pendiente (no en cada guardado).
      if (recovered && !loadQ().some(opBelongsToActiveSession) && window.UI && window.UI.toast) window.UI.toast('Cambios sincronizados con la nube', 'var(--accent)');
    } finally {
      flushing = false;
      if (flushAgain) { flushAgain = false; flushQueue(); }
    }
  }

  // ── API de escritura (encolable) ────────────────────────────────────────────
  function pushRows(kind, arr) {
    if (!enabled) return;
    const m = MAP[kind]; if (!m || !m.toRow) return;
    const seller = window.AUTH && window.AUTH.role && window.AUTH.role() === 'vendedor';
    if (seller && kind === 'products') return;
    if (seller && kind === 'sellers') {
      return run({ type: 'staffUpdate', kind, table: m.table, conflict: m.conflict, rows: arr.map(m.toRow) });
    }
    return run({ type: 'upsert', kind, table: m.table, conflict: m.conflict, rows: arr.map(m.toRow) });
  }
  function deleteRow(kind, id, baseVersion) {
    if (!enabled) return;
    const m = MAP[kind]; if (!m) return;
    if (m.localKey) return run({ type: 'softDelete', kind, table: m.table, col: m.conflict, val: id, baseVersion: Number(baseVersion) || 0 });
    return run({ type: 'delete', table: m.table, col: m.conflict, val: id });
  }
  function settleCommission({ operationId, sellerId }) {
    if (!enabled) return;
    return run({ type: 'commissionSettle', operationId, sellerId });
  }
  function closeCommissionPeriod({ operationId }) {
    if (!enabled) return;
    return run({ type: 'commissionClose', operationId });
  }
  function pushLoanOperation(action, loan, expectedVersion) {
    if (!enabled) return;
    return run({
      type: 'loanOperation',
      action,
      loan: JSON.parse(JSON.stringify(loan)),
      expectedVersion: Number(expectedVersion) || 0,
    });
  }
  function pushSale(sale, effects) {
    if (!enabled) return;
    effects = effects || {};
    const operationId = sale._operationId || newOpId();
    const header = { folio: sale.folio, operation_id: operationId, fecha: (sale.fecha || '').replace(' ', 'T'), cliente_id: effects.clientId || sale.clienteId || null, cliente: sale.cliente, vendedores: sale.vendedores || [], metodo: sale.metodo, estado: sale.estado, items: sale.items || 0, total: Number(sale.total) || 0 };
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
    if (sale.descuentoAdicional != null) header.descuento_adicional = Number(sale.descuentoAdicional) || 0;
    if (sale.totalAntesDescuentoAdicional != null) header.total_antes_descuento_adicional = Number(sale.totalAntesDescuentoAdicional) || 0;
    if (Array.isArray(sale.descuentosAdicionales)) header.descuentos_adicionales = sale.descuentosAdicionales;
    // H-34: el plazo congelado sólo se envía si la venta lo tiene, igual que el
    // resto de campos opcionales: una instalación sin la migración no lo manda.
    if (sale.returnLimitDays != null) header.return_limit_days = Number(sale.returnLimitDays) || 0;
    if (sale.returnExpiresAt != null) header.return_expires_at = sale.returnExpiresAt;
    // valor_regalado (cortesías) solo se envía si aplica, así no rompe instalaciones sin la migración pos_009.
    if (Number(sale.valorRegalado) > 0) header.valor_regalado = Number(sale.valorRegalado);
    const items = (sale.lineas || []).map(l => {
      const productId = l.productId || ((window.DATA.products || []).find(p => p.sku === l.sku) || {}).id || null;
      const row = { folio: sale.folio, product_id: productId, sku: l.sku, nombre: l.nombre, talla: l.talla, qty: l.qty, precio: Number(l.precio) || 0 };
      if (l.precioBase != null) row.precio_base = Number(l.precioBase) || 0;
      if (l.precioOrig != null) row.precio_original = Number(l.precioOrig) || 0;
      // H-32: evidencia del descuento. Condicional, como los precios: una instalación sin la
      // migración 034 no envía el campo y sigue funcionando igual.
      if (Array.isArray(l.promos)) row.promos = l.promos;
      if (l.descuentoAdicional != null) row.descuento_adicional = Number(l.descuentoAdicional) || 0;
      return row;
    });
    const moves = ((window.DATA && window.DATA.movements) || [])
      .filter(m => m.tipo === 'Venta' && m.ref === sale.folio)
      .map(m => ({ fecha: String(m.fecha || '').replace(' ', 'T'), tipo: 'Venta', producto: m.producto, sku: m.sku, cant: Number(m.cant) || 0, ref: sale.folio }));
    const stockLines = items
      .filter(row => row.product_id && Number(row.qty) > 0)
      .map(row => ({ product_id: row.product_id, talla: row.talla, qty: Number(row.qty) }));
    const payments = (effects.payments || ((window.DATA && window.DATA.paymentsForSale) ? window.DATA.paymentsForSale(sale.folio) : []))
      .map(MAP.payments.toRow);
    return run({
      type: 'sale', folio: sale.folio, header, items, moves, payments,
      operationId,
      reserveStock: sale._stockRequired !== false && !sale._stockReserved,
      stockLines,
      clientEffect: effects.clientEffect || null,
      sellerEffects: effects.sellerEffects || [],
    });
  }
  function pushReturn(ret, effects) {
    if (!enabled) return;
    effects = effects || {};
    const header = { id: ret.id, folio: ret.folio, fecha: ret.fecha || null, cliente: ret.cliente, vendedores: ret.vendedores || [], metodo: ret.metodo || null, total: Number(ret.total) || 0, notas: ret.notas || null };
    const items = (ret.lineas || []).map(l => ({ return_id: ret.id, product_id: l.productId || null, sku: l.sku, nombre: l.nombre, talla: l.talla, qty: l.qty, motivo: l.motivo || null, precio: Number(l.precio) || 0 }));
    const moves = (ret.lineas || []).map(l => ({ return_id: ret.id, fecha: String(ret.fecha || '').replace(' ', 'T'), tipo: 'Devolución', producto: l.nombre, sku: l.sku, cant: Number(l.qty) || 0, ref: ret.folio }));
    return run({
      type: 'return', id: ret.id, folio: ret.folio, header, items, moves,
      stockLines: effects.stockLines || [],
      clientEffect: effects.clientEffect || null,
      sellerEffects: effects.sellerEffects || [],
      legacy: false,
    });
  }
  // H-38: encola el cambio completo. Los renglones llevan `lado`; el servidor
  // resuelve valor reconocido y precio vigente, asi que aqui no viaja dinero
  // salvo el cobro de la diferencia, que el propio RPC valida contra su calculo.
  function pushExchange(exch, effects) {
    if (!enabled) return;
    effects = effects || {};
    const header = {
      id: exch.id, folio: exch.folio, origen_folio: exch.origenFolio,
      fecha: exch.fecha || null, usuario: exch.usuario || null,
      vendedor_id: exch.vendedorId || null, revisado_por: exch.revisadoPor || null,
      // H-47: lo acreditado viaja congelado, no se recalcula en la nube.
      comision_monto: Number(exch.comisionMonto) || 0,
      comision_base: exch.comisionBase || null,
      comision_pct: Number(exch.comisionPct) || 0,
      notas: exch.notas || null,
    };
    const items = (exch.lineas || []).map(l => ({
      lado: l.lado, product_id: l.productId || null, sku: l.sku, nombre: l.nombre,
      talla: l.talla, qty: Number(l.qty) || 0, motivo: l.motivo || null,
      condicion: l.condicion || null,
    }));
    const moves = (exch.lineas || []).map(l => ({
      fecha: String(exch.fecha || '').replace(' ', 'T'),
      tipo: l.lado === 'devuelto' ? 'Cambio (entra)' : 'Cambio (sale)',
      producto: l.nombre, sku: l.sku,
      cant: (l.lado === 'devuelto' ? 1 : -1) * (Number(l.qty) || 0), ref: exch.folio,
    }));
    return run({
      type: 'exchange', id: exch.id, folio: exch.folio,
      header, items, moves, payment: effects.payment || null,
      seller_effects: effects.sellerEffects || [],
    });
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
    const [lk, st] = await Promise.all([
      fetchAllRows(c, 'lookup', 'id'),
      fetchAllRows(c, 'settings', 'key'),
    ]);
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
  // Ejecuta una consulta en páginas explícitas. PostgREST limita cada respuesta;
  // una página llena nunca se interpreta como el conjunto completo.
  async function fetchPages(makeQuery, pageSize = 1000) {
    const out = [];
    for (let from = 0; ; from += pageSize) {
      const r = await makeQuery().range(from, from + pageSize - 1);
      if (r.error) return { data: null, error: r.error };
      const rows = r.data || [];
      out.push.apply(out, rows);
      if (rows.length < pageSize) return { data: out, error: null };
    }
  }
  function fetchAllRows(c, table, orderCol) {
    return fetchPages(() => c.from(table).select('*')
      .order(orderCol, { ascending: true }));
  }
  // Renglones (sale_items/return_items) SOLO de las claves bajadas, en lotes de 100.
  // Cada lote también se pagina: cien ventas pueden contener más de mil renglones.
  async function fetchItemsIn(c, table, col, keys) {
    const out = [];
    for (let i = 0; i < keys.length; i += 100) {
      const batch = keys.slice(i, i + 100);
      const r = await fetchPages(() => c.from(table).select('*')
        .in(col, batch).order('id', { ascending: true }));
      if (r.error) throw r.error;
      if (r.data) out.push.apply(out, r.data);
    }
    return out;
  }
  // Movimientos es un historial completo e inmutable. Se pagina por su identidad
  // creciente para que el límite de filas de PostgREST nunca produzca un reemplazo
  // local parcial disfrazado de pull completo.
  async function fetchAllMovements(c) {
    return fetchAllRows(c, 'movements', 'id');
  }
  // Filas de venta locales desde filas SQL + sus renglones (compartido: pull y fetch por folio).
  function saleRowsFrom(raws, itemRows) {
    const byFolio = {};
    (itemRows || []).forEach(x => (byFolio[x.folio] || (byFolio[x.folio] = [])).push({ productId: x.product_id || undefined, sku: x.sku, nombre: x.nombre, talla: x.talla, qty: x.qty, precio: Number(x.precio) || 0, precioBase: x.precio_base == null ? undefined : Number(x.precio_base), precioOrig: x.precio_original == null ? undefined : Number(x.precio_original), descuentoAdicional: x.descuento_adicional == null ? undefined : Number(x.descuento_adicional), promos: Array.isArray(x.promos) ? x.promos : undefined }));
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
      fetchPages(() => c.from('sales').select('*').gte('fecha', cutoff)
        .order('fecha', { ascending: true }).order('folio', { ascending: true })),
      fetchPages(() => c.from('sales').select('*').eq('estado', 'Apartado')
        .order('folio', { ascending: true })),
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
  // Devuelve la venta o null. Tolerante a minúsculas (reintenta en MAYÚSCULAS) y,
  // como última consulta, busca el término entre los folios impresos conservados
  // como alias: un ticket reidentificado nunca deja de encontrarse.
  async function fetchSaleByFolio(folio) {
    const c = await ensureClient(); if (!c) return null;
    const f = String(folio || '').trim(); if (!f) return null;
    let r = await c.from('sales').select('*').eq('folio', f);
    if ((r.error || !(r.data || []).length) && f !== f.toUpperCase()) r = await c.from('sales').select('*').eq('folio', f.toUpperCase());
    if (r.error || !(r.data || []).length) {
      const alias = await c.from('sales').select('*').contains('folio_aliases', [f.toUpperCase()]);
      if (!alias.error && (alias.data || []).length) r = alias;
    }
    if (r.error || !(r.data || []).length) return null;
    const items = await fetchItemsIn(c, 'sale_items', 'folio', r.data.map(x => x.folio));
    const rows = saleRowsFrom(r.data, items);
    if (!hasPendingFor('sales')) window.DATA.mergeRemote('sales', rows, 'folio');
    return window.DATA.sales.find(s => s.folio === rows[0].folio) || rows[0];
  }
  async function physicalCardAvailable(folio) {
    const c = await ensureClient();
    if (!c || !navigator.onLine || !(await hasSession())) {
      throw new Error('Conéctate para validar la tarjeta física');
    }
    const r = await c.rpc('physical_card_available', { p_folio: String(folio || '').trim() });
    if (r.error) throw new Error(r.error.message || 'No se pudo validar la tarjeta física');
    return r.data === true;
  }
  async function claimPhysicalCard(folio, claimToken) {
    const c = await ensureClient();
    if (!c || !navigator.onLine || !(await hasSession())) {
      throw new Error('ConÃ©ctate para validar la tarjeta fÃ­sica');
    }
    const r = await c.rpc('claim_physical_card', {
      p_folio: String(folio || '').trim(),
      p_claim_token: String(claimToken || '').trim(),
    });
    if (r.error) throw new Error(r.error.message || 'No se pudo reservar la tarjeta fÃ­sica');
    return r.data === true;
  }

  async function pullDomain(kind) {
    const m = MAP[kind]; const c = await ensureClient(); if (!c || !m) return;
    // Cambios locales sin subir para esta tabla → NO aplicar la nube (la pisaría con datos
    // viejos). Se re-chequea tras el fetch: el usuario pudo capturar durante el vuelo.
    if (hasPendingFor(m.table)) return;
    if (kind === 'sales') { await pullSales(c); return; }
    const r = kind === 'movements'
      ? await fetchAllMovements(c)
      : await fetchAllRows(c, m.table, m.conflict);
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
    await hydrateDurableQueue();
    // Al reconectar: drena la cola y, además, migra fotos incrustadas que hayan quedado.
    if (!onlineSubscribed) {
      onlineSubscribed = true;
      window.addEventListener('online', () => {
        flushQueue();
        ensureFolioBlock();
        autoMigratePhotos().catch(() => { /* */ });
      });
    }
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
      const seller = window.AUTH && window.AUTH.role && window.AUTH.role() === 'vendedor';
      const domains = seller
        ? ['products', 'clients', 'sellers', 'promotions']
        : ['products', 'clients', 'sellers', 'promotions', 'returns', 'liquidations', 'payments', 'movements'];
      await Promise.all(domains.map(k => pullDomain(k).catch(() => { /* tabla ausente */ })));
      if (!seller) {
        try { await pullDomain('sales'); } catch (e) { /* tabla ausente */ }
      }
      try { window.dispatchEvent(new CustomEvent('configchange', { detail: { domain: true } })); } catch (e) { /* */ }
      // Migración de fotos incrustadas EN SEGUNDO PLANO (no se espera): sube las que quedaron en
      // formato viejo sin que el usuario tenga que pulsar nada. Va después del pull para operar
      // sobre el inventario ya sincronizado.
      autoMigratePhotos().catch(() => { /* se reintenta al próximo arranque */ });
    }
    flushQueue(); // por si algo quedó pendiente (p. ej. un fallo durante el arranque)
    // Deja la terminal con folios del día ya reservados: si pierde la red después,
    // sigue emitiendo folios cortos definitivos.
    ensureFolioBlock();
  }

  // Asocia STORE a la identidad efectiva. Cambiar de cuenta fuerza el mismo
  // pull que una apertura limpia; logout detiene pushes sin borrar la cola.
  function setSession(profile) {
    const next = profile && profile.email
      ? String(profile.email).trim().toLowerCase()
      : null;
    if (!next) {
      if (sessionManaged) {
        sessionSeq++;
        sessionIdentity = null;
        enabled = false;
      }
      return Promise.resolve({ ok: true, signedOut: true });
    }
    sessionManaged = true;
    if (next === sessionIdentity && enabled) {
      return Promise.resolve({ ok: true, unchanged: true });
    }
    sessionIdentity = next;
    resumeAuthenticatedOperations();
    const seq = ++sessionSeq;
    enabled = true;
    return init({ pull: true }).then(() => ({
      ok: seq === sessionSeq,
      stale: seq !== sessionSeq,
    }));
  }

  // Las operaciones creadas antes de H-09 no tienen identidad verificable.
  // Sólo un administrador puede atribuirlas expresamente a su sesión actual.
  function claimLegacyQueue() {
    const profile = window.AUTH && window.AUTH.current && window.AUTH.current();
    const ownerId = activeOwnerId();
    if (!ownerId || !profile || String(profile.role || '').toLowerCase() !== 'admin') {
      return { ok: false, error: 'admin_required' };
    }
    const q = loadQ(); let claimed = 0;
    q.forEach(op => {
      if (op.ownerId === '__legacy_unclaimed__') {
        op.ownerId = ownerId;
        claimed++;
      }
    });
    if (claimed) {
      saveQ(q);
      legacyWarned = false;
      flushQueue();
    }
    return { ok: true, claimed };
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

  window.STORE = { init, setSession, claimLegacyQueue, pull, pushConfig, pushRows, pushSale, pushReturn, pushExchange, ensureFolioBlock, deleteRow, settleCommission, closeCommissionPeriod, pushLoanOperation, pullDomain, fetchSaleByFolio, physicalCardAvailable, claimPhysicalCard, flushQueue, retryOperation, queueStatus, clearQueue, markResetApplied, autoMigratePhotos, ensureClient, getClient: ensureClient, hasSession, callFunction, uploadBarcode, uploadProductPhoto, get enabled() { return enabled; }, get pending() { return loadQ().filter(opBelongsToActiveSession).length; } };
  window.CORE.registerSyncGateway(window.STORE);
})();
