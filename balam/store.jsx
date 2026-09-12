// H164 — una autoridad comercial: Supabase. DATA/CONFIG sólo proyectan memoria.
// Las referencias locales de resultado contienen identidad técnica, nunca payload/replay.
(function () {
  const SUPABASE_URL = 'https://telohdbvbvsfmwyriflz.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_-skU6PI0VrYa91UPHAEaIg_dhsi1l_I';
  const BUILD = '2026-09-12-h166-online';
  const OFFLINE = 'Sin conexión. BALAM necesita internet para continuar.';
  const CONFIRMING = 'Estamos confirmando la operación. No la repitas.';
  const UPDATING = 'BALAM se está actualizando.';
  const STARTUP_FAILED = 'No pudimos completar la actualización. Inténtalo de nuevo.';
  const RECEIPT_PREFIX = 'balam_online_request_v1:';
  const RESET_MARK_KEY = '_resetMark';
  const MONEY_WIRE_MARKER = '__BALAM_MONEY_V1__';
  const moneyWireMethod = (method, components) => Array.isArray(components) && components.length
    ? MONEY_WIRE_MARKER + JSON.stringify({ nominalMethod: method, components }) : method;
  let sb = null, identity = null, sessionSeq = 0, enabled = false;
  let ready = false, connection = 'checking', lastSuccess = null, failure = null;
  let refreshPromise = null, refreshAgain = false, lifecycleStarted = false, channel = null;
  let writeInFlight = false, configRemoteVersion = 0, legacyReviewCount = 0;
  let quoteContext = null, serverClock = null, configLookup = [];
  let snapshotRevision = null;
  let adoptionComplete = false;
  let legacyGeneration = 0;
  let adoption = { revision: 1, state: 'working', stage: 'presence', remainingLegacy: 0, archivedCount: 0 };
  // Sólo continuaciones de solicitudes ya enviadas: no guardan comandos ni los reenvían.
  const resultWaiters = new Map();
  const newRequestId = () => crypto.randomUUID();
  const copy = value => JSON.parse(JSON.stringify(value));
  function error(code, message) { return Object.assign(new Error(message), { code }); }
  function emit() { window.dispatchEvent(new CustomEvent('syncstatuschange', { detail: syncStatus() })); }
  function syncStatus() {
    return { ready, synchronized: ready, connection, lastSuccess, build: BUILD,
      busy: writeInFlight, reconciling: !!refreshPromise, hasUnresolvedRequests: hasUnresolvedRequests(),
      message: failure?.message || (ready ? 'Todo actualizado' : UPDATING),
      adoption: { ...adoption }, legacyReviewCount, errors: failure ? [failure] : [] };
  }
  function markUnavailable(reason) {
    const cause = reason || error('ONLINE_UNAVAILABLE', OFFLINE);
    const offline = isTransportFailure(cause);
    ready = false; connection = offline ? 'offline' : cause.code === 'ONLINE_RESULT_UNKNOWN' ? 'checking' : 'error';
    failure = error(offline ? 'ONLINE_UNAVAILABLE' : cause.code || 'ONLINE_STARTUP_FAILED',
      offline ? OFFLINE : ['ONLINE_RESULT_UNKNOWN','DEVICE_RETIRED','AUTH_REQUIRED'].includes(cause.code) ? cause.message : STARTUP_FAILED);
    emit();
  }
  function isTransportFailure(cause) {
    if (navigator.onLine === false || cause?.code === 'ONLINE_UNAVAILABLE') return true;
    if (cause?.remoteResponse) return false;
    return ['AbortError','TimeoutError'].includes(cause?.name)
      || /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(cause?.message || '');
  }
  function diagnosticCode(cause) {
    const code = String(cause?.code || '').toUpperCase();
    if (/^[0-9A-Z]{5}$/.test(code)) return 'SQL_' + code;
    if (/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) return code;
    return isTransportFailure(cause) ? 'ONLINE_UNAVAILABLE' : 'STARTUP_' + String(cause?.name || 'ERROR').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0,50);
  }
  function hasUnresolvedRequests() {
    if (resultWaiters.size > 0) return true;
    if (!identity) return false;
    try {
      return references(identity).length > 0;
    } catch (_) { return true; }
  }
  function adoptionStage(stage) {
    adoption = { ...adoption, state: 'working', stage }; emit();
  }
  async function reportAdoption(state, cause) {
    const report = { ...adoption, state };
    if (cause) report.code = diagnosticCode(cause);
    if (state === 'ready') Object.assign(report, { stage: 'complete', snapshotAt: lastSuccess });
    // Technical evidence only; never sends a command or a legacy payload for replay.
    const args = { p_device_id: window.CORE.getDeviceId(), p_report: report };
    // Failure diagnostics must not replace the original failure when their own connection fails.
    const response = await readRpc('online_adoption_report', args, { diagnostic: !!cause });
    if (response?.ok !== true || response.revision !== 1 || response.state !== state) {
      throw error('ADOPTION_REPORT_UNCONFIRMED', STARTUP_FAILED);
    }
    return report;
  }
  function assertBusinessReady() {
    if (navigator.onLine === false) throw error('ONLINE_UNAVAILABLE', OFFLINE);
    if (!enabled || !ready) throw failure || error('ONLINE_NOT_READY', UPDATING);
    if (writeInFlight) throw error('ONLINE_RESULT_UNKNOWN', CONFIRMING);
    return true;
  }
  async function ensureClient() {
    if (sb) return sb;
    if (!window.supabase?.createClient) throw error('ONLINE_CLIENT_UNAVAILABLE', STARTUP_FAILED);
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      db: { schema: 'pos' },
      global: { fetch: (input, init = {}) => {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        headers.set('x-balam-device-id', window.CORE.getDeviceId());
        headers.set('x-balam-client-build', BUILD);
        headers.set('x-balam-runtime', 'online-v1');
        const deadline = AbortSignal.timeout(20000);
        const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
        return fetch(input, { ...init, signal, headers, cache: 'no-store' });
      } },
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'balam_auth' },
    });
    return sb;
  }
  async function hasSession() {
    try { const { data, error: failure } = await (await ensureClient()).auth.getSession();
      return !failure && !!data?.session; } catch (_) { return false; }
  }
  async function currentUserId() {
    const { data, error: failure } = await (await ensureClient()).auth.getSession();
    if (failure || !data?.session?.user?.id) throw error('AUTH_REQUIRED', 'Inicia sesión para continuar.');
    return data.session.user.id;
  }
  async function readRpc(name, args = {}, options = {}) {
    if (navigator.onLine === false) { if (!options.diagnostic) markUnavailable(); throw error('ONLINE_UNAVAILABLE', OFFLINE); }
    try {
      const { data, error: failure, status } = await (await ensureClient()).rpc(name, args);
      if (failure) throw Object.assign(new Error(failure.message), failure, { remoteResponse: status > 0 });
      return data;
    } catch (failure) { failure.rpc = name; if (!options.diagnostic) markUnavailable(failure); throw failure; }
  }
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  async function hash(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function references(userId) {
    const result = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index); if (!key?.startsWith(RECEIPT_PREFIX)) continue;
      const entry = JSON.parse(localStorage.getItem(key));
      if (entry?.userId === userId) result.push({ ...entry, key });
    }
    return result;
  }
  function remember(reference) {
    const key = RECEIPT_PREFIX + reference.requestId, encoded = JSON.stringify(reference);
    try {
      localStorage.setItem(key, encoded);
      if (localStorage.getItem(key) !== encoded) throw new Error('unavailable');
    } catch (_) { throw error('ONLINE_RECEIPT_UNAVAILABLE', 'No se pudo proteger la confirmación. La operación no se envió.'); }
    return key;
  }
  async function resolveReference(reference) {
    // La resolución cancela atómicamente IDs ausentes; una solicitud atrasada no puede confirmar después.
    if (reference.kind === 'account') return accountRequest({ action: 'resolve', requestId: reference.requestId, expectedActorId: reference.userId });
    return readRpc('resolve_online_request', { p_request_id: reference.requestId });
  }
  function terminal(receipt) {
    return receipt && (receipt.ok === true || receipt.ok === false)
      && !['processing','pending','unknown','prepared','auth_confirmed','profile_confirmed','needs_review'].includes(receipt.status || receipt.state);
  }
  async function resolveOutstanding(userId) {
    const refs = references(userId), resolved = [];
    for (const ref of refs) {
      const result = await resolveReference(ref);
      if (ref.kind === 'account' && result?.uncertain === true) continue;
      if (!terminal(result)) throw error('ONLINE_RESULT_UNKNOWN', CONFIRMING);
      resolved.push({ ...ref, receipt: result });
    }
    return resolved;
  }
  function getQuoteContext() {
    if (!quoteContext) throw error('ONLINE_UNAVAILABLE', OFFLINE);
    return copy(quoteContext);
  }
  function serverNow() {
    return serverClock ? new Date(serverClock.time + performance.now() - serverClock.observed) : null;
  }
  function receiptError(receipt) {
    return error(receipt.error?.code || receipt.code || 'ONLINE_REJECTED',
      receipt.error?.message || receipt.message || 'La operación no fue confirmada.');
  }
  function deliverResolved(ref) {
    const waiter = resultWaiters.get(ref.requestId);
    if (waiter) {
      resultWaiters.delete(ref.requestId);
      if (ref.receipt.ok === true) waiter.resolve({ ok: true, requestId: ref.requestId, result: ref.receipt.result });
      else waiter.reject(receiptError(ref.receipt));
    } else {
      window.dispatchEvent(new CustomEvent('onlineoperationresolved', { detail: ref }));
      const label = ref.receipt.result?.folio || ref.receipt.result?.id || ref.requestId;
      window.UI?.toast(ref.receipt.ok === true
        ? ref.kind === 'folio' ? 'Se reservó el folio ' + label + '. La reserva no confirma una venta.'
          : 'Supabase confirmó la operación ' + label + '. Consulta el resultado antes de repetirla.'
        : 'La operación ' + label + ' no se realizó. Puedes volver a intentarla.',
        ref.receipt.ok === true ? 'var(--accent)' : 'var(--warning)');
    }
  }
  function wireConfig(command) {
    const state = command.state;
    if (!state) return command;
    const lookup = Object.entries(state.catalogs || {}).flatMap(([kind, rows]) => {
      const original = configLookup.filter(row => row.kind === kind);
      const sameOrder = original.length === rows.length && original.every((row, index) => row.code === rows[index].code);
      return rows.map((it, index) => ({ kind, code: it.code, label: it.label,
        active: it.active !== false, meta: it.meta || {},
        // Guardar otro ajuste no renumera catálogos históricos (p. ej. 10, 30).
        sort_order: sameOrder ? original[index].sort_order : index,
      }));
    });
    const settings = Object.entries(state.settings || {}).filter(([key]) => !key.startsWith('_')).map(([key, value]) => ({ key, value }));
    if (state.catalogMeta) settings.push({ key: '_catalogMeta', value: state.catalogMeta });
    const { state: omitted, ...rest } = command;
    return { ...rest, lookup, settings, expectedVersion: configRemoteVersion,
      productUpdates: (command.productUpdates || []).map(MAP.products.toRow) };
  }
  async function execute(command) {
    assertBusinessReady();
    writeInFlight = true; emit();
    let key = null, sent = false, receipt = null, requestId = null;
    const seq = sessionSeq, expectedActor = identity;
    try {
      command = copy(command.type === 'config' ? wireConfig(command) : command);
      const userId = await currentUserId();
      if (!expectedActor || userId !== expectedActor || seq !== sessionSeq) {
        throw error('SESSION_CHANGED', 'La sesión cambió. Consulta la operación con su usuario.');
      }
      command.expectedActorId = userId;
      requestId = command.requestId || command.operationId || newRequestId();
      if (references(userId).some(ref => ref.kind !== 'account' || ref.requestId === requestId)) {
        throw error('ONLINE_RESULT_UNKNOWN', CONFIRMING);
      }
      // Una lectura iniciada antes del commit no puede certificar su resultado.
      if (refreshPromise) await refreshPromise;
      // El probe valida Supabase/autorización antes de reservar referencia o enviar el comando.
      const probe = await readRpc('online_connectivity');
      if (probe !== true && probe?.ok !== true) { markUnavailable(); throw error('ONLINE_UNAVAILABLE', OFFLINE); }
      // Consultar una identidad repetida no compara nuevos UUIDs de partidas ni genera otro cobro.
      const prior = command.type === 'account' ? null
        : await readRpc('online_request_result', { p_request_id: requestId });
      if (seq !== sessionSeq || userId !== await currentUserId()) {
        throw error('SESSION_CHANGED', 'La sesión cambió. Consulta la operación con su usuario.');
      }
      const fingerprintData = command.type === 'account'
        ? { type: command.type, ...command.payload, password: undefined } : command;
      const reference = { requestId, userId, kind: command.type, fingerprint: await hash(stable(fingerprintData)) };
      if (seq !== sessionSeq) throw error('SESSION_CHANGED', 'La sesión cambió. Consulta la operación con su usuario.');
      key = remember(reference);
      sent = true;
      try { receipt = prior?.found === true ? prior.receipt : command.type === 'account'
        ? await accountRequest({ ...command.payload, requestId, expectedActorId: userId })
        : await readRpc('execute_online_command', { p_request_id: requestId, p_command: command }); }
      catch (_) { receipt = await resolveReference(reference); }
      if (!terminal(receipt)) throw error('ONLINE_RESULT_UNKNOWN', CONFIRMING);
      if (seq !== sessionSeq) throw error('SESSION_CHANGED', 'La sesión cambió. Consulta la operación con su usuario.');
      if (receipt.ok !== true) {
        localStorage.removeItem(key); key = null;
        await refresh({ internal: true });
        throw receiptError(receipt);
      }
      // Un commit conocido no habilita un segundo intento si falta reconstruir la pantalla.
      await refresh({ internal: true });
      if (seq !== sessionSeq) throw error('SESSION_CHANGED', 'La sesión cambió. Consulta la operación con su usuario.');
      localStorage.removeItem(key); key = null;
      return { ok: true, requestId, result: receipt.result };
    } catch (failure) {
      if (seq !== sessionSeq) throw error('SESSION_CHANGED', 'La sesión cambió. Consulta la operación con su usuario.');
      if (sent && key) {
        markUnavailable(error('ONLINE_RESULT_UNKNOWN', CONFIRMING));
        // El formulario sigue esperando su resultado; sólo se reconsulta la autoridad.
        // return sin await libera writeInFlight en finally para permitir esa consulta.
        return new Promise((resolve, reject) => resultWaiters.set(requestId, { resolve, reject }));
      }
      throw failure;
    } finally { writeInFlight = false; emit(); }
  }
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
        if (p.recordModel === 'v2') Object.assign(row, {
          record_model: 'v2', size_category_id: p.sizeCategoryId,
          size_code: String(p.sizeCode), size_scale: p.sizeScale || null,
          stock_quantity: Math.max(0, Math.round(Number(p.stockQuantity) || 0)),
          barcode_code: p.barcodeCode,
          ornament_color_codes: Array.isArray(p.ornamentColorCodes) ? p.ornamentColorCodes.slice() : [],
          physical_signature: p.physicalSignature,
          reference_family_id: p.referenceFamilyId,
          barcode_contract: Number(p.barcodeContract) || 3,
          barcode_aliases: Array.isArray(p.barcodeAliases) ? p.barcodeAliases.slice() : [],
        });
        return row;
      },
      fromRow: r => ({ id: r.id, recordModel: r.record_model || 'v1', referenceFamilyId: r.reference_family_id || null, cat: r.cat, manga: r.manga, tela: r.tela, color: r.color, cuello: r.cuello, modelo: r.modelo, nombre: r.nombre, orn: r.orn, ornColors: r.orn_colors || [], ornamentColorCodes: r.ornament_color_codes || [], precio: Number(r.precio) || 0, costo: Number(r.costo) || 0, pop: !!r.pop, stock: r.stock || [], stockQuantity: r.stock_quantity == null ? null : Number(r.stock_quantity), physicalIdentityLocked: !!r.physical_identity_locked, sizeCode: r.size_code || null, sizeScale: r.size_scale || null, barcodeCode: r.barcode_code || null, barcodeContract: Number(r.barcode_contract) || (r.record_model === 'v2' ? 3 : 0), barcodeAliases: Array.isArray(r.barcode_aliases) ? r.barcode_aliases : [], physicalSignature: r.physical_signature || null, imagen: r.imagen || undefined, barcodeUrls: r.barcode_urls || {}, attrs: r.attrs || {}, sizeCategoryId: r.size_category_id || (r.attrs || {}).__sizeCategoryId || null, preciosTalla: r.precios_talla || {}, _syncVersion: Number(r.sync_version) || 0, _deletedAt: r.deleted_at || null }),
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
      fromRow: r => ({ folio: r.folio, folioAliases: Array.isArray(r.folio_aliases) ? r.folio_aliases : undefined, _operationId: r.operation_id || undefined, _stockReserved: r.stock_reserved === true, _stockRequired: r.estado !== 'Apartado' && r.estado !== 'Cancelado', _stockIdempotent: r.stock_idempotent === true, _reservationOperationId: r.reservation_operation_id || undefined, fecha: String(r.fecha).replace('T', ' ').slice(0, 16), clienteId: r.cliente_id || undefined, cliente: r.cliente, vendedor: '', vendedores: r.vendedores || [], items: r.items || 0, subtotal: r.subtotal == null ? undefined : Number(r.subtotal), iva: r.iva == null ? undefined : Number(r.iva), total: Number(r.total) || 0, descuento: r.descuento == null ? undefined : Number(r.descuento), descuentoAdicional: r.descuento_adicional == null ? undefined : Number(r.descuento_adicional), totalAntesDescuentoAdicional: r.total_antes_descuento_adicional == null ? undefined : Number(r.total_antes_descuento_adicional), descuentosAdicionales: Array.isArray(r.descuentos_adicionales) ? r.descuentos_adicionales : undefined, ivaPct: r.iva_pct == null ? undefined : Number(r.iva_pct), ivaIncluded: r.iva_included == null ? undefined : !!r.iva_included, anticipo: r.anticipo == null ? undefined : Number(r.anticipo), saldo: r.saldo == null ? undefined : Number(r.saldo), pagoEfectivo: r.pago_efectivo == null ? undefined : Number(r.pago_efectivo), pagoOtro: r.pago_otro == null ? undefined : Number(r.pago_otro), metodo: r.metodo, estado: r.estado, comision: r.comision == null ? undefined : Number(r.comision), comisionBase: r.comision_base || undefined, comisiones: Array.isArray(r.comisiones) ? r.comisiones : undefined, comisionesRevertidas: Array.isArray(r.comisiones_revertidas) ? r.comisiones_revertidas : undefined, valorRegalado: Number(r.valor_regalado) || 0, returnLimitDays: r.return_limit_days == null ? null : Number(r.return_limit_days), returnExpiresAt: r.return_expires_at || null, lineas: [] }),
    },
    promotions: {
      table: 'promotions', conflict: 'id', localKey: 'promos',
      toRow: p => ({ id: p.id, nombre: p.nombre, tipo: p.tipo || 'pct', valor: Number(p.valor) || 0, inicio: p.inicio || null, fin: p.fin || null, hora_inicio: p.horaInicio || null, hora_fin: p.horaFin || null, pausado: !!p.pausado, scope: p.scope || {}, creado: p.creado || null, sync_base_version: Number(p._syncVersion) || 0, sync_device_id: window.CORE.getDeviceId() }),
      fromRow: r => ({ id: r.id, nombre: r.nombre, tipo: r.tipo || 'pct', valor: Number(r.valor) || 0, inicio: r.inicio || '', fin: r.fin || '', horaInicio: r.hora_inicio || '', horaFin: r.hora_fin || '', pausado: !!r.pausado, scope: r.scope || {}, creado: r.creado || 0, _syncVersion: Number(r.sync_version) || 0, _deletedAt: r.deleted_at || null }),
    },
    returns: {
      table: 'returns', conflict: 'id',
      fromRow: r => ({ id: r.id, folio: r.folio, fecha: r.fecha || '', cliente: r.cliente, vendedores: r.vendedores || [], metodo: r.metodo, total: Number(r.total) || 0, components: Array.isArray(r.components) ? r.components : undefined, comisiones: Array.isArray(r.comisiones) ? r.comisiones : undefined, priorSaleState: r.prior_sale_state || null, notas: r.notas || '', lineas: [] }),
    },
    liquidations: {
      table: 'liquidations', conflict: 'id',
      toRow: l => ({ id: l.id, seller_id: l.sellerId || null, seller: l.seller || null, monto: Number(l.monto) || 0, tipo: l.tipo || 'liquidacion', fecha: l.fecha || null }),
      fromRow: r => ({ id: r.id, sellerId: r.seller_id || '', seller: r.seller || '', monto: Number(r.monto) || 0, tipo: r.tipo || 'liquidacion', fecha: r.fecha || '' }),
    },
    commissionAdjustments: {
      table: 'commission_adjustments', conflict: 'operation_id',
      fromRow: r => {
        const detalle = Array.isArray(r.detalle) ? r.detalle : [];
        return {
          id: r.operation_id, operationId: r.operation_id,
          fecha: String(r.created_at || '').replace('T', ' ').slice(0, 16),
          aplicadoEn: String(r.created_at || '').replace('T', ' ').slice(0, 16),
          motivo: r.motivo || '', estado: 'aplicado',
          // Una fila heredada puede probar el total pero no qué folios cubrió.
          // Se conserva como autoridad económica y bloquea otro ajuste automático.
          _identityIncomplete: detalle.some(row => Number(row.ventas) > 0
            && (!Array.isArray(row.folios) || row.folios.length < Number(row.ventas))),
          renglones: detalle.flatMap(row =>
          (Array.isArray(row.folios) ? row.folios : []).map(line => ({
            folio: line.folio, sellerId: row.seller_id,
            comision: Number(line.comision) || 0,
          }))),
          porVendedor: detalle.map(row => ({
            sellerId: row.seller_id, comision: Number(row.monto) || 0,
            ventas: Number(row.ventas) || 0,
          })),
          totales: { comision: Number(r.total) || 0, vendedores: Number(r.vendedores) || 0 },
        };
      },
    },
    payments: {
      table: 'sale_payments', conflict: 'id',
      toRow: p => ({ id: p.id, folio: p.folio, fecha: p.fecha, tipo: p.tipo, metodo: moneyWireMethod(p.metodo, p.components), monto: Number(p.monto) || 0, efectivo: Number(p.efectivo) || 0, tarjeta: Number(p.tarjeta) || 0, transferencia: Number(p.transferencia) || 0, otro: Number(p.otro) || 0 }),
      fromRow: r => ({ id: r.id, folio: r.folio, fecha: r.fecha || '', tipo: r.tipo, metodo: r.metodo, monto: Number(r.monto) || 0, efectivo: Number(r.efectivo) || 0, tarjeta: Number(r.tarjeta) || 0, transferencia: Number(r.transferencia) || 0, otro: Number(r.otro) || 0, components: Array.isArray(r.components) ? r.components : undefined }),
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
        // H-96: las altas nuevas derivan la identidad comercial del ID durable.
        // No requiere columna nueva y permite que un pull conserve la clave que
        // debe llegar a exchange_commits en cualquier replay posterior.
        _operationId: String(r.id || '').startsWith('cmb-') ? String(r.id).slice(4) : undefined,
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
        // H-97: la identidad de una reclasificacion debe sobrevivir al pull.
        // DATA la usa para reconocer reintentos y validar la reversa exacta.
        operationId: r.operation_id || undefined,
        reversalOf: r.reversal_of || undefined,
      }),
    },
  };
  const saleHeaderFromRow = MAP.sales.fromRow;
  MAP.sales.fromRow = row => Object.assign(saleHeaderFromRow(row), {
    receiptSnapshot: row.receipt_snapshot && typeof row.receipt_snapshot === 'object'
      ? row.receipt_snapshot : undefined,
  });
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
      lineId: x.line_id || undefined, barcodeCode: x.barcode_code || undefined,
      physicalAttrs: x.physical_attrs || undefined,
      productId: x.product_id || x.productId || undefined,
      sku: x.sku, nombre: x.nombre, talla: x.talla, qty: x.qty,
      ornamento: x.ornamento || undefined,
      ornColors: Array.isArray(x.orn_colors) ? x.orn_colors : undefined,
      precio: Number(x.precio) || 0,
      listPrice: x.list_price == null ? undefined : Number(x.list_price),
      effectivePrice: x.effective_price == null ? undefined : Number(x.effective_price),
      discountSnapshot: x.discount_snapshot || undefined,
      precioBase: x.precio_base == null ? x.precioBase : Number(x.precio_base),
      precioOrig: x.precio_original == null ? x.precioOrig : Number(x.precio_original),
      descuentoAdicional: x.descuento_adicional == null
        ? x.descuentoAdicional : Number(x.descuento_adicional),
      promos: Array.isArray(x.promos) ? x.promos : undefined,
    };
  }
  function pushSale(sale, effects) {
    effects = effects || {};
    const operationId = sale._operationId || newRequestId();
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
    if (Array.isArray(sale.comisionesRevertidas)) header.comisiones_revertidas = sale.comisionesRevertidas;
    if (sale.descuentoAdicional != null) header.descuento_adicional = Number(sale.descuentoAdicional) || 0;
    if (sale.totalAntesDescuentoAdicional != null) header.total_antes_descuento_adicional = Number(sale.totalAntesDescuentoAdicional) || 0;
    if (Array.isArray(sale.descuentosAdicionales)) header.descuentos_adicionales = sale.descuentosAdicionales;
    // H-34: el plazo congelado sólo se envía si la venta lo tiene, igual que el
    // resto de campos opcionales: una instalación sin la migración no lo manda.
    if (sale.returnLimitDays != null) header.return_limit_days = Number(sale.returnLimitDays) || 0;
    if (sale.returnExpiresAt != null) header.return_expires_at = sale.returnExpiresAt;
    if (sale.receiptSnapshot && typeof sale.receiptSnapshot === 'object') header.receipt_snapshot = sale.receiptSnapshot;
    // valor_regalado (cortesías) solo se envía si aplica, así no rompe instalaciones sin la migración pos_009.
    if (Number(sale.valorRegalado) > 0) header.valor_regalado = Number(sale.valorRegalado);
    const items = (sale.lineas || []).map(l => {
      const productId = resolveLineProductId(l, `sale:${sale.folio}`);
      const row = { folio: sale.folio, product_id: productId, sku: l.sku, nombre: l.nombre, talla: l.talla, qty: l.qty, precio: Number(l.precio) || 0 };
      if (l.ornamento != null) row.ornamento = l.ornamento;
      if (Array.isArray(l.ornColors)) row.orn_colors = l.ornColors.slice();
      if (l.precioBase != null) row.precio_base = Number(l.precioBase) || 0;
      if (l.precioOrig != null) row.precio_original = Number(l.precioOrig) || 0;
      // H-32: evidencia del descuento. Condicional, como los precios: una instalación sin la
      // migración 034 no envía el campo y sigue funcionando igual.
      if (Array.isArray(l.promos)) row.promos = l.promos;
      if (l.descuentoAdicional != null) row.descuento_adicional = Number(l.descuentoAdicional) || 0;
      if (l.lineId) row.line_id = l.lineId;
      if (l.barcodeCode) row.barcode_code = l.barcodeCode;
      if (l.physicalAttrs) row.physical_attrs = l.physicalAttrs;
      if (l.listPrice != null) row.list_price = Number(l.listPrice) || 0;
      if (l.effectivePrice != null) row.effective_price = Number(l.effectivePrice) || 0;
      if (l.discountSnapshot) row.discount_snapshot = l.discountSnapshot;
      return row;
    });
    const preparedMoves = effects.movements || (sale._stockRequired === true && sale._stockReserved !== true
      ? (sale.lineas || []).map(line => ({ tipo: 'Venta', ref: sale.folio, fecha: sale.fecha,
        producto: line.nombre, productId: line.productId, sku: line.sku, talla: line.talla, cant: -Number(line.qty) })) : []);
    const moves = preparedMoves
      .filter(m => m.tipo === 'Venta' && m.ref === sale.folio)
      .map(m => ({ fecha: String(m.fecha || '').replace(' ', 'T'), tipo: 'Venta', producto: m.producto, product_id: m.productId || m.product_id || null, sku: m.sku, talla: m.talla || null, cant: Number(m.cant) || 0, ref: sale.folio }));
    const stockLines = items
      .filter(row => row.product_id && Number(row.qty) > 0)
      .map(row => ({ product_id: row.product_id, talla: row.talla, qty: Number(row.qty) }));
    const payments = (effects.payments || [])
      .map(MAP.payments.toRow);
    return execute({
      type: 'sale', folio: sale.folio, header, items, moves, payments,
      quoteContext: effects.quoteContext,
      operationId, requestId: effects.commitId || operationId,
      ...(effects.mode ? { mode: effects.mode } : {}),
      expectedProducts: (effects.productVersions || []).map(row => ({ id: row.id, version: row.baseVersion })),
      ...(effects.expectedSale ? { expectedSale: {
        estado: effects.expectedSale.estado, anticipo: effects.expectedSale.anticipo ?? null,
        saldo: effects.expectedSale.saldo ?? null, pago_efectivo: effects.expectedSale.pagoEfectivo ?? null,
        pago_otro: effects.expectedSale.pagoOtro ?? null, operation_id: effects.expectedSale.operationId ?? null,
      } } : {}),
      reserveStock: sale._stockRequired === true && sale._stockReserved !== true,
      stockLines,
      clientEffect: effects.clientEffect || null,
      sellerEffects: effects.sellerEffects || [],
    });
  }
  function pushReturn(ret, effects) {
    effects = effects || {};
    const header = { id: ret.id, folio: ret.folio, fecha: ret.fecha || null, cliente: ret.cliente, vendedores: ret.vendedores || [], metodo: moneyWireMethod(ret.metodo || null, ret.components), total: Number(ret.total) || 0, notas: ret.notas || null, comisiones: Array.isArray(ret.comisiones) ? ret.comisiones : [], prior_sale_state: ret.priorSaleState || null };
    const items = (ret.lineas || []).map(l => ({ return_id: ret.id, line_id: l.lineId || null,
      source_sale_line_id: l.sourceSaleLineId || null, product_id: l.productId || null,
      barcode_code: l.barcodeCode || null, physical_attrs: l.physicalAttrs || null,
      list_price: l.listPrice == null ? null : Number(l.listPrice) || 0,
      effective_price: l.effectivePrice == null ? null : Number(l.effectivePrice) || 0,
      discount_snapshot: l.discountSnapshot || null,
      sku: l.sku, nombre: l.nombre, talla: l.talla, qty: l.qty, motivo: l.motivo || null,
      precio: Number(l.precio) || 0, ornamento: l.ornamento || null,
      orn_colors: Array.isArray(l.ornColors) ? l.ornColors.slice() : null }));
    const moves = (ret.lineas || []).map(l => ({ return_id: ret.id, fecha: String(ret.fecha || '').replace(' ', 'T'), tipo: 'Devolución', producto: l.nombre, product_id: l.productId || null, sku: l.sku, talla: l.talla, cant: Number(l.qty) || 0, ref: ret.folio }));
    return execute({
      type: 'return', operationId: ret._operationId || ret.operationId, id: ret.id, folio: ret.folio, header, items, moves,
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
      line_id: l.lineId || null, source_sale_line_id: l.sourceSaleLineId || null,
      lado: l.lado, product_id: l.productId || null, barcode_code: l.barcodeCode || null,
      physical_attrs: l.physicalAttrs || null, sku: l.sku, nombre: l.nombre,
      list_price: l.listPrice == null ? null : Number(l.listPrice) || 0,
      effective_price: l.effectivePrice == null ? null : Number(l.effectivePrice) || 0,
      discount_snapshot: l.discountSnapshot || null,
      talla: l.talla, qty: Number(l.qty) || 0, motivo: l.motivo || null,
      condicion: l.condicion || null,
      ornamento: l.ornamento || null,
      orn_colors: Array.isArray(l.ornColors) ? l.ornColors.slice() : null,
    }));
    const moves = (exch.lineas || []).map(l => ({
      fecha: String(exch.fecha || '').replace(' ', 'T'),
      tipo: l.lado === 'devuelto' ? 'Cambio (entra)' : 'Cambio (sale)',
      producto: l.nombre, product_id: l.productId || null, sku: l.sku, talla: l.talla,
      cant: (l.lado === 'devuelto' ? 1 : -1) * (Number(l.qty) || 0), ref: exch.folio,
    }));
    return execute({
      type: 'exchange', operationId: exch._operationId || exch.operationId, id: exch.id, folio: exch.folio,
      expectedProducts: (effects.productVersions || []).map(row => ({ id: row.id, version: row.baseVersion })),
      quoteContext: effects.quoteContext,
      // `id` identifica esta entrada de cola; `key` identifica la intenciÃ³n
      // comercial y sobrevive timeout, replay, reconexiÃ³n y una cola nueva.
      key: exch._operationId || exch.operationId || exch.id,
      header, items, moves, payment: effects.payment ? MAP.payments.toRow(effects.payment) : null,
      seller_effects: effects.sellerEffects || [],
    });
  }
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
  function mappedSnapshot(raw) {
    if (Number(raw?.contractVersion) !== 1) throw error('ONLINE_CONTRACT_REQUIRED', 'No se pudo confirmar la información de BALAM.');
    if (!raw.commercialQuote || typeof raw.commercialQuote !== 'object' || !Number.isFinite(Date.parse(raw.serverTime))) {
      throw error('ONLINE_SNAPSHOT_INCOMPLETE', 'No se pudo confirmar la información de BALAM.');
    }
    if (typeof raw.commissionContext?.periodStart !== 'string' || !Array.isArray(raw.commissionContext.sellerBases)
        || raw.commissionContext.sellerBases.some(row => !row.sellerId || !Number.isFinite(Number(row.baseRaw)))) {
      throw error('ONLINE_SNAPSHOT_INCOMPLETE', 'No se pudo confirmar la información de BALAM.');
    }
    const next = { commissionContext: copy(raw.commissionContext) };
    for (const [kind, mapper] of Object.entries(MAP)) {
      if (!Array.isArray(raw[kind])) throw error('ONLINE_SNAPSHOT_INCOMPLETE', 'No se pudo confirmar la información de BALAM.');
      next[kind] = raw[kind].map(mapper.fromRow);
    }
    for (const key of ['lookup','settings','saleItems','returnItems','exchangeItems']) {
      if (!Array.isArray(raw[key])) throw error('ONLINE_SNAPSHOT_INCOMPLETE', 'No se pudo confirmar la información de BALAM.');
    }
    next.sales.forEach(sale => {
      sale.lineas = raw.saleItems.filter(line => line.folio === sale.folio).map(saleItemFromRow);
      sale.vendedor = next.sellers.find(row => row.id === sale.vendedores[0])?.nombre || '';
    });
    next.returns.forEach(doc => { doc.lineas = raw.returnItems.filter(row => row.return_id === doc.id)
      .map(row => ({ ...saleItemFromRow(row), sourceSaleLineId: row.source_sale_line_id || undefined, motivo: row.motivo || '' })); });
    next.exchanges.forEach(doc => { doc.lineas = raw.exchangeItems.filter(row => row.exchange_id === doc.id)
      .map(row => ({ ...saleItemFromRow(row), sourceSaleLineId: row.source_sale_line_id || undefined,
        lado: row.lado, condicion: row.condicion || undefined, motivo: row.motivo || undefined,
        valorUnitario: Number(row.valor_unitario) || 0, valorTotal: Number(row.valor_total) || 0 })); });
    return next;
  }
  const LEGACY_LOCAL = /^(?:balam_pos_(?:products_v2|sellers_v1|clients_v1|sales_v1|moves_v1|promos_v1|liq_v1|returns_v1|payments_v1|exchanges_v1|loans_v1|loans_premigracion_v1|commission_adjustments_v1|periodo_v1|folio_v[12]|sale_commit_journal_v1|sale_commit_journal_v2:.*|layaway_product_locks_v1)|balam_sync_.*|balam_auth_access_v2|balam_device_recovery_v1|balam_reset_seen|balam_point_zero_ticket_v1|balam_selective_cleanup_.*|balam_config_v\d+|balam_cfg_v\d+|balam_demo)$/;
  function legacyDatabase(mode, action) {
    return new Promise((resolve, reject) => {
      let db = null, tx = null, settled = false, absent = false;
      const finish = (cause, value) => {
        if (settled) return; settled = true; clearTimeout(deadline);
        if (cause && tx) { try { tx.abort(); } catch (_) {} }
        db?.close(); cause ? reject(cause) : resolve(value);
      };
      const deadline = setTimeout(() => finish(error('LEGACY_STORAGE_TIMEOUT', STARTUP_FAILED)), 10000);
      let request;
      try { request = window.indexedDB.open('balam_sync'); }
      catch (_) { finish(error('LEGACY_STORAGE_UNAVAILABLE', STARTUP_FAILED)); return; }
      request.onblocked = () => finish(error('LEGACY_STORAGE_BLOCKED', STARTUP_FAILED));
      request.onupgradeneeded = () => { absent = true; request.transaction.abort(); };
      request.onerror = () => absent ? finish(null, []) : finish(error('LEGACY_STORAGE_READ_FAILED', STARTUP_FAILED));
      request.onsuccess = () => {
        db = request.result;
        if (settled) { db.close(); return; }
        if (!db.objectStoreNames.contains('durable_queue')) { finish(null, []); return; }
        try {
          tx = db.transaction('durable_queue', mode);
          const result = action(tx.objectStore('durable_queue'));
          tx.oncomplete = () => finish(null, result);
          tx.onerror = tx.onabort = () => finish(error('LEGACY_STORAGE_TRANSACTION_FAILED', STARTUP_FAILED));
        } catch (_) { finish(error('LEGACY_STORAGE_TRANSACTION_FAILED', STARTUP_FAILED)); }
      };
    });
  }
  async function legacyIndexedDB() {
    if (!window.indexedDB) return [];
    return legacyDatabase('readonly', store => {
      const rows = [], cursor = store.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result; if (!row) return;
        rows.push({ sourceKey: 'indexedDB:balam_sync/durable_queue/' + String(row.key),
          original: JSON.stringify(row.value), idbKey: row.key });
        row.continue();
      };
      return rows;
    });
  }
  async function removeArchivedIndexedDB(entry) {
    return legacyDatabase('readwrite', store => {
      const current = store.get(entry.idbKey);
      current.onsuccess = () => { if (JSON.stringify(current.result) === entry.original) store.delete(entry.idbKey); };
    });
  }
  async function legacyCommercialCaches() {
    if (!window.caches) return [];
    const entries = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('balam-')) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        if (url.origin !== SUPABASE_URL || !/^\/(?:rest|functions|graphql)\/v1(?:\/|$)/.test(url.pathname)) continue;
        const response = await cache.match(request);
        if (!response || response.type === 'opaque') throw error('LEGACY_EVIDENCE_NOT_ARCHIVED', 'No se pudo leer la evidencia anterior.');
        entries.push({ sourceKey: 'cacheStorage:' + name + '/' + request.url,
          original: await response.text(), cacheName: name, cacheRequest: request });
      }
    }
    return entries;
  }
  async function inventoryLegacy() {
    const entries = [];
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (LEGACY_LOCAL.test(key) || ['balam_purge_seen','balam_purge_ticket'].includes(key)) {
        entries.push({ sourceKey: 'localStorage:' + key, localKey: key, original: localStorage.getItem(key) });
      }
    }
    entries.push(...await legacyIndexedDB());
    entries.push(...await legacyCommercialCaches());
    return entries;
  }
  async function archiveLegacy() {
    // Única lectura del almacenamiento comercial antiguo: traslado de evidencia sin ejecutar intenciones.
    const entries = await inventoryLegacy();
    if (entries.length) {
      adoptionComplete = false; ready = false; connection = 'checking';
      adoption = { ...adoption, state: 'working', stage: 'inventory', remainingLegacy: entries.length }; emit();
    }
    for (const entry of entries) {
      entry.hash = await hash(entry.original);
      const result = await readRpc('archive_online_legacy', {
        p_device_id: window.CORE.getDeviceId(),
        p_entries: [{ sourceKey: entry.sourceKey, hash: entry.hash, original: entry.original,
          kind: /queue|quarantine|journal|locks|ticket|recovery/.test(entry.sourceKey) ? 'operation' : 'cache' }],
      });
      const ack = (result?.entries || result?.acknowledged || []).find(row => row.sourceKey === entry.sourceKey && row.hash === entry.hash && row.archived === true);
      if (!result?.ok || !ack) throw error('LEGACY_EVIDENCE_NOT_ARCHIVED', 'No se pudo conservar la evidencia anterior. Vuelve a conectar BALAM.');
      if ((ack.classification || ack.status) === 'needs_review') legacyReviewCount++;
      if (entry.localKey) {
        if (localStorage.getItem(entry.localKey) === entry.original) localStorage.removeItem(entry.localKey);
      } else if (entry.cacheName) {
        const cache = await caches.open(entry.cacheName), current = await cache.match(entry.cacheRequest);
        if (current && await current.text() === entry.original) await cache.delete(entry.cacheRequest);
      } else await removeArchivedIndexedDB(entry);
      adoption.archivedCount++;
    }
    // Una pestaña vieja pudo modificar una fuente durante el archivo. Nunca certificarla ni borrar su nueva versión.
    adoption.remainingLegacy = (await inventoryLegacy()).length;
    if (adoption.remainingLegacy) throw error('LEGACY_SOURCE_CHANGED', STARTUP_FAILED);
  }
  async function refresh(options = {}) {
    if (!enabled) throw error('AUTH_REQUIRED', 'Inicia sesión para continuar.');
    if (writeInFlight && !options.internal) {
      refreshAgain = true;
      throw error('ONLINE_RESULT_UNKNOWN', CONFIRMING);
    }
    if (refreshPromise) { if (!options.internal) refreshAgain = true; return refreshPromise; }
    const seq = sessionSeq;
    refreshPromise = (async () => {
      try {
        const userId = await currentUserId();
        const resolved = writeInFlight ? [] : await resolveOutstanding(userId);
        const requestedRevision = options.internal || options.force || resolved.length ? null : snapshotRevision;
        const raw = await readRpc('online_snapshot_if_changed', { p_revision: requestedRevision });
        if (seq !== sessionSeq || !enabled) throw error('SESSION_CHANGED', 'La sesión cambió.');
        if (!raw || typeof raw.snapshotRevision !== 'string' || !raw.snapshotRevision
          || !Number.isFinite(Date.parse(raw.serverTime))) throw error('ONLINE_SNAPSHOT_INVALID', STARTUP_FAILED);
        if (raw.unchanged === true) {
          if (!requestedRevision || requestedRevision !== snapshotRevision || raw.snapshotRevision !== snapshotRevision
            || !quoteContext || !serverClock) throw error('ONLINE_REVISION_MISMATCH', STARTUP_FAILED);
          // The server checked the exact confirmed snapshot; no DATA/CONFIG event.
          serverClock = { time: Date.parse(raw.serverTime), observed: performance.now() };
          ready = adoptionComplete; connection = ready ? 'online' : 'checking'; lastSuccess = raw.serverTime; failure = null;
          emit();
          return { ok: true, unchanged: true, message: 'Todo actualizado', status: syncStatus() };
        }
        if (raw.unchanged !== false) throw error('ONLINE_SNAPSHOT_INVALID', STARTUP_FAILED);
        const next = mappedSnapshot(raw);
        window.DATA.validateOnlineSnapshot(next);
        if (seq !== sessionSeq || !enabled) throw error('SESSION_CHANGED', 'La sesión cambió.');
        // Todo se valida antes de aplicar; eventos React ocurren después de la sustitución completa.
        window.CONFIG.load(toConfigState(raw.lookup, raw.settings));
        window.DATA.replaceFromOnline(next);
        snapshotRevision = raw.snapshotRevision;
        configLookup = copy(raw.lookup);
        configRemoteVersion = Number(raw.configVersion) || 0;
        quoteContext = copy(raw.commercialQuote);
        serverClock = { time: Date.parse(raw.serverTime), observed: performance.now() };
        legacyReviewCount = Number(raw.legacyReviewCount) || 0;
        for (const ref of resolved) localStorage.removeItem(ref.key);
        ready = adoptionComplete; connection = ready ? 'online' : 'checking'; lastSuccess = raw.serverTime; failure = null;
        emit();
        for (const ref of resolved) deliverResolved(ref);
        return { ok: true, message: 'Todo actualizado', status: syncStatus() };
      } catch (cause) {
        markUnavailable(cause);
        throw cause;
      }
    })().finally(() => {
      refreshPromise = null; emit();
      if (refreshAgain && enabled && !writeInFlight) {
        refreshAgain = false; queueMicrotask(() => refresh().catch(() => {}));
      }
    });
    return refreshPromise;
  }
  async function heartbeatDevice() {
    if (!enabled) return false;
    const result = await readRpc('online_presence', { p_device_id: window.CORE.getDeviceId(), p_client_build: BUILD });
    if (result === false || result?.ok === false) {
      ready = false; connection = 'error'; failure = error('DEVICE_RETIRED', 'Este equipo está retirado. Un administrador puede reactivarlo en Equipos.'); emit();
      throw failure;
    }
    if (result !== true && result?.ok !== true) throw error('DEVICE_REPORT_UNCONFIRMED', 'No se pudo confirmar el equipo.');
    return true;
  }
  function startLifecycle() {
    if (lifecycleStarted) return; lifecycleStarted = true;
    const reconnect = () => { if (enabled && !writeInFlight) init().catch(() => {}); };
    window.addEventListener('offline', () => markUnavailable());
    window.addEventListener('online', reconnect);
    window.addEventListener('focus', reconnect);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reconnect(); });
    window.addEventListener('storage', event => {
      if (event.newValue && (LEGACY_LOCAL.test(event.key) || ['balam_purge_seen','balam_purge_ticket'].includes(event.key))) {
        legacyGeneration++; adoptionComplete = false; ready = false; connection = 'checking'; failure = null;
        adoptionStage('inventory'); reconnect();
      } else if (event.key?.startsWith(RECEIPT_PREFIX) && event.newValue) {
        ready = false; failure = error('ONLINE_RESULT_UNKNOWN', CONFIRMING); emit();
      } else if (event.key?.startsWith(RECEIPT_PREFIX)) reconnect();
    });
    // H166: 15s safety check is a conditional authoritative read, never a
    // periodic full catalog download. Focus/reconnect retain permission checks.
    setInterval(reconnect, 15000);
  }
  let initializing = null;
  async function init() {
    if (initializing) return initializing;
    initializing = (async () => {
      const seq = sessionSeq;
      try { window.CORE.getDeviceId(); }
      catch (cause) { markUnavailable(cause); throw cause; }
      if (!(await hasSession())) throw error('AUTH_REQUIRED', 'Inicia sesión para continuar.');
      enabled = true; startLifecycle();
      const adopting = !adoptionComplete || !ready;
      if (adopting) {
        adoptionComplete = false; ready = false; connection = 'checking'; failure = null;
        adoption = { revision: 1, state: 'working', stage: 'presence', remainingLegacy: 0, archivedCount: adoption.archivedCount };
        emit();
      }
      try {
        await heartbeatDevice();
        if (adopting) await reportAdoption('working');
        if (!adoptionComplete) adoptionStage('inventory');
        await archiveLegacy();
        if (!adoptionComplete) adoptionStage('permissions');
        if (window.AUTH?.refreshPermissions && !(await window.AUTH.refreshPermissions())) {
          const accessError = window.AUTH.accessError?.();
          const cause = error(accessError?.transport ? 'ONLINE_UNAVAILABLE' : accessError?.code || 'AUTH_REQUIRED',
            accessError?.transport ? OFFLINE : 'No se pudo confirmar el acceso de tu usuario.');
          cause.remoteResponse = accessError ? !accessError.transport : false;
          throw cause;
        }
        if (!adoptionComplete) adoptionStage('snapshot');
        const result = await refresh();
        if (seq !== sessionSeq || !enabled) throw error('SESSION_CHANGED', 'La sesión cambió.');
        if (!adoptionComplete) {
          adoption.remainingLegacy = (await inventoryLegacy()).length;
          if (adoption.remainingLegacy) throw error('LEGACY_SOURCE_CHANGED', STARTUP_FAILED);
          const generation = legacyGeneration;
          const completed = await reportAdoption('ready');
          if (seq !== sessionSeq || !enabled) throw error('SESSION_CHANGED', 'La sesión cambió.');
          if (generation !== legacyGeneration) throw error('LEGACY_SOURCE_CHANGED', STARTUP_FAILED);
          adoption = completed; adoptionComplete = true;
          ready = true; connection = 'online'; failure = null; emit();
        }
        if (!channel) {
          // Realtime is only an accelerator. Its failure cannot invalidate confirmed HTTP authority.
          try {
            channel = sb.channel('balam-online-' + window.CORE.getDeviceId())
              .on('postgres_changes', { event: 'UPDATE', schema: 'pos', table: 'online_snapshot_revision' }, () => {
                if (writeInFlight) { refreshAgain = true; return; }
                refresh().catch(() => {});
              }).subscribe();
          } catch (_) { channel = null; }
        }
        return { ...result, status: syncStatus() };
      } catch (cause) {
        if (seq === sessionSeq) {
          markUnavailable(cause);
          if (!adoptionComplete) {
            adoption = { ...adoption, state: 'failed', code: diagnosticCode(cause) }; emit();
            await reportAdoption('failed', cause).catch(() => {});
          }
        }
        throw cause;
      }
    })().finally(() => { initializing = null; });
    return initializing;
  }
  function clearMemory() {
    window.DATA?.replaceFromOnline({ ...Object.fromEntries(Object.keys(MAP).map(kind => [kind, []])),
      commissionContext: { periodStart: '', sellerBases: [] } });
    window.CONFIG?.clearRemote();
    quoteContext = null; serverClock = null; configLookup = []; snapshotRevision = null;
    ready = false; lastSuccess = null;
  }
  async function setSession(profile) {
    const next = window.AUTH?.hasSession() ? await currentUserId() : null;
    if (next === identity && enabled) return { ok: true, unchanged: true };
    sessionSeq++; identity = next; enabled = false;
    adoptionComplete = false;
    adoption = { revision: 1, state: 'working', stage: 'presence', remainingLegacy: 0, archivedCount: 0 };
    for (const waiter of resultWaiters.values()) waiter.reject(error('SESSION_CHANGED', 'La sesión cambió. Consulta la operación con su usuario.'));
    resultWaiters.clear();
    if (channel && sb) { sb.removeChannel(channel); channel = null; }
    clearMemory(); failure = null; connection = next ? 'checking' : 'offline'; emit();
    if (!next) return { ok: true, signedOut: true };
    const seq = sessionSeq;
    if (initializing) await initializing.catch(() => {});
    if (seq !== sessionSeq) return { ok: false, sessionChanged: true };
    return init();
  }
  function pushRows(kind, rows) {
    const mapper = MAP[kind];
    if (!mapper?.toRow && kind !== 'sellers') throw error('ONLINE_COMMAND_INVALID', 'Ese registro requiere su operación comercial específica.');
    if (!Array.isArray(rows) || !rows.length) throw error('ONLINE_COMMAND_EMPTY', 'No hay registros que guardar.');
    const ids = rows.map(row => String(row.id || ''));
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw error('ONLINE_COMMAND_INVALID', 'Cada registro debe tener una identidad única.');
    return execute({ type: kind === 'sellers' ? 'profileUpdate' : 'upsert', kind,
      table: mapper.table, conflict: mapper.conflict, rowIds: ids,
      rows: rows.map(kind === 'sellers' ? sellerProfileRow : mapper.toRow) });
  }
  function pushProductFamilyBatch(referenceFamilyId, rows) {
    if (!rows?.length || rows.some(row => row.referenceFamilyId !== referenceFamilyId || row.recordModel !== 'v2'))
      throw error('REFERENCE_FAMILY_SCOPE_MISMATCH', 'Las referencias no pertenecen a la misma familia.');
    return execute({ type: 'upsert', kind: 'products', table: 'products', conflict: 'id', familyBatch: true,
      referenceFamilyId, rowIds: rows.map(row => row.id), rows: rows.map(MAP.products.toRow) });
  }
  const pushClient = client => pushRows('clients', [client]);
  const pushConfig = state => execute({ type: 'config', state });
  function deleteRow(kind, id, baseVersion) {
    const mapper = MAP[kind];
    if (!mapper) throw error('ONLINE_COMMAND_INVALID', 'Registro no válido.');
    return execute({ type: mapper.localKey ? 'softDelete' : 'delete', kind, table: mapper.table,
      col: mapper.conflict, val: id, baseVersion: Number(baseVersion) || 0 });
  }
  const deleteProductScope = payload => execute({ type: 'productDeleteScope', kind: 'products', table: 'products',
    ...payload, rowIds: (payload.targets || []).map(row => row.id) });
  const settleCommission = args => execute({ type: 'commissionSettle', ...args });
  const closeCommissionPeriod = args => execute({ type: 'commissionClose', ...args });
  const applyCommissionAdjustment = args => execute({ type: 'commissionAdjustment', ...args });
  const pushLoanOperation = (action, loan, expectedVersion) => execute({ type: 'loanOperation', action, loan, expectedVersion });
  const commitReferenceReclassification = args => execute({ type: 'referenceReclassification', ...args });
  async function allocateFolio(args) {
    const seq = sessionSeq;
    const digest = await hash('folio:' + args.operationId);
    if (seq !== sessionSeq) throw error('SESSION_CHANGED', 'La sesión cambió. Consulta la operación con su usuario.');
    const requestId = digest.slice(0,8) + '-' + digest.slice(8,12) + '-5' + digest.slice(13,16) + '-8' + digest.slice(17,20) + '-' + digest.slice(20,32);
    return execute({ type: 'folio', requestId, prefix: args.prefix, businessDate: args.date, documentKind: args.kind, floor: 0 });
  }
  function settleLayaway(draft, effects = {}) {
    const sale = draft.sale || draft, payment = draft.payment || effects.payment;
    return execute({ type: 'sale', mode: 'layaway_liquidation', folio: draft.folio || sale.folio,
      operationId: draft.commitId || effects.commitId || newRequestId(), saleOperationId: draft.operationId || sale._operationId,
      payment: MAP.payments.toRow(payment), sellerEffects: effects.sellerEffects || [],
      itemIdentities: (sale.lineas || []).map(line => ({ sale_item_id: line._saleItemId,
        product_id: line.productId, sku: line.sku, talla: line.talla })),
      commissionSnapshot: { amount: Number(sale.comision) || 0, base: sale.comisionBase || 'neto', rows: sale.comisiones || [] } });
  }
  const clearInventory = args => execute({ type: 'clearInventory', ...args });
  function commitSizeMigration(args) {
    return execute({ type: 'sizeMigration', commands: [wireConfig({ type: 'config', state: args.config }),
      ...(args.products?.length ? [{ type: 'upsert', kind: 'products', rows: args.products.map(MAP.products.toRow) }] : []),
      ...(args.promotions?.length ? [{ type: 'upsert', kind: 'promotions', rows: args.promotions.map(MAP.promotions.toRow) }] : [])] });
  }
  async function fetchSaleByFolio(folio) {
    await refresh();
    const key = String(folio || '').trim().toUpperCase();
    return window.DATA.sales.find(row => String(row.folio).toUpperCase() === key)
      || window.DATA.sales.find(row => row.folioAliases?.some(alias => String(alias).toUpperCase() === key)) || null;
  }
  const physicalCardAvailable = folio => readRpc('physical_card_available', { p_folio: String(folio || '').trim() });
  async function claimPhysicalCard(folio, claimToken) {
    const response = await execute({ type: 'physicalCardClaim', folio, claimToken });
    return response.result === true;
  }
  async function syncFleetStatus() {
    const { data, error: cause } = await (await ensureClient()).from('sync_devices').select('*').order('last_seen_at', { ascending: false });
    if (cause) throw cause;
    const installations = (data || []).map(row => ({ ...row,
      connection: Date.now() - Date.parse(row.last_seen_at) <= 120000 ? 'online' : 'disconnected' }));
    // status es la autoridad de retiro; metadata conserva fechas históricas de reactivaciones.
    const retired = row => row.status === 'revoked';
    const devices = installations.filter(row => !retired(row)), history = installations.filter(retired);
    return { devices, history, activity: [], current: devices.filter(row => row.connection === 'online').length,
      disconnected: devices.filter(row => row.connection !== 'online').length, attention: 0, stale: 0 };
  }
  async function updateSyncDevice(deviceId, displayName, deviceType) {
    const response = await execute({ type: 'deviceUpdate', deviceId, displayName, deviceType });
    window.dispatchEvent(new CustomEvent('syncfleetchange')); return response.result;
  }
  async function setSyncDeviceRetired(deviceId, retired, note) {
    const response = await execute({ type: 'deviceRetire', deviceId, retired, note });
    window.dispatchEvent(new CustomEvent('syncfleetchange')); return response.result;
  }
  async function pointZeroPreview() {
    await refresh(); const preview = await readRpc('point_zero_preview');
    return { ...preview, client_ready: ready, client_status: syncStatus(), local_activity: writeInFlight,
      local_locks: false, ready: !!(preview?.ok && preview.system_mode === 'preproduction' && !preview.active_operation && ready && !writeInFlight) };
  }
  async function createPointZeroBackup(approvedPreview) {
    const current = await pointZeroPreview();
    if (!current.ready || current.preview_token !== approvedPreview?.preview_token) throw error('POINT_ZERO_PREVIEW_CHANGED', 'Actualiza la revisión antes de continuar.');
    const response = await execute({ type: 'pointZeroBackup', previewToken: current.preview_token }); return response.result;
  }
  async function executePointZero(opts) {
    if (opts.confirmation !== 'PUNTO CERO' || !opts.backupId || !opts.previewToken) throw error('POINT_ZERO_CONFIRMATION_REQUIRED', 'Falta la confirmación y el respaldo.');
    const response = await execute({ type: 'pointZero', ...opts }); return { ...response.result, local: { ok: true } };
  }
  const pointZeroReceipt = operationId => readRpc('point_zero_receipt', { p_operation_id: operationId });
  async function previewTestDataCleanup(preset, selection) {
    await refresh();
    const preview = await readRpc('preview_test_data_cleanup', { p_preset: preset || 'operations', p_selection: selection || {}, p_client_protocol: 6 });
    return { ...preview, client_ready: ready, client_status: syncStatus(), ready: !!(preview?.ok && preview.executable && ready && !writeInFlight) };
  }
  async function createTestDataCleanupBackup(approvedPreview) {
    const current = await previewTestDataCleanup(approvedPreview?.preset_requested, approvedPreview?.selection_requested);
    if (!current.ready || current.plan_hash !== approvedPreview?.plan_hash) throw error('CLEANUP_PREVIEW_CHANGED', 'Actualiza la revisión antes de continuar.');
    const response = await execute({ type: 'cleanupBackup', preset: current.preset_requested, selection: current.selection_requested, planHash: current.plan_hash });
    return response.result;
  }
  async function executeTestDataCleanup(opts) {
    if (opts.confirmation !== 'LIMPIAR OPERACIONES' || !opts.backupId || !opts.preview) throw error('CLEANUP_CONFIRMATION_REQUIRED', 'Falta la confirmación y el respaldo.');
    const response = await execute({ type: 'cleanup', operationId: opts.cleanupId,
      preset: opts.preview.preset_requested, selection: opts.preview.selection_requested, planHash: opts.preview.plan_hash,
      backupId: opts.backupId, confirmation: opts.confirmation });
    return { ...response.result, local: { ok: true }, remoteCommitted: true };
  }
  const testDataCleanupReceipt = cleanupId => readRpc('test_data_cleanup_receipt', { p_cleanup_id: cleanupId });
  function downloadDocument(document, kind, id) {
    const body = JSON.stringify(document, null, 2), url = URL.createObjectURL(new Blob([body], { type: 'application/json;charset=utf-8' }));
    const anchor = window.document.createElement('a'); anchor.href = url;
    anchor.download = `balam-${kind}-${id || Date.now()}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { bytes: new TextEncoder().encode(body).length, file: anchor.download };
  }
  async function uploadImage(bucket, path, blob, contentType) {
    assertBusinessReady();
    const seq = sessionSeq;
    const c = await ensureClient();
    const probe = await readRpc('online_connectivity');
    if (probe !== true && probe?.ok !== true) throw error('ONLINE_UNAVAILABLE', OFFLINE);
    const { error: cause } = await c.storage.from(bucket).upload(path, blob, { upsert: true, contentType });
    if (cause) throw cause;
    if (seq !== sessionSeq) throw error('SESSION_CHANGED', 'La sesión cambió. Vuelve a seleccionar la imagen con tu usuario.');
    const url = c.storage.from(bucket).getPublicUrl(path)?.data?.publicUrl;
    if (!url) throw error('IMAGE_UPLOAD_UNCONFIRMED', 'No se pudo confirmar la imagen.');
    return url;
  }
  const uploadBarcode = (path, blob) => uploadImage('barcodes', path, blob, 'image/png');
  const uploadProductPhoto = (path, blob) => uploadImage('product-photos', path, blob, 'image/jpeg');
  async function accountRequest(payload) {
    const c = await ensureClient(), { data } = await c.auth.getSession();
    const response = await fetch(SUPABASE_URL + '/functions/v1/admin-users', {
      method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + data.session.access_token, 'x-balam-device-id': window.CORE.getDeviceId() },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (response.status === 202 && body.uncertain === true) return body;
    if (!response.ok || body.error || body.ok === false) {
      if (body.terminal === true) return { ok: false, error: {
        code: body.error?.code || body.code, message: body.error?.message || body.message } };
      throw error('ONLINE_RESULT_UNKNOWN', CONFIRMING);
    }
    return body;
  }
  async function callFunction(name, payload) {
    if (name !== 'admin-users') throw error('ONLINE_COMMAND_INVALID', 'Función no autorizada.');
    const response = await execute({ type: 'account', requestId: payload?.requestId, payload });
    return { ok: true, status: 200, body: response.result };
  }
  window.STORE = { assertBusinessReady, execute, init, refresh, setSession, getQuoteContext, serverNow,
    synchronizeNow: refresh, pull: refresh, pullDomain: refresh, invalidateDomain: () => refresh().catch(() => {}),
    pushConfig, pushRows, pushClient, pushProductFamilyBatch, pushSale, pushReturn, pushExchange, settleLayaway,
    deleteRow, deleteProductScope, settleCommission, closeCommissionPeriod, applyCommissionAdjustment,
    pushLoanOperation, commitReferenceReclassification, allocateFolio, clearInventory, commitSizeMigration,
    fetchSaleByFolio, physicalCardAvailable, claimPhysicalCard, syncStatus, syncFleetStatus, updateSyncDevice, setSyncDeviceRetired,
    pointZeroPreview, createPointZeroBackup, executePointZero, pointZeroReceipt, downloadPointZeroDocument: downloadDocument,
    previewTestDataCleanup, createTestDataCleanupBackup, executeTestDataCleanup, testDataCleanupReceipt, downloadTestDataCleanupDocument: downloadDocument,
    heartbeatDevice, ensureClient, getClient: ensureClient, hasSession, callFunction, uploadBarcode, uploadProductPhoto,
    get enabled() { return enabled; } };
  window.CORE.registerSyncGateway(window.STORE);
})();
