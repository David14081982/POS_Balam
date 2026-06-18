// config.jsx — Motor de configuración del POS (catálogos + parámetros).
// Fuente única de verdad para todo lo que un administrador gestiona dinámicamente.
// Local-first: persiste en localStorage (balam_config_v1). El seam de nube (Supabase)
// se engancha aparte en store.jsx y empuja/jala estos mismos datos.
// Carga ANTES de data.jsx. Exporta window.CONFIG.
(function () {
  const LS_KEY = 'balam_config_v1';

  // ── Semilla de catálogos (valores actuales del sistema, ahora editables) ──────
  // Cada item: { code, label, active, meta? }. El orden del arreglo = orden visible.
  const SEED_CATALOGS = {
    category: [
      { code: '10', label: 'Guayabera Blanca' },
      { code: '21', label: 'Guayabera Color' },
      { code: '20', label: 'Camisa' },
      { code: '30', label: 'Pantalón' },
    ],
    fabric: [
      { code: 'ALG', label: 'Algodón' },
      { code: 'POL', label: 'Poliéster' },
      { code: 'MNT', label: 'Mantequilla' },
      { code: 'AJSP', label: 'Ajuar Especial' },
    ],
    sleeve: [
      { code: 'MC', label: 'Manga Corta' },
      { code: 'ML', label: 'Manga Larga' },
    ],
    neck: [
      { code: 'NOR', label: 'Normal / Clásico' },
      { code: 'MAO', label: 'Mao (chino)' },
      { code: 'ITA', label: 'Italiano' },
      { code: 'CER', label: 'Cerrado / Sport' },
    ],
    color: [
      { code: 'BL', label: 'Blanco', meta: { hex: '#f3f4f6' } },
      { code: 'BE', label: 'Beige', meta: { hex: '#d8c4a0' } },
      { code: 'AZ', label: 'Azul Cielo', meta: { hex: '#3b6fb0' } },
      { code: 'NE', label: 'Negro', meta: { hex: '#1c1f24' } },
      { code: 'VI', label: 'Vino', meta: { hex: '#6b2230' } },
      { code: 'HU', label: 'Hueso', meta: { hex: '#e8e2d4' } },
      { code: 'AC', label: 'Azul Acero', meta: { hex: '#4a6b8a' } },
      { code: 'MR', label: 'Azul Marino', meta: { hex: '#1e2a44' } },
      { code: 'AR', label: 'Arena', meta: { hex: '#c9b896' } },
      { code: 'GR', label: 'Gris', meta: { hex: '#8b9099' } },
      { code: 'CF', label: 'Café', meta: { hex: '#5a4334' } },
      { code: 'RS', label: 'Rosa', meta: { hex: '#d99bb0' } },
      { code: 'ML', label: 'Melón', meta: { hex: '#e8a06a' } },
      { code: 'KK', label: 'Kaky', meta: { hex: '#7a7250' } },
      { code: 'MZ', label: 'Mezclilla Azul', meta: { hex: '#3a4d6b' } },
      { code: 'OR', label: 'Oro', meta: { hex: '#caa83a' } },
      { code: 'PL', label: 'Plata', meta: { hex: '#c8ccd2' } },
      { code: 'RJ', label: 'Rojo', meta: { hex: '#b23b3b' } },
      { code: 'VE', label: 'Verde', meta: { hex: '#3d8c5a' } },
    ],
    ornament: [
      { code: 'Bordado Eléctrico', label: 'Bordado Eléctrico' },
      { code: 'Alforza', label: 'Alforza' },
      { code: '—', label: 'Sin ornamento' },
    ],
    size_letter: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'].map(s => ({ code: s, label: s })),
    size_number: ['34', '36', '38', '40', '42', '44', '46', '48', '50', '52'].map(s => ({ code: s, label: s })),
    payment_method: [
      { code: 'Efectivo', label: 'Efectivo', meta: { icon: 'cash' } },
      { code: 'Tarjeta', label: 'Tarjeta', meta: { icon: 'card' } },
      { code: 'Transferencia', label: 'Transferencia', meta: { icon: 'transfer' } },
      { code: 'Mixto', label: 'Mixto', meta: { icon: 'split' } },
      { code: 'Apartado', label: 'Apartado', meta: { icon: 'clock' } },
      { code: 'Cortesía', label: 'Cortesía', meta: { icon: 'tag' } },   // regalo/giveaway: total $0
    ],
    sale_status: [
      { code: 'Pagado', label: 'Pagado', meta: { tone: 'success' } },
      { code: 'Apartado', label: 'Apartado', meta: { tone: 'warning' } },
      { code: 'Pendiente', label: 'Pendiente', meta: { tone: 'info' } },
      { code: 'Cancelado', label: 'Cancelado', meta: { tone: 'danger' } },
      { code: 'Entregado', label: 'Entregado', meta: { tone: 'success' } },
      { code: 'Enviado', label: 'Enviado', meta: { tone: 'info' } },
      { code: 'En Ajuste', label: 'En Ajuste', meta: { tone: 'warning' } },
      { code: 'Devolución parcial', label: 'Devolución parcial', meta: { tone: 'warning' } },
      { code: 'Devuelto', label: 'Devuelto', meta: { tone: 'danger' } },
    ],
    movement_type: [
      { code: 'Entrada', label: 'Entrada' },
      { code: 'Venta', label: 'Venta' },
      { code: 'Devolución', label: 'Devolución' },
      { code: 'Ajuste', label: 'Ajuste' },
      { code: 'Transferencia', label: 'Transferencia' },
    ],
    // Motivos de devolución (editables por el admin en Configuración → Devoluciones).
    return_reason: [
      { code: 'Talla', label: 'Talla errónea' },
      { code: 'Defecto', label: 'Defecto de fábrica' },
      { code: 'Equivocado', label: 'Producto equivocado' },
      { code: 'Cambio', label: 'Cambio de opinión' },
      { code: 'Garantia', label: 'Garantía' },
    ],
    seller_role: [
      { code: 'senior', label: 'Heritage Senior Associate', meta: { minPct: 5 } },
      { code: 'consultant', label: 'Artisanal Consultant', meta: { minPct: 0 } },
    ],
    user_role: [
      { code: 'admin', label: 'Administrador', meta: { desc: 'Acceso total: inventario global, reportes financieros y control de usuarios.' } },
      { code: 'vendedor', label: 'Vendedor', meta: { desc: 'Ventas en piso, registro de clientes y stock disponible en tiempo real.' } },
      { code: 'gerente', label: 'Gerente', meta: { desc: 'Supervisión de tienda, aprobación de descuentos y gestión de personal local.' } },
    ],
    fit: [
      { code: 'Slim', label: 'Slim' },
      { code: 'Regular', label: 'Regular' },
      { code: 'Tailored', label: 'Tailored' },
    ],
    premium_fabric: [
      { code: 'Lino Artesanal', label: 'Lino Artesanal' },
      { code: 'Algodón Egipcio', label: 'Algodón Egipcio' },
      { code: 'Seda Italiana', label: 'Seda Italiana' },
    ],
    country_code: [
      { code: '+52', label: 'México (+52)' },
      { code: '+1', label: 'EE. UU. / Canadá (+1)' },
      { code: '+34', label: 'España (+34)' },
    ],
  };

  // ── Metadatos por catálogo (Fase 1: renombrar · En alta · En SKU · orden) ─────
  // Reproduce EXACTAMENTE el comportamiento fijo actual: el SKU es cat-manga-tela-color
  // (+ número de modelo al final). Nada cambia hasta que el admin lo edite.
  //   label   → nombre visible del catálogo (antes hardcodeado como título)
  //   inForm  → aparece como campo en el alta de producto
  //   inSku   → su código forma parte del SKU
  //   skuOrder→ posición dentro del SKU (entre los inSku)
  //   field   → propiedad del producto que lleva su código (p.cat, p.manga, …)
  //   system    → catálogo del sistema (no se puede borrar, solo desactivar/renombrar)
  //   struct    → estructural (swatch / matriz de stock): no se quita del alta ni del SKU por toggle
  //   formSelect→ se captura como menú desplegable en el alta (lo controla el toggle "En alta")
  const SEED_CATALOG_META = {
    category:    { label: 'Categoría',      inForm: true,  inSku: true,  skuOrder: 1, field: 'cat',    system: true, formSelect: true },
    sleeve:      { label: 'Manga',          inForm: true,  inSku: true,  skuOrder: 2, field: 'manga',  system: true, formSelect: true },
    fabric:      { label: 'Tela',           inForm: true,  inSku: true,  skuOrder: 3, field: 'tela',   system: true, formSelect: true, filterable: true },
    color:       { label: 'Color',          inForm: true,  inSku: true,  skuOrder: 4, field: 'color',  system: true, struct: true, formSelect: true },
    neck:        { label: 'Cuello',         inForm: true,  inSku: false, skuOrder: 5, field: 'cuello', system: true, formSelect: true },
    ornament:    { label: 'Ornamento',      inForm: false, inSku: false, skuOrder: 6, field: 'orn',    system: true },
    size_letter: { label: 'Talla (Letra)',  inForm: false, inSku: false, skuOrder: 7, system: true, struct: true },
    size_number: { label: 'Talla (Número)', inForm: false, inSku: false, skuOrder: 8, system: true, struct: true },
  };

  // ── Semilla de parámetros sueltos ────────────────────────────────────────────
  const SEED_SETTINGS = {
    'store.name': 'Balam Guayaberas',
    'store.rfc': 'XAXX010101000',
    'store.address': 'Calle 60 #412, Centro, Mérida, Yuc.',
    'store.phone': '999 924 0011',
    'store.logo': '',
    'currency': 'MXN',
    'tax.ivaPct': 16,
    'tax.included': true,
    'stock.lowThreshold': 4,
    'client.recurrentThreshold': 3,
    'commission.basePct': 5,
    'commission.monthlyGoal': 200000,
    'commission.bonus': 2000,
    'commission.auto': true,
    'commission.base': 'neto', // 'neto' (sobre precio sin IVA) | 'bruto' (sobre el total con IVA)
    'report.marginPct': 33,
    'discount.minMarginPct': 45,
    'folio.prefix': 'BG-',
    'ticket.footer': 'Gracias por ser parte de nuestra herencia.',
    'ticket.tagline': 'Piezas artesanales únicas, cuidando la tradición y el detalle en cada fibra.',
    'pos.askSize': true,
    'pos.allowLayaway': true,
    'pos.sound': true,
    'pos.validateStock': true,
    'returns.reverseCommission': true, // al devolver: revertir comisión/ventas del vendedor en proporción a lo devuelto
    'returns.refundMethod': 'Mismo método', // sugerencia por defecto del método de reembolso
    'print.auto': false,
    'print.lowStockAlert': true,
  };

  // ── Estado + persistencia ────────────────────────────────────────────────────
  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function seed() {
    const catalogs = {};
    Object.keys(SEED_CATALOGS).forEach(kind => {
      catalogs[kind] = SEED_CATALOGS[kind].map(it => ({
        code: it.code, label: it.label, active: true, meta: it.meta ? deepClone(it.meta) : {},
      }));
    });
    return { v: 1, catalogs, catalogMeta: deepClone(SEED_CATALOG_META), settings: deepClone(SEED_SETTINGS) };
  }

  let state;
  try {
    const raw = localStorage.getItem(LS_KEY);
    state = raw ? JSON.parse(raw) : null;
  } catch (e) { state = null; }
  if (!state || !state.catalogs || !state.settings) state = seed();

  // Rellena catálogos/ajustes nuevos que no estuvieran en un estado guardado viejo
  (function backfill() {
    const fresh = seed();
    let changed = false;
    Object.keys(fresh.catalogs).forEach(k => { if (!state.catalogs[k]) { state.catalogs[k] = fresh.catalogs[k]; changed = true; } });
    Object.keys(fresh.settings).forEach(k => { if (!(k in state.settings)) { state.settings[k] = fresh.settings[k]; changed = true; } });
    // Metadatos por catálogo: rellena el mapa entero o entradas-por-kind ausentes (estados viejos).
    if (!state.catalogMeta) { state.catalogMeta = fresh.catalogMeta; changed = true; }
    else Object.keys(fresh.catalogMeta).forEach(k => { if (!state.catalogMeta[k]) { state.catalogMeta[k] = fresh.catalogMeta[k]; changed = true; } });
    // Asegura el método 'Cortesía' (regalos/giveaways) en instalaciones que ya tenían payment_method.
    const pm = state.catalogs.payment_method;
    if (pm && !pm.some(it => it.code === 'Cortesía')) { pm.push({ code: 'Cortesía', label: 'Cortesía', active: true, meta: { icon: 'tag' } }); changed = true; }
    if (changed) persist();
  })();

  let version = 0;
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* cuota */ }
  }
  function emit() {
    version++;
    persist();
    try { window.dispatchEvent(new CustomEvent('configchange', { detail: { version } })); } catch (e) { /* SSR */ }
    if (window.STORE && window.STORE.pushConfig) { try { window.STORE.pushConfig(state); } catch (e) { /* offline */ } }
  }

  // ── API de lectura ────────────────────────────────────────────────────────────
  // Lista completa (incluye inactivos) — para el editor del admin
  function all(kind) { return (state.catalogs[kind] || []).slice(); }
  // Solo activos — para los consumidores de la app
  function list(kind) { return (state.catalogs[kind] || []).filter(it => it.active !== false); }
  // { code: label } de los activos, preservando orden — reemplaza los mapas viejos (D.CAT, etc.)
  function map(kind) {
    const o = {};
    list(kind).forEach(it => { o[it.code] = it.label; });
    return o;
  }
  // { code: meta[key] } de los activos (ej. metaMap('color','hex') → COLOR_HEX)
  function metaMap(kind, key) {
    const o = {};
    list(kind).forEach(it => { o[it.code] = it.meta ? it.meta[key] : undefined; });
    return o;
  }
  // Arreglo de codes activos (ej. codes('size_letter') → SIZES_LETRA)
  function codes(kind) { return list(kind).map(it => it.code); }
  function find(kind, code) { return (state.catalogs[kind] || []).find(it => it.code === code) || null; }

  function get(key) { return state.settings[key]; }
  function settings() { return deepClone(state.settings); }

  // ── Metadatos por catálogo (label / inForm / inSku / orden) ───────────────────
  function catalogMeta(kind) { return state.catalogMeta[kind] || null; }
  function allCatalogMeta() { return deepClone(state.catalogMeta); }
  // Etiqueta visible del catálogo (con respaldo si no hubiera meta).
  function catalogLabel(kind) { const m = state.catalogMeta[kind]; return (m && m.label) || kind; }
  // Propiedad del producto que lleva el código de un catálogo (p.cat, p.manga, …).
  function fieldOf(kind) { const m = state.catalogMeta[kind]; return m ? m.field : undefined; }
  // Partes del SKU: catálogos con inSku, ordenados por skuOrder → [{ kind, field }].
  function skuParts() {
    return Object.keys(state.catalogMeta)
      .map(kind => ({ kind, m: state.catalogMeta[kind] }))
      .filter(x => x.m && x.m.inSku && (x.m.field || x.m.custom))
      .sort((a, b) => (a.m.skuOrder || 0) - (b.m.skuOrder || 0))
      .map(x => ({ kind: x.kind, field: x.m.field, custom: !!x.m.custom }));
  }

  // ── ¿Un code de catálogo está en uso por algún producto? (guarda de borrado) ──
  function inUse(kind, code) {
    const D = window.DATA;
    if (!D || !D.products) return false;
    const cm = state.catalogMeta[kind];
    if (cm && cm.custom) return D.products.some(p => (p.attrs || {})[kind] === code);
    const field = fieldOf(kind);
    if (field && kind !== 'size_letter' && kind !== 'size_number') {
      if (D.products.some(p => String(p[field]) === String(code))) return true;
      if (kind === 'color' && D.products.some(p => (p.ornColors || []).includes(code))) return true;
      return false;
    }
    if (kind === 'size_letter') return D.products.some(p => (p.stock || []).some(v => v.escala === 'L' && v.talla === code && v.stock > 0));
    if (kind === 'size_number') return D.products.some(p => (p.stock || []).some(v => v.escala === 'N' && v.talla === code && v.stock > 0));
    return false;
  }

  // ── API de escritura (catálogos) ──────────────────────────────────────────────
  function addItem(kind, item) {
    if (!state.catalogs[kind]) state.catalogs[kind] = [];
    const code = String(item.code || '').trim();
    if (!code) return { ok: false, error: 'El código es obligatorio' };
    if (state.catalogs[kind].some(it => it.code === code)) return { ok: false, error: 'Ese código ya existe' };
    state.catalogs[kind].push({ code, label: (item.label || code).trim(), active: true, meta: item.meta || {} });
    emit();
    return { ok: true };
  }
  function updateItem(kind, code, patch) {
    const it = find(kind, code);
    if (!it) return { ok: false, error: 'No existe' };
    if ('label' in patch) it.label = patch.label;
    if ('active' in patch) it.active = !!patch.active;
    if ('meta' in patch) it.meta = Object.assign({}, it.meta, patch.meta);
    emit();
    return { ok: true };
  }
  function setActive(kind, code, active) { return updateItem(kind, code, { active }); }
  function removeItem(kind, code) {
    if (inUse(kind, code)) return { ok: false, error: 'En uso por productos — desactívalo en lugar de borrarlo' };
    const arr = state.catalogs[kind] || [];
    const i = arr.findIndex(it => it.code === code);
    if (i < 0) return { ok: false, error: 'No existe' };
    arr.splice(i, 1);
    emit();
    return { ok: true };
  }
  function move(kind, code, dir) {
    const arr = state.catalogs[kind] || [];
    const i = arr.findIndex(it => it.code === code);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return { ok: false };
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    emit();
    return { ok: true };
  }

  // ── API de escritura (metadatos de catálogo) ─────────────────────────────────
  // Renombrar (label) y togglear inForm/inSku. Los 'struct' no se quitan del alta ni del SKU.
  function setCatalogMeta(kind, patch) {
    const m = state.catalogMeta[kind];
    if (!m) return { ok: false, error: 'No existe' };
    if ('label' in patch) m.label = String(patch.label || '').trim() || m.label;
    // 'struct' (color, tallas) no se puede OCULTAR del alta (swatch/matriz de stock), pero sí
    // puede entrar o salir del SKU libremente (el SKU es solo un identificador).
    if ('inForm' in patch && !m.struct) m.inForm = !!patch.inForm;
    if ('inSku' in patch) m.inSku = !!patch.inSku;
    if ('required' in patch) m.required = !!patch.required;     // obligatorio en el alta
    if ('filterable' in patch) m.filterable = !!patch.filterable; // aparece como filtro en Inventario
    emit();
    return { ok: true };
  }
  // Reordena un catálogo dentro del SKU intercambiando skuOrder con su vecino inSku.
  function moveSkuOrder(kind, dir) {
    const m = state.catalogMeta[kind];
    if (!m || !m.inSku) return { ok: false };
    const ordered = Object.keys(state.catalogMeta)
      .map(k => ({ k, m: state.catalogMeta[k] }))
      .filter(x => x.m.inSku)
      .sort((a, b) => (a.m.skuOrder || 0) - (b.m.skuOrder || 0));
    const i = ordered.findIndex(x => x.k === kind);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return { ok: false };
    const a = ordered[i].m, b = ordered[j].m;
    const t = a.skuOrder; a.skuOrder = b.skuOrder; b.skuOrder = t;
    emit();
    return { ok: true };
  }

  // ── API de escritura (catálogos nuevos — Fase 2) ─────────────────────────────
  function slugify(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  }
  // Crea un catálogo "custom" vacío (un kind nuevo). Aparece como tarjeta editable y, si el admin
  // activa "En alta"/"En SKU", como campo del alta / segmento del SKU. Su valor por producto vive
  // en p.attrs[kind]. Las definiciones e ítems sincronizan a la nube como cualquier catálogo.
  function addCatalog(label) {
    const name = String(label || '').trim();
    if (!name) return { ok: false, error: 'Escribe el nombre del catálogo' };
    let base = slugify(name) || 'catalogo', kind = base, n = 2;
    while (state.catalogMeta[kind] || state.catalogs[kind]) kind = base + '_' + (n++);
    const orders = Object.keys(state.catalogMeta).map(k => state.catalogMeta[k].skuOrder || 0);
    state.catalogs[kind] = [];
    state.catalogMeta[kind] = { label: name, inForm: false, inSku: false, skuOrder: (orders.length ? Math.max.apply(null, orders) : 0) + 1, field: null, custom: true, formSelect: true, system: false };
    emit();
    return { ok: true, kind };
  }
  // Borra un catálogo custom (los del sistema no se borran). Bloqueado si algún producto lo usa.
  function removeCatalog(kind) {
    const m = state.catalogMeta[kind];
    if (!m) return { ok: false, error: 'No existe' };
    if (!m.custom) return { ok: false, error: 'Un catálogo del sistema no se puede borrar' };
    const D = window.DATA;
    if (D && D.products && D.products.some(p => (p.attrs || {})[kind] != null)) return { ok: false, error: 'En uso por productos — quita el valor antes de borrarlo' };
    delete state.catalogMeta[kind];
    delete state.catalogs[kind];
    emit();
    return { ok: true };
  }

  // ── API de escritura (ajustes) ────────────────────────────────────────────────
  function setSetting(key, value) { state.settings[key] = value; emit(); }
  function setSettings(obj) { Object.assign(state.settings, obj); emit(); }

  // ── Reset / import-export (para sync y respaldo) ──────────────────────────────
  function reset() { state = seed(); emit(); }
  function snapshot() { return deepClone(state); }
  // Aplica estado remoto. Los AJUSTES se fusionan sobre los defaults (la nube gana por
  // clave que tenga), así las claves nuevas del código no desaparecen tras un pull.
  function load(next) {
    if (!next || !next.catalogs || !next.settings) return;
    // Backfill de catálogos NUEVOS aún ausentes en la nube (p. ej. return_reason): si la nube no
    // trae el kind (o viene vacío), conserva la semilla local para que no desaparezca tras el pull.
    // emit() → pushConfig lo subirá, volviéndolo persistente. Los ajustes ya se fusionan sobre los defaults.
    const cats = next.catalogs, fresh = seed();
    Object.keys(fresh.catalogs).forEach(k => { if (!cats[k] || !cats[k].length) cats[k] = fresh.catalogs[k]; });
    // Metadatos: fusiona sobre los defaults (la nube gana por kind presente; los kinds nuevos del código no desaparecen).
    const meta = Object.assign({}, deepClone(SEED_CATALOG_META), next.catalogMeta || {});
    state = { v: next.v || 1, catalogs: cats, catalogMeta: meta, settings: Object.assign({}, deepClone(SEED_SETTINGS), next.settings) };
    emit();
  }

  window.CONFIG = {
    all, list, map, metaMap, codes, find, get, settings, inUse,
    catalogMeta, allCatalogMeta, catalogLabel, fieldOf, skuParts,
    addItem, updateItem, setActive, removeItem, move, setCatalogMeta, moveSkuOrder, addCatalog, removeCatalog, setSetting, setSettings,
    reset, snapshot, load,
    get version() { return version; },
    KINDS: Object.keys(SEED_CATALOGS),
  };
})();
