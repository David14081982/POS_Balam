// data.jsx — Datos de Balam Guayaberas. Exporta a window.DATA
// Persiste el catálogo de productos en localStorage (clave balam_pos_products_v2).
// Los CATÁLOGOS (colores, telas, mangas, categorías, cuellos, tallas) ya NO viven aquí:
// son administrables desde window.CONFIG (balam/config.jsx). Aquí solo se leen en vivo.
(function () {
  const C = window.CONFIG;

  // Lecturas en vivo desde CONFIG (un admin las edita sin tocar código).
  // Se exponen como getters en window.DATA para no romper a los consumidores
  // que usan D.CAT[code], Object.entries(D.TELA), D.SIZES_LETRA, etc.
  const COLOR_HEX = () => C.metaMap('color', 'hex');
  const COLOR_NAME = () => C.map('color');
  const TELA = () => C.map('fabric');
  const MANGA = () => C.map('sleeve');
  const CAT = () => C.map('category');
  const CUELLO = () => C.map('neck');

  // Dos escalas de talla. Cada prenda puede manejar AMBAS a la vez.
  const SIZES_LETRA = () => C.codes('size_letter');
  const SIZES_NUM = () => C.codes('size_number');

  // Construye el arreglo de stock (20 entradas: 10 letra + 10 número).
  // letras / nums: arreglos de hasta 10 cantidades (faltantes → 0).
  function mkStock(letras, nums) {
    letras = letras || []; nums = nums || [];
    const L = SIZES_LETRA().map((t, i) => ({ talla: t, escala: 'L', stock: Math.max(0, Math.round(letras[i] || 0)) }));
    const N = SIZES_NUM().map((t, i) => ({ talla: t, escala: 'N', stock: Math.max(0, Math.round(nums[i] || 0)) }));
    return L.concat(N);
  }
  // Devuelve arreglo vacío (todas las tallas en 0) — útil para producto nuevo
  function emptyStock() { return mkStock([], []); }

  // Catálogo de productos. VACÍO en producción: la tienda captura su inventario
  // desde Inventario → "Nuevo producto" (o importando un Excel con la plantilla).
  const seed = [];

  function sku(p) { return `${p.cat}-${p.manga}-${p.tela}-${p.color}-${String(p.modelo).padStart(3, '0')}`; }
  function totalStock(p) { return p.stock.reduce((a, v) => a + (v.stock || 0), 0); }

  // Fotos genéricas curadas (Unsplash). build-offline.mjs las embebe → 100% offline.
  // URLs completas literales para que el build las detecte.
  const IMG = {
    white: [
      'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=600&h=750&fit=crop',
      'https://images.unsplash.com/photo-1598033129183-c4f50c736f10?w=600&h=750&fit=crop',
      'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=600&h=750&fit=crop',
    ],
    blue: [
      'https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=600&h=750&fit=crop',
      'https://images.unsplash.com/photo-1620012253295-c15cc3e65df4?w=600&h=750&fit=crop',
    ],
    color: [
      'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=600&h=750&fit=crop',
      'https://images.unsplash.com/photo-1622470953794-aa9c70b0fb9d?w=600&h=750&fit=crop',
      'https://images.unsplash.com/photo-1517445312882-bc9910d016b7?w=600&h=750&fit=crop',
    ],
  };
  function pickImg(p) {
    const blueCols = ['AZ', 'AC', 'MR', 'MZ'];
    const whiteCols = ['BL', 'HU', 'AR', 'PL', 'BE'];
    const g = (whiteCols.includes(p.color) || p.cat === '10') ? IMG.white
      : blueCols.includes(p.color) ? IMG.blue : IMG.color;
    let n = 0; const s = String(p.id || p.modelo);
    for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) % 9973;
    return g[n % g.length];
  }

  // Recalcula campos derivados (sku, hex/nombre de color) y normaliza estructura.
  function hydrate(p) {
    p.modelo = String(p.modelo);
    if (!Array.isArray(p.ornColors)) p.ornColors = [];
    if (!p.cuello) p.cuello = 'NOR';
    // Normaliza stock al modelo de 20 entradas si viniera incompleto
    if (!Array.isArray(p.stock) || !p.stock.length || p.stock[0].escala === undefined) {
      const L = {}, N = {};
      (p.stock || []).forEach(v => { (v.escala === 'N' ? N : L)[v.talla] = v.stock; });
      p.stock = SIZES_LETRA().map(t => ({ talla: t, escala: 'L', stock: L[t] || 0 }))
        .concat(SIZES_NUM().map(t => ({ talla: t, escala: 'N', stock: N[t] || 0 })));
    }
    p.sku = sku(p);
    // Costo del producto (para validar margen en Descuentos). Si falta, estima 45% del precio.
    if (p.costo == null || p.costo === '') p.costo = Math.round((Number(p.precio) || 0) * 0.45);
    p.costo = Number(p.costo) || 0;
    p.colorHex = COLOR_HEX()[p.color] || '#8b9099';
    p.colorName = COLOR_NAME()[p.color] || p.color;
    if (!p.imagen) p.imagen = pickImg(p);
    return p;
  }

  // ---- Persistencia ----
  const LS_KEY = 'balam_pos_products_v2';
  let products;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.length) products = saved.map(hydrate);
    }
  } catch (e) { /* ignora storage corrupto */ }
  if (!products) products = seed.map(hydrate);

  function saveProducts() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(products)); } catch (e) { /* cuota llena */ }
    if (typeof syncUp === 'function') syncUp('products', products);
  }

  // Solo el administrador. Los vendedores se dan de alta en Configuración → Usuarios.
  const seedSellers = [
    { id: 's0', nombre: 'Administrador', iniciales: 'AD', color: '#131B2E', comisionPct: 0, ventasMes: 0, metaMes: 0, ventasNum: 0, comisionAcum: 0, bono: 'Sin bono', role: 'admin', email: 'admin@balam.com', passwordHash: null, active: true },
  ];

  // Solo el cliente genérico de mostrador (requerido por el POS). El resto se da de alta en Clientes.
  const seedClients = [
    { id: 'c7', nombre: 'Público en general', tel: '—', compras: 0, total: 0, ultima: '', talla: '', notas: 'Venta de mostrador sin registro.', generic: true },
  ];

  const seedSales = []; // sin ventas de ejemplo — se generan al cobrar en el POS

  const seedMovements = []; // sin movimientos de ejemplo — se generan al vender/ajustar inventario

  // Carga persistida o semilla (in-place para conservar la referencia del arreglo).
  function loadArr(key, seedArr) {
    const a = [];
    try {
      const raw = localStorage.getItem(key);
      const saved = raw ? JSON.parse(raw) : null;
      (Array.isArray(saved) && saved.length ? saved : seedArr).forEach(x => a.push(x));
    } catch (e) { seedArr.forEach(x => a.push(x)); }
    if (!a.length) seedArr.forEach(x => a.push(x));
    return a;
  }
  // Promociones/Descuentos (se aplican automáticamente en el POS).
  // scope: dimensión vacía = sin restricción (todas). tipo: 'pct' | 'fijo'.
  const seedPromos = []; // sin promociones de ejemplo — se crean en Descuentos

  const seedReturns = []; // sin devoluciones de ejemplo — se generan en la pantalla Devoluciones

  const LS_SELLERS = 'balam_pos_sellers_v1', LS_CLIENTS = 'balam_pos_clients_v1',
        LS_SALES = 'balam_pos_sales_v1', LS_MOVES = 'balam_pos_moves_v1', LS_FOLIO = 'balam_pos_folio_v1',
        LS_PROMOS = 'balam_pos_promos_v1', LS_LIQ = 'balam_pos_liq_v1', LS_PERIODO = 'balam_pos_periodo_v1',
        LS_RETURNS = 'balam_pos_returns_v1';
  const sellers = loadArr(LS_SELLERS, seedSellers);
  const clients = loadArr(LS_CLIENTS, seedClients);
  const sales = loadArr(LS_SALES, seedSales);
  const movements = loadArr(LS_MOVES, seedMovements);
  const promos = loadArr(LS_PROMOS, seedPromos);
  const liquidations = loadArr(LS_LIQ, []); // historial de pagos de comisión (corte/liquidación) — local
  const returns = loadArr(LS_RETURNS, seedReturns); // devoluciones (cabecera + renglones) — sincroniza a pos.returns
  let periodoInicio = '';
  try { periodoInicio = localStorage.getItem(LS_PERIODO) || ''; } catch (e) { /* sin storage */ }

  // Normaliza personas guardadas antes de unificar usuarios/vendedores.
  sellers.forEach(s => { if (!s.role) s.role = 'vendedor'; if (s.active === undefined) s.active = true; });
  if (!sellers.some(s => s.role === 'admin')) sellers.unshift(seedSellers[0]);

  let quotaWarned = false;
  const save = (key, arr) => {
    try { localStorage.setItem(key, JSON.stringify(arr)); }
    catch (e) {
      // Cuota de localStorage excedida (típico con muchas imágenes en base64): avisar una vez.
      if (!quotaWarned) {
        quotaWarned = true;
        if (window.UI && window.UI.toast) window.UI.toast('Almacenamiento local lleno. Reduce el peso de las imágenes de productos o inicia sesión para respaldar en la nube; algunos cambios podrían no guardarse en este dispositivo.', 'var(--danger)');
      }
    }
  };
  // Sube cambios a la nube si el seam está activo (no durante aplicación de datos remotos).
  let remoteApplying = false;
  function syncUp(kind, arr) {
    if (remoteApplying) return;
    if (window.STORE && window.STORE.pushRows) { try { window.STORE.pushRows(kind, arr); } catch (e) { /* offline */ } }
  }
  function saveSellers() { save(LS_SELLERS, sellers); syncUp('sellers', sellers); }
  function saveClients() { save(LS_CLIENTS, clients); syncUp('clients', clients); }
  function saveSales() { save(LS_SALES, sales); }       // ventas suben vía recordSale → STORE.pushSale
  function saveMovements() { save(LS_MOVES, movements); }
  function savePromos() { save(LS_PROMOS, promos); syncUp('promotions', promos); }
  function saveLiquidations() { save(LS_LIQ, liquidations); syncUp('liquidations', liquidations); } // historial — sincroniza a pos.liquidations
  function saveReturns() { save(LS_RETURNS, returns); }  // devoluciones suben vía recordReturn → STORE.pushReturn
  // Reemplaza un arreglo de dominio con datos de la nube (sin re-empujar).
  function applyRemote(kind, rows) {
    const M = { products: [products, saveProducts, hydrate], clients: [clients, saveClients], sellers: [sellers, saveSellers], sales: [sales, saveSales], movements: [movements, saveMovements], promotions: [promos, savePromos], returns: [returns, saveReturns], liquidations: [liquidations, saveLiquidations] };
    const m = M[kind]; if (!m) return;
    remoteApplying = true;
    try { m[0].length = 0; rows.forEach(r => m[0].push(m[2] ? m[2](r) : r)); m[1](); }
    finally { remoteApplying = false; }
    // La nube puede no tener admin aún (antes de pos_003). Garantiza uno local y súbelo.
    if (kind === 'sellers' && !sellers.some(s => s.role === 'admin')) {
      sellers.unshift(JSON.parse(JSON.stringify(seedSellers[0])));
      saveSellers();
    }
  }

  // ---- Motor de venta ----
  function now() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  // Folio consecutivo persistente. Arranca del máximo existente (o 1042).
  function nextFolio() {
    const prefix = (window.CONFIG && window.CONFIG.get('folio.prefix')) || 'BG-';
    let seq;
    try { seq = parseInt(localStorage.getItem(LS_FOLIO), 10); } catch (e) { seq = NaN; }
    if (!seq || isNaN(seq)) {
      seq = sales.reduce((m, s) => { const n = parseInt(String(s.folio).replace(/\D/g, ''), 10); return n > m ? n : m; }, 0);
    }
    seq += 1;
    save(LS_FOLIO, seq);
    return prefix + seq;
  }
  // Existencias disponibles de una talla en un producto.
  function stockOf(p, talla) { const e = (p.stock || []).find(v => v.talla === talla); return e ? e.stock : 0; }

  // Registra una venta: descuenta stock, mueve inventario, actualiza cliente y vendedores.
  // ticket: [{ p, talla, qty }], sellerIds: [id], client: obj, metodo, estado, total, itemCount.
  function recordSale({ ticket, sellerIds, client, metodo, estado, total, itemCount }) {
    const folio = nextFolio();
    const fecha = now();
    const cobrada = estado !== 'Apartado' && estado !== 'Cancelado';
    // 1) Descuento de stock + movimientos (solo si la venta se cobró/entregó)
    if (cobrada) {
      ticket.forEach(l => {
        const e = (l.p.stock || []).find(v => v.talla === l.talla);
        if (e) e.stock = Math.max(0, e.stock - l.qty);
        movements.unshift({ fecha, tipo: 'Venta', producto: l.p.nombre, sku: l.p.sku, cant: -l.qty, ref: folio });
      });
      saveProducts(); saveMovements();
    }
    // 2) Cliente (agregados) — solo registrados
    if (client && !client.generic) {
      const c = clients.find(x => x.id === client.id);
      if (c) { c.compras = (c.compras || 0) + 1; c.total = (c.total || 0) + total; c.ultima = fecha.slice(0, 10); saveClients(); }
    }
    // 3) Vendedores (reparto de venta y comisión).
    //    Base de comisión configurable (commission.base): 'neto' = sin IVA, 'bruto' = con IVA.
    //    `total` puede incluir o no IVA según tax.included → lo normalizamos a neto/bruto antes de aplicar el %.
    const ids = (sellerIds && sellerIds.length) ? sellerIds : [];
    let comisionVenta = 0;
    if (cobrada && ids.length) {
      const share = total / ids.length;
      const ivaPct = Number(window.CONFIG.get('tax.ivaPct')) || 0;
      const incl = !!window.CONFIG.get('tax.included');
      const neto = incl ? share / (1 + ivaPct / 100) : share;
      const bruto = incl ? share : share * (1 + ivaPct / 100);
      const base = window.CONFIG.get('commission.base') === 'bruto' ? bruto : neto;
      ids.forEach(id => {
        const s = sellers.find(x => x.id === id);
        if (s) {
          const c = base * (s.comisionPct || 0) / 100;
          comisionVenta += c;
          s.ventasMes = (s.ventasMes || 0) + share;
          s.ventasNum = (s.ventasNum || 0) + 1;
          s.comisionAcum = (s.comisionAcum || 0) + c;
        }
      });
      saveSellers();
    }
    comisionVenta = Math.round(comisionVenta * 100) / 100;
    // 4) Registro de venta (al frente = más reciente). Precio cobrado = con descuentos del POS.
    const primary = ids.map(id => (sellers.find(x => x.id === id) || {}).nombre).filter(Boolean);
    const unitOf = l => (window.PROMOS ? window.PROMOS.lineUnit(l.p, l.talla).unit : (Number(l.p.precio) || 0));
    const subtotalOrig = ticket.reduce((a, l) => a + (Number(l.p.precio) || 0) * l.qty, 0);
    const sale = {
      folio, fecha, cliente: client ? client.nombre : 'Público en general',
      vendedor: primary[0] || '—', vendedores: ids.slice(),
      items: itemCount, total, metodo, estado, descuento: Math.max(0, subtotalOrig - total),
      comision: comisionVenta, comisionBase: window.CONFIG.get('commission.base') || 'neto',
      lineas: ticket.map(l => ({ sku: l.p.sku, nombre: l.p.nombre, talla: l.talla, qty: l.qty, precio: unitOf(l), precioOrig: Number(l.p.precio) || 0 })),
    };
    sales.unshift(sale);
    saveSales();
    if (window.STORE && window.STORE.pushSale) { try { window.STORE.pushSale(sale); } catch (e) { /* offline */ } }
    return sale;
  }

  // Completa un apartado ya cobrado por completo: descuenta stock, acredita comisión/ventas al
  // vendedor atribuido (base neto/bruto vigente AHORA) y marca la venta como Pagado. No re-agrega
  // al cliente (los agregados se hicieron al crear el apartado). Idempotente: solo actúa si está Apartado.
  function completarApartado(folio) {
    const sale = sales.find(s => s.folio === folio);
    if (!sale || sale.estado !== 'Apartado') return null;
    const fecha2 = now();
    // 1) Stock + movimientos (no se hicieron al apartar)
    (sale.lineas || []).forEach(l => {
      const p = products.find(x => x.sku === l.sku);
      if (p) { const e = (p.stock || []).find(v => v.talla === l.talla); if (e) e.stock = Math.max(0, e.stock - l.qty); }
      movements.unshift({ fecha: fecha2, tipo: 'Venta', producto: l.nombre, sku: l.sku, cant: -l.qty, ref: folio });
    });
    saveProducts(); saveMovements();
    // 2) Comisión + ventas a los vendedores atribuidos
    const ids = sale.vendedores || [];
    let comisionVenta = 0;
    if (ids.length) {
      const share = (Number(sale.total) || 0) / ids.length;
      const ivaPct = Number(window.CONFIG.get('tax.ivaPct')) || 0;
      const incl = !!window.CONFIG.get('tax.included');
      const neto = incl ? share / (1 + ivaPct / 100) : share;
      const bruto = incl ? share : share * (1 + ivaPct / 100);
      const base = window.CONFIG.get('commission.base') === 'bruto' ? bruto : neto;
      ids.forEach(id => {
        const s = sellers.find(x => x.id === id);
        if (s) { const c = base * (s.comisionPct || 0) / 100; comisionVenta += c; s.ventasMes = (s.ventasMes || 0) + share; s.ventasNum = (s.ventasNum || 0) + 1; s.comisionAcum = (s.comisionAcum || 0) + c; }
      });
      saveSellers();
    }
    // 3) Marcar pagada y guardar la comisión real
    sale.estado = 'Pagado';
    sale.comision = Math.round(comisionVenta * 100) / 100;
    sale.comisionBase = window.CONFIG.get('commission.base') || 'neto';
    saveSales();
    if (window.STORE && window.STORE.pushSale) { try { window.STORE.pushSale(sale); } catch (e) { /* offline */ } }
    return sale;
  }

  // Registra un pago de comisión en el historial (local).
  function addLiquidacion(s, monto, tipo) {
    liquidations.unshift({ id: 'liq-' + Date.now() + '-' + s.id, fecha: now(), sellerId: s.id, seller: s.nombre, monto: Math.round((Number(monto) || 0) * 100) / 100, tipo });
    saveLiquidations();
  }
  // Liquida (paga) la comisión acumulada de un vendedor: la registra en el historial, la pone en
  // cero y persiste/sincroniza. Devuelve el monto liquidado, o null si el vendedor no existe.
  function liquidarComision(id) {
    const s = sellers.find(x => x.id === id);
    if (!s) return null;
    const monto = Number(s.comisionAcum) || 0;
    if (monto > 0) addLiquidacion(s, monto, 'liquidacion');
    s.comisionAcum = 0;
    saveSellers();
    return monto;
  }
  // Corte de mes: paga la comisión pendiente de TODOS los vendedores y reinicia los acumulados del
  // periodo (ventasMes, ventasNum, comisionAcum). metaMes NO se toca. Marca el inicio del nuevo periodo.
  function cerrarMes() {
    let total = 0, n = 0;
    sellers.forEach(s => {
      const pend = Number(s.comisionAcum) || 0;
      if (pend > 0) { addLiquidacion(s, pend, 'corte'); total += pend; n++; }
      s.comisionAcum = 0; s.ventasMes = 0; s.ventasNum = 0;
    });
    periodoInicio = now().slice(0, 10);
    try { localStorage.setItem(LS_PERIODO, periodoInicio); } catch (e) { /* sin storage */ }
    saveSellers();
    return { total: Math.round(total * 100) / 100, vendedores: n, periodoInicio };
  }
  function getPeriodoInicio() { return periodoInicio; }

  // ---- Devoluciones ----
  // Piezas de un renglón (sku+talla) de un folio ya devueltas en devoluciones previas.
  function returnedQty(folio, sku, talla) {
    let n = 0;
    returns.forEach(r => { if (r.folio === folio) (r.lineas || []).forEach(l => { if (l.sku === sku && l.talla === talla) n += Number(l.qty) || 0; }); });
    return n;
  }
  function returnsForFolio(folio) { return returns.filter(r => r.folio === folio); }
  // Solo se puede devolver una venta cobrada/entregada (no apartados, cancelados ni ya 100% devueltos).
  function isReturnable(sale) {
    return !!sale && ['Pagado', 'Entregado', 'Enviado', 'Devolución parcial'].includes(sale.estado);
  }

  // Registra una devolución: reingresa stock (+ movimiento 'Devolución'), revierte comisión/ventas
  // del vendedor en proporción a lo devuelto (si returns.reverseCommission), ajusta el total del
  // cliente, marca la venta original (Devuelto / Devolución parcial) y sincroniza.
  // arg: { folio, lineas:[{sku,nombre,talla,qty,motivo,precio}], metodo, notas }
  function recordReturn({ folio, lineas, metodo, notas }) {
    const sale = sales.find(s => s.folio === folio);
    if (!sale) return { ok: false, error: 'No se encontró la venta original' };
    if (!isReturnable(sale)) return { ok: false, error: 'Esa venta no admite devolución (apartado, cancelada o ya devuelta)' };
    const items = (lineas || []).filter(l => (Number(l.qty) || 0) > 0);
    if (!items.length) return { ok: false, error: 'Selecciona al menos un artículo y cantidad a devolver' };
    // Validar contra lo vendido menos lo ya devuelto
    for (const l of items) {
      const sold = (sale.lineas || []).filter(x => x.sku === l.sku && x.talla === l.talla).reduce((a, x) => a + (Number(x.qty) || 0), 0);
      const prev = returnedQty(folio, l.sku, l.talla);
      if ((Number(l.qty) || 0) > sold - prev) return { ok: false, error: `Cantidad inválida en ${l.nombre} (talla ${l.talla})` };
    }
    const fecha = now();
    const id = 'ret-' + Date.now();
    // 1) Reingreso de stock + movimiento 'Devolución' (cant positiva)
    items.forEach(l => {
      const p = products.find(x => x.sku === l.sku);
      if (p) { const e = (p.stock || []).find(v => v.talla === l.talla); if (e) e.stock = (Number(e.stock) || 0) + (Number(l.qty) || 0); }
      movements.unshift({ fecha, tipo: 'Devolución', producto: l.nombre, sku: l.sku, cant: Number(l.qty) || 0, ref: folio });
    });
    saveProducts(); saveMovements();
    // 2) Total reembolsado (precio cobrado por pieza, tomado del renglón de la venta)
    const refund = Math.round(items.reduce((a, l) => a + (Number(l.precio) || 0) * (Number(l.qty) || 0), 0) * 100) / 100;
    // 3) Reversión proporcional de comisión/ventas del vendedor (configurable en Configuración)
    const ids = sale.vendedores || [];
    if (window.CONFIG.get('returns.reverseCommission') && ids.length && refund > 0) {
      const share = refund / ids.length;
      const ivaPct = Number(window.CONFIG.get('tax.ivaPct')) || 0;
      const incl = !!window.CONFIG.get('tax.included');
      const neto = incl ? share / (1 + ivaPct / 100) : share;
      const bruto = incl ? share : share * (1 + ivaPct / 100);
      const base = (sale.comisionBase || window.CONFIG.get('commission.base')) === 'bruto' ? bruto : neto;
      ids.forEach(sid => {
        const s = sellers.find(x => x.id === sid);
        if (s) {
          const c = base * (s.comisionPct || 0) / 100;
          s.comisionAcum = Math.max(0, Math.round(((s.comisionAcum || 0) - c) * 100) / 100);
          s.ventasMes = Math.max(0, Math.round(((s.ventasMes || 0) - share) * 100) / 100);
        }
      });
      saveSellers();
    }
    // 4) Ajuste del total del cliente (best-effort por nombre; los apartados/genéricos no aplican)
    if (refund > 0 && sale.cliente) {
      const c = clients.find(x => !x.generic && x.nombre === sale.cliente);
      if (c) { c.total = Math.max(0, Math.round(((c.total || 0) - refund) * 100) / 100); saveClients(); }
    }
    // 5) Estado de la venta original: total vs parcial (cuenta lo previo + lo de esta devolución)
    const allReturned = (sale.lineas || []).every(x => {
      const extra = items.filter(l => l.sku === x.sku && l.talla === x.talla).reduce((a, l) => a + (Number(l.qty) || 0), 0);
      return returnedQty(folio, x.sku, x.talla) + extra >= (Number(x.qty) || 0);
    });
    sale.estado = allReturned ? 'Devuelto' : 'Devolución parcial';
    saveSales();
    if (window.STORE && window.STORE.pushSale) { try { window.STORE.pushSale(sale); } catch (e) { /* offline */ } }
    // 6) Registro de la devolución (al frente = más reciente) + sincronización
    const ret = {
      id, folio, fecha, cliente: sale.cliente, vendedores: ids.slice(),
      metodo: metodo || sale.metodo, total: refund, notas: notas || '',
      lineas: items.map(l => ({ sku: l.sku, nombre: l.nombre, talla: l.talla, qty: Number(l.qty) || 0, motivo: l.motivo || '', precio: Number(l.precio) || 0 })),
    };
    returns.unshift(ret);
    saveReturns();
    if (window.STORE && window.STORE.pushReturn) { try { window.STORE.pushReturn(ret); } catch (e) { /* offline */ } }
    return { ok: true, ret };
  }

  // ---- Usuarios (= personas en sellers; admin y/o vendedor) ----
  function addUser(u) {
    const s = {
      id: 'u-' + Date.now(), nombre: (u.nombre || '').trim(), iniciales: iniDe(u.nombre),
      color: u.color || '#64748b', comisionPct: Number(u.comisionPct) || 0,
      metaMes: Number(u.metaMes) || 0, ventasMes: 0, ventasNum: 0, comisionAcum: 0, bono: 'Sin bono',
      role: u.role || 'vendedor', email: (u.email || '').trim() || null,
      passwordHash: u.passwordHash || null, avatar: u.avatar || null, active: true,
    };
    sellers.push(s); saveSellers();
    return s;
  }
  function updateUser(id, patch) {
    const s = sellers.find(x => x.id === id);
    if (!s) return null;
    Object.assign(s, patch);
    if (patch.nombre) s.iniciales = iniDe(patch.nombre);
    saveSellers();
    return s;
  }
  function removeUser(id) {
    const s = sellers.find(x => x.id === id);
    if (!s) return { ok: false, error: 'No existe' };
    if (s.role === 'admin' && sellers.filter(x => x.role === 'admin').length <= 1) return { ok: false, error: 'Debe existir al menos un administrador' };
    const i = sellers.findIndex(x => x.id === id);
    sellers.splice(i, 1); saveSellers();
    if (window.STORE && window.STORE.deleteRow) { try { window.STORE.deleteRow('sellers', id); } catch (e) { /* offline */ } }
    return { ok: true };
  }
  function iniDe(nombre) { return String(nombre || '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }

  // ---- Promociones / Descuentos ----
  function addPromo(p) {
    const np = Object.assign({ id: 'promo-' + Date.now(), creado: Date.now(), pausado: false, scope: {} }, p);
    promos.unshift(np); savePromos();
    return np;
  }
  function updatePromo(id, patch) {
    const p = promos.find(x => x.id === id);
    if (!p) return null;
    Object.assign(p, patch); savePromos();
    return p;
  }
  function removePromo(id) {
    const i = promos.findIndex(x => x.id === id);
    if (i < 0) return;
    promos.splice(i, 1); savePromos();
    if (window.STORE && window.STORE.deleteRow) { try { window.STORE.deleteRow('promotions', id); } catch (e) { /* offline */ } }
  }
  function duplicatePromo(id) {
    const p = promos.find(x => x.id === id);
    if (!p) return null;
    const c = JSON.parse(JSON.stringify(p));
    c.id = 'promo-' + Date.now(); c.nombre = p.nombre + ' (copia)'; c.creado = Date.now(); c.pausado = true;
    promos.unshift(c); savePromos();
    return c;
  }

  // Restaura el catálogo original de fábrica
  function resetProducts() {
    products.length = 0;
    seed.map(hydrate).forEach(p => products.push(p));
    saveProducts();
    return products;
  }

  window.DATA = {
    products, sellers, clients, sales, movements, promos, liquidations, returns,
    sku, totalStock, hydrate, mkStock, emptyStock,
    saveProducts, saveSellers, saveClients, saveSales, saveMovements, savePromos, saveReturns,
    recordSale, nextFolio, stockOf, resetProducts, applyRemote, liquidarComision,
    completarApartado, cerrarMes, getPeriodoInicio,
    recordReturn, returnedQty, returnsForFolio, isReturnable,
    addUser, updateUser, removeUser,
    addPromo, updatePromo, removePromo, duplicatePromo,
  };
  // Catálogos retrocompatibles: D.CAT[code], Object.entries(D.TELA), D.SIZES_LETRA, …
  // ahora se resuelven EN VIVO desde CONFIG en cada acceso (reflejan ediciones del admin).
  Object.defineProperties(window.DATA, {
    CAT: { enumerable: true, get: CAT },
    TELA: { enumerable: true, get: TELA },
    MANGA: { enumerable: true, get: MANGA },
    CUELLO: { enumerable: true, get: CUELLO },
    COLOR_HEX: { enumerable: true, get: COLOR_HEX },
    COLOR_NAME: { enumerable: true, get: COLOR_NAME },
    SIZES_LETRA: { enumerable: true, get: SIZES_LETRA },
    SIZES_NUM: { enumerable: true, get: SIZES_NUM },
    SIZES: { enumerable: true, get: SIZES_LETRA }, // alias de compatibilidad
  });
})();
