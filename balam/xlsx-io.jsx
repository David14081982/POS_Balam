// xlsx-io.jsx — Importar / exportar inventario en Excel (.xlsx) con SheetJS.
// Considera: Ornamento, Colores Orn., Cuello, Tela y 20 columnas de talla (10 letra + 10 número).
// Exporta window.XLSXIO
(function () {
  const D = window.DATA;
  const BASE = ['SKU', 'Modelo', 'Categoría', 'Manga', 'Tela', 'Color', 'No. Modelo', 'Ornamento', 'Colores Orn.', 'Cuello', 'Precio'];
  // Encabezados de talla. Letras tal cual; números prefijados "T" para no confundir con cantidades.
  const LETRA_H = D.SIZES_LETRA.slice();                  // XS, S, M, …
  const NUM_H = D.SIZES_NUM.map(n => 'T' + n);            // T34, T36, …
  const HEADERS = BASE.concat(LETRA_H, NUM_H);

  function ensureXLSX() {
    if (!window.XLSX) { window.UI.toast('No se pudo cargar el motor de Excel', 'var(--danger)'); return false; }
    return true;
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
    rows.push([], ['NOTAS']);
    rows.push(['• El SKU se arma como: Categoría-Manga-Tela-Color-NoModelo  (ej. 21-MC-ALG-BL-060)']);
    rows.push(['• Si dejas la columna SKU vacía, el sistema lo arma con las columnas de atributos.']);
    rows.push(['• Colores Orn.: códigos de hilo del bordado separados por coma (ej. OR, VI). Vacío si no lleva.']);
    rows.push(['• Cuello: usa un código de la tabla CUELLO (NOR, MAO, ITA, CER).']);
    rows.push(['• Tallas LETRA: columnas ' + D.SIZES_LETRA.join(', ') + '.']);
    rows.push(['• Tallas NÚMERO: columnas T34…T52 (la "T" es sólo para distinguirlas; captura la cantidad).']);
    rows.push(['• Una prenda puede llenar ambas escalas. Las tallas que no apliquen se dejan en 0 o vacías.']);
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
    };
    const byKey = {};
    p.stock.forEach(v => { byKey[v.escala + v.talla] = v.stock; });
    D.SIZES_LETRA.forEach((t, i) => { r[LETRA_H[i]] = byKey['L' + t] || 0; });
    D.SIZES_NUM.forEach((t, i) => { r[NUM_H[i]] = byKey['N' + t] || 0; });
    return r;
  }

  function colWidth(h) {
    if (h === 'Modelo') return 26;
    if (h === 'SKU') return 20;
    if (h === 'Ornamento' || h === 'Colores Orn.') return 18;
    if (h === 'Cuello' || h === 'Categoría') return 12;
    return 7;
  }

  function inventarioSheet(products) {
    const data = products.map(rowFromProduct);
    const ws = window.XLSX.utils.json_to_sheet(data, { header: HEADERS });
    ws['!cols'] = HEADERS.map(h => ({ wch: colWidth(h) }));
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
    const ws = window.XLSX.utils.json_to_sheet([ejemplo], { header: HEADERS });
    ws['!cols'] = HEADERS.map(h => ({ wch: colWidth(h) }));
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

  function buildProduct(row, idx) {
    const nombre = String(row['Modelo'] || '').trim();
    const skuRaw = String(row['SKU'] || '').trim().toUpperCase();
    if (!nombre || /ejemplo/i.test(nombre)) return null;

    let cat, manga, tela, color, modelo;
    const parts = skuRaw.split('-');
    if (parts.length === 5) {
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
    return D.hydrate({
      id: 'imp-' + Date.now() + '-' + idx,
      cat, manga, tela, color, modelo, nombre,
      orn: String(row['Ornamento'] || '—').trim() || '—',
      ornColors: parseOrnColors(row['Colores Orn.']),
      cuello: parseCuello(row['Cuello']),
      precio: num(row['Precio']),
      stock: D.mkStock(letras, nums),
      pop: false,
    });
  }

  // Lee archivo → Promise<{products, total, skipped}>
  function parseFile(file) {
    return new Promise((resolve, reject) => {
      if (!ensureXLSX()) return reject(new Error('Sin motor Excel'));
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const sheetName = wb.SheetNames.includes('Inventario') ? 'Inventario' : wb.SheetNames[0];
          const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
          const products = [];
          let skipped = 0;
          rows.forEach((r, i) => { const p = buildProduct(r, i); if (p) products.push(p); else skipped++; });
          resolve({ products, total: rows.length, skipped });
        } catch (err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsArrayBuffer(file);
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

  window.XLSXIO = { exportTemplate, exportInventory, exportReturns, exportSales, exportSellers, parseFile, HEADERS };
})();
