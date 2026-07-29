// layaway.jsx — Pantalla de Apartados (H-40). Exporta window.LayawayScreen
//
// Un apartado vive entre dos momentos: se registra en el Punto de venta con un anticipo
// (balam/pos-ticket.jsx § CheckoutModal) y se liquida cuando el saldo llega a cero
// (DATA.registrarPagoApartado → DATA.finalizarApartado). Entre esos dos momentos el
// negocio necesita ver la cartera, cobrar abonos y entregar comprobante. Esta pantalla
// es ese intermedio; NO decide nada de dominio.
//
// Autoridades que se consumen sin recalcular:
//   · DATA.registrarPagoApartado — única forma de asentar un abono (valida monto, método,
//     historial de pagos, liquidación, stock, comisión y push a la nube).
//   · DATA.paymentsForSale — historial de pagos de la venta.
//   · CONFIG payment_method — catálogo de formas de pago administrable.
//   · window.BalamTicket — comprobante impreso. Esta pantalla NO define un segundo
//     formato de ticket: usa el del Punto de venta y le pasa el pago recibido.
// El saldo mostrado es el persistido en la venta; sólo se deriva cuando falta (ventas
// anteriores a que `saldo` existiera), con la misma fórmula que usa DATA.
(function () {
  const { useState, useMemo, useEffect } = React;
  const { fmt, toast, Modal, Segment } = window.UI;
  const { MS, GlassCard, SerifHeading } = window.HX;
  const C = window.CONFIG;
  const D = window.DATA;
  const h = React.createElement;

  const CARD = 'bg-surface-container-lowest rounded-lg shadow-e1';
  // Formas de pago que DATA.registrarPagoApartado acepta (balam/data.jsx § registrarPagoApartado).
  // El catálogo de CONFIG manda el orden y la presencia; esta lista es el filtro de lo asentable.
  const ABONABLES = ['Efectivo', 'Tarjeta', 'Transferencia', 'Mixto'];
  const REZAGO_DIAS = 30;   // umbral del filtro «+30 días». Es descriptivo: no bloquea nada.

  // ── Derivaciones de presentación ────────────────────────────────────────────
  const saldoDe = s => s.saldo != null
    ? Math.max(0, Number(s.saldo) || 0)
    : Math.max(0, (Number(s.total) || 0) - (Number(s.anticipo) || 0));
  const pagadoDe = s => Math.max(0, (Number(s.total) || 0) - saldoDe(s));
  const pctDe = s => { const t = Number(s.total) || 0; return t > 0 ? Math.min(100, Math.round(pagadoDe(s) / t * 100)) : 0; };
  const fechaDe = s => String(s.fecha || '').slice(0, 10);
  function diasDe(s) {
    const d = new Date(String(s.fecha || '').replace(' ', 'T'));
    if (isNaN(d)) return null;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
  }
  const abonosDe = folio => (D.paymentsForSale ? D.paymentsForSale(folio) : []).filter(p => p.tipo === 'abono' || p.tipo === 'liquidacion');

  const FILTROS = [['todos', 'Todos'], ['sin_abonos', 'Solo anticipo'], ['con_abonos', 'Con abonos'], ['rezagados', '+' + REZAGO_DIAS + ' días']];

  function metodosAbono() {
    const cat = (C.codes('payment_method') || []).filter(m => ABONABLES.includes(m));
    const ids = cat.length ? cat : ABONABLES.slice();
    return ids.map(id => ({ id, icon: ((C.find('payment_method', id) || {}).meta || {}).icon || 'cash' }));
  }

  // ── Pantalla ────────────────────────────────────────────────────────────────
  function LayawayScreen() {
    const [q, setQ] = useState('');
    const [filtro, setFiltro] = useState('todos');
    const [abonando, setAbonando] = useState(null);   // folio en captura
    const [recibo, setRecibo] = useState(null);       // { sale, payment, liquidado } tras asentar
    const [reimprimir, setReimprimir] = useState(null); // folio a reimprimir sin cobrar
    const [, bump] = useState(0);
    const refresh = () => bump(v => v + 1);

    const term = q.trim().toLowerCase();
    // La lista se recalcula con cada abono: el saldo, el porcentaje y el propio conjunto
    // cambian cuando una liquidación saca al apartado del estado 'Apartado'.
    const rows = useMemo(() => D.sales
      .filter(s => s.estado === 'Apartado')
      .filter(s => !term
        || String(s.folio).toLowerCase().includes(term)
        || (D.saleFolioAliases ? D.saleFolioAliases(s) : []).some(a => String(a).toLowerCase().includes(term))
        || String(s.cliente || '').toLowerCase().includes(term))
      .filter(s => {
        if (filtro === 'sin_abonos') return abonosDe(s.folio).length === 0;
        if (filtro === 'con_abonos') return abonosDe(s.folio).length > 0;
        if (filtro === 'rezagados') { const d = diasDe(s); return d != null && d > REZAGO_DIAS; }
        return true;
      })
      // Más antiguo primero: es el que reclama gestión.
      .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || ''))),
    [term, filtro, D.sales.length, abonando, recibo]);

    // KPIs de la cartera completa (no del filtro): el dueño pregunta «cuánto me deben».
    const todos = D.sales.filter(s => s.estado === 'Apartado');
    const porCobrar = todos.reduce((a, s) => a + saldoDe(s), 0);
    const yaCobrado = todos.reduce((a, s) => a + pagadoDe(s), 0);
    const comprometido = todos.reduce((a, s) => a + (Number(s.total) || 0), 0);
    const piezas = todos.reduce((a, s) => a + (Number(s.items) || (s.lineas || []).reduce((b, l) => b + (Number(l.qty) || 0), 0)), 0);
    const antiguo = todos.reduce((a, s) => { const d = diasDe(s); return d != null && d > a ? d : a; }, 0);
    const rezagados = todos.filter(s => { const d = diasDe(s); return d != null && d > REZAGO_DIAS; }).length;

    const saleAbonando = abonando ? D.sales.find(s => s.folio === abonando) : null;

    function onAsentado(res) {
      setAbonando(null);
      setRecibo(res);
      refresh();
    }

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'p-6 max-w-[1280px] mx-auto space-y-6' }, [

        // Encabezado + acciones de salida (imprimir listado / Excel)
        h('div', { key: 'hd', className: 'flex flex-wrap items-end justify-between gap-4' }, [
          h('div', { key: 't' }, [
            h(SerifHeading, { key: 'a', level: 'lg', className: 'italic', children: 'Apartados' }),
            h('p', { key: 'b', className: 'text-caption text-on-surface-variant mt-1' },
              todos.length ? `${todos.length} apartado(s) abiertos · ${fmt(porCobrar).replace('.00', '')} por cobrar` : 'No hay apartados abiertos.'),
          ]),
          h('div', { key: 'act', className: 'flex gap-3' }, [
            h('button', {
              key: 'p', className: 'flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container-low transition-all text-body font-semibold',
              onClick: () => imprimirListado(rows),
            }, [h(MS, { key: 'i', name: 'print', size: 16 }), 'Imprimir listado']),
            h('button', {
              key: 'x', className: 'flex items-center gap-2 px-6 py-2 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-all text-body font-semibold shadow-e2',
              onClick: () => {
                if (!rows.length) { toast('No hay apartados para exportar', 'var(--danger)'); return; }
                window.XLSXIO.exportLayaways(rows.map(filaExport));
              },
            }, [h(MS, { key: 'i', name: 'download', size: 16 }), 'Exportar Excel']),
          ]),
        ]),

        // KPIs
        h('div', { key: 'kpi', className: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4' }, [
          kpi('Saldo por cobrar', fmt(porCobrar).replace('.00', ''), 'cash', `${todos.length} apartado(s) abiertos`, 'gold'),
          kpi('Anticipos y abonos', fmt(yaCobrado).replace('.00', ''), 'check', `de ${fmt(comprometido).replace('.00', '')} comprometidos`, 'success'),
          kpi('Piezas comprometidas', String(piezas), 'box', 'aún no descontadas del inventario', 'neutral'),
          kpi('Apartado más antiguo', antiguo ? antiguo + ' días' : '—', 'clock', rezagados ? `${rezagados} con más de ${REZAGO_DIAS} días` : 'ninguno rezagado', rezagados ? 'warning' : 'neutral'),
        ]),

        // Búsqueda + filtros
        h(GlassCard, { key: 'f', className: 'p-4 flex flex-wrap items-center gap-4' }, [
          h('div', { key: 's', className: 'relative flex-1 min-w-[240px]' }, [
            h(MS, { key: 'i', name: 'search', size: 18, className: 'absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant' }),
            h('input', {
              key: 'in', value: q, onChange: e => setQ(e.target.value), placeholder: 'Buscar por folio o cliente…',
              className: 'w-full h-11 pl-10 pr-3 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary text-body rounded-lg',
            }),
          ]),
          h(Segment, { key: 'sg', value: filtro, onChange: setFiltro, options: FILTROS }),
        ]),

        // Listado
        h('div', { key: 'list', className: 'flex flex-col gap-3' }, rows.length
          ? rows.map(s => h(LayawayRow, { key: s.folio, sale: s, onAbonar: () => setAbonando(s.folio), onTicket: setReimprimir }))
          : h('div', { key: 'e', className: CARD + ' p-12 text-center' }, [
            h('div', { key: 'i', className: 'w-12 h-12 mx-auto mb-3 rounded-full grid place-items-center bg-surface-container text-on-surface-variant' }, h(MS, { name: 'clock', size: 24 })),
            h('div', { key: 't', className: 'font-headline text-h2 text-primary mb-1' }, todos.length ? 'Ningún apartado coincide con el filtro' : 'No hay apartados abiertos'),
            h('p', { key: 'd', className: 'text-caption text-on-surface-variant max-w-md mx-auto leading-relaxed' },
              todos.length ? 'Ajusta la búsqueda o vuelve a «Todos».' : 'Los apartados se registran en Punto de venta eligiendo el método «Apartado» con un cliente registrado.'),
          ])),

        // Nota operativa: la pieza no se reserva hasta liquidar (DATA.finalizarApartado).
        todos.length ? h('div', { key: 'nota', className: 'p-4 rounded-lg border flex gap-3', style: { borderColor: 'rgba(212,175,56,0.3)', background: 'rgba(212,175,56,0.06)' } }, [
          h(MS, { key: 'i', name: 'alert', size: 20, className: 'text-gold-text shrink-0' }),
          h('p', { key: 't', className: 'text-caption text-on-surface-variant leading-relaxed' },
            'Un apartado no descuenta inventario mientras tenga saldo: la pieza sigue disponible para venta en piso y el descuento ocurre al liquidarlo. El plazo de devolución también empieza a contar ese día.'),
        ]) : null,

        abonando && saleAbonando && h(AbonoModal, { key: 'ab', sale: saleAbonando, onClose: () => setAbonando(null), onDone: onAsentado }),
        recibo && h(ReciboModal, { key: 'rc', recibo, onClose: () => { setRecibo(null); refresh(); } }),
        // Comprobante térmico 80 mm: el MISMO ticket del Punto de venta
        // (window.BalamTicket), con el pago recibido como costura. Vive fuera de
        // pantalla y sólo él queda visible al imprimir (regla #balam-ticket de
        // POS Balam.html). Nunca hay dos montados a la vez.
        recibo ? h(window.BalamTicket, { key: 'tk', sale: recibo.sale, payment: recibo.payment }) : null,
        (!recibo && reimprimir) ? h(Reimpresion, { key: 'rp', folio: reimprimir, onDone: () => setReimprimir(null) }) : null,
      ]));
  }

  // ── Fila de apartado ────────────────────────────────────────────────────────
  // Cerrada muestra lo que se decide de un vistazo: cuánto debe y desde cuándo.
  // Abierta muestra la evidencia: qué se llevó apartado y cada pago recibido.
  function LayawayRow({ sale, onAbonar, onTicket }) {
    const [abierta, setAbierta] = useState(false);
    const saldo = saldoDe(sale);
    const pagado = pagadoDe(sale);
    const pct = pctDe(sale);
    const dias = diasDe(sale);
    const pagos = D.paymentsForSale ? D.paymentsForSale(sale.folio) : [];
    const abonos = pagos.filter(p => p.tipo === 'abono' || p.tipo === 'liquidacion');
    const rezagado = dias != null && dias > REZAGO_DIAS;
    const cliente = D.clients.find(c => c.nombre === sale.cliente && !c.generic);
    const tel = cliente && cliente.tel && cliente.tel !== '—' ? cliente.tel : null;
    const items = sale.items || (sale.lineas || []).reduce((a, l) => a + (Number(l.qty) || 0), 0);

    const chip = (icon, texto, cls) => h('span', { key: texto, className: 'inline-flex items-center gap-1 text-overline uppercase ' + (cls || 'text-on-surface-variant') }, [
      h(MS, { key: 'i', name: icon, size: 13 }), h('span', { key: 't' }, texto),
    ]);

    return h('div', { className: CARD + ' hover:shadow-e2 transition-shadow overflow-hidden' }, [
      h('div', { key: 'top', className: 'p-5 flex flex-wrap items-center gap-5' }, [
        // Folio y antigüedad
        h('div', { key: 'f', className: 'min-w-[9.5rem] shrink-0' }, [
          h('div', { key: 'a', className: 'font-headline text-h2 text-primary whitespace-nowrap' }, sale.folio),
          h('div', { key: 'b', className: 'text-overline uppercase text-on-surface-variant' }, fechaDe(sale)),
          dias != null && h('div', { key: 'c', className: 'mt-0.5' },
            chip(rezagado ? 'alert' : 'clock', dias === 0 ? 'Hoy' : `Hace ${dias} día${dias === 1 ? '' : 's'}`, rezagado ? 'text-warning' : 'text-on-surface-variant')),
        ]),
        // Cliente y avance
        h('div', { key: 'c', className: 'flex-1 min-w-[240px]' }, [
          h('div', { key: 'n', className: 'text-body font-medium text-primary truncate' }, sale.cliente || 'Público en general'),
          h('div', { key: 'm', className: 'flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5' }, [
            chip('box', `${items} art.`),
            chip('cash', abonos.length ? `${abonos.length} abono${abonos.length === 1 ? '' : 's'}` : 'Solo anticipo'),
            sale.vendedor ? chip('badge', sale.vendedor) : null,
          ]),
          h('div', { key: 'bar', className: 'mt-2.5 h-1.5 w-full max-w-md rounded-full bg-surface-container overflow-hidden' },
            h('div', { className: 'h-full rounded-full transition-all', style: { width: pct + '%', background: 'linear-gradient(90deg,#92760F,#D4AF38)' } })),
          h('div', { key: 'lb', className: 'text-overline uppercase text-on-surface-variant mt-1' },
            `${pct}% pagado · ${fmt(pagado).replace('.00', '')} de ${fmt(Number(sale.total) || 0).replace('.00', '')}`),
        ]),
        // Saldo
        h('div', { key: 's', className: 'text-right min-w-[7rem]' }, [
          h('div', { key: 'l', className: 'text-overline uppercase text-on-surface-variant' }, 'Saldo'),
          h('div', { key: 'v', className: 'font-headline text-h1 text-primary leading-none' }, fmt(saldo).replace('.00', '')),
        ]),
        // Acciones
        h('div', { key: 'act', className: 'flex items-center gap-2 shrink-0' }, [
          tel ? h('button', {
            key: 'tel', title: 'Llamar a ' + sale.cliente,
            className: 'w-11 h-11 grid place-items-center rounded-lg border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary transition',
            onClick: () => { const t = String(tel).replace(/[^0-9+]/g, ''); if (t) window.location.href = 'tel:' + t; },
          }, h(MS, { name: 'phone', size: 18 })) : null,
          h('button', {
            key: 'tk', title: 'Reimprimir el comprobante del apartado',
            className: 'w-11 h-11 grid place-items-center rounded-lg border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary transition',
            onClick: () => onTicket(sale.folio),
          }, h(MS, { name: 'print', size: 18 })),
          h('button', {
            key: 'b', onClick: onAbonar,
            className: 'px-5 h-11 flex items-center gap-2 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition',
          }, [h(MS, { key: 'i', name: 'cash', size: 18 }), 'Abonar']),
          h('button', {
            key: 'x', title: abierta ? 'Ocultar detalle' : 'Ver detalle y pagos',
            className: 'w-11 h-11 grid place-items-center rounded-lg text-on-surface-variant hover:text-primary transition',
            onClick: () => setAbierta(v => !v),
          }, h(MS, { name: abierta ? 'chevDown' : 'chevRight', size: 20 })),
        ]),
      ]),
      // Detalle desplegado
      abierta ? h('div', { key: 'det', className: 'px-5 pb-5 pt-1 border-t border-outline-variant grid grid-cols-1 md:grid-cols-2 gap-6' }, [
        h('div', { key: 'art' }, [
          h('div', { key: 't', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-2' }, 'Mercancía apartada'),
          (sale.lineas || []).length
            ? h('div', { key: 'l', className: 'space-y-1.5' }, sale.lineas.map((l, i) => h('div', { key: i, className: 'flex justify-between items-start gap-3 text-caption' }, [
              h('span', { key: 'n', className: 'text-on-surface flex-1 min-w-0' }, `${l.nombre} · Talla ${l.talla} · x${l.qty}`),
              h('span', { key: 'p', className: 'text-on-surface-variant shrink-0' }, fmt((Number(l.precio) || 0) * (Number(l.qty) || 0)).replace('.00', '')),
            ])))
            : h('p', { key: 'e', className: 'text-caption text-on-surface-variant' }, 'Venta sin detalle de renglones.'),
          tel ? h('div', { key: 'tel', className: 'mt-3 text-caption text-on-surface-variant' }, `Teléfono: ${tel}`) : null,
        ]),
        h('div', { key: 'pg' }, [
          h('div', { key: 't', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-2' }, 'Historial de pagos'),
          h('div', { key: 'l', className: 'space-y-1.5' }, pagos.map((p, i) => h('div', { key: p.id || i, className: 'flex justify-between items-center gap-3 text-caption' }, [
            h('span', { key: 'a', className: 'text-on-surface-variant' }, `${String(p.fecha || '').slice(0, 10)} · ${CONCEPTO_CORTO[p.tipo] || p.tipo || 'pago'} · ${p.metodo}`),
            h('span', { key: 'v', className: 'text-on-surface font-medium' }, fmt(p.monto).replace('.00', '')),
          ]))),
          h('div', { key: 'sm', className: 'flex justify-between items-center gap-3 mt-2 pt-2 border-t border-outline-variant text-caption font-semibold text-primary' }, [
            h('span', { key: 'l' }, 'Pagado'), h('span', { key: 'v' }, fmt(pagado).replace('.00', '')),
          ]),
        ]),
      ]) : null,
    ]);
  }
  const CONCEPTO_CORTO = { anticipo: 'Anticipo', abono: 'Abono', liquidacion: 'Liquidación', venta: 'Venta' };

  // ── Modal de abono ──────────────────────────────────────────────────────────
  // Captura monto + forma de pago y delega en DATA.registrarPagoApartado. Las validaciones
  // de aquí son de captura (evitar el intento imposible); la autoridad vuelve a validarlas.
  function AbonoModal({ sale, onClose, onDone }) {
    const METODOS = metodosAbono();
    const saldo = saldoDe(sale);
    const [metodo, setMetodo] = useState(() => (metodosAbono()[0] || { id: 'Efectivo' }).id);
    const [monto, setMonto] = useState(String(saldo));
    const [efectivo, setEfectivo] = useState('');
    const [otroMetodo, setOtroMetodo] = useState('Tarjeta');

    const inputCls = 'block w-full h-12 px-4 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary focus:border-primary text-base rounded-xl font-mono';
    const lbl = 'text-overline uppercase tracking-widest text-on-surface-variant mb-2';

    const amount = Number(monto);
    const montoValido = monto.trim() !== '' && Number.isFinite(amount) && amount > 0 && amount <= saldo + 0.009;
    const efe = Number(efectivo);
    const mixtoValido = metodo !== 'Mixto' || (efectivo.trim() !== '' && Number.isFinite(efe) && efe >= 0 && efe <= amount);
    const restanteMixto = Math.max(0, Math.round((amount - efe) * 100) / 100);
    const liquida = montoValido && Math.abs(amount - saldo) < 0.009;
    const nuevoSaldo = montoValido ? Math.max(0, Math.round((saldo - amount) * 100) / 100) : saldo;

    function confirmar() {
      if (!montoValido) { toast('El abono debe ser mayor a cero y no exceder el saldo.', 'var(--danger)'); return; }
      if (!mixtoValido) { toast('El desglose del pago mixto no cuadra con el monto.', 'var(--danger)'); return; }
      const detalle = metodo === 'Mixto'
        ? { efectivo: efe, [otroMetodo.toLowerCase()]: restanteMixto }
        : { [metodo.toLowerCase()]: Math.round(amount * 100) / 100 };
      const r = D.registrarPagoApartado(sale.folio, { monto: amount, metodo, detalle });
      if (!r.ok) { toast(r.error, 'var(--danger)'); return; }
      toast(r.liquidado ? 'Apartado liquidado · venta pagada' : 'Abono registrado · saldo ' + fmt(r.sale.saldo), 'var(--accent)');
      onDone({ sale: r.sale, payment: r.payment, liquidado: r.liquidado });
    }

    const footer = [
      h('button', { key: 'c', className: 'px-5 h-11 text-caption font-bold uppercase tracking-widest text-on-surface-variant hover:text-primary transition', onClick: onClose }, 'Cancelar'),
      h('button', {
        key: 'k', disabled: !montoValido || !mixtoValido, onClick: confirmar,
        className: 'px-6 h-11 flex items-center gap-2 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:bg-primary-container transition disabled:opacity-40 disabled:cursor-not-allowed',
      }, [h(MS, { key: 'i', name: 'check', size: 18 }), liquida ? 'Liquidar apartado' : 'Registrar abono']),
    ];

    return h(Modal, { title: 'Abonar a apartado', onClose, footer }, [
      // Contexto: de cuánto es el apartado y qué falta
      h('div', { key: 'ctx', className: 'bg-primary text-on-primary p-5 rounded-lg mb-5' }, [
        h('div', { key: 'a', className: 'flex justify-between items-center' }, [
          h('div', { key: 'l' }, [
            h('div', { key: 'a', className: 'text-caption opacity-70' }, `${sale.folio} · ${sale.cliente || 'Público en general'}`),
            h('div', { key: 'b', className: 'text-overline uppercase opacity-60 mt-0.5' }, 'Saldo pendiente'),
          ]),
          h('div', { key: 'v', className: 'font-headline text-h1 leading-none' }, fmt(saldo)),
        ]),
        h('div', { key: 'b', className: 'flex justify-between text-caption opacity-70 mt-3 pt-3 border-t border-white/15' }, [
          h('span', { key: 'l' }, `Total ${fmt(Number(sale.total) || 0)}`),
          h('span', { key: 'v' }, `Pagado ${fmt(pagadoDe(sale))}`),
        ]),
      ]),
      // Monto
      h('div', { key: 'mo', className: 'mb-4' }, [
        h('div', { key: 'l', className: lbl }, 'Monto del abono'),
        h('input', { key: 'in', className: inputCls, type: 'number', min: '0', step: '0.01', placeholder: '0.00', value: monto, onChange: e => setMonto(e.target.value), autoFocus: true }),
        h('div', { key: 'q', className: 'flex flex-wrap gap-2 mt-2' }, [
          h('button', {
            key: 'all', onClick: () => setMonto(String(saldo)),
            className: 'px-3 py-1.5 text-caption font-semibold border rounded-full transition-colors ' + (liquida ? 'border-primary text-primary bg-surface-container-low' : 'border-outline-variant hover:border-primary'),
          }, 'Liquidar todo · ' + fmt(saldo).replace('.00', '')),
          ...[0.5, 0.25].map(frac => {
            const v = Math.round(saldo * frac * 100) / 100;
            return v > 0 && v < saldo ? h('button', {
              key: 'f' + frac, onClick: () => setMonto(String(v)),
              className: 'px-3 py-1.5 text-caption font-semibold border border-outline-variant rounded-full hover:border-primary transition-colors',
            }, `${Math.round(frac * 100)}% · ${fmt(v).replace('.00', '')}`) : null;
          }),
        ]),
      ]),
      // Forma de pago — mismo idioma visual que el cobro del POS
      h('div', { key: 'ml', className: lbl }, 'Forma de pago'),
      h('div', { key: 'm', className: 'grid gap-2 mb-4', style: { gridTemplateColumns: `repeat(${Math.min(METODOS.length, 4)}, minmax(0, 1fr))` } },
        METODOS.map(m => h('button', {
          key: m.id,
          className: 'flex flex-col items-center gap-1.5 py-3 border rounded-xl transition-colors ' +
            (metodo === m.id ? 'border-primary bg-surface-container-low text-primary' : 'border-outline-variant text-on-surface-variant hover:border-primary'),
          onClick: () => setMetodo(m.id),
        }, [
          h(MS, { key: 'i', name: m.icon, size: 22, fill: metodo === m.id }),
          h('span', { key: 't', className: 'text-[9px] leading-none tracking-tight uppercase w-full text-center truncate', title: m.id }, m.id),
        ]))),
      metodo === 'Mixto' && h('div', { key: 'mix', className: 'mb-4' }, [
        h('div', { key: 'l', className: lbl }, 'Parte en efectivo'),
        h('input', { key: 'in', className: inputCls, type: 'number', min: '0', step: '0.01', placeholder: '0.00', value: efectivo, onChange: e => setEfectivo(e.target.value) }),
        h('div', { key: 'r', className: 'flex justify-between items-center mt-3 pt-3 border-t border-outline-variant gap-3' }, [
          h('select', { key: 'm', className: inputCls + ' max-w-[190px]', value: otroMetodo, onChange: e => setOtroMetodo(e.target.value) }, [
            h('option', { key: 't', value: 'Tarjeta' }, 'Resto con tarjeta'),
            h('option', { key: 'x', value: 'Transferencia' }, 'Resto por transferencia'),
          ]),
          h('span', { key: 'v', className: 'font-headline text-h2 text-primary' }, fmt(restanteMixto)),
        ]),
      ]),
      (metodo === 'Tarjeta' || metodo === 'Transferencia') && h('div', { key: 'simple', className: 'flex items-start gap-2 p-3 bg-surface-container-low text-on-surface-variant text-caption rounded-lg mb-4' }, [
        h(MS, { key: 'i', name: (METODOS.find(m => m.id === metodo) || {}).icon || 'cash', size: 16 }),
        metodo === 'Tarjeta' ? 'Cobra en la terminal antes de confirmar.' : 'Confirma la transferencia por ' + fmt(montoValido ? amount : 0) + ' antes de cerrar.',
      ]),
      // Efecto del abono
      h('div', { key: 'ef', className: 'p-4 rounded-lg bg-surface-container-low' }, [
        h('div', { key: 'a', className: 'flex justify-between items-center' }, [
          h('span', { key: 'l', className: 'text-body text-on-surface-variant' }, 'Saldo después del abono'),
          h('span', { key: 'v', className: 'font-headline text-h2 ' + (liquida ? 'text-success' : 'text-primary') }, fmt(nuevoSaldo)),
        ]),
        liquida && h('div', { key: 'b', className: 'flex items-start gap-2 mt-3 pt-3 border-t border-outline-variant text-caption text-on-surface-variant leading-relaxed' }, [
          h(MS, { key: 'i', name: 'check', size: 16, className: 'text-success shrink-0' }),
          'Al liquidar se descuenta el inventario, se acredita la comisión del vendedor y arranca el plazo de devolución. La mercancía se entrega hoy.',
        ]),
      ]),
    ]);
  }

  // ── Reimpresión del comprobante del apartado ────────────────────────────────
  // Sin cobrar nada: monta el ticket con el último pago registrado —el que el
  // cliente ya tiene en la mano— y lo manda a la impresora.
  function Reimpresion({ folio, onDone }) {
    const sale = D.sales.find(s => s.folio === folio);
    const pagos = sale && D.paymentsForSale ? D.paymentsForSale(folio) : [];
    const ultimo = pagos.length ? pagos[pagos.length - 1] : null;
    useEffect(() => {
      if (!sale) { onDone(); return; }
      const t = setTimeout(() => { window.print(); toast('Comprobante enviado a la impresora'); onDone(); }, 250);
      return () => clearTimeout(t);
    }, []);
    if (!sale) return null;
    return h(window.BalamTicket, { sale, payment: ultimo });
  }

  // ── Modal de comprobante ────────────────────────────────────────────────────
  function ReciboModal({ recibo, onClose }) {
    const { sale, payment, liquidado } = recibo;
    // Mismo comportamiento que la venta: si la impresión automática está activa, se dispara.
    useEffect(() => {
      if (C.get('print.auto')) { const t = setTimeout(() => window.print(), 350); return () => clearTimeout(t); }
    }, []);
    const footer = [
      h('button', {
        key: 'p', className: 'flex-1 py-3.5 border border-outline-variant text-on-surface text-caption font-bold uppercase tracking-widest rounded-xl hover:bg-surface-container transition flex items-center justify-center gap-2',
        onClick: () => window.print(),
      }, [h(MS, { key: 'i', name: 'print', size: 18 }), 'Imprimir comprobante']),
      h('button', { key: 'n', className: 'flex-1 py-3.5 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-xl hover:opacity-90 transition', onClick: onClose }, 'Listo'),
    ];
    return h(Modal, { title: '', onClose, footer }, [
      h('div', { key: 'b', className: 'text-center py-2' }, [
        h('div', { key: 'i', className: 'w-16 h-16 bg-success-soft text-success rounded-full grid place-items-center mx-auto mb-6' }, h(MS, { name: 'check', size: 32 })),
        h('h2', { key: 't', className: 'font-headline text-h1 text-primary mb-2' }, liquidado ? 'Apartado liquidado' : 'Abono registrado'),
        h('p', { key: 'p', className: 'text-caption text-on-surface-variant leading-relaxed' },
          `${fmt(payment ? payment.monto : 0)} en ${payment ? payment.metodo : '—'} · folio ${sale.folio}.`),
        h('p', { key: 's', className: 'text-caption text-on-surface-variant mt-1' },
          liquidado ? 'Entrega la mercancía: el inventario ya se descontó.' : `Saldo pendiente ${fmt(saldoDe(sale))}.`),
      ]),
    ]);
  }

  // ── KPI ─────────────────────────────────────────────────────────────────────
  const KPI_TONE = {
    gold: 'bg-gold-soft text-gold-text', success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning', neutral: 'bg-surface-container text-on-surface-variant',
  };
  function kpi(label, value, icon, sub, tone) {
    return h('div', { key: label, className: CARD + ' p-5 flex items-start gap-4' }, [
      h('div', { key: 'i', className: 'w-11 h-11 rounded-xl grid place-items-center shrink-0 ' + (KPI_TONE[tone] || KPI_TONE.neutral) }, h(MS, { name: icon, size: 22 })),
      h('div', { key: 't', className: 'min-w-0' }, [
        h('div', { key: 'a', className: 'text-overline uppercase text-on-surface-variant' }, label),
        h('div', { key: 'b', className: 'font-headline text-h1 text-primary leading-tight' }, value),
        h('div', { key: 'c', className: 'text-caption text-on-surface-variant' }, sub),
      ]),
    ]);
  }

  // ── Salidas: Excel e impresión del listado ──────────────────────────────────
  // Fila plana compartida por el .xlsx y por el listado impreso: una sola definición
  // de «qué columnas describen un apartado».
  function filaExport(s) {
    const abonos = abonosDe(s.folio);
    const ultimo = abonos.length ? abonos[abonos.length - 1] : null;
    return {
      folio: s.folio,
      fecha: fechaDe(s),
      dias: diasDe(s),
      cliente: s.cliente || 'Público en general',
      vendedor: s.vendedor || '—',
      items: s.items || (s.lineas || []).reduce((a, l) => a + (Number(l.qty) || 0), 0),
      total: Number(s.total) || 0,
      pagado: pagadoDe(s),
      saldo: saldoDe(s),
      pct: pctDe(s),
      abonos: abonos.length,
      ultimoAbono: ultimo ? String(ultimo.fecha || '').slice(0, 10) : '—',
      articulos: (s.lineas || []).map(l => `${l.nombre} T${l.talla} x${l.qty}`).join(' · '),
    };
  }

  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // El listado se imprime en una ventana propia, como las etiquetas de Inventario
  // (balam/inventory.jsx § printLabels): la regla @media print de la app deja visible
  // sólo #balam-ticket (80 mm), que no sirve para un reporte tabular en hoja carta.
  function imprimirListado(rows) {
    if (!rows.length) { toast('No hay apartados para imprimir', 'var(--danger)'); return; }
    const datos = rows.map(filaExport);
    const totSaldo = datos.reduce((a, r) => a + r.saldo, 0);
    const totPagado = datos.reduce((a, r) => a + r.pagado, 0);
    const totTotal = datos.reduce((a, r) => a + r.total, 0);
    const tienda = C.get('store.name') || 'Balam Guayaberas';
    const hoy = new Date().toLocaleString('es-MX');
    const tr = datos.map(r => `<tr>
      <td class="mono">${escapeHtml(r.folio)}</td>
      <td>${escapeHtml(r.fecha)}<div class="sub">${r.dias == null ? '' : r.dias + ' días'}</div></td>
      <td>${escapeHtml(r.cliente)}<div class="sub">${escapeHtml(r.articulos)}</div></td>
      <td class="num">${r.items}</td>
      <td class="num">${escapeHtml(fmt(r.total))}</td>
      <td class="num">${escapeHtml(fmt(r.pagado))}<div class="sub">${r.pct}% · ${r.abonos} abono(s)</div></td>
      <td class="num strong">${escapeHtml(fmt(r.saldo))}</td>
    </tr>`).join('');
    const win = window.open('', '_blank', 'width=980,height=720');
    if (!win) { toast('Permite las ventanas emergentes para imprimir', 'var(--danger)'); return; }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Apartados — ${escapeHtml(tienda)}</title><style>
      @page { size: A4 landscape; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #131B2E; }
      h1 { font-size: 22pt; margin: 0 0 2pt; letter-spacing: .02em; }
      .meta { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #5b6478; margin-bottom: 14pt; }
      .cards { display: flex; gap: 10pt; margin-bottom: 14pt; }
      .card { flex: 1; border: 1px solid #d8dbe3; border-radius: 6pt; padding: 8pt 10pt; }
      .card .k { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .12em; color: #5b6478; }
      .card .v { font-size: 16pt; margin-top: 2pt; }
      table { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; }
      th { text-align: left; text-transform: uppercase; letter-spacing: .08em; font-size: 7.5pt; color: #5b6478; border-bottom: 1.5pt solid #131B2E; padding: 5pt 4pt; }
      td { padding: 6pt 4pt; border-bottom: .5pt solid #e2e5eb; vertical-align: top; }
      tr { page-break-inside: avoid; }
      .num { text-align: right; white-space: nowrap; }
      .strong { font-weight: 700; font-size: 9.5pt; }
      .mono { font-family: 'Courier New', monospace; white-space: nowrap; }
      .sub { color: #7a8296; font-size: 7.5pt; margin-top: 1pt; }
      tfoot td { border-top: 1.5pt solid #131B2E; border-bottom: none; font-weight: 700; font-size: 9.5pt; padding-top: 7pt; }
      .foot { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #7a8296; margin-top: 12pt; }
    </style></head><body>
      <h1>Apartados por cobrar</h1>
      <div class="meta">${escapeHtml(tienda)} · emitido ${escapeHtml(hoy)} · ${datos.length} apartado(s)</div>
      <div class="cards">
        <div class="card"><div class="k">Saldo por cobrar</div><div class="v">${escapeHtml(fmt(totSaldo))}</div></div>
        <div class="card"><div class="k">Anticipos y abonos</div><div class="v">${escapeHtml(fmt(totPagado))}</div></div>
        <div class="card"><div class="k">Total comprometido</div><div class="v">${escapeHtml(fmt(totTotal))}</div></div>
      </div>
      <table>
        <thead><tr><th>Folio</th><th>Fecha</th><th>Cliente y mercancía</th><th class="num">Art.</th><th class="num">Total</th><th class="num">Pagado</th><th class="num">Saldo</th></tr></thead>
        <tbody>${tr}</tbody>
        <tfoot><tr><td colspan="4">Totales</td><td class="num">${escapeHtml(fmt(totTotal))}</td><td class="num">${escapeHtml(fmt(totPagado))}</td><td class="num">${escapeHtml(fmt(totSaldo))}</td></tr></tfoot>
      </table>
      <div class="foot">Un apartado no descuenta inventario mientras tenga saldo: la pieza se entrega y se descuenta al liquidarlo.</div>
      <scr` + `ipt>window.onload=function(){window.focus();window.print();setTimeout(function(){window.close();},400);};</scr` + `ipt>
    </body></html>`);
    win.document.close();
  }

  window.LayawayScreen = LayawayScreen;
})();
