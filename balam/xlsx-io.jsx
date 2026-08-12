// xlsx-io.jsx — Importar / exportar inventario en Excel (.xlsx) con SheetJS.
// Considera: Ornamento, Color de ornamento, Cuello, Material, Color Tela y tallas.
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
  // H-86: una sola descripción gobierna las tres operaciones. Los encabezados
  // se resuelven por nombre (el usuario puede mover columnas), nunca por posición.
  // Las columnas técnicas son parte del archivo, no del SKU visible, y Excel las
  // oculta solamente para reducir ruido: ocultar no es una frontera de seguridad.
  const INVENTORY_XLSX_SCHEMA = Object.freeze({
    name: 'balam.inventory',
    version: 2,
    sheets: Object.freeze(['Inventario', 'Catálogos', '_BALAM']),
    columns: Object.freeze([
      { key: 'sku', header: 'SKU', type: 'text', required: true },
      { key: 'nombre', header: 'Modelo', type: 'text', required: true },
      { key: 'cat', header: 'Categoría', type: 'catalog:category', required: true },
      { key: 'manga', header: 'Manga', type: 'catalog:sleeve', required: true },
      { key: 'tela', header: 'Material', type: 'catalog:fabric', required: true },
      { key: 'color', header: 'Color Tela', type: 'catalog:color', required: true },
      { key: 'modelo', header: 'No. Modelo', type: 'text', required: true },
      { key: 'orn', header: 'Ornamento', type: 'catalog:ornament', required: true },
      { key: 'ornColors', header: 'Colores Orn.', type: 'color-list', required: true },
      { key: 'cuello', header: 'Cuello', type: 'catalog:neck', required: true },
      { key: 'precio', header: 'Precio', type: 'money', required: true },
      { key: 'imagen', header: 'Foto (URL)', type: 'url', required: true },
      { key: 'sizeCategoryId', header: 'Categoría por talla', type: 'size-category', required: true },
      { key: 'ornamentColorsBySize', header: 'Colores Orn. por talla', type: 'json:size-colors', required: true },
      { key: 'preciosTalla', header: 'Precios especiales por talla', type: 'json:size-prices', required: true },
      { key: 'costo', header: 'Costo', type: 'money', required: true },
      { key: 'pop', header: 'Destacado', type: 'boolean', required: true },
      { key: 'sizeCode', header: 'Talla referencia', type: 'text', required: true, since: 2 },
      { key: 'stockQuantity', header: 'Existencia referencia', type: 'integer', required: true, since: 2 },
      { key: 'ornamentColorCodes', header: 'Colores de ornamento V2', type: 'catalog-list:ornament_color', required: true, since: 2 },
    ]),
    technicalColumns: Object.freeze([
      { key: 'sourceId', header: '_BALAM_ID_PRODUCTO', type: 'technical-id', required: true, hidden: true },
      { key: 'sourceVersion', header: '_BALAM_VERSION_PRODUCTO', type: 'integer', required: true, hidden: true },
      { key: 'recordModel', header: '_BALAM_MODELO_REFERENCIA', type: 'technical-model', required: true, hidden: true, since: 2 },
      { key: 'barcodeCode', header: '_BALAM_BARCODE_CODE', type: 'technical-barcode', required: true, hidden: true, since: 2 },
      { key: 'physicalSignature', header: '_BALAM_FIRMA_FISICA', type: 'technical-signature', required: true, hidden: true, since: 2 },
    ]),
  });
  const BASE = INVENTORY_XLSX_SCHEMA.columns.map(column => column.header);
  // Compatibilidad pública para arneses anteriores. H-86 ya no aplica esta
  // lista directamente: el plan canónico decide presencia/PRESERVAR por columna.
  const IMPORT_FIELDS = ['recordModel', 'barcodeCode', 'physicalSignature', 'sizeCode', 'stockQuantity', 'ornamentColorCodes', 'cat', 'sizeCategoryId', 'manga', 'tela', 'color', 'cuello', 'modelo', 'nombre', 'orn', 'ornColors', 'precio', 'costo', 'pop', 'preciosTalla', 'attrs', 'stock'];
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
  // Todo atributo custom tiene columna propia. Si su etiqueta choca con una base
  // (caso real: "Modelo"), se publica como "Atributo · Modelo": compartir una
  // celda entre nombre y código volvería a romper el round-trip.
  function exportCols() {
    return customCols().map(column => Object.assign({}, column, {
      originalLabel: column.label,
      label: BASE.indexOf(column.label) >= 0 ? 'Atributo · ' + column.label : column.label,
    }));
  }
  // Materialización del contrato para el catálogo vigente. Esta misma lista
  // alimenta escritor, validador y parser; no existe una segunda lista de Excel.
  function inventoryColumns(cols) {
    const c = cols || sizeColumns();
    const custom = exportCols().map(item => ({
      key: 'attr:' + item.kind, header: item.label, type: 'catalog:' + item.kind,
      required: true, custom: true, kind: item.kind,
    }));
    const sizes = c.letters.concat(c.numbers).map(item => ({
      key: 'stock:' + item.kind + ':' + String(item.value), header: item.header,
      type: 'stock', required: true, size: true, sizeItem: item,
    }));
    const columns = INVENTORY_XLSX_SCHEMA.columns.concat(custom, sizes, INVENTORY_XLSX_SCHEMA.technicalColumns);
    const seen = Object.create(null);
    columns.forEach(column => {
      if (seen[column.header]) throw balamError(`Dos definiciones producen la columna Excel «${column.header}». Corrige el catálogo antes de continuar.`);
      seen[column.header] = true;
    });
    return columns;
  }
  // Orden de columnas: base · catálogos custom · tallas · técnicas.
  function buildHeaders(cols) {
    return inventoryColumns(cols).map(column => column.header);
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

  function stableJson(value) {
    if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
    if (value && typeof value === 'object') {
      return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
    }
    return JSON.stringify(value);
  }
  // Huella de compatibilidad, no firma de seguridad. Su propósito es detectar
  // que un libro fue materializado con otro conjunto de catálogos.
  function fingerprint(value) {
    const text = typeof value === 'string' ? value : stableJson(value);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }
  function catalogSnapshot() {
    const kinds = ['category', 'sleeve', 'fabric', 'color', 'neck', 'ornament', 'size_letter', 'size_number']
      .concat(customCols().map(column => column.kind));
    const out = {};
    Array.from(new Set(kinds)).sort().forEach(kind => {
      out[kind] = window.CONFIG.all(kind).map(item => ({
        code: String(item.code), label: String(item.label == null ? '' : item.label),
        active: item.active !== false,
        value: item.meta && Object.prototype.hasOwnProperty.call(item.meta, 'value') ? String(item.meta.value) : String(item.code),
      }));
    });
    return out;
  }
  function sizeMapSnapshot(cols) {
    return cols.letters.concat(cols.numbers).map(item => ({
      kind: item.kind, value: String(item.value), label: item.label, header: item.header,
    }));
  }
  function metadataValues(cols) {
    return {
      schema_name: INVENTORY_XLSX_SCHEMA.name,
      schema_version: INVENTORY_XLSX_SCHEMA.version,
      generated_at: new Date().toISOString(),
      origin: 'BALAM_INVENTORY',
      catalog_fingerprint: fingerprint(catalogSnapshot()),
      size_map_fingerprint: fingerprint(sizeMapSnapshot(cols)),
      column_fingerprint: fingerprint(buildHeaders(cols)),
    };
  }
  function metadataSheet(cols) {
    const meta = metadataValues(cols);
    return window.XLSX.utils.aoa_to_sheet([
      ['BALAM INVENTORY — metadatos técnicos; no edites esta hoja'],
      ['Clave', 'Valor'],
      ...Object.keys(meta).map(key => [key, meta[key]]),
    ]);
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
    rows.push([], ['MATERIAL (col. Material)']);
    Object.entries(D.TELA).forEach(([k, v]) => rows.push([k, v]));
    rows.push([], ['CUELLO (col. Cuello)']);
    Object.entries(D.CUELLO).forEach(([k, v]) => rows.push([k, v]));
    rows.push([], ['ORNAMENTO (col. Ornamento)']);
    window.CONFIG.all('ornament').forEach(item => rows.push([item.code, item.label]));
    rows.push([], ['COLOR TELA (col. Color Tela)']);
    Object.entries(D.COLOR_NAME).forEach(([k, v]) => rows.push([k, v]));
    customCols().forEach(c => {
      const exported = exportCols().find(column => column.kind === c.kind);
      rows.push([], [c.label.toUpperCase() + ' (col. ' + (exported ? exported.label : c.label) + ')']);
      window.CONFIG.list(c.kind).forEach(it => rows.push([it.code, it.label]));
    });
    rows.push([], ['CATEGORÍAS POR TALLA (col. Categoría por talla)']);
    window.CONFIG.sizeCategories().forEach(category => rows.push([category.id, category.label]));
    rows.push([], ['NOTAS']);
    rows.push(['• El SKU comercial se arma con las categorías marcadas EN SKU; Material y Color Tela son conceptos distintos.']);
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
    rows.push(['• El SKU identifica comercialmente; la actualización usa _BALAM_ID_PRODUCTO.']);
    rows.push(['• Precios especiales por talla: JSON talla → precio (ej. {"XL":700}).']);
    rows.push(['• Colores Orn. por talla: JSON talla → códigos de color.']);
    rows.push(['• Destacado: usa SI o NO. Las columnas _BALAM_* son técnicas y no forman parte del SKU.']);
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
  function orderedSizeMap(map, product, valueMapper) {
    const out = {};
    const source = map && typeof map === 'object' ? map : {};
    D.resolveProductSizes(product).sizes.forEach(size => {
      const key = String(size.value);
      if (!Object.prototype.hasOwnProperty.call(source, key)) return;
      out[key] = valueMapper ? valueMapper(source[key]) : source[key];
    });
    return out;
  }
  function rowFromProduct(p, cols) {
    const canonicalAttrs = D.canonicalProductAttrs(p.attrs, { product: p });
    const ornamentBySize = D.sanitizeOrnamentColorsBySize(
      canonicalAttrs.__ornamentColorsBySize, p);
    const pricesBySize = D.sanitizePreciosTalla ? D.sanitizePreciosTalla(p.preciosTalla, p) : (p.preciosTalla || {});
    const r = {
      'SKU': p.sku, 'Modelo': p.nombre, 'Categoría': p.cat,
      'Categoría por talla': D.resolveProductSizes(p).categoryId || '',
      'Manga': p.manga, 'Material': p.tela,
      'Color Tela': p.color, 'No. Modelo': p.modelo, 'Ornamento': p.orn,
      'Colores Orn.': p.recordModel === 'v2' ? '' : (p.ornColors || []).join(', '), 'Cuello': p.cuello || 'NOR', 'Precio': p.precio,
      'Foto (URL)': fotoUrl(p), 'Costo': Number(p.costo) || 0, 'Destacado': p.pop ? 'SI' : 'NO',
      'Precios especiales por talla': JSON.stringify(orderedSizeMap(pricesBySize, p, value => Number(value))),
      // JSON conserva códigos canónicos y la relación exacta, no etiquetas.
      'Colores Orn. por talla': p.recordModel === 'v2' ? '{}' : JSON.stringify(orderedSizeMap(ornamentBySize, p, colors => colors.slice())),
      '_BALAM_ID_PRODUCTO': p.id || '',
      '_BALAM_VERSION_PRODUCTO': p._syncVersion == null ? 0 : Number(p._syncVersion) || 0,
      '_BALAM_MODELO_REFERENCIA': p.recordModel || 'v1',
      '_BALAM_BARCODE_CODE': p.barcodeCode || '',
      '_BALAM_FIRMA_FISICA': p.physicalSignature || '',
      'Talla referencia': p.recordModel === 'v2' ? p.sizeCode : '',
      'Existencia referencia': p.recordModel === 'v2' ? Number(p.stockQuantity) || 0 : '',
      'Colores de ornamento V2': p.recordModel === 'v2'
        ? D.canonicalReferenceOrnamentColors(p.ornamentColorCodes || []).join(', ') : '',
    };
    exportCols().forEach(c => { r[c.label] = canonicalAttrs[c.kind] || ''; });
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
    if (h === 'Colores Orn. por talla') return 42;
    if (h === 'Precios especiales por talla') return 34;
    if (h.indexOf('_BALAM_') === 0) return 2;
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
    headers.forEach((header, index) => {
      if (header.indexOf('_BALAM_') === 0) ws['!cols'][index].hidden = true;
    });
    return ws;
  }

  function download(wb, filename) {
    window.XLSX.writeFile(wb, filename, { bookType: 'xlsx' });
  }

  function inventoryWorkbook(products) {
    const cols = sizeColumns();
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, inventarioSheet(products || [], cols), 'Inventario');
    window.XLSX.utils.book_append_sheet(wb, catalogosSheet(cols), 'Catálogos');
    window.XLSX.utils.book_append_sheet(wb, metadataSheet(cols), '_BALAM');
    if (!wb.Workbook) wb.Workbook = {};
    wb.Workbook.Sheets = wb.SheetNames.map((name, index) => ({ Hidden: index === 2 ? 1 : 0 }));
    return { wb, cols };
  }
  function writeInventoryWorkbook(products, filename, successMessage, errorMessage) {
    if (!ensureXLSX()) return;
    try {
      const built = inventoryWorkbook(products);
      download(built.wb, filename);
      window.UI.toast(successMessage, 'var(--accent)');
      return built.wb;
    } catch (err) {
      window.UI.toast(mensajeError(err, errorMessage), 'var(--danger)');
      return null;
    }
  }
  function exportTemplate() {
    return writeInventoryWorkbook([], 'Plantilla_Inventario_Balam.xlsx',
      'Plantilla vacía descargada — llénala e impórtala', 'No se pudo generar la plantilla');
  }
  function exportInventory(products) {
    const fecha = new Date().toISOString().slice(0, 10);
    return writeInventoryWorkbook(products, `Inventario_Balam_${fecha}.xlsx`,
      `${products.length} productos exportados`, 'No se pudo exportar el inventario');
  }

  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  function rowError(idx, header, message) { throw balamError(`Fila ${idx + 2} · «${header}»: ${message}`); }
  function parseNumber(v, idx, header, options) {
    const raw = String(v == null ? '' : v).trim();
    if (!raw && options && options.emptyZero) return 0;
    const number = Number(raw.replace(/[$,\s]/g, ''));
    if (!raw || !Number.isFinite(number)) rowError(idx, header, 'debe ser un número válido.');
    if ((!options || !options.allowNegative) && number < 0) rowError(idx, header, 'no puede ser negativo.');
    return number;
  }
  function parseInteger(v, idx, header, options) {
    const number = parseNumber(v, idx, header, options);
    if (!Number.isInteger(number)) rowError(idx, header, 'debe ser un entero.');
    return number;
  }
  function catalogValue(kind, raw, idx, header, allowEmpty, unknowns) {
    const value = String(raw == null ? '' : raw).trim();
    if (!value) { if (allowEmpty) return ''; rowError(idx, header, 'es obligatorio.'); }
    const items = window.CONFIG.all(kind);
    const found = items.find(item => String(item.code) === value)
      || items.find(item => String(item.code).toLowerCase() === value.toLowerCase())
      || items.find(item => String(item.label).toLowerCase() === value.toLowerCase());
    if (!found) {
      if (unknowns) { unknowns.push({ kind, header, value }); return value; }
      rowError(idx, header, `el valor «${value}» no existe en el catálogo ${kind}.`);
    }
    return found.code;
  }
  function parseBoolean(v, idx, header) {
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    const value = String(v == null ? '' : v).trim().toLowerCase();
    if (['si', 'sí', 'true', '1', 'yes'].includes(value)) return true;
    if (['no', 'false', '0'].includes(value)) return false;
    rowError(idx, header, 'usa SI o NO.');
  }
  function parseJsonObject(v, idx, header) {
    const raw = String(v == null ? '' : v).trim();
    if (!raw) return {};
    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) { rowError(idx, header, 'contiene JSON inválido.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) rowError(idx, header, 'debe ser un objeto JSON.');
    return parsed;
  }
  function parseOrnColors(v, idx, unknowns) {
    const raw = String(v == null ? '' : v).trim();
    if (!raw) return [];
    const out = [];
    raw.split(/[,;/]+/).map(value => value.trim()).filter(Boolean).forEach(value => {
      const code = catalogValue('color', value, idx, 'Colores Orn.', false, unknowns);
      if (!out.includes(code)) out.push(code);
    });
    return out;
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
    const canonical = cols.mode === 'current';
    const headers = cols.fileHeaders || Object.keys(row || {});
    const present = header => headers.includes(header);
    const missing = [];
    const requiredText = (header, fallback) => {
      if (!present(header)) { missing.push(header); return fallback; }
      const value = String(row[header] == null ? '' : row[header]).trim();
      if (!value) rowError(idx, header, 'es obligatorio.');
      return value;
    };
    const unknownCatalogValues = [];
    const nombre = requiredText('Modelo', 'Producto heredado fila ' + (idx + 2));
    if (!canonical && /ejemplo/i.test(nombre)) return null;
    const skuRaw = present('SKU') ? String(row['SKU'] || '').trim().toUpperCase() : '';
    const catRaw = requiredText('Categoría', '');
    const mangaRaw = requiredText('Manga', '');
    const telaRaw = requiredText('Material', '');
    const colorRaw = requiredText('Color Tela', '');
    const modelo = requiredText('No. Modelo', '');
    const ornRaw = requiredText('Ornamento', '—');
    const cuelloRaw = requiredText('Cuello', 'NOR');
    const cat = catRaw ? catalogValue('category', catRaw, idx, 'Categoría', false, unknownCatalogValues) : '';
    const manga = mangaRaw ? catalogValue('sleeve', mangaRaw, idx, 'Manga', false, unknownCatalogValues) : '';
    const tela = telaRaw ? catalogValue('fabric', telaRaw, idx, 'Material', false, unknownCatalogValues) : '';
    const color = colorRaw ? catalogValue('color', colorRaw, idx, 'Color Tela', false, unknownCatalogValues) : '';
    const orn = ornRaw ? catalogValue('ornament', ornRaw, idx, 'Ornamento', false, unknownCatalogValues) : '—';
    const cuello = cuelloRaw ? catalogValue('neck', cuelloRaw, idx, 'Cuello', false, unknownCatalogValues) : 'NOR';
    const valuesByKind = { size_letter: [], size_number: [] };
    cols.letters.concat(cols.numbers).forEach(item => {
      const header = columnOf(item, cols.fileMap);
      const isPresent = present(header);
      const value = isPresent ? parseInteger(row[header], idx, header, { emptyZero: true }) : 0;
      valuesByKind[item.kind].push({ item, present: isPresent, value });
    });
    const hasLetters = valuesByKind.size_letter.some(entry => entry.value > 0);
    const hasNumbers = valuesByKind.size_number.some(entry => entry.value > 0);
    let sizeCategory = present('Categoría por talla') ? validSizeCategory(row['Categoría por talla']) : null;
    if (present('Categoría por talla') && !sizeCategory) rowError(idx, 'Categoría por talla', 'no existe en el catálogo.');
    if (!sizeCategory && hasLetters !== hasNumbers) {
      const scale = hasLetters ? 'L' : 'N';
      sizeCategory = window.CONFIG.sizeCategories().find(category => category.scale === scale) || null;
    }
    if (!sizeCategory) { missing.push('Categoría por talla'); sizeCategory = window.CONFIG.sizeCategories()[0] || null; }
    if (!sizeCategory) rowError(idx, 'Categoría por talla', 'no hay categorías configuradas.');
    if ((sizeCategory.scale === 'L' && hasNumbers) || (sizeCategory.scale === 'N' && hasLetters)) rowError(idx, 'Categoría por talla', 'hay existencias en una familia incompatible.');
    const selectedKind = sizeCategory.scale === 'N' ? 'size_number' : 'size_letter';
    const stock = valuesByKind[selectedKind].map(entry => ({ talla: entry.item.value, escala: sizeCategory.scale, stock: entry.value }));
    const allowedSizes = new Set(valuesByKind[selectedKind].map(entry => String(entry.item.value)));
    const rawPrices = present('Precios especiales por talla') ? parseJsonObject(row['Precios especiales por talla'], idx, 'Precios especiales por talla') : {};
    const preciosTalla = {};
    Object.keys(rawPrices).forEach(size => {
      if (!allowedSizes.has(String(size))) rowError(idx, 'Precios especiales por talla', `la talla «${size}» no pertenece a la categoría elegida.`);
      preciosTalla[size] = Math.round(parseNumber(rawPrices[size], idx, 'Precios especiales por talla') * 100) / 100;
    });
    const rawH83 = present('Colores Orn. por talla') ? parseJsonObject(row['Colores Orn. por talla'], idx, 'Colores Orn. por talla') : {};
    const ornamentColorsBySize = {};
    Object.keys(rawH83).forEach(size => {
      if (!allowedSizes.has(String(size))) rowError(idx, 'Colores Orn. por talla', `la talla «${size}» no pertenece a la categoría elegida.`);
      if (!Array.isArray(rawH83[size])) rowError(idx, 'Colores Orn. por talla', `la talla «${size}» debe contener una lista de colores.`);
      const colors = [];
      rawH83[size].forEach(value => { const code = catalogValue('color', value, idx, 'Colores Orn. por talla', false, unknownCatalogValues); if (!colors.includes(code)) colors.push(code); });
      if (colors.length) ornamentColorsBySize[size] = colors;
    });
    const attrs = { __sizeCategoryId: sizeCategory.id, __ornamentColorsBySize: ornamentColorsBySize };
    const customValues = {};
    exportCols().forEach(column => {
      if (!present(column.label)) return;
      const raw = String(row[column.label] == null ? '' : row[column.label]).trim();
      const value = raw ? catalogValue(column.kind, raw, idx, column.label, false, unknownCatalogValues) : '';
      customValues[column.kind] = value;
      if (value) attrs[column.kind] = value;
    });
    const foto = present('Foto (URL)') ? String(row['Foto (URL)'] || '').trim() : '';
    if (foto && !/^https?:\/\//i.test(foto)) rowError(idx, 'Foto (URL)', 'sólo admite enlaces http(s).');
    const sourceId = present('_BALAM_ID_PRODUCTO') ? String(row['_BALAM_ID_PRODUCTO'] || '').trim() : '';
    const sourceVersionRaw = present('_BALAM_VERSION_PRODUCTO') ? String(row['_BALAM_VERSION_PRODUCTO'] == null ? '' : row['_BALAM_VERSION_PRODUCTO']).trim() : '';
    if (sourceId && !sourceVersionRaw) rowError(idx, '_BALAM_VERSION_PRODUCTO', 'es obligatoria cuando existe ID de producto.');
    const sourceVersion = sourceVersionRaw ? parseInteger(sourceVersionRaw, idx, '_BALAM_VERSION_PRODUCTO') : null;
    const precio = present('Precio') ? parseNumber(row['Precio'], idx, 'Precio') : 0;
    const costo = present('Costo') ? parseNumber(row['Costo'], idx, 'Costo') : 0;
    const pop = present('Destacado') ? parseBoolean(row['Destacado'], idx, 'Destacado') : false;
    const recordModel = present('_BALAM_MODELO_REFERENCIA')
      ? String(row['_BALAM_MODELO_REFERENCIA'] || 'v1').trim().toLowerCase() : 'v1';
    if (!['v1', 'v2'].includes(recordModel)) rowError(idx, '_BALAM_MODELO_REFERENCIA', 'debe ser v1 o v2.');
    const ornColors = recordModel === 'v2' ? []
      : present('Colores Orn.') ? parseOrnColors(row['Colores Orn.'], idx, unknownCatalogValues) : [];
    if (recordModel === 'v2') delete attrs.__ornamentColorsBySize;
    const sizeCode = present('Talla referencia') ? String(row['Talla referencia'] || '').trim() : '';
    const stockQuantity = present('Existencia referencia') ? parseInteger(row['Existencia referencia'], idx, 'Existencia referencia', { emptyZero: true }) : 0;
    const ornamentColorCodes = D.canonicalReferenceOrnamentColors(present('Colores de ornamento V2')
      ? String(row['Colores de ornamento V2'] || '').split(',').map(value => value.trim()).filter(Boolean).map(value =>
        catalogValue('ornament_color', value, idx, 'Colores de ornamento V2', false, unknownCatalogValues)) : []);
    if (recordModel === 'v2' && !sizeCode) rowError(idx, 'Talla referencia', 'es obligatoria para V2.');
    if (recordModel === 'v2' && !allowedSizes.has(sizeCode)) rowError(idx, 'Talla referencia', 'no pertenece a la categoría elegida.');
    const barcodeCode = present('_BALAM_BARCODE_CODE') ? String(row['_BALAM_BARCODE_CODE'] || '').trim().toUpperCase() : '';
    const physicalSignature = present('_BALAM_FIRMA_FISICA') ? String(row['_BALAM_FIRMA_FISICA'] || '').trim() : '';
    const rawProduct = {
      id: sourceId || undefined, recordModel, barcodeCode: barcodeCode || undefined,
      physicalSignature: physicalSignature || undefined,
      sizeCode, sizeScale: sizeCategory.scale, stockQuantity, ornamentColorCodes,
      cat, manga, tela, color, modelo, nombre,
      imagen: foto || undefined, orn, ornColors, cuello, precio, costo, pop, preciosTalla,
      attrs, sizeCategoryId: sizeCategory.id,
      stock: recordModel === 'v2' ? [{ talla: sizeCode, escala: sizeCategory.scale, stock: stockQuantity }] : stock,
      sku: skuRaw || undefined,
    };
    try {
      // El adaptador legacy conserva su contrato de lectura histórica: campos
      // que todavía no existían significan PRESERVAR. El esquema canónico sí
      // exige todos los catálogos custom marcados como obligatorios.
      rawProduct.attrs = D.canonicalProductAttrs(rawProduct.attrs, {
        validateRequired: canonical || recordModel === 'v2', product: rawProduct,
      });
    } catch (error) {
      const definition = window.CONFIG.catalogMeta(error.kind) || {};
      rowError(idx, definition.label || error.kind || 'Atributos', error.message || 'es obligatorio.');
    }
    const product = recordModel === 'v2' ? D.createReference(rawProduct, [])
      : D.hydrate(Object.assign(rawProduct, { id: sourceId || 'imp-' + Date.now() + '-' + idx }));
    // Un heredado sin la columna H-83 expresa PRESERVAR, no un mapa vacío.
    if (!present('Colores Orn. por talla')) delete product.attrs.__ornamentColorsBySize;
    Object.defineProperty(product, '__xlsx', { value: {
      rowIndex: idx, sourceId, sourceVersion, canonical, missing, presentHeaders: headers.slice(),
      customValues, imageProvided: !!foto, unknownCatalogValues,
      stockPresent: valuesByKind[selectedKind].filter(entry => entry.present).map(entry => String(entry.item.value)),
    }, configurable: true, enumerable: false });
    return product;
  }

  // Columna de la que sale la cantidad de una talla:
  //   · con mapa del archivo → la que ese archivo declaró para esta identidad;
  //   · sin mapa → la regla histórica: el encabezado ERA la identidad.
  // Una identidad que el archivo no declara devuelve una columna inexistente y su
  // cantidad queda en 0, igual que hoy con una talla creada después de exportar.
  function columnOf(item, fileMap) {
    if (!fileMap) return item.legacyHeader;
    const found = fileMap[item.kind + '\u001f' + String(item.value)];
    return found == null ? '\u001fsin-columna' : found;
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
      map[kind + '\u001f' + value] = header;
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

  function validateSizeMapSheet(wb) {
    const ws = wb && wb.Sheets && wb.Sheets['Catálogos'];
    if (!ws) return [];
    const rows = sheetToJson(ws, { header: 1, defval: '' });
    const start = rows.findIndex(row => String((row && row[0]) || '').indexOf(SIZE_MAP_MARK) === 0);
    if (start < 0) return [];
    const identities = Object.create(null); const headers = Object.create(null); const entries = [];
    for (let i = start + 2; i < rows.length; i++) {
      const row = rows[i] || [];
      const header = String(row[0] == null ? '' : row[0]).trim();
      const value = String(row[1] == null ? '' : row[1]).trim();
      const kind = String(row[3] == null ? '' : row[3]).trim();
      if (!header || !kind) break;
      if (!['size_letter', 'size_number'].includes(kind)) throw balamError(`La hoja «Catálogos» declara la categoría de talla desconocida «${kind}».`);
      const key = kind + '|' + value;
      if (identities[key]) throw balamError(`La hoja «Catálogos» repite la identidad de talla «${value}» (${kind}).`);
      if (headers[header]) throw balamError(`La hoja «Catálogos» asigna dos tallas a la columna «${header}».`);
      identities[key] = true; headers[header] = true;
      entries.push({ header, value, label: String(row[2] || ''), kind });
    }
    return entries;
  }
  function metadataFromWorkbook(wb) {
    const ws = wb && wb.Sheets && wb.Sheets['_BALAM'];
    if (!ws) return null;
    const rows = sheetToJson(ws, { header: 1, defval: '' });
    const meta = Object.create(null);
    rows.slice(2).forEach(row => {
      const key = String(row[0] == null ? '' : row[0]).trim();
      if (key) meta[key] = row[1];
    });
    return meta;
  }
  function duplicateHeaders(headers) {
    const seen = Object.create(null); const duplicates = [];
    headers.forEach(header => {
      if (!header) return;
      if (seen[header] && !duplicates.includes(header)) duplicates.push(header);
      seen[header] = true;
    });
    return duplicates;
  }
  function validateCurrentWorkbook(wb, ws, cols, meta, mapEntries) {
    if (String(meta.schema_name || '') !== INVENTORY_XLSX_SCHEMA.name) throw balamError(`El archivo declara el esquema «${meta.schema_name || 'sin nombre'}», no un inventario BALAM.`);
    const schemaVersion = Number(meta.schema_version);
    if (![1, INVENTORY_XLSX_SCHEMA.version].includes(schemaVersion)) throw balamError(`Versión de esquema incompatible: archivo ${meta.schema_version || 'sin versión'}, BALAM ${INVENTORY_XLSX_SCHEMA.version}.`);
    if (!wb.Sheets['Inventario'] || !wb.Sheets['Catálogos']) throw balamError('El archivo canónico debe conservar las hojas «Inventario» y «Catálogos».');
    const headers = headerRowOf(ws);
    const duplicates = duplicateHeaders(headers);
    if (duplicates.length) throw balamError(`La hoja «Inventario» repite la columna «${duplicates[0]}».`);
    const legacyHeaders = { tela: 'Tela', color: 'Color' };
    const required = inventoryColumns(cols).filter(column => !column.since || schemaVersion >= column.since)
      .map(column => schemaVersion === 1 && legacyHeaders[column.key] ? legacyHeaders[column.key] : column.header);
    const missing = required.filter(header => !headers.includes(header));
    if (missing.length) throw balamError(`El archivo canónico no contiene la columna obligatoria «${missing[0]}».`);
    if (!cols.fileMap || !mapEntries.length) throw balamError('El archivo canónico no contiene el mapa técnico de tallas en «Catálogos».');
    cols.letters.concat(cols.numbers).forEach(item => {
      const entry = mapEntries.find(candidate => candidate.kind === item.kind && String(candidate.value) === String(item.value));
      if (!entry || !headers.includes(entry.header)) throw balamError(`La talla «${item.label}» no tiene una columna técnica resoluble.`);
    });
    mapEntries.forEach(entry => {
      const exists = cols.letters.concat(cols.numbers).some(item => item.kind === entry.kind && String(item.value) === String(entry.value));
      if (!exists) throw balamError(`El archivo refiere la talla interna «${entry.value}» (${entry.kind}), que no existe en el catálogo actual.`);
    });
    cols.fileHeaders = headers;
    return {
      catalogChanged: String(meta.catalog_fingerprint || '') !== fingerprint(catalogSnapshot()),
      columnsMoved: headers.join('\0') !== buildHeaders(cols).join('\0'),
    };
  }

  // Lee archivo → Promise<{products,total,skipped,schema,warnings}>.
  function parseFile(file) {
    return readWorkbook(file).then(wb => {
      const cols = sizeColumns();
      const mapEntries = validateSizeMapSheet(wb);
      cols.fileMap = sizeMapFromWorkbook(wb);
      const meta = metadataFromWorkbook(wb);
      const mode = meta ? 'current' : 'legacy';
      if (meta && !wb.SheetNames.includes('Inventario')) throw balamError('El archivo canónico no contiene la hoja «Inventario».');
      const sheetName = wb.SheetNames.includes('Inventario') ? 'Inventario' : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      cols.mode = mode;
      cols.fileHeaders = headerRowOf(ws);
      const duplicates = duplicateHeaders(cols.fileHeaders);
      if (duplicates.length) throw balamError(`La hoja «${sheetName}» repite la columna «${duplicates[0]}».`);
      const warnings = [];
      if (mode === 'current') {
        const validation = validateCurrentWorkbook(wb, ws, cols, meta, mapEntries);
        if (validation.catalogChanged) warnings.push('El catálogo cambió desde que se generó el archivo; cada código y talla fue validado contra la configuración actual.');
        if (validation.columnsMoved) warnings.push('Las columnas cambiaron de posición; se resolvieron por encabezado e identidad técnica.');
      } else {
        warnings.push('Archivo heredado sin versión: los campos ausentes se conservarán y toda coincidencia por SKU requiere resolución explícita.');
        if (!cols.fileMap) assertLegacyReadable(ws, cols);
      }
      const rows = sheetToJson(ws, { defval: '' });
      // Contrato v1/heredado: esos archivos llamaban “Tela” a Material y
      // “Color” a Color Tela. Se traducen al vocabulario vigente antes de
      // construir el producto; nunca vuelven a definir categorías de CONFIG.
      if (!cols.fileHeaders.includes('Material') && cols.fileHeaders.includes('Tela')) cols.fileHeaders.push('Material');
      if (!cols.fileHeaders.includes('Color Tela') && cols.fileHeaders.includes('Color')) cols.fileHeaders.push('Color Tela');
      rows.forEach(row => {
        if (!Object.prototype.hasOwnProperty.call(row, 'Material') && Object.prototype.hasOwnProperty.call(row, 'Tela')) row.Material = row.Tela;
        if (!Object.prototype.hasOwnProperty.call(row, 'Color Tela') && Object.prototype.hasOwnProperty.call(row, 'Color')) row['Color Tela'] = row.Color;
      });
      const products = [];
      let skipped = 0;
      rows.forEach((r, i) => { const p = buildProduct(r, i, cols); if (p) products.push(p); else skipped++; });
      return { products, total: rows.length, skipped, schema: mode, metadata: meta || {}, warnings };
    });
  }

  function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  function importMeta(product) { return product && product.__xlsx ? product.__xlsx : {}; }
  function canonicalProductState(product) {
    const resolved = D.resolveProductSizes(product);
    const attrs = {};
    const canonicalAttrs = D.canonicalProductAttrs(product.attrs, { product });
    Object.keys(canonicalAttrs).sort().forEach(key => { attrs[key] = clone(canonicalAttrs[key]); });
    return {
      id: product.id || '', version: Number(product._syncVersion) || 0, sku: product.sku || '',
      recordModel: product.recordModel || 'v1', barcodeCode: product.barcodeCode || '',
      physicalSignature: product.physicalSignature || '', sizeCode: product.sizeCode || '',
      stockQuantity: product.stockQuantity == null ? null : Number(product.stockQuantity),
      physicalIdentityLocked: !!product.physicalIdentityLocked,
      ornamentColorCodes: D.canonicalReferenceOrnamentColors(product.ornamentColorCodes || []),
      nombre: product.nombre || '', cat: product.cat || '', manga: product.manga || '', tela: product.tela || '',
      color: product.color || '', modelo: String(product.modelo == null ? '' : product.modelo), orn: product.orn || '',
      ornColors: (product.ornColors || []).slice(), cuello: product.cuello || '', precio: Number(product.precio) || 0,
      costo: Number(product.costo) || 0, pop: !!product.pop, imagen: fotoUrl(product),
      sizeCategoryId: resolved.categoryId || '',
      preciosTalla: orderedSizeMap(product.preciosTalla || {}, product, value => Number(value)),
      attrs,
      stock: resolved.sizes.map(size => ({ talla: String(size.value), escala: size.scale, stock: Number(size.stock) || 0 })),
    };
  }
  function inventoryStateFingerprint(products) { return fingerprint((products || []).map(canonicalProductState)); }
  function unknownMatchesTarget(issue, target) {
    if (!target) return false;
    const direct = { 'Categoría': 'cat', 'Manga': 'manga', 'Material': 'tela', 'Color Tela': 'color', 'Ornamento': 'orn', 'Cuello': 'cuello' };
    if (direct[issue.header]) return String(target[direct[issue.header]]) === String(issue.value);
    if (issue.header === 'Colores Orn.') return (target.ornColors || []).map(String).includes(String(issue.value));
    if (issue.header === 'Colores Orn. por talla') {
      return Object.values(((target.attrs || {}).__ornamentColorsBySize) || {}).some(colors => (colors || []).map(String).includes(String(issue.value)));
    }
    return String((target.attrs || {})[issue.kind] == null ? '' : (target.attrs || {})[issue.kind]) === String(issue.value);
  }
  function updateFromImport(target, incoming) {
    const meta = importMeta(incoming);
    const after = clone(target);
    const present = new Set(meta.presentHeaders || []);
    (meta.unknownCatalogValues || []).forEach(issue => present.delete(issue.header));
    [
      ['Categoría', 'cat'], ['Manga', 'manga'], ['Material', 'tela'], ['Color Tela', 'color'], ['Cuello', 'cuello'],
      ['No. Modelo', 'modelo'], ['Modelo', 'nombre'], ['Ornamento', 'orn'], ['Colores Orn.', 'ornColors'],
      ['Precio', 'precio'], ['Costo', 'costo'], ['Destacado', 'pop'],
    ].forEach(([header, field]) => { if (present.has(header)) after[field] = clone(incoming[field]); });
    if (present.has('Precios especiales por talla')) after.preciosTalla = clone(incoming.preciosTalla || {});
    if (target.recordModel === 'v2') {
      after.recordModel = 'v2';
      if (present.has('Talla referencia')) after.sizeCode = incoming.sizeCode;
      if (present.has('Existencia referencia')) after.stockQuantity = Number(incoming.stockQuantity) || 0;
      if (present.has('Colores de ornamento V2')) {
        after.ornamentColorCodes = D.canonicalReferenceOrnamentColors(incoming.ornamentColorCodes || []);
        after.ornColors = clone(after.ornamentColorCodes);
      }
      after.barcodeCode = target.barcodeCode;
    }
    if (meta.imageProvided) after.imagen = incoming.imagen;
    const attrs = Object.assign({}, after.attrs || {});
    if (present.has('Categoría por talla')) {
      after.sizeCategoryId = incoming.sizeCategoryId;
      attrs.__sizeCategoryId = incoming.sizeCategoryId;
    }
    if (target.recordModel === 'v2') delete attrs.__ornamentColorsBySize;
    else if (present.has('Colores Orn. por talla')) attrs.__ornamentColorsBySize = clone((incoming.attrs || {}).__ornamentColorsBySize || {});
    Object.keys(meta.customValues || {}).forEach(kind => {
      const value = meta.customValues[kind];
      if (value) attrs[kind] = value; else delete attrs[kind];
    });
    after.attrs = D.canonicalProductAttrs(attrs, { validateRequired: true, product: after });
    const stockKeys = new Set(meta.stockPresent || []);
    if (stockKeys.size) {
      if (meta.canonical) after.stock = clone(incoming.stock || []);
      else {
        const byKey = {};
        (after.stock || []).forEach(item => { byKey[String(item.escala) + '|' + String(item.talla)] = clone(item); });
        (incoming.stock || []).forEach(item => {
          if (stockKeys.has(String(item.talla))) byKey[String(item.escala) + '|' + String(item.talla)] = clone(item);
        });
        after.stock = Object.keys(byKey).map(key => byKey[key]);
      }
    }
    after.id = target.id;
    after.sku = target.sku;
    after._syncVersion = target._syncVersion;
    if (after.recordModel === 'v2') after.physicalSignature = D.physicalSignature(after);
    return D.hydrate(after);
  }
  function changeSummary(before, after) {
    return [
      ['recordModel', 'Modelo de registro'], ['barcodeCode', 'Código logístico'],
      ['sizeCode', 'Talla referencia'], ['stockQuantity', 'Existencia referencia'],
      ['ornamentColorCodes', 'Colores de ornamento V2'],
      ['nombre', 'Nombre'], ['cat', 'Categoría'], ['manga', 'Manga'], ['tela', 'Material'], ['color', 'Color Tela'],
      ['modelo', 'No. Modelo'], ['orn', 'Ornamento'], ['ornColors', 'Colores'], ['cuello', 'Cuello'],
      ['precio', 'Precio'], ['preciosTalla', 'Precios por talla'], ['costo', 'Costo'], ['pop', 'Destacado'],
      ['imagen', 'Imagen'], ['sizeCategoryId', 'Categoría por talla'], ['attrs', 'Atributos'], ['stock', 'Existencias'],
    ].filter(([key]) => stableJson(before[key]) !== stableJson(after[key])).map(([, label]) => label);
  }
  function planImport(parsed, currentProducts, resolutions) {
    const SKU_DUPLICATE_WARNING = 'SKU_DUPLICATE_WARNING';
    const BARCODE_DUPLICATE = 'BARCODE_DUPLICATE';
    const current = currentProducts || [];
    const resolutionMap = resolutions || {};
    const byId = Object.create(null); const bySku = Object.create(null); const byBarcode = Object.create(null);
    current.forEach(product => {
      if (product.id) byId[product.id] = product;
      (bySku[product.sku] || (bySku[product.sku] = [])).push(product);
      if (product.barcodeCode) (byBarcode[product.barcodeCode] || (byBarcode[product.barcodeCode] = [])).push(product);
    });
    const fileSkuCounts = Object.create(null); const fileIdCounts = Object.create(null); const fileBarcodeCounts = Object.create(null);
    (parsed.products || []).forEach(product => {
      fileSkuCounts[product.sku] = (fileSkuCounts[product.sku] || 0) + 1;
      const id = importMeta(product).sourceId;
      if (id) fileIdCounts[id] = (fileIdCounts[id] || 0) + 1;
      if (product.barcodeCode) fileBarcodeCounts[product.barcodeCode] = (fileBarcodeCounts[product.barcodeCode] || 0) + 1;
    });
    const rows = []; const nextById = Object.create(null);
    current.forEach(product => { nextById[product.id] = clone(product); });
    (parsed.products || []).forEach(incoming => {
      const meta = importMeta(incoming); const rowKey = 'row-' + meta.rowIndex;
      const matches = bySku[incoming.sku] || [];
      let conflict = null; let target = null; let action = null;
      const v2 = incoming.recordModel === 'v2';
      const barcodeMatches = incoming.barcodeCode ? (byBarcode[incoming.barcodeCode] || []) : [];
      if (meta.sourceId && fileIdCounts[meta.sourceId] > 1) conflict = { code: 'DUPLICATE_ID_FILE', message: `El ID ${meta.sourceId} aparece más de una vez en el archivo.` };
      else if (v2 && incoming.barcodeCode && fileBarcodeCounts[incoming.barcodeCode] > 1) conflict = { code: BARCODE_DUPLICATE, message: `El código logístico ${incoming.barcodeCode} aparece más de una vez en el archivo.` };
      else if (v2 && barcodeMatches.length > 1) conflict = { code: BARCODE_DUPLICATE, message: `El código logístico ${incoming.barcodeCode} resuelve a varias referencias actuales.` };
      else if (!v2 && fileSkuCounts[incoming.sku] > 1) conflict = { code: 'DUPLICATE_SKU_FILE', message: `El SKU ${incoming.sku} aparece ${fileSkuCounts[incoming.sku]} veces en el archivo legacy.` };
      else if (!v2 && matches.length > 1) conflict = { code: 'DUPLICATE_SKU_CURRENT', message: `El SKU ${incoming.sku} pertenece a ${matches.length} productos legacy actuales.` };
      else if (meta.sourceId) {
        target = byId[meta.sourceId] || null;
        if (!target) conflict = { code: 'ID_NOT_FOUND', message: `El ID técnico ${meta.sourceId} no existe actualmente; no se creará desde Excel.` };
        else if ((target.recordModel || 'v1') !== (incoming.recordModel || 'v1')) conflict = { code: 'REFERENCE_MODEL_MISMATCH', message: `El ID ${meta.sourceId} es ${(target.recordModel || 'v1').toUpperCase()} y la fila declara ${(incoming.recordModel || 'v1').toUpperCase()}; Excel no convierte modelos de referencia.` };
        else if (!v2 && String(target.sku) !== String(incoming.sku)) conflict = { code: 'SKU_ID_MISMATCH', message: `El ID ${meta.sourceId} pertenece al SKU ${target.sku}, no a ${incoming.sku}.` };
        else if (meta.sourceVersion !== null && Number(target._syncVersion || 0) !== Number(meta.sourceVersion)) conflict = { code: 'VERSION_CONFLICT', message: `El producto ${incoming.sku} cambió después de exportar (versión ${meta.sourceVersion} → ${Number(target._syncVersion) || 0}).` };
        else action = 'update';
      } else if (v2 && barcodeMatches.length === 1) {
        target = barcodeMatches[0];
        if ((target.recordModel || 'v1') !== 'v2') conflict = { code: 'REFERENCE_MODEL_MISMATCH', message: `El código logístico ${incoming.barcodeCode} no pertenece a una referencia V2.` };
        else action = 'update';
      } else if (v2 || !matches.length) {
        if (meta.missing && meta.missing.length) conflict = { code: 'LEGACY_MISSING_NEW', message: `La fila heredada no puede crear un producto: faltan ${meta.missing.join(', ')}.` };
        else action = 'new';
      } else {
        target = matches[0];
        if (resolutionMap[rowKey] === target.id) action = 'update';
        else conflict = { code: 'ID_REQUIRED', resolvable: true, candidateId: target.id, message: `El SKU ${incoming.sku} ya existe, pero la fila no contiene identidad técnica. Confirma expresamente el producto.` };
      }
      if (!conflict && action && (meta.unknownCatalogValues || []).length) {
        const changedUnknown = meta.unknownCatalogValues.find(issue => !unknownMatchesTarget(issue, target));
        if (changedUnknown) {
          conflict = { code: 'UNKNOWN_CATALOG_VALUE', message: `El valor «${changedUnknown.value}» de «${changedUnknown.header}» no existe en el catálogo actual.` };
          action = null;
        }
      }
      let after = null; let beforeState = null; let afterState = null; let fields = [];
      if (!conflict && action === 'update') {
        after = updateFromImport(target, incoming);
        if (target.recordModel === 'v2' && after.physicalSignature !== target.physicalSignature
            && (target.physicalIdentityLocked || (Number(target.stockQuantity) || 0) !== 0
              || (D.referenceHasOperations && D.referenceHasOperations(target.id)))) {
          conflict = { code: 'REFERENCE_RECLASSIFICATION_REQUIRED', message: 'La fila intenta cambiar atributos físicos de una referencia con operaciones. Usa Reclasificación.' };
          action = null; after = null;
        }
      }
      if (!conflict && action === 'update') {
        beforeState = canonicalProductState(target); afterState = canonicalProductState(after);
        fields = changeSummary(beforeState, afterState); nextById[target.id] = after;
      } else if (!conflict && action === 'new') {
        try {
          after = clone(incoming); after._syncVersion = 0;
          after = v2 ? D.createReference(after, Object.values(nextById)) : D.hydrate(after);
          afterState = canonicalProductState(after); fields = ['Alta completa']; nextById[after.id] = after;
        } catch (error) {
          conflict = { code: error.code || 'REFERENCE_CREATE_INVALID', message: error.message || 'La referencia V2 no pudo validarse.' };
          action = null; after = null;
        }
      }
      rows.push({ rowKey, rowNumber: meta.rowIndex + 2, incoming, action: conflict ? 'conflict' : action, conflict, targetId: target && target.id, before: beforeState, after: afterState, fields });
    });
    const conflicts = rows.filter(row => row.conflict);
    const ok = conflicts.length === 0 && rows.length > 0;
    const warnings = (parsed.warnings || []).slice();
    Object.keys(fileSkuCounts).filter(sku => fileSkuCounts[sku] > 1).forEach(sku =>
      warnings.push(`${SKU_DUPLICATE_WARNING}: ${fileSkuCounts[sku]} referencias comparten el SKU ${sku}; se conservarán separadas por ID y barcode.`));
    return {
      ok, schema: parsed.schema, warnings, rows, conflicts,
      creates: rows.filter(row => row.action === 'new').length,
      updates: rows.filter(row => row.action === 'update').length,
      baseFingerprint: inventoryStateFingerprint(current),
      nextProducts: ok ? Object.keys(nextById).map(id => nextById[id]) : clone(current),
    };
  }
  function applyImportPlan(plan, products) {
    if (!plan || !plan.ok || (plan.conflicts || []).length) throw balamError('La importación tiene conflictos; no se modificó el inventario.');
    if (inventoryStateFingerprint(products || []) !== plan.baseFingerprint) throw balamError('El inventario cambió mientras revisabas la importación. Vuelve a abrir el archivo.');
    const clean = plan.nextProducts.map(product => { const copy = clone(product); delete copy.__xlsx; return copy; });
    products.splice(0, products.length, ...clean);
    const productIds = (plan.rows || [])
      .filter(row => row.action === 'new' || row.action === 'update')
      .map(row => row.targetId || (row.after && row.after.id))
      .filter(Boolean);
    return { nuevos: plan.creates, actualizados: plan.updates, productIds };
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
    parseFile, planImport, applyImportPlan, readWorkbook, sheetToJson, limits: XLSX_LIMITS,
    headers: buildHeaders, sizeColumns, schema: INVENTORY_XLSX_SCHEMA, IMPORT_FIELDS,
    // Costura pura para pruebas de ida/vuelta; no persiste ni descarga archivos.
    __test: { rowFromProduct, buildProduct, inventoryWorkbook, metadataFromWorkbook, canonicalProductState, inventoryStateFingerprint },
  };
})();
