// barcodes.jsx — Códigos de barras Code128B (formato SKU-TALLA). Exporta window.BARCODES
// Render on-demand con JsBarcode (offline, sin guardar nada). El guardado de PNG en
// Supabase Storage es OPCIONAL y explícito (ver inventory.jsx → "Guardar imagen").
(function () {
  const D = window.DATA;
  const h = React.createElement;
  const { useRef, useEffect } = React;

  // Opciones base Code 128B (legibles para etiqueta térmica).
  const BASE_OPTS = { format: 'CODE128', width: 2, height: 80, displayValue: true, fontSize: 14, margin: 10, font: 'monospace' };

  // String del código: SKU + talla, en mayúsculas. Ej. ("21-ML-ALG-MZ-128","m") → "21-ML-ALG-MZ-128-M"
  function codeOf(p, talla) { return `${p.sku}-${talla}`.toUpperCase(); }

  // Parseo robusto: la talla es lo que va DESPUÉS del último guion (el SKU ya contiene guiones).
  function parse(code) {
    const s = String(code || '').trim().toUpperCase();
    const i = s.lastIndexOf('-');
    if (i <= 0 || i === s.length - 1) return null;
    return { sku: s.slice(0, i), talla: s.slice(i + 1) };
  }

  // Encuentra { p, talla } a partir de un código escaneado, buscando en memoria (sin red).
  function find(code) {
    const pr = parse(code); if (!pr) return null;
    const p = D.products.find(x => String(x.sku).toUpperCase() === pr.sku);
    if (!p) return null;
    const entry = (p.stock || []).find(v => String(v.talla).toUpperCase() === pr.talla);
    if (!entry) return null;
    return { p, talla: entry.talla };
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

  window.BARCODES = { codeOf, parse, find, draw, Barcode, toPNGDataURL, toPNGBlob, BASE_OPTS, ready };
})();
