// heritage.jsx — Primitivas visuales del diseño Balam (Stitch).
// Solo las usan las pantallas ya migradas. Exporta a window.HX.
(function () {
  // Mapa de íconos propios -> nombres Material Symbols.
  // Si un name no está en el mapa, se asume que ya es un nombre Material válido.
  const MS_MAP = {
    pos: 'point_of_sale', box: 'inventory_2', users: 'groups', badge: 'badge',
    chart: 'monitoring', gear: 'settings', search: 'search',
    barcode: 'barcode_scanner', scan: 'barcode_scanner', plus: 'add', minus: 'remove',
    x: 'close', trash: 'delete', check: 'check', chevDown: 'expand_more',
    chevRight: 'chevron_right', chevLeft: 'chevron_left', arrowUp: 'arrow_upward',
    arrowUpRight: 'north_east', cash: 'payments', card: 'credit_card',
    transfer: 'swap_horiz', split: 'call_split', clock: 'schedule', phone: 'call',
    user: 'person', tag: 'sell', filter: 'filter_list', bell: 'notifications',
    print: 'print', receipt: 'receipt_long', dots: 'more_horiz', grid: 'grid_view',
    list: 'view_list', shirt: 'checkroom', alert: 'warning', edit: 'edit',
    download: 'download', logout: 'logout', calendar: 'calendar_today', star: 'star',
    truck: 'local_shipping', repeat: 'sync', sparkle: 'auto_awesome',
    add: 'add', dashboard: 'dashboard', help: 'help_outline', close: 'close',
    loan: 'assignment_return', // H-46: mercancía que sale y tiene que volver
  };

  // Ícono Material Symbols. API: { name, size=20, fill, className, style }
  function MS({ name, size = 20, fill = false, className = '', style, ...rest }) {
    const sym = MS_MAP[name] || name;
    return React.createElement('span', {
      className: 'material-symbols-outlined ' + (fill ? 'ms-fill ' : '') + className,
      style: { fontSize: size, ...style },
      'aria-hidden': true, ...rest,
    }, sym);
  }

  // Card canónica (nivel 1): superficie blanca, radio lg, elevación e1, SIN borde.
  function GlassCard({ className = '', children, ...rest }) {
    return React.createElement('div', {
      className: 'bg-surface-container-lowest rounded-lg shadow-e1 ' + className,
      ...rest,
    }, children);
  }

  // Título editorial Playfair. level: 'lg' | 'md' (default md)
  function SerifHeading({ level = 'md', className = '', children, as = 'h2', ...rest }) {
    const size = level === 'lg' ? 'text-headline-lg' : 'text-headline-md';
    return React.createElement(as, {
      className: 'font-headline ' + size + ' text-primary ' + className, ...rest,
    }, children);
  }

  // Imagen de producto: foto real (p.imagen) si existe; si no o si falla, miniatura generada.
  // Sin dependencias externas → 100% offline, sin errores de red.
  function ProductImage({ p, className = '', imgClassName = '' }) {
    const [errored, setErrored] = React.useState(false);
    const raw = p && p.imagen;
    // En el bundle, __IMG_MAP redirige la URL de Unsplash a un blob embebido (offline)
    const src = (raw && window.__IMG_MAP && window.__IMG_MAP[raw]) || raw;
    if (!src || errored) {
      return React.createElement('div', {
        className: 'flex items-center justify-center bg-surface-container-high ' + className,
      }, React.createElement(window.UI.ProductThumb, { p, size: 64 }));
    }
    return React.createElement('div', { className: 'overflow-hidden bg-surface-container-high ' + className },
      React.createElement('img', {
        src, alt: p.nombre, loading: 'lazy', onError: () => setErrored(true),
        className: 'w-full h-full object-cover ' + imgClassName,
      }));
  }

  function ReferenceFamilyPicker({ projection, onPick, onClose, title = 'Selecciona referencia', includeZero = false }) {
    const h = React.createElement, D = window.DATA, fmt = window.UI.fmt;
    const groups = (projection && projection.sizeGroups || []).filter(group => includeZero || group.stock > 0);
    return h(window.UI.Modal, { title, onClose }, h('div', { className: 'space-y-4', 'data-testid': 'reference-family-picker' },
      groups.map(group => h('section', { key: group.key, className: 'rounded-xl border border-outline-variant p-3' }, [
        h('div', { key: 'h', className: 'flex items-center justify-between gap-3 mb-2' }, [
          h('strong', { key: 's', className: 'font-headline text-h2 text-primary' }, group.label),
          h('span', { key: 'n', className: 'text-caption text-on-surface-variant' }, group.stock + ' disponibles'),
        ]),
        h('div', { key: 'r', className: 'grid gap-2' }, group.references.map(reference => {
          const stock = Math.max(0, Number(reference.stockQuantity) || 0);
          const colors = D.canonicalReferenceOrnamentColors(reference.ornamentColorCodes || reference.ornColors || []);
          const variant = colors.length ? colors.join(' + ') : reference.sku;
          return h('button', {
            key: reference.id, type: 'button', disabled: stock <= 0, onClick: () => onPick(reference, reference.sizeCode),
            'data-testid': 'reference-family-pick-' + reference.id,
            className: 'min-h-12 px-3 py-2 rounded-lg border border-outline-variant text-left flex items-center gap-3 hover:border-primary disabled:opacity-45 disabled:cursor-not-allowed',
          }, [
            h('span', { key: 'v', className: 'flex-1 min-w-0 text-body font-semibold text-primary [overflow-wrap:anywhere]' }, variant),
            h('span', { key: 's', className: 'text-caption text-on-surface-variant whitespace-nowrap' }, stock + ' pz'),
            h('span', { key: 'p', className: 'font-headline text-body text-primary whitespace-nowrap' }, fmt(D.listPrice(reference, reference.sizeCode))),
          ]);
        })),
      ]))));
  }

  window.HX = { MS, MS_MAP, GlassCard, SerifHeading, ProductImage, ReferenceFamilyPicker };
})();
