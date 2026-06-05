// shared.jsx — utilidades y componentes compartidos. Exporta a window.
(function () {
  const { useState, useEffect, useRef } = React;

  // Formato moneda MXN
  const fmt = (n) => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---- Badge semántico canónico (set único, tokens) ----
  const BADGE_TONE = {
    success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger', info: 'bg-info-soft text-info',
    gold: 'bg-gold-soft text-gold-text', neutral: 'bg-surface-container text-on-surface-variant',
  };
  function Badge({ tone = 'neutral', className = '', children }) {
    return React.createElement('span', {
      className: 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-overline uppercase ' + (BADGE_TONE[tone] || BADGE_TONE.neutral) + ' ' + className,
    }, children);
  }
  // Tono semántico por estatus de venta — administrable desde CONFIG (sale_status.meta.tone).
  // 'Activo' (estatus de usuario) se mantiene como fallback fijo.
  function estadoTone(estado) {
    const it = window.CONFIG && window.CONFIG.find('sale_status', estado);
    if (it && it.meta && it.meta.tone) return it.meta.tone;
    return estado === 'Activo' ? 'success' : 'neutral';
  }
  function StatusBadge({ estado }) { return Badge({ tone: estadoTone(estado), children: estado }); }

  function StockBadge({ n }) {
    const low = (window.CONFIG && window.CONFIG.get('stock.lowThreshold')) || 4;
    let tone = 'success', txt = `${n} en stock`;
    if (n === 0) { tone = 'danger'; txt = 'Agotado'; }
    else if (n <= low) { tone = 'warning'; txt = `${n} bajo`; }
    return Badge({ tone, children: txt });
  }

  // Miniatura de producto (placeholder con patrón + swatch de color)
  function ProductThumb({ p, size = 48 }) {
    return React.createElement('div', {
      style: {
        width: size, height: size, position: 'relative', overflow: 'hidden',
        background: '#e6e8ea', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }
    }, [
      React.createElement('div', {
        key: 'bg',
        style: {
          position: 'absolute', inset: 0,
          background: `repeating-linear-gradient(${(p.modelo.charCodeAt(0) * 37) % 180}deg, ${p.colorHex}33 0 4px, transparent 4px 9px)`,
        }
      }),
      React.createElement(window.Icon, { key: 'i', name: 'shirt', size: size * 0.5, style: { color: p.colorHex, opacity: 0.9, position: 'relative' } }),
    ]);
  }

  // Toast system
  let pushToastFn = null;
  function ToastHost() {
    const [toasts, setToasts] = useState([]);
    useEffect(() => {
      pushToastFn = (msg, color = 'var(--success)') => {
        const id = Math.random();
        setToasts(t => [...t, { id, msg, color }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600);
      };
    }, []);
    return React.createElement('div', { className: 'fixed bottom-5 right-5 z-[200] flex flex-col gap-2 items-end' },
      toasts.map(t => React.createElement('div', {
        key: t.id,
        className: 'flex items-center gap-2.5 px-4 py-3 bg-primary-container text-white text-sm rounded-lg shadow-e3',
      }, [
        React.createElement('span', { key: 'd', className: 'w-2 h-2 rounded-full shrink-0', style: { background: t.color } }),
        React.createElement('span', { key: 'm' }, t.msg),
      ])));
  }
  function toast(msg, color) { if (pushToastFn) pushToastFn(msg, color); }

  // Modal
  function Modal({ title, onClose, children, footer, large }) {
    useEffect(() => {
      const h = (e) => { if (e.key === 'Escape') onClose(); };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, []);
    return React.createElement('div', {
      className: 'fixed inset-0 z-[150] bg-on-surface/40 backdrop-blur-sm flex items-center justify-center p-4',
      onClick: onClose,
    },
      React.createElement('div', {
        className: 'bg-surface-container-lowest rounded-xl shadow-e3 w-full flex flex-col max-h-[88vh] ' + (large ? 'max-w-3xl' : 'max-w-md'),
        onClick: e => e.stopPropagation(),
      }, [
        React.createElement('div', { key: 'h', className: 'flex items-center gap-3 px-6 py-4 border-b border-outline-variant' }, [
          React.createElement('div', { key: 't', className: 'flex-1 font-headline text-headline-md text-primary' }, title),
          React.createElement('button', {
            key: 'x', className: 'w-9 h-9 grid place-items-center text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors', onClick: onClose,
          }, React.createElement(window.HX.MS, { name: 'close', size: 20 })),
        ]),
        React.createElement('div', { key: 'b', className: 'px-6 py-5 overflow-y-auto' }, children),
        footer && React.createElement('div', { key: 'f', className: 'flex items-center justify-end gap-3 px-6 py-4 border-t border-outline-variant' }, footer),
      ]));
  }

  // Paginador reutilizable (Clientes, Inventario). Muestra ‹ 1 2 3 … › con la página activa.
  function Pager({ page, pages, onPage }) {
    if (!pages || pages <= 1) return null;
    const MS = window.HX.MS;
    let start = Math.max(1, page - 2), end = Math.min(pages, start + 4);
    start = Math.max(1, end - 4);
    const nums = []; for (let i = start; i <= end; i++) nums.push(i);
    const cell = (key, content, { active, disabled, onClick } = {}) => React.createElement('button', {
      key, disabled: !!disabled, onClick: onClick || undefined,
      className: 'w-8 h-8 flex items-center justify-center rounded-lg border text-overline font-bold transition-colors ' +
        (active ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant ' + (disabled ? 'opacity-30 cursor-not-allowed' : 'hover:bg-surface-container')),
    }, content);
    return React.createElement('div', { className: 'flex items-center gap-1' }, [
      cell('prev', React.createElement(MS, { name: 'chevLeft', size: 16 }), { disabled: page <= 1, onClick: page > 1 ? () => onPage(page - 1) : null }),
      ...nums.map(n => cell('p' + n, String(n), { active: n === page, onClick: () => onPage(n) })),
      cell('next', React.createElement(MS, { name: 'chevRight', size: 16 }), { disabled: page >= pages, onClick: page < pages ? () => onPage(page + 1) : null }),
    ]);
  }

  window.UI = { fmt, Badge, StatusBadge, StockBadge, ProductThumb, ToastHost, toast, Modal, BADGE_TONE, Pager };
})();
