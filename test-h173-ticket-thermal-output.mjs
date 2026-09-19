// H-173: tickets pequeños/grises. Dos fronteras, sin impresora real ni Supabase:
// 1) una tablet Android en «sitio de escritorio» debe usar el PNG RawBT;
// 2) la impresión del sistema de 80 mm debe salir en tinta negra sólida.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const remote = process.argv.find(arg => /^https?:\/\//.test(arg));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`);
};
const server = remote ? null : createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = remote || `http://127.0.0.1:${server.address().port}/index.html`;
const browser = await chromium.launch({ ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }), headless: true });

const DESKTOP_LINUX_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const devices = [
  // Chrome para tablets Android abre por omisión el «sitio de escritorio».
  { name: 'tablet Android en sitio de escritorio', ua: DESKTOP_LINUX_UA, platform: 'Linux aarch64', touch: 5, expected: true },
  { name: 'tablet Android con plataforma de escritorio', ua: DESKTOP_LINUX_UA, platform: 'Linux x86_64', touch: 5, expected: true },
  { name: 'Android móvil', ua: 'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', platform: 'Linux armv8l', touch: 5, expected: true },
  { name: 'PC Windows con pantalla táctil', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', platform: 'Win32', touch: 10, expected: false },
  { name: 'PC Linux sin pantalla táctil', ua: DESKTOP_LINUX_UA, platform: 'Linux x86_64', touch: 0, expected: false },
  { name: 'Chromebook táctil', ua: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', platform: 'Linux x86_64', touch: 10, expected: false },
  { name: 'Mac', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36', platform: 'MacIntel', touch: 0, expected: false },
];

async function openApp(context) {
  await context.route('**/*', route => {
    const target = new URL(route.request().url());
    if (target.hostname === '127.0.0.1' || (remote && target.origin === new URL(remote).origin)) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.BalamTicket && window.BalamReturnReceipt && window.UI && window.UI.receiptFrame);
  return page;
}

try {
  for (const device of devices) {
    const context = await browser.newContext({ userAgent: device.ua });
    await context.addInitScript(({ platform, touch }) => {
      Object.defineProperty(Navigator.prototype, 'platform', { get: () => platform, configurable: true });
      Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => touch, configurable: true });
    }, device);
    const page = await openApp(context);
    const detected = await page.evaluate(() => window.UI.usesBluetoothReceipt());
    check(`transporte: ${device.name} → ${device.expected ? 'RawBT' : 'sistema'}`, detected === device.expected, { detected });
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await openApp(context);
  const inspect = ({ kind, items, continuous }) => (async () => {
    const host = document.getElementById('h173-host') || Object.assign(document.createElement('div'), { id: 'h173-host' });
    document.body.append(host);
    window.__h173Root = window.__h173Root || ReactDOM.createRoot(host);
    const lines = Array.from({ length: items }, (_, i) => ({ productId: 'h173-' + i, sku: 'H173-SKU-' + i, nombre: 'PRENDA H173 ' + (i + 1),
      talla: 'M', qty: 1, precio: 450, precioOrig: 450, precioBase: 450, promos: [] }));
    const sale = { folio: 'PRUEBA-H173', fecha: '2026-09-19 12:00', vendedor: 'PRUEBA', metodo: 'Tarjeta', estado: kind === 'payment' ? 'Apartado' : 'Pagado',
      total: 450 * items, descuento: 0, subtotal: 450 * items / 1.16, iva: 450 * items * 0.16 / 1.16, ivaPct: 16, ivaIncluded: true,
      saldo: kind === 'payment' ? 100 : 0, lineas: lines };
    const props = kind === 'return'
      ? { sale, returnDoc: { id: 'DEV-H173', folio: sale.folio, fecha: sale.fecha, metodo: 'Efectivo', total: sale.total, lineas: lines } }
      : kind === 'payment' ? { sale, payment: { id: 'h173-pay', tipo: 'abono', metodo: 'Efectivo', monto: 100, fecha: sale.fecha } } : { sale };
    window.__h173Root.render(React.createElement(kind === 'return' ? BalamReturnReceipt : BalamTicket, props));
    const id = kind === 'return' ? 'balam-return-receipt' : 'balam-ticket';
    for (let i = 0; i < 100 && !(document.getElementById(id) && document.getElementById(id).textContent.includes('PRENDA H173 ' + items)); i++) await new Promise(r => setTimeout(r, 20));
    await document.fonts.ready;
    const element = document.getElementById(id);
    const snapshot = UI.captureReceipt(element);
    const frame = await UI.receiptFrame(snapshot, { continuous });
    try {
      const doc = frame.contentDocument, view = doc.defaultView;
      const lum = value => {
        const m = value.match(/rgba?\(([^)]+)\)/); if (!m) return 255;
        const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        const l = r * 0.2126 + g * 0.7152 + b * 0.0722;
        return 255 - a * (255 - l);
      };
      const gray = [], grayBorders = [], tints = [];
      for (const node of doc.body.querySelectorAll('*')) {
        const style = view.getComputedStyle(node);
        const hasText = [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim());
        const text = lum(style.color);
        if (hasText && text > 0.5 && text < 200) gray.push(style.color);
        for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
          if (parseFloat(style['border' + side + 'Width']) > 0 && style['border' + side + 'Style'] !== 'none') {
            const border = lum(style['border' + side + 'Color']);
            if (border > 0.5 && border < 255) grayBorders.push(style['border' + side + 'Color']);
          }
        }
        const background = lum(style.backgroundColor);
        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && background >= 200 && background < 254.5) tints.push(style.backgroundColor);
      }
      return { gray: gray.length, grayBorders: grayBorders.length, tints: tints.length, sample: gray.slice(0, 3),
        text: doc.body.textContent, width: doc.body.firstElementChild.getBoundingClientRect().width, height: Number(frame.dataset.pageHeight) || null };
    } finally { frame.remove(); }
  })();

  for (const [kind, items] of [['sale', 1], ['sale', 6], ['payment', 2], ['return', 3]]) {
    const result = await page.evaluate(inspect, { kind, items, continuous: true });
    check(`sistema 80 mm ${kind}/${items}: texto negro sólido`, result.gray === 0, { gray: result.gray, sample: result.sample });
    check(`sistema 80 mm ${kind}/${items}: bordes negros`, result.grayBorders === 0, { grayBorders: result.grayBorders });
    check(`sistema 80 mm ${kind}/${items}: sin fondos tramados`, result.tints === 0, { tints: result.tints });
    check(`sistema 80 mm ${kind}/${items}: contenido completo`, result.text.includes('PRENDA H173 ' + items) && result.text.includes('PRUEBA-H173') && result.height > 0, { height: result.height });
    check(`sistema 80 mm ${kind}/${items}: ancho 80 mm`, Math.abs(result.width - 302.36) < 1, { width: result.width });
  }
  // Reportes A4, apartados y préstamos (continuous:false) conservan su diseño.
  const a4 = await page.evaluate(inspect, { kind: 'sale', items: 1, continuous: false });
  check('A4 conserva sus tonos originales', a4.gray > 0, { gray: a4.gray });
  await context.close();
} finally {
  await browser.close();
  if (server) server.close();
}
const failed = results.filter(result => !result.ok).length;
console.log(`\nH-173: ${results.length - failed}/${results.length}`);
process.exit(failed ? 1 : 0);
