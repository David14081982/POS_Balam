// clients.jsx — CRM de clientes (Heritage Luxury). Exporta window.ClientsScreen
(function () {
  const { useState, useMemo } = React;
  const { fmt, toast, Pager, Modal } = window.UI;
  const { MS } = window.HX;
  const D = window.DATA;
  const h = React.createElement;
  const CARD = 'bg-surface-container-lowest rounded-xl shadow-e1';

  const CHIP = {
    Pagado: 'bg-success-soft text-success', Apartado: 'bg-warning-soft text-warning',
    Pendiente: 'bg-info-soft text-info', Cancelado: 'bg-danger-soft text-danger',
  };

  function Segment({ value, onChange, options }) {
    return h('div', { className: 'flex p-1 bg-surface-container rounded-lg border border-outline-variant' },
      options.map(([id, l]) => {
        const on = value === id;
        return h('button', { key: id, className: 'px-4 py-1.5 text-overline uppercase rounded transition-colors ' + (on ? 'bg-gold text-on-gold shadow-e1' : 'text-on-surface-variant hover:text-primary'), onClick: () => onChange(id) }, l);
      }));
  }

  function ClientsScreen() {
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState('all');
    const [detail, setDetail] = useState(null);
    const [adding, setAdding] = useState(false);
    const [editC, setEditC] = useState(null);
    const [page, setPage] = useState(1);
    const [refreshKey, setRefreshKey] = useState(0);

    const recurrent = window.CONFIG.get('client.recurrentThreshold') || 3;
    const rows = useMemo(() => {
      const q = query.trim().toLowerCase();
      return D.clients.filter(c => {
        if (c.generic) return false;
        if (filter === 'rec' && c.compras < recurrent) return false;
        if (filter === 'new' && c.compras >= recurrent) return false;
        return c.nombre.toLowerCase().includes(q) || c.tel.includes(q);
      });
    }, [query, filter, refreshKey]);
    const PER = 8, pages = Math.max(1, Math.ceil(rows.length / PER)), pg = Math.min(page, pages);
    const slice = rows.slice((pg - 1) * PER, pg * PER);

    function saveEditClient(patch) {
      Object.assign(editC, { nombre: patch.nombre.trim(), tel: patch.tel || '—', email: patch.email, talla: patch.talla, notas: patch.notas, nacimiento: patch.nacimiento || '' });
      D.saveClients();
      setEditC(null); setRefreshKey(k => k + 1);
      toast('Cliente actualizado', 'var(--accent)');
    }

    function saveNewClient(data) {
      D.clients.push({
        id: 'c-' + Date.now(), nombre: data.nombre.trim(), tel: data.tel, compras: 0, total: 0,
        ultima: '', talla: data.tallaCamisa || '', notas: data.notas,
        email: data.email, direccion: data.direccion, nacimiento: data.nacimiento || '',
      });
      D.saveClients();
      setAdding(false); setRefreshKey(k => k + 1);
      toast('Cliente registrado en Balam Heritage', 'var(--accent)');
    }

    if (adding) return h(NewClientForm, { onCancel: () => setAdding(false), onSave: saveNewClient });

    const reales = D.clients.filter(c => !c.generic);
    const totalClientes = reales.length;
    const totalFacturado = reales.reduce((a, c) => a + c.total, 0);
    const ventaProm = Math.round(totalFacturado / (totalClientes || 1));
    const recurrentes = reales.filter(c => c.compras >= recurrent).length;

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'p-10 max-w-container-max mx-auto' }, [
        // KPIs
        h('div', { key: 'kpi', className: 'grid grid-cols-1 md:grid-cols-4 gap-gutter mb-8' }, [
          kpi('Clientes registrados', totalClientes),
          kpi('Ticket promedio', fmt(ventaProm).replace('.00', '')),
          kpi(`Recurrentes (${recurrent}+)`, recurrentes, true),
          kpi('Total facturado', fmt(totalFacturado).replace('.00', ''), false, 'MXN'),
        ]),
        // Filtros + acción
        h('div', { key: 'fl', className: 'flex items-center justify-between gap-4 flex-wrap mb-6' }, [
          h('div', { key: 'l', className: 'flex items-center gap-3 flex-wrap' }, [
            h('div', { key: 's', className: 'relative w-80' }, [
              h('span', { key: 'i', className: 'absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/50' }, h(MS, { name: 'search', size: 20 })),
              h('input', { key: 'in', className: 'w-full bg-surface border border-outline-variant rounded-lg pl-10 pr-4 py-2.5 text-body focus:ring-1 focus:ring-primary focus:border-primary transition-all', placeholder: 'Buscar por nombre o teléfono…', value: query, onChange: e => { setQuery(e.target.value); setPage(1); } }),
            ]),
            h(Segment, { key: 'sg', value: filter, onChange: v => { setFilter(v); setPage(1); }, options: [['all', 'Todos'], ['rec', 'Recurrentes'], ['new', 'Nuevos']] }),
          ]),
          h('button', { key: 'add', className: 'flex items-center gap-2 px-6 py-2.5 bg-primary text-on-primary rounded-lg hover:opacity-90 transition-all text-overline font-bold uppercase tracking-wider shadow-e2', onClick: () => setAdding(true) }, [h(MS, { key: 'i', name: 'plus', size: 18 }), 'Nuevo cliente']),
        ]),
        // Tabla
        h('div', { key: 'tbl', className: CARD + ' overflow-hidden shadow-e1' }, [
          h('div', { key: 'sc', className: 'overflow-x-auto' }, h('table', { className: 'w-full text-left border-collapse' }, [
            h('thead', { key: 'h' }, h('tr', { className: 'bg-surface-container/50 border-b border-outline-variant' },
              [['Cliente', ''], ['Teléfono', ''], ['Talla', ''], ['Compras', 'text-right'], ['Total gastado', 'text-right'], ['Última visita', ''], ['', '']].map(([c, al], i) =>
                h('th', { key: i, className: 'px-4 py-4 text-overline uppercase tracking-wider font-semibold text-on-surface-variant/80 ' + al + (i === 0 ? ' pl-6' : '') }, c)))),
            h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, slice.map(c => h('tr', { key: c.id, className: 'hover:bg-surface-container transition-all group cursor-pointer', onClick: () => setDetail(c) }, [
              h('td', { key: 'n', className: 'px-6 py-4' }, h('div', { className: 'flex items-center gap-4' }, [
                h('div', { key: 'a', className: 'w-10 h-10 rounded-full bg-primary-container text-gold flex items-center justify-center text-caption font-bold shrink-0' }, c.nombre.split(' ').map(w => w[0]).slice(0, 2).join('')),
                h('span', { key: 'x', className: 'font-headline text-body text-primary' }, c.nombre),
              ])),
              h('td', { key: 't', className: 'px-4 py-4 text-overline font-mono text-on-surface-variant' }, c.tel),
              h('td', { key: 'tz', className: 'px-4 py-4' }, h('span', { className: 'px-2 py-0.5 bg-surface-container-high rounded text-overline font-bold uppercase text-on-surface-variant' }, c.talla || '—')),
              h('td', { key: 'c', className: 'px-4 py-4 text-right font-mono text-body' }, c.compras),
              h('td', { key: 'g', className: 'px-4 py-4 text-right font-headline text-body text-primary' }, fmt(c.total).replace('.00', '')),
              h('td', { key: 'u', className: 'px-4 py-4 text-caption text-on-surface-variant' }, fechaCorta(c.ultima)),
              h('td', { key: 'x', className: 'px-6 py-4 text-right' }, h(MS, { name: 'chevRight', size: 20, className: 'text-on-surface-variant/40 group-hover:text-primary transition-colors' })),
            ]))),
          ])),
          h('div', { key: 'pg', className: 'px-6 py-4 border-t border-outline-variant flex items-center justify-between bg-surface-container/30' }, [
            h('span', { key: 'l', className: 'text-overline font-bold text-on-surface-variant uppercase tracking-widest' }, `${rows.length} cliente${rows.length === 1 ? '' : 's'}${pages > 1 ? ` · página ${pg}/${pages}` : ''}`),
            h(Pager, { key: 'p', page: pg, pages, onPage: setPage }),
          ]),
        ]),
        // Drawer
        h(ClientDrawer, { key: 'dr', c: detail, onClose: () => setDetail(null), onEdit: (cl) => setEditC(cl) }),
        // Modal de edición
        editC && h(ClientEditModal, { key: 'ed', c: editC, onClose: () => setEditC(null), onSave: saveEditClient }),
      ]));
  }

  function kpi(label, value, gold, suffix) {
    return h('div', { key: label, className: CARD + ' p-6' + (gold ? ' border-l-4 border-l-secondary' : '') }, [
      h('p', { key: 'l', className: 'text-overline text-on-surface-variant uppercase tracking-widest mb-2 opacity-70 font-semibold' }, label),
      h('div', { key: 'v', className: 'flex items-baseline gap-1' }, [
        h('h3', { key: 'a', className: 'font-headline text-h1 text-primary' }, value),
        suffix && h('span', { key: 'b', className: 'text-overline text-on-surface-variant font-bold' }, suffix),
      ]),
    ]);
  }

  function ClientDrawer({ c, onClose, onEdit }) {
    const open = !!c;
    const historial = c ? D.sales.filter(s => s.cliente === c.nombre) : [];
    return h(React.Fragment, {}, [
      h('div', { key: 'ov', className: 'fixed inset-0 bg-primary-container/40 backdrop-blur-sm z-[55] transition-opacity duration-300 ' + (open ? 'opacity-100' : 'opacity-0 pointer-events-none'), onClick: onClose }),
      h('div', { key: 'dr', className: 'fixed inset-y-0 right-0 w-[460px] bg-surface border-l border-outline-variant z-[60] shadow-e3 flex flex-col transition-transform duration-300 ' + (open ? 'translate-x-0' : 'translate-x-full') },
        c && [
          h('div', { key: 'h', className: 'px-8 py-6 border-b border-outline-variant flex justify-between items-center' }, [
            h('div', { key: 't' }, [
              h('p', { key: 'a', className: 'text-overline uppercase font-bold text-on-surface-variant tracking-widest opacity-60' }, 'Ficha de cliente'),
              h('h2', { key: 'b', className: 'text-h1 font-headline text-primary mt-1' }, c.nombre),
            ]),
            h('button', { key: 'x', className: 'p-2 hover:bg-surface-container rounded-full transition-colors', onClick: onClose }, h(MS, { name: 'close', size: 22, className: 'text-on-surface-variant' })),
          ]),
          h('div', { key: 'c', className: 'flex-grow overflow-y-auto p-8 space-y-8' }, [
            // Cabecera cliente
            h('div', { key: 'hd', className: 'flex items-center gap-4' }, [
              h('div', { key: 'a', className: 'w-14 h-14 rounded-full bg-primary-container text-gold flex items-center justify-center text-h2 font-bold shrink-0' }, c.nombre.split(' ').map(w => w[0]).slice(0, 2).join('')),
              h('div', { key: 'i', className: 'flex-grow' }, [
                h('p', { key: 't', className: 'font-mono text-body text-on-surface-variant' }, c.tel),
                h('span', { key: 'z', className: 'inline-block mt-1 px-2 py-0.5 bg-surface-container-high rounded text-overline font-bold uppercase text-on-surface-variant' }, 'Talla ' + (c.talla || '—')),
              ]),
            ]),
            // Stats
            h('div', { key: 'st', className: 'grid grid-cols-2 gap-4' }, [
              stat('Compras totales', c.compras), stat('Total gastado', fmt(c.total).replace('.00', '')),
              stat('Ticket promedio', fmt(Math.round(c.total / (c.compras || 1))).replace('.00', '')), stat('Última visita', fechaCorta(c.ultima)),
            ]),
            // Notas
            c.notas && h('div', { key: 'no', className: 'space-y-2' }, [
              h('label', { key: 'l', className: 'text-overline uppercase font-bold text-on-surface-variant tracking-widest opacity-60' }, 'Notas'),
              h('div', { key: 'b', className: 'border border-outline-variant rounded-lg bg-surface-container/30 p-4 text-caption leading-relaxed text-on-surface-variant' }, c.notas),
            ]),
            // Historial
            h('div', { key: 'hi', className: 'space-y-3' }, [
              h('h3', { key: 't', className: 'text-overline font-bold uppercase text-primary tracking-widest border-b border-outline-variant pb-3' }, 'Historial de compras'),
              historial.length ? h('div', { key: 'l', className: 'divide-y divide-outline-variant' }, historial.map(s => h('div', { key: s.folio, className: 'flex items-center justify-between py-3' }, [
                h('div', { key: 'a' }, [
                  h('p', { key: 'f', className: 'text-body font-semibold text-primary' }, s.folio),
                  h('p', { key: 'd', className: 'text-overline text-on-surface-variant' }, s.fecha + ' · ' + s.items + ' art.'),
                ]),
                h('div', { key: 'b', className: 'flex items-center gap-3' }, [
                  h('span', { key: 'e', className: 'px-2 py-0.5 text-overline font-bold rounded ' + (CHIP[s.estado] || 'bg-surface-container-low text-on-surface-variant border-outline-variant') }, s.estado.toUpperCase()),
                  h('span', { key: 't', className: 'font-headline text-body text-primary w-20 text-right' }, fmt(s.total).replace('.00', '')),
                ]),
              ]))) : h('div', { key: 'e', className: 'text-center text-on-surface-variant text-body py-6' }, 'Sin compras registradas'),
            ]),
            // Acciones
            h('div', { key: 'ac', className: 'pt-2 flex gap-4' }, [
              h('button', { key: 'p', className: 'w-14 h-[52px] rounded-xl border border-outline-variant text-primary hover:bg-surface-container transition-all flex items-center justify-center disabled:opacity-30', disabled: !c.tel || c.tel === '—', onClick: () => { const t = String(c.tel || '').replace(/[^0-9+]/g, ''); if (t) window.location.href = 'tel:' + t; }, title: 'Llamar' }, h(MS, { name: 'phone', size: 20 })),
              h('button', { key: 'e', className: 'flex-grow bg-primary text-on-primary py-3.5 rounded-xl text-overline font-bold uppercase tracking-widest hover:opacity-90 transition-all shadow-e2 active:scale-95 flex items-center justify-center gap-2', onClick: () => onEdit && onEdit(c) }, [h(MS, { key: 'i', name: 'edit', size: 18 }), 'Editar cliente']),
            ]),
          ]),
        ]),
    ]);
  }

  // Edición rápida de cliente (campos núcleo). Patcha el cliente existente y persiste.
  function ClientEditModal({ c, onClose, onSave }) {
    const [f, setF] = useState({ nombre: c.nombre || '', tel: c.tel === '—' ? '' : (c.tel || ''), email: c.email || '', talla: c.talla || '', nacimiento: c.nacimiento || '', notas: c.notas || '' });
    const set = (k, v) => setF(p => ({ ...p, [k]: v }));
    const inp = 'w-full bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2.5 text-body focus:ring-1 focus:ring-primary focus:border-primary';
    const field = (label, ctrl) => h('div', { key: label }, [h('label', { key: 'l', className: 'block text-overline uppercase font-bold text-on-surface-variant tracking-widest mb-1.5' }, label), ctrl]);
    function save() { if (!f.nombre.trim()) { toast('El nombre es obligatorio', 'var(--danger)'); return; } onSave(f); }
    const footer = [
      h('button', { key: 'c', className: 'px-5 py-3 border border-outline-variant rounded-xl text-caption font-bold uppercase tracking-widest text-on-surface hover:bg-surface-container transition', onClick: onClose }, 'Cancelar'),
      h('button', { key: 's', className: 'px-6 py-3 bg-primary text-on-primary rounded-xl text-caption font-bold uppercase tracking-widest hover:opacity-90 transition flex items-center gap-2', onClick: save }, [h(MS, { key: 'i', name: 'check', size: 16 }), 'Guardar cambios']),
    ];
    return h(Modal, { title: 'Editar cliente', onClose, footer }, [
      h('div', { key: 'g', className: 'space-y-4' }, [
        field('Nombre completo', h('input', { className: inp, value: f.nombre, onChange: e => set('nombre', e.target.value), autoFocus: true })),
        h('div', { key: 'row', className: 'grid grid-cols-2 gap-4' }, [
          field('Teléfono', h('input', { className: inp, type: 'tel', value: f.tel, onChange: e => set('tel', e.target.value), placeholder: '999 000 0000' })),
          field('Talla', h('input', { className: inp, value: f.talla, onChange: e => set('talla', e.target.value), placeholder: 'M, L, 32…' })),
        ]),
        h('div', { key: 'row2', className: 'grid grid-cols-2 gap-4' }, [
          field('Correo electrónico', h('input', { className: inp, type: 'email', value: f.email, onChange: e => set('email', e.target.value), placeholder: 'cliente@balam.com' })),
          field('Fecha de nacimiento', h('input', { className: inp, type: 'date', value: f.nacimiento, onChange: e => set('nacimiento', e.target.value) })),
        ]),
        field('Notas', h('textarea', { className: inp + ' resize-none', rows: 3, value: f.notas, onChange: e => set('notas', e.target.value), placeholder: 'Preferencias, observaciones…' })),
      ]),
    ]);
  }

  function stat(label, value) {
    return h('div', { key: label, className: 'bg-surface-container/50 p-4 rounded-xl border border-outline-variant' }, [
      h('span', { key: 'l', className: 'block text-overline uppercase font-bold text-on-surface-variant tracking-widest opacity-60 mb-1.5' }, label),
      h('span', { key: 'v', className: 'font-headline text-h2 text-primary' }, value),
    ]);
  }
  function fechaCorta(f) { if (!f) return '—'; const [y, m, d] = f.split('-'); return `${d}/${m}/${y.slice(2)}`; }

  // ---------- Pantalla: Nuevo registro de cliente ----------
  const LUX = 'bg-surface-container-lowest p-10 rounded-lg shadow-e1';
  const UNDER = 'w-full bg-transparent border-0 border-b border-outline-variant py-3 px-0 text-body text-on-surface focus:border-primary focus:ring-0 transition-all placeholder:text-on-surface-variant/40';

  function NewClientForm({ onCancel, onSave }) {
    const [f, setF] = useState({
      nombre: '', email: '', cod: '+52', tel: '', nacimiento: '', calle: '', ciudad: '', estado: '', cp: '', pais: 'México',
      tallaCamisa: 'M', tallaPantalon: '32', telas: ['Lino Artesanal'], fit: 'Regular',
    });
    const set = (k, v) => setF(p => ({ ...p, [k]: v }));
    const toggleTela = (t) => setF(p => ({ ...p, telas: p.telas.includes(t) ? p.telas.filter(x => x !== t) : p.telas.concat(t) }));

    function submit() {
      if (!f.nombre.trim()) { toast('Escribe el nombre del cliente', 'var(--danger)'); return; }
      const direccion = [f.calle, f.ciudad, f.estado, f.cp, f.pais].filter(Boolean).join(', ');
      const notas = `Talla ${f.tallaCamisa} · Pantalón ${f.tallaPantalon} · Fit ${f.fit}` + (f.telas.length ? ` · Telas: ${f.telas.join(', ')}` : '');
      onSave({ nombre: f.nombre, tel: f.tel ? f.cod + ' ' + f.tel : '—', email: f.email, direccion, notas, tallaCamisa: f.tallaCamisa, nacimiento: f.nacimiento });
    }

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'max-w-5xl mx-auto py-12 px-10' }, [
        // Encabezado
        h('header', { key: 'h', className: 'mb-10' }, [
          h('div', { key: 'bc', className: 'flex items-center gap-2 text-on-surface-variant mb-4' }, [
            h('button', { key: 'a', className: 'text-overline uppercase tracking-widest font-semibold hover:text-primary', onClick: onCancel }, 'Clientes'),
            h(MS, { key: 'c', name: 'chevRight', size: 14 }),
            h('span', { key: 'b', className: 'text-overline uppercase tracking-widest font-semibold text-primary' }, 'Nuevo registro'),
          ]),
          h('h2', { key: 't', className: 'font-headline text-display-lg text-primary' }, 'Nuevo registro de cliente'),
          h('p', { key: 'p', className: 'text-on-surface-variant mt-2 max-w-2xl text-body-lg' }, 'Crea un perfil personalizado para ofrecer una experiencia de compra exclusiva y adaptada a las preferencias de tu cliente.'),
        ]),
        // Sección contacto
        h('section', { key: 's1', className: LUX + ' mb-8' },
          h('div', { className: 'flex flex-col md:flex-row gap-10 items-start' }, [
            h('div', { key: 'l', className: 'md:w-1/3' }, [
              h('h3', { key: 't', className: 'font-headline text-headline-md text-primary' }, 'Información de contacto'),
              h('p', { key: 'd', className: 'text-on-surface-variant mt-2 text-body leading-relaxed' }, 'Datos fundamentales para el seguimiento y envío de piezas.'),
            ]),
            h('div', { key: 'r', className: 'md:w-2/3 grid grid-cols-2 gap-x-8 gap-y-8' }, [
              ffield('Nombre completo', h('input', { className: UNDER, placeholder: 'Ej. Alejandro Valenzuela', value: f.nombre, onChange: e => set('nombre', e.target.value) }), 'col-span-2'),
              ffield('Correo electrónico', h('input', { className: UNDER, type: 'email', placeholder: 'cliente@balam.com', value: f.email, onChange: e => set('email', e.target.value) })),
              ffield('Teléfono', h('div', { className: 'flex items-center gap-2' }, [
                h('select', { key: 's', className: 'bg-transparent border-0 border-b border-outline-variant text-body focus:ring-0 focus:border-primary w-16 py-3', value: f.cod, onChange: e => set('cod', e.target.value) }, window.CONFIG.codes('country_code').map(c => h('option', { key: c, value: c }, c))),
                h('input', { key: 'i', className: UNDER + ' flex-1', type: 'tel', placeholder: '55 0000 0000', value: f.tel, onChange: e => set('tel', e.target.value) }),
              ])),
              ffield('Fecha de nacimiento', h('input', { className: UNDER, type: 'date', value: f.nacimiento, onChange: e => set('nacimiento', e.target.value) })),
              h('div', { key: 'dir', className: 'col-span-2 mt-2' }, [
                h('label', { key: 'l', className: 'block text-overline font-semibold text-on-surface-variant uppercase tracking-widest mb-4' }, 'Dirección de envío'),
                h('div', { key: 'g', className: 'grid grid-cols-2 gap-x-8 gap-y-6' }, [
                  h('input', { key: 'c', className: UNDER + ' col-span-2', placeholder: 'Calle y número', value: f.calle, onChange: e => set('calle', e.target.value) }),
                  h('input', { key: 'ci', className: UNDER, placeholder: 'Ciudad', value: f.ciudad, onChange: e => set('ciudad', e.target.value) }),
                  h('input', { key: 'e', className: UNDER, placeholder: 'Estado / Provincia', value: f.estado, onChange: e => set('estado', e.target.value) }),
                  h('input', { key: 'cp', className: UNDER, placeholder: 'Código postal', value: f.cp, onChange: e => set('cp', e.target.value) }),
                  h('input', { key: 'pa', className: UNDER, placeholder: 'País', value: f.pais, onChange: e => set('pais', e.target.value) }),
                ]),
              ]),
            ]),
          ])),
        // Sección preferencias
        h('section', { key: 's2', className: LUX },
          h('div', { className: 'flex flex-col md:flex-row gap-10 items-start' }, [
            h('div', { key: 'l', className: 'md:w-1/3' }, [
              h('h3', { key: 't', className: 'font-headline text-headline-md text-primary' }, 'Preferencias de estilo'),
              h('p', { key: 'd', className: 'text-on-surface-variant mt-2 text-body leading-relaxed' }, 'Personalización para el corte y confección de prendas a medida.'),
            ]),
            h('div', { key: 'r', className: 'md:w-2/3 space-y-10' }, [
              h('div', { key: 'sz', className: 'grid grid-cols-2 gap-8' }, [
                sizeGroup('Talla de camisa', window.CONFIG.codes('size_letter'), f.tallaCamisa, v => set('tallaCamisa', v)),
                sizeGroup('Talla de pantalón', ['30', '32', '34', '36'], f.tallaPantalon, v => set('tallaPantalon', v)),
              ]),
              h('div', { key: 'te' }, [
                h('label', { key: 'l', className: 'block text-overline font-semibold text-on-surface-variant uppercase tracking-widest mb-4' }, 'Preferencias de tela'),
                h('div', { key: 'g', className: 'flex gap-4' }, window.CONFIG.codes('premium_fabric').map(t => {
                  const on = f.telas.includes(t);
                  return h('button', { key: t, type: 'button', className: 'flex-1 border p-4 transition-all flex items-center justify-between rounded ' + (on ? 'border-primary bg-primary/5' : 'border-outline-variant hover:bg-surface'), onClick: () => toggleTela(t) }, [
                    h('span', { key: 's', className: 'text-body font-bold' }, t),
                    h(MS, { key: 'i', name: on ? 'check' : 'plus', size: 16, className: on ? 'text-primary' : 'text-on-surface-variant/40' }),
                  ]);
                })),
              ]),
              h('div', { key: 'fit' }, [
                h('label', { key: 'l', className: 'block text-overline font-semibold text-on-surface-variant uppercase tracking-widest mb-4' }, 'Tipo de ajuste (fit)'),
                h('div', { key: 'g', className: 'grid grid-cols-3 gap-4' }, window.CONFIG.codes('fit').map((fit, i) => [fit, i + 1]).map(([fit, w]) => {
                  const on = f.fit === fit;
                  return h('button', { key: fit, type: 'button', className: 'flex flex-col items-center gap-3 p-6 transition-all rounded ' + (on ? 'border-2 border-primary bg-primary/5' : 'border border-outline-variant hover:border-primary'), onClick: () => set('fit', fit) }, [
                    h('div', { key: 'b', className: 'h-8 border-x border-primary', style: { width: w * 4 } }),
                    h('span', { key: 's', className: 'text-caption uppercase tracking-widest font-bold' }, fit),
                  ]);
                })),
              ]),
            ]),
          ])),
        // Acciones
        h('div', { key: 'ac', className: 'flex justify-end items-center gap-8 pt-8' }, [
          h('button', { key: 'c', className: 'text-on-surface-variant text-overline font-bold uppercase tracking-widest hover:text-error transition-colors', onClick: onCancel }, 'Cancelar registro'),
          h('button', { key: 's', className: 'bg-primary text-on-primary px-12 py-4 text-overline font-bold uppercase tracking-[0.2em] rounded-lg shadow-e2 hover:bg-primary-container transition-all flex items-center gap-3', onClick: submit }, ['Guardar cliente', h(MS, { key: 'i', name: 'arrowUpRight', size: 16 })]),
        ]),
      ]));
  }

  function ffield(label, control, span) {
    return h('div', { key: label, className: span || 'col-span-1' }, [
      h('label', { key: 'l', className: 'block text-overline font-semibold text-on-surface-variant uppercase tracking-widest mb-2' }, label),
      control,
    ]);
  }
  function sizeGroup(label, opts, value, onChange) {
    return h('div', { key: label }, [
      h('label', { key: 'l', className: 'block text-overline font-semibold text-on-surface-variant uppercase tracking-widest mb-4' }, label),
      h('div', { key: 'g', className: 'flex gap-2 flex-wrap' }, opts.map(o => {
        const on = value === o;
        return h('button', { key: o, type: 'button', className: 'px-4 py-2 text-body transition-all rounded ' + (on ? 'border border-primary text-primary bg-primary/5 font-bold' : 'border border-outline-variant hover:border-primary hover:text-primary'), onClick: () => onChange(o) }, o);
      })),
    ]);
  }

  window.ClientsScreen = ClientsScreen;
})();
