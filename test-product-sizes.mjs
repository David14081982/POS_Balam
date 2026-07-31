// H-57 — La categoría por talla configurada es la única autoridad para POS e Inventario.
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve('.');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) {
    res.writeHead(404); res.end('nf'); return;
  }
  res.writeHead(200);
  fs.createReadStream(fp).pipe(res);
});
await new Promise(resolve => server.listen(8817, '127.0.0.1', resolve));

let pass = 0;
let fail = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  condition ? pass++ : fail++;
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.route(/supabase\.co/, route => route.abort());
await page.goto('http://127.0.0.1:8817/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG);

const result = await page.evaluate(() => {
  const D = window.DATA;
  const product = {
    id: 'alonso',
    nombre: 'ALONSO',
    sizeCategoryId: 'size_letter',
    attrs: { __sizeCategoryId: 'size_letter' },
    stock: [
      { id: 'var-a', escala: 'L', talla: 'A', stock: 4 },
      { id: 'var-0', escala: 'L', talla: '0', stock: 2 },
      { id: 'contaminada', escala: 'N', talla: '40', stock: 9 },
    ],
  };
  const catalogs = {
    size_letter: [
      { code: 'size-0', label: '0', active: true, meta: { value: 0, order: 1 } },
      { code: 'size-a', label: 'A', active: true, meta: { value: 'A', order: 2 } },
      { code: 'size-b', label: 'B', active: false, meta: { value: 'B', order: 3 } },
    ],
    size_number: [{ code: 'size-40', label: '40', active: true, meta: { value: 40, order: 1 } }],
  };
  const resolved = typeof D.resolveProductSizes === 'function'
    ? D.resolveProductSizes(product, catalogs, product.stock)
    : null;
  return { resolved, hasResolver: typeof D.resolveProductSizes === 'function' };
});

check('existe una autoridad única resolveProductSizes', result.hasResolver);
check('devuelve la categoría asignada', result.resolved && result.resolved.categoryId === 'size_letter', JSON.stringify(result.resolved));
check('conserva valor numérico 0 sin convertirlo en índice o letra',
  result.resolved && result.resolved.sizes[0] && result.resolved.sizes[0].value === 0);
check('devuelve ID estable, etiqueta, orden, existencia, variante y estado',
  result.resolved && result.resolved.sizes.every(s =>
    'sizeId' in s && 'value' in s && 'label' in s && 'order' in s &&
    'stock' in s && 'variantId' in s && 'active' in s));
check('respeta el orden comercial configurado',
  result.resolved && result.resolved.sizes.map(s => s.label).join(',') === '0,A,B');
check('no mezcla la talla 40 de otra categoría',
  result.resolved && !result.resolved.sizes.some(s => s.label === '40'));
check('asocia existencias por valor real y no por ID o índice',
  result.resolved && result.resolved.sizes[0].stock === 2 && result.resolved.sizes[1].stock === 4);
check('conserva el estado inactivo para que el consumidor aplique su regla',
  result.resolved && result.resolved.sizes[2].active === false);

const sources = ['balam/pos.jsx', 'balam/inventory.jsx'].map(p => fs.readFileSync(p, 'utf8')).join('\n');
check('POS e Inventario consumen la autoridad compartida',
  (sources.match(/resolveProductSizes/g) || []).length >= 3);

console.log(`\n${pass} pasaron, ${fail} fallaron`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
