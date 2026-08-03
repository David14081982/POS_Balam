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
  let sessionIdentity = null, sessionManaged = false, onlineSubscribed = false,
    writerSubscribed = false, legacyWarned = false;
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
  // H-69 · Frontera de escritura del vendedor.
  //
  // `comision_acum`, `ventas_mes` y `ventas_num` son EXCLUSIVAS de las RPC
  // financieras: la nube las protege con el trigger
  // `pos.restrict_direct_commission_writes`, que responde 42501
  // COMMISSION_RPC_REQUIRED a cualquier escritura directa como `authenticated`.
  // El cliente respeta la misma frontera ANTES de intentar la red, así que un
  // guardado de perfil -nombre, foto, estado, porcentaje, nivel, meta- ya no
  // puede quedar bloqueado por un acumulado que divergió.
  const SELLER_RPC_ONLY_COLUMNS = ['comision_acum', 'ventas_mes', 'ventas_num'];
  const sellerRow = s => ({ id: s.id, nombre: s.nombre, iniciales: s.iniciales, color: s.color, comision_pct: Number(s.comisionPct) || 0, commission_override_pct: s.commissionOverridePct == null || !Number.isFinite(Number(s.commissionOverridePct)) ? null : Number(s.commissionOverridePct), seller_level_code: s.sellerLevelCode == null ? null : String(s.sellerLevelCode), commission_policy_version: Number(s.commissionPolicyVersion) || 0, meta_mes: Number(s.metaMes) || 0, ventas_mes: Number(s.ventasMes) || 0, ventas_num: s.ventasNum || 0, comision_acum: Number(s.comisionAcum) || 0, bono: s.bono || null, email: s.email || null, password_hash: s.passwordHash || null, role: s.role || 'vendedor', avatar_url: s.avatar || null, active: s.active !== false, sync_base_version: Number(s._syncVersion) || 0, sync_device_id: window.CORE.getDeviceId() });
  const sellerProfileRow = s => {
    const row = sellerRow(s);
    SELLER_RPC_ONLY_COLUMNS.forEach(col => { delete row[col]; });
    return row;
  };

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
      toRow: sellerRow, profileRow: sellerProfileRow,
      fromRow: r => ({ id: r.id, nombre: r.nombre, iniciales: r.iniciales, color: r.color, comisionPct: Number(r.comision_pct) || 0, commissionOverridePct: r.commission_override_pct == null ? null : Number(r.commission_override_pct), sellerLevelCode: r.seller_level_code == null ? null : String(r.seller_level_code), commissionPolicyVersion: Number(r.commission_policy_version) || 0, metaMes: Number(r.meta_mes) || 0, ventasMes: Number(r.ventas_mes) || 0, ventasNum: r.ventas_num || 0, comisionAcum: Number(r.comision_acum) || 0, bono: r.bono || 'Sin bono', email: r.email || undefined, passwordHash: r.password_hash || null, role: r.role || 'vendedor', avatar: r.avatar_url || null, active: r.active !== false, _syncVersion: Number(r.sync_version) || 0, _deletedAt: r.deleted_at || null }),
    },
    sales: {
      table: 'sales', conflict: 'folio',
      // H-65: el estado de una venta no prueba que el inventario se reservara.
      // Esa autoridad pertenece exclusivamente a la respuesta/consulta remota.
      fromRow: r => ({ folio: r.folio, folioAliases: Array.isArray(r.folio_aliases) ? r.folio_aliases : undefined, _operationId: r.operation_id || undefined, _stockReserved: r.stock_reserved === true, _stockRequired: r.estado !== 'Apartado' && r.estado !== 'Cancelado', _stockIdempotent: r.stock_idempotent === true, _reservationOperationId: r.reservation_operation_id || undefined, _syncStatus: 'synced', fecha: String(r.fecha).replace('T', ' ').slice(0, 16), clienteId: r.cliente_id || undefined, cliente: r.cliente, vendedor: '', vendedores: r.vendedores || [], items: r.items || 0, subtotal: r.subtotal == null ? undefined : Number(r.subtotal), iva: r.iva == null ? undefined : Number(r.iva), total: Number(r.total) || 0, descuento: r.descuento == null ? undefined : Number(r.descuento), descuentoAdicional: r.descuento_adicional == null ? undefined : Number(r.descuento_adicional), totalAntesDescuentoAdicional: r.total_antes_descuento_adicional == null ? undefined : Number(r.total_antes_descuento_adicional), descuentosAdicionales: Array.isArray(r.descuentos_adicionales) ? r.descuentos_adicionales : undefined, ivaPct: r.iva_pct == null ? undefined : Number(r.iva_pct), ivaIncluded: r.iva_included == null ? undefined : !!r.iva_included, anticipo: r.anticipo == null ? undefined : Number(r.anticipo), saldo: r.saldo == null ? undefined : Number(r.saldo), pagoEfectivo: r.pago_efectivo == null ? undefined : Number(r.pago_efectivo), pagoOtro: r.pago_otro == null ? undefined : Number(r.pago_otro), metodo: r.metodo, estado: r.estado, comision: r.comision == null ? undefined : Number(r.comision), comisionBase: r.comision_base || undefined, comisiones: Array.isArray(r.comisiones) ? r.comisiones : undefined, valorRegalado: Number(r.valor_regalado) || 0, returnLimitDays: r.return_limit_days == null ? null : Number(r.return_limit_days), returnExpiresAt: r.return_expires_at || null, lineas: [] }),
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
        comision_base_importe: Number(e.comisionBaseImporte) || 0,
        comision_source: e.comisionSource || null,
        comision_policy_version: e.comisionPolicyVersion == null ? null : Number(e.comisionPolicyVersion),
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
        comisionBaseImporte: Number(r.comision_base_importe) || 0,
        comisionSource: r.comision_source || undefined,
        comisionPolicyVersion: r.comision_policy_version == null ? undefined : Number(r.comision_policy_version),
        comisionRevertida: r.comision_revertida || undefined,
        notas: r.notas || '', lineas: [],
      }),
    },
    // H-62: el préstamo se guarda entero en `document`. La fila no se traduce
    // campo por campo porque el documento ES la evidencia congelada; sólo se le
    // adjunta la versión confirmada por el servidor y el tombstone.
    loans: {
      table: 'loan_documents', conflict: 'id',
      fromRow: r => Object.assign({}, r.document, {
        _loanVersion: Number(r.version) || 0,
        _deletedAt: r.deleted_at || undefined,
      }),
    },
    movements: {
      table: 'movements', conflict: 'id',
      fromRow: r => ({
        id: r.id,
        fecha: String(r.fecha || '').replace('T', ' ').slice(0, 16),
        tipo: r.tipo,
        producto: r.producto || '',
        productId: r.product_id || undefined,
        sku: r.sku || '',
        talla: r.talla || undefined,
        cant: Number(r.cant) || 0,
        ref: r.ref || '',
      }),
    },
  };
  function kindForTable(table) {
    return Object.keys(MAP).find(kind => MAP[kind].table === table) || null;
  }
  function hasLocalWriter(requireLease = false) {
    const data = window.DATA;
    if (!data || typeof data.assertLocalWriter !== 'function') return true;
    try { data.assertLocalWriter(requireLease); return true; }
    catch (e) { return false; }
  }

  // H-65: un SKU no es identidad. Sólo se admite como puente para documentos
  // históricos cuando identifica exactamente un producto del catálogo local.
  function productIdentityError(code, line, context, matches) {
    const sku = String((line && line.sku) || '').trim();
    const error = new Error(code === 'product_identity_ambiguous'
      ? `El SKU ${sku || '—'} coincide con más de un producto`
      : `No se pudo identificar el producto del SKU ${sku || '—'}`);
    error.code = code;
    error.details = {
      context: context || 'unknown', sku: sku || null,
      product_id: (line && (line.productId || line.product_id)) || null,
      matches: (matches || []).map(p => p.id),
    };
    return error;
  }
  function resolveLineProductId(line, context) {
    const explicit = line && (line.productId || line.product_id);
    if (explicit) return String(explicit);
    const sku = String((line && line.sku) || '').trim();
    const products = (window.DATA && Array.isArray(window.DATA.products))
      ? window.DATA.products : [];
    const matches = sku ? products.filter(p => String(p.sku || '') === sku) : [];
    if (matches.length === 1) return matches[0].id;
    throw productIdentityError(matches.length > 1
      ? 'product_identity_ambiguous' : 'product_identity_missing', line, context, matches);
  }
  function saleItemFromRow(x) {
    return {
      _saleItemId: x.id == null ? undefined : Number(x.id),
      productId: x.product_id || x.productId || undefined,
      sku: x.sku, nombre: x.nombre, talla: x.talla, qty: x.qty,
      precio: Number(x.precio) || 0,
      precioBase: x.precio_base == null ? x.precioBase : Number(x.precio_base),
      precioOrig: x.precio_original == null ? x.precioOrig : Number(x.precio_original),
      descuentoAdicional: x.descuento_adicional == null
        ? x.descuentoAdicional : Number(x.descuento_adicional),
      promos: Array.isArray(x.promos) ? x.promos : undefined,
    };
  }
  function mappedSaleCommitResult(raw, op) {
    const payload = Array.isArray(raw) ? raw[0] : raw;
    if (!payload || typeof payload !== 'object') return null;
    const saleRaw = Array.isArray(payload.sale) ? payload.sale[0] : payload.sale;
    const itemRows = Array.isArray(payload.items) ? payload.items : [];
    let sale = null;
    if (saleRaw) {
      sale = MAP.sales.fromRow(saleRaw);
      if (sale.comision == null && op && op.commissionSnapshot) {
        sale.comision = Number(op.commissionSnapshot.amount) || 0;
        sale.comisionBase = op.commissionSnapshot.base || undefined;
      }
      sale.lineas = itemRows.map(saleItemFromRow);
      sale._stockReserved = payload.stock_reserved === true;
      sale._stockIdempotent = payload.stock_idempotent === true;
      sale._reservationOperationId = payload.reservation_operation_id || undefined;
      const vid = (saleRaw.vendedores || [])[0];
      const sellers = (window.DATA && window.DATA.sellers) || [];
      sale.vendedor = (sellers.find(x => x.id === vid) || {}).nombre || sale.vendedor || '';
    }
    return {
      ok: payload.ok === true,
      idempotent: payload.idempotent === true,
      stockReserved: payload.stock_reserved === true,
      stockIdempotent: payload.stock_idempotent === true,
      reservationOperationId: payload.reservation_operation_id || null,
      stock_reserved: payload.stock_reserved === true,
      stock_idempotent: payload.stock_idempotent === true,
      reservation_operation_id: payload.reservation_operation_id || null,
      products: (payload.products || []).map(MAP.products.fromRow),
      sale,
      items: itemRows.map(saleItemFromRow),
      payments: (payload.payments || []).map(MAP.payments.fromRow),
      movements: (payload.movements || []).map(MAP.movements.fromRow),
      sellers: (payload.sellers || []).map(MAP.sellers.fromRow),
      commit: payload.commit || null,
    };
  }
  async function resyncProductsAfterConflict(c, currentOpId) {
    const hasOtherPendingProductChange = () => loadQ().some(op => op.id !== currentOpId
      && opBelongsToActiveSession(op) && op.table === 'products');
    if (!window.DATA || typeof window.DATA.applyRemote !== 'function'
        || hasOtherPendingProductChange()) return false;
    const refreshed = await fetchAllRows(c, 'products', 'id');
    if (refreshed.error || hasOtherPendingProductChange()
        || !Array.isArray(refreshed.data) || !refreshed.data.length) return false;
    window.DATA.applyRemote('products', refreshed.data.map(MAP.products.fromRow));
    return true;
  }

  // ── Cola offline ────────────────────────────────────────────────────────────
  let volatileQueue = null, queueDurability = 'localStorage', storageWarned = false, backupNotified = false;
  let backupChain = Promise.resolve(), queueHydrated = false;
  const layawayResults = new Map();
  function rememberLayawayResult(op, authoritative) {
    const payment = (authoritative.payments || []).find(row => row.tipo === 'liquidacion') || null;
    layawayResults.set(op.id, {
      paymentId: payment && payment.id,
      reservationOperationId: authoritative.reservationOperationId,
    });
    while (layawayResults.size > 50) layawayResults.delete(layawayResults.keys().next().value);
  }
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
  function newOpId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const b = new Uint8Array(16); window.crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
        const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      }
    } catch (e) { /* fallback portable */ }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.floor(Math.random() * 16);
      return (c === 'x' ? r : ((r & 3) | 8)).toString(16);
    });
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isEmptyProductUpsert = op => op && op.type === 'upsert'
    && (op.kind === 'products' || op.table === 'products')
    && (!Array.isArray(op.rows) || op.rows.length === 0);
  const needsUuidQueueId = op => op && (
    (op.type === 'upsert' && (op.kind === 'products' || op.table === 'products'))
    || (op.type === 'softDelete' && op.kind === 'products')
  );
  function enqueue(op) {
    const q = loadQ();
    if (op.ownerId === undefined) op.ownerId = activeOwnerId();
    op.status = 'pending';
    op.attempts = Number(op.attempts) || 0;
    op.createdAt = op.createdAt || new Date().toISOString();
    delete op.diagnostic;
    // H-70: una op ACOTADA (`rowIds`) sólo se colapsa contra otra que cubra
    // exactamente las mismas filas. Antes cualquier upsert de la tabla pisaba al
    // anterior; con envíos por fila eso habría descartado, por ejemplo, el alta de
    // un cliente que seguía en la cola al editar a otro. Una op de tabla completa
    // sí puede pisar a cualquiera —como siempre—: su cuerpo se reconstruye del
    // arreglo local justo antes de volar y ya las contiene a todas.
    const opScope = (x) => (x.rowIds ? x.rowIds.slice().sort().join('|') : null);
    if (op.type === 'upsert' || op.type === 'profileUpdate') { const scope = opScope(op); const i = q.findIndex(x => (x.type === 'upsert' || x.type === 'profileUpdate') && x.table === op.table && x.ownerId === op.ownerId && (scope === null || opScope(x) === scope)); if (i >= 0) q[i] = op; else q.push(op); }
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
    } else if (/commit_mismatch|operation_mismatch|operation_id_conflict|operation_adoption_conflict|item_adoption_conflict|seller_effects_mismatch|payment_id_conflict|payment_balance_mismatch|layaway_not_pending|layaway_already_liquidated|layaway_local_state_conflict|legacy_.*conflict|legacy_context_incomplete|invalid_return|folio_conflict|loan_version_conflict|loan_operation_conflict|operation_purged/.test(lower)) {
      // H-68: `operation_purged` es la última defensa contra la resurrección. El
      // documento que esta operación quiere escribir fue borrado a propósito; reintentar
      // no lo va a hacer válido, así que se detiene y se muestra en el panel de sincronía.
      // H-62: los conflictos de préstamo son PERMANENTES pese a llegar con el
      // código 40001, que por sí solo significa «serialización» y se reintentaría
      // en bucle. Una versión esperada que ya no coincide no va a coincidir en el
      // siguiente intento: necesita revisión, no martilleo.
      category = 'conflict'; status = 'blocked_conflict'; policy = 'review_conflict'; retryable = false;
    } else if (/product_identity_(missing|ambiguous)|layaway_items_(missing_product_id|identity_ambiguous|invalid)|layaway_item_(identity_(missing|ambiguous|mismatch)|product_missing|sku_ambiguous)|layaway_not_found|invalid_(request|context|commission_snapshot|payment|payment_parts|layaway_liquidation)|reservation_confirmation_missing|invalid_commit_response/.test(lower)
        || (code.toUpperCase() === 'P0001' && /seller|vendedor|inactive|inactivo|no existe/.test(lower))) {
      category = 'constraint'; status = 'blocked_data'; policy = 'review_data'; retryable = false;
    } else if (/invalid_loan_|loan_not_found/.test(lower)) {
      category = 'constraint'; status = 'blocked_data'; policy = 'review_data'; retryable = false;
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
  function blockQueueForIdentity(op, error) {
    const diagnostic = classifyFailure(error);
    op.retry = true;
    op.diagnostic = diagnostic;
    op.status = diagnostic.status;
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
    if (!hasLocalWriter(false)) return false;
    const q = loadQ(), op = q.find(x => x.id === id && opBelongsToActiveSession(x));
    if (!op) return false;
    op.status = 'pending'; delete op.diagnostic;
    saveQ(q); flushQueue();
    return true;
  }
  function resumeAuthenticatedOperations() {
    if (!hasLocalWriter(false)) return false;
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
      || (op.type === 'loanOperation' && table === 'loan_documents')
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

  // H-62 · Reidentificación del folio en las operaciones que este mismo préstamo
  // dejó encoladas: todas llevan una copia del documento con el folio anterior.
  function rekeyQueuedLoanFolio(loanId, newFolio) {
    const q = loadQ();
    let changed = false;
    q.forEach(pending => {
      if (pending.type === 'loanOperation' && pending.loan && pending.loan.id === loanId
          && pending.loan.folio !== newFolio) {
        pending.loan.folio = newFolio;
        changed = true;
      }
    });
    if (changed) saveQ(q);
    return changed;
  }

  // H-62 · Reajuste de la versión esperada. Sólo la SIGUIENTE operación de ese
  // préstamo se reajusta: al confirmarse, ella reajustará a la que venga detrás.
  // Reajustarlas todas de golpe pondría la misma versión base a dos operaciones
  // consecutivas y la segunda volvería a chocar.
  function rebaseQueuedLoanVersions(currentOpId, loanId, version) {
    const q = loadQ();
    const next = q.find(pending => pending.type === 'loanOperation'
      && pending.id !== currentOpId
      && pending.loan && pending.loan.id === loanId);
    if (!next || Number(next.expectedVersion) === version) return false;
    next.expectedVersion = version;
    saveQ(q);
    return true;
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
        // H-62: choque de folio entre terminales. Mismo contrato que la venta
        // (`folio_conflict`): se pide un folio libre, el YA IMPRESO en el vale se
        // conserva como alias y se reintenta con la MISMA operación —el servidor
        // no auditó el intento fallido, así que la idempotencia sigue limpia—.
        if (committed.data.ok === false) {
          const rekeys = Number(op.folioRekeys) || 0;
          if (committed.data.error === 'folio_conflict' && rekeys < 3
              && window.DATA && window.DATA.rekeyLoanFolio) {
            const newFolio = window.DATA.collisionSafeLoanFolio(op.loan.folio, op.loan.id, rekeys + 1);
            if (newFolio && window.DATA.rekeyLoanFolio(op.loan.id, op.loan.folio, newFolio)) {
              op.loan.folio = newFolio;
              op.folioRekeys = rekeys + 1;
              rekeyQueuedLoanFolio(op.loan.id, newFolio);
              if (window.UI && window.UI.toast) {
                window.UI.toast(`Este préstamo se registró en la nube como ${newFolio}`, 'var(--accent)');
              }
              return applyOp(c, op);
            }
          }
          return failOp({ code: committed.data.error || 'loan_rejected', message: committed.data.error || 'El préstamo fue rechazado' }, committed.data);
        }
        const version = Number(committed.data._loanVersion) || 0;
        const local = window.DATA && (window.DATA.loans || []).find(x => x.id === op.loan.id);
        if (local && committed.data._loanVersion != null) {
          local._loanVersion = version;
          if (window.DATA.saveLoans) window.DATA.saveLoans();
        }
        // Rebase: las operaciones que este mismo préstamo dejó encoladas detrás
        // leyeron la versión que había ANTES de confirmar ésta. Sin reajustarlas
        // la siguiente choca con `LOAN_VERSION_CONFLICT` y no vuelve a pasar
        // nunca. Es el equivalente de `rebaseQueuedVersions` para documentos.
        if (committed.data._loanVersion != null) rebaseQueuedLoanVersions(op.id, op.loan.id, version);
        return true;
      }
      // H-69 · Escritura acotada del perfil del vendedor.
      //
      // Se usa `update` y NUNCA `upsert`: un upsert con `on conflict do update`
      // rellenaría las columnas ausentes con su valor por defecto, y el trigger
      // vería un `comision_acum` distinto del guardado y volvería a responder
      // 42501. Un `update` sólo escribe las columnas enviadas, así que el
      // acumulado remoto se conserva intacto por construcción.
      if (op.type === 'profileUpdate') {
        const m = MAP[op.kind] || MAP.sellers;
        // Mismo criterio que el upsert: el cuerpo se reconstruye justo antes de
        // enviarse, para que una operación compactada lleve la versión que otra
        // op en vuelo acaba de confirmar.
        // Sólo se reconstruye si DATA tiene realmente esa colección cargada. Con
        // la colección vacía, reconstruir borraría las filas que la operación
        // traía y el guardado desaparecería sin error.
        if (m && m.localKey && m.profileRow && window.DATA
            && Array.isArray(window.DATA[m.localKey]) && window.DATA[m.localKey].length) {
          op.rows = window.DATA[m.localKey].map(m.profileRow);
        }
        const remote = [];
        for (const row of op.rows) {
          const patch = Object.assign({}, row);
          delete patch[op.conflict];
          let r = await c.from(op.table).update(patch).eq(op.conflict, row[op.conflict]).select('*');
          if (r.error) return failOp(r.error);
          // Perfil que todavía no existe en la nube (alta local sin sesión
          // administrada): se inserta. El INSERT no pasa por el trigger, que
          // sólo vigila `before update`, y los acumulados nacen en cero.
          if (!(r.data || []).length) {
            r = await c.from(op.table).insert(row).select('*');
            if (r.error) return failOp(r.error);
          }
          if (!(r.data || []).length) {
            return failOp({ code: 'empty_response', message: 'El perfil no devolvió la fila esperada' });
          }
          remote.push.apply(remote, r.data.map(m.fromRow));
        }
        if (m && window.DATA && window.DATA.applySyncResult) {
          const expected = {};
          op.rows.forEach(row => { expected[row.id] = Number(row.sync_base_version) || 0; });
          const result = window.DATA.applySyncResult(op.kind, remote, expected, 'upsert') || {};
          rebaseQueuedVersions(op.table, remote);
          if (result.conflicts && window.UI && window.UI.toast) {
            window.UI.toast(`${result.conflicts} cambio(s) de personal no se aplicaron porque otra terminal guardó una versión más reciente`, 'var(--danger)');
          }
        }
        return true;
      }
      if (op.type === 'commissionAdjustment') {
        const r = await c.rpc('apply_commission_adjustment_checked', {
          p_operation_id: op.operationId,
          p_rows: op.rows || [],
          p_motivo: op.motivo || '',
        });
        if (r.error) return failOp(r.error);
        await pullDomain('sellers');
        await pullDomain('liquidations');
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
          if (op.kind === 'products' && result.conflicts
              && !(await resyncProductsAfterConflict(c, op.id))) {
            return failOp({
              code: 'product_resync_required',
              message: 'El inventario requiere resincronización antes de continuar',
            }, result);
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
          const local = window.DATA[m.localKey];
          // H-70: una op acotada se reconstruye SÓLO con sus filas. Reconstruirla
          // con el arreglo entero era justo lo que se quería evitar al enviarla
          // por fila. Si la fila ya no existe localmente, la op queda sin cuerpo
          // y no escribe nada (un borrado viaja por su propia `deleteRow`).
          op.rows = op.rowIds
            ? op.rowIds.map(id => local.find(x => x && x.id === id)).filter(Boolean).map(m.toRow)
            : local.map(m.toRow);
        }
        if (op.rowIds && (!Array.isArray(op.rows) || !op.rows.length)) return true;
        if (op.kind === 'products' && (!Array.isArray(op.rows) || !op.rows.length)) return true;
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
          if (op.kind === 'products' && result.conflicts
              && !(await resyncProductsAfterConflict(c, op.id))) {
            return failOp({
              code: 'product_resync_required',
              message: 'El inventario requiere resincronización antes de continuar',
            }, result);
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
            window.UI.toast('No se eliminó: otra terminal modificó el registro. Se resincronizará el inventario.', 'var(--danger)');
          }
          if (op.kind === 'products' && result.conflicts
              && !(await resyncProductsAfterConflict(c, op.id))) {
            return failOp({
              code: 'product_resync_required',
              message: 'El inventario requiere resincronización antes de continuar',
            }, result);
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
      if (op.type === 'sale' && op.mode === 'layaway_liquidation') {
        const failLayaway = (error, details) => {
          const failed = failOp(error, details);
          if (lastApplyFailure && lastApplyFailure.retryable === false
              && window.DATA && typeof window.DATA.releaseLayawayProductLock === 'function') {
            window.DATA.releaseLayawayProductLock(op.operationId);
          }
          return failed;
        };
        if (!hasLocalWriter(true)
            || !window.DATA
            || typeof window.DATA.ensureLayawayProductLockFromOperation !== 'function'
            || window.DATA.ensureLayawayProductLockFromOperation(op) !== true) {
          return failLayaway({
            code: 'layaway_local_state_conflict',
            message: 'La identidad local del inventario cambió; resincroniza antes de reintentar',
          });
        }
        const committed = await c.rpc('commit_layaway_liquidation_checked', {
          p_commit_id: op.id,
          p_operation_id: op.operationId,
          p_folio: op.folio,
          p_payment: op.payment,
          p_seller_effects: op.sellerEffects || [],
          p_context: {
            item_identities: op.itemIdentities || [],
            commission_amount: Number((op.commissionSnapshot || {}).amount) || 0,
            commission_base: (op.commissionSnapshot || {}).base || 'neto',
            // H-69: el apartado comisiona al liquidarse, así que su desglose
            // congelado por vendedor viaja con la confirmación del pago.
            commission_rows: (op.commissionSnapshot || {}).rows || [],
          },
        });
        const payload = Array.isArray(committed.data) ? committed.data[0] : committed.data;
        if (committed.error || !payload) {
          return failLayaway(committed.error || {
            code: 'empty_response', message: 'La liquidación no devolvió confirmación',
          });
        }
        if (payload.ok !== true) {
          return failLayaway({
            code: payload.error || 'layaway_liquidation_rejected',
            message: payload.message || payload.error || 'La liquidación fue rechazada',
          }, payload);
        }
        if (payload.stock_reserved !== true
            || payload.reservation_operation_id !== op.operationId) {
          return failLayaway({
            code: 'reservation_confirmation_missing',
            message: 'La liquidación no confirmó la reserva de inventario',
          }, payload);
        }
        if (!window.DATA || typeof window.DATA.applySaleCommitResult !== 'function') {
          return failLayaway({
            code: 'local_commit_apply_unavailable',
            message: 'La terminal no puede aplicar la respuesta autoritativa de la liquidación',
          }, payload);
        }
        const authoritative = mappedSaleCommitResult(payload, op);
        if (!authoritative || !authoritative.sale) {
          return failLayaway({
            code: 'invalid_commit_response',
            message: 'La liquidación no devolvió la venta autoritativa',
          }, payload);
        }
        // DATA persiste venta, pago, movimientos, vendedores y productos como
        // una sola respuesta coherente. Si la persistencia falla, el commit
        // permanece en cola y su reintento remoto es idempotente.
        const applied = await Promise.resolve(window.DATA.applySaleCommitResult(op.id, op.folio, authoritative));
        if (applied === false || (applied && applied.ok === false)) {
          return failLayaway({
            code: 'local_commit_persistence_failed',
            message: 'No se pudo persistir localmente la liquidación confirmada',
          }, applied || payload);
        }
        rememberLayawayResult(op, authoritative);
        return true;
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
        if (op.reserveStock === true
            && (committed.data.stock_reserved !== true
              || committed.data.reservation_operation_id !== op.operationId)) {
          return failOp({
            code: 'reservation_confirmation_missing',
            message: 'La venta no devolvió una confirmación verificable de inventario',
          }, committed.data);
        }
        const reconcile = async (kind, rows, expected) => {
          const m = MAP[kind];
          if (!rows.length || !m || !m.fromRow || !window.DATA || !window.DATA.applySyncResult) return true;
          const remote = rows.map(m.fromRow);
          const result = window.DATA.applySyncResult(kind, remote, expected, 'sale') || {};
          rebaseQueuedVersions(m.table, remote);
          if (kind === 'products' && result.conflicts) {
            if (window.UI && window.UI.toast) {
              window.UI.toast('El inventario cambió en otra terminal; se está resincronizando', 'var(--danger)');
            }
            return resyncProductsAfterConflict(c, op.id);
          }
          return true;
        };
        if (!(await reconcile('products', committed.data.products || [], expectedProducts))) {
          return failOp({
            code: 'product_resync_required',
            message: 'El inventario requiere resincronización antes de confirmar la venta',
          }, committed.data);
        }
        const expectedClient = {};
        if (op.clientEffect) expectedClient[op.clientEffect.id] = Number(op.clientEffect.base_version) || 0;
        await reconcile('clients', committed.data.clients || [], expectedClient);
        const expectedSellers = {};
        (op.sellerEffects || []).forEach(e => { expectedSellers[e.id] = Number(e.base_version) || 0; });
        await reconcile('sellers', committed.data.sellers || [], expectedSellers);
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
        if (window.DATA && window.DATA.markSaleSync) {
          window.DATA.markSaleSync(op.folio, 'synced', {
            stockReserved: committed.data.stock_reserved === true,
            stockIdempotent: committed.data.stock_idempotent === true,
            reservationOperationId: committed.data.reservation_operation_id || null,
            stock_reserved: committed.data.stock_reserved === true,
            stock_idempotent: committed.data.stock_idempotent === true,
            reservation_operation_id: committed.data.reservation_operation_id || null,
          });
        }
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
        const reconcile = async (kind, rows, expected) => {
          const m = MAP[kind];
          if (!rows.length || !m || !m.fromRow || !window.DATA || !window.DATA.applySyncResult) return true;
          const remote = rows.map(m.fromRow);
          const result = window.DATA.applySyncResult(kind, remote, expected, 'return') || {};
          rebaseQueuedVersions(m.table, remote);
          if (kind === 'products' && result.conflicts) {
            if (window.UI && window.UI.toast) {
              window.UI.toast('El inventario cambió en otra terminal; se está resincronizando', 'var(--danger)');
            }
            return resyncProductsAfterConflict(c, op.id);
          }
          return true;
        };
        if (!(await reconcile('products', committed.data.products || [], expectedProducts))) {
          return failOp({
            code: 'product_resync_required',
            message: 'El inventario requiere resincronización antes de confirmar la devolución',
          }, committed.data);
        }
        const expectedClient = {};
        const clientSource = op.legacy ? op.legacyTargets && op.legacyTargets.client : op.clientEffect;
        if (clientSource) expectedClient[clientSource.id] = Number(clientSource.base_version) || 0;
        await reconcile('clients', committed.data.clients || [], expectedClient);
        const expectedSellers = {};
        const sellerSources = op.legacy ? ((op.legacyTargets && op.legacyTargets.sellers) || []) : (op.sellerEffects || []);
        sellerSources.forEach(e => { expectedSellers[e.id] = Number(e.base_version) || 0; });
        await reconcile('sellers', committed.data.sellers || [], expectedSellers);
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
    if (!enabled || !hasLocalWriter(false)) return;
    op.id = newOpId();
    op.ownerId = activeOwnerId();
    enqueue(op);
    await backupChain;
    flushQueue();
  }

  let flushing = false, flushAgain = false, flushIdleWaiters = [];
  function waitForFlushIdle() {
    if (!flushing && !flushAgain) return Promise.resolve();
    return new Promise(resolve => { flushIdleWaiters.push(resolve); });
  }
  function hasPendingLayaway(folio) {
    const wanted = String(folio || '').trim();
    return !!wanted && loadQ().some(op => op && op.type === 'sale'
      && op.mode === 'layaway_liquidation' && op.folio === wanted);
  }
  function releaseFlushIdleWaiters() {
    if (flushing || flushAgain) return;
    const waiters = flushIdleWaiters.splice(0);
    waiters.forEach(resolve => resolve());
  }
  async function flushQueue() {
    if (!hasLocalWriter(false)) return;
    if (flushing) { flushAgain = true; return; } // otra pasada al terminar la actual
    { // migra ops persistidas por una versión anterior (sin id)
      const stored = loadQ(), q0 = []; let mig = false;
      stored.forEach(o => {
        // Descarta exclusivamente upserts vacíos de productos. Ninguna venta,
        // cambio, devolución, foto u otra operación se toca.
        if (isEmptyProductUpsert(o)) { mig = true; return; }
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
        // H-69 · Cierre auditado de la operación bloqueada por
        // COMMISSION_RPC_REQUIRED.
        //
        // No se borra: se DETERMINA que quedó obsoleta y se sustituye por la
        // forma que sí puede aplicarse. Quedó obsoleta porque su cuerpo se
        // reconstruye desde `DATA.sellers` en cada intento —nunca fue una
        // captura histórica, sino un espejo del estado local— y porque las tres
        // columnas que la bloqueaban dejaron de pertenecer al cliente. Lo que
        // esa operación quería guardar era el PERFIL, y eso viaja íntegro.
        //
        // La supersesión queda registrada en la propia operación (`supersededOp`,
        // `supersededReason`, `supersededDiagnostic`) para que el cierre de la
        // historia pueda demostrar qué se convirtió y por qué.
        if ((o.type === 'upsert' || o.type === 'staffUpdate')
            && (o.kind === 'sellers' || o.table === 'sellers')) {
          const previo = o.diagnostic || null;
          o.supersededOp = o.type;
          o.supersededReason = 'commission_columns_are_rpc_only';
          if (previo) o.supersededDiagnostic = previo;
          o.type = 'profileUpdate';
          o.kind = 'sellers';
          o.conflict = o.conflict || 'id';
          o.rows = (o.rows || []).map(row => {
            const clean = Object.assign({}, row);
            SELLER_RPC_ONLY_COLUMNS.forEach(col => { delete clean[col]; });
            return clean;
          });
          o.status = 'pending';
          o.retry = true;
          delete o.diagnostic;
          mig = true;
        }
        if (needsUuidQueueId(o) && !UUID_RE.test(String(o.id || ''))) {
          o.id = newOpId(); mig = true;
        }
        if (o.type === 'sale') {
          if (!o.operationId) { o.operationId = o.id; mig = true; }
          if (o.header && !o.header.operation_id) {
            o.header.operation_id = o.operationId; mig = true;
          }
          if (o.mode !== 'layaway_liquidation') {
            const previousIdentityState = JSON.stringify({
              stockLines: o.stockLines, reserveStock: o.reserveStock,
              status: o.status, diagnostic: o.diagnostic,
              productIds: (o.items || []).map(item => item.product_id || null),
            });
            try {
              o.stockLines = (o.items || []).map(item => {
                const productId = resolveLineProductId(item, 'legacy_sale_queue');
                if (!item.product_id) item.product_id = productId;
                return Number(item.qty) > 0
                  ? { product_id: productId, talla: item.talla, qty: Number(item.qty) }
                  : null;
              }).filter(Boolean);
              if (o.diagnostic && /product_identity_(missing|ambiguous)/.test(String(o.diagnostic.code || ''))) {
                o.status = 'pending'; delete o.diagnostic;
              }
            } catch (identityError) {
              o.stockLines = [];
              o.reserveStock = false;
              blockQueueForIdentity(o, identityError);
            }
            const state = o.header && o.header.estado;
            if (state === 'Apartado' || state === 'Cancelado') o.reserveStock = false;
            else if (typeof o.reserveStock !== 'boolean') o.reserveStock = o.stockLines.length > 0;
            if (previousIdentityState !== JSON.stringify({
              stockLines: o.stockLines, reserveStock: o.reserveStock,
              status: o.status, diagnostic: o.diagnostic,
              productIds: (o.items || []).map(item => item.product_id || null),
            })) mig = true;
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
            let identityComplete = true;
            (o.items || []).forEach(item => {
              if (!identityComplete) return;
              try {
                const productId = resolveLineProductId(item, 'legacy_return_queue');
                const exact = (data.products || []).filter(p => p.id === productId);
                if (exact.length !== 1) {
                  throw productIdentityError('product_identity_missing', item, 'legacy_return_queue', exact);
                }
                const product = exact[0];
                if (seenProducts.has(product.id)) return;
                seenProducts.add(product.id);
                products.push({
                  id: product.id, base_version: Number(product._syncVersion) || 0,
                  stock: product.stock || [],
                });
                if (!item.product_id) item.product_id = product.id;
              } catch (identityError) {
                identityComplete = false;
                blockQueueForIdentity(o, identityError);
              }
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
              complete: identityComplete && !!sale && products.length === new Set((o.items || []).map(i => i.product_id).filter(Boolean)).size
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
        q0.push(o);
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
        const genericSalesBehindLayaway = new Set();
        const layawaysBehindGenericSale = new Set();
        queue.forEach((candidate, index) => {
          if (candidate.type !== 'sale') return;
          if (candidate.mode === 'layaway_liquidation') {
            if (queue.slice(0, index).some(prior => prior.type === 'sale'
                && prior.mode !== 'layaway_liquidation' && prior.folio === candidate.folio)) {
              layawaysBehindGenericSale.add(candidate.id);
            }
          } else if (queue.slice(0, index).some(prior => prior.type === 'sale'
            && prior.mode === 'layaway_liquidation' && prior.folio === candidate.folio)) {
            genericSalesBehindLayaway.add(candidate.id);
          }
        });
        const op = queue.find(o => opBelongsToActiveSession(o)
          && isAutomaticallyEligible(o) && !failed.has(o.id)
          && !genericSalesBehindLayaway.has(o.id)
          && !layawaysBehindGenericSale.has(o.id)
          && !(o.type === 'return' && salesInFlight.has(o.folio)));
        if (!op) break;
        const ok = await applyOp(c, op);
        const cur = loadQ();
        if (ok) {
          if (op.retry) recovered = true;
          const remaining = cur.filter(o => o.id !== op.id);
          if (op.type === 'sale' && op.mode === 'layaway_liquidation') {
            remaining.forEach(later => {
              if (later.type !== 'sale' || later.mode === 'layaway_liquidation'
                  || later.folio !== op.folio) return;
              later.retry = true;
              later.status = 'blocked_conflict';
              later.diagnostic = classifyFailure({
                code: 'layaway_already_liquidated',
                message: 'Una liquidación autoritativa anterior ya cerró este apartado',
              });
            });
          }
          saveQ(remaining);
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
      if (flushAgain) {
        flushAgain = false;
        Promise.resolve(flushQueue()).finally(releaseFlushIdleWaiters);
      } else releaseFlushIdleWaiters();
    }
  }

  // ── API de escritura (encolable) ────────────────────────────────────────────
  function pushRows(kind, arr) {
    if (!enabled) return;
    const m = MAP[kind]; if (!m || !m.toRow) return;
    if (kind === 'products' && (!Array.isArray(arr) || !arr.length)) return;
    const seller = window.AUTH && window.AUTH.role && window.AUTH.role() === 'vendedor';
    if (seller && kind === 'products') return;
    // H-69: el vendedor NUNCA viaja como upsert de tabla completa. Va como
    // actualización acotada de perfil, sin las tres columnas que sólo las RPC
    // financieras pueden escribir. Vale para administrador y para vendedor: la
    // frontera es de datos, no de rol.
    if (kind === 'sellers') {
      return run({ type: 'profileUpdate', kind, table: m.table, conflict: m.conflict, rows: arr.map(m.profileRow) });
    }
    return run({ type: 'upsert', kind, table: m.table, conflict: m.conflict, rows: arr.map(m.toRow) });
  }
  // H-70: la edición de una ficha viaja sola. Mismo upsert y mismo control de
  // versión que `pushRows`, pero con una fila: el arreglo completo pisaba con
  // esta copia local a cualquier otro cliente que otra terminal hubiera tocado
  // mientras tanto.
  function pushClient(c) {
    if (!enabled || !c || !c.id) return;
    const m = MAP.clients;
    return run({ type: 'upsert', kind: 'clients', table: m.table, conflict: m.conflict, rowIds: [c.id], rows: [m.toRow(c)] });
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
  // H-69: el ajuste histórico es un documento propio. Viaja por la cola como una
  // RPC más —idempotente por `operationId`— y jamás escribe `comision_acum`
  // desde el cliente.
  function applyCommissionAdjustment({ operationId, rows, motivo }) {
    if (!enabled) return;
    return run({ type: 'commissionAdjustment', operationId, rows: rows || [], motivo: motivo || '' });
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

  // ── H-62 · Migración de los préstamos que sólo vivían en esta terminal ──────
  // Antes de H-62 un préstamo se enviaba únicamente al mutarlo, así que los
  // registrados antes de que existiera la réplica —o mientras no había sesión—
  // nunca salieron del navegador. Esta rutina los adopta en la nube UNA sola vez
  // conservando folio, fechas, líneas y devoluciones.
  //
  // No borra nada. Antes de encolar deja una copia congelada de la cartera en
  // `balam_pos_loans_premigracion_v1`, que sobrevive a la migración y sólo se
  // retira a mano: mientras exista, el estado anterior es reconstruible.
  const LOAN_BACKUP_KEY = 'balam_pos_loans_premigracion_v1';
  function migrateLocalLoans() {
    const D = window.DATA || {};
    const todos = Array.isArray(D.loans) ? D.loans : [];
    // No sincronizado = el servidor nunca confirmó una versión para él.
    const pendientes = todos.filter(l => l && l.id && l._loanVersion == null);
    const enCola = new Set(loadQ()
      .filter(op => op.type === 'loanOperation' && op.loan)
      .map(op => op.loan.id));
    const informe = {
      detectados: pendientes.length, encolados: 0, yaEnCola: 0,
      confirmados: 0, sinConfirmar: 0, fallidos: [], respaldo: false,
    };
    if (!pendientes.length) return Promise.resolve(informe);
    if (!enabled) { informe.fallidos.push({ folio: '—', motivo: 'sin_conexion' }); return Promise.resolve(informe); }
    try {
      if (!localStorage.getItem(LOAN_BACKUP_KEY)) {
        localStorage.setItem(LOAN_BACKUP_KEY, JSON.stringify({
          fecha: new Date().toISOString(), motivo: 'H-62 migración a Supabase', loans: todos,
        }));
      }
      informe.respaldo = true;
    } catch (e) { informe.fallidos.push({ folio: '—', motivo: 'sin_respaldo_local' }); }
    pendientes.forEach(loan => {
      if (enCola.has(loan.id)) { informe.yaEnCola++; return; }
      informe.encolados++;
      pushLoanOperation('deliver', loan, 0);
    });
    return flushQueue().then(() => {
      pendientes.forEach(loan => {
        const vivo = (D.loans || []).find(l => l.id === loan.id);
        if (vivo && vivo._loanVersion != null) informe.confirmados++;
        else informe.sinConfirmar++;
      });
      loadQ().forEach(op => {
        if (op.type === 'loanOperation' && op.diagnostic && /^blocked_/.test(op.status || '')) {
          informe.fallidos.push({ folio: (op.loan || {}).folio || '—', motivo: op.diagnostic.code });
        }
      });
      return informe;
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
    if (sale.comision != null) header.comision = Number(sale.comision) || 0;
    if (sale.comisionBase != null) header.comision_base = sale.comisionBase;
    // H-69: el desglose por vendedor viaja con la venta. Campo opcional, como el
    // resto de snapshots: una instalacion sin la migracion simplemente no lo manda.
    if (Array.isArray(sale.comisiones)) header.comisiones = sale.comisiones;
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
      const productId = resolveLineProductId(l, `sale:${sale.folio}`);
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
      .map(m => ({ fecha: String(m.fecha || '').replace(' ', 'T'), tipo: 'Venta', producto: m.producto, product_id: m.productId || m.product_id || null, sku: m.sku, talla: m.talla || null, cant: Number(m.cant) || 0, ref: sale.folio }));
    const stockLines = items
      .filter(row => row.product_id && Number(row.qty) > 0)
      .map(row => ({ product_id: row.product_id, talla: row.talla, qty: Number(row.qty) }));
    const payments = (effects.payments || ((window.DATA && window.DATA.paymentsForSale) ? window.DATA.paymentsForSale(sale.folio) : []))
      .map(MAP.payments.toRow);
    return run({
      type: 'sale', folio: sale.folio, header, items, moves, payments,
      operationId,
      reserveStock: sale._stockRequired === true && sale._stockReserved !== true,
      stockLines,
      clientEffect: effects.clientEffect || null,
      sellerEffects: effects.sellerEffects || [],
    });
  }
  function liquidationQueueResult(commitId, folio) {
    const pendingOp = loadQ().find(op => op.id === commitId && opBelongsToActiveSession(op));
    if (!pendingOp) {
      const applied = layawayResults.get(commitId) || {};
      return {
        ok: true, pending: false, commitId, folio,
        paymentId: applied.paymentId || null,
        reservationOperationId: applied.reservationOperationId || null,
      };
    }
    const diagnostic = pendingOp.diagnostic || null;
    const blocked = /^blocked_/.test(pendingOp.status || '') || pendingOp.status === 'auth_required';
    return {
      ok: false,
      pending: !blocked,
      queued: true,
      commitId,
      folio,
      error: diagnostic,
    };
  }
  async function settleLayaway(draft, effects) {
    draft = draft || {};
    effects = effects || {};
    if (!enabled) {
      return { ok: false, pending: false, error: { code: 'store_disabled', message: 'La sincronización no está inicializada' } };
    }
    if (!hasLocalWriter(true)) {
      return {
        ok: false, pending: false,
        error: { code: 'local_writer_required', message: 'La liquidación requiere la pestaña activa de escritura' },
      };
    }
    const sale = draft.sale || draft;
    const folio = String(draft.folio || sale.folio || '').trim();
    const operationId = draft.operationId || draft.operation_id
      || sale._operationId || sale.operationId || sale.operation_id;
    const payment = draft.payment || effects.payment;
    if (!folio || !operationId || !payment || typeof payment !== 'object') {
      return {
        ok: false, pending: false,
        error: {
          code: 'invalid_layaway_liquidation',
          message: 'La liquidación requiere folio, operación original y pago final',
        },
      };
    }
    const ownerId = activeOwnerId();
    const existing = loadQ().find(op => opBelongsToActiveSession(op)
      && op.type === 'sale' && op.mode === 'layaway_liquidation'
      && op.folio === folio);
    if (existing) {
      await backupChain;
      await flushQueue();
      await waitForFlushIdle();
      return liquidationQueueResult(existing.id, folio);
    }
    const clone = value => JSON.parse(JSON.stringify(value));
    const productIds = [...new Set((sale.lineas || []).map(line => line.productId).filter(Boolean))];
    const durableLock = window.DATA && typeof window.DATA.layawayProductLockSnapshot === 'function'
      ? window.DATA.layawayProductLockSnapshot(String(operationId)) : null;
    if (window.DATA && typeof window.DATA.layawayProductLockSnapshot === 'function'
        && (!durableLock || JSON.stringify((durableLock.productIds || []).slice().sort())
          !== JSON.stringify(productIds.slice().sort()))) {
      return {
        ok: false, pending: false,
        error: { code: 'layaway_local_state_conflict', message: 'No existe un lock durable para esta liquidación' },
      };
    }
    const productSnapshots = durableLock ? durableLock.productSnapshots
      : productIds.map(id => (window.DATA && window.DATA.products || []).find(product => product.id === id)).filter(Boolean);
    const op = {
      id: newOpId(),
      ownerId,
      type: 'sale',
      mode: 'layaway_liquidation',
      table: 'sales',
      folio,
      operationId: String(operationId),
      productIds: clone(productIds),
      productSnapshots: clone(productSnapshots),
      payment: clone(payment),
      sellerEffects: clone(effects.sellerEffects || effects.seller_effects || []),
      itemIdentities: (sale.lineas || []).map(line => ({
        sale_item_id: line._saleItemId == null ? null : Number(line._saleItemId),
        product_id: line.productId || null,
        sku: line.sku || null,
        talla: line.talla || null,
      })),
      commissionSnapshot: {
        amount: Number(sale.comision) || 0,
        base: sale.comisionBase || 'neto',
        rows: Array.isArray(sale.comisiones) ? sale.comisiones : [],
      },
    };
    enqueue(op);
    await backupChain;
    await flushQueue();
    await waitForFlushIdle();
    return liquidationQueueResult(op.id, folio);
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
      comision_base_importe: Number(exch.comisionBaseImporte) || 0,
      comision_source: exch.comisionSource || null,
      comision_policy_version: exch.comisionPolicyVersion == null ? null : Number(exch.comisionPolicyVersion),
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
    // (H-68: la marca es el camino HISTÓRICO. Una limpieza hecha con la autoridad
    // remota trae además su época y se aplica en `applyRemotePurge`, ANTES del
    // flush, así que ya no depende de que la cola estuviera vacía.)
    if (pendingAtBoot || loadQ().length) return false;
    if (!(window.DATA && window.DATA.resetTestData)) return false;
    if (!localPurgeApplied()) return false;
    try { localStorage.setItem(RESET_SEEN, lastResetMark); } catch (e) { /* */ }
    try { await flushQueue(); } catch (e) { /* offline: el stock restaurado queda en cola */ }
    if (window.UI && window.UI.toast) window.UI.toast('Datos de prueba borrados en esta terminal — inventario intacto', 'var(--accent)');
    return true;
  }

  // ── H-68 · Borrado de datos de prueba con autoridad transaccional ───────────
  // El borrado NO es una secuencia de borrados desde el navegador: `pos.purge_test_data()`
  // hace todo —revertir existencias, vaciar lo operativo, poner acumulados en cero y
  // sellar la época— dentro de UNA transacción. Si algo falla, la nube no cambia y esta
  // terminal tampoco toca nada.
  //
  // La época sellada es lo que hace que la limpieza VIAJE a los equipos apagados: al
  // encender, cada terminal la lee ANTES de drenar su cola (`applyRemotePurge`), invalida
  // sus operaciones pendientes de datos ya borrados y se limpia sola. Sin ese orden, el
  // flush del arranque volvería a subir las ventas de prueba a la nube recién limpiada.
  const PURGE_SEEN = 'balam_purge_seen';       // época ya aplicada en esta terminal
  const PURGE_TICKET = 'balam_purge_ticket';   // id reservado: un reintento no purga dos veces
  // Documentos: se descartan. Cada uno vive de un registro que la limpieza borró.
  const PURGE_DOCUMENT_OPS = {
    sale: 1, return: 1, exchange: 1, loanOperation: 1,
    commissionSettle: 1, commissionClose: 1, commissionAdjustment: 1,
  };
  // Cargas masivas que suben el arreglo COMPLETO: no se descartan a ciegas ni se dejan
  // pasar. Se reconstruyen desde el estado ya limpio, así una alta de catálogo capturada
  // sin red sobrevive y las filas borradas no vuelven.
  const PURGE_REBUILT_UPSERTS = { products: 1, sellers: 1, clients: 1 };
  const PURGE_DROPPED_UPSERTS = { liquidations: 1, payments: 1, exchanges: 1 };
  function localPurgeApplied(opts) {
    let local;
    try { local = window.DATA.resetTestData(opts); } catch (e) { return null; }
    // `false` = hay una liquidación de apartado pendiente: no se limpia NADA.
    if (local === false) return null;
    if (local === true) return { ok: true };           // contrato histórico
    return local && local.ok === true ? local : null;
  }
  // Invalida SÓLO lo vinculado con lo borrado. Una operación creada DESPUÉS de la
  // limpieza es ajena y queda intacta; una sin fecha se trata como anterior porque no
  // puede demostrar que no lo es.
  function pruneQueueForPurge(cutoffIso) {
    const cutoff = Date.parse(cutoffIso || '');
    const limit = Number.isFinite(cutoff) ? cutoff : Date.now();
    const q = loadQ();
    const kept = [];
    const rebuild = {};
    let dropped = 0;
    q.forEach(op => {
      const at = Date.parse(op.createdAt || '');
      if (Number.isFinite(at) && at > limit) { kept.push(op); return; }
      if (PURGE_DOCUMENT_OPS[op.type]) { dropped++; return; }
      if (op.type === 'upsert' || op.type === 'staffUpdate' || op.type === 'profileUpdate') {
        const kind = op.kind || op.table;
        if (PURGE_REBUILT_UPSERTS[kind]) { rebuild[kind] = true; dropped++; return; }
        if (PURGE_DROPPED_UPSERTS[kind]) { dropped++; return; }
      }
      kept.push(op); // config, bajas de catálogo y todo lo ajeno: intacto
    });
    if (dropped) saveQ(kept);
    return { dropped, kept: kept.length, rebuild: Object.keys(rebuild) };
  }
  // Se reencolan DESPUÉS de bajar el dominio: sólo entonces las filas locales llevan la
  // versión que la limpieza dejó en la nube y el control optimista las acepta.
  function rebuildPurgedUpserts(kinds) {
    (kinds || []).forEach(kind => {
      const rows = window.DATA && window.DATA[kind === 'products' ? 'products' : kind];
      if (Array.isArray(rows) && rows.length) pushRows(kind, rows);
    });
  }
  async function readPurgeState() {
    const c = await ensureClient();
    if (!c || !(await hasSession())) return null;
    try {
      const r = await c.rpc('test_data_purge_state');
      if (r.error || !r.data) return null;
      const state = Array.isArray(r.data) ? r.data[0] : r.data;
      return state && state.epoch ? state : null;
    } catch (e) { return null; }
  }
  function purgeSeen() {
    try { return localStorage.getItem(PURGE_SEEN); } catch (e) { return null; }
  }
  function markPurgeSeen(state) {
    try {
      localStorage.setItem(PURGE_SEEN, String(state.epoch));
      // La marca histórica queda saldada a la vez: `applyResetMark` no debe volver a
      // limpiar por el camino viejo lo que esta época ya limpió.
      if (lastResetMark) localStorage.setItem(RESET_SEEN, lastResetMark);
    } catch (e) { /* */ }
  }
  // Limpieza propagada por época. Corre ANTES del flush del arranque: es lo único que
  // impide que un equipo apagado resucite en la nube lo que otro acaba de borrar.
  async function applyRemotePurge() {
    const state = await readPurgeState();
    if (!state) return null;
    if (purgeSeen() === String(state.epoch)) return null;   // ya aplicada aquí
    if (!(window.DATA && window.DATA.resetTestData)) return null;
    const prune = pruneQueueForPurge(state.purged_at);
    const local = localPurgeApplied({ authority: 'remote' });
    if (!local) return null;   // liquidación pendiente: se reintenta al próximo arranque
    markPurgeSeen(state);
    if (window.UI && window.UI.toast) {
      window.UI.toast('Datos de prueba borrados en esta terminal — inventario y configuración intactos', 'var(--accent)');
    }
    return { state, local, prune };
  }
  // Autoridad del botón «Borrar datos de prueba». Con sesión, la transacción remota
  // manda: si falla, no se borra nada aquí. Sin sesión (uso local/demostración) la
  // terminal es su propia autoridad y sólo puede limpiarse a sí misma.
  async function purgeTestData() {
    if (!(window.DATA && window.DATA.resetTestData)) return { ok: false, error: 'DATA no disponible' };
    const footprint = window.DATA.testDataFootprint();
    if (footprint.bloqueado === 'LAYAWAY_LOCK') {
      return { ok: false, code: 'LAYAWAY_LOCK', error: 'Hay una liquidación de apartado pendiente; reconcíliala antes de borrar los datos de prueba' };
    }
    if (footprint.bloqueado === 'IDENTITY_AMBIGUOUS') {
      return { ok: false, code: 'IDENTITY_AMBIGUOUS', error: 'Hay renglones cuyo SKU resuelve a más de un producto: no se puede saber a qué producto devolver esas piezas', detalle: footprint.identidadAmbigua };
    }
    const c = await ensureClient();
    const online = !!c && (await hasSession());
    if (!online) {
      const local = localPurgeApplied();
      if (!local) return { ok: false, code: 'LAYAWAY_LOCK', error: 'No se pudo limpiar esta terminal' };
      return { ok: true, mode: 'local', antes: footprint, local };
    }
    // Un identificador reservado y persistido: si la respuesta se pierde por red, el
    // reintento entra con el MISMO id y la transacción remota lo reconoce como repetición
    // en vez de volver a borrar y restaurar.
    let ticket = null;
    try { ticket = localStorage.getItem(PURGE_TICKET); } catch (e) { ticket = null; }
    if (!ticket) {
      ticket = newOpId();
      try { localStorage.setItem(PURGE_TICKET, ticket); } catch (e) { /* */ }
    }
    let remote;
    try { remote = await c.rpc('purge_test_data', { p_purge_id: ticket }); }
    catch (e) { return { ok: false, code: 'NETWORK', error: String((e && e.message) || e) }; }
    if (remote.error) {
      // La respuesta COMPLETA viaja al informe: código, detalle y pista. Un
      // «DELETE requires a WHERE clause» sin más contexto costó una sesión
      // entera de diagnóstico (H-68); el siguiente fallo se lee en el acto.
      const e = remote.error;
      return {
        ok: false, code: 'REMOTE',
        error: e.message || String(e),
        detalle: {
          code: e.code || null, details: e.details || null,
          hint: e.hint || null, status: e.status || null,
        },
        diagnostic: classifyFailure(e),
      };
    }
    const report = remote.data || {};
    if (report.ok !== true) {
      return { ok: false, code: String(report.error || 'REMOTE'), error: report.message || report.error || 'La limpieza remota no se completó', detalle: report };
    }
    // A partir de aquí la nube YA quedó limpia y restaurada en una sola transacción.
    const prune = pruneQueueForPurge(report.purged_at);
    const local = localPurgeApplied({ authority: 'remote' });
    markPurgeSeen({ epoch: report.epoch });
    try { localStorage.removeItem(PURGE_TICKET); } catch (e) { /* */ }
    const domains = ['products', 'sellers', 'clients', 'promotions', 'liquidations', 'payments', 'movements', 'returns', 'loans'];
    await Promise.all(domains.map(k => pullDomain(k).catch(() => { /* tabla ausente */ })));
    try { await pullDomain('sales'); } catch (e) { /* */ }
    rebuildPurgedUpserts(prune.rebuild);
    try { await flushQueue(); } catch (e) { /* se reintenta al reconectar */ }
    try { window.dispatchEvent(new CustomEvent('configchange', { detail: { domain: true } })); } catch (e) { /* */ }
    return { ok: true, mode: 'remote', antes: footprint, remoto: report, local: local || null, cola: prune };
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
    (itemRows || []).forEach(x => (byFolio[x.folio] || (byFolio[x.folio] = [])).push(saleItemFromRow(x)));
    return raws.map(raw => {
      const s = MAP.sales.fromRow(raw); s.lineas = byFolio[raw.folio] || [];
      const vid = (raw.vendedores || [])[0];
      s.vendedor = (window.DATA.sellers.find(x => x.id === vid) || {}).nombre || s.vendedor || '';
      return s;
    });
  }
  function reservationStatusRows(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data.statuses)) return data.statuses;
    if (Array.isArray(data.reservations)) return data.reservations;
    if (Array.isArray(data.data)) return data.data;
    return data.operation_id || data.reservation_operation_id ? [data] : [];
  }
  async function attachSaleReservationStatus(c, raws) {
    const operations = Array.from(new Set((raws || [])
      .map(row => row.operation_id).filter(Boolean)));
    if (!operations.length) return raws || [];
    const statuses = [];
    for (let i = 0; i < operations.length; i += 200) {
      const status = await c.rpc('sale_stock_reservation_status', {
        p_operation_ids: operations.slice(i, i + 200),
      });
      // Compatibilidad durante el despliegue: si la función aún no existe,
      // no se infiere nada por estado; simplemente se conserva `false`.
      if (status.error) return raws || [];
      statuses.push.apply(statuses, reservationStatusRows(status.data));
    }
    const byOperation = {}, byFolio = {};
    statuses.forEach(status => {
      const operationId = status.operation_id || status.reservation_operation_id;
      if (operationId) byOperation[operationId] = status;
      if (status.folio) byFolio[status.folio] = status;
    });
    return (raws || []).map(raw => {
      const status = byOperation[raw.operation_id] || byFolio[raw.folio];
      if (!status) return raw;
      return Object.assign({}, raw, {
        stock_reserved: status.stock_reserved === true,
        stock_idempotent: status.stock_idempotent === true,
        reservation_operation_id: status.stock_reserved === true
          ? (status.reservation_operation_id || null) : null,
      });
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
    let raws = Object.values(uniq);
    if (!raws.length) return;
    raws = await attachSaleReservationStatus(c, raws);
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
    const remoteSales = await attachSaleReservationStatus(c, r.data);
    const items = await fetchItemsIn(c, 'sale_items', 'folio', remoteSales.map(x => x.folio));
    const rows = saleRowsFrom(remoteSales, items);
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
    if (!writerSubscribed) {
      writerSubscribed = true;
      window.addEventListener('localwriterchange', event => {
        if (event && event.detail && event.detail.state === 'writer') {
          queueHydrated = false;
          volatileQueue = null;
          Promise.resolve(init({ pull: true })).catch(() => { /* relevo best-effort */ });
        }
      });
    }
    if (window.DATA && typeof window.DATA.awaitLocalWriter === 'function'
        && !(await window.DATA.awaitLocalWriter(300))) {
      return { ok: false, readOnly: true };
    }
    if (!hasLocalWriter(false)) return { ok: false, readOnly: true };
    await hydrateDurableQueue();
    const layawayOpsAtBoot = loadQ().filter(op =>
      op.type === 'sale' && op.mode === 'layaway_liquidation'
      && isAutomaticallyEligible(op));
    if (window.DATA && typeof window.DATA.reconcileLayawayProductLocks === 'function') {
      window.DATA.reconcileLayawayProductLocks(layawayOpsAtBoot);
    }
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
    // H-68: la limpieza de datos de prueba se aplica ANTES de drenar nada. Un equipo
    // que estuvo apagado llega con operaciones de esos mismos datos en la cola; si se
    // flushara primero, las volvería a subir a la nube recién limpiada y reaparecerían
    // en todas las terminales al siguiente pull.
    let purged = null;
    try { purged = await applyRemotePurge(); } catch (e) { /* nunca bloquear el arranque */ }
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
      // `loans` sólo lo baja un administrador: la RLS de `pos.loan_documents`
      // concede la lectura a `pos.is_active_admin()`, así que pedirla con perfil
      // de vendedor devolvería siempre el conjunto vacío.
      const domains = seller
        ? ['products', 'clients', 'sellers', 'promotions']
        : ['products', 'clients', 'sellers', 'promotions', 'returns', 'liquidations', 'payments', 'movements', 'loans'];
      await Promise.all(domains.map(k => pullDomain(k).catch(() => { /* tabla ausente */ })));
      if (!seller) {
        try { await pullDomain('sales'); } catch (e) { /* tabla ausente */ }
      }
      // H-68: las cargas masivas que la limpieza invalidó se reencolan AQUÍ, ya con la
      // versión que la nube dejó tras restaurar. Antes del pull el control optimista las
      // rechazaría por versión vieja.
      if (purged && purged.prune && purged.prune.rebuild.length) rebuildPurgedUpserts(purged.prune.rebuild);
      try { window.dispatchEvent(new CustomEvent('configchange', { detail: { domain: true } })); } catch (e) { /* */ }
      // H-62: adopción de los préstamos que nunca salieron de esta terminal. Va
      // DESPUÉS del pull a propósito: sólo entonces se distingue lo que la nube
      // ya conoce de lo que sólo vive aquí. Es idempotente y no borra nada, así
      // que no exige que el dueño pulse ni escriba nada. Un vendedor no la
      // ejecuta: no tiene la capacidad ni la lectura.
      if (!seller) {
        migrateLocalLoans().then(informe => {
          if (informe && informe.confirmados > 0 && window.UI && window.UI.toast) {
            window.UI.toast(`${informe.confirmados} préstamo(s) de esta terminal se respaldaron en la nube`, 'var(--accent)');
          }
        }).catch(() => { /* se reintenta al próximo arranque */ });
      }
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

  window.STORE = { init, setSession, claimLegacyQueue, pull, pushConfig, pushRows, pushClient, pushSale, settleLayaway, pushReturn, pushExchange, ensureFolioBlock, deleteRow, settleCommission, closeCommissionPeriod, applyCommissionAdjustment, pushLoanOperation, migrateLocalLoans, pullDomain, fetchSaleByFolio, physicalCardAvailable, claimPhysicalCard, flushQueue, retryOperation, queueStatus, hasPendingLayaway, clearQueue, markResetApplied, purgeTestData, applyRemotePurge, pruneQueueForPurge, readPurgeState, autoMigratePhotos, ensureClient, getClient: ensureClient, hasSession, callFunction, uploadBarcode, uploadProductPhoto, get enabled() { return enabled; }, get pending() { return loadQ().filter(opBelongsToActiveSession).length; } };
  window.CORE.registerSyncGateway(window.STORE);
})();
