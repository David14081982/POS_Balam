// discounts.jsx — Promociones / Descuentos (Heritage).
// Exporta:
//   window.PROMOS        → motor (estado, match, lineUnit, preview) usado por el POS.
//   window.DiscountsScreen → pantalla de administración (tabla + modal + vista previa).
// Modelo de promo: { id, nombre, tipo:'pct'|'fijo', valor, inicio, fin, horaInicio, horaFin,
//   pausado, scope:{cats,telas,mangas,cuellos,colores,tallas,modelos,orns} }
// Reglas: descuentos ACUMULABLES (suma de % + suma de $) con tope de margen mínimo
//   (discount.minMarginPct sobre el costo). Solo las promos 'Activo' se aplican en ventas.
(function () {
  const { useState, useEffect, useMemo } = React;
  const { fmt, toast, ToastHost } = window.UI;
  const { MS } = window.HX;
  const D = window.DATA;
  const C = window.CONFIG;
  const h = React.createElement;

  // ── Motor ───────────────────────────────────────────────────────────────────
  function parseDT(d, t, isEnd) {
    if (!d) return null;
    const time = t || (isEnd ? '23:59' : '00:00');
    const dt = new Date(d + 'T' + time + ':00');
    return isNaN(dt.getTime()) ? null : dt;
  }
  function estado(p) {
    if (p.pausado) return 'Pausado';
    const now = new Date();
    const s = parseDT(p.inicio, p.horaInicio, false);
    const e = parseDT(p.fin, p.horaFin, true);
    if (s && now < s) return 'Programado';
    if (e && now > e) return 'Finalizado';
    return 'Activo';
  }
  function active() { return D.promos.filter(p => estado(p) === 'Activo'); }

  const inDim = (arr, val) => !arr || !arr.length || arr.indexOf(val) >= 0;
  function dimsMatch(s, p) {
    return inDim(s.cats, p.cat) && inDim(s.telas, p.tela) && inDim(s.mangas, p.manga)
      && inDim(s.cuellos, p.cuello) && inDim(s.colores, p.color) && inDim(s.orns, p.orn)
      && inDim(s.modelos, String(p.modelo));
  }
  function match(promo, p, talla) {
    const s = promo.scope || {};
    if (!dimsMatch(s, p)) return false;
    if (talla != null && s.tallas && s.tallas.length && s.tallas.indexOf(talla) < 0) return false;
    return true;
  }
  // Para vista previa / conteo (sin talla concreta): exige stock en alguna talla del alcance.
  function productMatch(promo, p) {
    const s = promo.scope || {};
    if (!dimsMatch(s, p)) return false;
    if (s.tallas && s.tallas.length) return (p.stock || []).some(v => s.tallas.indexOf(v.talla) >= 0);
    return true;
  }
  function floorPrice(p) {
    const minM = Number(C.get('discount.minMarginPct')) || 0;
    const cost = Number(p.costo) || 0;
    if (cost > 0 && minM > 0 && minM < 100) return cost / (1 - minM / 100);
    return 0;
  }
  // Aplica una lista de promos (acumulables) sobre el precio de lista de un producto.
  function applyStack(orig, list, p) {
    let pct = 0, fijo = 0;
    list.forEach(pr => { if (pr.tipo === 'fijo') fijo += Number(pr.valor) || 0; else pct += Number(pr.valor) || 0; });
    pct = Math.min(pct, 100);
    let unit = orig * (1 - pct / 100) - fijo;
    const floor = floorPrice(p);
    let capped = false;
    if (floor && unit < floor) { unit = floor; capped = true; }
    if (unit < 0) unit = 0;
    unit = Math.round(unit * 100) / 100;
    return { unit, capped, pct, fijo };
  }
  // Precio unitario efectivo de una línea del ticket (con todas las promos activas).
  function lineUnit(p, talla) {
    const orig = Number(p.precio) || 0;
    const list = active().filter(pr => match(pr, p, talla));
    if (!list.length) return { unit: orig, orig, off: 0, promos: [], capped: false };
    const r = applyStack(orig, list, p);
    return { unit: r.unit, orig, off: Math.max(0, orig - r.unit), promos: list, capped: r.capped };
  }
  // Vista previa del efecto de UNA promo (en edición) sobre el catálogo.
  function previewDraft(draft) {
    const affected = D.products.filter(p => productMatch(draft, p));
    const examples = affected.slice(0, 4).map(p => {
      const orig = Number(p.precio) || 0;
      const r = applyStack(orig, [draft], p);
      return { p, orig, unit: r.unit, off: Math.max(0, orig - r.unit), capped: r.capped, margin: orig > 0 ? (orig - (Number(p.costo) || 0)) / orig : 0 };
    });
    const anyCapped = affected.some(p => applyStack(Number(p.precio) || 0, [draft], p).capped);
    return { count: affected.length, examples, anyCapped };
  }

  window.PROMOS = { estado, active, match, productMatch, lineUnit, previewDraft, applyStack };

  // ── Helpers de UI ─────────────────────────────────────────────────────────────
  const STATUS_STYLE = {
    Activo: 'bg-green-50 text-green-700 border-green-200',
    Programado: 'bg-blue-50 text-blue-700 border-blue-200',
    Pausado: 'bg-gray-100 text-gray-600 border-gray-200',
    Finalizado: 'bg-red-50 text-red-700 border-red-200',
  };
  function discountText(p) { return p.tipo === 'fijo' ? fmt(p.valor) : (Number(p.valor) || 0) + '% Off'; }
  function vigenciaText(p) {
    if (!p.inicio && !p.fin) return 'Indefinido';
    const f = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    return f(p.inicio) + ' – ' + f(p.fin);
  }
  function scopeMaps() {
    return { cats: C.map('category'), telas: C.map('fabric'), mangas: C.map('sleeve'), cuellos: C.map('neck'), colores: C.map('color') };
  }
  function scopeSummary(s, maps) {
    s = s || {};
    const parts = [];
    if (s.cats && s.cats.length) parts.push(s.cats.map(c => maps.cats[c] || c).join(', '));
    if (s.telas && s.telas.length) parts.push(s.telas.map(c => maps.telas[c] || c).join(', '));
    if (s.mangas && s.mangas.length) parts.push(s.mangas.map(c => maps.mangas[c] || c).join(', '));
    if (s.cuellos && s.cuellos.length) parts.push(s.cuellos.map(c => maps.cuellos[c] || c).join(', '));
    if (s.colores && s.colores.length) parts.push(s.colores.map(c => maps.colores[c] || c).join(', '));
    if (s.tallas && s.tallas.length) parts.push('Tallas ' + s.tallas.join('/'));
    if (s.modelos && s.modelos.length) parts.push('Mod. ' + s.modelos.join('/'));
    if (s.orns && s.orns.length) parts.push(s.orns.join(', '));
    return parts.length ? parts.join(' · ') : 'Todas las prendas';
  }

  function StatusBadge({ p }) {
    const e = estado(p);
    return h('span', { className: 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border uppercase tracking-tighter ' + (STATUS_STYLE[e] || STATUS_STYLE.Finalizado) }, e);
  }

  // ── Pantalla ───────────────────────────────────────────────────────────────
  function DiscountsScreen() {
    const [, bump] = useState(0);
    const refresh = () => bump(v => v + 1);
    const [editing, setEditing] = useState(null); // null | {} (nuevo) | promo (editar)
    useEffect(() => {
      const on = () => refresh();
      window.addEventListener('configchange', on);
      return () => window.removeEventListener('configchange', on);
    }, []);

    const maps = scopeMaps();
    const promos = D.promos;
    const nActivas = promos.filter(p => estado(p) === 'Activo').length;
    const nProg = promos.filter(p => estado(p) === 'Programado').length;

    function togglePause(p) { D.updatePromo(p.id, { pausado: !p.pausado }); refresh(); toast(p.pausado ? 'Promoción reanudada' : 'Promoción pausada'); }
    function dup(p) { D.duplicatePromo(p.id); refresh(); toast('Promoción duplicada (en pausa)'); }
    function del(p) { if (window.confirm('¿Eliminar la promoción "' + p.nombre + '"?')) { D.removePromo(p.id); refresh(); toast('Promoción eliminada', 'var(--danger)'); } }

    return h('div', { className: 'flex-1 min-h-0 overflow-y-auto bg-background font-body text-on-surface p-8' }, [
      // Encabezado
      h('div', { key: 'hd', className: 'mb-8 flex flex-wrap gap-4 justify-between items-end' }, [
        h('div', { key: 'l', className: 'max-w-2xl' }, [
          h('h2', { key: 't', className: 'font-headline text-headline-lg text-primary mb-1' }, 'Promociones y Descuentos'),
          h('p', { key: 'd', className: 'text-body-md text-on-surface-variant' }, 'Gestiona ofertas y descuentos que se aplican automáticamente en el punto de venta.'),
        ]),
        h('div', { key: 'r', className: 'flex items-center gap-3' }, [
          h('span', { key: 'a', className: 'bg-primary-container text-on-primary-container px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1' }, [h(MS, { key: 'i', name: 'check', size: 14 }), nActivas + ' ACTIVAS']),
          h('span', { key: 'p', className: 'bg-surface-container-high text-on-surface-variant px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1' }, [h(MS, { key: 'i', name: 'clock', size: 14 }), nProg + ' PROGRAMADAS']),
          h('button', {
            key: 'n', className: 'ml-2 bg-primary text-on-primary px-5 h-10 rounded-lg shadow-e1 hover:opacity-90 transition-all text-caption font-bold uppercase tracking-widest flex items-center gap-2',
            onClick: () => setEditing({}),
          }, [h(MS, { key: 'i', name: 'add', size: 18 }), 'Nueva promoción']),
        ]),
      ]),
      // Tabla
      h('div', { key: 'tb', className: 'bg-surface-container-lowest border border-outline-variant rounded-xl shadow-e1 overflow-hidden' },
        promos.length === 0
          ? h('div', { className: 'py-16 text-center text-on-surface-variant' }, [
              h(MS, { key: 'i', name: 'sell', size: 36, className: 'opacity-40' }),
              h('p', { key: 't', className: 'mt-3 font-headline text-h2 text-primary' }, 'Sin promociones'),
              h('p', { key: 's', className: 'text-caption' }, 'Crea la primera con "Nueva promoción".'),
            ])
          : h('table', { className: 'w-full text-left border-collapse' }, [
              h('thead', { key: 'h', className: 'bg-surface-container-low border-b border-outline-variant' },
                h('tr', null, ['Nombre', 'Descuento', 'Vigencia', 'Alcance', 'Estado', ''].map((t, i) =>
                  h('th', { key: i, className: 'px-6 py-4 text-overline uppercase tracking-wider text-on-surface-variant/80 ' + (i === 5 ? 'text-right' : '') }, t || 'Acciones')))),
              h('tbody', { key: 'b', className: 'divide-y divide-outline-variant/50' },
                promos.map(p => {
                  const fin = estado(p) === 'Finalizado';
                  return h('tr', { key: p.id, className: 'hover:bg-surface-container/40 transition-colors ' + (fin || p.pausado ? 'opacity-70' : '') }, [
                    h('td', { key: 'n', className: 'px-6 py-5 font-headline text-[18px] text-primary' }, p.nombre),
                    h('td', { key: 'd', className: 'px-6 py-5 font-body-md font-semibold text-gold-text' }, discountText(p)),
                    h('td', { key: 'v', className: 'px-6 py-5 text-caption text-on-surface-variant' }, vigenciaText(p)),
                    h('td', { key: 'a', className: 'px-6 py-5 text-body-md max-w-[240px] truncate', title: scopeSummary(p.scope, maps) }, scopeSummary(p.scope, maps)),
                    h('td', { key: 's', className: 'px-6 py-5' }, h(StatusBadge, { p })),
                    h('td', { key: 'x', className: 'px-6 py-5 text-right' },
                      h('div', { className: 'flex justify-end gap-2 text-on-surface-variant' }, [
                        h('button', { key: 'e', className: 'p-1.5 hover:text-primary transition-colors', title: 'Editar', onClick: () => setEditing(p) }, h(MS, { name: 'edit', size: 18 })),
                        h('button', { key: 'd', className: 'p-1.5 hover:text-primary transition-colors', title: 'Duplicar', onClick: () => dup(p) }, h(MS, { name: 'content_copy', size: 18 })),
                        h('button', { key: 'p', className: 'p-1.5 hover:text-primary transition-colors', title: p.pausado ? 'Activar' : 'Pausar', onClick: () => togglePause(p) }, h(MS, { name: p.pausado ? 'play_arrow' : 'pause', size: 18 })),
                        h('button', { key: 'x', className: 'p-1.5 hover:text-danger transition-colors', title: 'Eliminar', onClick: () => del(p) }, h(MS, { name: 'trash', size: 18 })),
                      ])),
                  ]);
                })),
            ])),
      editing && h(PromoModal, { key: 'modal', promo: editing, onClose: () => setEditing(null), onSaved: () => { setEditing(null); refresh(); } }),
    ]);
  }

  // ── Modal de alta / edición ───────────────────────────────────────────────
  function PromoModal({ promo, onClose, onSaved }) {
    const isEdit = !!(promo && promo.id);
    const [d, setD] = useState(() => ({
      id: promo.id, nombre: promo.nombre || '', tipo: promo.tipo || 'pct', valor: promo.valor != null ? promo.valor : '',
      inicio: promo.inicio || '', fin: promo.fin || '', horaInicio: promo.horaInicio || '', horaFin: promo.horaFin || '',
      pausado: !!promo.pausado, scope: JSON.parse(JSON.stringify(promo.scope || {})),
    }));
    const set = (k, v) => setD(prev => Object.assign({}, prev, { [k]: v }));
    const isOn = (dim, code) => (d.scope[dim] || []).indexOf(code) >= 0;
    function toggle(dim, code) {
      setD(prev => {
        const sc = Object.assign({}, prev.scope);
        const arr = (sc[dim] || []).slice();
        const i = arr.indexOf(code);
        if (i >= 0) arr.splice(i, 1); else arr.push(code);
        sc[dim] = arr;
        return Object.assign({}, prev, { scope: sc });
      });
    }

    const cats = C.list('category'), telas = C.list('fabric'), mangas = C.list('sleeve'), cuellos = C.list('neck'), colores = C.list('color');
    const tallas = C.codes('size_letter').concat(C.codes('size_number'));
    const modelos = useMemo(() => [...new Set(D.products.map(p => String(p.modelo)))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })), []);
    const orns = useMemo(() => [...new Set(D.products.map(p => p.orn).filter(o => o && o !== '—'))], []);

    const draftForPreview = Object.assign({}, d, { valor: Number(d.valor) || 0 });
    const preview = useMemo(() => window.PROMOS.previewDraft(draftForPreview), [JSON.stringify(d)]);

    function submit() {
      if (!d.nombre.trim()) { toast('Escribe el nombre de la promoción', 'var(--danger)'); return; }
      if (!(Number(d.valor) > 0)) { toast('El valor del descuento debe ser mayor a 0', 'var(--danger)'); return; }
      if (d.inicio && d.fin && d.fin < d.inicio) { toast('La fecha fin no puede ser anterior al inicio', 'var(--danger)'); return; }
      const payload = {
        nombre: d.nombre.trim(), tipo: d.tipo, valor: Number(d.valor) || 0,
        inicio: d.inicio || '', fin: d.fin || '', horaInicio: d.horaInicio || '', horaFin: d.horaFin || '',
        pausado: !!d.pausado, scope: d.scope,
      };
      if (isEdit) D.updatePromo(d.id, payload); else D.addPromo(payload);
      toast(isEdit ? 'Promoción actualizada' : 'Promoción creada');
      onSaved();
    }

    const lblCls = 'font-label-sm text-on-surface-variant';
    const underline = 'w-full border-b border-outline-variant focus:border-primary border-t-0 border-l-0 border-r-0 bg-transparent px-0 py-2 text-body-md focus:ring-0';
    const sectionTitle = (t) => h('h4', { key: 'st', className: 'text-overline uppercase tracking-widest text-primary mb-5 border-b border-outline-variant/40 pb-2' }, t);
    const chip = (k, label, on, onClick) => h('button', {
      key: k, type: 'button', onClick,
      className: 'px-3 py-1 rounded text-xs transition-colors ' + (on ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-primary hover:text-on-primary'),
    }, label);
    const chipRow = (dim, items) => h('div', { key: 'cr', className: 'flex flex-wrap gap-2' }, items.map(it => chip(dim + ':' + it.code, it.label, isOn(dim, it.code), () => toggle(dim, it.code))));

    return h('div', {
      className: 'fixed inset-0 z-[60] bg-primary/40 backdrop-blur-sm flex items-center justify-center p-4',
      onMouseDown: e => { if (e.target === e.currentTarget) onClose(); },
    },
      h('div', { className: 'bg-surface-container-lowest w-full max-w-5xl max-h-[92vh] rounded-xl shadow-e3 flex flex-col' }, [
        // Header
        h('div', { key: 'h', className: 'px-8 py-6 border-b border-outline-variant flex justify-between items-center' }, [
          h('div', { key: 'l' }, [
            h('h2', { key: 't', className: 'font-headline text-headline-md text-primary' }, isEdit ? 'Editar promoción' : 'Configurar nueva promoción'),
            h('p', { key: 's', className: 'text-caption text-on-surface-variant' }, 'Define el descuento, su vigencia y a qué prendas aplica.'),
          ]),
          h('button', { key: 'x', className: 'text-on-surface-variant hover:text-primary transition-colors', onClick: onClose }, h(MS, { name: 'x', size: 28 })),
        ]),
        // Body
        h('div', { key: 'b', className: 'flex-grow overflow-y-auto px-8 py-7' },
          h('div', { className: 'grid grid-cols-12 gap-10' }, [
            // Configurador
            h('div', { key: 'cfg', className: 'col-span-12 lg:col-span-7 space-y-8' }, [
              // Información básica
              h('section', { key: 's1' }, [
                sectionTitle('Información básica'),
                h('div', { key: 'g', className: 'grid grid-cols-2 gap-5' }, [
                  h('div', { key: 'n', className: 'col-span-2 space-y-1.5' }, [
                    h('label', { key: 'l', className: lblCls }, 'Nombre de la promoción'),
                    h('input', { key: 'c', className: underline + ' text-body-lg', placeholder: 'Ej. Gala de Verano', value: d.nombre, onChange: e => set('nombre', e.target.value), autoFocus: true }),
                  ]),
                  h('div', { key: 't', className: 'space-y-1.5' }, [
                    h('label', { key: 'l', className: lblCls }, 'Tipo de descuento'),
                    h('select', { key: 'c', className: underline, value: d.tipo, onChange: e => set('tipo', e.target.value) }, [
                      h('option', { key: 'p', value: 'pct' }, 'Porcentaje (%)'),
                      h('option', { key: 'f', value: 'fijo' }, 'Monto fijo ($)'),
                    ]),
                  ]),
                  h('div', { key: 'v', className: 'space-y-1.5' }, [
                    h('label', { key: 'l', className: lblCls }, d.tipo === 'fijo' ? 'Monto por pieza ($)' : 'Valor (%)'),
                    h('input', { key: 'c', className: underline, type: 'number', min: 0, placeholder: d.tipo === 'fijo' ? '100' : '20', value: d.valor, onChange: e => set('valor', e.target.value) }),
                  ]),
                ]),
              ]),
              // Vigencia
              h('section', { key: 's2' }, [
                sectionTitle('Vigencia temporal'),
                h('div', { key: 'g', className: 'grid grid-cols-2 gap-6' }, [
                  h('div', { key: 'i', className: 'space-y-1.5' }, [
                    h('label', { key: 'l', className: lblCls }, 'Inicio (opcional)'),
                    h('div', { key: 'c', className: 'flex items-center gap-2 border-b border-outline-variant py-2' }, [
                      h(MS, { key: 'c', name: 'calendar', size: 18, className: 'text-on-surface-variant' }),
                      h('input', { key: 'd', className: 'border-none bg-transparent p-0 focus:ring-0 text-body-md w-full', type: 'date', value: d.inicio, onChange: e => set('inicio', e.target.value) }),
                      h('input', { key: 't', className: 'border-none bg-transparent p-0 focus:ring-0 text-body-md w-24', type: 'time', value: d.horaInicio, onChange: e => set('horaInicio', e.target.value) }),
                    ]),
                  ]),
                  h('div', { key: 'f', className: 'space-y-1.5' }, [
                    h('label', { key: 'l', className: lblCls }, 'Fin (opcional)'),
                    h('div', { key: 'c', className: 'flex items-center gap-2 border-b border-outline-variant py-2' }, [
                      h(MS, { key: 'c', name: 'calendar', size: 18, className: 'text-on-surface-variant' }),
                      h('input', { key: 'd', className: 'border-none bg-transparent p-0 focus:ring-0 text-body-md w-full', type: 'date', value: d.fin, onChange: e => set('fin', e.target.value) }),
                      h('input', { key: 't', className: 'border-none bg-transparent p-0 focus:ring-0 text-body-md w-24', type: 'time', value: d.horaFin, onChange: e => set('horaFin', e.target.value) }),
                    ]),
                  ]),
                ]),
                h('p', { key: 'hint', className: 'text-caption text-on-surface-variant mt-2' }, 'Sin fechas = vigencia indefinida. El estado (Activo/Programado/Finalizado) se calcula solo según las fechas.'),
              ]),
              // Alcance
              h('section', { key: 's3' }, [
                sectionTitle('Alcance (filtros — vacío = todas las prendas)'),
                h('div', { key: 'g', className: 'space-y-5' }, [
                  h('div', { key: 'cat' }, [h('label', { key: 'l', className: lblCls + ' block mb-2' }, 'Categorías'), chipRow('cats', cats)]),
                  h('div', { key: 'tela' }, [h('label', { key: 'l', className: lblCls + ' block mb-2' }, 'Telas'), chipRow('telas', telas)]),
                  h('div', { key: 'manga' }, [h('label', { key: 'l', className: lblCls + ' block mb-2' }, 'Manga'), chipRow('mangas', mangas)]),
                  h('div', { key: 'cuello' }, [h('label', { key: 'l', className: lblCls + ' block mb-2' }, 'Cuello'), chipRow('cuellos', cuellos)]),
                  h('div', { key: 'color' }, [h('label', { key: 'l', className: lblCls + ' block mb-2' }, 'Colores'), chipRow('colores', colores)]),
                  h('div', { key: 'talla' }, [h('label', { key: 'l', className: lblCls + ' block mb-2' }, 'Tallas'), h('div', { key: 'c', className: 'flex flex-wrap gap-2' }, tallas.map(t => chip('t:' + t, t, isOn('tallas', t), () => toggle('tallas', t))))]),
                  orns.length ? h('div', { key: 'orn' }, [h('label', { key: 'l', className: lblCls + ' block mb-2' }, 'Ornamento'), h('div', { key: 'c', className: 'flex flex-wrap gap-2' }, orns.map(o => chip('o:' + o, o, isOn('orns', o), () => toggle('orns', o))))]) : null,
                  h('div', { key: 'mod' }, [h('label', { key: 'l', className: lblCls + ' block mb-2' }, 'Modelos'), h('div', { key: 'c', className: 'flex flex-wrap gap-2 max-h-28 overflow-y-auto' }, modelos.map(m => chip('m:' + m, '#' + m, isOn('modelos', m), () => toggle('modelos', m))))]),
                ]),
              ]),
            ]),
            // Vista previa de impacto
            h('div', { key: 'prev', className: 'col-span-12 lg:col-span-5 lg:border-l border-outline-variant lg:pl-10' }, [
              sectionTitle('Vista previa de impacto'),
              h('div', { key: 'box', className: 'bg-surface-container-low p-6 rounded-xl mb-6' }, [
                h('div', { key: 'c', className: 'flex justify-between items-center mb-5' }, [
                  h('span', { key: 'a', className: 'font-label-sm text-on-surface-variant' }, 'Productos afectados'),
                  h('span', { key: 'b', className: 'font-headline text-headline-md text-primary' }, preview.count + ' SKUs'),
                ]),
                h('p', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant mb-3' }, 'Ejemplos de cálculo'),
                preview.examples.length === 0
                  ? h('p', { key: 'ex', className: 'text-caption text-on-surface-variant italic' }, 'Ninguna prenda coincide con el alcance actual.')
                  : h('div', { key: 'ex', className: 'space-y-3' }, preview.examples.map(ex => h('div', { key: ex.p.id, className: 'flex items-center justify-between gap-3 bg-surface-container-lowest p-3 rounded-lg border border-outline-variant/40' }, [
                      h('div', { key: 'n', className: 'min-w-0' }, [
                        h('p', { key: 'a', className: 'font-body-md font-semibold text-sm text-primary truncate' }, ex.p.nombre),
                        h('p', { key: 'b', className: 'text-overline uppercase text-on-surface-variant' }, ex.p.sku),
                      ]),
                      h('div', { key: 'p', className: 'text-right shrink-0' }, [
                        ex.off > 0 ? h('span', { key: 'o', className: 'line-through text-on-surface-variant/50 text-xs mr-1.5' }, fmt(ex.orig)) : null,
                        h('span', { key: 'u', className: 'text-gold-text font-bold text-sm' }, fmt(ex.unit)),
                      ]),
                    ]))),
              ]),
              // Validación de margen
              h('div', { key: 'v', className: 'p-5 border rounded-xl ' + (preview.anyCapped ? 'border-danger/40 bg-danger-soft' : 'border-gold/40 bg-gold/5') }, [
                h('h5', { key: 't', className: 'font-label-sm font-bold mb-2 flex items-center gap-2 ' + (preview.anyCapped ? 'text-danger' : 'text-gold-text') }, [
                  h(MS, { key: 'i', name: preview.anyCapped ? 'alert' : 'check', size: 18 }), 'Validación de margen',
                ]),
                h('p', { key: 'd', className: 'text-caption text-on-surface-variant' },
                  preview.anyCapped
                    ? 'Algunas prendas alcanzan el margen mínimo (' + (Number(C.get('discount.minMarginPct')) || 0) + '%): el descuento se topó para no vender por debajo del piso de utilidad.'
                    : 'El descuento respeta el margen mínimo de utilidad (' + (Number(C.get('discount.minMarginPct')) || 0) + '%) configurado.'),
              ]),
            ]),
          ])),
        // Footer
        h('div', { key: 'f', className: 'px-8 py-5 border-t border-outline-variant bg-surface-container-low flex justify-end gap-4' }, [
          h('button', { key: 'c', className: 'px-7 h-11 text-caption font-bold uppercase tracking-widest text-on-surface-variant hover:text-primary transition-colors', onClick: onClose }, 'Descartar'),
          h('button', { key: 's', className: 'px-9 h-11 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition shadow-e1 flex items-center gap-2', onClick: submit }, [h(MS, { key: 'i', name: 'check', size: 18 }), isEdit ? 'Guardar cambios' : 'Crear promoción']),
        ]),
      ]));
  }

  window.DiscountsScreen = DiscountsScreen;
})();
