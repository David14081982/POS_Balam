// settings.jsx — Módulo de Configuración (Heritage). Cataloga y parametriza TODO lo que
// antes estaba hardcodeado. Lee/escribe en window.CONFIG (balam/config.jsx), local-first.
// Exporta window.SettingsScreen
(function () {
  const { useState, useEffect } = React;
  const { toast } = window.UI;
  const { MS, GlassCard, SerifHeading } = window.HX;
  const C = window.CONFIG;
  const D = window.DATA;
  const h = React.createElement;

  const SECTIONS = [
    { id: 'negocio', label: 'Negocio', icon: 'gear' },
    { id: 'producto', label: 'Catálogos de producto', icon: 'box' },
    { id: 'ventas', label: 'Ventas y POS', icon: 'pos' },
    { id: 'devoluciones', label: 'Devoluciones', icon: 'undo' },
    { id: 'vendedores', label: 'Vendedores', icon: 'badge' },
    { id: 'clientes', label: 'Clientes', icon: 'users' },
    { id: 'inventario', label: 'Inventario', icon: 'box' },
    { id: 'impresion', label: 'Impresión', icon: 'print' },
    { id: 'usuarios', label: 'Usuarios', icon: 'users' },
    { id: 'demo', label: 'Datos de demostración', icon: 'star' },
  ];

  const TONE_OPTS = ['success', 'warning', 'info', 'danger', 'neutral', 'gold'];
  const ICON_OPTS = ['cash', 'card', 'transfer', 'split', 'clock', 'receipt', 'tag', 'star'];

  const INPUT = 'block w-full h-11 px-3 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary text-body rounded-lg';

  function SettingsScreen() {
    const [sec, setSec] = useState('negocio');
    const [addingUser, setAddingUser] = useState(false);
    // Re-render en vivo cuando cambia cualquier ajuste/catálogo (otra pestaña incluida).
    const [, bump] = useState(0);
    useEffect(() => {
      const onCfg = () => bump(v => v + 1);
      window.addEventListener('configchange', onCfg);
      return () => window.removeEventListener('configchange', onCfg);
    }, []);

    if (addingUser) return h(NewUserForm, { user: addingUser === true ? null : addingUser, onCancel: () => setAddingUser(false), onSaved: () => { setAddingUser(false); bump(v => v + 1); } });

    const ctx = { setAddingUser, refresh: () => bump(v => v + 1) };
    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface p-6' },
      h('div', { className: 'grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6 max-w-5xl' }, [
        h(GlassCard, { key: 'nav', className: 'p-2 h-fit md:sticky md:top-6' },
          SECTIONS.map(s => h('button', {
            key: s.id,
            className: 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ' +
              (sec === s.id ? 'bg-surface-container-low text-primary font-medium' : 'text-on-surface-variant hover:bg-surface-container-low'),
            onClick: () => setSec(s.id),
          }, [h(MS, { key: 'i', name: s.icon, size: 18 }), h('span', { key: 'l', className: 'text-body' }, s.label)])),
        ),
        h('div', { key: 'panel', className: 'flex flex-col gap-4 min-w-0' }, PANELS[sec](ctx)),
      ]));
  }

  // ── Editor genérico de catálogos ───────────────────────────────────────────────
  // metaFields: [{ key, label, type:'text'|'number'|'color'|'select', options? }]
  function CatalogEditor({ kind, title, hint, metaFields = [], codePlaceholder = 'CÓD', labelPlaceholder = 'Nombre visible', lockCode = false }) {
    const items = C.all(kind);
    const [code, setCode] = useState('');
    const [label, setLabel] = useState('');

    function add() {
      const meta = {};
      metaFields.forEach(f => { if (f.def !== undefined) meta[f.key] = f.def; });
      const r = C.addItem(kind, { code: code.trim(), label: label.trim() || code.trim(), meta });
      if (!r.ok) { toast(r.error, 'var(--danger)'); return; }
      setCode(''); setLabel('');
    }
    function commitLabel(it, v) { if (v !== it.label) C.updateItem(kind, it.code, { label: v }); }
    function commitMeta(it, key, v) { C.updateItem(kind, it.code, { meta: { [key]: v } }); }
    function del(it) { const r = C.removeItem(kind, it.code); if (!r.ok) toast(r.error, 'var(--danger)'); }

    const metaInput = (it, f) => {
      const val = (it.meta && it.meta[f.key] != null) ? it.meta[f.key] : '';
      if (f.type === 'color') return h('input', { type: 'color', value: val || '#cccccc', className: 'w-9 h-8 rounded border border-outline-variant bg-surface cursor-pointer', onChange: e => commitMeta(it, f.key, e.target.value), title: f.label });
      if (f.type === 'select') return h('select', { className: 'h-8 px-2 bg-surface-container-low border border-outline-variant rounded text-caption', value: val, onChange: e => commitMeta(it, f.key, e.target.value), title: f.label }, (f.options || []).map(o => h('option', { key: o, value: o }, o)));
      if (f.type === 'number') return h('input', { type: 'number', defaultValue: val, className: 'w-16 h-8 px-2 bg-surface-container-low border border-outline-variant rounded text-caption text-right', onBlur: e => commitMeta(it, f.key, Number(e.target.value) || 0), title: f.label });
      return h('input', { defaultValue: val, placeholder: f.label, className: 'h-8 px-2 bg-surface-container-low border border-outline-variant rounded text-caption w-28', onBlur: e => commitMeta(it, f.key, e.target.value) });
    };

    return h(GlassCard, { key: kind, className: 'p-5' }, [
      h('div', { key: 'h', className: 'flex items-baseline justify-between mb-1' }, [
        h(SerifHeading, { key: 't', children: title }),
        h('span', { key: 'c', className: 'text-overline uppercase text-on-surface-variant' }, `${items.filter(i => i.active !== false).length} activos · ${items.length} total`),
      ]),
      hint && h('p', { key: 'hint', className: 'text-caption text-on-surface-variant mb-3' }, hint),
      // Filas
      h('div', { key: 'rows', className: 'flex flex-col divide-y divide-outline-variant/50 mb-3' }, items.map(it => {
        const off = it.active === false;
        return h('div', { key: it.code, className: 'flex items-center gap-2 py-2 ' + (off ? 'opacity-50' : '') }, [
          h('span', { key: 'cd', className: 'font-mono text-caption text-on-surface-variant w-16 shrink-0 truncate', title: it.code }, it.code),
          h('input', { key: 'lb', defaultValue: it.label, className: 'flex-1 min-w-0 h-8 px-2 bg-surface border border-outline-variant rounded text-body focus:ring-1 focus:ring-primary', onBlur: e => commitLabel(it, e.target.value) }),
          ...metaFields.map(f => h('span', { key: f.key, className: 'shrink-0' }, metaInput(it, f))),
          h('button', { key: 'up', className: 'w-7 h-7 grid place-items-center rounded hover:bg-surface-container text-on-surface-variant shrink-0', title: 'Subir', onClick: () => C.move(kind, it.code, -1) }, h(MS, { name: 'chevDown', size: 16, style: { transform: 'rotate(180deg)' } })),
          h('button', { key: 'dn', className: 'w-7 h-7 grid place-items-center rounded hover:bg-surface-container text-on-surface-variant shrink-0', title: 'Bajar', onClick: () => C.move(kind, it.code, 1) }, h(MS, { name: 'chevDown', size: 16 })),
          h('button', {
            key: 'tg', className: 'px-2 h-7 rounded text-overline uppercase font-bold shrink-0 ' + (off ? 'bg-surface-container text-on-surface-variant' : 'bg-success-soft text-success'),
            title: off ? 'Inactivo — clic para activar' : 'Activo — clic para desactivar', onClick: () => C.setActive(kind, it.code, off),
          }, off ? 'Off' : 'On'),
          h('button', { key: 'del', className: 'w-7 h-7 grid place-items-center rounded text-danger hover:bg-danger-soft shrink-0', title: 'Eliminar', onClick: () => del(it) }, h(MS, { name: 'trash', size: 16 })),
        ]);
      })),
      // Alta
      h('div', { key: 'add', className: 'flex items-center gap-2 pt-3 border-t border-outline-variant' }, [
        h('input', { key: 'c', value: code, placeholder: codePlaceholder, disabled: lockCode, className: 'font-mono w-16 h-9 px-2 bg-surface-container-low border border-outline-variant rounded text-caption disabled:opacity-40', onChange: e => setCode(e.target.value), onKeyDown: e => { if (e.key === 'Enter') add(); } }),
        h('input', { key: 'l', value: label, placeholder: labelPlaceholder, className: 'flex-1 min-w-0 h-9 px-2 bg-surface-container-low border border-outline-variant rounded text-body', onChange: e => setLabel(e.target.value), onKeyDown: e => { if (e.key === 'Enter') add(); } }),
        h('button', { key: 'b', className: 'inline-flex items-center gap-1.5 px-4 h-9 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition', onClick: add }, [h(MS, { key: 'i', name: 'plus', size: 16 }), 'Agregar']),
      ]),
    ]);
  }

  // ── Controles de ajustes (parámetros sueltos) ──────────────────────────────────
  function CfgText({ k, label, hint, type = 'text', wide }) {
    const v = C.get(k);
    return h('div', { key: k, className: 'mb-4 ' + (wide ? 'col-span-2' : '') }, [
      h('div', { key: 'l', className: 'font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest mb-1.5' }, label),
      h('input', { key: 'in', type, defaultValue: v, className: INPUT, onBlur: e => C.setSetting(k, type === 'number' ? (Number(e.target.value) || 0) : e.target.value) }),
      hint && h('div', { key: 'h', className: 'text-caption text-on-surface-variant mt-1' }, hint),
    ]);
  }
  function CfgToggle({ k, title, desc }) {
    const on = !!C.get(k);
    return h('div', { key: k, className: 'flex items-center justify-between gap-4 py-3 border-t border-outline-variant/40 first:border-t-0' }, [
      h('div', { key: 't' }, [
        h('div', { key: 'a', className: 'text-body font-medium text-primary' }, title),
        desc && h('div', { key: 'b', className: 'text-caption text-on-surface-variant mt-0.5' }, desc),
      ]),
      h('button', {
        key: 'sw', className: 'relative w-11 h-6 rounded-full transition-colors shrink-0 ' + (on ? '' : 'bg-surface-container-highest'),
        style: on ? { background: '#D4AF38' } : null, onClick: () => C.setSetting(k, !on),
      }, h('span', { className: 'absolute top-0.5 w-5 h-5 bg-surface rounded-full shadow transition-all ' + (on ? 'left-[22px]' : 'left-0.5') })),
    ]);
  }
  // Selector segmentado (dos o más opciones excluyentes) ligado a un ajuste de CONFIG.
  function CfgSeg({ k, title, desc, options }) {
    const cur = C.get(k);
    return h('div', { key: k, className: 'py-3 border-t border-outline-variant/40 first:border-t-0' }, [
      h('div', { key: 't', className: 'text-body font-medium text-primary' }, title),
      desc && h('div', { key: 'd', className: 'text-caption text-on-surface-variant mt-0.5 mb-2.5' }, desc),
      h('div', { key: 's', className: 'inline-flex p-1 bg-surface-container-highest rounded-lg gap-1' },
        options.map(o => h('button', {
          key: o.value,
          className: 'px-4 py-1.5 rounded-md text-caption font-semibold uppercase tracking-wider transition-colors ' +
            (cur === o.value ? 'text-primary shadow-e1' : 'text-on-surface-variant hover:text-primary'),
          style: cur === o.value ? { background: '#fff' } : null,
          onClick: () => C.setSetting(k, o.value),
        }, o.label))),
    ]);
  }

  // Logotipo de la tienda (compartido: inicio/sidebar + ticket). Se guarda como data URL
  // en CONFIG (store.logo) → persiste local y sincroniza a la nube como ajuste.
  function LogoUploader() {
    const fileRef = React.useRef(null);
    const logo = C.get('store.logo');
    function onPick(e) {
      const file = e.target.files && e.target.files[0]; e.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('Selecciona una imagen', 'var(--danger)'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 256, scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), hgt = Math.round(img.height * scale);
          const cv = document.createElement('canvas'); cv.width = w; cv.height = hgt;
          cv.getContext('2d').drawImage(img, 0, 0, w, hgt);
          C.setSetting('store.logo', cv.toDataURL('image/png'));
          toast('Logotipo actualizado', 'var(--accent)');
        };
        img.onerror = () => toast('No se pudo leer la imagen', 'var(--danger)');
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }
    return h(GlassCard, { className: 'p-6' }, [
      h(SerifHeading, { key: 't', className: 'mb-4', children: 'Logotipo' }),
      h('div', { key: 'r', className: 'flex items-center gap-6' }, [
        h('div', { key: 'pv', className: 'w-20 h-20 rounded-full overflow-hidden grid place-items-center shrink-0 border border-outline-variant', style: { background: '#131B2E' } },
          logo ? h('img', { src: logo, className: 'w-full h-full object-cover' }) : h('span', { className: 'font-headline text-2xl', style: { color: '#FFE088' } }, 'B')),
        h('div', { key: 'b', className: 'flex-1' }, [
          h('p', { key: 'd', className: 'text-caption text-on-surface-variant mb-3' }, 'Se usa en el inicio (barra lateral) y en el ticket impreso. Se ajusta a 256 px.'),
          h('input', { key: 'f', ref: fileRef, type: 'file', accept: 'image/*', className: 'hidden', onChange: onPick }),
          h('div', { key: 'btns', className: 'flex gap-3' }, [
            h('button', { key: 'u', className: 'inline-flex items-center gap-2 px-4 h-10 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition', onClick: () => fileRef.current && fileRef.current.click() }, [h(MS, { key: 'i', name: 'upload', size: 16 }), 'Subir logo']),
            logo && h('button', { key: 'x', className: 'inline-flex items-center gap-2 px-4 h-10 border border-outline-variant text-on-surface-variant text-caption font-bold uppercase tracking-widest rounded-lg hover:bg-surface-container transition', onClick: () => { C.setSetting('store.logo', ''); toast('Logotipo eliminado'); } }, [h(MS, { key: 'i', name: 'trash', size: 16 }), 'Quitar']),
          ]),
        ]),
      ]),
    ]);
  }

  // ── Paneles por sección ────────────────────────────────────────────────────────
  const PANELS = {
    negocio: () => [
      h(LogoUploader, { key: 'logo' }),
      h(GlassCard, { key: 'd', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-4', children: 'Datos de la tienda' }),
        h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-2 gap-x-6' }, [
          h(CfgText, { key: 'n', k: 'store.name', label: 'Nombre comercial' }),
          h(CfgText, { key: 'r', k: 'store.rfc', label: 'RFC' }),
          h(CfgText, { key: 'a', k: 'store.address', label: 'Dirección', wide: true }),
          h(CfgText, { key: 'p', k: 'store.phone', label: 'Teléfono' }),
        ]),
      ]),
      h(GlassCard, { key: 'm', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-4', children: 'Moneda, impuestos y folios' }),
        h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-2 gap-x-6' }, [
          h(CfgText, { key: 'c', k: 'currency', label: 'Moneda' }),
          h(CfgText, { key: 'i', k: 'tax.ivaPct', label: 'IVA (%)', type: 'number' }),
          h(CfgText, { key: 'f', k: 'folio.prefix', label: 'Prefijo de folio' }),
        ]),
        h(CfgToggle, { key: 'inc', k: 'tax.included', title: 'IVA incluido en precios', desc: 'Los precios mostrados ya incluyen el IVA' }),
      ]),
    ],
    producto: () => [
      h('p', { key: 'intro', className: 'text-caption text-on-surface-variant' }, 'Estos catálogos alimentan el SKU, el alta de productos, los filtros y la importación de Excel. El código entra al SKU: si está en uso por productos no podrás borrarlo (desactívalo).'),
      h(CatalogEditor, { key: 'cat', kind: 'category', title: 'Categorías', codePlaceholder: '21' }),
      h(CatalogEditor, { key: 'fab', kind: 'fabric', title: 'Telas', codePlaceholder: 'ALG' }),
      h(CatalogEditor, { key: 'slv', kind: 'sleeve', title: 'Mangas', codePlaceholder: 'ML' }),
      h(CatalogEditor, { key: 'nck', kind: 'neck', title: 'Cuellos', codePlaceholder: 'NOR' }),
      h(CatalogEditor, { key: 'col', kind: 'color', title: 'Colores (prenda e hilos)', codePlaceholder: 'AZ', metaFields: [{ key: 'hex', label: 'Color', type: 'color', def: '#cccccc' }] }),
      h(CatalogEditor, { key: 'orn', kind: 'ornament', title: 'Ornamentos', codePlaceholder: 'Bordado', labelPlaceholder: 'Nombre del ornamento' }),
      h(CatalogEditor, { key: 'szl', kind: 'size_letter', title: 'Tallas — escala Letra', codePlaceholder: 'M', labelPlaceholder: 'M' }),
      h(CatalogEditor, { key: 'szn', kind: 'size_number', title: 'Tallas — escala Número', codePlaceholder: '40', labelPlaceholder: '40' }),
    ],
    ventas: () => [
      h(CatalogEditor, { key: 'pm', kind: 'payment_method', title: 'Métodos de pago', codePlaceholder: 'Efectivo', labelPlaceholder: 'Efectivo', metaFields: [{ key: 'icon', label: 'Ícono', type: 'select', options: ICON_OPTS, def: 'cash' }] }),
      h(CatalogEditor, { key: 'ss', kind: 'sale_status', title: 'Estatus de venta', codePlaceholder: 'Pagado', labelPlaceholder: 'Pagado', metaFields: [{ key: 'tone', label: 'Tono', type: 'select', options: TONE_OPTS, def: 'neutral' }] }),
      h(GlassCard, { key: 'beh', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-2', children: 'Comportamiento del POS' }),
        h(CfgToggle, { key: 'sz', k: 'pos.askSize', title: 'Pedir talla al escanear', desc: 'Muestra selector de talla cuando aplica a varias' }),
        h(CfgToggle, { key: 'lay', k: 'pos.allowLayaway', title: 'Permitir apartados', desc: 'Habilita ventas con anticipo y saldo pendiente' }),
        h(CfgToggle, { key: 'cm', k: 'commission.auto', title: 'Cálculo automático de comisión', desc: 'Reparte la comisión entre los vendedores asignados' }),
        h(CfgToggle, { key: 'st', k: 'pos.validateStock', title: 'Validar existencias al vender', desc: 'Impide agregar más piezas que el stock disponible' }),
        h(CfgToggle, { key: 'so', k: 'pos.sound', title: 'Sonido al agregar al ticket', desc: 'Beep de confirmación al escanear o tocar' }),
      ]),
      h(GlassCard, { key: 'umb', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-4', children: 'Umbrales' }),
        h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-2 gap-x-6' }, [
          h(CfgText, { key: 'lo', k: 'stock.lowThreshold', label: 'Stock bajo (≤ piezas)', type: 'number' }),
          h(CfgText, { key: 'rc', k: 'client.recurrentThreshold', label: 'Cliente recurrente (≥ compras)', type: 'number' }),
        ]),
      ]),
    ],
    devoluciones: () => [
      h('p', { key: 'i', className: 'text-caption text-on-surface-variant' }, 'Catálogo de motivos que el cajero elige al devolver un artículo, y la política de comisiones. Todo se sincroniza a la nube.'),
      h(CatalogEditor, { key: 'rr', kind: 'return_reason', title: 'Motivos de devolución', codePlaceholder: 'Talla', labelPlaceholder: 'Talla errónea', hint: 'El administrador agrega aquí cualquier motivo adicional; el cajero lo selecciona por artículo en la pantalla de Devoluciones.' }),
      h(GlassCard, { key: 'pol', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-2', children: 'Política de devoluciones' }),
        h(CfgToggle, { key: 'rc', k: 'returns.reverseCommission', title: 'Revertir comisión al devolver', desc: 'Descuenta al vendedor la comisión y las ventas correspondientes a lo devuelto (proporcional, usando la base de la venta). Si lo apagas, las comisiones ya acumuladas no se tocan.' }),
        h('p', { key: 'n', className: 'text-caption text-on-surface-variant mt-3' }, 'El reingreso de stock es inmediato: al confirmar una devolución, las piezas vuelven al inventario y se asienta un movimiento "Devolución".'),
      ]),
    ],
    vendedores: () => [
      h(GlassCard, { key: 'com', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-4', children: 'Comisiones' }),
        h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-3 gap-x-6' }, [
          h(CfgText, { key: 'b', k: 'commission.basePct', label: 'Comisión base (%)', type: 'number' }),
          h(CfgText, { key: 'm', k: 'commission.monthlyGoal', label: 'Meta mensual ($)', type: 'number' }),
          h(CfgText, { key: 'o', k: 'commission.bonus', label: 'Bono al superar meta ($)', type: 'number' }),
        ]),
        h(CfgSeg, {
          key: 'base', k: 'commission.base',
          title: 'Base de cálculo de la comisión',
          desc: 'Define si el % del vendedor se aplica sobre el precio sin IVA (neto) o sobre el total cobrado con IVA (bruto). Solo afecta ventas nuevas.',
          options: [{ value: 'neto', label: 'Precio neto (sin IVA)' }, { value: 'bruto', label: 'Precio bruto (con IVA)' }],
        }),
      ]),
      h(GlassCard, { key: 'rep', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-4', children: 'Reportes' }),
        h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-2 gap-x-6' }, [
          h(CfgText, { key: 'mg', k: 'report.marginPct', label: 'Margen de utilidad (%)', type: 'number' }),
        ]),
      ]),
      h(CatalogEditor, { key: 'rol', kind: 'seller_role', title: 'Niveles / roles de vendedor', codePlaceholder: 'senior', labelPlaceholder: 'Nombre del nivel', metaFields: [{ key: 'minPct', label: '% mín.', type: 'number', def: 0 }] }),
    ],
    clientes: () => [
      h('p', { key: 'i', className: 'text-caption text-on-surface-variant' }, 'Listas que aparecen en el alta de cliente (CRM).'),
      h(CatalogEditor, { key: 'fit', kind: 'fit', title: 'Tipos de ajuste (fit)', codePlaceholder: 'Regular', labelPlaceholder: 'Regular' }),
      h(CatalogEditor, { key: 'pf', kind: 'premium_fabric', title: 'Telas premium (preferencias)', codePlaceholder: 'Lino', labelPlaceholder: 'Nombre de la tela' }),
      h(CatalogEditor, { key: 'cc', kind: 'country_code', title: 'Códigos de país', codePlaceholder: '+52', labelPlaceholder: 'México (+52)' }),
    ],
    inventario: () => [
      h(CatalogEditor, { key: 'mt', kind: 'movement_type', title: 'Tipos de movimiento', codePlaceholder: 'Entrada', labelPlaceholder: 'Entrada' }),
    ],
    impresion: () => [
      h(GlassCard, { key: 'tk', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-2', children: 'Tickets e impresión' }),
        h(CfgToggle, { key: 'au', k: 'print.auto', title: 'Imprimir ticket automáticamente', desc: 'Envía a la impresora al confirmar el cobro' }),
        h(CfgToggle, { key: 'ls', k: 'print.lowStockAlert', title: 'Alerta de stock bajo', desc: 'Notifica cuando un producto baja del umbral' }),
      ]),
      h(GlassCard, { key: 'pie', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-4', children: 'Pie de ticket' }),
        h('div', { key: 'f1', className: 'mb-4' }, [
          h('div', { key: 'l', className: 'font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest mb-1.5' }, 'Mensaje principal (cursiva)'),
          h('textarea', { key: 'ta', defaultValue: C.get('ticket.footer'), rows: 2, className: 'block w-full px-3 py-2 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary text-body rounded-lg resize-none', onBlur: e => C.setSetting('ticket.footer', e.target.value) }),
        ]),
        h('div', { key: 'f2' }, [
          h('div', { key: 'l', className: 'font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest mb-1.5' }, 'Descripción (texto pequeño)'),
          h('textarea', { key: 'ta', defaultValue: C.get('ticket.tagline'), rows: 2, className: 'block w-full px-3 py-2 bg-surface-container-low border border-outline-variant focus:ring-1 focus:ring-primary text-body rounded-lg resize-none', onBlur: e => C.setSetting('ticket.tagline', e.target.value) }),
        ]),
      ]),
    ],
    usuarios: (ctx) => {
      const roleLabel = (r) => (C.find('user_role', r) || {}).label || r;
      return [
        h(GlassCard, { key: 'c', className: 'overflow-hidden' }, [
          h('div', { key: 'h', className: 'flex items-center justify-between px-5 py-4 border-b border-outline-variant' }, [
            h(SerifHeading, { key: 't', children: 'Usuarios del sistema' }),
            h('button', { key: 'a', className: 'inline-flex items-center gap-2 px-4 h-10 bg-primary text-on-primary font-label-sm uppercase tracking-widest text-caption rounded-lg hover:opacity-90 transition', onClick: () => ctx.setAddingUser(true) }, [h(MS, { key: 'i', name: 'plus', size: 16 }), 'Agregar']),
          ]),
          h('table', { key: 'tbl', className: 'w-full' }, [
            h('thead', { key: 'h' }, h('tr', { className: 'text-left border-b border-outline-variant' }, ['Usuario', 'Rol', 'Estado', ''].map((x, i) => h('th', { key: i, className: 'px-5 py-3 font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest' }, x)))),
            h('tbody', { key: 'b', className: 'divide-y divide-outline-variant/40' }, D.sellers.map(s => h('tr', { key: s.id, className: s.active === false ? 'opacity-50' : '' }, [
              h('td', { key: 'n', className: 'px-5 py-3' }, h('div', { className: 'flex items-center gap-3' }, [
                h('span', { key: 'a', className: 'w-8 h-8 rounded-full grid place-items-center text-overline font-bold text-white', style: { background: s.color } }, s.iniciales),
                h('div', { key: 'd' }, [h('div', { key: 'nm', className: 'font-medium text-primary' }, s.nombre), s.email && h('div', { key: 'em', className: 'text-overline text-on-surface-variant' }, s.email)]),
              ])),
              h('td', { key: 'r', className: 'px-5 py-3' }, h('span', { className: 'px-2 py-1 text-overline font-bold rounded ' + (s.role === 'admin' ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container text-on-surface-variant') }, roleLabel(s.role))),
              h('td', { key: 's', className: 'px-5 py-3' }, h('span', { className: 'px-2 py-1 text-overline font-bold rounded ' + (s.active === false ? 'bg-surface-container text-on-surface-variant' : 'bg-success-soft text-success') }, s.active === false ? 'Inactivo' : 'Activo')),
              h('td', { key: 'x', className: 'px-5 py-3 text-right' }, h('div', { className: 'flex items-center justify-end gap-4' }, [
                h('button', { key: 'e', className: 'text-overline uppercase font-bold text-on-surface-variant hover:text-primary', onClick: () => ctx.setAddingUser(s) }, 'Editar'),
                h('button', { key: 'a', className: 'text-overline uppercase font-bold text-on-surface-variant hover:text-primary', onClick: () => { D.updateUser(s.id, { active: s.active === false }); ctx.refresh(); } }, s.active === false ? 'Activar' : 'Desactivar'),
              ])),
            ]))),
          ]),
          h('p', { key: 'n', className: 'px-5 py-3 text-caption text-on-surface-variant' }, 'El administrador inicia sesión con correo y contraseña; los vendedores no inician sesión (se eligen al cobrar). Autenticación robusta (RLS/Supabase Auth) = fase posterior.'),
        ]),
      ];
    },
    demo: () => [h(DemoPanel, { key: 'demo' })],
  };

  // ── Panel: datos de demostración (simulación local para pruebas) ───────────────
  function DemoPanel() {
    const [busy, setBusy] = useState(false);
    const active = D.demoActive();
    function generar() {
      if (!window.confirm('¿Generar la SIMULACIÓN de demostración?\n\nReemplaza los datos actuales por ~24 productos, 8 clientes, 4 vendedores y ~300 ventas de los últimos 90 días (con devoluciones). Todo se calcula con el motor real.\n\nEs LOCAL: NO toca tu base en la nube. Úsalo SIN iniciar sesión.')) return;
      setBusy(true);
      setTimeout(() => { const r = D.seedDemo(); toast(`Simulación lista: ${r.sales} ventas · ${r.products} productos · ${r.returns} devoluciones`, 'var(--accent)'); setTimeout(() => location.reload(), 700); }, 30);
    }
    function limpiar() {
      if (!window.confirm('¿Limpiar TODO y volver al estado vacío de producción?\n\nBorra productos, clientes, ventas, devoluciones, etc. de este dispositivo. No se puede deshacer.')) return;
      D.resetEmpty();
      toast('Datos vaciados — estado de producción', 'var(--accent)');
      setTimeout(() => location.reload(), 600);
    }
    return [
      active && h('div', { key: 'badge', className: 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gold-soft text-gold-text text-overline font-bold uppercase tracking-widest w-fit' }, [h(MS, { key: 'i', name: 'star', size: 14, fill: true }), 'Modo demostración activo']),
      h(GlassCard, { key: 'c', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-2', children: 'Simulación de datos' }),
        h('p', { key: 'd', className: 'text-body text-on-surface-variant leading-relaxed mb-5' }, 'Genera una operación ficticia completa (productos, clientes, vendedores y ~300 ventas de 90 días, con devoluciones) para PROBAR reportes, comisiones, inventario y devoluciones con números REALES — todo se calcula con el motor del sistema, nada está inventado. Ideal para demostraciones.'),
        h('div', { key: 'b', className: 'flex flex-wrap gap-3' }, [
          h('button', { key: 'g', disabled: busy, className: 'inline-flex items-center gap-2 px-5 h-11 bg-primary text-on-primary font-label-sm uppercase tracking-widest text-caption rounded-lg hover:opacity-90 transition disabled:opacity-50', onClick: generar }, [h(MS, { key: 'i', name: busy ? 'clock' : 'star', size: 16 }), busy ? 'Generando…' : 'Generar simulación']),
          h('button', { key: 'r', className: 'inline-flex items-center gap-2 px-5 h-11 border border-outline-variant text-danger font-label-sm uppercase tracking-widest text-caption rounded-lg hover:bg-danger-soft hover:border-danger/30 transition', onClick: limpiar }, [h(MS, { key: 'i', name: 'trash', size: 16 }), 'Limpiar / Resetear a vacío']),
        ]),
      ]),
      h(GlassCard, { key: 'w', className: 'p-5 border-l-4 border-l-gold' }, [
        h('div', { key: 'h', className: 'flex items-center gap-2 mb-2' }, [h(MS, { key: 'i', name: 'alert', size: 18, className: 'text-gold-text' }), h('span', { key: 't', className: 'text-overline font-bold uppercase tracking-widest text-primary' }, 'Importante')]),
        h('ul', { key: 'l', className: 'text-caption text-on-surface-variant leading-relaxed list-disc pl-5 space-y-1' }, [
          h('li', { key: '1' }, 'La simulación es LOCAL: se guarda solo en este navegador y NO se sube a tu Supabase de producción.'),
          h('li', { key: '2' }, 'Para demos, comparte la app y úsala SIN iniciar sesión (con sesión, la app podría sincronizar y mezclar datos).'),
          h('li', { key: '3' }, 'Cuando termines de probar, usa “Limpiar / Resetear a vacío” para volver al estado de producción.'),
        ]),
      ]),
    ];
  }

  // ---------- Pantalla: alta/edición de usuario (admin agrega admin o vendedor) ----------
  function NewUserForm({ user, onCancel, onSaved }) {
    const editing = !!user;
    // Roles desde el catálogo; si la nube aún no lo trae, usa un respaldo (el rol siempre se puede cambiar).
    const ROLE_FALLBACK = [
      { code: 'admin', label: 'Administrador', meta: { desc: 'Acceso total: configuración, usuarios, reportes e inventario.' } },
      { code: 'vendedor', label: 'Vendedor', meta: { desc: 'Ventas en piso, registro de clientes y stock disponible.' } },
      { code: 'gerente', label: 'Gerente', meta: { desc: 'Supervisión de tienda, aprueba descuentos y gestiona personal.' } },
    ];
    const catRoles = C.list('user_role');
    const roles = catRoles.length ? catRoles : ROLE_FALLBACK;
    const [f, setF] = useState({ nombre: user ? user.nombre : '', email: user ? (user.email || '') : '', password: '', role: user ? user.role : 'vendedor', avatar: user ? (user.avatar || '') : '' });
    const set = (k, v) => setF(p => ({ ...p, [k]: v }));
    const fileRef = React.useRef(null);
    // Foto de perfil: redimensiona a 256px y guarda como data URL (sincroniza a sellers.avatar_url).
    function onPickAvatar(e) {
      const file = e.target.files && e.target.files[0]; e.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('Selecciona una imagen', 'var(--danger)'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 256, scale = Math.min(1, max / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale), hgt = Math.round(img.height * scale);
          const cv = document.createElement('canvas'); cv.width = w; cv.height = hgt;
          cv.getContext('2d').drawImage(img, 0, 0, w, hgt);
          set('avatar', cv.toDataURL('image/png'));
          toast('Foto lista', 'var(--accent)');
        };
        img.onerror = () => toast('No se pudo leer la imagen', 'var(--danger)');
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    }

    function genPassword() {
      const cs = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
      let p = ''; for (let i = 0; i < 14; i++) p += cs[Math.floor(Math.random() * cs.length)];
      set('password', p);
      toast('Contraseña generada — cópiala antes de guardar');
    }
    async function submit() {
      if (!f.nombre.trim()) { toast('Escribe el nombre completo', 'var(--danger)'); return; }
      // Producción (hay sesión real de admin): la cuenta de acceso se gestiona vía Edge Function.
      const online = !!(window.STORE && (await window.STORE.hasSession()));
      if (online) {
        if (!f.email.trim()) { toast('El correo es obligatorio (es su usuario de acceso)', 'var(--danger)'); return; }
        if (!editing && (f.password || '').length < 6) { toast('Contraseña de al menos 6 caracteres', 'var(--danger)'); return; }
        if (editing && f.password && f.password.length < 6) { toast('La nueva contraseña debe tener al menos 6 caracteres', 'var(--danger)'); return; }
        try {
          const c = await window.STORE.getClient();
          const payload = editing
            ? { action: 'update', id: user.id, email: f.email.trim(), nombre: f.nombre.trim(), role: f.role, avatar: f.avatar || '', password: f.password || undefined }
            : { action: 'create', email: f.email.trim(), password: f.password, nombre: f.nombre.trim(), role: f.role, avatar: f.avatar || '' };
          const { data, error } = await c.functions.invoke('admin-users', { body: payload });
          if (error || (data && data.error)) { toast((data && data.error) || (error && error.message) || 'No se pudo guardar', 'var(--danger)'); return; }
          await window.STORE.pullDomain('sellers');
          toast(editing ? 'Usuario actualizado' : 'Usuario acreditado', 'var(--accent)');
          onSaved();
        } catch (e) { toast('Error: ' + (e.message || e), 'var(--danger)'); }
        return;
      }
      // Dev / local: solo perfil (sin cuenta de acceso real; el login real va en producción).
      if (editing) {
        D.updateUser(user.id, { nombre: f.nombre, email: f.email.trim() || null, role: f.role, avatar: f.avatar || null });
        toast('Usuario actualizado (local)', 'var(--accent)');
      } else {
        D.addUser({ nombre: f.nombre, email: f.email, role: f.role, avatar: f.avatar || null });
        toast('Usuario creado (local)', 'var(--accent)');
      }
      onSaved();
    }
    async function eliminar() {
      const online = !!(window.STORE && (await window.STORE.hasSession()));
      if (online) {
        try {
          const c = await window.STORE.getClient();
          const { data, error } = await c.functions.invoke('admin-users', { body: { action: 'delete', id: user.id } });
          if (error || (data && data.error)) { toast((data && data.error) || (error && error.message), 'var(--danger)'); return; }
          await window.STORE.pullDomain('sellers');
          toast('Usuario eliminado', 'var(--danger)'); onSaved();
        } catch (e) { toast('Error: ' + (e.message || e), 'var(--danger)'); }
        return;
      }
      const r = D.removeUser(user.id);
      if (!r.ok) { toast(r.error, 'var(--danger)'); return; }
      toast('Usuario eliminado', 'var(--danger)');
      onSaved();
    }

    const under = 'w-full border-0 border-b border-outline-variant bg-transparent py-3 text-body focus:border-primary focus:ring-0 px-0 transition-all';
    const lbl = 'block text-overline uppercase font-bold text-on-surface-variant tracking-widest mb-1';

    return h('div', { className: 'flex-1 overflow-y-auto bg-background font-body text-on-surface' },
      h('div', { className: 'max-w-4xl mx-auto py-10 px-8' }, [
        h('div', { key: 'bc', className: 'flex items-center gap-2 mb-6 text-on-surface-variant' }, [
          h('button', { key: 'b', className: 'text-overline uppercase tracking-widest font-semibold hover:text-primary', onClick: onCancel }, 'Usuarios'),
          h(MS, { key: 'c', name: 'chevRight', size: 14 }),
          h('span', { key: 's', className: 'text-overline uppercase tracking-widest font-semibold text-primary' }, editing ? 'Editar usuario' : 'Nuevo usuario'),
        ]),
        h(GlassCard, { key: 'card', className: 'p-10' }, [
          h('div', { key: 'av', className: 'flex items-center gap-6 pb-8 border-b border-outline-variant mb-8' }, [
            h('div', { key: 'c', className: 'relative w-24 h-24 shrink-0 group' }, [
              h('div', { key: 'box', className: 'w-24 h-24 rounded-full overflow-hidden grid place-items-center text-white font-bold text-h1 border-2 border-dashed border-outline group-hover:border-primary transition-colors', style: { background: f.avatar ? 'transparent' : (editing ? user.color : '#e6e8ea') } },
                f.avatar ? h('img', { src: f.avatar, className: 'w-full h-full object-cover' })
                  : editing ? user.iniciales
                  : h(MS, { name: 'add_a_photo', size: 32, style: { color: '#76777d' } })),
              h('input', { key: 'f', ref: fileRef, type: 'file', accept: 'image/*', className: 'absolute inset-0 opacity-0 cursor-pointer', title: 'Subir foto de perfil', onChange: onPickAvatar }),
            ]),
            h('div', { key: 't' }, [
              h(SerifHeading, { key: 'h', children: editing ? user.nombre : 'Nuevo miembro de Balam' }),
              h('p', { key: 'p', className: 'text-caption text-on-surface-variant mt-1' }, 'Haz clic en el círculo para subir una foto (JPG/PNG, se ajusta a 256 px). Sin foto = iniciales.'),
              f.avatar && h('button', { key: 'x', type: 'button', className: 'mt-2 inline-flex items-center gap-1 text-overline uppercase font-bold text-on-surface-variant hover:text-danger transition-colors', onClick: () => set('avatar', '') }, [h(MS, { key: 'i', name: 'trash', size: 14 }), 'Quitar foto']),
            ]),
          ]),
          h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-2 gap-8 mb-8' }, [
            h('div', { key: 'n' }, [h('label', { key: 'l', className: lbl }, 'Nombre completo'), h('input', { key: 'i', className: under, value: f.nombre, placeholder: 'Ej. Alejandro Valdivia', onChange: e => set('nombre', e.target.value) })]),
            h('div', { key: 'e' }, [h('label', { key: 'l', className: lbl }, 'Correo (usuario de acceso)'), h('input', { key: 'i', type: 'email', className: under, value: f.email, placeholder: 'persona@balam.com', onChange: e => set('email', e.target.value) })]),
          ]),
          h('div', { key: 'pw', className: 'mb-8 relative' }, [
            h('label', { key: 'l', className: lbl }, editing ? 'Nueva contraseña (dejar vacío = sin cambio)' : 'Contraseña de acceso'),
            h('div', { key: 'r', className: 'flex items-center gap-3' }, [
              h('input', { key: 'i', type: 'text', className: under, value: f.password, placeholder: '••••••••', onChange: e => set('password', e.target.value) }),
              h('button', { key: 'g', type: 'button', className: 'shrink-0 text-overline font-bold text-primary hover:underline whitespace-nowrap', onClick: genPassword }, 'Generar segura'),
            ]),
          ]),
          h('div', { key: 'rl' }, [
            h('label', { key: 'l', className: lbl + ' mb-3' }, 'Rol del usuario'),
            h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-3 gap-4' }, roles.map(r => {
              const on = f.role === r.code;
              return h('button', { key: r.code, type: 'button', className: 'text-left p-5 border rounded-lg transition-all ' + (on ? 'border-primary bg-primary/5' : 'border-outline-variant hover:bg-surface-container-low'), onClick: () => set('role', r.code) }, [
                h('div', { key: 't', className: 'font-headline text-h2 text-primary mb-1' }, r.label),
                h('div', { key: 'd', className: 'text-caption text-on-surface-variant leading-relaxed' }, (r.meta && r.meta.desc) || ''),
              ]);
            })),
          ]),
          h('div', { key: 'ac', className: 'flex justify-end items-center gap-6 pt-8' }, [
            editing && h('button', { key: 'd', className: 'mr-auto inline-flex items-center gap-2 text-danger text-overline font-bold uppercase tracking-widest hover:opacity-70 transition-colors', onClick: eliminar }, [h(MS, { key: 'i', name: 'trash', size: 16 }), 'Eliminar usuario']),
            h('button', { key: 'c', className: 'text-on-surface-variant text-overline font-bold uppercase tracking-widest hover:text-primary transition-colors', onClick: onCancel }, 'Cancelar'),
            h('button', { key: 's', className: 'bg-primary text-on-primary px-10 py-4 text-overline font-bold uppercase tracking-widest rounded-lg shadow-e2 hover:opacity-90 transition-all', onClick: submit }, editing ? 'Guardar cambios' : 'Crear usuario'),
          ]),
        ]),
      ]));
  }

  window.SettingsScreen = SettingsScreen;
})();
