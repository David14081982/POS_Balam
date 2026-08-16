// shared.jsx — utilidades y componentes compartidos. Exporta a window.
(function () {
  const { useState, useEffect, useRef } = React;

  // Contrato táctil y de foco H-87. Se limita al cliente BALAM y a viewports
  // móviles; no cambia tipografía, contenido ni overflow.
  if (!document.getElementById('balam-responsive-contract')) {
    const style = document.createElement('style');
    style.id = 'balam-responsive-contract';
    style.textContent = `
      #root :is(button,a[href],input,select,textarea,[role="button"]):focus-visible {
        outline: 2px solid #67540a; outline-offset: 2px;
      }
      @media (max-width: 767px), (pointer: coarse) {
        #root :is(button,a[href],select,input:not([type="checkbox"]):not([type="radio"]),textarea,[role="button"]) { min-height: 44px; }
        #root :is(button,[role="button"])[aria-label] { min-width: 44px; }
      }
    `;
    document.head.appendChild(style);
  }

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
        className: 'shrink-0 min-h-11 whitespace-nowrap px-4 py-2 text-overline uppercase rounded transition-colors '
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

  function imageFileDimensions(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type || '')) { reject(new Error('invalid_image')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('image_read_failed'));
      reader.onabort = () => reject(new Error('image_read_aborted'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('image_decode_failed'));
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.src = reader.result;
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
    return React.createElement('div', { className: 'fixed top-4 inset-x-4 sm:inset-x-auto sm:top-auto sm:bottom-5 sm:right-5 z-[200] flex flex-col gap-2 items-stretch sm:items-end' },
      toasts.map(t => React.createElement('div', {
        key: t.id,
        'data-testid': 'toast',
        className: 'max-w-full flex items-center gap-2.5 px-4 py-3 bg-primary-container text-white text-sm rounded-lg shadow-e3',
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

  // Autoridad unica de impresion automatica para comprobantes.
  function useReceiptAutoPrint(delay = 350) {
    const printed = useRef(false);
    useEffect(() => {
      if (printed.current || !window.CONFIG || !window.CONFIG.get('print.auto')) return undefined;
      printed.current = true;
      const timer = setTimeout(() => window.print(), delay);
      return () => clearTimeout(timer);
    }, [delay]);
  }

  // Primitivas de composición H-87. No contienen reglas de negocio: únicamente
  // normalizan ancho, reflujo, jerarquía y recuperación del contenido.
  function Page({ children, className = '', compact = false }) {
    return React.createElement('div', { className: 'w-full min-w-0 mx-auto ' + (compact ? 'px-4 py-5 sm:px-6 sm:py-6 ' : 'px-4 py-6 sm:px-6 lg:px-10 lg:py-10 ') + className }, children);
  }
  function Toolbar({ children, className = '' }) {
    return React.createElement('div', { className: 'flex flex-col sm:flex-row sm:items-center gap-3 sm:flex-wrap min-w-0 ' + className }, children);
  }
  function ActionGroup({ children, className = '', end = false }) {
    return React.createElement('div', { className: 'flex flex-wrap items-center gap-2 min-w-0 ' + (end ? 'sm:ml-auto ' : '') + className }, children);
  }
  function KPI({ label, value, unit, helper, icon, tone = 'neutral', className = '', testId }) {
    const MS = window.HX && window.HX.MS;
    const tones = { neutral: 'bg-surface-container text-on-surface-variant', gold: 'bg-gold-soft text-gold-text', success: 'bg-success-soft text-success', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger' };
    return React.createElement('article', { className: 'min-w-0 rounded-xl bg-surface-container-lowest p-4 sm:p-5 shadow-e1 ' + className, 'data-responsive-kpi': 'true' }, [
      React.createElement('div', { key: 'top', className: 'flex items-start gap-3 min-w-0' }, [
        icon && MS ? React.createElement('div', { key: 'icon', className: 'w-11 h-11 shrink-0 rounded-xl grid place-items-center ' + (tones[tone] || tones.neutral) }, React.createElement(MS, { name: icon, size: 21 })) : null,
        React.createElement('div', { key: 'copy', className: 'min-w-0 flex-1' }, [
          React.createElement('p', { key: 'label', className: 'text-overline uppercase tracking-wider text-on-surface-variant leading-4 whitespace-normal' }, label),
          React.createElement('div', { key: 'amount', className: 'mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0 min-w-0' }, [
            React.createElement('span', { key: 'value', className: 'min-w-0 max-w-full font-headline text-primary leading-tight [font-size:clamp(1.35rem,5.5vw,2rem)] [overflow-wrap:anywhere]', 'data-kpi-value': 'true', 'data-testid': testId }, String(value == null ? '' : value)),
            unit ? React.createElement('span', { key: 'unit', className: 'text-overline font-semibold text-on-surface-variant whitespace-nowrap' }, unit) : null,
          ]),
        ]),
      ]),
      helper ? React.createElement('div', { key: 'helper', className: 'mt-2 text-caption text-on-surface-variant whitespace-normal' }, helper) : null,
    ]);
  }
  function Drawer({ title, onClose, children, footer, open = true, testId }) {
    const panelRef = useRef(null);
    useEffect(() => {
      if (!open) return undefined;
      const previous = document.activeElement;
      const onKey = event => { if (event.key === 'Escape') onClose(); };
      window.addEventListener('keydown', onKey);
      requestAnimationFrame(() => panelRef.current && panelRef.current.focus());
      return () => { window.removeEventListener('keydown', onKey); if (previous && previous.focus) previous.focus(); };
    }, [open, onClose]);
    if (!open) return null;
    return React.createElement(React.Fragment, null, [
      React.createElement('button', { key: 'backdrop', className: 'fixed inset-0 z-[55] bg-on-surface/35', onClick: onClose, 'aria-label': 'Cerrar panel', tabIndex: -1 }),
      React.createElement('aside', { key: 'panel', ref: panelRef, tabIndex: -1, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, 'data-testid': testId, className: 'fixed inset-0 sm:inset-y-0 sm:left-auto sm:right-0 z-[60] w-full sm:max-w-[460px] bg-surface border-l border-outline-variant shadow-e3 flex flex-col min-w-0' }, [
        React.createElement('header', { key: 'head', className: 'min-h-16 flex items-center gap-3 px-4 sm:px-6 border-b border-outline-variant' }, [
          React.createElement('h2', { key: 'title', className: 'flex-1 min-w-0 font-headline text-headline-md text-primary' }, title),
          React.createElement('button', { key: 'close', className: 'w-11 h-11 grid place-items-center rounded-lg hover:bg-surface-container', onClick: onClose, 'aria-label': 'Cerrar' }, React.createElement(window.HX.MS, { name: 'close', size: 20 })),
        ]),
        React.createElement('div', { key: 'body', className: 'flex-1 min-h-0 min-w-0 overflow-y-auto p-4 sm:p-6' }, children),
        footer ? React.createElement('footer', { key: 'footer', className: 'flex flex-wrap justify-end gap-2 px-4 sm:px-6 py-3 border-t border-outline-variant' }, footer) : null,
      ]),
    ]);
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
        if (e.key !== 'Tab') return;
        const nodes = focusable(); if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      };
      window.addEventListener('keydown', h);
      requestAnimationFrame(() => {
        const target = panelRef.current && (panelRef.current.querySelector('[data-autofocus]') || focusable()[0]);
        if (target) target.focus();
      });
      return () => {
        window.removeEventListener('keydown', h);
        if (previousFocus.current && previousFocus.current.focus) previousFocus.current.focus();
      };
    }, [productForm]);
    return React.createElement('div', {
      className: 'fixed inset-0 z-[150] bg-on-surface/40 backdrop-blur-sm flex items-center justify-center ' + (productForm ? 'p-0 sm:p-4' : 'p-4'),
      onClick: onClose,
    },
      React.createElement('div', {
        ref: panelRef,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': testId ? testId + '-title' : undefined,
        className: 'bg-surface-container-lowest shadow-e3 w-full min-w-0 flex flex-col ' +
          (productForm ? 'h-[100dvh] max-h-[100dvh] rounded-none sm:h-auto sm:max-h-[94vh] sm:rounded-xl max-w-6xl' :
            'rounded-xl max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] ' + (large ? 'sm:max-w-3xl' : 'sm:max-w-md')),
        'data-testid': testId,
        onClick: e => e.stopPropagation(),
      }, [
        React.createElement('div', { key: 'h', className: 'flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-outline-variant' }, [
          React.createElement('div', { key: 't', id: testId ? testId + '-title' : undefined, className: 'flex-1 min-w-0 font-headline text-lg sm:text-headline-md text-primary' }, title),
          React.createElement('button', {
            key: 'x', className: 'w-11 h-11 shrink-0 grid place-items-center text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors', onClick: onClose,
            'aria-label': 'Cerrar', 'data-testid': testId ? testId + '-close' : undefined,
          }, React.createElement(window.HX.MS, { name: 'close', size: 20 })),
        ]),
        React.createElement('div', { key: 'b', className: (productForm ? 'px-4 sm:px-6 py-4 sm:py-5' : 'px-4 sm:px-6 py-4 sm:py-5') + ' min-w-0 overflow-y-auto', 'data-testid': testId ? testId + '-body' : undefined }, children),
        footer && React.createElement('div', { key: 'f', className: 'flex flex-wrap items-center justify-end gap-2 sm:gap-3 px-4 sm:px-6 py-3 sm:py-4 border-t border-outline-variant', 'data-testid': testId ? testId + '-footer' : undefined }, footer),
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
      className: 'w-11 h-11 flex items-center justify-center rounded-lg border text-overline font-bold transition-colors ' +
        (active ? 'bg-primary text-on-primary border-primary' : 'border-outline-variant ' + (disabled ? 'opacity-30 cursor-not-allowed' : 'hover:bg-surface-container')),
    }, content);
    return React.createElement('div', { className: 'flex items-center gap-1' }, [
      cell('prev', React.createElement(MS, { name: 'chevLeft', size: 16 }), { disabled: page <= 1, onClick: page > 1 ? () => onPage(page - 1) : null }),
      ...nums.map(n => cell('p' + n, String(n), { active: n === page, onClick: () => onPage(n) })),
      cell('next', React.createElement(MS, { name: 'chevRight', size: 16 }), { disabled: page >= pages, onClick: page < pages ? () => onPage(page + 1) : null }),
    ]);
  }

  window.UI = { fmt, fechaCorta, fechaHora, Badge, StatusBadge, StockBadge, ProductThumb, ToastHost, toast, Page, Toolbar, ActionGroup, KPI, Drawer, Modal, BADGE_TONE, Pager, Segment, resizeImageFile, imageFileDimensions, useSyncActivity, useSyncFocusActivity, useReceiptAutoPrint };
})();
