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

  // Catálogos históricos de las dos escalas. Un producto usa exactamente UNA
  // categoría; estas lecturas se conservan para compatibilidad y Excel.
  const sizeValues = kind => C.list(kind).map(item => {
    const meta = item && item.meta && typeof item.meta === 'object' ? item.meta : {};
    return Object.prototype.hasOwnProperty.call(meta, 'value') ? meta.value : item.code;
  });
  const SIZES_LETRA = () => sizeValues('size_letter');
  const SIZES_NUM = () => sizeValues('size_number');

  const categoryScale = categoryId => {
    const meta = C && C.catalogMeta ? C.catalogMeta(categoryId) : null;
    return meta && meta.sizeScale ? meta.sizeScale
      : categoryId === 'size_number' ? 'N'
        : categoryId === 'size_letter' ? 'L' : null;
  };

  function inferSizeCategory(product, variants) {
    const categories = (C && C.sizeCategories ? C.sizeCategories() : []);
    const valid = id => !!id && categories.some(category => category.id === id);
    // attrs es la representación persistida y sizeCategoryId sólo su proyección
    // en memoria. Una copia local antigua puede traerlas en conflicto.
    const persisted = product && product.attrs && product.attrs.__sizeCategoryId;
    if (valid(persisted)) return persisted;
    const derived = product && product.sizeCategoryId;
    if (valid(derived)) return derived;
    const positive = new Set((variants || []).filter(v => Number(v.stock) > 0).map(v => v.escala).filter(Boolean));
    if (positive.size !== 1) return null;
    const scale = Array.from(positive)[0];
    const category = categories.find(item => item.scale === scale);
    return category ? category.id : (scale === 'N' ? 'size_number' : scale === 'L' ? 'size_letter' : null);
  }

  // Autoridad única: Producto → categoría asignada → tallas configuradas →
  // variantes/existencias. `catalogs` se admite para pruebas y adaptadores; en
  // producción se consulta CONFIG en vivo, por lo que una edición se refleja
  // sin reconstruir catálogos en las pantallas.
  function resolveProductSizes(product, catalogs, variants) {
    const rows = Array.isArray(variants) ? variants : ((product && product.stock) || []);
    const configuredCategories = C && C.sizeCategories ? C.sizeCategories() : [
      { id: 'size_letter', label: 'Talla (Letra)', scale: 'L' },
      { id: 'size_number', label: 'Talla (Número)', scale: 'N' },
    ];
    const categoryId = inferSizeCategory(product, rows);
    const rawPersisted = product && product.attrs && product.attrs.__sizeCategoryId;
    const rawDerived = product && product.sizeCategoryId;
    const categoryConflict = !!(rawPersisted && rawDerived && rawPersisted !== rawDerived);
    // Sin categoría inequívoca no se mezclan catálogos. Inventario debe pedir
    // una asignación explícita; POS no ofrece variantes ambiguas.
    if (!categoryId) {
      const positiveScales = new Set(rows.filter(v => Number(v.stock) > 0).map(v => v.escala).filter(Boolean));
      return {
        categoryId: null,
        categoryLabel: '',
        categoryConflict,
        requiresAssignment: true,
        ambiguous: positiveScales.size > 1,
        sizes: [],
      };
    }
    const source = catalogs || null;
    const sizes = [];
    const category = configuredCategories.find(cat => cat.id === categoryId);
    const scale = (category && category.scale) || categoryScale(categoryId);
    let items = source
      ? (Array.isArray(source[categoryId]) ? source[categoryId] : [])
      : (C && C.all ? C.all(categoryId) : []);
    if (!items.length && C && C.codes) {
      items = C.codes(categoryId).map(value => ({ code: value, label: value, active: true }));
    }
    items.forEach((item, index) => {
      const meta = item && item.meta && typeof item.meta === 'object' ? item.meta : {};
      const value = Object.prototype.hasOwnProperty.call(meta, 'value') ? meta.value : item.code;
      const matches = rows.filter(v =>
        (!scale || !v.escala || v.escala === scale) && String(v.talla) === String(value));
      sizes.push({
        // Identidad compuesta: una talla es {sizeCategoryId, sizeId}. El mismo
        // código puede existir en dos categorías (PZ en Letra y en Número) y son
        // dos tallas distintas; `filterKey` es esa pareja ya serializada.
        sizeCategoryId: categoryId,
        sizeId: item.code,
        filterKey: encodeURIComponent(categoryId) + ':' + encodeURIComponent(String(item.code)),
        value,
        label: item.label == null || item.label === '' ? String(value) : item.label,
        // El orden administrable es el del arreglo CONFIG/lookup.sort_order.
        order: index,
        stock: matches.reduce((sum, v) => sum + (Number(v.stock) || 0), 0),
        variantId: matches.length ? (matches[0].id || null) : null,
        active: item.active !== false,
        scale,
      });
    });
    return {
      categoryId,
      categoryLabel: category ? category.label : categoryId,
      categoryConflict,
      requiresAssignment: false,
      ambiguous: false,
      sizes,
    };
  }

  // Autoridad del filtro global de tallas: una ESTRUCTURA por categoría, no una
  // lista. Las categorías salen de Configuración en su orden, y las tallas de
  // cada una en el orden de su catálogo. No recorre productos ni existencias, no
  // ordena por texto ni por número, y jamás funde dos categorías: dos tallas con
  // el mismo código en categorías distintas son dos opciones distintas.
  // Una categoría sin tallas activas no produce grupo (no se anuncia un grupo
  // vacío); las tallas activas se ofrecen aunque no tengan existencias.
  function resolveSizeFilterGroups(catalogs) {
    const categories = C && C.sizeCategories ? C.sizeCategories() : [];
    return categories.map(category => {
      const product = {
        sizeCategoryId: category.id,
        attrs: { __sizeCategoryId: category.id },
        stock: [],
      };
      const sizes = resolveProductSizes(product, catalogs, []).sizes
        .filter(size => size.active)
        .map(size => ({ ...size, categoryLabel: category.label }));
      return { categoryId: category.id, categoryLabel: category.label, sizes };
    }).filter(group => group.sizes.length);
  }

  // Proyección plana de la misma autoridad, para los consumidores que sólo
  // necesitan el conjunto de tallas ofrecidas. Es una DERIVACIÓN de los grupos:
  // no reimplementa el orden ni la selección de categorías.
  function resolveSizeFilterOptions(catalogs) {
    return resolveSizeFilterGroups(catalogs)
      .reduce((out, group) => out.concat(group.sizes), []);
  }

  function sizeFilterMatch(product, filterKey) {
    if (!filterKey || filterKey === 'all') return true;
    return resolveProductSizes(product).sizes.some(size =>
      size.active && size.stock > 0 && size.filterKey === filterKey);
  }

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

  // Marcador del segmento de talla (número) dentro del SKU base. El SKU del modelo NO tiene una
  // talla única (es una matriz), así que reserva este marcador en su posición; la etiqueta/código
  // por pieza (barcodes.codeOf) lo reemplaza por la talla real. Ver Constructor de SKU.
  const SIZE_MARK = 'T';

  // SKU armado desde la receta configurable (CONFIG.skuParts): catálogos con "En SKU", ordenados.
  // El No. Modelo YA NO se agrega como token fijo al final: si el admin quiere la clave del modelo
  // en el SKU, activa "En SKU" en el catálogo Modelo y elige su posición como cualquier segmento.
  function sku(p) {
    // Modelo numérico → 3 dígitos (7 → 007, histórico). Clave de catálogo (ADR, ARO) → tal cual.
    const mod = String(p.modelo);
    const modTok = /^\d+$/.test(mod) ? mod.padStart(3, '0') : mod;
    // Respaldo para cuando CONFIG aún no cargó: orden fijo histórico (con modelo al final).
    if (!(C && typeof C.skuParts === 'function')) return [p.cat, p.manga, p.tela, p.color, modTok].join('-');
    // El segmento de talla emite el marcador (SIZE_MARK); no lleva un valor por producto.
    const parts = C.skuParts().map(x => x.sizeSlot ? SIZE_MARK : (x.custom ? (p.attrs || {})[x.kind] : p[x.field]));
    // Receta vacía → el modelo como respaldo: el SKU es el identificador y no puede quedar vacío.
    return parts.length ? parts.join('-') : modTok;
  }
  function totalStock(p) {
    return resolveProductSizes(p).sizes.reduce((sum, size) => sum + (Number(size.stock) || 0), 0);
  }

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
  // ¿La foto es una de las GENÉRICAS que asigna pickImg (no una que subió el usuario)?
  // La usa la exportación a Excel para no publicar como "foto del producto" una de relleno,
  // y la importación para que una genérica nunca pise una foto real ya guardada.
  const AUTO_IMGS = IMG.white.concat(IMG.blue, IMG.color);
  function isAutoImg(url) { return AUTO_IMGS.indexOf(String(url || '')) >= 0; }
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
    if (!p.attrs || typeof p.attrs !== 'object') p.attrs = {}; // valores de catálogos custom (Fase 2)
    p.sizeCategoryId = inferSizeCategory(p, p.stock);
    if (p.sizeCategoryId) p.attrs.__sizeCategoryId = p.sizeCategoryId;
    else delete p.attrs.__sizeCategoryId;
    if (!Array.isArray(p.ornColors)) p.ornColors = [];
    if (!p.cuello) p.cuello = 'NOR';
    // Normaliza stock al modelo de 20 entradas si viniera incompleto
    if (!Array.isArray(p.stock) || !p.stock.length || p.stock[0].escala === undefined) {
      const L = {}, N = {};
      (p.stock || []).forEach(v => { (v.escala === 'N' ? N : L)[v.talla] = v.stock; });
      p.stock = SIZES_LETRA().map(t => ({ talla: t, escala: 'L', stock: L[t] || 0 }))
        .concat(SIZES_NUM().map(t => ({ talla: t, escala: 'N', stock: N[t] || 0 })));
    }
    // SKU congelado: se calcula una sola vez (al crear el producto). Los productos ya
    // guardados conservan su SKU aunque cambie la receta — el historial los referencia por SKU.
    if (!p.sku) p.sku = sku(p);
    // Costo del producto (para validar margen en Descuentos). Si falta, estima 45% del precio.
    if (p.costo == null || p.costo === '') p.costo = Math.round((Number(p.precio) || 0) * 0.45);
    p.costo = Number(p.costo) || 0;
    // H-36: excepciones de precio por talla. Se canoniza aquí para que una talla
    // retirada del catálogo o un valor inutilizable no sobrevivan en el mapa.
    p.preciosTalla = sanitizePreciosTalla(p.preciosTalla, p);
    colorDisplay(p);
    if (!p.imagen) p.imagen = pickImg(p);
    return p;
  }

  // Nombre y hex del color para display. Si el código ya no está ACTIVO (p. ej. el catálogo se
  // re-codificó y el código viejo quedó desactivado — importCatalogs nunca borra), cae al elemento
  // desactivado: el punto conserva su color real y el nombre en vez de gris + código crudo.
  function colorDisplay(p) {
    const it = (C && C.find) ? C.find('color', String(p.color)) : null;
    p.colorHex = COLOR_HEX()[p.color] || (it && it.meta && it.meta.hex) || '#8b9099';
    p.colorName = COLOR_NAME()[p.color] || (it && it.label) || p.color;
  }

  // ── Re-vinculación por nombre (puente por etiqueta) ──────────────────────────
  // Un código huérfano (ya no ACTIVO en el catálogo) se remapea al código activo cuya etiqueta
  // coincide de forma INEQUÍVOCA (única). Nunca cae al primer elemento activo (eso reasignaría
  // un color/atributo equivocado); sin match confiable devuelve null y el formulario conserva
  // su aviso ⚠. El código viejo casi siempre sigue en el catálogo desactivado (importCatalogs
  // nunca borra y removeItem bloquea códigos en uso), así que su etiqueta está disponible.
  const normBridge = (s) => String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function bridgeCode(kind, code) {
    const l = (C && typeof C.list === 'function') ? C.list(kind) : [];
    if (!l.length) return null;
    const cur = String(code == null ? '' : code);
    if (l.some(x => x.code === cur)) return null; // no es huérfano
    const old = (C && C.find) ? C.find(kind, cur) : null;
    if (!old) return null;
    const oldHex = (kind === 'color' && old.meta && old.meta.hex) ? String(old.meta.hex).toLowerCase() : '';
    // Puente por HEX exacto entre un grupo de candidatos (desempata nombres repetidos o
    // suple un nombre ausente). Cercano NO basta: vino y guinda casi comparten hex.
    const byHex = (cands) => {
      if (!oldHex) return null;
      const mh = cands.filter(x => x.meta && String(x.meta.hex || '').toLowerCase() === oldHex);
      return mh.length === 1 ? mh[0].code : null;
    };
    const wanted = normBridge(old.label);
    if (wanted) {
      const matches = l.filter(x => normBridge(x.label) === wanted);
      if (matches.length === 1) return matches[0].code;
      if (matches.length > 1) return byHex(matches); // nombre ambiguo → que decida la muestra exacta
    }
    // Sin nombre útil (entrada vieja solo con su muestra de color, p. ej. código '5' sin etiqueta)
    return byHex(l);
  }
  const REMAP_FIELDS = [['category', 'cat'], ['sleeve', 'manga'], ['fabric', 'tela'], ['color', 'color'], ['neck', 'cuello']];
  let lastRemap = { fixed: 0, orphans: 0, detail: [] };
  // Pase de reparación: re-vincula códigos huérfanos de TODOS los productos (campos del sistema,
  // hilos del bordado y catálogos custom). No toca el SKU (congelado por diseño: el historial de
  // ventas referencia por SKU). Idempotente: la segunda pasada no cambia nada.
  function remapOrphanCodes() {
    let fixed = 0, orphans = 0; const detail = [];
    const metaAll = (C && C.allCatalogMeta) ? C.allCatalogMeta() : {};
    const customKinds = Object.keys(metaAll).filter(k => metaAll[k].custom);
    products.forEach(p => {
      REMAP_FIELDS.forEach(([kind, field]) => {
        const l = (C && typeof C.list === 'function') ? C.list(kind) : [];
        if (!l.length) return;
        const cur = String(p[field] == null ? '' : p[field]);
        if (l.some(x => x.code === cur)) return;
        const nu = bridgeCode(kind, cur);
        if (nu) { detail.push({ sku: p.sku, kind, from: cur, to: nu }); p[field] = nu; fixed++; }
        else orphans++;
      });
      if (Array.isArray(p.ornColors) && p.ornColors.length) {
        const lc = (C && typeof C.list === 'function') ? C.list('color') : [];
        if (lc.length) {
          const seen = {};
          p.ornColors = p.ornColors.map(c => {
            if (lc.some(x => x.code === c)) return c;
            const nu = bridgeCode('color', c);
            if (nu) { detail.push({ sku: p.sku, kind: 'ornColors', from: c, to: nu }); fixed++; return nu; }
            orphans++; return c;
          }).filter(c => (seen[c] ? false : (seen[c] = true)));
        }
      }
      customKinds.forEach(k => {
        const v = (p.attrs || {})[k];
        if (v == null || v === '') return;
        const l = C.list(k);
        if (!l.length || l.some(x => x.code === String(v))) return;
        const nu = bridgeCode(k, v);
        if (nu) { detail.push({ sku: p.sku, kind: k, from: v, to: nu }); p.attrs[k] = nu; fixed++; }
        else orphans++;
      });
      colorDisplay(p);
    });
    lastRemap = { fixed, orphans, detail };
    if (fixed) {
      saveProducts();
      if (window.UI && window.UI.toast) window.UI.toast(fixed + ' referencia(s) de producto re-vinculadas al catálogo por nombre', 'var(--accent)');
    }
    return lastRemap;
  }

  // Radiografía de catálogos para el admin (Configuración → Catálogos de producto):
  //   duplicates → nombres repetidos entre códigos ACTIVOS del mismo catálogo (bloquean la
  //                re-vinculación automática: con 2 candidatos el puente no adivina);
  //   orphans    → cada referencia de producto a un código que ya no está activo, con su nombre
  //                viejo y los candidatos activos por nombre (0 = sin equivalente, 2+ = ambiguo).
  function catalogHealthReport() {
    const metaAll = (C && C.allCatalogMeta) ? C.allCatalogMeta() : {};
    const customKinds = Object.keys(metaAll).filter(k => metaAll[k].custom);
    const kinds = REMAP_FIELDS.map(x => x[0]).concat(customKinds);
    const duplicates = [];
    kinds.forEach(kind => {
      const by = {};
      (C.list(kind) || []).forEach(it => { const n = normBridge(it.label); (by[n] = by[n] || []).push(it); });
      Object.keys(by).forEach(n => { if (n && by[n].length > 1) duplicates.push({ kind, label: by[n][0].label, codes: by[n].map(x => x.code) }); });
    });
    const orphans = [];
    const check = (p, kind, code, campo) => {
      const l = C.list(kind); if (!l.length) return;
      const cur = String(code == null ? '' : code);
      if (l.some(x => x.code === cur)) return;
      const old = (C && C.find) ? C.find(kind, cur) : null;
      const wanted = old ? normBridge(old.label) : '';
      const cands = wanted ? l.filter(x => normBridge(x.label) === wanted).map(x => x.code) : [];
      orphans.push({ id: p.id, producto: p.nombre, sku: p.sku, kind, campo, code: cur, oldLabel: old ? old.label : '', oldHex: (old && old.meta && old.meta.hex) || '', candidates: cands });
    };
    products.forEach(p => {
      REMAP_FIELDS.forEach(([kind, field]) => check(p, kind, p[field], field));
      (p.ornColors || []).forEach(c => check(p, 'color', c, 'ornColors'));
      customKinds.forEach(k => { const v = (p.attrs || {})[k]; if (v != null && v !== '') check(p, k, v, k); });
    });
    return { orphans, duplicates };
  }

  // Corrección manual puntual desde el Diagnóstico: cambia UNA referencia huérfana de un
  // producto al código ACTIVO elegido por el admin. No toca el SKU congelado.
  function applyOrphanFix(id, campo, from, to) {
    const p = products.find(x => x.id === id);
    if (!p) return { ok: false, error: 'Producto no encontrado' };
    try { assertLayawayProductsUnlocked([id]); }
    catch (e) { return { ok: false, error: e.message, code: e.code }; }
    const sys = REMAP_FIELDS.find(x => x[1] === campo);
    const kind = campo === 'ornColors' ? 'color' : (sys ? sys[0] : campo);
    if (!C.list(kind).some(x => x.code === String(to))) return { ok: false, error: 'Elige un valor del catálogo' };
    if (campo === 'ornColors') {
      const seen = {};
      p.ornColors = (p.ornColors || []).map(c => c === from ? to : c).filter(c => (seen[c] ? false : (seen[c] = true)));
    } else if (sys) {
      p[campo] = to;
    } else {
      p.attrs = Object.assign({}, p.attrs, { [campo]: to });
    }
    colorDisplay(p);
    saveProducts();
    return { ok: true };
  }

  // Diccionario nombre→#hex para "Corregir # por nombre" (Configuración → catálogo Color).
  // Las frases compuestas van PRIMERO ('azul marino' debe ganar antes que 'azul'); dentro de
  // los sueltos, los específicos antes que los genéricos. Primer match (por contención sobre el
  // nombre normalizado) gana. Nombre no reconocido → null (el admin lo ajusta con el selector).
  const COLOR_DICT = [
    ['blanco ostion', '#e8ddc8'], ['vino tinto', '#722030'],
    ['azul marino', '#1e2a44'], ['azul rey', '#1e3fbf'], ['azul cielo', '#7db3e8'], ['azul celeste', '#9cc7f0'],
    ['azul acero', '#4a6b8a'], ['azul petroleo', '#16404d'], ['azul turquesa', '#2ab5b0'], ['azul mezclilla', '#3a4d6b'],
    ['verde botella', '#17493b'], ['verde bandera', '#17703f'], ['verde limon', '#9fcf3a'], ['verde militar', '#5f6b3a'],
    ['verde olivo', '#6b6b3a'], ['verde menta', '#9adbb4'], ['verde esmeralda', '#2e9e6b'], ['verde jade', '#37a47f'], ['verde agua', '#7fd4cf'],
    ['gris oxford', '#4a4e57'], ['gris perla', '#c9ccd1'],
    ['rosa mexicano', '#e0218a'], ['rosa pastel', '#f2c4d0'],
    ['multicolor', '#9e9e9e'], ['mezclilla', '#3a4d6b'], ['denim', '#3a4d6b'], ['turquesa', '#2ab5b0'],
    ['aguamarina', '#7fd4cf'], ['esmeralda', '#2e9e6b'], ['chocolate', '#4a2f24'], ['mandarina', '#f08a2c'],
    ['lavanda', '#c3a8e0'], ['durazno', '#f2b48c'], ['mostaza', '#d1a52a'], ['plateado', '#c8ccd2'],
    ['dorado', '#caa83a'], ['celeste', '#9cc7f0'], ['petroleo', '#16404d'], ['cobalto', '#1f4dbf'],
    ['militar', '#5f6b3a'], ['marfil', '#f2ead6'], ['ostion', '#e8ddc8'], ['guinda', '#7a1f33'],
    ['salmon', '#f0937c'], ['fucsia', '#d1258c'], ['fiusha', '#d1258c'], ['violeta', '#7a4bc8'],
    ['morado', '#6a3d9a'], ['purpura', '#6a3d9a'], ['blanco', '#f6f6f6'], ['hueso', '#efe9dc'],
    ['crudo', '#ede3cf'], ['beige', '#d8c4a0'], ['arena', '#c9b896'], ['camel', '#b98a52'],
    ['negro', '#1c1f24'], ['plata', '#c8ccd2'], ['perla', '#c9ccd1'], ['acero', '#4a6b8a'],
    ['marino', '#1e2a44'], ['cielo', '#7db3e8'], ['gris', '#8b9099'], ['limon', '#9fcf3a'],
    ['menta', '#9adbb4'], ['olivo', '#6b6b3a'], ['jade', '#37a47f'], ['verde', '#3d8c5a'],
    ['azul', '#2456a6'], ['rojo', '#b23b3b'], ['tinto', '#722030'], ['vino', '#6b2230'],
    ['coral', '#e87461'], ['rosa', '#d99bb0'], ['lila', '#b790d4'], ['amarillo', '#f5d327'],
    ['naranja', '#e8762c'], ['melon', '#e8a06a'], ['cafe', '#5a4334'], ['kaki', '#7a7250'],
    ['caqui', '#7a7250'], ['khaki', '#7a7250'], ['oro', '#caa83a'],
  ];
  function hexForColorName(label) {
    const n = normBridge(label);
    if (!n) return null;
    for (let i = 0; i < COLOR_DICT.length; i++) if (n.indexOf(COLOR_DICT[i][0]) >= 0) return COLOR_DICT[i][1];
    return null;
  }

  // ---- Persistencia ----
  const LS_KEY = 'balam_pos_products_v2';
  const LS_SALE_COMMIT_JOURNAL_LEGACY = 'balam_pos_sale_commit_journal_v1';
  const LS_SALE_COMMIT_JOURNAL_PREFIX = 'balam_pos_sale_commit_journal_v2:';
  const LS_LAYAWAY_PRODUCT_LOCKS = 'balam_pos_layaway_product_locks_v1';
  const LOCAL_WRITER_LOCK = 'balam-pos-local-writer-v1';
  const localWriterLeaseSupported = !!(window.navigator && window.navigator.locks
    && typeof window.navigator.locks.request === 'function');
  let localWriterState = localWriterLeaseSupported ? 'waiting' : 'unsupported';
  let localWriterRelease = null;
  let localWriterWarningShown = false;
  const localWriterWaiters = [];
  function setLocalWriterState(state) {
    localWriterState = state;
    if (state === 'writer' || state === 'unsupported' || state === 'blocked') {
      const waiters = localWriterWaiters.splice(0);
      waiters.forEach(resolve => resolve(state === 'writer' || state === 'unsupported'));
    }
    try { window.dispatchEvent(new CustomEvent('localwriterchange', { detail: { state } })); }
    catch (e) { /* navegador/arnés sin CustomEvent */ }
  }
  function localWriterAllowed(requireLease) {
    return localWriterState === 'writer'
      || (!requireLease && localWriterState === 'unsupported');
  }
  function assertLocalWriter(requireLease = false) {
    if (localWriterAllowed(requireLease)) return true;
    const error = new Error(requireLease && !localWriterLeaseSupported
      ? 'Este navegador no puede garantizar una liquidación segura entre pestañas'
      : 'Otra pestaña tiene el control de escritura; ciérrala o espera el relevo automático');
    error.code = requireLease && !localWriterLeaseSupported
      ? 'LOCAL_WRITER_UNSUPPORTED' : 'LOCAL_WRITER_REQUIRED';
    if (!localWriterWarningShown && window.UI && window.UI.toast) {
      localWriterWarningShown = true;
      window.UI.toast(error.message, 'var(--danger)');
    }
    throw error;
  }
  function awaitLocalWriter(timeout = 250) {
    if (localWriterAllowed(false)) return Promise.resolve(true);
    if (localWriterState === 'blocked') return Promise.resolve(false);
    return new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      localWriterWaiters.push(finish);
      setTimeout(() => finish(localWriterAllowed(false)), Math.max(0, Number(timeout) || 0));
    });
  }
  function saleCommitJournalKey(commitId) {
    return LS_SALE_COMMIT_JOURNAL_PREFIX + String(commitId || '').trim();
  }
  function readPendingSaleCommitJournal() {
    const found = [];
    try {
      const legacy = localStorage.getItem(LS_SALE_COMMIT_JOURNAL_LEGACY);
      if (legacy) found.push({ key: LS_SALE_COMMIT_JOURNAL_LEGACY, raw: legacy });
      for (let i = 0; i < Number(localStorage.length || 0); i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(LS_SALE_COMMIT_JOURNAL_PREFIX)) {
          found.push({ key, raw: localStorage.getItem(key) });
        }
      }
      if (!found.length) return null;
      if (found.length !== 1) return { version: 0, invalid: true, multiple: true };
      const parsed = JSON.parse(found[0].raw);
      if (!parsed || parsed.version !== 1) return { version: 0, invalid: true, key: found[0].key };
      parsed.key = found[0].key;
      return parsed;
    } catch (e) {
      // Un journal ilegible significa que una confirmación pudo quedar a medias.
      // No se adivina el estado: la cola remota debe reconciliarlo.
      return { version: 0, invalid: true };
    }
  }
  let pendingSaleCommitJournal = readPendingSaleCommitJournal();
  let products;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved) && saved.length) products = saved.map(hydrate);
    }
  } catch (e) { /* ignora storage corrupto */ }
  if (!products) products = seed.map(hydrate);

  // colorHex/colorName se congelan al hidratar, pero el catálogo de color puede cambiar DESPUÉS
  // (pull de la nube tras el login, import de catálogos, edición del hex). Sin esto, el inventario
  // se queda con puntos grises (#8b9099) y el código crudo en vez del nombre. OJO: solo se
  // recalculan estos dos campos de display — el SKU sigue congelado por diseño.
  window.addEventListener('configchange', () => {
    products.forEach(colorDisplay);
    // Sana referencias huérfanas cuando el catálogo cambió (import de catálogos, edición del
    // admin, pull de la nube). Guarda: no correr a media aplicación de datos remotos.
    if (!remoteApplying) { try { remapOrphanCodes(); } catch (e) { /* catálogo a medio cargar */ } }
  });

  const catalogResyncReasons = new Map();
  if (pendingSaleCommitJournal) {
    catalogResyncReasons.set('h65-cache', 'Una liquidación confirmada requiere reconciliar su caché local');
  }
  let catalogResyncRequired = catalogResyncReasons.size > 0;
  let catalogResyncReason = [...catalogResyncReasons.values()].join(' ');
  function refreshCatalogResync() {
    catalogResyncRequired = catalogResyncReasons.size > 0;
    catalogResyncReason = [...catalogResyncReasons.values()].join(' ');
  }
  function requireCatalogResync(reason, token = 'general') {
    catalogResyncReasons.set(token,
      reason || 'No se pudo conservar la respuesta autoritativa del inventario');
    refreshCatalogResync();
  }
  function clearCatalogResync(token = 'general') {
    if (token === 'h65-cache' && pendingSaleCommitJournal) return false;
    catalogResyncReasons.delete(token);
    refreshCatalogResync();
    return !catalogResyncReasons.has(token);
  }
  function saveProducts(sync = true) {
    if (!remoteApplying && !protectLayawayLockedProducts()) return false;
    let persisted = true;
    try { localStorage.setItem(LS_KEY, JSON.stringify(products)); }
    catch (e) { persisted = false; requireCatalogResync('La caché local del inventario no se pudo actualizar', 'products-cache'); }
    if (sync && typeof syncUp === 'function') syncUp('products', products);
    return persisted;
  }

  // Recalcula el SKU de TODOS los productos con la receta vigente (acción explícita del admin).
  // El SKU normalmente está congelado; esto lo fuerza. Devuelve cuántos cambiaron.
  // Además NORMALIZA códigos huérfanos (el catálogo ya no tiene ese código ACTIVO):
  //   1) puente por NOMBRE: el código viejo suele seguir en el catálogo desactivado (nunca se
  //      borra); si su etiqueta coincide con un elemento activo (re-codificación del catálogo,
  //      p. ej. color '15'→'AMAR' ambos "AZUL MARINO"), remapea a ese código;
  //   2) si no hay coincidencia, primer elemento activo — el que el alta mostraba seleccionado.
  function regenerateSkus() {
    const FIX = [['category', 'cat'], ['sleeve', 'manga'], ['fabric', 'tela'], ['color', 'color'], ['neck', 'cuello']];
    const normTxt = (s) => String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    let changed = 0, fixed = 0;
    products.forEach(p => {
      FIX.forEach(([kind, field]) => {
        const l = (C && typeof C.list === 'function') ? C.list(kind) : [];
        if (l.length && !l.some(x => x.code === String(p[field]))) {
          const old = (C && C.find) ? C.find(kind, String(p[field])) : null;
          const match = old ? l.find(x => normTxt(x.label) === normTxt(old.label)) : null;
          p[field] = match ? match.code : l[0].code; fixed++;
        }
      });
      colorDisplay(p);
      const n = sku(p);
      if (n !== p.sku) { p.sku = n; changed++; }
    });
    if (changed || fixed) saveProducts();
    return { total: products.length, changed };
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
        LS_SALES = 'balam_pos_sales_v1', LS_MOVES = 'balam_pos_moves_v1',
        // LS_FOLIO: contador global anterior a H-33 (sólo se limpia). LS_FOLIO_V2:
        // reserva diaria vigente { prefix, date, used, next, until }.
        LS_FOLIO = 'balam_pos_folio_v1', LS_FOLIO_V2 = 'balam_pos_folio_v2',
        LS_PROMOS = 'balam_pos_promos_v1', LS_LIQ = 'balam_pos_liq_v1', LS_PERIODO = 'balam_pos_periodo_v1',
        LS_RETURNS = 'balam_pos_returns_v1', LS_PAYMENTS = 'balam_pos_payments_v1',
        LS_EXCHANGES = 'balam_pos_exchanges_v1', LS_LOANS = 'balam_pos_loans_v1';
  const sellers = loadArr(LS_SELLERS, seedSellers);
  const clients = loadArr(LS_CLIENTS, seedClients);
  const sales = loadArr(LS_SALES, seedSales);
  const movements = loadArr(LS_MOVES, seedMovements);
  const promos = loadArr(LS_PROMOS, seedPromos);
  const liquidations = loadArr(LS_LIQ, []); // historial de pagos de comisión (corte/liquidación) — local
  const returns = loadArr(LS_RETURNS, seedReturns); // devoluciones (cabecera + renglones) — sincroniza a pos.returns
  const payments = loadArr(LS_PAYMENTS, []); // movimientos reales de dinero por venta
  // H-37 (C4): documentos de cambio. Cada renglon lleva `lado`: 'devuelto' consume
  // unidades de la venta origen y 'entregado' las suministra. Ver
  // docs/04-contrato-del-cambio.md y ADR-010. Esta fase define el modelo; el
  // commit transaccional (C5) y la interfaz (C6) son historias posteriores.
  const exchanges = loadArr(LS_EXCHANGES, []);
  // H-46: préstamos de mercancía. Colección local sin contrato remoto todavía; su
  // modelo y sus autoridades viven más abajo, en la sección «préstamos».
  const loans = loadArr(LS_LOANS, []);

  function indexedSnapshots(arr, predicate) {
    const snapshots = [];
    arr.forEach((value, index) => {
      if (predicate(value)) snapshots.push({ index, value: JSON.parse(JSON.stringify(value)) });
    });
    return snapshots;
  }
  function restoreIndexedSnapshots(arr, predicate, snapshots) {
    for (let i = arr.length - 1; i >= 0; i--) if (predicate(arr[i])) arr.splice(i, 1);
    (snapshots || []).slice().sort((a, b) => a.index - b.index).forEach(entry => {
      const value = JSON.parse(JSON.stringify(entry.value));
      arr.splice(Math.max(0, Math.min(Number(entry.index) || 0, arr.length)), 0, value);
    });
  }
  function restoreSaleCommitJournal(journal) {
    if (!journal || journal.version !== 1 || !journal.folio) return false;
    const productIds = new Set(journal.productIds || []);
    const sellerIds = new Set(journal.sellerIds || []);
    restoreIndexedSnapshots(products, p => productIds.has(p.id), journal.products);
    restoreIndexedSnapshots(sales, s => s.folio === journal.folio, journal.sales);
    restoreIndexedSnapshots(payments, p => p.folio === journal.folio, journal.payments);
    restoreIndexedSnapshots(movements,
      m => m.ref === journal.folio && m.tipo === 'Venta', journal.movements);
    restoreIndexedSnapshots(sellers, s => sellerIds.has(s.id), journal.sellers);
    return true;
  }
  function makeSaleCommitJournal(commitId, folio, reservationOperationId, remoteProducts, remoteSellers) {
    const productIds = [...new Set((remoteProducts || []).map(p => p.id).filter(Boolean))];
    const sellerIds = [...new Set((remoteSellers || []).map(s => s.id).filter(Boolean))];
    const productSet = new Set(productIds), sellerSet = new Set(sellerIds);
    return {
      version: 1,
      commitId,
      folio,
      reservationOperationId,
      productIds,
      sellerIds,
      products: indexedSnapshots(products, p => productSet.has(p.id)),
      sales: indexedSnapshots(sales, s => s.folio === folio),
      payments: indexedSnapshots(payments, p => p.folio === folio),
      movements: indexedSnapshots(movements, m => m.ref === folio && m.tipo === 'Venta'),
      sellers: indexedSnapshots(sellers, s => sellerSet.has(s.id)),
    };
  }

  function readLayawayProductLocks() {
    try {
      const parsed = JSON.parse(localStorage.getItem(LS_LAYAWAY_PRODUCT_LOCKS) || '[]');
      return Array.isArray(parsed) ? parsed.filter(lock => lock && lock.operationId) : [];
    } catch (e) { return []; }
  }
  function writeLayawayProductLocks(locks) {
    try {
      if (locks.length) localStorage.setItem(LS_LAYAWAY_PRODUCT_LOCKS, JSON.stringify(locks));
      else localStorage.removeItem(LS_LAYAWAY_PRODUCT_LOCKS);
      return true;
    } catch (e) { return false; }
  }
  function layawayProductIds(sale) {
    return [...new Set(((sale && sale.lineas) || []).map(line => line.productId).filter(Boolean))];
  }
  function cachedLayawayProducts(productIds) {
    try {
      const parsed = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
      if (!Array.isArray(parsed) || !parsed.length) return null;
      const snapshots = productIds.map(id => parsed.find(product => product.id === id));
      return snapshots.every(Boolean)
        ? snapshots.map(product => JSON.parse(JSON.stringify(product))) : null;
    } catch (e) { return null; }
  }
  function acquireLayawayProductLock(sale) {
    try { assertLocalWriter(true); } catch (e) { return false; }
    const operationId = sale && sale._operationId;
    const productIds = layawayProductIds(sale);
    if (!operationId || !productIds.length) return false;
    const locks = readLayawayProductLocks();
    const own = locks.find(lock => lock.operationId === operationId);
    if (own) {
      if ((own.productIds || []).length !== productIds.length
          || !own.productIds.every(id => productIds.includes(id))) return false;
      const cached = cachedLayawayProducts(productIds);
      if (!cached || productIds.some(id => {
        const memory = products.find(product => product.id === id);
        const stored = cached.find(product => product.id === id);
        return !memory || !stored || JSON.stringify(memory) !== JSON.stringify(stored);
      })) return false;
      // Un pull remoto puede avanzar el producto mientras la RPC se reintenta.
      // El lock sigue protegiendo la identidad, pero su snapshot debe rebajarse
      // al cache durable para no restaurar una versión anterior en saveProducts().
      own.productSnapshots = cached;
      own.refreshedAt = new Date().toISOString();
      return writeLayawayProductLocks([own]);
    }
    // H-65 serializa todas las liquidaciones locales. Aunque usen productos
    // distintos, las cinco colecciones se persisten como una sola unidad.
    if (locks.length) return false;

    // Otra pestaña pudo persistir una edición justo antes de esta acción.
    // No se inicia la RPC sobre una copia que ya difiere del cache compartido.
    const productSnapshots = cachedLayawayProducts(productIds);
    if (!productSnapshots || productIds.some(id => {
      const memory = products.find(product => product.id === id);
      const cached = productSnapshots.find(product => product.id === id);
      return !memory || !cached || JSON.stringify(memory) !== JSON.stringify(cached);
    })) return false;
    if (productSnapshots.length !== productIds.length) return false;
    const next = [{
      operationId, folio: sale.folio, productIds, productSnapshots,
      createdAt: new Date().toISOString(),
    }];
    if (!writeLayawayProductLocks(next)) return false;
    const verified = readLayawayProductLocks().find(lock => lock.operationId === operationId);
    return !!verified && verified.productIds.length === productIds.length;
  }
  function releaseLayawayProductLock(operationId) {
    const locks = readLayawayProductLocks();
    const next = locks.filter(lock => lock.operationId !== operationId);
    return next.length === locks.length || writeLayawayProductLocks(next);
  }
  function reconcileLayawayProductLocks(operations) {
    try { assertLocalWriter(true); } catch (e) { return false; }
    const active = (operations || []).filter(op => op && op.operationId);
    const current = readLayawayProductLocks();
    const chosen = active.find(op => current.some(lock => lock.operationId === op.operationId))
      || active[0];
    if (!chosen) return writeLayawayProductLocks([]);
    const retained = current.find(lock => lock.operationId === chosen.operationId);
    if (retained && !writeLayawayProductLocks([retained])) return false;
    if (!retained && !writeLayawayProductLocks([])) return false;
    return ensureLayawayProductLockFromOperation(chosen);
  }
  function ensureLayawayProductLockFromOperation(op) {
    try { assertLocalWriter(true); } catch (e) { return false; }
    if (!op || !op.operationId) return false;
    const productIds = [...new Set((op.productIds || (op.itemIdentities || [])
      .map(item => item.product_id)).filter(Boolean))];
    if (!productIds.length) return false;
    const own = readLayawayProductLocks().find(lock => lock.operationId === op.operationId);
    if (!own) {
      const expected = Array.isArray(op.productSnapshots) ? op.productSnapshots : [];
      const cached = cachedLayawayProducts(productIds);
      if (expected.length !== productIds.length || !cached
          || productIds.some(id => JSON.stringify(expected.find(p => p.id === id))
            !== JSON.stringify(cached.find(p => p.id === id)))) return false;
    }
    return acquireLayawayProductLock({
      _operationId: op.operationId, folio: op.folio,
      lineas: productIds.map(productId => ({ productId })),
    });
  }
  function layawayProductLockSnapshot(operationId) {
    const lock = readLayawayProductLocks().find(entry => entry.operationId === operationId);
    return lock ? JSON.parse(JSON.stringify(lock)) : null;
  }
  function hasLayawayLiquidationLock(folio, operationId) {
    return readLayawayProductLocks().some(lock =>
      (folio && lock.folio === folio) || (operationId && lock.operationId === operationId));
  }
  function refreshLayawayProductLockSnapshots() {
    const locks = readLayawayProductLocks();
    if (!locks.length) return true;
    const refreshed = locks.map(lock => Object.assign({}, lock, {
      productSnapshots: (lock.productIds || []).map(id => products.find(p => p.id === id))
        .filter(Boolean).map(product => JSON.parse(JSON.stringify(product))),
      refreshedAt: new Date().toISOString(),
    }));
    if (refreshed.some(lock => lock.productSnapshots.length !== (lock.productIds || []).length)) return false;
    return writeLayawayProductLocks(refreshed);
  }
  function assertLayawayProductsUnlocked(productIds) {
    const wanted = new Set((productIds || []).filter(Boolean));
    const conflict = readLayawayProductLocks().find(lock =>
      (lock.productIds || []).some(id => wanted.has(id)));
    if (!conflict) return true;
    const error = new Error(`El producto está en una liquidación pendiente (${conflict.folio}); espera su confirmación`);
    error.code = 'LAYAWAY_PRODUCT_LOCKED';
    throw error;
  }
  let layawayLockWarned = false;
  function protectLayawayLockedProducts() {
    const locks = readLayawayProductLocks();
    let restored = false;
    locks.forEach(lock => (lock.productSnapshots || []).forEach(snapshot => {
      const index = products.findIndex(p => p.id === snapshot.id);
      if (index >= 0 && JSON.stringify(products[index]) !== JSON.stringify(snapshot)) {
        products[index] = hydrate(JSON.parse(JSON.stringify(snapshot)));
        restored = true;
      }
    }));
    if (restored && !layawayLockWarned) {
      layawayLockWarned = true;
      if (window.UI && window.UI.toast) {
        window.UI.toast('Ese producto tiene una liquidación pendiente; no se modificó hasta reconciliarla', 'var(--danger)');
      }
    }
    return !restored;
  }
  if (pendingSaleCommitJournal) {
    restoreSaleCommitJournal(pendingSaleCommitJournal);
    requireCatalogResync('Una liquidación confirmada requiere reconciliar su caché local', 'h65-cache');
  }
  let periodoInicio = '';
  try { periodoInicio = localStorage.getItem(LS_PERIODO) || ''; } catch (e) { /* sin storage */ }

  // Normaliza personas guardadas antes de unificar usuarios/vendedores.
  sellers.forEach(s => { if (!s.role) s.role = 'vendedor'; if (s.active === undefined) s.active = true; });
  if (!sellers.some(s => s.role === 'admin')) sellers.unshift(seedSellers[0]);

  // Un solo dueño de escritura evita que dos pestañas persistan arreglos
  // completos a partir de memorias distintas. Al recibir el relevo se descarta
  // toda copia en memoria y se reconstruye desde el cache durable antes de
  // habilitar mutadores o drenar la cola.
  const localWriterCollections = [
    [LS_KEY, products, seed, hydrate], [LS_SELLERS, sellers, seedSellers],
    [LS_CLIENTS, clients, seedClients], [LS_SALES, sales, seedSales],
    [LS_MOVES, movements, seedMovements], [LS_PROMOS, promos, seedPromos],
    [LS_LIQ, liquidations, []], [LS_RETURNS, returns, seedReturns],
    [LS_PAYMENTS, payments, []], [LS_EXCHANGES, exchanges, []], [LS_LOANS, loans, []],
  ];
  const localWriterFallbacks = new Map(localWriterCollections.map(([key, , fallback]) =>
    [key, JSON.parse(JSON.stringify(fallback || []))]));
  function rebaseLocalWriterCollections() {
    try {
      localWriterCollections.forEach(([key, target, , mapper]) => {
        const raw = localStorage.getItem(key);
        const parsed = raw == null
          ? JSON.parse(JSON.stringify(localWriterFallbacks.get(key) || []))
          : JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error(`invalid_local_cache:${key}`);
        target.splice(0, target.length,
          ...parsed.map(row => mapper ? mapper(row) : row));
      });
      sellers.forEach(s => {
        if (!s.role) s.role = 'vendedor';
        if (s.active === undefined) s.active = true;
      });
      if (!sellers.some(s => s.role === 'admin')) sellers.unshift(JSON.parse(JSON.stringify(seedSellers[0])));
      pendingSaleCommitJournal = readPendingSaleCommitJournal();
      if (pendingSaleCommitJournal) {
        if (pendingSaleCommitJournal.invalid
            || !restoreSaleCommitJournal(pendingSaleCommitJournal)) {
          throw new Error('invalid_sale_commit_journal');
        }
        requireCatalogResync('Una liquidación confirmada requiere reconciliar su caché local', 'h65-cache');
      } else clearCatalogResync('h65-cache');
      return true;
    } catch (e) {
      requireCatalogResync('La caché local no pudo reconstruirse para tomar el control de escritura', 'h65-cache');
      return false;
    }
  }

  // Una persona pertenece al catálogo comercial sólo si conserva el contrato
  // activo de vendedor. Acepta ambos nombres del tombstone para cubrir filas
  // remotas aún no mapeadas y objetos locales normalizados.
  function isEligibleSeller(seller) {
    return !!seller
      && seller.active === true
      && seller.role === 'vendedor'
      && seller._deletedAt == null
      && seller.deleted_at == null;
  }

  // Autoridad única del porcentaje efectivo. Los perfiles anteriores a H-31
  // conservan comisionPct como dato heredado; los nuevos usan la precedencia
  // explícita personalizada → nivel comercial → configuración general.
  function resolveSellerCommission(seller) {
    const profile = seller || {};
    const numeric = value => {
      if (value === null || value === undefined || value === '') return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const overridePct = numeric(profile.commissionOverridePct);
    const globalPct = numeric(C.get('commission.basePct'));
    const policyVersion = Number(profile.commissionPolicyVersion) || 0;

    if (overridePct !== null) {
      return { effectivePct: overridePct, source: 'personalizada', level: null, policyVersion };
    }

    const levelCode = profile.sellerLevelCode == null ? null : String(profile.sellerLevelCode);
    const level = levelCode
      ? C.all('seller_role').find(item => item && String(item.code) === levelCode)
      : null;
    const levelPct = level && level.meta ? numeric(level.meta.commissionPct) : null;
    if (level && levelPct !== null) {
      return {
        effectivePct: levelPct,
        source: 'nivel',
        level: {
          code: level.code,
          label: level.label,
          active: level.active !== false,
        },
        policyVersion,
      };
    }

    const legacyPct = numeric(profile.comisionPct);
    if (policyVersion < 1 && legacyPct !== null) {
      return { effectivePct: legacyPct, source: 'heredada', level: null, policyVersion };
    }

    return {
      effectivePct: globalPct === null ? 0 : globalPct,
      source: 'general',
      level: null,
      policyVersion,
    };
  }

  let quotaWarned = false, bulkMode = false; // bulkMode: omite escrituras por-llamada durante una generación masiva
  const save = (key, arr) => {
    if (bulkMode) return true; // se persiste todo de una vez al final (ver seedDemo)
    try { localStorage.setItem(key, JSON.stringify(arr)); return true; }
    catch (e) {
      // Cuota de localStorage excedida (típico con muchas imágenes en base64): avisar una vez.
      if (!quotaWarned) {
        quotaWarned = true;
        if (window.UI && window.UI.toast) window.UI.toast('Almacenamiento local lleno. Reduce el peso de las imágenes de productos o inicia sesión para respaldar en la nube; algunos cambios podrían no guardarse en este dispositivo.', 'var(--danger)');
      }
      return false;
    }
  };
  // Sube cambios a la nube si el seam está activo (no durante aplicación de datos remotos).
  let remoteApplying = false;
  function syncUp(kind, arr) {
    if (remoteApplying) return;
    try { window.CORE.invokeSync('pushRows', kind, arr); } catch (e) { /* offline */ }
  }
  function saveSellers(sync = true) { const ok = save(LS_SELLERS, sellers); if (sync) syncUp('sellers', sellers); return ok; }
  function saveClients(sync = true) { const ok = save(LS_CLIENTS, clients); if (sync) syncUp('clients', clients); return ok; }
  // Alta rápida de cliente (desde el POS): nombre obligatorio, teléfono opcional. Si el teléfono ya
  // existe en otro cliente, REUSA ese (evita duplicados). Devuelve el cliente (nuevo o existente) o null.
  function addClient({ nombre, tel }) {
    const name = String(nombre || '').trim();
    if (!name) return null;
    const phone = String(tel || '').trim();
    if (phone) { const ex = clients.find(c => !c.generic && String(c.tel || '').trim() === phone); if (ex) return ex; }
    const c = { id: 'cli-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), nombre: name, tel: phone || '—', compras: 0, total: 0, ultima: '', talla: '', notas: '', generic: false };
    clients.unshift(c); saveClients();
    return c;
  }
  function saveSales() { return save(LS_SALES, sales); }       // ventas suben vía recordSale → STORE.pushSale
  function markSaleSync(folio, status, detail) {
    const sale = sales.find(s => s.folio === folio);
    if (!sale) return false;
    const changed = sale._syncStatus !== status
      || JSON.stringify(sale._syncDetail || null) !== JSON.stringify(detail || null);
    sale._syncStatus = status;
    if (detail) sale._syncDetail = detail;
    else delete sale._syncDetail;
    if (status === 'synced' && detail
        && (detail.stockReserved === true || detail.stock_reserved === true)) {
      sale._stockReserved = true;
    }
    saveSales();
    return changed;
  }
  function saveMovements() { return save(LS_MOVES, movements); }
  function savePromos() { save(LS_PROMOS, promos); syncUp('promotions', promos); }
  function saveLiquidations() { save(LS_LIQ, liquidations); syncUp('liquidations', liquidations); } // historial — sincroniza a pos.liquidations
  function saveReturns() { save(LS_RETURNS, returns); }  // devoluciones suben vía recordReturn → STORE.pushReturn
  function savePayments(sync = true) { const ok = save(LS_PAYMENTS, payments); if (sync) syncUp('payments', payments); return ok; }
  function saveExchanges(sync = true) { save(LS_EXCHANGES, exchanges); if (sync) syncUp('exchanges', exchanges); }
  // Sin `syncUp`: un préstamo NO viaja como upsert de tabla. Cada operación
  // —entrega, devolución, faltante, edición, baja, reapertura— viaja por su
  // propia transacción idempotente `pos.commit_loan_operation()`, igual que la
  // venta viaja por `commit_sale`. Ver `pushLoanOperation` en `balam/store.jsx`.
  function saveLoans() { save(LS_LOANS, loans); }
  // Fusiona filas de la nube en el arreglo local por clave (upsert: actualiza las que
  // coinciden, agrega las nuevas, CONSERVA las no incluidas). Para pulls PARCIALES —
  // el pull de ventas es paginado (ventana reciente + apartados) — reemplazar el
  // arreglo (applyRemote) borraría el histórico local que Reportes, Clientes y
  // Devoluciones consultan. La fila de la nube gana en conflicto (es la verdad de ese folio).
  function mergeRemote(kind, rows, key) {
    const M = { sales: [sales, saveSales], returns: [returns, saveReturns] };
    const m = M[kind]; if (!m || !rows || !rows.length) return;
    remoteApplying = true;
    try {
      const arr = m[0];
      const idx = {}; arr.forEach((x, i) => { idx[x[key]] = i; });
      rows.forEach(r => { const i = idx[r[key]]; if (i !== undefined) arr[i] = r; else arr.push(r); });
      arr.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
      m[1]();
    } finally { remoteApplying = false; }
  }

  // Reemplaza un arreglo de dominio con datos de la nube (sin re-empujar).
  function applyRemote(kind, rows) {
    const M = { products: [products, saveProducts, hydrate], clients: [clients, saveClients], sellers: [sellers, saveSellers], sales: [sales, saveSales], movements: [movements, saveMovements], promotions: [promos, savePromos], returns: [returns, saveReturns], liquidations: [liquidations, saveLiquidations], payments: [payments, savePayments], exchanges: [exchanges, saveExchanges] };
    // Los préstamos no se reemplazan: se fusionan conservando lo que la nube
    // todavía no confirmó (H-62).
    if (kind === 'loans') return applyRemoteLoans(rows);
    const m = M[kind]; if (!m) return;
    // Una respuesta vacía también puede ser una lectura parcial/fallida. Nunca
    // sacrifica un catálogo local existente; los borrados reales usan tombstones.
    if (kind === 'products' && products.length && (!Array.isArray(rows) || !rows.length)) return false;
    let persisted = true;
    remoteApplying = true;
    try {
      m[0].length = 0;
      rows.filter(r => !r._deletedAt).forEach(r => m[0].push(m[2] ? m[2](r) : r));
      persisted = m[1]() !== false;
    }
    finally { remoteApplying = false; }
    if (kind === 'products') {
      if (persisted) {
        if (!refreshLayawayProductLockSnapshots()) {
          requireCatalogResync('El lock de una liquidación pendiente no pudo rebajarse al catálogo remoto', 'h65-cache');
          return false;
        }
        clearCatalogResync('products-cache');
        clearCatalogResync('product-conflict');
      } else requireCatalogResync('El catálogo remoto no pudo persistirse en la caché local', 'products-cache');
    }
    // La nube puede no tener admin aún (antes de pos_003). Garantiza uno local y súbelo.
    if (kind === 'sellers' && !sellers.some(s => s.role === 'admin')) {
      sellers.unshift(JSON.parse(JSON.stringify(seedSellers[0])));
      saveSellers();
    }
    return persisted;
  }

  // ---- Motor de venta ----
  function now() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function newOperationId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) { /* fallback portable */ }
    return 'sale-' + window.CORE.getDeviceId() + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }
  // Representación compacta y estable del ID inmutable. Un UUID completo conserva
  // sus 128 bits en base 36; el fallback conserva toda su entropía alfanumérica.
  function operationToken(operationId) {
    const raw = String(operationId || newOperationId());
    const hex = raw.replace(/-/g, '');
    if (/^[0-9a-f]{32}$/i.test(hex) && typeof BigInt !== 'undefined') {
      return BigInt('0x' + hex).toString(36).toUpperCase().padStart(25, '0');
    }
    return raw.replace(/[^a-z0-9]/gi, '').toUpperCase();
  }
  function collisionSafeFolio(folio, operationId) {
    const token = operationToken(operationId);
    const current = String(folio || '').trim();
    return current.endsWith('-' + token) ? current : current + '-' + token;
  }

  // ── H-33: folio comercial corto ─────────────────────────────────────────────
  // El folio VISIBLE es {PREFIJO}-{YYMMDD}-{CONSECUTIVO}. No lleva identidad
  // técnica: ésa vive en `sale._operationId` (UUID inmutable) y nunca se deriva
  // del folio. La unicidad entre terminales la da un contador diario en Supabase:
  // cada terminal RESERVA un bloque de números y los entrega localmente, así una
  // venta offline conserva un folio corto y definitivo.
  //
  // CONTRATO DEL FOLIO IMPRESO: el valor que se imprime no cambia nunca. Cuando
  // no hay bloque reservado (sin red y sin reserva vigente) el folio incorpora un
  // CUARTO segmento con el código corto de esta terminal —`BG-260727-0001-K7Q`—,
  // que lo distingue de cualquier otra terminal y lo vuelve definitivo: no se
  // renombra al sincronizar. `folio_conflict` sobrevive como última defensa para
  // el residuo (dos terminales con el mismo código, u operaciones heredadas de
  // H-02); en ese caso el folio impreso se conserva para siempre en
  // `sale.folioAliases` y sigue sirviendo para buscar, devolver y reimprimir.
  const FOLIO_BLOCK = 10;     // números que se piden por reserva
  const FOLIO_REFILL_AT = 3;  // se repone cuando quedan estos o menos
  const FOLIO_RE = /^([A-Z0-9]{1,6})-(\d{6})-(\d{4,})(?:-([A-Z0-9]{2,4}))?$/;
  // Prefijo comercial seguro: mayúsculas, sólo A-Z0-9 y longitud acotada.
  function normalizeFolioPrefix(raw) {
    const clean = String(raw == null ? '' : raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    return clean || 'BG';
  }
  function folioPrefix() {
    return normalizeFolioPrefix(window.CONFIG && window.CONFIG.get('folio.prefix'));
  }
  // Fecha LOCAL del negocio (el día del mostrador), nunca UTC. Acepta la fecha ya
  // formateada de la venta ('YYYY-MM-DD HH:mm'): folio y fecha salen del MISMO
  // valor, así una venta cerca de la medianoche no queda partida entre dos días.
  function businessDate(date) {
    if (typeof date === 'string') {
      const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return m[1].slice(2) + m[2] + m[3];
    }
    const d = date instanceof Date ? date : new Date();
    const p = n => String(n).padStart(2, '0');
    return p(d.getFullYear() % 100) + p(d.getMonth() + 1) + p(d.getDate());
  }
  // Código corto y estable de esta terminal (3 caracteres base 36). Sólo aparece
  // en folios provisionales; es lo que impide que dos terminales sin bloque
  // impriman la misma cadena.
  function terminalCode(deviceId) {
    const id = String(deviceId == null ? window.CORE.getDeviceId() : deviceId);
    let hash = 2166136261; // FNV-1a de 32 bits
    for (let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0).toString(36).toUpperCase() + '00').slice(0, 3);
  }
  // Cuatro dígitos mínimos; a partir de 10000 crece sin truncarse ni repetirse.
  // `terminal` sólo se agrega en folios provisionales.
  function folioFromParts(prefix, date, seq, terminal) {
    const base = normalizeFolioPrefix(prefix) + '-' + String(date)
      + '-' + String(Math.max(1, Math.floor(Number(seq) || 0))).padStart(4, '0');
    const tag = String(terminal || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    return tag ? base + '-' + tag : base;
  }
  function parseFolio(folio) {
    const m = String(folio == null ? '' : folio).trim().toUpperCase().match(FOLIO_RE);
    return m
      ? { prefix: m[1], date: m[2], seq: parseInt(m[3], 10), terminal: m[4] || null, provisional: !!m[4] }
      : null;
  }
  function folioPreview(prefix, date) {
    return folioFromParts(normalizeFolioPrefix(prefix), date || businessDate(), 1);
  }
  // Reserva vigente de esta terminal. `used` es el piso local: un número entregado
  // no se vuelve a entregar aunque se borre la venta.
  function loadFolioState() {
    try {
      const raw = JSON.parse(localStorage.getItem(LS_FOLIO_V2));
      if (raw && typeof raw === 'object') {
        return {
          prefix: String(raw.prefix || ''), date: String(raw.date || ''),
          used: Number(raw.used) || 0, next: Number(raw.next) || 0, until: Number(raw.until) || 0,
        };
      }
    } catch (e) { /* sin storage o dato dañado */ }
    return { prefix: '', date: '', used: 0, next: 0, until: 0 };
  }
  function saveFolioState(state) {
    try { localStorage.setItem(LS_FOLIO_V2, JSON.stringify(state)); } catch (e) { /* cuota */ }
  }
  function folioStateFor(prefix, date) {
    const st = loadFolioState();
    return (st.prefix === prefix && st.date === date) ? st : { prefix, date, used: 0, next: 0, until: 0 };
  }
  // Mayor consecutivo del día ya conocido localmente, incluidas las ventas bajadas
  // de la nube: sirve de piso para no repetir un número de otra terminal.
  function maxKnownFolioSeq(prefix, date) {
    return sales.reduce((m, s) => {
      const p = parseFolio(s.folio);
      return p && p.prefix === prefix && p.date === date && p.seq > m ? p.seq : m;
    }, 0);
  }
  function takeFolioSeq(prefix, date) {
    const st = folioStateFor(prefix, date);
    let seq, reserved;
    if (st.next && st.next <= st.until) { seq = st.next; st.next = seq + 1; reserved = true; }
    else { seq = Math.max(st.used, maxKnownFolioSeq(prefix, date)) + 1; reserved = false; }
    if (seq > st.used) st.used = seq;
    saveFolioState(st);
    return { seq, reserved };
  }
  // Contrato con STORE: qué bloque hace falta y desde qué piso pedirlo.
  function folioBlockRequest() {
    const prefix = folioPrefix(), date = businessDate();
    const st = folioStateFor(prefix, date);
    const left = st.next && st.next <= st.until ? st.until - st.next + 1 : 0;
    return {
      prefix, date, left, count: FOLIO_BLOCK,
      floor: Math.max(st.used, maxKnownFolioSeq(prefix, date)),
      needed: left <= FOLIO_REFILL_AT,
    };
  }
  // Adopta un bloque confirmado por el servidor. Sólo avanza: nunca vuelve a un
  // número ya entregado por esta terminal.
  function applyFolioBlock(prefix, date, from, to) {
    const p = normalizeFolioPrefix(prefix), d = String(date || '');
    const f = Math.floor(Number(from) || 0), t = Math.floor(Number(to) || 0);
    if (!/^\d{6}$/.test(d) || !(f > 0) || !(t >= f)) return false;
    const st = folioStateFor(p, d);
    if (f <= st.used) return false;
    st.next = f; st.until = t;
    if (f - 1 > st.used) st.used = f - 1;
    saveFolioState(st);
    return true;
  }
  // Autoridad ÚNICA del folio comercial. `operationId` no participa en el valor
  // visible; se conserva en la firma porque el llamador ya generó la identidad.
  // Con bloque reservado devuelve el formato limpio; sin bloque agrega el código
  // de terminal y el resultado sigue siendo DEFINITIVO: no se renombra después.
  function nextFolio(operationId, fecha) {
    const prefix = folioPrefix(), date = businessDate(fecha);
    const taken = takeFolioSeq(prefix, date);
    const device = window.CORE.getDeviceId(); // identidad de terminal siempre presente
    const tag = taken.reserved ? null : terminalCode(device);
    // Reposición en segundo plano: jamás bloquea el cobro.
    try { window.CORE.invokeSync('ensureFolioBlock'); } catch (e) { /* offline */ }
    return folioFromParts(prefix, date, taken.seq, tag);
  }
  // ── Resolución por folio o alias ────────────────────────────────────────────
  // Autoridad única de "¿qué venta es este folio?". Un folio impreso que después
  // recibió otro identificador sigue resolviendo a su venta, y NUNCA se resuelve
  // a la venta ajena que casualmente comparta la cadena: la coincidencia exacta
  // por folio vigente tiene prioridad y el alias sólo se consulta después, contra
  // la venta que realmente lo imprimió.
  function saleFolioAliases(sale) {
    return Array.isArray(sale && sale.folioAliases) ? sale.folioAliases : [];
  }
  function findSaleByFolio(folioOrAlias) {
    const term = String(folioOrAlias == null ? '' : folioOrAlias).trim();
    if (!term) return null;
    const up = term.toUpperCase();
    return sales.find(s => s.folio === term)
      || sales.find(s => String(s.folio || '').toUpperCase() === up)
      || sales.find(s => saleFolioAliases(s).some(a => String(a).toUpperCase() === up))
      || null;
  }
  // ¿Este término encontró la venta por un folio anterior? La interfaz lo usa para
  // avisar con qué identificador quedó registrada finalmente.
  function folioAliasHit(sale, term) {
    const t = String(term == null ? '' : term).trim().toUpperCase();
    if (!t || !sale) return null;
    if (String(sale.folio || '').toUpperCase().includes(t)) return null;
    return saleFolioAliases(sale).find(a => String(a).toUpperCase().includes(t)) || null;
  }
  // Existencias disponibles de una talla en un producto.
  function stockOf(p, talla) {
    const hit = resolveProductSizes(p).sizes.find(s => String(s.value) === String(talla));
    return hit ? hit.stock : 0;
  }
  function stockVariantOf(p, talla) {
    const size = resolveProductSizes(p).sizes.find(s => String(s.value) === String(talla));
    if (!size) return null;
    return (p.stock || []).find(variant =>
      (!size.scale || variant.escala === size.scale)
      && String(variant.talla) === String(size.value)) || null;
  }

  // Registra una venta: descuenta stock, mueve inventario, actualiza cliente y vendedores.
  // ticket: [{ p, talla, qty }], sellerIds: [id], client: obj, metodo, estado, total, itemCount.
  const money = n => Math.round(Number(n) * 100) / 100;
  function paymentParts(metodo, monto, detail) {
    const d = detail || {}, amount = money(monto);
    const parts = {
      efectivo: money(d.efectivo || (metodo === 'Efectivo' ? amount : 0)),
      tarjeta: money(d.tarjeta || (metodo === 'Tarjeta' ? amount : 0)),
      transferencia: money(d.transferencia || (metodo === 'Transferencia' ? amount : 0)),
      otro: money(d.otro || 0),
    };
    if (Math.abs(money(parts.efectivo + parts.tarjeta + parts.transferencia + parts.otro) - amount) > 0.009) throw new Error('Los componentes del pago no coinciden con el monto');
    if (Object.values(parts).some(x => x < 0)) throw new Error('Los componentes del pago no pueden ser negativos');
    return parts;
  }
  // Reidentificación de último recurso. El folio anterior YA ESTÁ IMPRESO, así que
  // no se pierde: queda como alias histórico de la venta y sigue resolviendo
  // búsqueda, devolución y reimpresión. Sólo ocurre en el residuo (colisión de
  // códigos de terminal u operaciones heredadas de H-02).
  function rekeySaleFolio(operationId, oldFolio, newFolio) {
    const sale = sales.find(s => s._operationId === operationId && s.folio === oldFolio);
    if (!sale || sale._syncStatus === 'synced' || !newFolio || newFolio === oldFolio) return false;
    const aliases = (sale.folioAliases || []).slice();
    if (oldFolio && !aliases.includes(oldFolio)) aliases.push(oldFolio);
    sale.folioAliases = aliases.filter(a => a !== newFolio);
    sale.folio = newFolio;
    payments.forEach(p => { if (p.folio === oldFolio) p.folio = newFolio; });
    movements.forEach(m => { if (m.ref === oldFolio) m.ref = newFolio; });
    returns.forEach(r => { if (r.folio === oldFolio) r.folio = newFolio; });
    saveSales(); savePayments(false); saveMovements(); saveReturns();
    return true;
  }

  // Confirma el resultado devuelto por el servidor versionado. Una versión
  // expected+1 fue aceptada: conserva cambios locales posteriores y solo avanza
  // el reloj. Cualquier otra versión significa conflicto y la fila remota gana.
  function applySyncResult(kind, rows, expected, operation) {
    const M = {
      products: [products, saveProducts, hydrate],
      clients: [clients, saveClients],
      sellers: [sellers, saveSellers],
      promotions: [promos, savePromos],
    };
    const m = M[kind]; if (!m) return { conflicts: 0 };
    let conflicts = 0;
    remoteApplying = true;
    try {
      rows.forEach(remote => {
        const i = m[0].findIndex(x => x.id === remote.id);
        const base = Number(expected && expected[remote.id]) || 0;
        const accepted = Number(remote._syncVersion) === base + 1;
        if (accepted) {
          if (i >= 0) {
            m[0][i]._syncVersion = remote._syncVersion;
            m[0][i]._deletedAt = remote._deletedAt || null;
          }
          return;
        }
        conflicts++;
        if (remote._deletedAt) {
          if (i >= 0) m[0].splice(i, 1);
        } else if (i >= 0) {
          m[0][i] = m[2] ? m[2](remote) : remote;
        } else {
          m[0].push(m[2] ? m[2](remote) : remote);
        }
      });
      m[1]();
    } finally { remoteApplying = false; }
    if (kind === 'products' && conflicts) {
      requireCatalogResync('Otra terminal confirmó una versión distinta del inventario; se requiere resincronización', 'product-conflict');
    }
    return { conflicts, operation, requiresResync: kind === 'products' && conflicts > 0 };
  }

  // H-65: aplica como una sola unidad el snapshot que devolvió la liquidación
  // transaccional. No usa la heurística expected+1: para venta, productos,
  // pagos y movimiento de este folio la respuesta del servidor es la autoridad.
  // Si alguna escritura de caché falla, la operación permanece en cola y nuevas
  // ventas se bloquean hasta que un pull completo pueda persistir el catálogo.
  function applySaleCommitResult(commitId, folio, result) {
    try { assertLocalWriter(true); }
    catch (e) { return { ok: false, error: e.code || 'LOCAL_WRITER_REQUIRED' }; }
    commitId = String(commitId || '').trim();
    result = result || {};
    const authoritativeSale = result.sale;
    const stockReserved = result.stockReserved === true || result.stock_reserved === true;
    const reservationOperationId = result.reservationOperationId || result.reservation_operation_id || null;
    if (!commitId || !authoritativeSale || authoritativeSale.folio !== folio
        || authoritativeSale.estado !== 'Pagado') {
      return { ok: false, error: 'AUTHORITATIVE_SALE_MISSING' };
    }
    if (!stockReserved || !reservationOperationId) {
      return { ok: false, error: 'STOCK_RESERVATION_NOT_CONFIRMED' };
    }

    const remoteProducts = Array.isArray(result.products) ? result.products : [];
    const remoteSellers = Array.isArray(result.sellers) ? result.sellers : [];
    const requiredIds = new Set((authoritativeSale.lineas || [])
      .map(line => line.productId).filter(Boolean));
    if (!requiredIds.size
        || [...requiredIds].some(id => !remoteProducts.some(p => p.id === id))) {
      return { ok: false, error: 'AUTHORITATIVE_PRODUCTS_INCOMPLETE' };
    }

    // Bajo el lease cross-tab, toda colección se relee antes del journal. Así
    // los cambios no relacionados que otra pestaña confirmó antes del relevo no
    // se pierden al persistir la respuesta H-65.
    if (!rebaseLocalWriterCollections()) {
      return { ok: false, error: 'CACHE_REBASE_REQUIRED' };
    }
    const current = sales.find(s => s.folio === folio);
    const expectedOperationId = current && current._operationId;
    if (expectedOperationId && reservationOperationId !== expectedOperationId) {
      return { ok: false, error: 'STOCK_RESERVATION_NOT_CONFIRMED' };
    }

    const durableJournal = pendingSaleCommitJournal;
    const legacyReplay = durableJournal
      && durableJournal.key === LS_SALE_COMMIT_JOURNAL_LEGACY
      && !durableJournal.commitId
      && durableJournal.folio === folio
      && durableJournal.reservationOperationId === reservationOperationId;
    if (durableJournal && (durableJournal.invalid
        || (!legacyReplay && durableJournal.commitId !== commitId))) {
      requireCatalogResync('Otra liquidación espera reconciliar su caché local', 'h65-cache');
      return { ok: false, error: 'CACHE_JOURNAL_CONFLICT' };
    }
    const journalKey = durableJournal ? durableJournal.key : saleCommitJournalKey(commitId);
    const journal = durableJournal || makeSaleCommitJournal(
      commitId, folio, reservationOperationId, remoteProducts, remoteSellers
    );
    journal.key = journalKey;
    journal.commitId = journal.commitId || commitId;
    try {
      if (!durableJournal || legacyReplay) localStorage.setItem(journalKey, JSON.stringify(journal));
      const storedJournal = JSON.parse(localStorage.getItem(journalKey) || 'null');
      if (!storedJournal || storedJournal.commitId !== commitId
          || storedJournal.reservationOperationId !== reservationOperationId) {
        throw new Error('journal_not_verified');
      }
      pendingSaleCommitJournal = Object.assign(storedJournal, { key: journalKey });
    } catch (e) {
      requireCatalogResync('No se pudo preparar la confirmación local de la liquidación', 'h65-cache');
      return { ok: false, error: 'CACHE_JOURNAL_UNAVAILABLE' };
    }

    const restoreAfterCacheFailure = error => {
      restoreSaleCommitJournal(journal);
      try {
        if (!localStorage.getItem(journalKey)) {
          localStorage.setItem(journalKey, JSON.stringify(journal));
        }
        pendingSaleCommitJournal = Object.assign({}, journal, { key: journalKey });
      } catch (e) { /* el gate h65 conserva el bloqueo aunque storage esté lleno */ }
      // Restauración best-effort: el journal permanece como autoridad de
      // recuperación si una de estas claves sigue sin poder escribirse.
      saveProducts(false); saveSales(); savePayments(false); saveMovements(); saveSellers(false);
      requireCatalogResync('La confirmación remota de la liquidación no pudo persistirse completa', 'h65-cache');
      return { ok: false, error };
    };

    remoteApplying = true;
    try {
      remoteProducts.forEach(remote => {
        const i = products.findIndex(p => p.id === remote.id);
        const row = hydrate(remote);
        if (i >= 0) products[i] = row; else products.push(row);
      });

      const confirmedSale = Object.assign({}, authoritativeSale, {
        _stockRequired: true,
        _stockReserved: true,
        _syncStatus: 'synced',
        _syncDetail: {
          stockReserved: true,
          stockIdempotent: result.stockIdempotent === true || result.stock_idempotent === true,
          reservationOperationId,
        },
      });
      const saleIndex = sales.findIndex(s => s.folio === folio);
      if (saleIndex >= 0) sales[saleIndex] = confirmedSale;
      else sales.unshift(confirmedSale);

      payments.splice(0, payments.length,
        ...payments.filter(p => p.folio !== folio),
        ...(Array.isArray(result.payments) ? result.payments.slice().reverse() : []));
      payments.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

      movements.splice(0, movements.length,
        ...movements.filter(m => !(m.ref === folio && m.tipo === 'Venta')),
        ...(Array.isArray(result.movements) ? result.movements.slice().reverse() : []));
      movements.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));

      remoteSellers.forEach(remote => {
        const i = sellers.findIndex(s => s.id === remote.id);
        if (i >= 0) sellers[i] = remote; else sellers.push(remote);
      });

      const persisted = [
        saveProducts(false), saveSales(), savePayments(false), saveMovements(), saveSellers(false),
      ].every(Boolean);
      let verified = false;
      if (persisted) {
        try {
          verified = localStorage.getItem(LS_KEY) === JSON.stringify(products)
            && localStorage.getItem(LS_SALES) === JSON.stringify(sales)
            && localStorage.getItem(LS_PAYMENTS) === JSON.stringify(payments)
            && localStorage.getItem(LS_MOVES) === JSON.stringify(movements)
            && localStorage.getItem(LS_SELLERS) === JSON.stringify(sellers);
        } catch (e) { verified = false; }
      }
      if (!verified) return restoreAfterCacheFailure('CACHE_RESYNC_REQUIRED');
      try {
        localStorage.removeItem(journalKey);
        if (localStorage.getItem(journalKey) !== null) {
          throw new Error('journal_not_cleared');
        }
      } catch (e) { return restoreAfterCacheFailure('CACHE_JOURNAL_NOT_CLEARED'); }
      pendingSaleCommitJournal = null;
      releaseLayawayProductLock(reservationOperationId);
      clearCatalogResync('h65-cache');
      clearCatalogResync('products-cache');
      const confirmedPayment = (Array.isArray(result.payments) ? result.payments : [])
        .find(p => p.tipo === 'liquidacion') || null;
      return {
        ok: true, sale: confirmedSale,
        paymentId: confirmedPayment && confirmedPayment.id,
      };
    } finally { remoteApplying = false; }
  }
  function salePaymentDraft(sale, { monto, metodo, tipo, detalle, fecha }) {
    const amount = money(monto);
    if (!(amount > 0)) return null;
    const parts = paymentParts(metodo, amount, detalle);
    return {
      id: 'pay-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      folio: sale.folio, fecha: fecha || now(), tipo: tipo || 'pago',
      metodo, monto: amount, ...parts,
    };
  }
  function addSalePayment(sale, spec, sync = true) {
    const p = salePaymentDraft(sale, spec);
    if (!p) return null;
    payments.unshift(p);
    savePayments(sync);
    return p;
  }
  function paymentsForSale(folio) { return payments.filter(p => p.folio === folio).reverse().sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))); }
  function hasFinancialSnapshot(sale) { return !!sale && sale.subtotal != null && sale.iva != null && sale.descuento != null; }
  // H-32: resolución de descuento de un renglón. Devuelve el precio unitario efectivo y la
  // EVIDENCIA de las promociones que lo produjeron, copiada (no referenciada) para que la venta
  // siga siendo explicable aunque la promoción se edite o se elimine. Se calcula UNA sola vez,
  // en el Punto de Venta, y viaja con la línea hasta recordSale: el renglón es dueño de su precio.
  // No decide reglas comerciales — sólo conserva lo que el motor ya resolvió.
  // ── Precio por talla (H-36) ────────────────────────────────────────────────
  // Autoridad ÚNICA de «¿cuánto cuesta esta talla antes de promociones?».
  // `preciosTalla` es un mapa { talla: precio } de EXCEPCIONES: la ausencia de
  // una clave significa "vale el precio general del artículo", no "sin precio".
  // Un `0` explícito sí es un precio. Con el mapa vacío —el estado de todos los
  // artículos anteriores a H-36— el resultado es el precio general de siempre.
  function listPrice(product, talla) {
    const general = Number(product && product.precio) || 0;
    const mapa = product && product.preciosTalla;
    if (!mapa || typeof mapa !== 'object' || talla == null) return general;
    const v = mapa[talla];
    if (v == null || v === '') return general;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : general;
  }
  // Derivada de listPrice para el catálogo: qué precio anunciar antes de que el
  // cliente elija talla. Mira sólo las tallas con existencias, porque son las
  // que el POS deja vender; sin existencias cae al precio general.
  function priceRange(product) {
    const general = Number(product && product.precio) || 0;
    const conStock = resolveProductSizes(product).sizes.filter(v => v.active && Number(v.stock) > 0);
    if (!conStock.length) return { min: general, max: general, unico: true };
    const precios = conStock.map(v => listPrice(product, v.value));
    const min = Math.min.apply(null, precios);
    const max = Math.max.apply(null, precios);
    return { min, max, unico: min === max };
  }
  // Deja el mapa en su forma canónica: sólo tallas del catálogo vigente y sólo
  // precios utilizables. Se aplica al guardar; la lectura permanece tolerante.
  function sanitizePreciosTalla(mapa, product) {
    const resolved = product ? resolveProductSizes(product) : null;
    // Un histórico ambiguo no debe perder precios antes de que el administrador
    // elija categoría; conserva claves reconocidas en cualquiera de las escalas.
    const validas = resolved && !resolved.requiresAssignment
      ? resolved.sizes.map(s => String(s.value))
      : SIZES_LETRA().concat(SIZES_NUM()).map(String);
    const out = {};
    if (!mapa || typeof mapa !== 'object') return out;
    Object.keys(mapa).forEach(talla => {
      if (validas.indexOf(String(talla)) < 0) return;
      const n = Number(mapa[talla]);
      if (!Number.isFinite(n) || n < 0) return;
      out[talla] = Math.round(n * 100) / 100;
    });
    return out;
  }

  function resolveLineDiscount(product, talla) {
    const orig = listPrice(product, talla);
    const du = window.PROMOS ? window.PROMOS.lineUnit(product, talla, orig) : null;
    if (!du) return { orig, unit: orig, promos: [] };
    const promos = (Array.isArray(du.promos) ? du.promos : []).map(p => ({
      id: p.id, nombre: p.nombre, tipo: p.tipo || 'pct', valor: Number(p.valor) || 0,
    }));
    return { orig, unit: Number(du.unit) || 0, promos };
  }
  // H-52: autoridad única de «¿cuánto debe pagar esta venta y por qué?».
  // Recibe líneas cuya promoción configurada YA fue resuelta y aplicaciones
  // manuales. No consulta configuración: el resultado es una cotización
  // congelable que consumen POS, cobro, documento, ticket y posventa.
  function saleQuote(ticket, applications) {
    if (!Array.isArray(ticket) || !ticket.length) throw new Error('La cotización requiere artículos');
    const apps = Array.isArray(applications) ? applications : [];
    if (apps.length > 1 && apps.some(a => !a || a.combinable !== true)) {
      throw new Error('Este beneficio no puede combinarse con otro descuento adicional');
    }
    const lines = ticket.map((line, index) => {
      const qty = Number(line.qty);
      const res = line.res || {};
      const orig = money(res.orig);
      const unit = money(res.unit);
      if (!Number.isInteger(qty) || qty <= 0 || orig < 0 || unit < 0 || unit > orig) {
        throw new Error('El renglón de la cotización es inválido');
      }
      return {
        key: line.key == null ? String(index) : String(line.key), qty,
        res: { orig, unit, promos: Array.isArray(res.promos) ? JSON.parse(JSON.stringify(res.promos)) : [] },
        originalTotal: money(orig * qty), configuredTotal: money(unit * qty),
        remaining: money(unit * qty), additionalDiscount: 0,
      };
    });
    const originalTotal = money(lines.reduce((sum, line) => sum + line.originalTotal, 0));
    const beforeAdditionalTotal = money(lines.reduce((sum, line) => sum + line.configuredTotal, 0));
    const configuredDiscountTotal = money(originalTotal - beforeAdditionalTotal);
    const frozen = [];

    apps.forEach((raw, appIndex) => {
      const app = raw || {};
      const type = String(app.benefitType || '');
      const scope = app.scope === 'item' ? 'item' : 'ticket';
      const value = Number(app.value);
      if (app.origin === 'Otro' && !String(app.reason || '').trim()) throw new Error('El motivo es obligatorio');
      if (app.origin === 'Tarjeta física') {
        if (!String(app.cardFolio || '').trim()) throw new Error('El folio de la tarjeta es obligatorio');
        if (app.onlineVerified !== true) throw new Error('La tarjeta física requiere conexión y validación');
      }
      if (!['percentage', 'fixed', 'courtesy_piece', 'courtesy_total'].includes(type)) {
        throw new Error('El tipo de descuento adicional es inválido');
      }
      if ((type === 'percentage' || type === 'fixed') && (!Number.isFinite(value) || value <= 0)) {
        throw new Error('El descuento adicional debe ser mayor que cero');
      }
      if (type === 'percentage' && value > 100) throw new Error('El porcentaje no puede exceder 100');
      if (type === 'percentage' && Number(app.maxPercent) > 0 && value > Number(app.maxPercent)) {
        throw new Error('El porcentaje excede el máximo permitido');
      }
      if (type === 'fixed' && Number(app.maxAmount) > 0 && value > Number(app.maxAmount)) {
        throw new Error('El importe excede el máximo permitido');
      }
      let eligible = lines.filter(line => line.remaining > 0);
      if (scope === 'item') eligible = eligible.filter(line => line.key === String(app.targetKey));
      if (!eligible.length) throw new Error('No existe importe elegible para el descuento');
      const amountBefore = money(eligible.reduce((sum, line) => sum + line.remaining, 0));
      let requested = 0;
      if (type === 'percentage') requested = money(amountBefore * value / 100);
      else if (type === 'fixed') requested = money(value);
      else if (type === 'courtesy_total') requested = amountBefore;
      else {
        if (scope !== 'item' || eligible.length !== 1) throw new Error('La cortesía de pieza requiere un artículo');
        requested = money(Math.min(eligible[0].remaining, eligible[0].remaining / eligible[0].qty));
      }
      const discountAmount = money(Math.min(amountBefore, requested));
      if (discountAmount <= 0) throw new Error('El descuento adicional no produce ningún beneficio');

      // Prorrateo en centavos. Cada renglón salvo el último recibe su proporción
      // redondeada; el último absorbe el residuo, de forma determinista.
      let assigned = 0;
      eligible.forEach((line, index) => {
        const share = index === eligible.length - 1
          ? money(discountAmount - assigned)
          : money(discountAmount * line.remaining / amountBefore);
        const safe = money(Math.min(line.remaining, Math.max(0, share)));
        line.remaining = money(line.remaining - safe);
        line.additionalDiscount = money(line.additionalDiscount + safe);
        assigned = money(assigned + safe);
      });
      frozen.push(Object.assign({}, JSON.parse(JSON.stringify(app)), {
        id: app.id || `additional-${appIndex + 1}`, scope,
        amountBefore, discountAmount: assigned,
        amountAfter: money(amountBefore - assigned),
      }));
    });

    const finalTotal = money(lines.reduce((sum, line) => sum + line.remaining, 0));
    const subtotal = money(finalTotal / 1.16);
    const iva = money(finalTotal - subtotal);
    return {
      originalTotal, configuredDiscountTotal, beforeAdditionalTotal,
      additionalDiscountTotal: money(beforeAdditionalTotal - finalTotal),
      subtotal, iva, ivaPct: 16, ivaIncluded: true, finalTotal,
      applications: frozen,
      lines: lines.map(line => Object.assign({}, line, {
        finalUnit: money(line.remaining / line.qty),
      })),
    };
  }
  function assertSaleAmounts({ ticket, metodo, estado, subtotal, iva, total, anticipo, pagoEfectivo, pagoOtro, ivaIncluded }) {
    const finite = n => Number.isFinite(Number(n));
    if (!Array.isArray(ticket) || !ticket.length || ticket.some(l => !Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0)) throw new Error('La venta requiere artículos con cantidades positivas');
    if (!window.CONFIG.list('payment_method').some(m => m.code === metodo)) throw new Error('Método de pago inválido');
    if (![subtotal, iva, total, anticipo, pagoEfectivo, pagoOtro].every(finite)) throw new Error('Los importes deben ser numéricos');
    if (subtotal < 0 || iva < 0 || total < 0) throw new Error('Subtotal, IVA y total deben ser mayores o iguales a cero');
    const expectedTotal = subtotal + iva;
    if (Math.abs(money(expectedTotal) - money(total)) > 0.009) throw new Error('El subtotal e IVA no coinciden con el total final');
    if (anticipo < 0 || anticipo > total) throw new Error('El anticipo debe estar entre cero y el total');
    if (metodo === 'Apartado' && estado !== 'Apartado') throw new Error('El estado del apartado es inválido');
    if (metodo !== 'Apartado' && metodo !== 'Cortesía' && Math.abs(money(pagoEfectivo + pagoOtro) - money(total)) > 0.009) throw new Error('La suma de pagos no coincide con el total');
    if (pagoEfectivo < 0 || pagoEfectivo > total || pagoOtro < 0 || pagoOtro > total) throw new Error('El desglose de pago es inválido');
  }
  function recordSale({ ticket, additionalDiscounts, quote: quoteIn, sellerIds, client, metodo, estado, subtotal: subtotalIn, iva: ivaIn, total: totalIn, anticipo: anticipoIn, pagoEfectivo: pagoEfectivoIn, pagoOtro: pagoOtroIn, pagoDetalle, metodoPago, ivaPct: ivaPctIn, ivaIncluded: ivaIncludedIn, itemCount, fecha: fechaIn }) {
    if (catalogResyncRequired) {
      throw new Error(`El inventario requiere resincronización antes de continuar vendiendo. ${catalogResyncReason}`);
    }
    const quoteTicket = (ticket || []).map(l => l.res ? l : Object.assign({}, l, { res: resolveLineDiscount(l.p, l.talla) }));
    const quote = quoteIn || saleQuote(quoteTicket, additionalDiscounts || []);
    const total = money(quote.finalTotal);
    const ivaPct = quote.ivaPct;
    const ivaIncluded = quote.ivaIncluded;
    const subtotal = money(quote.subtotal);
    const iva = money(quote.iva);
    const anticipo = anticipoIn == null ? (estado === 'Apartado' ? 0 : total) : money(anticipoIn);
    const pagoEfectivo = pagoEfectivoIn == null ? (metodo === 'Efectivo' ? total : 0) : money(pagoEfectivoIn);
    const pagoOtro = pagoOtroIn == null ? (metodo === 'Efectivo' || metodo === 'Apartado' ? 0 : total) : money(pagoOtroIn);
    assertSaleAmounts({ ticket, metodo, estado, subtotal, iva, total, anticipo, pagoEfectivo, pagoOtro, ivaIncluded });
    const operationId = newOperationId();
    const fecha = fechaIn || now(); // permite fecha pasada (simulación)
    // El folio toma su día de la MISMA fecha que se guarda en la venta.
    const folio = nextFolio(operationId, fecha);
    const cobrada = estado !== 'Apartado' && estado !== 'Cancelado';
    if (cobrada) assertLayawayProductsUnlocked((ticket || []).map(line => line.p && line.p.id));
    // H-34: el plazo se congela con la política vigente AHORA y cuenta desde la
    // misma fecha de la venta. El apartado todavía no entrega mercancía: su
    // plazo arranca al liquidarse (ver finalizarApartado).
    const returnLimitDays = returnLimitDaysConfig();
    const returnExpiresAt = (returnLimitDays == null || estado === 'Apartado')
      ? null : addDays(dayOf(fecha), returnLimitDays);
    // Cortesía (regalo/giveaway): no se cobra (total $0) y NO genera comisión, pero SÍ descuenta
    // inventario. Se guarda 'valorRegalado' (lo que se habría cobrado) para reportes de cuánto se regaló.
    const cortesia = metodo === 'Cortesía';
    const valorRegalado = cortesia ? (Number(total) || 0) : 0;
    const totalCobrado = cortesia ? 0 : total;
    let clientEffect = null;
    const sellerEffects = [];
    // 1) Descuento de stock + movimientos (solo si la venta se cobró/entregó)
    if (cobrada) {
      ticket.forEach(l => {
        const e = stockVariantOf(l.p, l.talla);
        if (e) e.stock = Math.max(0, e.stock - l.qty);
        movements.unshift({ fecha, tipo: 'Venta', producto: l.p.nombre, productId: l.p.id, sku: l.p.sku, talla: l.talla, cant: -l.qty, ref: folio });
      });
      saveProducts(false); saveMovements();
    }
    // 2) Cliente (agregados) — solo registrados y NO en cortesía (no pagó nada).
    if (client && !client.generic && !cortesia) {
      const c = clients.find(x => x.id === client.id);
      if (c) {
        const beforeCompras = Number(c.compras) || 0;
        const beforeTotal = Number(c.total) || 0;
        c.compras = beforeCompras + 1; c.total = money(beforeTotal + total); c.ultima = fecha.slice(0, 10);
        clientEffect = {
          id: c.id, base_version: Number(c._syncVersion) || 0,
          compras_delta: 1, total_delta: total, ultima: c.ultima,
          after_compras: c.compras, after_total: c.total,
        };
        saveClients(false);
      }
    }
    // 3) Vendedores (reparto de venta y comisión).
    //    Base de comisión configurable (commission.base): 'neto' = sin IVA, 'bruto' = con IVA.
    //    Finanzas fija IVA 16% incluido: `total - iva` es neto y `total` es bruto.
    const ids = (sellerIds && sellerIds.length) ? sellerIds : [];
    let comisionVenta = 0;
    if (cobrada && ids.length && !cortesia) {
      const share = total / ids.length;
      const neto = (total - iva) / ids.length;
      const bruto = share;
      const base = window.CONFIG.get('commission.base') === 'bruto' ? bruto : neto;
      ids.forEach(id => {
        const s = sellers.find(x => x.id === id);
        if (s) {
          const baseVersion = Number(s._syncVersion) || 0;
          const c = base * (s.comisionPct || 0) / 100;
          comisionVenta += c;
          s.ventasMes = (s.ventasMes || 0) + share;
          s.ventasNum = (s.ventasNum || 0) + 1;
          s.comisionAcum = (s.comisionAcum || 0) + c;
          sellerEffects.push({
            id: s.id, base_version: baseVersion,
            ventas_mes_delta: share, ventas_num_delta: 1, comision_acum_delta: c,
            after_ventas_mes: s.ventasMes, after_ventas_num: s.ventasNum,
            after_comision_acum: s.comisionAcum,
          });
        }
      });
      saveSellers(false);
    }
    comisionVenta = Math.round(comisionVenta * 100) / 100;
    // 4) Registro de venta (al frente = más reciente). Precio cobrado = con descuentos del POS.
    const primary = ids.map(id => (sellers.find(x => x.id === id) || {}).nombre).filter(Boolean);
    // H-32: se usa la resolución que el POS ya calculó (l.res). Si el llamador no la trae, se
    // resuelve aquí UNA vez y se reutiliza; en ningún caso se evalúa el motor dos veces por línea.
    const resList = ticket.map(l => l.res || resolveLineDiscount(l.p, l.talla));
    const quotedLines = quote.lines || [];
    const unitAt = i => quotedLines[i] ? quotedLines[i].finalUnit : resList[i].unit;
    // H-36: el precio de lista sale de la resolución del renglón, no del artículo.
    // Con precios por talla, `l.p.precio` y `unitAt(i)` dejan de hablar del mismo
    // precio y el descuento quedaría mal calculado en ambas direcciones.
    const subtotalOrig = ticket.reduce((a, l, i) => a + resList[i].orig * l.qty, 0);
    const totalConDescuento = ticket.reduce((a, l, i) => a + resList[i].unit * l.qty, 0);
    const sale = {
      folio, fecha, clienteId: client && !client.generic ? client.id : undefined, cliente: client ? client.nombre : 'Público en general',
      vendedor: primary[0] || '—', vendedores: ids.slice(),
      items: itemCount, subtotal, iva, total: totalCobrado, ivaPct, ivaIncluded,
      anticipo: cortesia ? 0 : anticipo, saldo: cortesia ? 0 : money(total - anticipo),
      pagoEfectivo: cortesia ? 0 : pagoEfectivo, pagoOtro: cortesia ? 0 : pagoOtro,
      metodo, estado,
      descuento: cortesia ? 0 : money(quote.configuredDiscountTotal),
      descuentoAdicional: cortesia ? 0 : money(quote.additionalDiscountTotal),
      totalAntesDescuentoAdicional: cortesia ? 0 : money(quote.beforeAdditionalTotal),
      descuentosAdicionales: cortesia ? [] : JSON.parse(JSON.stringify(quote.applications || [])),
      valorRegalado,
      comision: comisionVenta, comisionBase: window.CONFIG.get('commission.base') || 'neto',
      // H-34: snapshot del plazo. null = sin límite, igual que las ventas previas.
      returnLimitDays, returnExpiresAt,
      _operationId: operationId, _stockRequired: cobrada, _syncStatus: 'pending',
      // En cortesía cada línea queda en $0 (no se cobró); el valor vive en precioOrig y valorRegalado.
      // promos: evidencia histórica inmutable de H-32. Un arreglo vacío significa "sin promoción";
      // su AUSENCIA significa "venta anterior a H-32", que nunca imprime porcentaje.
      lineas: ticket.map((l, i) => ({
        productId: l.p.id, sku: l.p.sku, nombre: l.p.nombre, talla: l.talla, qty: l.qty,
        precio: cortesia ? 0 : money(unitAt(i)),
        precioBase: cortesia ? 0 : resList[i].unit, precioOrig: resList[i].orig,
        descuentoAdicional: cortesia ? 0 : money(((typeof quotedLines !== 'undefined' && quotedLines[i]) || {}).additionalDiscount),
        promos: resList[i].promos,
      })),
    };
    sales.unshift(sale);
    saveSales();
    if (!cortesia) {
      const paidNow = estado === 'Apartado' ? anticipo : total;
      const tender = metodoPago || (metodo === 'Apartado' ? 'Efectivo' : metodo);
      if (paidNow > 0) addSalePayment(sale, { monto: paidNow, metodo: tender, tipo: estado === 'Apartado' ? 'anticipo' : 'venta', detalle: pagoDetalle, fecha }, false);
    }
    if (!remoteApplying) {
      try {
        window.CORE.invokeSync('pushSale', sale, {
          clientId: client && !client.generic ? client.id : null,
          clientEffect, sellerEffects, payments: paymentsForSale(sale.folio),
        });
      } catch (e) { /* offline */ }
    }
    return sale;
  }

  // H-65: prepara la intención de liquidación SIN mutar ningún agregado local.
  // La identidad primaria es productId. El SKU sólo adopta documentos históricos
  // y únicamente cuando identifica exactamente un producto; nunca se usa find().
  function resolveLayawayProduct(line) {
    const productId = String(line && line.productId || '').trim();
    if (productId) {
      const product = products.find(p => p.id === productId);
      if (!product) throw new Error(`El producto ${productId} ya no está en el catálogo; resincroniza antes de liquidar`);
      return product;
    }
    const skuValue = String(line && line.sku || '').trim();
    const matches = products.filter(p => String(p.sku || '').trim() === skuValue);
    if (matches.length > 1) {
      const error = new Error(`SKU ambiguo ${skuValue}: el apartado histórico no identifica un producto único`);
      error.code = 'PRODUCT_SKU_AMBIGUOUS';
      throw error;
    }
    if (matches.length !== 1) {
      const error = new Error(`No se encontró el producto histórico ${skuValue}`);
      error.code = 'PRODUCT_NOT_FOUND';
      throw error;
    }
    return matches[0];
  }

  function finalizarApartado(sale, payment) {
    const fecha2 = now();
    const sellerEffects = [];
    const resolvedLines = (sale.lineas || []).map(line => {
      const product = resolveLayawayProduct(line);
      const qty = Number(line.qty);
      if (!Number.isInteger(qty) || qty <= 0) throw new Error('El apartado contiene una cantidad inválida');
      if (!stockVariantOf(product, line.talla)) {
        throw new Error(`La talla ${line.talla} ya no existe en ${product.nombre || product.id}; resincroniza antes de liquidar`);
      }
      return Object.assign({}, line, { productId: product.id });
    });

    // Comisión/ventas se calculan como deltas, pero no se aplican todavía.
    const ids = sale.vendedores || [];
    let comisionVenta = 0;
    if (ids.length) {
      const share = (Number(sale.total) || 0) / ids.length;
      const grossTotal = Number(sale.total) || 0;
      const taxRatio = grossTotal > 0 ? (Number(sale.iva) || 0) / grossTotal : 0;
      const neto = share * (1 - taxRatio);
      const bruto = share;
      const base = window.CONFIG.get('commission.base') === 'bruto' ? bruto : neto;
      ids.forEach(id => {
        const s = sellers.find(x => x.id === id);
        if (s) {
          const baseVersion = Number(s._syncVersion) || 0;
          const c = base * (s.comisionPct || 0) / 100;
          comisionVenta += c;
          sellerEffects.push({
            id: s.id, base_version: baseVersion,
            ventas_mes_delta: share, ventas_num_delta: 1, comision_acum_delta: c,
            after_ventas_mes: (Number(s.ventasMes) || 0) + share,
            after_ventas_num: (Number(s.ventasNum) || 0) + 1,
            after_comision_acum: (Number(s.comisionAcum) || 0) + c,
          });
        }
      });
    }
    const saleDraft = Object.assign({}, sale, {
      lineas: resolvedLines,
      estado: 'Pagado',
      anticipo: Number(sale.total) || 0,
      saldo: 0,
      pagoEfectivo: money((Number(sale.pagoEfectivo) || 0) + payment.efectivo),
      pagoOtro: money((Number(sale.pagoOtro) || 0) + payment.tarjeta + payment.transferencia + payment.otro),
      comision: Math.round(comisionVenta * 100) / 100,
      comisionBase: window.CONFIG.get('commission.base') || 'neto',
      returnExpiresAt: sale.returnLimitDays != null && !sale.returnExpiresAt
        ? addDays(dayOf(fecha2), sale.returnLimitDays) : sale.returnExpiresAt,
      _operationId: sale._operationId || newOperationId(),
      _stockRequired: true,
      _syncStatus: 'pending',
    });
    return { sale: saleDraft, payment, sellerEffects };
  }

  async function liquidarApartado(sale, payment) {
    let prepared;
    try { prepared = finalizarApartado(sale, payment); }
    catch (e) { return { ok: false, error: e.message || 'No se pudo identificar la mercancía del apartado', code: e.code }; }
    if (!acquireLayawayProductLock(prepared.sale)) {
      return {
        ok: false,
        error: 'El producto cambió o ya tiene una liquidación pendiente; resincroniza antes de continuar',
        code: 'LAYAWAY_PRODUCT_LOCKED',
      };
    }
    let remote;
    try {
      remote = await Promise.resolve(window.CORE.invokeSync('settleLayaway', prepared.sale, {
        payment: prepared.payment,
        sellerEffects: prepared.sellerEffects,
      }));
    } catch (e) {
      return { ok: false, pending: true, error: e.message || 'La liquidación quedó pendiente de confirmación' };
    }
    if (!remote || remote.ok !== true) {
      const remoteError = remote && remote.error;
      if (!remote || remote.pending !== true) releaseLayawayProductLock(prepared.sale._operationId);
      return {
        ok: false,
        pending: !!(remote && remote.pending),
        error: (typeof remoteError === 'string' ? remoteError : remoteError && remoteError.message)
          || (remote && (remote.diagnostic || {}).message)
          || 'La liquidación quedó pendiente de confirmación; no entregues la mercancía',
      };
    }
    const confirmedSale = sales.find(s => s.folio === sale.folio);
    const authoritativePaymentId = remote.paymentId || remote.payment_id || payment.id;
    const confirmedPayment = payments.find(p => p.id === authoritativePaymentId);
    if (!confirmedSale || confirmedSale.estado !== 'Pagado' || !confirmedPayment
        || confirmedSale._stockReserved !== true) {
      requireCatalogResync('La confirmación remota no quedó reconciliada en esta terminal');
      return { ok: false, error: 'La terminal debe resincronizar antes de entregar la mercancía' };
    }
    return { ok: true, sale: confirmedSale, payment: confirmedPayment, liquidado: true };
  }

  function registrarPagoApartado(folio, { monto, metodo, detalle, fecha } = {}) {
    const sale = sales.find(s => s.folio === folio);
    if (!sale || sale.estado !== 'Apartado') return { ok: false, error: 'El apartado no está pendiente' };
    // La cola durable se consulta por el gateway de sincronización: DATA no
    // conoce a STORE. Si esa consulta falla se asume liquidación pendiente; un
    // abono de más sobre un apartado ya liquidado no se puede deshacer.
    let queuedLiquidation = false;
    try { queuedLiquidation = window.CORE.invokeSync('hasPendingLayaway', folio) === true; }
    catch (e) { queuedLiquidation = true; }
    if (hasLayawayLiquidationLock(folio, sale._operationId) || queuedLiquidation) {
      return {
        ok: false, pending: true, code: 'LAYAWAY_LIQUIDATION_PENDING',
        error: 'Este apartado ya tiene una liquidación pendiente; no captures otro abono hasta reconciliarla',
      };
    }
    if (catalogResyncRequired) {
      return { ok: false, error: `La terminal requiere resincronizar antes de registrar otro pago. ${catalogResyncReason}` };
    }
    const saldo = sale.saldo != null ? money(sale.saldo) : money((Number(sale.total) || 0) - (Number(sale.anticipo) || 0));
    const amount = money(monto);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'El abono debe ser mayor a cero' };
    if (amount > saldo) return { ok: false, error: 'El abono no puede exceder el saldo pendiente' };
    if (!['Efectivo', 'Tarjeta', 'Transferencia', 'Mixto'].includes(metodo)) return { ok: false, error: 'Método de pago inválido para el abono' };
    let payment;
    try { payment = salePaymentDraft(sale, { monto: amount, metodo, tipo: amount === saldo ? 'liquidacion' : 'abono', detalle, fecha }); }
    catch (e) { return { ok: false, error: e.message || 'El desglose del pago no cuadra' }; }
    if (amount === saldo) return liquidarApartado(sale, payment);
    payments.unshift(payment);
    savePayments(false);
    sale.anticipo = money((Number(sale.anticipo) || 0) + amount);
    sale.saldo = money((Number(sale.total) || 0) - sale.anticipo);
    sale.pagoEfectivo = money((Number(sale.pagoEfectivo) || 0) + payment.efectivo);
    sale.pagoOtro = money((Number(sale.pagoOtro) || 0) + payment.tarjeta + payment.transferencia + payment.otro);
    saveSales();
    try { window.CORE.invokeSync('pushSale', sale, { sellerEffects: [], payments: paymentsForSale(sale.folio) }); } catch (e) { /* offline */ }
    return { ok: true, sale, payment, liquidado: false };
  }
  async function completarApartado(folio) {
    const sale = sales.find(s => s.folio === folio);
    if (!sale || sale.estado !== 'Apartado') return null;
    const saldo = sale.saldo != null ? Number(sale.saldo) || 0 : Math.max(0, (Number(sale.total) || 0) - (Number(sale.anticipo) || 0));
    const r = await Promise.resolve(registrarPagoApartado(folio, { monto: saldo, metodo: 'Efectivo', detalle: { efectivo: saldo } }));
    return r.ok ? r.sale : null;
  }

  // Registra un pago de comisión en el historial (local).
  function addLiquidacion(s, monto, tipo, operationId) {
    const prefix = tipo === 'corte' ? 'cut-' : 'liq-';
    liquidations.unshift({ id: prefix + operationId + (tipo === 'corte' ? '-' + s.id : ''), fecha: now(), sellerId: s.id, seller: s.nombre, monto: Math.round((Number(monto) || 0) * 100) / 100, tipo });
  }
  // Liquida (paga) la comisión acumulada de un vendedor: la registra en el historial, la pone en
  // cero y persiste/sincroniza. Devuelve el monto liquidado, o null si el vendedor no existe.
  function liquidarComision(id) {
    const s = sellers.find(x => x.id === id);
    if (!s) return null;
    const operationId = newOperationId();
    const monto = Number(s.comisionAcum) || 0;
    if (monto > 0) addLiquidacion(s, monto, 'liquidacion', operationId);
    s.comisionAcum = 0;
    save(LS_LIQ, liquidations);
    saveSellers(false);
    window.CORE.invokeSync('settleCommission', { operationId, sellerId: id });
    return monto;
  }
  // Corte de mes: paga la comisión pendiente de TODOS los vendedores y reinicia los acumulados del
  // periodo (ventasMes, ventasNum, comisionAcum). metaMes NO se toca. Marca el inicio del nuevo periodo.
  function cerrarMes() {
    const operationId = newOperationId();
    let total = 0, n = 0;
    sellers.forEach(s => {
      const pend = Number(s.comisionAcum) || 0;
      if (pend > 0) { addLiquidacion(s, pend, 'corte', operationId); total += pend; n++; }
      s.comisionAcum = 0; s.ventasMes = 0; s.ventasNum = 0;
    });
    periodoInicio = now().slice(0, 10);
    try { localStorage.setItem(LS_PERIODO, periodoInicio); } catch (e) { /* sin storage */ }
    save(LS_LIQ, liquidations);
    saveSellers(false);
    window.CORE.invokeSync('closeCommissionPeriod', { operationId });
    return { total: Math.round(total * 100) / 100, vendedores: n, periodoInicio };
  }
  function getPeriodoInicio() { return periodoInicio; }

  // ── H-34: plazo de posventa ─────────────────────────────────────────────────
  // El plazo para devolver se CONGELA en la venta al crearse. Cambiar la
  // configuración después NO altera ninguna venta anterior: la política vive en
  // el documento, igual que el folio (H-33), el snapshot financiero (H-03) y la
  // evidencia de descuento (H-32). Derivar el vencimiento de la configuración
  // vigente haría que un ajuste administrativo venciera ventas ya emitidas.
  //
  // `returnLimitDays == null` significa SIN LÍMITE. Es también el estado natural
  // de toda venta anterior a H-34, que por eso nunca vence.
  const MAX_LIMIT_DAYS = 3650;
  function returnLimitDaysConfig() {
    if (!C.get('returns.limitEnabled')) return null;
    const raw = Math.floor(Number(C.get('returns.limitDays')));
    return Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_LIMIT_DAYS) : null;
  }
  // Día local del negocio 'YYYY-MM-DD'. Acepta la fecha ya formateada de la venta
  // ('YYYY-MM-DD HH:mm'), así plazo y venta salen del MISMO valor y una venta
  // cerca de la medianoche no queda partida entre dos días (lección de H-33).
  function dayOf(date) {
    if (typeof date === 'string') {
      const m = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return m[1] + '-' + m[2] + '-' + m[3];
    }
    const d = date instanceof Date ? date : new Date();
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  // Aritmética de calendario sobre la tripleta año/mes/día. No convierte husos
  // horarios, así que el horario de verano no puede correr un vencimiento un día.
  function dayValue(day) {
    const m = String(day == null ? '' : day).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  }
  function addDays(day, days) {
    const base = dayValue(day);
    if (!Number.isFinite(base)) return null;
    const d = new Date(base + Math.round(Number(days) || 0) * 86400000);
    const p = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }
  function daysUntil(day) {
    const target = dayValue(day), today = dayValue(dayOf());
    return Number.isFinite(target) && Number.isFinite(today)
      ? Math.round((target - today) / 86400000) : null;
  }
  const dayWord = n => (Math.abs(n) === 1 ? 'día' : 'días');
  const noLimit = { limited: false, days: null, expiresAt: null, daysLeft: null, status: 'sin_limite', label: 'Sin límite' };
  // Autoridad ÚNICA del estado del plazo de una venta. La consultan la pantalla
  // de Devoluciones (etiqueta y filtros) y `recordReturn` (bloqueo). Nunca lee la
  // configuración vigente: sólo lo que la venta congeló.
  //   sin_limite → la venta no vence nunca
  //   pendiente  → apartado sin liquidar: el plazo aún no arranca
  //   vigente    → admite posventa (incluye el último día, "Vence hoy")
  //   vencido    → fuera de plazo
  function returnDeadline(sale) {
    const days = sale && sale.returnLimitDays != null ? Number(sale.returnLimitDays) : null;
    if (!(days > 0)) return Object.assign({}, noLimit);
    const expiresAt = (sale && sale.returnExpiresAt) || null;
    if (!expiresAt) {
      return { limited: true, days, expiresAt: null, daysLeft: null, status: 'pendiente', label: `Plazo de ${days} ${dayWord(days)} al liquidar` };
    }
    const daysLeft = daysUntil(expiresAt);
    // Fecha dañada: no se inventa un vencimiento ni se bloquea al mostrador.
    if (daysLeft == null) return Object.assign({}, noLimit);
    if (daysLeft < 0) {
      const n = -daysLeft;
      return { limited: true, days, expiresAt, daysLeft, status: 'vencido', label: `Vencido hace ${n} ${dayWord(n)}` };
    }
    return {
      limited: true, days, expiresAt, daysLeft, status: 'vigente',
      label: daysLeft === 0 ? 'Vence hoy' : `Vence en ${daysLeft} ${dayWord(daysLeft)}`,
    };
  }

  // ── H-35: autoridad única del saldo por renglón ─────────────────────────────
  // «¿Cuántas unidades de este renglón siguen disponibles?» tiene UNA sola
  // respuesta, aquí y en SQL (`pos.sale_line_balance`). Sin esta autoridad, una
  // devolución y un cambio podrían consumir la misma pieza, porque cada uno
  // validaría contra su propia tabla.
  //
  // COSTURA: `consumptionSources()` enumera los documentos que consumen unidades
  // de una venta. Hoy sólo devoluciones. El módulo de Cambios publicará
  // `DATA.exchanges` y sus renglones `lado === 'devuelto'` entrarán aquí sin que
  // ningún consumidor de `saleLineBalance()` cambie. Es el espejo local exacto
  // de la vista `pos.line_consumption`.
  function consumptionSources() {
    const sources = [{
      origen: 'devolucion', docs: returns,
      id: d => d.id, folio: d => d.folio, lines: d => d.lineas || [],
    }];
    const exchanges = window.DATA && window.DATA.exchanges;
    if (Array.isArray(exchanges)) {
      sources.push({
        origen: 'cambio', docs: exchanges,
        id: d => d.id, folio: d => d.origenFolio || d.saleFolio,
        lines: d => (d.lineas || []).filter(l => l && l.lado === 'devuelto'),
      });
    }
    return sources;
  }
  // Saldo por (sku, talla) de una venta. `excludeDocument` reproduce la exclusión
  // que necesita un documento al reescribirse: no contarse a sí mismo.
  // El consumo se relaciona con el folio VIGENTE de la venta, que es el que
  // rekeySaleFolio propaga a devoluciones, pagos y movimientos.
  // COSTURA SIMETRICA (H-37): `supplySources()` enumera los documentos que
  // SUMINISTRAN unidades a una venta, igual que consumptionSources() enumera los
  // que las consumen. Hoy solo los cambios, con sus renglones `lado ===
  // 'entregado'`. Es el espejo local exacto de la vista `pos.line_supply`.
  //
  // Existe porque el Contrato del Cambio permite recambiar una pieza recibida en
  // un cambio anterior: esa pieza no es renglon de ninguna venta, asi que sin
  // este lado la autoridad del saldo no podria gobernarla.
  function supplySources() {
    const sources = [];
    if (Array.isArray(exchanges)) {
      sources.push({
        origen: 'cambio', docs: exchanges,
        id: d => d.id, folio: d => d.origenFolio || d.saleFolio,
        lines: d => (d.lineas || []).filter(l => l && l.lado === 'entregado'),
      });
    }
    return sources;
  }
  // Saldo por (sku, talla) de una venta. `excludeDocument` reproduce la exclusion
  // que necesita un documento al reescribirse: no contarse a si mismo.
  //
  //   vendida   = renglones de la venta  +  entregado por cambios sobre ella
  //   consumida = devuelto               +  entregado de vuelta en cambios
  //
  // Asi una cadena A->B->C queda anclada al folio de origen sin abrir una segunda
  // autoridad del saldo (ADR-003, ADR-010).
  function saleLineBalance(folio, { excludeDocument } = {}) {
    const sale = findSaleByFolio(folio);
    const key = sale ? sale.folio : folio;
    const rows = {}, order = [];
    const rowFor = (sku, talla) => {
      const k = sku + '' + talla;
      if (!rows[k]) {
        rows[k] = { sku, talla, vendida: 0, devuelta: 0, cambiada: 0, consumida: 0, disponible: 0 };
        order.push(k);
      }
      return rows[k];
    };
    ((sale && sale.lineas) || []).forEach(l => {
      rowFor(l.sku, l.talla).vendida += Number(l.qty) || 0;
    });
    supplySources().forEach(src => {
      (src.docs || []).forEach(doc => {
        if (!doc || src.folio(doc) !== key) return;
        if (excludeDocument != null && src.id(doc) === excludeDocument) return;
        src.lines(doc).forEach(l => { rowFor(l.sku, l.talla).vendida += Number(l.qty) || 0; });
      });
    });
    consumptionSources().forEach(src => {
      (src.docs || []).forEach(doc => {
        if (!doc || src.folio(doc) !== key) return;
        if (excludeDocument != null && src.id(doc) === excludeDocument) return;
        src.lines(doc).forEach(l => {
          const row = rows[l.sku + '' + l.talla];
          if (!row) return; // consumo de un renglon que esta venta no tiene
          const qty = Number(l.qty) || 0;
          row.consumida += qty;
          if (src.origen === 'cambio') row.cambiada += qty; else row.devuelta += qty;
        });
      });
    });
    return order.map(k => {
      const r = rows[k];
      r.disponible = Math.max(0, r.vendida - r.consumida);
      return r;
    });
  }
  // AUTORIDAD UNICA del valor historico reconocido de una pieza que el cliente
  // entrega (Contrato del Cambio, seccion 3). Responde tanto por piezas vendidas
  // en la venta origen como por piezas entregadas en un cambio anterior, que
  // adquieren valor historico propio desde ese momento.
  //
  // NUNCA deriva del precio vigente: eso le cobraria al cliente una subida de
  // precio posterior a su compra. El precio vigente solo aplica a lo que el
  // cliente RECIBE, y lo resuelve DATA.listPrice().
  function recognizedValue(folio, sku, talla) {
    const sale = findSaleByFolio(folio);
    const key = sale ? sale.folio : folio;
    let valor = 0, encontrado = false;
    ((sale && sale.lineas) || []).forEach(l => {
      if (l.sku !== sku || l.talla !== talla) return;
      const v = l.precioBase != null ? l.precioBase : (l.precioOrig != null ? l.precioOrig : l.precio);
      valor = Number(v) || 0; encontrado = true;
    });
    // Un cambio posterior reasigna el valor de la pieza: el ultimo manda.
    supplySources().forEach(src => {
      (src.docs || []).forEach(doc => {
        if (!doc || src.folio(doc) !== key) return;
        src.lines(doc).forEach(l => {
          if (l.sku !== sku || l.talla !== talla) return;
          valor = Number(l.precio) || 0; encontrado = true;
        });
      });
    });
    return encontrado ? valor : 0;
  }

  // ---- Devoluciones ----
  // Piezas de un renglón (sku+talla) de un folio ya devueltas en devoluciones previas.
  // Conserva su significado LITERAL (sólo devoluciones); el disponible lo decide
  // saleLineBalance().
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
  // ---- Cambios (H-38 / C5) ----
  // Registra un cambio local y lo entrega a la autoridad transaccional
  // pos.commit_exchange(). Gobernado por docs/04-contrato-del-cambio.md.
  //
  // El DINERO no se calcula aqui: el servidor resuelve valor reconocido y precio
  // vigente, y valida el cobro contra su propio calculo. Aqui se anticipa el
  // mismo resultado con las autoridades locales para que la terminal pueda
  // operar offline, pero la cifra que manda es la del commit.
  //
  // El cambio NUNCA devuelve efectivo: si lo entregado vale menos, el sobrante
  // se registra como valor no aprovechado (Contrato del Cambio, seccion 4).
  function recordExchange({ origenFolio, lineas, usuario, vendedorId, revisadoPor, notas, metodoPago, fecha: fechaIn }) {
    const sale = findSaleByFolio(origenFolio);
    if (!sale) return { ok: false, error: 'sale_not_found' };
    const items = (lineas || []).filter(l => l && (l.lado === 'devuelto' || l.lado === 'entregado'));
    const devueltos = items.filter(l => l.lado === 'devuelto');
    const entregados = items.filter(l => l.lado === 'entregado');
    if (!devueltos.length || !entregados.length) return { ok: false, error: 'invalid_items' };
    try {
      assertLayawayProductsUnlocked(items.map(line => {
        const product = products.find(p => p.id === line.productId)
          || products.find(p => p.sku === line.sku);
        return product && product.id;
      }));
    } catch (e) { return { ok: false, error: e.message, code: e.code }; }

    // Plazo de posventa (H-34): compuerta, no se reinicia ni se hereda aparte.
    const plazo = returnDeadline(sale);
    if (plazo && plazo.status === 'vencido') return { ok: false, error: 'exchange_window_closed' };

    // Saldo por renglon (H-35/H-37): la autoridad ya suma el suministro de
    // cambios anteriores, asi que una pieza recibida antes puede recambiarse.
    const saldo = saleLineBalance(sale.folio);
    const faltan = [];
    devueltos.forEach(l => {
      const row = saldo.find(b => b.sku === l.sku && b.talla === l.talla);
      const disponible = row ? row.disponible : 0;
      if ((Number(l.qty) || 0) > disponible) faltan.push({ sku: l.sku, talla: l.talla, requested: Number(l.qty) || 0, available: disponible });
    });
    if (faltan.length) return { ok: false, error: 'invalid_exchange_quantity', items: faltan };

    const fecha = fechaIn || now();
    const valorReconocido = devueltos.reduce((a, l) => a + recognizedValue(sale.folio, l.sku, l.talla) * (Number(l.qty) || 0), 0);
    const valorEntregado = entregados.reduce((a, l) => {
      const p = products.find(x => x.id === l.productId || x.sku === l.sku);
      return a + listPrice(p, l.talla) * (Number(l.qty) || 0);
    }, 0);
    const diferencia = valorEntregado >= valorReconocido ? money(valorEntregado - valorReconocido) : 0;
    const valorNoAprovechado = valorEntregado >= valorReconocido ? 0 : money(valorReconocido - valorEntregado);

    // H-47 · Contrato del Cambio § 7: el intercambio en sí NUNCA comisiona. Sólo
    // el EXCEDENTE de valor constituye venta nueva, y su comisión es de quien
    // atendió el cambio. Se acredita en el acto, como en una venta.
    //
    // Pero un cambio NO es un pedido: no toca `ventasMes` ni `ventasNum`, así que
    // no mueve el conteo de ventas, el ticket promedio ni las metas del equipo.
    // Sólo el acumulado de comisión cambia.
    //
    // Lo acreditado queda CONGELADO en el documento (ADR-002): monto, base y
    // porcentaje. La reversa resta exactamente lo que se pagó, no lo que la
    // configuración de hoy diría. Sin eso, cambiar `commission.base` o el
    // porcentaje de alguien descuadraría la reversa (AP-06).
    const comisionBase = window.CONFIG.get('commission.base') === 'bruto' ? 'bruto' : 'neto';
    const vendedorCambio = vendedorId ? sellers.find(x => x.id === vendedorId) : null;
    const comisionPct = vendedorCambio ? (Number(vendedorCambio.comisionPct) || 0) : 0;
    // El excedente viene con IVA incluido al 16%, misma convención que `recordSale`
    // fija en su cálculo de subtotal. Unificar ambas en un solo ayudante queda
    // pendiente: aquí se replica el criterio, no el importe.
    const baseComisionable = comisionBase === 'bruto' ? diferencia : money(diferencia / 1.16);
    const comisionMonto = money(baseComisionable * comisionPct / 100);

    const id = 'cmb-' + newOperationId();
    const exch = {
      id, folio: nextFolio(id, fecha), origenFolio: sale.folio, fecha,
      usuario: usuario || '', vendedorId: vendedorId || undefined,
      revisadoPor: revisadoPor || undefined, notas: notas || '',
      valorReconocido: money(valorReconocido), valorEntregado: money(valorEntregado),
      diferencia, valorNoAprovechado, baseComision: diferencia,
      comisionMonto, comisionBase, comisionPct,
      lineas: items.map(l => {
        const p = products.find(x => x.id === l.productId || x.sku === l.sku);
        return {
          lado: l.lado, productId: p ? p.id : l.productId, sku: l.sku, nombre: l.nombre,
          talla: l.talla, qty: Number(l.qty) || 0, motivo: l.motivo || '',
          // La condicion solo aplica a lo que el cliente ENTREGA: es el resultado
          // de la revision que decide si la prenda se recibe (Contrato, seccion 5).
          condicion: l.lado === 'devuelto' ? (l.condicion || '') : undefined,
          precio: l.lado === 'entregado' ? listPrice(p, l.talla) : recognizedValue(sale.folio, l.sku, l.talla),
        };
      }),
    };

    // Inventario local en dos sentidos: entra lo devuelto, sale lo entregado.
    exch.lineas.forEach(l => {
      const p = products.find(x => x.id === l.productId);
      if (!p) return;
      const e = stockVariantOf(p, l.talla);
      if (!e) return;
      e.stock = Math.max(0, e.stock + (l.lado === 'devuelto' ? 1 : -1) * l.qty);
      movements.unshift({
        fecha, tipo: l.lado === 'devuelto' ? 'Cambio (entra)' : 'Cambio (sale)',
        producto: l.nombre, sku: l.sku,
        cant: (l.lado === 'devuelto' ? 1 : -1) * l.qty, ref: exch.folio,
      });
    });
    saveProducts(false); saveMovements();

    let payment = null;
    if (diferencia > 0) {
      payment = {
        id: 'pay-' + id, folio: exch.folio, fecha, tipo: 'cambio',
        metodo: metodoPago || 'Efectivo', monto: diferencia,
        efectivo: (metodoPago || 'Efectivo') === 'Efectivo' ? diferencia : 0,
        tarjeta: 0, transferencia: 0,
        otro: (metodoPago || 'Efectivo') === 'Efectivo' ? 0 : diferencia,
      };
      payments.unshift(payment);
      savePayments(false);
    }

    // Acreditación de la comisión del excedente. Mismo patrón de concurrencia
    // optimista que la venta: se registra la versión con la que se leyó al
    // vendedor, para que la nube rechace el efecto si otro equipo lo movió.
    const sellerEffects = [];
    if (vendedorCambio && comisionMonto > 0) {
      const baseVersion = Number(vendedorCambio._syncVersion) || 0;
      const before = Number(vendedorCambio.comisionAcum) || 0;
      vendedorCambio.comisionAcum = money(before + comisionMonto);
      sellerEffects.push({
        id: vendedorCambio.id, base_version: baseVersion,
        comision_acum_delta: comisionMonto,
        after_comision_acum: vendedorCambio.comisionAcum,
      });
      saveSellers(false);
    }

    exchanges.unshift(exch);
    saveExchanges(false);
    if (!remoteApplying) {
      try { window.CORE.invokeSync('pushExchange', exch, { payment, sellerEffects }); } catch (e) { /* offline */ }
    }
    return { ok: true, exchange: exch, payment };
  }

  // H-47 · Reversa de la comisión del excedente.
  //
  // Hoy NO existe ninguna forma de cancelar ni modificar un cambio: `pos.exchanges`
  // no tiene estado y nada lo revierte. Esta es la COSTURA DECLARADA para cuando
  // exista, y está probada para que no sea código muerto (ADR-003).
  //
  // Resta el monto CONGELADO, no uno recalculado: si el dueño cambió la base de
  // comisión o el porcentaje de alguien entre el registro y la reversa, lo que se
  // devuelve sigue siendo lo que de verdad se pagó.
  function reverseExchangeCommission(exchangeId, { fecha: fechaIn } = {}) {
    const e = exchanges.find(x => x.id === exchangeId);
    if (!e) return { ok: false, error: 'exchange_not_found' };
    if (e.comisionRevertida) return { ok: false, error: 'comision_ya_revertida' };
    const monto = money(Number(e.comisionMonto) || 0);
    const s = e.vendedorId ? sellers.find(x => x.id === e.vendedorId) : null;
    const sellerEffects = [];
    if (s && monto > 0) {
      const baseVersion = Number(s._syncVersion) || 0;
      const before = Number(s.comisionAcum) || 0;
      // Nunca deja el acumulado en negativo: si ya se liquidó el periodo, la
      // comisión no se puede "des-pagar" restando de un saldo que no existe.
      s.comisionAcum = Math.max(0, money(before - monto));
      sellerEffects.push({
        id: s.id, base_version: baseVersion,
        comision_acum_delta: s.comisionAcum - before,
        after_comision_acum: s.comisionAcum,
      });
      saveSellers(false);
    }
    e.comisionRevertida = fechaIn || now();
    saveExchanges(false);
    if (!remoteApplying) {
      try { window.CORE.invokeSync('pushExchange', e, { sellerEffects }); } catch (err) { /* offline */ }
    }
    return { ok: true, monto, vendedorId: e.vendedorId || null };
  }

  // ── H-49 · Autoridad del ingreso del periodo ────────────────────────────────
  //
  // La suma de ventas está escrita SEIS veces en `balam/*.jsx`. Añadir el ingreso
  // del cambio en una sola de ellas habría creado la séptima divergencia, así que
  // la aritmética vive aquí y las pantallas la consumen (`AP-01`, `ADR-003`).
  //
  // Decisión del dueño (30/07/2026): la diferencia que el cliente paga en un
  // cambio SÍ suma al importe vendido —es ingreso por entregar un producto de
  // mayor valor—, pero NO es un pedido, porque proviene de una operación que ya
  // existía. De ahí que `ticketProm` se calcule sobre las ventas y no sobre el
  // importe total: si usara el importe, un cambio inflaría el promedio sin que
  // nadie hubiera comprado de más.
  //
  // `pred` recibe el documento completo —venta o cambio—, y ambos tienen `fecha`,
  // así que un mismo filtro de periodo sirve para los dos.
  const enPeriodo = (pred) => (typeof pred === 'function' ? pred : () => true);

  function exchangeRevenue(pred) {
    const dentro = enPeriodo(pred);
    return money((exchanges || []).reduce((a, e) => dentro(e) ? a + (Number(e.diferencia) || 0) : a, 0));
  }

  // Lo que el cliente pierde cuando se lleva menos de lo que entrega. NO es
  // ingreso cobrado —no entra dinero— pero el Contrato decide que se pierde
  // (§ 4), así que el negocio necesita verlo: si crece, algo va mal en el
  // mostrador. Se informa aparte y nunca suma al importe vendido.
  function exchangeUnusedValue(pred) {
    const dentro = enPeriodo(pred);
    return money((exchanges || []).reduce((a, e) => dentro(e) ? a + (Number(e.valorNoAprovechado) || 0) : a, 0));
  }

  // Proyecciones de lectura para los tres reportes exigidos por el Contrato § 7.
  // No recalculan la liquidación: presentan la evidencia congelada en ventas y
  // cambios, para que Reportes no replique aritmética ni conozca el documento.
  function exchangeReport(pred) {
    const dentro = enPeriodo(pred);
    return (exchanges || []).filter(dentro).map(e => {
      const vendedor = sellers.find(s => s.id === e.vendedorId);
      const lineas = (e.lineas || []).map(l => ({ ...l }));
      return {
        id: e.id, folio: e.folio, origenFolio: e.origenFolio, fecha: e.fecha,
        vendedorId: e.vendedorId || null,
        vendedor: vendedor ? vendedor.nombre : (e.vendedorId ? 'Vendedor histórico' : '—'),
        revisadoPor: e.revisadoPor || '—', notas: e.notas || '',
        valorReconocido: Number(e.valorReconocido) || 0,
        valorEntregado: Number(e.valorEntregado) || 0,
        diferencia: Number(e.diferencia) || 0,
        valorNoAprovechado: Number(e.valorNoAprovechado) || 0,
        comisionMonto: Number(e.comisionMonto) || 0,
        devueltos: lineas.filter(l => l.lado === 'devuelto'),
        entregados: lineas.filter(l => l.lado === 'entregado'),
      };
    }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }

  function sellerCommissionReport(pred) {
    const dentro = enPeriodo(pred);
    const porId = {};
    const ensure = id => {
      const key = id || '__sin_vendedor__';
      if (!porId[key]) {
        const s = sellers.find(x => x.id === id);
        porId[key] = {
          vendedorId: id || null,
          vendedor: s ? s.nombre : (id ? 'Vendedor histórico' : 'Sin vendedor'),
          ventas: 0, cambios: 0, total: 0, repartoEstimado: false,
        };
      }
      return porId[key];
    };
    sales.filter(s => s.estado !== 'Cancelado' && dentro(s)).forEach(sale => {
      const ids = (sale.vendedores || []).filter(Boolean);
      const fallback = !ids.length && sale.vendedor && sale.vendedor !== '—'
        ? sellers.find(s => s.nombre === sale.vendedor) : null;
      if (!ids.length && fallback) ids.push(fallback.id);
      if (!ids.length) return;
      const total = Number(sale.comision) || 0;
      const share = money(total / ids.length);
      ids.forEach((id, i) => {
        const row = ensure(id);
        // El último absorbe el residuo de centavos para conservar el total.
        row.ventas = money(row.ventas + (i === ids.length - 1 ? total - share * (ids.length - 1) : share));
        if (ids.length > 1) row.repartoEstimado = true;
      });
    });
    (exchanges || []).filter(dentro).forEach(e => {
      const monto = e.comisionRevertida ? 0 : (Number(e.comisionMonto) || 0);
      if (!e.vendedorId && !monto) return;
      const row = ensure(e.vendedorId);
      row.cambios = money(row.cambios + monto);
    });
    return Object.values(porId).map(row => ({
      ...row, total: money(row.ventas + row.cambios),
    })).sort((a, b) => b.total - a.total || a.vendedor.localeCompare(b.vendedor));
  }

  function revenueSummary(pred) {
    const dentro = enPeriodo(pred);
    const validas = sales.filter(s => s.estado !== 'Cancelado' && dentro(s));
    // Las cortesías no son ventas pagadas: no cuentan como pedidos ni en el ticket.
    const cortesias = validas.filter(s => s.metodo === 'Cortesía').length;
    const ventasSolas = money(validas.reduce((a, s) => a + (Number(s.total) || 0), 0));
    const difCambios = exchangeRevenue(pred);
    const pedidos = validas.length - cortesias;
    return {
      ventasSolas, difCambios,
      importeVendido: money(ventasSolas + difCambios),
      noAprovechado: exchangeUnusedValue(pred),
      pedidos,
      ticketProm: pedidos > 0 ? money(ventasSolas / pedidos) : 0,
    };
  }

  function recordReturn({ folio, lineas, metodo, notas, fecha: fechaIn }) {
    const sale = sales.find(s => s.folio === folio);
    if (!sale) return { ok: false, error: 'No se encontró la venta original' };
    if (!isReturnable(sale)) return { ok: false, error: 'Esa venta no admite devolución (apartado, cancelada o ya devuelta)' };
    // H-34: el plazo lo decide el snapshot de la venta, no la configuración de hoy.
    const plazo = returnDeadline(sale);
    if (plazo.status === 'vencido') {
      return { ok: false, error: `El plazo de devolución de esta venta venció el ${plazo.expiresAt} (${plazo.label.toLowerCase()})` };
    }
    const items = (lineas || []).filter(l => (Number(l.qty) || 0) > 0);
    if (!items.length) return { ok: false, error: 'Selecciona al menos un artículo y cantidad a devolver' };
    try {
      assertLayawayProductsUnlocked(items.map(line => {
        const sold = (sale.lineas || []).find(x => x.sku === line.sku && x.talla === line.talla);
        const product = products.find(p => p.id === (line.productId || (sold && sold.productId)))
          || products.find(p => p.sku === line.sku);
        return product && product.id;
      }));
    } catch (e) { return { ok: false, error: e.message, code: e.code }; }
    // H-35: el disponible lo decide la autoridad única, que ya descuenta
    // devoluciones previas y, cuando existan, los cambios de esta venta.
    const saldo = saleLineBalance(folio);
    for (const l of items) {
      const row = saldo.find(b => b.sku === l.sku && b.talla === l.talla);
      if ((Number(l.qty) || 0) > (row ? row.disponible : 0)) return { ok: false, error: `Cantidad inválida en ${l.nombre} (talla ${l.talla})` };
    }
    const fecha = fechaIn || now(); // permite fecha pasada (simulación)
    const id = 'ret-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const stockLines = [];
    const sellerEffects = [];
    let clientEffect = null;
    // 1) Reingreso de stock + movimiento 'Devolución' (cant positiva)
    items.forEach(l => {
      const p = products.find(x => x.sku === l.sku);
      if (p) {
        const e = stockVariantOf(p, l.talla);
        if (e) e.stock = (Number(e.stock) || 0) + (Number(l.qty) || 0);
        stockLines.push({ product_id: p.id, talla: l.talla, qty: Number(l.qty) || 0 });
      }
      movements.unshift({ fecha, tipo: 'Devolución', producto: l.nombre, sku: l.sku, cant: Number(l.qty) || 0, ref: folio });
    });
    saveProducts(false); saveMovements();
    // 2) Total reembolsado desde el snapshot cobrado, nunca desde la configuración actual
    // ni desde el precio (manipulable) enviado por la interfaz.
    // H-35: se conserva EXACTAMENTE la comparación histórica por renglón crudo
    // —incluido su comportamiento ante renglones repetidos— y sólo se sustituye
    // la fuente: lo consumido en vez de lo devuelto. Sin cambios registrados
    // ambas cantidades son idénticas, así que ningún importe se altera.
    const allReturned = (sale.lineas || []).every(x => {
      const extra = items.filter(l => l.sku === x.sku && l.talla === x.talla).reduce((a, l) => a + (Number(l.qty) || 0), 0);
      const row = saldo.find(b => b.sku === x.sku && b.talla === x.talla);
      return (row ? row.consumida : 0) + extra >= (Number(x.qty) || 0);
    });
    const linePrice = l => {
      const soldLine = (sale.lineas || []).find(x => x.sku === l.sku && x.talla === l.talla);
      return soldLine ? Number(soldLine.precio) || 0 : 0;
    };
    let refund = money(items.reduce((a, l) => a + linePrice(l) * (Number(l.qty) || 0), 0));
    if (allReturned) refund = money((Number(sale.total) || 0) - returnsForFolio(folio).reduce((a, r) => a + (Number(r.total) || 0), 0));
    // 3) Reversión proporcional de comisión/ventas del vendedor (configurable en Configuración)
    const ids = sale.vendedores || [];
    if (window.CONFIG.get('returns.reverseCommission') && ids.length && refund > 0) {
      const share = refund / ids.length;
      const grossTotal = Number(sale.total) || 0;
      const taxRatio = grossTotal > 0 ? (Number(sale.iva) || 0) / grossTotal : 0;
      const neto = share * (1 - taxRatio);
      const bruto = share;
      const base = (sale.comisionBase || window.CONFIG.get('commission.base')) === 'bruto' ? bruto : neto;
      ids.forEach(sid => {
        const s = sellers.find(x => x.id === sid);
        if (s) {
          const baseVersion = Number(s._syncVersion) || 0;
          const beforeVentas = Number(s.ventasMes) || 0;
          const beforeComision = Number(s.comisionAcum) || 0;
          const c = base * (s.comisionPct || 0) / 100;
          s.comisionAcum = Math.max(0, Math.round((beforeComision - c) * 100) / 100);
          s.ventasMes = Math.max(0, Math.round((beforeVentas - share) * 100) / 100);
          sellerEffects.push({
            id: s.id, base_version: baseVersion,
            ventas_mes_delta: s.ventasMes - beforeVentas,
            comision_acum_delta: s.comisionAcum - beforeComision,
            after_ventas_mes: s.ventasMes, after_comision_acum: s.comisionAcum,
          });
        }
      });
      saveSellers(false);
    }
    // 4) Ajuste del total del cliente (best-effort por nombre; los apartados/genéricos no aplican)
    if (refund > 0 && sale.cliente) {
      const c = clients.find(x => !x.generic && ((sale.clienteId && x.id === sale.clienteId) || (!sale.clienteId && x.nombre === sale.cliente)));
      if (c) {
        const beforeTotal = Number(c.total) || 0;
        c.total = Math.max(0, Math.round((beforeTotal - refund) * 100) / 100);
        clientEffect = {
          id: c.id, base_version: Number(c._syncVersion) || 0,
          total_delta: c.total - beforeTotal, after_total: c.total,
        };
        saveClients(false);
      }
    }
    // 5) Estado de la venta original: total vs parcial
    sale.estado = allReturned ? 'Devuelto' : 'Devolución parcial';
    saveSales();
    // 6) Registro de la devolución (al frente = más reciente) + sincronización
    const ret = {
      id, folio, fecha, cliente: sale.cliente, vendedores: ids.slice(),
      metodo: metodo || sale.metodo, total: refund, notas: notas || '',
      lineas: items.map(l => {
        const p = products.find(x => x.sku === l.sku);
        return { productId: p ? p.id : undefined, sku: l.sku, nombre: l.nombre, talla: l.talla, qty: Number(l.qty) || 0, motivo: l.motivo || '', precio: linePrice(l) };
      }),
    };
    returns.unshift(ret);
    saveReturns();
    if (!remoteApplying) try { window.CORE.invokeSync('pushReturn', ret, { stockLines, clientEffect, sellerEffects }); } catch (e) { /* offline */ }
    return { ok: true, ret };
  }

  // ---- Usuarios (= personas en sellers; admin y/o vendedor) ----
  function addUser(u) {
    const s = {
      id: 'u-' + Date.now(), nombre: (u.nombre || '').trim(), iniciales: iniDe(u.nombre),
      color: u.color || '#64748b', comisionPct: Number(u.comisionPct) || 0,
      commissionOverridePct: null, sellerLevelCode: null, commissionPolicyVersion: 1,
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
    const version = Number(s._syncVersion) || 0;
    const i = sellers.findIndex(x => x.id === id);
    sellers.splice(i, 1); saveSellers();
    try { window.CORE.invokeSync('deleteRow', 'sellers', id, version); } catch (e) { /* offline */ }
    return { ok: true };
  }
  // Borra un cliente de local Y de la nube (mismo patrón que removeUser/removeProduct). El cliente
  // genérico de mostrador no se puede borrar (lo requiere el POS).
  function removeClient(id) {
    const c = clients.find(x => x.id === id);
    if (!c) return { ok: false, error: 'No existe' };
    if (c.generic) return { ok: false, error: 'El cliente genérico no se puede borrar' };
    const version = Number(c._syncVersion) || 0;
    const i = clients.findIndex(x => x.id === id);
    clients.splice(i, 1); saveClients();
    try { window.CORE.invokeSync('deleteRow', 'clients', id, version); } catch (e) { /* offline */ }
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
    const version = Number(promos[i]._syncVersion) || 0;
    promos.splice(i, 1); savePromos();
    try { window.CORE.invokeSync('deleteRow', 'promotions', id, version); } catch (e) { /* offline */ }
  }
  function duplicatePromo(id) {
    const p = promos.find(x => x.id === id);
    if (!p) return null;
    const c = JSON.parse(JSON.stringify(p));
    c.id = 'promo-' + Date.now(); c.nombre = p.nombre + ' (copia)'; c.creado = Date.now(); c.pausado = true;
    promos.unshift(c); savePromos();
    return c;
  }

  // Borra un producto de local Y de la nube. Antes solo se hacía splice + saveProducts (upsert),
  // que NO elimina la fila en Supabase: el producto "revivía" en el siguiente pull. Mismo patrón
  // que removeUser/removePromo.
  function removeProduct(id) {
    const i = products.findIndex(x => x.id === id);
    if (i < 0) return false;
    try { assertLayawayProductsUnlocked([id]); } catch (e) { return false; }
    const version = Number(products[i]._syncVersion) || 0;
    products.splice(i, 1); saveProducts();
    try { window.CORE.invokeSync('deleteRow', 'products', id, version); } catch (e) { /* offline */ }
    return true;
  }

  // Restaura el catálogo original de fábrica
  function resetProducts() {
    if (readLayawayProductLocks().length) return false;
    products.length = 0;
    seed.map(hydrate).forEach(p => products.push(p));
    saveProducts();
    return products;
  }

  // ── H-46: préstamos de mercancía ─────────────────────────────────────────────
  // Un préstamo es un documento propio: mercancía que SALE del negocio y tiene que
  // volver. No es una venta de $0 ni un movimiento de inventario, y por eso no
  // reutiliza ninguno de los dos:
  //   · `pos.movements` es historial de sólo lectura para el cliente —cada pull
  //     reemplaza el arreglo—, así que un movimiento local de préstamo se borraría
  //     solo en la siguiente sincronización;
  //   · el consecutivo diario de la venta vive en `pos.folio_counters` y gastar un
  //     número aquí movería la numeración comercial de las ventas (`ADR-001`).
  // El documento CONGELA su propia evidencia —nombre, SKU, talla y persona— para
  // seguir siendo explicable si el producto o el cliente se editan o se borran
  // después (`R-DOM-02`).
  //
  // H-62: el préstamo SÍ se replica. Cada operación viaja por la cola offline y
  // se confirma con `pos.commit_loan_operation()`, una transacción idempotente
  // por (operación, payload) sobre `pos.loan_documents`, donde el documento se
  // guarda entero: la evidencia congelada viaja tal cual, sin normalizar. La
  // terminal conserva en `_loanVersion` la versión confirmada por el servidor, y
  // ése es también el indicador de «esto ya está en la nube».
  //
  // Los préstamos NO mueven existencias. La cifra «unidades fuera» se deriva de
  // esta colección mediante `loanedQty()`, que es su única autoridad.
  const LOAN_ESTADOS = ['pendiente', 'devuelto', 'no_devuelto'];
  const LOAN_PERSONA_TIPOS = ['cliente', 'empleado', 'otro'];
  // H-62: el cuarto segmento OPCIONAL es el código corto de la terminal, igual
  // que en el folio de venta (`FOLIO_RE`). Sólo aparece cuando dos terminales
  // generaron el mismo consecutivo el mismo día y la nube lo rechazó; el folio
  // ya impreso sobrevive como alias. Aditivo: un folio sin él sigue casando.
  const LOAN_FOLIO_RE = /^PR-(\d{6})-(\d{3,})(?:-([A-Z0-9]{2,4}))?$/;
  const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
  const soloDia = v => String(v == null ? '' : v).slice(0, 10);
  const horaActual = () => now().slice(11, 16);
  const diaActual = () => now().slice(0, 10);
  // Identidad técnica del préstamo. No se reutiliza `newOperationId()`: su valor de
  // respaldo se identifica como venta y estas dos identidades no son la misma cosa.
  function newLoanId() {
    try {
      if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    } catch (e) { /* respaldo portable */ }
    return 'loan-' + window.CORE.getDeviceId() + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function parseLoanFolio(folio) {
    const m = String(folio == null ? '' : folio).trim().toUpperCase().match(LOAN_FOLIO_RE);
    return m ? { date: m[1], seq: parseInt(m[2], 10), terminal: m[3] || null } : null;
  }
  // ── H-62: el folio impreso no cambia ───────────────────────────────────────
  // Mismo contrato que la venta (`ADR-001` · `docs/02-architecture.md` § El folio
  // impreso no cambia). Si la nube rechaza el folio porque otra terminal ya lo
  // emitió hoy, el préstamo recibe un folio nuevo y el que YA FIRMÓ el cliente
  // en el vale se conserva como alias: sigue resolviendo búsqueda y reimpresión.
  function loanFolioAliases(loan) {
    return Array.isArray(loan && loan.folioAliases) ? loan.folioAliases : [];
  }
  function findLoanByFolio(folioOrAlias) {
    const term = String(folioOrAlias == null ? '' : folioOrAlias).trim();
    if (!term) return null;
    const up = term.toUpperCase();
    return loans.find(l => l.folio === term)
      || loans.find(l => String(l.folio || '').toUpperCase() === up)
      || loans.find(l => loanFolioAliases(l).some(a => String(a).toUpperCase() === up))
      || null;
  }
  // Folio seguro entre terminales. El primer intento añade el código corto de
  // ESTA terminal —tres caracteres base 36, el mismo `terminalCode()` que usa el
  // folio provisional de venta—; si aun así chocara (dos terminales con el mismo
  // código, una en 46 656) se cae al token de la identidad técnica, que es único
  // por construcción.
  function collisionSafeLoanFolio(folio, loanId, intento) {
    const base = String(folio || '').trim().toUpperCase();
    if (Number(intento) > 1) return collisionSafeFolio(base, loanId);
    const tag = terminalCode();
    return base.endsWith('-' + tag) ? collisionSafeFolio(base, loanId) : base + '-' + tag;
  }
  // Incorpora los préstamos bajados de la nube. NO es un reemplazo ciego: un
  // préstamo local que el servidor todavía no confirmó —sin `_loanVersion`—
  // sobrevive al pull, porque su envío puede seguir en la cola o estar pendiente
  // de migrar. Perderlo aquí sería perder mercancía que está fuera del negocio.
  // Un tombstone remoto sí retira el documento local (`R-CLI-04`).
  function applyRemoteLoans(rows) {
    const list = Array.isArray(rows) ? rows : [];
    // Una lectura vacía nunca sacrifica la cartera local: puede ser una lectura
    // parcial, o una nube a la que todavía no se migró nada. Mismo criterio que
    // el catálogo de productos.
    if (!list.length && loans.length) return false;
    remoteApplying = true;
    try {
      const sinConfirmar = loans.filter(l => l && l._loanVersion == null);
      const remotos = new Map();
      list.forEach(r => { if (r && r.id) remotos.set(r.id, r); });
      loans.length = 0;
      remotos.forEach(r => { if (!r._deletedAt) loans.push(r); });
      sinConfirmar.forEach(l => { if (!remotos.has(l.id)) loans.push(l); });
      loans.sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
      saveLoans();
    } finally { remoteApplying = false; }
    return true;
  }
  // Reidentificación del folio de un préstamo todavía no confirmado por la nube.
  function rekeyLoanFolio(id, oldFolio, newFolio) {
    const loan = loans.find(l => l.id === id && l.folio === oldFolio);
    if (!loan || loan._loanVersion != null || !newFolio || newFolio === oldFolio) return false;
    const aliases = loanFolioAliases(loan).slice();
    if (oldFolio && !aliases.includes(oldFolio)) aliases.push(oldFolio);
    loan.folioAliases = aliases.filter(a => a !== newFolio);
    loan.folio = newFolio;
    saveLoans();
    return true;
  }
  // Referencia comercial del préstamo: `PR-{AAMMDD}-{CONSECUTIVO}`. El día sale de la
  // MISMA fecha que se guarda en el documento, nunca de una segunda lectura del reloj
  // (`R-DOM-03`), y el consecutivo se deriva de los préstamos que esta terminal ya
  // conoce de ese día.
  function nextLoanFolio(fecha) {
    const date = businessDate(fecha);
    const seq = loans.reduce((m, l) => {
      const p = parseLoanFolio(l.folio);
      return p && p.date === date && p.seq > m ? p.seq : m;
    }, 0) + 1;
    return 'PR-' + date + '-' + String(seq).padStart(3, '0');
  }
  function normalizeLoanPersona(raw) {
    const p = raw || {};
    const nombre = String(p.nombre || '').trim();
    if (!nombre) return null;
    return {
      tipo: LOAN_PERSONA_TIPOS.indexOf(p.tipo) >= 0 ? p.tipo : 'otro',
      id: p.id || null,
      nombre,
      tel: String(p.tel || '').trim(),
    };
  }
  // Piezas comprometidas y piezas todavía fuera. Un renglón puede regresar por partes.
  function prestamoPiezas(loan) {
    return ((loan && loan.lineas) || []).reduce((a, l) => a + (Number(l.qty) || 0), 0);
  }
  function prestamoPendientes(loan) {
    return ((loan && loan.lineas) || []).reduce((a, l) => (
      a + Math.max(0, (Number(l.qty) || 0) - (Number(l.devueltas) || 0))
    ), 0);
  }
  // Autoridad única del atraso: compara la fecha ESPERADA guardada en el documento
  // contra el día de referencia. `dias` positivo = días de retraso; negativo = días
  // que faltan. Sólo un préstamo `pendiente` con piezas fuera puede estar vencido:
  // uno cerrado como `no_devuelto` ya declaró su desenlace y no se vuelve a alarmar.
  function prestamoAtraso(loan, hoy) {
    const pendientes = prestamoPendientes(loan);
    const esperada = soloDia(loan && loan.fechaEsperada);
    if (!loan || loan.estado !== 'pendiente' || !pendientes || !DIA_RE.test(esperada)) {
      return { vencido: false, dias: null, pendientes };
    }
    const ref = DIA_RE.test(soloDia(hoy)) ? soloDia(hoy) : diaActual();
    const dias = Math.round((Date.parse(ref + 'T00:00:00') - Date.parse(esperada + 'T00:00:00')) / 86400000);
    return { vencido: dias > 0, dias, pendientes };
  }
  function prestamosVencidos(hoy) {
    return loans.filter(l => prestamoAtraso(l, hoy).vencido);
  }
  // Unidades de un artículo que están fuera del negocio por un préstamo abierto.
  // Los préstamos no descuentan existencias: quien necesite mostrar «hay 5, 2 están
  // prestadas» consume esta función y no vuelve a recorrer la colección.
  function loanedQty(sku, talla) {
    return loans.reduce((a, l) => (
      l.estado !== 'pendiente' ? a : a + (l.lineas || []).reduce((b, x) => (
        x.sku === sku && (talla == null || x.talla === talla)
          ? b + Math.max(0, (Number(x.qty) || 0) - (Number(x.devueltas) || 0))
          : b
      ), 0)
    ), 0);
  }
  function registrarPrestamo(input) {
    const d = input || {};
    const dia = soloDia(d.fecha) || diaActual();
    if (!DIA_RE.test(dia)) return { ok: false, error: 'La fecha del préstamo no es válida' };
    const esperada = soloDia(d.fechaEsperada);
    if (!DIA_RE.test(esperada)) return { ok: false, error: 'Falta la fecha esperada de devolución' };
    if (esperada < dia) return { ok: false, error: 'La devolución esperada no puede ser anterior al préstamo' };
    const persona = normalizeLoanPersona(d.persona);
    if (!persona) return { ok: false, error: 'Falta el nombre de quien recibe la mercancía' };
    const lineas = [];
    (d.lineas || []).forEach(l => {
      const qty = Math.floor(Number(l && l.qty) || 0);
      const talla = String((l && l.talla) || '').trim();
      if (qty <= 0 || !talla) return;
      const p = products.find(x => x.id === (l.productId || l.id)) || products.find(x => x.sku === l.sku);
      if (!p) return;
      const key = p.sku + '|' + talla;
      const ex = lineas.find(x => x.key === key);
      if (ex) { ex.qty += qty; return; }
      // `precio` es el precio de lista de la talla en el momento del préstamo
      // (autoridad de H-36) y se congela: es lo que vale la pérdida si la pieza no
      // vuelve, y no puede depender de una edición posterior del catálogo.
      lineas.push({
        key, productId: p.id, sku: p.sku, nombre: p.nombre, talla, qty, devueltas: 0,
        precio: Number(listPrice(p, talla)) || 0,
      });
    });
    if (!lineas.length) return { ok: false, error: 'Agrega al menos una pieza al préstamo' };
    const loan = {
      id: newLoanId(),
      fecha: dia + ' ' + horaActual(),
      fechaEsperada: esperada,
      fechaDevolucion: null,
      estado: 'pendiente',
      persona, lineas, devoluciones: [],
      nota: String(d.nota || '').trim(),
      notaCierre: '',
      usuario: String(d.usuario || '').trim(),
    };
    loan.folio = nextLoanFolio(loan.fecha);
    loans.unshift(loan); saveLoans();
    try { window.CORE.invokeSync('pushLoanOperation', 'deliver', loan, 0); } catch (e) { /* offline */ }
    return { ok: true, loan };
  }
  // Devolución total o parcial. Cada entrega deja su propio asiento en
  // `loan.devoluciones`; `fechaDevolucion` —la fecha REAL que pide el negocio— se
  // fija con el asiento que completa el préstamo. Un préstamo dado por perdido que
  // finalmente regresa se acepta: vuelve a `pendiente` o cierra como `devuelto`.
  function registrarDevolucionPrestamo(id, input) {
    const d = input || {};
    const loan = loans.find(x => x.id === id);
    if (!loan) return { ok: false, error: 'El préstamo no existe' };
    if (loan.estado === 'devuelto') return { ok: false, error: 'Este préstamo ya está devuelto por completo' };
    const baseVersion = Number(loan._loanVersion) || 0;
    const dia = soloDia(d.fecha) || diaActual();
    if (!DIA_RE.test(dia)) return { ok: false, error: 'La fecha de devolución no es válida' };
    if (dia < soloDia(loan.fecha)) return { ok: false, error: 'La devolución no puede ser anterior al préstamo' };
    const pedido = {};
    (d.lineas || []).forEach(l => {
      const qty = Math.floor(Number(l && l.qty) || 0);
      if (qty > 0 && l && l.key) pedido[l.key] = (pedido[l.key] || 0) + qty;
    });
    const claves = Object.keys(pedido);
    if (!claves.length) return { ok: false, error: 'Indica cuántas piezas regresaron' };
    for (let i = 0; i < claves.length; i++) {
      const linea = loan.lineas.find(l => l.key === claves[i]);
      if (!linea) return { ok: false, error: 'El préstamo no incluye esa pieza' };
      const restante = (Number(linea.qty) || 0) - (Number(linea.devueltas) || 0);
      if (pedido[claves[i]] > restante) {
        return { ok: false, error: `Sólo faltan ${restante} pieza(s) de ${linea.nombre} talla ${linea.talla}` };
      }
    }
    claves.forEach(k => {
      const linea = loan.lineas.find(l => l.key === k);
      linea.devueltas = (Number(linea.devueltas) || 0) + pedido[k];
    });
    if (!Array.isArray(loan.devoluciones)) loan.devoluciones = [];
    const asiento = {
      fecha: dia + ' ' + horaActual(),
      lineas: claves.map(k => ({ key: k, qty: pedido[k] })),
      nota: String(d.nota || '').trim(),
    };
    loan.devoluciones.push(asiento);
    const completo = prestamoPendientes(loan) === 0;
    loan.estado = completo ? 'devuelto' : 'pendiente';
    loan.fechaDevolucion = completo ? asiento.fecha : null;
    if (completo && asiento.nota) loan.notaCierre = asiento.nota;
    saveLoans();
    try { window.CORE.invokeSync('pushLoanOperation', 'return', loan, baseVersion); } catch (e) { /* offline */ }
    return { ok: true, loan, cerrado: completo };
  }
  // Declarar la pérdida. No mueve existencias —el préstamo nunca las movió— pero
  // deja el desenlace escrito y saca al préstamo de la lista de vencidos.
  function marcarPrestamoNoDevuelto(id, input) {
    const d = input || {};
    const loan = loans.find(x => x.id === id);
    if (!loan) return { ok: false, error: 'El préstamo no existe' };
    if (loan.estado === 'devuelto') return { ok: false, error: 'Este préstamo ya está devuelto' };
    if (!prestamoPendientes(loan)) return { ok: false, error: 'Este préstamo no tiene piezas fuera' };
    const baseVersion = Number(loan._loanVersion) || 0;
    const dia = soloDia(d.fecha) || diaActual();
    if (!DIA_RE.test(dia)) return { ok: false, error: 'La fecha no es válida' };
    loan.estado = 'no_devuelto';
    loan.fechaCierre = dia + ' ' + horaActual();
    loan.notaCierre = String(d.nota || '').trim();
    saveLoans();
    try { window.CORE.invokeSync('pushLoanOperation', 'shortage', loan, baseVersion); } catch (e) { /* offline */ }
    return { ok: true, loan };
  }
  // Corregir la captura. Sólo mientras nada haya regresado: con devoluciones
  // asentadas el documento ya tiene consecuencias y se corrige hacia adelante.
  function actualizarPrestamo(id, patch) {
    const loan = loans.find(x => x.id === id);
    if (!loan) return { ok: false, error: 'El préstamo no existe' };
    if ((loan.devoluciones || []).length) return { ok: false, error: 'Ya hay devoluciones registradas: no se puede editar' };
    const p = patch || {};
    const baseVersion = Number(loan._loanVersion) || 0;
    const wasShortage = loan.estado === 'no_devuelto';
    if (p.persona !== undefined) {
      const persona = normalizeLoanPersona(p.persona);
      if (!persona) return { ok: false, error: 'Falta el nombre de quien recibe la mercancía' };
      loan.persona = persona;
    }
    if (p.fechaEsperada !== undefined) {
      const esperada = soloDia(p.fechaEsperada);
      if (!DIA_RE.test(esperada)) return { ok: false, error: 'Falta la fecha esperada de devolución' };
      if (esperada < soloDia(loan.fecha)) return { ok: false, error: 'La devolución esperada no puede ser anterior al préstamo' };
      loan.fechaEsperada = esperada;
    }
    if (p.nota !== undefined) loan.nota = String(p.nota || '').trim();
    if (p.estado !== undefined && p.estado === 'pendiente' && loan.estado === 'no_devuelto') loan.estado = 'pendiente';
    saveLoans();
    try { window.CORE.invokeSync('pushLoanOperation', wasShortage && loan.estado === 'pendiente' ? 'reopen' : 'edit', loan, baseVersion); } catch (e) { /* offline */ }
    return { ok: true, loan };
  }
  function eliminarPrestamo(id) {
    const i = loans.findIndex(x => x.id === id);
    if (i < 0) return { ok: false, error: 'El préstamo no existe' };
    if ((loans[i].devoluciones || []).length) return { ok: false, error: 'Ya hay devoluciones registradas: no se puede eliminar' };
    const loan = loans[i];
    const baseVersion = Number(loan._loanVersion) || 0;
    loans.splice(i, 1); saveLoans();
    try { window.CORE.invokeSync('pushLoanOperation', 'delete', loan, baseVersion); } catch (e) { /* offline */ }
    return { ok: true };
  }

  // ── Simulación de demostración (LOCAL-ONLY: nunca toca la nube) ─────────────────
  // Genera catálogo, clientes, vendedores y ~300 ventas (+ devoluciones) PASADAS por el
  // motor real, así TODO lo calculado (stock, comisiones, totales, reportes) se deriva solo.
  // Durante toda la operación remoteApplying=true ⇒ no sincroniza nada.
  const LS_DEMO = 'balam_demo';
  function demoActive() { try { return localStorage.getItem(LS_DEMO) === '1'; } catch (e) { return false; } }
  const rawSave = (key, arr) => { try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) { /* cuota */ } };
  function persistAllLocal() {
    rawSave(LS_KEY, products); rawSave(LS_CLIENTS, clients); rawSave(LS_SELLERS, sellers);
    rawSave(LS_SALES, sales); rawSave(LS_MOVES, movements); rawSave(LS_RETURNS, returns);
    rawSave(LS_PROMOS, promos); rawSave(LS_LIQ, liquidations); rawSave(LS_PAYMENTS, payments);
    rawSave(LS_LOANS, loans);
  }
  function clearAllLocal() {
    products.length = 0; sales.length = 0; movements.length = 0; returns.length = 0; payments.length = 0;
    promos.length = 0; liquidations.length = 0; loans.length = 0;
    clients.length = 0; seedClients.forEach(c => clients.push(JSON.parse(JSON.stringify(c)))); // solo el genérico
    sellers.length = 0; seedSellers.forEach(s => sellers.push(JSON.parse(JSON.stringify(s)))); // solo el admin
    try {
      localStorage.removeItem(LS_FOLIO); localStorage.removeItem(LS_FOLIO_V2);
      localStorage.removeItem(LS_PERIODO);
    } catch (e) { /* */ }
    periodoInicio = '';
  }

  // Vacía a estado de producción (sin datos). Local-only: NO borra la nube. Si hay sesión, el llamador
  // (DemoPanel) avisa que Supabase conserva los datos y se repoblarán al recargar.
  function resetEmpty() {
    if (readLayawayProductLocks().length) return false;
    remoteApplying = true;
    try {
      clearAllLocal(); persistAllLocal();
      try { localStorage.removeItem(LS_DEMO); } catch (e) { /* */ }
      // Descarta lo pendiente de sincronizar para que no se reenvíe nada de la simulación.
      try { window.CORE.invokeSync('clearQueue'); } catch (e) { /* */ }
    } finally { remoteApplying = false; }
    return true;
  }

  // Borra los datos de PRUEBA CONSERVANDO el catálogo de productos (inventario), los
  // vendedores/usuarios y la configuración. Complemento local de supabase/LIMPIAR-PRUEBAS.sql:
  // el SQL vacía la nube, esto vacía ESTE dispositivo (la app nunca borra lo local cuando la
  // nube llega vacía — ver store.jsx pullDomain — y sin esto las pruebas reaparecerían y hasta
  // se re-subirían, porque savePromos/saveClients suben el arreglo COMPLETO).
  // El stock vuelve a como estaba antes de probar: se reintegra lo que descontaron las ventas
  // y se quita lo que reingresaron las devoluciones (mismo criterio que recordSale/recordReturn).
  function resetTestData() {
    if (readLayawayProductLocks().length) return false;
    remoteApplying = true; // vaciado local: que no encole nada a medias
    try {
      // 1) Revertir stock. Solo las ventas que SÍ descontaron (recordSale: cobrada =
      //    estado distinto de Apartado/Cancelado); las devoluciones ya lo habían reingresado.
      const bySku = {};
      products.forEach(p => { if (p.sku) bySku[p.sku] = p; });
      const bump = (sku, talla, delta) => {
        const p = bySku[sku]; if (!p) return;
        const e = stockVariantOf(p, talla); if (!e) return;
        e.stock = Math.max(0, (Number(e.stock) || 0) + delta);
      };
      sales.forEach(s => {
        if (s.estado === 'Apartado' || s.estado === 'Cancelado') return; // nunca descontaron
        (s.lineas || []).forEach(l => bump(l.sku, l.talla, Number(l.qty) || 0));
      });
      returns.forEach(r => (r.lineas || []).forEach(l => bump(l.sku, l.talla, -(Number(l.qty) || 0))));

      // 2) Vaciar lo transaccional. De movimientos SOLO los de venta/devolución: las
      //    'Entrada'/'Ajuste'/'Transferencia' son historial de inventario y se conservan.
      sales.length = 0; returns.length = 0; promos.length = 0; liquidations.length = 0; payments.length = 0;
      // Los préstamos de prueba también son datos transaccionales. No hay stock que
      // revertir: un préstamo nunca descontó existencias.
      loans.length = 0;
      const keepMoves = movements.filter(m => m.tipo !== 'Venta' && m.tipo !== 'Devolución');
      movements.length = 0; keepMoves.forEach(m => movements.push(m));

      // 3) Clientes: solo el genérico de mostrador (contadores en cero).
      clients.length = 0; seedClients.forEach(c => clients.push(JSON.parse(JSON.stringify(c))));

      // 4) Vendedores: se CONSERVAN (usuarios, contraseñas, comisión, meta); solo se ponen
      //    en cero los acumulados del periodo que generaron las ventas de prueba.
      sellers.forEach(s => { s.ventasMes = 0; s.ventasNum = 0; s.comisionAcum = 0; });

      // 5) Folio y periodo de comisiones vuelven a empezar. Se borra también la
      //    reserva diaria de H-33: el complemento SQL vacía pos.folio_counters.
      try {
        localStorage.removeItem(LS_FOLIO); localStorage.removeItem(LS_FOLIO_V2);
        localStorage.removeItem(LS_PERIODO);
      } catch (e) { /* */ }
      periodoInicio = '';
      persistAllLocal();
      // Descarta lo pendiente de subir: son operaciones de las pruebas.
      try { window.CORE.invokeSync('clearQueue'); } catch (e) { /* */ }
    } finally { remoteApplying = false; }
    // 6) Subir lo que el SQL NO puede reconstruir: el stock restaurado y los contadores en
    //    cero. (Las filas borradas —ventas, devoluciones, promos, clientes— las quita el SQL.)
    syncUp('products', products); syncUp('sellers', sellers); syncUp('clients', clients);
    return true;
  }

  function seedDemo() {
    if (readLayawayProductLocks().length) {
      return { ok: false, error: 'Hay una liquidación pendiente; reconcíliala antes de reemplazar los datos locales' };
    }
    remoteApplying = true; bulkMode = true; // LOCAL-ONLY y rápido (persiste al final)
    try {
      clearAllLocal();
      const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
      const pick = arr => arr[Math.floor(Math.random() * arr.length)];
      const C2 = window.CONFIG, p2 = n => String(n).padStart(2, '0');
      const cats = C2.codes('category'), colors = C2.codes('color'), telas = C2.codes('fabric'),
        mangas = C2.codes('sleeve'), cuellos = C2.codes('neck'), orns = C2.codes('ornament');
      const NOMS = ['Tira Red', 'Panal Tadeo', 'Presidencial', 'Clásica Lisa', 'Hexágonos', 'Café Capuchino',
        'Rombitos', 'Alforza Doble', 'Líneas Cruzadas', 'Pirámide', 'Manta Lisa', 'Esferas Doradas',
        'Nuditos', 'Pestañas Finas', 'Marino', 'Crucecitas', 'Moñitos', 'Serpiente', 'Capuchino',
        'Bordado Real', 'Tira X', 'Alforza Ancha', 'Doble Línea', 'Heritage'];

      // 1) Productos (~24) con stock en tallas centrales
      for (let i = 0; i < 24; i++) {
        const numberSizes = Math.random() < 0.35;
        const letras = numberSizes ? [] : SIZES_LETRA().map((_, k) => (k >= 1 && k <= 6 ? rnd(0, 14) : 0));
        const nums = numberSizes ? SIZES_NUM().map((_, k) => (k >= 2 && k <= 7 ? rnd(0, 10) : 0)) : [];
        const sizeCategoryId = numberSizes ? 'size_number' : 'size_letter';
        products.push(hydrate({
          id: 'dp' + i, cat: pick(cats), manga: pick(mangas), tela: pick(telas), color: pick(colors),
          cuello: pick(cuellos), modelo: String(100 + i), nombre: NOMS[i % NOMS.length],
          orn: (orns && orns.length ? pick(orns) : '—'), ornColors: [], precio: rnd(8, 28) * 50,
          pop: Math.random() < 0.25,
          sizeCategoryId, attrs: { __sizeCategoryId: sizeCategoryId },
          stock: mkStock(letras, nums).filter(v => v.escala === (numberSizes ? 'N' : 'L')),
        }));
      }

      // 2) Clientes (8) — el genérico ya está; con fecha de nacimiento (para cumpleaños)
      const CNOMS = ['José Luis Aguilar', 'María Fernanda Rosado', 'Carlos Manuel Uc', 'Ana Patricia Canul',
        'Roberto Sansores', 'Gabriela Couoh', 'Luis Ángel Pat', 'Diana Carolina Be'];
      const TL = SIZES_LETRA();
      CNOMS.forEach((nombre, i) => {
        const by = rnd(1975, 2002), bm = rnd(1, 12), bd = rnd(1, 28);
        clients.push({ id: 'dc' + i, nombre, tel: `999 ${rnd(100, 999)} ${rnd(1000, 9999)}`, compras: 0, total: 0,
          ultima: '', talla: (TL.length ? pick(TL) : 'M'), notas: '', email: '',
          nacimiento: `${by}-${p2(bm)}-${p2(bd)}` });
      });

      // 3) Vendedores (4) — el admin ya está
      [['Rocío Méndez', '#b8f040'], ['Iván Castro', '#3b82f6'], ['Diana Pérez', '#f59e0b'], ['Mateo Ríos', '#ef4444']]
        .forEach(([nombre, color], i) => sellers.push({ id: 'ds' + i, nombre, iniciales: iniDe(nombre), color,
          comisionPct: rnd(4, 6), metaMes: rnd(30, 50) * 5000, ventasMes: 0, ventasNum: 0, comisionAcum: 0,
          bono: 'Sin bono', role: 'vendedor', email: null, passwordHash: null, active: true }));

      const realClients = clients.filter(c => !c.generic);
      const realSellers = sellers.filter(s => s.role === 'vendedor');
      const generico = clients.find(c => c.generic);
      const metodos = (C2.codes('payment_method') || []).length ? C2.codes('payment_method') : ['Efectivo', 'Tarjeta', 'Transferencia'];

      // 4) ~300 ventas en 90 días — fechas ascendentes (folios alineados a la fecha)
      const dates = [];
      for (let i = 0; i < 300; i++) { const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * 90)); d.setHours(rnd(9, 20), rnd(0, 59), 0, 0); dates.push(d); }
      dates.sort((a, b) => a - b);
      dates.forEach(d => {
        const fecha = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
        const r = Math.random();
        const estado = r < 0.05 ? 'Cancelado' : r < 0.13 ? 'Apartado' : 'Pagado';
        const seller = pick(realSellers);
        const client = (Math.random() < 0.4 && generico) ? generico : pick(realClients);
        const ticket = [];
        for (let k = 0, n = rnd(1, 3); k < n; k++) {
          const p = pick(products);
          const avail = resolveProductSizes(p).sizes
            .filter(size => size.active && size.stock > 0)
            .map(size => ({ talla: size.value, escala: size.scale, stock: size.stock }));
          if (!avail.length) continue;
          const v = pick(avail);
          if (ticket.some(t => t.p.id === p.id && t.talla === v.talla)) continue;
          // H-32: el generador resuelve igual que el POS, para que recordSale nunca vuelva a evaluar.
          ticket.push({ p, talla: v.talla, qty: Math.min(rnd(1, 3), v.stock), res: resolveLineDiscount(p, v.talla) });
        }
        if (!ticket.length) return;
        const total = ticket.reduce((a, t) => a + (Number(t.p.precio) || 0) * t.qty, 0);
        const itemCount = ticket.reduce((a, t) => a + t.qty, 0);
        recordSale({ ticket, sellerIds: [seller.id], client, metodo: pick(metodos), estado, total, itemCount, fecha });
      });

      // 5) Devoluciones (~6% de ventas pagadas con líneas)
      const reasons = (C2.codes('return_reason') || []).length ? C2.codes('return_reason') : ['Talla', 'Defecto'];
      const pagadas = sales.filter(s => s.estado === 'Pagado' && (s.lineas || []).length);
      const nRet = Math.round(pagadas.length * 0.06);
      for (let i = 0; i < nRet && pagadas.length; i++) {
        const s = pick(pagadas);
        const linea = pick(s.lineas);
        const sd = new Date(String(s.fecha).replace(' ', 'T')); sd.setDate(sd.getDate() + rnd(1, 10));
        if (sd > new Date()) continue;
        const fecha = `${sd.getFullYear()}-${p2(sd.getMonth() + 1)}-${p2(sd.getDate())} ${p2(rnd(9, 19))}:${p2(rnd(0, 59))}`;
        recordReturn({ folio: s.folio, lineas: [{ sku: linea.sku, nombre: linea.nombre, talla: linea.talla, qty: 1, motivo: pick(reasons), precio: linea.precio }], metodo: s.metodo, fecha });
      }

      // 6) Orden por fecha desc para listados + persistir local
      sales.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
      movements.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
      returns.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
      bulkMode = false;
      persistAllLocal();
      try { localStorage.setItem(LS_DEMO, '1'); } catch (e) { /* */ }
    } finally { remoteApplying = false; bulkMode = false; }
    return { ok: true, products: products.length, clients: clients.length, sellers: sellers.length, sales: sales.length, returns: returns.length };
  }

  window.DATA = {
    products, sellers, clients, sales, movements, promos, liquidations, returns, payments, exchanges, loans,
    sku, regenerateSkus, totalStock, hydrate, mkStock, emptyStock, SIZE_MARK,
    saveProducts, saveSellers, saveClients, saveSales, saveMovements, savePromos, saveReturns, savePayments,
    removeProduct, remapOrphanCodes, catalogHealthReport, hexForColorName, applyOrphanFix, get lastRemap() { return lastRemap; },
    addClient, removeClient, recordSale, nextFolio, collisionSafeFolio, rekeySaleFolio,
    normalizeFolioPrefix, businessDate, folioFromParts, parseFolio, folioPreview,
    folioBlockRequest, applyFolioBlock, terminalCode,
    findSaleByFolio, saleFolioAliases, folioAliasHit, stockOf, isAutoImg, resetProducts, applyRemote, applySyncResult, applySaleCommitResult, mergeRemote, markSaleSync, liquidarComision,
    completarApartado, registrarPagoApartado, paymentsForSale, hasFinancialSnapshot, resolveLineDiscount, saleQuote, cerrarMes, getPeriodoInicio,
    listPrice, priceRange, sanitizePreciosTalla, resolveProductSizes,
    resolveSizeFilterGroups, resolveSizeFilterOptions, sizeFilterMatch, inferSizeCategory,
    recordReturn, returnedQty, returnsForFolio, isReturnable, returnDeadline, saleLineBalance,
    saveExchanges, recognizedValue, supplySources, recordExchange, reverseExchangeCommission,
    revenueSummary, exchangeRevenue, exchangeUnusedValue, exchangeReport, sellerCommissionReport,
    saveLoans, registrarPrestamo, registrarDevolucionPrestamo, marcarPrestamoNoDevuelto,
    actualizarPrestamo, eliminarPrestamo, prestamoPiezas, prestamoPendientes,
    prestamoAtraso, prestamosVencidos, loanedQty, parseLoanFolio, nextLoanFolio, LOAN_ESTADOS,
    applyRemoteLoans, findLoanByFolio, loanFolioAliases, rekeyLoanFolio, collisionSafeLoanFolio,
    requireCatalogResync, clearCatalogResync,
    acquireLayawayProductLock, releaseLayawayProductLock,
    reconcileLayawayProductLocks, ensureLayawayProductLockFromOperation,
    layawayProductLockSnapshot, hasLayawayLiquidationLock,
    assertLayawayProductsUnlocked, assertLocalWriter, awaitLocalWriter,
    get localWriterState() { return localWriterState; },
    get isLocalWriter() { return localWriterAllowed(false); },
    get localWriterLeaseSupported() { return localWriterLeaseSupported; },
    get catalogResyncRequired() { return catalogResyncRequired; },
    addUser, updateUser, removeUser, isEligibleSeller, resolveSellerCommission,
    addPromo, updatePromo, removePromo, duplicatePromo,
    seedDemo, resetEmpty, resetTestData, demoActive,
  };
  const localWriterMutators = [
    'regenerateSkus', 'saveProducts', 'saveSellers', 'saveClients', 'saveSales',
    'saveMovements', 'savePromos', 'saveReturns', 'savePayments', 'removeProduct',
    'applyOrphanFix', 'addClient', 'removeClient', 'recordSale', 'rekeySaleFolio',
    'applyFolioBlock', 'resetProducts', 'applyRemote', 'applySyncResult',
    'applySaleCommitResult', 'mergeRemote', 'markSaleSync', 'liquidarComision',
    'completarApartado', 'registrarPagoApartado', 'cerrarMes', 'recordReturn',
    'saveExchanges', 'recordExchange', 'reverseExchangeCommission', 'saveLoans',
    'registrarPrestamo', 'registrarDevolucionPrestamo', 'marcarPrestamoNoDevuelto',
    'actualizarPrestamo', 'eliminarPrestamo', 'applyRemoteLoans', 'rekeyLoanFolio',
    'addUser', 'updateUser', 'removeUser', 'addPromo', 'updatePromo', 'removePromo',
    'duplicatePromo', 'seedDemo', 'resetEmpty', 'resetTestData',
  ];
  localWriterMutators.forEach(name => {
    const original = window.DATA[name];
    if (typeof original !== 'function') return;
    window.DATA[name] = function (...args) {
      assertLocalWriter(false);
      return original.apply(window.DATA, args);
    };
  });
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
  window.CORE.registerCatalogProducts({
    list: () => products,
    save: () => window.DATA.saveProducts(),
  });
  // H-63: CONFIG necesita saber si una talla está referenciada por el alcance de una
  // promoción antes de dejar que se desactive. Sólo lectura, por el gateway de CORE.
  // Se registra sólo si el contrato existe: varios arneses construyen un CORE mínimo y
  // exigirlo los rompería sin que el producto tenga un defecto (core.jsx y data.jsx
  // siempre viajan en el mismo artefacto). `test-module-contracts.mjs` vigila que las
  // dos puntas del gateway sigan cableadas, así que la guarda no puede esconder su
  // desaparición.
  if (typeof window.CORE.registerCatalogPromotions === 'function') {
    window.CORE.registerCatalogPromotions({ list: () => promos });
  }

  let localWriterRequestActive = false;
  function startLocalWriterLease() {
    if (!localWriterLeaseSupported) {
      setLocalWriterState('unsupported');
      try { remapOrphanCodes(); } catch (e) { /* mejor arrancar que bloquear */ }
      return;
    }
    if (localWriterRequestActive || localWriterState === 'writer') return;
    localWriterRequestActive = true;
    Promise.resolve(window.navigator.locks.request(LOCAL_WRITER_LOCK, { mode: 'exclusive' }, async () => {
      setLocalWriterState('rebasing');
      if (!rebaseLocalWriterCollections()) {
        setLocalWriterState('blocked');
        return;
      }
      setLocalWriterState('writer');
      localWriterWarningShown = false;
      try { remapOrphanCodes(); } catch (e) { /* el catálogo sigue disponible */ }
      await new Promise(resolve => {
        let released = false;
        localWriterRelease = () => {
          if (released) return;
          released = true;
          localWriterRelease = null;
          resolve();
        };
        window.addEventListener('pagehide', localWriterRelease, { once: true });
        window.addEventListener('beforeunload', localWriterRelease, { once: true });
      });
      setLocalWriterState('waiting');
    })).catch(() => setLocalWriterState('blocked')).finally(() => {
      localWriterRequestActive = false;
    });
  }
  window.addEventListener('pageshow', () => {
    if (localWriterState === 'waiting') startLocalWriterLease();
  });
  startLocalWriterLease();
})();
