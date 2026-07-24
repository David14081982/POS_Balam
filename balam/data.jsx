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

  function saveProducts() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(products)); } catch (e) { /* cuota llena */ }
    if (typeof syncUp === 'function') syncUp('products', products);
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

  let quotaWarned = false, bulkMode = false; // bulkMode: omite escrituras por-llamada durante una generación masiva
  const save = (key, arr) => {
    if (bulkMode) return; // se persiste todo de una vez al final (ver seedDemo)
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
  function saveSales() { save(LS_SALES, sales); }       // ventas suben vía recordSale → STORE.pushSale
  function saveMovements() { save(LS_MOVES, movements); }
  function savePromos() { save(LS_PROMOS, promos); syncUp('promotions', promos); }
  function saveLiquidations() { save(LS_LIQ, liquidations); syncUp('liquidations', liquidations); } // historial — sincroniza a pos.liquidations
  function saveReturns() { save(LS_RETURNS, returns); }  // devoluciones suben vía recordReturn → STORE.pushReturn
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
  function recordSale({ ticket, sellerIds, client, metodo, estado, total, itemCount, fecha: fechaIn }) {
    const folio = nextFolio();
    const fecha = fechaIn || now(); // permite fecha pasada (simulación)
    const cobrada = estado !== 'Apartado' && estado !== 'Cancelado';
    // Cortesía (regalo/giveaway): no se cobra (total $0) y NO genera comisión, pero SÍ descuenta
    // inventario. Se guarda 'valorRegalado' (lo que se habría cobrado) para reportes de cuánto se regaló.
    const cortesia = metodo === 'Cortesía';
    const valorRegalado = cortesia ? (Number(total) || 0) : 0;
    const totalCobrado = cortesia ? 0 : total;
    // 1) Descuento de stock + movimientos (solo si la venta se cobró/entregó)
    if (cobrada) {
      ticket.forEach(l => {
        const e = (l.p.stock || []).find(v => v.talla === l.talla);
        if (e) e.stock = Math.max(0, e.stock - l.qty);
        movements.unshift({ fecha, tipo: 'Venta', producto: l.p.nombre, sku: l.p.sku, cant: -l.qty, ref: folio });
      });
      saveProducts(); saveMovements();
    }
    // 2) Cliente (agregados) — solo registrados y NO en cortesía (no pagó nada).
    if (client && !client.generic && !cortesia) {
      const c = clients.find(x => x.id === client.id);
      if (c) { c.compras = (c.compras || 0) + 1; c.total = (c.total || 0) + total; c.ultima = fecha.slice(0, 10); saveClients(); }
    }
    // 3) Vendedores (reparto de venta y comisión).
    //    Base de comisión configurable (commission.base): 'neto' = sin IVA, 'bruto' = con IVA.
    //    `total` puede incluir o no IVA según tax.included → lo normalizamos a neto/bruto antes de aplicar el %.
    const ids = (sellerIds && sellerIds.length) ? sellerIds : [];
    let comisionVenta = 0;
    if (cobrada && ids.length && !cortesia) {
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
      items: itemCount, total: totalCobrado, metodo, estado,
      descuento: cortesia ? 0 : Math.max(0, subtotalOrig - total), valorRegalado,
      comision: comisionVenta, comisionBase: window.CONFIG.get('commission.base') || 'neto',
      // En cortesía cada línea queda en $0 (no se cobró); el valor vive en precioOrig y valorRegalado.
      lineas: ticket.map(l => ({ sku: l.p.sku, nombre: l.p.nombre, talla: l.talla, qty: l.qty, precio: cortesia ? 0 : unitOf(l), precioOrig: Number(l.p.precio) || 0 })),
    };
    sales.unshift(sale);
    saveSales();
    if (!remoteApplying && window.STORE && window.STORE.pushSale) { try { window.STORE.pushSale(sale); } catch (e) { /* offline */ } }
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
  function recordReturn({ folio, lineas, metodo, notas, fecha: fechaIn }) {
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
    const fecha = fechaIn || now(); // permite fecha pasada (simulación)
    const id = 'ret-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
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
    if (!remoteApplying && window.STORE && window.STORE.pushSale) { try { window.STORE.pushSale(sale); } catch (e) { /* offline */ } }
    // 6) Registro de la devolución (al frente = más reciente) + sincronización
    const ret = {
      id, folio, fecha, cliente: sale.cliente, vendedores: ids.slice(),
      metodo: metodo || sale.metodo, total: refund, notas: notas || '',
      lineas: items.map(l => ({ sku: l.sku, nombre: l.nombre, talla: l.talla, qty: Number(l.qty) || 0, motivo: l.motivo || '', precio: Number(l.precio) || 0 })),
    };
    returns.unshift(ret);
    saveReturns();
    if (!remoteApplying && window.STORE && window.STORE.pushReturn) { try { window.STORE.pushReturn(ret); } catch (e) { /* offline */ } }
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
  // Borra un cliente de local Y de la nube (mismo patrón que removeUser/removeProduct). El cliente
  // genérico de mostrador no se puede borrar (lo requiere el POS).
  function removeClient(id) {
    const c = clients.find(x => x.id === id);
    if (!c) return { ok: false, error: 'No existe' };
    if (c.generic) return { ok: false, error: 'El cliente genérico no se puede borrar' };
    const i = clients.findIndex(x => x.id === id);
    clients.splice(i, 1); saveClients();
    if (window.STORE && window.STORE.deleteRow) { try { window.STORE.deleteRow('clients', id); } catch (e) { /* offline */ } }
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

  // Borra un producto de local Y de la nube. Antes solo se hacía splice + saveProducts (upsert),
  // que NO elimina la fila en Supabase: el producto "revivía" en el siguiente pull. Mismo patrón
  // que removeUser/removePromo.
  function removeProduct(id) {
    const i = products.findIndex(x => x.id === id);
    if (i < 0) return;
    products.splice(i, 1); saveProducts();
    if (window.STORE && window.STORE.deleteRow) { try { window.STORE.deleteRow('products', id); } catch (e) { /* offline */ } }
  }

  // Restaura el catálogo original de fábrica
  function resetProducts() {
    products.length = 0;
    seed.map(hydrate).forEach(p => products.push(p));
    saveProducts();
    return products;
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
    rawSave(LS_PROMOS, promos); rawSave(LS_LIQ, liquidations);
  }
  function clearAllLocal() {
    products.length = 0; sales.length = 0; movements.length = 0; returns.length = 0;
    promos.length = 0; liquidations.length = 0;
    clients.length = 0; seedClients.forEach(c => clients.push(JSON.parse(JSON.stringify(c)))); // solo el genérico
    sellers.length = 0; seedSellers.forEach(s => sellers.push(JSON.parse(JSON.stringify(s)))); // solo el admin
    try { localStorage.removeItem(LS_FOLIO); localStorage.removeItem(LS_PERIODO); } catch (e) { /* */ }
    periodoInicio = '';
  }

  // Vacía a estado de producción (sin datos). Local-only: NO borra la nube. Si hay sesión, el llamador
  // (DemoPanel) avisa que Supabase conserva los datos y se repoblarán al recargar.
  function resetEmpty() {
    remoteApplying = true;
    try {
      clearAllLocal(); persistAllLocal();
      try { localStorage.removeItem(LS_DEMO); } catch (e) { /* */ }
      // Descarta lo pendiente de sincronizar para que no se reenvíe nada de la simulación.
      try { if (window.STORE && window.STORE.clearQueue) window.STORE.clearQueue(); } catch (e) { /* */ }
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
    remoteApplying = true; // vaciado local: que no encole nada a medias
    try {
      // 1) Revertir stock. Solo las ventas que SÍ descontaron (recordSale: cobrada =
      //    estado distinto de Apartado/Cancelado); las devoluciones ya lo habían reingresado.
      const bySku = {};
      products.forEach(p => { if (p.sku) bySku[p.sku] = p; });
      const bump = (sku, talla, delta) => {
        const p = bySku[sku]; if (!p) return;
        const e = (p.stock || []).find(v => v.talla === talla); if (!e) return;
        e.stock = Math.max(0, (Number(e.stock) || 0) + delta);
      };
      sales.forEach(s => {
        if (s.estado === 'Apartado' || s.estado === 'Cancelado') return; // nunca descontaron
        (s.lineas || []).forEach(l => bump(l.sku, l.talla, Number(l.qty) || 0));
      });
      returns.forEach(r => (r.lineas || []).forEach(l => bump(l.sku, l.talla, -(Number(l.qty) || 0))));

      // 2) Vaciar lo transaccional. De movimientos SOLO los de venta/devolución: las
      //    'Entrada'/'Ajuste'/'Transferencia' son historial de inventario y se conservan.
      sales.length = 0; returns.length = 0; promos.length = 0; liquidations.length = 0;
      const keepMoves = movements.filter(m => m.tipo !== 'Venta' && m.tipo !== 'Devolución');
      movements.length = 0; keepMoves.forEach(m => movements.push(m));

      // 3) Clientes: solo el genérico de mostrador (contadores en cero).
      clients.length = 0; seedClients.forEach(c => clients.push(JSON.parse(JSON.stringify(c))));

      // 4) Vendedores: se CONSERVAN (usuarios, contraseñas, comisión, meta); solo se ponen
      //    en cero los acumulados del periodo que generaron las ventas de prueba.
      sellers.forEach(s => { s.ventasMes = 0; s.ventasNum = 0; s.comisionAcum = 0; });

      // 5) Folio y periodo de comisiones vuelven a empezar.
      try { localStorage.removeItem(LS_FOLIO); localStorage.removeItem(LS_PERIODO); } catch (e) { /* */ }
      periodoInicio = '';
      persistAllLocal();
      // Descarta lo pendiente de subir: son operaciones de las pruebas.
      try { if (window.STORE && window.STORE.clearQueue) window.STORE.clearQueue(); } catch (e) { /* */ }
    } finally { remoteApplying = false; }
    // 6) Subir lo que el SQL NO puede reconstruir: el stock restaurado y los contadores en
    //    cero. (Las filas borradas —ventas, devoluciones, promos, clientes— las quita el SQL.)
    syncUp('products', products); syncUp('sellers', sellers); syncUp('clients', clients);
    return true;
  }

  function seedDemo() {
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
        const letras = SIZES_LETRA().map((_, k) => (k >= 1 && k <= 6 ? rnd(0, 14) : 0));
        const nums = (Math.random() < 0.35) ? SIZES_NUM().map((_, k) => (k >= 2 && k <= 7 ? rnd(0, 10) : 0)) : [];
        products.push(hydrate({
          id: 'dp' + i, cat: pick(cats), manga: pick(mangas), tela: pick(telas), color: pick(colors),
          cuello: pick(cuellos), modelo: String(100 + i), nombre: NOMS[i % NOMS.length],
          orn: (orns && orns.length ? pick(orns) : '—'), ornColors: [], precio: rnd(8, 28) * 50,
          pop: Math.random() < 0.25, stock: mkStock(letras, nums),
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
          const avail = (p.stock || []).filter(v => v.stock > 0);
          if (!avail.length) continue;
          const v = pick(avail);
          if (ticket.some(t => t.p.id === p.id && t.talla === v.talla)) continue;
          ticket.push({ p, talla: v.talla, qty: Math.min(rnd(1, 3), v.stock) });
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
    return { products: products.length, clients: clients.length, sellers: sellers.length, sales: sales.length, returns: returns.length };
  }

  window.DATA = {
    products, sellers, clients, sales, movements, promos, liquidations, returns,
    sku, regenerateSkus, totalStock, hydrate, mkStock, emptyStock, SIZE_MARK,
    saveProducts, saveSellers, saveClients, saveSales, saveMovements, savePromos, saveReturns,
    removeProduct, remapOrphanCodes, catalogHealthReport, hexForColorName, applyOrphanFix, get lastRemap() { return lastRemap; },
    addClient, removeClient, recordSale, nextFolio, stockOf, isAutoImg, resetProducts, applyRemote, mergeRemote, liquidarComision,
    completarApartado, cerrarMes, getPeriodoInicio,
    recordReturn, returnedQty, returnsForFolio, isReturnable,
    addUser, updateUser, removeUser,
    addPromo, updatePromo, removePromo, duplicatePromo,
    seedDemo, resetEmpty, resetTestData, demoActive,
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

  // Sana huérfanos existentes al ARRANCAR (p. ej. daño previo por un import de catálogos que
  // re-codificó colores). Va al FINAL del módulo: remapOrphanCodes → saveProducts → syncUp lee
  // 'remoteApplying' (let), que ya debe estar inicializado — llamarlo antes sería TDZ.
  try { remapOrphanCodes(); } catch (e) { /* mejor arrancar que bloquear */ }
})();
