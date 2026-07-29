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
  const BASE = ['SKU', 'Modelo', 'Categoría', 'Manga', 'Tela', 'Color', 'No. Modelo', 'Ornamento', 'Colores Orn.', 'Cuello', 'Precio', 'Foto (URL)'];
  // Campos que la hoja de Inventario REALMENTE trae. Al ACTUALIZAR un producto existente solo se
  // tocan estos: id, costo, destacado y códigos de barras se conservan porque el Excel no los
  // lleva (reemplazarlos con los valores por defecto de hydrate borraría lo que ya tenías).
  // 'imagen' NO está en la lista: se trata aparte (solo pisa si la hoja trae una URL real).
  const IMPORT_FIELDS = ['cat', 'manga', 'tela', 'color', 'cuello', 'modelo', 'nombre', 'orn', 'ornColors', 'precio', 'attrs', 'stock'];
  // URL de la foto para el Excel: SOLO fotos reales accesibles por enlace.
  // Se omiten (a) las genéricas de relleno que asigna el sistema y (b) las incrustadas
  // (data:image/…), que son texto de decenas de miles de caracteres y no caben en una celda
  // de Excel (tope 32,767). Esas se migran con Configuración → Inventario → "Fotos de producto".
  function fotoUrl(p) {
    const u = String(p.imagen || '');
    if (!/^https?:\/\//i.test(u)) return '';
    return D.isAutoImg && D.isAutoImg(u) ? '' : u;
  }
  // Encabezados de talla. Letras tal cual; números prefijados "T" para no confundir con cantidades.
  const LETRA_H = D.SIZES_LETRA.slice();                  // XS, S, M, …
  const NUM_H = D.SIZES_NUM.map(n => 'T' + n);            // T34, T36, …
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
  function buildHeaders() { return BASE.concat(exportCols().map(c => c.label), LETRA_H, NUM_H); }

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

  // Hoja con catálogo de códigos válidos
  function catalogosSheet() {
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
    rows.push([], ['NOTAS']);
    rows.push(['• El SKU se arma como: Categoría-Manga-Tela-Color-NoModelo  (ej. 21-MC-ALG-BL-060)']);
    rows.push(['• Si dejas la columna SKU vacía, el sistema lo arma con las columnas de atributos.']);
    rows.push(['• Colores Orn.: códigos de hilo del bordado separados por coma (ej. OR, VI). Vacío si no lleva.']);
    rows.push(['• Cuello: usa un código de la tabla CUELLO (NOR, MAO, ITA, CER).']);
    rows.push(['• Tallas LETRA: columnas ' + D.SIZES_LETRA.join(', ') + '.']);
    rows.push(['• Tallas NÚMERO: columnas T34…T52 (la "T" es sólo para distinguirlas; captura la cantidad).']);
    rows.push(['• Una prenda puede llenar ambas escalas. Las tallas que no apliquen se dejan en 0 o vacías.']);
    rows.push(['• Foto (URL): enlace http(s) a la imagen. Al importar se asigna al producto.']);
    rows.push(['   Vacío = se conserva la foto que ya tiene (o se le pone una genérica si es nuevo).']);
    rows.push(['• Al importar, si el SKU YA EXISTE el producto se ACTUALIZA (no se duplica).']);
    rows.push(['   Se respetan costo, destacado y códigos de barras: esta hoja no los lleva.']);
    rows.push(['• Borra la fila de EJEMPLO antes de importar.']);
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 18 }, { wch: 34 }];
    return ws;
  }

  // Convierte un producto → fila plana con todas las columnas
  function rowFromProduct(p) {
    const r = {
      'SKU': p.sku, 'Modelo': p.nombre, 'Categoría': p.cat, 'Manga': p.manga, 'Tela': p.tela,
      'Color': p.color, 'No. Modelo': p.modelo, 'Ornamento': p.orn,
      'Colores Orn.': (p.ornColors || []).join(', '), 'Cuello': p.cuello || 'NOR', 'Precio': p.precio,
      'Foto (URL)': fotoUrl(p),
    };
    exportCols().forEach(c => { r[c.label] = (p.attrs || {})[c.kind] || ''; });
    const byKey = {};
    p.stock.forEach(v => { byKey[v.escala + v.talla] = v.stock; });
    D.SIZES_LETRA.forEach((t, i) => { r[LETRA_H[i]] = byKey['L' + t] || 0; });
    D.SIZES_NUM.forEach((t, i) => { r[NUM_H[i]] = byKey['N' + t] || 0; });
    return r;
  }

  function colWidth(h) {
    if (h === 'Foto (URL)') return 46;
    if (h === 'Modelo') return 26;
    if (h === 'SKU') return 20;
    if (h === 'Ornamento' || h === 'Colores Orn.') return 18;
    if (h === 'Cuello' || h === 'Categoría') return 12;
    if (BASE.indexOf(h) >= 0 || LETRA_H.indexOf(h) >= 0 || NUM_H.indexOf(h) >= 0) return 7;
    return 16; // columnas de catálogos custom
  }

  function inventarioSheet(products) {
    const data = products.map(rowFromProduct);
    const headers = buildHeaders();
    const ws = window.XLSX.utils.json_to_sheet(data, { header: headers });
    ws['!cols'] = headers.map(h => ({ wch: colWidth(h) }));
    return ws;
  }

  function download(wb, filename) {
    window.XLSX.writeFile(wb, filename, { bookType: 'xlsx' });
  }

  // Plantilla vacía (1 fila de ejemplo + instrucciones)
  function exportTemplate() {
    if (!ensureXLSX()) return;
    const ejemplo = rowFromProduct(D.hydrate({
      cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', modelo: '060', nombre: 'EJEMPLO — borra esta fila',
      orn: 'Bordado Eléctrico', ornColors: ['OR', 'VI'], cuello: 'MAO', precio: 650,
      stock: D.mkStock([2, 4, 6, 9, 12, 8, 5], [0, 0, 3, 5, 6, 4]),
    }));
    const headers = buildHeaders();
    const ws = window.XLSX.utils.json_to_sheet([ejemplo], { header: headers });
    ws['!cols'] = headers.map(h => ({ wch: colWidth(h) }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
    window.XLSX.utils.book_append_sheet(wb, catalogosSheet(), 'Catálogos');
    download(wb, 'Plantilla_Inventario_Balam.xlsx');
    window.UI.toast('Plantilla descargada — llénala e impórtala', 'var(--accent)');
  }

  function exportInventory(products) {
    if (!ensureXLSX()) return;
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, inventarioSheet(products), 'Inventario');
    window.XLSX.utils.book_append_sheet(wb, catalogosSheet(), 'Catálogos');
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

  function buildProduct(row, idx) {
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
    const letras = D.SIZES_LETRA.map((t, i) => num(row[LETRA_H[i]]));
    const nums = D.SIZES_NUM.map((t, i) => num(row[NUM_H[i]]));
    const attrs = {};
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
      attrs,
      stock: D.mkStock(letras, nums),
      pop: false,
    });
  }

  // Lee archivo → Promise<{products, total, skipped}>
  function parseFile(file) {
    return readWorkbook(file).then(wb => {
      const sheetName = wb.SheetNames.includes('Inventario') ? 'Inventario' : wb.SheetNames[0];
      const rows = sheetToJson(wb.Sheets[sheetName], { defval: '' });
      const products = [];
      let skipped = 0;
      rows.forEach((r, i) => { const p = buildProduct(r, i); if (p) products.push(p); else skipped++; });
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

  function exportSellers(rows) {
    if (!ensureXLSX()) return;
    const H = ['Vendedor', 'Rol', 'Comisión %', 'Ventas del mes', 'Meta', 'Avance %', 'Comisión acumulada', 'Estado'];
    const data = rows.map(r => ({
      'Vendedor': r.nombre, 'Rol': r.rol, 'Comisión %': r.pct, 'Ventas del mes': r.ventas,
      'Meta': r.meta, 'Avance %': r.avance, 'Comisión acumulada': r.comision, 'Estado': r.estado,
    }));
    const ws = window.XLSX.utils.json_to_sheet(data, { header: H });
    ws['!cols'] = [{ wch: 22 }, { wch: 24 }, { wch: 11 }, { wch: 15 }, { wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 10 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Vendedores');
    download(wb, `Vendedores_Balam_${new Date().toISOString().slice(0, 10)}.xlsx`);
    window.UI.toast(`${rows.length} vendedores exportados`, 'var(--accent)');
  }

  window.XLSXIO = {
    exportTemplate, exportInventory, exportReturns, exportSales, exportSellers, exportLayaways,
    parseFile, readWorkbook, sheetToJson, limits: XLSX_LIMITS,
    headers: buildHeaders, IMPORT_FIELDS,
  };
})();
