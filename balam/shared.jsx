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

  // H-134: autoridad única de mensajes visibles. Los módulos pueden conservar
  // códigos y diagnósticos para soporte, pero nunca deben imprimirlos como la
  // explicación principal para quien opera BALAM.
  const MESSAGE_LEVEL = {
    neutral: { color: 'var(--outline)', tone: 'text-on-surface-variant' },
    success: { color: 'var(--success)', tone: 'text-success' },
    warning: { color: 'var(--warning)', tone: 'text-warning' },
    danger: { color: 'var(--danger)', tone: 'text-danger' },
  };
  const TECHNICAL_JARGON = /\b(?:v[123]|products?\.id|uuid|barcode_code|reference_family_id|rpc|rls|supabase|tombstones?|epochs?|protocol(?:o)?|rebootstrap|cach[eé]|colas?|json|hid|code\s*128|m[oó]dulos?|encoding|namespace|manifest|hash|commit|sha(?:-?256)?|schemas?|payload|sql|localstorage|fallback|alias|resolver|sync_activity|pgrst\w*|jwt|http\s*\d{3})\b|\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
  const MESSAGE_CATALOG = {
    inventory: {
      title: 'No hay existencias suficientes',
      explanation: 'La cantidad disponible cambió antes de completar la operación.',
      action: 'Revisa las existencias y ajusta la cantidad.', level: 'warning',
    },
    auth: {
      title: 'Tu sesión necesita renovarse',
      explanation: 'BALAM no pudo confirmar tu acceso.',
      action: 'Inicia sesión nuevamente y vuelve a intentarlo.', level: 'warning',
    },
    permission: {
      title: 'No tienes permiso para esta acción',
      explanation: 'La operación fue detenida para proteger la información.',
      action: 'Pide a una persona administradora que revise tu acceso.', level: 'danger',
    },
    network: {
      title: 'No hay conexión en este momento',
      explanation: 'Tu cambio permanece protegido en este equipo.',
      action: 'Puedes seguir trabajando; BALAM lo enviará cuando vuelva la conexión.', level: 'warning',
    },
    server: {
      title: 'El servicio no respondió',
      explanation: 'BALAM no pudo completar la comunicación en este momento.',
      action: 'Espera un momento y vuelve a intentarlo.', level: 'warning',
    },
    service_configuration: {
      title: 'El servicio necesita mantenimiento',
      explanation: 'BALAM detuvo la operación porque una parte del servicio no está disponible.',
      action: 'Pide a una persona administradora que reporte el problema a soporte.', level: 'danger',
    },
    compatibility: {
      title: 'Este equipo necesita actualizar su información',
      explanation: 'La información compartida cambió y BALAM detuvo nuevas escrituras para evitar errores.',
      action: 'Abre Centro de equipos y elige “Actualizar este equipo”.', level: 'danger',
    },
    conflict: {
      title: 'Otra terminal guardó un cambio primero',
      explanation: 'BALAM detuvo esta operación para no sobrescribir información reciente.',
      action: 'Actualiza la pantalla, revisa los datos y vuelve a intentarlo.', level: 'warning',
    },
    data: {
      title: 'Hay información que necesita revisión',
      explanation: 'BALAM detuvo la operación porque encontró datos incompletos o incompatibles.',
      action: 'Revisa los campos marcados; si persiste, pide ayuda a una persona administradora.', level: 'danger',
    },
    storage: {
      title: 'Este equipo tiene poco espacio disponible',
      explanation: 'BALAM conserva el cambio abierto para evitar perderlo.',
      action: 'No cierres esta pestaña, libera espacio y vuelve a intentarlo.', level: 'danger',
    },
    barcode_ambiguous: {
      title: 'El código identifica más de un producto',
      explanation: 'BALAM detuvo la selección para evitar mover la pieza equivocada.',
      action: 'Busca el producto por nombre y confirma sus características.', level: 'warning',
    },
    product_queue_pending: {
      title: 'Hay cambios pendientes de enviar',
      explanation: 'Espera a que se guarden los cambios de este equipo antes de eliminar productos.',
      action: 'Conéctate a internet. Si el aviso continúa, revisa los pendientes en Centro de equipos.', level: 'warning',
    },
    layaway_active: {
      title: 'Este producto está en un apartado activo',
      explanation: 'La pieza sigue comprometida con un cliente.',
      action: 'Liquida o cancela el apartado antes de eliminar el producto.', level: 'warning',
    },
    layaway_product_locked: {
      title: 'Se está confirmando el cobro de un apartado',
      explanation: 'Todavía no se puede confirmar si la pieza salió del inventario.',
      action: 'Espera a que termine la confirmación antes de eliminar el producto.', level: 'warning',
    },
    product_open_loan: {
      title: 'Este producto está en un préstamo abierto',
      explanation: 'Hay piezas prestadas que todavía no se han devuelto ni registrado como faltantes.',
      action: 'Resuelve esas piezas en Préstamos antes de eliminar el producto.', level: 'warning',
    },
    product_returnable_history: {
      title: 'Este producto aún admite devolución o cambio',
      explanation: 'BALAM necesita conservarlo para poder recibir la pieza si el cliente la devuelve.',
      action: 'Podrás eliminarlo cuando ya no queden piezas con devolución o cambio vigente.', level: 'warning',
    },
    product_not_found: {
      title: 'El producto ya no está en el inventario',
      explanation: 'No se encontró el producto que intentas eliminar.',
      action: 'Cierra el detalle y vuelve a buscarlo en Inventario.', level: 'warning',
    },
    reference_family_scope_mismatch: {
      title: 'Los productos de esta familia cambiaron',
      explanation: 'La selección ya no coincide con la familia actual.',
      action: 'Cierra el detalle y abre la familia de nuevo antes de eliminar.', level: 'warning',
    },
    product_delete_queue_unavailable: {
      title: 'No se pudo guardar la eliminación en este equipo',
      explanation: 'El producto permanece en el inventario.',
      action: 'Revisa si tienes otra pestaña de BALAM abierta. Si continúa, pide ayuda a una persona administradora.', level: 'warning',
    },
    barcode_not_found: {
      title: 'No encontramos un producto con este código',
      explanation: 'El código leído no coincide con los productos registrados en este equipo.',
      action: 'Busca el producto por nombre y revisa su etiqueta antes de intentar de nuevo.', level: 'warning',
    },
    barcode_missing: {
      title: 'Esta pieza no tiene un código válido',
      explanation: 'La etiqueta no puede generarse de forma segura.',
      action: 'Abre el producto y corrige su identificación antes de imprimir.', level: 'danger',
    },
    label_density: {
      title: 'El código quedaría demasiado apretado',
      explanation: 'Algunas lectoras podrían no reconocer la etiqueta impresa.',
      action: 'No imprimas esta etiqueta; corrige la identificación del producto.', level: 'danger',
    },
    label_encoding: {
      title: 'El código contiene caracteres no admitidos',
      explanation: 'BALAM no puede crear una etiqueta legible con ese valor.',
      action: 'Corrige la identificación del producto y vuelve a generar la etiqueta.', level: 'danger',
    },
    label_generation: {
      title: 'No se pudo crear la imagen de la etiqueta',
      explanation: 'BALAM detuvo este archivo para no entregar una etiqueta incompleta.',
      action: 'Vuelve a generar la etiqueta; si continúa, pide ayuda a soporte.', level: 'danger',
    },
    file_format: {
      title: 'El archivo no tiene el formato esperado',
      explanation: 'BALAM no puede relacionar algunas filas con el inventario de forma segura.',
      action: 'Descarga una plantilla nueva, copia tus datos y vuelve a importarla.', level: 'danger',
    },
    update_safety: {
      title: 'La actualización está en espera',
      explanation: 'Hay trabajo pendiente que debe protegerse antes de actualizar.',
      action: 'Termina o sincroniza los cambios pendientes y vuelve a intentarlo.', level: 'warning',
    },
    unknown: {
      title: 'No se pudo completar la acción',
      explanation: 'BALAM detuvo la operación para proteger la información.',
      action: 'Inténtalo nuevamente; si continúa, pide ayuda a una persona administradora.', level: 'danger',
    },
  };
  function technicalMessageViewer() {
    try {
      const role = window.AUTH && window.AUTH.role && window.AUTH.role();
      return !!(window.AUTH && window.AUTH.isAdmin && window.AUTH.isAdmin()) || role === 'support';
    } catch (error) { return false; }
  }
  function messageTechnicalText(input) {
    if (input == null) return '';
    if (typeof input === 'string') return input;
    if (input instanceof Error) return [input.name, input.message, input.code].filter(Boolean).join(' · ');
    try { return JSON.stringify(input, null, 2); } catch (error) { return String(input); }
  }
  function classifyUserMessage(input) {
    const raw = typeof input === 'string' ? input : ((input && (input.message || input.error || input.reason)) || '');
    const code = String((input && input.code) || '').toLowerCase();
    const category = String((input && input.category) || '').toLowerCase();
    const all = `${code} ${category} ${raw}`.toLowerCase();
    if (input && input.context === 'product_delete') {
      if (['product_queue_pending', 'layaway_active', 'layaway_product_locked',
        'product_open_loan', 'product_returnable_history', 'product_not_found',
        'reference_family_scope_mismatch', 'product_delete_queue_unavailable'].includes(code)) return code;
      if (code === 'product_active_layaway') return 'layaway_active';
    }
    if (/barcode.*ambiguous|identity_ambiguous|c[oó]digo ambiguo|m[aá]s de una referencia/.test(all)) return 'barcode_ambiguous';
    if (/barcode.*not_found/.test(all)) return 'barcode_not_found';
    if (/missing_barcode|barcode.*missing|falta.*(?:barcode|code128)|no tiene.*c[oó]digo/.test(all)) return 'barcode_missing';
    if (/density|\bdense\b|m[oó]dulo|demasiado.*(?:denso|apretado)/.test(all)) return 'label_density';
    if (/generation_error|png.*(?:failed|error)|no se pudo.*imagen/.test(all)) return 'label_generation';
    if (/encoding|code128|codificaci[oó]n/.test(all)) return 'label_encoding';
    if (/pgrst|schema cache|column .* does not exist|relation .* does not exist/.test(all) || category === 'schema') return 'service_configuration';
    if (/xlsx|excel|json|uuid|reference_|duplicate_(?:id|sku)|id_(?:not|required)|catalog_value|archivo.*(?:incompatible|versi[oó]n)/.test(all)) return 'file_format';
    if (/quota|storage|persist|durable|localstorage|indexeddb|espacio/.test(all)) return 'storage';
    if (/rebootstrap|protocol|epoch|compatib|actualizaci[oó]n.*espera/.test(all)) return 'compatibility';
    if (/activity_active|update.*(?:unsafe|blocked)|service.worker|trabajo pendiente.*actualizar/.test(all)) return 'update_safety';
    if (/insufficient_stock|waiting_inventory|sin stock|existencias? insuficientes?/.test(all) || category === 'inventory') return 'inventory';
    if (/401|jwt|not authenticated|unauthorized|sesi[oó]n|sign.?in/.test(all) || category === 'auth') return 'auth';
    if (/403|42501|rls|row.level|permission denied|forbidden|permiso/.test(all) || category === 'permission') return 'permission';
    if (/failed to fetch|network|load failed|fetch failed|sin conexi[oó]n|offline/.test(all) || category === 'network') return 'network';
    if (/http\s*5\d\d|server|servidor/.test(all) || category === 'server') return 'server';
    if (/conflict|mismatch|otra terminal|already_liquidated|folio_conflict/.test(all) || category === 'conflict') return 'conflict';
    if (/^23|constraint|invalid_|missing|not_found|incomplete|no existe/.test(all) || category === 'constraint' || category === 'data') return 'data';
    return 'unknown';
  }
  function messageAuthority(input, options = {}) {
    if (input && input.__humanMessage) return input;
    const raw = typeof input === 'string' ? input : ((input && (input.message || input.error || input.reason)) || '');
    const explicitCode = !!(input && typeof input === 'object' && (input.code || input.category || input.status));
    const unsafe = TECHNICAL_JARGON.test(String(raw)) || TECHNICAL_JARGON.test(String((input && input.code) || ''));
    const color = String(options.color || '');
    const hintedLevel = options.level || (color.includes('danger') ? 'danger' : color.includes('warning') ? 'warning' : color.includes('accent') || color.includes('success') ? 'success' : null);
    const customCopy = options.code || options.title || options.explanation || options.action;
    if (raw && !explicitCode && !unsafe && !customCopy) {
      return { __humanMessage: true, title: String(raw), explanation: '', action: '', level: hintedLevel || 'neutral', technicalDetails: '' };
    }
    const key = options.code && MESSAGE_CATALOG[options.code] ? options.code : classifyUserMessage(input);
    const base = MESSAGE_CATALOG[key] || MESSAGE_CATALOG.unknown;
    return {
      __humanMessage: true,
      title: options.title || base.title,
      explanation: options.explanation || base.explanation,
      action: options.action || base.action,
      level: options.level || base.level,
      technicalDetails: messageTechnicalText(input),
    };
  }
  function messageText(input, options) {
    const msg = messageAuthority(input, options);
    return [msg.title, msg.explanation, msg.action].filter(Boolean).join(' ');
  }
  function HumanMessage({ message, options = {}, className = '', inverse = false }) {
    const msg = messageAuthority(message, options);
    const style = MESSAGE_LEVEL[msg.level] || MESSAGE_LEVEL.neutral;
    return React.createElement('div', { className, 'data-message-level': msg.level }, [
      React.createElement('p', { key: 'title', className: 'font-semibold ' + (inverse ? 'text-white' : style.tone) }, msg.title),
      msg.explanation && React.createElement('p', { key: 'explanation', className: 'mt-1 ' + (inverse ? 'text-white/90' : 'text-on-surface-variant') }, msg.explanation),
      msg.action && React.createElement('p', { key: 'action', className: 'mt-1 font-medium ' + (inverse ? 'text-white' : 'text-on-surface') }, msg.action),
      technicalMessageViewer() && msg.technicalDetails && React.createElement('details', {
        key: 'technical', className: 'mt-2 text-overline ' + (inverse ? 'text-white/90' : 'text-on-surface-variant'), 'data-technical-details': 'true',
      }, [
        React.createElement('summary', { key: 'summary', className: 'cursor-pointer font-semibold' }, 'Detalles técnicos'),
        React.createElement('pre', { key: 'body', className: 'mt-1 whitespace-pre-wrap break-all font-mono' }, msg.technicalDetails),
      ]),
    ]);
  }

  // Toast system
  let pushToastFn = null;
  function ToastHost() {
    const [toasts, setToasts] = useState([]);
    useEffect(() => {
      pushToastFn = (input, color = 'var(--success)') => {
        const id = Math.random();
        const msg = messageAuthority(input, { color });
        // Un error nuevo sustituye al anterior del mismo nivel: evita que una
        // causa ya resuelta se mezcle visualmente con la siguiente acción.
        setToasts(t => [...t.filter(existing => existing.msg.level !== msg.level), { id, msg, color: (MESSAGE_LEVEL[msg.level] || {}).color || color }]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), msg.level === 'danger' || msg.level === 'warning' ? 5200 : 3000);
      };
    }, []);
    return React.createElement('div', { className: 'fixed top-4 inset-x-4 sm:inset-x-auto sm:top-auto sm:bottom-5 sm:right-5 z-[200] flex flex-col gap-2 items-stretch sm:items-end' },
      toasts.map(t => React.createElement('div', {
        key: t.id,
        'data-testid': 'toast',
        className: 'max-w-full flex items-center gap-2.5 px-4 py-3 bg-primary-container text-white text-sm rounded-lg shadow-e3',
      }, [
        React.createElement('span', { key: 'd', className: 'w-2 h-2 rounded-full shrink-0', style: { background: t.color } }),
        React.createElement(HumanMessage, { key: 'm', message: t.msg, className: 'min-w-0', inverse: true }),
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
  function useSyncFocusActivity(domains, detail, enabled = true, passiveSelector = null) {
    const token = React.useRef(null);
    const list = Array.isArray(domains) ? domains : [domains];
    const isPassive = target => !!(passiveSelector && target && target.closest && target.closest(passiveSelector));
    useEffect(() => {
      if (!enabled && token.current && window.CORE && window.CORE.endActivity) {
        window.CORE.endActivity(token.current); token.current = null;
      }
    }, [!!enabled]);
    useEffect(() => () => {
      if (token.current && window.CORE && window.CORE.endActivity) window.CORE.endActivity(token.current);
      token.current = null;
    }, []);
    return {
      onFocusCapture(event) {
        if (!enabled) return;
        // Device recovery controls must not count as a configuration edit.
        // Release only this hook's token; other forms/operations stay protected.
        if (isPassive(event.target)) {
          if (token.current && window.CORE && window.CORE.endActivity) window.CORE.endActivity(token.current);
          token.current = null;
          return;
        }
        if (!token.current && window.CORE && window.CORE.beginActivity) token.current = window.CORE.beginActivity(list, detail || null);
      },
      onBlurCapture(event) {
        const root = event.currentTarget;
        setTimeout(() => {
          if (root && root.contains && root.contains(document.activeElement) && !isPassive(document.activeElement)) return;
          if (token.current && window.CORE && window.CORE.endActivity) window.CORE.endActivity(token.current);
          token.current = null;
        }, 0);
      },
    };
  }

  // H-143/H-144: salida RawBT del comprobante histórico montado. El PNG
  // conserva el diseño existente; nunca se reconstruye desde el catálogo.
  const usesBluetoothReceipt = () => /Android/i.test(navigator.userAgent || '');
  const receiptBluetoothHelp = 'Para papel de 80 mm: abre los ajustes de tu impresora en RawBT y selecciona 576 puntos en el ancho de impresión.';
  const receiptGraphics = new WeakMap();
  const receiptResourceData = new Map();
  async function receiptLocalData(url) {
    if (url.startsWith('data:')) return url;
    if (!url.startsWith('blob:')) throw new Error('El diseño contiene un recurso que no está disponible sin conexión. Reimprime el comprobante desde una computadora.');
    if (!receiptResourceData.has(url)) {
      const work = fetch(url).then(r => r.blob()).then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
      }));
      receiptResourceData.set(url, work);
      work.catch(() => receiptResourceData.delete(url));
    }
    return receiptResourceData.get(url);
  }
  async function receiptGraphic(element) {
    const doc = element.ownerDocument;
    // Aplicar las mismas reglas de impresión, incluidas fuentes y Tailwind.
    const rules = [];
    const visit = list => Array.from(list).forEach(rule => {
      if (rule.type === 4 && /\bprint\b/.test(rule.conditionText)) visit(rule.cssRules);
      else rules.push(rule.cssText);
    });
    Array.from(doc.styleSheets).forEach(sheet => visit(sheet.cssRules));
    let css = rules.join('\n');
    const urls = [...new Set(Array.from(css.matchAll(/url\(["']?([^"')]+)["']?\)/g), m => m[1]))];
    for (const url of urls) css = css.split(url).join(await receiptLocalData(url));
    const copy = element.cloneNode(true);
    copy.querySelectorAll('script,iframe,object,embed,button').forEach(node => node.remove());
    for (const node of [copy, ...copy.querySelectorAll('*')]) {
      for (const attr of Array.from(node.attributes)) if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
      if (node.tagName === 'IMG') { node.removeAttribute('srcset'); node.src = await receiptLocalData(node.currentSrc || node.src); }
    }
    // La caja física no depende del tamaño de pantalla ni del scroll del POS.
    copy.style.setProperty('position', 'static', 'important');
    copy.style.setProperty('margin', '0', 'important');
    css += '\nhtml,body{width:80mm!important;margin:0!important;padding:0!important;height:auto!important;min-height:0!important;overflow:visible!important;background:white!important}';
    // H-145: separadores negros en la copia térmica; Chrome conserva su diseño.
    css += '\nbody *{border-color:#000!important}';
    const frame = doc.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('sandbox', 'allow-same-origin');
    frame.style.cssText = 'position:absolute;left:-100000px;top:0;width:80mm;height:1px;border:0;';
    doc.body.appendChild(frame);
    try {
      const rendered = frame.contentDocument;
      const style = rendered.createElement('style'); style.textContent = css; rendered.head.appendChild(style);
      rendered.body.appendChild(rendered.importNode(copy, true));
      await rendered.fonts.ready;
      await Promise.all(Array.from(rendered.images, img => img.decode()));
      const box = rendered.body.firstElementChild.getBoundingClientRect();
      // El rollo es de 80 mm, el cabezal de 576 puntos (72 mm a 203 dpi).
      // No gastar esos puntos en los márgenes de la hoja CSS. Conservar 1 px
      // de resguardo por lado y ampliar el contenido de forma proporcional.
      const root = rendered.body.firstElementChild;
      const content = root.matches('#balam-ticket, #balam-return-receipt') ? root.firstElementChild : root;
      const padding = rendered.defaultView.getComputedStyle(content);
      const left = Math.max(0, parseFloat(padding.paddingLeft) - 1);
      const right = Math.max(0, parseFloat(padding.paddingRight) - 1);
      const usable = box.width - left - right;
      const width = 576, height = Math.ceil(Math.max(box.height, rendered.body.scrollHeight) * width / usable);
      if (!height || height > 24000) throw new Error('El comprobante es demasiado largo para Bluetooth. Reimprime el comprobante desde una computadora.');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${left} 0 ${usable} ${height * usable / width}"><foreignObject width="${box.width}" height="100%">${new XMLSerializer().serializeToString(rendered.documentElement)}</foreignObject></svg>`;
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await image.decode();
      const canvas = doc.createElement('canvas'); canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); ctx.drawImage(image, 0, 0);
      // Negro/blanco sólidos: evitar letras grises tramadas por RawBT. Sub por
      // fila conserva un PNG pequeño sin reducir geometría ni contenido.
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const rows = new Uint8Array((width + 1) * height);
      for (let y = 0; y < height; y++) {
        rows[y * (width + 1)] = 1;
        let previous = 0;
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          const gray = pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722 < 200 ? 0 : 255;
          rows[y * (width + 1) + x + 1] = (gray - previous) & 255;
          previous = gray;
        }
      }
      const compressed = new Uint8Array(await new Response(new Blob([rows]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
      const chunk = (type, data) => {
        const bytes = new Uint8Array(data.length + 12), view = new DataView(bytes.buffer);
        view.setUint32(0, data.length); bytes.set(new TextEncoder().encode(type), 4); bytes.set(data, 8);
        let crc = 0xffffffff;
        for (let i = 4; i < bytes.length - 4; i++) {
          crc ^= bytes[i];
          for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
        }
        view.setUint32(bytes.length - 4, (crc ^ 0xffffffff) >>> 0);
        return bytes;
      };
      const header = new Uint8Array(13), size = new DataView(header.buffer);
      size.setUint32(0, width); size.setUint32(4, height); header[8] = 8;
      const file = new Blob([new Uint8Array([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array())], { type: 'image/png' });
      const png = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file);
      });
      if (png.length > 500000) throw new Error('El comprobante es demasiado largo para Bluetooth. Reimprime el comprobante desde una computadora.');
      return png;
    } finally { frame.remove(); }
  }
  function prepareReceipt(element = document.querySelector('#balam-ticket, #balam-return-receipt')) {
    if (!element) return null;
    const key = element.outerHTML;
    const previous = receiptGraphics.get(element);
    if (previous && previous.key === key && !previous.error) return previous;
    const state = { key, png: null, error: null, promise: null };
    receiptGraphics.set(element, state);
    state.promise = Promise.resolve().then(() => {
      // Mantener las guardas de documento vacío y tamaño antes de rasterizar.
      if (receiptPrintText(element).length > 500000) throw new Error('El comprobante es demasiado largo para Bluetooth. Reimprime el comprobante desde una computadora.');
      return receiptGraphic(element);
    }).then(png => { state.png = png; }, error => {
      state.error = new Error(/^El (comprobante|diseño)/.test(error.message || '') ? error.message
        : 'No se pudo preparar el diseño. Vuelve a pulsar Imprimir o reimprime el comprobante desde una computadora.');
    });
    return state;
  }
  function receiptPrintText(element) {
    if (!element) throw new Error('El comprobante todavía no está disponible. Cierra y vuelve a abrirlo.');
    const doc = element.ownerDocument;
    const copy = element.cloneNode(true);
    copy.removeAttribute('id');
    copy.querySelectorAll('script,style,img,svg,button,.material-symbols-outlined,.material-symbols-rounded,.material-icons').forEach(node => node.remove());
    copy.style.cssText = 'position:absolute;left:-100000px;top:0;width:80mm;display:block;visibility:visible;';
    doc.body.appendChild(copy);
    try {
      // No permitir que campos históricos introduzcan comandos ESC/POS.
      const text = copy.innerText.replace(/\r\n?/g, '\n').replace(/\t/g, '  ')
        .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) throw new Error('El comprobante está vacío. Cierra y vuelve a abrirlo.');
      return text + '\n\n\n';
    } finally { copy.remove(); }
  }
  function printReceipt({ element, host = window, automatic = false, system = false } = {}) {
    const notice = message => {
      if (host === window) toast(message);
      else {
        let status = host.document.getElementById('receipt-print-status');
        if (!status) {
          status = host.document.createElement('p'); status.id = 'receipt-print-status';
          status.setAttribute('role', 'status'); status.style.cssText = 'padding:12px;margin:0;background:white;color:#131b2e;';
          host.document.querySelector('.tools').after(status);
        }
        status.textContent = message;
      }
    };
    try {
      if (!usesBluetoothReceipt() || system) { host.print(); return true; }
      // Chrome bloquea intents iniciados desde timers. Conservar acción manual.
      if (automatic) return false;
      const receipt = element || host.document.querySelector('#balam-ticket, #balam-return-receipt');
      if (!receipt) throw new Error('El comprobante todavía no está disponible. Cierra y vuelve a abrirlo.');
      const graphic = prepareReceipt(receipt);
      if (!graphic.png) {
        notice('Preparando el diseño del ticket…');
        graphic.promise.then(() => {
          if (!receipt.isConnected || host.closed || receiptGraphics.get(receipt) !== graphic) return;
          notice(graphic.error ? graphic.error.message : 'Diseño listo. Pulsa Imprimir para enviarlo a RawBT.');
        });
        return false;
      }
      const payload = graphic.png;
      const link = host.document.createElement('a');
      link.href = 'intent:' + payload + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
      host.document.body.appendChild(link);
      // Sin await, popup ni timer: conserva el gesto del botón original.
      try { link.click(); } finally { link.remove(); }
      notice('Abriendo RawBT. Si no se abre, comprueba que esté instalado y vuelve a pulsar Imprimir.');
      return true;
    } catch (error) {
      notice(error.message || 'No se pudo abrir la impresión. Vuelve a intentarlo.');
      return false;
    }
  }
  function ReceiptPrintHelp() {
    const [status, setStatus] = React.useState('Preparando el diseño del ticket…');
    React.useEffect(() => {
      if (!usesBluetoothReceipt()) return undefined;
      let active = true;
      const graphic = prepareReceipt();
      if (graphic) graphic.promise.then(() => { if (active) setStatus(graphic.error ? graphic.error.message : 'Impresión Bluetooth con el diseño del ticket.'); });
      return () => { active = false; };
    }, []);
    if (!usesBluetoothReceipt()) return null;
    return React.createElement('p', { className: 'text-caption text-on-surface-variant mt-3', 'data-testid': 'receipt-design-status' }, [
      status + ' ',
      React.createElement('span', { key: 'width', className: 'block mt-2' }, receiptBluetoothHelp),
    ]);
  }

  // Autoridad unica de impresion automatica para comprobantes.
  function useReceiptAutoPrint(delay = 350) {
    const printed = useRef(false);
    useEffect(() => {
      if (printed.current || !window.CONFIG || !window.CONFIG.get('print.auto')) return undefined;
      printed.current = true;
      const timer = setTimeout(() => printReceipt({ automatic: true }), delay);
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

  window.UI = { fmt, fechaCorta, fechaHora, Badge, StatusBadge, StockBadge, ProductThumb, ToastHost, toast, HumanMessage, messageAuthority, messageText, technicalMessageViewer, Page, Toolbar, ActionGroup, KPI, Drawer, Modal, BADGE_TONE, MESSAGE_LEVEL, Pager, Segment, resizeImageFile, imageFileDimensions, useSyncActivity, useSyncFocusActivity, useReceiptAutoPrint, usesBluetoothReceipt, receiptBluetoothHelp, receiptPrintText, prepareReceipt, printReceipt, ReceiptPrintHelp };
})();
