// loans.jsx — Pantalla de Préstamos (H-46). Exporta window.LoansScreen
//
// Un préstamo es mercancía que SALE del negocio con la obligación de volver: una
// guayabera que un empleado se lleva puesta a un evento, varias piezas que un
// cliente se lleva a probar. Es un documento propio, no una venta de $0.
//
// Esta pantalla NO decide nada del dominio. Todo lo que cambia el estado de un
// préstamo pasa por su autoridad en `balam/data.jsx` § préstamos:
//   · DATA.registrarPrestamo            — alta, con la evidencia congelada
//   · DATA.registrarDevolucionPrestamo  — devolución total o parcial
//   · DATA.marcarPrestamoNoDevuelto     — declarar la pérdida
//   · DATA.actualizarPrestamo           — corregir la captura antes de que regrese algo
//   · DATA.eliminarPrestamo             — borrar una captura sin consecuencias
//   · DATA.prestamoAtraso               — única fuente de «vencido» y de los días
//   · DATA.prestamoPendientes           — piezas todavía fuera
// Las validaciones de aquí son de captura: evitan el intento imposible y la
// autoridad vuelve a comprobarlas.
//
// Idiomas de interacción reutilizados, no reinventados (`R-CLI-08`):
//   · cartera, KPIs, búsqueda, `Segment` de filtros, fila con detalle desplegable,
//     «Imprimir listado» y «Exportar Excel» → balam/layaway.jsx
//   · buscador de producto + selector de talla con existencias y precio de la talla
//     → balam/pos.jsx § SizeModal
//   · autocompletado en línea de la persona → balam/pos-ticket.jsx § ClientPicker
//   · listado y vale impresos en ventana propia → balam/inventory.jsx § printLabels
//
// Los tres estados —pendiente, devuelto, no devuelto— NO son un catálogo
// administrable: no son etiquetas, son el contrato del módulo. Un cuarto estado
// cambiaría comportamiento, no un rótulo.
(function () {
  const { useState, useMemo, useEffect, useRef } = React;
  const { fmt, fechaCorta, fechaHora, toast, Modal, Segment, Badge } = window.UI;
  const { MS, GlassCard, SerifHeading, ProductImage } = window.HX;
  const C = window.CONFIG;
  const D = window.DATA;
  const h = React.createElement;

  const CARD = 'bg-surface-container-lowest rounded-lg shadow-e1';
  const ESTADOS = {
    pendiente: { label: 'Pendiente', tone: 'warning', icon: 'clock' },
    devuelto: { label: 'Devuelto', tone: 'success', icon: 'check' },
    no_devuelto: { label: 'No devuelto', tone: 'danger', icon: 'alert' },
  };
  const TIPOS = {
    cliente: { label: 'Cliente', icon: 'users' },
    empleado: { label: 'Empleado', icon: 'badge' },
    otro: { label: 'Otro', icon: 'user' },
  };
  const FILTROS = [
    ['pendientes', 'Pendientes'], ['vencidos', 'Vencidos'],
    ['devueltos', 'Devueltos'], ['perdidos', 'No devueltos'], ['todos', 'Todos'],
  ];
  // Plazos sugeridos al capturar. Son atajos de escritura, no reglas: la fecha
  // esperada se puede teclear libremente.
  const PLAZOS = [[3, '3 días'], [7, '1 semana'], [15, '15 días'], [30, '1 mes']];

  // ── Derivaciones de presentación ────────────────────────────────────────────
  // `diaDe` NO es presentación: entrega el día en 'AAAA-MM-DD' para comparar fechas y
  // para llenar los campos `type="date"`, que sólo aceptan ese formato. Lo que se LEE
  // pasa siempre por `fechaCorta`/`fechaHora` (window.UI).
  const diaDe = v => String(v == null ? '' : v).slice(0, 10);
  const piezasDe = l => D.prestamoPiezas(l);
  const fueraDe = l => D.prestamoPendientes(l);
  const devueltasDe = l => piezasDe(l) - fueraDe(l);
  // Valor de lo que está fuera, al precio congelado del préstamo.
  const valorFueraDe = l => (l.lineas || []).reduce((a, x) => (
    a + Math.max(0, (Number(x.qty) || 0) - (Number(x.devueltas) || 0)) * (Number(x.precio) || 0)
  ), 0);
  const valorTotalDe = l => (l.lineas || []).reduce((a, x) => a + (Number(x.qty) || 0) * (Number(x.precio) || 0), 0);
  const mercanciaDe = l => (l.lineas || []).map(x => `${x.nombre} T${x.talla} x${x.qty}`).join(' · ');
  // Día LOCAL del negocio (el del mostrador), nunca UTC.
  function hoyISO() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function sumaDias(dia, dias) {
    const t = Date.parse(String(dia) + 'T00:00:00');
    if (isNaN(t)) return dia;
    const d = new Date(t + dias * 86400000), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  // ── Lector de código de barras (H-48) ───────────────────────────────────────
  // `window.BARCODES` es la autoridad del código `SKU-TALLA` y se consume tal cual:
  // aquí no se parsea ni se reimplementa la resolución de etiquetas.
  const leerCodigo = raw => (window.BARCODES ? window.BARCODES.find(raw) : null);
  const pareceCodigo = raw => !!(window.BARCODES && window.BARCODES.parse(raw));
  // Un lector HID teclea la ráfaga en el campo que tenga el foco. Cuando la ráfaga
  // resulta ser un código conocido y no cayó en el buscador, se retira del campo lo
  // que el lector acaba de escribir: si no, escanear con el foco en «quién recibe»
  // dejaría el código metido dentro del nombre de la persona.
  function retirarCodigoTecleado(el, code) {
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
    const valor = String(el.value == null ? '' : el.value);
    if (!valor.toUpperCase().endsWith(String(code).toUpperCase())) return;
    const proto = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, valor.slice(0, valor.length - String(code).length));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Tallas ofrecidas al capturar, agrupadas por escala como en el Punto de venta.
  // Sin `incluirVacias` sólo se ofrecen las que tienen existencia.
  const ESCALAS = [['L', 'Letras'], ['N', 'Números']];
  const tallaLbl = (escala, talla) => C.map(escala === 'N' ? 'size_number' : 'size_letter')[talla] || talla;
  function tallasVisibles(producto, incluirVacias) {
    const grupos = filtro => ESCALAS
      .map(([escala, etiqueta]) => [escala, etiqueta, (producto.stock || []).filter(v => v.escala === escala && filtro(v))])
      .filter(grupo => grupo[2].length);
    const conStock = grupos(v => v.stock > 0);
    // Una prenda sin ninguna existencia registrada ofrece todas sus tallas: si el
    // negocio la tiene en la mano, el dato equivocado es la existencia.
    return (incluirVacias || !conStock.length) ? grupos(() => true) : conStock;
  }
  const hayTallasVacias = producto => (producto.stock || []).some(v => !(v.stock > 0));

  // Texto del plazo. `dias` viene de DATA.prestamoAtraso: positivo = retraso.
  function textoPlazo(loan) {
    const a = D.prestamoAtraso(loan);
    if (loan.estado === 'devuelto') return { texto: 'Devuelto', icon: 'check', cls: 'text-success' };
    if (loan.estado === 'no_devuelto') return { texto: 'No devuelto', icon: 'alert', cls: 'text-danger' };
    if (a.dias == null) return { texto: 'Sin plazo', icon: 'clock', cls: 'text-on-surface-variant' };
    if (a.dias > 0) return { texto: `Vencido hace ${a.dias} día${a.dias === 1 ? '' : 's'}`, icon: 'alert', cls: 'text-danger' };
    if (a.dias === 0) return { texto: 'Vence hoy', icon: 'clock', cls: 'text-warning' };
    const faltan = -a.dias;
    return { texto: `Vence en ${faltan} día${faltan === 1 ? '' : 's'}`, icon: 'clock', cls: 'text-on-surface-variant' };
  }

  // ── Pantalla ────────────────────────────────────────────────────────────────
  function LoansScreen() {
    const [q, setQ] = useState('');
    const [filtro, setFiltro] = useState('pendientes');
    const [nuevo, setNuevo] = useState(false);
    const [editando, setEditando] = useState(null);      // folio en edición
    const [devolviendo, setDevolviendo] = useState(null); // folio en captura de devolución
    const [confirmando, setConfirmando] = useState(null); // { tipo, folio }
    const [vale, setVale] = useState(null);               // folio a imprimir
    const [, bump] = useState(0);
    const refresh = () => bump(v => v + 1);

    const term = q.trim().toLowerCase();
    // H-48: un código leído en el buscador responde «¿quién tiene esta prenda?». Se
    // resuelve con la autoridad del Punto de venta y busca en TODOS los estados: si la
    // prenda ya volvió, la respuesta útil sigue siendo el préstamo que la sacó.
    const escaneo = useMemo(() => (q.trim() ? leerCodigo(q.trim()) : null), [q]);
    const rows = useMemo(() => D.loans
      .filter(l => {
        if (escaneo) return (l.lineas || []).some(x => x.sku === escaneo.p.sku && x.talla === escaneo.talla);
        const a = D.prestamoAtraso(l);
        if (filtro === 'pendientes') return l.estado === 'pendiente';
        if (filtro === 'vencidos') return a.vencido;
        if (filtro === 'devueltos') return l.estado === 'devuelto';
        if (filtro === 'perdidos') return l.estado === 'no_devuelto';
        return true;
      })
      .filter(l => escaneo || !term
        || String(l.folio).toLowerCase().includes(term)
        || String(l.persona && l.persona.nombre || '').toLowerCase().includes(term)
        || (l.lineas || []).some(x => (
          String(x.nombre || '').toLowerCase().includes(term) || String(x.sku || '').toLowerCase().includes(term)
        )))
      // Lo abierto se ordena por urgencia (la fecha esperada más próxima primero);
      // lo cerrado, por lo más reciente.
      .sort((a, b) => {
        const abiertoA = a.estado === 'pendiente', abiertoB = b.estado === 'pendiente';
        if (abiertoA !== abiertoB) return abiertoA ? -1 : 1;
        if (abiertoA) return String(a.fechaEsperada || '').localeCompare(String(b.fechaEsperada || ''));
        return String(b.fecha || '').localeCompare(String(a.fecha || ''));
      }),
    [term, escaneo, filtro, D.loans.length, nuevo, devolviendo, confirmando, editando]);

    // Los indicadores describen la cartera completa, no el filtro: la pregunta del
    // dueño es «qué tengo fuera», no «qué estoy viendo».
    const pendientes = D.loans.filter(l => l.estado === 'pendiente');
    const perdidos = D.loans.filter(l => l.estado === 'no_devuelto');
    const vencidos = D.prestamosVencidos();
    const piezasFuera = pendientes.reduce((a, l) => a + fueraDe(l), 0);
    const valorFuera = pendientes.reduce((a, l) => a + valorFueraDe(l), 0);
    const valorPerdido = perdidos.reduce((a, l) => a + valorFueraDe(l), 0);
    const masAtrasado = vencidos.reduce((a, l) => { const d = D.prestamoAtraso(l).dias; return d != null && d > a ? d : a; }, 0);

    const loanDe = folio => D.loans.find(l => l.folio === folio) || null;
    const enEdicion = editando ? loanDe(editando) : null;
    const enDevolucion = devolviendo ? loanDe(devolviendo) : null;
    const enConfirmacion = confirmando ? loanDe(confirmando.folio) : null;

    function cerrarConfirmacion() { setConfirmando(null); refresh(); }
    function ejecutarConfirmacion(nota) {
      const loan = enConfirmacion;
      if (!loan) { cerrarConfirmacion(); return; }
      if (confirmando.tipo === 'perdido') {
        const r = D.marcarPrestamoNoDevuelto(loan.id, { nota });
        if (!r.ok) { toast(r.error, 'var(--danger)'); return; }
        toast('Préstamo declarado no devuelto', 'var(--danger)');
      } else {
        const r = D.eliminarPrestamo(loan.id);
        if (!r.ok) { toast(r.error, 'var(--danger)'); return; }
        toast('Préstamo eliminado');
      }
      cerrarConfirmacion();
    }

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'p-6 max-w-[1280px] mx-auto space-y-6' }, [

        // Encabezado y acciones
        h('div', { key: 'hd', className: 'flex flex-wrap items-end justify-between gap-4' }, [
          h('div', { key: 't' }, [
            h(SerifHeading, { key: 'a', level: 'lg', className: 'italic', children: 'Préstamos' }),
            h('p', { key: 'b', className: 'text-caption text-on-surface-variant mt-1' },
              pendientes.length
                ? `${pendientes.length} préstamo(s) pendientes · ${piezasFuera} pieza(s) fuera del negocio`
                : 'No hay mercancía prestada.'),
          ]),
          h('div', { key: 'act', className: 'flex flex-wrap gap-3' }, [
            h('button', {
              key: 'p', 'data-testid': 'loans-imprimir',
              className: 'flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container-low transition-all text-body font-semibold',
              onClick: () => imprimirListado(rows),
            }, [h(MS, { key: 'i', name: 'print', size: 16 }), 'Imprimir listado']),
            h('button', {
              key: 'x', 'data-testid': 'loans-excel',
              className: 'flex items-center gap-2 px-4 py-2 border border-outline-variant rounded-lg hover:bg-surface-container-low transition-all text-body font-semibold',
              onClick: () => {
                if (!rows.length) { toast('No hay préstamos para exportar', 'var(--danger)'); return; }
                window.XLSXIO.exportLoans(rows.map(filaExport));
              },
            }, [h(MS, { key: 'i', name: 'download', size: 16 }), 'Exportar Excel']),
            h('button', {
              key: 'n', 'data-testid': 'loans-nuevo',
              className: 'flex items-center gap-2 px-6 py-2 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-all text-body font-semibold shadow-e2',
              onClick: () => setNuevo(true),
            }, [h(MS, { key: 'i', name: 'add', size: 18 }), 'Registrar préstamo']),
          ]),
        ]),

        // Indicadores
        h('div', { key: 'kpi', className: 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4' }, [
          kpi('Piezas fuera', String(piezasFuera), 'loan', `${pendientes.length} préstamo(s) pendientes`, piezasFuera ? 'gold' : 'neutral'),
          kpi('Valor prestado', fmt(valorFuera).replace('.00', ''), 'cash', 'al precio del día del préstamo', 'neutral'),
          kpi('Vencidos', String(vencidos.length), 'alert',
            vencidos.length ? `el más atrasado, ${masAtrasado} día(s)` : 'ninguno pasado de fecha',
            vencidos.length ? 'danger' : 'success'),
          kpi('No devueltos', String(perdidos.length), 'x',
            perdidos.length ? `${fmt(valorPerdido).replace('.00', '')} declarados como pérdida` : 'sin pérdidas declaradas',
            perdidos.length ? 'warning' : 'neutral'),
        ]),

        // Búsqueda y filtros
        h(GlassCard, { key: 'f', className: 'p-4 flex flex-wrap items-center gap-4' }, [
          h('div', { key: 's', className: 'relative flex-1 min-w-[240px]' }, [
            h(MS, { key: 'i', name: 'barcode', size: 20, className: 'absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant' }),
            h('input', {
              key: 'in', 'data-testid': 'loans-buscar', value: q, onChange: e => setQ(e.target.value),
              placeholder: 'Escanea una prenda o busca por folio, persona o prenda…',
              className: 'w-full h-11 pl-11 pr-3 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary text-body rounded-lg',
            }),
          ]),
          h(Segment, { key: 'sg', value: filtro, onChange: setFiltro, options: FILTROS, testid: 'loans-filtro' }),
          // Una lectura ignora el filtro de estado a propósito; se dice en pantalla.
          escaneo ? h('div', {
            key: 'esc', 'data-testid': 'loans-escaneo',
            className: 'w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-gold-soft text-gold-text text-caption font-semibold',
          }, [
            h(MS, { key: 'i', name: 'barcode', size: 16 }),
            h('span', { key: 't' }, `Código leído · ${escaneo.p.nombre} talla ${escaneo.talla} · ${rows.length} préstamo(s) con esta pieza, en cualquier estado`),
          ]) : null,
        ]),

        // Listado
        h('div', { key: 'list', className: 'flex flex-col gap-3' }, rows.length
          ? rows.map(l => h(LoanRow, {
            key: l.folio, loan: l,
            onDevolver: () => setDevolviendo(l.folio),
            onVale: () => setVale(l.folio),
            onEditar: () => setEditando(l.folio),
            onPerdido: () => setConfirmando({ tipo: 'perdido', folio: l.folio }),
            onEliminar: () => setConfirmando({ tipo: 'eliminar', folio: l.folio }),
          }))
          : h('div', { key: 'e', className: CARD + ' p-12 text-center' }, [
            h('div', { key: 'i', className: 'w-12 h-12 mx-auto mb-3 rounded-full grid place-items-center bg-surface-container text-on-surface-variant' }, h(MS, { name: 'loan', size: 24 })),
            h('div', { key: 't', className: 'font-headline text-h2 text-primary mb-1' },
              escaneo ? 'Esta pieza no está en ningún préstamo'
                : D.loans.length ? 'Ningún préstamo coincide con el filtro' : 'No hay préstamos registrados'),
            h('p', { key: 'd', className: 'text-caption text-on-surface-variant max-w-md mx-auto leading-relaxed' },
              escaneo
                ? `${escaneo.p.nombre} talla ${escaneo.talla} nunca salió en préstamo, o el préstamo se registró con otra talla.`
                : D.loans.length
                  ? 'Ajusta la búsqueda o cambia el filtro a «Todos».'
                  : 'Registra un préstamo cuando una prenda salga del negocio con obligación de volver: un empleado que la porta en un evento o un cliente que se la lleva a probar.'),
          ])),

        // Nota operativa: el contrato del módulo, dicho donde se opera.
        D.loans.length ? h('div', { key: 'nota', className: 'p-4 rounded-lg border flex gap-3', style: { borderColor: 'rgba(212,175,56,0.3)', background: 'rgba(212,175,56,0.06)' } }, [
          h(MS, { key: 'i', name: 'alert', size: 20, className: 'text-gold-text shrink-0' }),
          h('p', { key: 't', className: 'text-caption text-on-surface-variant leading-relaxed' },
            'Un préstamo no descuenta inventario: la pieza sigue contando como existencia y puede venderse en piso por descuido. Usa el vale impreso como respaldo y revisa los vencidos antes de cerrar el día. Los préstamos se guardan en esta terminal y todavía no viajan a la nube: exporta el listado para respaldarlos.'),
        ]) : null,

        nuevo && h(PrestamoModal, { key: 'nv', onClose: () => setNuevo(false), onDone: () => { setNuevo(false); refresh(); } }),
        enEdicion && h(PrestamoModal, {
          key: 'ed', loan: enEdicion, onClose: () => setEditando(null),
          onDone: () => { setEditando(null); refresh(); },
        }),
        enDevolucion && h(DevolucionModal, {
          key: 'dv', loan: enDevolucion, onClose: () => setDevolviendo(null),
          onDone: () => { setDevolviendo(null); refresh(); },
        }),
        enConfirmacion && h(ConfirmarModal, {
          key: 'cf', tipo: confirmando.tipo, loan: enConfirmacion,
          onClose: cerrarConfirmacion, onConfirm: ejecutarConfirmacion,
        }),
        vale ? h(ValeImpreso, { key: 'vl', folio: vale, onDone: () => setVale(null) }) : null,
      ]));
  }

  // ── Fila de préstamo ────────────────────────────────────────────────────────
  // Cerrada muestra lo que se decide de un vistazo: quién tiene qué y para cuándo.
  // Abierta muestra la evidencia: mercancía, fechas, notas y devoluciones asentadas.
  function LoanRow({ loan, onDevolver, onVale, onEditar, onPerdido, onEliminar }) {
    const [abierta, setAbierta] = useState(false);
    const est = ESTADOS[loan.estado] || ESTADOS.pendiente;
    const tipo = TIPOS[(loan.persona || {}).tipo] || TIPOS.otro;
    const plazo = textoPlazo(loan);
    const piezas = piezasDe(loan);
    const fuera = fueraDe(loan);
    const devueltas = devueltasDe(loan);
    const pct = piezas > 0 ? Math.round(devueltas / piezas * 100) : 0;
    const tel = (loan.persona || {}).tel && loan.persona.tel !== '—' ? loan.persona.tel : null;
    const editable = !(loan.devoluciones || []).length;

    const chip = (icon, texto, cls) => h('span', { key: texto, className: 'inline-flex items-center gap-1 text-overline uppercase ' + (cls || 'text-on-surface-variant') }, [
      h(MS, { key: 'i', name: icon, size: 13 }), h('span', { key: 't' }, texto),
    ]);
    const iconBtn = (testid, title, icon, onClick, cls) => h('button', {
      key: testid, 'data-testid': testid, title,
      className: 'w-11 h-11 grid place-items-center rounded-lg border border-outline-variant transition ' +
        (cls || 'text-on-surface-variant hover:border-primary hover:text-primary'),
      onClick,
    }, h(MS, { name: icon, size: 18 }));

    return h('div', { className: CARD + ' hover:shadow-e2 transition-shadow overflow-hidden', 'data-testid': 'loan-row-' + loan.folio }, [
      h('div', { key: 'top', className: 'p-5 flex flex-wrap items-center gap-5' }, [
        // Folio y plazo
        h('div', { key: 'f', className: 'min-w-[10rem] shrink-0' }, [
          h('div', { key: 'a', className: 'font-headline text-h2 text-primary whitespace-nowrap' }, loan.folio),
          h('div', { key: 'b', className: 'text-overline uppercase text-on-surface-variant' }, fechaCorta(loan.fecha)),
          h('div', { key: 'c', className: 'mt-0.5' }, chip(plazo.icon, plazo.texto, plazo.cls)),
        ]),
        // Persona y mercancía
        h('div', { key: 'c', className: 'flex-1 min-w-[240px]' }, [
          h('div', { key: 'n', className: 'text-body font-medium text-primary truncate' }, (loan.persona || {}).nombre || '—'),
          h('div', { key: 'm', className: 'flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5' }, [
            chip(tipo.icon, tipo.label),
            chip('box', `${piezas} pieza${piezas === 1 ? '' : 's'}`),
            tel ? chip('phone', tel) : null,
          ]),
          h('div', { key: 'ml', className: 'text-caption text-on-surface-variant mt-1 truncate', title: mercanciaDe(loan) }, mercanciaDe(loan)),
          devueltas > 0 ? h('div', { key: 'bar', className: 'mt-2 h-1.5 w-full max-w-md rounded-full bg-surface-container overflow-hidden' },
            h('div', { className: 'h-full rounded-full transition-all', style: { width: pct + '%', background: 'linear-gradient(90deg,#047857,#34d399)' } })) : null,
          devueltas > 0 ? h('div', { key: 'lb', className: 'text-overline uppercase text-on-surface-variant mt-1' },
            `${devueltas} de ${piezas} devueltas`) : null,
        ]),
        // Estado
        h('div', { key: 's', className: 'text-right min-w-[8rem]' }, [
          h('div', { key: 'b' }, h(Badge, { tone: est.tone, children: est.label })),
          h('div', { key: 'v', className: 'text-overline uppercase text-on-surface-variant mt-1.5' },
            loan.estado === 'devuelto' ? fechaCorta(loan.fechaDevolucion) : `${fuera} fuera`),
        ]),
        // Acciones
        h('div', { key: 'act', className: 'flex items-center gap-2 shrink-0' }, [
          tel ? iconBtn('loan-llamar-' + loan.folio, 'Llamar a ' + loan.persona.nombre, 'phone', () => {
            const t = String(tel).replace(/[^0-9+]/g, '');
            if (t) window.location.href = 'tel:' + t;
          }) : null,
          iconBtn('loan-vale-' + loan.folio, 'Imprimir el vale del préstamo', 'print', onVale),
          loan.estado !== 'devuelto' ? h('button', {
            key: 'dv', 'data-testid': 'loan-devolver-' + loan.folio,
            className: 'px-5 h-11 flex items-center gap-2 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition',
            onClick: onDevolver,
          }, [h(MS, { key: 'i', name: 'check', size: 18 }), 'Devolver']) : null,
          h('button', {
            key: 'x', 'data-testid': 'loan-detalle-' + loan.folio,
            title: abierta ? 'Ocultar detalle' : 'Ver detalle del préstamo',
            className: 'w-11 h-11 grid place-items-center rounded-lg text-on-surface-variant hover:text-primary transition',
            onClick: () => setAbierta(v => !v),
          }, h(MS, { name: abierta ? 'chevDown' : 'chevRight', size: 20 })),
        ]),
      ]),
      // Detalle desplegado
      abierta ? h('div', { key: 'det', className: 'px-5 pb-5 pt-1 border-t border-outline-variant' }, [
        h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-2 gap-6' }, [
          h('div', { key: 'art' }, [
            h('div', { key: 't', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-2' }, 'Mercancía prestada'),
            h('div', { key: 'l', className: 'space-y-1.5' }, (loan.lineas || []).map(x => {
              const pend = Math.max(0, (Number(x.qty) || 0) - (Number(x.devueltas) || 0));
              return h('div', { key: x.key, className: 'flex justify-between items-start gap-3 text-caption' }, [
                h('span', { key: 'n', className: 'text-on-surface flex-1 min-w-0' }, `${x.nombre} · ${x.sku} · Talla ${x.talla} · x${x.qty}`),
                h('span', { key: 'p', className: 'shrink-0 ' + (pend ? 'text-warning' : 'text-success') },
                  pend ? `${pend} fuera` : 'devuelta'),
              ]);
            })),
            h('div', { key: 'v', className: 'flex justify-between items-center gap-3 mt-2 pt-2 border-t border-outline-variant text-caption font-semibold text-primary' }, [
              h('span', { key: 'l' }, 'Valor de la mercancía'), h('span', { key: 'v' }, fmt(valorTotalDe(loan))),
            ]),
            loan.nota ? h('p', { key: 'nt', className: 'text-caption text-on-surface-variant mt-3 leading-relaxed' }, 'Nota: ' + loan.nota) : null,
          ]),
          h('div', { key: 'fe' }, [
            h('div', { key: 't', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-2' }, 'Fechas'),
            h('div', { key: 'l', className: 'space-y-1.5 text-caption' }, [
              fila('Préstamo', fechaHora(loan.fecha) || '—'),
              fila('Devolución esperada', fechaCorta(loan.fechaEsperada) || '—'),
              fila('Devolución real', loan.fechaDevolucion
                ? fechaHora(loan.fechaDevolucion)
                : (loan.estado === 'no_devuelto' ? 'No regresó' : 'Pendiente')),
              loan.usuario ? fila('Registró', loan.usuario) : null,
            ]),
            (loan.devoluciones || []).length ? h('div', { key: 'h', className: 'mt-4' }, [
              h('div', { key: 't', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-2' }, 'Devoluciones registradas'),
              h('div', { key: 'l', className: 'space-y-1.5' }, loan.devoluciones.map((d, i) => h('div', { key: i, className: 'text-caption text-on-surface-variant' },
                `${fechaCorta(d.fecha)} · ${(d.lineas || []).reduce((a, x) => a + (Number(x.qty) || 0), 0)} pieza(s)` + (d.nota ? ` · ${d.nota}` : '')))),
            ]) : null,
            loan.notaCierre ? h('p', { key: 'nc', className: 'text-caption text-on-surface-variant mt-3 leading-relaxed' }, 'Cierre: ' + loan.notaCierre) : null,
          ]),
        ]),
        // Acciones de excepción: viven en el detalle, no en la fila cerrada.
        h('div', { key: 'ex', className: 'flex flex-wrap gap-2 mt-5 pt-4 border-t border-outline-variant' }, [
          editable ? h('button', {
            key: 'ed', 'data-testid': 'loan-editar-' + loan.folio,
            className: 'flex items-center gap-2 px-4 h-10 border border-outline-variant rounded-lg text-caption font-semibold text-on-surface-variant hover:border-primary hover:text-primary transition',
            onClick: onEditar,
          }, [h(MS, { key: 'i', name: 'edit', size: 16 }), 'Editar captura']) : null,
          loan.estado === 'pendiente' ? h('button', {
            key: 'pd', 'data-testid': 'loan-perdido-' + loan.folio,
            className: 'flex items-center gap-2 px-4 h-10 border border-outline-variant rounded-lg text-caption font-semibold text-danger hover:border-danger transition',
            onClick: onPerdido,
          }, [h(MS, { key: 'i', name: 'alert', size: 16 }), 'Marcar como no devuelto']) : null,
          editable ? h('button', {
            key: 'el', 'data-testid': 'loan-eliminar-' + loan.folio,
            className: 'flex items-center gap-2 px-4 h-10 border border-outline-variant rounded-lg text-caption font-semibold text-danger hover:border-danger transition',
            onClick: onEliminar,
          }, [h(MS, { key: 'i', name: 'trash', size: 16 }), 'Eliminar']) : null,
          !editable ? h('p', { key: 'ne', className: 'text-caption text-on-surface-variant' },
            'Con devoluciones registradas el préstamo ya no se edita ni se elimina: se corrige hacia adelante.') : null,
        ]),
      ]) : null,
    ]);
  }
  const fila = (etiqueta, valor) => h('div', { key: etiqueta, className: 'flex justify-between gap-3' }, [
    h('span', { key: 'l', className: 'text-on-surface-variant' }, etiqueta),
    h('span', { key: 'v', className: 'text-on-surface font-medium text-right' }, String(valor)),
  ]);

  // ── Alta y corrección del préstamo ──────────────────────────────────────────
  // Un solo formulario para las dos cosas. Con `loan` presente edita: la mercancía
  // queda de sólo lectura porque cambiarla sería otro préstamo, no una corrección.
  function PrestamoModal({ loan, onClose, onDone }) {
    const editar = !!loan;
    const hoy = hoyISO();
    const [lineas, setLineas] = useState(() => (loan ? (loan.lineas || []).map(x => Object.assign({}, x)) : []));
    const [tipo, setTipo] = useState(() => (loan && loan.persona ? loan.persona.tipo : 'cliente'));
    const [nombre, setNombre] = useState(() => (loan && loan.persona ? loan.persona.nombre : ''));
    const [tel, setTel] = useState(() => (loan && loan.persona ? loan.persona.tel : ''));
    const [personaId, setPersonaId] = useState(() => (loan && loan.persona ? loan.persona.id : null));
    const [fecha, setFecha] = useState(() => (loan ? diaDe(loan.fecha) : hoy));
    const [esperada, setEsperada] = useState(() => (loan ? loan.fechaEsperada : sumaDias(hoy, 7)));
    const [nota, setNota] = useState(() => (loan ? loan.nota || '' : ''));
    const [busca, setBusca] = useState('');
    const [picking, setPicking] = useState(null); // producto elegido, pendiente de talla
    const [verTallasVacias, setVerTallasVacias] = useState(false);
    const buscaRef = useRef(null);

    const inputCls = 'block w-full h-11 px-3 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary focus:border-primary text-body rounded-lg';
    const lbl = 'text-overline uppercase tracking-widest text-on-surface-variant mb-2 block';

    // Candidatos de persona: el mismo autocompletado en línea del Punto de venta.
    const term = nombre.trim().toLowerCase();
    const candidatos = useMemo(() => {
      if (tipo === 'otro' || !term || personaId) return [];
      const base = tipo === 'cliente'
        ? D.clients.filter(c => !c.generic).map(c => ({ id: c.id, nombre: c.nombre, tel: c.tel === '—' ? '' : (c.tel || ''), sub: `${c.compras || 0} compras` }))
        : D.sellers.filter(s => s.active !== false && s._deletedAt == null).map(s => ({ id: s.id, nombre: s.nombre, tel: s.tel || '', sub: s.role === 'admin' ? 'Administrador' : 'Vendedor' }));
      return base.filter(x => String(x.nombre).toLowerCase().includes(term)).slice(0, 6);
    }, [tipo, term, personaId]);

    const catalogo = useMemo(() => {
      const t = busca.trim().toLowerCase();
      if (!t) return [];
      return D.products.filter(p => (
        p.nombre.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t) || String(p.colorName || '').toLowerCase().includes(t)
      )).slice(0, 8);
    }, [busca]);

    const piezas = lineas.reduce((a, l) => a + (Number(l.qty) || 0), 0);
    const valor = lineas.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.precio) || 0), 0);
    const fechasOk = !!fecha && !!esperada && esperada >= fecha;
    const listo = !!nombre.trim() && piezas > 0 && fechasOk;

    function agregar(p, talla) {
      const key = p.sku + '|' + talla;
      setLineas(prev => {
        const ex = prev.find(x => x.key === key);
        if (ex) return prev.map(x => x.key === key ? Object.assign({}, x, { qty: x.qty + 1 }) : x);
        return prev.concat([{
          key, productId: p.id, sku: p.sku, nombre: p.nombre, talla, qty: 1, devueltas: 0,
          precio: Number(D.listPrice(p, talla)) || 0,
        }]);
      });
      setPicking(null); setBusca('');
      toast(`${p.nombre} · ${talla} agregada al préstamo`);
    }

    // Lectura en el buscador: los tres caminos del Punto de venta, en el mismo orden.
    //   1) código de barras completo → la pieza exacta entra al préstamo, sin talla que elegir;
    //   2) SKU exacto → abre el selector de talla;
    //   3) texto libre → abre la primera coincidencia del catálogo.
    function onScan(e) {
      if (e.key !== 'Enter') return;
      // El valor se lee del DOM, más confiable que el estado ante lectores muy rápidos.
      const raw = String(e.target && e.target.value != null ? e.target.value : busca).trim();
      if (!raw) return;
      e.preventDefault();
      const hit = leerCodigo(raw);
      if (hit) { agregar(hit.p, hit.talla); return; }
      const q = raw.toLowerCase();
      const exacto = D.products.find(p => p.sku.toLowerCase() === q);
      const destino = exacto || catalogo[0];
      if (destino) { setPicking(destino); setBusca(''); setVerTallasVacias(false); return; }
      toast(pareceCodigo(raw)
        ? 'Código no encontrado: ' + raw.toUpperCase()
        : `Sin coincidencias para «${raw}»`, 'var(--danger)');
    }

    // Lector USB (HID) mientras la captura está abierta: funciona aunque el foco no
    // esté en el buscador. Misma heurística de cadencia que `balam/pos.jsx`: un lector
    // teclea por debajo de ~30 ms por carácter, así que una pausa mayor a 50 ms
    // reinicia el búfer y el tecleo humano nunca se confunde con una lectura. Sólo
    // interviene si la ráfaga resuelve a un código conocido.
    const scanRT = useRef({});
    scanRT.current = { agregar, buscador: buscaRef.current };
    useEffect(() => {
      if (editar) return undefined; // editando no entra mercancía nueva
      let buf = '', ultima = 0;
      function onKey(e) {
        const st = scanRT.current;
        if (document.activeElement === st.buscador) return; // lo atiende onScan
        if (e.key === 'Enter') {
          const code = buf; buf = '';
          if (code.length < 4) return;
          const hit = leerCodigo(code);
          if (!hit) return; // no es un código conocido → no intervenir
          e.preventDefault();
          retirarCodigoTecleado(document.activeElement, code);
          st.agregar(hit.p, hit.talla);
          return;
        }
        if (e.key && e.key.length === 1) {
          const ahora = Date.now();
          if (ahora - ultima > 50) buf = '';
          buf += e.key; ultima = ahora;
        }
      }
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);
    function setQty(key, delta) {
      setLineas(prev => prev.flatMap(x => {
        if (x.key !== key) return [x];
        const q = (Number(x.qty) || 0) + delta;
        return q <= 0 ? [] : [Object.assign({}, x, { qty: q })];
      }));
    }
    function elegirPersona(c) {
      setPersonaId(c.id); setNombre(c.nombre);
      if (c.tel) setTel(c.tel);
    }
    function confirmar() {
      const persona = { tipo, id: personaId, nombre: nombre.trim(), tel: tel.trim() };
      if (editar) {
        const r = D.actualizarPrestamo(loan.id, { persona, fechaEsperada: esperada, nota });
        if (!r.ok) { toast(r.error, 'var(--danger)'); return; }
        toast('Préstamo actualizado');
        onDone(r.loan);
        return;
      }
      const usuario = (window.AUTH && window.AUTH.current() && window.AUTH.current().nombre) || '';
      const r = D.registrarPrestamo({
        lineas: lineas.map(x => ({ productId: x.productId, sku: x.sku, talla: x.talla, qty: x.qty })),
        persona, fecha, fechaEsperada: esperada, nota, usuario,
      });
      if (!r.ok) { toast(r.error, 'var(--danger)'); return; }
      toast(`Préstamo ${r.loan.folio} registrado · ${piezas} pieza(s) fuera`, 'var(--accent)');
      onDone(r.loan);
    }

    const footer = [
      h('button', {
        key: 'c', 'data-testid': 'prestamo-cancelar',
        className: 'px-5 h-11 text-caption font-bold uppercase tracking-widest text-on-surface-variant hover:text-primary transition',
        onClick: onClose,
      }, 'Cancelar'),
      h('button', {
        key: 'k', 'data-testid': 'prestamo-confirmar', disabled: !listo, onClick: confirmar,
        className: 'px-6 h-11 flex items-center gap-2 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:bg-primary-container transition disabled:opacity-40 disabled:cursor-not-allowed',
      }, [h(MS, { key: 'i', name: 'check', size: 18 }), editar ? 'Guardar cambios' : 'Registrar préstamo']),
    ];

    return h(Modal, { title: editar ? 'Editar préstamo ' + loan.folio : 'Registrar préstamo', onClose, footer, large: true }, [

      // 1) Mercancía
      h('div', { key: 'mc', className: 'mb-5' }, [
        h('label', { key: 'l', className: lbl }, '1 · Mercancía que sale'),
        editar
          ? h('p', { key: 'ro', className: 'text-caption text-on-surface-variant mb-2' },
            'La mercancía de un préstamo no se cambia: si salió otra prenda, elimina este préstamo y registra el correcto.')
          : h('div', { key: 'bs', className: 'relative mb-3' }, [
            h(MS, { key: 'i', name: 'barcode', size: 20, className: 'absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant' }),
            h('input', {
              key: 'in', 'data-testid': 'prestamo-buscar-producto', ref: buscaRef, value: busca,
              onChange: e => { setBusca(e.target.value); setPicking(null); },
              onKeyDown: onScan, autoFocus: true,
              placeholder: 'Escanea el código de barras o busca por nombre o SKU…',
              className: inputCls + ' pl-11',
            }),
            catalogo.length ? h('div', { key: 'dd', className: 'absolute z-30 left-0 right-0 mt-1 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-e3 max-h-64 overflow-y-auto' },
              catalogo.map(p => h('button', {
                key: p.id, 'data-testid': 'prestamo-producto-' + p.sku, type: 'button',
                className: 'w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-container-low text-left transition-colors',
                // Elegir la prenda cierra el desplegable, como en el Punto de venta:
                // el paso siguiente es la talla y no debe quedar tapado.
                onClick: () => { setPicking(p); setBusca(''); setVerTallasVacias(false); },
              }, [
                h(ProductImage, { key: 't', p, className: 'w-9 h-11 shrink-0 rounded ring-1 ring-outline-variant/50' }),
                h('div', { key: 'i', className: 'flex-1 min-w-0' }, [
                  h('div', { key: 'n', className: 'text-body font-semibold text-primary truncate' }, p.nombre),
                  h('div', { key: 's', className: 'text-overline uppercase text-on-surface-variant truncate' }, `${p.sku} · ${D.totalStock(p)} en stock`),
                ]),
              ]))) : null,
          ]),
        // Selector de talla: el MISMO lenguaje del Punto de venta —tallas agrupadas
        // por escala, con el precio de la talla y sus existencias—. Por omisión sólo
        // se ofrecen las tallas con existencia, como en el POS; prestar una talla que
        // el sistema cree agotada es posible pero se pide expresamente, porque implica
        // que la existencia registrada está mal.
        picking ? h('div', { key: 'tz', className: 'p-4 rounded-lg bg-surface-container-low mb-3' }, [
          h('div', { key: 'h', className: 'flex items-center justify-between gap-3 mb-3' }, [
            h('div', { key: 'n', className: 'text-body font-semibold text-primary truncate' }, picking.nombre + ' · elige la talla'),
            h('button', {
              key: 'x', 'data-testid': 'prestamo-cerrar-tallas', onClick: () => setPicking(null),
              className: 'w-8 h-8 grid place-items-center rounded text-on-surface-variant hover:text-primary',
            }, h(MS, { name: 'x', size: 18 })),
          ]),
          ...tallasVisibles(picking, verTallasVacias).map(([escala, etiqueta, items]) => h('div', { key: escala, className: 'mb-3 last:mb-0' }, [
            h('div', { key: 'l', className: 'text-overline uppercase text-muted mb-2' }, etiqueta),
            h('div', { key: 'g', className: 'flex flex-wrap gap-2' }, items.map(v => h('button', {
              key: v.talla, 'data-testid': 'prestamo-talla-' + v.talla,
              className: 'flex flex-col items-center gap-0.5 min-w-[64px] px-3 py-2 border rounded-lg transition-colors ' +
                (v.stock > 0 ? 'border-outline-variant hover:border-primary hover:bg-surface' : 'border-warning/60 hover:border-warning'),
              onClick: () => agregar(picking, v.talla),
            }, [
              h('span', { key: 't', className: 'font-semibold text-body text-primary' }, tallaLbl(escala, v.talla)),
              h('span', { key: 'p', className: 'text-caption font-semibold text-gold-text' }, fmt(D.listPrice(picking, v.talla)).replace('.00', '')),
              h('span', { key: 's', className: 'text-caption ' + (v.stock > 0 ? 'text-muted' : 'text-warning') }, v.stock + ' pz'),
            ]))),
          ])),
          hayTallasVacias(picking) ? h('button', {
            key: 'vt', 'data-testid': 'prestamo-tallas-agotadas',
            className: 'text-caption font-semibold text-on-surface-variant hover:text-primary transition-colors underline decoration-dotted',
            onClick: () => setVerTallasVacias(v => !v),
          }, verTallasVacias ? 'Ocultar tallas sin existencia' : 'Prestar una talla sin existencia registrada') : null,
        ]) : null,
        lineas.length
          ? h('div', { key: 'ln', className: 'border border-outline-variant rounded-lg divide-y divide-outline-variant' }, lineas.map(x => {
            const prod = D.products.find(p => p.sku === x.sku);
            const disponible = prod ? D.stockOf(prod, x.talla) : 0;
            const excede = (Number(x.qty) || 0) > disponible;
            return h('div', { key: x.key, className: 'flex items-center gap-3 px-3 py-2' }, [
              h('div', { key: 'i', className: 'flex-1 min-w-0' }, [
                h('div', { key: 'n', className: 'text-body text-primary truncate' }, `${x.nombre} · Talla ${x.talla}`),
                h('div', { key: 's', className: 'text-overline uppercase ' + (excede ? 'text-warning' : 'text-on-surface-variant') },
                  excede ? `sólo hay ${disponible} en existencia` : `${x.sku} · ${fmt(x.precio).replace('.00', '')} c/u`),
              ]),
              editar ? h('span', { key: 'q', className: 'text-body font-semibold text-primary' }, 'x' + x.qty) : h('div', { key: 'q', className: 'flex items-center gap-1 shrink-0' }, [
                h('button', {
                  key: '-', 'data-testid': 'prestamo-menos-' + x.key, onClick: () => setQty(x.key, -1),
                  className: 'w-8 h-8 grid place-items-center rounded border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary',
                }, h(MS, { name: 'minus', size: 16 })),
                h('span', { key: 'v', className: 'w-8 text-center text-body font-semibold text-primary' }, String(x.qty)),
                h('button', {
                  key: '+', 'data-testid': 'prestamo-mas-' + x.key, onClick: () => setQty(x.key, 1),
                  className: 'w-8 h-8 grid place-items-center rounded border border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary',
                }, h(MS, { name: 'plus', size: 16 })),
              ]),
            ]);
          }).concat([
            h('div', { key: 'tot', className: 'flex justify-between items-center px-3 py-2 bg-surface-container-low text-caption font-semibold text-primary' }, [
              h('span', { key: 'l' }, `${piezas} pieza(s)`),
              h('span', { key: 'v' }, fmt(valor)),
            ]),
          ]))
          : h('p', { key: 'e', className: 'text-caption text-on-surface-variant' }, 'Todavía no hay piezas en este préstamo.'),
      ]),

      // 2) Persona que recibe
      h('div', { key: 'pe', className: 'mb-5' }, [
        h('label', { key: 'l', className: lbl }, '2 · Quién recibe la mercancía'),
        h('div', { key: 'sg', className: 'mb-3' }, h(Segment, {
          value: tipo, testid: 'prestamo-tipo',
          onChange: v => { setTipo(v); setPersonaId(null); },
          options: [['cliente', 'Cliente'], ['empleado', 'Empleado'], ['otro', 'Otro']],
        })),
        h('div', { key: 'f', className: 'relative' }, [
          h('div', { key: 'g', className: 'grid grid-cols-1 sm:grid-cols-2 gap-3' }, [
            h('input', {
              key: 'n', 'data-testid': 'prestamo-persona', className: inputCls, value: nombre,
              placeholder: tipo === 'empleado' ? 'Nombre del empleado' : 'Nombre de quien recibe',
              onChange: e => { setNombre(e.target.value); setPersonaId(null); },
            }),
            h('input', {
              key: 't', 'data-testid': 'prestamo-telefono', className: inputCls, type: 'tel', value: tel,
              placeholder: 'Teléfono (opcional)', onChange: e => setTel(e.target.value),
            }),
          ]),
          candidatos.length ? h('div', { key: 'dd', className: 'absolute z-30 left-0 right-0 mt-1 bg-surface-container-lowest border border-outline-variant rounded-lg shadow-e3 max-h-56 overflow-y-auto' },
            candidatos.map(c => h('button', {
              key: c.id, 'data-testid': 'prestamo-candidato-' + c.id, type: 'button',
              className: 'w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-container-low text-left transition-colors',
              onClick: () => elegirPersona(c),
            }, [
              h('div', { key: 'a', className: 'w-8 h-8 rounded-full bg-primary text-on-primary grid place-items-center text-[11px] font-bold shrink-0' },
                String(c.nombre).split(' ').map(w => w[0]).slice(0, 2).join('')),
              h('div', { key: 'i', className: 'flex-1 min-w-0' }, [
                h('div', { key: 'n', className: 'text-body font-semibold text-primary truncate' }, c.nombre),
                h('div', { key: 's', className: 'text-overline uppercase text-on-surface-variant truncate' }, (c.tel || 'Sin teléfono') + ' · ' + c.sub),
              ]),
            ]))) : null,
        ]),
      ]),

      // 3) Fechas
      h('div', { key: 'fe', className: 'mb-5' }, [
        h('label', { key: 'l', className: lbl }, '3 · Fechas'),
        h('div', { key: 'g', className: 'grid grid-cols-1 sm:grid-cols-2 gap-3' }, [
          h('div', { key: 'a' }, [
            h('span', { key: 'l', className: 'text-caption text-on-surface-variant' }, 'Fecha del préstamo'),
            h('input', {
              key: 'i', 'data-testid': 'prestamo-fecha', className: inputCls + ' mt-1', type: 'date',
              value: fecha, max: esperada || undefined, disabled: editar,
              onChange: e => setFecha(e.target.value),
            }),
          ]),
          h('div', { key: 'b' }, [
            h('span', { key: 'l', className: 'text-caption text-on-surface-variant' }, 'Devolución esperada'),
            h('input', {
              key: 'i', 'data-testid': 'prestamo-esperada', className: inputCls + ' mt-1', type: 'date',
              value: esperada, min: fecha || undefined, onChange: e => setEsperada(e.target.value),
            }),
          ]),
        ]),
        h('div', { key: 'q', className: 'flex flex-wrap gap-2 mt-2' }, PLAZOS.map(([d, label]) => {
          const valor = sumaDias(fecha || hoy, d);
          return h('button', {
            key: d, 'data-testid': 'prestamo-plazo-' + d, onClick: () => setEsperada(valor),
            className: 'px-3 py-1.5 text-caption font-semibold border rounded-full transition-colors ' +
              (esperada === valor ? 'border-primary text-primary bg-surface-container-low' : 'border-outline-variant hover:border-primary'),
          }, label);
        })),
        !fechasOk && esperada && fecha ? h('p', { key: 'w', className: 'text-caption text-danger mt-2' },
          'La devolución esperada no puede ser anterior al préstamo.') : null,
      ]),

      // 4) Nota
      h('div', { key: 'nt' }, [
        h('label', { key: 'l', className: lbl }, '4 · Nota (opcional)'),
        h('textarea', {
          key: 'i', 'data-testid': 'prestamo-nota', className: inputCls + ' h-auto py-2 resize-none', rows: 2,
          value: nota, onChange: e => setNota(e.target.value),
          placeholder: 'Estado de la prenda, motivo del préstamo, condiciones acordadas…',
        }),
      ]),

      h('div', { key: 'av', className: 'flex items-start gap-2 p-3 mt-4 bg-surface-container-low text-on-surface-variant text-caption rounded-lg' }, [
        h(MS, { key: 'i', name: 'alert', size: 16, className: 'shrink-0 mt-0.5' }),
        'El préstamo no descuenta inventario: la prenda seguirá apareciendo como existencia. Imprime el vale y pide firma al entregar.',
      ]),
    ]);
  }

  // ── Devolución ──────────────────────────────────────────────────────────────
  // Total o parcial: se captura cuántas piezas de cada renglón regresaron. El
  // botón queda bloqueado mientras no haya al menos una pieza.
  function DevolucionModal({ loan, onClose, onDone }) {
    const hoy = hoyISO();
    const pendientesPorLinea = (loan.lineas || []).map(x => ({
      key: x.key, nombre: x.nombre, talla: x.talla, sku: x.sku,
      resta: Math.max(0, (Number(x.qty) || 0) - (Number(x.devueltas) || 0)),
    })).filter(x => x.resta > 0);
    const [cant, setCant] = useState(() => {
      const m = {};
      pendientesPorLinea.forEach(x => { m[x.key] = x.resta; });
      return m;
    });
    const [fecha, setFecha] = useState(hoy);
    const [nota, setNota] = useState('');

    const inputCls = 'block w-full h-11 px-3 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary focus:border-primary text-body rounded-lg';
    const lbl = 'text-overline uppercase tracking-widest text-on-surface-variant mb-2 block';

    const total = Object.keys(cant).reduce((a, k) => a + (Number(cant[k]) || 0), 0);
    const fueraDespues = D.prestamoPendientes(loan) - total;
    const fechaOk = !!fecha && fecha >= diaDe(loan.fecha);
    const listo = total > 0 && fechaOk;
    const cierra = listo && fueraDespues === 0;

    function set(key, valor, resta) {
      const n = Math.max(0, Math.min(resta, Math.floor(Number(valor) || 0)));
      setCant(prev => Object.assign({}, prev, { [key]: n }));
    }
    function confirmar() {
      const r = D.registrarDevolucionPrestamo(loan.id, {
        lineas: Object.keys(cant).map(k => ({ key: k, qty: Number(cant[k]) || 0 })),
        fecha, nota,
      });
      if (!r.ok) { toast(r.error, 'var(--danger)'); return; }
      toast(r.cerrado ? 'Préstamo devuelto por completo' : `Devolución parcial · quedan ${D.prestamoPendientes(r.loan)} pieza(s) fuera`, 'var(--accent)');
      onDone(r.loan);
    }

    const footer = [
      h('button', {
        key: 'c', 'data-testid': 'devolucion-cancelar',
        className: 'px-5 h-11 text-caption font-bold uppercase tracking-widest text-on-surface-variant hover:text-primary transition',
        onClick: onClose,
      }, 'Cancelar'),
      h('button', {
        key: 'k', 'data-testid': 'devolucion-confirmar', disabled: !listo, onClick: confirmar,
        className: 'px-6 h-11 flex items-center gap-2 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:bg-primary-container transition disabled:opacity-40 disabled:cursor-not-allowed',
      }, [h(MS, { key: 'i', name: 'check', size: 18 }), cierra ? 'Cerrar el préstamo' : 'Registrar devolución']),
    ];

    return h(Modal, { title: 'Registrar devolución', onClose, footer }, [
      h('div', { key: 'ctx', className: 'bg-primary text-on-primary p-5 rounded-lg mb-5' }, [
        h('div', { key: 'a', className: 'flex justify-between items-center gap-3' }, [
          h('div', { key: 'l', className: 'min-w-0' }, [
            h('div', { key: 'a', className: 'text-caption opacity-70 truncate' }, `${loan.folio} · ${(loan.persona || {}).nombre || '—'}`),
            h('div', { key: 'b', className: 'text-overline uppercase opacity-60 mt-0.5' }, 'Piezas fuera'),
          ]),
          h('div', { key: 'v', className: 'font-headline text-h1 leading-none' }, String(D.prestamoPendientes(loan))),
        ]),
        h('div', { key: 'b', className: 'flex justify-between text-caption opacity-70 mt-3 pt-3 border-t border-white/15 gap-3' }, [
          h('span', { key: 'l' }, 'Esperada ' + (fechaCorta(loan.fechaEsperada) || '—')),
          h('span', { key: 'v' }, textoPlazo(loan).texto),
        ]),
      ]),
      h('label', { key: 'll', className: lbl }, 'Piezas que regresaron'),
      h('div', { key: 'ln', className: 'border border-outline-variant rounded-lg divide-y divide-outline-variant mb-4' },
        pendientesPorLinea.map(x => h('div', { key: x.key, className: 'flex items-center gap-3 px-3 py-2' }, [
          h('div', { key: 'i', className: 'flex-1 min-w-0' }, [
            h('div', { key: 'n', className: 'text-body text-primary truncate' }, `${x.nombre} · Talla ${x.talla}`),
            h('div', { key: 's', className: 'text-overline uppercase text-on-surface-variant' }, `${x.resta} fuera`),
          ]),
          h('input', {
            key: 'q', 'data-testid': 'devolucion-qty-' + x.key, type: 'number', min: '0', max: String(x.resta), step: '1',
            value: String(cant[x.key] == null ? '' : cant[x.key]),
            onChange: e => set(x.key, e.target.value, x.resta),
            className: 'w-20 h-10 px-2 text-center bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary text-body rounded-lg font-mono',
          }),
        ]))),
      h('div', { key: 'fe', className: 'mb-4' }, [
        h('label', { key: 'l', className: lbl }, 'Fecha real de devolución'),
        h('input', {
          key: 'i', 'data-testid': 'devolucion-fecha', className: inputCls, type: 'date', value: fecha,
          min: diaDe(loan.fecha) || undefined, onChange: e => setFecha(e.target.value),
        }),
        !fechaOk && fecha ? h('p', { key: 'w', className: 'text-caption text-danger mt-2' },
          'La devolución no puede ser anterior al préstamo.') : null,
      ]),
      h('div', { key: 'nt', className: 'mb-4' }, [
        h('label', { key: 'l', className: lbl }, 'Nota (opcional)'),
        h('textarea', {
          key: 'i', 'data-testid': 'devolucion-nota', className: inputCls + ' h-auto py-2 resize-none', rows: 2,
          value: nota, onChange: e => setNota(e.target.value),
          placeholder: 'Cómo regresó la prenda, faltantes, daños…',
        }),
      ]),
      h('div', { key: 'ef', className: 'p-4 rounded-lg bg-surface-container-low' }, [
        h('div', { key: 'a', className: 'flex justify-between items-center gap-3' }, [
          h('span', { key: 'l', className: 'text-body text-on-surface-variant' }, 'Piezas fuera después'),
          h('span', { key: 'v', className: 'font-headline text-h2 ' + (cierra ? 'text-success' : 'text-primary') }, String(Math.max(0, fueraDespues))),
        ]),
        cierra ? h('div', { key: 'b', className: 'flex items-start gap-2 mt-3 pt-3 border-t border-outline-variant text-caption text-on-surface-variant leading-relaxed' }, [
          h(MS, { key: 'i', name: 'check', size: 16, className: 'text-success shrink-0' }),
          'Regresó todo: el préstamo queda como devuelto con esta fecha como devolución real.',
        ]) : null,
      ]),
    ]);
  }

  // ── Confirmación de acciones con consecuencia ───────────────────────────────
  // No usa `window.confirm`: el diálogo del navegador no distingue la acción
  // destructiva de la que sigue ni sabe decir qué está en juego.
  function ConfirmarModal({ tipo, loan, onClose, onConfirm }) {
    const [nota, setNota] = useState('');
    const perdido = tipo === 'perdido';
    const fuera = D.prestamoPendientes(loan);
    const footer = [
      h('button', {
        key: 'c', 'data-testid': 'confirmar-cancelar',
        className: 'px-5 h-11 text-caption font-bold uppercase tracking-widest text-on-surface-variant hover:text-primary transition',
        onClick: onClose,
      }, 'Cancelar'),
      h('button', {
        key: 'k', 'data-testid': 'confirmar-aceptar', onClick: () => onConfirm(nota),
        className: 'px-6 h-11 flex items-center gap-2 text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition',
        style: { background: 'var(--danger, #B91C1C)' },
      }, [h(MS, { key: 'i', name: perdido ? 'alert' : 'trash', size: 18 }), perdido ? 'Declarar no devuelto' : 'Eliminar préstamo']),
    ];
    return h(Modal, { title: perdido ? 'Declarar mercancía no devuelta' : 'Eliminar préstamo', onClose, footer }, [
      h('p', { key: 'p', className: 'text-body text-on-surface leading-relaxed' }, perdido
        ? `${loan.folio}: ${fuera} pieza(s) de ${(loan.persona || {}).nombre || '—'} quedan como no devueltas, por ${fmt(valorFueraDe(loan))}. El préstamo se cierra como pérdida y deja de aparecer entre los vencidos. Si la mercancía regresa después, todavía podrás registrar su devolución.`
        : `${loan.folio} se borrará de esta terminal. Sólo se puede eliminar porque no tiene ninguna devolución registrada.`),
      perdido ? h('div', { key: 'nt', className: 'mt-4' }, [
        h('label', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-2 block' }, 'Motivo (opcional)'),
        h('textarea', {
          key: 'i', 'data-testid': 'confirmar-nota', rows: 2, value: nota, onChange: e => setNota(e.target.value),
          className: 'block w-full px-3 py-2 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary text-body rounded-lg resize-none',
          placeholder: 'Qué pasó con la mercancía…',
        }),
      ]) : null,
    ]);
  }

  // ── Salidas: Excel, vale impreso y listado impreso ──────────────────────────
  // Fila plana compartida por el .xlsx y el listado impreso: una sola definición de
  // «qué columnas describen un préstamo».
  // Las fechas salen ya en día/mes/año: estas filas alimentan el `.xlsx` y el listado
  // impreso, que los lee una persona.
  function filaExport(l) {
    const a = D.prestamoAtraso(l);
    return {
      folio: l.folio,
      fecha: fechaCorta(l.fecha),
      persona: (l.persona || {}).nombre || '—',
      tipo: (TIPOS[(l.persona || {}).tipo] || TIPOS.otro).label,
      tel: (l.persona || {}).tel || '—',
      piezas: piezasDe(l),
      fuera: fueraDe(l),
      esperada: fechaCorta(l.fechaEsperada) || '—',
      devolucion: fechaCorta(l.fechaDevolucion) || (l.estado === 'no_devuelto' ? 'No regresó' : '—'),
      estado: (ESTADOS[l.estado] || ESTADOS.pendiente).label,
      atraso: a.vencido ? a.dias : 0,
      valor: valorTotalDe(l),
      valorFuera: valorFueraDe(l),
      articulos: mercanciaDe(l),
      nota: l.nota || '',
    };
  }

  const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HOJA_CSS = `
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #131B2E; }
      h1 { font-size: 22pt; margin: 0 0 2pt; letter-spacing: .02em; }
      .meta { font-family: Arial, Helvetica, sans-serif; font-size: 9pt; color: #5b6478; margin-bottom: 14pt; }
      table { width: 100%; border-collapse: collapse; font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; }
      th { text-align: left; text-transform: uppercase; letter-spacing: .08em; font-size: 7.5pt; color: #5b6478; border-bottom: 1.5pt solid #131B2E; padding: 5pt 4pt; }
      td { padding: 6pt 4pt; border-bottom: .5pt solid #e2e5eb; vertical-align: top; }
      tr { page-break-inside: avoid; }
      .num { text-align: right; white-space: nowrap; }
      .strong { font-weight: 700; font-size: 9.5pt; }
      .mono { font-family: 'Courier New', monospace; white-space: nowrap; }
      .sub { color: #7a8296; font-size: 7.5pt; margin-top: 1pt; }
      tfoot td { border-top: 1.5pt solid #131B2E; border-bottom: none; font-weight: 700; font-size: 9.5pt; padding-top: 7pt; }
      .foot { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; color: #7a8296; margin-top: 12pt; }`;

  function abrirImpresion(titulo, cuerpo, pagina) {
    const win = window.open('', '_blank', 'width=980,height=720');
    if (!win) { toast('Permite las ventanas emergentes para imprimir', 'var(--danger)'); return false; }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title><style>
      @page { size: ${pagina}; margin: 12mm; }${HOJA_CSS}
      .cards { display: flex; gap: 10pt; margin-bottom: 14pt; }
      .card { flex: 1; border: 1px solid #d8dbe3; border-radius: 6pt; padding: 8pt 10pt; }
      .card .k { font-family: Arial, Helvetica, sans-serif; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .12em; color: #5b6478; }
      .card .v { font-size: 16pt; margin-top: 2pt; }
      .firma { margin-top: 34pt; display: flex; gap: 24pt; }
      .firma div { flex: 1; border-top: .8pt solid #131B2E; padding-top: 5pt; font-family: Arial, Helvetica, sans-serif; font-size: 8pt; color: #5b6478; text-align: center; }
      .aviso { font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; border: 1px solid #d8dbe3; border-radius: 6pt; padding: 8pt 10pt; margin-top: 14pt; line-height: 1.45; }
    </style></head><body>${cuerpo}
      <scr` + `ipt>window.onload=function(){window.focus();window.print();setTimeout(function(){window.close();},400);};</scr` + `ipt>
    </body></html>`);
    win.document.close();
    return true;
  }

  // Vale de un préstamo: el papel que firma quien se lleva la mercancía. Se imprime
  // en ventana propia como las etiquetas de Inventario, porque la regla @media print
  // de la aplicación sólo deja visible el ticket térmico de 80 mm.
  function imprimirVale(loan) {
    const tienda = C.get('store.name') || 'Balam Guayaberas';
    const hoy = new Date().toLocaleString('es-MX');
    const tr = (loan.lineas || []).map(x => `<tr>
      <td>${escapeHtml(x.nombre)}<div class="sub">${escapeHtml(x.sku)}</div></td>
      <td>${escapeHtml(x.talla)}</td>
      <td class="num">${Number(x.qty) || 0}</td>
      <td class="num">${escapeHtml(fmt(x.precio || 0))}</td>
      <td class="num">${escapeHtml(fmt((Number(x.qty) || 0) * (Number(x.precio) || 0)))}</td>
    </tr>`).join('');
    return abrirImpresion(`Vale de préstamo ${escapeHtml(loan.folio)} — ${escapeHtml(tienda)}`, `
      <h1>Vale de préstamo</h1>
      <div class="meta">${escapeHtml(tienda)} · folio <strong>${escapeHtml(loan.folio)}</strong> · emitido ${escapeHtml(hoy)}</div>
      <div class="cards">
        <div class="card"><div class="k">Recibe</div><div class="v">${escapeHtml((loan.persona || {}).nombre || '—')}</div>
          <div class="sub">${escapeHtml((TIPOS[(loan.persona || {}).tipo] || TIPOS.otro).label)}${(loan.persona || {}).tel ? ' · ' + escapeHtml(loan.persona.tel) : ''}</div></div>
        <div class="card"><div class="k">Fecha del préstamo</div><div class="v">${escapeHtml(fechaCorta(loan.fecha))}</div>
          <div class="sub">${escapeHtml(loan.usuario ? 'registró ' + loan.usuario : '')}</div></div>
        <div class="card"><div class="k">Devolución esperada</div><div class="v">${escapeHtml(fechaCorta(loan.fechaEsperada) || '—')}</div>
          <div class="sub">${escapeHtml(textoPlazo(loan).texto)}</div></div>
      </div>
      <table>
        <thead><tr><th>Prenda</th><th>Talla</th><th class="num">Cant.</th><th class="num">Valor unitario</th><th class="num">Valor</th></tr></thead>
        <tbody>${tr}</tbody>
        <tfoot><tr><td colspan="2">Total</td><td class="num">${piezasDe(loan)}</td><td></td><td class="num">${escapeHtml(fmt(valorTotalDe(loan)))}</td></tr></tfoot>
      </table>
      ${loan.nota ? `<div class="aviso"><strong>Nota:</strong> ${escapeHtml(loan.nota)}</div>` : ''}
      <div class="aviso">Recibí en préstamo la mercancía descrita y me comprometo a devolverla completa y en las mismas condiciones a más tardar el ${escapeHtml(fechaCorta(loan.fechaEsperada) || '—')}. En caso de no devolverla, acepto cubrir su valor de ${escapeHtml(fmt(valorTotalDe(loan)))}.</div>
      <div class="firma"><div>Firma de quien recibe</div><div>Firma de quien entrega</div></div>
      <div class="foot">Este vale no es un comprobante de venta. La mercancía prestada no se descuenta del inventario.</div>`, 'A4 portrait');
  }

  function imprimirListado(rows) {
    if (!rows.length) { toast('No hay préstamos para imprimir', 'var(--danger)'); return; }
    const datos = rows.map(filaExport);
    const totPiezas = datos.reduce((a, r) => a + r.piezas, 0);
    const totFuera = datos.reduce((a, r) => a + r.fuera, 0);
    const totValorFuera = datos.reduce((a, r) => a + r.valorFuera, 0);
    const tienda = C.get('store.name') || 'Balam Guayaberas';
    const hoy = new Date().toLocaleString('es-MX');
    const tr = datos.map(r => `<tr>
      <td class="mono">${escapeHtml(r.folio)}</td>
      <td>${escapeHtml(r.fecha)}<div class="sub">${escapeHtml(r.tipo)}</div></td>
      <td>${escapeHtml(r.persona)}<div class="sub">${escapeHtml(r.articulos)}</div></td>
      <td class="num">${r.piezas}</td>
      <td class="num strong">${r.fuera}</td>
      <td>${escapeHtml(r.esperada)}<div class="sub">${r.atraso ? r.atraso + ' días de atraso' : ''}</div></td>
      <td>${escapeHtml(r.devolucion)}</td>
      <td>${escapeHtml(r.estado)}</td>
      <td class="num">${escapeHtml(fmt(r.valorFuera))}</td>
    </tr>`).join('');
    abrirImpresion(`Préstamos — ${escapeHtml(tienda)}`, `
      <h1>Mercancía prestada</h1>
      <div class="meta">${escapeHtml(tienda)} · emitido ${escapeHtml(hoy)} · ${datos.length} préstamo(s)</div>
      <div class="cards">
        <div class="card"><div class="k">Piezas fuera</div><div class="v">${totFuera}</div></div>
        <div class="card"><div class="k">Piezas prestadas</div><div class="v">${totPiezas}</div></div>
        <div class="card"><div class="k">Valor fuera</div><div class="v">${escapeHtml(fmt(totValorFuera))}</div></div>
      </div>
      <table>
        <thead><tr><th>Folio</th><th>Préstamo</th><th>Recibe y mercancía</th><th class="num">Piezas</th><th class="num">Fuera</th><th>Esperada</th><th>Devolución</th><th>Estado</th><th class="num">Valor fuera</th></tr></thead>
        <tbody>${tr}</tbody>
        <tfoot><tr><td colspan="3">Totales</td><td class="num">${totPiezas}</td><td class="num">${totFuera}</td><td colspan="3"></td><td class="num">${escapeHtml(fmt(totValorFuera))}</td></tr></tfoot>
      </table>
      <div class="foot">Un préstamo no descuenta inventario: la pieza sigue contando como existencia hasta que se declare no devuelta.</div>`, 'A4 landscape');
  }

  // Monta la impresión del vale y se desmonta solo, como la reimpresión de Apartados.
  function ValeImpreso({ folio, onDone }) {
    useEffect(() => {
      const loan = D.loans.find(l => l.folio === folio);
      if (!loan) { onDone(); return; }
      if (imprimirVale(loan)) toast('Vale enviado a la impresora');
      onDone();
    }, []);
    return null;
  }

  // ── KPI ─────────────────────────────────────────────────────────────────────
  const KPI_TONE = {
    gold: 'bg-gold-soft text-gold-text', success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger',
    neutral: 'bg-surface-container text-on-surface-variant',
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

  window.LoansScreen = LoansScreen;
})();
