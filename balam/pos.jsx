// pos.jsx — Punto de venta (Balam). Exporta window.POSScreen
(function () {
  const { useState, useEffect, useRef, useMemo } = React;
  const { fmt, toast, Modal } = window.UI;
  // H-36: antes de elegir talla el catálogo anuncia un rango; el precio real de
  // la talla aparece al elegirla y es el que circula por resumen y ticket.
  const precioCatalogo = (p) => {
    if (p && p.isFamilyProjection) {
      const prices = (p.availableReferences || []).map(reference =>
        Number(window.DATA.listPrice(reference, reference.sizeCode)) || 0);
      if (!prices.length) return '—';
      const min = Math.min(...prices), max = Math.max(...prices);
      return min === max ? fmt(min) : fmt(min) + ' – ' + fmt(max);
    }
    const r = window.DATA.priceRange(p);
    return r.unico ? fmt(r.min) : fmt(r.min) + ' – ' + fmt(r.max);
  };
  const { MS, ProductImage } = window.HX;
  const D = window.DATA;
  const h = React.createElement;

  // Filtros derivados del catálogo de categorías (administrable en Configuración).
  function catFilters() {
    return [{ id: 'all', label: 'Todos' }]
      .concat(window.CONFIG.list('category').map(c => ({ id: c.code, label: c.label })));
  }

  function POSScreen({ layout, catalogView, onNav }) {
    const CAT_FILTERS = catFilters();
    const ticketBottom = layout === 'bottom';
    const [query, setQuery] = useState('');
    const [cat, setCat] = useState('all');
    const [talla, setTalla] = useState('all');
    const [color, setColor] = useState('all');
    const [onlyPop, setOnlyPop] = useState(false);
    const [catalogVersion, setCatalogVersion] = useState(() => window.CONFIG.version || 0);
    useEffect(() => {
      const refreshCatalogs = () => setCatalogVersion(window.CONFIG.version || Date.now());
      window.addEventListener('configchange', refreshCatalogs);
      return () => window.removeEventListener('configchange', refreshCatalogs);
    }, []);
    // Estructura por categoría tal como la define Configuración → Catálogos de
    // producto: un grupo por categoría, sus tallas en el orden configurado y
    // todas las activas aunque hoy ningún producto tenga stock. La clave de cada
    // opción conserva categoría + identidad de talla.
    const TALLA_GRUPOS = useMemo(() => D.resolveSizeFilterGroups(), [catalogVersion]);
    useEffect(() => {
      if (talla === 'all') return;
      const vigente = TALLA_GRUPOS.some(grupo => grupo.sizes.some(size => size.filterKey === talla));
      if (!vigente) setTalla('all');
    }, [talla, catalogVersion]);
    const COLORS = window.CONFIG.list('color');
    const [ticket, setTicket] = useState([]);
    const [additionalDiscounts, setAdditionalDiscounts] = useState([]);
    const [discountOpen, setDiscountOpen] = useState(false);
    const [client, setClient] = useState(D.clients.find(c => c.generic));
    const [sizePick, setSizePick] = useState(null);
    const [checkout, setCheckout] = useState(false);
    const [pendingMetodo, setPendingMetodo] = useState(null); // venta por confirmar vendedor
    const [success, setSuccess] = useState(null);             // venta registrada
    const [flash, setFlash] = useState(null);                 // línea recién agregada por escáner (destello verde)
    const [cartOpen, setCartOpen] = useState(false);
    const [cartFeedback, setCartFeedback] = useState(null);
    const viewportBand = useViewportBand();
    const cartTriggerRef = useRef(null);
    const feedbackTimer = useRef(null);
    window.UI.useSyncActivity(!!(ticket.length || checkout || pendingMetodo),
      ['config','products','promotions','clients','sellers','sales','payments','movements'],
      { screen: 'pos' });
    const scanRef = useRef(null);

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      return D.commercialProducts().filter(p => {
        const candidates = p.isFamilyProjection ? p.references : [p];
        if (onlyPop && !candidates.some(row => row.pop)) return false;
        if (cat !== 'all' && !candidates.some(row => row.cat === cat)) return false;
        if (!candidates.some(row => D.sizeFilterMatch(row, talla))) return false;
        if (color !== 'all' && !candidates.some(row => row.color === color)) return false;
        if (!q) return true;
        return p.isFamilyProjection ? p.searchText.includes(q)
          : p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.colorName.toLowerCase().includes(q);
      });
    }, [query, cat, talla, color, onlyPop]);

    function flashLine(key) { setFlash(key); setTimeout(() => setFlash(k => (k === key ? null : k)), 900); }
    function onScan(e) {
      if (e.key !== 'Enter') return;
      // Lee el valor real del DOM (más confiable que el estado ante lectores muy rápidos).
      const raw = String(e.target && e.target.value != null ? e.target.value : query).trim();
      if (!raw) return;
      // 1) ¿Código de barras SKU-TALLA? (lector USB HID o tecleado) → agrega la talla exacta al ticket.
      const barcodeResult = window.BARCODES && window.BARCODES.resolve(raw);
      const hit = barcodeResult && barcodeResult.ok ? barcodeResult.hit : null;
      if (hit) { addToTicket(hit.p, hit.talla); setQuery(''); flashLine(hit.productId); return; }
      if (barcodeResult && barcodeResult.code === 'BARCODE_AMBIGUOUS') {
        toast('Código bloqueado: resuelve a más de una referencia. Resincroniza antes de vender.', 'var(--danger)'); return;
      }
      // 2) Coincidencia exacta por SKU → abre el selector de talla.
      const q = raw.toLowerCase();
      const exactMatches = D.products.filter(p => p.sku.toLowerCase() === q);
      if (exactMatches.length > 1) {
        toast(`${exactMatches.length} referencias comparten ese SKU. Selecciona la referencia por sus atributos.`, 'var(--warning)');
        setQuery(raw); return;
      }
      const target = exactMatches[0] || filtered[0];
      if (target) { openSize(target); setQuery(''); return; }
      // 3) Sin resultado: mensaje según parezca código o búsqueda libre.
      const looksCode = window.BARCODES && window.BARCODES.parse(raw);
      toast(looksCode ? ('Código no encontrado: ' + raw.toUpperCase()) : ('Sin coincidencias para "' + raw + '"'), 'var(--danger)');
    }

    // Lector de código de barras USB (HID): captura GLOBAL — funciona aunque el campo de escaneo
    // no tenga el foco. Distingue lector de tecleo humano por la cadencia entre teclas
    // (un lector teclea < ~30 ms/carácter; si hay una pausa > 50 ms, se reinicia el búfer).
    const scanRT = useRef({});
    scanRT.current = { addToTicket, flashLine, scanEl: scanRef.current, blocked: !!(sizePick || checkout || pendingMetodo || success) };
    useEffect(() => {
      let buf = '', lt = 0;
      function onKey(e) {
        const st = scanRT.current;
        if (document.activeElement === st.scanEl) return; // si el campo tiene foco, lo maneja onScan
        if (e.key === 'Enter') {
          const code = buf; buf = '';
          if (st.blocked || code.length < 4) return;       // hay un modal abierto o ráfaga muy corta
          const result = window.BARCODES && window.BARCODES.resolve(code);
          if (result && result.code === 'BARCODE_AMBIGUOUS') {
            toast('Código ambiguo bloqueado. Resincroniza el inventario.', 'var(--danger)'); return;
          }
          const hit = result && result.ok ? result.hit : null;
          if (!hit) return;                                // no es un código conocido → no intervenir
          e.preventDefault();
          st.addToTicket(hit.p, hit.talla);
          st.flashLine(hit.productId);
          return;
        }
        if (e.key && e.key.length === 1) {
          const now = Date.now();
          if (now - lt > 50) buf = '';                     // pausa larga → tecleo humano, reinicia
          buf += e.key; lt = now;
        }
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);
    function openSize(p) { setSizePick(p); }
    const validateStock = () => window.CONFIG.get('pos.validateStock');
    function addToTicket(p, talla) {
      const key = p.id + '-' + talla;
      if (validateStock()) {
        const ex = ticket.find(l => l.key === key);
        const enTicket = ex ? ex.qty : 0;
        if (enTicket + 1 > D.stockOf(p, talla)) {
          toast(`Sin stock de ${p.nombre} talla ${talla} (${D.stockOf(p, talla)} pz)`, 'var(--danger)');
          return;
        }
      }
      setTicket(prev => {
        const ex = prev.find(l => l.key === key);
        if (ex) return prev.map(l => l.key === key ? { ...l, qty: l.qty + 1 } : l);
        return [...prev, { key, productId: p.id, p, talla, qty: 1 }];
      });
      setAdditionalDiscounts([]);
      setSizePick(null);
      setCartFeedback({ key, nombre: p.nombre, talla });
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = setTimeout(() => setCartFeedback(current => current && current.key === key ? null : current), 1800);
    }
    useEffect(() => () => clearTimeout(feedbackTimer.current), []);
    function setQty(key, d) {
      setAdditionalDiscounts([]);
      setTicket(prev => prev.flatMap(l => {
        if (l.key !== key) return [l];
        if (d > 0 && validateStock() && l.qty + d > D.stockOf(l.p, l.talla)) {
          toast(`Sin stock: ${D.stockOf(l.p, l.talla)} pz disponibles`, 'var(--danger)');
          return [l];
        }
        const q = l.qty + d;
        return q <= 0 ? [] : [{ ...l, qty: q }];
      }));
    }
    function removeLine(key) { setAdditionalDiscounts([]); setTicket(prev => prev.filter(l => l.key !== key)); }

    // Descuentos automáticos (window.PROMOS): precio efectivo por línea.
    // H-32: cada renglón resuelve su descuento UNA sola vez. La resolución viaja con la línea
    // hasta el resumen, el ticket y recordSale; nadie vuelve a consultar el motor.
    const resolved = ticket.map(l => Object.assign({}, l, { res: D.resolveLineDiscount(l.p, l.talla) }));
    const quote = resolved.length ? D.saleQuote(resolved, additionalDiscounts) : {
      originalTotal: 0, beforeAdditionalTotal: 0, configuredDiscountTotal: 0,
      additionalDiscountTotal: 0, finalTotal: 0, subtotal: 0, iva: 0, applications: [],
    };
    const subtotalOrig = quote.originalTotal;
    const subtotal = quote.beforeAdditionalTotal;
    const discount = quote.configuredDiscountTotal;
    const itemCount = ticket.reduce((a, l) => a + l.qty, 0);
    // Regla de Finanzas: todos los precios ya incluyen IVA 16%. El descuento se aplica
    // al precio con IVA y después se separan Importe + IVA, sin volver a sumarlo.
    const ivaPct = 16;
    const ivaIncluded = true;
    const grandTotal = quote.finalTotal;
    const importe = quote.subtotal;
    const iva = quote.iva;

    // Paso 1→2: confirmar cobro abre el selector "¿quién realizó esta venta?"
    function onCobrar(pago) { setCheckout(false); setPendingMetodo(pago); }
    // Paso 2→3: con el vendedor elegido se registra la venta y se muestra el éxito
    function onSellerConfirm(sellerId) {
      const estado = pendingMetodo.metodo === 'Apartado' ? 'Apartado' : 'Pagado';
      try {
        const sale = D.recordSale({
          ticket: resolved, additionalDiscounts, quote, sellerIds: [sellerId], client, metodo: pendingMetodo.metodo, estado,
          subtotal: importe, iva, total: grandTotal, anticipo: pendingMetodo.anticipo,
          pagoEfectivo: pendingMetodo.pagoEfectivo, pagoOtro: pendingMetodo.pagoOtro,
          pagoDetalle: pendingMetodo.pagoDetalle, metodoPago: pendingMetodo.metodoPago,
          ivaPct, ivaIncluded, itemCount,
        });
        setPendingMetodo(null);
        setSuccess(sale);
      } catch (e) {
        toast(e.message || 'Los importes de la venta no cuadran', 'var(--danger)');
      }
    }
    function onNewSale() { setSuccess(null); setTicket([]); setAdditionalDiscounts([]); setClient(D.clients.find(c => c.generic)); }

    // ---- Catálogo ----
    const catalog = h('section', { key: 'catalog', className: 'pos-cat flex-1 flex flex-col min-w-0 min-h-0' }, [
      // Captura / scan
      h('div', { key: 'cap', className: 'flex flex-col sm:flex-row gap-3 mb-6' }, [
        h('div', { key: 'scan', className: 'relative flex-1' }, [
          h('span', { key: 'i', className: 'absolute inset-y-0 left-0 pl-3.5 flex items-center text-on-surface-variant/50' }, h(MS, { name: 'barcode', size: 20 })),
          h('input', {
            key: 'in', ref: scanRef,
            'data-testid': 'pos-barcode-input',
            className: 'block w-full pl-11 pr-4 h-12 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary focus:border-primary text-sm rounded-xl transition-all placeholder:text-on-surface-variant/40',
            placeholder: 'Escanea código de barras o busca productos…',
            value: query, onChange: e => setQuery(e.target.value), onKeyDown: onScan, autoFocus: true,
          }),
        ]),
        h('button', {
          key: 'pop',
          className: 'h-12 px-5 flex items-center gap-2 text-caption font-semibold uppercase tracking-wider rounded-xl border transition-all ' +
            (onlyPop ? 'bg-gold text-on-gold border-gold' : 'bg-surface border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'),
          onClick: () => setOnlyPop(v => !v),
        }, [h(MS, { key: 'i', name: 'star', size: 20, fill: onlyPop }), 'Populares']),
      ]),
      // Filtros
      h('div', { key: 'fil', className: 'flex items-center gap-2 mb-6 sm:mb-8 overflow-x-auto pb-2 min-w-0', tabIndex: 0, role: 'region', 'aria-label': 'Filtros del catálogo' }, [
        // Desplegables compactos: primero talla, luego color.
        h(FilterSelect, {
          key: 'ft', value: talla, active: talla !== 'all', onChange: e => setTalla(e.target.value),
          testid: 'pos-size-filter',
        }, [
          h('option', { key: 'all', value: 'all' }, 'Todas las tallas'),
          // Un <optgroup> por categoría: el menú nativo dibuja el encabezado y
          // no permite seleccionarlo, así que «Todas las tallas» sigue siendo la
          // única opción global y ninguna categoría se mezcla con otra.
          ...TALLA_GRUPOS.map(grupo => h('optgroup', {
            key: grupo.categoryId,
            label: grupo.categoryLabel,
          }, grupo.sizes.map(t => h('option', {
            key: t.filterKey,
            value: t.filterKey,
          }, t.label)))),
        ]),
        h(FilterSelect, {
          key: 'fc', value: color, active: color !== 'all', onChange: e => setColor(e.target.value),
        }, [
          h('option', { key: 'all', value: 'all' }, 'Todos los colores'),
          ...COLORS.map(c => h('option', { key: c.code, value: c.code }, c.label)),
        ]),
        ...CAT_FILTERS.map(f => h('button', {
          key: f.id,
          className: 'min-h-11 px-5 py-2 text-caption font-semibold uppercase tracking-wider rounded-full whitespace-nowrap border transition-all ' +
            (cat === f.id ? 'bg-gold text-on-gold border-gold shadow-e1' : 'bg-surface border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'),
          onClick: () => setCat(f.id),
        }, f.label)),
        h('span', { key: 'count', className: 'ml-auto text-muted text-caption whitespace-nowrap font-medium' }, `${filtered.length} productos`),
      ]),
      // Grid / Lista
      h('div', { key: 'scroll', className: 'flex-1 min-h-0 overflow-y-auto no-scrollbar pr-2 -mr-2', 'data-testid': 'pos-catalog-scroll' },
        catalogView === 'list'
          ? h('div', { className: 'flex flex-col divide-y divide-outline-variant bg-surface-container-lowest rounded-xl overflow-hidden shadow-e1' },
              filtered.map(p => h(ProductRow, { key: p.id, p, onAdd: () => openSize(p) })))
          : h('div', { className: 'pos-cat-grid grid gap-8' },
              filtered.map(p => h(ProductCard, { key: p.id, p, onAdd: () => openSize(p) })))),
    ]);

    const ticketPanel = h(window.TicketPanel, {
      key: 'ticket',
      ticket: resolved, client, subtotal, subtotalOrig, discount, itemCount, grandTotal,
      quote, additionalDiscounts,
      onPickClient: setClient, onResetClient: () => setClient(D.clients.find(c => c.generic)),
      onQty: setQty, onRemove: removeLine, onCobrar: () => setCheckout(true),
      onAdditionalDiscount: () => setDiscountOpen(true),
      onRemoveAdditionalDiscount: id => setAdditionalDiscounts(prev => prev.filter(x => x.id !== id)),
      onClear: () => { setTicket([]); setAdditionalDiscounts([]); }, bottom: ticketBottom, flashKey: flash, surface: viewportBand === 'desktop' ? 'inline' : 'overlay',
    });
    const compactCart = viewportBand !== 'desktop' && h(CartAccess, {
      key: 'cart-access', itemCount, total: grandTotal, feedback: cartFeedback,
      onOpen: () => setCartOpen(true), triggerRef: cartTriggerRef, tablet: viewportBand === 'tablet',
    });
    const cartOverlay = viewportBand !== 'desktop' && cartOpen && h(CartOverlay, {
      key: 'cart-overlay', mobile: viewportBand === 'mobile', onClose: () => setCartOpen(false), returnFocusRef: cartTriggerRef,
    }, ticketPanel);

    return h('div', {
      className: 'flex-1 min-h-0 min-w-0 bg-background font-body text-on-surface px-4 pt-6 pb-28 sm:px-6 sm:pt-6 sm:pb-28 lg:px-8 lg:pt-8 lg:pb-28 xl:pb-8 flex flex-col xl:flex-row gap-6 lg:gap-8 ' + (ticketBottom ? 'xl:flex-col' : ''),
    }, [
      catalog,
      viewportBand === 'desktop' && ticketPanel,
      compactCart,
      cartOverlay,
      sizePick && h(SizeModal, { key: 'sm', p: sizePick, onClose: () => setSizePick(null), onPick: addToTicket }),
      discountOpen && h(window.AdditionalDiscountModal, {
        key: 'ad', ticket: resolved, existing: additionalDiscounts,
        onClose: () => setDiscountOpen(false),
        onConfirm: app => { setAdditionalDiscounts(prev => prev.concat(app)); setDiscountOpen(false); },
      }),
      checkout && h(window.CheckoutModal, { key: 'co', total: grandTotal, itemCount, client, quote, onClose: () => setCheckout(false), onConfirm: onCobrar }),
      pendingMetodo && h(SellerPickModal, { key: 'sp', onClose: () => setPendingMetodo(null), onConfirm: onSellerConfirm }),
      success && h(SuccessModal, { key: 'ok', sale: success, onNew: onNewSale }),
      success && h(window.BalamTicket, { key: 'tk', sale: success }),
    ]);
  }

  function useViewportBand() {
    const read = () => window.innerWidth >= 1280 ? 'desktop' : window.innerWidth >= 768 ? 'tablet' : 'mobile';
    const [band, setBand] = useState(read);
    useEffect(() => {
      const onResize = () => setBand(read());
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, []);
    return band;
  }

  function CartAccess({ itemCount, total, feedback, onOpen, triggerRef, tablet }) {
    const empty = itemCount === 0;
    return h('div', {
      className: (tablet ? 'fixed right-6 bottom-6 w-[360px]' : 'fixed inset-x-0 bottom-0 w-full') + ' z-40 px-3 pt-2 bg-surface/95 backdrop-blur border-t border-outline-variant shadow-e3',
      style: { paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' },
      'data-testid': 'pos-cart-access',
    }, h('button', {
      ref: triggerRef, type: 'button', disabled: empty, onClick: onOpen,
      className: 'w-full min-h-14 px-4 rounded-xl bg-primary text-on-primary flex items-center gap-3 text-left disabled:opacity-60 transition ' + (feedback ? 'ring-4 ring-success/30' : ''),
      'data-testid': 'pos-cart-open', 'aria-haspopup': 'dialog',
      'aria-label': empty ? 'Venta vacía' : `Ver venta, ${itemCount} artículos, total ${fmt(total)}`,
    }, [
      h(MS, { key: 'i', name: feedback ? 'check' : 'shopping_cart', size: 22 }),
      h('span', { key: 'copy', className: 'flex-1 min-w-0' }, [
        h('span', { key: 'main', className: 'block text-caption font-bold uppercase tracking-wider' }, empty ? 'Venta vacía' : `Ver venta (${itemCount})`),
        h('span', { key: 'feedback', className: 'block text-overline truncate opacity-75', 'aria-live': 'polite' }, feedback ? `${feedback.nombre} · talla ${feedback.talla} agregado` : 'Resumen siempre disponible'),
      ]),
      h('span', { key: 'total', className: 'font-headline text-lg shrink-0' }, fmt(total)),
    ]));
  }

  function CartOverlay({ mobile, onClose, returnFocusRef, children }) {
    const panelRef = useRef(null);
    useEffect(() => {
      const focusable = () => panelRef.current ? [...panelRef.current.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(node => node.offsetParent !== null) : [];
      const onKey = event => {
        if (event.key === 'Escape') { onClose(); return; }
        if (event.key !== 'Tab') return;
        const nodes = focusable(); if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      };
      window.addEventListener('keydown', onKey);
      requestAnimationFrame(() => focusable()[0]?.focus());
      return () => { window.removeEventListener('keydown', onKey); requestAnimationFrame(() => returnFocusRef.current?.focus()); };
    }, []);
    return h('div', { className: 'fixed inset-0 z-[140] bg-on-surface/40 flex ' + (mobile ? 'items-end' : 'justify-end'), onMouseDown: event => { if (event.target === event.currentTarget) onClose(); } },
      h('section', {
        ref: panelRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Resumen de venta', 'data-testid': 'pos-cart-surface',
        className: 'bg-surface min-w-0 flex flex-col shadow-e3 ' + (mobile ? 'w-full max-h-[88dvh] rounded-t-2xl' : 'h-full w-[min(460px,92vw)]'),
        style: mobile ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined,
      }, [
        h('header', { key: 'h', className: 'min-h-16 px-4 flex items-center border-b border-outline-variant' }, [
          h('h2', { key: 't', className: 'flex-1 font-headline text-headline-md text-primary' }, 'Resumen de venta'),
          h('button', { key: 'x', onClick: onClose, className: 'w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-container', 'aria-label': 'Cerrar resumen' }, h(MS, { name: 'close', size: 20 })),
        ]),
        h('div', { key: 'b', className: 'flex-1 min-h-0 overflow-hidden p-3' }, children),
      ]));
  }

  // Desplegable de filtro compacto (talla / color) con estética de "pill".
  function FilterSelect({ value, active, onChange, children, testid }) {
    // Chromium puede usar los colores del <select> como base para su popup
    // nativo. El control cerrado conserva el gold activo; las opciones
    // recuperan la superficie normal y el navegador decide selección y hover.
    // Recorre también el interior de un <optgroup>: la cascada debe llegar a la
    // <option>, que es lo que Chromium pinta, no sólo al grupo que la contiene.
    const paint = child => {
      if (!React.isValidElement(child)) return child;
      const painted = { className: ((child.props.className || '') + ' bg-surface text-on-surface').trim() };
      if (child.type === 'optgroup') painted.children = React.Children.map(child.props.children, paint);
      return React.cloneElement(child, painted);
    };
    const menuOptions = React.Children.map(children, paint);
    return h('div', { className: 'relative shrink-0' }, [
      h('select', {
        key: 's', value, onChange, 'data-testid': testid,
        className: 'h-11 pl-4 pr-9 text-caption font-semibold uppercase tracking-wider rounded-full border appearance-none cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary ' +
          (active ? 'bg-gold text-on-gold border-gold shadow-e1' : 'bg-surface border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'),
      }, menuOptions),
      h('span', { key: 'c', className: 'pointer-events-none absolute inset-y-0 right-0 pr-2.5 flex items-center ' + (active ? 'text-on-gold' : 'text-on-surface-variant') }, h(MS, { name: 'chevDown', size: 16 })),
    ]);
  }

  // Modal: ¿quién realizó esta venta? (selección única, post-cobro)
  function SellerPickModal({ onClose, onConfirm }) {
    const [sel, setSel] = useState(null);
    const lista = D.sellers.filter(D.isEligibleSeller);
    const footer = [
      h('button', {
        key: 'k', 'data-testid': 'seller-pick-confirm', className: 'w-full py-3.5 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-xl hover:opacity-90 transition disabled:opacity-40',
        disabled: !sel, onClick: () => sel && onConfirm(sel),
      }, 'Confirmar vendedor'),
    ];
    return h(Modal, { title: '¿Quién realizó esta venta?', onClose, footer }, [
      h('div', { key: 'g', className: 'grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 py-2' }, lista.map(s => {
        const on = sel === s.id;
        return h('button', {
          key: s.id, 'data-testid': 'seller-pick-' + s.id, className: 'flex flex-col items-center gap-2 group', onClick: () => setSel(s.id),
        }, [
          s.avatar
            ? h('img', { key: 'a', src: s.avatar, className: 'w-14 h-14 rounded-full object-cover border-2 transition-all ' + (on ? 'border-primary' : 'border-transparent group-hover:border-outline') })
            : h('div', { key: 'a', className: 'w-14 h-14 rounded-full grid place-items-center font-bold text-white border-2 transition-all ' + (on ? 'border-primary' : 'border-transparent group-hover:border-outline'), style: { background: s.color } }, s.iniciales),
          h('span', { key: 'n', className: 'text-overline font-bold ' + (on ? 'text-primary' : 'text-on-surface-variant') }, s.nombre.split(' ')[0] + ' ' + (s.nombre.split(' ')[1] ? s.nombre.split(' ')[1][0] + '.' : '')),
        ]);
      })),
    ]);
  }

  // Modal: venta exitosa (+ impresión de ticket)
  function SuccessModal({ sale, onNew }) {
    window.UI.useReceiptAutoPrint();
    const footer = [
      h('button', { key: 'p', className: 'flex-1 py-3.5 border border-outline-variant text-on-surface text-caption font-bold uppercase tracking-widest rounded-xl hover:bg-surface-container transition flex items-center justify-center gap-2', onClick: () => window.print() }, [h(MS, { key: 'i', name: 'print', size: 18 }), 'Imprimir ticket']),
      h('button', { key: 'n', className: 'flex-1 py-3.5 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-xl hover:opacity-90 transition', onClick: onNew }, 'Nueva venta'),
    ];
    return h(Modal, { title: '', onClose: onNew, footer }, [
      h('div', { key: 'b', className: 'text-center py-2' }, [
        h('div', { key: 'i', className: 'w-16 h-16 bg-success-soft text-success rounded-full grid place-items-center mx-auto mb-6' }, h(MS, { name: 'check', size: 32 })),
        h('h2', { key: 't', className: 'font-headline text-h1 text-primary mb-2' }, 'Venta exitosa'),
        h('p', { key: 'p', className: 'text-caption text-on-surface-variant leading-relaxed' }, `Folio ${sale.folio} · comprobante generado para ${sale.cliente}.`),
      ]),
    ]);
  }

  // Tarjeta de producto (grid) — ref: slate refined
  function ProductCard({ p, onAdd }) {
    const total = p.isFamilyProjection ? p.totalStock : D.totalStock(p);
    const out = total === 0;
    const subtitle = (p.orn && p.orn !== '—') ? p.orn : D.TELA[p.tela];
    return h('div', {
      'data-testid': 'pos-product-' + (p.commercialKey || p.id),
      className: 'group flex flex-col bg-surface-container-lowest rounded-xl overflow-hidden transition-all duration-300 shadow-e1 ' +
        (out ? 'opacity-50' : 'cursor-pointer hover:-translate-y-0.5 hover:shadow-e2'),
      onClick: out ? null : onAdd,
    }, [
      h('div', { key: 'img', className: 'aspect-[4/5] bg-surface-container-low relative overflow-hidden' }, [
        h(ProductImage, { key: 'i', p, className: 'w-full h-full', imgClassName: 'group-hover:scale-[1.03] transition-transform duration-500' }),
        p.pop && !out && h('div', { key: 'ex', className: 'absolute top-3 left-3 px-2 py-1 bg-primary text-on-primary text-overline uppercase rounded' }, 'Exclusivo'),
        h('div', { key: 's', className: 'absolute bottom-3 right-3 px-2 py-1 bg-surface/90 backdrop-blur text-overline uppercase rounded shadow-e1' }, out ? 'Agotado' : 'Stock: ' + total),
      ]),
      h('div', { key: 'b', className: 'p-5 flex flex-col flex-1' }, [
        h('div', { key: 'h', className: 'mb-3' }, [
          h('h3', { key: 'n', className: 'font-headline text-h2 text-primary leading-tight' }, p.nombre),
          h('p', { key: 's', className: 'text-overline uppercase text-on-surface-variant mt-1 truncate' }, p.isFamilyProjection ? `${p.availableReferences.length} referencias disponibles` : subtitle),
        ]),
        h('div', { key: 'm', className: 'mt-auto flex justify-between items-center' }, [
          h('span', { key: 'p', className: 'font-headline text-h2 text-primary' }, precioCatalogo(p)),
          out ? null : h('button', {
            key: 'add',
            className: 'w-11 h-11 bg-surface-container-low text-primary rounded-xl flex items-center justify-center hover:bg-primary hover:text-on-primary transition-all',
            'data-testid': 'pos-product-add-' + (p.commercialKey || p.id),
            onClick: e => { e.stopPropagation(); onAdd(); }, title: 'Agregar',
          }, h(MS, { name: 'plus', size: 20 })),
        ]),
      ]),
    ]);
  }

  // Fila de producto (lista)
  function ProductRow({ p, onAdd }) {
    const total = p.isFamilyProjection ? p.totalStock : D.totalStock(p);
    const out = total === 0;
    return h('div', {
      'data-testid': 'pos-product-' + (p.commercialKey || p.id),
      className: 'flex items-center gap-4 p-3 hover:bg-surface-container-low transition-colors ' + (out ? 'opacity-50' : 'cursor-pointer'),
      onClick: out ? null : onAdd,
    }, [
      h(ProductImage, { key: 't', p, className: 'w-12 h-14 shrink-0 rounded-lg ring-1 ring-outline-variant/50' }),
      h('div', { key: 'n', className: 'flex-1 min-w-0' }, [
        h('div', { key: 'a', className: 'font-headline text-body text-primary truncate' }, p.nombre),
        h('div', { key: 'b', className: 'text-overline uppercase text-on-surface-variant' }, p.isFamilyProjection ? `${total} piezas · ${p.referenceCount} referencias` : p.sku),
      ]),
      h('span', { key: 'm', className: 'font-headline text-body text-primary w-28 text-right' }, precioCatalogo(p)),
      h('button', {
        key: 'add', className: 'w-9 h-9 bg-surface-container-low text-primary rounded-xl flex items-center justify-center hover:bg-primary hover:text-on-primary transition-all shrink-0',
        onClick: e => { e.stopPropagation(); if (!out) onAdd(); },
      }, h(MS, { name: 'plus', size: 18 })),
    ]);
  }

  // Modal de talla
  function SizeModal({ p, onClose, onPick }) {
    if (p.isFamilyProjection) return h(FamilySizeModal, { p, onClose, onPick });
    const resolved = D.resolveProductSizes(p);
    const sizes = resolved.sizes.filter(size => size.active && size.stock > 0);
    return h(Modal, { title: 'Selecciona talla', onClose, testId: 'pos-size-picker' }, [
      h('div', { key: 'h', className: 'flex items-center gap-4 mb-5' }, [
        h(ProductImage, { key: 't', p, className: 'w-16 h-20 rounded-lg ring-1 ring-outline-variant/50' }),
        h('div', { key: 'i' }, [
          h('div', { key: 'n', className: 'font-headline text-h2 text-primary' }, p.nombre),
          h('div', { key: 's', className: 'text-overline uppercase text-on-surface-variant' }, p.sku),
          h('div', { key: 'p', className: 'font-headline text-h2 text-primary mt-1' }, precioCatalogo(p)),
        ]),
      ]),
      h('div', { key: 'lbl', className: 'text-overline uppercase text-on-surface-variant mb-3' }, 'Tallas disponibles'),
      resolved.requiresAssignment && h('div', {
        key: 'warn',
        className: 'p-3 mb-3 rounded-lg bg-warning-soft text-warning text-caption',
      }, resolved.ambiguous
        ? 'Este producto tiene existencias en más de una categoría. Asígnale una categoría en Inventario antes de venderlo.'
        : 'Este producto no tiene una categoría por talla asignada. Corrígelo en Inventario antes de venderlo.'),
      h('div', { key: 'category', className: 'mb-4' }, [
          h('div', { key: 'sz', className: 'flex flex-wrap gap-2' },
            sizes.map(size => h('button', {
              key: size.sizeId,
              'data-testid': 'legacy-size-pick-' + size.sizeId,
              className: 'flex flex-col items-center gap-0.5 min-w-[64px] px-3 py-2.5 border border-outline-variant hover:border-primary hover:bg-surface-container-low transition-colors rounded-lg',
              onClick: () => onPick(p, size.value),
            }, [
              h('span', { key: 't', className: 'font-semibold text-body text-primary' }, size.label),
              // H-36: el precio real de la talla, visible antes de agregarla.
              h('span', { key: 'p', className: 'text-caption font-semibold text-gold-text' }, fmt(D.listPrice(p, size.value))),
              h('span', { key: 's', className: 'text-caption text-muted' }, size.stock + ' pz'),
              D.effectiveOrnamentColors(p, size.value).length
                ? h('span', {
                    key: 'oc', className: 'text-overline text-on-surface-variant mt-1',
                    'data-testid': 'effective-ornament-colors-' + size.sizeId,
                  }, D.effectiveOrnamentColors(p, size.value).join(' + '))
                : null,
            ]))),
        ]),
    ]);
  }

  function referencePartValue(reference, part) {
    if (part.effectiveSize) return String(reference.sizeCode || '');
    if (part.custom) {
      const value = (reference.attrs || {})[part.kind];
      return value == null && part.kind === window.CONFIG.modeloKind() ? reference.modelo : value;
    }
    return part.field ? reference[part.field] : undefined;
  }

  function humanCatalogValue(kind, value) {
    const values = Array.isArray(value) ? value : [value];
    return values.filter(item => item != null && item !== '').map(item => {
      const found = window.CONFIG.find(kind, item);
      return found ? found.label : String(item);
    }).join(' + ');
  }

  function referenceVariantLabel(reference, references) {
    const parts = window.CONFIG.referenceParts().filter(part => !part.effectiveSize).filter(part => {
      const values = references.map(row => JSON.stringify(referencePartValue(row, part)));
      return values.some(value => value !== values[0]);
    });
    const labels = parts.map(part => ({
      field: window.CONFIG.catalogLabel(part.kind),
      value: humanCatalogValue(part.kind, referencePartValue(reference, part)),
    })).filter(item => item.value);
    if (labels.length === 1) return labels[0].value;
    return labels.map(item => `${item.field}: ${item.value}`).join(' · ');
  }

  function referencePriceLabel(references) {
    const prices = references.map(reference => Number(D.listPrice(reference, reference.sizeCode)) || 0);
    const min = Math.min(...prices), max = Math.max(...prices);
    return min === max ? fmt(min) : fmt(min) + ' – ' + fmt(max);
  }

  // H-111: el POS proyecta familias V2 como una selección comercial por talla.
  // La proyección sólo presenta; toda salida sigue siendo una referencia products.id exacta.
  function FamilySizeModal({ p, onClose, onPick }) {
    const [variantGroup, setVariantGroup] = useState(null);
    const visualSku = D.familyVisualSku(p);
    const availableGroups = p.sizeGroups.filter(group => group.stock > 0);
    const availableFamilyReferences = p.availableReferences || [];
    const pickSize = group => {
      const availableReferences = group.references.filter(reference => Number(reference.stockQuantity) > 0);
      if (availableReferences.length === 1) onPick(availableReferences[0], availableReferences[0].sizeCode);
      else setVariantGroup({ ...group, availableReferences });
    };
    const title = variantGroup ? 'Selecciona variante' : 'Selecciona talla';
    return h(Modal, { title, onClose, testId: variantGroup ? 'pos-family-variant-picker' : 'pos-family-size-picker' }, [
      h('div', { key: 'root', 'data-testid': 'family-size-picker' }, [
        h('div', { key: 'h', className: 'flex items-center gap-4 mb-5' }, [
          h(ProductImage, { key: 't', p, className: 'w-16 h-20 rounded-lg ring-1 ring-outline-variant/50' }),
          h('div', { key: 'i', className: 'min-w-0' }, [
            h('div', { key: 'n', className: 'font-headline text-h2 text-primary' }, p.nombre),
            h('div', { key: 's', className: 'text-overline uppercase text-on-surface-variant [overflow-wrap:anywhere]' }, visualSku),
            h('div', { key: 'p', className: 'font-headline text-h2 text-primary mt-1' }, referencePriceLabel(availableFamilyReferences)),
          ]),
        ]),
        variantGroup
          ? h('div', { key: 'variants' }, [
              h('div', { key: 'bar', className: 'flex items-center justify-between gap-3 mb-3' }, [
                h('div', { key: 'lbl', className: 'text-overline uppercase text-on-surface-variant' }, `Talla ${variantGroup.label}`),
                h('button', { key: 'back', type: 'button', onClick: () => setVariantGroup(null), 'data-testid': 'family-variant-back', className: 'text-caption font-semibold text-primary hover:underline' }, 'Volver a tallas'),
              ]),
              h('div', { key: 'list', className: 'grid gap-2' }, variantGroup.availableReferences.map(reference => h('button', {
                key: reference.id, type: 'button', onClick: () => onPick(reference, reference.sizeCode),
                'data-testid': 'family-variant-pick-' + reference.id,
                className: 'min-h-12 px-3 py-2.5 rounded-lg border border-outline-variant text-left flex flex-wrap items-center gap-x-3 gap-y-1 hover:border-primary hover:bg-surface-container-low transition-colors',
              }, [
                h('span', { key: 'v', className: 'flex-1 min-w-[10rem] text-body font-semibold text-primary [overflow-wrap:anywhere]' }, referenceVariantLabel(reference, variantGroup.availableReferences)),
                h('span', { key: 'p', className: 'font-headline text-body text-primary whitespace-nowrap' }, fmt(D.listPrice(reference, reference.sizeCode))),
                h('span', { key: 's', className: 'text-caption text-muted whitespace-nowrap' }, reference.stockQuantity + ' pz'),
              ]))),
            ])
          : h('div', { key: 'sizes' }, [
              h('div', { key: 'lbl', className: 'text-overline uppercase text-on-surface-variant mb-3' }, 'Tallas disponibles'),
              h('div', { key: 'list', className: 'flex flex-wrap gap-2' }, availableGroups.map(group => {
                const availableReferences = group.references.filter(reference => Number(reference.stockQuantity) > 0);
                return h('button', {
                  key: group.key, type: 'button', onClick: () => pickSize(group),
                  'data-testid': 'family-size-pick-' + group.key,
                  className: 'flex flex-col items-center gap-0.5 min-w-[64px] px-3 py-2.5 border border-outline-variant hover:border-primary hover:bg-surface-container-low transition-colors rounded-lg',
                }, [
                  h('span', { key: 't', className: 'font-semibold text-body text-primary' }, group.label),
                  h('span', { key: 'p', className: 'text-caption font-semibold text-gold-text' }, referencePriceLabel(availableReferences)),
                  h('span', { key: 's', className: 'text-caption text-muted' }, group.stock + ' pz'),
                ]);
              })),
            ]),
      ]),
    ]);
  }

  window.POSScreen = POSScreen;
})();
