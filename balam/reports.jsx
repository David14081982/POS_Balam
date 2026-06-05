// reports.jsx — Reportes / Analítica (Heritage Luxury). Exporta window.ReportsScreen
(function () {
  const { useState } = React;
  const { fmt, toast } = window.UI;
  const { MS, ProductImage } = window.HX;
  const D = window.DATA;
  const h = React.createElement;
  const GOLD_GRAD = 'linear-gradient(135deg, #92760F 0%, #D4AF38 100%)';

  const CARD = 'bg-surface-container-lowest rounded-xl shadow-e1';
  const SEMANAS = [{ s: 'SEM 1', pct: 40 }, { s: 'SEM 2', pct: 65 }, { s: 'SEM 3', pct: 85 }, { s: 'SEM 4', pct: 55 }];

  function ReportsScreen() {
    const [mes, setMes] = useState('Mayo 2026');

    // Datos reales
    const ventasBrutas = D.sales.filter(s => s.estado !== 'Cancelado').reduce((a, s) => a + s.total, 0) + 1100000; // + histórico mock
    const utilidad = Math.round(ventasBrutas * ((window.CONFIG.get('report.marginPct') || 33) / 100));
    const pedidos = D.sales.length + 300;
    const ticketProm = Math.round(ventasBrutas / pedidos);

    // Meta global (equipo)
    const teamVentas = D.sellers.reduce((a, s) => a + s.ventasMes, 0);
    const teamMeta = D.sellers.reduce((a, s) => a + s.metaMes, 0);
    const avance = Math.min(100, Math.round(teamVentas / teamMeta * 100));
    const falta = Math.max(0, teamMeta - teamVentas);
    const R = 70, CIRC = 2 * Math.PI * R, offset = CIRC * (1 - avance / 100);

    // Top categorías (por valor de inventario, proxy de venta)
    const catRev = {};
    D.products.forEach(p => { catRev[p.cat] = (catRev[p.cat] || 0) + p.precio * D.totalStock(p); });
    const cats = Object.entries(catRev).map(([cat, rev]) => ({ cat, rev, img: D.products.find(x => x.cat === cat) }))
      .sort((a, b) => b.rev - a.rev).slice(0, 3);
    const maxRev = cats.length ? cats[0].rev : 1;

    // Comisiones
    const topVend = [...D.sellers].sort((a, b) => b.ventasMes - a.ventasMes);
    const totalComision = D.sellers.reduce((a, s) => a + s.comisionAcum, 0);

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'p-10 max-w-container-max mx-auto' }, [

        // Acciones
        h('div', { key: 'act', className: 'flex justify-end gap-3 mb-8' }, [
          h('button', { key: 'm', className: 'flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container-low transition-all text-body font-semibold', onClick: () => toast('Reporte enviado por correo') }, [h(MS, { key: 'i', name: 'mail', size: 16 }), 'Enviar por correo']),
          h('button', { key: 'p', className: 'flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container-low transition-all text-body font-semibold', onClick: () => window.print() }, [h(MS, { key: 'i', name: 'print', size: 16 }), 'Imprimir']),
          h('button', { key: 'e', className: 'flex items-center gap-2 px-6 py-2 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-all text-body font-semibold shadow-e2', onClick: () => toast('Exportando reporte a PDF…') }, [h(MS, { key: 'i', name: 'download', size: 16 }), 'Exportar PDF']),
        ]),

        // KPIs
        h('div', { key: 'kpi', className: 'grid grid-cols-1 md:grid-cols-4 gap-gutter mb-gutter' }, [
          kpi('Ventas brutas', fmt(ventasBrutas).replace('.00', ''), 'trending_up', '+12.4% vs mes anterior', 'text-success'),
          kpi('Utilidad neta', fmt(utilidad).replace('.00', ''), 'trending_up', '+8.2% vs mes anterior', 'text-success'),
          kpi('Total pedidos', String(pedidos), 'chart', 'Meta: 400 pedidos', 'text-on-surface-variant/60'),
          kpi('Ticket promedio', fmt(ticketProm).replace('.00', ''), 'star', 'Nivel Luxury Gold', 'text-gold-text', true),
        ]),

        // Gráfica + Meta global
        h('div', { key: 'mid', className: 'grid grid-cols-1 lg:grid-cols-3 gap-gutter' }, [
          // Rendimiento mensual
          h('div', { key: 'g', className: CARD + ' lg:col-span-2 p-8 flex flex-col' }, [
            h('div', { key: 'h', className: 'flex justify-between items-start mb-8' }, [
              h('div', { key: 't' }, [
                h('h4', { key: 'a', className: 'font-headline text-headline-md text-primary' }, 'Rendimiento mensual'),
                h('p', { key: 'b', className: 'text-on-surface-variant text-body' }, 'Distribución de ingresos por semana'),
              ]),
              h('select', { key: 's', className: 'bg-surface-container-low border-none rounded-lg text-caption font-bold px-4 py-2 focus:ring-1 focus:ring-primary', value: mes, onChange: e => setMes(e.target.value) },
                ['Mayo 2026', 'Abril 2026', 'Marzo 2026'].map(m => h('option', { key: m, value: m }, m))),
            ]),
            h('div', { key: 'bars', className: 'flex-grow flex items-end justify-between gap-4 h-64 px-4 border-b border-outline-variant mb-4' },
              SEMANAS.map(x => h('div', { key: x.s, className: 'flex flex-col items-center w-full h-full justify-end gap-2 group' }, [
                h('div', { key: 'b', className: 'w-full bg-primary-container/10 rounded-t-lg relative overflow-hidden group-hover:bg-primary-container/20 transition-all', style: { height: x.pct + '%' } },
                  h('div', { className: 'absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity', style: { background: GOLD_GRAD } })),
                h('span', { key: 'l', className: 'text-overline text-on-surface-variant font-bold' }, x.s),
              ]))),
            h('div', { key: 'leg', className: 'flex gap-6' }, [
              h('div', { key: 'p', className: 'flex items-center gap-2' }, [h('div', { className: 'w-3 h-3 rounded-full bg-primary-container/20' }), h('span', { className: 'text-caption text-on-surface-variant' }, 'Proyectado')]),
              h('div', { key: 'r', className: 'flex items-center gap-2' }, [h('div', { className: 'w-3 h-3 rounded-full', style: { background: GOLD_GRAD } }), h('span', { className: 'text-caption text-on-surface-variant' }, 'Realizado')]),
            ]),
          ]),
          // Meta global (navy)
          h('div', { key: 'meta', className: 'border border-outline-variant rounded-xl p-8 bg-primary-container text-on-primary flex flex-col justify-between' }, [
            h('div', { key: 'h' }, [
              h('h4', { key: 'a', className: 'font-headline text-headline-md text-gold mb-1' }, 'Meta global'),
              h('p', { key: 'b', className: 'text-on-primary-container text-body opacity-80' }, 'Avance del objetivo de ventas'),
            ]),
            h('div', { key: 'g', className: 'py-8 text-center' }, [
              h('div', { key: 'r', className: 'relative inline-flex items-center justify-center' }, [
                h('svg', { key: 's', width: 160, height: 160, className: 'transform -rotate-90' }, [
                  h('circle', { key: 'bg', cx: 80, cy: 80, r: R, fill: 'transparent', stroke: 'currentColor', strokeWidth: 8, className: 'text-on-primary-container/20' }),
                  h('circle', { key: 'fg', cx: 80, cy: 80, r: R, fill: 'transparent', stroke: '#D4AF38', strokeWidth: 8, strokeDasharray: CIRC, strokeDashoffset: offset, strokeLinecap: 'round', className: 'transition-all duration-1000' }),
                ]),
                h('div', { key: 'c', className: 'absolute flex flex-col items-center' }, [
                  h('span', { key: 'v', className: 'text-display font-bold text-white' }, avance + '%'),
                  h('span', { key: 'l', className: 'text-overline uppercase tracking-tight text-gold' }, 'Completado'),
                ]),
              ]),
              h('p', { key: 'f', className: 'mt-6 text-body text-on-primary-container font-light' }, ['Faltan ', h('span', { key: 's', className: 'text-gold font-bold' }, fmt(falta).replace('.00', '')), ' para el bono mensual.']),
            ]),
            h('button', { key: 'b', className: 'w-full py-3 bg-gold text-on-gold rounded-lg font-bold text-body uppercase tracking-wider hover:opacity-90 transition-all', onClick: () => toast('Generando plan de impulso…') }, 'Impulsar ventas'),
          ]),
        ]),

        // Top categorías + Comisiones
        h('div', { key: 'bot', className: 'grid grid-cols-1 lg:grid-cols-2 gap-gutter mt-gutter' }, [
          h('div', { key: 'cats', className: CARD + ' p-8' }, [
            h('h4', { key: 't', className: 'font-headline text-headline-md text-primary mb-6' }, 'Top categorías'),
            h('div', { key: 'l', className: 'space-y-6' }, cats.map(c => h('div', { key: c.cat, className: 'flex items-center gap-4' }, [
              h(ProductImage, { key: 'i', p: c.img, className: 'w-16 h-16 rounded-lg shrink-0 shadow-e1 border border-outline-variant/30' }),
              h('div', { key: 'd', className: 'flex-grow' }, [
                h('div', { key: 'r', className: 'flex justify-between items-center mb-1' }, [
                  h('span', { key: 'n', className: 'font-bold text-body' }, D.CAT[c.cat] || c.cat),
                  h('span', { key: 'v', className: 'text-primary font-bold' }, fmt(c.rev).replace('.00', '')),
                ]),
                h('div', { key: 'b', className: 'w-full bg-surface-container h-1.5 rounded-full' }, h('div', { className: 'bg-primary h-full rounded-full', style: { width: (c.rev / maxRev * 100) + '%' } })),
              ]),
            ]))),
          ]),
          h('div', { key: 'com', className: CARD + ' p-8 overflow-hidden' }, [
            h('div', { key: 'h', className: 'flex justify-between items-center mb-6' }, [
              h('h4', { key: 't', className: 'font-headline text-headline-md text-primary' }, 'Comisiones de vendedores'),
              h(MS, { key: 'i', name: 'cash', size: 22, className: 'text-gold-text' }),
            ]),
            h('table', { key: 'tbl', className: 'w-full text-left' }, [
              h('thead', { key: 'h' }, h('tr', { className: 'border-b border-outline-variant' },
                ['Vendedor', 'Ventas', 'Comisión'].map((c, i) => h('th', { key: i, className: 'pb-4 text-overline font-semibold text-on-surface-variant uppercase tracking-wider' + (c === 'Comisión' ? ' text-right' : '') }, c)))),
              h('tbody', { key: 'b', className: 'divide-y divide-outline-variant/30' }, topVend.map(s => h('tr', { key: s.id }, [
                h('td', { key: 'n', className: 'py-4' }, h('div', { className: 'flex items-center gap-3' }, [
                  h('div', { key: 'a', className: 'w-8 h-8 rounded-full flex items-center justify-center text-overline font-bold text-white', style: { background: s.color } }, s.iniciales),
                  h('span', { key: 'x', className: 'text-body font-semibold' }, s.nombre),
                ])),
                h('td', { key: 'v', className: 'py-4 text-body' }, fmt(s.ventasMes).replace('.00', '')),
                h('td', { key: 'c', className: 'py-4 text-body font-bold text-right text-gold-text' }, fmt(s.comisionAcum).replace('.00', '')),
              ]))),
              h('tfoot', { key: 'f' }, h('tr', {}, [
                h('td', { key: 'l', className: 'pt-6 font-bold text-body', colSpan: 2 }, 'Total a liquidar'),
                h('td', { key: 'v', className: 'pt-6 font-headline text-primary text-right text-h1' }, fmt(totalComision).replace('.00', '')),
              ])),
            ]),
          ]),
        ]),

      ]));
  }

  function kpi(label, value, icon, delta, deltaCls, gold) {
    return h('div', { key: label, className: CARD + ' p-6' + (gold ? ' border-l-4 border-l-secondary' : '') }, [
      h('p', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant uppercase tracking-wider mb-2' }, label),
      h('h3', { key: 'v', className: 'font-headline text-headline-lg text-primary' }, value),
      h('div', { key: 'd', className: 'mt-4 flex items-center gap-1 text-caption font-bold ' + (deltaCls || 'text-on-surface-variant') }, [
        h(MS, { key: 'i', name: icon, size: 16 }), h('span', { key: 's' }, delta),
      ]),
    ]);
  }

  window.ReportsScreen = ReportsScreen;
})();
