// xlsx-io.jsx — Importar / exportar inventario en Excel (.xlsx) con SheetJS.
// Considera: Ornamento, Colores Orn., Cuello, Tela y 20 columnas de talla (10 letra + 10 número).
// Exporta window.XLSXIO
(function () {
  const D = window.DATA;
  const XLSX_LIMITS = Object.freeze({
    maxFileBytes: 10 * 1024 * 1024,
    maxSheets: 32,
    maxRowsPerSheet: 50000,
    maxColumnsPerSheet: 256,
    maxCellsPerSheet: 1000000,
  });
  // 'Foto (URL)' va al FINAL de BASE a propósito: las columnas A–K conservan su posición de siempre.
  const BASE = ['SKU', 'Modelo', 'Categoría', 'Manga', 'Tela', 'Color', 'No. Modelo', 'Ornamento', 'Colores Orn.', 'Cuello', 'Precio', 'Foto (URL)', 'Categoría por talla'];
  // Campos que la hoja de Inventario REALMENTE trae. Al ACTUALIZAR un producto existente solo se
  // tocan estos: id, costo, destacado y códigos de barras se conservan porque el Excel no los
  // lleva (reemplazarlos con los valores por defecto de hydrate borraría lo que ya tenías).
  // 'imagen' NO está en la lista: se trata aparte (solo pisa si la hoja trae una URL real).
  const IMPORT_FIELDS = ['cat', 'sizeCategoryId', 'manga', 'tela', 'color', 'cuello', 'modelo', 'nombre', 'orn', 'ornColors', 'precio', 'attrs', 'stock'];
  // URL de la foto para el Excel: SOLO fotos reales accesibles por enlace.
  // Se omiten (a) las genéricas de relleno que asigna el sistema y (b) las incrustadas
  // (data:image/…), que son texto de decenas de miles de caracteres y no caben en una celda
  // de Excel (tope 32,767). Esas se migran con Configuración → Inventario → "Fotos de producto".
  function fotoUrl(p) {
    const u = String(p.imagen || '');
    if (!/^https?:\/\//i.test(u)) return '';
    return D.isAutoImg && D.isAutoImg(u) ? '' : u;
  }
  // Error con mensaje apto para el usuario: la pantalla lo muestra tal cual en el aviso.
  function balamError(msg) { const e = new Error(msg); e.balam = true; return e; }
  function mensajeError(err, respaldo) { return (err && err.balam && err.message) || respaldo; }

  // ── Tallas: identidad para las piezas, etiqueta para el encabezado (H-67) ─────
  // Un renglón de talla tiene dos valores que NO son lo mismo:
  //   · identidad — `meta.value` (o el código, en los registros históricos). Es lo
  //     que guarda `stock[].talla`. Nunca se toca ni se renombra.
  //   · etiqueta  — lo que el administrador escribe en Configuración. Es lo único
  //     que significa algo para la tienda.
  // El encabezado del Excel se compone con la ETIQUETA y las piezas se localizan
  // con la IDENTIDAD. Antes ambos salían de la identidad, así que la talla 38
  // —cuya identidad es '0' desde H-64— exportaba una columna llamada «T0».
  // Incluyen inactivos para no perder stock histórico al exportar y reimportar.
  const sizeItems = (kind, prefix) => window.CONFIG.all(kind).map(item => {
    const meta = item && item.meta && typeof item.meta === 'object' ? item.meta : {};
    const value = Object.prototype.hasOwnProperty.call(meta, 'value') ? meta.value : item.code;
    const label = String(item && item.label != null ? item.label : '').trim() || String(value);
    return {
      kind, value, label,
      header: (prefix || '') + label,            // el que se lee en Excel
      legacyHeader: (prefix || '') + String(value), // el de los archivos anteriores a H-67
    };
  });
  // Dos tallas con la misma etiqueta darían dos columnas con el mismo encabezado:
  // la segunda pisaría a la primera y las piezas de una talla acabarían escritas en
  // la otra. Tampoco puede chocar con una columna que ya existe. No se elige en
  // silencio: se detiene la operación y se dice cuál corregir.
  function assertSizeHeaders(items) {
    const ocupadas = BASE.concat(exportCols().map(c => c.label));
    const vistos = {};
    items.forEach(item => {
      const previo = vistos[item.header];
      if (previo) {
        throw balamError(`Dos tallas comparten la etiqueta «${item.label}» (identidades internas «${previo.value}» y «${item.value}»). `
          + 'Corrige el nombre en Configuración → Catálogos de producto antes de exportar o importar.');
      }
      if (ocupadas.indexOf(item.header) >= 0) {
        throw balamError(`La etiqueta de talla «${item.label}» produce una columna que ya existe en el Excel («${item.header}»). `
          + 'Cámbiala en Configuración → Catálogos de producto antes de exportar o importar.');
      }
      vistos[item.header] = item;
    });
    return items;
  }
  // Las dos escalas, validadas juntas: una letra y un número tampoco pueden
  // producir el mismo encabezado. Se calcula una vez por operación.
  function sizeColumns() {
    const letters = sizeItems('size_letter', '');
    const numbers = sizeItems('size_number', 'T');
    assertSizeHeaders(letters.concat(numbers));
    return { letters, numbers };
  }
  const sizeHeadersOf = (cols) => cols.letters.concat(cols.numbers).map(item => item.header);
  // Catálogos creados por el admin (Fase 2): una columna extra por catálogo (encabezado = su nombre).
  function customCols() {
    const meta = (window.CONFIG && window.CONFIG.allCatalogMeta) ? window.CONFIG.allCatalogMeta() : {};
    return Object.keys(meta).filter(k => meta[k].custom).map(k => ({ kind: k, label: meta[k].label }));
  }
  // Catálogos custom que generan columna PROPIA en el Excel. Se excluyen los que se llaman igual
  // que una columna base — el caso real es un catálogo llamado "Modelo": su encabezado chocaba con
  // el de BASE y, al armar la fila, su CÓDIGO pisaba el nombre del producto. Por eso la columna
  // "Modelo" salía abreviada e idéntica a "No. Modelo". Ese valor no se pierde: ya viaja en su
  // columna base ("No. Modelo") y en el SKU.
  // La IMPORTACIÓN sigue usando customCols() completo a propósito: validCustom resuelve el valor
  // por nombre además de por código, así que lee bien la columna aunque traiga el nombre largo.
  function exportCols() { return customCols().filter(c => BASE.indexOf(c.label) < 0); }
  // Orden de columnas: base · catálogos custom · tallas. Se calcula al vuelo (los custom son dinámicos).
  function buildHeaders(cols) {
    const c = cols || sizeColumns();
    return BASE.concat(exportCols().map(x => x.label), sizeHeadersOf(c));
  }

  function ensureXLSX() {
    if (!window.XLSX) { window.UI.toast('No se pudo cargar el motor de Excel', 'var(--danger)'); return false; }
    return true;
  }

  function validateFile(file) {
    if (!file || typeof file.size !== 'number') throw new Error('Archivo Excel inválido');
    if (file.size <= 0) throw new Error('El archivo Excel está vacío');
    if (file.size > XLSX_LIMITS.maxFileBytes) throw new Error('El archivo Excel supera el límite de 10 MB');
  }

  function validateWorkbook(wb) {
    const names = Array.isArray(wb && wb.SheetNames) ? wb.SheetNames : [];
    if (!names.length) throw new Error('El archivo Excel no contiene hojas');
    if (names.length > XLSX_LIMITS.maxSheets) {
      throw new Error(`El archivo Excel supera el límite de ${XLSX_LIMITS.maxSheets} hojas`);
    }
    names.forEach(name => {
      const ws = wb.Sheets && wb.Sheets[name];
      if (!ws || !ws['!ref']) return;
      const range = window.XLSX.utils.decode_range(ws['!ref']);
      const rows = range.e.r - range.s.r + 1;
      const columns = range.e.c - range.s.c + 1;
      if (rows > XLSX_LIMITS.maxRowsPerSheet) {
        throw new Error(`La hoja "${name}" supera el límite de ${XLSX_LIMITS.maxRowsPerSheet} filas`);
      }
      if (columns > XLSX_LIMITS.maxColumnsPerSheet) {
        throw new Error(`La hoja "${name}" supera el límite de ${XLSX_LIMITS.maxColumnsPerSheet} columnas`);
      }
      if (rows * columns > XLSX_LIMITS.maxCellsPerSheet) {
        throw new Error(`La hoja "${name}" supera el límite de ${XLSX_LIMITS.maxCellsPerSheet} celdas`);
      }
    });
    return wb;
  }

  function readWorkbook(file) {
    return new Promise((resolve, reject) => {
      if (!ensureXLSX()) return reject(new Error('Sin motor Excel'));
      try { validateFile(file); } catch (err) { return reject(err); }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = window.XLSX.read(new Uint8Array(e.target.result), {
            type: 'array',
            cellFormula: false,
            cellHTML: false,
            cellStyles: false,
            sheetRows: XLSX_LIMITS.maxRowsPerSheet + 1,
          });
          resolve(validateWorkbook(wb));
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsArrayBuffer(file);
    });
  }

  function sheetToJson(ws, options) {
    if (!ws) throw new Error('La hoja solicitada no existe');
    return window.XLSX.utils.sheet_to_json(ws, options || {});
  }

  // Marca del mapa de tallas dentro de la hoja «Catálogos». El archivo viaja con la
  // relación columna → identidad porque el encabezado, por sí solo, ya no la contiene:
  // «T38» es la identidad '0' y «T0» fue la talla 38 en los archivos anteriores. Sin
  // el mapa no se adivina (ADR-011 § 4): o se lee el mapa, o se aplica la regla
  // histórica —encabezado = identidad—, y si el archivo no encaja en ninguna, se detiene.
  const SIZE_MAP_MARK = 'MAPA DE COLUMNAS DE TALLA';
  const SIZE_MAP_TITLE = SIZE_MAP_MARK + ' — no borres esta hoja: es lo que permite volver a importar el archivo';
  const SIZE_MAP_HEAD = ['Columna en Inventario', 'Identidad interna', 'Etiqueta', 'Categoría por talla'];

  // Hoja con catálogo de códigos válidos
  function catalogosSheet(cols) {
    const rows = [['CATÁLOGO DE CÓDIGOS — usa estos valores en las columnas correspondientes'], []];
    rows.push(['CATEGORÍA (col. Categoría)']);
    Object.entries(D.CAT).forEach(([k, v]) => rows.push([k, v]));
    rows.push([], ['MANGA (col. Manga)']);
    Object.entries(D.MANGA).forEach(([k, v]) => rows.push([k, v]));
    rows.push([], ['TELA (col. Tela)']);
    Object.entries(D.TELA).forEach(([k, v]) => rows.push([k, v]));
    rows.push([], ['CUELLO (col. Cuello)']);
    Object.entries(D.CUELLO).forEach(([k, v]) => rows.push([k, v]));
    rows.push([], ['COLOR (cols. Color y Colores Orn.)']);
    Object.entries(D.COLOR_NAME).forEach(([k, v]) => rows.push([k, v]));
    customCols().forEach(c => {
      rows.push([], [c.label.toUpperCase() + ' (col. ' + c.label + ')']);
      window.CONFIG.list(c.kind).forEach(it => rows.push([it.code, it.label]));
    });
    rows.push([], ['CATEGORÍAS POR TALLA (col. Categoría por talla)']);
    window.CONFIG.sizeCategories().forEach(category => rows.push([category.id, category.label]));
    rows.push([], ['NOTAS']);
    rows.push(['• El SKU se arma como: Categoría-Manga-Tela-Color-NoModelo  (ej. 21-MC-ALG-BL-060)']);
    rows.push(['• Si dejas la columna SKU vacía, el sistema lo arma con las columnas de atributos.']);
    rows.push(['• Colores Orn.: códigos de hilo del bordado separados por coma (ej. OR, VI). Vacío si no lleva.']);
    rows.push(['• Cuello: usa un código de la tabla CUELLO (NOR, MAO, ITA, CER).']);
    rows.push(['• Categoría por talla: usa exactamente un código de la tabla CATEGORÍAS POR TALLA.']);
    rows.push(['• Tallas LETRA: columnas ' + cols.letters.map(i => i.header).join(', ') + '.']);
    rows.push(['• Tallas NÚMERO: columnas ' + cols.numbers.map(i => i.header).join(', ') + ' (la "T" sólo distingue el encabezado).']);
    rows.push(['• Cada columna de talla lleva el NOMBRE de la talla en Configuración; abajo va a qué renglón del catálogo escribe.']);
    rows.push(['• Captura existencias únicamente en la escala de la categoría elegida. Una fila con ambas escalas se omite por ambigua.']);
    rows.push(['• Foto (URL): enlace http(s) a la imagen. Al importar se asigna al producto.']);
    rows.push(['   Vacío = se conserva la foto que ya tiene (o se le pone una genérica si es nuevo).']);
    rows.push(['• Al importar, si el SKU YA EXISTE el producto se ACTUALIZA (no se duplica).']);
    rows.push(['   Se respetan costo, destacado y códigos de barras: esta hoja no los lleva.']);
    rows.push(['• Borra la fila de EJEMPLO antes de importar.']);
    // El mapa va al FINAL y en filas contiguas: así se lee de corrido al importar.
    rows.push([], [SIZE_MAP_TITLE], SIZE_MAP_HEAD);
    cols.letters.concat(cols.numbers).forEach(item => {
      rows.push([item.header, String(item.value), item.label, item.kind]);
    });
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 22 }, { wch: 34 }, { wch: 16 }, { wch: 18 }];
    return ws;
  }

  // Convierte un producto → fila plana con todas las columnas
  function rowFromProduct(p, cols) {
    const r = {
      'SKU': p.sku, 'Modelo': p.nombre, 'Categoría': p.cat,
      'Categoría por talla': D.resolveProductSizes(p).categoryId || '',
      'Manga': p.manga, 'Tela': p.tela,
      'Color': p.color, 'No. Modelo': p.modelo, 'Ornamento': p.orn,
      'Colores Orn.': (p.ornColors || []).join(', '), 'Cuello': p.cuello || 'NOR', 'Precio': p.precio,
      'Foto (URL)': fotoUrl(p),
    };
    exportCols().forEach(c => { r[c.label] = (p.attrs || {})[c.kind] || ''; });
    const byKey = {};
    p.stock.forEach(v => { byKey[v.escala + v.talla] = v.stock; });
    // La columna se llama por la etiqueta; las piezas se buscan por la identidad.
    cols.letters.forEach(item => { r[item.header] = byKey['L' + item.value] || 0; });
    cols.numbers.forEach(item => { r[item.header] = byKey['N' + item.value] || 0; });
    return r;
  }

  function colWidth(h, sizeHeaders) {
    if (h === 'Foto (URL)') return 46;
    if (h === 'Modelo') return 26;
    if (h === 'SKU') return 20;
    if (h === 'Ornamento' || h === 'Colores Orn.') return 18;
    if (h === 'Cuello' || h === 'Categoría') return 12;
    if (BASE.indexOf(h) >= 0 || sizeHeaders.indexOf(h) >= 0) return 7;
    return 16; // columnas de catálogos custom
  }

  function inventarioSheet(products, cols) {
    const data = products.map(p => rowFromProduct(p, cols));
    const headers = buildHeaders(cols);
    const sizeHeaders = sizeHeadersOf(cols);
    const ws = window.XLSX.utils.json_to_sheet(data, { header: headers });
    ws['!cols'] = headers.map(h => ({ wch: colWidth(h, sizeHeaders) }));
    return ws;
  }

  function download(wb, filename) {
    window.XLSX.writeFile(wb, filename, { bookType: 'xlsx' });
  }

  // Plantilla vacía (1 fila de ejemplo + instrucciones)
  function exportTemplate() {
    if (!ensureXLSX()) return;
    let cols;
    try { cols = sizeColumns(); } catch (err) { window.UI.toast(mensajeError(err, 'No se pudo generar la plantilla'), 'var(--danger)'); return; }
    const ejemplo = rowFromProduct(D.hydrate({
      cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', modelo: '060', nombre: 'EJEMPLO — borra esta fila',
      orn: 'Bordado Eléctrico', ornColors: ['OR', 'VI'], cuello: 'MAO', precio: 650,
      sizeCategoryId: 'size_letter', attrs: { __sizeCategoryId: 'size_letter' },
      stock: D.mkStock([2, 4, 6, 9, 12, 8, 5], []).filter(v => v.escala === 'L'),
    }), cols);
    const headers = buildHeaders(cols);
    const sizeHeaders = sizeHeadersOf(cols);
    const ws = window.XLSX.utils.json_to_sheet([ejemplo], { header: headers });
    ws['!cols'] = headers.map(h => ({ wch: colWidth(h, sizeHeaders) }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    window.XLSX.utils.book_append_sheet(wb, catalogosSheet(cols), 'Catálogos');
    download(wb, 'Plantilla_Inventario_Balam.xlsx');
    window.UI.toast('Plantilla descargada — llénala e impórtala', 'var(--accent)');
  }

  function exportInventory(products) {
    if (!ensureXLSX()) return;
    let cols;
    try { cols = sizeColumns(); } catch (err) { window.UI.toast(mensajeError(err, 'No se pudo exportar el inventario'), 'var(--danger)'); return; }
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, inventarioSheet(products, cols), 'Inventario');
    window.XLSX.utils.book_append_sheet(wb, catalogosSheet(cols), 'Catálogos');
    const fecha = new Date().toISOString().slice(0, 10);
    download(wb, `Inventario_Balam_${fecha}.xlsx`);
    window.UI.toast(`${products.length} productos exportados`, 'var(--accent)');
  }

  function num(v) { const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }

  // Parsea "OR, VI / NE" → ['OR','VI','NE'] (sólo códigos de color conocidos)
  function parseOrnColors(v) {
    return String(v || '').split(/[,;/]+/).map(s => s.trim().toUpperCase())
      .filter(c => c && D.COLOR_NAME[c]);
  }
  // Acepta código (NOR) o nombre ("Mao (chino)") → código de cuello
  function parseCuello(v) {
    const s = String(v || '').trim();
    if (!s) return 'NOR';
    const up = s.toUpperCase();
    if (D.CUELLO[up]) return up;
    const found = Object.entries(D.CUELLO).find(([, name]) => name.toLowerCase() === s.toLowerCase());
    return found ? found[0] : 'NOR';
  }

  // Valida un code contra un catálogo; si no existe usa el primero disponible (o el fallback).
  // Evita inyectar códigos inválidos que después romperían el render del inventario.
  function valid(kind, code, fallback) {
    const c = String(code || '').trim().toUpperCase();
    if (c && window.CONFIG.find(kind, c)) return c;
    if (window.CONFIG.find(kind, fallback)) return fallback;
    const first = window.CONFIG.codes(kind)[0];
    return first || fallback;
  }

  // Valida un valor de catálogo custom (códigos pueden ser mixtos): código exacto → por código
  // sin distinguir mayúsculas → por nombre. Si no coincide, vacío (los custom son opcionales).
  function validCustom(kind, raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return '';
    if (window.CONFIG.find(kind, s)) return s;
    const items = window.CONFIG.all(kind);
    const byCode = items.find(it => String(it.code).toLowerCase() === s.toLowerCase());
    if (byCode) return byCode.code;
    const byLabel = items.find(it => String(it.label).toLowerCase() === s.toLowerCase());
    return byLabel ? byLabel.code : '';
  }

  function validSizeCategory(raw) {
    const value = String(raw == null ? '' : raw).trim();
    if (!value) return null;
    const categories = window.CONFIG.sizeCategories ? window.CONFIG.sizeCategories() : [];
    return categories.find(category => category.id === value)
      || categories.find(category => category.id.toLowerCase() === value.toLowerCase())
      || categories.find(category => String(category.label).toLowerCase() === value.toLowerCase())
      || null;
  }

  function buildProduct(row, idx, cols) {
    const nombre = String(row['Modelo'] || '').trim();
    const skuRaw = String(row['SKU'] || '').trim().toUpperCase();
    if (!nombre || /ejemplo/i.test(nombre)) return null;

    let cat, manga, tela, color, modelo;
    const parts = skuRaw.split('-');
    // Atajo: parsear el SKU posicionalmente SOLO si la receta sigue siendo la de fábrica
    // (cat-manga-tela-color + modelo). Si el admin reordenó/cambió el SKU, ese orden ya no es
    // confiable → se usan las columnas explícitas (Categoría/Manga/Tela/Color/No. Modelo).
    const recipe = (window.CONFIG && window.CONFIG.skuParts) ? window.CONFIG.skuParts().map(x => x.field) : ['cat', 'manga', 'tela', 'color'];
    const legacyOrder = recipe.length === 4 && recipe[0] === 'cat' && recipe[1] === 'manga' && recipe[2] === 'tela' && recipe[3] === 'color';
    if (legacyOrder && parts.length === 5) {
      [cat, manga, tela, color, modelo] = parts;
    } else {
      cat = String(row['Categoría'] || '21').trim();
      manga = String(row['Manga'] || 'ML').trim().toUpperCase();
      tela = String(row['Tela'] || 'ALG').trim().toUpperCase();
      color = String(row['Color'] || 'BL').trim().toUpperCase();
      modelo = String(row['No. Modelo'] || (900 + idx)).trim();
    }
    // Normaliza contra los catálogos vigentes (códigos desconocidos → default seguro).
    cat = valid('category', cat, '21');
    manga = valid('sleeve', manga, 'ML');
    tela = valid('fabric', tela, 'ALG');
    color = valid('color', color, 'BL');
    modelo = String(modelo).padStart(3, '0');
    const letterSizes = cols.letters;
    const numberSizes = cols.numbers;
    // Qué columna alimenta a cada talla lo decide el archivo, no su apariencia.
    const letras = letterSizes.map(item => num(row[columnOf(item, cols.fileMap)]));
    const nums = numberSizes.map(item => num(row[columnOf(item, cols.fileMap)]));
    let sizeCategory = validSizeCategory(row['Categoría por talla']);
    const hasLetters = letras.some(value => value > 0);
    const hasNumbers = nums.some(value => value > 0);
    // Compatibilidad con hojas anteriores: sólo se infiere cuando exactamente
    // una escala tiene existencias. Dos escalas o ninguna son ambiguas.
    if (!sizeCategory && hasLetters !== hasNumbers) {
      const scale = hasLetters ? 'L' : 'N';
      sizeCategory = window.CONFIG.sizeCategories().find(category => category.scale === scale) || null;
    }
    // Una hoja histórica sin ninguna existencia no contiene dos intenciones en
    // conflicto. Conserva el default histórico del alta: primera categoría.
    if (!sizeCategory && !hasLetters && !hasNumbers) {
      sizeCategory = window.CONFIG.sizeCategories()[0] || null;
    }
    if (!sizeCategory) return null;
    if ((sizeCategory.scale === 'L' && hasNumbers) || (sizeCategory.scale === 'N' && hasLetters)) return null;
    const selectedSizes = sizeCategory.scale === 'N' ? numberSizes : letterSizes;
    const quantities = sizeCategory.scale === 'N' ? nums : letras;
    const stock = selectedSizes.map((item, index) => ({
      talla: item.value,
      escala: sizeCategory.scale,
      stock: Math.max(0, Math.round(quantities[index] || 0)),
    }));
    const attrs = {};
    attrs.__sizeCategoryId = sizeCategory.id;
    customCols().forEach(c => { const v = validCustom(c.kind, row[c.label]); if (v) attrs[c.kind] = v; });
    // Foto: solo enlaces http(s). Cualquier otra cosa se ignora y hydrate pone la genérica
    // (mismo comportamiento que un archivo sin esta columna).
    const foto = String(row['Foto (URL)'] || '').trim();
    const imagen = /^https?:\/\//i.test(foto) ? foto : undefined;
    return D.hydrate({
      id: 'imp-' + Date.now() + '-' + idx,
      cat, manga, tela, color, modelo, nombre, imagen,
      orn: String(row['Ornamento'] || '—').trim() || '—',
      ornColors: parseOrnColors(row['Colores Orn.']),
      cuello: parseCuello(row['Cuello']),
      precio: num(row['Precio']),
      attrs, sizeCategoryId: sizeCategory.id,
      stock,
      pop: false,
    });
  }

  // Columna de la que sale la cantidad de una talla:
  //   · con mapa del archivo → la que ese archivo declaró para esta identidad;
  //   · sin mapa → la regla histórica: el encabezado ERA la identidad.
  // Una identidad que el archivo no declara devuelve una columna inexistente y su
  // cantidad queda en 0, igual que hoy con una talla creada después de exportar.
  function columnOf(item, fileMap) {
    if (!fileMap) return item.legacyHeader;
    const found = fileMap[item.kind + ' ' + String(item.value)];
    return found == null ? ' sin-columna' : found;
  }

  // Mapa columna → identidad que el propio archivo declara en su hoja «Catálogos».
  function sizeMapFromWorkbook(wb) {
    const ws = wb && wb.Sheets && wb.Sheets['Catálogos'];
    if (!ws) return null;
    let rows;
    try { rows = sheetToJson(ws, { header: 1, defval: '' }); } catch (err) { return null; }
    const start = rows.findIndex(r => String((r && r[0]) || '').indexOf(SIZE_MAP_MARK) === 0);
    if (start < 0) return null;
    const map = {};
    for (let i = start + 2; i < rows.length; i++) { // +2: se salta el título y la cabecera
      const row = rows[i] || [];
      const header = String(row[0] == null ? '' : row[0]).trim();
      const value = String(row[1] == null ? '' : row[1]).trim();
      const kind = String(row[3] == null ? '' : row[3]).trim();
      if (!header || !kind) break;
      map[kind + ' ' + value] = header;
    }
    return Object.keys(map).length ? map : null;
  }

  function headerRowOf(ws) {
    if (!ws || !ws['!ref']) return [];
    const range = window.XLSX.utils.decode_range(ws['!ref']);
    const out = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[window.XLSX.utils.encode_cell({ r: range.s.r, c })];
      out.push(cell && cell.v != null ? String(cell.v).trim() : '');
    }
    return out;
  }

  // Un archivo sin mapa se lee con la regla histórica (encabezado = identidad), que es
  // exactamente lo que hacían los archivos anteriores. Pero si trae la columna con el
  // nombre nuevo —«T38»— y NO la histórica —«T0»—, es un archivo de esta versión al que
  // le borraron la hoja «Catálogos»: leerlo como histórico pondría en cero todas esas
  // tallas. Se detiene en vez de vaciar el inventario, y no adivina.
  function assertLegacyReadable(ws, cols) {
    const encabezados = headerRowOf(ws);
    const perdidas = cols.letters.concat(cols.numbers).filter(item =>
      item.header !== item.legacyHeader
      && encabezados.indexOf(item.header) >= 0
      && encabezados.indexOf(item.legacyHeader) < 0);
    if (!perdidas.length) return;
    throw balamError(`El archivo trae la columna «${perdidas[0].header}» pero no la hoja «Catálogos», que es la que dice a qué talla pertenece. `
      + 'Vuelve a exportar el inventario desde el sistema y trabaja sobre ese archivo.');
  }

  // Lee archivo → Promise<{products, total, skipped}>
  function parseFile(file) {
    return readWorkbook(file).then(wb => {
      const cols = sizeColumns();
      cols.fileMap = sizeMapFromWorkbook(wb);
      const sheetName = wb.SheetNames.includes('Inventario') ? 'Inventario' : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!cols.fileMap) assertLegacyReadable(ws, cols);
      const rows = sheetToJson(ws, { defval: '' });
      const products = [];
      let skipped = 0;
      rows.forEach((r, i) => { const p = buildProduct(r, i, cols); if (p) products.push(p); else skipped++; });
      return { products, total: rows.length, skipped };
    });
  }

  // Exporta el historial de devoluciones (a nivel renglón) a un .xlsx descargable.
  function exportReturns(rows) {
    if (!ensureXLSX()) return;
    const H = ['Fecha', 'Folio', 'Cliente', 'Producto', 'SKU', 'Talla', 'Cantidad', 'Motivo', 'Reembolso', 'Método', 'Estatus'];
    const data = rows.map(r => ({
      'Fecha': r.fecha, 'Folio': r.folio, 'Cliente': r.cliente, 'Producto': r.nombre, 'SKU': r.sku,
      'Talla': r.talla, 'Cantidad': r.qty, 'Motivo': r.motivoLabel, 'Reembolso': r.monto, 'Método': r.metodo, 'Estatus': r.estatus,
    }));
    const ws = window.XLSX.utils.json_to_sheet(data, { header: H });
    ws['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 22 }, { wch: 26 }, { wch: 20 }, { wch: 7 }, { wch: 9 }, { wch: 18 }, { wch: 12 }, { wch: 13 }, { wch: 13 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Devoluciones');
    download(wb, `Devoluciones_Balam_${new Date().toISOString().slice(0, 10)}.xlsx`);
    window.UI.toast(`${rows.length} renglones exportados`, 'var(--accent)');
  }

  function exportSales(rows) {
    if (!ensureXLSX()) return;
    const H = ['Fecha', 'Folio', 'Cliente', 'Producto', 'Vendedor', 'Método', 'Monto', 'Comisión', 'Estado'];
    const data = rows.map(r => ({
      'Fecha': r.fecha, 'Folio': r.folio, 'Cliente': r.cliente, 'Producto': r.producto,
      'Vendedor': r.vendedor, 'Método': r.metodo, 'Monto': r.monto, 'Comisión': r.comision, 'Estado': r.estado,
    }));
    const ws = window.XLSX.utils.json_to_sheet(data, { header: H });
    ws['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 22 }, { wch: 26 }, { wch: 20 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
    download(wb, `Ventas_Balam_${new Date().toISOString().slice(0, 10)}.xlsx`);
    window.UI.toast(`${rows.length} ventas exportadas`, 'var(--accent)');
  }

  // Cartera de apartados abiertos (H-40). Las filas llegan ya planas desde
  // balam/layaway.jsx § filaExport: aquí no se deriva saldo ni porcentaje.
  function exportLayaways(rows) {
    if (!ensureXLSX()) return;
    const H = ['Folio', 'Fecha', 'Días', 'Cliente', 'Vendedor', 'Artículos', 'Total', 'Pagado', 'Saldo', '% pagado', 'Abonos', 'Último abono', 'Mercancía'];
    const data = rows.map(r => ({
      'Folio': r.folio, 'Fecha': r.fecha, 'Días': r.dias == null ? '' : r.dias, 'Cliente': r.cliente,
      'Vendedor': r.vendedor, 'Artículos': r.items, 'Total': r.total, 'Pagado': r.pagado, 'Saldo': r.saldo,
      '% pagado': r.pct, 'Abonos': r.abonos, 'Último abono': r.ultimoAbono, 'Mercancía': r.articulos,
    }));
    const ws = window.XLSX.utils.json_to_sheet(data, { header: H });
    ws['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 7 }, { wch: 24 }, { wch: 20 }, { wch: 9 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 14 }, { wch: 40 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Apartados');
    download(wb, `Apartados_Balam_${new Date().toISOString().slice(0, 10)}.xlsx`);
    window.UI.toast(`${rows.length} apartados exportados`, 'var(--accent)');
  }

  // Mercancía prestada (H-46). Las filas llegan ya planas desde
  // balam/loans.jsx § filaExport: aquí no se deriva atraso, valor ni estado.
  // Es además la vía de respaldo del módulo: los préstamos todavía no viajan a la nube.
  function exportLoans(rows) {
    if (!ensureXLSX()) return;
    const H = ['Folio', 'Fecha del préstamo', 'Recibe', 'Tipo', 'Teléfono', 'Piezas', 'Fuera',
      'Devolución esperada', 'Devolución real', 'Estado', 'Días de atraso', 'Valor', 'Valor fuera', 'Mercancía', 'Nota'];
    const data = rows.map(r => ({
      'Folio': r.folio, 'Fecha del préstamo': r.fecha, 'Recibe': r.persona, 'Tipo': r.tipo,
      'Teléfono': r.tel, 'Piezas': r.piezas, 'Fuera': r.fuera,
      'Devolución esperada': r.esperada, 'Devolución real': r.devolucion, 'Estado': r.estado,
      'Días de atraso': r.atraso, 'Valor': r.valor, 'Valor fuera': r.valorFuera,
      'Mercancía': r.articulos, 'Nota': r.nota,
    }));
    const ws = window.XLSX.utils.json_to_sheet(data, { header: H });
    ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 24 }, { wch: 11 }, { wch: 15 }, { wch: 8 }, { wch: 8 },
      { wch: 18 }, { wch: 18 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 12 }, { wch: 40 }, { wch: 30 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Préstamos');
    download(wb, `Prestamos_Balam_${new Date().toISOString().slice(0, 10)}.xlsx`);
    window.UI.toast(`${rows.length} préstamos exportados`, 'var(--accent)');
  }

  // H-69: el reporte mensual sale de la MISMA autoridad que pinta la pantalla
  // (`DATA.commissionLedger`), asi que el XLSX y Vendedores no pueden discrepar.
  // Separa lo generado, lo revertido y lo ya liquidado, porque un cierre de mes
  // deja el pendiente en cero pero no borra lo que se genero.
  function exportSellers(rows) {
    if (!ensureXLSX()) return;
    const H = ['Vendedor', 'Rol', 'Comisión %', 'Origen del %', 'Ventas del mes', 'Base comisionable',
      'Meta', 'Avance %', 'Comisión generada', 'Revertido', 'Liquidado', 'Pendiente', 'Estado'];
    const data = rows.map(r => ({
      'Vendedor': r.nombre, 'Rol': r.rol, 'Comisión %': r.pct, 'Origen del %': r.origen || '',
      'Ventas del mes': r.ventas, 'Base comisionable': r.base == null ? 0 : r.base,
      'Meta': r.meta, 'Avance %': r.avance,
      'Comisión generada': r.generado == null ? r.comision : r.generado,
      'Revertido': r.revertido == null ? 0 : r.revertido,
      'Liquidado': r.liquidado == null ? 0 : r.liquidado,
      'Pendiente': r.comision, 'Estado': r.estado,
    }));
    const ws = window.XLSX.utils.json_to_sheet(data, { header: H });
    ws['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 11 }, { wch: 30 }, { wch: 15 }, { wch: 17 },
      { wch: 12 }, { wch: 10 }, { wch: 17 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 10 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Vendedores');
    download(wb, `Vendedores_Balam_${new Date().toISOString().slice(0, 10)}.xlsx`);
    window.UI.toast(`${rows.length} vendedores exportados`, 'var(--accent)');
  }

  window.XLSXIO = {
    exportTemplate, exportInventory, exportReturns, exportSales, exportSellers, exportLayaways, exportLoans,
    parseFile, readWorkbook, sheetToJson, limits: XLSX_LIMITS,
    headers: buildHeaders, sizeColumns, IMPORT_FIELDS,
  };
})();
