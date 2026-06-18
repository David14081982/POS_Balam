// pos.jsx — Punto de venta (Heritage slate). Exporta window.POSScreen
(function () {
  const { useState, useEffect, useRef, useMemo } = React;
  const { fmt, toast, Modal } = window.UI;
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
    // Catálogos administrables para los desplegables de talla y color.
    const TALLAS_L = window.CONFIG.list('size_letter');
    const TALLAS_N = window.CONFIG.list('size_number');
    const COLORS = window.CONFIG.list('color');
    const [ticket, setTicket] = useState([]);
    const [client, setClient] = useState(D.clients.find(c => c.generic));
    const [sizePick, setSizePick] = useState(null);
    const [checkout, setCheckout] = useState(false);
    const [pendingMetodo, setPendingMetodo] = useState(null); // venta por confirmar vendedor
    const [success, setSuccess] = useState(null);             // venta registrada
    const [flash, setFlash] = useState(null);                 // línea recién agregada por escáner (destello verde)
    const scanRef = useRef(null);

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      return D.products.filter(p => {
        if (onlyPop && !p.pop) return false;
        if (cat !== 'all' && p.cat !== cat) return false;
        if (talla !== 'all' && !p.stock.some(v => v.talla === talla && v.stock > 0)) return false;
        if (color !== 'all' && p.color !== color) return false;
        if (!q) return true;
        return p.nombre.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.colorName.toLowerCase().includes(q);
      });
    }, [query, cat, talla, color, onlyPop]);

    function flashLine(key) { setFlash(key); setTimeout(() => setFlash(k => (k === key ? null : k)), 900); }
    function onScan(e) {
      if (e.key !== 'Enter') return;
      // Lee el valor real del DOM (más confiable que el estado ante lectores muy rápidos).
      const raw = String(e.target && e.target.value != null ? e.target.value : query).trim();
      if (!raw) return;
      // 1) ¿Código de barras SKU-TALLA? (lector USB HID o tecleado) → agrega la talla exacta al ticket.
      const hit = window.BARCODES && window.BARCODES.find(raw);
      if (hit) { addToTicket(hit.p, hit.talla); setQuery(''); flashLine(hit.p.id + '-' + hit.talla); return; }
      // 2) Coincidencia exacta por SKU → abre el selector de talla.
      const q = raw.toLowerCase();
      const exact = D.products.find(p => p.sku.toLowerCase() === q);
      const target = exact || filtered[0];
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
          const hit = window.BARCODES && window.BARCODES.find(code);
          if (!hit) return;                                // no es un código conocido → no intervenir
          e.preventDefault();
          st.addToTicket(hit.p, hit.talla);
          st.flashLine(hit.p.id + '-' + hit.talla);
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
        return [...prev, { key, p, talla, qty: 1 }];
      });
      setSizePick(null);
      toast(`${p.nombre} · ${talla} agregado`);
    }
    function setQty(key, d) {
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
    function removeLine(key) { setTicket(prev => prev.filter(l => l.key !== key)); }

    // Descuentos automáticos (window.PROMOS): precio efectivo por línea.
    const unitOf = (l) => (window.PROMOS ? window.PROMOS.lineUnit(l.p, l.talla).unit : l.p.precio);
    const subtotalOrig = ticket.reduce((a, l) => a + l.p.precio * l.qty, 0);
    const subtotal = ticket.reduce((a, l) => a + unitOf(l) * l.qty, 0);
    const discount = Math.max(0, subtotalOrig - subtotal);
    const itemCount = ticket.reduce((a, l) => a + l.qty, 0);
    // Total a cobrar: si el IVA NO está incluido en el precio, se suma sobre la base con descuento.
    // Si está incluido (default), el precio ya lo contiene y el total es el subtotal tal cual.
    const ivaPct = window.CONFIG.get('tax.ivaPct') || 0;
    const ivaIncluded = !!window.CONFIG.get('tax.included');
    const grandTotal = ivaIncluded ? subtotal : Math.round(subtotal * (1 + ivaPct / 100) * 100) / 100;

    // Paso 1→2: confirmar cobro abre el selector "¿quién realizó esta venta?"
    function onCobrar(metodo) { setCheckout(false); setPendingMetodo(metodo); }
    // Paso 2→3: con el vendedor elegido se registra la venta y se muestra el éxito
    function onSellerConfirm(sellerId) {
      const estado = pendingMetodo === 'Apartado' ? 'Apartado' : 'Pagado';
      const sale = D.recordSale({ ticket, sellerIds: [sellerId], client, metodo: pendingMetodo, estado, total: subtotal, itemCount });
      setPendingMetodo(null);
      setSuccess(sale);
    }
    function onNewSale() { setSuccess(null); setTicket([]); setClient(D.clients.find(c => c.generic)); }

    // ---- Catálogo ----
    const catalog = h('section', { key: 'catalog', className: 'pos-cat flex-1 flex flex-col min-w-0' }, [
      // Captura / scan
      h('div', { key: 'cap', className: 'flex gap-3 mb-6' }, [
        h('div', { key: 'scan', className: 'relative flex-1' }, [
          h('span', { key: 'i', className: 'absolute inset-y-0 left-0 pl-3.5 flex items-center text-on-surface-variant/50' }, h(MS, { name: 'barcode', size: 20 })),
          h('input', {
            key: 'in', ref: scanRef,
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
      h('div', { key: 'fil', className: 'flex items-center gap-2 mb-8 overflow-x-auto pb-1' }, [
        // Desplegables compactos: primero talla, luego color.
        h(FilterSelect, {
          key: 'ft', value: talla, active: talla !== 'all', onChange: e => setTalla(e.target.value),
        }, [
          h('option', { key: 'all', value: 'all' }, 'Todas las tallas'),
          TALLAS_L.length && h('optgroup', { key: 'gl', label: 'Letras' }, TALLAS_L.map(t => h('option', { key: t.code, value: t.code }, t.label))),
          TALLAS_N.length && h('optgroup', { key: 'gn', label: 'Números' }, TALLAS_N.map(t => h('option', { key: t.code, value: t.code }, t.label))),
        ]),
        h(FilterSelect, {
          key: 'fc', value: color, active: color !== 'all', onChange: e => setColor(e.target.value),
        }, [
          h('option', { key: 'all', value: 'all' }, 'Todos los colores'),
          ...COLORS.map(c => h('option', { key: c.code, value: c.code }, c.label)),
        ]),
        ...CAT_FILTERS.map(f => h('button', {
          key: f.id,
          className: 'px-5 py-2 text-caption font-semibold uppercase tracking-wider rounded-full whitespace-nowrap border transition-all ' +
            (cat === f.id ? 'bg-gold text-on-gold border-gold shadow-e1' : 'bg-surface border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'),
          onClick: () => setCat(f.id),
        }, f.label)),
        h('span', { key: 'count', className: 'ml-auto text-muted text-caption whitespace-nowrap font-medium' }, `${filtered.length} productos`),
      ]),
      // Grid / Lista
      h('div', { key: 'scroll', className: 'flex-1 overflow-y-auto no-scrollbar pr-2 -mr-2' },
        catalogView === 'list'
          ? h('div', { className: 'flex flex-col divide-y divide-outline-variant bg-surface-container-lowest rounded-xl overflow-hidden shadow-e1' },
              filtered.map(p => h(ProductRow, { key: p.id, p, onAdd: () => openSize(p) })))
          : h('div', { className: 'pos-cat-grid grid gap-8' },
              filtered.map(p => h(ProductCard, { key: p.id, p, onAdd: () => openSize(p) })))),
    ]);

    const ticketPanel = h(window.TicketPanel, {
      key: 'ticket',
      ticket, client, subtotal, subtotalOrig, discount, itemCount, grandTotal,
      onPickClient: setClient, onResetClient: () => setClient(D.clients.find(c => c.generic)),
      onQty: setQty, onRemove: removeLine, onCobrar: () => setCheckout(true),
      onClear: () => setTicket([]), bottom: ticketBottom, flashKey: flash,
    });

    return h('div', {
      className: 'flex-1 min-h-0 bg-background font-body text-on-surface p-8 flex gap-8 ' + (ticketBottom ? 'flex-col' : ''),
    }, [
      catalog,
      ticketPanel,
      sizePick && h(SizeModal, { key: 'sm', p: sizePick, onClose: () => setSizePick(null), onPick: addToTicket }),
      checkout && h(window.CheckoutModal, { key: 'co', total: grandTotal, itemCount, client, onClose: () => setCheckout(false), onConfirm: onCobrar }),
      pendingMetodo && h(SellerPickModal, { key: 'sp', onClose: () => setPendingMetodo(null), onConfirm: onSellerConfirm }),
      success && h(SuccessModal, { key: 'ok', sale: success, onNew: onNewSale }),
      success && h(window.BalamTicket, { key: 'tk', sale: success }),
    ]);
  }

  // Desplegable de filtro compacto (talla / color) con estética de "pill".
  function FilterSelect({ value, active, onChange, children }) {
    return h('div', { className: 'relative shrink-0' }, [
      h('select', {
        key: 's', value, onChange,
        className: 'h-9 pl-4 pr-9 text-caption font-semibold uppercase tracking-wider rounded-full border appearance-none cursor-pointer transition-all focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary ' +
          (active ? 'bg-gold text-on-gold border-gold shadow-e1' : 'bg-surface border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'),
      }, children),
      h('span', { key: 'c', className: 'pointer-events-none absolute inset-y-0 right-0 pr-2.5 flex items-center ' + (active ? 'text-on-gold' : 'text-on-surface-variant') }, h(MS, { name: 'chevDown', size: 16 })),
    ]);
  }

  // Modal: ¿quién realizó esta venta? (selección única, post-cobro)
  function SellerPickModal({ onClose, onConfirm }) {
    const [sel, setSel] = useState(null);
    const lista = D.sellers.filter(s => s.active !== false);
    const footer = [
      h('button', {
        key: 'k', className: 'w-full py-3.5 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-xl hover:opacity-90 transition disabled:opacity-40',
        disabled: !sel, onClick: () => sel && onConfirm(sel),
      }, 'Confirmar vendedor'),
    ];
    return h(Modal, { title: '¿Quién realizó esta venta?', onClose, footer }, [
      h('div', { key: 'g', className: 'grid grid-cols-3 gap-4 py-2' }, lista.map(s => {
        const on = sel === s.id;
        return h('button', {
          key: s.id, className: 'flex flex-col items-center gap-2 group', onClick: () => setSel(s.id),
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
    useEffect(() => {
      if (window.CONFIG.get('print.auto')) { const t = setTimeout(() => window.print(), 350); return () => clearTimeout(t); }
    }, []);
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
    const total = D.totalStock(p);
    const out = total === 0;
    const subtitle = (p.orn && p.orn !== '—') ? p.orn : D.TELA[p.tela];
    return h('div', {
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
          h('p', { key: 's', className: 'text-overline uppercase text-on-surface-variant mt-1 truncate' }, subtitle),
        ]),
        h('div', { key: 'm', className: 'mt-auto flex justify-between items-center' }, [
          h('span', { key: 'p', className: 'font-headline text-h2 text-primary' }, fmt(p.precio)),
          out ? null : h('button', {
            key: 'add',
            className: 'w-9 h-9 bg-surface-container-low text-primary rounded-xl flex items-center justify-center hover:bg-primary hover:text-on-primary transition-all',
            onClick: e => { e.stopPropagation(); onAdd(); }, title: 'Agregar',
          }, h(MS, { name: 'plus', size: 20 })),
        ]),
      ]),
    ]);
  }

  // Fila de producto (lista)
  function ProductRow({ p, onAdd }) {
    const total = D.totalStock(p);
    const out = total === 0;
    return h('div', {
      className: 'flex items-center gap-4 p-3 hover:bg-surface-container-low transition-colors ' + (out ? 'opacity-50' : 'cursor-pointer'),
      onClick: out ? null : onAdd,
    }, [
      h(ProductImage, { key: 't', p, className: 'w-12 h-14 shrink-0 rounded-lg ring-1 ring-outline-variant/50' }),
      h('div', { key: 'n', className: 'flex-1 min-w-0' }, [
        h('div', { key: 'a', className: 'font-headline text-body text-primary truncate' }, p.nombre),
        h('div', { key: 'b', className: 'text-overline uppercase text-on-surface-variant' }, p.sku),
      ]),
      h('span', { key: 'm', className: 'font-headline text-body text-primary w-24 text-right' }, fmt(p.precio)),
      h('button', {
        key: 'add', className: 'w-9 h-9 bg-surface-container-low text-primary rounded-xl flex items-center justify-center hover:bg-primary hover:text-on-primary transition-all shrink-0',
        onClick: e => { e.stopPropagation(); if (!out) onAdd(); },
      }, h(MS, { name: 'plus', size: 18 })),
    ]);
  }

  // Modal de talla
  function SizeModal({ p, onClose, onPick }) {
    return h(Modal, { title: 'Selecciona talla', onClose }, [
      h('div', { key: 'h', className: 'flex items-center gap-4 mb-5' }, [
        h(ProductImage, { key: 't', p, className: 'w-16 h-20 rounded-lg ring-1 ring-outline-variant/50' }),
        h('div', { key: 'i' }, [
          h('div', { key: 'n', className: 'font-headline text-h2 text-primary' }, p.nombre),
          h('div', { key: 's', className: 'text-overline uppercase text-on-surface-variant' }, p.sku),
          h('div', { key: 'p', className: 'font-headline text-h2 text-primary mt-1' }, fmt(p.precio)),
        ]),
      ]),
      h('div', { key: 'lbl', className: 'text-overline uppercase text-on-surface-variant mb-3' }, 'Tallas disponibles'),
      ...[['L', 'Letras'], ['N', 'Números']].map(([e, label]) => {
        const items = p.stock.filter(v => v.escala === e && v.stock > 0);
        if (!items.length) return null;
        return h('div', { key: e, className: 'mb-4' }, [
          h('div', { key: 'sl', className: 'text-overline uppercase text-muted mb-2' }, label),
          h('div', { key: 'sz', className: 'flex flex-wrap gap-2' },
            items.map(v => h('button', {
              key: v.talla,
              className: 'flex flex-col items-center gap-0.5 min-w-[64px] px-3 py-2.5 border border-outline-variant hover:border-primary hover:bg-surface-container-low transition-colors rounded-lg',
              onClick: () => onPick(p, v.talla),
            }, [
              h('span', { key: 't', className: 'font-semibold text-body text-primary' }, (window.CONFIG.map(e === 'N' ? 'size_number' : 'size_letter')[v.talla] || v.talla)),
              h('span', { key: 's', className: 'text-caption text-muted' }, v.stock + ' pz'),
            ]))),
        ]);
      }),
    ]);
  }

  window.POSScreen = POSScreen;
})();
