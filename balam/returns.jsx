// returns.jsx — Pantalla de Devoluciones (Heritage). Replica el diseño de "Detalle de
// Devolución": elegir folio → seleccionar artículos (checkbox revela motivo + cantidad) →
// notas → resumen con total a reembolsar. Reingresa stock, revierte comisión (configurable)
// y marca la venta original. Todo se asienta en window.DATA y sincroniza a pos.returns.
// Exporta window.ReturnsScreen.
(function () {
  const { useState, useMemo } = React;
  const { toast, fmt, StatusBadge, Segment } = window.UI;
  const { MS, GlassCard, SerifHeading } = window.HX;
  const C = window.CONFIG;
  const D = window.DATA;
  const h = React.createElement;

  // C6: el TIPO DE OPERACIÓN se decide al inicio, sobre la venta ya localizada.
  // El flujo de Devoluciones queda intacto: `ReturnDetail` no cambia una línea.
  // El cambio vive en `ExchangeDetail`, que reutiliza las mismas autoridades.
  const OPERACIONES = [['devolucion', 'Devolución'], ['cambio', 'Cambio']];

  function ReturnsScreen() {
    const [folio, setFolio] = useState(null);
    const [tipo, setTipo] = useState('devolucion');
    const [, bump] = useState(0);
    const refresh = () => bump(v => v + 1);
    const volver = () => { setFolio(null); setTipo('devolucion'); };
    if (folio) {
      // Resuelve por folio vigente o por el folio impreso conservado como alias.
      const sale = D.findSaleByFolio ? D.findSaleByFolio(folio) : D.sales.find(s => s.folio === folio);
      if (!sale) { volver(); return null; }
      const done = () => { volver(); refresh(); };
      const selector = h('div', { key: 'op', className: 'max-w-[1100px] mx-auto px-6 pt-6' }, [
        h('div', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-2' }, 'Tipo de operación'),
        h(Segment, { key: 's', options: OPERACIONES, value: tipo, onChange: setTipo }),
      ]);
      return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' }, [
        selector,
        tipo === 'cambio'
          ? h(ExchangeDetail, { key: 'cd', sale, onBack: volver, onDone: done, embedded: true })
          : h(ReturnDetail, { key: 'rd', sale, onBack: volver, onDone: done, embedded: true }),
      ]);
    }
    return h(ReturnPicker, { onPick: setFolio });
  }

  // ── H-34: presentación del plazo congelado en la venta ────────────────────────
  // `DATA.returnDeadline` es la autoridad; aquí sólo se elige el color y el filtro.
  const DEADLINE_FILTERS = [['todos', 'Todos'], ['vigente', 'Vigentes'], ['vencido', 'Vencidos'], ['sin_limite', 'Sin límite']];
  const deadlineOf = (sale) => (D.returnDeadline ? D.returnDeadline(sale) : { status: 'sin_limite', label: 'Sin límite' });
  const DEADLINE_TONE = { vigente: 'text-success', vencido: 'text-danger', pendiente: 'text-warning', sin_limite: 'text-on-surface-variant' };
  function DeadlineTag({ sale, className }) {
    const dl = deadlineOf(sale);
    return h('div', {
      className: 'flex items-center gap-1 text-overline uppercase mt-0.5 ' + (DEADLINE_TONE[dl.status] || '') + ' ' + (className || ''),
    }, [
      h(MS, { key: 'i', name: dl.status === 'vencido' ? 'alert' : 'clock', size: 13 }),
      h('span', { key: 'l' }, dl.label),
    ]);
  }

  // ── Paso 1: elegir la venta a devolver + historial de devoluciones ─────────────
  function ReturnPicker({ onPick }) {
    const [q, setQ] = useState('');
    const [plazo, setPlazo] = useState('todos');
    const [buscando, setBuscando] = useState(false);
    const [, bump] = useState(0);
    const term = q.trim().toLowerCase();
    // La búsqueda acepta el folio vigente, el folio impreso conservado como alias
    // y el nombre del cliente. El alias pertenece SÓLO a la venta que lo imprimió:
    // nunca ofrece la venta ajena que casualmente comparta la cadena.
    // El plazo NO decide si la venta aparece: una venta vencida se muestra y se
    // explica. Lo que bloquea es confirmar la devolución (DATA.recordReturn).
    const sales = useMemo(() => D.sales
      .filter(s => D.isReturnable(s))
      .filter(s => !term
        || String(s.folio).toLowerCase().includes(term)
        || (D.saleFolioAliases ? D.saleFolioAliases(s) : []).some(a => String(a).toLowerCase().includes(term))
        || String(s.cliente || '').toLowerCase().includes(term))
      .filter(s => plazo === 'todos' || deadlineOf(s).status === plazo)
      .slice(0, 40), [q, plazo, D.sales.length, buscando]);
    const recent = (D.returns || []).slice(0, 8);
    // El pull de ventas es paginado (ventana reciente): un folio más viejo puede no estar
    // en este equipo. Este botón lo trae de la nube y lo fusiona en lo local para devolverlo.
    async function buscarEnNube() {
      if (buscando) return;
      if (!window.STORE || !window.STORE.fetchSaleByFolio) { toast('Sincronización con la nube no disponible', 'var(--danger)'); return; }
      setBuscando(true);
      try {
        const s = await window.STORE.fetchSaleByFolio(q.trim());
        const alias = s && D.folioAliasHit ? D.folioAliasHit(s, q.trim()) : null;
        if (!s) toast('No se encontró ese folio en la nube', 'var(--danger)');
        else if (!D.isReturnable(s)) toast(`La venta ${s.folio} no admite devolución (${s.estado})`, 'var(--danger)');
        else if (alias) toast(`Este ticket se registró posteriormente como ${s.folio}`, 'var(--accent)');
        else toast(`Venta ${s.folio} recuperada del histórico`, 'var(--accent)');
      } catch (e) { toast('No se pudo consultar la nube', 'var(--danger)'); }
      setBuscando(false); bump(v => v + 1);
    }

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
            h('div', { key: 'pl', className: 'mt-3' }, h(Segment, { value: plazo, onChange: setPlazo, options: DEADLINE_FILTERS })),
          ]),
          h('div', { key: 'list', className: 'flex flex-col gap-2' }, sales.length ? sales.map(s => h('button', {
            key: s.folio,
            className: 'group flex items-center gap-4 p-4 bg-surface-container-lowest rounded-lg shadow-e1 hover:shadow-e2 transition-all text-left',
            onClick: () => onPick(s.folio),
          }, [
            // El folio corto de H-33 cabe completo: la columna se dimensiona para
            // mostrarlo en una sola línea en vez de partirlo por sus guiones.
            h('div', { key: 'f', className: 'min-w-[9.5rem] shrink-0' }, [
              h('div', { key: 'a', className: 'font-headline text-h2 text-primary whitespace-nowrap' }, s.folio),
              h('div', { key: 'b', className: 'text-overline uppercase text-on-surface-variant' }, String(s.fecha || '').slice(0, 10)),
              // El ticket del cliente trae otro folio: se dice con qué quedó registrado.
              D.folioAliasHit && D.folioAliasHit(s, term) && h('div', {
                key: 'al', className: 'text-overline text-accent mt-0.5',
              }, `Ticket ${D.folioAliasHit(s, term)} · registrado como ${s.folio}`),
            ]),
            h('div', { key: 'c', className: 'flex-1 min-w-0' }, [
              h('div', { key: 'a', className: 'text-body font-medium text-primary truncate' }, s.cliente || 'Público en general'),
              h('div', { key: 'b', className: 'text-caption text-on-surface-variant' }, `${s.items} art. · ${s.metodo}`),
              h(DeadlineTag, { key: 'dl', sale: s }),
              !(s.lineas && s.lineas.length) && h('div', { key: 'd', className: 'flex items-center gap-1 text-overline uppercase text-warning mt-0.5' }, [h(MS, { key: 'i', name: 'alert', size: 13 }), 'Sin detalle de artículos']),
            ]),
            h(StatusBadge, { key: 'st', estado: s.estado }),
            h('div', { key: 't', className: 'w-24 text-right font-headline text-h2 text-primary' }, fmt(s.total).replace('.00', '')),
            h(MS, { key: 'ch', name: 'chevRight', size: 20, className: 'text-on-surface-variant group-hover:text-primary' }),
          ])) : h('div', { key: 'empty', className: 'text-center text-on-surface-variant py-12 text-body' }, [
            h('p', { key: 'm' }, 'No hay ventas que coincidan. Solo se pueden devolver ventas pagadas o entregadas.'),
            q.trim() && h('button', {
              key: 'nube', disabled: buscando, onClick: buscarEnNube,
              className: 'mt-4 inline-flex items-center gap-2 px-5 h-11 border border-outline-variant rounded-lg text-caption font-bold uppercase tracking-widest text-primary hover:bg-surface-container transition disabled:opacity-50',
            }, [h(MS, { key: 'i', name: buscando ? 'clock' : 'search', size: 16 }), buscando ? 'Buscando…' : 'Buscar folio en el histórico (nube)']),
          ])),
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
      // H-35: lo devolvible sale de la autoridad única del saldo, que descuenta
      // devoluciones y —cuando existan— cambios. No se recalcula aquí.
      const saldo = D.saleLineBalance ? D.saleLineBalance(sale.folio) : [];
      return Object.values(g).map(x => {
        const b = saldo.find(r => r.sku === x.sku && r.talla === x.talla);
        x.returned = b ? b.consumida : D.returnedQty(sale.folio, x.sku, x.talla);
        x.max = b ? b.disponible : Math.max(0, x.qty - x.returned);
        return x;
      });
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
      if (vencida) { toast(`Esta venta ya no admite devolución · ${plazo.label.toLowerCase()}`, 'var(--danger)'); return; }
      if (!chosen.length) { toast('Selecciona al menos un artículo', 'var(--danger)'); return; }
      for (const r of chosen) { if (!sel[r.k].motivo) { toast(`Elige el motivo para ${r.nombre}`, 'var(--danger)'); return; } }
      const lineas = chosen.map(r => ({ sku: r.sku, nombre: r.nombre, talla: r.talla, qty: sel[r.k].qty || 1, motivo: sel[r.k].motivo, precio: r.precio }));
      const res = D.recordReturn({ folio: sale.folio, lineas, metodo: metodo === 'Mismo método' ? sale.metodo : metodo, notas });
      if (!res.ok) { toast(res.error, 'var(--danger)'); return; }
      toast(`Devolución registrada · ${fmt(res.ret.total)}`, 'var(--accent)');
      onDone();
    }

    const reverseOn = !!C.get('returns.reverseCommission');
    // El plazo vive en la venta (H-34): una venta vencida se abre y se explica,
    // pero no se puede confirmar. `recordReturn` aplica la misma regla al guardar.
    const plazo = deadlineOf(sale);
    const vencida = plazo.status === 'vencido';

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
            // Ticket impreso con otro folio: se conserva y se explica siempre.
            !!(D.saleFolioAliases ? D.saleFolioAliases(sale) : []).length && h('div', {
              key: 'al', className: 'text-caption text-accent mt-1',
            }, `Ticket ${D.saleFolioAliases(sale).join(', ')} · este ticket se registró posteriormente como ${sale.folio}`),
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
          h('div', { key: 's3', className: 'h-10 w-px bg-outline-variant hidden md:block' }),
          h('div', { key: 'pl' }, [
            h('div', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant' }, 'Plazo'),
            h('div', { key: 'v', className: 'text-body-lg ' + (DEADLINE_TONE[plazo.status] || 'text-primary') }, plazo.label),
            plazo.expiresAt && h('div', { key: 'e', className: 'text-overline uppercase text-on-surface-variant' }, `Hasta ${plazo.expiresAt}`),
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
                vencida && h('div', { key: 'exp', className: 'mb-3 p-3 rounded-lg text-caption leading-relaxed', style: { background: 'rgba(255,255,255,0.12)' } },
                  `Fuera de plazo: esta venta admitía devolución hasta el ${plazo.expiresAt}. Para aceptarla, un administrador debe ajustar el plazo en Configuración → Devoluciones.`),
                h('button', { key: 'ok', onClick: confirm, disabled: !chosen.length || vencida, className: 'w-full py-3.5 font-label-sm uppercase tracking-widest text-xs rounded-lg transition-all active:scale-95 disabled:opacity-40', style: { background: '#FFE088', color: '#131B2E' } }, 'Confirmar devolución'),
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

  // ── C6: pantalla del Cambio ──────────────────────────────────────────────────
  // Reutiliza las autoridades existentes y no duplica ninguna regla:
  //   saleLineBalance      → qué queda disponible de la venta
  //   recognizedValue      → cuánto vale la pieza que el cliente entrega
  //   priceRange/listPrice → qué cuesta hoy lo que se lleva
  //   returnDeadline       → si la venta todavía admite posventa
  //   recordExchange       → única vía de registro; el servidor recalcula el dinero
  //   CheckoutModal        → el cobro completo del POS para la diferencia
  //   BalamTicket          → autoridad única del comprobante impreso
  function ExchangeDetail({ sale, onBack, onDone, embedded }) {
    const [dev, setDev] = useState({});
    const [ent, setEnt] = useState([]);
    const [picking, setPicking] = useState(null);
    const [q, setQ] = useState('');
    const [notas, setNotas] = useState('');
    const [revisor, setRevisor] = useState('');
    const [cobro, setCobro] = useState(false);
    const [recibo, setRecibo] = useState(null);
    const [vendedor, setVendedor] = useState(null);
    const reasons = C.list('return_reason');
    const plazo = deadlineOf(sale);
    const vencida = plazo.status === 'vencido';
    const elegibles = D.sellers.filter(v => (D.isEligibleSeller ? D.isEligibleSeller(v) : v.active));

    const saldo = (D.saleLineBalance ? D.saleLineBalance(sale.folio) : [])
      .filter(r => r.disponible > 0)
      .map(r => Object.assign({}, r, {
        k: r.sku + '|' + r.talla,
        nombre: ((sale.lineas || []).find(l => l.sku === r.sku && l.talla === r.talla) || {}).nombre || r.sku,
        valor: D.recognizedValue ? D.recognizedValue(sale.folio, r.sku, r.talla) : 0,
      }));
    const setRow = (k, patch) => setDev(p => Object.assign({}, p, { [k]: Object.assign({ on: true, qty: 1 }, p[k], patch) }));
    const marcados = saldo.filter(r => dev[r.k] && dev[r.k].on);

    const valorReconocido = marcados.reduce((a, r) => a + r.valor * (dev[r.k].qty || 1), 0);
    const valorEntregado = ent.reduce((a, l) => a + D.listPrice(l.p, l.talla) * l.qty, 0);
    const diferencia = Math.max(0, Math.round((valorEntregado - valorReconocido) * 100) / 100);
    const noAprovechado = Math.max(0, Math.round((valorReconocido - valorEntregado) * 100) / 100);

    const catalogo = useMemo(() => {
      const t = q.trim().toUpperCase();
      return D.products.filter(p => !p._deletedAt && (!t
        || String(p.nombre).toUpperCase().includes(t) || String(p.sku).toUpperCase().includes(t)))
        .slice(0, 24);
    }, [q]);

    function agregar(p, talla) {
      setPicking(null);
      setEnt(prev => {
        const i = prev.findIndex(l => l.p.id === p.id && l.talla === talla);
        if (i >= 0) { const c = prev.slice(); c[i] = Object.assign({}, c[i], { qty: c[i].qty + 1 }); return c; }
        return prev.concat([{ p, talla, qty: 1 }]);
      });
    }

    function validar() {
      if (vencida) { toast('Esta venta ya no admite posventa · ' + plazo.label.toLowerCase(), 'var(--danger)'); return false; }
      if (!marcados.length) { toast('Marca lo que el cliente entrega', 'var(--danger)'); return false; }
      if (!ent.length) { toast('Elige lo que el cliente se lleva', 'var(--danger)'); return false; }
      for (const r of marcados) {
        if (!dev[r.k].motivo) { toast('Elige el motivo para ' + r.nombre, 'var(--danger)'); return false; }
        if (!String(dev[r.k].condicion || '').trim()) { toast('Registra la revisión de ' + r.nombre, 'var(--danger)'); return false; }
      }
      if (!String(revisor).trim()) { toast('Escribe quién revisó la mercancía', 'var(--danger)'); return false; }
      return true;
    }

    // El excedente lo cobra el checkout completo del POS. Sin diferencia, el
    // sobrante se pierde (Contrato del Cambio §4) y se confirma explícitamente.
    function siguiente() {
      if (!validar()) return;
      if (diferencia > 0) { setCobro(true); return; }
      if (noAprovechado > 0 && !window.confirm(
        'El cliente se lleva ' + fmt(noAprovechado) + ' menos de lo que entrega.\n\n'
        + 'Ese saldo NO se devuelve en efectivo y NO queda a favor: se pierde.\n\n¿Confirmas el cambio?')) return;
      setVendedor({ metodo: null });
    }

    function registrar(sellerId, metodo) {
      const lineas = marcados.map(r => ({
        lado: 'devuelto', sku: r.sku, nombre: r.nombre, talla: r.talla,
        qty: dev[r.k].qty || 1, motivo: dev[r.k].motivo, condicion: dev[r.k].condicion,
        productId: (D.products.find(p => p.sku === r.sku) || {}).id,
      })).concat(ent.map(l => ({
        lado: 'entregado', sku: l.p.sku, nombre: l.p.nombre, talla: l.talla,
        qty: l.qty, productId: l.p.id,
      })));
      const res = D.recordExchange({
        origenFolio: sale.folio, lineas, notas,
        usuario: (window.AUTH && window.AUTH.current && (window.AUTH.current() || {}).email) || '',
        vendedorId: sellerId, revisadoPor: revisor, metodoPago: metodo,
      });
      if (!res.ok) { toast(res.error, 'var(--danger)'); return; }
      toast('Cambio registrado · ' + res.exchange.folio, 'var(--accent)');
      setVendedor(null); setCobro(false);
      setRecibo({ sale, exchange: res.exchange, payment: res.payment });
    }

    const box = 'bg-surface-container-lowest rounded-xl border border-outline-variant p-5';
    const cuerpo = h('div', { className: 'max-w-[1100px] mx-auto p-6' }, [
      h('div', { key: 'bc', className: 'flex items-center gap-3 mb-5' }, [
        h('button', { key: 'b', className: 'inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors', onClick: onBack },
          [h(MS, { key: 'i', name: 'chevLeft', size: 18 }), h('span', { key: 't', className: 'text-overline uppercase tracking-widest font-semibold' }, 'Devoluciones')]),
        h('span', { key: 'f', className: 'text-overline uppercase text-on-surface-variant' }, sale.folio),
        h(DeadlineTag, { key: 'dl', sale }),
      ]),
      vencida && h('div', { key: 'exp', className: 'mb-4 p-3 rounded-lg text-caption bg-surface-container' },
        'Fuera de plazo: esta venta admitía posventa hasta ' + (plazo.expiresAt || '—') + '. Un administrador debe ajustar el plazo en Configuración → Devoluciones.'),

      h('div', { key: 'dev', className: box + ' mb-5' }, [
        h('div', { key: 't', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-3' }, 'Lo que el cliente entrega'),
        !saldo.length && h('p', { key: 'v', className: 'text-caption text-on-surface-variant' }, 'Esta venta ya no tiene piezas disponibles.'),
        ...saldo.map(r => {
          const st = dev[r.k] || {};
          return h('div', { key: r.k, className: 'py-3 border-b border-outline-variant last:border-0' }, [
            h('label', { key: 'h', className: 'flex items-center gap-3 cursor-pointer' }, [
              h('input', { key: 'c', type: 'checkbox', checked: !!st.on, className: 'w-5 h-5 rounded border-outline text-primary',
                onChange: e => setRow(r.k, { on: e.target.checked }) }),
              h('div', { key: 'n', className: 'flex-1 min-w-0' }, [
                h('div', { key: 'a', className: 'text-body text-primary font-semibold truncate' }, r.nombre),
                h('div', { key: 'b', className: 'text-overline uppercase text-on-surface-variant' },
                  'Talla ' + r.talla + ' · ' + r.disponible + ' disponible(s) · se reconoce ' + fmt(r.valor)),
              ]),
            ]),
            st.on && h('div', { key: 'd', className: 'mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 pl-8' }, [
              h('div', { key: 'm' }, [
                h('label', { key: 'l', className: 'block text-overline uppercase text-on-surface-variant mb-1' }, 'Motivo'),
                h('select', { key: 's', value: st.motivo || '', className: 'w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg text-body',
                  onChange: e => setRow(r.k, { motivo: e.target.value }) },
                  [h('option', { key: '_', value: '', disabled: true }, 'Selecciona…')].concat(reasons.map(x => h('option', { key: x.code, value: x.code }, x.label)))),
              ]),
              h('div', { key: 'q' }, [
                h('label', { key: 'l', className: 'block text-overline uppercase text-on-surface-variant mb-1' }, 'Cantidad'),
                h('div', { key: 'w', className: 'flex items-center gap-2' }, [
                  h('button', { key: 'm', className: 'w-9 h-9 grid place-items-center border border-outline-variant rounded-lg', onClick: () => setRow(r.k, { qty: Math.max(1, (st.qty || 1) - 1) }) }, h(MS, { name: 'minus', size: 16 })),
                  h('span', { key: 'v', className: 'w-8 text-center font-headline text-h2 text-primary' }, st.qty || 1),
                  h('button', { key: 'p', className: 'w-9 h-9 grid place-items-center border border-outline-variant rounded-lg', onClick: () => setRow(r.k, { qty: Math.min(r.disponible, (st.qty || 1) + 1) }) }, h(MS, { name: 'plus', size: 16 })),
                ]),
              ]),
              h('div', { key: 'r' }, [
                h('label', { key: 'l', className: 'block text-overline uppercase text-on-surface-variant mb-1' }, 'Revisión de la prenda'),
                h('input', { key: 'i', value: st.condicion || '', placeholder: 'Excelente · sin uso, con etiqueta…',
                  className: 'w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg text-body',
                  onChange: e => setRow(r.k, { condicion: e.target.value }) }),
              ]),
            ]),
          ]);
        }),
      ]),

      h('div', { key: 'ent', className: box + ' mb-5' }, [
        h('div', { key: 't', className: 'flex items-center gap-3 mb-3' }, [
          h('span', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant' }, 'Lo que el cliente se lleva'),
          h('input', { key: 'q', value: q, placeholder: 'Buscar artículo o SKU…', onChange: e => setQ(e.target.value),
            className: 'flex-1 h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg text-body' }),
        ]),
        ...ent.map((l, i) => h('div', { key: 'l' + i, className: 'flex items-center gap-3 py-2 border-b border-outline-variant last:border-0' }, [
          h('div', { key: 'n', className: 'flex-1 min-w-0' }, [
            h('div', { key: 'a', className: 'text-body text-primary truncate' }, l.p.nombre),
            h('div', { key: 'b', className: 'text-overline uppercase text-on-surface-variant' }, 'Talla ' + l.talla + ' · ' + fmt(D.listPrice(l.p, l.talla))),
          ]),
          h('span', { key: 'q', className: 'font-headline text-body text-primary' }, '×' + l.qty),
          h('button', { key: 'x', className: 'w-9 h-9 grid place-items-center text-on-surface-variant hover:text-danger', onClick: () => setEnt(prev => prev.filter((_, j) => j !== i)) }, h(MS, { name: 'trash', size: 16 })),
        ])),
        h('div', { key: 'cat', className: 'grid grid-cols-2 md:grid-cols-4 gap-2 mt-3' }, catalogo.map(p => {
          const r = D.priceRange(p);
          return h('button', { key: p.id, onClick: () => setPicking(p),
            className: 'text-left p-3 border border-outline-variant rounded-lg hover:border-primary transition-colors' }, [
            h('div', { key: 'n', className: 'text-caption text-primary font-semibold truncate' }, p.nombre),
            h('div', { key: 'p', className: 'text-overline text-on-surface-variant' },
              r.unico ? fmt(r.min) : fmt(r.min) + ' – ' + fmt(r.max)),
          ]);
        })),
      ]),

      h('div', { key: 'liq', className: 'bg-primary text-on-primary rounded-xl p-5 mb-5' }, [
        h('div', { key: 'a', className: 'flex justify-between text-body mb-1' }, [h('span', { key: 'l' }, 'Valor reconocido'), h('span', { key: 'v' }, fmt(valorReconocido))]),
        h('div', { key: 'b', className: 'flex justify-between text-body mb-1' }, [h('span', { key: 'l' }, 'Valor de lo que se lleva'), h('span', { key: 'v' }, fmt(valorEntregado))]),
        diferencia > 0 && h('div', { key: 'c', className: 'flex justify-between font-headline mt-3 pt-3 border-t border-white/20', style: { fontSize: '26px' } },
          [h('span', { key: 'l' }, 'A cobrar'), h('span', { key: 'v' }, fmt(diferencia))]),
        noAprovechado > 0 && h('div', { key: 'd', className: 'mt-3 pt-3 border-t border-white/20 text-caption' },
          'Sobrante de ' + fmt(noAprovechado) + ' · no se devuelve en efectivo ni queda a favor.'),
        h('div', { key: 'r', className: 'mt-4' }, [
          h('label', { key: 'l', className: 'block text-overline uppercase opacity-70 mb-1' }, 'Revisó la mercancía'),
          h('input', { key: 'i', value: revisor, placeholder: 'Nombre de quien revisó', onChange: e => setRevisor(e.target.value),
            className: 'w-full h-10 px-3 rounded-lg text-body bg-white/10 border border-white/20 text-on-primary' }),
        ]),
        h('div', { key: 'n', className: 'mt-3' }, [
          h('label', { key: 'l', className: 'block text-overline uppercase opacity-70 mb-1' }, 'Observaciones'),
          h('input', { key: 'i', value: notas, onChange: e => setNotas(e.target.value),
            className: 'w-full h-10 px-3 rounded-lg text-body bg-white/10 border border-white/20 text-on-primary' }),
        ]),
        h('button', { key: 'go', disabled: vencida, onClick: siguiente,
          className: 'w-full mt-5 py-3.5 bg-gold text-on-gold text-caption font-bold uppercase tracking-widest rounded-xl disabled:opacity-40' },
          diferencia > 0 ? 'Cobrar ' + fmt(diferencia) : 'Registrar cambio'),
      ]),
    ]);

    return h('div', { className: embedded ? '' : 'flex-1 overflow-y-auto bg-background font-body text-on-surface' }, [
      cuerpo,
      picking && h(ExchangeSizeModal, { key: 'sz', p: picking, onClose: () => setPicking(null), onPick: agregar }),
      cobro && h(window.CheckoutModal, {
        key: 'co', total: diferencia, itemCount: ent.reduce((a, l) => a + l.qty, 0),
        client: { generic: true, nombre: sale.cliente }, onClose: () => setCobro(false),
        onConfirm: (pago) => { setCobro(false); setVendedor({ metodo: (pago && pago.metodo) ? pago.metodo : 'Efectivo' }); },
      }),
      vendedor && h(SellerModal, {
        key: 'sv', sellers: elegibles, onClose: () => setVendedor(null),
        onPick: (id) => registrar(id, vendedor.metodo),
      }),
      recibo && h(ExchangeReceipt, { key: 'rc', recibo, onClose: () => { setRecibo(null); onDone(); } }),
      // Comprobante térmico: la MISMA autoridad del Punto de venta, con el cambio
      // como costura. Vive fuera de pantalla y sólo él queda visible al imprimir.
      recibo ? h(window.BalamTicket, { key: 'tk', sale: recibo.sale, payment: recibo.payment, exchange: recibo.exchange }) : null,
    ]);
  }

  // Selector de talla del cambio: mismo idioma que el POS, con el precio vigente
  // de cada talla (H-36) y sólo las que tienen existencias.
  function ExchangeSizeModal({ p, onClose, onPick }) {
    const conStock = (p.stock || []).filter(v => v.stock > 0);
    return h(window.UI.Modal, { title: 'Selecciona talla', onClose },
      h('div', { className: 'flex flex-wrap gap-2 py-2' }, conStock.length
        ? conStock.map(v => h('button', {
            key: v.talla, onClick: () => onPick(p, v.talla),
            className: 'flex flex-col items-center gap-0.5 min-w-[76px] px-3 py-2.5 border border-outline-variant hover:border-primary rounded-lg transition-colors',
          }, [
            h('span', { key: 't', className: 'font-semibold text-body text-primary' }, v.talla),
            h('span', { key: 'p', className: 'text-caption font-semibold text-gold-text' }, fmt(D.listPrice(p, v.talla))),
            h('span', { key: 's', className: 'text-caption text-muted' }, v.stock + ' pz'),
          ]))
        : h('p', { className: 'text-caption text-on-surface-variant' }, 'Sin existencias en ninguna talla.')));
  }

  // La comisión del excedente es del vendedor que atiende el cambio (Contrato §7),
  // así que se pide igual que el POS pide confirmar vendedor antes de registrar.
  function SellerModal({ sellers, onClose, onPick }) {
    return h(window.UI.Modal, { title: 'Vendedor que atiende el cambio', onClose },
      h('div', { className: 'grid grid-cols-2 gap-2 py-2' }, sellers.length
        ? sellers.map(v => h('button', {
            key: v.id, onClick: () => onPick(v.id),
            className: 'p-3 border border-outline-variant rounded-lg hover:border-primary text-left transition-colors',
          }, h('span', { className: 'text-body text-primary font-semibold' }, v.nombre)))
        : h('p', { className: 'text-caption text-on-surface-variant' }, 'No hay vendedores elegibles.')));
  }

  // Acuse en pantalla. El documento impreso lo arma window.BalamTicket.
  function ExchangeReceipt({ recibo, onClose }) {
    const ex = recibo.exchange;
    React.useEffect(() => {
      if (C.get('print.auto')) { const t = setTimeout(() => window.print(), 350); return () => clearTimeout(t); }
    }, []);
    return h(window.UI.Modal, {
      title: 'Cambio registrado', onClose,
      footer: [
        h('button', { key: 'p', className: 'flex-1 py-3.5 border border-outline-variant text-caption font-bold uppercase tracking-widest rounded-xl', onClick: () => window.print() }, 'Imprimir comprobante'),
        h('button', { key: 'n', className: 'flex-1 py-3.5 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-xl', onClick: onClose }, 'Listo'),
      ],
    }, h('div', { className: 'py-2 space-y-1 text-body' }, [
      h('div', { key: 'f' }, ['Cambio ', h('strong', { key: 'b' }, ex.folio)]),
      h('div', { key: 'o', className: 'text-caption text-on-surface-variant' }, 'Sobre la venta ' + ex.origenFolio),
      ex.diferencia > 0 && h('div', { key: 'd', className: 'text-caption' }, 'Diferencia cobrada · ' + fmt(ex.diferencia)),
      ex.valorNoAprovechado > 0 && h('div', { key: 'n', className: 'text-caption' }, 'Sobrante no aprovechado · ' + fmt(ex.valorNoAprovechado)),
    ]));
  }

  window.ReturnsScreen = ReturnsScreen;
})();
