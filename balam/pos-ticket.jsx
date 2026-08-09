// pos-ticket.jsx — Panel de ticket + modal de cobro (Heritage slate). Exporta window.TicketPanel, window.CheckoutModal
(function () {
  const { useState } = React;
  const { fmt, toast, Modal } = window.UI;
  const { MS, ProductImage } = window.HX;
  const D = window.DATA;
  const h = React.createElement;
  // Nombre visible de una talla según el catálogo (refleja renombres de Configuración).
  const tallaLbl = (t, product) => {
    const D = window.DATA;
    if (product && D && typeof D.resolveProductSizes === 'function') {
      const size = D.resolveProductSizes(product).sizes.find(item => String(item.value) === String(t));
      if (size) return size.label;
    }
    // Compatibilidad de documentos históricos sin identidad de categoría.
    // Compara contra el valor real (meta.value), no sólo contra el ID del ítem.
    const C = window.CONFIG;
    for (const category of (C.sizeCategories ? C.sizeCategories() : [])) {
      const item = C.all(category.id).find(candidate => {
        const meta = candidate.meta && typeof candidate.meta === 'object' ? candidate.meta : {};
        const value = Object.prototype.hasOwnProperty.call(meta, 'value') ? meta.value : candidate.code;
        return String(value) === String(t);
      });
      if (item) return item.label;
    }
    return t;
  };
  const money2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const ornamentEvidence = line => {
    if (!line || (!line.ornamento && !Array.isArray(line.ornColors))) return '';
    const colors = Array.isArray(line.ornColors) ? line.ornColors.join(' + ') : '';
    return [line.ornamento, colors].filter(Boolean).join(' · ');
  };

  // ── H-32: presentación financiera solicitada por Finanzas ────────────────────
  // Importe e IVA describen el PRECIO ORIGINAL (antes del descuento), no el total cobrado.
  // El precio original se deriva como total + descuento para que la resta impresa cuadre
  // exactamente con el total. Ningún importe guardado cambia: esto es sólo presentación.
  function desglose(totalPagar, descuento, ivaPct) {
    const pct = Number(ivaPct) > 0 ? Number(ivaPct) : 16;
    const precioOriginal = money2(money2(totalPagar) + money2(descuento));
    const importe = money2(precioOriginal / (1 + pct / 100));
    return { precioOriginal, importe, iva: money2(precioOriginal - importe), ivaPct: pct };
  }

  // Porcentaje del descuento SÓLO desde evidencia histórica persistida. Nunca se deriva.
  // Se imprime únicamente si TODOS los renglones con descuento traen evidencia, cada uno con
  // exactamente UNA promoción, todas porcentuales y todas con el mismo valor configurado.
  // Cualquier otro caso (monto fijo, promociones distintas, acumulación, venta histórica sin
  // evidencia) devuelve null y la fila se imprime sin porcentaje.
  function pctDeEvidencia(items) {
    if (!Array.isArray(items) || !items.length) return null;
    const conDescuento = items.filter(x => Number(x.orig) > Number(x.base));
    if (!conDescuento.length) return null;
    let pct = null;
    for (const x of conDescuento) {
      if (!Array.isArray(x.promos) || x.promos.length !== 1) return null;
      const pr = x.promos[0];
      if (!pr || pr.tipo !== 'pct') return null;
      const v = Number(pr.valor);
      if (!Number.isFinite(v) || v <= 0) return null;
      if (pct === null) pct = v; else if (pct !== v) return null;
    }
    return pct;
  }
  const etiquetaDescuento = (pct) =>
    'Descuento (SOBRE PRECIO ORIGINAL)' + (pct == null ? '' : ' ' + Number(pct) + '%');

  // Asignar/crear cliente EN LÍNEA (sin modal): autocompletado por nombre o teléfono + alta rápida.
  function ClientPicker({ onPick }) {
    const [nombre, setNombre] = useState('');
    const [tel, setTel] = useState('');
    const qN = nombre.trim(), qT = tel.trim();
    const has = !!(qN || qT);
    const matches = has ? D.clients.filter(c => !c.generic && (
      (qN && c.nombre.toLowerCase().includes(qN.toLowerCase())) || (qT && String(c.tel || '').includes(qT))
    )).slice(0, 8) : [];
    function crear() {
      const c = D.addClient({ nombre: qN, tel: qT });
      if (!c) { toast('Escribe el nombre del cliente', 'var(--danger)'); return; }
      const reuse = qT && String(c.tel || '') === qT && c.nombre !== qN;
      onPick(c);
      toast(reuse ? ('Ya existía con ese teléfono: ' + c.nombre) : ('Cliente «' + c.nombre + '» creado'), 'var(--accent)');
    }
    const inp = 'h-9 px-3 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary text-sm rounded-lg w-full';
    return h('div', { className: 'relative' }, [
      h('div', { key: 'f', className: 'grid grid-cols-2 gap-2' }, [
        h('input', { key: 'n', className: inp, placeholder: 'Nombre del cliente', value: nombre, onChange: e => setNombre(e.target.value) }),
        h('input', { key: 't', className: inp, type: 'tel', placeholder: 'Teléfono (opcional)', value: tel, onChange: e => setTel(e.target.value) }),
      ]),
      has ? h('div', { key: 'dd', className: 'absolute z-30 left-0 right-0 mt-1 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-e3 max-h-64 overflow-y-auto' }, [
        ...matches.map(c => h('button', {
          key: c.id, type: 'button', className: 'w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-container-low text-left transition-colors', onClick: () => onPick(c),
        }, [
          h('div', { key: 'a', className: 'w-8 h-8 rounded-full bg-primary text-on-primary grid place-items-center text-[11px] font-bold shrink-0' }, c.nombre.split(' ').map(w => w[0]).slice(0, 2).join('')),
          h('div', { key: 'i', className: 'flex-1 min-w-0' }, [
            h('div', { key: 'n', className: 'text-body font-semibold text-primary truncate' }, c.nombre),
            h('div', { key: 's', className: 'text-overline uppercase text-on-surface-variant truncate' }, (c.tel && c.tel !== '—' ? c.tel : 'Sin teléfono') + ' · ' + (c.compras || 0) + ' compras'),
          ]),
        ])),
        qN ? h('button', { key: 'crear', type: 'button', className: 'w-full flex items-center gap-2 px-3 py-2.5 border-t border-outline-variant text-primary font-semibold text-caption hover:bg-surface-container-low transition-colors', onClick: crear }, [h(MS, { key: 'i', name: 'person_add', size: 16 }), 'Crear «' + qN + '»' + (qT ? (' · ' + qT) : '')]) : null,
        (!matches.length && !qN) ? h('div', { key: 'hint', className: 'px-3 py-2 text-caption text-on-surface-variant' }, 'Escribe el nombre para crear el cliente') : null,
      ]) : null,
    ]);
  }

  function TicketPanel({ ticket, client, subtotal, subtotalOrig, discount, itemCount, grandTotal, quote, additionalDiscounts, onPickClient, onResetClient, onQty, onRemove, onCobrar, onAdditionalDiscount, onRemoveAdditionalDiscount, onClear, bottom, flashKey }) {
    const desc = discount || 0;
    const totalPagar = grandTotal != null ? grandTotal : subtotal;
    const dg = desglose(totalPagar, desc, 16);
    // La evidencia viaja en la línea (l.res), resuelta una sola vez por el POS.
    const pctEvidencia = desc > 0
      ? pctDeEvidencia(ticket.map(l => {
          // H-36: sin resolución adjunta, el precio de lista lo da la autoridad
          // de la talla, nunca el del artículo.
          const base = l.res || { orig: window.DATA.listPrice(l.p, l.talla), unit: window.DATA.listPrice(l.p, l.talla), promos: null };
          return { orig: base.orig, base: base.unit, promos: base.promos };
        }))
      : null;
    const empty = ticket.length === 0;
    return h('aside', {
      className: 'bg-surface-container-lowest rounded-xl shadow-e3 flex flex-col overflow-hidden shrink-0 w-full min-w-0 ' +
        (bottom ? 'xl:max-h-[42vh]' : 'xl:w-[clamp(340px,30vw,440px)]'),
    }, [
      // Resumen de venta + cliente
      h('div', { key: 'top', className: 'p-4 border-b border-outline-variant bg-surface' }, [
        h('div', { key: 'hd', className: 'flex justify-between items-center mb-3' }, [
          h('span', { key: 'l', className: 'text-overline uppercase text-on-surface-variant' }, 'Resumen de venta'),
          !client.generic && h('button', { key: 'a', className: 'text-primary hover:opacity-70 font-semibold text-caption flex items-center gap-1 transition-opacity', onClick: onResetClient }, [
            h(MS, { key: 'i', name: 'person_add', size: 16 }), 'Cambiar cliente',
          ]),
        ]),
        // Cliente genérico → alta/búsqueda EN LÍNEA. Cliente asignado → tarjeta de resumen.
        client.generic
          ? h(ClientPicker, { key: 'cp', onPick: onPickClient })
          : h('div', {
              key: 'cl', className: 'w-full flex items-center gap-3 p-3 rounded-lg bg-surface-container-low shadow-e1',
            }, [
              h('div', { key: 'a', className: 'w-9 h-9 rounded-full bg-primary flex items-center justify-center text-on-primary font-bold text-body shrink-0' },
                client.nombre.split(' ').map(w => w[0]).slice(0, 2).join('')),
              h('div', { key: 'i', className: 'flex-1 min-w-0' }, [
                h('p', { key: 'n', className: 'text-body-strong text-primary truncate' }, client.nombre),
                h('p', { key: 's', className: 'text-overline uppercase text-on-surface-variant truncate' },
                  (client.tel && client.tel !== '—' ? client.tel : 'Sin teléfono') + ' • ' + (client.compras || 0) + ' compras'),
              ]),
            ]),
      ]),
      // Líneas
      empty
        ? h('div', { key: 'e', className: 'flex-1 flex flex-col items-center justify-center gap-2 text-on-surface-variant py-12 px-6' }, [
            h(MS, { key: 'i', name: 'receipt', size: 36, className: 'text-on-surface-variant/40' }),
            h('div', { key: 't', className: 'font-headline text-h2 text-primary' }, 'Ticket vacío'),
            h('div', { key: 's', className: 'text-caption text-center' }, 'Escanea o toca un producto para empezar'),
          ])
        : h('div', { key: 'lines', className: 'flex-1 overflow-y-auto no-scrollbar px-6 py-3 space-y-2' },
            ticket.map((l, idx) => [
              idx > 0 && h('div', { key: 'd' + l.key, className: 'h-px bg-outline-variant/60' }),
              h('div', { key: l.key, className: 'flex gap-4 rounded-lg transition-all duration-500 ' + (l.key === flashKey ? 'ring-2 ring-success bg-success-soft/50 -mx-2 px-2 py-1' : '') }, [
                h(ProductImage, { key: 't', p: l.p, className: 'w-12 h-16 shrink-0 rounded-lg ring-1 ring-outline-variant/50' }),
                h('div', { key: 'i', className: 'flex-1 min-w-0 flex flex-col' }, [
                  h('div', { key: 'top', className: 'flex justify-between items-start mb-1' }, [
                    h('h4', { key: 'n', className: 'text-body-strong text-primary truncate pr-3' }, l.p.nombre),
                    h('button', { key: 'x', className: 'text-on-surface-variant hover:text-danger transition-colors shrink-0', onClick: () => onRemove(l.key), title: 'Quitar' }, h(MS, { name: 'trash', size: 18 })),
                  ]),
                  h('p', { key: 'sz', className: 'text-overline uppercase text-on-surface-variant' }, 'Talla ' + tallaLbl(l.talla, l.p) + ' • ' + l.p.colorName),
                  D.effectiveOrnamentColors(l.p, l.talla).length
                    ? h('p', { key: 'oc', className: 'text-overline uppercase text-on-surface-variant/80' },
                        (l.p.orn || '') + ' · ' + D.effectiveOrnamentColors(l.p, l.talla).join(' + '))
                    : null,
                  h('div', { key: 'm', className: 'mt-auto pt-1.5 flex justify-between items-center' }, [
                    h('div', { key: 'q', className: 'flex items-center bg-surface-container-low border border-outline-variant rounded-md overflow-hidden' }, [
                      h('button', { key: 'm', className: 'w-7 h-7 flex items-center justify-center hover:bg-surface transition-colors', onClick: () => onQty(l.key, -1) }, h(MS, { name: 'minus', size: 16 })),
                      h('span', { key: 'n', className: 'w-8 text-center text-caption font-bold border-x border-outline-variant bg-surface py-1' }, l.qty),
                      h('button', { key: 'p', className: 'w-7 h-7 flex items-center justify-center hover:bg-surface transition-colors', onClick: () => onQty(l.key, 1) }, h(MS, { name: 'plus', size: 16 })),
                    ]),
                    (() => {
                      // H-32: se reutiliza la resolución de la línea; no se vuelve a consultar el motor.
                      // H-36: el precio de lista es el de la talla, no el del artículo.
                      const lista = window.DATA.listPrice(l.p, l.talla);
                      const r = l.res || { orig: lista, unit: lista };
                      const du = { unit: r.unit, off: Math.max(0, r.orig - r.unit) };
                      if (du.off > 0) return h('div', { key: 'sub', className: 'text-right leading-tight' }, [
                        h('div', { key: 'o', className: 'text-overline text-on-surface-variant line-through' }, fmt(r.orig * l.qty)),
                        h('div', { key: 'n', className: 'font-headline text-body text-gold-text' }, fmt(du.unit * l.qty)),
                      ]);
                      return h('span', { key: 'sub', className: 'font-headline text-body text-primary' }, fmt(du.unit * l.qty));
                    })(),
                  ]),
                ]),
              ]),
            ])),
      // Footer (navy)
      h('div', { key: 'foot', className: 'px-6 py-4 bg-primary text-on-primary' }, [
        h('div', { key: 'rows', className: 'space-y-1.5 mb-2' }, [
          // Orden fijado por Finanzas: precio original → importe → IVA → descuento → total.
          desc > 0 ? h('div', { key: 'po', className: 'flex justify-between items-center text-caption opacity-70' }, [
            h('span', { key: 'l' }, `Precio original (${itemCount} artículo${itemCount === 1 ? '' : 's'})`), h('span', { key: 'v', className: 'font-medium' }, fmt(dg.precioOriginal)),
          ]) : null,
          h('div', { key: 'im', className: 'flex justify-between items-center text-caption opacity-70' }, [
            h('span', { key: 'l' }, 'Importe'), h('span', { key: 'v', className: 'font-medium' }, fmt(dg.importe)),
          ]),
          h('div', { key: 'iva', className: 'flex justify-between items-center text-caption opacity-70' }, [
            h('span', { key: 'l' }, `IVA (${dg.ivaPct}%)`), h('span', { key: 'v', className: 'font-medium' }, fmt(dg.iva)),
          ]),
          desc > 0 ? h('div', { key: 'ds', className: 'flex justify-between items-center gap-3 text-caption' }, [
            h('span', { key: 'l', className: 'min-w-0' }, etiquetaDescuento(pctEvidencia)), h('span', { key: 'v', className: 'font-semibold shrink-0', style: { color: '#FFE088' } }, '− ' + fmt(desc)),
          ]) : null,
          (quote && quote.additionalDiscountTotal > 0) ? h('div', { key: 'ad', className: 'space-y-1' },
            (quote.applications || []).map(a => h('div', { key: a.id, className: 'flex justify-between items-center gap-2 text-caption' }, [
              h('button', { key: 'x', className: 'text-left min-w-0 truncate', title: 'Quitar descuento', onClick: () => onRemoveAdditionalDiscount(a.id) }, `Descuento adicional — ${a.origin || a.benefitName}`),
              h('span', { key: 'v', className: 'font-semibold shrink-0', style: { color: '#FFE088' } }, '− ' + fmt(a.discountAmount)),
            ]))) : null,
        ]),
        h('div', { key: 'tot', className: 'flex justify-between items-end mb-3' }, [
          h('span', { key: 'l', className: 'text-overline uppercase opacity-60' }, 'Total a pagar'),
          h('span', { key: 'v', className: 'font-headline text-h1 tracking-tight leading-none' }, fmt(totalPagar)),
        ]),
        h('button', {
          key: 'ad', 'data-testid': 'additional-discount-open', disabled: empty,
          className: 'w-full mb-3 py-2.5 bg-on-primary/10 hover:bg-on-primary/20 border border-on-primary/20 rounded-lg text-caption font-bold uppercase tracking-wider disabled:opacity-40',
          onClick: onAdditionalDiscount,
        }, 'Aplicar descuento adicional'),
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

  function AdditionalDiscountModal({ ticket, existing, onClose, onConfirm }) {
    const benefits = window.CONFIG.list('additional_benefit');
    const [code, setCode] = useState(() => (benefits[0] || {}).code || '');
    const [value, setValue] = useState('');
    const [targetKey, setTargetKey] = useState(() => (ticket[0] || {}).key || '');
    const [reason, setReason] = useState('');
    const [cardType, setCardType] = useState('');
    const [cardFolio, setCardFolio] = useState('');
    const [busy, setBusy] = useState(false);
    const [applicationId] = useState(() => 'ad-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
    const benefit = benefits.find(x => x.code === code) || benefits[0];
    const meta = (benefit && benefit.meta) || {};
    const custom = meta.allowsCustomValue === true || meta.allowsCustomValue === 'true';
    const needsItem = meta.scope === 'item' || meta.benefitType === 'courtesy_piece';
    const needsReason = meta.requiresReason === true || meta.requiresReason === 'true' || meta.origin === 'Otro';
    const needsCard = meta.origin === 'Tarjeta física';
    const hasCustomValue = !custom || String(value).trim() !== '';
    const appliedValue = custom ? Number(value) : Number(meta.value);
    let preview = null, error = '';
    const draft = benefit ? {
      id: applicationId, benefitCode: benefit.code, benefitName: benefit.label,
      origin: meta.origin, benefitType: meta.benefitType, value: appliedValue,
      maxPercent: Number(meta.maxPercent) || 0, maxAmount: Number(meta.maxAmount) || 0,
      scope: needsItem ? 'item' : 'ticket', targetKey: needsItem ? targetKey : undefined,
      combinable: meta.combinable === true || meta.combinable === 'true', reason: reason.trim(),
      cardType: cardType.trim(), cardFolio: cardFolio.trim(),
      onlineVerified: !needsCard || (!!navigator.onLine && !!(window.AUTH && window.AUTH.hasSession())),
      appliedBy: ((window.AUTH && window.AUTH.current && window.AUTH.current()) || {}).email || '',
      appliedAt: new Date().toISOString(),
    } : null;
    try { if (draft && hasCustomValue) preview = window.DATA.saleQuote(ticket, (existing || []).concat(draft)); }
    catch (e) { error = e.message || 'El descuento no es válido'; }
    async function confirm() {
      if (!draft || !hasCustomValue || error || (needsReason && !reason.trim()) || (needsCard && (!cardType.trim() || !cardFolio.trim()))) return;
      setBusy(true);
      try {
        if (needsCard && (!navigator.onLine || !window.AUTH.hasSession())) throw new Error('Conéctate para validar la tarjeta física');
        if (needsCard) {
          const available = await window.STORE.claimPhysicalCard(cardFolio, applicationId);
          draft.claimToken = applicationId;
          if (!available) throw new Error('El folio de tarjeta física ya fue utilizado');
        }
        onConfirm(draft);
      } catch (e) { toast(e.message, 'var(--danger)'); setBusy(false); }
    }
    const cls = 'block w-full h-11 px-3 bg-surface-container-low border border-outline-variant rounded-lg';
    const footer = [
      h('button', { key: 'c', className: 'px-5 h-11 border border-outline-variant rounded-lg', onClick: onClose }, 'Cancelar'),
      h('button', {
        key: 'a', 'data-testid': 'additional-discount-confirm', disabled: busy || !!error || !draft || !hasCustomValue || (needsReason && !reason.trim()) || (needsCard && (!cardType.trim() || !cardFolio.trim())),
        className: 'px-6 h-11 bg-primary text-on-primary rounded-lg font-bold disabled:opacity-40', onClick: confirm,
      }, busy ? 'Validando…' : 'Aplicar descuento'),
    ];
    return h(Modal, { title: 'Descuento adicional', onClose, footer }, [
      h('label', { key: 'bl', className: 'text-overline uppercase text-on-surface-variant' }, 'Beneficio'),
      h('select', { key: 'b', className: cls + ' mb-4', value: code, onChange: e => { setCode(e.target.value); setValue(''); } },
        benefits.map(x => h('option', { key: x.code, value: x.code }, x.label))),
      custom && h('div', { key: 'custom', className: 'mb-4' }, [
        h('label', { key: 'l', className: 'block text-overline uppercase text-on-surface-variant mb-1' },
          meta.benefitType === 'percentage' ? 'Porcentaje de descuento' : 'Importe del descuento'),
        h('input', {
          key: 'v', 'data-testid': 'additional-discount-custom-value', className: cls,
          type: 'number', min: 0.01, step: 0.01,
          max: meta.benefitType === 'percentage' ? (Number(meta.maxPercent) || 100) : (Number(meta.maxAmount) || undefined),
          value, onChange: e => setValue(e.target.value),
          placeholder: meta.benefitType === 'percentage' ? 'Ej. 15' : 'Ej. 250.00',
        }),
      ]),
      needsItem && h('select', { key: 't', className: cls + ' mb-4', value: targetKey, onChange: e => setTargetKey(e.target.value) },
        ticket.map(l => h('option', { key: l.key, value: l.key }, `${l.p.nombre} · ${l.talla}`))),
      needsCard && h('div', { key: 'card', className: 'grid grid-cols-2 gap-3 mb-4' }, [
        h('input', { key: 'type', className: cls, value: cardType, onChange: e => setCardType(e.target.value), placeholder: 'Tipo de tarjeta' }),
        h('input', { key: 'folio', 'data-testid': 'additional-discount-card-folio', className: cls, value: cardFolio, onChange: e => setCardFolio(e.target.value), placeholder: 'Folio físico' }),
      ]),
      h('textarea', { key: 'r', className: 'block w-full min-h-20 p-3 bg-surface-container-low border border-outline-variant rounded-lg mb-4', value: reason, onChange: e => setReason(e.target.value), placeholder: needsReason ? 'Motivo obligatorio' : 'Motivo o comentario' }),
      preview && h('div', { key: 'p', className: 'p-4 bg-surface-container-low rounded-lg space-y-2 text-caption' }, [
        h('div', { key: 'a', className: 'flex justify-between' }, [h('span', {}, 'Antes del descuento adicional'), h('b', {}, fmt(preview.beforeAdditionalTotal))]),
        h('div', { key: 'd', className: 'flex justify-between text-gold-text' }, [h('span', {}, 'Descuento adicional'), h('b', {}, '− ' + fmt(preview.additionalDiscountTotal))]),
        h('div', { key: 'f', className: 'flex justify-between text-body-strong' }, [h('span', {}, 'Total resultante'), h('b', {}, fmt(preview.finalTotal))]),
      ]),
      error && h('div', { key: 'e', className: 'mt-3 p-3 bg-danger-soft text-danger text-caption rounded-lg' }, error),
    ]);
  }

  function CheckoutModal({ total, itemCount, client, quote, onClose, onConfirm }) {
    const METODOS = metodos();
    const [metodo, setMetodo] = useState(() => (metodos()[0] || { id: 'Efectivo' }).id);
    const [recibido, setRecibido] = useState('');
    const [efectivo, setEfectivo] = useState('');
    const [anticipo, setAnticipo] = useState('');
    const [otroMetodo, setOtroMetodo] = useState('Tarjeta');
    const [anticipoMetodo, setAnticipoMetodo] = useState('Efectivo');
    const recv = Number(recibido);
    const cambio = Math.max(0, recv - total);
    const efe = Number(efectivo);
    const restanteMixto = Math.max(0, total - efe);
    const ant = Number(anticipo);
    const saldo = Math.max(0, total - ant);
    const esCortesia = metodo === 'Cortesía';        // regalo/giveaway: total $0, exige cliente registrado

    const inputCls = 'block w-full h-12 px-4 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary focus:border-primary text-base rounded-xl font-mono';
    const lbl = 'text-overline uppercase text-on-surface-variant mb-2';

    const metodoValido = METODOS.some(m => m.id === metodo);
    const efectivoValido = metodo !== 'Efectivo' || (recibido.trim() !== '' && Number.isFinite(recv) && recv >= total);
    const mixtoValido = metodo !== 'Mixto' || (efectivo.trim() !== '' && Number.isFinite(efe) && efe >= 0 && efe <= total);
    const apartadoValido = metodo !== 'Apartado' || (anticipo.trim() !== '' && Number.isFinite(ant) && ant >= 0 && ant <= total && !client.generic);
    const cortesiaValida = !esCortesia || !client.generic;
    function confirmar() {
      if (!metodoValido || !efectivoValido || !mixtoValido || !apartadoValido || !cortesiaValida) {
        toast('Revisa los importes: el pago debe ser numérico, completo y no exceder el total.', 'var(--danger)');
        return;
      }
      onConfirm({
        metodo,
        anticipo: metodo === 'Apartado' ? ant : total,
        pagoEfectivo: metodo === 'Mixto' ? efe : (metodo === 'Efectivo' ? total : 0),
        pagoOtro: metodo === 'Apartado' ? 0 : (metodo === 'Mixto' ? Math.round((total - efe) * 100) / 100 : (metodo === 'Efectivo' ? 0 : total)),
        metodoPago: metodo === 'Apartado' ? anticipoMetodo : metodo,
        pagoDetalle: metodo === 'Mixto'
          ? { efectivo: efe, [otroMetodo.toLowerCase()]: Math.round((total - efe) * 100) / 100 }
          : metodo === 'Apartado'
            ? { [anticipoMetodo.toLowerCase()]: ant }
            : { [metodo.toLowerCase()]: total },
      });
    }
    const footer = [
      h('button', { key: 'c', className: 'px-5 h-11 border border-outline-variant text-on-surface text-caption font-bold uppercase tracking-widest hover:bg-surface-container-low rounded-lg transition-colors', onClick: onClose }, 'Cancelar'),
      h('button', {
        key: 'k',
        // Contrato estable de interaccion para los E2E: el copy y el icono del
        // boton cambian, su papel no. Las pruebas no deben depender del texto.
        'data-testid': 'checkout-confirmar',
        className: 'px-6 h-11 flex items-center gap-2 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:bg-primary-container transition disabled:opacity-40 disabled:cursor-not-allowed',
        onClick: confirmar,
        disabled: !metodoValido || !efectivoValido || !mixtoValido || !apartadoValido || !cortesiaValida,
      }, [h(MS, { key: 'i', name: 'check', size: 18 }), metodo === 'Apartado' ? 'Registrar apartado' : esCortesia ? 'Registrar cortesía' : 'Confirmar cobro']),
    ];

    return h(Modal, { title: 'Cobrar venta', onClose, footer }, [
      h('div', { key: 'tot', className: 'flex justify-between items-center bg-primary text-on-primary p-5 rounded-lg mb-5' }, [
        h('div', { key: 'l' }, [
          h('div', { key: 'a', className: 'text-caption opacity-70' }, `${itemCount} artículos · ${client.nombre}`),
          h('div', { key: 'b', className: 'text-overline uppercase opacity-60 mt-0.5' }, esCortesia ? 'Cortesía · sin costo' : 'Total a cobrar'),
        ]),
        h('div', { key: 'v', className: 'font-headline text-h1 leading-none' }, fmt(esCortesia ? 0 : total)),
      ]),
      quote && quote.additionalDiscountTotal > 0 && h('div', { key: 'discounts', className: 'mb-5 p-3 rounded-lg bg-gold-soft text-gold-text text-caption' },
        (quote.applications || []).map(a => h('div', { key: a.id, className: 'flex justify-between gap-3' }, [
          h('span', { key: 'l' }, `${a.benefitName || 'Descuento adicional'} · ${a.origin || ''}`),
          h('span', { key: 'v', className: 'font-bold' }, '− ' + fmt(a.discountAmount)),
        ]))),
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
        h('input', { key: 'in', 'data-testid': 'checkout-recibido', className: inputCls, type: 'number', placeholder: '0.00', value: recibido, onChange: e => setRecibido(e.target.value), autoFocus: true }),
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
          h('select', { key: 'm', className: inputCls + ' max-w-[190px]', value: otroMetodo, onChange: e => setOtroMetodo(e.target.value) }, [
            h('option', { key: 't', value: 'Tarjeta' }, 'Resto con tarjeta'),
            h('option', { key: 'x', value: 'Transferencia' }, 'Resto por transferencia'),
          ]),
          h('span', { key: 'v', className: 'font-headline text-h2 text-primary' }, fmt(restanteMixto)),
        ]),
      ]),
      metodo === 'Apartado' && h('div', { key: 'ap' }, [
        h('div', { key: 'l', className: lbl }, 'Anticipo recibido'),
        h('input', { key: 'in', className: inputCls, type: 'number', placeholder: '0.00', value: anticipo, onChange: e => setAnticipo(e.target.value), autoFocus: true }),
        h('div', { key: 'pm', className: 'mt-3' }, [
          h('div', { key: 'l', className: lbl }, 'Forma del anticipo'),
          h('select', { key: 's', className: inputCls, value: anticipoMetodo, onChange: e => setAnticipoMetodo(e.target.value) }, [
            h('option', { key: 'e', value: 'Efectivo' }, 'Efectivo'),
            h('option', { key: 't', value: 'Tarjeta' }, 'Tarjeta'),
            h('option', { key: 'x', value: 'Transferencia' }, 'Transferencia'),
          ]),
        ]),
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
      esCortesia && h('div', { key: 'cor' }, [
        h('div', { key: 'n', className: 'flex items-start gap-2 p-3 bg-surface-container-low text-on-surface-variant text-caption rounded-lg' }, [
          h(MS, { key: 'i', name: 'tag', size: 16 }),
          'Cortesía (sorteo/regalo): se entrega SIN costo. Valor regalado ' + fmt(total) + '. No genera comisión y sí se descuenta del inventario.',
        ]),
        client.generic && h('div', { key: 'w', className: 'flex items-start gap-2 mt-3 p-3 bg-danger-soft text-danger text-caption rounded-lg' }, [
          h(MS, { key: 'i', name: 'alert', size: 16 }), 'Una cortesía requiere cliente registrado (para saber a quién se entregó). Asígnalo antes de confirmar.',
        ]),
      ]),
    ]);
  }

  // ---- Ticket térmico 80mm (comprobante de venta) ----
  // Se renderiza fuera de pantalla (#balam-ticket) y se imprime con window.print().
  //
  // AUTORIDAD ÚNICA del comprobante impreso. La cobranza de apartados (H-40) no
  // define un segundo formato: entra por la costura `payment`, que añade el acuse
  // del pago recibido y conserva intacto el resto del documento. Sin `payment` el
  // ticket es exactamente el de siempre.
  function BalamTicket({ sale, payment, exchange }) {
    if (!sale) return null;
    const C = window.CONFIG;
    const hasSnapshot = sale.subtotal != null || sale.iva != null;
    const ivaPct = sale.ivaPct != null ? Number(sale.ivaPct) : 16;
    const incl = sale.ivaIncluded != null ? !!sale.ivaIncluded : true;
    // H-32: el resumen del carrito y el ticket usan EXACTAMENTE el mismo desglose, calculado
    // sobre el PRECIO ORIGINAL. Se lee sólo lo persistido: nunca se consulta el motor ni las
    // promociones vigentes para reconstruir una venta antigua.
    const granTotal = Number(sale.total) || 0;
    const desc = Number(sale.descuento) || 0;
    const descAdicional = Number(sale.descuentoAdicional) || 0;
    const appsAdicionales = Array.isArray(sale.descuentosAdicionales) ? sale.descuentosAdicionales : [];
    // Cortesía: se conserva intacto el comportamiento previo (el desglose describe el valor
    // regalado y el total cobrado es cero). Queda expresamente fuera del alcance de H-32.
    const cortesia = Number(sale.valorRegalado) > 0;
    const dg = desglose(granTotal, desc + descAdicional, ivaPct);
    const subtotal = cortesia ? (hasSnapshot ? Number(sale.subtotal) || 0 : granTotal / 1.16) : dg.importe;
    const iva = cortesia ? (hasSnapshot ? Number(sale.iva) || 0 : granTotal - subtotal) : dg.iva;
    const pctEvidencia = desc > 0
      ? pctDeEvidencia((sale.lineas || []).map(l => ({ orig: Number(l.precioOrig), base: Number(l.precioBase), promos: l.promos })))
      : null;
    const lineas = sale.lineas || [];
    const receiptSnapshot = sale.receiptSnapshot && sale.receiptSnapshot.version === 1
      ? sale.receiptSnapshot : null;
    const frozenStore = receiptSnapshot && receiptSnapshot.store ? receiptSnapshot.store : {};
    const displayLines = lineas.map((line, index) => {
      const frozen = receiptSnapshot && Array.isArray(receiptSnapshot.lines)
        ? receiptSnapshot.lines[index] : null;
      if (!frozen) return {
        name: line.nombre || '', sku: line.sku || '', sizeLabel: line.talla || '',
        colorLabel: '', ornamentLabel: line.ornamento || '',
        ornamentColors: (line.ornColors || []).map(code => ({ code, label: code })),
      };
      return frozen;
    });
    const frozenOrnament = (line, display) => {
      const colors = (display.ornamentColors || []).map(item => item.label || item.code).filter(Boolean).join(' + ');
      return [display.ornamentLabel || line.ornamento, colors].filter(Boolean).join(' Â· ');
    };
    const pagos = D.paymentsForSale ? D.paymentsForSale(sale.folio) : [];
    const snapshotCompleto = D.hasFinancialSnapshot ? D.hasFinancialSnapshot(sale) : hasSnapshot;
    // Estado de cobranza: lo pagado y lo que falta. Se lee de la venta —nunca se
    // recalcula— y sólo se deriva cuando `saldo` no existe (ventas anteriores).
    const saldoPend = sale.saldo != null
      ? Math.max(0, Number(sale.saldo) || 0)
      : Math.max(0, granTotal - (Number(sale.anticipo) || 0));
    const pagadoAcum = Math.max(0, granTotal - saldoPend);
    const esApartado = sale.estado === 'Apartado';
    // H-73: la costura `payment` la usan DOS operaciones distintas. Nació para la
    // cobranza de apartados (H-40) y el Cambio la reutilizó para acusar dinero
    // (C6), así que el vocabulario se decide por el TIPO del pago —dato que ya
    // viajaba en el documento— y no por la mera presencia de la costura. Un
    // cambio no es una cobranza: no dice «Apartado», ni «Mercancía entregada»,
    // ni «Saldo pendiente», y no oculta el método de pago de la venta.
    const CONCEPTO = {
      anticipo: 'Anticipo de apartado', abono: 'Abono a apartado',
      liquidacion: 'Liquidación de apartado', cambio: 'Diferencia de cambio cobrada',
    };
    const COBRANZA_APARTADO = ['anticipo', 'abono', 'liquidacion'];
    const esCobranzaApartado = !!payment && COBRANZA_APARTADO.indexOf(payment.tipo) >= 0;
    // Un abono liquidado deja la venta en 'Pagado': el acuse sigue siendo de apartado.
    const conCobranza = esApartado || esCobranzaApartado;
    const concepto = payment ? (CONCEPTO[payment.tipo] || 'Pago recibido') : '';

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

    // H-41: el comprobante se monta como hijo directo de <body>. Dentro del árbol de
    // la pantalla quedaba atrapado en contenedores con `overflow-y: auto` y altura de
    // ventana, así que al imprimir el navegador no podía repartirlo en varias hojas.
    // La clase `tk-block` marca lo que nunca debe partirse entre una hoja y la otra.
    const documento = h('div', { id: 'balam-ticket' },
      h('div', { className: 'px-6 py-7 flex flex-col items-center text-center font-body text-on-surface', style: { width: '80mm', boxSizing: 'border-box' } }, [
        // Encabezado
        h('div', { key: 'h', className: 'tk-block w-full mb-8 flex flex-col items-center' }, [
          C.get('store.logo')
            ? h('img', { key: 'm', src: C.get('store.logo'), className: 'w-16 h-16 mb-4 rounded-2xl object-cover' })
            : h('div', { key: 'm', className: 'w-16 h-16 mb-4 rounded-2xl grid place-items-center', style: { background: '#131B2E' } }, h(MS, { name: 'landscape', size: 40, fill: true, style: { color: '#FFFFFF' } })),
          h('h1', { key: 't', className: 'font-headline', style: { fontSize: '32px', letterSpacing: '0.1em', lineHeight: 1 } }, 'BALAM'),
          h('p', { key: 's', className: 'font-semibold text-primary mt-3', style: { fontSize: '14px' } }, frozenStore.name || C.get('store.name') || 'Balam Guayaberas'),
          (frozenStore.rfc || (!receiptSnapshot && C.get('store.rfc'))) && h('p', { key: 'r', className: 'text-on-surface-variant mt-1', style: { fontSize: '12px', lineHeight: 1.5 } }, 'RFC: ' + (frozenStore.rfc || C.get('store.rfc'))),
          (frozenStore.address || (!receiptSnapshot && C.get('store.address'))) && h('p', { key: 'a', className: 'text-on-surface-variant', style: { fontSize: '12px', lineHeight: 1.5 } }, frozenStore.address || C.get('store.address')),
          (frozenStore.phone || (!receiptSnapshot && C.get('store.phone'))) && h('p', { key: 'p', className: 'text-on-surface-variant', style: { fontSize: '12px', lineHeight: 1.5 } }, frozenStore.phone || C.get('store.phone')),
        ]),
        // Acuse del pago recibido (sólo cobranza de apartado): lo primero que el
        // cliente debe leer es cuánto entregó hoy y por qué concepto.
        payment ? h('div', { key: 'rc', className: 'tk-block w-full mb-6' }, [
          h('div', { key: 'a', className: 'uppercase text-on-surface-variant', style: { fontSize: '11px', letterSpacing: '0.18em' } }, concepto),
          h('div', { key: 'b', className: 'font-headline text-primary mt-1', style: { fontSize: '30px', lineHeight: 1.1 } }, fmt(Number(payment.monto) || 0)),
          h('div', { key: 'c', className: 'text-on-surface-variant mt-1', style: { fontSize: '12px' } }, `Recibido en ${payment.metodo} · ${payment.fecha}`),
        ]) : null,
        // C6: acuse del CAMBIO. Segunda costura, hermana de : aquélla
        // acusa dinero recibido y ésta acusa mercancía intercambiada, que es un
        // hecho distinto y no cabía en la primera. El resto del documento —tienda,
        // transacción, renglones vendidos, desglose fiscal— queda intacto, así que
        // sigue habiendo UN solo formato impreso (ADR: BalamTicket es la autoridad).
        exchange ? h('div', { key: 'cx', className: 'tk-block w-full mb-6' }, [
          h('div', { key: 'a', className: 'uppercase text-on-surface-variant', style: { fontSize: '11px', letterSpacing: '0.18em' } }, 'Cambio de mercancia'),
          h('div', { key: 'b', className: 'font-headline text-primary mt-1', style: { fontSize: '20px', lineHeight: 1.2 } }, exchange.folio),
          h('div', { key: 'c', className: 'text-on-surface-variant mt-1', style: { fontSize: '12px' } }, 'Sobre la venta ' + (exchange.origenFolio || sale.folio)),
          h('div', { key: 'd', className: 'mt-3 text-left', style: { fontSize: '12px', lineHeight: 1.6 } }, [
            h('div', { key: 'h1', className: 'uppercase text-on-surface-variant', style: { letterSpacing: '0.12em' } }, 'Entrega'),
            ...(exchange.lineas || []).filter(l => l.lado === 'devuelto').map((l, i) =>
              h('div', { key: 'e' + i }, l.qty + ' × ' + l.nombre + ' · talla ' + l.talla + (ornamentEvidence(l) ? ' · ' + ornamentEvidence(l) : '') + ' · ' + fmt(l.precio))),
            h('div', { key: 'h2', className: 'uppercase text-on-surface-variant mt-2', style: { letterSpacing: '0.12em' } }, 'Recibe'),
            ...(exchange.lineas || []).filter(l => l.lado === 'entregado').map((l, i) =>
              h('div', { key: 'r' + i }, l.qty + ' × ' + l.nombre + ' · talla ' + l.talla + (ornamentEvidence(l) ? ' · ' + ornamentEvidence(l) : '') + ' · ' + fmt(l.precio))),
            Number(exchange.diferencia) > 0
              ? h('div', { key: 'df', className: 'font-semibold text-primary mt-2' }, 'Diferencia pagada · ' + fmt(exchange.diferencia))
              : null,
            Number(exchange.valorNoAprovechado) > 0
              ? h('div', { key: 'na', className: 'text-on-surface-variant mt-2' }, 'Saldo no aprovechado · ' + fmt(exchange.valorNoAprovechado) + ' (no reembolsable)')
              : null,
          ]),
        ]) : null,
        // Transacción
        h('div', { key: 'tx', className: 'tk-block w-full border-y border-outline-variant py-4 mb-6 flex flex-col gap-1.5 text-left' }, [
          // H-73: el rótulo lo decide la operación real, no la costura.
          info(conCobranza ? 'Apartado' : 'Transacción', sale.folio, 'font-medium'),
          // Reimpresión de una venta reidentificada: el folio del ticket que
          // conserva el cliente se imprime junto al vigente y nunca se pierde.
          (D.saleFolioAliases && D.saleFolioAliases(sale).length)
            ? info('Ticket impreso', D.saleFolioAliases(sale).join(', '))
            : null,
          info('Fecha', sale.fecha),
          info('Atendido por', (receiptSnapshot && receiptSnapshot.sellerName) || sale.vendedor || '—'),
          payment ? info('Cliente', sale.cliente || 'Público en general') : null,
          (sale.estado && sale.estado !== 'Pagado') ? info('Estado', sale.estado) : null,
        ]),
        // Detalle
        h('div', { key: 'd', className: 'w-full text-left' }, [
          h('div', { key: 'h', className: 'uppercase text-on-surface-variant mb-4', style: { fontSize: '11px', letterSpacing: '0.18em' } },
            conCobranza ? (saldoPend > 0 ? 'Mercancía apartada' : 'Mercancía entregada') : 'Detalle de compra'),
          h('div', { key: 'l', className: 'space-y-5' }, lineas.map((l, i) => { const shown = displayLines[i]; return h('div', { key: i, className: 'tk-block' }, [
            h('div', { key: 'a', className: 'flex justify-between items-start gap-3' }, [
              h('span', { key: 'n', className: 'font-headline flex-1 min-w-0', style: { fontSize: '18px', lineHeight: 1.25 } }, shown.name || l.nombre),
              h('span', { key: 'p', className: 'font-semibold text-primary shrink-0', style: { fontSize: '14px' } }, fmt((l.precioOrig != null ? l.precioOrig : l.precio) * l.qty)),
            ]),
            h('div', { key: 'b', className: 'flex justify-between items-start gap-3 mt-1 text-on-surface-variant', style: { fontSize: '10px', lineHeight: 1.4 } }, [
              h('span', { key: 's', className: 'flex-1 min-w-0' }, `SKU: ${shown.sku || l.sku} · Talla: ${shown.sizeLabel || l.talla}${shown.colorLabel ? ' · ' + shown.colorLabel : ''}`),
              h('span', { key: 'q', className: 'shrink-0' }, `Cant: ${l.qty}`),
            ]),
            frozenOrnament(l, shown) ? h('div', {
              key: 'oc', className: 'mt-1 text-on-surface-variant', style: { fontSize: '10px', lineHeight: 1.4 },
              'data-testid': 'ticket-ornament-evidence',
            }, 'Ornamento: ' + frozenOrnament(l, shown)) : null,
          ]); })),
        ]),
        // Totales
        h('div', { key: 'tt', className: 'tk-block w-full border-t-2 border-primary pt-4 mt-8' }, [
          h('div', { key: 'r', className: 'space-y-1.5 text-on-surface-variant' }, [
            // Orden fijado por Finanzas: precio original → importe → IVA → descuento → total.
            desc > 0 ? h('div', { key: 'po', className: 'flex justify-between', style: { fontSize: '13px' } }, [h('span', { key: 'l' }, 'Precio original'), h('span', { key: 'v' }, fmt(dg.precioOriginal))]) : null,
            h('div', { key: 'st', className: 'flex justify-between', style: { fontSize: '13px' } }, [h('span', { key: 'l' }, 'Importe'), h('span', { key: 'v' }, fmt(subtotal))]),
            h('div', { key: 'iva', className: 'flex justify-between', style: { fontSize: '13px' } }, [h('span', { key: 'l' }, `IVA (${dg.ivaPct}%)`), h('span', { key: 'v' }, fmt(iva))]),
            desc > 0 ? h('div', { key: 'ds', className: 'flex justify-between gap-2', style: { fontSize: '13px', color: '#9a7b16' } }, [h('span', { key: 'l', className: 'min-w-0' }, etiquetaDescuento(pctEvidencia)), h('span', { key: 'v', className: 'font-semibold shrink-0' }, '− ' + fmt(desc))]) : null,
            ...appsAdicionales.map((a, i) => {
              const folio = String(a.cardFolio || '');
              const masked = folio ? ('••••' + folio.slice(-4)) : '';
              const reason = String(a.reason || '').trim().slice(0, 60);
              return h('div', { key: 'ad' + i, className: 'text-left pt-1', style: { fontSize: '12px', color: '#9a7b16' } }, [
                h('div', { key: 'r', className: 'flex justify-between gap-2' }, [
                  h('span', { key: 'l' }, `Descuento adicional — ${a.origin || a.benefitName || 'Beneficio'}`),
                  h('span', { key: 'v', className: 'font-semibold shrink-0' }, '− ' + fmt(a.discountAmount)),
                ]),
                h('div', { key: 'e', className: 'text-on-surface-variant' },
                  [a.benefitName, reason, masked].filter(Boolean).join(' · ')),
              ]);
            }),
          ]),
          h('div', { key: 'g', className: 'flex justify-between items-end border-t border-outline-variant pt-3 mt-3' }, [
            h('span', { key: 'l', className: 'font-headline uppercase text-primary', style: { fontSize: '18px', letterSpacing: '-0.01em' } }, 'Total a pagar'),
            h('span', { key: 'v', className: 'font-headline text-primary', style: { fontSize: '26px', lineHeight: 1 } }, fmt(granTotal)),
          ]),
          // Estado de cobranza del apartado: cuánto lleva pagado y cuánto falta.
          conCobranza ? h('div', { key: 'ap', className: 'mt-3 pt-3 border-t border-outline-variant space-y-1.5', style: { fontSize: '13px' } }, [
            row('Pagado a la fecha', fmt(pagadoAcum)),
            saldoPend > 0
              ? h('div', { key: 'sp', className: 'flex justify-between items-center font-semibold text-primary', style: { fontSize: '15px' } }, [
                h('span', { key: 'l' }, 'Saldo pendiente'), h('span', { key: 'v' }, fmt(saldoPend)),
              ])
              : h('div', { key: 'sp', className: 'flex justify-between items-center font-semibold text-primary', style: { fontSize: '15px' } }, [
                h('span', { key: 'l' }, 'Saldo pendiente'), h('span', { key: 'v' }, 'LIQUIDADO'),
              ]),
          ]) : null,
        ]),
        // Método de pago. En un acuse de COBRANZA DE APARTADO no se repite: el pago
        // del día ya declaró su forma arriba y el «método» de la venta es el propio
        // apartado. H-73: un acuse de cambio sí lo conserva, porque ahí el método de
        // la venta y el de la diferencia son dos hechos distintos.
        esCobranzaApartado ? null : h('div', { key: 'mp', className: 'tk-block w-full mt-5 bg-surface-container-low rounded-xl p-4 text-left flex items-center gap-3' }, [
          h(MS, { key: 'i', name: ((C.find('payment_method', sale.metodo) || {}).meta || {}).icon || 'cash', size: 22, className: 'text-gold-text' }),
          h('div', { key: 't' }, [
            h('p', { key: 'a', className: 'uppercase text-on-surface-variant', style: { fontSize: '10px', letterSpacing: '0.08em' } }, 'Método de pago'),
            h('p', { key: 'b', className: 'font-medium text-primary', style: { fontSize: '13px' } }, sale.metodo),
          ]),
        ]),
        // Historial de pagos al pie: cada movimiento con su fecha, concepto e importe.
        // El pago que se acaba de recibir queda marcado para que el cliente lo ubique.
        pagos.length ? h('div', { key: 'ph', className: 'tk-block w-full mt-4 text-left border border-outline-variant rounded-xl p-4' }, [
          h('p', { key: 't', className: 'uppercase text-on-surface-variant mb-2.5', style: { fontSize: '10px', letterSpacing: '0.08em' } }, 'Historial de pagos'),
          ...pagos.map((p, i) => {
            const esteEs = payment && p.id === payment.id;
            return h('div', { key: p.id || i, className: 'flex justify-between items-start gap-3 py-1 ' + (esteEs ? 'font-semibold text-primary' : 'text-on-surface-variant') }, [
              h('span', { key: 'l', className: 'flex-1 min-w-0', style: { fontSize: '11px', lineHeight: 1.35 } }, [
                h('span', { key: 'd' }, String(p.fecha || '').slice(0, 10) + ' · '),
                h('span', { key: 'c' }, CONCEPTO[p.tipo] ? CONCEPTO[p.tipo].replace(' de apartado', '').replace(' a apartado', '') : (p.tipo || 'pago')),
                h('span', { key: 'm' }, ' · ' + p.metodo),
                // Sin flechas ni glifos raros: una impresora térmica no siempre los tiene.
                esteEs ? h('span', { key: 'n' }, ' (este pago)') : null,
              ]),
              h('span', { key: 'v', className: 'shrink-0', style: { fontSize: '12px' } }, fmt(p.monto)),
            ]);
          }),
          h('div', { key: 'tot', className: 'flex justify-between items-center mt-2 pt-2 border-t border-outline-variant font-semibold text-primary', style: { fontSize: '12px' } }, [
            h('span', { key: 'l' }, `Total pagado (${pagos.length} movimiento${pagos.length === 1 ? '' : 's'})`),
            h('span', { key: 'v' }, fmt(pagos.reduce((a, p) => a + (Number(p.monto) || 0), 0))),
          ]),
        ]) : null,
        !snapshotCompleto ? h('div', { key: 'hw', className: 'w-full mt-4 p-3 border border-outline-variant rounded-lg text-on-surface-variant', style: { fontSize: '10px' } }, 'Venta histórica: desglose fiscal o de descuentos no disponible; se conserva el total registrado.') : null,
        (conCobranza && saldoPend > 0) ? h('div', { key: 'nt', className: 'w-full mt-4 p-3 border border-outline-variant rounded-lg text-on-surface-variant text-left', style: { fontSize: '10px', lineHeight: 1.5 } },
          'Conserva este comprobante. La mercancía se entrega al liquidar el saldo.') : null,
        // Pie
        h('div', { key: 'f', className: 'tk-block w-full mt-12 mb-1 flex flex-col items-center' }, [
          h('div', { key: 'd', className: 'w-12 h-px bg-outline-variant mb-6' }),
          h('p', { key: 'm', className: 'font-headline italic text-primary px-2 mb-1', style: { fontSize: '20px', lineHeight: 1.35 } }, frozenStore.footer || (!receiptSnapshot && C.get('ticket.footer')) || 'Gracias por ser parte de nuestra herencia.'),
          (frozenStore.tagline || (!receiptSnapshot && C.get('ticket.tagline'))) && h('p', { key: 'tl', className: 'text-on-surface-variant px-4 mt-3', style: { fontSize: '12px', lineHeight: 1.6 } }, frozenStore.tagline || C.get('ticket.tagline')),
          h('div', { key: 'bc', className: 'mt-9 w-full flex flex-col items-center gap-2' }, [
            h('div', { key: 'b', className: 'flex items-end justify-center gap-[1px] py-2 px-6 w-full', style: { background: 'rgba(19,27,46,0.035)' } }, bars),
            h('span', { key: 'u', className: 'text-on-surface-variant', style: { fontSize: '9px', letterSpacing: '0.3em' } }, 'BALAMGUAYABERAS.COM'),
          ]),
        ]),
      ]));
    // Portal a <body>: fuera de los contenedores con scroll de la pantalla.
    return (typeof ReactDOM !== 'undefined' && ReactDOM.createPortal && typeof document !== 'undefined')
      ? ReactDOM.createPortal(documento, document.body)
      : documento;
  }

  // Documento termico propio de una devolucion directa. No reutiliza el
  // vocabulario de Cambio y consume solo la venta/retorno ya congelados.
  function BalamReturnReceipt({ sale, returnDoc }) {
    if (!sale || !returnDoc) return null;
    const snapshot = sale.receiptSnapshot && sale.receiptSnapshot.version === 1 ? sale.receiptSnapshot : null;
    const store = snapshot && snapshot.store ? snapshot.store : {};
    const seller = (snapshot && snapshot.sellerName) || sale.vendedor || '—';
    const displayFor = (line, index) => {
      const saleIndex = (sale.lineas || []).findIndex(soldLine =>
        String(soldLine.productId || '') === String(line.productId || '')
        && String(soldLine.sku || '') === String(line.sku || '')
        && String(soldLine.talla || '') === String(line.talla || ''));
      const sold = snapshot && Array.isArray(snapshot.lines)
        ? snapshot.lines[saleIndex >= 0 ? saleIndex : index] : null;
      return sold || { name: line.nombre || '', sku: line.sku || '', sizeLabel: line.talla || '' };
    };
    const documentNode = h('div', { id: 'balam-return-receipt' },
      h('div', { className: 'px-6 py-7 font-body text-on-surface', style: { width: '80mm', boxSizing: 'border-box' } }, [
        h('div', { key: 'h', className: 'tk-block text-center border-b border-outline-variant pb-5 mb-5' }, [
          h('h1', { key: 'b', className: 'font-headline text-primary', style: { fontSize: '28px' } }, 'BALAM'),
          h('div', { key: 's', style: { fontSize: '12px' } }, store.name || 'Balam Guayaberas'),
          h('div', { key: 't', className: 'font-semibold mt-4', style: { fontSize: '18px' } }, 'COMPROBANTE DE DEVOLUCIÓN'),
        ]),
        h('div', { key: 'i', className: 'tk-block space-y-1 border-b border-outline-variant pb-4 mb-5', style: { fontSize: '12px' } }, [
          h('div', { key: 'f' }, `Folio de devolución: ${returnDoc.id}`),
          h('div', { key: 'o' }, `Venta original: ${returnDoc.folio || sale.folio}`),
          h('div', { key: 'd' }, `Fecha: ${returnDoc.fecha || ''}`),
          h('div', { key: 'v' }, `Vendedor: ${seller}`),
          h('div', { key: 'c' }, `Cliente: ${returnDoc.cliente || sale.cliente || 'Público en general'}`),
          h('div', { key: 'm' }, `Método de devolución: ${returnDoc.metodo || '—'}`),
          h('div', { key: 'r' }, `Referencia de operación: ${returnDoc.id}`),
        ]),
        h('div', { key: 'l', className: 'space-y-4' }, (returnDoc.lineas || []).map((line, index) => {
          const shown = displayFor(line, index);
          return h('div', { key: index, className: 'tk-block border-b border-outline-variant pb-3', style: { fontSize: '12px' } }, [
            h('div', { key: 'n', className: 'font-semibold' }, shown.name || line.nombre),
            h('div', { key: 'a' }, `SKU: ${shown.sku || line.sku} · Talla: ${shown.sizeLabel || line.talla}`),
            h('div', { key: 'q' }, `Cantidad: ${line.qty} · Importe: ${fmt((Number(line.precio) || 0) * (Number(line.qty) || 0))}`),
          ]);
        })),
        h('div', { key: 'tot', className: 'tk-block flex justify-between font-headline text-primary mt-6 pt-4 border-t-2 border-primary', style: { fontSize: '20px' } }, [
          h('span', { key: 'l' }, 'REEMBOLSO'), h('span', { key: 'v' }, fmt(returnDoc.total)),
        ]),
      ]));
    return (typeof ReactDOM !== 'undefined' && ReactDOM.createPortal && typeof document !== 'undefined')
      ? ReactDOM.createPortal(documentNode, document.body) : documentNode;
  }

  window.TicketPanel = TicketPanel;
  window.AdditionalDiscountModal = AdditionalDiscountModal;
  window.CheckoutModal = CheckoutModal;
  window.BalamTicket = BalamTicket;
  window.BalamReturnReceipt = BalamReturnReceipt;
})();
