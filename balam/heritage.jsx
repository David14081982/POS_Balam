// heritage.jsx — Primitivas del rediseño "Artisanal Heritage" (Stitch).
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

  window.HX = { MS, MS_MAP, GlassCard, SerifHeading, ProductImage };
})();
