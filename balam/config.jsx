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
    additional_benefit: [
      { code: 'MANUAL_PERCENT', label: 'Descuento manual (%)', meta: { origin: 'Promoción especial', benefitType: 'percentage', value: 0, maxPercent: 100, maxAmount: 0, scope: 'ticket', requiresReason: true, requiresFolio: false, combinable: false, allowsCustomValue: true } },
      { code: 'MANUAL_AMOUNT', label: 'Descuento manual ($)', meta: { origin: 'Promoción especial', benefitType: 'fixed', value: 0, maxPercent: 0, maxAmount: 0, scope: 'ticket', requiresReason: true, requiresFolio: false, combinable: false, allowsCustomValue: true } },
      { code: 'EMP50', label: 'Empleado 50%', meta: { origin: 'Empleado', benefitType: 'percentage', value: 50, scope: 'ticket', requiresReason: false, requiresFolio: false, combinable: false, allowsCustomValue: false } },
      { code: 'CARD50', label: 'Tarjeta física 50% en un artículo', meta: { origin: 'Tarjeta física', benefitType: 'percentage', value: 50, scope: 'item', requiresReason: false, requiresFolio: true, combinable: false, allowsCustomValue: false } },
      { code: 'CARD500', label: 'Tarjeta física $500', meta: { origin: 'Tarjeta física', benefitType: 'fixed', value: 500, scope: 'ticket', requiresReason: false, requiresFolio: true, combinable: false, allowsCustomValue: false } },
      { code: 'CARD1000', label: 'Tarjeta física $1,000', meta: { origin: 'Tarjeta física', benefitType: 'fixed', value: 1000, scope: 'ticket', requiresReason: false, requiresFolio: true, combinable: false, allowsCustomValue: false } },
      { code: 'COURTESY_PIECE', label: 'Cortesía de una pieza', meta: { origin: 'Cortesía', benefitType: 'courtesy_piece', value: 0, scope: 'item', requiresReason: true, requiresFolio: false, combinable: false, allowsCustomValue: false } },
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
      { code: 'consultant', label: 'Cargo de vendedor', meta: { minPct: 0 } },
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
    size_letter: { label: 'Talla (Letra)',  inForm: false, inSku: false, skuOrder: 7, system: true, struct: true, sizeCategory: true, sizeScale: 'L' },
    size_number: { label: 'Talla (Número)', inForm: false, inSku: false, skuOrder: 8, system: true, struct: true, sizeCategory: true, sizeScale: 'N', sizeSlot: true },
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
    // H-69 · Escalera de comisión de la tienda. Los tres porcentajes son
    // MARGINALES: cada peso de venta neta del mes se paga a la tasa de su tramo,
    // así que una venta ya cobrada nunca se recalcula al cruzar un umbral.
    //   base   → desde 0 hasta la meta del vendedor
    //   meta   → desde la meta hasta el umbral de excedente
    //   exced. → por encima del umbral
    // Un vendedor SIN meta (metaMes = 0) comisiona la tasa base plana.
    'commission.basePct': 3,
    'commission.goalPct': 4,
    'commission.surplusPct': 5,
    'commission.surplusThresholdPct': 120, // % de la meta a partir del cual aplica la tasa de excedente
    'commission.monthlyGoal': 200000,      // sugerencia al dar de alta; la meta real vive en el perfil
    'commission.bonus': 2000,
    'commission.auto': true,
    'commission.base': 'neto', // 'neto' (sobre precio sin IVA) | 'bruto' (sobre el total con IVA)
    'report.marginPct': 33,
    'discount.minMarginPct': 45,
    'folio.prefix': 'BG', // H-33: sólo el prefijo; el folio es PREFIJO-YYMMDD-0001
    'ticket.footer': 'Gracias por ser parte de nuestra herencia.',
    'ticket.tagline': 'Piezas artesanales únicas, cuidando la tradición y el detalle en cada fibra.',
    'pos.askSize': true,
    'pos.allowLayaway': true,
    'pos.sound': true,
    'pos.validateStock': true,
    'returns.reverseCommission': true, // al devolver: revertir comisión/ventas del vendedor en proporción a lo devuelto
    'returns.refundMethod': 'Mismo método', // sugerencia por defecto del método de reembolso
    // H-34: plazo de posventa. Apagado = las ventas nunca vencen (contrato histórico).
    // Cada venta congela el plazo vigente al crearse; cambiar esto no altera ventas anteriores.
    'returns.limitEnabled': false,
    'returns.limitDays': 15,
    'print.auto': false,
    'print.lowStockAlert': true,
    'benefits.manualOptionsV1': true,
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

  // Rellena catálogos/ajustes/ítems nuevos ausentes en un estado (guardado local viejo O traído de la
  // nube). Muta el estado in situ y devuelve si cambió. Se usa al arrancar (datos locales) y dentro de
  // load() (datos de Supabase), para que una config vieja en la nube se auto-repare y se vuelva a subir.
  function backfillState(st) {
    const fresh = seed();
    let changed = false;
    const needsManualOptions = !Object.prototype.hasOwnProperty.call(st.settings, 'benefits.manualOptionsV1');
    Object.keys(fresh.catalogs).forEach(k => { if (!st.catalogs[k]) { st.catalogs[k] = fresh.catalogs[k]; changed = true; } });
    if (needsManualOptions) {
      const benefits = st.catalogs.additional_benefit || (st.catalogs.additional_benefit = []);
      fresh.catalogs.additional_benefit
        .filter(item => ['MANUAL_PERCENT', 'MANUAL_AMOUNT'].includes(item.code))
        .forEach(item => {
          if (!benefits.some(current => current.code === item.code)) {
            benefits.unshift(deepClone(item));
            changed = true;
          }
        });
    }
    Object.keys(fresh.settings).forEach(k => { if (!(k in st.settings)) { st.settings[k] = fresh.settings[k]; changed = true; } });
    // Metadatos por catálogo: rellena el mapa entero o entradas-por-kind ausentes (estados viejos).
    if (!st.catalogMeta) { st.catalogMeta = fresh.catalogMeta; changed = true; }
    else Object.keys(fresh.catalogMeta).forEach(k => { if (!st.catalogMeta[k]) { st.catalogMeta[k] = fresh.catalogMeta[k]; changed = true; } });
    // Talla (Número): habilita el segmento de talla en el SKU para estados guardados antes de esta función.
    if (st.catalogMeta.size_number && !st.catalogMeta.size_number.sizeSlot) { st.catalogMeta.size_number.sizeSlot = true; changed = true; }
    // Asegura el método 'Cortesía' (regalos/giveaways) aunque payment_method ya exista (local o nube).
    const pm = st.catalogs.payment_method;
    if (pm && !pm.some(it => it.code === 'Cortesía')) { pm.push({ code: 'Cortesía', label: 'Cortesía', active: true, meta: { icon: 'tag' } }); changed = true; }
    return changed;
  }

  // Rellena catálogos/ajustes nuevos que no estuvieran en un estado guardado viejo (datos locales)
  if (backfillState(state)) persist();

  let version = 0;
  function persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* cuota */ }
  }
  function emit() {
    version++;
    persist();
    try { window.dispatchEvent(new CustomEvent('configchange', { detail: { version } })); } catch (e) { /* SSR */ }
    try { window.CORE.invokeSync('pushConfig', state); } catch (e) { /* offline */ }
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
  // Categorías por talla: son los catálogos estructurales ya administrados por
  // Configuración. No se mantiene una lista paralela en POS ni Inventario.
  function sizeCategories() {
    const structural = {
      size_letter: { label: 'Talla (Letra)', scale: 'L' },
      size_number: { label: 'Talla (Número)', scale: 'N' },
    };
    const kinds = Object.keys(state.catalogMeta)
      .filter(kind => state.catalogMeta[kind] && state.catalogMeta[kind].sizeCategory);
    Object.keys(structural).forEach(kind => {
      // Configuraciones históricas traen los catálogos, pero pueden carecer de
      // las banderas sizeCategory/sizeScale añadidas después.
      if (!kinds.includes(kind) && (state.catalogs[kind] || state.catalogMeta[kind])) kinds.push(kind);
    });
    return kinds.map(kind => {
      const meta = state.catalogMeta[kind] || {};
      const fallback = structural[kind] || {};
      return {
        id: kind,
        label: meta.label || fallback.label || kind,
        scale: meta.sizeScale || fallback.scale || null,
      };
    });
  }
  // Etiqueta visible del catálogo (con respaldo si no hubiera meta).
  function catalogLabel(kind) { const m = state.catalogMeta[kind]; return (m && m.label) || kind; }
  // Propiedad del producto que lleva el código de un catálogo (p.cat, p.manga, …).
  function fieldOf(kind) { const m = state.catalogMeta[kind]; return m ? m.field : undefined; }
  // Kind del catálogo custom que alimenta el campo "Nombre / Modelo" del alta: por slug ('modelo')
  // o, de respaldo, por su nombre. null si no existe. Lo usan el alta (inventory) y el Constructor
  // de SKU (settings) — ese catálogo SÍ se captura aunque su "En alta" esté apagado.
  function modeloKind() {
    const m = state.catalogMeta;
    if (m.modelo && m.modelo.custom) return 'modelo';
    return Object.keys(m).find(k => m[k].custom && String(m[k].label || '').trim().toLowerCase() === 'modelo') || null;
  }

  // Partes del SKU: catálogos con inSku, ordenados por skuOrder → [{ kind, field }].
  function skuParts() {
    return Object.keys(state.catalogMeta)
      .map(kind => ({ kind, m: state.catalogMeta[kind] }))
      .filter(x => x.m && x.m.inSku && (x.m.field || x.m.custom || x.m.sizeSlot))
      .sort((a, b) => (a.m.skuOrder || 0) - (b.m.skuOrder || 0))
      .map(x => ({ kind: x.kind, field: x.m.field, custom: !!x.m.custom, sizeSlot: !!x.m.sizeSlot }));
  }

  // ── H-63 · ¿Qué referencias vivas tiene este código de talla? ────────────────
  // Autoridad única de la pregunta. La categoría define la ESCALA y el valor real
  // sale de meta.value (o del código, en los registros históricos): nunca se
  // clasifica por la apariencia del código ni de la etiqueta. Un código puede
  // llamarse 'B' y ser una talla numérica perfectamente válida.
  // Cuenta cuatro clases de referencia, todas por VALOR: existencias positivas,
  // precios especiales por talla, códigos de barras generados y alcance de
  // promociones. Devolver cero es la única licencia para retirarlo de la operación.
  const SIZE_KINDS = ['size_letter', 'size_number'];
  function sizeCodeReferences(kind, code) {
    const vacio = { stock: 0, productos: 0, precios: 0, barcodes: 0, promociones: 0, total: 0 };
    if (SIZE_KINDS.indexOf(kind) < 0) return vacio;
    const item = (state.catalogs[kind] || []).find(it => it.code === code);
    if (!item) return vacio;
    const meta = item.meta && typeof item.meta === 'object' ? item.meta : {};
    const value = Object.prototype.hasOwnProperty.call(meta, 'value') ? meta.value : item.code;
    const scale = (sizeCategories().find(cat => cat.id === kind) || {}).scale
      || (kind === 'size_number' ? 'N' : 'L');
    const target = String(value);
    const out = Object.assign({}, vacio);
    window.CORE.catalogProducts().forEach(p => {
      // Sólo cuentan las referencias de productos de ESTA categoría; un producto de
      // la otra escala no convierte su talla homónima en una referencia viva.
      const assigned = (p.attrs || {}).__sizeCategoryId || p.sizeCategoryId || null;
      if (assigned && assigned !== kind) return;
      const piezas = (p.stock || []).reduce((sum, v) =>
        (v.escala === scale && String(v.talla) === target ? sum + (Number(v.stock) || 0) : sum), 0);
      if (piezas > 0) { out.stock += piezas; out.productos++; }
      const precios = p.preciosTalla || {};
      if (Object.prototype.hasOwnProperty.call(precios, target)) out.precios++;
      const barcodes = p.barcodeUrls || {};
      if (Object.prototype.hasOwnProperty.call(barcodes, target)) out.barcodes++;
    });
    window.CORE.catalogPromotions().forEach(promo => {
      const tallas = (promo && promo.scope && Array.isArray(promo.scope.tallas)) ? promo.scope.tallas : [];
      if (tallas.some(t => String(t) === target)) out.promociones++;
    });
    out.total = out.stock + out.precios + out.barcodes + out.promociones;
    return out;
  }
  // Alcance de la protección de H-63: sólo Talla (Número), donde el daño está
  // demostrado. Talla (Letra) conserva su comportamiento exacto — ampliarla es una
  // decisión funcional pendiente, no un descuido.
  const PROTECTED_SIZE_KIND = 'size_number';
  function sizeCodeProtected(kind, code) {
    return kind === PROTECTED_SIZE_KIND && sizeCodeReferences(kind, code).total > 0;
  }
  function sizeGuardError(kind, code) {
    const r = sizeCodeReferences(kind, code);
    const partes = [];
    if (r.stock) partes.push(`${r.stock} pieza(s) en ${r.productos} producto(s)`);
    if (r.precios) partes.push(`${r.precios} precio(s) especial(es)`);
    if (r.barcodes) partes.push(`${r.barcodes} código(s) de barras`);
    if (r.promociones) partes.push(`${r.promociones} promoción(es)`);
    const item = (state.catalogs[kind] || []).find(it => it.code === code);
    const etiqueta = item ? `${item.label} (${code})` : code;
    return `La talla ${etiqueta} tiene existencias o referencias vivas: ${partes.join(', ')}. `
      + 'Desactivarla dejaría ese inventario fuera del punto de venta.';
  }

  // ── ¿Un code de catálogo está en uso por algún producto? (guarda de borrado) ──
  function inUse(kind, code) {
    // H-63: para la categoría protegida, «en uso» es la misma pregunta que responde
    // sizeCodeReferences. Sin esto habría dos fórmulas para un mismo hecho y la
    // ruta de borrado seguiría admitiendo un código referenciado sólo por precios.
    if (kind === PROTECTED_SIZE_KIND) return sizeCodeReferences(kind, code).total > 0;
    const products = window.CORE.catalogProducts();
    const cm = state.catalogMeta[kind];
    if (cm && cm.custom) return products.some(p => (p.attrs || {})[kind] === code);
    const field = fieldOf(kind);
    if (field && kind !== 'size_letter' && kind !== 'size_number') {
      if (products.some(p => String(p[field]) === String(code))) return true;
      if (kind === 'color' && products.some(p => (p.ornColors || []).includes(code))) return true;
      return false;
    }
    const sizeItem = (state.catalogs[kind] || []).find(item => item.code === code);
    const sizeMeta = sizeItem && sizeItem.meta && typeof sizeItem.meta === 'object' ? sizeItem.meta : {};
    const sizeValue = Object.prototype.hasOwnProperty.call(sizeMeta, 'value') ? sizeMeta.value : code;
    // size_number no llega aquí: lo resuelve arriba la autoridad de referencias.
    if (kind === 'size_letter') return products.some(p => (p.stock || []).some(v =>
      v.escala === 'L' && String(v.talla) === String(sizeValue) && Number(v.stock) > 0));
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
    // H-63: desactivar es la operación peligrosa; reactivar nunca se bloquea.
    // Se comprueba ANTES de tocar nada para que un rechazo no deje el catálogo
    // a medio modificar ni emita un configchange.
    if ('active' in patch && !patch.active && it.active !== false && sizeCodeProtected(kind, code)) {
      return { ok: false, error: sizeGuardError(kind, code), references: sizeCodeReferences(kind, code) };
    }
    if ('label' in patch) it.label = patch.label;
    if ('active' in patch) it.active = !!patch.active;
    if ('meta' in patch) it.meta = Object.assign({}, it.meta, patch.meta);
    emit();
    return { ok: true };
  }
  function setActive(kind, code, active) { return updateItem(kind, code, { active }); }

  // ── H-74 · Renombrar el CÓDIGO de una talla ─────────────────────────────────
  // `updateItem` jamás toca `code` por diseño: el código es la identidad con la
  // que el inventario encuentra sus piezas (`ADR-011`). Esta puerta existe sólo
  // para la migración de `DATA.migrateSizeCodes()`, que reescribe en el MISMO
  // acto las referencias del inventario; usarla sola desconectaría las piezas.
  //
  // Resuelve el orden por sí misma: renombrar `0→38` y `s→0` a la vez colisiona,
  // porque el destino de `s` lo ocupa el origen de `0`. Se aplican primero los
  // pares cuyo destino ya está libre y se repite; si ningún par avanza en una
  // pasada, el mapa tiene un ciclo y se rechaza entero.
  const SIZE_KINDS_RENAME = ['size_letter', 'size_number'];
  function renameSizeCodes(kind, pairs, opts) {
    if (SIZE_KINDS_RENAME.indexOf(kind) < 0) return { ok: false, code: 'INVALID_KIND', error: 'Sólo se renombran códigos de talla' };
    const arr = state.catalogs[kind] || [];
    const pend = (pairs || []).map(p => ({ from: String(p[0]), to: String(p[1]) })).filter(p => p.from !== p.to);
    if (!pend.length) return { ok: false, code: 'EMPTY_MAP', error: 'No hay códigos que renombrar' };
    const origenes = new Set(pend.map(p => p.from));
    for (const p of pend) {
      if (!arr.some(x => x.code === p.from)) return { ok: false, code: 'SOURCE_MISSING', error: `El código ${p.from} no existe en el catálogo` };
      // Un destino ocupado sólo es admisible si ese ocupante también se renombra.
      const ocupa = arr.find(x => x.code === p.to);
      if (ocupa && !origenes.has(p.to)) return { ok: false, code: 'TARGET_TAKEN', error: `El código ${p.to} ya lo usa una talla que no se renombra` };
    }
    if (new Set(pend.map(p => p.to)).size !== pend.length) return { ok: false, code: 'DUPLICATE_TARGET', error: 'Dos tallas no pueden quedar con el mismo código' };
    const aplicado = [];
    let restantes = pend.slice();
    while (restantes.length) {
      const libres = restantes.filter(p => !arr.some(x => x.code === p.to));
      if (!libres.length) return { ok: false, code: 'RENAME_CYCLE', error: 'El mapa de códigos forma un ciclo y no puede aplicarse' };
      libres.forEach(p => { arr.find(x => x.code === p.from).code = p.to; aplicado.push(p.from + '→' + p.to); });
      restantes = restantes.filter(p => libres.indexOf(p) < 0);
    }
    // Orden natural: las tallas con etiqueta numérica ascendente primero; las
    // demás conservan su orden relativo al final.
    if (opts && opts.reorder) {
      const num = (x) => { const n = Number(String(x.label).trim()); return Number.isFinite(n) && String(x.label).trim() !== '' ? n : null; };
      const conNum = arr.filter(x => num(x) !== null).sort((a, b) => num(a) - num(b));
      const sinNum = arr.filter(x => num(x) === null);
      state.catalogs[kind] = conNum.concat(sinNum);
    }
    emit();
    return { ok: true, aplicado };
  }
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
    // Al borrar, limpia el valor del atributo en los productos y procede. Bloquear por "en uso"
    // creaba un candado sin llave: blankProduct() auto-rellena attrs[kind] con el primer ítem
    // cuando el catálogo está "En SKU" (aunque esté oculto del alta), así que el usuario nunca
    // eligió ese valor ni tiene UI para quitarlo. El SKU ya congelado de cada producto no cambia.
    const prods = window.CORE.catalogProducts();
    let touched = false;
    prods.forEach(p => { if (p.attrs && (kind in p.attrs)) { delete p.attrs[kind]; touched = true; } });
    if (touched) window.CORE.saveCatalogProducts();
    delete state.catalogMeta[kind];
    delete state.catalogs[kind];
    emit();
    return { ok: true };
  }

  // ── Importación masiva de catálogos (Excel → Configuración) ──────────────────
  // map: { kind: [{ code, label, active, meta }] }. Por cada kind presente:
  //   · upsert por código: label/activo/meta se fusionan sobre el elemento existente
  //   · el ORDEN del archivo manda (se convierte en el orden del catálogo)
  //   · códigos existentes que NO vienen en el archivo se conservan al final DESACTIVADOS
  //     (nunca se borra: productos e historial pueden referenciarlos)
  //   · kinds desconocidos u hojas vacías se ignoran (no tocan nada)
  // H-63: el resultado se ARMA COMPLETO antes de aplicarse. Si alguna hoja dejaría
  // inactivo un código de talla protegido —por ACTIVO=NO o por ausencia, que es la
  // desactivación silenciosa que causó el defecto— se rechaza el archivo ENTERO:
  // media importación aplicada es peor que ninguna, porque deja el catálogo en un
  // estado que nadie pidió y que el archivo ya no describe.
  function importCatalogs(map) {
    let kinds = 0, items = 0;
    const staged = {};
    const blocked = [];
    Object.keys(map || {}).forEach(kind => {
      if (!state.catalogs[kind]) return;
      const rows = (map[kind] || []).filter(r => r && String(r.code == null ? '' : r.code).trim());
      if (!rows.length) return;
      const prev = state.catalogs[kind];
      const seen = {}; const next = [];
      rows.forEach(r => {
        const code = String(r.code).trim();
        if (seen[code]) return; // duplicado en el archivo → la primera fila gana
        seen[code] = true;
        const old = prev.find(it => it.code === code);
        const label = String(r.label == null ? '' : r.label).trim();
        const active = r.active != null ? !!r.active : (old ? old.active !== false : true);
        if (old && old.active !== false && !active && sizeCodeProtected(kind, code)) {
          blocked.push({ kind, code, label: old.label, reason: 'desactivado', references: sizeCodeReferences(kind, code) });
        }
        next.push({
          code,
          label: label || (old ? old.label : code),
          active,
          meta: Object.assign({}, old ? old.meta : {}, r.meta || {}),
        });
        items++;
      });
      prev.forEach(it => {
        if (seen[it.code]) return;
        if (it.active !== false && sizeCodeProtected(kind, it.code)) {
          blocked.push({ kind, code: it.code, label: it.label, reason: 'ausente', references: sizeCodeReferences(kind, it.code) });
        }
        next.push(Object.assign({}, it, { active: false }));
      });
      staged[kind] = next;
      kinds++;
    });
    if (blocked.length) {
      const detalle = blocked.map(b => `${b.label} (${b.code})`).join(', ');
      return {
        ok: false,
        kinds: 0,
        items: 0,
        blocked,
        error: `El archivo dejaría sin punto de venta ${blocked.length} talla(s) con existencias o referencias vivas: ${detalle}. `
          + 'No se aplicó ningún cambio.',
      };
    }
    Object.keys(staged).forEach(kind => { state.catalogs[kind] = staged[kind]; });
    if (kinds) emit();
    return { ok: true, kinds, items };
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
    // Migra el estado remoto ANTES de fusionar defaults; de otro modo una
    // bandera nueva parecería ya presente y no podría inyectar sus ítems una vez.
    backfillState(next);
    // Backfill de catálogos NUEVOS aún ausentes en la nube (p. ej. return_reason): si la nube no
    // trae el kind, conserva la semilla local para que no desaparezca tras el pull.
    // OJO: si el kind SÍ figura en los metadatos de la nube (_catalogMeta) pero llega sin filas,
    // es que el admin vació el catálogo a propósito (p. ej. Talla Letra) — se respeta vacío en
    // vez de resucitar la semilla (bug: las tallas "revivían" en cada recarga).
    const cats = next.catalogs, fresh = seed();
    Object.keys(fresh.catalogs).forEach(k => {
      const known = !!(next.catalogMeta && next.catalogMeta[k]);
      if (!cats[k]) cats[k] = known ? [] : fresh.catalogs[k];
      else if (!cats[k].length && !known) cats[k] = fresh.catalogs[k];
    });
    // Metadatos: fusiona sobre los defaults (la nube gana por kind presente; los kinds nuevos del código no desaparecen).
    const meta = Object.assign({}, deepClone(SEED_CATALOG_META), next.catalogMeta || {});
    state = { v: next.v || 1, catalogs: cats, catalogMeta: meta, settings: Object.assign({}, deepClone(SEED_SETTINGS), next.settings) };
    // Inyecta ítems nuevos que la nube no trae (p. ej. el método 'Cortesía' en un payment_method ya
    // poblado). emit() → pushConfig vuelve a subir la config reparada, volviéndola persistente.
    backfillState(state);
    emit();
  }

  window.CONFIG = {
    all, list, map, metaMap, codes, find, get, settings, inUse, sizeCodeReferences,
    catalogMeta, allCatalogMeta, sizeCategories, catalogLabel, fieldOf, skuParts, modeloKind,
    addItem, updateItem, setActive, removeItem, move, setCatalogMeta, moveSkuOrder, addCatalog, removeCatalog, importCatalogs, setSetting, setSettings,
    renameSizeCodes,
    reset, snapshot, load,
    get version() { return version; },
    KINDS: Object.keys(SEED_CATALOGS),
  };
})();
