// sellers.jsx — Vendedores y comisiones (Heritage Luxury). Exporta window.SellersScreen
//
// H-69: esta pantalla ya NO calcula comisión. Pregunta.
// `DATA.commissionLedger()` recorre la evidencia congelada —ventas, cambios,
// devoluciones, cancelaciones y liquidaciones— y devuelve el recorrido de cada
// vendedor. Reportes y el XLSX consumen la misma función, así que los tres
// muestran exactamente los mismos números (`R-DOM-01`).
(function () {
  const { useState } = React;
  const { fmt, Modal, toast } = window.UI;
  const { MS } = window.HX;
  const D = window.DATA;
  const h = React.createElement;
  const SHADOW = 'shadow-e1';
  const SHADOW_HOVER = 'hover:shadow-e2';

  // Nivel comercial: manda el nivel ASIGNADO en el perfil. El umbral `minPct`
  // sigue existiendo como etiqueta para los perfiles que nunca tuvieron
  // asignación, pero ya no decide el porcentaje: eso lo hace la autoridad.
  const role = (s) => {
    const policy = D.resolveSellerCommission(s);
    if (policy.level && policy.level.label) return policy.level.label;
    const roles = window.CONFIG.list('seller_role')
      .map(r => ({ label: r.label, min: (r.meta && r.meta.minPct) || 0 }))
      .sort((a, b) => b.min - a.min);
    const hit = roles.find(r => policy.effectivePct >= r.min);
    return hit ? hit.label : (roles.length ? roles[roles.length - 1].label : '—');
  };

  const metaPct = (s, ventas) => (Number(s.metaMes) > 0 ? Math.round((ventas / s.metaMes) * 100) : 0);
  const metaHit = (s, ventas) => Number(s.metaMes) > 0 && ventas >= s.metaMes;
  const periodoLabel = () => {
    const ini = D.getPeriodoInicio && D.getPeriodoInicio();
    if (!ini) return 'Acumulado histórico';
    return 'Periodo desde ' + new Date(ini + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
  };

  // Fila del periodo vigente para un vendedor. Si todavía no generó nada, se
  // devuelve una fila en cero con su identidad: la pantalla nunca inventa datos
  // pero tampoco esconde a alguien por no haber vendido.
  function ledgerRow(ledger, seller) {
    const hit = ledger.find(r => r.vendedorId === seller.id);
    return hit || {
      vendedorId: seller.id, vendedor: seller.nombre, ventas: 0, cambios: 0,
      revertido: 0, liquidado: 0, base: 0, importeVendido: 0, pedidos: 0,
      generado: 0, neto: 0, pendiente: 0, total: 0, repartoEstimado: false,
      acumuladoVigente: Number(seller.comisionAcum) || 0,
      descuadre: Number(seller.comisionAcum) || 0,
    };
  }

  function SellerAvatar({ s, className, fallbackClassName, fallbackStyle }) {
    return s.avatar
      ? h('img', { src: s.avatar, alt: s.nombre, className: className + ' object-cover' })
      : h('span', { className: className + ' ' + (fallbackClassName || ''), style: fallbackStyle || { background: s.color } }, s.iniciales);
  }

  function SellersScreen() {
    const [detail, setDetail] = useState(null);
    const [view, setView] = useState('grid');
    const [ajuste, setAjuste] = useState(false);
    const [, bump] = useState(0);
    window.UI.useSyncActivity(!!ajuste, ['sellers','liquidations','sales','returns','exchanges'], { screen: 'sellers' });
    const refresh = () => bump(v => v + 1);
    const eligibleSellers = D.sellers.filter(D.isEligibleSeller);
    const periodo = D.currentPeriodPredicate();
    const ledger = D.commissionLedger(periodo);
    const filas = eligibleSellers.map(s => ({ s, row: ledgerRow(ledger, s) }));
    const totalComision = filas.reduce((a, x) => a + x.row.pendiente, 0);
    const totalVentas = filas.reduce((a, x) => a + x.row.importeVendido, 0);
    const descuadres = filas.filter(x => x.row.descuadre != null && Math.abs(x.row.descuadre) >= 0.01);

    function liquidar(s) {
      const row = ledgerRow(ledger, s);
      if (!window.confirm('¿Liquidar la comisión acumulada de ' + s.nombre + ' (' + fmt(row.pendiente) + ')? Quedará en cero.')) return;
      const monto = D.liquidarComision(s.id);
      setDetail(null); refresh();
      toast('Comisión de ' + s.nombre + ' liquidada: ' + fmt(monto || 0), 'var(--accent)');
    }
    function cerrarMes() {
      if (!window.confirm('¿Cerrar el periodo?\nSe pagará la comisión pendiente de TODOS los vendedores (' + fmt(totalComision) + ') y arrancará un periodo nuevo. Las ventas y las comisiones ya generadas NO se borran: siguen en el reporte.')) return;
      const r = D.cerrarMes();
      setDetail(null); refresh();
      toast('Periodo cerrado · ' + fmt(r.total) + ' liquidados a ' + r.vendedores + ' vendedor(es)', 'var(--accent)');
    }
    function exportar() {
      window.XLSXIO.exportSellers(D.sellers.map(s => {
        const row = ledgerRow(ledger, s);
        const policy = D.resolveSellerCommission(s);
        return {
          nombre: s.nombre, rol: role(s), pct: policy.effectivePct,
          origen: D.commissionSourceLabel(policy.source),
          ventas: Math.round(row.importeVendido), base: Math.round(row.base * 100) / 100,
          meta: Math.round(s.metaMes || 0), avance: metaPct(s, row.importeVendido),
          generado: Math.round(row.generado * 100) / 100,
          revertido: Math.round(row.revertido * 100) / 100,
          liquidado: Math.round(row.liquidado * 100) / 100,
          comision: Math.round(row.pendiente * 100) / 100,
          estado: s.active === false ? 'Inactivo' : 'Activo',
        };
      }));
    }

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'p-10 max-w-container-max mx-auto' }, [
        h('section', { key: 'hd', className: 'flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6' }, [
          h('div', { key: 'l' }, [
            h('h2', { key: 't', className: 'font-headline text-headline-lg text-primary' }, 'Vendedores y comisiones'),
            h('p', { key: 'd', className: 'text-on-surface-variant mt-2 max-w-2xl text-body' }, 'Visualización de rendimiento individual y métricas del equipo Heritage. Gestiona los incentivos basados en la excelencia del servicio.'),
          ]),
          h('div', { key: 'r', className: 'flex items-center gap-3' }, [
            h('button', { key: 'aj', 'data-testid': 'commission-adjustment-open', className: 'flex items-center gap-2 px-6 py-2.5 bg-surface border border-outline-variant text-primary hover:border-primary transition-colors rounded-lg', onClick: () => setAjuste(true) }, [h(MS, { key: 'i', name: 'receipt', size: 18 }), h('span', { key: 's', className: 'text-overline font-bold uppercase tracking-widest' }, 'Ajuste histórico')]),
            h('button', { key: 'rep', 'data-testid': 'commission-export', className: 'flex items-center gap-2 px-6 py-2.5 bg-surface border border-outline-variant text-primary hover:border-primary transition-colors rounded-lg', onClick: exportar }, [h(MS, { key: 'i', name: 'download', size: 18 }), h('span', { key: 's', className: 'text-overline font-bold uppercase tracking-widest' }, 'Reporte mensual')]),
            h('button', { key: 'cm', 'data-testid': 'commission-close-period', className: 'flex items-center gap-2 px-6 py-2.5 bg-primary text-on-primary hover:opacity-90 transition-opacity rounded-lg disabled:opacity-40 disabled:cursor-not-allowed', disabled: !(totalComision > 0), onClick: cerrarMes }, [h(MS, { key: 'i', name: 'cash', size: 18 }), h('span', { key: 's', className: 'text-overline font-bold uppercase tracking-widest' }, 'Cerrar mes')]),
          ]),
        ]),
        // Un desajuste entre el saldo derivado y el contador que paga la
        // liquidación se muestra: esconderlo sería volver a tener dos verdades.
        descuadres.length ? h('div', { key: 'warn', 'data-testid': 'commission-mismatch', className: 'mb-8 p-4 rounded-lg border border-danger/40 bg-danger/5 text-body' },
          'Hay ' + descuadres.length + ' vendedor(es) cuyo saldo pendiente calculado no coincide con el acumulado guardado. Revisa la sincronización antes de liquidar: ' +
          descuadres.map(x => x.s.nombre + ' (' + fmt(x.row.descuadre) + ')').join(', ')) : null,
        h('section', { key: 'sum', className: 'grid grid-cols-1 md:grid-cols-3 gap-gutter mb-12' }, [
          h('div', { key: 'a', className: 'bg-surface p-8 rounded-lg ' + SHADOW + ' flex flex-col justify-between' }, [
            h('div', { key: 't' }, [
              h('span', { key: 'l', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-[0.15em]' }, 'Ventas del mes (equipo)'),
              h('h3', { key: 'v', className: 'font-headline text-display text-primary mt-4' }, fmt(totalVentas).replace('.00', '')),
            ]),
            h('div', { key: 'd', className: 'mt-8 flex items-center text-on-surface-variant' }, [h(MS, { key: 'i', name: 'calendar', size: 18, className: 'mr-1' }), h('span', { key: 's', className: 'text-body' }, periodoLabel())]),
          ]),
          h('div', { key: 'b', className: 'bg-surface p-8 rounded-lg border-t-2 border-t-gold ' + SHADOW + ' flex flex-col justify-between' }, [
            h('div', { key: 't' }, [
              h('span', { key: 'l', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-[0.15em]' }, 'Comisiones por liquidar'),
              h('h3', { key: 'v', 'data-testid': 'commission-pending-total', className: 'font-headline text-display text-primary mt-4' }, fmt(totalComision).replace('.00', '')),
            ]),
            h('div', { key: 'd', className: 'mt-8 flex items-center text-on-surface-variant' }, [h(MS, { key: 'i', name: 'calendar', size: 18, className: 'mr-1' }), h('span', { key: 's', className: 'text-body' }, periodoLabel())]),
          ]),
          h('div', { key: 'c', className: 'bg-surface p-8 rounded-lg ' + SHADOW + ' flex flex-col justify-between' }, [
            h('div', { key: 't' }, [
              h('span', { key: 'l', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-[0.15em]' }, 'Vendedores activos'),
              h('h3', { key: 'v', className: 'font-headline text-display text-primary mt-4' }, eligibleSellers.length),
            ]),
            h('div', { key: 'd', className: 'mt-8 flex items-center justify-between' }, [
              h('div', { key: 'av', className: 'flex -space-x-3' }, eligibleSellers.map(s => h(SellerAvatar, { key: s.id, s, className: 'w-9 h-9 rounded-full border-2 border-surface shrink-0', fallbackClassName: 'flex items-center justify-center text-overline font-bold text-white' }))),
              h('span', { key: 'l', className: 'text-body text-primary font-medium underline underline-offset-4 cursor-pointer hover:opacity-70' }, 'Ver todos'),
            ]),
          ]),
        ]),
        h('section', { key: 'ind' }, [
          h('div', { key: 'h', className: 'flex items-center justify-between mb-8 pb-4 border-b border-outline-variant' }, [
            h('h3', { key: 't', className: 'font-headline text-headline-md text-primary' }, 'Rendimiento individual'),
            h('div', { key: 'tg', className: 'flex border border-outline-variant bg-surface p-1 rounded-lg' },
              [['grid', 'Grid'], ['list', 'Lista']].map(([id, l]) => h('button', { key: id, 'data-testid': 'sellers-view-' + id, className: 'px-3 py-1 text-caption uppercase tracking-tighter rounded ' + (view === id ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-low'), onClick: () => setView(id) }, l))),
          ]),
          view === 'grid'
            ? h('div', { key: 'g', className: 'grid grid-cols-1 xl:grid-cols-2 gap-8' }, filas.map(({ s, row }) => h(SellerCard, { key: s.id, s, row, onOpen: () => setDetail(s), onLiquidar: () => liquidar(s) })))
            : h(SellerList, { key: 'l', filas, onOpen: setDetail }),
        ]),
        detail && h(SellerDetail, { key: 'd', s: detail, row: ledgerRow(ledger, detail), onClose: () => setDetail(null), onLiquidar: () => liquidar(detail) }),
        ajuste && h(AjusteHistorico, { key: 'aj', onClose: () => { setAjuste(false); refresh(); } }),
      ]));
  }

  function SellerCard({ s, row, onOpen, onLiquidar }) {
    const pct = metaPct(s, row.importeVendido);
    const meta = metaHit(s, row.importeVendido);
    const policy = D.resolveSellerCommission(s);
    return h('div', { className: 'bg-surface rounded-lg overflow-hidden transition-all duration-300 hover:-translate-y-0.5 ' + SHADOW + ' ' + SHADOW_HOVER, 'data-testid': 'seller-card-' + s.id }, [
      h('div', { key: 'b', className: 'p-8 flex items-start gap-8' }, [
        h(SellerAvatar, { key: 'av', s, className: 'w-24 h-32 border border-outline-variant shrink-0 rounded', fallbackClassName: 'flex items-center justify-center font-headline text-4xl', fallbackStyle: { background: s.color + '1a', color: s.color } }),
        h('div', { key: 'i', className: 'flex-1 min-w-0' }, [
          h('div', { key: 'h', className: 'flex justify-between items-start gap-3' }, [
            h('div', { key: 'n' }, [
              h('h4', { key: 'a', className: 'font-headline text-h2 text-primary leading-tight' }, s.nombre),
              h('p', { key: 'b', className: 'text-caption text-on-surface-variant uppercase tracking-widest mt-1' }, role(s)),
            ]),
            meta && h('span', { key: 'm', className: 'px-2 py-0.5 uppercase tracking-tighter rounded-sm shrink-0 bg-gold-soft text-gold-text text-overline' }, 'Meta cumplida'),
          ]),
          h('div', { key: 'st', className: 'mt-8 grid grid-cols-2 gap-8' }, [
            h('div', { key: 'c' }, [
              h('p', { key: 'l', className: 'text-overline text-on-surface-variant uppercase tracking-widest mb-1' }, 'Comisión'),
              h('p', { key: 'v', 'data-testid': 'seller-card-pct-' + s.id, className: 'text-h2 font-headline text-primary' }, policy.effectivePct + '%'),
              h('p', { key: 'o', className: 'text-caption text-on-surface-variant mt-0.5' }, D.commissionSourceLabel(policy.source)),
            ]),
            h('div', { key: 'v', className: 'text-right' }, [
              h('p', { key: 'l', className: 'text-overline text-on-surface-variant uppercase tracking-widest mb-1' }, 'Ventas del periodo'),
              h('p', { key: 'v', className: 'text-h2 font-headline text-primary' }, fmt(row.importeVendido).replace('.00', '')),
              h('p', { key: 'c', className: 'text-caption text-gold-text mt-0.5' }, 'Comisión ' + fmt(row.pendiente).replace('.00', '')),
            ]),
          ]),
          h('div', { key: 'mt', className: 'mt-8' }, [
            h('div', { key: 'r', className: 'flex justify-between items-center mb-2.5' }, [
              h('span', { key: 'l', className: 'text-overline text-on-surface-variant uppercase tracking-wider' }, Number(s.metaMes) > 0 ? 'Meta: ' + fmt(s.metaMes).replace('.00', '') : 'Sin meta mensual'),
              h('span', { key: 'p', className: 'text-caption font-semibold ' + (meta ? 'text-primary' : 'text-on-surface-variant') }, pct + '%'),
            ]),
            h('div', { key: 'b', className: 'w-full h-1 bg-surface-container overflow-hidden rounded-full' }, h('div', { className: 'h-full transition-all duration-1000 ' + (meta ? 'bg-primary' : 'bg-outline'), style: { width: Math.min(100, pct) + '%' } })),
          ]),
        ]),
      ]),
      h('div', { key: 'f', className: 'px-8 py-4 bg-surface-container-low/50 border-t border-outline-variant flex justify-between items-center' }, [
        h('button', { key: 'd', className: 'text-on-surface-variant hover:text-primary text-overline uppercase tracking-[0.2em] flex items-center group', onClick: onOpen }, [h(MS, { key: 'i', name: 'arrowUpRight', size: 16, className: 'mr-2 group-hover:translate-x-0.5 transition-transform' }), 'Detalles de ventas']),
        h('button', { key: 'l', 'data-testid': 'seller-settle-' + s.id, className: 'text-primary text-overline uppercase tracking-[0.2em] font-bold hover:opacity-70 disabled:opacity-30 disabled:cursor-not-allowed', disabled: !(row.pendiente > 0), onClick: onLiquidar }, 'Liquidar comisión'),
      ]),
    ]);
  }

  function SellerList({ filas, onOpen }) {
    return h('div', { className: 'bg-surface rounded-lg overflow-hidden ' + SHADOW },
      h('table', { className: 'w-full text-left' }, [
        h('thead', { key: 'h' }, h('tr', { className: 'bg-surface-container/50 border-b border-outline-variant' },
          [['Vendedor', ''], ['Comisión', ''], ['Ventas', 'text-right'], ['Pendiente', 'text-right'], ['Meta', 'text-right'], ['', '']].map(([c, al], i) => h('th', { key: i, className: 'px-6 py-4 text-overline uppercase tracking-wider font-semibold text-on-surface-variant/80 ' + al }, c)))),
        h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, filas.map(({ s, row }) => {
          const pct = metaPct(s, row.importeVendido);
          const policy = D.resolveSellerCommission(s);
          return h('tr', { key: s.id, className: 'hover:bg-surface-container transition-colors cursor-pointer', onClick: () => onOpen(s) }, [
            h('td', { key: 'n', className: 'px-6 py-4' }, h('div', { className: 'flex items-center gap-3' }, [
              h(SellerAvatar, { key: 'a', s, className: 'w-9 h-9 rounded-full shrink-0', fallbackClassName: 'flex items-center justify-center text-overline font-bold text-white' }),
              h('div', { key: 'd' }, [h('div', { key: 'n', className: 'font-headline text-body text-primary' }, s.nombre), h('div', { key: 'r', className: 'text-overline text-on-surface-variant uppercase tracking-wider' }, role(s))]),
            ])),
            h('td', { key: 'c', className: 'px-6 py-4 text-body' }, policy.effectivePct + '%'),
            h('td', { key: 'v', className: 'px-6 py-4 text-right font-headline text-base text-primary' }, fmt(row.importeVendido).replace('.00', '')),
            h('td', { key: 'p', className: 'px-6 py-4 text-right font-headline text-base text-gold-text' }, fmt(row.pendiente).replace('.00', '')),
            h('td', { key: 'm', className: 'px-6 py-4 text-right text-body ' + (metaHit(s, row.importeVendido) ? 'text-primary font-semibold' : 'text-on-surface-variant') }, pct + '%'),
            h('td', { key: 'x', className: 'px-6 py-4 text-right' }, h(MS, { name: 'chevRight', size: 18, className: 'text-on-surface-variant/40' })),
          ]);
        })),
      ]));
  }

  function SellerDetail({ s, row, onClose, onLiquidar }) {
    // Las ventas se localizan por IDENTIDAD del vendedor, nunca por su nombre:
    // renombrar a alguien no puede vaciarle el historial, y en una venta
    // compartida el segundo vendedor también ve la suya.
    const ventas = D.sales.filter(v => (v.vendedores || []).includes(s.id))
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const liqs = (D.liquidations || []).filter(l => l.sellerId === s.id).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const policy = D.resolveSellerCommission(s);
    const pct = metaPct(s, row.importeVendido);
    // Cada renglón muestra lo CONGELADO para esta persona en esa venta, no el
    // total del documento ni una estimación con el porcentaje de hoy.
    const suyo = (venta) => {
      const congeladas = D.saleFrozenCommissions(venta);
      const mio = congeladas.filter(c => c.sellerId === s.id);
      return {
        monto: mio.reduce((a, c) => a + (Number(c.monto) || 0), 0),
        estimado: mio.some(c => c.reconstruida),
      };
    };
    const footer = [
      h('button', { key: 'l', 'data-testid': 'seller-detail-settle', className: 'inline-flex items-center gap-2 px-5 h-11 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition disabled:opacity-30 disabled:cursor-not-allowed', disabled: !(row.pendiente > 0), onClick: onLiquidar }, [h(MS, { key: 'i', name: 'cash', size: 16 }), 'Liquidar comisión']),
    ];
    return h(Modal, { title: 'Vendedor', onClose, footer, large: true }, [
      h('div', { key: 'h', className: 'flex items-center gap-4' }, [
        h(SellerAvatar, { key: 'a', s, className: 'w-14 h-14 rounded-full shrink-0', fallbackClassName: 'flex items-center justify-center text-h2 font-bold text-white' }),
        h('div', { key: 'i', className: 'flex-1' }, [
          h('h2', { key: 'n', className: 'font-headline text-h1 text-primary' }, s.nombre),
          h('div', { key: 'b', className: 'text-overline text-on-surface-variant uppercase tracking-widest mt-0.5' }, role(s) + ' · ' + s.bono),
        ]),
        h('span', { key: 'z', className: 'px-3 py-1.5 bg-surface-container-high text-on-surface-variant text-caption rounded' }, 'Comisión ' + policy.effectivePct + '% · ' + D.commissionSourceLabel(policy.source)),
      ]),
      h('div', { key: 'esc', className: 'mt-4 p-4 rounded-lg bg-surface-container/40 border border-outline-variant text-caption text-on-surface-variant leading-relaxed' },
        Number(s.metaMes) > 0
          ? `Escalera vigente: ${policy.basePct}% hasta ${fmt(s.metaMes).replace('.00', '')}, ${policy.goalPct}% hasta ${fmt(s.metaMes * policy.surplusThresholdPct / 100).replace('.00', '')} y ${policy.surplusPct}% por encima. Base acumulada en el periodo: ${fmt(row.base).replace('.00', '')}.`
          : `Sin meta mensual: ${policy.basePct}% plano sobre la venta neta. Base acumulada en el periodo: ${fmt(row.base).replace('.00', '')}.`),
      h('div', { key: 'st', className: 'grid grid-cols-2 md:grid-cols-4 gap-4 my-6' }, [
        stat('Ventas del periodo', fmt(row.importeVendido).replace('.00', '')), stat('# de ventas', row.pedidos),
        stat('Comisión generada', fmt(row.generado).replace('.00', '')), stat('Avance de meta', pct + '%'),
        stat('Revertido', fmt(row.revertido).replace('.00', '')), stat('Liquidado', fmt(row.liquidado).replace('.00', '')),
        stat('Pendiente', fmt(row.pendiente).replace('.00', '')), stat('Comisión por cambios', fmt(row.cambios).replace('.00', '')),
      ]),
      h('div', { key: 'hl', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-widest mb-3' }, 'Ventas recientes atribuidas'),
      ventas.length ? h('div', { key: 't', className: 'border border-outline-variant rounded-lg overflow-hidden' }, h('table', { className: 'w-full' }, [
        h('thead', { key: 'h' }, h('tr', { className: 'text-left border-b border-outline-variant' }, ['Folio', 'Cliente', 'Total', 'Su comisión'].map((x, i) => h('th', { key: i, className: 'px-3 py-2 text-overline font-semibold text-on-surface-variant uppercase tracking-widest' + (x === 'Total' || x === 'Su comisión' ? ' text-right' : '') }, x)))),
        h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, ventas.slice(0, 40).map(v => {
          const mio = suyo(v);
          return h('tr', { key: v.folio, className: v.estado === 'Cancelado' ? 'opacity-50 line-through' : '' }, [
            h('td', { key: 'f', className: 'px-3 py-2 font-medium text-primary' }, v.folio),
            h('td', { key: 'c', className: 'px-3 py-2 text-body' }, v.cliente),
            h('td', { key: 't', className: 'px-3 py-2 text-right font-headline text-body' }, fmt(v.total).replace('.00', '')),
            h('td', { key: 'k', className: 'px-3 py-2 text-right font-headline text-body text-gold-text' }, fmt(mio.monto).replace('.00', '') + (mio.estimado ? ' *' : '')),
          ]);
        })),
      ])) : h('div', { key: 'e', className: 'text-center text-on-surface-variant py-8' }, 'Sin ventas en el periodo'),
      ventas.some(v => suyo(v).estimado) ? h('p', { key: 'nota', className: 'text-caption text-on-surface-variant mt-2' }, '* Venta anterior a la política actual: el reparto entre vendedores es estimado.') : null,
      liqs.length ? h('div', { key: 'liq', className: 'mt-6' }, [
        h('div', { key: 'hl', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-widest mb-3' }, 'Liquidaciones recientes'),
        h('div', { key: 'l', className: 'border border-outline-variant rounded-lg overflow-hidden divide-y divide-outline-variant' }, liqs.slice(0, 6).map(l => h('div', { key: l.id, className: 'flex items-center justify-between px-3 py-2.5' }, [
          h('div', { key: 'd', className: 'flex items-center gap-2' }, [
            h(MS, { key: 'i', name: l.tipo === 'corte' ? 'calendar' : 'cash', size: 16, className: 'text-on-surface-variant' }),
            h('span', { key: 'f', className: 'text-body text-primary' }, l.fecha),
            h('span', { key: 't', className: 'text-overline uppercase tracking-wider text-on-surface-variant' }, l.tipo === 'corte' ? '· Corte de mes' : (l.tipo === 'ajuste' ? '· Ajuste histórico' : '· Liquidación')),
          ]),
          h('span', { key: 'm', className: 'font-headline text-body text-gold-text' }, fmt(l.monto).replace('.00', '')),
        ]))),
      ]) : null,
    ]);
  }

  // ── H-69 · Ajuste histórico de comisión ─────────────────────────────────────
  //
  // Sólo propone. Muestra folio por folio lo que la política habría pagado en las
  // ventas que quedaron en cero, y no mueve un peso hasta que alguien confirma el
  // resumen final. Los tickets emitidos no se tocan: el ajuste es un documento
  // aparte (`ADR-002`).
  function AjusteHistorico({ onClose }) {
    const [preview] = useState(() => D.commissionAdjustmentPreview());
    const [motivo, setMotivo] = useState('');
    const [confirmando, setConfirmando] = useState(false);
    const [resultado, setResultado] = useState(null);

    function aplicar() {
      const draft = D.commissionAdjustmentDraft(preview, { motivo });
      const r = D.applyCommissionAdjustment(draft);
      if (!r.ok) { toast(r.idempotente ? 'Este ajuste ya se aplicó' : 'No se pudo aplicar el ajuste', 'var(--danger)'); return; }
      setResultado(r.ajuste);
      toast('Ajuste histórico registrado: ' + fmt(r.ajuste.totales.comision), 'var(--accent)');
    }

    const footer = resultado ? [
      h('button', { key: 'c', className: 'px-5 h-11 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg', onClick: onClose }, 'Cerrar'),
    ] : [
      h('button', { key: 'x', className: 'px-5 h-11 text-on-surface-variant text-caption font-bold uppercase tracking-widest', onClick: onClose }, 'Cancelar'),
      confirmando
        ? h('button', { key: 'a', 'data-testid': 'commission-adjustment-apply', className: 'px-5 h-11 bg-danger text-white text-caption font-bold uppercase tracking-widest rounded-lg disabled:opacity-30', disabled: !preview.aplicable, onClick: aplicar }, 'Sí, registrar el ajuste')
        : h('button', { key: 'r', 'data-testid': 'commission-adjustment-review', className: 'px-5 h-11 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg disabled:opacity-30', disabled: !preview.aplicable, onClick: () => setConfirmando(true) }, 'Revisar resumen final'),
    ];

    return h(Modal, { title: 'Ajuste histórico de comisiones', onClose, footer, large: true }, [
      h('p', { key: 'i', className: 'text-body text-on-surface-variant leading-relaxed' },
        'Estas son las ventas que se cobraron sin comisión. Los tickets ya emitidos NO se modifican: lo que se registra es un documento de ajuste aparte, con su propio folio y auditoría.'),
      !preview.aplicable
        ? h('div', { key: 'v', 'data-testid': 'commission-adjustment-empty', className: 'my-8 text-center text-on-surface-variant' }, preview.yaAjustados ? 'No queda nada por ajustar: todo lo pendiente ya se reconoció.' : 'No hay ventas sin comisión en el rango.')
        : h('div', { key: 'c' }, [
          h('div', { key: 'tot', className: 'grid grid-cols-2 md:grid-cols-4 gap-4 my-6' }, [
            stat('Ventas', preview.totales.ventas), stat('Venta neta', fmt(preview.totales.ventaNeta).replace('.00', '')),
            stat('Devuelto', fmt(preview.totales.devuelto).replace('.00', '')),
            stat('Ajuste propuesto', fmt(preview.totales.comision).replace('.00', '')),
          ]),
          h('div', { key: 'pv', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-widest mb-2' }, 'Total por vendedor'),
          h('div', { key: 'pvt', 'data-testid': 'commission-adjustment-by-seller', className: 'border border-outline-variant rounded-lg divide-y divide-outline-variant mb-6' },
            preview.porVendedor.map(r => h('div', { key: r.sellerId, className: 'flex justify-between px-3 py-2.5' }, [
              h('span', { key: 'n', className: 'text-body text-primary' }, r.vendedor + ' · ' + r.ventas + ' venta(s)'),
              h('span', { key: 'm', className: 'font-headline text-body text-gold-text' }, fmt(r.comision).replace('.00', '')),
            ]))),
          confirmando ? null : h('div', { key: 'det', className: 'border border-outline-variant rounded-lg overflow-hidden max-h-72 overflow-y-auto' }, h('table', { className: 'w-full' }, [
            h('thead', { key: 'h', className: 'sticky top-0 bg-surface-container' }, h('tr', { className: 'text-left border-b border-outline-variant' },
              ['Folio', 'Vendedor', 'Venta neta', '%', 'Comisión', 'Devuelto', 'Estado'].map((x, i) => h('th', { key: i, className: 'px-3 py-2 text-overline font-semibold text-on-surface-variant uppercase tracking-widest' }, x)))),
            h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, preview.renglones.map((r, i) => h('tr', { key: r.folio + '-' + r.sellerId + '-' + i }, [
              h('td', { key: 'f', className: 'px-3 py-2 text-body text-primary' }, r.folio),
              h('td', { key: 'v', className: 'px-3 py-2 text-body' }, r.vendedor),
              h('td', { key: 'n', className: 'px-3 py-2 text-body text-right' }, fmt(r.ventaNeta).replace('.00', '')),
              h('td', { key: 'p', className: 'px-3 py-2 text-body text-right' }, r.pct + '%'),
              h('td', { key: 'c', className: 'px-3 py-2 text-body text-right text-gold-text' }, fmt(r.comision).replace('.00', '')),
              h('td', { key: 'd', className: 'px-3 py-2 text-body text-right' }, fmt(r.devuelto).replace('.00', '')),
              h('td', { key: 'e', className: 'px-3 py-2 text-caption text-on-surface-variant' }, r.cancelada ? 'Cancelada' : r.estado),
            ]))),
          ])),
          confirmando && !resultado ? h('div', { key: 'cf', 'data-testid': 'commission-adjustment-summary', className: 'mt-4 p-5 rounded-lg border border-danger/40 bg-danger/5' }, [
            h('p', { key: 't', className: 'text-body font-semibold text-primary mb-2' }, 'Resumen final antes de registrar'),
            h('p', { key: 'd', className: 'text-body' }, `Se registrará un ajuste de ${fmt(preview.totales.comision)} repartido entre ${preview.porVendedor.length} vendedor(es), por ${preview.totales.ventas} venta(s). Ninguna venta ni ticket se modifica.`),
            h('input', { key: 'm', className: 'mt-4 w-full border-0 border-b border-outline-variant bg-transparent py-2 text-body', placeholder: 'Motivo (opcional)', value: motivo, onChange: e => setMotivo(e.target.value) }),
          ]) : null,
        ]),
      resultado ? h('div', { key: 'ok', 'data-testid': 'commission-adjustment-result', className: 'mt-6 p-5 rounded-lg border border-outline-variant bg-surface-container-low' }, [
        h('p', { key: 't', className: 'text-body font-semibold text-primary' }, 'Ajuste registrado'),
        h('p', { key: 'd', className: 'text-body mt-1' }, `Documento ${resultado.id} · ${fmt(resultado.totales.comision)} · ${resultado.totales.ventas} venta(s).`),
      ]) : null,
    ]);
  }

  function stat(label, value) {
    return h('div', { key: label, className: 'bg-surface-container/50 p-4 rounded-xl border border-outline-variant' }, [
      h('span', { key: 'l', className: 'block text-overline uppercase font-bold text-on-surface-variant tracking-widest opacity-60 mb-1.5' }, label),
      h('span', { key: 'v', className: 'font-headline text-h2 text-primary' }, value),
    ]);
  }

  window.SellersScreen = SellersScreen;
})();
