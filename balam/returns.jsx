// returns.jsx — Pantalla de Devoluciones (Heritage). Replica el diseño de "Detalle de
// Devolución": elegir folio → seleccionar artículos (checkbox revela motivo + cantidad) →
// notas → resumen con total a reembolsar. Reingresa stock, revierte comisión (configurable)
// y marca la venta original. Todo se asienta en window.DATA y sincroniza a pos.returns.
// Exporta window.ReturnsScreen.
(function () {
  const { useState, useMemo } = React;
  const { toast, fmt, StatusBadge, Segment } = window.UI;
  const { MS, GlassCard, SerifHeading, ProductImage } = window.HX;
  const C = window.CONFIG;
  const D = window.DATA;
  const h = React.createElement;

  // C6: el TIPO DE OPERACIÓN se decide al inicio, sobre la venta ya localizada.
  // El flujo de Devoluciones queda intacto: `ReturnDetail` no cambia una línea.
  // El cambio vive en `ExchangeDetail`, que reutiliza las mismas autoridades.
  const OPERACIONES = [['devolucion', 'Devolución'], ['cambio', 'Cambio']];

  // H-44: la operación se declara ANTES de buscar y el equipo recuerda la
  // última. Un mostrador que atiende cinco cambios seguidos no vuelve a
  // declararlo cinco veces. Es preferencia del dispositivo, no dato del
  // negocio: vive en localStorage y su pérdida no cuesta nada.
  const OP_KEY = 'balam_ultima_operacion';
  const ultimaOperacion = () => {
    try { const v = localStorage.getItem(OP_KEY); return OPERACIONES.some(o => o[0] === v) ? v : 'devolucion'; }
    catch (e) { return 'devolucion'; }
  };
  const recordarOperacion = (v) => { try { localStorage.setItem(OP_KEY, v); } catch (e) {} };

  function ReturnsScreen() {
    const [folio, setFolio] = useState(null);
    const [tipo, setTipoRaw] = useState(ultimaOperacion);
    const setTipo = (v) => { setTipoRaw(v); recordarOperacion(v); };
    const [, bump] = useState(0);
    const refresh = () => bump(v => v + 1);
    // Al volver se conserva la operación declarada: el cajero sigue en lo suyo.
    const volver = () => setFolio(null);
    if (folio) {
      // Resuelve por folio vigente o por el folio impreso conservado como alias.
      const sale = D.findSaleByFolio ? D.findSaleByFolio(folio) : D.sales.find(s => s.folio === folio);
      if (!sale) { volver(); return null; }
      const done = () => { volver(); refresh(); };
      // Sigue disponible como CORRECCIÓN: la declaración primaria ya ocurrió en
      // el buscador, pero equivocarse de operación no puede obligar a empezar.
      const selector = h('div', { key: 'op', className: 'max-w-[1100px] mx-auto px-6 pt-6' }, [
        h('div', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-2' }, 'Tipo de operación'),
        h(Segment, { key: 's', options: OPERACIONES, value: tipo, onChange: setTipo, testid: 'operacion-detalle' }),
      ]);
      // El contenedor NO scrollea: cada detalle trae el suyo. Anidar dos
      // 'overflow-y-auto' rompia el desplazamiento de Devoluciones, que debe
      // quedar exactamente como estaba.
      return h('div', { className: 'flex-1 flex flex-col overflow-hidden bg-background font-body text-on-surface' }, [
        h('div', { key: 'sel', className: 'shrink-0 bg-background' }, selector),
        tipo === 'cambio'
          ? h(ExchangeDetail, { key: 'cd', sale, onBack: volver, onDone: done, embedded: true })
          : h(ReturnDetail, { key: 'rd', sale, onBack: volver, onDone: done, embedded: true }),
      ]);
    }
    return h(ReturnPicker, { onPick: setFolio, tipo, onTipo: setTipo });
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
  function ReturnPicker({ onPick, tipo, onTipo }) {
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
            // H-44: primero se declara QUÉ se va a hacer; después se busca la
            // venta. El orden importa porque el resto de la pantalla habla ya
            // en el idioma de la operación elegida.
            h('div', { key: 'op', className: 'mb-4 pb-4 border-b border-outline-variant' }, [
              h('div', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-2' }, 'Qué vas a registrar'),
              h(Segment, { key: 's', options: OPERACIONES, value: tipo, onChange: onTipo, testid: 'operacion' }),
              h('p', { key: 'h', className: 'text-caption text-on-surface-variant mt-2' },
                tipo === 'cambio'
                  ? 'El cliente entrega mercancía y se lleva otra. No se devuelve efectivo.'
                  : 'Se reembolsa la mercancía que el cliente entrega.'),
            ]),
            h('div', { key: 'l', className: 'flex items-center gap-2 mb-3 text-on-surface-variant' }, [
              h(MS, { key: 'i', name: tipo === 'cambio' ? 'repeat' : 'undo', size: 18 }),
              h(SerifHeading, { key: 't', children: tipo === 'cambio' ? 'Selecciona la venta a cambiar' : 'Selecciona la venta a devolver' }),
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
  // Reutiliza el LENGUAJE del Punto de venta (R-CLI-08): catálogo a la izquierda,
  // panel de resumen a la derecha, renglones con imagen + cantidad ± + papelera,
  // pie navy con el desglose y lectura de código de barras idéntica.
  //
  // Consume autoridades y no reimplementa reglas:
  //   saleLineBalance · recognizedValue · listPrice/priceRange · returnDeadline
  //   recordExchange (única vía de registro) · CheckoutModal · BalamTicket
  function ExchangeDetail({ sale, onBack, onDone, embedded }) {
    const [dev, setDev] = useState({});
    const [ent, setEnt] = useState([]);
    const [picking, setPicking] = useState(null);
    const [query, setQuery] = useState('');
    const [flash, setFlash] = useState(null);
    const [notas, setNotas] = useState('');
    const [cobro, setCobro] = useState(false);
    const [recibo, setRecibo] = useState(null);
    const [vendedor, setVendedor] = useState(null);
    const [aviso, setAviso] = useState(null);
    const scanRef = React.useRef(null);
    const refDev = React.useRef(null), refCat = React.useRef(null), refDatos = React.useRef(null);
    const reasons = C.list('return_reason');
    // H-44 · Preselección VISIBLE, nunca silenciosa. El motivo abrumadoramente
    // más frecuente del cambio es la talla, así que llega marcado en el propio
    // desplegable: el cajero lo LEE y lo corrige con un toque. Preseleccionar no
    // es decidir por él; es no obligarle a repetir lo de siempre.
    const motivoDefault = ((reasons.find(x => /talla/i.test(x.label || x.code)) || reasons[0]) || {}).code || '';
    const CONDICIONES = ['Sin uso, con etiqueta', 'Sin uso, sin etiqueta', 'Usada, en buen estado', 'Con detalle'];
    // Quien revisó es, por defecto, quien tiene la sesión abierta. Sigue siendo
    // un campo de texto editable: revisar y cobrar pueden ser dos personas.
    const sesion = (window.AUTH && window.AUTH.current && window.AUTH.current()) || {};
    const [revisor, setRevisor] = useState(sesion.nombre || sesion.email || '');
    const plazo = deadlineOf(sale);
    const vencida = plazo.status === 'vencido';
    const elegibles = D.sellers.filter(v => (D.isEligibleSeller ? D.isEligibleSeller(v) : v.active));

    const saldo = (D.saleLineBalance ? D.saleLineBalance(sale.folio) : [])
      .filter(r => r.disponible > 0)
      .map(r => Object.assign({}, r, {
        k: r.sku + '|' + r.talla,
        p: D.products.find(x => x.sku === r.sku),
        nombre: ((sale.lineas || []).find(l => l.sku === r.sku && l.talla === r.talla) || {}).nombre || r.sku,
        valor: D.recognizedValue ? D.recognizedValue(sale.folio, r.sku, r.talla) : 0,
      }));
    // La preselección se aplica al ABRIR el renglón y nunca pisa lo ya escrito:
    // el `patch` y el estado previo mandan sobre los valores por defecto.
    const setRow = (k, patch) => setDev(p => Object.assign({}, p, {
      [k]: Object.assign({ on: true, qty: 1, motivo: motivoDefault, condicion: CONDICIONES[0] }, p[k], patch),
    }));
    const quitarDev = (k) => setDev(p => { const c = Object.assign({}, p); delete c[k]; return c; });
    const marcados = saldo.filter(r => dev[r.k] && dev[r.k].on);

    const valorReconocido = marcados.reduce((a, r) => a + r.valor * (dev[r.k].qty || 1), 0);
    const valorEntregado = ent.reduce((a, l) => a + D.listPrice(l.p, l.talla) * l.qty, 0);
    const diferencia = Math.max(0, Math.round((valorEntregado - valorReconocido) * 100) / 100);
    const noAprovechado = Math.max(0, Math.round((valorReconocido - valorEntregado) * 100) / 100);
    // Mismo desglose que el POS: importe e IVA describen lo que se cobra.
    const ivaPct = 16;
    const importe = Math.round((diferencia / (1 + ivaPct / 100)) * 100) / 100;
    const ivaMonto = Math.round((diferencia - importe) * 100) / 100;

    const catalogo = useMemo(() => {
      const t = query.trim().toLowerCase();
      return D.products.filter(p => !p._deletedAt && (!t
        || String(p.nombre).toLowerCase().includes(t) || String(p.sku).toLowerCase().includes(t)))
        .slice(0, 24);
    }, [query]);

    function flashLine(key) { setFlash(key); setTimeout(() => setFlash(k => (k === key ? null : k)), 900); }
    function agregar(p, talla) {
      setPicking(null);
      setEnt(prev => {
        const i = prev.findIndex(l => l.p.id === p.id && l.talla === talla);
        if (i >= 0) { const c = prev.slice(); c[i] = Object.assign({}, c[i], { qty: c[i].qty + 1 }); return c; }
        return prev.concat([{ key: p.id + '-' + talla, p, talla, qty: 1 }]);
      });
      flashLine(p.id + '-' + talla);
    }
    const entQty = (key, d) => setEnt(prev => prev.map(l => l.key === key ? Object.assign({}, l, { qty: Math.max(1, l.qty + d) }) : l));
    const entQuitar = (key) => setEnt(prev => prev.filter(l => l.key !== key));

    // Lectura de código de barras: mismo comportamiento que el Punto de venta.
    function onScan(e) {
      if (e.key !== 'Enter') return;
      const raw = String((e.target && e.target.value != null) ? e.target.value : query).trim();
      if (!raw) return;
      const hit = window.BARCODES && window.BARCODES.find(raw);
      if (hit) { agregar(hit.p, hit.talla); setQuery(''); return; }
      const q = raw.toLowerCase();
      const exact = D.products.find(p => String(p.sku).toLowerCase() === q);
      const target = exact || catalogo[0];
      if (target) { setPicking(target); setQuery(''); return; }
      const looksCode = window.BARCODES && window.BARCODES.parse(raw);
      toast(looksCode ? ('Código no encontrado: ' + raw.toUpperCase()) : ('Sin coincidencias para "' + raw + '"'), 'var(--danger)');
    }
    // Lector USB (HID) con captura global, igual que el POS: distingue el lector
    // del tecleo humano por la cadencia entre teclas.
    const scanRT = React.useRef({});
    scanRT.current = { agregar, scanEl: scanRef.current, blocked: !!(picking || cobro || vendedor || recibo || aviso) };
    React.useEffect(() => {
      let buf = '', lt = 0;
      function onKey(e) {
        const st = scanRT.current;
        if (document.activeElement === st.scanEl) return;
        if (e.key === 'Enter') {
          const code = buf; buf = '';
          if (st.blocked || code.length < 4) return;
          const hit = window.BARCODES && window.BARCODES.find(code);
          if (!hit) return;
          e.preventDefault();
          st.agregar(hit.p, hit.talla);
          return;
        }
        if (e.key && e.key.length === 1) {
          const now = Date.now();
          if (now - lt > 50) buf = '';
          buf += e.key; lt = now;
        }
      }
      document.addEventListener('keydown', onKey, true);
      return () => document.removeEventListener('keydown', onKey, true);
    }, []);

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
    // H-44 · El botón principal GUÍA: nunca es un callejón sin salida. Declara
    // qué falta y lleva hasta ahí. `validar()` sigue siendo la única autoridad
    // que decide si se registra: la guía informa, no autoriza.
    const faltaMotivo = marcados.find(r => !dev[r.k].motivo);
    const faltaRevision = marcados.find(r => !String(dev[r.k].condicion || '').trim());
    const guia = vencida ? { txt: 'Fuera de plazo', icon: 'alert', foco: null }
      : !marcados.length ? { txt: 'Marca lo que entrega', icon: 'undo', foco: refDev }
      : !ent.length ? { txt: 'Elige lo que se lleva', icon: 'search', foco: refCat }
      : faltaMotivo ? { txt: 'Falta el motivo', icon: 'alert', foco: refDev }
      : faltaRevision ? { txt: 'Falta la revisión de la prenda', icon: 'alert', foco: refDev }
      : !String(revisor).trim() ? { txt: 'Falta quién revisó', icon: 'alert', foco: refDatos }
      : null;
    function siguiente() {
      if (!validar()) {
        if (guia && guia.foco && guia.foco.current) guia.foco.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (diferencia > 0) { setCobro(true); return; }
      if (noAprovechado > 0) {
        // Modal del sistema, no `window.confirm`: el navegador no sabe pintar
        // una cifra ni distinguir la acción destructiva de la que sigue.
        setAviso({
          titulo: 'El cliente pierde ' + fmt(noAprovechado),
          cuerpo: 'Se lleva ' + fmt(noAprovechado) + ' menos de lo que entrega. Ese saldo NO se devuelve en efectivo y NO queda a favor del cliente: se pierde.',
          onSi: () => { setAviso(null); setVendedor({ metodo: null }); },
        });
        return;
      }
      setVendedor({ metodo: null });
    }
    function registrar(sellerId, metodo) {
      const lineas = marcados.map(r => ({
        lado: 'devuelto', sku: r.sku, nombre: r.nombre, talla: r.talla,
        qty: dev[r.k].qty || 1, motivo: dev[r.k].motivo, condicion: dev[r.k].condicion,
        productId: r.p ? r.p.id : undefined,
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

    // ── Renglón del panel: mismo lenguaje que el ticket del POS ───────────────
    function Renglon({ img, nombre, talla, qty, importe: imp, onMenos, onMas, onQuitar, destacado }) {
      return h('div', { className: 'flex gap-3 rounded-lg transition-all duration-500 ' + (destacado ? 'ring-2 ring-success bg-success-soft/50 -mx-2 px-2 py-1' : '') }, [
        img ? h(ProductImage, { key: 't', p: img, className: 'w-11 h-14 shrink-0 rounded-lg ring-1 ring-outline-variant/50' })
            : h('div', { key: 't', className: 'w-11 h-14 shrink-0 rounded-lg bg-surface-container grid place-items-center' }, h(MS, { name: 'shirt', size: 18, className: 'text-on-surface-variant/40' })),
        h('div', { key: 'i', className: 'flex-1 min-w-0 flex flex-col' }, [
          h('div', { key: 'top', className: 'flex justify-between items-start mb-1' }, [
            h('h4', { key: 'n', className: 'text-body-strong text-primary truncate pr-3' }, nombre),
            h('button', { key: 'x', title: 'Quitar', 'data-testid': 'cambio-quitar', onClick: onQuitar,
              className: 'text-on-surface-variant hover:text-danger transition-colors shrink-0' }, h(MS, { name: 'trash', size: 18 })),
          ]),
          h('p', { key: 'sz', className: 'text-overline uppercase text-on-surface-variant' }, 'Talla ' + talla),
          h('div', { key: 'm', className: 'mt-auto pt-1.5 flex justify-between items-center' }, [
            h('div', { key: 'q', className: 'flex items-center bg-surface-container-low border border-outline-variant rounded-md overflow-hidden' }, [
              h('button', { key: 'a', className: 'w-7 h-7 flex items-center justify-center hover:bg-surface transition-colors', onClick: onMenos }, h(MS, { name: 'minus', size: 16 })),
              h('span', { key: 'n', className: 'w-8 text-center text-caption font-bold border-x border-outline-variant bg-surface py-1' }, qty),
              h('button', { key: 'b', className: 'w-7 h-7 flex items-center justify-center hover:bg-surface transition-colors', onClick: onMas }, h(MS, { name: 'plus', size: 16 })),
            ]),
            h('span', { key: 's', className: 'font-headline text-body text-primary' }, fmt(imp)),
          ]),
        ]),
      ]);
    }
    const vacio = (icono, titulo, pista) => h('div', { className: 'flex flex-col items-center justify-center gap-2 py-6 text-on-surface-variant' }, [
      h(MS, { key: 'i', name: icono, size: 28, className: 'text-on-surface-variant/40' }),
      h('div', { key: 't', className: 'text-caption font-semibold text-primary' }, titulo),
      h('div', { key: 's', className: 'text-caption text-center' }, pista),
    ]);

    // ── Panel: Resumen del cambio ─────────────────────────────────────────────
    const panel = h('aside', { 'data-testid': 'cambio-panel', className: 'bg-surface-container-lowest rounded-xl shadow-e3 flex flex-col overflow-hidden shrink-0 w-[clamp(340px,32vw,460px)]' }, [
      h('div', { key: 'hd', className: 'p-4 border-b border-outline-variant bg-surface' }, [
        h('span', { key: 'l', className: 'text-overline uppercase text-on-surface-variant' }, 'Resumen del cambio'),
        h('div', { key: 'f', className: 'text-caption text-on-surface-variant mt-0.5' }, 'Venta ' + sale.folio),
      ]),
      h('div', { key: 'body', className: 'flex-1 overflow-y-auto no-scrollbar px-5 py-3' }, [
        h('div', { key: 'he', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-2' }, 'Entrega'),
        marcados.length
          ? h('div', { key: 'de', className: 'space-y-2 mb-4' }, marcados.map(r => h(Renglon, {
              key: r.k, img: r.p, nombre: r.nombre, talla: r.talla, qty: dev[r.k].qty || 1,
              importe: r.valor * (dev[r.k].qty || 1),
              onMenos: () => setRow(r.k, { qty: Math.max(1, (dev[r.k].qty || 1) - 1) }),
              onMas: () => setRow(r.k, { qty: Math.min(r.disponible, (dev[r.k].qty || 1) + 1) }),
              onQuitar: () => quitarDev(r.k),
            })))
          : h('div', { key: 've' }, vacio('undo', 'Sin mercancía marcada', 'Marca abajo lo que el cliente regresa')),
        h('div', { key: 'hr', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-2 pt-2 border-t border-outline-variant' }, 'Recibe'),
        ent.length
          ? h('div', { key: 'dr', className: 'space-y-2' }, ent.map(l => h(Renglon, {
              key: l.key, img: l.p, nombre: l.p.nombre, talla: l.talla, qty: l.qty,
              importe: D.listPrice(l.p, l.talla) * l.qty, destacado: flash === l.key,
              onMenos: () => entQty(l.key, -1), onMas: () => entQty(l.key, 1),
              onQuitar: () => entQuitar(l.key),
            })))
          : h('div', { key: 'vr' }, vacio('shopping_cart_checkout', 'Sin mercancía elegida', 'Escanea o toca un producto para empezar')),
      ]),
      h('div', { key: 'foot', className: 'px-5 py-4 bg-primary text-on-primary' }, [
        h('div', { key: 'rows', className: 'space-y-1.5 mb-2' }, [
          h('div', { key: 'vr', className: 'flex justify-between text-caption opacity-70' }, [h('span', { key: 'l' }, 'Valor reconocido'), h('span', { key: 'v', className: 'font-medium' }, fmt(valorReconocido))]),
          h('div', { key: 've', className: 'flex justify-between text-caption opacity-70' }, [h('span', { key: 'l' }, 'Valor de lo que recibe'), h('span', { key: 'v', className: 'font-medium' }, fmt(valorEntregado))]),
          diferencia > 0 ? h('div', { key: 'im', className: 'flex justify-between text-caption opacity-70' }, [h('span', { key: 'l' }, 'Importe'), h('span', { key: 'v', className: 'font-medium' }, fmt(importe))]) : null,
          diferencia > 0 ? h('div', { key: 'iv', className: 'flex justify-between text-caption opacity-70' }, [h('span', { key: 'l' }, 'IVA (' + ivaPct + '%)'), h('span', { key: 'v', className: 'font-medium' }, fmt(ivaMonto))]) : null,
        ]),
        noAprovechado > 0
          ? h('div', { key: 'na', className: 'mb-3' }, [
              h('div', { key: 'r', className: 'flex justify-between items-end' }, [
                h('span', { key: 'l', className: 'text-overline uppercase opacity-60' }, 'Valor no aprovechado'),
                h('span', { key: 'v', className: 'font-headline text-h1 tracking-tight leading-none', style: { color: '#FFE088' } }, fmt(noAprovechado)),
              ]),
              h('div', { key: 'a', className: 'text-caption mt-1 opacity-80' }, 'No se devuelve en efectivo ni queda a favor del cliente.'),
            ])
          : h('div', { key: 'tt', className: 'flex justify-between items-end mb-3' }, [
              h('span', { key: 'l', className: 'text-overline uppercase opacity-60' }, diferencia > 0 ? 'Diferencia a cobrar' : 'Sin diferencia'),
              h('span', { key: 'v', className: 'font-headline text-h1 tracking-tight leading-none' }, fmt(diferencia)),
            ]),
        // Sólo el plazo vencido lo deshabilita, porque ahí no hay nada que
        // guiar: la venta ya no admite posventa. En cualquier otro estado el
        // botón responde y dice qué falta (H-44).
        h('button', { key: 'go', 'data-testid': 'cambio-accion', disabled: vencida, onClick: siguiente,
          className: 'w-full py-3 rounded-lg text-caption font-bold uppercase tracking-wider shadow-e2 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed '
            + (guia ? 'bg-surface/60 text-primary' : 'bg-surface text-primary') },
          [h(MS, { key: 'i', name: guia ? guia.icon : (diferencia > 0 ? 'shopping_cart_checkout' : 'check'), size: 18 }),
           guia ? guia.txt : (diferencia > 0 ? 'Cobrar ' + fmt(diferencia) : 'Registrar cambio')]),
      ]),
    ]);

    // ── Columna de trabajo ────────────────────────────────────────────────────
    const trabajo = h('div', { className: 'flex-1 min-w-0 flex flex-col gap-5 overflow-y-auto no-scrollbar pr-2 -mr-2' }, [
      h('div', { key: 'bc', className: 'flex items-center gap-3' }, [
        h('button', { key: 'b', className: 'inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors', onClick: onBack },
          [h(MS, { key: 'i', name: 'chevLeft', size: 18 }), h('span', { key: 't', className: 'text-overline uppercase tracking-widest font-semibold' }, 'Devoluciones')]),
        h(DeadlineTag, { key: 'dl', sale }),
      ]),
      vencida && h('div', { key: 'exp', className: 'p-3 rounded-lg text-caption bg-surface-container' },
        'Fuera de plazo: esta venta admitía posventa hasta ' + (plazo.expiresAt || '—') + '. Un administrador debe ajustar el plazo en Configuración → Devoluciones.'),

      h('div', { key: 'dev', ref: refDev, className: 'bg-surface-container-lowest rounded-xl border border-outline-variant p-5' }, [
        h('div', { key: 't', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-3' }, 'Marca lo que el cliente entrega'),
        !saldo.length && h('p', { key: 'v', className: 'text-caption text-on-surface-variant' }, 'Esta venta ya no tiene piezas disponibles.'),
        ...saldo.map(r => {
          const st = dev[r.k] || {};
          return h('div', { key: r.k, className: 'py-3 border-b border-outline-variant last:border-0' }, [
            h('label', { key: 'h', className: 'flex items-center gap-3 cursor-pointer' }, [
              h('input', { key: 'c', type: 'checkbox', checked: !!st.on, className: 'w-5 h-5 rounded border-outline text-primary',
                onChange: e => (e.target.checked ? setRow(r.k, { on: true }) : quitarDev(r.k)) }),
              h('div', { key: 'n', className: 'flex-1 min-w-0' }, [
                h('div', { key: 'a', className: 'text-body text-primary font-semibold truncate' }, r.nombre),
                h('div', { key: 'b', className: 'text-overline uppercase text-on-surface-variant' },
                  'Talla ' + r.talla + ' · ' + r.disponible + ' disponible(s) · se reconoce ' + fmt(r.valor)),
              ]),
            ]),
            // H-45 · Camino rápido: el cambio de talla es el caso abrumadoramente
            // más frecuente, y hasta ahora obligaba a BUSCAR en el catálogo la
            // prenda que el cliente tiene en la mano. Este botón no trae lógica
            // propia: abre el MISMO selector de tallas que usa el catálogo, con
            // el precio vigente de cada talla (H-36) y sólo las que tienen
            // existencias. Se ofrece todas, incluida la misma que se devuelve,
            // porque un cambio por defecto de fábrica es la misma talla.
            st.on && r.p && h('div', { key: 'rapido', className: 'mt-3 pl-8' }, [
              h('button', {
                key: 'b', 'data-testid': 'cambio-misma-prenda', onClick: () => setPicking(r.p),
                className: 'inline-flex items-center gap-2 px-4 h-10 rounded-lg border border-primary text-primary '
                  + 'text-caption font-bold uppercase tracking-wider hover:bg-surface-container transition-colors',
              }, [h(MS, { key: 'i', name: 'repeat', size: 16 }), 'Misma prenda, otra talla']),
              h('span', { key: 'h', className: 'ml-3 text-caption text-on-surface-variant' },
                'Sin buscarla en el catálogo'),
            ]),
            st.on && h('div', { key: 'd', className: 'mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 pl-8' }, [
              h('div', { key: 'm' }, [
                h('label', { key: 'l', className: 'block text-overline uppercase text-on-surface-variant mb-1' }, 'Motivo'),
                h('select', { key: 's', value: st.motivo || '', 'data-testid': 'cambio-motivo',
                  className: 'w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg text-body',
                  onChange: e => setRow(r.k, { motivo: e.target.value }) },
                  [h('option', { key: '_', value: '', disabled: true }, 'Selecciona…')].concat(reasons.map(x => h('option', { key: x.code, value: x.code }, x.label)))),
              ]),
              h('div', { key: 'r' }, [
                h('label', { key: 'l', className: 'block text-overline uppercase text-on-surface-variant mb-1' }, 'Condición de la prenda'),
                h('input', { key: 'i', value: st.condicion || '', placeholder: 'Excelente · sin uso, con etiqueta…',
                  'data-testid': 'cambio-condicion',
                  className: 'w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg text-body',
                  onChange: e => setRow(r.k, { condicion: e.target.value }) }),
                // Acciones rápidas: los cuatro dictámenes que se escriben el 95%
                // de las veces. Siguen siendo texto libre; esto sólo ahorra
                // teclearlo, y deja ver cuál quedó registrado.
                h('div', { key: 'q', className: 'flex flex-wrap gap-1.5 mt-2' }, CONDICIONES.map(c => h('button', {
                  key: c, 'data-testid': 'cambio-condicion-rapida', onClick: () => setRow(r.k, { condicion: c }),
                  className: 'px-2.5 py-1 rounded-full text-overline uppercase border transition-colors '
                    + (st.condicion === c ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant text-on-surface-variant hover:border-primary'),
                }, c))),
              ]),
            ]),
          ]);
        }),
      ]),

      h('div', { key: 'cat', ref: refCat, className: 'bg-surface-container-lowest rounded-xl border border-outline-variant p-5' }, [
        h('div', { key: 't', className: 'flex items-center gap-3 mb-3' }, [
          h('span', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant shrink-0' }, 'Elige lo que se lleva'),
          h('input', { key: 'q', ref: scanRef, 'data-testid': 'cambio-escaner', value: query, onKeyDown: onScan, onChange: e => setQuery(e.target.value),
            placeholder: 'Escanea el código de barras o busca por nombre / SKU…',
            className: 'flex-1 h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg text-body focus:ring-1 focus:ring-primary' }),
        ]),
        h('div', { key: 'g', className: 'grid grid-cols-2 md:grid-cols-4 gap-2' }, catalogo.map(p => {
          const r = D.priceRange(p);
          return h('button', { key: p.id, onClick: () => setPicking(p),
            className: 'text-left p-3 border border-outline-variant rounded-lg hover:border-primary transition-colors' }, [
            h('div', { key: 'n', className: 'text-caption text-primary font-semibold truncate' }, p.nombre),
            h('div', { key: 'p', className: 'text-overline text-on-surface-variant' }, r.unico ? fmt(r.min) : fmt(r.min) + ' – ' + fmt(r.max)),
          ]);
        })),
      ]),

      h('div', { key: 'datos', ref: refDatos, className: 'bg-surface-container-lowest rounded-xl border border-outline-variant p-5' }, [
        h('div', { key: 't', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-3' }, 'Datos del cambio'),
        h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-2 gap-3' }, [
          h('div', { key: 'r' }, [
            h('label', { key: 'l', className: 'block text-overline uppercase text-on-surface-variant mb-1' }, 'Revisó la mercancía'),
            h('input', { key: 'i', value: revisor, placeholder: 'Nombre de quien revisó', 'data-testid': 'cambio-revisor', onChange: e => setRevisor(e.target.value),
              className: 'w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg text-body' }),
          ]),
          h('div', { key: 'n' }, [
            h('label', { key: 'l', className: 'block text-overline uppercase text-on-surface-variant mb-1' }, 'Observaciones'),
            h('input', { key: 'i', value: notas, onChange: e => setNotas(e.target.value),
              className: 'w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg text-body' }),
          ]),
        ]),
      ]),
    ]);

    return h('div', { className: (embedded ? 'flex-1 min-h-0 ' : 'flex-1 min-h-0 ') + 'bg-background font-body text-on-surface p-6 flex gap-6' }, [
      trabajo,
      panel,
      picking && h(ExchangeSizeModal, { key: 'sz', p: picking, onClose: () => setPicking(null), onPick: agregar }),
      cobro && h(window.CheckoutModal, {
        key: 'co', total: diferencia, itemCount: ent.reduce((a, l) => a + l.qty, 0),
        client: { generic: true, nombre: sale.cliente }, onClose: () => setCobro(false),
        onConfirm: (pago) => { setCobro(false); setVendedor({ metodo: (pago && pago.metodo) ? pago.metodo : 'Efectivo' }); },
      }),
      // El aviso del sobrante perdido es del sistema, no del navegador: se ve
      // la cifra, se distingue la acción que sigue de la que vuelve, y la
      // pantalla no se congela mientras el cajero decide.
      aviso && h(window.UI.Modal, {
        key: 'av', title: aviso.titulo, onClose: () => setAviso(null),
        footer: [
          h('button', { key: 'n', 'data-testid': 'cambio-aviso-revisar', onClick: () => setAviso(null),
            className: 'flex-1 py-3.5 border border-outline-variant text-caption font-bold uppercase tracking-widest rounded-xl' }, 'Revisar'),
          h('button', { key: 's', 'data-testid': 'cambio-aviso-confirmar', onClick: aviso.onSi,
            className: 'flex-1 py-3.5 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-xl' }, 'Sí, registrar'),
        ],
      }, h('p', { className: 'py-2 text-body text-on-surface' }, aviso.cuerpo)),
      vendedor && h(SellerModal, { key: 'sv', sellers: elegibles, onClose: () => setVendedor(null), onPick: (id) => registrar(id, vendedor.metodo) }),
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
            key: v.id, 'data-testid': 'cambio-vendedor', onClick: () => onPick(v.id),
            className: 'p-3 border border-outline-variant rounded-lg hover:border-primary text-left transition-colors',
          }, h('span', { className: 'text-body text-primary font-semibold' }, v.nombre)))
        : h('p', { className: 'text-caption text-on-surface-variant' }, 'No hay vendedores elegibles.')));
  }

  // Acuse en pantalla + impresión automática. El documento lo arma BalamTicket.
  function ExchangeReceipt({ recibo, onClose }) {
    const ex = recibo.exchange;
    React.useEffect(() => { const t = setTimeout(() => window.print(), 350); return () => clearTimeout(t); }, []);
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
