// inventory.jsx — Inventario (Heritage Luxury). Exporta window.InventoryScreen
(function () {
  const { useState, useMemo, useRef, useEffect } = React;
  const { fmt, Modal, toast, Pager } = window.UI;
  const { MS, ProductImage } = window.HX;
  const D = window.DATA;
  const h = React.createElement;

  const ESCALAS = [['L', 'Letras'], ['N', 'Números']];
  // Nombre visible de una talla según el catálogo (size_letter/size_number). Si se renombró en
  // Configuración, aquí se refleja; si no existe, cae al código.
  const tallaLabel = (talla, escala) => {
    const m = window.CONFIG.map(escala === 'N' ? 'size_number' : 'size_letter');
    return (m[talla] != null && m[talla] !== '') ? m[talla] : talla;
  };
  // Alinea el stock de un producto al catálogo de tallas VIGENTE: conserva cantidades por talla,
  // agrega las tallas nuevas en 0 y omite las que ya no existen. Misma lógica que D.hydrate.
  const alignStock = (existing) => {
    const by = {}; (existing || []).forEach(v => { by[v.escala + v.talla] = v.stock; });
    return window.DATA.SIZES_LETRA.map(t => ({ talla: t, escala: 'L', stock: by['L' + t] || 0 }))
      .concat(window.DATA.SIZES_NUM.map(t => ({ talla: t, escala: 'N', stock: by['N' + t] || 0 })));
  };
  const CARD = 'bg-surface-container-lowest rounded-xl shadow-e1';
  const INPUT = 'w-full bg-surface border border-outline-variant rounded-lg px-3 h-11 text-body focus:ring-1 focus:ring-primary focus:border-primary transition-all';
  const SELECT = INPUT + ' appearance-none';
  const XLSBTN = 'flex items-center gap-2 px-3 py-1.5 border border-outline-variant rounded bg-surface hover:bg-surface-container text-overline uppercase transition-colors';
  const StockPill = ({ n }) => h(window.UI.StockBadge, { n });
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

  function Segment({ value, onChange, options }) {
    // overflow-x-auto + no-scrollbar: cuando hay muchas opciones (catálogo ilimitado), la fila se
    // desliza en horizontal en vez de romper el ancho. shrink-0/whitespace-nowrap: los botones
    // conservan su tamaño (no se comprimen ni parten el texto en 2 líneas).
    return h('div', { className: 'flex p-1 bg-surface-container rounded-lg border border-outline-variant overflow-x-auto no-scrollbar' },
      options.map(([id, l]) => {
        const on = value === id;
        return h('button', {
          key: id, className: 'shrink-0 whitespace-nowrap px-4 py-1.5 text-overline uppercase rounded transition-colors ' + (on ? 'bg-gold text-on-gold shadow-e1' : 'text-on-surface-variant hover:text-primary'),
          onClick: () => onChange(id),
        }, l);
      }));
  }

  function InventoryScreen() {
    const [query, setQuery] = useState('');
    const [filters, setFilters] = useState({}); // { [kind]: code|'all' } — catálogos "Filtrables"
    const [stockFilter, setStockFilter] = useState('all');
    const [detail, setDetail] = useState(null);
    const [editing, setEditing] = useState(null);
    const [products, setProducts] = useState(() => D.products.slice());
    const [importPreview, setImportPreview] = useState(null);
    const [labelTargets, setLabelTargets] = useState(null); // productos para imprimir etiquetas
    const [page, setPage] = useState(1);
    const fileRef = useRef(null);

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
        .then(res => { if (!res.products.length) { toast('No se encontraron productos válidos en el archivo', 'var(--danger)'); return; } setImportPreview(res); })
        .catch(() => toast('No se pudo leer el archivo Excel', 'var(--danger)'));
    }
    // Importar ACTUALIZA por SKU: si el SKU ya existe se modifica ese producto en vez de agregar
    // otro. (Antes siempre hacía push, así que reimportar el mismo archivo duplicaba el catálogo.)
    // El SKU es la identidad estable del producto — el historial de ventas y movimientos lo
    // referencia por SKU, y hydrate lo congela al crearlo.
    function confirmImport() {
      // Si dos productos comparten SKU (posible: la receta puede no incluir el No. Modelo), se
      // actualiza SIEMPRE el primero. Determinista y estable entre importaciones.
      const bySku = {};
      D.products.forEach(p => { if (p.sku && !bySku[p.sku]) bySku[p.sku] = p; });
      const F = (window.XLSXIO && window.XLSXIO.IMPORT_FIELDS) || [];
      let nuevos = 0, actualizados = 0;
      importPreview.products.forEach(imp => {
        const target = bySku[imp.sku];
        if (!target) { D.products.push(imp); bySku[imp.sku] = imp; nuevos++; return; }
        // Solo los campos que la hoja trae. Se conservan id, costo, destacado y códigos de
        // barras: el Excel no los lleva y copiarlos borraría lo que ya está capturado.
        F.forEach(k => { if (k !== 'attrs' && imp[k] !== undefined) target[k] = imp[k]; });
        // attrs se FUSIONA, no se reemplaza: un catálogo custom sin columna en el archivo
        // dejaría el valor vacío y se perdería el que ya tenía el producto.
        target.attrs = Object.assign({}, target.attrs, imp.attrs);
        // La foto solo se pisa si la hoja trajo una URL real; la genérica que pone hydrate
        // cuando la celda va vacía nunca reemplaza una foto ya subida.
        if (imp.imagen && !D.isAutoImg(imp.imagen)) target.imagen = imp.imagen;
        D.hydrate(target);
        actualizados++;
      });
      D.saveProducts(); refresh();
      setImportPreview(null);
      toast(`${nuevos} nuevos · ${actualizados} actualizados`, 'var(--accent)');
    }
    function saveProduct(draft, mode) {
      if (mode === 'edit') {
        const target = D.products.find(p => p.id === draft.id);
        if (target) { Object.assign(target, draft); D.hydrate(target); }
      } else {
        const p = D.hydrate(Object.assign({}, draft, { id: 'new-' + Date.now() }));
        D.products.push(p);
      }
      D.saveProducts(); refresh();
      setEditing(null); setDetail(null);
      toast(mode === 'edit' ? 'Producto actualizado' : 'Producto agregado al inventario', 'var(--accent)');
    }
    function deleteProduct(p) {
      D.removeProduct(p.id); refresh();
      setDetail(null);
      toast('Producto eliminado', 'var(--danger)');
    }

    const lowThreshold = window.CONFIG.get('stock.lowThreshold') || 4;
    // Catálogos marcados como "Filtrables" (Configuración). Por defecto solo Tela.
    const filterableKinds = Object.keys(window.CONFIG.allCatalogMeta ? window.CONFIG.allCatalogMeta() : {})
      .filter(k => { const m = window.CONFIG.catalogMeta(k); return m && m.filterable; });
    const rows = useMemo(() => {
      const q = query.trim().toLowerCase();
      return products.filter(p => {
        for (let i = 0; i < filterableKinds.length; i++) {
          const fk = filterableKinds[i], selv = filters[fk];
          if (!selv || selv === 'all') continue;
          const m = window.CONFIG.catalogMeta(fk);
          const val = m.custom ? (p.attrs || {})[fk] : p[m.field];
          if (String(val) !== String(selv)) return false;
        }
        const total = D.totalStock(p);
        if (stockFilter === 'low' && total > lowThreshold) return false;
        if (stockFilter === 'out' && total !== 0) return false;
        if (!q) return true;
        return p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.colorName.toLowerCase().includes(q);
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
          className: 'min-w-[9.5rem] max-w-[14rem] bg-surface border rounded-lg px-3 py-2.5 text-body transition-all focus:ring-1 focus:ring-primary focus:border-primary '
            + (activo ? 'border-gold text-primary font-semibold' : 'border-outline-variant'),
          value: val,
          onChange: e => { setFilters(prev => Object.assign({}, prev, { [fk]: e.target.value })); setPage(1); },
        }, opts),
      ]);
    }).concat(Object.keys(filters).some(k => filters[k] && filters[k] !== 'all')
      ? [h('button', {
        key: '__clr',
        className: 'h-11 px-4 inline-flex items-center gap-2 text-caption font-bold uppercase tracking-widest text-on-surface-variant border border-outline-variant rounded-lg hover:text-primary hover:bg-surface-container transition-colors',
        onClick: () => { setFilters({}); setPage(1); },
      }, [h(MS, { key: 'i', name: 'close', size: 16 }), 'Limpiar'])]
      : []);

    // Los KPIs se calculan sobre `rows` (lo FILTRADO), no sobre el inventario completo. Antes
    // usaban `products`: al filtrar por una tela, arriba seguía diciendo 242 y el pie de la
    // tabla 37 — la misma pantalla mostraba dos cifras distintas y se prestaba a leer mal.
    const lowCount = rows.filter(p => { const t = D.totalStock(p); return t > 0 && t <= lowThreshold; }).length;
    const totalUnidades = rows.reduce((a, p) => a + D.totalStock(p), 0);
    const valorInventario = rows.reduce((a, p) => a + D.totalStock(p) * p.precio, 0);

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'p-10 max-w-container-max mx-auto' }, [
        // KPIs
        h('div', { key: 'kpi', className: 'grid grid-cols-1 md:grid-cols-4 gap-gutter mb-8' }, [
          kpi('SKUs activos', rows.length),
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
              h('div', { key: 's', className: 'relative w-72' }, [
                h('span', { key: 'i', className: 'absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50' }, h(MS, { name: 'search', size: 20 })),
                h('input', { key: 'in', className: 'w-full bg-surface border border-outline-variant rounded-lg pl-10 pr-4 py-2.5 text-body focus:ring-1 focus:ring-primary focus:border-primary transition-all', placeholder: 'Buscar SKU, modelo o color…', value: query, onChange: e => { setQuery(e.target.value); setPage(1); } }),
              ]),
              h(Segment, { key: 'sg2', value: stockFilter, onChange: v => { setStockFilter(v); setPage(1); }, options: [['all', 'Todo'], ['low', 'Bajo'], ['out', 'Agotados']] }),
            ].concat(catalogFilters)),
            h('button', { key: 'add', className: 'flex items-center gap-2 px-6 py-2.5 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-all text-overline font-bold uppercase tracking-wider shadow-e2', onClick: () => setEditing({ mode: 'new', product: blankProduct() }) }, [h(MS, { key: 'i', name: 'plus', size: 18 }), 'Nuevo producto']),
          ]),
          // Excel
          h('div', { key: 'r2', className: 'flex items-center gap-4 py-2 border-y border-outline-variant/60' }, [
            h('span', { key: 'l', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-widest flex items-center gap-2' }, [h(MS, { key: 'i', name: 'box', size: 18 }), 'Excel:']),
            h('input', { key: 'f', ref: fileRef, type: 'file', accept: '.xlsx,.xls,.csv', className: 'hidden', onChange: onPickFile }),
            h('div', { key: 'b', className: 'flex gap-2' }, [
              h('button', { key: 't', className: XLSBTN, onClick: () => window.XLSXIO.exportTemplate() }, [h(MS, { key: 'i', name: 'download', size: 16 }), 'Plantilla']),
              h('button', { key: 'i', className: XLSBTN, onClick: () => fileRef.current && fileRef.current.click() }, [h(MS, { key: 'i', name: 'upload', size: 16 }), 'Importar']),
              h('button', { key: 'e', className: XLSBTN, onClick: () => window.XLSXIO.exportInventory(products) }, [h(MS, { key: 'i', name: 'file_export', size: 16 }), 'Exportar']),
              h('button', { key: 'bc', className: XLSBTN, onClick: () => { if (!rows.length) { toast('No hay productos para etiquetar', 'var(--danger)'); return; } setLabelTargets(rows.slice()); }, title: 'Imprimir etiquetas de los productos filtrados' }, [h(MS, { key: 'i', name: 'barcode', size: 16 }), 'Etiquetas']),
            ]),
          ]),
        ]),
        // Tabla
        h('div', { key: 'tbl', className: CARD + ' overflow-hidden shadow-e1' }, [
          h('div', { key: 'sc', className: 'overflow-x-auto' }, h('table', { className: 'w-full text-left border-collapse' }, [
            h('thead', { key: 'h' }, h('tr', { className: 'bg-surface-container/50 border-b border-outline-variant' },
              ['Producto', 'SKU', 'Atributos', 'Color / Orn.', 'Precio', 'Stock', ''].map((c, i) =>
                h('th', { key: i, className: 'px-4 py-4 text-overline uppercase tracking-wider font-semibold text-on-surface-variant/80' + (i === 0 ? ' pl-6' : '') }, c)))),
            h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, slice.map(p => {
              const total = D.totalStock(p);
              return h('tr', { key: p.id, className: 'hover:bg-surface-container transition-all group cursor-pointer', onClick: () => setDetail(p) }, [
                h('td', { key: 'n', className: 'px-6 py-4' }, h('div', { className: 'flex items-center gap-4' }, [
                  h(ProductImage, { key: 'i', p, className: 'w-12 h-14 rounded shadow-e1 border border-outline-variant shrink-0' }),
                  h('span', { key: 'x', className: 'font-bold text-body text-primary' }, p.nombre),
                ])),
                h('td', { key: 's', className: 'px-4 py-4' }, h('span', { className: 'text-overline font-mono text-on-surface-variant' }, p.sku)),
                h('td', { key: 'a', className: 'px-4 py-4' }, h('div', { className: 'flex flex-wrap gap-1.5' },
                  [(D.MANGA[p.manga] || p.manga || '—').replace('Manga ', 'M. '), p.orn, D.CUELLO[p.cuello] || p.cuello].map((t, i) => h('span', { key: i, className: 'px-2 py-0.5 bg-surface-container-high rounded text-overline font-bold uppercase text-on-surface-variant' }, t)))),
                h('td', { key: 'c', className: 'px-4 py-4' }, h('div', { className: 'flex flex-col gap-1.5' }, [
                  h('div', { key: 'm', className: 'flex items-center gap-2.5' }, [
                    h(ColorDot, { key: 'sw', hex: p.colorHex, size: 20, title: p.colorName, tela: true }),
                    h('span', { key: 'n', className: 'text-overline font-medium text-on-surface-variant' }, p.colorName),
                  ]),
                  p.ornColors && p.ornColors.length ? h('div', { key: 'o', className: 'flex items-center gap-1.5', style: { marginLeft: 30 } },
                    p.ornColors.map(c => h(ColorDot, { key: c, hex: D.COLOR_HEX[c], size: 10, title: D.COLOR_NAME[c] }))) : null,
                ])),
                h('td', { key: 'p', className: 'px-4 py-4' }, h('span', { className: 'font-headline text-base text-primary' }, fmt(p.precio).replace('.00', ''))),
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
        h(DetailDrawer, { key: 'dr', p: detail, onClose: () => setDetail(null), onEdit: () => setEditing({ mode: 'edit', product: detail }), onDelete: () => deleteProduct(detail), onLabels: (prod) => setLabelTargets([prod]) }),
        labelTargets && h(LabelModal, { key: 'lbl', products: labelTargets, onClose: () => setLabelTargets(null) }),
        editing && h(ProductForm, { key: 'f-' + editing.mode + '-' + (editing.product.id || 'new'), mode: editing.mode, product: editing.product, onClose: () => setEditing(null), onSave: saveProduct }),
        importPreview && h(ImportModal, { key: 'imp', data: importPreview, onClose: () => setImportPreview(null), onConfirm: confirmImport }),
      ]));
  }

  function kpi(label, value, gold, suffix) {
    return h('div', { key: label, className: CARD + ' p-6' + (gold ? ' border-l-4 border-l-secondary' : '') }, [
      h('p', { key: 'l', className: 'text-overline text-on-surface-variant uppercase tracking-widest mb-2 opacity-70 font-semibold' }, label),
      h('div', { key: 'v', className: 'flex items-baseline gap-1' }, [
        h('h3', { key: 'a', className: 'font-headline text-h1 text-primary' }, value),
        suffix && h('span', { key: 'b', className: 'text-overline text-on-surface-variant font-bold' }, suffix),
      ]),
    ]);
  }

  function blankProduct() {
    // Valores por defecto de catálogos custom activos (Fase 2): primer ítem disponible, para que
    // un atributo nuevo en el SKU no genere segmentos vacíos en productos recién creados.
    const attrs = {};
    const meta = window.CONFIG.allCatalogMeta ? window.CONFIG.allCatalogMeta() : {};
    Object.keys(meta).forEach(k => {
      if (meta[k].custom && (meta[k].inForm || meta[k].inSku)) { const l = window.CONFIG.list(k); attrs[k] = l.length ? l[0].code : ''; }
    });
    // Defaults de los catálogos del sistema: primer elemento ACTIVO del catálogo (el admin los
    // edita). Los códigos históricos ('21', 'ML', …) quedan solo como respaldo si está vacío —
    // un default fósil que ya no existe en el catálogo produce SKUs y atributos huérfanos.
    const first = (kind, fb) => { const l = window.CONFIG.list(kind); return l.length ? l[0].code : fb; };
    return { cat: first('category', '21'), manga: first('sleeve', 'ML'), tela: first('fabric', 'ALG'), color: first('color', 'BL'), modelo: '', nombre: '', orn: '—', ornColors: [], cuello: first('neck', 'NOR'), precio: 0, stock: D.emptyStock(), pop: false, attrs };
  }

  // ---------- Drawer de detalle ----------
  function DetailDrawer({ p, onClose, onEdit, onDelete, onLabels }) {
    const open = !!p;
    return h(React.Fragment, {}, [
      h('div', { key: 'ov', className: 'fixed inset-0 bg-primary-container/40 backdrop-blur-sm z-[55] transition-opacity duration-300 ' + (open ? 'opacity-100' : 'opacity-0 pointer-events-none'), onClick: onClose }),
      h('div', { key: 'dr', className: 'fixed inset-y-0 right-0 w-[460px] bg-surface border-l border-outline-variant z-[60] shadow-e3 flex flex-col transition-transform duration-300 ' + (open ? 'translate-x-0' : 'translate-x-full') },
        p && [
          h('div', { key: 'h', className: 'px-8 py-6 border-b border-outline-variant flex justify-between items-center' }, [
            h('div', { key: 't' }, [
              h('p', { key: 'a', className: 'text-overline uppercase font-bold text-on-surface-variant tracking-widest opacity-60' }, 'Detalle de producto'),
              h('h2', { key: 'b', className: 'text-h1 font-headline text-primary mt-1' }, p.nombre),
            ]),
            h('button', { key: 'x', className: 'p-2 hover:bg-surface-container rounded-full transition-colors', onClick: onClose }, h(MS, { name: 'close', size: 22, className: 'text-on-surface-variant' })),
          ]),
          h('div', { key: 'c', className: 'flex-grow overflow-y-auto' }, [
            h('div', { key: 'img', className: 'aspect-[4/3] bg-surface-container relative overflow-hidden' }, h(ProductImage, { p, className: 'w-full h-full' })),
            h('div', { key: 'b', className: 'p-8 space-y-8' }, [
              // SKU + precio
              h('div', { key: 'g', className: 'grid grid-cols-2 gap-8' }, [
                drawerField('SKU', h('span', { className: 'font-mono text-body text-primary' }, p.sku)),
                drawerField('Precio (MXN)', h('span', { className: 'font-headline text-h2 text-primary' }, fmt(p.precio).replace('.00', ''))),
              ]),
              // Atributos
              h('div', { key: 'at', className: 'space-y-4' }, [
                h('h3', { key: 't', className: 'text-overline font-bold uppercase text-primary tracking-widest border-b border-outline-variant pb-3' }, 'Atributos'),
                h('div', { key: 'gr', className: 'grid grid-cols-2 gap-4' }, [
                  drawerInfo('Categoría', D.CAT[p.cat]), drawerInfo('Manga', D.MANGA[p.manga]),
                  drawerInfo('Tela', D.TELA[p.tela]), drawerInfo('Cuello', D.CUELLO[p.cuello]),
                  drawerInfo('Color', p.colorName, p.colorHex), drawerInfo('Ornamento', p.orn),
                ]),
              ]),
              // Stock por talla
              h('div', { key: 'stk', className: 'space-y-3' }, [
                h('h3', { key: 't', className: 'text-overline font-bold uppercase text-primary tracking-widest border-b border-outline-variant pb-3' }, 'Existencias por talla'),
                ...ESCALAS.filter(([e]) => p.stock.some(v => v.escala === e && v.stock > 0)).map(([e, label]) => h('div', { key: e }, [
                  h('div', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant/70 mb-2' }, label),
                  h('div', { key: 'g', className: 'flex flex-wrap gap-2' }, p.stock.filter(v => v.escala === e && v.stock > 0).map(v =>
                    h('div', { key: v.talla, className: 'flex flex-col items-center min-w-[48px] px-2 py-1.5 border border-outline-variant rounded' }, [
                      h('span', { key: 't', className: 'text-caption font-semibold text-primary' }, tallaLabel(v.talla, e)),
                      h('span', { key: 's', className: 'text-overline text-on-surface-variant' }, v.stock + ' pz'),
                    ]))),
                ])),
              ]),
              // Acciones
              h('div', { key: 'ac', className: 'pt-4 space-y-3' }, [
                h('button', { key: 'lb', className: 'w-full py-3 rounded-xl border border-outline-variant text-primary hover:border-primary hover:bg-surface-container transition-all flex items-center justify-center gap-2 text-overline font-bold uppercase tracking-widest', onClick: () => onLabels && onLabels(p) }, [h(MS, { key: 'i', name: 'barcode', size: 18 }), 'Imprimir etiqueta']),
                h('div', { key: 'row', className: 'flex gap-4' }, [
                  h('button', { key: 'e', className: 'flex-grow bg-primary text-on-primary py-3.5 rounded-xl text-overline font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-e2 active:scale-95 flex items-center justify-center gap-2', onClick: onEdit }, [h(MS, { key: 'i', name: 'edit', size: 18 }), 'Editar producto']),
                  h('button', { key: 'd', className: 'w-14 h-[52px] rounded-xl border border-outline-variant text-danger hover:bg-danger-soft hover:border-danger/30 transition-all flex items-center justify-center', onClick: onDelete, title: 'Eliminar' }, h(MS, { name: 'trash', size: 20 })),
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
  function ImportModal({ data, onClose, onConfirm }) {
    // Qué va a pasar con cada fila: el SKU ya existente se ACTUALIZA, el nuevo se AGREGA.
    const existentes = new Set(D.products.map(p => p.sku));
    const esNuevo = (p) => !existentes.has(p.sku);
    const nuevos = data.products.filter(esNuevo).length;
    const actualiza = data.products.length - nuevos;
    const footer = [
      h('button', { key: 'c', className: 'px-5 h-11 border border-outline-variant text-on-surface text-caption font-bold uppercase tracking-widest hover:bg-surface-container rounded-lg transition-colors', onClick: onClose }, 'Cancelar'),
      h('button', { key: 'k', className: 'inline-flex items-center gap-2 px-5 h-11 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition', onClick: onConfirm }, [h(MS, { key: 'i', name: 'check', size: 16 }), `Importar ${data.products.length}`]),
    ];
    return h(Modal, { title: 'Previsualizar importación', onClose, footer, large: true }, [
      h('div', { key: 'sum', className: 'flex items-center gap-2 mb-4 flex-wrap text-caption' }, [
        nuevos > 0 && h('span', { key: 'n', className: 'px-2 py-1 bg-success-soft text-success font-bold rounded' }, `${nuevos} nuevos`),
        actualiza > 0 && h('span', { key: 'u', className: 'px-2 py-1 bg-gold-soft text-gold-text font-bold rounded' }, `${actualiza} se actualizan`),
        data.skipped > 0 && h('span', { key: 'b', className: 'px-2 py-1 bg-warning-soft text-warning font-bold rounded' }, `${data.skipped} omitidos`),
        h('span', { key: 'c', className: 'text-on-surface-variant' }, `${data.total} filas leídas`),
      ]),
      actualiza > 0 && h('p', { key: 'nota', className: 'text-caption text-on-surface-variant mb-3' }, 'Los que se actualizan conservan su costo, si están destacados y sus códigos de barras (esta hoja no los lleva). La foto solo cambia si la columna “Foto (URL)” trae un enlace.'),
      h('div', { key: 'tbl', className: 'border border-outline-variant rounded-lg overflow-hidden max-h-80 overflow-y-auto' },
        h('table', { className: 'w-full' }, [
          h('thead', { key: 'h', className: 'sticky top-0 bg-surface' }, h('tr', { className: 'border-b border-outline-variant' },
            ['Acción', 'Producto', 'SKU', 'Cuello', 'Precio', 'Stock'].map((c, i) => h('th', { key: i, className: 'px-3 py-2 text-overline font-semibold text-on-surface-variant uppercase tracking-widest text-left' + (c === 'Precio' || c === 'Stock' ? ' text-right' : '') }, c)))),
          h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, data.products.slice(0, 60).map(p => h('tr', { key: p.id }, [
            h('td', { key: 'a', className: 'px-3 py-2' }, h('span', { className: 'px-2 py-0.5 text-overline font-bold rounded ' + (esNuevo(p) ? 'bg-success-soft text-success' : 'bg-gold-soft text-gold-text') }, esNuevo(p) ? 'Nuevo' : 'Actualiza')),
            h('td', { key: 'n', className: 'px-3 py-2' }, h('div', { className: 'flex items-center gap-2' }, [h(ProductImage, { key: 't', p, className: 'w-8 h-8 rounded' }), h('span', { key: 'x', className: 'text-body text-primary' }, p.nombre)])),
            h('td', { key: 's', className: 'px-3 py-2 text-overline font-mono text-on-surface-variant' }, p.sku),
            h('td', { key: 'cu', className: 'px-3 py-2' }, h('span', { className: 'px-2 py-0.5 bg-surface-container-high text-on-surface-variant text-overline rounded' }, D.CUELLO[p.cuello])),
            h('td', { key: 'p', className: 'px-3 py-2 text-right font-headline text-body' }, fmt(p.precio).replace('.00', '')),
            h('td', { key: 'st', className: 'px-3 py-2 text-right font-mono text-body' }, D.totalStock(p)),
          ]))),
        ])),
      data.products.length > 60 && h('div', { key: 'more', className: 'text-caption text-on-surface-variant mt-2 text-center' }, `… y ${data.products.length - 60} más`),
    ]);
  }

  // ---------- Formulario de alta / edición ----------
  function ProductForm({ mode, product, onClose, onSave }) {
    // Los códigos huérfanos NO se sustituyen al abrir: el select los muestra con aviso (sel() ya
    // lo maneja). Sustituirlos por el primer elemento activo reescribía el color/atributo real del
    // producto con solo abrir y guardar. La normalización masiva vive en Regenerar SKUs.
    const [d, setD] = useState(() => ({
      id: product.id, cat: product.cat, manga: product.manga, tela: product.tela, color: product.color,
      modelo: product.modelo, nombre: product.nombre, orn: product.orn, ornColors: (product.ornColors || []).slice(),
      cuello: product.cuello, precio: product.precio, costo: product.costo != null ? product.costo : '', pop: !!product.pop,
      imagen: product.imagen || '',
      attrs: product.attrs ? { ...product.attrs } : {}, // valores de catálogos custom (Fase 2)
      stock: alignStock(product.stock),
    }));
    const set = (k, v) => setD(prev => ({ ...prev, [k]: v }));
    const setAttr = (k, v) => setD(prev => ({ ...prev, attrs: { ...(prev.attrs || {}), [k]: v } }));
    // Catálogo "Modelo" (custom) que alimenta el desplegable de "Nombre / Modelo" (detección
    // centralizada en CONFIG.modeloKind). Si no existe, el campo sigue siendo texto libre.
    const modeloKind = window.CONFIG.modeloKind ? window.CONFIG.modeloKind() : null;
    const modeloItems = modeloKind ? window.CONFIG.list(modeloKind) : [];
    // El valor elegido del catálogo se guarda como NOMBRE del producto (d.nombre = etiqueta), como
    // NO. MODELO (d.modelo = código del catálogo: ADR, ARO, …) y, si el catálogo entra al SKU/filtros,
    // también en d.attrs[modeloKind] = código. El No. Modelo deja de capturarse a mano.
    const setModelo = (code) => { const it = modeloItems.find(x => x.code === code); setD(prev => ({ ...prev, nombre: it ? it.label : '', modelo: code, attrs: { ...(prev.attrs || {}), [modeloKind]: code } })); };
    const modeloCode = (modeloItems.find(x => x.label === d.nombre) || {}).code || '';
    const setStock = (talla, escala, val) => setD(prev => ({ ...prev, stock: prev.stock.map(v => v.talla === talla && v.escala === escala ? { ...v, stock: Math.max(0, Math.round(Number(val) || 0)) } : v) }));
    const toggleOrn = (c) => setD(prev => ({ ...prev, ornColors: prev.ornColors.includes(c) ? prev.ornColors.filter(x => x !== c) : prev.ornColors.concat(c) }));
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
    function onPickImg(e) {
      const file = e.target.files && e.target.files[0]; e.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('Selecciona una imagen', 'var(--danger)'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = async () => {
          const max = 600, scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), hgt = Math.round(img.height * scale);
          const cv = document.createElement('canvas'); cv.width = w; cv.height = hgt;
          cv.getContext('2d').drawImage(img, 0, 0, w, hgt);
          const dataUrl = cv.toDataURL('image/jpeg', 0.85);
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
        };
        img.onerror = () => toast('No se pudo leer la imagen', 'var(--danger)');
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
    const imgSrc = d.imagen ? ((window.__IMG_MAP && window.__IMG_MAP[d.imagen]) || d.imagen) : '';
    const skuPrev = D.sku({ ...d, modelo: d.modelo || '000' }); // misma receta que el SKU real
    const total = d.stock.reduce((a, v) => a + v.stock, 0);

    function submit() {
      if (!d.nombre.trim()) { toast('Escribe el nombre / modelo de la prenda', 'var(--danger)'); return; }
      // Con catálogo "Modelo", el No. Modelo ES la clave del catálogo (también corrige productos
      // viejos capturados a mano al reeditarlos). Sin catálogo, se respeta el texto libre.
      const modeloFinal = (modeloKind && modeloCode) ? modeloCode : String(d.modelo).trim();
      if (!modeloFinal) { toast(modeloKind ? 'Selecciona el Nombre / Modelo' : 'Escribe el número de modelo', 'var(--danger)'); return; }
      // Catálogos marcados "Obligatorio" (y que aparecen en el alta) deben tener valor.
      const meta = window.CONFIG.allCatalogMeta ? window.CONFIG.allCatalogMeta() : {};
      const falta = Object.keys(meta).find(k => {
        const m = meta[k]; if (!m.required || !m.inForm) return false;
        const val = m.custom ? (d.attrs || {})[k] : d[m.field];
        return val == null || String(val).trim() === '';
      });
      if (falta) { toast('Selecciona ' + meta[falta].label, 'var(--danger)'); return; }
      onSave({ ...d, nombre: d.nombre.trim(), modelo: modeloFinal, precio: Number(d.precio) || 0, costo: Number(d.costo) || 0 }, mode);
    }

    const footer = [
      h('div', { key: 'sk', className: 'flex-1 self-center text-overline uppercase tracking-wider text-on-surface-variant font-mono' }, 'SKU: ' + skuPrev),
      h('button', { key: 'c', className: 'px-5 h-11 border border-outline-variant text-on-surface text-caption font-bold uppercase tracking-widest hover:bg-surface-container rounded-lg transition-colors', onClick: onClose }, 'Cancelar'),
      h('button', { key: 's', className: 'inline-flex items-center gap-2 px-5 h-11 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition', onClick: submit }, [h(MS, { key: 'i', name: 'check', size: 16 }), mode === 'edit' ? 'Guardar cambios' : 'Agregar producto']),
    ];

    return h(Modal, { title: mode === 'edit' ? 'Editar producto' : 'Nuevo producto', onClose, footer, large: true }, [
      // Imagen del producto (subir / cambiar / quitar)
      h('div', { key: 'img', className: 'flex items-center gap-4 mb-5' }, [
        h('div', { key: 'pv', className: 'w-20 h-24 rounded-lg overflow-hidden shrink-0 border border-outline-variant bg-surface-container grid place-items-center' },
          imgSrc ? h('img', { src: imgSrc, className: 'w-full h-full object-cover' }) : h(MS, { name: 'shirt', size: 28, className: 'text-on-surface-variant/40' })),
        h('div', { key: 'b', className: 'flex-1 min-w-0' }, [
          h('p', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant uppercase tracking-widest mb-1' }, 'Imagen del producto'),
          h('p', { key: 'd', className: 'text-overline text-on-surface-variant/70 mb-2' }, 'JPG/PNG · se ajusta a 600 px. Sin imagen = se genera una automática.'),
          h('input', { key: 'f', ref: fileRef, type: 'file', accept: 'image/*', className: 'hidden', onChange: onPickImg }),
          h('div', { key: 'btns', className: 'flex gap-2' }, [
            h('button', { key: 'u', type: 'button', className: 'inline-flex items-center gap-2 px-4 h-10 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition', onClick: () => fileRef.current && fileRef.current.click() }, [h(MS, { key: 'i', name: d.imagen ? 'edit' : 'upload', size: 16 }), d.imagen ? 'Cambiar' : 'Subir imagen']),
            d.imagen && h('button', { key: 'x', type: 'button', className: 'inline-flex items-center gap-2 px-4 h-10 border border-outline-variant text-on-surface-variant text-caption font-bold uppercase tracking-widest rounded-lg hover:bg-surface-container transition', onClick: () => set('imagen', '') }, [h(MS, { key: 'i', name: 'trash', size: 16 }), 'Quitar']),
          ]),
        ]),
      ]),
      h('div', { key: 'g1', className: 'grid grid-cols-2 md:grid-cols-3 gap-4' }, [
        field('Nombre / Modelo', modeloKind
          ? h('select', { className: INPUT, value: modeloCode, onChange: e => setModelo(e.target.value) }, [
              h('option', { key: '', value: '' }, 'Selecciona…'),
              ...modeloItems.map(it => h('option', { key: it.code, value: it.code }, it.label)),
            ])
          : h('input', { className: INPUT, value: d.nombre, placeholder: 'Ej. Tira Red', onChange: e => set('nombre', e.target.value) }), 'wide'),
        // Con catálogo "Modelo" presente, la clave viene del catálogo (setModelo) y no se edita a mano.
        field('No. Modelo', modeloKind
          ? h('input', { className: INPUT + ' opacity-60 cursor-not-allowed', value: modeloCode || d.modelo, readOnly: true, tabIndex: -1, title: 'Se llena automáticamente con la clave del catálogo Modelo al elegir Nombre / Modelo' })
          : h('input', { className: INPUT, value: d.modelo, placeholder: '128', onChange: e => set('modelo', e.target.value) })),
        field('Precio', h('input', { className: INPUT, type: 'number', min: 0, value: d.precio, onChange: e => set('precio', e.target.value) })),
        // Atributos select del alta: etiqueta y visibilidad salen de CONFIG.catalogMeta (editable
        // por el admin en Configuración → Catálogos de producto). Solo se muestran los "En alta".
        ...[
          { kind: 'category', field: 'cat', map: D.CAT },
          { kind: 'sleeve', field: 'manga', map: D.MANGA },
          { kind: 'fabric', field: 'tela', map: D.TELA },
          { kind: 'color', field: 'color', map: D.COLOR_NAME, useKeyAsValue: true },
          { kind: 'neck', field: 'cuello', map: D.CUELLO },
        ].filter(a => { const m = window.CONFIG.catalogMeta(a.kind); return !m || m.inForm; })
          .map(a => field(window.CONFIG.catalogLabel(a.kind), sel(d[a.field], a.map, v => set(a.field, v), a.useKeyAsValue))),
        field(window.CONFIG.catalogLabel('ornament'), sel(d.orn || '—', window.CONFIG.map('ornament'), v => set('orn', v))),
        // Catálogos creados por el admin (Fase 2): se muestran como select cuando están "En alta".
        // Su valor se guarda en d.attrs[kind]; entra al SKU si el catálogo está "En SKU".
        ...Object.keys(window.CONFIG.allCatalogMeta ? window.CONFIG.allCatalogMeta() : {})
          .filter(k => { const m = window.CONFIG.catalogMeta(k); return m && m.custom && m.inForm && k !== modeloKind; })
          .map(k => field(window.CONFIG.catalogLabel(k), sel((d.attrs || {})[k] || '', window.CONFIG.map(k), v => setAttr(k, v)))),
      ]),
      h('div', { key: 'oc', className: 'mt-4' }, [
        h('div', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant uppercase tracking-widest mb-2' }, ['Colores Orn. ', h('span', { key: 's', className: 'normal-case tracking-normal text-on-surface-variant/70' }, '(hilos del bordado)')]),
        h('div', { key: 'g', className: 'flex flex-wrap gap-1.5' }, Object.keys(D.COLOR_NAME).map(c => h('button', {
          key: c, type: 'button', title: D.COLOR_NAME[c],
          className: 'flex items-center gap-1 px-2 py-1 border rounded transition-colors ' + (d.ornColors.includes(c) ? 'border-primary bg-surface-container' : 'border-outline-variant hover:border-primary'),
          onClick: () => toggleOrn(c),
        }, [h('span', { key: 'sw', className: 'w-3 h-3 rounded-full border border-outline-variant', style: { background: D.COLOR_HEX[c] } }), h('span', { key: 'c', className: 'text-overline' }, c)]))),
      ]),
      h('div', { key: 'div', className: 'border-t border-outline-variant my-5' }),
      h('div', { key: 'stk' }, [
        h('div', { key: 'l', className: 'flex items-center gap-2 mb-3' }, [
          h('span', { key: 't', className: 'flex items-center gap-2 text-caption font-semibold text-on-surface-variant uppercase tracking-widest' }, [h(MS, { key: 'i', name: 'tag', size: 15 }), 'Existencias por talla']),
          h('span', { key: 'sp', className: 'flex-1' }),
          h('span', { key: 'tt', className: 'px-2 py-1 text-overline uppercase rounded bg-gold text-on-gold' }, `${total} pz en total`),
        ]),
        // Solo escalas con tallas activas en el catálogo (o con stock legado > 0): si el admin
        // desactiva toda una escala (p. ej. Letras), su sección desaparece del alta.
        ...ESCALAS.filter(([e]) => (e === 'L' ? D.SIZES_LETRA : D.SIZES_NUM).length || d.stock.some(v => v.escala === e && v.stock > 0)).map(([e, label]) => h('div', { key: e, className: 'mb-4' }, [
          h('div', { key: 'sl', className: 'text-overline uppercase tracking-widest text-on-surface-variant/70 mb-2' }, label),
          h('div', { key: 'r', className: 'grid grid-cols-5 sm:grid-cols-10 gap-2' }, d.stock.filter(v => v.escala === e).map(v => h('div', { key: v.talla, className: 'flex flex-col items-center gap-1' }, [
            h('label', { key: 'l', className: 'text-overline uppercase text-on-surface-variant' }, tallaLabel(v.talla, e)),
            h('input', { key: 'i', type: 'number', min: 0, value: v.stock, className: 'w-full h-9 text-center bg-surface-container border border-outline-variant focus:ring-1 focus:ring-primary text-body rounded font-mono', onChange: ev => setStock(v.talla, e, ev.target.value) }),
          ]))),
        ])),
      ]),
    ]);
  }

  function sel(value, map, onChange, useKeyAsValue) {
    const opts = Object.entries(map).map(([k, v]) => h('option', { key: k, value: k }, useKeyAsValue ? `${v} (${k})` : v));
    // Valor huérfano (código guardado que ya no existe en el catálogo): opción visible con aviso.
    // Sin esto, el <select> muestra la PRIMERA opción aunque el estado conserve el código viejo,
    // y el capturista guarda sin darse cuenta (SKU/atributos huérfanos, p. ej. cat '21').
    if (!(value in map)) opts.unshift(h('option', { key: '__orphan', value }, value ? `⚠ ${value} — ya no existe, elige otro` : 'Selecciona…'));
    return h('select', { className: SELECT, value, onChange: e => onChange(e.target.value) }, opts);
  }
  function field(label, control, mod) {
    return h('div', { key: label, className: mod === 'wide' ? 'col-span-2 md:col-span-1' : '' }, [
      h('label', { key: 'l', className: 'block text-caption font-semibold text-on-surface-variant uppercase tracking-widest mb-1.5' }, label),
      React.cloneElement(control, { key: 'c' }),
    ]);
  }

  // ── Etiquetas de código de barras (impresión 6×4 cm + guardado opcional en Supabase) ──
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  const LBL_OPTS = { height: 60, fontSize: 13, margin: 4 }; // ajuste del código para la vista previa
  // En la etiqueta impresa el código va aparte (.bx-meta), así que el código de barras no repite el texto.
  const PRINT_OPTS = Object.assign({}, LBL_OPTS, { displayValue: false });

  function LabelModal({ products, onClose }) {
    const B = window.BARCODES;
    const [copiesMode, setCopiesMode] = useState('one'); // 'one' | 'stock'
    const [copies, setCopies] = useState(1);
    const [withPrice, setWithPrice] = useState(true);
    const [saving, setSaving] = useState(false);

    const specs = [];
    (products || []).forEach(p => (p.stock || []).forEach(v => { if (v.stock > 0) specs.push({ p, talla: v.talla, stock: v.stock, code: B.codeOf(p, v.talla) }); }));
    const copiesOf = s => copiesMode === 'stock' ? s.stock : Math.max(1, Number(copies) || 1);
    const totalLabels = specs.reduce((a, s) => a + copiesOf(s), 0);
    const uniqueCount = new Set(specs.map(s => s.code)).size;

    if (!B || !B.ready()) return h(Modal, { title: 'Etiquetas', onClose }, h('p', { className: 'text-body text-on-surface-variant py-6 text-center' }, 'La librería de códigos de barras no cargó. Revisa tu conexión e inténtalo de nuevo.'));
    if (!specs.length) return h(Modal, { title: 'Etiquetas', onClose }, h('p', { className: 'text-body text-on-surface-variant py-6 text-center' }, 'No hay tallas con existencias para etiquetar.'));

    function printLabels() {
      const cache = {};
      let html = '';
      specs.forEach(s => {
        if (cache[s.code] === undefined) cache[s.code] = B.toPNGDataURL(s.code, PRINT_OPTS);
        const price = withPrice ? `<div class="bx-price">${escapeHtml(fmt(s.p.precio).replace('.00', ''))}</div>` : '';
        const one = `<div class="bx-label"><div class="bx-name">${escapeHtml(s.p.nombre)}</div><img class="bx-img" src="${cache[s.code]}"><div class="bx-meta">${escapeHtml(s.code)}</div>${price}</div>`;
        for (let i = 0; i < copiesOf(s); i++) html += one;
      });
      const win = window.open('', '_blank', 'width=520,height=680');
      if (!win) { toast('Permite las ventanas emergentes para imprimir', 'var(--danger)'); return; }
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas Balam</title><style>
        @page { size: 60mm 40mm; margin: 0; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: monospace; }
        .bx-label { width: 60mm; height: 40mm; padding: 2mm; display: flex; flex-direction: column; align-items: center; justify-content: center; page-break-after: always; overflow: hidden; }
        .bx-name { font-family: sans-serif; font-size: 9pt; font-weight: 700; text-align: center; line-height: 1.05; max-height: 2.3em; overflow: hidden; margin-bottom: .5mm; }
        .bx-img { width: 100%; max-height: 18mm; object-fit: contain; }
        .bx-meta { font-size: 8pt; letter-spacing: .4px; margin-top: .3mm; }
        .bx-price { font-family: sans-serif; font-size: 12pt; font-weight: 800; margin-top: .3mm; }
      </style></head><body>${html}<scr` + `ipt>window.onload=function(){window.focus();window.print();setTimeout(function(){window.close();},400);};</scr` + `ipt></body></html>`);
      win.document.close();
    }

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
      D.saveProducts();
      setSaving(false);
      toast(failN ? `Guardadas ${okN}, fallaron ${failN}. Error al guardar imagen del código; intenta regenerarlo.` : `${okN} ${okN === 1 ? 'imagen guardada' : 'imágenes guardadas'} en Supabase`, failN ? 'var(--danger)' : 'var(--accent)');
    }

    const seg = (val, on, label) => h('button', { key: val, onClick: () => setCopiesMode(val), className: 'px-3 py-1.5 rounded-md text-caption font-semibold transition-colors ' + (on ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-primary') }, label);
    const preview = specs.slice(0, 4);
    const footer = [
      h('button', { key: 'sv', disabled: saving, onClick: saveToSupabase, className: 'px-5 py-3 border border-outline-variant rounded-xl text-caption font-bold uppercase tracking-widest text-primary hover:bg-surface-container transition disabled:opacity-50 flex items-center gap-2' }, [h(MS, { key: 'i', name: saving ? 'clock' : 'upload', size: 16 }), saving ? 'Guardando…' : `Guardar en Supabase (${uniqueCount})`]),
      h('button', { key: 'pr', onClick: printLabels, className: 'px-6 py-3 bg-primary text-on-primary rounded-xl text-caption font-bold uppercase tracking-widest hover:opacity-90 transition flex items-center gap-2' }, [h(MS, { key: 'i', name: 'print', size: 16 }), `Imprimir (${totalLabels})`]),
    ];

    return h(Modal, { title: 'Etiquetas de código de barras', onClose, footer }, [
      h('div', { key: 'cfg', className: 'space-y-4 mb-5' }, [
        h('div', { key: 'r1', className: 'flex items-center justify-between gap-4' }, [
          h('span', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant' }, 'Copias'),
          h('div', { key: 's', className: 'inline-flex bg-surface-container-low p-1 rounded-lg' }, [seg('one', copiesMode === 'one', '1 por talla'), seg('stock', copiesMode === 'stock', 'Una por pieza (stock)')]),
        ]),
        copiesMode === 'one' && h('div', { key: 'r2', className: 'flex items-center justify-between gap-4' }, [
          h('span', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant' }, 'Copias por talla'),
          h('input', { key: 'i', type: 'number', min: 1, value: copies, onChange: e => setCopies(e.target.value), className: 'w-24 bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-body text-right focus:ring-1 focus:ring-primary' }),
        ]),
        h('label', { key: 'r3', className: 'flex items-center justify-between gap-4 cursor-pointer' }, [
          h('span', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant' }, 'Incluir precio en la etiqueta'),
          h('input', { key: 'i', type: 'checkbox', checked: withPrice, onChange: e => setWithPrice(e.target.checked), className: 'w-5 h-5 rounded border-outline text-primary focus:ring-primary' }),
        ]),
        h('p', { key: 'sum', className: 'text-caption text-on-surface-variant' }, `${specs.length} talla(s) con existencias · ${totalLabels} etiqueta(s) a imprimir`),
      ]),
      h('div', { key: 'pv', className: 'border-t border-outline-variant pt-4' }, [
        h('p', { key: 'l', className: 'text-overline uppercase font-bold text-on-surface-variant tracking-widest mb-3' }, 'Vista previa'),
        h('div', { key: 'g', className: 'grid grid-cols-2 gap-3' }, preview.map(s => h('div', { key: s.code, className: 'border border-outline-variant rounded-lg p-2 flex flex-col items-center gap-1 bg-white overflow-hidden' }, [
          h('div', { key: 'n', className: 'text-overline font-bold text-center text-primary truncate w-full' }, s.p.nombre),
          h('div', { key: 'b', className: 'w-full overflow-hidden' }, h(B.Barcode, { code: s.code, opts: LBL_OPTS })),
          withPrice && h('div', { key: 'p', className: 'text-caption font-bold text-primary' }, fmt(s.p.precio).replace('.00', '')),
        ]))),
        specs.length > preview.length && h('p', { key: 'm', className: 'text-caption text-on-surface-variant mt-2' }, `…y ${specs.length - preview.length} más`),
      ]),
    ]);
  }

  window.InventoryScreen = InventoryScreen;
})();
