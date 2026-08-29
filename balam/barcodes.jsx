// barcodes.jsx — Code128: barcodeCode V2 y adaptador SKU-talla exclusivamente V1.
// Render on-demand con JsBarcode (offline, sin guardar nada). El guardado de PNG en
// Supabase Storage es OPCIONAL y explícito (ver inventory.jsx → "Guardar imagen").
(function () {
  const D = window.DATA;
  const h = React.createElement;
  const { useRef, useEffect } = React;

  // Opciones base Code 128B (legibles para etiqueta térmica).
  const BASE_OPTS = { format: 'CODE128', width: 2, height: 80, displayValue: true, fontSize: 14, margin: 10, font: 'monospace' };

  // H-127: contrato físico único de la etiqueta. Preview, PNG, PDF,
  // impresión y diagnóstico consumen estos mismos valores; no existe un
  // canvas auxiliar con otra anchura o márgenes para decidir legibilidad.
  // H-128 aumenta únicamente la altura de barras y elimina el margen vertical
  // interno. Ancho, X, quiet zones horizontales e identidad quedan intactos.
  const LABEL_60X40 = Object.freeze({
    labelWidthMm: 60,
    labelHeightMm: 40,
    symbolBox: Object.freeze({ xMm: 2, yMm: 7.3, widthMm: 56, heightMm: 15, fit: 'xMidYMid meet' }),
    barcodeOptions: Object.freeze({
      format: 'CODE128', width: 2, height: 100, displayValue: false,
      fontSize: 13, margin: 4, marginTop: 0, marginBottom: 0, font: 'monospace',
    }),
    raster: Object.freeze({ widthPx: 720, heightPx: 480, jpegQuality: 0.96 }),
    minModuleMm: 0.25,
    nearModuleMm: 0.275,
  });

  // String del código por pieza: reemplaza el marcador de talla del SKU base (SIZE_MARK, ver
  // data.jsx / Constructor de SKU) por la talla real, respetando la POSICIÓN que fijó el admin.
  // Ej. base "21-ML-ALG-T-128" + talla "38" → "21-ML-ALG-38-128".
  // Respaldo (SKUs viejos sin marcador): la talla se pega al final, como antes.
  function codeOf(p, talla) {
    if (D && D.isV2Reference && D.isV2Reference(p)) return String(p.barcodeCode || '').toUpperCase();
    return D.materializedSku(p, talla);
  }

  // Parseo heurístico (solo para saber si algo "parece" un código): la talla suele ir después del
  // último guion. NO se usa para localizar el producto — de eso se encarga find() por coincidencia.
  function parse(code) {
    const s = String(code || '').trim().toUpperCase();
    if (/^B[A-F0-9]{15}$/.test(s)) return { barcodeCode: s, model: 'v2' };
    const i = s.lastIndexOf('-');
    if (i <= 0 || i === s.length - 1) return null;
    return { sku: s.slice(0, i), talla: s.slice(i + 1) };
  }

  // Encuentra { p, talla } a partir de un código escaneado, buscando en memoria (sin red).
  // Por COINCIDENCIA: compara el código contra codeOf(p, talla) de cada producto/talla. Así funciona
  // con la talla en cualquier posición del SKU y sigue leyendo etiquetas viejas (talla al final).
  function resolveExact(s) {
    const prods = D.products || [];
    const matches = [];
    prods.filter(p => p && !p._deletedAt).forEach(p => {
      if (D.isV2Reference && D.isV2Reference(p)) {
        if (String(p.barcodeCode || '').toUpperCase() === s) matches.push({ p, talla: p.sizeCode, productId: p.id });
        return;
      }
      D.resolveProductSizes(p).sizes.filter(size => size.active && size.stock > 0).forEach(size => {
        if (codeOf(p, size.value) === s) matches.push({ p, talla: size.value, productId: p.id, legacy: true });
      });
    });
    if (matches.length === 1) return { ok: true, hit: matches[0], matches };
    return { ok: false, code: matches.length > 1 ? 'BARCODE_AMBIGUOUS' : 'BARCODE_NOT_FOUND', matches };
  }

  function resolve(code) {
    const s = String(code || '').trim().toUpperCase();
    if (!s) return { ok: false, code: 'BARCODE_EMPTY', matches: [] };

    // Los lectores USB HID emulan un teclado. Si la distribución del sistema no
    // coincide con la configurada en el lector, la tecla física «-» puede llegar
    // como "'". Primero se respeta SIEMPRE el código literal; sólo cuando no existe
    // se intenta el equivalente con guiones. No se modifica ningún SKU ni producto.
    const exact = resolveExact(s);
    if (exact.code !== 'BARCODE_NOT_FOUND' || !s.includes("'")) return exact;
    return resolveExact(s.split("'").join('-'));
  }

  // Un lector HID envía posiciones físicas de teclado. En una distribución
  // distinta, `Minus` puede llegar como apóstrofe y `Slash` como guion aunque el
  // texto Code128 contenga `-` y `/`, respectivamente. La adaptación ocurre antes
  // de pintar/acumular la tecla; los caracteres ya correctos se conservan y
  // ninguna identidad se reescribe.
  function scannerChar(event) {
    const key = String(event && event.key != null ? event.key : '');
    const code = String(event && event.code != null ? event.code : '');
    const legacyCode = Number(event && (event.keyCode || event.which)) || 0;
    const modified = !!(event && (event.ctrlKey || event.metaKey || event.altKey));
    const physicalMinus = code === 'Minus' || (!code && legacyCode === 189);
    const physicalSlash = code === 'Slash' || (!code && legacyCode === 191);
    if (!modified && key === "'" && physicalMinus) return '-';
    if (!modified && key === '-' && physicalSlash) return '/';
    return key;
  }

  // Intercepta exclusivamente las sustituciones físicas anteriores en un input
  // controlado por React. Devuelve true cuando consumió la tecla.
  function consumeScannerInputKey(event, commit) {
    const key = scannerChar(event);
    const original = String(event && event.key != null ? event.key : '');
    const target = event && (event.currentTarget || event.target);
    if (!target || key === original || typeof commit !== 'function') return false;
    const value = String(target.value == null ? '' : target.value);
    const start = Number.isInteger(target.selectionStart) ? target.selectionStart : value.length;
    const end = Number.isInteger(target.selectionEnd) ? target.selectionEnd : start;
    const next = value.slice(0, start) + key + value.slice(end);
    if (typeof event.preventDefault === 'function') event.preventDefault();
    commit(next);
    const caret = start + key.length;
    if (typeof target.setSelectionRange === 'function' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        try { target.setSelectionRange(caret, caret); } catch (error) {}
      });
    }
    return true;
  }

  // Una captura global puede caer en cualquier input antes de que Enter confirme
  // que la ráfaga era un código conocido. Entonces retira exactamente el texto
  // crudo que tecleó el lector; no interviene sobre ráfagas desconocidas.
  function removeScannerText(el, rawCode) {
    if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return false;
    const code = String(rawCode == null ? '' : rawCode);
    const value = String(el.value == null ? '' : el.value);
    if (!code || !value.toUpperCase().endsWith(code.toUpperCase())) return false;
    const proto = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (!descriptor || typeof descriptor.set !== 'function') return false;
    descriptor.set.call(el, value.slice(0, value.length - code.length));
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  let lastResolution = null;
  function find(code) {
    lastResolution = resolve(code);
    return lastResolution.ok ? lastResolution.hit : null;
  }

  const ready = () => typeof window.JsBarcode === 'function';

  // Dibuja el código en un <svg> o <canvas> existente. Devuelve true/false.
  function draw(el, code, opts) {
    if (!ready() || !el) return false;
    try { window.JsBarcode(el, code, Object.assign({}, BASE_OPTS, opts)); return true; }
    catch (e) { return false; }
  }

  // Componente React: <svg> responsivo (escala al contenedor vía viewBox, no se desborda).
  function Barcode({ code, opts, className, style }) {
    const ref = useRef(null);
    useEffect(() => {
      const el = ref.current; if (!el) return;
      if (draw(el, code, opts)) {
        const w = el.getAttribute('width'), hgt = el.getAttribute('height');
        if (w && hgt) {
          el.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
          el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
          el.removeAttribute('width'); el.removeAttribute('height');
        }
      }
    }, [code, JSON.stringify(opts || {})]);
    return h('svg', { ref, className: className || '', style: Object.assign({ display: 'block', width: '100%', height: 'auto' }, style || {}) });
  }

  // PNG como data URL (para incrustar <img> en la ventana de impresión). Síncrono; '' si falla.
  function toPNGDataURL(code, opts) {
    if (!ready()) return '';
    const canvas = document.createElement('canvas');
    try { window.JsBarcode(canvas, code, Object.assign({}, BASE_OPTS, opts)); return canvas.toDataURL('image/png'); }
    catch (e) { return ''; }
  }

  // PNG como Blob (para subir a Supabase Storage). Promesa.
  function toPNGBlob(code, opts) {
    return new Promise((resolve, reject) => {
      if (!ready()) return reject(new Error('JsBarcode no disponible'));
      const canvas = document.createElement('canvas');
      try { window.JsBarcode(canvas, code, Object.assign({}, BASE_OPTS, opts)); }
      catch (e) { return reject(e); }
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo generar la imagen PNG')), 'image/png');
    });
  }

  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  function physicalMargins(options) {
    const margin = finite(options.margin, 0);
    return {
      left: finite(options.marginLeft, margin), right: finite(options.marginRight, margin),
      top: finite(options.marginTop, margin), bottom: finite(options.marginBottom, margin),
    };
  }

  // Inspecciona el PNG real que se contiene dentro del SVG maestro. `modules`
  // excluye los márgenes de JsBarcode; X, alto y quiet zones ya incluyen la
  // escala `meet` efectiva. El umbral contractual permanece en 0.25 mm.
  function inspectLabelCode(code, contract = LABEL_60X40) {
    const value = String(code == null ? '' : code);
    const box = contract.symbolBox;
    const raster = contract.raster;
    const minModuleMm = finite(contract.minModuleMm, 0.25);
    const nearModuleMm = Math.max(minModuleMm, finite(contract.nearModuleMm, minModuleMm));
    const base = {
      code: value,
      chars: Array.from(value).length,
      availableWidthMm: box.widthMm,
      availableHeightMm: box.heightMm,
      minModuleMm,
      nearModuleMm,
      pdfDpi: raster.widthPx / contract.labelWidthMm * 25.4,
      pdfDpiX: raster.widthPx / contract.labelWidthMm * 25.4,
      pdfDpiY: raster.heightPx / contract.labelHeightMm * 25.4,
    };
    if (!value) return Object.assign(base, {
      ok: false, status: 'MISSING_BARCODE', reason: 'No hay texto Code128 para generar la etiqueta.',
      modules: 0, moduleMm: 0, barHeightMm: 0, quietZoneLeftMm: 0, quietZoneRightMm: 0,
    });
    if (!ready()) return Object.assign(base, {
      ok: false, status: 'GENERATION_ERROR', reason: 'JsBarcode no disponible.',
      modules: 0, moduleMm: 0, barHeightMm: 0, quietZoneLeftMm: 0, quietZoneRightMm: 0,
    });
    const options = Object.assign({}, BASE_OPTS, contract.barcodeOptions);
    const margins = physicalMargins(options);
    const canvas = document.createElement('canvas');
    try {
      window.JsBarcode(canvas, value, options);
      const moduleWidthPx = finite(options.width, BASE_OPTS.width);
      const encodedWidthPx = canvas.width - margins.left - margins.right;
      const modules = encodedWidthPx > 0 && moduleWidthPx > 0 ? Math.round(encodedWidthPx / moduleWidthPx) : 0;
      const scaleMmPerPx = Math.min(box.widthMm / canvas.width, box.heightMm / canvas.height);
      const renderedWidthMm = canvas.width * scaleMmPerPx;
      const renderedHeightMm = canvas.height * scaleMmPerPx;
      const centeredLeftMm = box.xMm + (box.widthMm - renderedWidthMm) / 2;
      const centeredRightMm = contract.labelWidthMm - box.xMm - box.widthMm + (box.widthMm - renderedWidthMm) / 2;
      const moduleMm = moduleWidthPx * scaleMmPerPx;
      const embeddedQuietZoneLeftMm = margins.left * scaleMmPerPx;
      const embeddedQuietZoneRightMm = margins.right * scaleMmPerPx;
      const status = moduleMm < minModuleMm ? 'DENSE' : moduleMm < nearModuleMm ? 'NEAR' : 'OK';
      return Object.assign(base, {
        ok: status !== 'DENSE', status, modules, moduleMm,
        canvasWidthPx: canvas.width, canvasHeightPx: canvas.height,
        encodedWidthPx, moduleWidthPx, scaleMmPerPx,
        renderedWidthMm, renderedHeightMm,
        encodedWidthMm: modules * moduleMm,
        barHeightMm: finite(options.height, BASE_OPTS.height) * scaleMmPerPx,
        embeddedQuietZoneLeftMm, embeddedQuietZoneRightMm,
        outerQuietZoneLeftMm: centeredLeftMm, outerQuietZoneRightMm: centeredRightMm,
        quietZoneLeftMm: centeredLeftMm + embeddedQuietZoneLeftMm,
        quietZoneRightMm: centeredRightMm + embeddedQuietZoneRightMm,
        pdfModulePx: moduleMm * (raster.widthPx / contract.labelWidthMm),
        pdfBarHeightPx: finite(options.height, BASE_OPTS.height) * scaleMmPerPx * (raster.heightPx / contract.labelHeightMm),
      });
    } catch (error) {
      return Object.assign(base, {
        ok: false, status: 'ENCODING_ERROR', reason: error && error.message || 'El texto no se puede codificar en Code128.',
        modules: 0, moduleMm: 0, barHeightMm: 0, quietZoneLeftMm: 0, quietZoneRightMm: 0,
      });
    }
  }

  // Nombre histórico conservado para Configuración y consumidores externos.
  // Con los valores estándar delega sin desviaciones al contrato 60×40.
  function validateLabelCode(code, usableMm = LABEL_60X40.symbolBox.widthMm, minModuleMm = LABEL_60X40.minModuleMm) {
    if (usableMm === LABEL_60X40.symbolBox.widthMm && minModuleMm === LABEL_60X40.minModuleMm) return inspectLabelCode(code);
    return inspectLabelCode(code, Object.assign({}, LABEL_60X40, {
      symbolBox: Object.assign({}, LABEL_60X40.symbolBox, { widthMm: usableMm }),
      minModuleMm,
    }));
  }

  window.BARCODES = { codeOf, parse, resolve, find, scannerChar, consumeScannerInputKey, removeScannerText,
    draw, Barcode, toPNGDataURL, toPNGBlob,
    inspectLabelCode, validateLabelCode, LABEL_60X40, BASE_OPTS, ready,
    get lastResolution() { return lastResolution; } };
})();
