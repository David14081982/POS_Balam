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
    // H-36: excepciones de precio por talla. Se canoniza aquí para que una talla
    // retirada del catálogo o un valor inutilizable no sobrevivan en el mapa.
    p.preciosTalla = sanitizePreciosTalla(p.preciosTalla);
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

  function saveProducts(sync = true) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(products)); } catch (e) { /* cuota llena */ }
    if (sync && typeof syncUp === 'function') syncUp('products', products);
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
        LS_EXCHANGES = 'balam_pos_exchanges_v1';
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
  let periodoInicio = '';
  try { periodoInicio = localStorage.getItem(LS_PERIODO) || ''; } catch (e) { /* sin storage */ }

  // Normaliza personas guardadas antes de unificar usuarios/vendedores.
  sellers.forEach(s => { if (!s.role) s.role = 'vendedor'; if (s.active === undefined) s.active = true; });
  if (!sellers.some(s => s.role === 'admin')) sellers.unshift(seedSellers[0]);

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
    try { window.CORE.invokeSync('pushRows', kind, arr); } catch (e) { /* offline */ }
  }
  function saveSellers(sync = true) { save(LS_SELLERS, sellers); if (sync) syncUp('sellers', sellers); }
  function saveClients(sync = true) { save(LS_CLIENTS, clients); if (sync) syncUp('clients', clients); }
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
  function markSaleSync(folio, status, detail) {
    const sale = sales.find(s => s.folio === folio);
    if (!sale) return false;
    const changed = sale._syncStatus !== status
      || JSON.stringify(sale._syncDetail || null) !== JSON.stringify(detail || null);
    sale._syncStatus = status;
    if (detail) sale._syncDetail = detail;
    else delete sale._syncDetail;
    if (status === 'synced' && detail && detail.stockReserved) sale._stockReserved = true;
    saveSales();
    return changed;
  }
  function saveMovements() { save(LS_MOVES, movements); }
  function savePromos() { save(LS_PROMOS, promos); syncUp('promotions', promos); }
  function saveLiquidations() { save(LS_LIQ, liquidations); syncUp('liquidations', liquidations); } // historial — sincroniza a pos.liquidations
  function saveReturns() { save(LS_RETURNS, returns); }  // devoluciones suben vía recordReturn → STORE.pushReturn
  function savePayments(sync = true) { save(LS_PAYMENTS, payments); if (sync) syncUp('payments', payments); }
  function saveExchanges(sync = true) { save(LS_EXCHANGES, exchanges); if (sync) syncUp('exchanges', exchanges); }
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
    const m = M[kind]; if (!m) return;
    remoteApplying = true;
    try {
      m[0].length = 0;
      rows.filter(r => !r._deletedAt).forEach(r => m[0].push(m[2] ? m[2](r) : r));
      m[1]();
    }
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
  function stockOf(p, talla) { const e = (p.stock || []).find(v => v.talla === talla); return e ? e.stock : 0; }

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
    return { conflicts, operation };
  }
  function addSalePayment(sale, { monto, metodo, tipo, detalle, fecha }, sync = true) {
    const amount = money(monto);
    if (!(amount > 0)) return null;
    const parts = paymentParts(metodo, amount, detalle);
    const p = {
      id: 'pay-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      folio: sale.folio, fecha: fecha || now(), tipo: tipo || 'pago',
      metodo, monto: amount, ...parts,
    };
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
    const conStock = ((product && product.stock) || []).filter(v => Number(v.stock) > 0);
    if (!conStock.length) return { min: general, max: general, unico: true };
    const precios = conStock.map(v => listPrice(product, v.talla));
    const min = Math.min.apply(null, precios);
    const max = Math.max.apply(null, precios);
    return { min, max, unico: min === max };
  }
  // Deja el mapa en su forma canónica: sólo tallas del catálogo vigente y sólo
  // precios utilizables. Se aplica al guardar; la lectura permanece tolerante.
  function sanitizePreciosTalla(mapa) {
    const validas = SIZES_LETRA().concat(SIZES_NUM());
    const out = {};
    if (!mapa || typeof mapa !== 'object') return out;
    Object.keys(mapa).forEach(talla => {
      if (validas.indexOf(talla) < 0) return;
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
  function recordSale({ ticket, sellerIds, client, metodo, estado, subtotal: subtotalIn, iva: ivaIn, total: totalIn, anticipo: anticipoIn, pagoEfectivo: pagoEfectivoIn, pagoOtro: pagoOtroIn, pagoDetalle, metodoPago, ivaPct: ivaPctIn, ivaIncluded: ivaIncludedIn, itemCount, fecha: fechaIn }) {
    const total = money(totalIn);
    const ivaPct = 16;
    const ivaIncluded = true;
    const subtotal = money(total / 1.16);
    const iva = money(total - subtotal);
    const anticipo = anticipoIn == null ? (estado === 'Apartado' ? 0 : total) : money(anticipoIn);
    const pagoEfectivo = pagoEfectivoIn == null ? (metodo === 'Efectivo' ? total : 0) : money(pagoEfectivoIn);
    const pagoOtro = pagoOtroIn == null ? (metodo === 'Efectivo' || metodo === 'Apartado' ? 0 : total) : money(pagoOtroIn);
    assertSaleAmounts({ ticket, metodo, estado, subtotal, iva, total, anticipo, pagoEfectivo, pagoOtro, ivaIncluded });
    const operationId = newOperationId();
    const fecha = fechaIn || now(); // permite fecha pasada (simulación)
    // El folio toma su día de la MISMA fecha que se guarda en la venta.
    const folio = nextFolio(operationId, fecha);
    const cobrada = estado !== 'Apartado' && estado !== 'Cancelado';
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
        const e = (l.p.stock || []).find(v => v.talla === l.talla);
        if (e) e.stock = Math.max(0, e.stock - l.qty);
        movements.unshift({ fecha, tipo: 'Venta', producto: l.p.nombre, sku: l.p.sku, cant: -l.qty, ref: folio });
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
    const unitAt = i => resList[i].unit;
    // H-36: el precio de lista sale de la resolución del renglón, no del artículo.
    // Con precios por talla, `l.p.precio` y `unitAt(i)` dejan de hablar del mismo
    // precio y el descuento quedaría mal calculado en ambas direcciones.
    const subtotalOrig = ticket.reduce((a, l, i) => a + resList[i].orig * l.qty, 0);
    const totalConDescuento = ticket.reduce((a, l, i) => a + unitAt(i) * l.qty, 0);
    const sale = {
      folio, fecha, clienteId: client && !client.generic ? client.id : undefined, cliente: client ? client.nombre : 'Público en general',
      vendedor: primary[0] || '—', vendedores: ids.slice(),
      items: itemCount, subtotal, iva, total: totalCobrado, ivaPct, ivaIncluded,
      anticipo: cortesia ? 0 : anticipo, saldo: cortesia ? 0 : money(total - anticipo),
      pagoEfectivo: cortesia ? 0 : pagoEfectivo, pagoOtro: cortesia ? 0 : pagoOtro,
      metodo, estado,
      descuento: cortesia ? 0 : money(Math.max(0, subtotalOrig - totalConDescuento)), valorRegalado,
      comision: comisionVenta, comisionBase: window.CONFIG.get('commission.base') || 'neto',
      // H-34: snapshot del plazo. null = sin límite, igual que las ventas previas.
      returnLimitDays, returnExpiresAt,
      _operationId: operationId, _stockRequired: cobrada, _syncStatus: 'pending',
      // En cortesía cada línea queda en $0 (no se cobró); el valor vive en precioOrig y valorRegalado.
      // promos: evidencia histórica inmutable de H-32. Un arreglo vacío significa "sin promoción";
      // su AUSENCIA significa "venta anterior a H-32", que nunca imprime porcentaje.
      lineas: ticket.map((l, i) => ({ productId: l.p.id, sku: l.p.sku, nombre: l.p.nombre, talla: l.talla, qty: l.qty, precio: cortesia ? 0 : money(unitAt(i) * (totalConDescuento > 0 ? total / totalConDescuento : 0)), precioBase: cortesia ? 0 : unitAt(i), precioOrig: resList[i].orig, promos: resList[i].promos })),
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

  // Completa un apartado ya cobrado por completo: descuenta stock, acredita comisión/ventas al
  // vendedor atribuido (base neto/bruto vigente AHORA) y marca la venta como Pagado. No re-agrega
  // al cliente (los agregados se hicieron al crear el apartado). Idempotente: solo actúa si está Apartado.
  function finalizarApartado(sale) {
    const fecha2 = now();
    const sellerEffects = [];
    // 1) Stock + movimientos (no se hicieron al apartar)
    (sale.lineas || []).forEach(l => {
      const p = products.find(x => x.sku === l.sku);
      if (p) { const e = (p.stock || []).find(v => v.talla === l.talla); if (e) e.stock = Math.max(0, e.stock - l.qty); }
      movements.unshift({ fecha: fecha2, tipo: 'Venta', producto: l.nombre, sku: l.sku, cant: -l.qty, ref: sale.folio });
    });
    saveProducts(false); saveMovements();
    // 2) Comisión + ventas a los vendedores atribuidos
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
    // 3) Marcar pagada y guardar la comisión real
    sale.estado = 'Pagado';
    // H-34: la mercancía se entrega al liquidar, así que el plazo congelado
    // arranca aquí y no en la fecha en que se reservó el apartado.
    if (sale.returnLimitDays != null && !sale.returnExpiresAt) {
      sale.returnExpiresAt = addDays(dayOf(fecha2), sale.returnLimitDays);
    }
    sale.anticipo = Number(sale.total) || 0;
    sale.saldo = 0;
    sale.comision = Math.round(comisionVenta * 100) / 100;
    sale.comisionBase = window.CONFIG.get('commission.base') || 'neto';
    sale._operationId = sale._operationId || newOperationId();
    sale._stockRequired = true;
    sale._syncStatus = 'pending';
    saveSales();
    return { sale, sellerEffects };
  }
  function registrarPagoApartado(folio, { monto, metodo, detalle, fecha } = {}) {
    const sale = sales.find(s => s.folio === folio);
    if (!sale || sale.estado !== 'Apartado') return { ok: false, error: 'El apartado no está pendiente' };
    const saldo = sale.saldo != null ? money(sale.saldo) : money((Number(sale.total) || 0) - (Number(sale.anticipo) || 0));
    const amount = money(monto);
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: 'El abono debe ser mayor a cero' };
    if (amount > saldo) return { ok: false, error: 'El abono no puede exceder el saldo pendiente' };
    if (!['Efectivo', 'Tarjeta', 'Transferencia', 'Mixto'].includes(metodo)) return { ok: false, error: 'Método de pago inválido para el abono' };
    let payment;
    try { payment = addSalePayment(sale, { monto: amount, metodo, tipo: amount === saldo ? 'liquidacion' : 'abono', detalle, fecha }, false); }
    catch (e) { return { ok: false, error: e.message || 'El desglose del pago no cuadra' }; }
    sale.anticipo = money((Number(sale.anticipo) || 0) + amount);
    sale.saldo = money((Number(sale.total) || 0) - sale.anticipo);
    sale.pagoEfectivo = money((Number(sale.pagoEfectivo) || 0) + payment.efectivo);
    sale.pagoOtro = money((Number(sale.pagoOtro) || 0) + payment.tarjeta + payment.transferencia + payment.otro);
    let sellerEffects = [];
    if (sale.saldo === 0) sellerEffects = finalizarApartado(sale).sellerEffects;
    else saveSales();
    try { window.CORE.invokeSync('pushSale', sale, { sellerEffects, payments: paymentsForSale(sale.folio) }); } catch (e) { /* offline */ }
    return { ok: true, sale, payment, liquidado: sale.saldo === 0 };
  }
  function completarApartado(folio) {
    const sale = sales.find(s => s.folio === folio);
    if (!sale || sale.estado !== 'Apartado') return null;
    const saldo = sale.saldo != null ? Number(sale.saldo) || 0 : Math.max(0, (Number(sale.total) || 0) - (Number(sale.anticipo) || 0));
    const r = registrarPagoApartado(folio, { monto: saldo, metodo: 'Efectivo', detalle: { efectivo: saldo } });
    return r.ok ? r.sale : null;
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
  function recordExchange({ origenFolio, lineas, usuario, notas, metodoPago, fecha: fechaIn }) {
    const sale = findSaleByFolio(origenFolio);
    if (!sale) return { ok: false, error: 'sale_not_found' };
    const items = (lineas || []).filter(l => l && (l.lado === 'devuelto' || l.lado === 'entregado'));
    const devueltos = items.filter(l => l.lado === 'devuelto');
    const entregados = items.filter(l => l.lado === 'entregado');
    if (!devueltos.length || !entregados.length) return { ok: false, error: 'invalid_items' };

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

    const id = 'cmb-' + newOperationId();
    const exch = {
      id, folio: nextFolio(id, fecha), origenFolio: sale.folio, fecha,
      usuario: usuario || '', notas: notas || '',
      valorReconocido: money(valorReconocido), valorEntregado: money(valorEntregado),
      diferencia, valorNoAprovechado, baseComision: diferencia,
      lineas: items.map(l => {
        const p = products.find(x => x.id === l.productId || x.sku === l.sku);
        return {
          lado: l.lado, productId: p ? p.id : l.productId, sku: l.sku, nombre: l.nombre,
          talla: l.talla, qty: Number(l.qty) || 0, motivo: l.motivo || '',
          precio: l.lado === 'entregado' ? listPrice(p, l.talla) : recognizedValue(sale.folio, l.sku, l.talla),
        };
      }),
    };

    // Inventario local en dos sentidos: entra lo devuelto, sale lo entregado.
    exch.lineas.forEach(l => {
      const p = products.find(x => x.id === l.productId);
      if (!p) return;
      const e = (p.stock || []).find(v => v.talla === l.talla);
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

    exchanges.unshift(exch);
    saveExchanges(false);
    if (!remoteApplying) {
      try { window.CORE.invokeSync('pushExchange', exch, { payment }); } catch (e) { /* offline */ }
    }
    return { ok: true, exchange: exch, payment };
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
        const e = (p.stock || []).find(v => v.talla === l.talla);
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
    if (i < 0) return;
    const version = Number(products[i]._syncVersion) || 0;
    products.splice(i, 1); saveProducts();
    try { window.CORE.invokeSync('deleteRow', 'products', id, version); } catch (e) { /* offline */ }
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
    rawSave(LS_PROMOS, promos); rawSave(LS_LIQ, liquidations); rawSave(LS_PAYMENTS, payments);
  }
  function clearAllLocal() {
    products.length = 0; sales.length = 0; movements.length = 0; returns.length = 0; payments.length = 0;
    promos.length = 0; liquidations.length = 0;
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
      sales.length = 0; returns.length = 0; promos.length = 0; liquidations.length = 0; payments.length = 0;
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
    return { products: products.length, clients: clients.length, sellers: sellers.length, sales: sales.length, returns: returns.length };
  }

  window.DATA = {
    products, sellers, clients, sales, movements, promos, liquidations, returns, payments, exchanges,
    sku, regenerateSkus, totalStock, hydrate, mkStock, emptyStock, SIZE_MARK,
    saveProducts, saveSellers, saveClients, saveSales, saveMovements, savePromos, saveReturns, savePayments,
    removeProduct, remapOrphanCodes, catalogHealthReport, hexForColorName, applyOrphanFix, get lastRemap() { return lastRemap; },
    addClient, removeClient, recordSale, nextFolio, collisionSafeFolio, rekeySaleFolio,
    normalizeFolioPrefix, businessDate, folioFromParts, parseFolio, folioPreview,
    folioBlockRequest, applyFolioBlock, terminalCode,
    findSaleByFolio, saleFolioAliases, folioAliasHit, stockOf, isAutoImg, resetProducts, applyRemote, applySyncResult, mergeRemote, markSaleSync, liquidarComision,
    completarApartado, registrarPagoApartado, paymentsForSale, hasFinancialSnapshot, resolveLineDiscount, cerrarMes, getPeriodoInicio,
    listPrice, priceRange, sanitizePreciosTalla,
    recordReturn, returnedQty, returnsForFolio, isReturnable, returnDeadline, saleLineBalance,
    saveExchanges, recognizedValue, supplySources, recordExchange,
    addUser, updateUser, removeUser, isEligibleSeller, resolveSellerCommission,
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
  window.CORE.registerCatalogProducts({
    list: () => products,
    save: () => saveProducts(),
  });

  // Sana huérfanos existentes al ARRANCAR (p. ej. daño previo por un import de catálogos que
  // re-codificó colores). Va al FINAL del módulo: remapOrphanCodes → saveProducts → syncUp lee
  // 'remoteApplying' (let), que ya debe estar inicializado — llamarlo antes sería TDZ.
  try { remapOrphanCodes(); } catch (e) { /* mejor arrancar que bloquear */ }
})();
