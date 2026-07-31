// H-59 — Auditoría de categorías por talla, resolución y consumidores.
import { chromium } from 'playwright-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.');
const server = http.createServer((req, res) => {
  let requested = decodeURIComponent(req.url.split('?')[0]);
  if (requested === '/') requested = '/index.html';
  const file = path.join(ROOT, requested);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.writeHead(404); res.end('nf'); return;
  }
  res.writeHead(200);
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(8827, '127.0.0.1', resolve));

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  condition ? pass++ : fail++;
}

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto('http://127.0.0.1:8827/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG);

  const result = await page.evaluate(() => {
    const D = window.DATA;
    const catalogs = {
      size_letter: [
        { code: 'letter-m', label: 'M', active: true, meta: { value: 'M', order: 99 } },
        { code: 'letter-s', label: 'S', active: true, meta: { value: 'S', order: 1 } },
        { code: 'letter-x', label: 'X', active: false, meta: { value: 'X', order: 0 } },
      ],
      size_number: [
        { code: 'number-40', label: '40', active: true, meta: { value: 40, order: 50 } },
        { code: 'number-38', label: '38', active: true, meta: { value: 38, order: 2 } },
      ],
    };
    const letter = {
      id: 'letter', sizeCategoryId: 'size_letter',
      attrs: { __sizeCategoryId: 'size_letter' },
      stock: [
        { id: 'l-m', escala: 'L', talla: 'M', stock: 0 },
        { id: 'l-s', escala: 'L', talla: 'S', stock: 2 },
        { id: 'foreign', escala: 'N', talla: '40', stock: 9 },
      ],
    };
    const number = {
      id: 'number', attrs: { __sizeCategoryId: 'size_number' },
      stock: [
        { id: 'n-40', escala: 'N', talla: '40', stock: 3 },
        { id: 'foreign', escala: 'L', talla: 'M', stock: 8 },
      ],
    };
    const ambiguous = {
      id: 'ambiguous', attrs: {},
      stock: [
        { escala: 'L', talla: 'M', stock: 2 },
        { escala: 'N', talla: '40', stock: 4 },
      ],
    };
    const conflict = {
      id: 'conflict', sizeCategoryId: 'size_letter',
      attrs: { __sizeCategoryId: 'size_number' },
      stock: [{ escala: 'N', talla: '40', stock: 3 }],
    };
    const rLetter = D.resolveProductSizes(letter, catalogs, letter.stock);
    const rNumber = D.resolveProductSizes(number, catalogs, number.stock);
    const rAmbiguous = D.resolveProductSizes(ambiguous, catalogs, ambiguous.stock);
    const rConflict = D.resolveProductSizes(conflict, catalogs, conflict.stock);
    const filter = typeof D.resolveSizeFilterOptions === 'function'
      ? D.resolveSizeFilterOptions(catalogs)
      : null;
    return {
      rLetter, rNumber, rAmbiguous, rConflict, filter,
      letterTotal: D.totalStock(letter),
      ambiguousTotal: D.totalStock(ambiguous),
    };
  });

  check('producto Letra resuelve únicamente Talla (Letra)',
    result.rLetter.categoryId === 'size_letter'
      && result.rLetter.sizes.every(s => s.categoryId === 'size_letter'));
  check('producto Número resuelve únicamente Talla (Número)',
    result.rNumber.categoryId === 'size_number'
      && result.rNumber.sizes.every(s => s.categoryId === 'size_number'));
  check('variantes de otra escala no contaminan las existencias',
    result.rLetter.sizes.every(s => s.label !== '40')
      && result.rNumber.sizes.every(s => s.label !== 'M'));
  check('totales de inventario ignoran variantes ajenas a la categoría',
    result.letterTotal === 2, String(result.letterTotal));
  check('producto ambiguo no mezcla categorías',
    result.rAmbiguous.categoryId === null && result.rAmbiguous.sizes.length === 0,
    JSON.stringify(result.rAmbiguous));
  check('producto ambiguo queda bloqueado también en el total vendible',
    result.ambiguousTotal === 0, String(result.ambiguousTotal));
  check('attrs persistido prevalece sobre el campo derivado en conflicto',
    result.rConflict.categoryId === 'size_number');
  check('el orden visible es el orden del catálogo, no meta.order',
    result.rLetter.sizes.map(s => s.label).join(',') === 'M,S,X',
    result.rLetter.sizes.map(s => s.label).join(','));
  check('la autoridad del filtro existe', Array.isArray(result.filter));
  check('el filtro incluye todas las tallas activas aunque no tengan stock',
    result.filter && result.filter.map(s => s.label).join(',') === 'M,S,40,38',
    result.filter ? result.filter.map(s => s.label).join(',') : 'sin autoridad');
  check('el filtro excluye tallas inactivas',
    result.filter && !result.filter.some(s => s.label === 'X'));
  check('cada opción del filtro conserva identidad de categoría',
    result.filter && result.filter.every(s => s.categoryId && s.filterKey));

  const pos = fs.readFileSync('balam/pos.jsx', 'utf8');
  const inventory = fs.readFileSync('balam/inventory.jsx', 'utf8');
  const xlsx = fs.readFileSync('balam/xlsx-io.jsx', 'utf8');
  const store = fs.readFileSync('balam/store.jsx', 'utf8');
  check('el filtro POS consume la proyección centralizada',
    /resolveSizeFilterOptions/.test(pos));
  check('selector POS y existencias Inventario consumen resolveProductSizes',
    /function SizeModal[\s\S]*resolveProductSizes/.test(pos)
      && /function DetailDrawer[\s\S]*resolveProductSizes/.test(inventory));
  check('el filtro POS compara categoría y talla, no sólo texto',
    /sizeFilterMatch/.test(pos));
  check('Excel transporta una categoría única por producto',
    /Categoría por talla/.test(xlsx)
      && /sizeCategoryId/.test(xlsx)
      && !/puede llenar ambas escalas/i.test(xlsx));
  check('la caché remota persiste una sola categoría en attrs',
    /resolveProductSizes\(p\)\.categoryId/.test(store)
      && /attrs\.__sizeCategoryId = categoryId/.test(store)
      && /sizeCategoryId: \(r\.attrs \|\| \{\}\)\.__sizeCategoryId/.test(store));

  const importResult = await page.evaluate(async () => {
    async function parse(row) {
      const ws = window.XLSX.utils.json_to_sheet([row]);
      const wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
      const bytes = window.XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
      return window.XLSXIO.parseFile(new File([bytes], 'audit.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }));
    }
    const base = {
      SKU: '', Modelo: 'AUDITORÍA', Categoría: '21', Manga: 'ML',
      Tela: 'ALG', Color: 'BL', 'No. Modelo': '998', Precio: 100,
    };
    const ambiguous = await parse({ ...base, M: 2, T40: 3 });
    const contradictory = await parse({
      ...base, 'Categoría por talla': 'size_letter', M: 2, T40: 3,
    });
    const legacyLetter = await parse({ ...base, M: 2 });
    const explicitNumber = await parse({
      ...base, 'Categoría por talla': 'size_number', T40: 3,
    });
    return {
      ambiguous,
      contradictory,
      legacyLetter: legacyLetter.products[0] || null,
      explicitNumber: explicitNumber.products[0] || null,
    };
  });
  check('Excel rechaza una fila ambigua con existencias en ambas categorías',
    importResult.ambiguous.products.length === 0 && importResult.ambiguous.skipped === 1);
  check('Excel rechaza existencias que contradicen la categoría explícita',
    importResult.contradictory.products.length === 0 && importResult.contradictory.skipped === 1);
  check('Excel antiguo infiere Letra sólo cuando una escala es inequívoca',
    importResult.legacyLetter
      && importResult.legacyLetter.sizeCategoryId === 'size_letter'
      && importResult.legacyLetter.stock.every(v => v.escala === 'L'));
  check('Excel explícito persiste Número y únicamente sus variantes',
    importResult.explicitNumber
      && importResult.explicitNumber.sizeCategoryId === 'size_number'
      && importResult.explicitNumber.attrs.__sizeCategoryId === 'size_number'
      && importResult.explicitNumber.stock.every(v => v.escala === 'N'));

  await page.evaluate(() => {
    window.CONFIG.importCatalogs({
      size_letter: [
        { code: 'audit-m', label: 'M', active: true, meta: { value: 'M', order: 90 } },
        { code: 'audit-s', label: 'S', active: true, meta: { value: 'S', order: 1 } },
        { code: 'audit-x', label: 'X', active: false, meta: { value: 'X', order: 0 } },
      ],
      size_number: [
        { code: 'audit-40', label: '40', active: true, meta: { value: 40, order: 50 } },
        { code: 'audit-38', label: '38', active: true, meta: { value: 38, order: 2 } },
      ],
    });
    const first = kind => ((window.CONFIG.list(kind) || [])[0] || {}).code || '';
    const base = window.DATA.products[0]
      ? JSON.parse(JSON.stringify(window.DATA.products[0]))
      : {
          cat: first('category'), manga: first('sleeve'), tela: first('fabric'),
          color: first('color'), cuello: first('neck'), orn: '—',
          ornColors: [], precio: 100, costo: 40, pop: false, attrs: {},
        };
    const product = window.DATA.hydrate({
      ...base,
      id: 'audit-pos-size-filter',
      nombre: 'Producto auditoría de tallas',
      modelo: 'AUD-59',
      sku: 'AUD-59',
      sizeCategoryId: 'size_letter',
      attrs: { ...(base.attrs || {}), __sizeCategoryId: 'size_letter' },
      stock: [{ id: 'audit-stock-s', escala: 'L', talla: 'S', stock: 2 }],
    });
    window.DATA.products.splice(0, window.DATA.products.length, product);
    window.DATA.saveProducts(false);
    localStorage.setItem('balam-page', 'pos');
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-testid="pos-size-filter"]', {
    state: 'attached',
    timeout: 25000,
  });
  const renderedFilter = await page.locator('[data-testid="pos-size-filter"]').evaluate(select =>
    Array.from(select.options).map(option => option.textContent.trim()));
  check('el filtro POS renderiza todas las tallas activas en orden configurado',
    renderedFilter.join(',') === 'Todas las tallas,M,S,40,38',
    renderedFilter.join(','));
  const configuredValues = await page.evaluate(() => ({
    letters: window.DATA.SIZES_LETRA,
    numbers: window.DATA.SIZES_NUM,
    stored: window.DATA.mkStock([3], []).find(variant => variant.escala === 'L').talla,
  }));
  check('código de catálogo e identidad de talla permanecen separados',
    configuredValues.letters.join(',') === 'M,S'
      && configuredValues.numbers.join(',') === '40,38'
      && configuredValues.stored === 'M',
    JSON.stringify(configuredValues));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
