// inventory.jsx — Inventario (Balam). Exporta window.InventoryScreen
(function () {
  const { useState, useMemo, useRef, useEffect } = React;
  const { fmt, Modal, toast, Pager, Segment, resizeImageFile } = window.UI;
  const { MS, ProductImage } = window.HX;
  const D = window.DATA;
  const h = React.createElement;

  const tallaLabel = (product, talla) => {
    const hit = D.resolveProductSizes(product).sizes.find(s => String(s.value) === String(talla));
    return hit ? hit.label : talla;
  };
  const alignStock = (product, categoryId) => {
    const candidate = { ...product, sizeCategoryId: categoryId, attrs: { ...(product.attrs || {}), __sizeCategoryId: categoryId } };
    return D.resolveProductSizes(candidate).sizes.filter(size => size.active || size.stock > 0).map(size => {
      const old = (product.stock || []).find(v =>
        (!size.scale || v.escala === size.scale) && String(v.talla) === String(size.value));
      return { ...(old && old.id ? { id: old.id } : {}), talla: size.value, escala: size.scale, stock: old ? (Number(old.stock) || 0) : 0 };
    });
  };
  const CARD = 'bg-surface-container-lowest rounded-xl shadow-e1';
  const INPUT = 'w-full bg-surface border border-outline-variant rounded-lg px-3 h-11 text-body focus:ring-1 focus:ring-primary focus:border-primary transition-all';
  const SELECT = INPUT + ' appearance-none';
  const XLSBTN = 'flex items-center gap-2 px-3 py-1.5 border border-outline-variant rounded bg-surface hover:bg-surface-container text-overline uppercase transition-colors';
  const StockPill = ({ n }) => h(window.UI.StockBadge, { n });
  const commercialStock = p => p && p.isFamilyProjection ? p.totalStock : D.totalStock(p);
  const commercialKey = p => p && (p.commercialKey || p.id);
  // H-36: cuando el artículo tiene excepciones por talla, las listas y la ficha
  // anuncian el rango en vez de un precio que no aplicaría a todas las tallas.
  const precioTexto = (p) => {
    if (p && p.isFamilyProjection) {
      const uno = n => fmt(n).replace('.00', '');
      return p.singlePrice != null ? uno(p.singlePrice) : uno(p.priceMin) + ' – ' + uno(p.priceMax);
    }
    const r = D.priceRange(p);
    const uno = n => fmt(n).replace('.00', '');
    return r.unico ? uno(r.min) : uno(r.min) + ' – ' + uno(r.max);
  };
  // Muestras de color con semántica de forma:
  //   · tela  → ETIQUETA COLGANTE (hang tag): forma de etiqueta con punta y OJAL perforado,
  //     trama de tejido en CSS y sombra que sigue la silueta (drop-shadow, porque box-shadow
  //     no respeta clip-path). Al hover de la fila se balancea desde el ojal (transform-origin
  //     en el ojal + rotate), como una etiqueta colgada de su hilo.
  //   · hilo  → esferita con brillo tipo perla (un hilo enrollado es redondo).
  // Sin contorno duro: el drop-shadow de 0 desenfoque dibuja un filo sutil siguiendo la punta,
  // así los colores claros (blanco, hueso) no se pierden contra el fondo blanco.
  // La <tr> lleva la clase 'group'.
  const ColorDot = ({ hex, size = 18, title, tela }) => {
    // Luminosidad del color (0 oscuro → 1 claro): los CLAROS (blanco, hueso, plata) necesitan
    // más definición contra el fondo blanco — viñeteado de bordes, trama y filo más marcados.
    const lum = (() => {
      const m = String(hex || '').match(/^#([0-9a-f]{6})$/i);
      if (!m) return 0.5;
      const v = [0, 2, 4].map(i => parseInt(m[1].substr(i, 2), 16) / 255);
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    })();
    const light = lum > 0.72;
    if (tela) {
      // Vertical: punta y ojal ARRIBA (cuelga de su hilo). Dos capas de transform que no se
      // pisan: el span EXTERIOR lleva el hover (giro+escala con transición) y el INTERIOR el
      // balanceo continuo .tag-float (keyframes en el <style> del shell), ambos con el punto
      // de giro en el ojal. El delay negativo (derivado del hex) desincroniza cada etiqueta.
      const hgt = Math.round(size * 1.25), hole = hgt * 0.075, ring = hgt * 0.14;
      const delay = -((parseInt(String(hex || '').replace('#', '').slice(0, 2), 16) || 0) % 9) * 0.4;
      return h('span', {
        title,
        className: 'inline-block shrink-0 transition-transform duration-200 group-hover:rotate-12 group-hover:scale-110',
        style: { width: size, height: hgt, transformOrigin: '50% 13%' },
      }, h('span', {
        className: 'tag-float block w-full h-full',
        style: {
          animationDelay: delay + 's',
          transformOrigin: '50% 13%',
          clipPath: 'polygon(50% 0, 100% 22%, 100% 100%, 0 100%, 0 22%)',
          background: `radial-gradient(circle at 50% 13%, rgba(255,255,255,.95) 0 ${hole}px, rgba(15,23,42,${light ? '.5' : '.38'}) ${hole}px ${ring}px, rgba(0,0,0,0) ${ring}px),
            radial-gradient(130% 130% at 50% 42%, rgba(0,0,0,0) ${light ? '55%' : '78%'}, rgba(15,23,42,${light ? '.16' : '.08'}) 100%),
            linear-gradient(160deg, rgba(255,255,255,.30), rgba(255,255,255,0) 55%),
            repeating-linear-gradient(45deg, rgba(255,255,255,.12) 0 1px, rgba(255,255,255,0) 1px 3px),
            repeating-linear-gradient(-45deg, rgba(15,23,42,${light ? '.16' : '.10'}) 0 1px, rgba(15,23,42,0) 1px 3px),
            ${hex || '#8b9099'}`,
          filter: light
            ? 'drop-shadow(0 0 1px rgba(15,23,42,.55)) drop-shadow(0 2px 3px rgba(15,23,42,.32)) drop-shadow(0 1px 1px rgba(15,23,42,.16))'
            : 'drop-shadow(0 0 .6px rgba(15,23,42,.45)) drop-shadow(0 2px 3px rgba(15,23,42,.28)) drop-shadow(0 1px 1px rgba(15,23,42,.14))',
        },
      }));
    }
    return h('span', {
      title,
      className: 'inline-block rounded-full shrink-0 transition-transform duration-200 group-hover:scale-110',
      style: {
        width: size, height: size,
        background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,.45), rgba(255,255,255,0) 58%),
          radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${light ? '52%' : '75%'}, rgba(15,23,42,${light ? '.18' : '.08'}) 100%),
          ${hex || '#8b9099'}`,
        boxShadow: size >= 14
          ? `0 2px 6px rgba(15,23,42,.30), 0 1px 2px rgba(15,23,42,.18), inset 0 0 0 1px rgba(15,23,42,${light ? '.22' : '.06'})`
          : `0 1px 3px rgba(15,23,42,.30), inset 0 0 0 1px rgba(15,23,42,${light ? '.22' : '.06'})`,
      },
    });
  };

  function InventoryScreen() {
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState({}); // { [kind]: code|'all' } — catálogos "Filtrables"
    const [stockFilter, setStockFilter] = useState('all');
    const [detail, setDetail] = useState(null);
    const [editing, setEditing] = useState(null);
    const [products, setProducts] = useState(() => D.products.slice());
    const [importPreview, setImportPreview] = useState(null);
    const [importResolutions, setImportResolutions] = useState({});
    const [labelTargets, setLabelTargets] = useState(null); // productos para imprimir etiquetas
    window.UI.useSyncActivity(!!(editing || importPreview), ['products', 'config', 'promotions'], { screen: 'inventory' });
    const [page, setPage] = useState(1);
    const fileRef = useRef(null);
    const [mobileTable, setMobileTable] = useState(() => window.matchMedia('(max-width: 767px)').matches);
    useEffect(() => {
      const media = window.matchMedia('(max-width: 767px)');
      const onChange = event => setMobileTable(event.matches);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }, []);

    function refresh() { setProducts(D.products.slice()); }
    // El pull de la nube reemplaza D.products DESPUÉS de montar esta pantalla (y un import
    // de catálogos también lo muta); sin esto los KPIs y la tabla se quedaban con la copia
    // vieja hasta cambiar de pestaña. 'configchange' se dispara al terminar el pull.
    useEffect(() => {
      const onCfg = () => setProducts(D.products.slice());
      window.addEventListener('configchange', onCfg);
      return () => window.removeEventListener('configchange', onCfg);
    }, []);

    function onPickFile(e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      window.XLSXIO.parseFile(file)
        .then(res => {
          if (!res.products.length) { toast('El archivo no contiene productos para importar', 'var(--danger)'); return; }
          setImportResolutions({}); setImportPreview(res);
        })
        // Los errores propios del lector (etiquetas duplicadas, archivo sin la hoja
        // «Catálogos») traen un mensaje que el dueño puede accionar: se muestra tal cual.
        .catch(err => toast((err && err.balam && err.message) || 'No se pudo leer el archivo Excel', 'var(--danger)'));
    }
    // H-86: la vista previa es un plan completo. Ninguna fila toca DATA mientras
    // exista un conflicto y la actualización localiza por el ID técnico exportado.
    function confirmImport() {
      const plan = window.XLSXIO.planImport(importPreview, D.products, importResolutions);
      if (!plan.ok) {
        toast(`Importación bloqueada: ${plan.conflicts.length} conflicto(s). No se modificó el inventario.`, 'var(--danger)');
        return;
      }
      const backup = D.products.map(product => JSON.parse(JSON.stringify(product)));
      try {
        const result = window.XLSXIO.applyImportPlan(plan, D.products);
        D.saveProducts(result.productIds); refresh();
        setImportPreview(null); setImportResolutions({});
        toast(`${result.nuevos} nuevos · ${result.actualizados} actualizados`, 'var(--accent)');
      } catch (error) {
        D.products.splice(0, D.products.length, ...backup); refresh();
        toast((error && error.balam && error.message) || 'No se pudo aplicar la importación; no se modificó el inventario', 'var(--danger)');
      }
    }
    function saveProduct(draft, mode, options) {
      if (Array.isArray(draft)) {
        const backup = D.products.map(row => JSON.parse(JSON.stringify(row)));
        const saved = [];
        try {
          draft.forEach(rawCandidate => {
            const candidate = { ...rawCandidate };
            delete candidate.rowKey; delete candidate.selectedForCreation;
            const current = D.products.find(row => row.id === candidate.id);
            if (current) saved.push(D.updateReference(candidate));
            else { const created = D.createReference(candidate, D.products); D.products.push(created); saved.push(created); }
          });
          D.persistProducts();
          if (window.STORE && typeof window.STORE.pushProductFamilyBatch === 'function') {
            window.STORE.pushProductFamilyBatch(saved[0].referenceFamilyId, saved);
          } else D.syncProducts(saved.map(row => row.id));
        } catch (error) {
          D.products.splice(0, D.products.length, ...backup.map(row => D.hydrate(row)));
          D.persistProducts();
          toast((error && error.message) || 'No se pudo guardar la familia; no se aplicaron cambios', 'var(--danger)');
          return;
        }
        refresh(); setEditing(null); setDetail(null);
        toast(`${saved.length} referencias guardadas`, 'var(--accent)');
        if (options && options.openLabels) setLabelTargets(saved);
        return;
      }
      let saved = draft;
      try {
        if (mode === 'edit') saved = D.updateReference && D.isV2Reference(draft)
          ? D.updateReference(draft)
          : (() => { const target = D.products.find(p => p.id === draft.id); if (target) { Object.assign(target, draft); D.hydrate(target); } return target || draft; })();
        else {
          const p = D.createReference(draft, D.products);
          D.products.push(p); saved = p;
        }
      } catch (error) {
        toast((error && error.message) || 'No se pudo guardar la referencia', 'var(--danger)'); return;
      }
      D.saveProducts([saved.id]); refresh();
      setEditing(null); setDetail(null);
      toast(mode === 'edit' ? 'Producto actualizado' : 'Producto agregado al inventario', 'var(--accent)');
      if ((saved.referenceWarnings || []).some(w => w.code === 'SKU_DUPLICATE_WARNING')) {
        toast('Advertencia: referencias físicas distintas comparten el mismo SKU visible.', 'var(--warning)');
      }
      if (options && options.openLabels) setLabelTargets([saved]);
    }
    function deleteProduct(p) {
      if (!D.removeProduct(p.id)) {
        toast('El producto tiene una liquidación pendiente; espera su confirmación', 'var(--danger)');
        return;
      }
      refresh();
      setDetail(null);
      toast('Producto eliminado', 'var(--danger)');
    }

    const lowThreshold = window.CONFIG.get('stock.lowThreshold') || 4;
    // Catálogos marcados como "Filtrables" (Configuración). Por defecto Material y Color Tela.
    const filterableKinds = Object.keys(window.CONFIG.allCatalogMeta ? window.CONFIG.allCatalogMeta() : {})
      .filter(k => { const m = window.CONFIG.catalogMeta(k); return m && m.filterable; });
    const rows = useMemo(() => {
      const q = query.trim().toLowerCase();
      return D.commercialProducts(products).filter(p => {
        const candidates = p.isFamilyProjection ? p.references : [p];
        for (let i = 0; i < filterableKinds.length; i++) {
          const fk = filterableKinds[i], selv = filters[fk];
          if (!selv || selv === 'all') continue;
          const m = window.CONFIG.catalogMeta(fk);
          if (!candidates.some(row => String(m.custom ? (row.attrs || {})[fk] : row[m.field]) === String(selv))) return false;
        }
        const total = commercialStock(p);
        if (stockFilter === 'low' && total > lowThreshold) return false;
        if (stockFilter === 'out' && total !== 0) return false;
        if (!q) return true;
        return p.isFamilyProjection ? p.searchText.includes(q)
          : p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.colorName.toLowerCase().includes(q);
      });
    }, [query, filters, stockFilter, products]);
    const PER = 10, pages = Math.max(1, Math.ceil(rows.length / PER)), pg = Math.min(page, pages);
    const slice = rows.slice((pg - 1) * PER, pg * PER);

    // Filtros por catálogo (Tela, Color…) como desplegables + el botón "Limpiar". Se arman aquí
    // para poder colocarlos en la MISMA fila del buscador. El estado `filters` no cambia de forma
    // → la lógica de filtrado de `rows` sigue igual.
    const catalogFilters = filterableKinds.map(fk => {
      const val = filters[fk] || 'all';
      const activo = val !== 'all';
      const items = window.CONFIG.list(fk);
      const opts = [h('option', { key: '__all', value: 'all' }, 'Todas')]
        .concat(items.map(it => h('option', { key: it.code, value: it.code }, it.label)));
      // Valor huérfano (se filtró por un código que luego se borró/desactivó del catálogo): sin
      // esta opción el desplegable mostraría "Todas" mientras el filtro sigue activo y la lista
      // aparecería vacía sin explicación.
      if (activo && !items.some(it => it.code === val)) {
        opts.splice(1, 0, h('option', { key: '__orphan', value: val }, `⚠ ${val} — ya no existe`));
      }
      return h('div', { key: 'f_' + fk, className: 'flex flex-col gap-1' }, [
        h('label', { key: 'l', className: 'text-overline font-bold uppercase tracking-widest text-on-surface-variant' }, window.CONFIG.catalogLabel(fk)),
        h('select', {
          key: 's',
          'data-testid': 'inventory-catalog-filter-' + fk,
          className: 'min-w-[9.5rem] max-w-[14rem] bg-surface border rounded-lg px-3 py-2.5 text-body transition-all focus:ring-1 focus:ring-primary focus:border-primary '
            + (activo ? 'border-gold text-primary font-semibold' : 'border-outline-variant'),
          value: val,
          onChange: e => { setFilters(prev => Object.assign({}, prev, { [fk]: e.target.value })); setPage(1); },
        }, opts),
      ]);
    }).concat(Object.keys(filters).some(k => filters[k] && filters[k] !== 'all')
      ? [h('button', {
        key: '__clr',
        'data-testid': 'inventory-catalog-filters-clear',
        className: 'h-11 px-4 inline-flex items-center gap-2 text-caption font-bold uppercase tracking-widest text-on-surface-variant border border-outline-variant rounded-lg hover:text-primary hover:bg-surface-container transition-colors',
        onClick: () => { setFilters({}); setPage(1); },
      }, [h(MS, { key: 'i', name: 'close', size: 16 }), 'Limpiar'])]
      : []);

    // Los KPIs se calculan sobre `rows` (lo FILTRADO), no sobre el inventario completo. Antes
    // usaban `products`: al filtrar por una tela, arriba seguía diciendo 242 y el pie de la
    // tabla 37 — la misma pantalla mostraba dos cifras distintas y se prestaba a leer mal.
    const lowCount = rows.filter(p => { const t = commercialStock(p); return t > 0 && t <= lowThreshold; }).length;
    const totalUnidades = rows.reduce((a, p) => a + commercialStock(p), 0);
    const valorInventario = rows.reduce((a, p) => a + (p.isFamilyProjection ? p.references : [p]).reduce((sum, ref) => sum
      + D.resolveProductSizes(ref).sizes.reduce((b, size) => b + (Number(size.stock) || 0) * D.listPrice(ref, size.value), 0), 0), 0);

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'w-full min-w-0 px-4 py-6 sm:px-6 lg:p-10 max-w-container-max mx-auto' }, [
        // KPIs
        h('div', { key: 'kpi', className: 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-gutter mb-8' }, [
          kpi('Productos / familias', rows.length),
          kpi('Unidades en stock', totalUnidades),
          kpi('Stock bajo', lowCount, true),
          kpi('Valor inventario', fmt(valorInventario).replace('.00', ''), false, 'MXN'),
        ]),
        // Filtros + acciones. UNA sola fila: buscador, Todo/Bajo/Agotados y los desplegables de
        // catálogo. Antes los de catálogo ocupaban un renglón aparte, una banda más antes de la
        // tabla. items-end alinea por abajo los controles con etiqueta (los desplegables) con los
        // que no la llevan (buscador y segmento); flex-wrap los acomoda solos si no caben.
        h('div', { key: 'fl', className: 'flex flex-col gap-4 mb-6' }, [
          h('div', { key: 'r1', className: 'flex items-end justify-between gap-4 flex-wrap' }, [
            h('div', { key: 'l', className: 'flex items-end gap-3 flex-wrap' }, [
              h('div', { key: 's', className: 'relative w-full sm:w-72 min-w-0' }, [
                h('span', { key: 'i', className: 'absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50' }, h(MS, { name: 'search', size: 20 })),
                h('input', { key: 'in', className: 'w-full bg-surface border border-outline-variant rounded-lg pl-10 pr-4 py-2.5 text-body focus:ring-1 focus:ring-primary focus:border-primary transition-all', placeholder: 'Buscar SKU, modelo o color…', value: query, onChange: e => { setQuery(e.target.value); setPage(1); } }),
              ]),
              h(Segment, { key: 'sg2', value: stockFilter, onChange: v => { setStockFilter(v); setPage(1); }, options: [['all', 'Todo'], ['low', 'Bajo'], ['out', 'Agotados']] }),
            ].concat(catalogFilters)),
            h('button', { key: 'add', 'data-testid': 'inventory-new-product', className: 'flex items-center gap-2 px-6 py-2.5 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-all text-overline font-bold uppercase tracking-wider shadow-e2', onClick: () => setEditing({ mode: 'new', product: blankProduct() }) }, [h(MS, { key: 'i', name: 'plus', size: 18 }), 'Nuevo producto']),
          ]),
          // Excel
          h('div', { key: 'r2', className: 'flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 py-3 border-y border-outline-variant/60 min-w-0' }, [
            h('span', { key: 'l', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-widest flex items-center gap-2' }, [h(MS, { key: 'i', name: 'box', size: 18 }), 'Excel:']),
            h('input', { key: 'f', ref: fileRef, type: 'file', accept: '.xlsx,.xls,.csv', className: 'hidden', onChange: onPickFile }),
            h('div', { key: 'b', className: 'flex flex-wrap gap-2 min-w-0' }, [
              h('button', { key: 't', className: XLSBTN, onClick: () => window.XLSXIO.exportTemplate() }, [h(MS, { key: 'i', name: 'download', size: 16 }), 'Plantilla']),
              h('button', { key: 'i', className: XLSBTN, onClick: () => fileRef.current && fileRef.current.click() }, [h(MS, { key: 'i', name: 'upload', size: 16 }), 'Importar']),
              h('button', { key: 'e', className: XLSBTN, onClick: () => window.XLSXIO.exportInventory(products) }, [h(MS, { key: 'i', name: 'file_export', size: 16 }), 'Exportar']),
              h('button', { key: 'bc', 'data-testid': 'inventory-labels', className: XLSBTN, onClick: () => { if (!rows.length) { toast('No hay productos para etiquetar', 'var(--danger)'); return; } setLabelTargets(rows.flatMap(row => row.isFamilyProjection ? row.references : [row])); }, title: 'Imprimir etiquetas de los productos filtrados' }, [h(MS, { key: 'i', name: 'barcode', size: 16 }), 'Etiquetas']),
            ]),
          ]),
        ]),
        // Tabla
        h('div', { key: 'tbl', className: CARD + ' overflow-hidden shadow-e1' }, [
          mobileTable && h('div', { key: 'mobile', className: 'divide-y divide-outline-variant' }, slice.map(p => {
            const total = commercialStock(p);
            return h('button', { key: commercialKey(p), 'data-testid': 'inventory-product-' + commercialKey(p), className: 'w-full min-h-11 p-4 text-left hover:bg-surface-container transition-colors', onClick: () => setDetail(p), 'aria-label': `Abrir ${p.nombre}` }, [
              h('div', { key: 'top', className: 'flex items-start gap-3 min-w-0' }, [
                h(ProductImage, { key: 'i', p, className: 'w-12 h-14 rounded shadow-e1 border border-outline-variant shrink-0' }),
                h('div', { key: 'copy', className: 'flex-1 min-w-0' }, [
                  h('div', { key: 'name', className: 'font-bold text-body text-primary whitespace-normal [overflow-wrap:anywhere]' }, p.nombre),
                  h('div', { key: 'sku', 'data-testid': 'inventory-sku-mobile', className: 'mt-1 text-overline font-mono text-on-surface-variant [overflow-wrap:anywhere]' }, p.isFamilyProjection ? `${p.referenceCount} referencias · ${D.familyVisualSku(p)}` : p.sku),
                  h('div', { key: 'meta', className: 'mt-2 flex flex-wrap items-center gap-2' }, [h(StockPill, { key: 'stock', n: total }), h('span', { key: 'price', className: 'font-headline text-body text-primary' }, precioTexto(p))]),
                ]),
                h(MS, { key: 'next', name: 'chevRight', size: 20, className: 'shrink-0 text-on-surface-variant' }),
              ]),
            ]);
          })),
          !mobileTable && h('div', { key: 'sc', className: 'overflow-x-auto', 'data-horizontal-scroll': 'inventory-table', tabIndex: 0, role: 'region', 'aria-label': 'Tabla completa de inventario' }, h('table', { className: 'w-full text-left border-collapse' }, [
            h('thead', { key: 'h' }, h('tr', { className: 'bg-surface-container/50 border-b border-outline-variant' },
              ['Producto', 'SKU', 'Atributos', 'Color / Orn.', 'Precio', 'Stock', ''].map((c, i) =>
                h('th', { key: i, className: 'px-4 py-4 text-overline uppercase tracking-wider font-semibold text-on-surface-variant/80' + (i === 0 ? ' pl-6' : '') }, c)))),
            h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, slice.map(p => {
              const total = commercialStock(p);
              return h('tr', { key: commercialKey(p), 'data-testid': 'inventory-product-' + commercialKey(p), className: 'hover:bg-surface-container transition-all group cursor-pointer', onClick: () => setDetail(p) }, [
                h('td', { key: 'n', className: 'px-6 py-4' }, h('div', { className: 'flex items-center gap-4' }, [
                  h(ProductImage, { key: 'i', p, className: 'w-12 h-14 rounded shadow-e1 border border-outline-variant shrink-0' }),
                  h('span', { key: 'x', className: 'font-bold text-body text-primary' }, p.nombre),
                ])),
                h('td', { key: 's', className: 'px-4 py-4' }, h('span', { 'data-testid': 'inventory-sku-desktop', className: 'text-overline font-mono text-on-surface-variant' }, p.isFamilyProjection ? D.familyVisualSku(p) : p.sku)),
                h('td', { key: 'a', className: 'px-4 py-4' }, h('div', { className: 'flex flex-wrap gap-1.5' },
                  [(D.MANGA[p.manga] || p.manga || '—').replace('Manga ', 'M. '), p.orn, D.CUELLO[p.cuello] || p.cuello].map((t, i) => h('span', { key: i, className: 'px-2 py-0.5 bg-surface-container-high rounded text-overline font-bold uppercase text-on-surface-variant' }, t)))),
                h('td', { key: 'c', className: 'px-4 py-4' }, h('div', { className: 'flex flex-col gap-1.5' }, [
                  h('div', { key: 'm', className: 'flex items-center gap-2.5' }, [
                    h(ColorDot, { key: 'sw', hex: p.colorHex, size: 20, title: p.colorName, tela: true }),
                    h('span', { key: 'n', className: 'text-overline font-medium text-on-surface-variant' }, p.colorName),
                  ]),
                  p.ornColors && p.ornColors.length ? h('div', { key: 'o', className: 'flex items-center gap-1.5', style: { marginLeft: 30 } },
                    p.ornColors.map(c => { const item = window.CONFIG.find(D.isV2Reference(p) ? 'ornament_color' : 'color', c); return h(ColorDot, { key: c, hex: (item && item.meta && item.meta.hex) || D.COLOR_HEX[c], size: 10, title: (item && item.label) || D.COLOR_NAME[c] || c }); })) : null,
                ])),
                h('td', { key: 'p', className: 'px-4 py-4' }, h('span', { className: 'font-headline text-base text-primary' }, precioTexto(p))),
                h('td', { key: 'st', className: 'px-4 py-4' }, h(StockPill, { n: total })),
                h('td', { key: 'x', className: 'px-6 py-4 text-right' }, h(MS, { name: 'chevRight', size: 20, className: 'text-on-surface-variant/40 group-hover:text-primary transition-colors' })),
              ]);
            })),
          ])),
          // Footer
          h('div', { key: 'pg', className: 'px-6 py-4 border-t border-outline-variant flex items-center justify-between bg-surface-container/30' }, [
            h('span', { key: 'l', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-widest' }, `${rows.length} producto${rows.length === 1 ? '' : 's'}${pages > 1 ? ` · página ${pg}/${pages}` : ''}`),
            h(Pager, { key: 'p', page: pg, pages, onPage: setPage }),
          ]),
        ]),
        // Drawer detalle (siempre montado, slide-in)
        h(DetailDrawer, { key: 'dr', p: detail, onClose: () => setDetail(null), onEdit: () => setEditing({ mode: 'edit', product: detail }), onDelete: () => deleteProduct(detail), onLabels: (prod) => setLabelTargets(prod.isFamilyProjection ? prod.references.slice() : [prod]) }),
        labelTargets && h(LabelModal, { key: 'lbl', products: labelTargets, onClose: () => setLabelTargets(null) }),
        editing && h(ProductForm, { key: 'f-' + editing.mode + '-' + (editing.product.id || 'new'), mode: editing.mode, product: editing.product, onClose: () => setEditing(null), onSave: saveProduct }),
        importPreview && h(ImportModal, {
          key: 'imp', data: importPreview,
          plan: window.XLSXIO.planImport(importPreview, D.products, importResolutions),
          onResolve: (rowKey, productId) => setImportResolutions(current => Object.assign({}, current, { [rowKey]: productId })),
          onClose: () => { setImportPreview(null); setImportResolutions({}); }, onConfirm: confirmImport,
        }),
      ]));
  }

  function kpi(label, value, gold, suffix) {
    return h(window.UI.KPI, { key: label, label, value, unit: suffix, tone: gold ? 'gold' : 'neutral', className: gold ? 'border-l-4 border-l-secondary' : '' });
  }

  function blankProduct() {
    // Los catálogos custom empiezan sin selección. Autorrellenar el primer valor
    // convertiría Características en obligatorio y crearía identidad física sin
    // una decisión de la empleada.
    const attrs = {};
    const meta = window.CONFIG.allCatalogMeta ? window.CONFIG.allCatalogMeta() : {};
    Object.keys(meta).forEach(k => {
      if (meta[k].custom && (meta[k].inForm || meta[k].inSku || meta[k].inReference)) attrs[k] = '';
    });
    // Defaults de los catálogos del sistema: primer elemento ACTIVO del catálogo (el admin los
    // edita). Los códigos históricos ('21', 'ML', …) quedan solo como respaldo si está vacío —
    // un default fósil que ya no existe en el catálogo produce SKUs y atributos huérfanos.
    const first = (kind, fb) => { const l = window.CONFIG.list(kind); return l.length ? l[0].code : fb; };
    const sizeCategoryId = ((window.CONFIG.sizeCategories && window.CONFIG.sizeCategories()[0]) || {}).id || 'size_letter';
    attrs.__sizeCategoryId = sizeCategoryId;
    const sizeItem = (window.CONFIG.list(sizeCategoryId)[0] || {});
    const sizeCode = Object.prototype.hasOwnProperty.call(sizeItem.meta || {}, 'value') ? sizeItem.meta.value : sizeItem.code;
    const sizeScale = ((window.CONFIG.sizeCategories().find(item => item.id === sizeCategoryId) || {}).scale) || '';
    const base = { recordModel: 'v2', cat: first('category', '21'), manga: first('sleeve', 'ML'), tela: first('fabric', 'ALG'), color: first('color', 'BL'), modelo: '', nombre: '', orn: '—', ornColors: [], ornamentColorCodes: [], cuello: first('neck', 'NOR'), precio: 0, stockQuantity: 0, sizeCode: String(sizeCode || ''), sizeScale, stock: [], pop: false, attrs, sizeCategoryId };
    base.stock = [{ talla: base.sizeCode, escala: sizeScale, stock: 0 }];
    return base;
  }

  // ---------- Drawer de detalle ----------
  function DetailDrawer({ p, onClose, onEdit, onDelete, onLabels }) {
    const open = !!p;
    const sizeResolution = p && !p.isFamilyProjection ? D.resolveProductSizes(p) : null;
    const resolvedSizes = p && p.isFamilyProjection ? p.sizeGroups.map(size => {
      const references = size.references.filter(ref => ref.active !== false && Number(ref.stockQuantity) > 0);
      return { ...size, references, hasMultipleReferences: size.references.length > 1,
        stock: references.reduce((sum, ref) => sum + Number(ref.stockQuantity), 0) };
    }).filter(size => size.stock > 0) : sizeResolution
      ? sizeResolution.sizes.filter(s => s.active && s.stock > 0)
      : [];
    return h(React.Fragment, {}, [
      h('div', { key: 'ov', className: 'fixed inset-0 bg-primary-container/40 backdrop-blur-sm z-[55] transition-opacity duration-300 ' + (open ? 'opacity-100' : 'opacity-0 pointer-events-none'), onClick: onClose }),
      h('div', { key: 'dr', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Detalle del producto', className: 'fixed inset-0 sm:inset-y-0 sm:left-auto sm:right-0 w-full sm:w-[460px] max-w-full bg-surface border-l border-outline-variant z-[60] shadow-e3 flex flex-col transition-transform duration-300 ' + (open ? 'translate-x-0' : 'translate-x-full') },
        p && [
          h('div', { key: 'h', className: 'px-8 py-6 border-b border-outline-variant flex justify-between items-center' }, [
            h('div', { key: 't' }, [
              h('p', { key: 'a', className: 'text-overline uppercase font-bold text-on-surface-variant tracking-widest opacity-60' }, 'Detalle de producto'),
              h('h2', { key: 'b', className: 'text-h1 font-headline text-primary mt-1' }, p.nombre),
            ]),
            h('button', { key: 'x', 'data-testid': 'product-detail-close', 'aria-label': 'Cerrar detalle', className: 'p-2 hover:bg-surface-container rounded-full transition-colors', onClick: onClose }, h(MS, { name: 'close', size: 22, className: 'text-on-surface-variant' })),
          ]),
          h('div', { key: 'c', className: 'flex-grow overflow-y-auto' }, [
            h('div', { key: 'img', className: 'aspect-[4/3] bg-surface-container relative overflow-hidden' }, h(ProductImage, { p, className: 'w-full h-full' })),
            h('div', { key: 'b', className: 'p-8 space-y-8' }, [
              // SKU + precio
              h('div', { key: 'g', className: 'grid grid-cols-2 gap-8' }, [
                drawerField('SKU', h('span', { className: 'font-mono text-body text-primary' }, p.isFamilyProjection ? p.skuLabel : p.sku)),
                drawerField('Precio (MXN)', h('span', { className: 'font-headline text-h2 text-primary' }, precioTexto(p))),
              ]),
              // Atributos
              h('div', { key: 'at', className: 'space-y-4' }, [
                h('h3', { key: 't', className: 'text-overline font-bold uppercase text-primary tracking-widest border-b border-outline-variant pb-3' }, 'Atributos'),
                h('div', { key: 'gr', className: 'grid grid-cols-2 gap-4' }, [
                  drawerInfo('Categoría', D.CAT[p.cat]), drawerInfo('Manga', D.MANGA[p.manga]),
                  drawerInfo('Material', D.TELA[p.tela]), drawerInfo('Cuello', D.CUELLO[p.cuello]),
                  drawerInfo('Color Tela', p.colorName, p.colorHex), drawerInfo('Ornamento', p.orn),
                ]),
              ]),
              // Stock por talla
               h('div', { key: 'stk', className: 'space-y-3' }, [
                 h('h3', { key: 't', className: 'text-overline font-bold uppercase text-primary tracking-widest border-b border-outline-variant pb-3' }, 'Existencias por talla'),
                 sizeResolution && sizeResolution.requiresAssignment && h('div', {
                   key: 'warn',
                   className: 'p-3 rounded-lg bg-warning-soft text-warning text-caption',
                 }, sizeResolution.ambiguous
                   ? 'El producto conserva existencias en más de una categoría. Edítalo y elige una categoría antes de venderlo.'
                   : 'El producto no tiene una categoría por talla asignada. Edítalo para completar la relación.'),
                   h('div', { key: 'g', className: 'flex flex-wrap gap-2', 'data-testid': 'product-detail-size-stock' }, resolvedSizes.length ? resolvedSizes.map(size =>
                    h('div', { key: size.key || size.sizeId, className: 'flex flex-col items-center min-w-[48px] px-2 py-1.5 border border-outline-variant rounded', 'data-testid': 'product-detail-size-chip', 'data-size-code': size.label }, [
                      h('span', { key: 't', className: 'text-caption font-semibold text-primary' }, size.label),
                      h('span', { key: 's', className: 'text-overline text-on-surface-variant' }, size.stock + ' pz'),
                      p.isFamilyProjection && size.hasMultipleReferences ? h('div', { key: 'variants', className: 'mt-1 pt-1 border-t border-outline-variant space-y-0.5', 'data-testid': 'product-detail-size-variants' }, size.references.map(ref =>
                        h('div', { key: ref.id, className: 'flex items-center justify-between gap-2 text-overline text-on-surface-variant' }, [
                          h('span', { key: 'v' }, D.canonicalReferenceOrnamentColors(ref.ornamentColorCodes || []).join(' + ') || ref.sku),
                          h('span', { key: 'n', className: 'whitespace-nowrap' }, ref.stockQuantity + ' pz · ' + precioTexto(ref)),
                        ]))) : null,
                    ])) : h('p', { key: 'empty', className: 'text-caption text-on-surface-variant', 'data-testid': 'product-detail-size-empty' }, 'Sin existencias en ninguna talla.')),
              ]),
              // Acciones
              h('div', { key: 'ac', className: 'pt-4 space-y-3' }, [
                h('button', { key: 'lb', 'data-testid': 'product-detail-labels', className: 'w-full py-3 rounded-xl border border-outline-variant text-primary hover:border-primary hover:bg-surface-container transition-all flex items-center justify-center gap-2 text-overline font-bold uppercase tracking-widest', onClick: () => onLabels && onLabels(p) }, [h(MS, { key: 'i', name: 'barcode', size: 18 }), 'Imprimir etiqueta']),
                h('div', { key: 'row', className: 'flex gap-4' }, [
                  h('button', { key: 'e', 'data-testid': 'product-detail-edit', className: 'flex-grow bg-primary text-on-primary py-3.5 rounded-xl text-overline font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-e2 active:scale-95 flex items-center justify-center gap-2', onClick: onEdit }, [h(MS, { key: 'i', name: 'edit', size: 18 }), 'Editar producto']),
                  !p.isFamilyProjection && h('button', { key: 'd', className: 'w-14 h-[52px] rounded-xl border border-outline-variant text-danger hover:bg-danger-soft hover:border-danger/30 transition-all flex items-center justify-center', onClick: onDelete, title: 'Eliminar' }, h(MS, { name: 'trash', size: 20 })),
                ]),
              ]),
            ]),
          ]),
        ]),
    ]);
  }

  function drawerField(label, control) {
    return h('div', { key: label, className: 'space-y-2' }, [
      h('label', { key: 'l', className: 'block text-overline uppercase font-bold text-on-surface-variant tracking-widest opacity-60' }, label),
      h('div', { key: 'c', className: 'border-b border-outline-variant py-2' }, control),
    ]);
  }
  function drawerInfo(label, value, hex) {
    return h('div', { key: label, className: 'bg-surface-container/50 p-3 rounded-xl border border-outline-variant' }, [
      h('span', { key: 'l', className: 'block text-overline uppercase font-bold text-on-surface-variant tracking-widest opacity-60 mb-1.5' }, label),
      h('span', { key: 'v', className: 'flex items-center gap-2 text-caption font-bold text-primary' }, [
        hex && h(ColorDot, { key: 's', hex, size: 16, tela: true }), value,
      ]),
    ]);
  }

  // ---------- Previsualización de importación ----------
  function ImportModal({ data, plan, onClose, onConfirm, onResolve }) {
    const stockTotal = state => state && Array.isArray(state.stock)
      ? state.stock.reduce((sum, item) => sum + (Number(item.stock) || 0), 0) : 0;
    const priceSummary = state => {
      if (!state) return '—';
      const specials = Object.keys(state.preciosTalla || {}).length;
      return fmt(state.precio).replace('.00', '') + (specials ? ` + ${specials} especial(es)` : '');
    };
    const footer = [
      h('button', { key: 'c', className: 'px-5 h-11 border border-outline-variant text-on-surface text-caption font-bold uppercase tracking-widest hover:bg-surface-container rounded-lg transition-colors', onClick: onClose }, 'Cancelar'),
      h('button', { key: 'k', 'data-testid': 'inventory-import-confirm', disabled: !plan.ok, className: 'inline-flex items-center gap-2 px-5 h-11 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed', onClick: onConfirm }, [h(MS, { key: 'i', name: plan.ok ? 'check' : 'block', size: 16 }), plan.ok ? `Importar ${plan.rows.length}` : 'Importación bloqueada']),
    ];
    return h(Modal, { title: 'Previsualizar importación', onClose, footer, large: true }, [
      h('div', { key: 'sum', className: 'flex items-center gap-2 mb-4 flex-wrap text-caption' }, [
        plan.creates > 0 && h('span', { key: 'n', 'data-testid': 'inventory-import-creates', className: 'px-2 py-1 bg-success-soft text-success font-bold rounded' }, `${plan.creates} altas`),
        plan.updates > 0 && h('span', { key: 'u', 'data-testid': 'inventory-import-updates', className: 'px-2 py-1 bg-gold-soft text-gold-text font-bold rounded' }, `${plan.updates} actualizaciones`),
        plan.conflicts.length > 0 && h('span', { key: 'x', 'data-testid': 'inventory-import-conflicts', className: 'px-2 py-1 bg-danger-soft text-danger font-bold rounded' }, `${plan.conflicts.length} conflictos`),
        data.skipped > 0 && h('span', { key: 'b', className: 'px-2 py-1 bg-warning-soft text-warning font-bold rounded' }, `${data.skipped} omitidos`),
        h('span', { key: 'c', className: 'text-on-surface-variant' }, `${data.total} filas leídas · ${data.schema === 'current' ? 'Esquema BALAM v' + data.metadata.schema_version : 'Archivo heredado'}`),
      ]),
      ...(plan.warnings || []).map((warning, index) => h('p', { key: 'w' + index, role: 'status', className: 'text-caption text-warning mb-2 p-2 rounded bg-warning-soft' }, warning)),
      plan.conflicts.length > 0 && h('p', { key: 'blocked', role: 'alert', className: 'text-caption font-semibold text-danger mb-3' }, 'Todo-o-nada: mientras exista un conflicto no se aplicará ninguna fila.'),
      h('div', { key: 'tbl', className: 'border border-outline-variant rounded-lg overflow-hidden max-h-80 overflow-y-auto' },
        h('table', { className: 'w-full' }, [
          h('thead', { key: 'h', className: 'sticky top-0 bg-surface' }, h('tr', { className: 'border-b border-outline-variant' },
            ['Acción', 'Producto / SKU', 'Stock antes → después', 'Precios antes → después', 'Campos modificados'].map((c, i) => h('th', { key: i, className: 'px-3 py-2 text-overline font-semibold text-on-surface-variant uppercase tracking-widest text-left' }, c)))),
          h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, plan.rows.slice(0, 60).map(row => h('tr', { key: row.rowKey, 'data-testid': 'inventory-import-row-' + row.rowNumber }, [
            h('td', { key: 'a', className: 'px-3 py-2 align-top' }, [
              h('span', { key: 'badge', className: 'px-2 py-0.5 text-overline font-bold rounded ' + (row.action === 'new' ? 'bg-success-soft text-success' : row.action === 'update' ? 'bg-gold-soft text-gold-text' : 'bg-danger-soft text-danger') }, row.action === 'new' ? 'Alta' : row.action === 'update' ? 'Actualiza' : 'Conflicto'),
              row.conflict && h('p', { key: 'msg', className: 'mt-1 text-overline text-danger max-w-56' }, row.conflict.message),
              row.conflict && row.conflict.resolvable && h('button', { key: 'resolve', type: 'button', 'data-testid': 'inventory-import-resolve-' + row.rowNumber, onClick: () => onResolve(row.rowKey, row.conflict.candidateId), className: 'mt-2 px-2 min-h-8 border border-danger/40 rounded text-overline font-bold text-danger' }, 'Confirmar producto existente'),
            ]),
            h('td', { key: 'n', className: 'px-3 py-2 align-top' }, [h('div', { key: 'name', className: 'text-body text-primary font-semibold' }, row.incoming.nombre), h('code', { key: 'sku', className: 'text-overline text-on-surface-variant' }, row.incoming.sku)]),
            h('td', { key: 'st', className: 'px-3 py-2 align-top font-mono text-caption' }, row.action === 'new' ? `0 → ${stockTotal(row.after)}` : row.before && row.after ? `${stockTotal(row.before)} → ${stockTotal(row.after)}` : '—'),
            h('td', { key: 'pr', className: 'px-3 py-2 align-top text-caption' }, row.action === 'new' ? `— → ${priceSummary(row.after)}` : row.before && row.after ? `${priceSummary(row.before)} → ${priceSummary(row.after)}` : '—'),
            h('td', { key: 'f', className: 'px-3 py-2 align-top text-caption' }, row.fields.length ? row.fields.join(', ') : (row.action === 'update' ? 'Sin cambios' : '—')),
          ]))),
        ])),
      plan.rows.length > 60 && h('div', { key: 'more', className: 'text-caption text-on-surface-variant mt-2 text-center' }, `… y ${plan.rows.length - 60} más`),
    ]);
  }

  // ---------- Precios por talla (H-36) ----------
  // Mapa canónico { talla: precio } → filas { tallas:[], precio } agrupando las
  // tallas que comparten precio. Es la inversa de expandirPrecios().
  function agruparPrecios(mapa) {
    const porPrecio = {};
    Object.keys(mapa || {}).forEach(talla => {
      const k = String(Number(mapa[talla]));
      (porPrecio[k] || (porPrecio[k] = [])).push(talla);
    });
    return Object.keys(porPrecio).map(k => ({ tallas: porPrecio[k], precio: Number(k), expanded: false }));
  }
  function expandirPrecios(rows) {
    const out = {};
    (rows || []).forEach(r => (r.tallas || []).forEach(t => { out[t] = Number(r.precio) || 0; }));
    return out;
  }

  // H-83: el mapa persistido se presenta como grupos de tallas que comparten el
  // mismo conjunto de colores. El orden de los colores no crea otro grupo.
  function ordenarColoresOrnamento(colors, referenceColors) {
    const selected = new Set((colors || []).map(String));
    const kind = referenceColors ? 'ornament_color' : 'color';
    return (window.CONFIG.all ? window.CONFIG.all(kind) : window.CONFIG.list(kind))
      .map(item => String(item.code)).filter(code => selected.has(code));
  }
  function agruparColoresOrnamento(mapa, product) {
    const clean = D.isV2Reference(product)
      ? Object.fromEntries(Object.entries(mapa || {}).map(([size, colors]) => [size, D.canonicalReferenceOrnamentColors(colors)]).filter(([, colors]) => colors.length))
      : D.sanitizeOrnamentColorsBySize(mapa, product);
    const groups = {};
    const order = D.isV2Reference(product)
      ? Object.keys(clean)
      : D.resolveProductSizes(product).sizes.map(size => String(size.value));
    order.forEach(talla => {
      if (!clean[talla]) return;
      const key = JSON.stringify(clean[talla]);
      if (!groups[key]) groups[key] = { tallas: [], colores: clean[talla].slice(), expanded: false };
      groups[key].tallas.push(talla);
    });
    return Object.values(groups);
  }
  function expandirColoresOrnamento(rows, referenceColors) {
    const out = {};
    (rows || []).forEach(row => {
      const colors = ordenarColoresOrnamento(row.colores, referenceColors);
      (row.tallas || []).forEach(talla => { if (colors.length) out[talla] = colors.slice(); });
    });
    return out;
  }

  // Las banderas de presentación nunca forman parte de la identidad del borrador
  // ni del dato persistido. Esta firma alimenta exclusivamente la protección de
  // cierre con cambios pendientes.
  function productDraftSignature(draft) {
    return JSON.stringify({
      ...draft,
      precioRows: (draft.precioRows || []).map(row => ({ tallas: row.tallas || [], precio: row.precio })),
      ornamentColorRows: (draft.ornamentColorRows || []).map(row => ({ tallas: row.tallas || [], colores: row.colores || [] })),
    });
  }

  // En H-101 la familia es administrativa: una misma familia puede contener
  // referencias de categorías/escala distintas. La identidad de talla dentro
  // del editor siempre incluye categoría + escala + código.
  function referenceRowCategoryId(row, fallback) {
    return (row && (row.sizeCategoryId || (row.attrs || {}).__sizeCategoryId)) || fallback || '';
  }
  function referenceRowSizeKey(row, fallback) {
    return [referenceRowCategoryId(row, fallback), (row && row.sizeScale) || '', String((row && row.sizeCode) || '')].join('::');
  }
  function referenceRowSizeLabel(row, fallback) {
    const categoryId = referenceRowCategoryId(row, fallback);
    const item = window.CONFIG.list(categoryId).find(option => String(Object.prototype.hasOwnProperty.call(option.meta || {}, 'value') ? option.meta.value : option.code) === String((row && row.sizeCode) || ''));
    return item ? item.label : String((row && row.sizeCode) || '');
  }
  function referenceDraftSignature(rows) {
    return JSON.stringify((rows || []).filter(row => row.id || row.selectedForCreation).map(row => ({
      ...row, source: row.source || null,
    })));
  }

  // ---------- Formulario de alta / edición ----------
  function ProductForm({ mode, product, onClose, onSave }) {
    const initialFamily = D.isV2Reference(product) && mode === 'edit'
      ? D.referenceFamily(product) : [];
    const initialPrimary = [];
    const initialVariantIds = new Set();
    const initialSizes = new Set();
    initialFamily.forEach(row => {
      const size = referenceRowSizeKey(row);
      if (initialSizes.has(size)) initialVariantIds.add(row.id);
      else { initialSizes.add(size); initialPrimary.push(row); }
    });
    const mostFrequent = (values, fallback, keyOf) => {
      const counts = new Map();
      (values || []).forEach(value => {
        const key = keyOf ? keyOf(value) : String(value);
        const current = counts.get(key) || { value, count: 0 };
        current.count += 1; counts.set(key, current);
      });
      return Array.from(counts.values()).sort((a, b) => b.count - a.count)[0]?.value ?? fallback;
    };
    const initialCategoryId = product.sizeCategoryId || mostFrequent(initialPrimary.map(row => row.sizeCategoryId), '')
      || D.inferSizeCategory(product, product.stock) || '';
    const initialGeneralPrice = mostFrequent(initialPrimary.map(row => Number(row.precio) || 0), Number(product.precio) || 0);
    const initialGeneralColors = D.isV2Reference(product)
      ? mostFrequent(initialPrimary.map(row => D.canonicalReferenceOrnamentColors(row.ornamentColorCodes || row.ornColors || [])),
        D.canonicalReferenceOrnamentColors(product.ornamentColorCodes || product.ornColors || []), value => JSON.stringify(value))
      : (product.ornColors || []).slice();
    const initialPriceMap = Object.fromEntries(initialPrimary
      .filter(row => Number(row.precio) !== Number(initialGeneralPrice))
      .map(row => [referenceRowSizeKey(row), Number(row.precio) || 0]));
    const initialColorMap = Object.fromEntries(initialPrimary
      .filter(row => JSON.stringify(D.canonicalReferenceOrnamentColors(row.ornamentColorCodes || row.ornColors || []))
        !== JSON.stringify(initialGeneralColors))
      .map(row => [referenceRowSizeKey(row), D.canonicalReferenceOrnamentColors(row.ornamentColorCodes || row.ornColors || [])]));
    // Los códigos huérfanos NO se sustituyen al abrir: el select los muestra con aviso (sel() ya
    // lo maneja). Sustituirlos por el primer elemento activo reescribía el color/atributo real del
    // producto con solo abrir y guardar. La normalización masiva vive en Regenerar SKUs.
    const [d, setD] = useState(() => ({
      recordModel: product.recordModel || 'v1', barcodeCode: product.barcodeCode || null,
      physicalSignature: product.physicalSignature || null,
      id: product.id, cat: product.cat, manga: product.manga, tela: product.tela, color: product.color,
      modelo: product.modelo, nombre: product.nombre, orn: product.orn,
      ornColors: initialGeneralColors.slice(),
      ornamentColorCodes: initialGeneralColors.slice(),
      cuello: product.cuello, precio: initialGeneralPrice, costo: product.costo != null ? product.costo : '', pop: !!product.pop,
      imagen: product.imagen || '',
      attrs: product.attrs ? { ...product.attrs } : {}, // valores de catálogos custom (Fase 2)
      sizeCategoryId: initialCategoryId,
      sizeCode: product.sizeCode || '', sizeScale: product.sizeScale || '',
      stockQuantity: product.stockQuantity == null ? 0 : Number(product.stockQuantity),
      stock: D.isV2Reference(product) ? (product.stock || []).map(row => ({ ...row }))
        : alignStock(product, initialCategoryId),
      // H-36: las excepciones se editan como filas «grupo de tallas → precio»,
      // que es como el negocio ya expresa un alcance por tallas en Descuentos.
      // El dato guardado es el mapa canónico; la agrupación vive sólo aquí y se
      // reconstruye juntando las tallas que comparten precio.
      precioRows: D.isV2Reference(product) ? agruparPrecios(initialPriceMap) : agruparPrecios(product.preciosTalla),
      ornamentColorRows: agruparColoresOrnamento(
        D.isV2Reference(product) ? initialColorMap : product.attrs && product.attrs.__ornamentColorsBySize, product),
    }));
    const familyId = useRef(product.referenceFamilyId
      || (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : 'family-' + Date.now())).current;
    const rowFromReference = (row, index) => ({
      rowKey: row.id || `draft-${index}-${referenceRowSizeKey(row)}`,
      id: row.id || null, selectedForCreation: !!row.id,
       sizeCategoryId: referenceRowCategoryId(row, initialCategoryId),
      sizeCode: String(row.sizeCode || ''), sizeScale: row.sizeScale || '',
      stockQuantity: Math.max(0, Number(row.stockQuantity) || 0),
      precio: initialVariantIds.has(row.id) && Number(row.precio) !== Number(initialGeneralPrice)
        ? (Number(row.precio) || 0) : '',
      ornamentColorCodes: initialVariantIds.has(row.id)
        && JSON.stringify(D.canonicalReferenceOrnamentColors(row.ornamentColorCodes || row.ornColors || [])) !== JSON.stringify(initialGeneralColors)
        ? D.canonicalReferenceOrnamentColors(row.ornamentColorCodes || row.ornColors || []) : null,
      attrs: Object.fromEntries(Object.entries(row.attrs || {}).filter(([kind, value]) => {
        const meta = window.CONFIG.catalogMeta(kind) || {};
        return meta.captureScope === 'reference' && value !== (product.attrs || {})[kind];
      })), barcodeCode: row.barcodeCode || null,
      physicalSignature: row.physicalSignature || null, _syncVersion: Number(row._syncVersion) || 0,
      physicalIdentityLocked: !!row.physicalIdentityLocked,
      source: JSON.parse(JSON.stringify(row)),
    });
    const emptyRowsForCategory = categoryId => {
      const category = (window.CONFIG.sizeCategories().find(item => item.id === categoryId) || {});
      return window.CONFIG.list(categoryId).map((item, index) => ({
        rowKey: `draft-${categoryId}-${index}-${item.code}`, id: null, selectedForCreation: false,
        sizeCategoryId: categoryId,
        sizeCode: String(Object.prototype.hasOwnProperty.call(item.meta || {}, 'value') ? item.meta.value : item.code),
        sizeScale: category.scale || '', stockQuantity: 0, precio: '', ornamentColorCodes: null,
        attrs: {}, barcodeCode: null, physicalSignature: null, _syncVersion: 0,
      }));
    };
    const [referenceRows, setReferenceRows] = useState(() => {
      if (!D.isV2Reference(product)) return [];
      const siblings = D.referenceFamily(product);
      if (mode === 'edit' && siblings.length) {
        const existing = new Set(siblings.map(row => referenceRowSizeKey(row)));
        return siblings.map(rowFromReference).concat(
          emptyRowsForCategory(initialCategoryId).filter(row => !existing.has(referenceRowSizeKey(row))));
      }
      return emptyRowsForCategory(initialCategoryId);
    });
    const [captureSizeCategoryId, setCaptureSizeCategoryId] = useState(
      initialCategoryId);
    const initialSignature = useRef(productDraftSignature(d));
    const [exceptionsOpen, setExceptionsOpen] = useState(false);
    const initialHasPhysicalOverrides = initialFamily.some(row => Object.entries(row.attrs || {}).some(([kind, value]) => {
      const meta = window.CONFIG.catalogMeta(kind) || {};
      return meta.captureScope === 'reference' && value !== (product.attrs || {})[kind];
    }));
    const [variantsOpen, setVariantsOpen] = useState(initialVariantIds.size > 0 || initialHasPhysicalOverrides);
    const [summaryDetailsOpen, setSummaryDetailsOpen] = useState(false);
    const [colorPicker, setColorPicker] = useState(null);
    const [colorQuery, setColorQuery] = useState('');
    const [showAllSummary, setShowAllSummary] = useState(false);
    const [zeroSizesOpen, setZeroSizesOpen] = useState(false);
    const [attemptedSubmit, setAttemptedSubmit] = useState(false);
    const set = (k, v) => setD(prev => ({ ...prev, [k]: v }));
    const setSizeCategory = categoryId => {
      setD(prev => ({
        ...prev,
        sizeCategoryId: categoryId,
        attrs: { ...(prev.attrs || {}), __sizeCategoryId: categoryId },
        ...(prev.recordModel === 'v2' ? (() => {
          const item = window.CONFIG.list(categoryId)[0] || {};
          const sizeCode = Object.prototype.hasOwnProperty.call(item.meta || {}, 'value') ? item.meta.value : item.code;
          const scale = ((window.CONFIG.sizeCategories().find(cat => cat.id === categoryId) || {}).scale) || '';
          return { sizeCode: String(sizeCode || ''), sizeScale: scale,
            stock: [{ talla: String(sizeCode || ''), escala: scale, stock: Number(prev.stockQuantity) || 0 }] };
        })() : { stock: alignStock(prev, categoryId) }),
        precioRows: [], ornamentColorRows: [],
      }));
    };
    const requestSizeCategory = categoryId => {
      if (d.recordModel === 'v2') {
        if (categoryId === captureSizeCategoryId) return;
        setCaptureSizeCategoryId(categoryId);
        setZeroSizesOpen(false);
        setReferenceRows(rows => {
          const known = new Set(rows.map(row => referenceRowSizeKey(row)));
          return rows.concat(emptyRowsForCategory(categoryId).filter(row => !known.has(referenceRowSizeKey(row))));
        });
        return;
      }
      if (categoryId === d.sizeCategoryId) return;
      const aligned = alignStock(d, categoryId);
      const preserved = new Set(aligned.map(row => `${row.escala}|${row.talla}`));
      const stockLost = d.stock.filter(row => Number(row.stock) > 0 && !preserved.has(`${row.escala}|${row.talla}`));
      const priceGroups = d.precioRows.filter(row => (row.tallas || []).length).length;
      const colorGroups = d.ornamentColorRows.filter(row => (row.tallas || []).length).length;
      if (stockLost.length || priceGroups || colorGroups) {
        const parts = [];
        if (stockLost.length) parts.push(`${stockLost.length} talla(s) con existencias`);
        if (priceGroups) parts.push(`${priceGroups} grupo(s) de precio`);
        if (colorGroups) parts.push(`${colorGroups} grupo(s) de colores`);
        if (!window.confirm(`Cambiar la familia de tallas eliminará ${parts.join(', ')}. ¿Deseas continuar?`)) return;
      }
      setSizeCategory(categoryId);
      setExceptionsOpen(false);
      setColorPicker(null);
    };
    const setAttr = (k, v) => setD(prev => ({ ...prev, attrs: { ...(prev.attrs || {}), [k]: v } }));
    // Catálogo "Modelo" (custom) que alimenta el desplegable de "Nombre / Modelo" (detección
    // centralizada en CONFIG.modeloKind). Si no existe, el campo sigue siendo texto libre.
    const modeloKind = window.CONFIG.modeloKind ? window.CONFIG.modeloKind() : null;
    const modeloItems = modeloKind ? window.CONFIG.list(modeloKind) : [];
    const referenceCaptureKinds = Object.keys(window.CONFIG.allCatalogMeta ? window.CONFIG.allCatalogMeta() : {})
      .filter(kind => { const meta = window.CONFIG.catalogMeta(kind); return meta && meta.custom
        && meta.inForm && meta.captureScope === 'reference' && kind !== modeloKind; });
    const familyCaptureKinds = Object.keys(window.CONFIG.allCatalogMeta ? window.CONFIG.allCatalogMeta() : {})
      .filter(kind => { const meta = window.CONFIG.catalogMeta(kind); return meta
        && meta.captureScope === 'family' && (meta.field || meta.custom); });
    // El valor elegido del catálogo se guarda como NOMBRE del producto (d.nombre = etiqueta), como
    // NO. MODELO (d.modelo = código del catálogo: ADR, ARO, …) y, si el catálogo entra al SKU/filtros,
    // también en d.attrs[modeloKind] = código. El No. Modelo deja de capturarse a mano.
    const setModelo = (code) => { const it = modeloItems.find(x => x.code === code); setD(prev => ({ ...prev, nombre: it ? it.label : '', modelo: code, attrs: { ...(prev.attrs || {}), [modeloKind]: code } })); };
    const modeloCode = String((d.attrs || {})[modeloKind] || (modeloItems.find(x => x.label === d.nombre) || {}).code || '');
    const setStock = (talla, escala, val) => setD(prev => {
      const quantity = Math.max(0, Math.round(Number(val) || 0));
      return prev.recordModel === 'v2'
        ? { ...prev, stockQuantity: quantity, stock: [{ talla: prev.sizeCode, escala: prev.sizeScale, stock: quantity }] }
        : { ...prev, stock: prev.stock.map(v => v.talla === talla && v.escala === escala ? { ...v, stock: quantity } : v) };
    });
    const setReferenceSize = value => setD(prev => ({ ...prev, sizeCode: String(value),
      stock: [{ talla: String(value), escala: prev.sizeScale, stock: Number(prev.stockQuantity) || 0 }] }));
    const setFamilyRow = (rowKey, patch) => setReferenceRows(rows => rows.map(row => {
      if (row.rowKey !== rowKey) return row;
      const next = { ...row, ...patch };
      if (Object.prototype.hasOwnProperty.call(patch, 'stockQuantity')) {
        next.stockQuantity = Math.max(0, Math.round(Number(patch.stockQuantity) || 0));
        if (next.stockQuantity > 0) next.selectedForCreation = true;
      }
      return next;
    }));
    const addFamilyVariant = source => {
      setReferenceRows(rows => rows.concat([{
        ...(source || rows[0] || {}), rowKey: `draft-${Date.now()}-${rows.length}`,
        id: null, barcodeCode: null, physicalSignature: null,
        physicalIdentityLocked: false, _syncVersion: 0, selectedForCreation: true,
        stockQuantity: 0, precio: '', ornamentColorCodes: null, attrs: {},
      }]));
      setVariantsOpen(true);
    };
    const removeFamilyVariant = row => {
      if (row.id) return;
      setReferenceRows(rows => rows.filter(item => item.rowKey !== row.rowKey));
    };
    const toggleOrn = (c) => setD(prev => {
      const colors = prev.ornColors.includes(c) ? prev.ornColors.filter(x => x !== c) : prev.ornColors.concat(c);
      const canonical = D.canonicalReferenceOrnamentColors(colors);
      return { ...prev, ornColors: canonical, ornamentColorCodes: prev.recordModel === 'v2' ? canonical : prev.ornamentColorCodes };
    });
    // Filas de excepción: agregar, quitar, cambiar precio y alternar una talla.
    const addPrecioRow = () => { setExceptionsOpen(true); setD(prev => ({
      ...prev,
      precioRows: prev.precioRows.map(row => ({ ...row, expanded: false })).concat([{ tallas: [], precio: '', expanded: true }]),
    })); };
    const delPrecioRow = (i) => setD(prev => ({ ...prev, precioRows: prev.precioRows.filter((_, k) => k !== i) }));
    const setPrecioRow = (i, precio) => setD(prev => ({ ...prev, precioRows: prev.precioRows.map((r, k) => k === i ? { ...r, precio } : r) }));
    const setPrecioExpanded = (i, expanded) => setD(prev => ({ ...prev, precioRows: prev.precioRows.map((r, k) => k === i ? { ...r, expanded } : r) }));
    const togglePrecioTalla = (i, talla) => setD(prev => ({
      ...prev,
      precioRows: prev.precioRows.map((r, k) => k !== i ? r
        : { ...r, tallas: r.tallas.includes(talla) ? r.tallas.filter(t => t !== talla) : r.tallas.concat(talla) }),
    }));
    const addOrnamentColorRow = () => { setExceptionsOpen(true); setD(prev => ({
      ...prev,
      ornamentColorRows: prev.ornamentColorRows.map(row => ({ ...row, expanded: false })).concat([{ tallas: [], colores: [], expanded: true }]),
    })); };
    const delOrnamentColorRow = i => setD(prev => ({
      ...prev, ornamentColorRows: prev.ornamentColorRows.filter((_, k) => k !== i),
    }));
    const setOrnamentColorExpanded = (i, expanded) => setD(prev => ({
      ...prev, ornamentColorRows: prev.ornamentColorRows.map((row, k) => k === i ? { ...row, expanded } : row),
    }));
    const toggleOrnamentColorSize = (i, talla) => setD(prev => ({
      ...prev,
      ornamentColorRows: prev.ornamentColorRows.map((row, k) => k !== i ? row : {
        ...row, tallas: row.tallas.includes(String(talla))
          ? row.tallas.filter(value => value !== String(talla)) : row.tallas.concat(String(talla)),
      }),
    }));
    const toggleOrnamentColor = (i, color) => setD(prev => ({
      ...prev,
      ornamentColorRows: prev.ornamentColorRows.map((row, k) => k !== i ? row : {
        ...row, colores: row.colores.includes(color)
          ? row.colores.filter(value => value !== color) : ordenarColoresOrnamento(row.colores.concat(color), d.recordModel === 'v2'),
      }),
    }));
    const fileRef = useRef(null);
    // Guardas de la subida en segundo plano: no tocar el estado tras desmontar, y si el
    // usuario elige otra foto antes de que termine la subida anterior, la vieja se descarta.
    const alive = useRef(true);
    useEffect(() => () => { alive.current = false; }, []);
    const imgSeq = useRef(0);
    // Imagen del producto: redimensiona a 600px (JPEG) y la muestra al instante como data URL.
    // Con sesión, la sube a Supabase Storage (bucket product-photos) y d.imagen pasa a ser la
    // URL — así la foto NO viaja incrustada en cada guardado/pull. Sin sesión o sin red, se
    // queda el data URL local (comportamiento de siempre); la tarjeta "Fotos de producto" en
    // Configuración → Inventario la migra después.
    async function onPickImg(e) {
      const file = e.target.files && e.target.files[0]; e.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('Selecciona una imagen', 'var(--danger)'); return; }
      let dataUrl;
      try {
        dataUrl = await resizeImageFile(file, { max: 600, type: 'image/jpeg', quality: 0.85 });
      } catch (error) {
        toast('No se pudo leer la imagen', 'var(--danger)');
        return;
      }
      set('imagen', dataUrl); // vista previa inmediata + respaldo si la nube no responde
      toast('Imagen lista', 'var(--accent)');
      const seq = ++imgSeq.current;
      try {
        if (!window.STORE || !window.STORE.uploadProductPhoto || !(await window.STORE.hasSession())) return;
        const blob = await (await fetch(dataUrl)).blob();
        const name = 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
        const url = await window.STORE.uploadProductPhoto(name, blob);
        if (url && alive.current && seq === imgSeq.current) { set('imagen', url); toast('Foto guardada en la nube', 'var(--accent)'); }
      } catch (err) { /* sin red o sin bucket: se queda el respaldo local (data URL) */ }
    }
    const imgSrc = d.imagen ? ((window.__IMG_MAP && window.__IMG_MAP[d.imagen]) || d.imagen) : '';
    const skuPrev = D.sku({ ...d, modelo: d.modelo || '000' }); // misma receta que el SKU real
    const visibleReferenceRows = referenceRows.filter(row => row.id || row.selectedForCreation
      || referenceRowCategoryId(row, d.sizeCategoryId) === captureSizeCategoryId);
    const standardFamilyRows = [], variantFamilyRows = [];
    const seenFamilySizes = new Set();
    visibleReferenceRows.forEach(row => {
      const size = referenceRowSizeKey(row, d.sizeCategoryId);
      if (seenFamilySizes.has(size)) variantFamilyRows.push(row);
      else { seenFamilySizes.add(size); standardFamilyRows.push(row); }
    });
    const selectedFamilyRows = referenceRows.filter(row => row.selectedForCreation);
    const exceptionSizeRows = d.recordModel === 'v2'
      ? standardFamilyRows.map(row => ({
          talla: referenceRowSizeKey(row, d.sizeCategoryId), label: referenceRowSizeLabel(row, d.sizeCategoryId),
          escala: row.sizeScale, stock: Number(row.stockQuantity) || 0,
        })) : d.stock;
    const exceptionSizeLabel = size => {
      const row = exceptionSizeRows.find(item => String(item.talla) === String(size));
      return row && row.label ? row.label : tallaLabel(d, size);
    };
    const total = d.recordModel === 'v2'
      ? selectedFamilyRows.reduce((sum, row) => sum + (Number(row.stockQuantity) || 0), 0)
      : d.stock.reduce((a, v) => a + v.stock, 0);
    const stockedSizes = d.recordModel === 'v2'
      ? new Set(selectedFamilyRows.filter(row => Number(row.stockQuantity) > 0)
        .map(row => referenceRowSizeKey(row, d.sizeCategoryId))).size
      : d.stock.filter(row => Number(row.stock) > 0).length;
    const modeloFinal = (modeloKind && modeloCode) ? modeloCode : String(d.modelo).trim();
    const previewPrices = expandirPrecios(d.precioRows.filter(row =>
      (row.tallas || []).length && row.precio !== '' && row.precio != null));
    const previewOrnamentColors = expandirColoresOrnamento(d.ornamentColorRows.filter(row =>
      (row.tallas || []).length && (row.colores || []).length), d.recordModel === 'v2');
    const previewAttrs = { ...(d.attrs || {}), __ornamentColorsBySize: previewOrnamentColors };
    const previewProduct = { ...d, attrs: previewAttrs, preciosTalla: previewPrices };

    function validateDraft() {
      const out = [];
      if (!d.nombre.trim()) out.push({ code: 'name', target: 'product-name', message: 'Selecciona o escribe el nombre / modelo.' });
      if (!modeloKind && !modeloFinal) out.push({ code: 'model', target: 'product-model', message: 'Escribe el número de modelo.' });
      if (!(d.recordModel === 'v2' ? captureSizeCategoryId : d.sizeCategoryId)) out.push({ code: 'size-category', target: 'product-size-category', message: 'Selecciona la familia de tallas.' });
      if (d.recordModel === 'v2' && !selectedFamilyRows.length) out.push({ code: 'family-empty', target: 'reference-family-grid', message: 'Selecciona al menos una referencia para crear o conservar.' });
      const meta = window.CONFIG.allCatalogMeta ? window.CONFIG.allCatalogMeta() : {};
      Object.keys(meta).forEach(kind => {
        const m = meta[kind]; if (!m.required || !m.inForm) return;
        if (d.recordModel === 'v2' && m.captureScope === 'reference' && m.custom) {
          selectedFamilyRows.forEach(row => {
            const value = (row.attrs || {})[kind] || (d.attrs || {})[kind];
            if (value == null || String(value).trim() === '') out.push({
              code: 'catalog-' + kind + '-' + row.rowKey, target: 'family-row-' + row.rowKey,
              message: `Selecciona ${m.label} para talla ${referenceRowSizeLabel(row, d.sizeCategoryId)}.`,
            });
          });
          return;
        }
        // V1 ya tiene su modelo histórico en `modelo`; exigirle una
        // reclasificación de catálogo para editar precio/foto violaría la
        // compatibilidad. V2 sí debe elegir el valor publicado explícitamente.
        const value = m.custom
          ? (kind === modeloKind && d.recordModel !== 'v2'
            ? ((d.attrs || {})[kind] || d.modelo) : (d.attrs || {})[kind])
          : d[m.field];
        if (value == null || String(value).trim() === '') out.push({ code: 'catalog-' + kind,
          target: kind === modeloKind ? 'product-name' : (kind === 'ornament' ? 'product-ornament' : 'product-field-' + kind),
          message: 'Selecciona ' + m.label + '.' });
      });
      if (d.recordModel === 'v2' && D.ornamentColorMode(d) === 'required') selectedFamilyRows.forEach(row => {
        const explicit = Array.isArray(row.ornamentColorCodes) ? row.ornamentColorCodes : null;
        const grouped = previewOrnamentColors[referenceRowSizeKey(row, d.sizeCategoryId)];
        const colors = D.canonicalReferenceOrnamentColors(explicit || grouped || d.ornColors || []);
        if (!colors.length) out.push({ code: 'ornament-color-required-' + row.rowKey,
          target: 'general-color-selector-toggle', message: `Selecciona color de ornamento para talla ${referenceRowSizeLabel(row, d.sizeCategoryId)}.` });
      });
      const priceOwners = {};
      d.precioRows.forEach((row, index) => {
        if ((row.tallas || []).length && (row.precio === '' || row.precio == null)) {
          out.push({ code: 'price-empty-' + index, type: 'price', index, target: `price-group-${index}-value`, sizes: row.tallas.slice(), message: `Escribe el precio del grupo ${index + 1}.` });
        }
        (row.tallas || []).forEach(size => {
          if (priceOwners[size] != null) out.push({ code: `price-overlap-${priceOwners[size]}-${index}-${size}`, type: 'price', index, target: `price-group-${index}-size-${size}`, sizes: [String(size)], message: `La talla ${exceptionSizeLabel(size)} está en dos precios especiales (grupos ${priceOwners[size] + 1} y ${index + 1}).` });
          else priceOwners[size] = index;
        });
      });
      const colorOwners = {};
      d.ornamentColorRows.forEach((row, index) => {
        const colors = ordenarColoresOrnamento(row.colores, d.recordModel === 'v2');
        if ((row.tallas || []).length && !colors.length) {
          out.push({ code: 'color-empty-' + index, type: 'color', index, target: `ornament-group-${index}-color-toggle`, sizes: row.tallas.slice(), message: `Selecciona al menos un color en el grupo ${index + 1}.` });
        }
        (row.tallas || []).forEach(size => {
          const previous = colorOwners[size];
          if (previous && JSON.stringify(previous.colors) !== JSON.stringify(colors)) {
            out.push({ code: `color-overlap-${previous.index}-${index}-${size}`, type: 'color', index, target: `ornament-group-${index}-size-${size}`, sizes: [String(size)], message: `La talla ${exceptionSizeLabel(size)} tiene colores incompatibles en los grupos ${previous.index + 1} y ${index + 1}.` });
          } else colorOwners[size] = { colors, index };
        });
      });
      return out;
    }

    const errors = validateDraft();
    const liveErrors = errors.filter(error => attemptedSubmit || error.type === 'price' || error.type === 'color');
    const summaryRows = D.resolveProductSizes(previewProduct).sizes.map(size => {
      const value = String(size.value);
      const stockRow = d.stock.find(row => String(row.talla) === value && (!size.scale || row.escala === size.scale));
      const stock = Number(stockRow && stockRow.stock) || 0;
      const colorSpecial = Object.prototype.hasOwnProperty.call(previewOrnamentColors, value);
      const priceSpecial = Object.prototype.hasOwnProperty.call(previewPrices, value);
      return {
        value, label: size.label, stock, colorSpecial, priceSpecial,
        ornament: d.orn || '—', colors: D.effectiveOrnamentColors(previewProduct, value),
        price: D.listPrice(previewProduct, value),
        errors: liveErrors.filter(error => (error.sizes || []).map(String).includes(value)),
      };
    });
    const relevantSummaryRows = summaryRows.filter(row => showAllSummary || row.stock > 0 || row.colorSpecial || row.priceSpecial || row.errors.length);

    const focusError = error => {
      if (!error) return;
      if (error.type === 'price') { setExceptionsOpen(true); setPrecioExpanded(error.index, true); }
      if (error.type === 'color') { setExceptionsOpen(true); setOrnamentColorExpanded(error.index, true); }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const target = document.querySelector(`[data-testid="${error.target}"]`);
        if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.focus(); }
      }));
    };
    const initialReferenceSignature = useRef(referenceDraftSignature(referenceRows));
    const isDirty = productDraftSignature(d) !== initialSignature.current
      || referenceDraftSignature(referenceRows) !== initialReferenceSignature.current;
    const requestClose = () => {
      if (isDirty && !window.confirm('Hay cambios sin guardar. ¿Deseas cerrar el formulario y descartarlos?')) return;
      onClose();
    };

    const renderColorSelector = ({ pickerId, selected, historicalCodes, onToggle, optionTestId, toggleTestId, closeTestId }) => {
      const open = colorPicker === pickerId;
      const referenceColors = d.recordModel === 'v2';
      const kind = referenceColors ? 'ornament_color' : 'color';
      const colorItems = window.CONFIG.selectable(kind, historicalCodes || []);
      const names = Object.fromEntries(colorItems.map(item => [item.code, item.label]));
      const hexes = Object.fromEntries(colorItems.map(item => [item.code, (item.meta || {}).hex || '#8b9099']));
      const selectedSet = new Set((selected || []).map(String));
      const canonical = colorItems.map(item => String(item.code)).filter(code => selectedSet.has(code));
      const searchKey = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      const query = searchKey(colorQuery.trim());
      const colors = colorItems.filter(item => !query || searchKey(`${item.code} ${item.label}`).includes(query));
      const closePicker = () => {
        setColorPicker(null);
        requestAnimationFrame(() => document.querySelector(`[data-testid="${toggleTestId}"]`)?.focus());
      };
      const panel = h('div', {
        key: 'panel',
        className: 'fixed z-[180] left-4 right-4 top-1/2 -translate-y-1/2 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:w-[30rem] max-w-[calc(100vw-2rem)] max-h-[min(34rem,calc(100dvh-2rem))] flex flex-col overflow-hidden p-3 border border-outline-variant rounded-xl bg-surface-container-lowest shadow-e3',
        role: 'group', 'aria-label': 'Selector de colores de ornamento', 'data-testid': toggleTestId + '-panel',
        onKeyDown: event => { if (event.key === 'Escape') { event.stopPropagation(); closePicker(); } },
      }, [
        h('div', { key: 'search', className: 'flex items-center gap-2 pb-3 bg-surface-container-lowest shrink-0' }, [
          h('input', { key: 'q', type: 'search', value: colorQuery, autoFocus: true, onChange: event => setColorQuery(event.target.value), placeholder: 'Buscar código o color…', className: INPUT + ' flex-1 min-w-0', 'data-testid': toggleTestId + '-search' }),
          h('button', { key: 'close', type: 'button', 'data-testid': closeTestId, className: 'min-w-11 h-11 grid place-items-center border border-outline-variant rounded-lg text-on-surface-variant', onClick: closePicker, 'aria-label': 'Cerrar selector de colores' }, h(MS, { name: 'close', size: 17 })),
        ]),
        h('div', { key: 'colors', className: 'grid grid-cols-1 gap-1.5 overflow-y-auto overscroll-contain min-h-0 pr-1' }, colors.map(item => {
          const code = String(item.code);
          const historical = item.active === false;
          const active = canonical.includes(code);
          const fullName = String(item.label) + (historical ? ' · Histórico' : '');
          return h('button', {
            key: code, type: 'button', 'data-testid': optionTestId(code), 'aria-pressed': active ? 'true' : 'false',
            title: `${code} — ${fullName}`, onClick: () => onToggle(code),
            className: 'w-full min-h-11 grid grid-cols-[1.25rem_4rem_minmax(0,1fr)_1.25rem] items-center gap-2 px-3 text-left border rounded-lg transition-colors ' + (active ? 'border-primary bg-surface-container text-primary' : 'border-outline-variant bg-surface hover:border-primary text-on-surface-variant'),
          }, [
            h('span', { key: 'sw', 'data-color-swatch': code, className: 'w-4 h-4 rounded-full border-2 border-outline shrink-0', style: { background: hexes[code] } }),
            h('span', { key: 'c', className: 'text-overline font-bold font-mono' }, code),
            h('span', { key: 'n', className: 'min-w-0 text-caption truncate', title: fullName }, fullName),
            active ? h(MS, { key: 'ok', name: 'check', size: 15 }) : h('span', { key: 'space', 'aria-hidden': 'true' }),
          ]);
        })),
        !colors.length && h('p', { key: 'empty', className: 'text-caption text-on-surface-variant py-3 text-center' }, 'No hay colores que coincidan.'),
      ]);
      return h(React.Fragment, null, [
        h('div', { key: 'trigger', className: 'relative' }, h('div', { className: 'flex flex-wrap items-center gap-2' }, [
          ...canonical.map(code => h('button', {
            key: code, type: 'button', onClick: () => onToggle(code), title: `Quitar ${names[code]}`,
            className: 'inline-flex items-center gap-1.5 min-h-9 px-2.5 border border-primary/40 bg-surface-container rounded-lg text-overline font-semibold text-primary',
            }, [h('span', { key: 'sw', className: 'w-3.5 h-3.5 rounded-full border border-outline-variant', style: { background: hexes[code] } }), code,
              (window.CONFIG.find(kind, code) || {}).active === false ? ' · Histórico' : null,
              h(MS, { key: 'x', name: 'close', size: 13 })])),
          h('button', {
            key: 'toggle', type: 'button', 'data-testid': toggleTestId, 'aria-expanded': open ? 'true' : 'false',
            className: 'inline-flex items-center gap-2 min-h-10 px-3 border border-outline-variant rounded-lg text-caption font-semibold text-on-surface-variant hover:border-primary hover:text-primary transition-colors',
            onClick: () => { setColorPicker(open ? null : pickerId); setColorQuery(''); },
          }, [h(MS, { key: 'i', name: 'palette', size: 16 }), canonical.length ? `${canonical.length} seleccionado${canonical.length === 1 ? '' : 's'}` : 'Elegir colores', h(MS, { key: 'c', name: 'chevDown', size: 15, style: { transform: open ? 'rotate(180deg)' : '' } })]),
        ])),
        open && ReactDOM.createPortal(panel, document.body),
      ]);
    };

    const sectionHeading = (number, id, title) => h('div', { key: 'heading', className: 'flex items-center gap-2 mb-4' }, [
      h('span', { key: 'n', className: 'w-7 h-7 rounded-full bg-primary text-on-primary grid place-items-center text-caption font-bold shrink-0' }, number),
      h('h2', { key: 't', id, className: 'font-headline text-title text-primary' }, title),
    ]);

    const renderColorExceptions = () => D.ornamentSupportsColors(d) && h('div', { key: 'colors', 'data-testid': 'ornament-colors-by-size' }, [
      h('div', { key: 'head', className: 'flex flex-wrap items-center gap-2 mb-1' }, [
        h(MS, { key: 'i', name: 'palette', size: 16 }),
        h('h3', { key: 't', className: 'text-caption font-bold uppercase tracking-widest text-primary' }, 'Colores de ornamento'),
        h('span', { key: 'sp', className: 'flex-1' }),
        h('button', { key: 'add', type: 'button', onClick: addOrnamentColorRow, 'data-testid': 'add-ornament-colors-by-size', className: 'inline-flex items-center gap-1 px-3 min-h-10 border border-outline-variant rounded-lg text-overline font-bold text-primary' }, [h(MS, { key: 'i', name: 'plus', size: 14 }), 'Agregar colores']),
      ]),
      h('p', { key: 'help', className: 'text-overline text-on-surface-variant/70 mb-3' }, 'Las demás tallas usan los colores generales.'),
      !d.ornamentColorRows.length && h('p', { key: 'empty', className: 'p-3 rounded-lg bg-surface-container-low text-caption text-on-surface-variant' }, 'Sin colores especiales.'),
      ...d.ornamentColorRows.map((row, index) => {
        const rowErrors = liveErrors.filter(error => error.type === 'color' && error.index === index);
        return h('div', { key: 'ocr' + index, className: 'mb-3 p-3 rounded-xl border ' + (rowErrors.length ? 'border-danger/50 bg-danger-soft/40' : 'border-outline-variant bg-surface-container-low'), 'data-testid': 'ornament-color-group-' + index }, [
          h('div', { key: 'top', className: 'flex items-center gap-2' }, [
            h('button', { key: 'edit', type: 'button', 'data-testid': 'ornament-group-' + index + '-edit', 'aria-expanded': row.expanded ? 'true' : 'false', onClick: () => setOrnamentColorExpanded(index, !row.expanded), className: 'flex-1 min-w-0 text-left' }, [
              h('span', { key: 'label', className: 'block text-overline uppercase font-bold text-on-surface-variant' }, 'Grupo ' + (index + 1)),
              h('span', { key: 'sum', className: 'block text-caption text-primary truncate' }, (row.tallas.length ? row.tallas.map(exceptionSizeLabel).join('/') : 'Sin tallas') + ' → ' + (row.colores.length ? row.colores.join(' + ') : 'Sin colores')),
            ]),
            h('button', { key: 'x', type: 'button', title: 'Quitar grupo', 'aria-label': 'Eliminar grupo ' + (index + 1) + ' de colores', onClick: () => delOrnamentColorRow(index), 'data-testid': 'ornament-group-' + index + '-delete', className: 'w-10 h-10 grid place-items-center border border-outline-variant rounded-lg text-on-surface-variant hover:text-danger' }, h(MS, { name: 'trash', size: 16 })),
          ]),
          row.expanded && h('div', { key: 'editbody', className: 'mt-3 pt-3 border-t border-outline-variant' }, [
            h('p', { key: 'sl', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-1.5' }, 'Tallas'),
            h('div', { key: 'sizes', className: 'flex flex-wrap gap-1.5 mb-3' }, exceptionSizeRows.map(size => h('button', {
              key: size.talla, type: 'button', onClick: () => toggleOrnamentColorSize(index, size.talla),
              'data-testid': 'ornament-group-' + index + '-size-' + size.talla,
              'aria-pressed': row.tallas.includes(String(size.talla)) ? 'true' : 'false',
              className: 'min-h-10 px-3 border rounded-lg text-overline uppercase transition-colors ' + (row.tallas.includes(String(size.talla)) ? 'border-primary bg-surface-container text-primary font-bold' : 'border-outline-variant bg-surface text-on-surface-variant hover:border-primary'),
            }, exceptionSizeLabel(size.talla) + (Number(size.stock) > 0 ? ' · ' + size.stock : '')))),
            h('p', { key: 'cl', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-1.5' }, 'Colores'),
            renderColorSelector({ pickerId: 'group-' + index, selected: row.colores, onToggle: color => toggleOrnamentColor(index, color), optionTestId: color => 'ornament-group-' + index + '-color-' + color, toggleTestId: 'ornament-group-' + index + '-color-toggle', closeTestId: 'ornament-group-' + index + '-color-close' }),
            ...rowErrors.map(error => h('p', { key: error.code, className: 'mt-2 text-caption text-danger', role: 'alert' }, error.message)),
            h('div', { key: 'donebar', className: 'flex justify-end mt-3' }, h('button', { type: 'button', 'data-testid': 'ornament-group-' + index + '-done', className: 'px-4 min-h-10 bg-primary text-on-primary rounded-lg text-overline font-bold uppercase', onClick: () => { if (rowErrors.length) focusError(rowErrors[0]); else { setOrnamentColorExpanded(index, false); setColorPicker(null); } } }, 'Listo')),
          ]),
        ]);
      }),
    ]);

    const renderPriceExceptions = () => h('div', { key: 'prices' }, [
      h('div', { key: 'head', className: 'flex flex-wrap items-center gap-2 mb-1' }, [
        h(MS, { key: 'i', name: 'tag', size: 16 }),
        h('h3', { key: 't', className: 'text-caption font-bold uppercase tracking-widest text-primary' }, 'Precios especiales'),
        h('span', { key: 'base', className: 'text-overline text-on-surface-variant' }, 'General ' + fmt(Number(d.precio) || 0).replace('.00', '')),
        h('span', { key: 'sp', className: 'flex-1' }),
        h('button', { key: 'add', type: 'button', onClick: addPrecioRow, 'data-testid': 'add-price-by-size', className: 'inline-flex items-center gap-1 px-3 min-h-10 border border-outline-variant rounded-lg text-overline font-bold text-primary' }, [h(MS, { key: 'i', name: 'plus', size: 14 }), 'Agregar precio']),
      ]),
      h('p', { key: 'help', className: 'text-overline text-on-surface-variant/70 mb-3' }, 'Las demás tallas usan el precio general.'),
      !d.precioRows.length && h('p', { key: 'empty', className: 'p-3 rounded-lg bg-surface-container-low text-caption text-on-surface-variant' }, 'Sin precios especiales.'),
      ...d.precioRows.map((row, index) => {
        const rowErrors = liveErrors.filter(error => error.type === 'price' && error.index === index);
        return h('div', { key: 'price' + index, className: 'mb-3 p-3 rounded-xl border ' + (rowErrors.length ? 'border-danger/50 bg-danger-soft/40' : 'border-outline-variant bg-surface-container-low'), 'data-testid': 'price-group-' + index }, [
          h('div', { key: 'top', className: 'flex items-center gap-2' }, [
            h('button', { key: 'edit', type: 'button', 'data-testid': 'price-group-' + index + '-edit', 'aria-expanded': row.expanded ? 'true' : 'false', onClick: () => setPrecioExpanded(index, !row.expanded), className: 'flex-1 min-w-0 text-left' }, [
              h('span', { key: 'label', className: 'block text-overline uppercase font-bold text-on-surface-variant' }, 'Grupo ' + (index + 1)),
              h('span', { key: 'sum', className: 'block text-caption text-primary truncate' }, (row.tallas.length ? row.tallas.map(exceptionSizeLabel).join('/') : 'Sin tallas') + ' → ' + (row.precio === '' ? 'Sin precio' : fmt(Number(row.precio) || 0).replace('.00', ''))),
            ]),
            h('button', { key: 'x', type: 'button', title: 'Quitar grupo', 'aria-label': 'Eliminar grupo ' + (index + 1) + ' de precio', onClick: () => delPrecioRow(index), 'data-testid': 'price-group-' + index + '-delete', className: 'w-10 h-10 grid place-items-center border border-outline-variant rounded-lg text-on-surface-variant hover:text-danger' }, h(MS, { name: 'trash', size: 16 })),
          ]),
          row.expanded && h('div', { key: 'editbody', className: 'mt-3 pt-3 border-t border-outline-variant' }, [
            field('Precio del grupo', h('input', { type: 'number', min: 0, value: row.precio, placeholder: String(d.precio || 0), 'data-testid': 'price-group-' + index + '-value', className: INPUT + ' max-w-40 text-right font-mono', onChange: event => setPrecioRow(index, event.target.value) }), null, rowErrors.find(error => error.code.indexOf('price-empty') === 0)),
            h('p', { key: 'sl', className: 'text-overline uppercase tracking-widest text-on-surface-variant mt-3 mb-1.5' }, 'Tallas'),
            h('div', { key: 'sizes', className: 'flex flex-wrap gap-1.5' }, exceptionSizeRows.map(size => h('button', {
              key: size.talla, type: 'button', onClick: () => togglePrecioTalla(index, size.talla), 'data-testid': 'price-group-' + index + '-size-' + size.talla,
              'aria-pressed': row.tallas.includes(size.talla) ? 'true' : 'false',
              className: 'min-h-10 px-3 border rounded-lg text-overline uppercase transition-colors ' + (row.tallas.includes(size.talla) ? 'border-primary bg-surface-container text-primary font-bold' : 'border-outline-variant bg-surface text-on-surface-variant hover:border-primary'),
            }, exceptionSizeLabel(size.talla) + (Number(size.stock) > 0 ? ' · ' + size.stock : '')))),
            ...rowErrors.filter(error => error.code.indexOf('price-empty') !== 0).map(error => h('p', { key: error.code, className: 'mt-2 text-caption text-danger', role: 'alert' }, error.message)),
            h('div', { key: 'donebar', className: 'flex justify-end mt-3' }, h('button', { type: 'button', 'data-testid': 'price-group-' + index + '-done', className: 'px-4 min-h-10 bg-primary text-on-primary rounded-lg text-overline font-bold uppercase', onClick: () => rowErrors.length ? focusError(rowErrors[0]) : setPrecioExpanded(index, false) }, 'Listo')),
          ]),
        ]);
      }),
    ]);

    const familyPriceMap = () => expandirPrecios(d.precioRows.filter(row => (row.tallas || []).length));
    const familyColorMap = () => expandirColoresOrnamento(d.ornamentColorRows.filter(row => (row.tallas || []).length), d.recordModel === 'v2');
    const effectiveFamilyPrice = row => row.precio !== '' && row.precio != null
      ? Number(row.precio) || 0 : Number(familyPriceMap()[referenceRowSizeKey(row, d.sizeCategoryId)] ?? d.precio) || 0;
    const historicalFamilyColors = row => row && row.id
      ? D.canonicalReferenceOrnamentColors(((row.source || {}).ornamentColorCodes) || ((row.source || {}).ornColors) || []) : [];
    const effectiveFamilyColors = row => {
      const values = Array.isArray(row.ornamentColorCodes)
        ? D.canonicalReferenceOrnamentColors(row.ornamentColorCodes)
        : D.canonicalReferenceOrnamentColors(familyColorMap()[referenceRowSizeKey(row, d.sizeCategoryId)] || d.ornColors || []);
      const allowed = new Set(window.CONFIG.selectable('ornament_color', historicalFamilyColors(row)).map(item => String(item.code)));
      return values.filter(code => allowed.has(String(code)));
    };
    const physicalExceptionRows = standardFamilyRows.filter(row => referenceCaptureKinds.some(kind =>
      Object.prototype.hasOwnProperty.call(row.attrs || {}, kind)));
    const renderVariantEditor = (row, index, isAdditional) => h('div', {
      key: row.rowKey, className: 'p-3 sm:p-4 rounded-xl border border-outline-variant bg-surface-container-low',
      'data-testid': 'family-variant-' + row.rowKey,
    }, [
      h('div', { key: 'head', className: 'flex items-center gap-2 mb-3' }, [
        h('strong', { key: 't', className: 'text-caption text-primary' }, isAdditional
          ? `Variante adicional ${index + 1}` : `Excepción física · ${referenceRowSizeLabel(row, d.sizeCategoryId)}`),
        h('span', { key: 'sp', className: 'flex-1' }),
        isAdditional && !row.id && h('button', { key: 'del', type: 'button', onClick: () => removeFamilyVariant(row),
          className: 'min-h-10 px-3 inline-flex items-center gap-1 text-overline font-bold text-danger border border-outline-variant rounded-lg' }, [h(MS, { key: 'i', name: 'trash', size: 15 }), 'Quitar']),
      ]),
      h('div', { key: 'grid', className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-start' }, [
        isAdditional && field('Talla', h('select', { className: SELECT, value: row.sizeCode, disabled: !!row.id,
          'data-testid': 'family-variant-size-' + row.rowKey, onChange: event => {
            const categoryId = referenceRowCategoryId(row, captureSizeCategoryId || d.sizeCategoryId);
            setFamilyRow(row.rowKey, { sizeCode: event.target.value, sizeCategoryId: categoryId,
              sizeScale: (window.CONFIG.sizeCategories().find(cat => cat.id === categoryId) || {}).scale || row.sizeScale });
          } }, window.CONFIG.list(referenceRowCategoryId(row, captureSizeCategoryId || d.sizeCategoryId)).map(item => {
            const value = String(Object.prototype.hasOwnProperty.call(item.meta || {}, 'value') ? item.meta.value : item.code);
            return h('option', { key: item.code, value }, item.label);
          }))),
        isAdditional && field('Existencia', h('input', { className: INPUT + ' text-right font-mono', type: 'number', min: 0,
          value: row.stockQuantity, 'data-testid': 'family-variant-stock-' + row.rowKey,
          onFocus: event => event.currentTarget.select(), onChange: event => setFamilyRow(row.rowKey, { stockQuantity: event.target.value }) })),
        isAdditional && field('Precio especial', h('input', { className: INPUT + ' text-right font-mono', type: 'number', min: 0,
          value: row.precio, placeholder: String(familyPriceMap()[referenceRowSizeKey(row, d.sizeCategoryId)] ?? d.precio ?? 0),
          'data-testid': 'family-variant-price-' + row.rowKey, onChange: event => setFamilyRow(row.rowKey, { precio: event.target.value }) })),
        isAdditional && h('div', { key: 'colors', className: 'sm:col-span-2 lg:col-span-1 min-w-0' }, [
          h('p', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant uppercase tracking-widest mb-1.5' }, 'Colores de ornamento'),
          renderColorSelector({ pickerId: 'variant-' + row.rowKey, selected: effectiveFamilyColors(row), historicalCodes: historicalFamilyColors(row),
            onToggle: color => {
              const current = effectiveFamilyColors(row);
              setFamilyRow(row.rowKey, { ornamentColorCodes: current.includes(color) ? current.filter(value => value !== color) : current.concat(color) });
            }, optionTestId: color => 'family-variant-' + row.rowKey + '-color-' + color,
            toggleTestId: 'family-variant-' + row.rowKey + '-colors', closeTestId: 'family-variant-' + row.rowKey + '-colors-close' }),
        ]),
        ...referenceCaptureKinds.map(kind => {
          const meta = window.CONFIG.catalogMeta(kind) || {};
          return field((meta.label || kind) + ' especial', h('select', { className: SELECT,
            value: (row.attrs || {})[kind] || '',
            onChange: event => setFamilyRow(row.rowKey, { attrs: { ...(row.attrs || {}), [kind]: event.target.value } }) }, [
            h('option', { key: '', value: '' }, 'Usar valor general'),
            ...window.CONFIG.list(kind).map(item => h('option', { key: item.code, value: item.code }, item.label)),
          ]));
        }),
      ]),
    ]);
    const compactCategoryGroups = Array.from(new Set(standardFamilyRows.map(row => referenceRowCategoryId(row, d.sizeCategoryId)))).map(categoryId => ({
      categoryId,
      label: ((window.CONFIG.sizeCategories ? window.CONFIG.sizeCategories() : []).find(category => category.id === categoryId) || {}).label || categoryId,
      rows: standardFamilyRows.filter(row => referenceRowCategoryId(row, d.sizeCategoryId) === categoryId),
    }));
    const zeroDraftRows = standardFamilyRows.filter(row => !row.id && Number(row.stockQuantity) === 0);
    const renderReferenceFamilyGrid = () => h('div', { key: 'family-grid', 'data-testid': 'reference-family-grid' }, [
      h('p', { key: 'hint', className: 'mb-3 text-caption text-on-surface-variant' }, 'El selector elige las tallas que deseas agregar. Las referencias existentes conservan su identidad; escribir una cantidad activa una talla nueva.'),
      h('div', { key: 'sizes', className: 'space-y-4', 'data-testid': 'family-compact-stock-grid' }, compactCategoryGroups.map(group => h('div', {
        key: group.categoryId, 'data-testid': 'family-size-group-' + group.categoryId,
      }, [
        h('p', { key: 'label', className: 'mb-2 text-overline uppercase tracking-widest text-on-surface-variant font-bold' }, group.label),
        h('div', { key: 'grid', className: 'grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-10 gap-2' }, group.rows.map(row => {
          const index = standardFamilyRows.indexOf(row);
          const active = !!row.selectedForCreation;
          const existing = !!row.id;
          return h('div', { key: row.rowKey, className: 'min-w-0 flex flex-col items-center gap-1', 'data-testid': 'family-row-' + row.rowKey }, [
            h('label', { key: 'l', htmlFor: 'family-stock-' + row.rowKey, className: 'text-overline uppercase text-on-surface-variant font-semibold truncate max-w-full' }, referenceRowSizeLabel(row, d.sizeCategoryId)),
            h('input', { key: 'i', id: 'family-stock-' + row.rowKey, type: 'number', inputMode: 'numeric', min: 0,
              value: row.stockQuantity, 'data-testid': 'family-stock-' + row.rowKey,
              className: 'w-full h-11 text-center bg-surface-container border focus:ring-2 focus:ring-primary text-body rounded-lg font-mono ' + (active ? 'border-outline-variant' : 'border-dashed border-outline-variant text-on-surface-variant'),
              onFocus: event => event.currentTarget.select(),
              onKeyDown: event => {
                if (!['Enter', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return;
                event.preventDefault(); const next = standardFamilyRows[index + (event.key === 'ArrowLeft' ? -1 : 1)];
                if (next) document.querySelector('[data-testid="family-stock-' + next.rowKey + '"]')?.focus();
              },
              onChange: event => setFamilyRow(row.rowKey, { stockQuantity: event.target.value,
                selectedForCreation: active || Number(event.target.value) > 0 }),
            }),
            !existing && active && Number(row.stockQuantity) === 0 && h('span', { key: 'new-zero', className: 'min-h-8 text-[10px] leading-tight text-accent font-bold text-center' }, 'Nueva en 0'),
            existing && Number(row.stockQuantity) === 0 && h('span', { key: 'kept', className: 'min-h-8 text-[10px] leading-tight text-accent font-bold text-center' }, 'Existente en 0'),
          ]);
        })),
      ]))),
      zeroDraftRows.length > 0 && h('div', { key: 'zero-sizes', className: 'mt-4' }, [
        h('button', { key: 'toggle', type: 'button', onClick: () => setZeroSizesOpen(value => !value),
          'aria-expanded': zeroSizesOpen ? 'true' : 'false', 'data-testid': 'family-zero-sizes-toggle',
          className: 'inline-flex items-center gap-2 min-h-10 px-3 border border-outline-variant rounded-lg text-caption font-semibold text-primary' }, [
          h(MS, { key: 'i', name: 'plus', size: 16 }), 'Agregar tallas sin existencia',
        ]),
        zeroSizesOpen && h('div', { key: 'panel', className: 'mt-2 p-3 flex flex-wrap gap-2 rounded-xl border border-outline-variant bg-surface-container-low', 'data-testid': 'family-zero-sizes-panel' }, zeroDraftRows.map(row => h('button', {
          key: row.rowKey, type: 'button', onClick: () => setFamilyRow(row.rowKey, { selectedForCreation: !row.selectedForCreation }),
          'aria-pressed': row.selectedForCreation ? 'true' : 'false', 'data-testid': 'family-zero-toggle-' + row.rowKey,
          className: 'min-h-10 px-3 border rounded-lg text-overline font-bold ' + (row.selectedForCreation ? 'border-primary bg-surface-container text-primary' : 'border-outline-variant bg-surface text-on-surface-variant'),
        }, referenceRowSizeLabel(row, d.sizeCategoryId)))),
      ]),
      h('div', { key: 'variant-actions', className: 'mt-4 pt-4 border-t border-outline-variant' }, [
        h('div', { key: 'bar', className: 'flex flex-wrap items-center gap-2' }, [
          h('button', { key: 'toggle', type: 'button', onClick: () => setVariantsOpen(value => !value),
            'aria-expanded': variantsOpen ? 'true' : 'false', 'data-testid': 'family-variants-toggle',
            className: 'inline-flex items-center gap-2 min-h-10 px-3 border border-outline-variant rounded-lg text-caption font-semibold text-primary' }, [
            h(MS, { key: 'i', name: 'tune', size: 16 }), 'Variantes y excepciones físicas',
            (variantFamilyRows.length + physicalExceptionRows.length) > 0 && h('span', { key: 'count', className: 'px-1.5 rounded-full bg-gold text-on-gold text-overline font-bold' }, variantFamilyRows.length + physicalExceptionRows.length),
          ]),
          h('button', { key: 'add', type: 'button', onClick: () => addFamilyVariant(
            standardFamilyRows.find(row => row.selectedForCreation && referenceRowCategoryId(row, d.sizeCategoryId) === captureSizeCategoryId)
              || standardFamilyRows.find(row => referenceRowCategoryId(row, d.sizeCategoryId) === captureSizeCategoryId)
              || standardFamilyRows.find(row => row.selectedForCreation) || standardFamilyRows[0]),
            'data-testid': 'family-add-variant', className: 'inline-flex items-center gap-1 min-h-10 px-3 border border-primary rounded-lg text-overline font-bold text-primary' }, [h(MS, { key: 'i', name: 'plus', size: 14 }), 'Agregar variante física']),
        ]),
        variantsOpen && h('div', { key: 'body', className: 'mt-3 space-y-3' }, [
          !variantFamilyRows.length && !physicalExceptionRows.length && h('p', { key: 'empty', className: 'p-3 rounded-lg bg-surface-container-low text-caption text-on-surface-variant' }, 'Sin variantes físicas adicionales.'),
          ...physicalExceptionRows.map((row, index) => renderVariantEditor(row, index, false)),
          ...variantFamilyRows.map((row, index) => renderVariantEditor(row, index, true)),
        ]),
      ]),
    ]);
    const renderFamilySummary = () => h('section', { key: 'family-summary', className: 'rounded-xl border border-outline-variant p-4 sm:p-5', 'data-testid': 'reference-family-summary' }, [
      h('div', { key: 'heading', className: 'flex flex-wrap items-center gap-2 mb-3' }, [
        sectionHeading('6', 'product-section-family-summary', 'Resumen efectivo por talla'),
        h('span', { key: 'sp', className: 'flex-1' }),
        h('button', { key: 'details', type: 'button', onClick: () => setSummaryDetailsOpen(value => !value),
          'aria-pressed': summaryDetailsOpen ? 'true' : 'false', 'data-testid': 'family-summary-details-toggle',
          className: 'min-h-10 px-3 border border-outline-variant rounded-lg text-overline font-bold text-primary' }, summaryDetailsOpen ? 'Ocultar detalles' : 'Mostrar detalles'),
      ]),
      h('div', { key: 'totals', className: 'flex flex-wrap gap-2 my-3' }, [
        h('span', { key: 'r', className: 'px-3 py-1 rounded-full bg-primary text-on-primary text-overline font-bold' }, `Referencias: ${selectedFamilyRows.length}`),
        h('span', { key: 'p', className: 'px-3 py-1 rounded-full bg-gold text-on-gold text-overline font-bold' }, `Piezas: ${total}`),
      ]),
      h('div', { key: 'columns', className: 'hidden md:grid grid-cols-[.7fr_.7fr_1.4fr_1fr] gap-3 px-3 py-2 text-overline uppercase tracking-widest text-on-surface-variant border-b border-outline-variant' }, ['Talla', 'Existencia', 'Color orn.', 'Precio'].map(label => h('span', { key: label }, label))),
      ...selectedFamilyRows.map((row, index) => {
        const rowCategoryId = referenceRowCategoryId(row, d.sizeCategoryId);
        const attrs = { ...(d.attrs || {}), ...(row.attrs || {}), __sizeCategoryId: rowCategoryId };
        const candidate = { ...d, ...row, attrs, sizeCategoryId: rowCategoryId,
          ornamentColorCodes: effectiveFamilyColors(row), precio: effectiveFamilyPrice(row), recordModel: 'v2' };
        const sameSize = selectedFamilyRows.filter(item => referenceRowSizeKey(item, d.sizeCategoryId) === referenceRowSizeKey(row, d.sizeCategoryId));
        const variantLabel = sameSize.length > 1 ? ` · ${effectiveFamilyColors(row).join('+') || index + 1}` : '';
        return h('div', { key: row.rowKey, className: 'border-b last:border-0 border-outline-variant text-caption', 'data-testid': 'family-summary-' + row.rowKey }, [
          h('div', { key: 'main', className: 'grid grid-cols-2 md:grid-cols-[.7fr_.7fr_1.4fr_1fr] gap-2 md:gap-3 px-3 py-3 items-center' }, [
          summaryCell('Talla', referenceRowSizeLabel(row, d.sizeCategoryId) + variantLabel, 'font-bold text-primary'),
          summaryCell('Existencia', row.stockQuantity, 'font-mono'),
          summaryCell('Color orn.', effectiveFamilyColors(row).join(' + ') || 'Sin colores'),
          summaryCell('Precio', fmt(effectiveFamilyPrice(row)).replace('.00', ''), 'font-mono font-semibold'),
          ]),
          summaryDetailsOpen && h('div', { key: 'details', className: 'grid grid-cols-1 sm:grid-cols-3 gap-2 px-3 pb-3 text-on-surface-variant' }, [
            summaryCell('Corte', attrs.corte || 'General'),
            summaryCell('Características', attrs.caracteristicas || 'General'),
            summaryCell('SKU', D.sku(candidate), 'font-mono break-all'),
          ]),
        ]);
      }),
    ]);

    const renderSizeSummary = () => h('section', { key: 'summary', className: 'rounded-xl border border-outline-variant p-4 sm:p-5', 'aria-labelledby': 'product-section-summary', 'data-testid': 'product-size-summary' }, [
      h('div', { key: 'heading', className: 'flex flex-wrap items-center gap-2 mb-3' }, [
        sectionHeading('6', 'product-section-summary', 'Resumen efectivo por talla'),
        h('span', { key: 'sp', className: 'flex-1' }),
        h('button', { key: 'all', type: 'button', 'data-testid': 'product-summary-show-all', 'aria-pressed': showAllSummary ? 'true' : 'false', onClick: () => setShowAllSummary(value => !value), className: 'min-h-10 px-3 border border-outline-variant rounded-lg text-overline font-bold text-primary' }, showAllSummary ? 'Ocultar tallas en cero' : 'Mostrar todas'),
      ]),
      h('div', { key: 'columns', className: 'hidden md:grid grid-cols-[.55fr_.75fr_1.1fr_1.3fr_.9fr_1.2fr] gap-3 px-3 py-2 text-overline uppercase tracking-widest text-on-surface-variant border-b border-outline-variant' }, ['Talla', 'Existencia', 'Ornamento', 'Colores efectivos', 'Precio efectivo', 'Estado'].map(label => h('span', { key: label }, label))),
      !relevantSummaryRows.length && h('p', { key: 'empty', className: 'py-5 text-center text-caption text-on-surface-variant' }, 'Captura existencias o excepciones para ver el resumen por talla.'),
      ...relevantSummaryRows.map(row => h('div', { key: row.value, 'data-testid': 'product-size-summary-row-' + row.value, className: 'grid grid-cols-2 md:grid-cols-[.55fr_.75fr_1.1fr_1.3fr_.9fr_1.2fr] gap-2 md:gap-3 px-3 py-3 border-b last:border-b-0 border-outline-variant/70 items-center text-caption' }, [
        summaryCell('Talla', row.label, 'font-bold text-primary'),
        summaryCell('Existencia', row.stock, 'font-mono'),
        summaryCell('Ornamento efectivo', row.ornament),
        summaryCell('Colores efectivos', [row.colors.length ? row.colors.join(' + ') : 'Sin colores', row.colorSpecial && h('span', { key: 'badge', className: 'ml-1 px-1.5 py-0.5 rounded bg-gold/30 text-primary text-overline font-bold' }, 'Especial')]),
        summaryCell('Precio efectivo', [fmt(row.price).replace('.00', ''), row.priceSpecial && h('span', { key: 'badge', className: 'ml-1 px-1.5 py-0.5 rounded bg-gold/30 text-primary text-overline font-bold' }, 'Especial')], 'font-mono font-semibold'),
        summaryCell('Estado', row.errors.length ? row.errors[0].message : (row.colorSpecial || row.priceSpecial ? 'Excepción aplicada' : 'General'), row.errors.length ? 'text-danger font-semibold' : 'text-accent font-semibold'),
      ])),
      !showAllSummary && summaryRows.length > relevantSummaryRows.length && h('p', { key: 'hidden', className: 'mt-2 text-overline text-on-surface-variant text-center' }, (summaryRows.length - relevantSummaryRows.length) + ' talla(s) sin existencia ni excepciones ocultas'),
    ]);

    const summaryCell = (label, content, className) => h('div', { key: label, className: className || '' }, [
      h('span', { key: 'ml', className: 'md:hidden text-overline text-on-surface-variant block' }, label), content,
    ]);

    function submit(afterSave) {
      setAttemptedSubmit(true);
      if (errors.length) { focusError(errors[0]); toast(errors[0].message, 'var(--danger)'); return; }
      const preciosTalla = d.recordModel === 'v2' ? {} : expandirPrecios(d.precioRows.filter(r => (r.tallas || []).length));
      const rawOrnamentColorsBySize = expandirColoresOrnamento(
        d.ornamentColorRows.filter(row => row.tallas.length), d.recordModel === 'v2');
      const { precioRows, ornamentColorRows, ...rest } = d;
      const attrs = { ...(rest.attrs || {}) };
      if (d.recordModel === 'v2') {
        delete attrs.__ornamentColorsBySize;
        const drafts = selectedFamilyRows.map(row => {
          const source = row.source || {};
          const rowCategoryId = referenceRowCategoryId(row, d.sizeCategoryId);
          const candidate = mode === 'edit' && row.id ? { ...source } : { ...rest };
          const candidateAttrs = { ...((source && source.attrs) || attrs), ...(row.attrs || {}) };
          familyCaptureKinds.forEach(kind => {
            const meta = window.CONFIG.catalogMeta(kind) || {};
            if (meta.custom) {
              const nextValue = kind === modeloKind ? modeloFinal : (d.attrs || {})[kind];
              const originalValue = kind === modeloKind ? String(product.modelo || '') : (product.attrs || {})[kind];
              if (mode !== 'edit' || String(nextValue || '') !== String(originalValue || '')) {
                if (nextValue) candidateAttrs[kind] = nextValue; else delete candidateAttrs[kind];
              }
            } else if (meta.field) {
              if (mode !== 'edit' || String(d[meta.field] || '') !== String(product[meta.field] || '')) {
                candidate[meta.field] = d[meta.field];
              }
            }
          });
          if (mode !== 'edit' || d.nombre.trim() !== String(product.nombre || '')) candidate.nombre = d.nombre.trim();
          if (mode !== 'edit' || modeloFinal !== String(product.modelo || '')) candidate.modelo = modeloFinal;
          ['imagen', 'costo', 'pop'].forEach(fieldName => {
            if (mode !== 'edit' || JSON.stringify(d[fieldName]) !== JSON.stringify(product[fieldName])) candidate[fieldName] = d[fieldName];
          });
          const colors = D.ornamentColorMode(d) === 'none' ? [] : effectiveFamilyColors(row);
          return { ...candidate,
            id: row.id || undefined, recordModel: 'v2', referenceFamilyId: familyId,
            barcodeCode: row.barcodeCode || undefined, physicalSignature: row.physicalSignature || undefined,
            physicalIdentityLocked: !!row.physicalIdentityLocked, _syncVersion: Number(row._syncVersion) || 0,
            sizeCategoryId: rowCategoryId, sizeCode: String(row.sizeCode), sizeScale: row.sizeScale,
            stockQuantity: Math.max(0, Math.round(Number(row.stockQuantity) || 0)),
            stock: [{ talla: String(row.sizeCode), escala: row.sizeScale, stock: Math.max(0, Math.round(Number(row.stockQuantity) || 0)) }],
            precio: effectiveFamilyPrice(row), preciosTalla: {}, ornamentColorCodes: colors, ornColors: colors,
            attrs: { ...candidateAttrs, __sizeCategoryId: rowCategoryId }, costo: Number(candidate.costo) || 0,
          };
        });
        onSave(drafts, mode === 'edit' ? 'family-edit' : 'family-new', { openLabels: afterSave === 'labels' });
        return;
      }
      else attrs.__ornamentColorsBySize = D.sanitizeOrnamentColorsBySize(
        rawOrnamentColorsBySize, { ...rest, attrs });
      const referenceShape = d.recordModel === 'v2' ? {
        recordModel: 'v2', sizeCode: String(d.sizeCode), sizeScale: d.sizeScale,
        stockQuantity: Math.max(0, Math.round(Number(d.stockQuantity) || 0)),
        ornamentColorCodes: D.ornamentColorMode(d) === 'none'
          ? [] : D.canonicalReferenceOrnamentColors(d.ornColors),
        stock: [{ talla: String(d.sizeCode), escala: d.sizeScale, stock: Math.max(0, Math.round(Number(d.stockQuantity) || 0)) }],
      } : {};
      onSave({ ...rest, ...referenceShape, attrs, nombre: d.nombre.trim(), modelo: modeloFinal, precio: Number(d.precio) || 0, costo: Number(d.costo) || 0, preciosTalla }, mode, { openLabels: afterSave === 'labels' });
    }

    const footer = [
      h('div', { key: 'sk', className: 'flex-1 min-w-full sm:min-w-[20rem] self-center' }, [
        h('div', { key: 'sku', 'data-testid': 'product-sku-preview', className: 'text-overline uppercase tracking-wider text-primary font-mono font-bold' }, 'SKU: ' + skuPrev),
        h('div', { key: 'sum', className: 'text-overline text-on-surface-variant mt-0.5' }, `${total} piezas · ${stockedSizes} tallas con existencia · ${d.precioRows.filter(row => row.tallas.length).length} precio(s) especial(es) · ${d.ornamentColorRows.filter(row => row.tallas.length).length} grupo(s) de colores`),
        h('button', { key: 'status', type: 'button', 'data-testid': 'product-validation-summary', onClick: () => errors.length && focusError(errors[0]), className: 'mt-1 text-caption font-semibold ' + (errors.length ? 'text-danger' : 'text-accent') }, errors.length ? `${errors.length} pendiente${errors.length === 1 ? '' : 's'} por corregir` : 'Sin errores'),
      ]),
      h('button', { key: 'c', 'data-testid': 'product-cancel', className: 'px-4 sm:px-5 h-11 border border-outline-variant text-on-surface text-caption font-bold uppercase tracking-widest hover:bg-surface-container rounded-lg transition-colors', onClick: requestClose }, 'Cancelar'),
      mode === 'edit' && h('button', { key: 'sl', type: 'button', 'data-testid': 'product-save-labels', className: 'inline-flex items-center gap-2 px-4 h-11 border border-primary text-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:bg-surface-container', onClick: () => submit('labels') }, [h(MS, { key: 'i', name: 'barcode', size: 16 }), 'Guardar y abrir etiquetas']),
      h('button', { key: 's', 'data-testid': 'product-save', className: 'inline-flex items-center gap-2 px-5 h-11 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition', onClick: () => submit() }, [h(MS, { key: 'i', name: 'check', size: 16 }), mode === 'edit' ? 'Guardar cambios' : 'Agregar producto']),
    ];

    return h(Modal, { title: mode === 'edit' ? 'Editar producto' : 'Nuevo producto', onClose: requestClose, footer, large: true, testId: 'product-form', productForm: true }, [
      attemptedSubmit && errors.length ? h('div', { key: 'errors', role: 'alert', className: 'mb-4 p-3 rounded-xl border border-danger/30 bg-danger-soft', 'data-testid': 'product-form-errors' }, [
        h('p', { key: 't', className: 'text-caption font-bold text-danger mb-1' }, `Corrige ${errors.length} pendiente${errors.length === 1 ? '' : 's'} antes de guardar:`),
        ...errors.map(error => h('button', { key: error.code, type: 'button', onClick: () => focusError(error), className: 'block w-full text-left text-caption text-danger hover:underline py-0.5' }, error.message)),
      ]) : null,
      h('section', { key: 'identity', className: 'rounded-xl border border-outline-variant p-4 sm:p-5 mb-4', 'aria-labelledby': 'product-section-identity' }, [
        sectionHeading('1', 'product-section-identity', 'Identidad y precio general'),
        h('div', { key: 'content', className: 'flex flex-col sm:flex-row gap-4' }, [
          h('div', { key: 'img', className: 'flex sm:flex-col items-center gap-3 sm:w-28 shrink-0' }, [
            h('div', { key: 'pv', className: 'w-16 h-20 sm:w-20 sm:h-24 rounded-lg overflow-hidden shrink-0 border border-outline-variant bg-surface-container grid place-items-center' }, imgSrc ? h('img', { src: imgSrc, className: 'w-full h-full object-cover', alt: 'Vista previa del producto' }) : h(MS, { name: 'shirt', size: 26, className: 'text-on-surface-variant/40' })),
            h('input', { key: 'f', ref: fileRef, type: 'file', accept: 'image/*', className: 'hidden', onChange: onPickImg }),
            h('div', { key: 'buttons', className: 'flex sm:flex-col gap-2' }, [
              h('button', { key: 'u', type: 'button', className: 'px-3 min-h-10 border border-outline-variant rounded-lg text-overline font-bold text-primary', onClick: () => fileRef.current && fileRef.current.click() }, d.imagen ? 'Cambiar foto' : 'Agregar foto'),
              d.imagen && h('button', { key: 'x', type: 'button', className: 'px-3 min-h-10 text-overline text-danger', onClick: () => set('imagen', '') }, 'Quitar'),
            ]),
          ]),
          h('div', { key: 'fields', className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 flex-1' }, [
            field('Nombre / Modelo', modeloKind
              ? h('select', { className: INPUT, value: modeloCode, 'data-testid': 'product-name', 'data-autofocus': true, onChange: e => setModelo(e.target.value) }, [h('option', { key: '', value: '' }, 'Selecciona…'), ...modeloItems.map(it => h('option', { key: it.code, value: it.code }, it.label))])
              : h('input', { className: INPUT, value: d.nombre, 'data-testid': 'product-name', 'data-autofocus': true, placeholder: 'Ej. Tira Red', onChange: e => set('nombre', e.target.value) }), 'wide', attemptedSubmit && errors.find(error => error.code === 'name')),
            field('No. Modelo', modeloKind
              ? h('input', { className: INPUT + ' opacity-70', value: modeloCode || d.modelo, 'data-testid': 'product-model', readOnly: true, tabIndex: -1 })
              : h('input', { className: INPUT, value: d.modelo, 'data-testid': 'product-model', placeholder: '128', onChange: e => set('modelo', e.target.value) }), null, attemptedSubmit && errors.find(error => error.code === 'model'), modeloKind ? 'Se llena automáticamente al elegir el modelo.' : null),
            field('Precio general', h('input', { className: INPUT, type: 'number', min: 0, value: d.precio, 'data-testid': 'product-general-price', onChange: e => set('precio', e.target.value) })),
          ]),
        ]),
      ]),
      h('section', { key: 'features', className: 'rounded-xl border border-outline-variant p-4 sm:p-5 mb-4', 'aria-labelledby': 'product-section-features' }, [
        sectionHeading('2', 'product-section-features', 'Características generales'),
        h('div', { key: 'grid', className: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' }, [
          ...[
            { kind: 'category', field: 'cat', map: D.CAT }, { kind: 'sleeve', field: 'manga', map: D.MANGA },
            { kind: 'fabric', field: 'tela', map: D.TELA }, { kind: 'color', field: 'color', map: D.COLOR_NAME, useKeyAsValue: true },
            { kind: 'neck', field: 'cuello', map: D.CUELLO },
          ].filter(a => { const m = window.CONFIG.catalogMeta(a.kind); return !m || m.inForm; }).map(a => field(window.CONFIG.catalogLabel(a.kind), sel(d[a.field], a.map, value => set(a.field, value), a.useKeyAsValue, 'product-field-' + a.kind), null, attemptedSubmit && errors.find(error => error.code === 'catalog-' + a.kind))),
          ...Object.keys(window.CONFIG.allCatalogMeta ? window.CONFIG.allCatalogMeta() : {}).filter(kind => { const meta = window.CONFIG.catalogMeta(kind); return meta && meta.custom && meta.inForm && kind !== modeloKind; }).map(kind => field(window.CONFIG.catalogLabel(kind) + (d.recordModel === 'v2' && (window.CONFIG.catalogMeta(kind) || {}).captureScope === 'reference' ? ' general' : ''), sel((d.attrs || {})[kind] || '', window.CONFIG.map(kind), value => setAttr(kind, value), false, 'product-field-' + kind), null, attemptedSubmit && errors.find(error => error.code === 'catalog-' + kind), d.recordModel === 'v2' && (window.CONFIG.catalogMeta(kind) || {}).captureScope === 'reference' ? 'Se aplica a todas las tallas salvo una variante física.' : null)),
        ]),
      ]),
      h('section', { key: 'ornament', className: 'rounded-xl border border-outline-variant p-4 sm:p-5 mb-4', 'aria-labelledby': 'product-section-ornament' }, [
        sectionHeading('3', 'product-section-ornament', 'Ornamento general'),
        h('div', { key: 'grid', className: 'grid grid-cols-1 lg:grid-cols-3 gap-4 items-start' }, [
          field(window.CONFIG.catalogLabel('ornament'), sel(d.orn || '—', window.CONFIG.map('ornament'), value => {
            setD(prev => ({ ...prev, orn: value,
              ...(D.ornamentColorMode(value) === 'none' ? { ornColors: [], ornamentColorCodes: [] } : {}) }));
            setColorPicker(null);
          }, false, 'product-ornament'), null, attemptedSubmit && errors.find(error => error.code === 'catalog-ornament')),
          D.ornamentSupportsColors(d) && h('div', { key: 'colors', className: 'lg:col-span-2' }, [
            h('p', { key: 'label', className: 'text-caption font-semibold text-on-surface-variant uppercase tracking-widest mb-1.5' }, 'Colores generales del ornamento'),
            renderColorSelector({ pickerId: 'general', selected: d.ornColors,
              historicalCodes: mode === 'edit' ? (product.ornamentColorCodes || product.ornColors || []) : [],
              onToggle: toggleOrn, optionTestId: code => `product-general-color-${code}`, toggleTestId: 'general-color-selector-toggle', closeTestId: 'general-color-selector-close' }),
            attemptedSubmit && errors.find(error => error.code === 'ornament-color-required')
              ? h('p', { key: 'required-error', className: 'mt-2 text-caption text-danger', role: 'alert' }, errors.find(error => error.code === 'ornament-color-required').message) : null,
            h('p', { key: 'help', className: 'text-overline text-on-surface-variant/70 mt-2' }, 'Todas las tallas heredan estos colores salvo que tengan una excepción.'),
          ]),
          !D.ornamentSupportsColors(d) && h('p', { key: 'none', className: 'lg:col-span-2 text-caption text-on-surface-variant self-end pb-3' }, 'Este ornamento no utiliza colores de hilo.'),
        ]),
      ]),
      h('section', { key: 'stock', className: 'rounded-xl border border-outline-variant p-4 sm:p-5 mb-4', 'aria-labelledby': 'product-section-stock' }, [
        h('div', { key: 'heading', className: 'flex flex-wrap items-center gap-2 mb-4' }, [
          sectionHeading('4', 'product-section-stock', 'Tallas y existencias'),
          h('span', { key: 'sp', className: 'flex-1' }),
          h('span', { key: 'total', className: 'px-2.5 py-1 text-overline uppercase rounded bg-gold text-on-gold font-bold' }, total + ' pz en total'),
        ]),
        h('div', { key: 'category', className: 'max-w-sm mb-4' }, field(d.recordModel === 'v2' ? 'Tallas para agregar' : 'Familia de tallas', h('select', {
          className: SELECT, value: d.recordModel === 'v2' ? captureSizeCategoryId : d.sizeCategoryId, 'data-testid': 'product-size-category',
          onChange: event => requestSizeCategory(event.target.value),
        }, [
          h('option', { key: '', value: '' }, 'Selecciona…'),
          ...(window.CONFIG.sizeCategories ? window.CONFIG.sizeCategories() : []).map(category => h('option', { key: category.id, value: category.id }, category.label)),
        ]), d.recordModel === 'v2' ? 'Cambiar este selector no modifica referencias existentes; sólo muestra otro conjunto para agregar.' : null,
        attemptedSubmit && errors.find(error => error.code === 'size-category'))),
        d.recordModel === 'v2' ? renderReferenceFamilyGrid() : h('div', { key: d.sizeCategoryId || 'none', className: 'grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-10 gap-2' }, d.stock.map((row, index) => {
          const id = 'product-stock-' + row.talla;
          return h('div', { key: String(row.talla), className: 'flex flex-col items-center gap-1' }, [
            h('label', { key: 'l', htmlFor: id, className: 'text-overline uppercase text-on-surface-variant font-semibold' }, tallaLabel(d, row.talla)),
            h('input', {
              key: 'i', id, type: 'number', inputMode: 'numeric', min: 0, value: row.stock, 'data-testid': id,
              className: 'w-full h-11 text-center bg-surface-container border border-outline-variant focus:ring-2 focus:ring-primary text-body rounded-lg font-mono',
              onFocus: event => event.currentTarget.select(),
              onKeyDown: event => {
                if (!['Enter', 'ArrowRight', 'ArrowLeft'].includes(event.key)) return;
                event.preventDefault();
                const next = d.stock[index + (event.key === 'ArrowLeft' ? -1 : 1)];
                if (next) { const target = document.querySelector('[data-testid="product-stock-' + next.talla + '"]'); if (target) target.focus(); }
              },
              onChange: event => setStock(row.talla, row.escala, event.target.value),
            }),
          ]);
        })),
      ]),
      h('section', { key: 'exceptions', className: 'rounded-xl border border-outline-variant mb-4 overflow-hidden', 'aria-labelledby': 'product-section-exceptions' }, [
        h('button', {
          key: 'toggle', type: 'button', 'data-testid': 'product-exceptions-toggle',
          'aria-expanded': exceptionsOpen ? 'true' : 'false', onClick: () => setExceptionsOpen(value => !value),
          className: 'w-full flex flex-wrap items-center gap-3 p-4 sm:p-5 text-left hover:bg-surface-container-low transition-colors',
        }, [
          h('span', { key: 'n', className: 'w-7 h-7 rounded-full bg-primary text-on-primary grid place-items-center text-caption font-bold' }, '5'),
          h('span', { key: 'title', id: 'product-section-exceptions', className: 'font-headline text-title text-primary' }, 'Excepciones por talla'),
          h('span', { key: 'count', className: 'text-overline text-on-surface-variant' }, d.ornamentColorRows.filter(row => row.tallas.length).length + ' de colores · ' + d.precioRows.filter(row => row.tallas.length).length + ' de precio'),
          h('span', { key: 'sp', className: 'flex-1' }),
          h(MS, { key: 'chev', name: 'chevDown', size: 18, style: { transform: exceptionsOpen ? 'rotate(180deg)' : '' } }),
        ]),
        exceptionsOpen && h('div', { key: 'body', className: 'border-t border-outline-variant p-4 sm:p-5 grid grid-cols-1 xl:grid-cols-2 gap-5' }, [
          renderColorExceptions(),
          renderPriceExceptions(),
        ]),
      ]),
      d.recordModel === 'v2' ? renderFamilySummary() : renderSizeSummary(),
    ]);
  }

  function sel(value, map, onChange, useKeyAsValue, testId) {
    const opts = Object.entries(map).map(([k, v]) => h('option', { key: k, value: k }, useKeyAsValue ? `${v} (${k})` : v));
    // Valor huérfano (código guardado que ya no existe en el catálogo): opción visible con aviso.
    // Sin esto, el <select> muestra la PRIMERA opción aunque el estado conserve el código viejo,
    // y el capturista guarda sin darse cuenta (SKU/atributos huérfanos, p. ej. cat '21').
    if (!(value in map)) opts.unshift(h('option', { key: '__orphan', value }, value ? `⚠ ${value} — ya no existe, elige otro` : 'Selecciona…'));
    return h('select', { className: SELECT, value, onChange: e => onChange(e.target.value), 'data-testid': testId }, opts);
  }
  function field(label, control, mod, error, help) {
    const id = control.props.id || control.props['data-testid'];
    const errorMessage = typeof error === 'string' ? error : error && error.message;
    const descriptionId = id && (errorMessage || help) ? id + (errorMessage ? '-error' : '-help') : undefined;
    return h('div', { key: label, className: mod === 'wide' ? 'sm:col-span-2 lg:col-span-1' : '' }, [
      h('label', { key: 'l', htmlFor: id, className: 'block text-caption font-semibold text-on-surface-variant uppercase tracking-widest mb-1.5' }, label),
      React.cloneElement(control, {
        key: 'c', id,
        'aria-invalid': errorMessage ? 'true' : undefined,
        'aria-describedby': descriptionId,
      }),
      errorMessage && h('p', { key: 'e', id: id + '-error', role: 'alert', className: 'mt-1.5 text-caption font-semibold text-danger', 'data-testid': id + '-error' }, errorMessage),
      !errorMessage && help && h('p', { key: 'h', id: id + '-help', className: 'mt-1.5 text-caption text-on-surface-variant' }, help),
    ]);
  }

  // ── Etiquetas de código de barras (impresión 6×4 cm + guardado opcional en Supabase) ──
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  const LBL_OPTS = { height: 60, fontSize: 13, margin: 4 }; // ajuste del código para la vista previa
  // Las barras no imprimen su valor. El único texto técnico visible es el SKU comercial.
  const PRINT_OPTS = Object.assign({}, LBL_OPTS, { displayValue: false });

  // La etiqueta reserva 56 mm útiles. En monospace, un carácter ocupa cerca de
  // 0.62 em; este cálculo elige la mayor tipografía que cabe en una sola línea.
  // No cambia, corta ni reinterpreta el SKU: sólo proyecta su longitud.
  function labelSkuFontPt(sku) {
    const chars = Math.max(1, Array.from(String(sku || '')).length);
    const usablePx = 56 * 96 / 25.4;
    return Math.min(12.5, usablePx * 0.75 / (chars * 0.62));
  }

  // H-99: ésta es la única autoridad visual de la etiqueta. El documento usa
  // estas dimensiones físicas y el preview escala el bloque completo, sin
  // recalcular ninguna zona ni tipografía.
  const LABEL_LAYOUT_CSS = `
    .bx-label,.bx-label *{box-sizing:border-box}.bx-label{width:60mm;height:40mm;background:white;color:#111827;overflow:hidden;page-break-after:always;font-family:Arial,sans-serif}.bx-artwork{display:block;width:60mm;height:40mm}.bx-name{font-family:Arial,sans-serif;font-weight:700}.bx-img{display:block}.bx-meta{font-family:monospace;font-weight:600;white-space:nowrap}.bx-price{font-family:Arial,sans-serif;font-weight:900}`;

  const LABEL_WIDTH_MM = 60;
  const LABEL_HEIGHT_MM = 40;
  const PDF_WIDTH_PT = LABEL_WIDTH_MM * 72 / 25.4;
  const PDF_HEIGHT_PT = LABEL_HEIGHT_MM * 72 / 25.4;
  const ptToMm = pt => Number(pt) * 25.4 / 72;

  function labelSvg(item) {
    const skuPt = labelSkuFontPt(item.sku).toFixed(2);
    return `<svg class="bx-artwork" data-label-artwork="h99" xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40" role="img" aria-label="Etiqueta ${escapeHtml(item.sku)}"><rect width="60" height="40" fill="#fff"/><text class="bx-name" data-label-part="name" data-font-pt="14" x="30" y="4.15" fill="#111827" font-family="Arial,sans-serif" font-size="${ptToMm(14).toFixed(5)}" font-weight="700" text-anchor="middle" dominant-baseline="middle">${escapeHtml(item.name)}</text><image class="bx-img" data-testid="label-preview-barcode" data-label-part="barcode" x="2" y="7.3" width="56" height="15" preserveAspectRatio="xMidYMid meet" href="${item.image}"/><text class="bx-meta" data-label-part="sku" data-font-pt="${skuPt}" x="30" y="25.5" fill="#111827" font-family="monospace" font-size="${ptToMm(skuPt).toFixed(5)}" font-weight="600" text-anchor="middle" dominant-baseline="middle">${escapeHtml(item.sku)}</text>${item.price ? `<text class="bx-price" data-label-part="price" data-font-pt="20" x="30" y="34" fill="#111827" font-family="Arial,sans-serif" font-size="${ptToMm(20).toFixed(5)}" font-weight="900" text-anchor="middle" dominant-baseline="middle">${escapeHtml(item.price)}</text>` : ''}</svg>`;
  }

  function labelMarkup(item) {
    return `<div class="bx-label" data-testid="label-master">${labelSvg(item)}</div>`;
  }

  function concatBytes(parts) {
    const size = parts.reduce((total, part) => total + part.length, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    parts.forEach(part => { output.set(part, offset); offset += part.length; });
    return output;
  }

  const asciiBytes = value => new TextEncoder().encode(String(value));
  function pdfText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
  }

  async function labelJpeg(item) {
    const svgBlob = new Blob([labelSvg(item)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('No se pudo renderizar la etiqueta para PDF'));
        image.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = 720; canvas.height = 480;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo codificar la etiqueta para PDF')), 'image/jpeg', 0.96));
      return new Uint8Array(await jpeg.arrayBuffer());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function buildLabelPdf(rendered) {
    if (!rendered.length) throw new Error('No hay etiquetas para generar el PDF');
    // Secuencial para que lotes grandes no mantengan decenas de canvas activos
    // al mismo tiempo en móviles; el PDF sigue siendo un solo archivo.
    const images = [];
    for (const item of rendered) images.push(await labelJpeg(item));
    const objects = [];
    const pageIds = rendered.map((_, index) => 4 + index * 3);
    objects[1] = asciiBytes('<< /Type /Catalog /Pages 2 0 R >>');
    objects[2] = asciiBytes(`<< /Type /Pages /Count ${rendered.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`);
    objects[3] = asciiBytes('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    rendered.forEach((item, index) => {
      const pageId = pageIds[index], imageId = pageId + 1, contentId = pageId + 2;
      const metadata = `${pdfText(item.name)} | ${pdfText(item.sku)}${item.price ? ` | ${pdfText(item.price)}` : ''}`;
      const content = asciiBytes(`q\n${PDF_WIDTH_PT.toFixed(5)} 0 0 ${PDF_HEIGHT_PT.toFixed(5)} 0 0 cm\n/Im0 Do\nQ\nBT /F1 1 Tf 3 Tr 1 0 0 1 0 0 Tm (${metadata}) Tj ET`);
      objects[pageId] = asciiBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH_PT.toFixed(5)} ${PDF_HEIGHT_PT.toFixed(5)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
      objects[imageId] = concatBytes([
        asciiBytes(`<< /Type /XObject /Subtype /Image /Width 720 /Height 480 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${images[index].length} >>\nstream\n`),
        images[index], asciiBytes('\nendstream'),
      ]);
      objects[contentId] = concatBytes([asciiBytes(`<< /Length ${content.length} >>\nstream\n`), content, asciiBytes('\nendstream')]);
    });
    const chunks = [asciiBytes('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')];
    const offsets = [0];
    let cursor = chunks[0].length;
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = cursor;
      const object = concatBytes([asciiBytes(`${id} 0 obj\n`), objects[id], asciiBytes('\nendobj\n')]);
      chunks.push(object); cursor += object.length;
    }
    const xrefOffset = cursor;
    const xref = [`xref\n0 ${objects.length}\n0000000000 65535 f \n`];
    for (let id = 1; id < objects.length; id++) xref.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
    xref.push(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
    chunks.push(asciiBytes(xref.join('')));
    return new Blob([concatBytes(chunks)], { type: 'application/pdf' });
  }

  function safeFilePart(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'Etiqueta';
  }
  function localDateStamp(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }
  function labelPdfFileName(products) {
    if ((products || []).length === 1) return `BALAM_${safeFilePart(products[0].nombre)}_${safeFilePart(products[0].sku)}.pdf`;
    return `BALAM_Etiquetas_${localDateStamp(new Date())}.pdf`;
  }
  function downloadLabelPdf(asset) {
    const url = URL.createObjectURL(asset.blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = asset.fileName; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function LabelPreview({ item }) {
    const stageRef = useRef(null);
    const labelRef = useRef(null);
    const [scale, setScale] = useState(1);
    useEffect(() => {
      const stage = stageRef.current;
      const label = labelRef.current && labelRef.current.firstElementChild;
      if (!stage || !label) return undefined;
      const fit = () => setScale(Math.min(stage.clientWidth / label.offsetWidth, stage.clientHeight / label.offsetHeight));
      fit();
      if (typeof ResizeObserver === 'undefined') return undefined;
      const observer = new ResizeObserver(fit);
      observer.observe(stage);
      return () => observer.disconnect();
    }, [item.image, item.name, item.sku, item.price]);
    return h('div', {
      ref: stageRef,
      className: 'relative w-full overflow-hidden bg-white border border-outline-variant',
      style: { aspectRatio: '3 / 2' },
      'data-testid': 'label-preview-stage',
    }, h('div', {
      ref: labelRef,
      style: { transform: `scale(${scale})`, transformOrigin: 'top left' },
      dangerouslySetInnerHTML: { __html: labelMarkup(item) },
    }));
  }

  function buildLabelDocument(rendered) {
    const labels = rendered.map(labelMarkup).join('');
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Etiquetas Balam</title><style>
      @page { size: 60mm 40mm; margin: 0; } *{box-sizing:border-box} body{margin:0;font-family:system-ui,sans-serif;background:#eef0f4}.bx-tools{position:sticky;top:0;z-index:2;display:flex;gap:8px;flex-wrap:wrap;padding:12px;background:#131b2e;color:white}.bx-tools button{min-height:44px;padding:0 16px;border:0;border-radius:8px;font-weight:700}.bx-sheet{display:flex;flex-wrap:wrap;gap:12px;padding:16px}${LABEL_LAYOUT_CSS}@media(max-width:600px){.bx-sheet{padding:8px;justify-content:center}}@media print{body{background:white}.bx-tools{display:none}.bx-sheet{display:block;padding:0}.bx-label{margin:0}}
    </style></head><body><div class="bx-tools"><button id="print" type="button" onclick="window.print()">Imprimir</button><button type="button" onclick="window.close()">Cerrar</button><span>${rendered.length} etiqueta(s) · 60×40 mm</span></div><main class="bx-sheet">${labels}</main></body></html>`;
  }

  function LabelModal({ products, onClose }) {
    const B = window.BARCODES;
    const [copiesMode, setCopiesMode] = useState('one'); // 'one' | 'stock'
    const [copies, setCopies] = useState(1);
    const [withPrice, setWithPrice] = useState(true);
    const [saving, setSaving] = useState(false);
    const [pdfAsset, setPdfAsset] = useState(null);
    const [pdfError, setPdfError] = useState('');
    const [selectedProductIds, setSelectedProductIds] = useState(() => new Set((products || []).map(product => product.id)));
    const imageCache = useRef({});
    const pdfGeneration = useRef(0);

    const specs = [];
    (products || []).filter(p => selectedProductIds.has(p.id)).forEach(p => D.resolveProductSizes(p).sizes.forEach(size => {
      if (size.active && size.stock > 0) {
        specs.push({ p, talla: size.value, stock: size.stock, code: B.codeOf(p, size.value) });
      }
    }));
    const copiesOf = s => copiesMode === 'stock' ? s.stock : Math.max(1, Number(copies) || 1);
    const totalLabels = specs.reduce((a, s) => a + copiesOf(s), 0);
    const uniqueCount = new Set(specs.map(s => s.code)).size;
    const pdfKey = [copiesMode, copies, withPrice ? 'price' : 'no-price', specs.map(s => `${s.p.id}:${s.talla}:${s.stock}:${s.code}:${D.listPrice(s.p, s.talla)}`).join('|')].join('::');

    useEffect(() => {
      if (!B || !B.ready || !B.ready() || !specs.length) return undefined;
      const generation = ++pdfGeneration.current;
      setPdfAsset(null); setPdfError('');
      const rendered = renderItems();
      buildLabelPdf(rendered).then(blob => {
        if (generation === pdfGeneration.current) setPdfAsset({ blob, fileName: labelPdfFileName(products), rendered });
      }).catch(error => {
        if (generation === pdfGeneration.current) setPdfError((error && error.message) || 'No se pudo generar el PDF');
      });
      return () => { if (generation === pdfGeneration.current) pdfGeneration.current++; };
    }, [pdfKey]);

    if (!B || !B.ready()) return h(Modal, { title: 'Etiquetas', onClose }, h('p', { className: 'text-body text-on-surface-variant py-6 text-center' }, 'La librería de códigos de barras no cargó. Revisa tu conexión e inténtalo de nuevo.'));
    if (!specs.length) return h(Modal, { title: 'Etiquetas', onClose }, h('p', { className: 'text-body text-on-surface-variant py-6 text-center' }, 'No hay tallas con existencias para etiquetar.'));

    function labelItem(s) {
      if (imageCache.current[s.code] === undefined) imageCache.current[s.code] = B.toPNGDataURL(s.code, PRINT_OPTS);
      return { name: s.p.nombre, image: imageCache.current[s.code], barcode: s.code, sku: D.materializedSku(s.p, s.talla), price: withPrice ? fmt(D.listPrice(s.p, s.talla)).replace('.00', '') : '' };
    }

    function renderItems() {
      const rendered = [];
      specs.forEach(s => {
        const one = labelItem(s);
        for (let i = 0; i < copiesOf(s); i++) rendered.push(one);
      });
      return rendered;
    }
    function renderDocument() {
      return buildLabelDocument(renderItems());
    }
    function openPrintableView() {
      const win = window.open('', '_blank', 'width=520,height=680');
      if (!win) { toast('El navegador bloqueó la vista imprimible. Usa Descargar.', 'var(--danger)'); return; }
      win.document.write(renderDocument());
      win.document.close();
    }
    const validations = specs.map(s => ({ ...s, validation: B.validateLabelCode(s.code) }));
    const riskyCodes = validations.filter(item => !item.validation.ok);

    async function saveToSupabase() {
      if (saving) return;
      if (!window.STORE) { toast('Sincronización con la nube no disponible', 'var(--danger)'); return; }
      if (!(await window.STORE.hasSession())) { toast('Inicia sesión para guardar imágenes en la nube', 'var(--danger)'); return; }
      setSaving(true);
      let okN = 0, failN = 0; const seen = {};
      for (const s of specs) {
        if (seen[s.code]) continue; seen[s.code] = true;
        try {
          const blob = await B.toPNGBlob(s.code, PRINT_OPTS);
          const urlPub = await window.STORE.uploadBarcode(s.code + '.png', blob);
          if (!s.p.barcodeUrls) s.p.barcodeUrls = {};
          s.p.barcodeUrls[s.talla] = urlPub;
          okN++;
        } catch (e) { failN++; }
      }
      D.saveProducts([...new Set(specs.map(spec => spec.p.id))]);
      setSaving(false);
      toast(failN ? `Guardadas ${okN}, fallaron ${failN}. Error al guardar imagen del código; intenta regenerarlo.` : `${okN} ${okN === 1 ? 'imagen guardada' : 'imágenes guardadas'} en Supabase`, failN ? 'var(--danger)' : 'var(--accent)');
    }

    const seg = (val, on, label) => h('button', { key: val, 'data-testid': `labels-copies-${val}`, onClick: () => setCopiesMode(val), className: 'px-3 py-1.5 rounded-md text-caption font-semibold transition-colors ' + (on ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-primary') }, label);
    const preview = specs.slice(0, 4).map(labelItem);
    const canSharePdf = !!(pdfAsset && navigator.share && navigator.canShare && navigator.canShare({ files: [new File([pdfAsset.blob], pdfAsset.fileName, { type: 'application/pdf' })] }));
    function sharePdf() {
      if (!pdfAsset || !canSharePdf) return;
      const file = new File([pdfAsset.blob], pdfAsset.fileName, { type: 'application/pdf' });
      navigator.share({ files: [file], title: 'Etiquetas Balam' }).catch(error => {
        if (!error || error.name !== 'AbortError') toast('No se pudo compartir el PDF. Usa Descargar PDF.', 'var(--danger)');
      });
    }
    const footer = [
      h('button', { key: 'sv', disabled: saving, onClick: saveToSupabase, className: 'px-5 py-3 border border-outline-variant rounded-xl text-caption font-bold uppercase tracking-widest text-primary hover:bg-surface-container transition disabled:opacity-50 flex items-center gap-2' }, [h(MS, { key: 'i', name: saving ? 'clock' : 'upload', size: 16 }), saving ? 'Guardando…' : `Guardar en Supabase (${uniqueCount})`]),
      h('button', { key: 'dl', disabled: !pdfAsset, onClick: () => downloadLabelPdf(pdfAsset), 'data-testid': 'labels-download', className: 'px-5 py-3 border border-outline-variant rounded-xl text-caption font-bold uppercase tracking-widest text-primary hover:bg-surface-container transition disabled:opacity-50 flex items-center gap-2' }, [h(MS, { key: 'i', name: pdfAsset ? 'download' : 'clock', size: 16 }), pdfAsset ? 'Descargar PDF' : 'Generando PDF…']),
      canSharePdf && h('button', { key: 'sh', onClick: sharePdf, 'data-testid': 'labels-share', className: 'px-5 py-3 border border-outline-variant rounded-xl text-caption font-bold uppercase tracking-widest text-primary hover:bg-surface-container transition flex items-center gap-2' }, [h(MS, { key: 'i', name: 'share', size: 16 }), 'Compartir PDF']),
      h('button', { key: 'pr', onClick: openPrintableView, 'data-testid': 'labels-open-printable', className: 'px-6 py-3 bg-primary text-on-primary rounded-xl text-caption font-bold uppercase tracking-widest hover:opacity-90 transition flex items-center gap-2' }, [h(MS, { key: 'i', name: 'print', size: 16 }), `Abrir vista imprimible (${totalLabels})`]),
    ].filter(Boolean);

    return h(Modal, { title: 'Etiquetas de código de barras', onClose, footer, testId: 'label-modal', large: true }, [
      h('div', { key: 'cfg', className: 'space-y-4 mb-5' }, [
        (products || []).length > 1 && h('fieldset', { key: 'refs', className: 'rounded-xl border border-outline-variant p-3', 'data-testid': 'label-family-references' }, [
          h('legend', { key: 'l', className: 'px-1 text-overline font-bold uppercase text-on-surface-variant' }, 'Referencias a imprimir'),
          h('div', { key: 'g', className: 'grid sm:grid-cols-2 gap-2' }, products.map(product => h('label', { key: product.id, className: 'flex items-center gap-2 min-h-11 cursor-pointer' }, [
            h('input', { key: 'i', type: 'checkbox', checked: selectedProductIds.has(product.id), 'data-testid': 'label-reference-select-' + product.id,
              onChange: event => setSelectedProductIds(current => { const next = new Set(current); if (event.target.checked) next.add(product.id); else if (next.size > 1) next.delete(product.id); return next; }) }),
            h('span', { key: 't', className: 'text-caption text-primary' }, `${product.sizeCode} · ${product.sku}`),
          ]))),
        ]),
        h('div', { key: 'r1', className: 'flex items-center justify-between gap-4' }, [
          h('span', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant' }, 'Copias'),
          h('div', { key: 's', className: 'inline-flex bg-surface-container-low p-1 rounded-lg' }, [seg('one', copiesMode === 'one', '1 por talla'), seg('stock', copiesMode === 'stock', 'Una por pieza (stock)')]),
        ]),
        copiesMode === 'one' && h('div', { key: 'r2', className: 'flex items-center justify-between gap-4' }, [
          h('span', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant' }, 'Copias por talla'),
          h('input', { key: 'i', type: 'number', min: 1, value: copies, onChange: e => setCopies(e.target.value), 'data-testid': 'labels-copies-input', className: 'w-24 bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-body text-right focus:ring-1 focus:ring-primary' }),
        ]),
        h('label', { key: 'r3', className: 'flex items-center justify-between gap-4 cursor-pointer' }, [
          h('span', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant' }, 'Incluir precio en la etiqueta'),
          h('input', { key: 'i', type: 'checkbox', checked: withPrice, onChange: e => setWithPrice(e.target.checked), className: 'w-5 h-5 rounded border-outline text-primary focus:ring-primary' }),
        ]),
        h('p', { key: 'sum', className: 'text-caption text-on-surface-variant' }, `${specs.length} talla(s) con existencias · ${totalLabels} etiqueta(s) a imprimir`),
        pdfError && h('div', { key: 'pdf-error', role: 'alert', 'data-testid': 'labels-pdf-error', className: 'p-3 rounded-lg bg-danger-soft text-danger text-caption' }, `${pdfError}. Puedes mantener abierta la vista imprimible e intentarlo de nuevo.`),
        riskyCodes.length > 0 && h('div', { key: 'warn', role: 'alert', 'data-testid': 'labels-legibility-warning', className: 'p-3 rounded-lg bg-warning-soft text-warning text-caption' }, `${riskyCodes.length} código(s) son demasiado largos para una lectura Code128 robusta en 60×40 mm. En V2 revisa el barcode logístico; en etiquetas V1 acorta el SKU o valida una muestra con tu lector.`),
      ]),
      h('div', { key: 'pv', className: 'border-t border-outline-variant pt-4' }, [
        h('style', { key: 'css' }, LABEL_LAYOUT_CSS),
        h('p', { key: 'l', className: 'text-overline uppercase font-bold text-on-surface-variant tracking-widest mb-3' }, 'Vista previa'),
        h('div', { key: 'g', className: 'grid grid-cols-1 sm:grid-cols-2 gap-3' }, preview.map((item, index) => h(LabelPreview, { key: `${item.barcode}-${index}`, item }))),
        specs.length > preview.length && h('p', { key: 'm', className: 'text-caption text-on-surface-variant mt-2' }, `…y ${specs.length - preview.length} más`),
      ]),
    ]);
  }

  window.InventoryScreen = InventoryScreen;
})();
