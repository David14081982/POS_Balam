// sellers.jsx — Vendedores y comisiones (Heritage Luxury). Exporta window.SellersScreen
(function () {
  const { useState } = React;
  const { fmt, Modal, toast } = window.UI;
  const { MS } = window.HX;
  const D = window.DATA;
  const h = React.createElement;
  const SHADOW = 'shadow-e1';
  const SHADOW_HOVER = 'hover:shadow-e2';

  // Nivel/rol del vendedor según su % de comisión — reglas administrables (seller_role.meta.minPct).
  const role = (s) => {
    const roles = window.CONFIG.list('seller_role')
      .map(r => ({ label: r.label, min: (r.meta && r.meta.minPct) || 0 }))
      .sort((a, b) => b.min - a.min);
    const hit = roles.find(r => s.comisionPct >= r.min);
    return hit ? hit.label : (roles.length ? roles[roles.length - 1].label : '—');
  };

  // Avance de meta con guardia contra meta=0 (evita NaN/Infinity en admin y vendedores sin meta).
  const metaPct = (s) => (Number(s.metaMes) > 0 ? Math.round((s.ventasMes / s.metaMes) * 100) : 0);
  const metaHit = (s) => Number(s.metaMes) > 0 && s.ventasMes >= s.metaMes;
  // Comisión de una venta atribuida: usa el monto guardado al cobrar (refleja la base neto/bruto y el %
  // vigentes en ese momento); si es una venta vieja/sincronizada sin el dato, la estima con el % actual.
  const saleComm = (v, s) => (v && v.comision != null ? Number(v.comision) : (Number(v.total) || 0) * (s.comisionPct || 0) / 100);

  function SellersScreen() {
    const [detail, setDetail] = useState(null);
    const [view, setView] = useState('grid');
    const [, bump] = useState(0);
    const refresh = () => bump(v => v + 1);
    const totalComision = D.sellers.reduce((a, s) => a + s.comisionAcum, 0);
    const totalVentas = D.sellers.reduce((a, s) => a + s.ventasMes, 0);

    function liquidar(s) {
      if (!window.confirm('¿Liquidar la comisión acumulada de ' + s.nombre + ' (' + fmt(s.comisionAcum) + ')? Quedará en cero.')) return;
      const monto = D.liquidarComision(s.id);
      setDetail(null); refresh();
      toast('Comisión de ' + s.nombre + ' liquidada: ' + fmt(monto || 0), 'var(--accent)');
    }

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'p-10 max-w-container-max mx-auto' }, [
        // Encabezado
        h('section', { key: 'hd', className: 'flex flex-col md:flex-row md:items-end justify-between mb-12 gap-6' }, [
          h('div', { key: 'l' }, [
            h('h2', { key: 't', className: 'font-headline text-headline-lg text-primary' }, 'Vendedores y comisiones'),
            h('p', { key: 'd', className: 'text-on-surface-variant mt-2 max-w-2xl text-body' }, 'Visualización de rendimiento individual y métricas del equipo Heritage. Gestiona los incentivos basados en la excelencia del servicio.'),
          ]),
          h('button', { key: 'r', className: 'flex items-center gap-2 px-6 py-2.5 bg-surface border border-outline-variant text-primary hover:border-primary transition-colors rounded-lg', onClick: () => toast('Exportando reporte mensual…') }, [h(MS, { key: 'i', name: 'download', size: 18 }), h('span', { key: 's', className: 'text-overline font-bold uppercase tracking-widest' }, 'Reporte mensual')]),
        ]),
        // Resumen
        h('section', { key: 'sum', className: 'grid grid-cols-1 md:grid-cols-3 gap-gutter mb-12' }, [
          h('div', { key: 'a', className: 'bg-surface p-8 rounded-lg ' + SHADOW + ' flex flex-col justify-between' }, [
            h('div', { key: 't' }, [
              h('span', { key: 'l', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-[0.15em]' }, 'Ventas del mes (equipo)'),
              h('h3', { key: 'v', className: 'font-headline text-display text-primary mt-4' }, fmt(totalVentas).replace('.00', '')),
            ]),
            h('div', { key: 'd', className: 'mt-8 flex items-center text-success' }, [h(MS, { key: 'i', name: 'trending_up', size: 18, className: 'mr-1' }), h('span', { key: 's', className: 'text-body font-medium' }, '+12.5% vs mes anterior')]),
          ]),
          h('div', { key: 'b', className: 'bg-surface p-8 rounded-lg border-t-2 border-t-gold ' + SHADOW + ' flex flex-col justify-between' }, [
            h('div', { key: 't' }, [
              h('span', { key: 'l', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-[0.15em]' }, 'Comisiones por liquidar'),
              h('h3', { key: 'v', className: 'font-headline text-display text-primary mt-4' }, fmt(totalComision).replace('.00', '')),
            ]),
            h('div', { key: 'd', className: 'mt-8 flex items-center text-on-surface-variant' }, [h(MS, { key: 'i', name: 'calendar', size: 18, className: 'mr-1' }), h('span', { key: 's', className: 'text-body' }, 'Próximo corte: 30 jun')]),
          ]),
          h('div', { key: 'c', className: 'bg-surface p-8 rounded-lg ' + SHADOW + ' flex flex-col justify-between' }, [
            h('div', { key: 't' }, [
              h('span', { key: 'l', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-[0.15em]' }, 'Vendedores activos'),
              h('h3', { key: 'v', className: 'font-headline text-display text-primary mt-4' }, D.sellers.length),
            ]),
            h('div', { key: 'd', className: 'mt-8 flex items-center justify-between' }, [
              h('div', { key: 'av', className: 'flex -space-x-3' }, D.sellers.map(s => h('div', { key: s.id, className: 'w-9 h-9 rounded-full border-2 border-surface flex items-center justify-center text-overline font-bold text-white', style: { background: s.color } }, s.iniciales))),
              h('span', { key: 'l', className: 'text-body text-primary font-medium underline underline-offset-4 cursor-pointer hover:opacity-70' }, 'Ver todos'),
            ]),
          ]),
        ]),
        // Rendimiento individual
        h('section', { key: 'ind' }, [
          h('div', { key: 'h', className: 'flex items-center justify-between mb-8 pb-4 border-b border-outline-variant' }, [
            h('h3', { key: 't', className: 'font-headline text-headline-md text-primary' }, 'Rendimiento individual'),
            h('div', { key: 'tg', className: 'flex border border-outline-variant bg-surface p-1 rounded-lg' },
              [['grid', 'Grid'], ['list', 'Lista']].map(([id, l]) => h('button', { key: id, className: 'px-3 py-1 text-caption uppercase tracking-tighter rounded ' + (view === id ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-low'), onClick: () => setView(id) }, l))),
          ]),
          view === 'grid'
            ? h('div', { key: 'g', className: 'grid grid-cols-1 xl:grid-cols-2 gap-8' }, D.sellers.map(s => h(SellerCard, { key: s.id, s, onOpen: () => setDetail(s), onLiquidar: () => liquidar(s) })))
            : h(SellerList, { key: 'l', sellers: D.sellers, onOpen: setDetail }),
        ]),
        detail && h(SellerDetail, { key: 'd', s: detail, onClose: () => setDetail(null), onLiquidar: () => liquidar(detail) }),
      ]));
  }

  function SellerCard({ s, onOpen, onLiquidar }) {
    const pct = metaPct(s);
    const meta = metaHit(s);
    return h('div', { className: 'bg-surface rounded-lg overflow-hidden transition-all duration-300 hover:-translate-y-0.5 ' + SHADOW + ' ' + SHADOW_HOVER }, [
      h('div', { key: 'b', className: 'p-8 flex items-start gap-8' }, [
        h('div', { key: 'av', className: 'w-24 h-32 flex items-center justify-center border border-outline-variant shrink-0 rounded', style: { background: s.color + '1a' } },
          h('span', { key: 'i', className: 'font-headline text-4xl', style: { color: s.color } }, s.iniciales)),
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
              h('p', { key: 'v', className: 'text-h2 font-headline text-primary' }, s.comisionPct + '%'),
            ]),
            h('div', { key: 'v', className: 'text-right' }, [
              h('p', { key: 'l', className: 'text-overline text-on-surface-variant uppercase tracking-widest mb-1' }, 'Ventas totales'),
              h('p', { key: 'v', className: 'text-h2 font-headline text-primary' }, fmt(s.ventasMes).replace('.00', '')),
            ]),
          ]),
          h('div', { key: 'mt', className: 'mt-8' }, [
            h('div', { key: 'r', className: 'flex justify-between items-center mb-2.5' }, [
              h('span', { key: 'l', className: 'text-overline text-on-surface-variant uppercase tracking-wider' }, 'Meta: ' + fmt(s.metaMes).replace('.00', '')),
              h('span', { key: 'p', className: 'text-caption font-semibold ' + (meta ? 'text-primary' : 'text-on-surface-variant') }, pct + '%'),
            ]),
            h('div', { key: 'b', className: 'w-full h-1 bg-surface-container overflow-hidden rounded-full' }, h('div', { className: 'h-full transition-all duration-1000 ' + (meta ? 'bg-primary' : 'bg-outline'), style: { width: Math.min(100, pct) + '%' } })),
          ]),
        ]),
      ]),
      h('div', { key: 'f', className: 'px-8 py-4 bg-surface-container-low/50 border-t border-outline-variant flex justify-between items-center' }, [
        h('button', { key: 'd', className: 'text-on-surface-variant hover:text-primary text-overline uppercase tracking-[0.2em] flex items-center group', onClick: onOpen }, [h(MS, { key: 'i', name: 'arrowUpRight', size: 16, className: 'mr-2 group-hover:translate-x-0.5 transition-transform' }), 'Detalles de ventas']),
        h('button', { key: 'l', className: 'text-primary text-overline uppercase tracking-[0.2em] font-bold hover:opacity-70 disabled:opacity-30 disabled:cursor-not-allowed', disabled: !(s.comisionAcum > 0), onClick: onLiquidar }, 'Liquidar comisión'),
      ]),
    ]);
  }

  function SellerList({ sellers, onOpen }) {
    return h('div', { className: 'bg-surface rounded-lg overflow-hidden ' + SHADOW },
      h('table', { className: 'w-full text-left' }, [
        h('thead', { key: 'h' }, h('tr', { className: 'bg-surface-container/50 border-b border-outline-variant' },
          [['Vendedor', ''], ['Comisión', ''], ['Ventas', 'text-right'], ['Meta', 'text-right'], ['', '']].map(([c, al], i) => h('th', { key: i, className: 'px-6 py-4 text-overline uppercase tracking-wider font-semibold text-on-surface-variant/80 ' + al }, c)))),
        h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, sellers.map(s => {
          const pct = metaPct(s);
          return h('tr', { key: s.id, className: 'hover:bg-surface-container transition-colors cursor-pointer', onClick: () => onOpen(s) }, [
            h('td', { key: 'n', className: 'px-6 py-4' }, h('div', { className: 'flex items-center gap-3' }, [
              h('span', { key: 'a', className: 'w-9 h-9 rounded-full flex items-center justify-center text-overline font-bold text-white', style: { background: s.color } }, s.iniciales),
              h('div', { key: 'd' }, [h('div', { key: 'n', className: 'font-headline text-body text-primary' }, s.nombre), h('div', { key: 'r', className: 'text-overline text-on-surface-variant uppercase tracking-wider' }, role(s))]),
            ])),
            h('td', { key: 'c', className: 'px-6 py-4 text-body' }, s.comisionPct + '%'),
            h('td', { key: 'v', className: 'px-6 py-4 text-right font-headline text-base text-primary' }, fmt(s.ventasMes).replace('.00', '')),
            h('td', { key: 'm', className: 'px-6 py-4 text-right text-body ' + (metaHit(s) ? 'text-primary font-semibold' : 'text-on-surface-variant') }, pct + '%'),
            h('td', { key: 'x', className: 'px-6 py-4 text-right' }, h(MS, { name: 'chevRight', size: 18, className: 'text-on-surface-variant/40' })),
          ]);
        })),
      ]));
  }

  function SellerDetail({ s, onClose, onLiquidar }) {
    const ventas = D.sales.filter(v => v.vendedor === s.nombre);
    const pct = metaPct(s);
    const footer = [
      h('button', { key: 'l', className: 'inline-flex items-center gap-2 px-5 h-11 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition disabled:opacity-30 disabled:cursor-not-allowed', disabled: !(s.comisionAcum > 0), onClick: onLiquidar }, [h(MS, { key: 'i', name: 'cash', size: 16 }), 'Liquidar comisión']),
    ];
    return h(Modal, { title: 'Vendedor', onClose, footer, large: true }, [
      h('div', { key: 'h', className: 'flex items-center gap-4' }, [
        h('span', { key: 'a', className: 'w-14 h-14 rounded-full flex items-center justify-center text-h2 font-bold text-white shrink-0', style: { background: s.color } }, s.iniciales),
        h('div', { key: 'i', className: 'flex-1' }, [
          h('h2', { key: 'n', className: 'font-headline text-h1 text-primary' }, s.nombre),
          h('div', { key: 'b', className: 'text-overline text-on-surface-variant uppercase tracking-widest mt-0.5' }, role(s) + ' · ' + s.bono),
        ]),
        h('span', { key: 'z', className: 'px-3 py-1.5 bg-surface-container-high text-on-surface-variant text-caption rounded' }, 'Comisión ' + s.comisionPct + '%'),
      ]),
      h('div', { key: 'st', className: 'grid grid-cols-2 md:grid-cols-4 gap-4 my-6' }, [
        stat('Ventas del mes', fmt(s.ventasMes).replace('.00', '')), stat('# de ventas', s.ventasNum),
        stat('Comisión acum.', fmt(s.comisionAcum).replace('.00', '')), stat('Avance de meta', pct + '%'),
      ]),
      h('div', { key: 'hl', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-widest mb-3' }, 'Ventas recientes atribuidas'),
      ventas.length ? h('div', { key: 't', className: 'border border-outline-variant rounded-lg overflow-hidden' }, h('table', { className: 'w-full' }, [
        h('thead', { key: 'h' }, h('tr', { className: 'text-left border-b border-outline-variant' }, ['Folio', 'Cliente', 'Total', 'Comisión'].map((x, i) => h('th', { key: i, className: 'px-3 py-2 text-overline font-semibold text-on-surface-variant uppercase tracking-widest' + (x === 'Total' || x === 'Comisión' ? ' text-right' : '') }, x)))),
        h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, ventas.map(v => h('tr', { key: v.folio }, [
          h('td', { key: 'f', className: 'px-3 py-2 font-medium text-primary' }, v.folio),
          h('td', { key: 'c', className: 'px-3 py-2 text-body' }, v.cliente),
          h('td', { key: 't', className: 'px-3 py-2 text-right font-headline text-body' }, fmt(v.total).replace('.00', '')),
          h('td', { key: 'k', className: 'px-3 py-2 text-right font-headline text-body text-gold-text' }, fmt(saleComm(v, s)).replace('.00', '')),
        ]))),
      ])) : h('div', { key: 'e', className: 'text-center text-on-surface-variant py-8' }, 'Sin ventas en el periodo'),
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
