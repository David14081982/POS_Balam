// returns.jsx — Pantalla de Devoluciones (Heritage). Replica el diseño de "Detalle de
// Devolución": elegir folio → seleccionar artículos (checkbox revela motivo + cantidad) →
// notas → resumen con total a reembolsar. Reingresa stock, revierte comisión (configurable)
// y marca la venta original. Todo se asienta en window.DATA y sincroniza a pos.returns.
// Exporta window.ReturnsScreen.
(function () {
  const { useState, useMemo } = React;
  const { toast, fmt, StatusBadge } = window.UI;
  const { MS, GlassCard, SerifHeading } = window.HX;
  const C = window.CONFIG;
  const D = window.DATA;
  const h = React.createElement;

  function ReturnsScreen() {
    const [folio, setFolio] = useState(null);
    const [, bump] = useState(0);
    const refresh = () => bump(v => v + 1);
    if (folio) {
      const sale = D.sales.find(s => s.folio === folio);
      if (!sale) { setFolio(null); return null; }
      return h(ReturnDetail, { sale, onBack: () => setFolio(null), onDone: () => { setFolio(null); refresh(); } });
    }
    return h(ReturnPicker, { onPick: setFolio });
  }

  // ── Paso 1: elegir la venta a devolver + historial de devoluciones ─────────────
  function ReturnPicker({ onPick }) {
    const [q, setQ] = useState('');
    const sales = useMemo(() => {
      const term = q.trim().toLowerCase();
      return D.sales
        .filter(s => D.isReturnable(s))
        .filter(s => !term || String(s.folio).toLowerCase().includes(term) || String(s.cliente || '').toLowerCase().includes(term))
        .slice(0, 40);
    }, [q, D.sales.length]);
    const recent = (D.returns || []).slice(0, 8);

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface p-6' },
      h('div', { className: 'max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6' }, [
        // Columna: selector de venta
        h('div', { key: 'pick', className: 'lg:col-span-2 space-y-4' }, [
          h(GlassCard, { key: 'search', className: 'p-4' }, [
            h('div', { key: 'l', className: 'flex items-center gap-2 mb-3 text-on-surface-variant' }, [
              h(MS, { key: 'i', name: 'undo', size: 18 }),
              h(SerifHeading, { key: 't', children: 'Selecciona la venta a devolver' }),
            ]),
            h('div', { key: 's', className: 'relative' }, [
              h(MS, { key: 'i', name: 'search', size: 18, className: 'absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant' }),
              h('input', { key: 'in', value: q, onChange: e => setQ(e.target.value), placeholder: 'Buscar por folio o cliente…', autoFocus: true, className: 'w-full h-11 pl-10 pr-3 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary text-body rounded-lg' }),
            ]),
          ]),
          h('div', { key: 'list', className: 'flex flex-col gap-2' }, sales.length ? sales.map(s => h('button', {
            key: s.folio,
            className: 'group flex items-center gap-4 p-4 bg-surface-container-lowest rounded-lg shadow-e1 hover:shadow-e2 transition-all text-left',
            onClick: () => onPick(s.folio),
          }, [
            h('div', { key: 'f', className: 'w-24 shrink-0' }, [
              h('div', { key: 'a', className: 'font-headline text-h2 text-primary' }, s.folio),
              h('div', { key: 'b', className: 'text-overline uppercase text-on-surface-variant' }, String(s.fecha || '').slice(0, 10)),
            ]),
            h('div', { key: 'c', className: 'flex-1 min-w-0' }, [
              h('div', { key: 'a', className: 'text-body font-medium text-primary truncate' }, s.cliente || 'Público en general'),
              h('div', { key: 'b', className: 'text-caption text-on-surface-variant' }, `${s.items} art. · ${s.metodo}`),
              !(s.lineas && s.lineas.length) && h('div', { key: 'd', className: 'flex items-center gap-1 text-overline uppercase text-warning mt-0.5' }, [h(MS, { key: 'i', name: 'alert', size: 13 }), 'Sin detalle de artículos']),
            ]),
            h(StatusBadge, { key: 'st', estado: s.estado }),
            h('div', { key: 't', className: 'w-24 text-right font-headline text-h2 text-primary' }, fmt(s.total).replace('.00', '')),
            h(MS, { key: 'ch', name: 'chevRight', size: 20, className: 'text-on-surface-variant group-hover:text-primary' }),
          ])) : h('div', { key: 'empty', className: 'text-center text-on-surface-variant py-12 text-body' }, 'No hay ventas que coincidan. Solo se pueden devolver ventas pagadas o entregadas.')),
        ]),
        // Columna: devoluciones recientes
        h('div', { key: 'rec', className: 'space-y-4' },
          h(GlassCard, { className: 'p-5' }, [
            h(SerifHeading, { key: 't', className: 'mb-1', children: 'Devoluciones recientes' }),
            h('p', { key: 'h', className: 'text-caption text-on-surface-variant mb-4' }, 'Últimos reembolsos registrados.'),
            recent.length ? h('div', { key: 'l', className: 'flex flex-col divide-y divide-outline-variant/50' }, recent.map(r => h('div', { key: r.id, className: 'flex items-center justify-between py-2.5' }, [
              h('div', { key: 'a', className: 'min-w-0' }, [
                h('div', { key: 'f', className: 'text-body font-medium text-primary' }, r.folio),
                h('div', { key: 'd', className: 'text-overline uppercase text-on-surface-variant truncate' }, `${String(r.fecha || '').slice(0, 10)} · ${(r.lineas || []).reduce((a, l) => a + (Number(l.qty) || 0), 0)} pza`),
              ]),
              h('span', { key: 'm', className: 'font-headline text-body text-gold-text' }, '−' + fmt(r.total).replace('.00', '')),
            ]))) : h('div', { key: 'e', className: 'text-caption text-on-surface-variant py-4' }, 'Aún no hay devoluciones.'),
          ])),
      ]));
  }

  // ── Paso 2: detalle de la devolución ───────────────────────────────────────────
  function ReturnDetail({ sale, onBack, onDone }) {
    // Agrupa renglones por sku+talla y calcula lo aún devolvible (vendido − ya devuelto).
    const rows = useMemo(() => {
      const g = {};
      (sale.lineas || []).forEach(l => {
        const k = l.sku + '__' + l.talla;
        if (!g[k]) g[k] = { k, sku: l.sku, nombre: l.nombre, talla: l.talla, precio: Number(l.precio) || 0, qty: 0 };
        g[k].qty += Number(l.qty) || 0;
      });
      return Object.values(g).map(x => { x.returned = D.returnedQty(sale.folio, x.sku, x.talla); x.max = Math.max(0, x.qty - x.returned); return x; });
    }, [sale.folio]);

    const reasons = C.list('return_reason');
    const methods = ['Mismo método'].concat(C.codes('payment_method'));
    const [sel, setSel] = useState({});        // { k: { on, motivo, qty } }
    const [metodo, setMetodo] = useState('Mismo método');
    const [notas, setNotas] = useState('');

    const setRow = (k, patch) => setSel(p => ({ ...p, [k]: { ...(p[k] || { on: false, motivo: '', qty: 1 }), ...patch } }));
    const toggle = (row) => { const cur = sel[row.k] || {}; setRow(row.k, { on: !cur.on, qty: cur.qty || 1, motivo: cur.motivo || '' }); };
    const setQty = (row, d) => { const cur = sel[row.k] || { qty: 1 }; const q = Math.min(row.max, Math.max(1, (cur.qty || 1) + d)); setRow(row.k, { qty: q }); };

    const chosen = rows.filter(r => sel[r.k] && sel[r.k].on && r.max > 0);
    const count = chosen.reduce((a, r) => a + (sel[r.k].qty || 1), 0);
    const refund = chosen.reduce((a, r) => a + r.precio * (sel[r.k].qty || 1), 0);

    function confirm() {
      if (!chosen.length) { toast('Selecciona al menos un artículo', 'var(--danger)'); return; }
      for (const r of chosen) { if (!sel[r.k].motivo) { toast(`Elige el motivo para ${r.nombre}`, 'var(--danger)'); return; } }
      const lineas = chosen.map(r => ({ sku: r.sku, nombre: r.nombre, talla: r.talla, qty: sel[r.k].qty || 1, motivo: sel[r.k].motivo, precio: r.precio }));
      const res = D.recordReturn({ folio: sale.folio, lineas, metodo: metodo === 'Mismo método' ? sale.metodo : metodo, notas });
      if (!res.ok) { toast(res.error, 'var(--danger)'); return; }
      toast(`Devolución registrada · ${fmt(res.ret.total)}`, 'var(--accent)');
      onDone();
    }

    const reverseOn = !!C.get('returns.reverseCommission');

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'max-w-[1100px] mx-auto p-6' }, [
        // Breadcrumb
        h('div', { key: 'bc', className: 'flex items-center gap-3 mb-6' }, [
          h('button', { key: 'b', className: 'inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors', onClick: onBack }, [
            h(MS, { key: 'i', name: 'chevLeft', size: 18 }), h('span', { key: 't', className: 'text-overline uppercase tracking-widest font-semibold' }, 'Devoluciones'),
          ]),
          h('div', { key: 'd', className: 'h-4 w-px bg-outline-variant' }),
          h(SerifHeading, { key: 'h', level: 'lg', className: 'italic', children: 'Detalle de devolución' }),
        ]),
        // Tarjeta de contexto de la venta
        h(GlassCard, { key: 'ctx', className: 'p-5 mb-6 flex flex-wrap items-center gap-6' }, [
          h('div', { key: 'f' }, [
            h('div', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant' }, 'Folio original'),
            h('div', { key: 'v', className: 'font-headline text-headline-md text-primary' }, sale.folio),
          ]),
          h('div', { key: 's1', className: 'h-10 w-px bg-outline-variant hidden md:block' }),
          h('div', { key: 'c' }, [
            h('div', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant' }, 'Cliente'),
            h('div', { key: 'v', className: 'text-body-lg font-medium text-primary' }, sale.cliente || 'Público en general'),
          ]),
          h('div', { key: 's2', className: 'h-10 w-px bg-outline-variant hidden md:block' }),
          h('div', { key: 'd' }, [
            h('div', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant' }, 'Fecha de venta'),
            h('div', { key: 'v', className: 'text-body-lg text-primary' }, String(sale.fecha || '').slice(0, 10)),
          ]),
          h('div', { key: 'sp', className: 'flex-1' }),
          h(StatusBadge, { key: 'st', estado: sale.estado }),
        ]),
        // Grid principal
        h('div', { key: 'grid', className: 'grid grid-cols-1 lg:grid-cols-3 gap-8' }, [
          // Columna selección
          h('div', { key: 'sel', className: 'lg:col-span-2 space-y-6' }, [
            h('section', { key: 'items' }, [
              h(SerifHeading, { key: 't', className: 'mb-4', children: 'Selección de artículos' }),
              rows.length === 0 && h('div', { key: 'empty', className: 'bg-surface-container-lowest rounded-lg shadow-e1 p-8 text-center' }, [
                h('div', { key: 'i', className: 'w-12 h-12 mx-auto mb-3 rounded-full grid place-items-center bg-warning-soft text-warning' }, h(MS, { name: 'alert', size: 24 })),
                h('div', { key: 't', className: 'font-headline text-h2 text-primary mb-1' }, 'Esta venta no tiene detalle de artículos'),
                h('p', { key: 'd', className: 'text-caption text-on-surface-variant max-w-sm mx-auto leading-relaxed' }, 'Es una venta histórica o de demostración registrada sin renglones, por lo que no puede procesarse una devolución por pieza. Las ventas hechas en Punto de venta sí incluyen el detalle y se pueden devolver.'),
              ]),
              rows.length > 0 && h('div', { key: 'list', className: 'space-y-3' }, rows.map(row => {
                const st = sel[row.k] || {};
                const done = row.max <= 0;
                return h('div', { key: row.k, className: 'bg-surface-container-lowest rounded-lg shadow-e1 p-5 ' + (done ? 'opacity-60' : '') }, [
                  h('div', { key: 'top', className: 'flex gap-4 items-start' }, [
                    // Checkbox
                    h('button', {
                      key: 'cb', disabled: done, onClick: () => toggle(row),
                      className: 'w-6 h-6 mt-0.5 shrink-0 grid place-items-center rounded border-2 transition-colors ' + (st.on ? 'bg-primary border-primary text-on-primary' : 'border-outline ' + (done ? '' : 'hover:border-primary')),
                    }, st.on && h(MS, { name: 'check', size: 16 })),
                    h('div', { key: 'info', className: 'flex-1 min-w-0' }, [
                      h('div', { key: 'r', className: 'flex justify-between items-start gap-3' }, [
                        h('div', { key: 'a', className: 'min-w-0' }, [
                          h('div', { key: 'n', className: 'font-headline text-h2 text-primary truncate' }, row.nombre),
                          h('div', { key: 's', className: 'text-overline uppercase text-on-surface-variant mt-0.5' }, `${row.sku} · Talla ${row.talla}`),
                        ]),
                        h('div', { key: 'p', className: 'text-right shrink-0' }, [
                          h('div', { key: 'pr', className: 'text-body-lg text-primary' }, fmt(row.precio)),
                          h('div', { key: 'q', className: 'text-overline uppercase text-on-surface-variant' }, done ? 'Devuelto' : `${row.max} de ${row.qty} devolvible`),
                        ]),
                      ]),
                      // Detalle revelado al marcar
                      st.on && !done && h('div', { key: 'det', className: 'mt-5 pt-5 border-t border-outline-variant grid grid-cols-1 md:grid-cols-2 gap-5' }, [
                        h('div', { key: 'm' }, [
                          h('label', { key: 'l', className: 'block text-overline uppercase tracking-widest text-on-surface-variant mb-1.5' }, 'Motivo de devolución'),
                          h('select', {
                            key: 's', value: st.motivo || '', onChange: e => setRow(row.k, { motivo: e.target.value }),
                            className: 'w-full h-10 px-3 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary text-body rounded-lg',
                          }, [h('option', { key: '_', value: '', disabled: true }, 'Selecciona un motivo…')].concat(reasons.map(r => h('option', { key: r.code, value: r.code }, r.label)))),
                        ]),
                        h('div', { key: 'q' }, [
                          h('label', { key: 'l', className: 'block text-overline uppercase tracking-widest text-on-surface-variant mb-1.5' }, 'Cantidad'),
                          h('div', { key: 'st', className: 'flex items-center gap-3' }, [
                            h('button', { key: '-', onClick: () => setQty(row, -1), className: 'w-9 h-9 grid place-items-center border border-outline-variant rounded-lg text-on-surface-variant hover:bg-surface-container' }, h(MS, { name: 'minus', size: 16 })),
                            h('span', { key: 'v', className: 'w-8 text-center font-headline text-h2 text-primary' }, st.qty || 1),
                            h('button', { key: '+', onClick: () => setQty(row, 1), className: 'w-9 h-9 grid place-items-center border border-outline-variant rounded-lg text-on-surface-variant hover:bg-surface-container' }, h(MS, { name: 'plus', size: 16 })),
                          ]),
                        ]),
                      ]),
                    ]),
                  ]),
                ]);
              })),
            ]),
            h('section', { key: 'notes' }, [
              h('label', { key: 'l', className: 'block text-overline uppercase tracking-widest text-on-surface-variant mb-2' }, 'Notas adicionales'),
              h('textarea', { key: 'ta', value: notas, onChange: e => setNotas(e.target.value), rows: 3, placeholder: 'Detalles del estado de la prenda o la solicitud del cliente…', className: 'w-full bg-surface-container-lowest border border-outline-variant focus:ring-1 focus:ring-primary p-4 text-body rounded-lg resize-none' }),
            ]),
          ]),
          // Columna resumen
          h('div', { key: 'sum', className: 'space-y-6' }, [
            h('div', { key: 'card', className: 'bg-primary text-on-primary p-7 rounded-lg sticky top-6' }, [
              h('h4', { key: 't', className: 'font-headline text-headline-md mb-6 pb-4 border-b border-white/15' }, 'Resumen de devolución'),
              h('div', { key: 'rows', className: 'space-y-4' }, [
                h('div', { key: 'c', className: 'flex justify-between items-center' }, [
                  h('span', { key: 'l', className: 'text-overline uppercase opacity-70' }, 'Artículos seleccionados'), h('span', { key: 'v', className: 'font-headline text-headline-md' }, count),
                ]),
                h('div', { key: 's', className: 'flex justify-between items-start' }, [
                  h('span', { key: 'l', className: 'text-overline uppercase opacity-70' }, 'Reingreso a stock'),
                  h('div', { key: 'v', className: 'text-right' }, [
                    h('div', { key: 'a', className: 'text-body' }, `${count} ${count === 1 ? 'unidad' : 'unidades'}`),
                    h('div', { key: 'b', className: 'text-[10px] opacity-50 italic' }, 'Inmediato al confirmar'),
                  ]),
                ]),
                h('div', { key: 'rf', className: 'pt-4 border-t border-white/15' }, [
                  h('div', { key: 'l', className: 'text-overline uppercase mb-1' }, 'Total a reembolsar'),
                  h('div', { key: 'v', className: 'font-headline', style: { color: '#FFE088', fontSize: '34px', lineHeight: 1.1 } }, fmt(refund)),
                ]),
                h('div', { key: 'mt', className: 'pt-2' }, [
                  h('label', { key: 'l', className: 'block text-overline uppercase opacity-70 mb-1.5' }, 'Método de reembolso'),
                  h('select', { key: 's', value: metodo, onChange: e => setMetodo(e.target.value), className: 'w-full h-10 px-3 rounded-lg text-body bg-white/10 border border-white/20 text-on-primary focus:ring-1 focus:ring-secondary-fixed' },
                    methods.map(m => h('option', { key: m, value: m, style: { color: '#131B2E' } }, m))),
                ]),
                reverseOn && h('div', { key: 'cm', className: 'flex items-center gap-2 text-[11px] opacity-70 pt-1' }, [h(MS, { key: 'i', name: 'undo', size: 14 }), 'La comisión del vendedor se ajustará en proporción.']),
              ]),
              h('div', { key: 'btns', className: 'mt-8 space-y-3' }, [
                h('button', { key: 'ok', onClick: confirm, disabled: !chosen.length, className: 'w-full py-3.5 font-label-sm uppercase tracking-widest text-xs rounded-lg transition-all active:scale-95 disabled:opacity-40', style: { background: '#FFE088', color: '#131B2E' } }, 'Confirmar devolución'),
                h('button', { key: 'x', onClick: onBack, className: 'w-full py-3.5 font-label-sm uppercase tracking-widest text-xs rounded-lg border border-white/25 text-on-primary hover:bg-white/10 transition-colors' }, 'Cancelar'),
              ]),
            ]),
            // Guía de calidad
            h('div', { key: 'guide', className: 'p-5 rounded-lg border', style: { borderColor: 'rgba(212,175,56,0.3)', background: 'rgba(212,175,56,0.06)' } },
              h('div', { className: 'flex gap-3' }, [
                h(MS, { key: 'i', name: 'verified', size: 20, className: 'text-gold-text shrink-0' }),
                h('div', { key: 't' }, [
                  h('div', { key: 'a', className: 'text-overline uppercase font-bold text-gold-text mb-1' }, 'Guía de calidad'),
                  h('p', { key: 'b', className: 'text-caption text-on-surface-variant leading-relaxed' }, 'Toda prenda devuelta debe pasar por sanitización y revisión de costuras antes de marcarse como disponible en inventario.'),
                ]),
              ])),
          ]),
        ]),
      ]));
  }

  window.ReturnsScreen = ReturnsScreen;
})();
