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
    ],
    sale_status: [
      { code: 'Pagado', label: 'Pagado', meta: { tone: 'success' } },
      { code: 'Apartado', label: 'Apartado', meta: { tone: 'warning' } },
      { code: 'Pendiente', label: 'Pendiente', meta: { tone: 'info' } },
      { code: 'Cancelado', label: 'Cancelado', meta: { tone: 'danger' } },
      { code: 'Entregado', label: 'Entregado', meta: { tone: 'success' } },
      { code: 'Enviado', label: 'Enviado', meta: { tone: 'info' } },
      { code: 'En Ajuste', label: 'En Ajuste', meta: { tone: 'warning' } },
    ],
    movement_type: [
      { code: 'Entrada', label: 'Entrada' },
      { code: 'Venta', label: 'Venta' },
      { code: 'Ajuste', label: 'Ajuste' },
      { code: 'Transferencia', label: 'Transferencia' },
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
    'report.marginPct': 33,
    'discount.minMarginPct': 45,
    'folio.prefix': 'BG-',
    'ticket.footer': 'Gracias por ser parte de nuestra herencia.',
    'ticket.tagline': 'Piezas artesanales únicas, cuidando la tradición y el detalle en cada fibra.',
    'pos.askSize': true,
    'pos.allowLayaway': true,
    'pos.sound': true,
    'pos.validateStock': true,
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
    return { v: 1, catalogs, settings: deepClone(SEED_SETTINGS) };
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

  // ── ¿Un code de catálogo está en uso por algún producto? (guarda de borrado) ──
  function inUse(kind, code) {
    const D = window.DATA;
    if (!D || !D.products) return false;
    const field = { category: 'cat', fabric: 'tela', sleeve: 'manga', neck: 'cuello', color: 'color', ornament: 'orn' }[kind];
    if (field) {
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
    state = { v: next.v || 1, catalogs: next.catalogs, settings: Object.assign({}, deepClone(SEED_SETTINGS), next.settings) };
    emit();
  }

  window.CONFIG = {
    all, list, map, metaMap, codes, find, get, settings, inUse,
    addItem, updateItem, setActive, removeItem, move, setSetting, setSettings,
    reset, snapshot, load,
    get version() { return version; },
    KINDS: Object.keys(SEED_CATALOGS),
  };
})();
