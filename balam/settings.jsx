// settings.jsx — Módulo de Configuración (Heritage). Cataloga y parametriza TODO lo que
// antes estaba hardcodeado. Lee/escribe en window.CONFIG (balam/config.jsx), local-first.
// Exporta window.SettingsScreen
(function () {
  const { useState, useEffect, useRef } = React;
  const { toast, resizeImageFile } = window.UI;
  const { MS, GlassCard, SerifHeading } = window.HX;
  const C = window.CONFIG;
  const D = window.DATA;
  const h = React.createElement;

  const SECTIONS = [
    { id: 'negocio', label: 'Negocio', icon: 'gear' },
    { id: 'producto', label: 'Catálogos de producto', icon: 'box' },
    { id: 'ventas', label: 'Ventas y POS', icon: 'pos' },
    { id: 'beneficios', label: 'Descuentos adicionales y beneficios', icon: 'tag' },
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
            'data-testid': 'settings-section-' + s.id,
            className: 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ' +
              (sec === s.id ? 'bg-surface-container-low text-primary font-medium' : 'text-on-surface-variant hover:bg-surface-container-low'),
            onClick: () => setSec(s.id),
          }, [h(MS, { key: 'i', name: s.icon, size: 18 }), h('span', { key: 'l', className: 'text-body' }, s.label)])),
        ),
        h('div', { key: 'panel', className: 'flex flex-col gap-4 min-w-0' }, PANELS[sec](ctx)),
      ]));
  }

  // ── Campo de color: texto hex/RGB + recuadro selector, sincronizados ───────────
  // Acepta "#1A2B3C", "1A2B3C", "#ABC", "142,165,251", "142 165 251" o "rgb(142,165,251)".
  function parseColorInput(s) {
    s = String(s == null ? '' : s).trim().toLowerCase();
    let m = s.match(/^#?([0-9a-f]{6})$/);
    if (m) return '#' + m[1];
    m = s.match(/^#?([0-9a-f]{3})$/);
    if (m) return '#' + m[1].split('').map(c => c + c).join('');
    m = s.match(/^(?:rgb\s*\(\s*)?(\d{1,3})\s*[,; ]\s*(\d{1,3})\s*[,; ]\s*(\d{1,3})\s*\)?$/);
    if (m) {
      const r = +m[1], g = +m[2], b = +m[3];
      if (r > 255 || g > 255 || b > 255) return null;
      return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    }
    return null;
  }
  function ColorField({ val, title, onCommit }) {
    const [txt, setTxt] = useState(val || '');
    useEffect(() => { setTxt(val || ''); }, [val]); // el selector visual (u otro cambio) refresca el texto
    function apply() {
      const s = String(txt).trim();
      if (!s || s === val) { setTxt(val || ''); return; }
      const hex = parseColorInput(s);
      if (!hex) { toast('Color no válido — escribe #1A2B3C o 142,165,251', 'var(--danger)'); setTxt(val || ''); return; }
      setTxt(hex);
      if (hex !== val) onCommit(hex);
    }
    return h('span', { className: 'inline-flex items-center gap-1.5' }, [
      h('input', {
        key: 't', value: txt, placeholder: '#HEX o R,G,B', spellCheck: false,
        className: 'w-28 h-8 px-2 bg-surface-container-low border border-outline-variant rounded text-caption font-mono',
        title: (title ? title + ' — ' : '') + 'hexadecimal (#1A2B3C) o RGB (142,165,251); Enter para aplicar',
        onChange: e => setTxt(e.target.value),
        onKeyDown: e => { if (e.key === 'Enter') e.currentTarget.blur(); },
        onBlur: apply,
      }),
      h('input', {
        key: 'c', type: 'color', value: /^#[0-9a-f]{6}$/i.test(val || '') ? val : '#cccccc',
        className: 'w-9 h-8 rounded border border-outline-variant bg-surface cursor-pointer shrink-0',
        onChange: e => onCommit(e.target.value), title,
      }),
    ]);
  }

  // ── Editor genérico de catálogos ───────────────────────────────────────────────
  // metaFields: [{ key, label, type:'text'|'number'|'color'|'select', options? }]
  function CatalogEditor({ kind, title, hint, metaFields = [], codePlaceholder = 'CÓD', labelPlaceholder = 'Nombre visible', lockCode = false }) {
    const items = C.all(kind);
    const [code, setCode] = useState('');
    const [label, setLabel] = useState('');
    // Metadatos del catálogo (solo los catálogos de producto los tienen). null = catálogo simple.
    const cmeta = C.catalogMeta ? C.catalogMeta(kind) : null;

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
    function delCatalog() {
      if (!window.confirm('¿Eliminar el catálogo "' + (cmeta ? cmeta.label : kind) + '" y todos sus elementos? Si algún producto tiene un valor de este catálogo, se quitará (su SKU ya asignado no cambia). Esta acción no se puede deshacer.')) return;
      const r = C.removeCatalog(kind); if (!r.ok) toast(r.error, 'var(--danger)'); else toast('Catálogo eliminado', 'var(--danger)');
    }

    const metaInput = (it, f) => {
      const val = (it.meta && it.meta[f.key] != null) ? it.meta[f.key] : '';
      if (f.type === 'color') return h(ColorField, { val, title: f.label, onCommit: v => commitMeta(it, f.key, v) });
      if (f.type === 'select') return h('select', { className: 'h-8 px-2 bg-surface-container-low border border-outline-variant rounded text-caption', value: val, onChange: e => commitMeta(it, f.key, e.target.value), title: f.label }, (f.options || []).map(o => h('option', { key: o, value: o }, o)));
      if (f.type === 'number') return h('input', { type: 'number', defaultValue: val, className: 'w-16 h-8 px-2 bg-surface-container-low border border-outline-variant rounded text-caption text-right', onBlur: e => commitMeta(it, f.key, Number(e.target.value) || 0), title: f.label });
      return h('input', { defaultValue: val, placeholder: f.label, className: 'h-8 px-2 bg-surface-container-low border border-outline-variant rounded text-caption w-28', onBlur: e => commitMeta(it, f.key, e.target.value) });
    };

    const countLabel = `${items.filter(i => i.active !== false).length} activos · ${items.length} total`;
    // Píldora-interruptor (En alta / En SKU). locked = activo fijo (no se puede apagar).
    const metaPill = (txt, on, onClick, locked) => h('button', {
      key: txt, type: 'button', onClick: locked ? undefined : onClick, disabled: !!locked,
      className: 'inline-flex items-center gap-1 px-2.5 h-7 rounded-full text-overline uppercase font-bold border transition-colors ' +
        (on ? 'bg-primary text-on-primary border-primary' : 'bg-surface-container text-on-surface-variant border-outline-variant hover:border-primary') +
        (locked ? ' opacity-70 cursor-default' : ''),
      title: locked ? txt + ': fijo en este atributo' : (on ? txt + ' activo — clic para desactivar' : txt + ' inactivo — clic para activar'),
    }, [locked ? h(MS, { key: 'i', name: 'lock', size: 12 }) : null, txt]);
    // Interruptores según el tipo de catálogo:
    //   En alta → catálogos select; bloqueado-ON si son estructurales (color: swatch siempre presente).
    //   En SKU  → cualquier catálogo con código (incluido color); libre.
    const pills = [];
    const selectAttr = cmeta && (cmeta.formSelect || cmeta.custom); // se captura como menú en el alta
    if (cmeta && cmeta.formSelect) pills.push(metaPill('En alta', cmeta.inForm, () => C.setCatalogMeta(kind, { inForm: !cmeta.inForm }), cmeta.struct));
    if (cmeta && (cmeta.field || cmeta.custom || cmeta.sizeSlot)) pills.push(metaPill('En SKU', cmeta.inSku, () => C.setCatalogMeta(kind, { inSku: !cmeta.inSku })));
    if (selectAttr) pills.push(metaPill('Obligatorio', !!cmeta.required, () => C.setCatalogMeta(kind, { required: !cmeta.required })));
    if (selectAttr) pills.push(metaPill('Filtrable', !!cmeta.filterable, () => C.setCatalogMeta(kind, { filterable: !cmeta.filterable })));
    const structNote = (cmeta && cmeta.struct && !cmeta.field)
      ? h('span', { key: 'st', className: 'inline-flex items-center gap-1.5 text-overline uppercase text-on-surface-variant/70' }, [h(MS, { key: 'i', name: 'lock', size: 13 }), 'Atributo estructural (matriz de stock)'])
      : null;
    // Encabezado: editable + toggles si es catálogo de producto; estático si no.
    const header = cmeta
      ? h('div', { key: 'h', className: 'mb-3' }, [
          h('div', { key: 'tr', className: 'flex items-center justify-between gap-3 mb-2' }, [
            h('div', { key: 'l', className: 'flex items-center gap-2 flex-1 min-w-0' }, [
              cmeta.system && h(MS, { key: 'lk', name: 'lock', size: 14, className: 'text-on-surface-variant/60 shrink-0', title: 'Catálogo del sistema: se puede renombrar y editar, pero no borrar.' }),
              h('input', { key: 'nm', defaultValue: cmeta.label, title: 'Nombre del catálogo', className: 'flex-1 min-w-0 font-headline text-h2 text-primary bg-transparent border-b border-transparent hover:border-outline-variant focus:border-primary focus:ring-0 px-0 py-0.5', onBlur: e => C.setCatalogMeta(kind, { label: e.target.value }) }),
            ]),
            h('div', { key: 'c', className: 'flex items-center gap-3 shrink-0' }, [
              h('span', { key: 'n', className: 'text-overline uppercase text-on-surface-variant' }, countLabel),
              cmeta.custom && h('button', { key: 'dc', type: 'button', className: 'inline-flex items-center gap-1 text-overline uppercase font-bold text-danger hover:opacity-70 transition-opacity', title: 'Eliminar este catálogo', onClick: delCatalog }, [h(MS, { key: 'i', name: 'trash', size: 14 }), 'Catálogo']),
            ]),
          ]),
          (pills.length || structNote) && h('div', { key: 'tg', className: 'flex items-center gap-2 flex-wrap' }, pills.concat(structNote || [])),
        ])
      : h('div', { key: 'h', className: 'flex items-baseline justify-between mb-1' }, [
          h(SerifHeading, { key: 't', children: title }),
          h('span', { key: 'c', className: 'text-overline uppercase text-on-surface-variant' }, countLabel),
        ]);

    return h(GlassCard, { key: kind, className: 'p-5' }, [
      header,
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

  // ── Constructor de SKU ─────────────────────────────────────────────────────────
  // Muestra los catálogos con "En SKU" como segmentos ordenables (◀ ▶) + el número de
  // modelo fijo al final, con vista previa en vivo. Reordena vía CONFIG.moveSkuOrder.
  function SkuBuilder() {
    const parts = C.skuParts();
    function regenerar() {
      const n = (D.products || []).length;
      if (!n) { toast('No hay productos que regenerar'); return; }
      if (!window.confirm('¿Regenerar el SKU de ' + n + ' producto(s) con la receta actual?\n\n⚠ El SKU es el identificador del producto. Las ventas, devoluciones y movimientos YA registrados seguirán apuntando al SKU anterior, por lo que podrían dejar de vincularse con el producto en reportes. Úsalo solo durante la configuración inicial, antes de tener ventas reales.\n\nEsta acción no se puede deshacer.')) return;
      const r = D.regenerateSkus();
      toast(r.changed + ' de ' + r.total + ' SKUs actualizados', 'var(--accent)');
    }
    const sampleCode = (kind) => {
      const m = C.catalogMeta(kind);
      if (m && m.sizeSlot) return (window.DATA && window.DATA.SIZE_MARK) || 'T'; // marcador; la etiqueta lo cambia por la talla
      const l = C.list(kind); return l.length ? l[0].code : '??';
    };
    const preview = parts.map(p => sampleCode(p.kind)).join('-');
    // El catálogo "Modelo" no cuenta como oculto: está cableado al campo Nombre / Modelo del alta.
    const modeloK = C.modeloKind ? C.modeloKind() : null;
    const hidden = parts.filter(x => x.kind !== modeloK).map(p => C.catalogMeta(p.kind)).filter(m => m && m.formSelect && !m.inForm);
    const sizeMark = (window.DATA && window.DATA.SIZE_MARK) || 'T';
    const hasSize = parts.some(p => { const m = C.catalogMeta(p.kind); return m && m.sizeSlot; });
    const chip = (p, i) => h('div', { key: p.kind, className: 'inline-flex items-center rounded-lg border border-outline-variant bg-surface-container-low overflow-hidden' }, [
      h('button', { key: 'l', className: 'w-7 h-9 grid place-items-center hover:bg-surface-container text-on-surface-variant disabled:opacity-30', disabled: i === 0, title: 'Mover a la izquierda', onClick: () => C.moveSkuOrder(p.kind, -1) }, h(MS, { name: 'chevRight', size: 14, style: { transform: 'rotate(180deg)' } })),
      h('span', { key: 't', className: 'px-2 text-caption font-semibold text-primary whitespace-nowrap' }, C.catalogLabel(p.kind)),
      h('button', { key: 'r', className: 'w-7 h-9 grid place-items-center hover:bg-surface-container text-on-surface-variant disabled:opacity-30', disabled: i === parts.length - 1, title: 'Mover a la derecha', onClick: () => C.moveSkuOrder(p.kind, 1) }, h(MS, { name: 'chevRight', size: 14 })),
    ]);
    return h(GlassCard, { key: 'skubuilder', className: 'p-5' }, [
      h('div', { key: 'h', className: 'flex items-baseline justify-between mb-1' }, [
        h(SerifHeading, { key: 't', children: 'Constructor de SKU' }),
        h('span', { key: 'c', className: 'text-overline uppercase text-on-surface-variant' }, parts.length + ' segmentos'),
      ]),
      h('p', { key: 'd', className: 'text-caption text-on-surface-variant mb-4' }, 'Activa “En SKU” en cada catálogo para incluirlo y reordena con ◀ ▶. El SKU se fija al crear el producto: cambiar la receta solo afecta a productos nuevos.'),
      h('div', { key: 'chips', className: 'flex flex-wrap items-center gap-2 mb-4' }, parts.map(chip)),
      h('div', { key: 'pv', className: 'flex items-center gap-2 flex-wrap' }, [
        h('span', { key: 'l', className: 'text-overline uppercase tracking-widest text-on-surface-variant' }, 'Vista previa'),
        h('span', { key: 'v', className: 'font-mono text-body text-gold-text' }, preview),
      ]),
      hasSize ? h('div', { key: 'szn', className: 'mt-2 flex items-start gap-2 text-caption text-on-surface-variant' }, [
        h(MS, { key: 'i', name: 'barcode', size: 15, className: 'text-on-surface-variant/70 shrink-0 mt-0.5' }),
        h('span', { key: 't' }, `“${sizeMark}” marca la posición de la Talla (Número): el SKU del modelo la muestra así, y cada etiqueta/código de barras la reemplaza por la talla real (p. ej. ${sizeMark}→38).`),
      ]) : null,
      hidden.length ? h('div', { key: 'w', className: 'mt-3 flex items-start gap-2 text-caption text-on-surface-variant bg-gold/5 border border-gold/30 rounded-lg p-3' }, [
        h(MS, { key: 'i', name: 'alert', size: 16, className: 'text-gold-text shrink-0 mt-0.5' }),
        h('span', { key: 't' }, 'En el SKU pero oculto del alta: ' + hidden.map(m => m.label).join(', ') + '. Los productos nuevos no podrán elegir ese valor.'),
      ]) : null,
      // Regenerar SKUs de productos existentes (el SKU está congelado al crear).
      h('div', { key: 'rg', className: 'mt-4 pt-4 border-t border-outline-variant/60 flex items-center justify-between gap-3 flex-wrap' }, [
        h('p', { key: 't', className: 'text-caption text-on-surface-variant max-w-md' }, 'El SKU se fija al crear cada producto. Si cambiaste la receta y quieres aplicarla a los productos ya existentes, regenéralos (afecta el historial — úsalo en configuración inicial).'),
        h('button', { key: 'b', type: 'button', className: 'inline-flex items-center gap-2 px-4 h-10 border border-danger/40 text-danger text-caption font-bold uppercase tracking-widest rounded-lg hover:bg-danger-soft transition shrink-0', onClick: regenerar }, [h(MS, { key: 'i', name: 'repeat', size: 16 }), 'Regenerar SKUs']),
      ]),
    ]);
  }

  // ── Diagnóstico de catálogos: códigos huérfanos y nombres repetidos ───────────
  // Radiografía en vivo (se recalcula con cada configchange vía el bump de SettingsScreen):
  // muestra QUÉ productos apuntan a códigos que ya no existen en el catálogo y POR QUÉ no se
  // re-vincularon solos (nombre repetido entre dos códigos activos, o sin equivalente).
  // Distancia RGB entre dos #hex (para SUGERIR el color activo más parecido a la muestra vieja).
  function hexDist(a, b) {
    const px = (h) => { const m = String(h || '').toLowerCase().match(/^#?([0-9a-f]{6})$/); return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)) : null; };
    const A = px(a), B = px(b);
    if (!A || !B) return Infinity;
    return Math.sqrt(Math.pow(A[0] - B[0], 2) + Math.pow(A[1] - B[1], 2) + Math.pow(A[2] - B[2], 2));
  }
  // Selector + Aplicar de una fila pendiente del Diagnóstico. Para color, pre-sugiere el activo
  // con la muestra más parecida a la del código viejo (el admin confirma; nada se aplica solo).
  function FixControl({ o, onDone }) {
    const opts = C.list(o.kind);
    let best = '';
    if ((o.kind === 'color') && o.oldHex) {
      let bd = Infinity;
      opts.forEach(x => { const d = hexDist(o.oldHex, x.meta && x.meta.hex); if (d < bd) { bd = d; best = x.code; } });
    }
    const [sel, setSel] = useState(best);
    function apply() {
      const r = D.applyOrphanFix(o.id, o.campo, o.code, sel);
      if (!r.ok) { toast(r.error, 'var(--danger)'); return; }
      toast('Producto corregido', 'var(--accent)');
      onDone();
    }
    return h('span', { className: 'inline-flex items-center gap-1.5' }, [
      h('select', { key: 's', className: 'h-8 px-2 bg-surface-container-low border border-outline-variant rounded text-caption max-w-[180px]', value: sel, onChange: e => setSel(e.target.value), title: best ? 'Sugerido por parecido de la muestra de color' : 'Elige el valor correcto' }, [
        h('option', { key: '', value: '' }, 'Elige…'),
        ...opts.map(x => h('option', { key: x.code, value: x.code }, x.label + ' (' + x.code + ')')),
      ]),
      h('button', { key: 'b', type: 'button', disabled: !sel, className: 'px-3 h-8 bg-primary text-on-primary text-overline font-bold uppercase tracking-widest rounded disabled:opacity-40 hover:opacity-90 transition', onClick: apply }, 'Aplicar'),
    ]);
  }
  function CatalogHealthCard() {
    const [, setTick] = useState(0); // re-render tras aplicar una corrección (no emite configchange)
    const rep = D.catalogHealthReport();
    const campoLabel = (o) => o.campo === 'ornColors' ? C.catalogLabel('color') + ' (hilos bordado)' : C.catalogLabel(o.kind);
    if (!rep.orphans.length && !rep.duplicates.length) {
      return h(GlassCard, { key: 'health', className: 'p-5' }, h('div', { className: 'flex items-center gap-2' }, [
        h(MS, { key: 'i', name: 'check', size: 18, className: 'text-success' }),
        h('span', { key: 't', className: 'text-body font-semibold text-success' }, 'Catálogos sanos: ningún producto con códigos huérfanos ni nombres repetidos.'),
      ]));
    }
    return h(GlassCard, { key: 'health', className: 'p-5 border border-warning/40' }, [
      h('div', { key: 'h', className: 'flex items-center gap-2 mb-1' }, [
        h(MS, { key: 'i', name: 'alert', size: 18, className: 'text-warning' }),
        h(SerifHeading, { key: 't', children: 'Diagnóstico de catálogos' }),
      ]),
      h('p', { key: 'd', className: 'text-caption text-on-surface-variant mb-3' }, 'Estos productos apuntan a códigos que ya no existen en el catálogo (el aviso "⚠ ya no existe" al editar). El sistema los reconecta solo cuando encuentra UN nombre igual; aquí se explica qué lo impide y cómo destrabarlo.'),
      // Nombres repetidos: la causa #1 de que la reconexión automática no proceda.
      rep.duplicates.length ? h('div', { key: 'dup', className: 'mb-4 border border-danger/40 bg-danger-soft rounded-lg p-3' }, [
        h('p', { key: 't', className: 'text-caption font-bold text-danger uppercase tracking-widest mb-2' }, 'Nombres repetidos en el catálogo (corrige esto primero)'),
        ...rep.duplicates.map((d, i) => h('p', { key: i, className: 'text-body text-on-surface mb-1' },
          `${C.catalogLabel(d.kind)}: "${d.label}" lo tienen ${d.codes.length} códigos (${d.codes.join(', ')}). Renombra o desactiva los que sobren en el catálogo de abajo; al guardar, los productos pendientes se reconectan solos.`)),
      ]) : null,
      rep.orphans.length ? h('div', { key: 'orp', className: 'border border-outline-variant rounded-lg overflow-hidden' }, [
        h('div', { key: 'sc', className: 'overflow-x-auto max-h-96 overflow-y-auto' }, h('table', { className: 'w-full' }, [
          h('thead', { key: 'h', className: 'sticky top-0 bg-surface' }, h('tr', { className: 'border-b border-outline-variant' },
            ['Producto', 'Campo', 'Código viejo', 'Nombre que tenía', 'Situación', 'Corregir aquí'].map((c, i) =>
              h('th', { key: i, className: 'px-3 py-2 text-overline font-semibold text-on-surface-variant uppercase tracking-widest text-left' }, c)))),
          h('tbody', { key: 'b', className: 'divide-y divide-outline-variant' }, rep.orphans.map((o) => h('tr', { key: o.id + '|' + o.campo + '|' + o.code }, [
            h('td', { key: 'p', className: 'px-3 py-2 text-body text-primary font-medium' }, o.producto || o.sku),
            h('td', { key: 'k', className: 'px-3 py-2 text-caption text-on-surface-variant' }, campoLabel(o)),
            h('td', { key: 'c', className: 'px-3 py-2 text-overline font-mono' }, o.code),
            h('td', { key: 'n', className: 'px-3 py-2 text-caption' }, [
              o.oldHex ? h('span', { key: 'd', className: 'inline-block w-3 h-3 rounded-full border border-outline-variant mr-1.5 align-middle', style: { background: o.oldHex }, title: o.oldHex }) : null,
              o.oldLabel || (o.oldHex ? '(solo muestra de color)' : '(ya no está en el catálogo)'),
            ]),
            h('td', { key: 's', className: 'px-3 py-2 text-caption ' + (o.candidates.length > 1 ? 'text-danger' : 'text-on-surface-variant') },
              o.candidates.length > 1
                ? `Nombre repetido: ${o.candidates.length} candidatos (${o.candidates.join(', ')}) — corrige el catálogo arriba`
                : o.candidates.length === 1
                  ? `Se reconectará solo a ${o.candidates[0]} al guardar cualquier cambio de catálogo`
                  : 'Sin equivalente automático — usa "Corregir aquí"'),
            h('td', { key: 'f', className: 'px-3 py-2' }, h(FixControl, { o, onDone: () => setTick(t => t + 1) })),
          ]))),
        ])),
        h('p', { key: 'n', className: 'text-overline text-on-surface-variant px-3 py-2 bg-surface-container/40' }, `${rep.orphans.length} referencia(s) pendiente(s) en total`),
      ]) : null,
    ]);
  }

  // ── Números de color (#) por nombre ───────────────────────────────────────────
  // Cuando la columna HEX del Excel llegó desfasada (o una clave heredó el # de otro color),
  // este botón asigna a cada color ACTIVO el # canónico según su NOMBRE (D.hexForColorName).
  // Aplica todo en UN solo emit (vía importCatalogs, que fusiona meta por código y conserva
  // orden y activos); los nombres no reconocidos no se tocan y se listan para ajuste manual.
  function ColorHexFixCard() {
    const [unknown, setUnknown] = useState(null); // nombres no reconocidos del último ajuste
    function run() {
      const items = C.all('color');
      if (!items.filter(it => it.active !== false).length) { toast('No hay colores activos', 'var(--danger)'); return; }
      if (!window.confirm('Se asignará a cada color ACTIVO el # que corresponde a su NOMBRE (se sobrescribe el # actual). Los nombres no reconocidos no se tocan. ¿Aplicar?')) return;
      let fixed = 0; const un = [];
      const rows = items.map(it => {
        const r = { code: it.code, label: it.label, active: it.active !== false };
        if (it.active !== false) {
          const hx = D.hexForColorName(it.label);
          if (hx) { r.meta = { hex: hx }; fixed++; } else un.push(it.label);
        }
        return r;
      });
      C.importCatalogs({ color: rows });
      setUnknown(un);
      toast(`${fixed} color(es) con # corregido por nombre` + (un.length ? ` — ${un.length} sin reconocer` : ''), 'var(--accent)');
    }
    return h(GlassCard, { key: 'colhex', className: 'p-5' }, [
      h('div', { key: 'r', className: 'flex items-center justify-between gap-4 flex-wrap' }, [
        h('div', { key: 't', className: 'flex-1 min-w-[240px]' }, [
          h(SerifHeading, { key: 'h', children: 'Números de color (#)' }),
          h('p', { key: 'd', className: 'text-caption text-on-surface-variant mt-1' }, 'Si los # quedaron desfasados (p. ej. tras importar un Excel), este botón asigna a cada color activo el # que corresponde a su nombre. Los nombres que no se reconozcan se listan para que los ajustes con el selector visual del catálogo de arriba.'),
        ]),
        h('button', { key: 'b', type: 'button', className: 'inline-flex items-center gap-2 px-4 h-10 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition shrink-0', onClick: run }, [h(MS, { key: 'i', name: 'edit', size: 16 }), 'Corregir # por nombre']),
      ]),
      unknown && (unknown.length
        ? h('div', { key: 'un', className: 'mt-3 border border-warning/40 bg-warning-soft rounded-lg p-3' }, [
            h('p', { key: 't', className: 'text-caption font-bold text-warning uppercase tracking-widest mb-2' }, 'Nombres no reconocidos — ajusta su # a mano con el selector visual'),
            h('div', { key: 'g', className: 'flex flex-wrap gap-1.5' }, unknown.map((n, i) => h('span', { key: i, className: 'px-2 py-0.5 bg-surface rounded text-caption border border-outline-variant' }, n))),
          ])
        : h('p', { key: 'ok', className: 'mt-3 text-caption font-semibold text-success' }, 'Todos los colores activos quedaron con su # correspondiente.')),
    ]);
  }

  // ── Exportar / importar TODOS los catálogos de producto como Excel ─────────────
  // Una hoja por catálogo (nombre visible del catálogo): CÓDIGO · NOMBRE · ACTIVO (+ HEX en color).
  // Importar aplica cambios masivos vía CONFIG.importCatalogs (upsert por código; el orden del
  // archivo manda; lo que no venga se desactiva, nunca se borra).
  function CatalogXlsxCard() {
    const fileRef = useRef(null);
    const [diag, setDiag] = useState(null); // { title, lines } — diagnóstico cuando el import no procede
    const kinds = () => Object.keys(C.allCatalogMeta ? C.allCatalogMeta() : {});
    const sheetName = (kind) => String(C.catalogLabel(kind)).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31).trim();
    // Comparación tolerante: minúsculas y sin acentos ("Categoría" ≡ "categoria" ≡ "CATEGORIA").
    const norm = (s) => String(s == null ? '' : s).trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    function doExport() {
      const X = window.XLSX;
      if (!X) { toast('No se pudo cargar el motor de Excel', 'var(--danger)'); return; }
      const wb = X.utils.book_new();
      kinds().forEach(kind => {
        const rows = C.all(kind).map(it => {
          const r = { 'CÓDIGO': it.code, 'NOMBRE': it.label, 'ACTIVO': it.active === false ? 'NO' : 'SI' };
          if (kind === 'color') r['HEX'] = (it.meta && it.meta.hex) || '';
          return r;
        });
        const ws = X.utils.json_to_sheet(rows.length ? rows : [{ 'CÓDIGO': '', 'NOMBRE': '', 'ACTIVO': '' }]);
        X.utils.book_append_sheet(wb, ws, sheetName(kind));
      });
      X.writeFile(wb, 'catalogos-balam.xlsx', { bookType: 'xlsx' });
      toast('Excel de catálogos descargado', 'var(--accent)');
    }
    // 'SI'/'NO' (y variantes) → boolean; celda vacía → null (conserva el estado actual).
    function parseActive(v) {
      const s = String(v == null ? '' : v).trim().toLowerCase();
      if (!s) return null;
      return !['no', '0', 'false', 'off', 'inactivo'].includes(s);
    }
    function doImport(e) {
      const file = e.target.files && e.target.files[0]; e.target.value = '';
      if (!file) return;
      const X = window.XLSX;
      const IO = window.XLSXIO;
      if (!X || !IO) { toast('No se pudo cargar el motor de Excel', 'var(--danger)'); return; }
      IO.readWorkbook(file).then(wb => {
        // Hoja → kind: por el nombre visible del catálogo o por su kind interno,
        // sin distinguir mayúsculas ni acentos ("categoria" también vale).
        const byName = {};
        kinds().forEach(k => { byName[norm(sheetName(k))] = k; byName[norm(k)] = k; });
        const map = {}; const ignored = [];
        wb.SheetNames.forEach(sn => {
          const kind = byName[norm(sn)];
          if (!kind) { ignored.push(sn); return; }
          map[kind] = IO.sheetToJson(wb.Sheets[sn], { defval: '' }).map(r => {
            // Encabezados tolerantes: "CÓDIGO" ≡ "Codigo" ≡ "código", etc.
            const pick = (...names) => { for (const k of Object.keys(r)) { if (names.includes(norm(k)) && r[k] != null && String(r[k]).trim() !== '') return r[k]; } return ''; };
            const row = { code: pick('codigo', 'code'), label: pick('nombre', 'etiqueta', 'label') };
            const act = parseActive(pick('activo', 'active'));
            if (act != null) row.active = act;
            const hex = String(pick('hex')).trim();
            if (kind === 'color' && hex) row.meta = { hex: hex[0] === '#' ? hex : '#' + hex };
            return row;
          });
        });
        // Plan B: el Excel de INVENTARIO trae una hoja "Catálogos" (guía de códigos por secciones:
        // "CATEGORÍA (col. Categoría)" → filas código·nombre). Si ninguna hoja coincidió por nombre,
        // intenta leer los catálogos desde esa guía para que ese archivo también sirva aquí.
        let guideMode = false;
        if (!Object.keys(map).length) {
          const guideSn = wb.SheetNames.find(sn => norm(sn) === 'catalogos');
          if (guideSn) {
            // Secciones del sistema con nombre fijo en la guía (aunque el catálogo esté renombrado).
            const SYS = { categoria: 'category', manga: 'sleeve', tela: 'fabric', cuello: 'neck', color: 'color' };
            const aoa = IO.sheetToJson(wb.Sheets[guideSn], { header: 1, defval: '' });
            let cur = null;
            aoa.forEach(row => {
              const a = String(row[0] == null ? '' : row[0]).trim();
              if (!a) return; // fila en blanco entre secciones
              const hdr = a.match(/^(.+?)\s*\(cols?\.\s*[^)]*\)\s*$/i); // "TELA (col. Tela)" → TELA
              if (hdr) { const n = norm(hdr[1]); cur = SYS[n] || byName[n] || null; return; }
              if (norm(a) === 'notas' || norm(a).indexOf('catalogo de codigos') === 0 || a[0] === '•') { cur = null; return; }
              if (!cur) return;
              const label = String(row[1] == null ? '' : row[1]).trim();
              (map[cur] = map[cur] || []).push({ code: a, label: label || a });
            });
            guideMode = Object.keys(map).length > 0;
          }
        }
        // Diagnóstico: ninguna hoja coincide con un catálogo → explica el porqué en detalle.
        if (!Object.keys(map).length) {
          const expected = kinds().map(sheetName).join(', ');
          const isInventario = wb.SheetNames.some(sn => norm(sn) === 'inventario');
          setDiag(isInventario ? {
            title: 'Este archivo es un Excel de INVENTARIO, no de catálogos',
            lines: [
              `Hojas del archivo: ${wb.SheetNames.join(', ')}. Ese formato lo generan los botones Exportar/Plantilla de la pantalla Inventario (productos y existencias); su hoja "Catálogos" es solo una guía de códigos, no es editable.`,
              'Si quieres actualizar productos y existencias, impórtalo con el botón Importar de la pantalla Inventario.',
              `Si quieres editar los catálogos en bloque, usa el botón Exportar de ESTA tarjeta (descarga catalogos-balam.xlsx con una pestaña por catálogo: ${expected}), edítalo sin renombrar pestañas y vuelve a importarlo aquí.`,
            ],
          } : {
            title: 'El archivo no contiene hojas de catálogos reconocibles',
            lines: [
              `Hojas encontradas: ${wb.SheetNames.join(', ') || '(ninguna)'}.`,
              `Se esperaba al menos una hoja con el nombre de un catálogo: ${expected} (mayúsculas y acentos no importan).`,
              'Usa el botón Exportar de esta tarjeta para descargar el archivo con el formato correcto, edítalo sin renombrar las pestañas y vuelve a importarlo.',
            ],
          });
          toast('No se pudo importar — revisa el detalle en la tarjeta', 'var(--danger)');
          return;
        }
        if (!window.confirm(guideMode
          ? 'Este es un Excel de INVENTARIO: los catálogos se leerán de su hoja "Catálogos" (guía de códigos). El orden del archivo manda y los códigos que no vengan se DESACTIVAN (no se borran). OJO: esto NO importa productos ni existencias — eso se hace con el botón Importar de la pantalla Inventario. ¿Aplicar?'
          : '¿Aplicar el Excel a los catálogos? El orden del archivo manda y los códigos que no vengan en él se DESACTIVAN (no se borran).')) return;
        const r = C.importCatalogs(map);
        // Hojas reconocidas pero ninguna fila con CÓDIGO → suele ser un encabezado distinto o filas de título arriba.
        if (!r.kinds) {
          setDiag({
            title: 'Se reconocieron las hojas, pero ninguna fila tiene CÓDIGO',
            lines: [
              `Hojas reconocidas: ${Object.keys(map).map(sheetName).join(', ')}.`,
              'La PRIMERA fila de cada hoja debe ser el encabezado, con columnas CÓDIGO y NOMBRE (ACTIVO opcional: SI/NO; HEX solo en Color).',
              'Revisa que no haya filas de título arriba del encabezado y que la columna CÓDIGO no esté vacía.',
            ],
          });
          toast('No se pudo importar — revisa el detalle en la tarjeta', 'var(--danger)');
          return;
        }
        setDiag(null);
        // El configchange del import ya corrió la re-vinculación por nombre (data.jsx): si el
        // archivo re-codificó catálogos, los productos se remapearon solos — repórtalo aquí.
        const rm = (window.DATA && window.DATA.lastRemap) || { fixed: 0, orphans: 0 };
        const extra = (rm.fixed || rm.orphans)
          ? ` · productos: ${rm.fixed} re-vinculado(s) por nombre${rm.orphans ? `, ${rm.orphans} sin equivalente (revísalos al editar)` : ''}`
          : '';
        toast((guideMode
          ? `Importado desde la hoja "Catálogos" del Excel de Inventario: ${r.kinds} catálogo(s), ${r.items} elemento(s)`
          : `Importado: ${r.kinds} catálogo(s), ${r.items} elemento(s)` + (ignored.length ? ` — hojas ignoradas: ${ignored.join(', ')}` : '')) + extra, 'var(--accent)');
      }).catch(err => {
        toast((err && err.message) || 'No se pudo leer el archivo', 'var(--danger)');
      });
    }
    return h(GlassCard, { key: 'catxlsx', className: 'p-5' }, [
      h('div', { key: 'r', className: 'flex items-center justify-between gap-4 flex-wrap' }, [
        h('div', { key: 't', className: 'flex-1 min-w-[240px]' }, [
          h(SerifHeading, { key: 'h', children: 'Catálogos en Excel' }),
          h('p', { key: 'd', className: 'text-caption text-on-surface-variant mt-1' }, 'Exporta todos los catálogos (una hoja por catálogo: código, nombre, activo) para editarlos en bloque y vuelve a importarlos. Al importar, el orden del archivo manda; los códigos que no vengan se desactivan (no se borran).'),
        ]),
        h('div', { key: 'b', className: 'flex items-center gap-2 shrink-0' }, [
          h('button', { key: 'ex', type: 'button', className: 'inline-flex items-center gap-2 px-4 h-10 border border-outline-variant text-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:border-primary hover:bg-surface-container transition', onClick: doExport }, [h(MS, { key: 'i', name: 'download', size: 16 }), 'Exportar']),
          h('input', { key: 'f', ref: fileRef, type: 'file', accept: '.xlsx,.xls', className: 'hidden', onChange: doImport }),
          h('button', { key: 'im', type: 'button', className: 'inline-flex items-center gap-2 px-4 h-10 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition', onClick: () => fileRef.current && fileRef.current.click() }, [h(MS, { key: 'i', name: 'upload', size: 16 }), 'Importar']),
        ]),
      ]),
      // Diagnóstico del último intento de importación fallido (persiste hasta cerrarlo o importar bien).
      diag ? h('div', { key: 'diag', className: 'mt-4 border border-danger/40 bg-danger-soft rounded-lg p-4' }, [
        h('div', { key: 'h', className: 'flex items-start justify-between gap-3' }, [
          h('div', { key: 't', className: 'flex items-center gap-2 text-body font-semibold text-danger' }, [h(MS, { key: 'i', name: 'alert', size: 18 }), diag.title]),
          h('button', { key: 'x', type: 'button', className: 'text-caption font-bold uppercase tracking-widest text-on-surface-variant hover:text-primary shrink-0', onClick: () => setDiag(null) }, 'Cerrar'),
        ]),
        h('ul', { key: 'l', className: 'mt-2 space-y-1.5 list-disc pl-5 text-caption text-on-surface-variant' }, diag.lines.map((t, i) => h('li', { key: i }, t))),
      ]) : null,
    ]);
  }

  // ── Crear catálogo nuevo (Fase 2) ───────────────────────────────────────────────
  function NewCatalogCard() {
    const [name, setName] = useState('');
    function create() {
      const r = C.addCatalog(name);
      if (!r.ok) { toast(r.error, 'var(--danger)'); return; }
      setName('');
      toast('Catálogo creado — agrega sus elementos y actívalo en alta/SKU', 'var(--accent)');
    }
    return h(GlassCard, { key: 'newcat', className: 'p-5 border border-dashed border-outline-variant' }, [
      h(SerifHeading, { key: 't', children: 'Crear catálogo nuevo' }),
      h('p', { key: 'd', className: 'text-caption text-on-surface-variant mt-1 mb-3' }, 'Crea tu propio catálogo (p. ej. Temporada, Colección, Estilo). Después agrega sus elementos y decide si aparece en el alta de producto y/o forma parte del SKU.'),
      h('div', { key: 'r', className: 'flex items-center gap-2' }, [
        h('input', { key: 'i', value: name, placeholder: 'Nombre del catálogo', className: 'flex-1 min-w-0 h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg text-body', onChange: e => setName(e.target.value), onKeyDown: e => { if (e.key === 'Enter') create(); } }),
        h('button', { key: 'b', className: 'inline-flex items-center gap-1.5 px-5 h-10 bg-primary text-on-primary text-caption font-bold uppercase tracking-widest rounded-lg hover:opacity-90 transition', onClick: create }, [h(MS, { key: 'i', name: 'plus', size: 16 }), 'Crear']),
      ]),
    ]);
  }

  // ── Controles de ajustes (parámetros sueltos) ──────────────────────────────────
  function CfgText({ k, label, hint, type = 'text', wide, min, max }) {
    const v = C.get(k);
    return h('div', { key: k, className: 'mb-4 ' + (wide ? 'col-span-2' : '') }, [
      h('div', { key: 'l', className: 'font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest mb-1.5' }, label),
      h('input', {
        key: 'in', type, min, max, defaultValue: v, className: INPUT,
        onBlur: e => {
          let next = type === 'number' ? (Number(e.target.value) || 0) : e.target.value;
          if (type === 'number' && min != null) next = Math.max(Number(min), next);
          if (type === 'number' && max != null) next = Math.min(Number(max), next);
          if (type === 'number') e.target.value = next;
          C.setSetting(k, next);
        },
      }),
      hint && h('div', { key: 'h', className: 'text-caption text-on-surface-variant mt-1' }, hint),
    ]);
  }
  // Prefijo del folio comercial (H-33). Normaliza con la MISMA autoridad que genera
  // el folio (DATA.normalizeFolioPrefix) y muestra el resultado real de hoy. Cambiarlo
  // sólo afecta a las ventas siguientes: el folio se copia dentro de la venta al crearla.
  function FolioPrefixField() {
    const guardado = C.get('folio.prefix');
    const norm = (v) => (D.normalizeFolioPrefix ? D.normalizeFolioPrefix(v) : String(v || 'BG').toUpperCase());
    const [pref, setPref] = useState(norm(guardado));
    const vista = D.folioPreview ? D.folioPreview(pref) : pref;
    return h('div', { key: 'folio', className: 'mb-4' }, [
      h('div', { key: 'l', className: 'font-label-sm text-label-sm text-on-surface-variant uppercase tracking-widest mb-1.5' }, 'Prefijo de folio'),
      h('input', {
        key: 'in', type: 'text', maxLength: 6, defaultValue: pref, className: INPUT,
        onChange: e => setPref(norm(e.target.value)),
        onBlur: e => {
          const next = norm(e.target.value);
          e.target.value = next;
          setPref(next);
          if (next !== guardado) C.setSetting('folio.prefix', next);
        },
      }),
      h('div', { key: 'p', className: 'text-caption text-on-surface-variant mt-1' }, [
        h('span', { key: 'a' }, 'Así se verá hoy: '),
        h('span', { key: 'b', className: 'font-medium text-primary' }, vista),
      ]),
      h('div', { key: 'h', className: 'text-caption text-on-surface-variant mt-0.5' },
        'Hasta 6 letras o números. El folio es PREFIJO-AAMMDD-0001 y reinicia cada día. Las ventas ya registradas conservan su folio.'),
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
    async function onPick(e) {
      const file = e.target.files && e.target.files[0]; e.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('Selecciona una imagen', 'var(--danger)'); return; }
      try {
        C.setSetting('store.logo', await resizeImageFile(file, { max: 256, type: 'image/png' }));
        toast('Logotipo actualizado', 'var(--accent)');
      } catch (error) {
        toast('No se pudo leer la imagen', 'var(--danger)');
      }
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

  // ── Migración de fotos de producto a la nube (Storage) ─────────────────────────
  // Detecta productos cuya foto sigue INCRUSTADA (data URL base64) — el formato viejo que
  // inflaba localStorage y cada sincronización — y las sube al bucket 'product-photos'
  // (migración pos_010), dejando en p.imagen solo la URL pública. Idempotente: la ruta es
  // prod-<id>.jpg con upsert, así un reintento continúa donde se quedó sin duplicar nada.
  function PhotoMigrationCard() {
    const [busy, setBusy] = useState(false);
    const [prog, setProg] = useState(null); // { done, total, fail }
    const [, setTick] = useState(0);        // re-contar pendientes al terminar
    const pend = D.products.filter(p => /^data:image\//.test(p.imagen || ''));
    const pesoMB = pend.reduce((a, p) => a + p.imagen.length * 0.75, 0) / (1024 * 1024);
    async function migrar() {
      if (busy) return;
      if (!window.STORE || !window.STORE.uploadProductPhoto) { toast('Sincronización con la nube no disponible', 'var(--danger)'); return; }
      if (!(await window.STORE.hasSession())) { toast('Inicia sesión para subir las fotos a la nube', 'var(--danger)'); return; }
      setBusy(true);
      const total = pend.length; let ok = 0, fallo = 0;
      setProg({ done: 0, total, fail: 0 });
      for (const p of pend) {
        try {
          const blob = await (await fetch(p.imagen)).blob();
          const url = await window.STORE.uploadProductPhoto('prod-' + p.id + '.jpg', blob);
          if (!url) throw new Error('sin URL');
          p.imagen = url; ok++;
          if (ok % 5 === 0) D.saveProducts(); // persistir avance por lotes
        } catch (e) { fallo++; }
        setProg({ done: ok, total, fail: fallo });
      }
      if (ok) D.saveProducts();
      setBusy(false); setTick(t => t + 1);
      toast(fallo
        ? `Migradas ${ok} de ${total}; fallaron ${fallo}. Verifica conexión y que corriste la migración pos_010 (bucket product-photos); al reintentar continúa donde se quedó.`
        : (ok ? `${ok} foto(s) migradas a la nube` : 'No había fotos pendientes'), fallo ? 'var(--danger)' : 'var(--accent)');
    }
    return h(GlassCard, { className: 'p-6' }, [
      h(SerifHeading, { key: 't', className: 'mb-2', children: 'Fotos de producto' }),
      pend.length === 0
        ? h('p', { key: 'okd', className: 'text-body text-success flex items-center gap-2' }, [h(MS, { key: 'i', name: 'check', size: 18 }), 'Todas las fotos de producto ya viven en la nube (o no hay fotos guardadas).'])
        : h('p', { key: 'd', className: 'text-body text-on-surface-variant leading-relaxed mb-4' },
            `Las fotos se guardan en la nube AUTOMÁTICAMENTE. Quedan ${pend.length} en formato antiguo (~${pesoMB.toFixed(1)} MB) que se subirán solas al abrir el sistema con sesión y conexión. Si quieres, puedes forzarlo ahora con el botón; si algo falla, continúa donde se quedó.`),
      pend.length > 0 && h('button', {
        key: 'b', type: 'button', disabled: busy,
        className: 'inline-flex items-center gap-2 px-5 h-11 bg-primary text-on-primary font-label-sm uppercase tracking-widest text-caption rounded-lg hover:opacity-90 transition disabled:opacity-50',
        onClick: migrar,
      }, [h(MS, { key: 'i', name: busy ? 'clock' : 'upload', size: 16 }), busy ? 'Migrando…' : `Subir ahora (${pend.length})`]),
      busy && prog && h('div', { key: 'pg', className: 'mt-4' }, [
        h('div', { key: 'bar', className: 'h-2 rounded-full bg-surface-container overflow-hidden' },
          h('div', { className: 'h-full bg-gold transition-all', style: { width: Math.round(((prog.done + prog.fail) / Math.max(1, prog.total)) * 100) + '%' } })),
        h('p', { key: 'lbl', className: 'text-caption text-on-surface-variant mt-2' }, `${prog.done} de ${prog.total} migradas${prog.fail ? ` · ${prog.fail} fallidas` : ''}`),
      ]),
    ]);
  }

  // Editor deliberadamente específico: los beneficios tienen lenguaje de negocio
  // propio y no caben en la fila técnica del editor genérico de catálogos.
  function BenefitEditor() {
    const items = C.all('additional_benefit');
    const [open, setOpen] = useState('');
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState('');
    const [newType, setNewType] = useState('percentage');
    const isOn = v => v === true || v === 'true';
    const meta = it => it.meta || {};
    const typeLabels = {
      percentage: 'Porcentaje',
      fixed: 'Cantidad de dinero',
      courtesy_piece: 'Cortesía de un artículo',
      courtesy_total: 'Cortesía de toda la venta',
    };
    const scopeLabels = { ticket: 'Toda la venta', item: 'Un artículo' };
    const origins = ['Promoción especial', 'Empleado', 'Cliente frecuente', 'Tarjeta física', 'Cortesía', 'Otro'];
    const fieldClass = 'block w-full h-10 px-3 bg-surface-container-low border border-outline-variant rounded-lg text-body';
    const update = (it, patch) => C.updateItem('additional_benefit', it.code, patch);
    const updateMeta = (it, patch) => update(it, { meta: patch });
    const toggle = (it, key) => updateMeta(it, { [key]: !isOn(meta(it)[key]) });
    const Switch = ({ it, field, label, description }) => {
      const on = isOn(meta(it)[field]);
      return h('button', {
        type: 'button', onClick: () => toggle(it, field),
        className: 'w-full flex items-center justify-between gap-3 p-3 rounded-lg border text-left transition ' +
          (on ? 'border-primary/40 bg-primary/5' : 'border-outline-variant bg-surface-container-low'),
      }, [
        h('span', { key: 't', className: 'min-w-0' }, [
          h('span', { key: 'l', className: 'block text-body font-medium text-primary' }, label),
          description && h('span', { key: 'd', className: 'block text-caption text-on-surface-variant mt-0.5' }, description),
        ]),
        h('span', {
          key: 's', className: 'w-11 h-6 p-0.5 rounded-full shrink-0 transition-colors ' + (on ? 'bg-primary' : 'bg-outline-variant'),
        }, h('span', { className: 'block w-5 h-5 bg-white rounded-full shadow transition-transform ' + (on ? 'translate-x-5' : '') })),
      ]);
    };
    function addBenefit() {
      const name = newName.trim();
      if (!name) { toast('Escribe el nombre que verá el vendedor', 'var(--danger)'); return; }
      const base = 'BENEFICIO_' + name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').toUpperCase();
      let code = base || ('BENEFICIO_' + Date.now());
      let suffix = 2;
      while (C.find('additional_benefit', code)) code = base + '_' + suffix++;
      const r = C.addItem('additional_benefit', {
        code, label: name,
        meta: {
          origin: 'Promoción especial', benefitType: newType, value: 0,
          maxPercent: newType === 'percentage' ? 100 : 0, maxAmount: 0,
          scope: 'ticket', requiresReason: true, requiresFolio: false,
          requiresAuthorization: false, combinable: false, allowsCustomValue: true,
        },
      });
      if (!r.ok) { toast(r.error, 'var(--danger)'); return; }
      setNewName(''); setAdding(false); setOpen(code);
    }
    function remove(it) {
      if (!window.confirm(`¿Eliminar “${it.label}”? Las ventas anteriores conservarán el beneficio que utilizaron.`)) return;
      const r = C.removeItem('additional_benefit', it.code);
      if (!r.ok) toast(r.error, 'var(--danger)');
    }
    const editPanel = it => {
      const m = meta(it);
      const type = m.benefitType || 'percentage';
      const custom = isOn(m.allowsCustomValue);
      const monetary = type === 'percentage' || type === 'fixed';
      return h('div', { className: 'p-4 pt-2 border-t border-outline-variant/60' }, [
        h('div', { key: 'grid', className: 'grid grid-cols-1 md:grid-cols-2 gap-4' }, [
          h('label', { key: 'name', className: 'block' }, [
            h('span', { key: 'l', className: 'block text-caption font-medium mb-1' }, 'Nombre que verá el vendedor'),
            h('input', { key: 'i', className: fieldClass, defaultValue: it.label, onBlur: e => update(it, { label: e.target.value.trim() || it.label }) }),
          ]),
          h('label', { key: 'origin', className: 'block' }, [
            h('span', { key: 'l', className: 'block text-caption font-medium mb-1' }, '¿De dónde proviene?'),
            h('select', { key: 's', className: fieldClass, value: m.origin || 'Otro', onChange: e => updateMeta(it, { origin: e.target.value }) },
              origins.map(x => h('option', { key: x, value: x }, x))),
          ]),
          h('label', { key: 'type', className: 'block' }, [
            h('span', { key: 'l', className: 'block text-caption font-medium mb-1' }, '¿Cómo se calcula?'),
            h('select', { key: 's', className: fieldClass, value: type, onChange: e => updateMeta(it, { benefitType: e.target.value }) },
              Object.entries(typeLabels).map(([value, label]) => h('option', { key: value, value }, label))),
          ]),
          h('label', { key: 'scope', className: 'block' }, [
            h('span', { key: 'l', className: 'block text-caption font-medium mb-1' }, '¿Dónde se aplica?'),
            h('select', { key: 's', className: fieldClass, value: m.scope || 'ticket', onChange: e => updateMeta(it, { scope: e.target.value }) }, [
              h('option', { key: 'ticket', value: 'ticket' }, 'Toda la venta'),
              h('option', { key: 'item', value: 'item' }, 'Un artículo'),
            ]),
          ]),
        ]),
        monetary && h('div', { key: 'value', className: 'mt-4 grid grid-cols-1 md:grid-cols-2 gap-4' }, [
          h(Switch, {
            key: 'custom', it, field: 'allowsCustomValue', label: 'El vendedor escribe el valor',
            description: custom ? 'Lo capturará al aplicar el descuento.' : 'Se utilizará siempre el valor configurado.',
          }),
          custom
            ? h('label', { key: 'limit', className: 'block' }, [
                h('span', { key: 'l', className: 'block text-caption font-medium mb-1' },
                  type === 'percentage' ? 'Porcentaje máximo permitido' : 'Importe máximo permitido'),
                h('input', {
                  key: 'i', type: 'number', min: 0, step: 0.01, className: fieldClass,
                  defaultValue: type === 'percentage' ? (Number(m.maxPercent) || 0) : (Number(m.maxAmount) || 0),
                  onBlur: e => updateMeta(it, { [type === 'percentage' ? 'maxPercent' : 'maxAmount']: Math.max(0, Number(e.target.value) || 0) }),
                }),
                h('span', { key: 'h', className: 'block text-caption text-on-surface-variant mt-1' },
                  type === 'fixed' ? 'Cero significa sin límite adicional.' : 'El sistema nunca acepta más de 100%.'),
              ])
            : h('label', { key: 'fixed', className: 'block' }, [
                h('span', { key: 'l', className: 'block text-caption font-medium mb-1' },
                  type === 'percentage' ? 'Porcentaje que se aplicará' : 'Importe que se descontará'),
                h('input', {
                  key: 'i', type: 'number', min: 0, step: 0.01, className: fieldClass,
                  defaultValue: Number(m.value) || 0,
                  onBlur: e => updateMeta(it, { value: Math.max(0, Number(e.target.value) || 0) }),
                }),
              ]),
        ]),
        h('div', { key: 'rules', className: 'mt-4 grid grid-cols-1 md:grid-cols-2 gap-3' }, [
          h(Switch, { key: 'reason', it, field: 'requiresReason', label: 'Pedir una explicación al vendedor' }),
          h(Switch, { key: 'combine', it, field: 'combinable', label: 'Se puede combinar con otro beneficio' }),
          m.origin === 'Tarjeta física' && h('div', { key: 'card', className: 'p-3 rounded-lg border border-outline-variant bg-surface-container-low text-caption text-on-surface-variant' },
            'Al aplicarla se pedirá el tipo y folio de la tarjeta. Requiere conexión y sólo puede usarse una vez.'),
        ]),
        h('div', { key: 'actions', className: 'mt-4 pt-4 border-t border-outline-variant/60 flex flex-wrap items-center justify-between gap-3' }, [
          h('div', { key: 'move', className: 'flex items-center gap-2' }, [
            h('span', { key: 'l', className: 'text-caption text-on-surface-variant' }, 'Orden en el Punto de Venta:'),
            h('button', { key: 'up', type: 'button', className: 'px-3 h-9 border border-outline-variant rounded-lg', onClick: () => C.move('additional_benefit', it.code, -1) }, 'Subir'),
            h('button', { key: 'down', type: 'button', className: 'px-3 h-9 border border-outline-variant rounded-lg', onClick: () => C.move('additional_benefit', it.code, 1) }, 'Bajar'),
          ]),
          h('button', { key: 'delete', type: 'button', className: 'px-3 h-9 text-danger hover:bg-danger-soft rounded-lg', onClick: () => remove(it) }, 'Eliminar opción'),
        ]),
      ]);
    };
    return h(GlassCard, { className: 'p-5 overflow-hidden' }, [
      h('div', { key: 'head', className: 'flex items-start justify-between gap-4 flex-wrap mb-4' }, [
        h('div', { key: 'text' }, [
          h(SerifHeading, { key: 't', children: 'Opciones disponibles en el Punto de Venta' }),
          h('p', { key: 'd', className: 'text-caption text-on-surface-variant mt-1' }, 'Abre una opción para cambiarla. Los nombres internos y reglas técnicas están ocultos.'),
        ]),
        h('button', {
          key: 'add', type: 'button', 'data-testid': 'benefit-add',
          className: 'px-4 h-10 bg-primary text-on-primary rounded-lg font-medium shrink-0',
          onClick: () => setAdding(v => !v),
        }, adding ? 'Cancelar' : 'Nueva opción'),
      ]),
      adding && h('div', { key: 'new', className: 'mb-4 p-4 rounded-xl border border-primary/30 bg-primary/5' }, [
        h('p', { key: 't', className: 'text-body font-semibold mb-3' }, 'Crear una opción para el vendedor'),
        h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3' }, [
          h('input', { key: 'n', className: fieldClass, value: newName, placeholder: 'Ej. Cliente frecuente', onChange: e => setNewName(e.target.value) }),
          h('select', { key: 't', className: fieldClass, value: newType, onChange: e => setNewType(e.target.value) }, [
            h('option', { key: 'p', value: 'percentage' }, 'Porcentaje'),
            h('option', { key: 'f', value: 'fixed' }, 'Cantidad de dinero'),
            h('option', { key: 'cp', value: 'courtesy_piece' }, 'Cortesía de un artículo'),
            h('option', { key: 'ct', value: 'courtesy_total' }, 'Cortesía de toda la venta'),
          ]),
          h('button', { key: 'b', type: 'button', className: 'px-4 h-10 bg-primary text-on-primary rounded-lg font-medium', onClick: addBenefit }, 'Crear'),
        ]),
      ]),
      h('div', { key: 'list', className: 'space-y-3' }, items.map(it => {
        const m = meta(it);
        const off = it.active === false;
        const expanded = open === it.code;
        return h('section', {
          key: it.code, 'data-testid': 'benefit-card-' + it.code,
          className: 'rounded-xl border border-outline-variant overflow-hidden ' + (off ? 'opacity-60' : 'bg-surface'),
        }, [
          h('div', { key: 'summary', className: 'p-4 flex items-center gap-3' }, [
            h('button', {
              key: 'open', type: 'button', className: 'flex-1 min-w-0 text-left',
              onClick: () => setOpen(expanded ? '' : it.code),
            }, [
              h('span', { key: 'name', className: 'block text-body font-semibold text-primary truncate' }, it.label),
              h('span', { key: 'desc', className: 'block text-caption text-on-surface-variant mt-1' },
                `${typeLabels[m.benefitType] || 'Beneficio'} · ${scopeLabels[m.scope] || 'Toda la venta'}${isOn(m.allowsCustomValue) ? ' · El vendedor escribe el valor' : ''}`),
            ]),
            h('button', {
              key: 'active', type: 'button',
              className: 'px-3 h-8 rounded-full text-caption font-semibold shrink-0 ' +
                (off ? 'bg-surface-container text-on-surface-variant' : 'bg-success-soft text-success'),
              onClick: () => C.setActive('additional_benefit', it.code, off),
            }, off ? 'Desactivada' : 'Activa'),
            h('button', {
              key: 'edit', type: 'button', 'aria-expanded': expanded,
              className: 'w-9 h-9 grid place-items-center rounded-lg hover:bg-surface-container shrink-0',
              title: expanded ? 'Cerrar edición' : 'Editar opción',
              onClick: () => setOpen(expanded ? '' : it.code),
            }, h(MS, { name: 'chevDown', size: 18, style: { transform: expanded ? 'rotate(180deg)' : '' } })),
          ]),
          expanded ? editPanel(it) : null,
        ]);
      })),
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
          h(FolioPrefixField, { key: 'f' }),
        ]),
        h('div', { key: 'iva', className: 'mt-4 p-4 rounded-xl bg-surface-container-low border border-outline-variant' }, [
          h('p', { key: 't', className: 'text-body-strong text-primary' }, 'IVA 16% incluido en precios'),
          h('p', { key: 'd', className: 'text-caption text-on-surface-variant mt-1' }, 'Regla fija de Finanzas: el POS separa Importe e IVA del total; nunca agrega IVA nuevamente.'),
        ]),
      ]),
    ],
    producto: () => [
      h('p', { key: 'intro', className: 'text-caption text-on-surface-variant' }, 'Estos catálogos alimentan el SKU, el alta de productos, los filtros y la importación de Excel. Renómbralos, decide cuáles aparecen en el alta y cuáles forman el SKU. El código entra al SKU: si está en uso por productos no podrás borrarlo (desactívalo).'),
      h(SkuBuilder, { key: 'sku' }),
      h(CatalogHealthCard, { key: 'health' }),
      h(CatalogXlsxCard, { key: 'catxlsx' }),
      h(CatalogEditor, { key: 'cat', kind: 'category', codePlaceholder: '21' }),
      h(CatalogEditor, { key: 'fab', kind: 'fabric', codePlaceholder: 'ALG' }),
      h(CatalogEditor, { key: 'slv', kind: 'sleeve', codePlaceholder: 'ML' }),
      h(CatalogEditor, { key: 'nck', kind: 'neck', codePlaceholder: 'NOR' }),
      h(CatalogEditor, { key: 'col', kind: 'color', codePlaceholder: 'AZ', metaFields: [{ key: 'hex', label: 'Color', type: 'color', def: '#cccccc' }] }),
      h(ColorHexFixCard, { key: 'colhex' }),
      h(CatalogEditor, { key: 'orn', kind: 'ornament', codePlaceholder: 'Bordado', labelPlaceholder: 'Nombre del ornamento' }),
      h(CatalogEditor, { key: 'szl', kind: 'size_letter', codePlaceholder: 'M', labelPlaceholder: 'M' }),
      h(CatalogEditor, { key: 'szn', kind: 'size_number', codePlaceholder: '40', labelPlaceholder: '40' }),
      // Catálogos creados por el administrador (Fase 2)
      ...Object.keys(C.allCatalogMeta ? C.allCatalogMeta() : {}).filter(k => { const m = C.catalogMeta(k); return m && m.custom; })
        .map(k => h(CatalogEditor, { key: k, kind: k, codePlaceholder: 'CÓD' })),
      h(NewCatalogCard, { key: 'newcat' }),
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
          h(CfgText, { key: 'mm', k: 'discount.minMarginPct', label: 'Margen mínimo en promociones (%)', type: 'number', min: 0, max: 100, hint: 'Limita descuentos nuevos usando el costo registrado del producto.' }),
        ]),
      ]),
    ],
    beneficios: () => [
      h('p', { key: 'i', className: 'text-caption text-on-surface-variant' }, 'Opciones que el vendedor puede aplicar después de las promociones configuradas. Cada venta congela el beneficio utilizado; editarlo aquí no altera documentos anteriores.'),
      h(GlassCard, { key: 'manual', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-2', children: 'Captura manual del vendedor' }),
        h('p', { key: 'd', className: 'text-body text-on-surface-variant' }, '“Descuento manual (%)” permite escribir un porcentaje y “Descuento manual ($)” un importe. El administrador puede renombrar, desactivar o limitar ambas opciones en el catálogo inferior.'),
        h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-caption' }, [
          h('div', { key: 'p', className: 'p-3 rounded-lg bg-surface-container-low' }, [
            h('b', { key: 't' }, 'Porcentaje manual'),
            h('p', { key: 'd', className: 'text-on-surface-variant mt-1' }, 'El vendedor escribe un porcentaje, por ejemplo 10 o 15.5. Puedes establecer un máximo.'),
          ]),
          h('div', { key: 'a', className: 'p-3 rounded-lg bg-surface-container-low' }, [
            h('b', { key: 't' }, 'Importe manual'),
            h('p', { key: 'd', className: 'text-on-surface-variant mt-1' }, 'El vendedor escribe una cantidad de dinero. Cero como máximo significa sin límite adicional.'),
          ]),
        ]),
      ]),
      h(BenefitEditor, { key: 'ab' }),
    ],
    devoluciones: () => [
      h('p', { key: 'i', className: 'text-caption text-on-surface-variant' }, 'Catálogo de motivos que el cajero elige al devolver un artículo, y la política de comisiones. Todo se sincroniza a la nube.'),
      h(CatalogEditor, { key: 'rr', kind: 'return_reason', title: 'Motivos de devolución', codePlaceholder: 'Talla', labelPlaceholder: 'Talla errónea', hint: 'El administrador agrega aquí cualquier motivo adicional; el cajero lo selecciona por artículo en la pantalla de Devoluciones.' }),
      h(GlassCard, { key: 'plazo', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-2', children: 'Plazo para devoluciones' }),
        h(CfgToggle, { key: 'le', k: 'returns.limitEnabled', title: 'Aplicar límite de tiempo', desc: 'Si lo apagas, las ventas nunca vencen y pueden devolverse siempre.' }),
        h('div', { key: 'g', className: 'grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-2' }, [
          h(CfgText, { key: 'ld', k: 'returns.limitDays', label: 'Días permitidos', type: 'number', min: 1, max: 3650 }),
        ]),
        h('p', { key: 'n', className: 'text-caption text-on-surface-variant mt-3' }, 'Cada venta conserva el plazo vigente al momento en que se registró. Cambiar estos ajustes NO modifica ninguna venta anterior: sólo aplica a las ventas nuevas. Los apartados empiezan a contar el día en que se liquidan.'),
      ]),
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
      h(PhotoMigrationCard, { key: 'fotos' }),
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
                s.avatar
                  ? h('img', { key: 'a', src: s.avatar, className: 'w-8 h-8 rounded-full object-cover shrink-0' })
                  : h('span', { key: 'a', className: 'w-8 h-8 rounded-full grid place-items-center text-overline font-bold text-white shrink-0', style: { background: s.color } }, s.iniciales),
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
    async function generar() {
      // La simulación es LOCAL. Con sesión iniciada se subiría a Supabase y contaminaría los datos
      // reales (justo lo que hay que limpiar después). Se bloquea: primero cerrar sesión.
      if (window.STORE && (await window.STORE.hasSession())) {
        window.alert('Tienes una sesión iniciada.\n\nLa simulación es LOCAL y, con sesión, se subiría a tu Supabase y contaminaría tus datos reales.\n\nCierra sesión primero y vuelve a intentarlo.');
        return;
      }
      if (!window.confirm('¿Generar la SIMULACIÓN de demostración?\n\nReemplaza los datos actuales por ~24 productos, 8 clientes, 4 vendedores y ~300 ventas de los últimos 90 días (con devoluciones). Todo se calcula con el motor real.\n\nEs LOCAL: NO toca tu base en la nube.')) return;
      setBusy(true);
      setTimeout(() => { const r = D.seedDemo(); toast(`Simulación lista: ${r.sales} ventas · ${r.products} productos · ${r.returns} devoluciones`, 'var(--accent)'); setTimeout(() => location.reload(), 700); }, 30);
    }
    async function limpiar() {
      if (!window.confirm('¿Limpiar TODO y volver al estado vacío de producción?\n\nBorra productos, clientes, ventas, devoluciones, etc. de ESTE dispositivo. No se puede deshacer.')) return;
      const online = !!(window.STORE && (await window.STORE.hasSession()));
      D.resetEmpty();
      if (online) {
        window.alert('Datos locales vaciados.\n\n⚠ Tienes sesión iniciada: tu Supabase TODAVÍA conserva los datos y, al recargar, la app los volverá a descargar (la simulación "revivirá").\n\nPara vaciar la nube, hazlo desde Supabase, o cierra sesión para trabajar solo en local.');
      } else {
        toast('Datos vaciados — estado de producción', 'var(--accent)');
      }
      setTimeout(() => location.reload(), 800);
    }
    // Borra SOLO lo transaccional de prueba (ventas, devoluciones, descuentos, liquidaciones,
    // clientes) y devuelve al inventario el stock que consumieron. Los productos NO se tocan.
    function limpiarPruebas() {
      if (!window.confirm('¿Borrar los DATOS DE PRUEBA de este dispositivo?\n\nSE BORRA: ventas, devoluciones, descuentos/promociones, liquidaciones de comisión, movimientos de venta y clientes registrados.\n\nSE CONSERVA: tu inventario (productos, precios, fotos y códigos), los usuarios/vendedores y toda la configuración.\n\nEl stock vuelve a como estaba antes de las pruebas. No se puede deshacer.')) return;
      D.resetTestData();
      // La marca vigente queda como aplicada: si no, el próximo arranque volvería a avisar.
      try { if (window.STORE && window.STORE.markResetApplied) window.STORE.markResetApplied(); } catch (e) { /* */ }
      window.alert('Datos de prueba borrados en este dispositivo y stock restaurado.\n\nSi usas la nube, corre también el archivo supabase/LIMPIAR-PRUEBAS.sql en Supabase (SQL Editor): además de vaciarla, deja una marca para que las DEMÁS terminales se limpien solas la próxima vez que las abran.');
      setTimeout(() => location.reload(), 800);
    }
    return [
      active && h('div', { key: 'badge', className: 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gold-soft text-gold-text text-overline font-bold uppercase tracking-widest w-fit' }, [h(MS, { key: 'i', name: 'star', size: 14, fill: true }), 'Modo demostración activo']),
      h(GlassCard, { key: 'clean', className: 'p-6' }, [
        h(SerifHeading, { key: 't', className: 'mb-2', children: 'Borrar datos de prueba' }),
        h('p', { key: 'd', className: 'text-body text-on-surface-variant leading-relaxed mb-5' }, 'Deja el sistema listo para operar de verdad: borra las ventas, devoluciones, descuentos, liquidaciones y clientes que capturaste probando, y devuelve al inventario las piezas que esas ventas descontaron. Tu inventario, tus usuarios y tu configuración NO se tocan.'),
        h('div', { key: 'b' }, [
          h('button', { key: 'x', className: 'inline-flex items-center gap-2 px-5 h-11 border border-outline-variant text-danger font-label-sm uppercase tracking-widest text-caption rounded-lg hover:bg-danger-soft hover:border-danger/30 transition', onClick: limpiarPruebas }, [h(MS, { key: 'i', name: 'trash', size: 16 }), 'Borrar datos de prueba (conserva inventario)']),
        ]),
      ]),
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
    async function onPickAvatar(e) {
      const file = e.target.files && e.target.files[0]; e.target.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) { toast('Selecciona una imagen', 'var(--danger)'); return; }
      try {
        set('avatar', await resizeImageFile(file, { max: 256, type: 'image/png' }));
        toast('Foto lista', 'var(--accent)');
      } catch (error) {
        toast('No se pudo leer la imagen', 'var(--danger)');
      }
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
        // Edición de SOLO perfil (no cambia email ni contraseña): se actualiza pos.sellers directo,
        // SIN la Edge Function admin-users. Así renombrar / cambiar rol / foto funciona aunque la
        // función no esté desplegada. (Crear usuarios y cambiar email/contraseña sí la requieren, por Auth.)
        if (editing && !f.password && f.email.trim() === (user.email || '')) {
          D.updateUser(user.id, { nombre: f.nombre.trim(), role: f.role, avatar: f.avatar || null });
          toast('Usuario actualizado', 'var(--accent)');
          onSaved();
          return;
        }
        if (!editing && (f.password || '').length < 6) { toast('Contraseña de al menos 6 caracteres', 'var(--danger)'); return; }
        if (editing && f.password && f.password.length < 6) { toast('La nueva contraseña debe tener al menos 6 caracteres', 'var(--danger)'); return; }
        try {
          const payload = editing
            ? { action: 'update', id: user.id, email: f.email.trim(), nombre: f.nombre.trim(), role: f.role, avatar: f.avatar || '', password: f.password || undefined }
            : { action: 'create', email: f.email.trim(), password: f.password, nombre: f.nombre.trim(), role: f.role, avatar: f.avatar || '' };
          // callFunction lee SIEMPRE el cuerpo real de la respuesta, así el usuario ve el motivo
          // exacto ("Solo un administrador…", "Sesión inválida", "correo ya registrado…") en vez del
          // genérico "returned a non-2xx status code" que da supabase-js .invoke() en errores.
          const r = await window.STORE.callFunction('admin-users', payload);
          if (!r.ok || (r.body && r.body.error)) {
            toast((r.body && r.body.error) || ('No se pudo guardar (código ' + r.status + ')'), 'var(--danger)');
            return;
          }
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
          const r = await window.STORE.callFunction('admin-users', { action: 'delete', id: user.id });
          if (!r.ok || (r.body && r.body.error)) { toast((r.body && r.body.error) || ('No se pudo eliminar (código ' + r.status + ')'), 'var(--danger)'); return; }
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
