// reports.jsx — Reportes / Analítica (Heritage Luxury). Exporta window.ReportsScreen
(function () {
  const { useState } = React;
  const { fmt, toast, StatusBadge } = window.UI;
  const { MS, ProductImage } = window.HX;
  const D = window.DATA;
  const h = React.createElement;
  const GOLD_GRAD = 'linear-gradient(135deg, #92760F 0%, #D4AF38 100%)';

  const CARD = 'bg-surface-container-lowest rounded-xl shadow-e1';

  function ResumenReport({ onNav }) {
    const marginPct = window.CONFIG.get('report.marginPct') || 33;
    const parse = f => { const d = new Date(String(f || '').replace(' ', 'T')); return isNaN(d) ? null : d; };
    const nonCancel = D.sales.filter(s => s.estado !== 'Cancelado');
    const periodoLbl = new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

    // KPIs — 100% reales (sin históricos ni metas inventadas)
    const ventasBrutas = nonCancel.reduce((a, s) => a + (Number(s.total) || 0), 0);
    const utilidad = Math.round(ventasBrutas * (marginPct / 100));
    const pedidos = nonCancel.length;
    const ticketProm = pedidos ? Math.round(ventasBrutas / pedidos) : 0;

    // Variación real: mes calendario actual vs mes anterior (oculta si no hay base previa)
    const ymOf = d => d.getFullYear() * 12 + d.getMonth();
    const curYM = ymOf(new Date());
    const monthAgg = off => nonCancel.reduce((acc, s) => { const d = parse(s.fecha); if (d && ymOf(d) === curYM - off) { acc.tot += Number(s.total) || 0; acc.n += 1; } return acc; }, { tot: 0, n: 0 });
    const m0 = monthAgg(0), m1 = monthAgg(1);
    const pctMoM = (cur, prev) => prev > 0 ? Math.round((cur - prev) / prev * 100) : null;
    const mom = pct => pct == null ? ['', 'text-on-surface-variant', 'trending_up'] : [(pct >= 0 ? '+' : '') + pct + '% vs mes anterior', pct >= 0 ? 'text-success' : 'text-danger', pct >= 0 ? 'trending_up' : 'trending_down'];
    const [tV, cV, iV] = mom(pctMoM(m0.tot, m1.tot)), [tP, cP, iP] = mom(pctMoM(m0.n, m1.n));

    // Meta global (equipo) — guardas contra meta=0 (evita NaN/Infinity y "100%" falso)
    const teamVentas = D.sellers.reduce((a, s) => a + (Number(s.ventasMes) || 0), 0);
    const teamMeta = D.sellers.reduce((a, s) => a + (Number(s.metaMes) || 0), 0);
    const avance = teamMeta > 0 ? Math.min(100, Math.round(teamVentas / teamMeta * 100)) : 0;
    const falta = Math.max(0, teamMeta - teamVentas);
    const R = 70, CIRC = 2 * Math.PI * R, offset = CIRC * (1 - avance / 100);

    // Top categorías por VENTAS reales (de las líneas de venta, no proxy de inventario)
    const catRev = {};
    nonCancel.forEach(s => (s.lineas || []).forEach(l => { const p = D.products.find(x => x.sku === l.sku); if (p) catRev[p.cat] = (catRev[p.cat] || 0) + (Number(l.precio) || 0) * (Number(l.qty) || 0); }));
    const cats = Object.entries(catRev).map(([cat, rev]) => ({ cat, rev, img: D.products.find(x => x.cat === cat) }))
      .sort((a, b) => b.rev - a.rev).slice(0, 3);
    const maxRev = cats.length ? cats[0].rev : 1;

    // Comisiones (reales)
    const topVend = [...D.sellers].sort((a, b) => b.ventasMes - a.ventasMes);
    const totalComision = D.sellers.reduce((a, s) => a + (Number(s.comisionAcum) || 0), 0);

    // Ventas por semana (últimas 6) — reales
    const nowD = new Date();
    const weekly = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(nowD); start.setHours(0, 0, 0, 0); start.setDate(nowD.getDate() - (i * 7 + 6));
      const end = new Date(nowD); end.setHours(23, 59, 59, 999); end.setDate(nowD.getDate() - i * 7);
      const tot = nonCancel.reduce((a, s) => { const d = parse(s.fecha); return (d && d >= start && d <= end) ? a + (Number(s.total) || 0) : a; }, 0);
      weekly.push({ s: 'S' + (6 - i), total: tot });
    }
    const maxW = Math.max(1, ...weekly.map(w => w.total));

    return h(React.Fragment, null, [

        // Acciones
        h('div', { key: 'act', className: 'flex justify-end gap-3 mb-8' }, [
          h('button', { key: 'm', className: 'flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container-low transition-all text-body font-semibold', onClick: () => { const subj = encodeURIComponent(`Reporte Balam — ${periodoLbl}`); const body = encodeURIComponent(`Resumen ${periodoLbl}\n\nVentas brutas: ${fmt(ventasBrutas)}\nUtilidad neta: ${fmt(utilidad)}\nTotal pedidos: ${pedidos}\nTicket promedio: ${fmt(ticketProm)}\nComisiones a liquidar: ${fmt(totalComision)}`); window.location.href = `mailto:?subject=${subj}&body=${body}`; } }, [h(MS, { key: 'i', name: 'mail', size: 16 }), 'Enviar por correo']),
          h('button', { key: 'p', className: 'flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container-low transition-all text-body font-semibold', onClick: () => window.print() }, [h(MS, { key: 'i', name: 'print', size: 16 }), 'Imprimir']),
          h('button', { key: 'e', className: 'flex items-center gap-2 px-6 py-2 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-all text-body font-semibold shadow-e2', onClick: () => { toast('Abriendo impresión — elige "Guardar como PDF"'); setTimeout(() => window.print(), 350); } }, [h(MS, { key: 'i', name: 'download', size: 16 }), 'Exportar PDF']),
        ]),

        // KPIs
        h('div', { key: 'kpi', className: 'grid grid-cols-1 md:grid-cols-4 gap-gutter mb-gutter' }, [
          kpi('Ventas brutas', fmt(ventasBrutas).replace('.00', ''), iV, tV, cV),
          kpi('Utilidad neta', fmt(utilidad).replace('.00', ''), iV, tV, cV),
          kpi('Total pedidos', String(pedidos), iP, tP, cP),
          kpi('Ticket promedio', fmt(ticketProm).replace('.00', ''), 'star', '', 'text-gold-text', true),
        ]),

        // Gráfica + Meta global
        h('div', { key: 'mid', className: 'grid grid-cols-1 lg:grid-cols-3 gap-gutter' }, [
          // Rendimiento mensual
          h('div', { key: 'g', className: CARD + ' lg:col-span-2 p-8 flex flex-col' }, [
            h('div', { key: 'h', className: 'flex justify-between items-start mb-8' }, [
              h('div', { key: 't' }, [
                h('h4', { key: 'a', className: 'font-headline text-headline-md text-primary' }, 'Ventas por semana'),
                h('p', { key: 'b', className: 'text-on-surface-variant text-body' }, 'Ingresos realizados · últimas 6 semanas'),
              ]),
              h('span', { key: 's', className: 'text-caption text-on-surface-variant font-semibold' }, fmt(weekly.reduce((a, w) => a + w.total, 0)).replace('.00', '')),
            ]),
            h('div', { key: 'bars', className: 'flex-grow flex items-end justify-between gap-4 h-64 px-4 border-b border-outline-variant mb-4' },
              weekly.map(x => h('div', { key: x.s, className: 'flex flex-col items-center w-full h-full justify-end gap-2 group' }, [
                h('span', { key: 'v', className: 'text-overline text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap' }, fmt(x.total).replace('.00', '')),
                h('div', { key: 'b', className: 'w-full rounded-t-lg transition-all', style: { height: Math.max(2, Math.round(x.total / maxW * 100)) + '%', background: GOLD_GRAD } }),
                h('span', { key: 'l', className: 'text-overline text-on-surface-variant font-bold' }, x.s),
              ]))),
            h('div', { key: 'leg', className: 'flex gap-6' },
              h('div', { key: 'r', className: 'flex items-center gap-2' }, [h('div', { className: 'w-3 h-3 rounded-full', style: { background: GOLD_GRAD } }), h('span', { className: 'text-caption text-on-surface-variant' }, 'Realizado')])),
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
              h('p', { key: 'f', className: 'mt-6 text-body text-on-primary-container font-light' }, teamMeta > 0
                ? ['Faltan ', h('span', { key: 's', className: 'text-gold font-bold' }, fmt(falta).replace('.00', '')), ' para la meta del equipo.']
                : 'Define metas de venta en Vendedores para medir el avance.'),
            ]),
            h('button', { key: 'b', className: 'w-full py-3 bg-gold text-on-gold rounded-lg font-bold text-body uppercase tracking-wider hover:opacity-90 transition-all', onClick: () => onNav && onNav('vendedores') }, 'Impulsar ventas'),
          ]),
        ]),

        // Top categorías + Comisiones
        h('div', { key: 'bot', className: 'grid grid-cols-1 lg:grid-cols-2 gap-gutter mt-gutter' }, [
          h('div', { key: 'cats', className: CARD + ' p-8' }, [
            h('h4', { key: 't', className: 'font-headline text-headline-md text-primary mb-6' }, 'Top categorías'),
            h('div', { key: 'l', className: 'space-y-6' }, cats.length ? cats.map(c => h('div', { key: c.cat, className: 'flex items-center gap-4' }, [
              h(ProductImage, { key: 'i', p: c.img, className: 'w-16 h-16 rounded-lg shrink-0 shadow-e1 border border-outline-variant/30' }),
              h('div', { key: 'd', className: 'flex-grow' }, [
                h('div', { key: 'r', className: 'flex justify-between items-center mb-1' }, [
                  h('span', { key: 'n', className: 'font-bold text-body' }, D.CAT[c.cat] || c.cat),
                  h('span', { key: 'v', className: 'text-primary font-bold' }, fmt(c.rev).replace('.00', '')),
                ]),
                h('div', { key: 'b', className: 'w-full bg-surface-container h-1.5 rounded-full' }, h('div', { className: 'bg-primary h-full rounded-full', style: { width: (c.rev / maxRev * 100) + '%' } })),
              ]),
            ])) : emptyHint('Sin ventas registradas aún.')),
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

      ]);
  }

  function kpi(label, value, icon, delta, deltaCls, gold) {
    return h('div', { key: label, className: CARD + ' p-6' + (gold ? ' border-l-4 border-l-secondary' : '') }, [
      h('p', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant uppercase tracking-wider mb-2' }, label),
      h('h3', { key: 'v', className: 'font-headline text-headline-lg text-primary' }, value),
      delta && h('div', { key: 'd', className: 'mt-4 flex items-center gap-1 text-caption font-bold ' + (deltaCls || 'text-on-surface-variant') }, [
        h(MS, { key: 'i', name: icon, size: 16 }), h('span', { key: 's' }, delta),
      ]),
    ]);
  }

  // ── Shell con pestañas: Resumen | Devoluciones ─────────────────────────────────
  function ReportsScreen({ onNav }) {
    const [tab, setTab] = useState('resumen');
    const TABS = [['resumen', 'Resumen', 'chart'], ['ventas', 'Ventas', 'cash'], ['devoluciones', 'Devoluciones', 'undo']];
    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'p-10 max-w-container-max mx-auto' }, [
        h('div', { key: 'tabs', className: 'inline-flex items-center gap-2 p-1.5 mb-8 bg-surface-container-low rounded-xl border border-outline-variant' },
          TABS.map(([id, label, icon]) => h('button', {
            key: id, onClick: () => setTab(id),
            className: 'flex items-center gap-2 px-6 py-2.5 rounded-lg text-caption font-bold uppercase tracking-wider transition-all ' +
              (tab === id ? 'bg-primary text-on-primary shadow-e2' : 'text-on-surface-variant hover:text-primary hover:bg-surface-container'),
          }, [h(MS, { key: 'i', name: icon, size: 18 }), label]))),
        tab === 'ventas' ? h(SalesReport, { key: 'ven' })
          : tab === 'devoluciones' ? h(ReturnsReport, { key: 'dev' })
            : h(ResumenReport, { key: 'res', onNav }),
      ]));
  }

  // ── Tarjeta de métrica y chip de variación (reutilizables en el reporte) ───────
  function metricCard(label, value, sub, extra, accent) {
    return h('div', { key: label, className: CARD + ' p-6' + (accent ? ' border-l-4 border-l-primary' : '') }, [
      h('p', { key: 'l', className: 'text-caption font-semibold text-on-surface-variant uppercase tracking-wider mb-2' }, label),
      h('div', { key: 'v', className: 'flex items-end justify-between gap-2' }, [
        h('h3', { key: 'a', className: 'font-headline text-headline-md text-primary leading-tight' }, value),
        extra || null,
      ]),
      sub && h('p', { key: 's', className: 'text-caption text-on-surface-variant mt-3' }, sub),
    ]);
  }
  // Variación. betterDown=true (devoluciones): MÁS es peor (rojo). betterDown=false (ventas): MÁS es mejor (verde).
  function deltaChip(pct, betterDown = true) {
    const flat = pct === 0, up = pct > 0;
    const good = betterDown ? !up : up;
    const cls = flat ? 'text-on-surface-variant' : (good ? 'text-success' : 'text-danger');
    const icon = flat ? 'horizontal_rule' : (up ? 'trending_up' : 'trending_down');
    return h('span', { key: 'd', className: 'inline-flex items-center gap-1 text-caption font-bold mb-1 ' + cls }, [h(MS, { key: 'i', name: icon, size: 16 }), (up ? '+' : '') + pct + '%']);
  }
  function emptyHint(msg) { return h('div', { className: 'text-center text-on-surface-variant py-12 text-body' }, msg); }

  // ── Reporte de Devoluciones (datos en vivo de D.returns) ───────────────────────
  function ReturnsReport() {
    const [range, setRange] = useState('30');
    const [motivo, setMotivo] = useState('');
    const [cat, setCat] = useState('');
    const [page, setPage] = useState(1);

    const C = window.CONFIG;
    const reasons = C.list('return_reason');
    const cats = C.list('category');
    const motivoLabel = (code) => { const it = C.find('return_reason', code); return (it && it.label) || code || '—'; };
    const RANGES = [['30', '30 días'], ['trimestre', 'Trimestre'], ['año', 'Año'], ['todo', 'Todo']];
    const DAYS = { '30': 30, 'trimestre': 90, 'año': 365 };
    const parse = f => { const d = new Date(String(f || '').replace(' ', 'T')); return isNaN(d) ? null : d; };
    const now = Date.now();
    // mult=1 periodo actual; mult=2 periodo inmediato anterior (para variación)
    const inWin = (f, mult = 1) => {
      if (range === 'todo') return mult === 1;
      const d = parse(f); if (!d) return false;
      const span = DAYS[range] * 86400000, age = now - d.getTime();
      return mult === 1 ? (age >= 0 && age <= span) : (age > span && age <= 2 * span);
    };

    const periodReturns = D.returns.filter(r => inWin(r.fecha));
    const prevReturns = D.returns.filter(r => inWin(r.fecha, 2));
    const flat = (list) => {
      const out = [];
      list.forEach(r => (r.lineas || []).forEach(l => {
        const prod = D.products.find(p => p.sku === l.sku);
        out.push({ id: r.id + '|' + l.sku + '|' + l.talla, fecha: r.fecha, folio: r.folio, cliente: r.cliente, metodo: r.metodo, sku: l.sku, nombre: l.nombre, talla: l.talla, qty: Number(l.qty) || 0, motivo: l.motivo, motivoLabel: motivoLabel(l.motivo), monto: (Number(l.precio) || 0) * (Number(l.qty) || 0), cat: prod ? prod.cat : null, estatus: 'Reingresado', prod });
      }));
      return out;
    };
    const periodRows = flat(periodReturns);

    // Métricas del periodo
    const totalDev = periodReturns.length, prevDev = prevReturns.length;
    const piezas = periodRows.reduce((a, r) => a + r.qty, 0);
    const totalReemb = periodReturns.reduce((a, r) => a + (Number(r.total) || 0), 0);
    const prevReemb = prevReturns.reduce((a, r) => a + (Number(r.total) || 0), 0);
    const ventasPeriodo = D.sales.filter(s => s.estado !== 'Cancelado' && inWin(s.fecha)).reduce((a, s) => a + (Number(s.total) || 0), 0);
    const tasa = ventasPeriodo > 0 ? (totalReemb / ventasPeriodo * 100) : 0;
    const porMotivo = {};
    periodRows.forEach(r => { porMotivo[r.motivo] = (porMotivo[r.motivo] || 0) + r.qty; });
    const dist = reasons.map(rs => ({ code: rs.code, label: rs.label, n: porMotivo[rs.code] || 0 }))
      .concat(Object.keys(porMotivo).filter(c => c && !reasons.some(rs => rs.code === c)).map(c => ({ code: c, label: motivoLabel(c), n: porMotivo[c] })))
      .sort((a, b) => b.n - a.n);
    const maxN = dist.reduce((m, x) => Math.max(m, x.n), 0) || 1;
    const principal = dist[0] && dist[0].n > 0 ? dist[0] : null;
    const principalPct = principal && piezas > 0 ? Math.round(principal.n / piezas * 100) : 0;
    const deltaPct = (cur, prev) => prev > 0 ? Math.round((cur - prev) / prev * 100) : (cur > 0 ? 100 : 0);

    // Tabla (filtros motivo/categoría + orden + paginación)
    const filtered = periodRows
      .filter(r => !motivo || r.motivo === motivo)
      .filter(r => !cat || r.cat === cat)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const PER = 12, pages = Math.max(1, Math.ceil(filtered.length / PER)), pg = Math.min(page, pages);
    const slice = filtered.slice((pg - 1) * PER, pg * PER);

    const sel = (value, onChange, opts) => h('select', { value, onChange: e => { onChange(e.target.value); setPage(1); }, className: 'bg-surface-container-low border-none rounded-lg text-caption font-semibold px-3 py-2 focus:ring-1 focus:ring-primary' }, opts.map(([v, l]) => h('option', { key: v, value: v }, l)));

    if (!D.returns.length) {
      return h('div', { className: CARD + ' p-12 text-center' }, [
        h('div', { key: 'i', className: 'w-14 h-14 mx-auto mb-4 rounded-full grid place-items-center bg-surface-container text-on-surface-variant' }, h(MS, { name: 'undo', size: 28 })),
        h('h3', { key: 't', className: 'font-headline text-headline-md text-primary mb-1' }, 'Aún no hay devoluciones'),
        h('p', { key: 'd', className: 'text-body text-on-surface-variant' }, 'Cuando registres devoluciones en la pantalla de Devoluciones, aquí verás las métricas y el historial.'),
      ]);
    }

    return h(React.Fragment, null, [
      // Encabezado + rango + exportar
      h('div', { key: 'hd', className: 'flex flex-wrap justify-between items-end gap-4 mb-8' }, [
        h('div', { key: 't' }, [
          h('h2', { key: 'a', className: 'font-headline text-headline-lg text-primary' }, 'Reporte de devoluciones'),
          h('p', { key: 'b', className: 'text-on-surface-variant text-body mt-1 max-w-xl' }, 'Métricas e historial en vivo de los retornos registrados.'),
        ]),
        h('div', { key: 'r', className: 'flex items-center gap-3' }, [
          h('button', { key: 'x', className: 'flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg hover:opacity-90 transition text-body font-semibold shadow-e2', onClick: () => { if (!filtered.length) { toast('No hay devoluciones para exportar', 'var(--danger)'); return; } window.XLSXIO.exportReturns(filtered); } }, [h(MS, { key: 'i', name: 'download', size: 16 }), 'Exportar Excel']),
          h('div', { key: 'seg', className: 'inline-flex bg-surface-container-low p-1 rounded-lg' }, RANGES.map(([id, label]) => h('button', { key: id, onClick: () => { setRange(id); setPage(1); }, className: 'px-3.5 py-1.5 rounded-md text-caption font-semibold transition-colors ' + (range === id ? 'text-primary shadow-e1' : 'text-on-surface-variant hover:text-primary'), style: range === id ? { background: '#fff' } : null }, label))),
        ]),
      ]),

      // Tarjetas de métrica
      h('div', { key: 'cards', className: 'grid grid-cols-1 md:grid-cols-4 gap-gutter mb-gutter' }, [
        metricCard('Total devoluciones', String(totalDev), `${piezas} ${piezas === 1 ? 'pieza' : 'piezas'} en el periodo`, range !== 'todo' && deltaChip(deltaPct(totalDev, prevDev)), true),
        metricCard('Tasa de devolución', tasa.toFixed(1) + '%', ventasPeriodo > 0 ? 'sobre ventas del periodo' : 'sin ventas en el periodo'),
        metricCard('Motivo principal', principal ? principal.label : '—', principal ? `${principalPct}% de las piezas` : 'sin datos'),
        h('div', { key: 'reemb', className: 'rounded-xl p-6 bg-primary-container text-on-primary' }, [
          h('p', { key: 'l', className: 'text-caption font-semibold uppercase tracking-wider mb-2 text-on-primary-container' }, 'Total reembolsado'),
          h('h3', { key: 'v', className: 'font-headline text-headline-md text-white' }, fmt(totalReemb).replace('.00', '')),
          h('p', { key: 's', className: 'text-caption mt-3 text-on-primary-container' }, range === 'todo' ? 'histórico completo' : `${deltaPct(totalReemb, prevReemb) >= 0 ? '+' : ''}${deltaPct(totalReemb, prevReemb)}% vs periodo anterior`),
        ]),
      ]),

      // Distribución por motivo
      h('div', { key: 'chart', className: CARD + ' p-8 mb-gutter' }, [
        h('div', { key: 'h', className: 'flex justify-between items-center mb-8' }, [
          h('h4', { key: 't', className: 'font-headline text-headline-md text-primary' }, 'Distribución por motivo'),
          h('span', { key: 's', className: 'text-caption text-on-surface-variant' }, `${piezas} ${piezas === 1 ? 'pieza' : 'piezas'}`),
        ]),
        piezas > 0
          ? h('div', { key: 'bars', className: 'flex items-end justify-around gap-6 px-2 pt-6' }, dist.filter(d => d.n > 0).map(d => h('div', { key: d.code, className: 'flex flex-col items-center gap-2 flex-1' }, [
            h('span', { key: 'n', className: 'text-caption font-bold text-primary' }, d.n),
            h('div', { key: 'b', className: 'w-full max-w-[60px] rounded-t-md', style: { height: Math.round(d.n / maxN * 180) + 'px', minHeight: '6px', background: GOLD_GRAD } }),
            h('span', { key: 'l', className: 'text-overline uppercase text-on-surface-variant text-center leading-tight' }, d.label),
          ])))
          : emptyHint('Sin devoluciones en el periodo seleccionado.'),
      ]),

      // Historial + filtros
      h('div', { key: 'tbl', className: CARD + ' overflow-hidden' }, [
        h('div', { key: 'h', className: 'p-6 border-b border-outline-variant flex flex-wrap items-center justify-between gap-4' }, [
          h('h4', { key: 't', className: 'font-headline text-headline-md text-primary' }, 'Historial de devoluciones'),
          h('div', { key: 'f', className: 'flex items-center gap-3' }, [
            sel(cat, setCat, [['', 'Todas las categorías']].concat(cats.map(c => [c.code, c.label]))),
            sel(motivo, setMotivo, [['', 'Todos los motivos']].concat(reasons.map(r => [r.code, r.label]))),
          ]),
        ]),
        filtered.length
          ? h('div', { key: 'wrap', className: 'overflow-x-auto' }, h('table', { className: 'w-full text-left' }, [
            h('thead', { key: 'thd' }, h('tr', { className: 'bg-surface-container-low border-b border-outline-variant' },
              ['Fecha', 'Folio', 'Producto', 'SKU', 'Talla', 'Motivo', 'Reembolso', 'Inventario'].map((c, i) => h('th', { key: i, className: 'px-5 py-3 text-overline font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap' + (c === 'Reembolso' ? ' text-right' : '') }, c)))),
            h('tbody', { key: 'tb', className: 'divide-y divide-outline-variant/40' }, slice.map(r => h('tr', { key: r.id, className: 'hover:bg-surface-container-lowest transition-colors' }, [
              h('td', { key: 'f', className: 'px-5 py-3 text-body whitespace-nowrap' }, String(r.fecha || '').slice(0, 10)),
              h('td', { key: 'fo', className: 'px-5 py-3 font-mono text-caption text-primary whitespace-nowrap' }, r.folio),
              h('td', { key: 'p', className: 'px-5 py-3' }, h('div', { className: 'flex items-center gap-3 min-w-[180px]' }, [
                r.prod ? h(ProductImage, { key: 'i', p: r.prod, className: 'w-9 h-9 rounded shrink-0' }) : h('div', { key: 'i', className: 'w-9 h-9 rounded bg-surface-container shrink-0' }),
                h('span', { key: 'n', className: 'text-body font-medium' }, r.nombre),
              ])),
              h('td', { key: 's', className: 'px-5 py-3 text-caption text-on-surface-variant whitespace-nowrap' }, r.sku),
              h('td', { key: 't', className: 'px-5 py-3 text-body' }, r.talla),
              h('td', { key: 'm', className: 'px-5 py-3' }, h('span', { className: 'bg-surface-container px-2 py-1 rounded text-overline font-bold uppercase text-on-surface-variant whitespace-nowrap' }, r.motivoLabel)),
              h('td', { key: 'r', className: 'px-5 py-3 text-right text-body font-semibold text-gold-text whitespace-nowrap' }, fmt(r.monto).replace('.00', '')),
              h('td', { key: 'in', className: 'px-5 py-3' }, h('div', { className: 'flex items-center gap-1.5 text-success' }, [h(MS, { key: 'i', name: 'check_circle', size: 18, fill: true }), h('span', { key: 'l', className: 'text-caption whitespace-nowrap' }, 'Reingresado')])),
            ]))),
          ]))
          : emptyHint('No hay devoluciones que coincidan con los filtros.'),
        filtered.length > PER && h('div', { key: 'pg', className: 'px-6 py-4 bg-surface-container-low flex justify-between items-center' }, [
          h('p', { key: 'i', className: 'text-caption text-on-surface-variant' }, `Mostrando ${(pg - 1) * PER + 1}–${Math.min(pg * PER, filtered.length)} de ${filtered.length}`),
          h('div', { key: 'n', className: 'flex items-center gap-2' }, [
            h('button', { key: 'p', disabled: pg <= 1, onClick: () => setPage(pg - 1), className: 'w-8 h-8 grid place-items-center rounded border border-outline-variant hover:bg-white transition-colors disabled:opacity-40' }, h(MS, { name: 'chevLeft', size: 18 })),
            h('span', { key: 'c', className: 'px-2 text-caption font-bold' }, `${pg} / ${pages}`),
            h('button', { key: 'x', disabled: pg >= pages, onClick: () => setPage(pg + 1), className: 'w-8 h-8 grid place-items-center rounded border border-outline-variant hover:bg-white transition-colors disabled:opacity-40' }, h(MS, { name: 'chevRight', size: 18 })),
          ]),
        ]),
      ]),
    ]);
  }

  // ── Reporte de Ventas (datos en vivo de D.sales) ───────────────────────────────
  function SalesReport() {
    const C = window.CONFIG;
    const sellersList = D.sellers.filter(s => s.active !== false);
    const statuses = C.list('sale_status');
    const parse = f => { const d = new Date(String(f || '').replace(' ', 'T')); return isNaN(d) ? null : d; };
    const isoDay = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }; // fecha LOCAL (no UTC)
    const DEF_FROM = isoDay(Date.now() - 30 * 86400000), DEF_TO = isoDay(Date.now());
    const [from, setFrom] = useState(DEF_FROM); // desde (YYYY-MM-DD)
    const [to, setTo] = useState(DEF_TO);       // hasta (YYYY-MM-DD)
    const [vend, setVend] = useState('');       // filtro por vendedor (id)
    const [estado, setEstado] = useState('');   // filtro por estado de venta
    const [page, setPage] = useState(1);

    // Ventana por rango de fechas. El "periodo previo" es la misma longitud justo antes de 'desde'.
    const fromT = from ? new Date(from + 'T00:00:00').getTime() : null;
    const toT = to ? new Date(to + 'T23:59:59').getTime() : null;
    const span = (fromT != null && toT != null) ? (toT - fromT) : null;
    const inWin = (f, mult = 1) => {
      const d = parse(f); if (!d) return false;
      const t = d.getTime();
      if (mult === 1) return (fromT == null || t >= fromT) && (toT == null || t <= toT);
      if (fromT == null || span == null) return false;
      return t >= fromT - span && t < fromT;
    };
    const clearFilters = () => { setFrom(DEF_FROM); setTo(DEF_TO); setVend(''); setEstado(''); setPage(1); };

    // Helpers de venta (compatibles con ventas reales y semilla)
    const sellerNames = (s) => {
      if (s.vendedores && s.vendedores.length) return s.vendedores.map(id => (D.sellers.find(x => x.id === id) || {}).nombre).filter(Boolean);
      return (s.vendedor && s.vendedor !== '—') ? [s.vendedor] : [];
    };
    const matchesVend = (s) => {
      if (!vend) return true;
      const sv = D.sellers.find(x => x.id === vend); if (!sv) return true;
      if (s.vendedores && s.vendedores.length) return s.vendedores.includes(vend);
      return s.vendedor === sv.nombre;
    };
    const isValid = s => s.estado !== 'Cancelado';
    const commOf = (s) => {
      if (!isValid(s)) return 0;
      if (typeof s.comision === 'number') return s.comision;
      const ids = (s.vendedores && s.vendedores.length) ? s.vendedores
        : (() => { const m = D.sellers.find(x => x.nombre === s.vendedor); return m ? [m.id] : []; })();
      if (!ids.length) return 0;
      const share = (Number(s.total) || 0) / ids.length;
      return ids.reduce((a, id) => { const sv = D.sellers.find(x => x.id === id); return a + (sv ? share * (sv.comisionPct || 0) / 100 : 0); }, 0);
    };
    const productLabel = (s) => {
      if (s.lineas && s.lineas.length) return s.lineas[0].nombre + (s.lineas.length > 1 ? ` +${s.lineas.length - 1}` : '');
      const n = Number(s.items) || 0; return `${n} ${n === 1 ? 'artículo' : 'artículos'}`;
    };

    const periodSales = D.sales.filter(s => inWin(s.fecha));
    const prevSales = D.sales.filter(s => inWin(s.fecha, 2));
    const validPeriod = periodSales.filter(isValid);
    const validPrev = prevSales.filter(isValid);

    // Métricas del periodo
    const totalVendido = validPeriod.reduce((a, s) => a + (Number(s.total) || 0), 0);
    const nVentas = validPeriod.length;
    const ticketProm = nVentas ? totalVendido / nVentas : 0;
    const comisiones = validPeriod.reduce((a, s) => a + commOf(s), 0);
    const prevVendido = validPrev.reduce((a, s) => a + (Number(s.total) || 0), 0);
    const prevN = validPrev.length;
    const deltaPct = (cur, prev) => prev > 0 ? Math.round((cur - prev) / prev * 100) : (cur > 0 ? 100 : 0);

    // Distribución: ventas ($) por vendedor
    const porVend = {};
    validPeriod.forEach(s => { const ns = sellerNames(s); const share = (Number(s.total) || 0) / Math.max(1, ns.length); ns.forEach(n => { porVend[n] = (porVend[n] || 0) + share; }); });
    const dist = Object.entries(porVend).map(([nombre, val]) => ({ nombre, val })).sort((a, b) => b.val - a.val);
    const maxV = dist.reduce((m, x) => Math.max(m, x.val), 0) || 1;

    // Tabla (filtros vendedor/estado + orden + paginación)
    const rows = periodSales
      .filter(matchesVend)
      .filter(s => !estado || s.estado === estado)
      .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
      .map(s => {
        const first = s.lineas && s.lineas[0];
        const prod = first ? D.products.find(p => p.sku === first.sku) : null;
        return { id: s.folio, fecha: s.fecha, folio: s.folio, cliente: s.cliente, producto: productLabel(s), vendedor: sellerNames(s).join(', ') || '—', metodo: s.metodo || '—', monto: Number(s.total) || 0, comision: commOf(s), estado: s.estado, prod };
      });
    const PER = 12, pages = Math.max(1, Math.ceil(rows.length / PER)), pg = Math.min(page, pages);
    const slice = rows.slice((pg - 1) * PER, pg * PER);

    const sel = (value, onChange, opts) => h('select', { value, onChange: e => { onChange(e.target.value); setPage(1); }, className: 'bg-surface-container-low border-none rounded-lg text-caption font-semibold px-3 py-2 focus:ring-1 focus:ring-primary' }, opts.map(([v, l]) => h('option', { key: v, value: v }, l)));

    if (!D.sales.length) {
      return h('div', { className: CARD + ' p-12 text-center' }, [
        h('div', { key: 'i', className: 'w-14 h-14 mx-auto mb-4 rounded-full grid place-items-center bg-surface-container text-on-surface-variant' }, h(MS, { name: 'cash', size: 28 })),
        h('h3', { key: 't', className: 'font-headline text-headline-md text-primary mb-1' }, 'Aún no hay ventas'),
        h('p', { key: 'd', className: 'text-body text-on-surface-variant' }, 'Cuando registres ventas en el Punto de venta, aquí verás las métricas y el historial.'),
      ]);
    }

    return h(React.Fragment, null, [
      // Encabezado + rango + exportar
      h('div', { key: 'hd', className: 'flex flex-wrap justify-between items-end gap-4 mb-8' }, [
        h('div', { key: 't' }, [
          h('h2', { key: 'a', className: 'font-headline text-headline-lg text-primary' }, 'Reporte de ventas'),
          h('p', { key: 'b', className: 'text-on-surface-variant text-body mt-1 max-w-xl' }, 'Métricas e historial en vivo de las transacciones registradas.'),
        ]),
        h('div', { key: 'r', className: 'flex flex-wrap items-center gap-3' }, [
          h('div', { key: 'dates', className: 'flex items-center gap-2 bg-surface-container-low rounded-lg px-3 py-1.5' }, [
            h(MS, { key: 'ic', name: 'calendar', size: 16, className: 'text-on-surface-variant' }),
            h('span', { key: 'l1', className: 'text-caption font-semibold text-on-surface-variant' }, 'Del'),
            h('input', { key: 'f', type: 'date', value: from, max: to || undefined, onChange: e => { setFrom(e.target.value); setPage(1); }, className: 'bg-transparent border-none text-caption font-semibold text-primary focus:ring-0 p-0' }),
            h('span', { key: 'l2', className: 'text-caption font-semibold text-on-surface-variant' }, 'al'),
            h('input', { key: 't', type: 'date', value: to, min: from || undefined, onChange: e => { setTo(e.target.value); setPage(1); }, className: 'bg-transparent border-none text-caption font-semibold text-primary focus:ring-0 p-0' }),
          ]),
          h('button', { key: 'clr', onClick: clearFilters, className: 'flex items-center gap-1 px-2 py-2 text-caption font-semibold text-on-surface-variant hover:text-primary transition-colors', title: 'Limpiar filtros' }, [h(MS, { key: 'i', name: 'x', size: 16 }), 'Limpiar']),
          h('button', { key: 'x', className: 'flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg hover:opacity-90 transition text-body font-semibold shadow-e2', onClick: () => { if (!rows.length) { toast('No hay ventas para exportar', 'var(--danger)'); return; } window.XLSXIO.exportSales(rows); } }, [h(MS, { key: 'i', name: 'download', size: 16 }), 'Exportar Excel']),
        ]),
      ]),

      // Tarjetas de métrica
      h('div', { key: 'cards', className: 'grid grid-cols-1 md:grid-cols-4 gap-gutter mb-gutter' }, [
        h('div', { key: 'tot', className: 'rounded-xl p-6 bg-primary-container text-on-primary' }, [
          h('p', { key: 'l', className: 'text-caption font-semibold uppercase tracking-wider mb-2 text-on-primary-container' }, 'Total vendido'),
          h('h3', { key: 'v', className: 'font-headline text-headline-md text-white' }, fmt(totalVendido).replace('.00', '')),
          h('p', { key: 's', className: 'text-caption mt-3 text-on-primary-container' }, prevVendido > 0 ? `${deltaPct(totalVendido, prevVendido) >= 0 ? '+' : ''}${deltaPct(totalVendido, prevVendido)}% vs periodo anterior` : 'periodo seleccionado'),
        ]),
        metricCard('Ventas totales', String(nVentas), 'transacciones procesadas', prevN > 0 && deltaChip(deltaPct(nVentas, prevN), false), true),
        metricCard('Ticket promedio', fmt(ticketProm).replace('.00', ''), 'por transacción'),
        metricCard('Comisiones', fmt(comisiones).replace('.00', ''), 'acumulado del periodo'),
      ]),

      // Ventas por vendedor
      h('div', { key: 'chart', className: CARD + ' p-8 mb-gutter' }, [
        h('div', { key: 'h', className: 'flex justify-between items-center mb-8' }, [
          h('h4', { key: 't', className: 'font-headline text-headline-md text-primary' }, 'Ventas por vendedor'),
          h('span', { key: 's', className: 'text-caption text-on-surface-variant' }, `${nVentas} ${nVentas === 1 ? 'venta' : 'ventas'}`),
        ]),
        dist.length
          ? h('div', { key: 'bars', className: 'flex items-end justify-around gap-6 px-2 pt-6' }, dist.map(d => h('div', { key: d.nombre, className: 'flex flex-col items-center gap-2 flex-1' }, [
            h('span', { key: 'n', className: 'text-caption font-bold text-primary whitespace-nowrap' }, fmt(d.val).replace('.00', '')),
            h('div', { key: 'b', className: 'w-full max-w-[60px] rounded-t-md', style: { height: Math.round(d.val / maxV * 180) + 'px', minHeight: '6px', background: GOLD_GRAD } }),
            h('span', { key: 'l', className: 'text-overline uppercase text-on-surface-variant text-center leading-tight' }, d.nombre),
          ])))
          : emptyHint('Sin ventas en el periodo seleccionado.'),
      ]),

      // Historial + filtros
      h('div', { key: 'tbl', className: CARD + ' overflow-hidden' }, [
        h('div', { key: 'h', className: 'p-6 border-b border-outline-variant flex flex-wrap items-center justify-between gap-4' }, [
          h('h4', { key: 't', className: 'font-headline text-headline-md text-primary' }, 'Historial de ventas'),
          h('div', { key: 'f', className: 'flex items-center gap-3' }, [
            sel(vend, setVend, [['', 'Todos los vendedores']].concat(sellersList.map(s => [s.id, s.nombre]))),
            sel(estado, setEstado, [['', 'Cualquier estado']].concat(statuses.map(st => [st.code, st.label]))),
          ]),
        ]),
        rows.length
          ? h('div', { key: 'wrap', className: 'overflow-x-auto' }, h('table', { className: 'w-full text-left' }, [
            h('thead', { key: 'thd' }, h('tr', { className: 'bg-surface-container-low border-b border-outline-variant' },
              ['Fecha', 'Folio', 'Cliente', 'Producto', 'Vendedor', 'Método', 'Monto', 'Comisión', 'Estado'].map((c, i) => h('th', { key: i, className: 'px-5 py-3 text-overline font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap' + ((c === 'Monto' || c === 'Comisión' || c === 'Estado') ? ' text-right' : '') }, c)))),
            h('tbody', { key: 'tb', className: 'divide-y divide-outline-variant/40' }, slice.map(r => h('tr', { key: r.id, className: 'hover:bg-surface-container-lowest transition-colors' }, [
              h('td', { key: 'f', className: 'px-5 py-3 text-body whitespace-nowrap' }, String(r.fecha || '').slice(0, 10)),
              h('td', { key: 'fo', className: 'px-5 py-3 font-mono text-caption text-primary whitespace-nowrap' }, r.folio),
              h('td', { key: 'c', className: 'px-5 py-3 text-body font-medium whitespace-nowrap' }, r.cliente),
              h('td', { key: 'p', className: 'px-5 py-3' }, h('div', { className: 'flex items-center gap-3 min-w-[170px]' }, [
                r.prod ? h(ProductImage, { key: 'i', p: r.prod, className: 'w-9 h-9 rounded shrink-0' }) : h('div', { key: 'i', className: 'w-9 h-9 rounded bg-surface-container shrink-0 grid place-items-center text-on-surface-variant' }, h(MS, { name: 'tag', size: 16 })),
                h('span', { key: 'n', className: 'text-body' }, r.producto),
              ])),
              h('td', { key: 'v', className: 'px-5 py-3 text-body whitespace-nowrap' }, r.vendedor),
              h('td', { key: 'mp', className: 'px-5 py-3' }, h('span', { className: 'bg-surface-container px-2 py-1 rounded text-overline font-bold uppercase text-on-surface-variant whitespace-nowrap' }, r.metodo)),
              h('td', { key: 'm', className: 'px-5 py-3 text-right text-body font-semibold text-primary whitespace-nowrap' }, fmt(r.monto).replace('.00', '')),
              h('td', { key: 'co', className: 'px-5 py-3 text-right text-body font-semibold text-gold-text whitespace-nowrap' }, r.comision > 0 ? fmt(r.comision).replace('.00', '') : '—'),
              h('td', { key: 'e', className: 'px-5 py-3 text-right' }, h(StatusBadge, { estado: r.estado })),
            ]))),
          ]))
          : emptyHint('No hay ventas que coincidan con los filtros.'),
        rows.length > PER && h('div', { key: 'pg', className: 'px-6 py-4 bg-surface-container-low flex justify-between items-center' }, [
          h('p', { key: 'i', className: 'text-caption text-on-surface-variant' }, `Mostrando ${(pg - 1) * PER + 1}–${Math.min(pg * PER, rows.length)} de ${rows.length}`),
          h('div', { key: 'n', className: 'flex items-center gap-2' }, [
            h('button', { key: 'p', disabled: pg <= 1, onClick: () => setPage(pg - 1), className: 'w-8 h-8 grid place-items-center rounded border border-outline-variant hover:bg-white transition-colors disabled:opacity-40' }, h(MS, { name: 'chevLeft', size: 18 })),
            h('span', { key: 'c', className: 'px-2 text-caption font-bold' }, `${pg} / ${pages}`),
            h('button', { key: 'x', disabled: pg >= pages, onClick: () => setPage(pg + 1), className: 'w-8 h-8 grid place-items-center rounded border border-outline-variant hover:bg-white transition-colors disabled:opacity-40' }, h(MS, { name: 'chevRight', size: 18 })),
          ]),
        ]),
      ]),
    ]);
  }

  window.ReportsScreen = ReportsScreen;
})();
