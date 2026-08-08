// shared.jsx — utilidades y componentes compartidos. Exporta a window.
(function () {
  const { useState, useEffect, useRef } = React;

  // Formato moneda MXN
  const fmt = (n) => '$' + Number(n).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // ---- Fecha visible: DD/MM/AAAA ----
  // El negocio lee día/mes/año. Las fechas se PERSISTEN en 'AAAA-MM-DD [HH:mm]' y ese
  // formato no cambia: es el que ordena, compara y viaja a la nube. Estas dos funciones
  // son sólo presentación y son la única fuente del formato visible, para que no acabe
  // reimplementado en cada pantalla.
  // Un valor que no se reconoce se devuelve tal cual: nunca se inventa una fecha.
  const RE_FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/;
  function fechaCorta(v) {
    const s = String(v == null ? '' : v);
    const m = s.match(RE_FECHA_ISO);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
  }
  function fechaHora(v) {
    const s = String(v == null ? '' : v);
    const m = s.match(RE_FECHA_ISO);
    if (!m) return s;
    return m[4] ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}` : `${m[3]}/${m[2]}/${m[1]}`;
  }

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

  // `testid` es opcional y estampa un contrato estable por opción
  // (`<testid>-<id>`) para que las pruebas no localicen la opción por su texto,
  // que aquí se pinta en mayúsculas por CSS (R-DEL-10).
  function Segment({ value, onChange, options, testid }) {
    return React.createElement('div', {
      className: 'flex p-1 bg-surface-container rounded-lg border border-outline-variant overflow-x-auto no-scrollbar',
    }, options.map(([id, label]) => {
      const active = value === id;
      return React.createElement('button', {
        key: id,
        'data-testid': testid ? testid + '-' + id : undefined,
        className: 'shrink-0 whitespace-nowrap px-4 py-1.5 text-overline uppercase rounded transition-colors '
          + (active ? 'bg-gold text-on-gold shadow-e1' : 'text-on-surface-variant hover:text-primary'),
        onClick: () => onChange(id),
      }, label);
    }));
  }

  function resizeImageFile(file, { max = 256, type = 'image/png', quality } = {}) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || '')) {
        reject(new Error('invalid_image'));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('image_read_failed'));
      reader.onabort = () => reject(new Error('image_read_aborted'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('image_decode_failed'));
        img.onload = () => {
          try {
            const limit = Math.max(1, Number(max) || 1);
            const scale = Math.min(1, limit / Math.max(img.width, img.height, 1));
            const width = Math.max(1, Math.round(img.width * scale));
            const height = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(quality == null
              ? canvas.toDataURL(type)
              : canvas.toDataURL(type, quality));
          } catch (error) {
            reject(error);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // Miniatura de producto (placeholder con patrón + swatch de color)
  function ProductThumb({ p, size = 48 }) {
    const valid = p && typeof p === 'object';
    const modelo = valid && p.modelo != null ? String(p.modelo) : '';
    const colorHex = valid && typeof p.colorHex === 'string' && p.colorHex
      ? p.colorHex : '#8b9099';
    const angle = modelo ? (modelo.charCodeAt(0) * 37) % 180 : 135;
    return React.createElement('div', {
      'data-testid': valid ? undefined : 'product-thumb-missing',
      title: valid ? undefined : 'Producto no disponible',
      style: {
        width: size, height: size, position: 'relative', overflow: 'hidden',
        background: '#e6e8ea', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }
    }, [
      React.createElement('div', {
        key: 'bg',
        style: {
          position: 'absolute', inset: 0,
          background: `repeating-linear-gradient(${angle}deg, ${colorHex}33 0 4px, transparent 4px 9px)`,
        }
      }),
      React.createElement(window.Icon, {
        key: 'i', name: valid ? 'shirt' : 'alert', size: size * 0.5,
        style: { color: colorHex, opacity: 0.9, position: 'relative' },
      }),
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
        'data-testid': 'toast',
        className: 'flex items-center gap-2.5 px-4 py-3 bg-primary-container text-white text-sm rounded-lg shadow-e3',
      }, [
        React.createElement('span', { key: 'd', className: 'w-2 h-2 rounded-full shrink-0', style: { background: t.color } }),
        React.createElement('span', { key: 'm' }, t.msg),
      ])));
  }
  function toast(msg, color) { if (pushToastFn) pushToastFn(msg, color); }
  function useSyncActivity(active, domains, detail) {
    const token = React.useRef(null);
    const key = (Array.isArray(domains) ? domains : [domains]).join('|');
    useEffect(() => {
      if (active && !token.current && window.CORE && window.CORE.beginActivity) {
        token.current = window.CORE.beginActivity(key.split('|').filter(Boolean), detail || null);
      } else if (!active && token.current && window.CORE && window.CORE.endActivity) {
        window.CORE.endActivity(token.current); token.current = null;
      }
      return () => {
        if (token.current && window.CORE && window.CORE.endActivity) {
          window.CORE.endActivity(token.current); token.current = null;
        }
      };
    }, [!!active, key]);
  }
  function useSyncFocusActivity(domains, detail) {
    const token = React.useRef(null);
    const list = Array.isArray(domains) ? domains : [domains];
    useEffect(() => () => {
      if (token.current && window.CORE && window.CORE.endActivity) window.CORE.endActivity(token.current);
      token.current = null;
    }, []);
    return {
      onFocusCapture() {
        if (!token.current && window.CORE && window.CORE.beginActivity) token.current = window.CORE.beginActivity(list, detail || null);
      },
      onBlurCapture(event) {
        const root = event.currentTarget;
        setTimeout(() => {
          if (root && root.contains && root.contains(document.activeElement)) return;
          if (token.current && window.CORE && window.CORE.endActivity) window.CORE.endActivity(token.current);
          token.current = null;
        }, 0);
      },
    };
  }

  // Modal
  function Modal({ title, onClose, children, footer, large, testId, productForm }) {
    const panelRef = useRef(null);
    const previousFocus = useRef(null);
    const closeRef = useRef(onClose);
    useEffect(() => { closeRef.current = onClose; }, [onClose]);
    useEffect(() => {
      previousFocus.current = document.activeElement;
      const focusable = () => panelRef.current ? [...panelRef.current.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter(node => node.offsetParent !== null) : [];
      const h = (e) => {
        if (e.key === 'Escape') { closeRef.current(); return; }
        if (!productForm || e.key !== 'Tab') return;
        const nodes = focusable(); if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      };
      window.addEventListener('keydown', h);
      if (productForm) requestAnimationFrame(() => {
        const target = panelRef.current && (panelRef.current.querySelector('[data-autofocus]') || focusable()[0]);
        if (target) target.focus();
      });
      return () => {
        window.removeEventListener('keydown', h);
        if (productForm && previousFocus.current && previousFocus.current.focus) previousFocus.current.focus();
      };
    }, [productForm]);
    return React.createElement('div', {
      className: 'fixed inset-0 z-[150] bg-on-surface/40 backdrop-blur-sm flex items-center justify-center ' + (productForm ? 'p-0 sm:p-4' : 'p-4'),
      onClick: onClose,
    },
      React.createElement('div', {
        ref: panelRef,
        role: productForm ? 'dialog' : undefined,
        'aria-modal': productForm ? 'true' : undefined,
        'aria-labelledby': productForm && testId ? testId + '-title' : undefined,
        className: 'bg-surface-container-lowest shadow-e3 w-full flex flex-col ' +
          (productForm ? 'h-[100dvh] max-h-[100dvh] rounded-none sm:h-auto sm:max-h-[94vh] sm:rounded-xl max-w-6xl' :
            'rounded-xl max-h-[88vh] ' + (large ? 'max-w-3xl' : 'max-w-md')),
        'data-testid': testId,
        onClick: e => e.stopPropagation(),
      }, [
        React.createElement('div', { key: 'h', className: 'flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-outline-variant' }, [
          React.createElement('div', { key: 't', id: productForm && testId ? testId + '-title' : undefined, className: 'flex-1 font-headline text-headline-md text-primary' }, title),
          React.createElement('button', {
            key: 'x', className: 'w-9 h-9 grid place-items-center text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors', onClick: onClose,
            'aria-label': 'Cerrar', 'data-testid': testId ? testId + '-close' : undefined,
          }, React.createElement(window.HX.MS, { name: 'close', size: 20 })),
        ]),
        React.createElement('div', { key: 'b', className: (productForm ? 'px-4 sm:px-6 py-4 sm:py-5' : 'px-6 py-5') + ' overflow-y-auto', 'data-testid': testId ? testId + '-body' : undefined }, children),
        footer && React.createElement('div', { key: 'f', className: (productForm ? 'flex flex-wrap items-center gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4' : 'flex items-center justify-end gap-3 px-6 py-4') + ' border-t border-outline-variant', 'data-testid': testId ? testId + '-footer' : undefined }, footer),
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

  window.UI = { fmt, fechaCorta, fechaHora, Badge, StatusBadge, StockBadge, ProductThumb, ToastHost, toast, Modal, BADGE_TONE, Pager, Segment, resizeImageFile, useSyncActivity, useSyncFocusActivity };
})();
