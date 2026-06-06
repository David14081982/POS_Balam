// pos-ticket.jsx — Panel de ticket + modal de cobro (Heritage slate). Exporta window.TicketPanel, window.CheckoutModal
(function () {
  const { useState } = React;
  const { fmt, toast, Modal } = window.UI;
  const { MS, ProductImage } = window.HX;
  const D = window.DATA;
  const h = React.createElement;

  function TicketPanel({ ticket, client, subtotal, subtotalOrig, discount, itemCount, grandTotal, onClient, onQty, onRemove, onCobrar, onClear, bottom, flashKey }) {
    const subOrig = subtotalOrig != null ? subtotalOrig : subtotal;
    const desc = discount || 0;
    const totalPagar = grandTotal != null ? grandTotal : subtotal; // con IVA sumado si no está incluido
    const empty = ticket.length === 0;
    return h('aside', {
      className: 'bg-surface-container-lowest rounded-xl shadow-e3 flex flex-col overflow-hidden shrink-0 ' +
        (bottom ? 'w-full max-h-[42vh]' : 'w-[440px]'),
    }, [
      // Resumen de venta + cliente
      h('div', { key: 'top', className: 'p-6 border-b border-outline-variant bg-surface' }, [
        h('div', { key: 'hd', className: 'flex justify-between items-center mb-4' }, [
          h('span', { key: 'l', className: 'text-overline uppercase text-on-surface-variant' }, 'Resumen de venta'),
          h('button', { key: 'a', className: 'text-primary hover:opacity-70 font-semibold text-caption flex items-center gap-1 transition-opacity', onClick: onClient }, [
            h(MS, { key: 'i', name: 'person_add', size: 16 }), 'Cambiar cliente',
          ]),
        ]),
        h('button', {
          key: 'cl', className: 'w-full flex items-center gap-4 p-4 rounded-lg bg-surface-container-low shadow-e1 hover:shadow-e2 transition-all group text-left',
          onClick: onClient,
        }, [
          h('div', { key: 'a', className: 'w-10 h-10 rounded-full bg-primary flex items-center justify-center text-on-primary font-bold text-body shrink-0' },
            client.generic ? h(MS, { name: 'person', size: 20 }) : client.nombre.split(' ').map(w => w[0]).slice(0, 2).join('')),
          h('div', { key: 'i', className: 'flex-1 min-w-0' }, [
            h('p', { key: 'n', className: 'text-body-strong text-primary truncate' }, client.nombre),
            h('p', { key: 's', className: 'text-overline uppercase text-on-surface-variant truncate' },
              client.generic ? 'Venta de mostrador' : client.tel + ' • ' + client.compras + ' compras'),
          ]),
          h(MS, { key: 'c', name: 'chevDown', size: 20, className: 'text-on-surface-variant group-hover:text-primary transition-colors' }),
        ]),
      ]),
      // Líneas
      empty
        ? h('div', { key: 'e', className: 'flex-1 flex flex-col items-center justify-center gap-2 text-on-surface-variant py-12 px-6' }, [
            h(MS, { key: 'i', name: 'receipt', size: 36, className: 'text-on-surface-variant/40' }),
            h('div', { key: 't', className: 'font-headline text-h2 text-primary' }, 'Ticket vacío'),
            h('div', { key: 's', className: 'text-caption text-center' }, 'Escanea o toca un producto para empezar'),
          ])
        : h('div', { key: 'lines', className: 'flex-1 overflow-y-auto no-scrollbar px-6 py-4 space-y-5' },
            ticket.map((l, idx) => [
              idx > 0 && h('div', { key: 'd' + l.key, className: 'h-px bg-outline-variant/60' }),
              h('div', { key: l.key, className: 'flex gap-4 rounded-lg transition-all duration-500 ' + (l.key === flashKey ? 'ring-2 ring-success bg-success-soft/50 -mx-2 px-2 py-1' : '') }, [
                h(ProductImage, { key: 't', p: l.p, className: 'w-16 h-20 shrink-0 rounded-lg ring-1 ring-outline-variant/50' }),
                h('div', { key: 'i', className: 'flex-1 min-w-0 flex flex-col' }, [
                  h('div', { key: 'top', className: 'flex justify-between items-start mb-1' }, [
                    h('h4', { key: 'n', className: 'text-body-strong text-primary truncate pr-3' }, l.p.nombre),
                    h('button', { key: 'x', className: 'text-on-surface-variant hover:text-danger transition-colors shrink-0', onClick: () => onRemove(l.key), title: 'Quitar' }, h(MS, { name: 'trash', size: 18 })),
                  ]),
                  h('p', { key: 'sz', className: 'text-overline uppercase text-on-surface-variant' }, 'Talla ' + l.talla + ' • ' + l.p.colorName),
                  h('div', { key: 'm', className: 'mt-auto pt-2 flex justify-between items-center' }, [
                    h('div', { key: 'q', className: 'flex items-center bg-surface-container-low border border-outline-variant rounded-md overflow-hidden' }, [
                      h('button', { key: 'm', className: 'w-7 h-7 flex items-center justify-center hover:bg-surface transition-colors', onClick: () => onQty(l.key, -1) }, h(MS, { name: 'minus', size: 16 })),
                      h('span', { key: 'n', className: 'w-8 text-center text-caption font-bold border-x border-outline-variant bg-surface py-1' }, l.qty),
                      h('button', { key: 'p', className: 'w-7 h-7 flex items-center justify-center hover:bg-surface transition-colors', onClick: () => onQty(l.key, 1) }, h(MS, { name: 'plus', size: 16 })),
                    ]),
                    (() => {
                      const du = window.PROMOS ? window.PROMOS.lineUnit(l.p, l.talla) : { unit: l.p.precio, off: 0 };
                      if (du.off > 0) return h('div', { key: 'sub', className: 'text-right leading-tight' }, [
                        h('div', { key: 'o', className: 'text-overline text-on-surface-variant line-through' }, fmt(l.p.precio * l.qty)),
                        h('div', { key: 'n', className: 'font-headline text-body text-gold-text' }, fmt(du.unit * l.qty)),
                      ]);
                      return h('span', { key: 'sub', className: 'font-headline text-body text-primary' }, fmt(du.unit * l.qty));
                    })(),
                  ]),
                ]),
              ]),
            ])),
      // Footer (navy)
      h('div', { key: 'foot', className: 'p-7 bg-primary text-on-primary' }, [
        h('div', { key: 'rows', className: 'space-y-2 mb-5' }, [
          h('div', { key: 'st', className: 'flex justify-between items-center text-caption opacity-70' }, [
            h('span', { key: 'l' }, `Subtotal (${itemCount} artículo${itemCount === 1 ? '' : 's'})`), h('span', { key: 'v', className: 'font-medium' }, fmt(subOrig)),
          ]),
          desc > 0 ? h('div', { key: 'ds', className: 'flex justify-between items-center text-caption' }, [
            h('span', { key: 'l', className: 'flex items-center gap-1' }, [h(MS, { key: 'i', name: 'sell', size: 14 }), 'Descuentos']), h('span', { key: 'v', className: 'font-semibold', style: { color: '#FFE088' } }, '− ' + fmt(desc)),
          ]) : null,
          (() => {
            const ivaPct = window.CONFIG.get('tax.ivaPct') || 0;
            const incl = window.CONFIG.get('tax.included');
            if (!ivaPct) return null;
            const iva = incl ? subtotal - subtotal / (1 + ivaPct / 100) : subtotal * (ivaPct / 100);
            return h('div', { key: 'iva', className: 'flex justify-between items-center text-caption opacity-70' }, [
              h('span', { key: 'l' }, `IVA ${incl ? 'incluido' : ''} (${ivaPct}%)`), h('span', { key: 'v', className: 'font-medium' }, fmt(iva)),
            ]);
          })(),
        ]),
        h('div', { key: 'tot', className: 'flex justify-between items-end mb-6' }, [
          h('span', { key: 'l', className: 'text-overline uppercase opacity-60' }, 'Total a pagar'),
          h('span', { key: 'v', className: 'font-headline text-display tracking-tight leading-none' }, fmt(totalPagar)),
        ]),
        h('div', { key: 'btns', className: 'grid grid-cols-3 gap-3' }, [
          h('button', {
            key: 'd', className: 'py-3 bg-on-primary/10 hover:bg-on-primary/20 border border-on-primary/20 rounded-lg text-caption font-bold uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed',
            disabled: empty, onClick: () => { onClear(); toast('Venta diferida'); },
          }, [h(MS, { key: 'i', name: 'save', size: 18 }), 'Diferir']),
          h('button', {
            key: 'c', className: 'col-span-2 py-3 bg-surface text-primary hover:opacity-90 rounded-lg text-caption font-bold uppercase tracking-wider transition-all active:scale-[0.98] flex items-center justify-center gap-2 shadow-e2 disabled:opacity-40 disabled:cursor-not-allowed',
            disabled: empty, onClick: onCobrar,
          }, [h(MS, { key: 'i', name: 'shopping_cart_checkout', size: 18 }), 'Completar venta']),
        ]),
      ]),
    ]);
  }

  // ---- Modal de cobro ----
  // Métodos de pago administrables desde Configuración (payment_method.meta.icon).
  function metodos() {
    return window.CONFIG.list('payment_method').map(m => ({ id: m.code, icon: (m.meta && m.meta.icon) || 'cash' }));
  }

  function CheckoutModal({ total, itemCount, client, onClose, onConfirm }) {
    const METODOS = metodos();
    const [metodo, setMetodo] = useState(() => (metodos()[0] || { id: 'Efectivo' }).id);
    const [recibido, setRecibido] = useState('');
    const [efectivo, setEfectivo] = useState('');
    const [anticipo, setAnticipo] = useState('');
    const recv = parseFloat(recibido) || 0;
    const cambio = Math.max(0, recv - total);
    const efe = parseFloat(efectivo) || 0;
    const restanteMixto = Math.max(0, total - efe);
    const ant = parseFloat(anticipo) || 0;
    const saldo = Math.max(0, total - ant);

    const inputCls = 'block w-full h-12 px-4 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary focus:border-primary text-base rounded-xl font-mono';
    const lbl = 'text-overline uppercase text-on-surface-variant mb-2';

    const footer = [
      h('button', { key: 'c', className: 'px-5 h-11 border border-outline-variant text-on-surface text-caption font-bold uppercase tracking-widest hover:bg-surface-container-low rounded-lg transition-colors', onClick: onClose }, 'Cancelar'),
      h('button', {
        key: 'k',
        className: 'px-6 h-11 flex items-center gap-2 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:bg-primary-container transition disabled:opacity-40 disabled:cursor-not-allowed',
        onClick: () => onConfirm(metodo),
        disabled: (metodo === 'Efectivo' && recv < total) || (metodo === 'Apartado' && client.generic),
      }, [h(MS, { key: 'i', name: 'check', size: 18 }), metodo === 'Apartado' ? 'Registrar apartado' : 'Confirmar cobro']),
    ];

    return h(Modal, { title: 'Cobrar venta', onClose, footer }, [
      h('div', { key: 'tot', className: 'flex justify-between items-center bg-primary text-on-primary p-5 rounded-lg mb-5' }, [
        h('div', { key: 'l' }, [
          h('div', { key: 'a', className: 'text-caption opacity-70' }, `${itemCount} artículos · ${client.nombre}`),
          h('div', { key: 'b', className: 'text-overline uppercase opacity-60 mt-0.5' }, 'Total a cobrar'),
        ]),
        h('div', { key: 'v', className: 'font-headline text-h1 leading-none' }, fmt(total)),
      ]),
      h('div', { key: 'ml', className: lbl }, 'Método de pago'),
      h('div', { key: 'm', className: 'grid gap-2 mb-4', style: { gridTemplateColumns: `repeat(${Math.min(METODOS.length, 5)}, minmax(0, 1fr))` } },
        METODOS.map(m => h('button', {
          key: m.id,
          className: 'flex flex-col items-center gap-1.5 py-3 border rounded-xl transition-colors ' +
            (metodo === m.id ? 'border-primary bg-surface-container-low text-primary' : 'border-outline-variant text-on-surface-variant hover:border-primary'),
          onClick: () => setMetodo(m.id),
        }, [
          h(MS, { key: 'i', name: m.icon, size: 22, fill: metodo === m.id }),
          h('span', { key: 't', className: 'text-[9px] leading-none tracking-tight uppercase w-full text-center truncate', title: m.id }, m.id),
        ]))),
      metodo === 'Efectivo' && h('div', { key: 'efe' }, [
        h('div', { key: 'l', className: lbl }, 'Efectivo recibido'),
        h('input', { key: 'in', className: inputCls, type: 'number', placeholder: '0.00', value: recibido, onChange: e => setRecibido(e.target.value), autoFocus: true }),
        h('div', { key: 'q', className: 'flex gap-2 mt-2' },
          [...new Set([200, 500, 1000, Math.ceil(total / 50) * 50])].map(v => h('button', {
            key: v, className: 'px-3 py-1.5 text-caption font-semibold border border-outline-variant rounded-full hover:border-primary transition-colors', onClick: () => setRecibido(String(v)),
          }, fmt(v).replace('.00', '')))),
        h('div', { key: 'ch', className: 'flex justify-between items-center mt-3 pt-3 border-t border-outline-variant' }, [
          h('span', { key: 'l', className: 'text-body text-on-surface-variant' }, 'Cambio'),
          h('span', { key: 'v', className: 'font-headline text-h2 ' + (cambio > 0 ? 'text-primary' : 'text-on-surface-variant') }, fmt(cambio)),
        ]),
      ]),
      metodo === 'Mixto' && h('div', { key: 'mix' }, [
        h('div', { key: 'l', className: lbl }, 'Pago en efectivo'),
        h('input', { key: 'in', className: inputCls, type: 'number', placeholder: '0.00', value: efectivo, onChange: e => setEfectivo(e.target.value), autoFocus: true }),
        h('div', { key: 'r', className: 'flex justify-between items-center mt-3 pt-3 border-t border-outline-variant' }, [
          h('span', { key: 'l', className: 'text-body text-on-surface-variant' }, 'Resto con tarjeta'),
          h('span', { key: 'v', className: 'font-headline text-h2 text-primary' }, fmt(restanteMixto)),
        ]),
      ]),
      metodo === 'Apartado' && h('div', { key: 'ap' }, [
        h('div', { key: 'l', className: lbl }, 'Anticipo recibido'),
        h('input', { key: 'in', className: inputCls, type: 'number', placeholder: '0.00', value: anticipo, onChange: e => setAnticipo(e.target.value), autoFocus: true }),
        h('div', { key: 's', className: 'flex justify-between items-center mt-3 pt-3 border-t border-outline-variant' }, [
          h('span', { key: 'l', className: 'text-body text-on-surface-variant' }, 'Saldo pendiente'),
          h('span', { key: 'v', className: 'font-headline text-h2 text-primary' }, fmt(saldo)),
        ]),
        client.generic && h('div', { key: 'w', className: 'flex items-start gap-2 mt-3 p-3 bg-danger-soft text-danger text-caption rounded-lg' }, [
          h(MS, { key: 'i', name: 'alert', size: 16 }), 'Un apartado requiere cliente registrado. Asígnalo antes de confirmar.',
        ]),
      ]),
      (metodo === 'Tarjeta' || metodo === 'Transferencia') && h('div', { key: 'simple', className: 'flex items-start gap-2 p-3 bg-surface-container-low text-on-surface-variant text-caption rounded-lg' }, [
        h(MS, { key: 'i', name: METODOS.find(m => m.id === metodo).icon, size: 16 }),
        metodo === 'Tarjeta' ? 'Inserta o acerca la tarjeta en la terminal.' : 'Confirma la transferencia por ' + fmt(total) + ' antes de cerrar.',
      ]),
    ]);
  }

  // ---- Ticket térmico 80mm (comprobante de venta) ----
  // Se renderiza fuera de pantalla (#balam-ticket) y se imprime con window.print().
  function BalamTicket({ sale }) {
    if (!sale) return null;
    const C = window.CONFIG;
    const ivaPct = C.get('tax.ivaPct') || 0;
    const incl = !!C.get('tax.included');
    const totalCobrado = Number(sale.total) || 0;
    const subtotal = incl ? totalCobrado / (1 + ivaPct / 100) : totalCobrado;
    const iva = incl ? totalCobrado - subtotal : subtotal * (ivaPct / 100);
    const granTotal = incl ? totalCobrado : subtotal + iva;
    const colorDe = (sku) => { const p = D.products.find(x => x.sku === sku); return p ? p.colorName : ''; };
    const lineas = sale.lineas || [];

    const row = (l, v, cls) => h('div', { key: l, className: 'flex justify-between items-center ' + (cls || '') }, [
      h('span', { key: 'l' }, l), h('span', { key: 'v' }, v),
    ]);

    // Barras decorativas deterministas a partir del folio
    // Código de barras decorativo (denso) derivado del folio
    const bars = [];
    let bseed = String(sale.folio || '').split('').reduce((a, c) => a + c.charCodeAt(0), 7);
    for (let i = 0; i < 44; i++) { bseed = (bseed * 33 + 7) % 9973; bars.push(h('div', { key: i, style: { width: (bseed % 3 + 1) + 'px', height: '40px', background: '#131B2E' } })); }

    const info = (label, value, vcls) => h('div', { key: label, className: 'flex justify-between items-center gap-3' }, [
      h('span', { key: 'l', className: 'uppercase tracking-wide text-on-surface-variant', style: { fontSize: '11px' } }, label),
      h('span', { key: 'v', className: 'text-primary ' + (vcls || ''), style: { fontSize: '13px' } }, value),
    ]);

    return h('div', { id: 'balam-ticket' },
      h('div', { className: 'px-6 py-7 flex flex-col items-center text-center font-body text-on-surface', style: { width: '80mm', boxSizing: 'border-box' } }, [
        // Encabezado
        h('div', { key: 'h', className: 'w-full mb-8 flex flex-col items-center' }, [
          C.get('store.logo')
            ? h('img', { key: 'm', src: C.get('store.logo'), className: 'w-16 h-16 mb-4 rounded-2xl object-cover' })
            : h('div', { key: 'm', className: 'w-16 h-16 mb-4 rounded-2xl grid place-items-center', style: { background: '#131B2E' } }, h(MS, { name: 'landscape', size: 40, fill: true, style: { color: '#FFFFFF' } })),
          h('h1', { key: 't', className: 'font-headline', style: { fontSize: '32px', letterSpacing: '0.1em', lineHeight: 1 } }, 'BALAM'),
          h('p', { key: 's', className: 'font-semibold text-primary mt-3', style: { fontSize: '14px' } }, C.get('store.name') || 'Balam Guayaberas'),
          C.get('store.rfc') && h('p', { key: 'r', className: 'text-on-surface-variant mt-1', style: { fontSize: '12px', lineHeight: 1.5 } }, 'RFC: ' + C.get('store.rfc')),
          C.get('store.address') && h('p', { key: 'a', className: 'text-on-surface-variant', style: { fontSize: '12px', lineHeight: 1.5 } }, C.get('store.address')),
          C.get('store.phone') && h('p', { key: 'p', className: 'text-on-surface-variant', style: { fontSize: '12px', lineHeight: 1.5 } }, C.get('store.phone')),
        ]),
        // Transacción
        h('div', { key: 'tx', className: 'w-full border-y border-outline-variant py-4 mb-6 flex flex-col gap-1.5 text-left' }, [
          info('Transacción', sale.folio, 'font-medium'),
          info('Fecha', sale.fecha),
          info('Atendido por', sale.vendedor || '—'),
          (sale.estado && sale.estado !== 'Pagado') ? info('Estado', sale.estado) : null,
        ]),
        // Detalle
        h('div', { key: 'd', className: 'w-full text-left' }, [
          h('div', { key: 'h', className: 'uppercase text-on-surface-variant mb-4', style: { fontSize: '11px', letterSpacing: '0.18em' } }, 'Detalle de compra'),
          h('div', { key: 'l', className: 'space-y-5' }, lineas.map((l, i) => h('div', { key: i }, [
            h('div', { key: 'a', className: 'flex justify-between items-start gap-3' }, [
              h('span', { key: 'n', className: 'font-headline flex-1 min-w-0', style: { fontSize: '18px', lineHeight: 1.25 } }, l.nombre),
              h('span', { key: 'p', className: 'font-semibold text-primary shrink-0', style: { fontSize: '14px' } }, fmt(l.precio * l.qty)),
            ]),
            h('div', { key: 'b', className: 'flex justify-between items-start gap-3 mt-1 text-on-surface-variant', style: { fontSize: '10px', lineHeight: 1.4 } }, [
              h('span', { key: 's', className: 'flex-1 min-w-0' }, `SKU: ${l.sku} · Talla: ${l.talla}${colorDe(l.sku) ? ' · ' + colorDe(l.sku) : ''}`),
              h('span', { key: 'q', className: 'shrink-0' }, `Cant: ${l.qty}`),
            ]),
          ]))),
        ]),
        // Totales
        h('div', { key: 'tt', className: 'w-full border-t-2 border-primary pt-4 mt-8' }, [
          h('div', { key: 'r', className: 'space-y-1.5 text-on-surface-variant' }, [
            h('div', { key: 'st', className: 'flex justify-between', style: { fontSize: '13px' } }, [h('span', { key: 'l' }, 'Subtotal'), h('span', { key: 'v' }, fmt(subtotal))]),
            ivaPct ? h('div', { key: 'iva', className: 'flex justify-between', style: { fontSize: '13px' } }, [h('span', { key: 'l' }, `IVA (${ivaPct}%)`), h('span', { key: 'v' }, fmt(iva))]) : null,
          ]),
          h('div', { key: 'g', className: 'flex justify-between items-end border-t border-outline-variant pt-3 mt-3' }, [
            h('span', { key: 'l', className: 'font-headline uppercase text-primary', style: { fontSize: '18px', letterSpacing: '-0.01em' } }, 'Total'),
            h('span', { key: 'v', className: 'font-headline text-primary', style: { fontSize: '26px', lineHeight: 1 } }, fmt(granTotal)),
          ]),
          (Number(sale.descuento) > 0) ? h('div', { key: 'sv', className: 'flex justify-between items-center mt-2', style: { fontSize: '12px', color: '#9a7b16' } }, [
            h('span', { key: 'l' }, 'Ahorro aplicado'), h('span', { key: 'v', className: 'font-semibold' }, '− ' + fmt(sale.descuento)),
          ]) : null,
        ]),
        // Método de pago
        h('div', { key: 'mp', className: 'w-full mt-5 bg-surface-container-low rounded-xl p-4 text-left flex items-center gap-3' }, [
          h(MS, { key: 'i', name: ((C.find('payment_method', sale.metodo) || {}).meta || {}).icon || 'cash', size: 22, className: 'text-gold-text' }),
          h('div', { key: 't' }, [
            h('p', { key: 'a', className: 'uppercase text-on-surface-variant', style: { fontSize: '10px', letterSpacing: '0.08em' } }, 'Método de pago'),
            h('p', { key: 'b', className: 'font-medium text-primary', style: { fontSize: '13px' } }, sale.metodo),
          ]),
        ]),
        // Pie
        h('div', { key: 'f', className: 'w-full mt-12 mb-1 flex flex-col items-center' }, [
          h('div', { key: 'd', className: 'w-12 h-px bg-outline-variant mb-6' }),
          h('p', { key: 'm', className: 'font-headline italic text-primary px-2 mb-1', style: { fontSize: '20px', lineHeight: 1.35 } }, C.get('ticket.footer') || 'Gracias por ser parte de nuestra herencia.'),
          C.get('ticket.tagline') && h('p', { key: 'tl', className: 'text-on-surface-variant px-4 mt-3', style: { fontSize: '12px', lineHeight: 1.6 } }, C.get('ticket.tagline')),
          h('div', { key: 'bc', className: 'mt-9 w-full flex flex-col items-center gap-2' }, [
            h('div', { key: 'b', className: 'flex items-end justify-center gap-[1px] py-2 px-6 w-full', style: { background: 'rgba(19,27,46,0.035)' } }, bars),
            h('span', { key: 'u', className: 'text-on-surface-variant', style: { fontSize: '9px', letterSpacing: '0.3em' } }, 'BALAMGUAYABERAS.COM'),
          ]),
        ]),
      ]));
  }

  window.TicketPanel = TicketPanel;
  window.CheckoutModal = CheckoutModal;
  window.BalamTicket = BalamTicket;
})();
