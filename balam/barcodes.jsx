// barcodes.jsx — Code128: barcodeCode V2 y adaptador SKU-talla exclusivamente V1.
// Render on-demand con JsBarcode (offline, sin guardar nada). El guardado de PNG en
// Supabase Storage es OPCIONAL y explícito (ver inventory.jsx → "Guardar imagen").
(function () {
  const D = window.DATA;
  const h = React.createElement;
  const { useRef, useEffect } = React;

  // Opciones base Code 128B (legibles para etiqueta térmica).
  const BASE_OPTS = { format: 'CODE128', width: 2, height: 80, displayValue: true, fontSize: 14, margin: 10, font: 'monospace' };

  // String del código por pieza: reemplaza el marcador de talla del SKU base (SIZE_MARK, ver
  // data.jsx / Constructor de SKU) por la talla real, respetando la POSICIÓN que fijó el admin.
  // Ej. base "21-ML-ALG-T-128" + talla "38" → "21-ML-ALG-38-128".
  // Respaldo (SKUs viejos sin marcador): la talla se pega al final, como antes.
  function codeOf(p, talla) {
    if (D && D.isV2Reference && D.isV2Reference(p)) return String(p.barcodeCode || '').toUpperCase();
    const mark = (D && D.SIZE_MARK) || 'T';
    const parts = String(p.sku).split('-');
    const i = parts.findIndex(seg => seg.toUpperCase() === mark.toUpperCase());
    if (i >= 0) { parts[i] = String(talla); return parts.join('-').toUpperCase(); }
    return `${p.sku}-${talla}`.toUpperCase();
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
  function resolve(code) {
    const s = String(code || '').trim().toUpperCase();
    if (!s) return { ok: false, code: 'BARCODE_EMPTY', matches: [] };
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

  // Legibilidad física para una etiqueta de 60×40 mm. El área útil del código
  // es 56 mm; JsBarcode con width=1 entrega el número exacto de módulos. Un
  // módulo menor de 0.25 mm se advierte porque la reducción deja de ser robusta
  // para impresoras/lectores comerciales, aunque el PNG todavía pueda generarse.
  function validateLabelCode(code, usableMm = 56, minModuleMm = 0.25) {
    if (!ready()) return { ok: false, reason: 'JsBarcode no disponible', modules: 0, moduleMm: 0, minModuleMm };
    const canvas = document.createElement('canvas');
    try {
      window.JsBarcode(canvas, String(code), Object.assign({}, BASE_OPTS, { width: 1, margin: 0, displayValue: false }));
      const modules = canvas.width;
      const moduleMm = modules ? usableMm / modules : 0;
      return { ok: moduleMm >= minModuleMm, modules, moduleMm, minModuleMm, usableMm };
    } catch (error) {
      return { ok: false, reason: error && error.message || 'Código inválido', modules: 0, moduleMm: 0, minModuleMm, usableMm };
    }
  }

  window.BARCODES = { codeOf, parse, resolve, find, draw, Barcode, toPNGDataURL, toPNGBlob, validateLabelCode, BASE_OPTS, ready,
    get lastResolution() { return lastResolution; } };
})();
