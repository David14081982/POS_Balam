// dashboard.jsx — Panel de control (sistema unificado). Exporta window.DashboardScreen
(function () {
  const { fmt, Badge, StatusBadge } = window.UI;
  const { MS, ProductImage } = window.HX;
  const D = window.DATA;
  const h = React.createElement;

  const CARD = 'bg-surface-container-lowest rounded-lg shadow-e1';
  const CARD_INT = CARD + ' hover:shadow-e2 transition-shadow';
  const OVERLINE = 'text-overline text-muted';

  // Imagen decorativa del banner (bordado Heritage — embebida vía __IMG_MAP → offline)
  const BANNER_IMG = 'https://lh3.googleusercontent.com/aida-public/AB6AXuAl2JC_UU8z37TP3sNY-qHinm2p5UswTgFKhukJOrvlPCQXoCsGJGSO7lwd71uHlCL0TIkrHYbLeehidQDdzj_xN-vTy8sxz_CFtm2HRauWLYT0Tc0AkvlJbWcfe88a10XbQX4r-pX61ZxpHoUoVMOkLcfXBJ2BgdcBsYlncy8e3K-TTmM9k7xxqewNNdh3iGMCSMzt3wq8qyB2xgprumQdc9KrIR4lucMtxe9ZsRtJnDd4KL5lGi_l8lWmqThKdE5izNVS8yIHTMM';

  const DOW = ['DOM', 'LUN', 'MAR', 'MIE', 'JUE', 'VIE', 'SAB'];
  // Actividad real: total vendido por día en los últimos 7 días.
  function semanaReal() {
    const hoy = new Date(), p = n => String(n).padStart(2, '0');
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoy); d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      const tot = D.sales.filter(s => String(s.fecha).startsWith(key) && s.estado !== 'Cancelado').reduce((a, s) => a + s.total, 0);
      out.push({ d: DOW[d.getDay()], total: tot });
    }
    const maxTot = Math.max(1, ...out.map(x => x.total));
    return out.map(x => ({ d: x.d, pct: Math.round(x.total / maxTot * 100) }));
  }

  function DashboardScreen({ onNav }) {
    const SEMANA = semanaReal();
    const maxPct = Math.max(1, ...SEMANA.map(x => x.pct));
    const maxFecha = D.sales.reduce((m, s) => s.fecha.slice(0, 10) > m ? s.fecha.slice(0, 10) : m, '');
    const hoy = D.sales.filter(s => s.fecha.startsWith(maxFecha) && s.estado !== 'Cancelado');
    const ventasHoy = hoy.reduce((a, s) => a + s.total, 0);
    const promedio = hoy.length ? Math.round(ventasHoy / hoy.length) : 0;
    const low = window.CONFIG.get('stock.lowThreshold') || 4;
    const estrella = D.products.find(p => p.pop) || D.products[0];
    const criticos = D.products.filter(p => D.totalStock(p) <= low);
    const apartados = D.sales.filter(s => s.estado === 'Apartado');
    const saludInv = D.products.length ? Math.round((D.products.length - criticos.length) / D.products.length * 100) : 100;
    // Piezas vendidas del modelo estrella (de ventas con líneas reales).
    const ventasEstrella = estrella ? D.sales.reduce((a, s) => a + (s.lineas || []).filter(l => l.sku === estrella.sku).reduce((b, l) => b + (l.qty || 0), 0), 0) : 0;

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'p-10 max-w-[1280px] mx-auto space-y-8' }, [

        // Banner
        h('section', { key: 'b', className: 'relative overflow-hidden rounded-xl bg-primary-container p-8 text-on-primary flex justify-between items-center' }, [
          // Imagen decorativa derecha (~40%, full height) — oculta en móvil
          h('div', { key: 'img', className: 'hidden md:block absolute right-0 top-0 h-full w-2/5 pointer-events-none select-none' }, [
            h('img', { key: 'i', src: (window.__IMG_MAP && window.__IMG_MAP[BANNER_IMG]) || BANNER_IMG, alt: '', 'aria-hidden': true, className: 'w-full h-full object-cover opacity-90' }),
            h('div', { key: 'g', className: 'absolute inset-0', style: { background: 'linear-gradient(to right, #1E293B 0%, rgba(30,41,59,0.55) 45%, rgba(30,41,59,0) 100%)' } }),
          ]),
          h('div', { key: 'c', className: 'relative z-10 space-y-4 max-w-lg' }, [
            h('div', { key: 't', className: 'space-y-1' }, [
              h('h2', { key: 'a', className: 'font-headline text-h1' }, 'Buenos días, Juan'),
              h('p', { key: 'b', className: 'text-body text-on-primary/70' }, [
                'Hoy tienes ', h('span', { key: 's', className: 'text-on-primary font-semibold' }, `${apartados.length} apartado(s)`),
                ' y ', h('span', { key: 'c', className: 'text-on-primary font-semibold' }, `${criticos.length} modelo(s)`), ' con stock crítico.',
              ]),
            ]),
            h('div', { key: 'bt', className: 'flex gap-3' }, [
              h('button', { key: 'a', className: 'bg-surface text-primary px-5 py-2 rounded-md text-body-strong hover:opacity-90 transition-opacity shadow-e1', onClick: () => onNav && onNav('reportes') }, 'Revisar pendientes'),
              h('button', { key: 'b', className: 'bg-on-primary/10 border border-on-primary/20 text-on-primary px-5 py-2 rounded-md text-body-strong hover:bg-on-primary/20 transition-colors', onClick: () => onNav && onNav('inventario') }, 'Ver catálogo'),
            ]),
          ]),
        ]),

        // Métricas
        h('div', { key: 'm', className: 'grid grid-cols-1 md:grid-cols-4 gap-6' }, [
          metric('Ventas hoy', fmt(ventasHoy).replace('.00', ''), 'success', '+12.5%', [h('span', { key: 'd', className: 'w-1.5 h-1.5 rounded-full bg-success' }), 'Actualizado hace 5 min']),
          metric('Tickets', String(hoy.length), 'neutral', 'Estable', 'Promedio: ' + fmt(promedio).replace('.00', '') + ' / ticket'),
          metric('Favorito', estrella ? estrella.nombre : '—', 'gold', 'Premium', ventasEstrella + ' vendidas este periodo', true),
          metric('Inventario', saludInv + '%', criticos.length ? 'warning' : 'success', criticos.length ? 'Revisar' : 'OK', criticos.length + ' alertas de stock bajo'),
        ]),

        // Gráfica + alertas
        h('div', { key: 'ch', className: 'grid grid-cols-12 gap-8' }, [
          h('div', { key: 'g', className: CARD + ' col-span-12 lg:col-span-8 p-8' }, [
            h('div', { key: 'h', className: 'flex justify-between items-center mb-10' }, [
              h('div', { key: 't' }, [
                h('h3', { key: 'a', className: 'text-h2 text-primary' }, 'Actividad de ventas'),
                h('p', { key: 'b', className: 'text-caption text-on-surface-variant' }, 'Rendimiento semanal del showroom'),
              ]),
              h('div', { key: 'sw', className: 'flex border border-outline-variant rounded-md overflow-hidden' }, [
                h('button', { key: 's', className: 'px-4 py-1.5 bg-surface-container-low text-caption font-semibold text-primary border-r border-outline-variant' }, 'Semanal'),
                h('button', { key: 'm', className: 'px-4 py-1.5 bg-surface text-caption font-medium text-on-surface-variant hover:bg-surface-container-low transition-colors' }, 'Mensual'),
              ]),
            ]),
            h('div', { key: 'bars', className: 'h-64 w-full flex items-end gap-6 px-2' },
              SEMANA.map(x => {
                const peak = x.pct === maxPct;
                return h('div', { key: x.d, className: 'flex-1 h-full flex flex-col justify-end items-center gap-4' }, [
                  h('div', { key: 'b', className: 'w-full rounded-sm transition-all ' + (peak ? 'bg-primary' : 'bg-surface-container-high hover:bg-outline cursor-pointer'), style: { height: x.pct + '%' } }),
                  h('span', { key: 'l', className: 'text-overline ' + (peak ? 'text-primary' : 'text-muted') }, x.d),
                ]);
              })),
          ]),
          h('div', { key: 'al', className: 'col-span-12 lg:col-span-4 space-y-6' }, [
            h('div', { key: 'cup', className: CARD + ' p-6 border-l-4 border-l-gold' }, [
              h('div', { key: 'h', className: 'flex items-center gap-2 mb-4' }, [
                h(MS, { key: 'i', name: 'cake', size: 20, fill: true, className: 'text-gold-text' }),
                h('h4', { key: 't', className: 'text-overline text-primary' }, 'Cumpleaños'),
              ]),
              h('div', { key: 'l', className: 'space-y-4' }, [cumple('Mateo Figueroa', 'Hoy', true), cumple('Elena Rodríguez', 'Mañana', false)]),
              h('button', { key: 'b', className: 'mt-6 w-full py-2 text-overline rounded bg-gold-soft text-gold-text hover:opacity-80 transition-opacity' }, 'Enviar felicitación'),
            ]),
            h('div', { key: 'stk', className: CARD + ' p-6 border-l-4 border-l-danger' }, [
              h('div', { key: 'h', className: 'flex items-center gap-2 mb-3' }, [
                h(MS, { key: 'i', name: 'alert', size: 20, className: 'text-danger' }),
                h('h4', { key: 't', className: 'text-overline text-primary' }, 'Stock crítico'),
              ]),
              h('p', { key: 'p', className: 'text-caption text-on-surface-variant leading-relaxed mb-4' }, `${criticos.length} modelo(s) están por debajo del mínimo de seguridad.`),
              h('button', { key: 'b', className: 'w-full bg-surface-container-low py-2.5 text-overline text-primary hover:bg-surface-container transition-colors rounded', onClick: () => onNav && onNav('inventario') }, 'Ver inventario'),
            ]),
          ]),
        ]),

        // Ventas recientes + acciones
        h('div', { key: 'rs', className: 'grid grid-cols-12 gap-8' }, [
          h('div', { key: 't', className: CARD + ' col-span-12 lg:col-span-9 overflow-hidden' }, [
            h('div', { key: 'h', className: 'p-6 border-b border-outline-variant' }, h('h3', { className: 'text-h2 text-primary' }, 'Ventas recientes')),
            h('div', { key: 'tw', className: 'overflow-x-auto' }, h('table', { className: 'w-full text-left' }, [
              h('thead', { key: 'h' }, h('tr', { className: 'bg-surface-container-low' },
                ['Cliente', 'Vendedor', 'Método', 'Estado', 'Total', ''].map((c, i) =>
                  h('th', { key: i, className: 'px-6 py-3.5 ' + OVERLINE + (c === 'Total' ? ' text-right' : '') }, c)))),
              h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, D.sales.slice(0, 5).map((s, i) =>
                h('tr', { key: s.folio, className: 'hover:bg-surface-container-low transition-colors' }, [
                  h('td', { key: 'c', className: 'px-6 py-4' }, h('div', { className: 'flex items-center gap-4' }, [
                    h(ProductImage, { key: 't', p: D.products[i % D.products.length], className: 'w-10 h-10 rounded border border-outline-variant' }),
                    h('div', { key: 'd' }, [
                      h('p', { key: 'n', className: 'text-body-strong text-primary' }, s.cliente),
                      h('p', { key: 'f', className: 'text-caption text-muted' }, s.folio + ' · ' + s.fecha.slice(0, 10)),
                    ]),
                  ])),
                  h('td', { key: 'v', className: 'px-6 py-4 text-body text-on-surface-variant' }, s.vendedor),
                  h('td', { key: 'm', className: 'px-6 py-4 text-body text-muted' }, s.metodo),
                  h('td', { key: 'e', className: 'px-6 py-4' }, h(StatusBadge, { estado: s.estado })),
                  h('td', { key: 't', className: 'px-6 py-4 text-right text-body-strong text-primary' }, fmt(s.total).replace('.00', '')),
                  h('td', { key: 'x', className: 'px-6 py-4' }, h('button', { className: 'text-muted hover:text-primary transition-colors' }, h(MS, { name: 'dots', size: 20 }))),
                ]))),
            ])),
          ]),
          h('div', { key: 'sa', className: 'col-span-12 lg:col-span-3 space-y-4' }, [
            action('add', 'Nueva venta', 'Checkout rápido', () => onNav && onNav('pos'), true),
            action('user', 'Registrar cliente', 'CRM Heritage', () => onNav && onNav('clientes'), false),
            h('div', { key: 'box', className: 'mt-4 p-6 rounded-lg bg-gold-soft flex flex-col items-center text-center' }, [
              h(MS, { key: 'i', name: 'badge', size: 24, className: 'mb-3 text-gold-text' }),
              h('p', { key: 't', className: 'text-body-strong text-primary mb-1' }, 'Pedidos a medida'),
              h('p', { key: 'd', className: 'text-caption text-on-surface-variant mb-5 px-2' }, '12 citas programadas para esta semana en el taller.'),
              h('a', { key: 'a', className: 'text-overline text-gold-text border-b border-gold pb-0.5 cursor-pointer' }, 'Gestionar taller'),
            ]),
          ]),
        ]),

      ]));
  }

  function metric(label, value, tone, badge, footer, big) {
    return h('div', { key: label, className: CARD_INT + ' p-6' }, [
      h('div', { key: 'h', className: 'flex justify-between items-center mb-4' }, [
        h('span', { key: 'l', className: OVERLINE }, label),
        h(Badge, { key: 'b', tone }, badge),
      ]),
      h('p', { key: 'v', className: 'font-headline text-primary truncate ' + (big ? 'text-h2' : 'text-h1') }, value),
      h('div', { key: 'f', className: 'mt-4 flex items-center gap-1.5 text-caption text-muted' }, footer),
    ]);
  }
  function cumple(nombre, cuando, hoy) {
    return h('div', { key: nombre, className: 'flex justify-between items-center' }, [
      h('span', { key: 'n', className: 'text-body text-on-surface font-medium' }, nombre),
      h('span', { key: 'c', className: hoy ? 'text-overline text-success' : 'text-caption text-muted' }, cuando),
    ]);
  }
  function action(icon, title, sub, onClick, gold) {
    return h('button', { key: title, className: CARD_INT + ' w-full flex items-center gap-4 p-5 group', onClick }, [
      h('div', {
        key: 'i', className: 'w-9 h-9 rounded-md flex items-center justify-center shrink-0 ' + (gold ? 'bg-gold text-on-gold' : 'bg-surface-container-low text-primary group-hover:bg-primary group-hover:text-on-primary transition-colors'),
      }, h(MS, { name: icon, size: 20 })),
      h('div', { key: 't', className: 'text-left' }, [
        h('p', { key: 'a', className: 'text-body-strong text-primary' }, title),
        h('p', { key: 'b', className: 'text-caption text-muted' }, sub),
      ]),
    ]);
  }

  window.DashboardScreen = DashboardScreen;
})();
