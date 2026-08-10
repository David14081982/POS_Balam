// reports.jsx — Reportes / Analítica (Balam). Exporta window.ReportsScreen
(function () {
  const { useState, useEffect } = React;
  const { fmt, toast, StatusBadge } = window.UI;
  const { MS, ProductImage } = window.HX;
  const D = window.DATA;
  const h = React.createElement;
  const GOLD_GRAD = 'linear-gradient(135deg, #92760F 0%, #D4AF38 100%)';

  const CARD = 'bg-surface-container-lowest rounded-xl shadow-e1';

  const escapeReport = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  function openPrintableWindow(html, autoPrint) {
    const win = window.open('', '_blank');
    if (!win) { toast('El navegador bloqueo la ventana de impresion', 'var(--danger)'); return null; }
    try { win.opener = null; } catch (error) { /* ventana aislada cuando el navegador lo permite */ }
    win.document.write(html); win.document.close();
    if (autoPrint) setTimeout(() => { win.focus(); win.print(); }, 100);
    return win;
  }
  function openReportDocument(model) {
    const metrics = (model.metrics || []).map(item => `<tr><th>${escapeReport(item[0])}</th><td>${escapeReport(item[1])}</td></tr>`).join('');
    const tableHead = model.columns ? `<thead><tr>${model.columns.map(column => `<th>${escapeReport(column)}</th>`).join('')}</tr></thead>` : '';
    const tableRows = model.rows ? `<tbody>${model.rows.map(row => `<tr>${row.map(value => `<td>${escapeReport(value)}</td>`).join('')}</tr>`).join('')}</tbody>` : '';
    const summary = (model.summary || []).length ? `<section class="summary">${model.summary.map(item => `<div><small>${escapeReport(item[0])}</small><strong>${escapeReport(item[1])}</strong></div>`).join('')}</section>` : '';
    const notes = (model.notes || []).map(note => `<p class="note">${escapeReport(note)}</p>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeReport(model.title)}</title><style>
      @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#131b2e;margin:0}
      main{display:block}.brand{font-size:12px;letter-spacing:.18em;font-weight:800;color:#92760f;margin-bottom:8px}h1{font-size:24px;margin:0 0 4px}p{color:#566070;margin:0 0 8px}
      .generated{font-size:11px;margin-bottom:22px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:18px 0}.summary div{border:1px solid #d9dde5;border-radius:8px;padding:10px}.summary small{display:block;color:#566070;font-size:9px;text-transform:uppercase}.summary strong{display:block;margin-top:5px;font-size:15px}
      table{width:100%;border-collapse:collapse;font-size:12px}thead{display:table-header-group}th,td{padding:9px;border-bottom:1px solid #d9dde5;text-align:left}thead th{background:#131b2e;color:white;text-transform:uppercase;font-size:9px;letter-spacing:.05em}td:not(:first-child){text-align:right;font-weight:700}tr{break-inside:avoid}.note{margin:14px 0 0;padding:10px;background:#f4f1e8;border-left:3px solid #92760f;font-size:11px}
      @media print{main{display:block!important}}
    </style></head><body><main data-report-printable="true"><div class="brand">${escapeReport(model.brand || '')}</div><h1>${escapeReport(model.title)}</h1><p>${escapeReport(model.period)}</p>${model.generated ? `<p class="generated">Generado: ${escapeReport(model.generated)}</p>` : ''}${summary}<table>${tableHead || ''}${tableRows || metrics}</table>${notes}</main></body></html>`;
    openPrintableWindow(html, true);
  }

  // Proyección compartida: pantalla, A4 y ticket consumen este mismo snapshot
  // ya normalizado por DATA.paymentMethodReport(). Aquí sólo hay etiquetas.
  function paymentMethodReportView(model, period, generated) {
    const reconciliationText = model.reconciliation.ok
      ? 'Conciliación correcta · diferencia $0.00'
      : `Conciliación pendiente · diferencia ${fmt(model.reconciliation.difference)}`;
    const origins = [
      ['Ventas', model.origins.sales],
      ['Movimientos de apartados', model.origins.layaways],
      ['Cambios cobrados', model.origins.exchanges],
      ['Devoluciones', model.origins.returns],
    ];
    return {
      period, generated, entries: model.entries, refunds: model.refunds, net: model.net,
      methods: model.methods, principal: model.principal, courtesies: model.courtesies,
      undistributed: model.undistributed, reconciliation: model.reconciliation,
      reconciliationText, operations: model.operations, origins,
      exchangeEntries: model.exchangeEntries,
    };
  }

  function openPaymentMethodTicket(view) {
    const methodBlocks = view.methods.length ? view.methods.map(row => `<section class="method tk-block">
      <h2>${escapeReport(row.methodLabel)}</h2>
      <div class="money"><span>Entradas</span><strong>${escapeReport(fmt(row.entries))}</strong></div>
      <div class="money"><span>Devoluciones</span><strong>${escapeReport(row.refunds ? `−${fmt(row.refunds)}` : fmt(0))}</strong></div>
      <div class="money net"><span>Neto</span><strong>${escapeReport(fmt(row.net))}</strong></div>
    </section>`).join('') : '<p class="empty tk-block">Sin movimientos monetarios en el periodo.</p>';
    const origins = view.origins.map(item => `<div class="count"><span>${escapeReport(item[0])}</span><strong>${escapeReport(item[1])}</strong></div>`).join('');
    const undistributed = view.undistributed ? `<section class="alert tk-block"><h2>IMPORTE SIN DISTRIBUCIÓN</h2><strong>${escapeReport(fmt(view.undistributed))}</strong><p>Detalle histórico insuficiente; no se atribuye sin evidencia.</p></section>` : '';
    const courtesy = view.courtesies ? `<section class="tk-block muted"><h2>OPERACIONES SIN INGRESO</h2><div class="count"><span>Cortesías</span><strong>${escapeReport(view.courtesies)}</strong></div><p>Ingreso: $0.00</p></section>` : '';
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte por método de pago · BALAM</title><style>
      @page{size:80mm auto;margin:0}*{box-sizing:border-box}html,body{margin:0;min-width:0;background:#e8eaf0;color:#131b2e;font-family:Arial,sans-serif}
      .tools{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;padding:10px;background:#131b2e;color:#fff}.tools button{min-height:44px;padding:0 14px;border:0;border-radius:7px;font-weight:800}.tools .primary{background:#d4af38;color:#131b2e}.tools .secondary{background:#fff;color:#131b2e}
      main{width:80mm;max-width:100%;margin:12px auto;background:#fff;padding:5mm 4.5mm;font-size:9.5pt;line-height:1.3;overflow:visible}.tk-block{break-inside:avoid;page-break-inside:avoid}.brand{text-align:center;border-bottom:2px solid #131b2e;padding-bottom:3mm}.brand strong{display:block;font-size:14pt;letter-spacing:.2em}.brand h1{margin:1.5mm 0 0;font-size:11pt;letter-spacing:.04em}.meta{padding:3mm 0;border-bottom:1px dashed #596273}.meta p{margin:1mm 0;overflow-wrap:anywhere}.method{padding:3mm 0;border-bottom:1px dashed #596273}.method h2,.alert h2,.muted h2,.origins h2{margin:0 0 2mm;font-size:10pt;line-height:1.2;overflow-wrap:anywhere;word-break:break-word}.money,.count{display:grid;grid-template-columns:minmax(0,1fr) max-content;gap:3mm;align-items:baseline;margin:.8mm 0}.money span,.count span{min-width:0;overflow-wrap:anywhere}.money strong,.count strong{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}.money.net{margin-top:1.5mm;padding-top:1.5mm;border-top:1px solid #c7cad1;font-weight:800}.totals{padding:3mm 0;border-bottom:2px solid #131b2e}.totals .grand{font-size:12pt;border-top:2px solid #131b2e;padding-top:2mm;margin-top:2mm}.summary,.origins,.muted,.alert,.reconciliation{padding:3mm 0;border-bottom:1px dashed #596273}.summary p,.muted p,.alert p,.reconciliation p{margin:1mm 0;overflow-wrap:anywhere}.alert{color:#7a4500}.alert>strong{display:block;font-size:12pt}.reconciliation{font-weight:800}.reconciliation.pending{color:#a32929}.empty{padding:5mm 0;text-align:center}.foot{text-align:center;padding-top:3mm;font-size:8pt;color:#596273}
      @media(max-width:360px){main{margin:0 auto;padding:4mm 3.5mm}.tools{flex-wrap:wrap}}
      @media print{html,body{height:auto!important;min-height:0!important;background:#fff!important;overflow:visible!important}.tools{display:none!important}main{width:80mm;max-width:80mm;margin:0!important;padding:5mm 4.5mm!important}}
    </style></head><body><div class="tools"><button type="button" class="primary" onclick="window.print()">Imprimir ticket</button><button type="button" class="secondary" onclick="window.close()">Cerrar</button><span>80 mm</span></div><main data-payment-method-ticket="true">
      <header class="brand tk-block"><strong>BALAM</strong><h1>REPORTE POR MÉTODO DE PAGO</h1></header>
      <section class="meta tk-block"><p><strong>Periodo:</strong><br>${escapeReport(view.period)}</p><p><strong>Generado:</strong><br>${escapeReport(view.generated)}</p></section>
      ${methodBlocks}
      <section class="totals tk-block"><div class="money"><span>TOTAL ENTRADAS</span><strong>${escapeReport(fmt(view.entries))}</strong></div><div class="money"><span>DEVOLUCIONES</span><strong>${escapeReport(view.refunds ? `−${fmt(view.refunds)}` : fmt(0))}</strong></div><div class="money grand"><span>NETO</span><strong>${escapeReport(fmt(view.net))}</strong></div></section>
      <section class="summary tk-block"><p><strong>Operaciones:</strong> ${escapeReport(view.operations)}</p><p><strong>Método principal:</strong><br>${view.principal ? `${escapeReport(view.principal.methodLabel)} · ${escapeReport(fmt(view.principal.net))}` : 'Sin movimientos'}</p></section>
      <section class="origins tk-block"><h2>ORIGEN DE OPERACIONES</h2>${origins}<div class="money"><span>Entradas por cambios</span><strong>${escapeReport(fmt(view.exchangeEntries))}</strong></div><p>Importe informativo; ya está incluido en Total entradas.</p></section>
      ${courtesy}${undistributed}
      <section class="reconciliation tk-block ${view.reconciliation.ok ? '' : 'pending'}"><p>CONCILIACIÓN: ${view.reconciliation.ok ? 'CORRECTA' : 'PENDIENTE'}</p><p>Σ métodos ${escapeReport(fmt(view.reconciliation.distributedNet))} + sin distribución ${escapeReport(fmt(view.undistributed))} = neto ${escapeReport(fmt(view.net))}</p>${view.reconciliation.ok ? '' : `<p>Diferencia: ${escapeReport(fmt(view.reconciliation.difference))}</p>`}</section>
      <footer class="foot tk-block">Reporte ejecutivo · BALAM</footer>
    </main></body></html>`;
    openPrintableWindow(html, false);
  }

  function ReprintSaleModal({ sale, onClose }) {
    const printed = React.useRef(false);
    useEffect(() => {
      if (printed.current) return undefined;
      printed.current = true;
      const timer = setTimeout(() => window.print(), 100);
      return () => clearTimeout(timer);
    }, []);
    return h(window.UI.Modal, { title: 'Reimpresion de venta', onClose, footer: [
      h('button', { key: 'p', onClick: () => window.print(), className: 'px-4 py-3 border border-outline-variant rounded-lg' }, 'Imprimir nuevamente'),
      h('button', { key: 'c', 'data-testid': 'sales-reprint-close', onClick: onClose, className: 'px-4 py-3 bg-primary text-on-primary rounded-lg' }, 'Cerrar'),
    ] }, [
      h('p', { key: 'm', className: 'text-caption text-on-surface-variant' }, `Documento historico ${sale.folio}. Esta accion no modifica la venta.`),
      h(window.BalamTicket, { key: 't', sale }),
    ]);
  }

  function ResumenReport({ onNav }) {
    const marginPct = window.CONFIG.get('report.marginPct') || 33;
    const parse = f => { const d = new Date(String(f || '').replace(' ', 'T')); return isNaN(d) ? null : d; };
    const nonCancel = D.sales.filter(s => s.estado !== 'Cancelado');
    const periodoLbl = new Date().toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });

    // KPIs — 100% reales (sin históricos ni metas inventadas)
    // H-49: el importe vendido, el conteo de pedidos y el ticket promedio salen
    // de UNA autoridad, `DATA.revenueSummary`, porque la diferencia cobrada en un
    // cambio suma al importe pero NO es un pedido. Repartir esa distinción por la
    // pantalla es como se descuadran los reportes.
    const rev = D.revenueSummary();
    const ventasBrutas = rev.importeVendido;
    const difCambios = rev.difCambios;
    const cobradoReal = (D.payments || []).reduce((a, p) => a + (Number(p.monto) || 0), 0);
    const anticipos = (D.payments || []).filter(p => p.tipo === 'anticipo').reduce((a, p) => a + (Number(p.monto) || 0), 0);
    const abonos = (D.payments || []).filter(p => p.tipo === 'abono' || p.tipo === 'liquidacion').reduce((a, p) => a + (Number(p.monto) || 0), 0);
    const saldosPendientes = nonCancel.reduce((a, s) => a + (Number(s.saldo) || 0), 0);
    const descuentos = nonCancel.reduce((a, s) => a + (Number(s.descuento) || 0), 0);
    const descuentosAdicionales = nonCancel.reduce((a, s) => a + (Number(s.descuentoAdicional) || 0), 0);
    const historicasSinDetalle = nonCancel.filter(s => !D.hasFinancialSnapshot(s) || !D.paymentsForSale(s.folio).length).length;
    const utilidad = Math.round(ventasBrutas * (marginPct / 100));
    // Las cortesías (regalos) no son ventas pagadas: no cuentan como pedidos ni en el ticket promedio.
    const cortesias = nonCancel.filter(s => s.metodo === 'Cortesía');
    const regalado = cortesias.reduce((a, s) => a + (Number(s.valorRegalado) || 0), 0);
    // El ticket promedio se mide sobre VENTAS, nunca sobre el importe total: un
    // cambio lo inflaría sin que nadie hubiera comprado de más.
    const pedidos = rev.pedidos;
    const ticketProm = Math.round(rev.ticketProm);

    // Variación real: mes calendario actual vs mes anterior (oculta si no hay base previa)
    const ymOf = d => d.getFullYear() * 12 + d.getMonth();
    const curYM = ymOf(new Date());
    // La variación mensual mide el mismo importe que el KPI —ventas más
    // diferencias de cambios— pero el CONTEO sigue siendo de pedidos: un cambio
    // aporta dinero, no un pedido más.
    const delMes = off => (doc) => { const d = parse(doc.fecha); return !!d && ymOf(d) === curYM - off; };
    const monthAgg = off => {
      const acc = nonCancel.reduce((a, s) => { if (delMes(off)(s)) { a.tot += Number(s.total) || 0; a.n += 1; } return a; }, { tot: 0, n: 0 });
      acc.tot += D.exchangeRevenue(delMes(off));
      return acc;
    };
    const m0 = monthAgg(0), m1 = monthAgg(1);
    const pctMoM = (cur, prev) => prev > 0 ? Math.round((cur - prev) / prev * 100) : null;
    const mom = pct => pct == null ? ['', 'text-on-surface-variant', 'trending_up'] : [(pct >= 0 ? '+' : '') + pct + '% vs mes anterior', pct >= 0 ? 'text-success' : 'text-danger', pct >= 0 ? 'trending_up' : 'trending_down'];
    const [tV, cV, iV] = mom(pctMoM(m0.tot, m1.tot)), [tP, cP, iP] = mom(pctMoM(m0.n, m1.n));

    // Meta global (equipo) — guardas contra meta=0 (evita NaN/Infinity y "100%" falso)
    // H-69: el equipo y las comisiones salen de `DATA.commissionLedger`, la
    // misma autoridad que pinta Vendedores y el XLSX. Antes se leia
    // `ventasMes`/`comisionAcum`, que el cierre de mes pone en cero: el reporte
    // del mes desaparecia justo despues de cerrarlo.
    const ledgerPeriodo = D.commissionLedger(D.currentPeriodPredicate());
    const ledgerDe = id => ledgerPeriodo.find(r => r.vendedorId === id) || { importeVendido: 0, pendiente: 0, generado: 0, neto: 0 };
    const teamVentas = D.sellers.reduce((a, s) => a + ledgerDe(s.id).importeVendido, 0);
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
    const topVend = [...D.sellers].sort((a, b) => ledgerDe(b.id).importeVendido - ledgerDe(a.id).importeVendido);
    const totalComision = D.sellers.reduce((a, s) => a + ledgerDe(s.id).pendiente, 0);

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
          h('button', { key: 'p', 'data-testid': 'report-print', className: 'flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container-low transition-all text-body font-semibold', onClick: () => openReportDocument({ title: 'Reporte Balam', period: periodoLbl, metrics: [['Ventas brutas', fmt(ventasBrutas)], ['Utilidad neta', fmt(utilidad)], ['Total pedidos', pedidos], ['Ticket promedio', fmt(ticketProm)], ['Comisiones', fmt(totalComision)]] }) }, [h(MS, { key: 'i', name: 'print', size: 16 }), 'Imprimir']),
          h('button', { key: 'e', 'data-testid': 'report-pdf', className: 'flex items-center gap-2 px-6 py-2 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-all text-body font-semibold shadow-e2', onClick: () => { toast('Abriendo impresion — elige "Guardar como PDF"'); openReportDocument({ title: 'Reporte Balam', period: periodoLbl, metrics: [['Ventas brutas', fmt(ventasBrutas)], ['Utilidad neta', fmt(utilidad)], ['Total pedidos', pedidos], ['Ticket promedio', fmt(ticketProm)], ['Comisiones', fmt(totalComision)]] }); } }, [h(MS, { key: 'i', name: 'download', size: 16 }), 'Exportar PDF']),
        ]),

        // KPIs
        h('div', { key: 'kpi', className: 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter mb-gutter' }, [
          kpi('Ventas brutas', fmt(ventasBrutas).replace('.00', ''), iV, tV, cV),
          kpi('Utilidad neta', fmt(utilidad).replace('.00', ''), iV, tV, cV),
          kpi('Total pedidos', String(pedidos), iP, tP, cP),
          kpi('Ticket promedio', fmt(ticketProm).replace('.00', ''), 'star', '', 'text-gold-text', true),
        ]),
        h('div', { key: 'cash', className: 'grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-gutter mb-gutter' }, [
          metricCard('Dinero cobrado', fmt(cobradoReal).replace('.00', ''), 'movimientos de pago registrados'),
          // H-49: sin este renglon, «Dinero cobrado» salia mas alto que «Ventas
          // brutas» y nada en pantalla explicaba la diferencia.
          metricCard('Diferencias cobradas por cambios', fmt(difCambios).replace('.00', ''), 'excedente pagado al cambiar por algo de mayor valor'),
          metricCard('Anticipos', fmt(anticipos).replace('.00', ''), 'recibidos al apartar'),
          metricCard('Abonos y liquidaciones', fmt(abonos).replace('.00', ''), 'cobros posteriores'),
          metricCard('Saldos pendientes', fmt(saldosPendientes).replace('.00', ''), 'por cobrar en apartados'),
          metricCard('Descuentos', fmt(descuentos).replace('.00', ''), 'concedidos sobre precio con IVA'),
          metricCard('Descuentos adicionales', fmt(descuentosAdicionales).replace('.00', ''), 'beneficios manuales posteriores a promociones'),
        ]),
        historicasSinDetalle ? h('div', { key: 'hist', className: 'mb-gutter p-4 rounded-xl bg-warning-soft text-warning text-caption' }, `${historicasSinDetalle} venta(s) histórica(s) no tienen desglose financiero completo; no se inventaron pagos ni descuentos.`) : null,
        // Cortesías (regalos/giveaways): cuántas y el valor regalado. Solo se muestra si hay.
        cortesias.length ? h('div', { key: 'cor', className: CARD + ' p-5 mb-gutter flex items-center gap-4' }, [
          h('div', { key: 'i', className: 'w-11 h-11 rounded-xl grid place-items-center bg-gold-soft text-gold-text shrink-0' }, h(MS, { name: 'tag', size: 22 })),
          h('div', { key: 't', className: 'flex-1 min-w-0' }, [
            h('div', { key: 'a', className: 'text-overline uppercase text-on-surface-variant' }, 'Cortesías entregadas'),
            h('div', { key: 'b', className: 'text-body text-on-surface-variant' }, cortesias.length + ' entrega' + (cortesias.length === 1 ? '' : 's') + ' · valor regalado'),
          ]),
          h('div', { key: 'v', className: 'font-headline text-h2 text-gold-text' }, fmt(regalado).replace('.00', '')),
        ]) : null,

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
                h('td', { key: 'v', className: 'py-4 text-body' }, fmt(ledgerDe(s.id).importeVendido).replace('.00', '')),
                h('td', { key: 'c', className: 'py-4 text-body font-bold text-right text-gold-text' }, fmt(ledgerDe(s.id).pendiente).replace('.00', '')),
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
    return h(window.UI.KPI, { key: label, label, value, icon, tone: gold ? 'gold' : 'neutral', className: gold ? 'border-l-4 border-l-secondary' : '', helper: delta ? h('span', { className: 'font-bold ' + (deltaCls || 'text-on-surface-variant') }, delta) : null });
  }

  // ── Reportes del cambio: trazabilidad, comisión por origen y valor perdido ─────
  function ExchangesReport() {
    const [range, setRange] = useState('30');
    const cutoff = range === 'all' ? null : Date.now() - Number(range) * 86400000;
    const pred = doc => {
      if (cutoff == null) return true;
      const d = new Date(String((doc && doc.fecha) || '').replace(' ', 'T'));
      return !isNaN(d) && d.getTime() >= cutoff;
    };
    const cambios = D.exchangeReport(pred);
    const comisiones = D.sellerCommissionReport(pred);
    const noAprovechado = D.exchangeUnusedValue(pred);
    const fecha = value => window.UI.fechaCorta ? window.UI.fechaCorta(value) : String(value || '').slice(0, 10);
    const lineLabel = l => `${Number(l.qty) || 0} × ${l.nombre || l.sku || 'Artículo'} · talla ${l.talla || '—'}`;

    return h(React.Fragment, null, [
      h('div', { key: 'hd', className: 'flex flex-wrap items-end justify-between gap-4 mb-8' }, [
        h('div', { key: 't' }, [
          h('h2', { key: 'a', className: 'font-headline text-headline-lg text-primary' }, 'Reporte de cambios'),
          h('p', { key: 'b', className: 'text-on-surface-variant text-body mt-1' }, 'Trazabilidad de posventa y sus efectos económicos.'),
        ]),
        h('label', { key: 'f', className: 'text-caption font-semibold text-on-surface-variant' }, [
          'Periodo ',
          h('select', {
            key: 's', value: range, 'data-testid': 'exchange-report-range',
            onChange: e => setRange(e.target.value),
            className: 'ml-2 bg-surface-container-low border-none rounded-lg text-caption font-semibold px-3 py-2',
          }, [
            h('option', { key: '30', value: '30' }, 'Últimos 30 días'),
            h('option', { key: '90', value: '90' }, 'Últimos 90 días'),
            h('option', { key: 'all', value: 'all' }, 'Todo el historial'),
          ]),
        ]),
      ]),

      h('section', { key: 'unused', 'data-testid': 'exchange-unused-report', className: CARD + ' p-6 mb-gutter border-l-4 border-l-secondary' }, [
        h('p', { key: 'l', className: 'text-caption font-semibold uppercase tracking-wider text-on-surface-variant' }, 'Valor no aprovechado'),
        h('div', { key: 'v', className: 'font-headline text-headline-lg text-primary mt-2' }, fmt(noAprovechado).replace('.00', '')),
        h('p', { key: 's', className: 'text-caption text-on-surface-variant mt-2' }, 'Valor que el cliente entregó y no recuperó al llevarse mercancía de menor valor.'),
      ]),

      h('section', { key: 'comm', 'data-testid': 'exchange-commission-report', className: CARD + ' overflow-hidden mb-gutter' }, [
        h('div', { key: 'h', className: 'p-6 border-b border-outline-variant' }, [
          h('h3', { key: 't', className: 'font-headline text-headline-md text-primary' }, 'Comisión por vendedor y origen'),
          h('p', { key: 's', className: 'text-caption text-on-surface-variant mt-1' }, 'Separa ventas de excedentes cobrados en cambios.'),
        ]),
        comisiones.length ? h('div', { key: 'w', className: 'overflow-x-auto' }, h('table', { className: 'w-full text-left' }, [
          h('thead', { key: 'h' }, h('tr', { className: 'bg-surface-container-low border-b border-outline-variant' },
            ['Vendedor', 'De ventas', 'De cambios', 'Total'].map((c, i) => h('th', { key: c, className: 'px-6 py-3 text-overline uppercase text-on-surface-variant' + (i ? ' text-right' : '') }, c)))),
          h('tbody', { key: 'b', className: 'divide-y divide-outline-variant/40' }, comisiones.map(r => h('tr', { key: r.vendedorId || 'none' }, [
            h('td', { key: 'n', className: 'px-6 py-4 text-body font-semibold' }, [
              r.vendedor,
              r.repartoEstimado ? h('span', { key: 'e', className: 'block text-overline text-warning mt-1' }, 'Reparto estimado: venta histórica con varios vendedores') : null,
            ]),
            h('td', { key: 'v', className: 'px-6 py-4 text-right text-body' }, fmt(r.ventas).replace('.00', '')),
            h('td', { key: 'c', className: 'px-6 py-4 text-right text-body' }, fmt(r.cambios).replace('.00', '')),
            h('td', { key: 't', className: 'px-6 py-4 text-right text-body font-bold text-gold-text' }, fmt(r.total).replace('.00', '')),
          ]))),
        ])) : emptyHint('No hay comisiones en el periodo seleccionado.'),
      ]),

      h('section', { key: 'history', 'data-testid': 'exchange-history-report', className: CARD + ' overflow-hidden' }, [
        h('div', { key: 'h', className: 'p-6 border-b border-outline-variant' }, [
          h('h3', { key: 't', className: 'font-headline text-headline-md text-primary' }, 'Ventas cambiadas'),
          h('p', { key: 's', className: 'text-caption text-on-surface-variant mt-1' }, 'Qué salió del cliente y qué mercancía recibió.'),
        ]),
        cambios.length ? h('div', { key: 'list', className: 'divide-y divide-outline-variant/50' }, cambios.map(c => h('article', { key: c.id || c.folio, className: 'p-6' }, [
          h('div', { key: 'top', className: 'flex flex-wrap justify-between gap-3 mb-4' }, [
            h('div', { key: 'id' }, [
              h('p', { key: 'f', className: 'font-mono text-caption text-primary' }, `${c.origenFolio || '—'} → ${c.folio || '—'}`),
              h('p', { key: 'd', className: 'text-caption text-on-surface-variant mt-1' }, `${fecha(c.fecha)} · atendió ${c.vendedor} · revisó ${c.revisadoPor}`),
            ]),
            h('div', { key: 'money', className: 'text-right text-caption' }, [
              c.diferencia > 0 ? h('p', { key: 'd', className: 'font-bold text-success' }, `Diferencia cobrada ${fmt(c.diferencia).replace('.00', '')}`) : null,
              c.valorNoAprovechado > 0 ? h('p', { key: 'u', className: 'font-bold text-warning' }, `No aprovechado ${fmt(c.valorNoAprovechado).replace('.00', '')}`) : null,
            ]),
          ]),
          h('div', { key: 'lines', className: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, [
            h('div', { key: 'out', className: 'rounded-lg bg-surface-container-low p-4' }, [
              h('p', { key: 'h', className: 'text-overline uppercase font-bold text-on-surface-variant mb-2' }, 'Cliente entregó'),
              ...(c.devueltos || []).map((l, i) => h('p', { key: i, className: 'text-body' }, `${lineLabel(l)}${l.motivo ? ` · ${l.motivo}` : ''}${l.condicion ? ` · ${l.condicion}` : ''}`)),
            ]),
            h('div', { key: 'in', className: 'rounded-lg bg-gold-soft p-4' }, [
              h('p', { key: 'h', className: 'text-overline uppercase font-bold text-gold-text mb-2' }, 'Cliente recibió'),
              ...(c.entregados || []).map((l, i) => h('p', { key: i, className: 'text-body' }, lineLabel(l))),
            ]),
          ]),
          c.notas ? h('p', { key: 'note', className: 'text-caption text-on-surface-variant mt-4' }, `Nota: ${c.notas}`) : null,
        ]))) : emptyHint('No hay cambios en el periodo seleccionado.'),
      ]),
    ]);
  }

  function PaymentMethodReport() {
    const dayText = date => {
      const d = date || new Date();
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    const today = dayText();
    const rangeFor = id => {
      const now = new Date();
      if (id === 'ayer') { const d = new Date(now); d.setDate(d.getDate() - 1); return [dayText(d), dayText(d)]; }
      if (id === 'semana') { const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return [dayText(d), today]; }
      if (id === 'mes') return [dayText(new Date(now.getFullYear(), now.getMonth(), 1)), today];
      return [today, today];
    };
    const [preset, setPreset] = useState('hoy');
    const initial = rangeFor('hoy');
    const [from, setFrom] = useState(initial[0]), [to, setTo] = useState(initial[1]);
    const applyPreset = id => { const range = rangeFor(id); setPreset(id); setFrom(range[0]); setTo(range[1]); };
    const model = D.paymentMethodReport({ from, to });
    const period = from === to ? from : `${from} – ${to}`;
    const view = paymentMethodReportView(model, period, new Date().toLocaleString('es-MX'));
    const print = () => openReportDocument({
      brand: 'BALAM', title: 'Reporte de ingresos por método de pago', period: `Periodo: ${view.period}`,
      generated: view.generated,
      summary: [['Total entradas', fmt(view.entries)], ['Devoluciones', fmt(view.refunds)], ['Neto', fmt(view.net)],
        ['Método principal', view.principal ? `${view.principal.methodLabel} · ${fmt(view.principal.net)}` : 'Sin movimientos']],
      columns: ['Método', 'Operaciones', 'Entradas', 'Devoluciones', 'Neto', '% del total'],
      rows: view.methods.map(row => [row.methodLabel, row.operations, fmt(row.entries), fmt(row.refunds), fmt(row.net), `${row.percentage.toFixed(2)}%`])
        .concat([['TOTAL', '', fmt(view.entries), fmt(view.refunds), fmt(view.net), '100.00%']]),
      notes: [view.reconciliationText, `Operaciones económicas: ${view.operations}.`,
        ...view.origins.map(item => `${item[0]}: ${item[1]}.`),
        `Entradas por cambios: ${fmt(view.exchangeEntries)} (informativo; ya incluido en Total entradas).`]
        .concat(view.undistributed ? [`Importe histórico sin distribución: ${fmt(view.undistributed)}. No fue atribuido a ningún método.`] : [])
        .concat(view.courtesies ? [`Cortesías: ${view.courtesies} operaciones · $0.00 ingresado.`] : []),
    });
    return h('section', { 'data-testid': 'payment-method-report' }, [
      h('div', { key: 'head', className: 'flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-6' }, [
        h('div', { key: 'title' }, [
          h('div', { key: 'eyebrow', className: 'text-overline uppercase tracking-widest text-gold-text font-bold' }, 'Flujo de dinero'),
          h('h2', { key: 'h', className: 'font-headline text-headline-lg text-primary' }, 'Ingresos por método de pago'),
          h('p', { key: 'p', className: 'text-body text-on-surface-variant mt-1' }, 'Entradas y devoluciones según el medio real utilizado.'),
        ]),
        h('div', { key: 'actions', className: 'flex flex-wrap gap-2' }, [
          h('button', { key: 'print', 'data-testid': 'payment-method-print', onClick: print, className: 'px-4 py-2 border border-outline-variant rounded-lg font-semibold' }, 'Imprimir reporte'),
          h('button', { key: 'pdf', 'data-testid': 'payment-method-pdf', onClick: () => { toast('Abriendo impresión — elige "Guardar como PDF"'); print(); }, className: 'px-4 py-2 bg-primary text-on-primary rounded-lg font-semibold' }, 'Exportar PDF'),
          h('button', { key: 'ticket', 'data-testid': 'payment-method-ticket', onClick: () => openPaymentMethodTicket(view), className: 'px-4 py-2 bg-secondary text-on-secondary rounded-lg font-semibold' }, 'Imprimir ticket'),
        ]),
      ]),
      h('div', { key: 'filters', className: CARD + ' p-4 mb-6 flex flex-wrap items-center gap-2' }, [
        [['hoy', 'Hoy'], ['ayer', 'Ayer'], ['semana', 'Esta semana'], ['mes', 'Este mes']].map(([id, label]) => h('button', { key: id, onClick: () => applyPreset(id), className: 'px-3 py-2 rounded-lg text-caption font-semibold ' + (preset === id ? 'bg-primary text-on-primary' : 'border border-outline-variant') }, label)),
        h('span', { key: 'sep', className: 'hidden sm:block w-px h-8 bg-outline-variant mx-1' }),
        h('input', { key: 'from', type: 'date', value: from, max: to || undefined, onChange: e => { setPreset('custom'); setFrom(e.target.value); }, className: 'h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg' }),
        h('span', { key: 'dash', className: 'text-on-surface-variant' }, 'a'),
        h('input', { key: 'to', type: 'date', value: to, min: from || undefined, onChange: e => { setPreset('custom'); setTo(e.target.value); }, className: 'h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg' }),
      ]),
      h('div', { key: 'kpis', className: 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-gutter mb-6' }, [
        metricCard('Total entradas', fmt(view.entries), 'dinero recibido', null, true),
        metricCard('Devoluciones', fmt(view.refunds), 'dinero devuelto'),
        metricCard('Neto', fmt(view.net), 'entradas menos devoluciones'),
        metricCard('Método principal', view.principal ? view.principal.methodLabel : '—', view.principal ? fmt(view.principal.net) : 'sin movimientos'),
      ]),
      h('div', { key: 'table', className: CARD + ' overflow-hidden mb-6' }, [
        h('div', { key: 'scroll', className: 'overflow-x-auto' }, h('table', { className: 'w-full min-w-[720px]', 'data-testid': 'payment-method-table' }, [
          h('thead', { key: 'h' }, h('tr', { className: 'bg-primary text-on-primary' }, ['Método', 'Operaciones', 'Entradas', 'Devoluciones', 'Neto', '% del total'].map(label => h('th', { key: label, className: 'px-4 py-3 text-left text-overline uppercase' }, label)))),
          h('tbody', { key: 'b' }, view.methods.length ? view.methods.map(row => h('tr', { key: row.methodCode, className: 'border-b border-outline-variant/50' }, [
            h('td', { key: 'm', className: 'px-4 py-3 font-semibold' }, row.methodLabel),
            h('td', { key: 'o', className: 'px-4 py-3 text-right' }, row.operations),
            h('td', { key: 'e', className: 'px-4 py-3 text-right' }, fmt(row.entries)),
            h('td', { key: 'r', className: 'px-4 py-3 text-right text-danger' }, row.refunds ? `− ${fmt(row.refunds)}` : fmt(0)),
            h('td', { key: 'n', className: 'px-4 py-3 text-right font-bold' }, fmt(row.net)),
            h('td', { key: 'p', className: 'px-4 py-3 text-right' }, `${row.percentage.toFixed(2)}%`),
          ])) : h('tr', { key: 'empty' }, h('td', { colSpan: 6, className: 'p-8 text-center text-on-surface-variant' }, 'Sin movimientos monetarios en el periodo.'))),
          h('tfoot', { key: 'f' }, h('tr', { className: 'bg-surface-container-low font-bold' }, [
            h('td', { key: 'l', className: 'px-4 py-3' }, 'TOTAL'), h('td', { key: 'o' }),
            h('td', { key: 'e', className: 'px-4 py-3 text-right' }, fmt(view.entries)), h('td', { key: 'r', className: 'px-4 py-3 text-right' }, fmt(view.refunds)),
            h('td', { key: 'n', className: 'px-4 py-3 text-right' }, fmt(view.net)), h('td', { key: 'p' }),
          ])),
        ])),
      ]),
      h('div', { key: 'origins', 'data-testid': 'payment-method-origins', className: CARD + ' p-4 mb-6' }, [
        h('div', { key: 'head', className: 'flex flex-wrap items-baseline justify-between gap-3 mb-3' }, [
          h('h3', { key: 'h', className: 'font-headline text-title-lg text-primary' }, 'Origen de operaciones'),
          h('span', { key: 'ops', className: 'text-caption font-bold' }, `Operaciones económicas: ${view.operations}`),
        ]),
        h('div', { key: 'grid', className: 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3' }, view.origins.map(item => h('div', { key: item[0], className: 'rounded-lg bg-surface-container-low p-3 flex justify-between gap-3' }, [
          h('span', { key: 'l', className: 'text-caption text-on-surface-variant' }, item[0]),
          h('strong', { key: 'v' }, item[1]),
        ]))),
        h('p', { key: 'exchange', className: 'text-caption mt-3 text-on-surface-variant' }, `Entradas por cambios: ${fmt(view.exchangeEntries)} · informativo; ya incluido en Total entradas.`),
      ]),
      h('div', { key: 'recon', 'data-testid': 'payment-method-reconciliation', className: 'p-4 rounded-xl border ' + (view.reconciliation.ok ? 'bg-success-soft text-success border-success/30' : 'bg-danger-soft text-danger border-danger/30') }, [
        h('div', { key: 't', className: 'font-bold' }, view.reconciliationText),
        h('div', { key: 'f', className: 'text-caption mt-1' }, `Σ métodos ${fmt(view.reconciliation.distributedNet)} + sin distribución ${fmt(view.undistributed)} = neto ${fmt(view.net)}`),
      ]),
      view.undistributed ? h('div', { key: 'und', className: 'mt-4 p-4 rounded-xl bg-warning-soft text-warning' }, `Importe histórico sin distribución: ${fmt(view.undistributed)}. Se conserva visible y no se atribuye sin evidencia.`) : null,
      view.courtesies ? h('div', { key: 'courtesy', className: 'mt-4 p-4 rounded-xl bg-surface-container-low text-on-surface-variant' }, `Cortesías: ${view.courtesies} operaciones · $0.00 ingresado`) : null,
    ]);
  }

  // ── Shell con pestañas ─────────────────────────────────────────────────────
  function ReportsScreen({ onNav }) {
    const [tab, setTab] = useState('resumen');
    const TABS = [['resumen', 'Resumen', 'chart'], ['metodos', 'Ingresos por método', 'cash'], ['ventas', 'Ventas', 'receipt'], ['cambios', 'Cambios', 'swap'], ['devoluciones', 'Devoluciones', 'undo']];
    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'w-full min-w-0 px-4 py-6 sm:px-6 lg:p-10 max-w-container-max mx-auto' }, [
        h('div', { key: 'tabs', className: 'flex items-center gap-2 p-1.5 mb-8 bg-surface-container-low rounded-xl border border-outline-variant overflow-x-auto no-scrollbar', role: 'tablist', 'aria-label': 'Secciones de reportes' },
          TABS.map(([id, label, icon]) => h('button', {
            key: id, onClick: () => setTab(id),
            'data-testid': id === 'cambios' ? 'reports-tab-exchanges'
              : `reports-tab-${id === 'resumen' ? 'summary' : (id === 'ventas' ? 'sales' : id)}`,
            className: 'flex items-center gap-2 px-6 py-2.5 rounded-lg text-caption font-bold uppercase tracking-wider transition-all ' +
              (tab === id ? 'bg-primary text-on-primary shadow-e2' : 'text-on-surface-variant hover:text-primary hover:bg-surface-container'),
          }, [h(MS, { key: 'i', name: icon, size: 18 }), label]))),
        tab === 'metodos' ? h(PaymentMethodReport, { key: 'pay' })
          : tab === 'ventas' ? h(SalesReport, { key: 'ven' })
          : tab === 'cambios' ? h(ExchangesReport, { key: 'cam' })
          : tab === 'devoluciones' ? h(ReturnsReport, { key: 'dev' })
            : h(ResumenReport, { key: 'res', onNav }),
      ]));
  }

  // ── Tarjeta de métrica y chip de variación (reutilizables en el reporte) ───────
  function metricCard(label, value, sub, extra, accent) {
    return h(window.UI.KPI, { key: label, label, value, className: accent ? 'border-l-4 border-l-primary' : '', helper: h('div', { className: 'flex flex-wrap items-center justify-between gap-2' }, [sub ? h('span', { key: 's' }, sub) : null, extra || null]) });
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
    const [reprintSale, setReprintSale] = useState(null);

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
    // H-69: la comision de una venta es la que quedo CONGELADA en el documento.
    // Ya no se reconstruye con el porcentaje vigente del vendedor, que daria una
    // cifra distinta cada vez que el dueno edita la politica (AP-06).
    const commOf = (s) => {
      if (!isValid(s)) return 0;
      return D.saleFrozenCommissions(s).reduce((a, c) => a + (Number(c.monto) || 0), 0);
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
    const pagosPeriodo = (D.payments || []).filter(p => inWin(p.fecha));
    const totalCobrado = pagosPeriodo.reduce((a, p) => a + (Number(p.monto) || 0), 0);
    const pendientesPeriodo = validPeriod.reduce((a, s) => a + (Number(s.saldo) || 0), 0);
    const descuentosPeriodo = validPeriod.reduce((a, s) => a + (Number(s.descuento) || 0), 0);
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
        return { id: s.folio, fecha: s.fecha, folio: s.folio, cliente: s.cliente, producto: productLabel(s), vendedor: sellerNames(s).join(', ') || '—', metodo: s.metodo || '—', monto: Number(s.total) || 0, comision: commOf(s), estado: s.estado, prod, sale: s };
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
      h('div', { key: 'finance', className: 'grid grid-cols-1 md:grid-cols-3 gap-gutter mb-gutter' }, [
        metricCard('Cobrado en el periodo', fmt(totalCobrado).replace('.00', ''), 'según historial de pagos'),
        metricCard('Saldo pendiente', fmt(pendientesPeriodo).replace('.00', ''), 'apartados del periodo'),
        metricCard('Descuentos concedidos', fmt(descuentosPeriodo).replace('.00', ''), 'incluyen IVA'),
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
              ['Fecha', 'Folio', 'Cliente', 'Producto', 'Vendedor', 'Método', 'Monto', 'Comisión', 'Estado', 'Acciones'].map((c, i) => h('th', { key: i, className: 'px-5 py-3 text-overline font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap' + ((c === 'Monto' || c === 'Comisión' || c === 'Estado') ? ' text-right' : '') }, c)))),
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
              h('td', { key: 'a', className: 'px-5 py-3 text-right' }, h('button', {
                'data-testid': `sales-reprint-${r.folio}`,
                onClick: () => setReprintSale(D.findSaleByFolio(r.folio)),
                className: 'px-3 py-2 border border-outline-variant rounded-lg text-caption font-semibold hover:bg-surface-container',
              }, 'Reimprimir')),
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
      reprintSale ? h(ReprintSaleModal, { key: 'rp', sale: reprintSale, onClose: () => setReprintSale(null) }) : null,
    ]);
  }

  window.ReportsScreen = ReportsScreen;
})();
