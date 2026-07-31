// H-61 — El filtro global de tallas del POS es una estructura por categoría.
//
// Comprueba que el filtro NO es una lista plana: cada categoría de talla
// configurada produce un grupo real, en el orden de Configuración, con sus
// tallas en el orden del catálogo. Ninguna comprobación depende de un orden
// literal escrito aquí: todo se deriva de CONFIG en tiempo de ejecución, de modo
// que el arnés falla igual si alguien reintroduce un orden fijo en el código.
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
await new Promise(resolve => server.listen(8829, '127.0.0.1', resolve));

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ' · ' + detail : ''}`);
  condition ? pass++ : fail++;
}

// Catálogo deliberadamente NO alfabético y NO numérico ascendente: si alguien
// ordena por texto, por número o por existencias, el orden esperado cambia y el
// arnés lo delata. Reproduce además la forma real de la tienda: la categoría
// Letra termina en tallas de pieza, y la Número contiene tallas de pieza
// heredadas que jamás deben verse como parte de las letras.
const SCENARIO = {
  size_letter: [
    { code: 'XS', label: 'XS', active: true },
    { code: 'S', label: 'S', active: true },
    { code: 'L', label: 'L', active: true },
    { code: '2XL', label: '2XL', active: true },
    { code: 'PZ', label: 'PIEZA', active: true },
    { code: 'CH', label: 'CHICO', active: true },
    { code: 'GR', label: 'GRANDE', active: true },
    { code: 'ZZ', label: 'RETIRADA', active: false },
  ],
  size_number: [
    { code: '36', label: '36', active: true },
    { code: '4', label: '4', active: true },
    { code: '12', label: '12', active: true },
    { code: '0', label: '0', active: true },
    { code: 'PZ', label: 'PIEZA', active: true },
    { code: 'QQ', label: 'RETIRADA', active: false },
  ],
};

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  await page.route(/supabase\.co/, route => route.abort());
  await page.goto('http://127.0.0.1:8829/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG);

  // Se instala por la MISMA vía que un pull de la nube (CONFIG.load), no por un
  // atajo de pruebas: el orden que llega es el que debe verse.
  const expected = await page.evaluate((scenario) => {
    const snapshot = window.CONFIG.snapshot();
    const catalogs = Object.assign({}, snapshot.catalogs);
    Object.keys(scenario).forEach(kind => {
      catalogs[kind] = scenario[kind].map(item => ({
        code: item.code, label: item.label, active: item.active, meta: {},
      }));
    });
    window.CONFIG.load({
      v: 1, catalogs, catalogMeta: snapshot.catalogMeta, settings: snapshot.settings,
    });
    // La expectativa se DERIVA de Configuración, nunca se escribe a mano.
    return window.CONFIG.sizeCategories().map(category => ({
      categoryId: category.id,
      categoryLabel: category.label,
      sizes: window.CONFIG.all(category.id)
        .filter(item => item.active !== false)
        .map(item => ({ sizeId: item.code, label: item.label })),
    })).filter(group => group.sizes.length);
  }, SCENARIO);

  const groups = await page.evaluate(() => (
    typeof window.DATA.resolveSizeFilterGroups === 'function'
      ? window.DATA.resolveSizeFilterGroups()
      : null));

  check('existe una autoridad de grupos para el filtro global',
    Array.isArray(groups));
  check('hay un grupo por cada categoría configurada, en el orden de Configuración',
    !!groups && groups.map(g => g.categoryId).join(',') === expected.map(g => g.categoryId).join(','),
    groups ? groups.map(g => g.categoryId).join(',') : 'sin autoridad');
  check('cada grupo se anuncia con la etiqueta de su categoría',
    !!groups && groups.every((g, i) => g.categoryLabel === expected[i].categoryLabel),
    groups ? groups.map(g => g.categoryLabel).join(' | ') : 'sin autoridad');
  check('cada grupo conserva el orden del catálogo, no un orden alfabético ni numérico',
    !!groups && groups.every((g, i) =>
      g.sizes.map(s => s.sizeId).join(',') === expected[i].sizes.map(s => s.sizeId).join(',')),
    groups ? groups.map(g => g.categoryId + ':' + g.sizes.map(s => s.sizeId).join('>')).join(' | ') : 'sin autoridad');
  check('ninguna talla aparece fuera de su categoría',
    !!groups && groups.every(g => g.sizes.every(s => s.sizeCategoryId === g.categoryId)));
  check('las tallas inactivas no llegan al filtro',
    !!groups && groups.every(g => g.sizes.every(s => s.label !== 'RETIRADA')));
  check('una talla activa sin existencias sigue ofreciéndose',
    !!groups && groups.some(g => g.sizes.some(s => s.sizeId === '0' && !s.stock)));
  check('un mismo código en dos categorías produce dos opciones distinguibles',
    !!groups && (() => {
      const piezas = groups.flatMap(g => g.sizes.filter(s => s.sizeId === 'PZ'));
      return piezas.length === 2 && piezas[0].filterKey !== piezas[1].filterKey;
    })());
  check('cada opción lleva su identidad compuesta categoría + talla',
    !!groups && groups.every(g => g.sizes.every(s => s.sizeCategoryId === g.categoryId && s.sizeId)));

  const flat = await page.evaluate(() => window.DATA.resolveSizeFilterOptions());
  check('la lista plana es una derivación de los grupos, no una autoridad paralela',
    !!groups && flat.map(s => s.filterKey).join(',')
      === groups.flatMap(g => g.sizes.map(s => s.filterKey)).join(','));

  // ── Render real del POS ─────────────────────────────────────────────────────
  await page.evaluate(() => { localStorage.setItem('balam-page', 'pos'); });
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-testid="pos-size-filter"]', { state: 'attached', timeout: 25000 });

  const dom = await page.locator('[data-testid="pos-size-filter"]').evaluate(select => ({
    groups: Array.from(select.querySelectorAll('optgroup')).map(group => ({
      label: group.label,
      options: Array.from(group.querySelectorAll('option')).map(option => ({
        value: option.value, text: option.textContent.trim(), className: option.className,
      })),
    })),
    topLevel: Array.from(select.children)
      .filter(node => node.tagName === 'OPTION')
      .map(option => ({ value: option.value, text: option.textContent.trim() })),
    firstOption: select.options[0] ? select.options[0].value : null,
    allText: Array.from(select.options).map(option => option.textContent.trim()),
  }));

  check('el filtro del POS dibuja grupos reales, no una lista plana',
    dom.groups.length === expected.length,
    dom.groups.length + ' grupo(s) · opciones: ' + dom.allText.join(', '));
  check('los grupos del POS llevan el nombre de la categoría, en su orden',
    dom.groups.map(g => g.label).join(',') === expected.map(g => g.categoryLabel).join(','),
    dom.groups.map(g => g.label).join(','));
  check('cada grupo del POS lista sus tallas en el orden de Configuración',
    dom.groups.length === expected.length && dom.groups.every((g, i) =>
      g.options.map(o => o.text).join(',') === expected[i].sizes.map(s => s.label).join(',')),
    dom.groups.map(g => g.label + ': ' + g.options.map(o => o.text).join('>')).join(' | '));
  check('«Todas las tallas» es la única opción global y va primero',
    dom.topLevel.length === 1 && dom.topLevel[0].value === 'all' && dom.firstOption === 'all',
    JSON.stringify(dom.topLevel));
  check('el valor de cada opción conserva categoría y talla',
    dom.groups.length === expected.length && dom.groups.every((g, i) => g.options.length > 0 && g.options.every((o, j) => {
      const size = expected[i].sizes[j];
      return size && decodeURIComponent(o.value.split(':')[0]) === expected[i].categoryId
        && decodeURIComponent(o.value.split(':')[1] || '') === size.sizeId;
    })),
    dom.groups.flatMap(g => g.options.map(o => o.value)).join(' '));
  check('ninguna talla inactiva llega al menú del POS',
    !dom.allText.includes('RETIRADA'));
  check('las opciones agrupadas conservan la cascada de color del menú (H-58)',
    dom.groups.length > 0 && dom.groups.every(g => g.options.length > 0
      && g.options.every(o => /bg-surface/.test(o.className) && /text-on-surface/.test(o.className))),
    dom.groups[0] && dom.groups[0].options[0] ? dom.groups[0].options[0].className : 'sin opciones');

  // Reordenar en Configuración se refleja sin recargar la pantalla.
  const afterMove = await page.evaluate(async () => {
    const before = window.CONFIG.all('size_number').filter(i => i.active !== false).map(i => i.code);
    window.CONFIG.move('size_number', before[before.length - 1], -1);
    await new Promise(resolve => setTimeout(resolve, 400));
    const select = document.querySelector('[data-testid="pos-size-filter"]');
    const group = Array.from(select.querySelectorAll('optgroup'))
      .find(g => g.label === (window.CONFIG.sizeCategories().find(c => c.id === 'size_number') || {}).label);
    return {
      configured: window.CONFIG.all('size_number').filter(i => i.active !== false).map(i => i.label),
      rendered: group ? Array.from(group.querySelectorAll('option')).map(o => o.textContent.trim()) : null,
    };
  });
  check('reordenar el catálogo en Configuración reordena el filtro sin recargar',
    afterMove.rendered && afterMove.rendered.join(',') === afterMove.configured.join(','),
    'configurado: ' + afterMove.configured.join(',') + ' · filtro: ' + (afterMove.rendered || []).join(','));

  const pos = fs.readFileSync('balam/pos.jsx', 'utf8');
  check('el POS no reconstruye el filtro recorriendo productos ni variantes',
    !/TALLAS[\s\S]{0,400}D\.products/.test(pos) && /resolveSizeFilterGroups/.test(pos));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
