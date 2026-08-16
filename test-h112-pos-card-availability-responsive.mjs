// H-112 · UI-PAR-01/02/03: disponibilidad familiar y geometría móvil del POS.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const root = resolve('.');
const artifact = process.env.BALAM_ARTIFACT_PATH ? resolve(process.env.BALAM_ARTIFACT_PATH) : resolve(root, 'index.html');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const relative = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
  const path = relative === 'index.html' ? artifact : resolve(root, relative);
  if ((relative !== 'index.html' && !path.startsWith(root)) || !existsSync(path)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
  createReadStream(path).pipe(res);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));

let pass = 0, fail = 0, browser;
const check = (name, value, detail = '') => {
  console.log(`${value ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  value ? pass++ : fail++;
};
const overlapArea = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route(/supabase\.co/, route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { localStorage.setItem('balam-page', 'pos'); localStorage.setItem('balam-sidebar', '1'); });
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG);
  const fixture = await page.evaluate(() => {
    const D = window.DATA;
    const legacy = { id: '11200000-0000-4000-8000-000000000101', recordModel: 'v1', cat: '1', modelo: 'VIC', nombre: 'H112 V1',
      manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'TRA', orn: 'BEL', ornColors: ['DRO'], precio: 990, costo: 0, pop: false,
      sku: 'H112-V1', imagen: '', attrs: { producto: 'VIC', corte: '-', caracteristicas: '66', __sizeCategoryId: 'size_letter' },
      stock: [{ talla: 'M', escala: 'L', stock: 4 }, { talla: 'L', escala: 'L', stock: 2 }], preciosTalla: { M: 1090, L: 990 } };
    const familyId = '11200000-0000-4000-8000-000000000201', family = [];
    for (const spec of [
      { id: 'a1200000-0000-4000-8000-000000000211', color: 'DRO', stock: 3, price: 1150 },
      { id: 'b1200000-0000-4000-8000-000000000212', color: 'AZL', stock: 2, price: 1250 },
      { id: 'c1200000-0000-4000-8000-000000000213', color: 'NEG', stock: 0, price: 1350 },
    ]) family.push(D.createReference({ id: spec.id, referenceFamilyId: familyId, cat: '1', modelo: 'VIC2', nombre: 'H112 V2',
      manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'TRA', orn: 'BEL', sizeCategoryId: 'size_number', sizeCode: '40', sizeScale: 'N',
      stockQuantity: spec.stock, precio: spec.price, ornamentColorCodes: [spec.color], attrs: { producto: 'VIC2', corte: '-', caracteristicas: '66' } }, family));
    const rows = [legacy, ...family];
    localStorage.setItem('balam_pos_products_v2', JSON.stringify(rows));
    return { legacyId: legacy.id, familyId, productsJson: JSON.stringify(rows) };
  });
  await page.addInitScript(productsJson => localStorage.setItem('balam_pos_products_v2', productsJson), fixture.productsJson);
  await page.reload({ waitUntil: 'load' });

  const projection = await page.evaluate(id => {
    const p = window.DATA.referenceFamilyProjection(id);
    return { references: p.references.length, available: p.availableReferences.length, total: p.totalStock };
  }, fixture.familyId);
  check('familia conserva tres referencias y sólo dos vendibles', projection.references === 3 && projection.available === 2 && projection.total === 5, JSON.stringify(projection));

  const v2Card = page.getByTestId('pos-product-family:' + fixture.familyId);
  const v2Text = (await v2Card.innerText()).replace(/\s+/g, ' ');
  check('UI-PAR-01 copy cuenta sólo referencias vendibles', /2 referencias disponibles/i.test(v2Text) && !/3 referencias disponibles/i.test(v2Text), v2Text);
  check('UI-PAR-01 rango excluye el precio máximo agotado', /1,150/.test(v2Text) && /1,250/.test(v2Text) && !/1,350/.test(v2Text), v2Text);

  const v1Text = (await page.getByTestId('pos-product-' + fixture.legacyId).innerText()).replace(/\s+/g, ' ');
  check('V1 conserva copy y rango legacy', /H112 V1/.test(v1Text) && /990/.test(v1Text) && /1,090/.test(v1Text) && !/referencias disponibles/i.test(v1Text), v1Text);

  for (const width of [320, 360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 }); await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelector('[data-testid="pos-cart-access"]'));
    const result = await page.evaluate(async familyId => {
      const cart = document.querySelector('[data-testid="pos-cart-access"]');
      const scroll = document.querySelector('[data-testid="pos-catalog-scroll"]') || document.querySelector('.pos-cat [class*="overflow-y-auto"]');
      const cards = [...document.querySelectorAll('[data-testid^="pos-product-"]')];
      const familyCard = document.querySelector(`[data-testid="pos-product-family:${familyId}"]`);
      const add = familyCard && (familyCard.querySelector(`[data-testid="pos-product-add-family:${familyId}"]`) || familyCard.querySelector('button'));
      const visibleRect = element => new Promise(resolveRect => {
        const observer = new IntersectionObserver(entries => { const r = entries[0].intersectionRect; observer.disconnect(); resolveRect({ left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height }); });
        observer.observe(element);
      });
      const cartRect = cart.getBoundingClientRect(), samples = [];
      for (const top of [0, Math.max(0, (scroll.scrollHeight-scroll.clientHeight)/2), Math.max(0, scroll.scrollHeight-scroll.clientHeight)]) {
        scroll.scrollTop = top; await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
        const visibleCards = await Promise.all(cards.map(visibleRect));
        const visibleAdd = await visibleRect(add);
        samples.push({ top, cards: visibleCards, add: visibleAdd });
      }
      const rect = add.getBoundingClientRect(), style = getComputedStyle(cart);
      return { cart: { left:cartRect.left,top:cartRect.top,right:cartRect.right,bottom:cartRect.bottom }, samples,
        target: { width:rect.width,height:rect.height }, fixed:style.position === 'fixed', overflow:document.documentElement.scrollWidth-innerWidth };
    }, fixture.familyId);
    const intersections = result.samples.flatMap(sample => [...sample.cards, sample.add]).map(rect => overlapArea(rect, result.cart));
    check(`UI-PAR-02 ${width}px carrito fijo sin intersección visible`, result.fixed && intersections.every(area => area === 0), JSON.stringify({ max: Math.max(...intersections), cart: result.cart }));
    check(`UI-PAR-03 ${width}px Agregar tiene target 44×44`, result.target.width >= 44 && result.target.height >= 44, JSON.stringify(result.target));
    check(`responsive ${width}px sin overflow documental`, result.overflow <= 0, String(result.overflow));
  }
  check('recorrido H-112 sin errores de página', errors.length === 0, errors.join(' | '));
} finally { if (browser) await browser.close(); await new Promise(done => server.close(done)); }

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
