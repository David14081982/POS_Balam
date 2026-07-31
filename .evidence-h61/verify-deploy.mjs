// Verificación del artefacto PUBLICADO: se carga desde GitHub Pages y se le
// pregunta por su comportamiento. Un SHA-256 igual prueba los bytes; esto
// prueba que el filtro agrupado es el que la tienda recibe.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = 'https://david14081982.github.io/POS_Balam/';
const cats = JSON.parse(fs.readFileSync('.evidence-h59-production/remote-readonly-verification.json', 'utf8')).categories;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e)));
await page.route(/supabase\.co/, route => route.abort());
await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 60000 });

const api = await page.evaluate(() => ({
  groups: typeof window.DATA.resolveSizeFilterGroups,
  options: typeof window.DATA.resolveSizeFilterOptions,
}));

await page.evaluate((cats) => {
  const snap = window.CONFIG.snapshot();
  const catalogs = Object.assign({}, snap.catalogs);
  Object.keys(cats).forEach(kind => {
    catalogs[kind] = cats[kind].map(r => ({ code: r.code, label: r.label, active: r.active !== false, meta: {} }));
  });
  window.CONFIG.load({ v: 1, catalogs, catalogMeta: snap.catalogMeta, settings: snap.settings });
  localStorage.setItem('balam-page', 'pos');
}, cats);
await page.reload({ waitUntil: 'load' });
let reachedPos = true;
try {
  await page.waitForSelector('[data-testid="pos-size-filter"]', { state: 'attached', timeout: 45000 });
} catch (e) {
  reachedPos = false;
  const body = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log('NO se alcanzó la pantalla de POS. Cuerpo visible:\n' + body);
}

const dom = reachedPos ? await page.locator('[data-testid="pos-size-filter"]').evaluate(sel => ({
  global: Array.from(sel.children).filter(n => n.tagName === 'OPTION').map(o => o.textContent.trim()),
  groups: Array.from(sel.querySelectorAll('optgroup')).map(g => ({
    label: g.label,
    sizes: Array.from(g.querySelectorAll('option')).map(o => o.textContent.trim()),
  })),
})) : { global: [], groups: [] };

// El artefacto publicado se interroga también por su autoridad, sin depender de
// haber podido pintar la pantalla: la estructura debe salir de CONFIG.
const authority = await page.evaluate(() => {
  const groups = window.DATA.resolveSizeFilterGroups();
  return {
    categories: groups.map(g => ({ id: g.categoryId, label: g.categoryLabel, count: g.sizes.length })),
    first: groups.map(g => g.sizes.slice(0, 8).map(s => s.label)),
    flatIsDerived: window.DATA.resolveSizeFilterOptions().map(s => s.filterKey).join(',')
      === groups.flatMap(g => g.sizes.map(s => s.filterKey)).join(','),
  };
});
console.log('AUTORIDAD publicada:', JSON.stringify(authority.categories));
authority.first.forEach((sizes, i) => console.log(`  ${authority.categories[i].label}: ${sizes.join(', ')} …`));
console.log('  lista plana derivada de los grupos:', authority.flatIsDerived);

const report = { at: new Date().toISOString(), url: URL, api, authority, reachedPos, dom, pageErrors };
fs.writeFileSync('.evidence-h61/deploy-verification.json', JSON.stringify(report, null, 2));
console.log('window.DATA.resolveSizeFilterGroups →', api.groups);
console.log('opción global:', dom.global.join(', '));
dom.groups.forEach(g => console.log(`grupo "${g.label}" (${g.sizes.length}): ${g.sizes.slice(0, 8).join(', ')}${g.sizes.length > 8 ? ' …' : ''}`));
console.log('errores de página:', pageErrors.length);

await browser.close();
process.exit(api.groups === "function" && authority.categories.length === 2 && authority.flatIsDerived ? 0 : 1);
