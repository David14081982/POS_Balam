import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const root = resolve('.');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = createServer((req, res) => {
  const pathname = decodeURIComponent(req.url.split('?')[0]);
  const file = join(root, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(root) || !existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise(done => server.listen(8814, '127.0.0.1', done));

const forbiddenSource = String.raw`\b(?:V1|V2|V3|products?\.id|UUID|barcode_code|reference_family_id|RPC|RLS|Supabase|tombstones?|epoch|protocolo|rebootstrap|cach[eé]|cola|JSON|HID|Code\s*128|m[oó]dulos?|encoding|namespace|manifest|hash|commit|SHA(?:-?256)?|schema|payload|SQL|localStorage|fallback|alias|resolver|sync_activity)\b|\bHTTP\s*\d{3}\b|\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b`;
let pass = 0, fail = 0;
const check = (name, value, detail = '') => {
  console.log(`${value ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  value ? pass++ : fail++;
};

let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route(/supabase\.co/, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'simulated remote failure' }) }));
  await page.addInitScript(() => {
    localStorage.setItem('balam-page', 'dashboard');
    localStorage.setItem('balam-sidebar', '0');
  });
  await page.goto('http://127.0.0.1:8814/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.App && window.UI && window.DATA, null, { timeout: 30000 });

  const scan = async label => {
    const hits = await page.evaluate(({ source }) => {
      const forbidden = new RegExp(source, 'gi');
      const values = [];
      const add = (where, value) => {
        const text = String(value || '').trim();
        if (!text) return;
        const found = [...text.matchAll(new RegExp(source, 'gi'))];
        const matches = found.map(match => match[0]);
        if (matches.length) values.push({ where, matches: [...new Set(matches)], text: found.slice(0, 6).map(match => text.slice(Math.max(0, match.index - 70), match.index + match[0].length + 100)).join(' … ') });
      };
      const visible = document.body.cloneNode(true);
      visible.querySelectorAll('script,style,.material-symbols-outlined,[data-technical-details],details:not([open])').forEach(node => node.remove());
      add('visible text', visible.textContent);
      document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(element => {
        if (element.closest('[data-technical-details]')) return;
        if (element.closest('details:not([open])')) return;
        for (const attr of ['placeholder', 'title', 'aria-label']) add(`${element.tagName}.${attr}`, element.getAttribute(attr));
      });
      return values;
    }, { source: forbiddenSource });
    check(`${label} sin jerga visible`, hits.length === 0, hits.map(hit => `${hit.matches.join(', ')}: ${hit.text}`).join(' | '));
  };

  const pages = [
    ['dashboard', 'Panel de control', 'Panel de control'], ['pos', 'Punto de venta', 'Punto de venta'], ['inventario', 'Inventario', 'Inventario'],
    ['clientes', 'Clientes', 'Clientes'], ['apartados', 'Apartados', 'Apartados'], ['prestamos', 'Préstamos', 'Préstamos'],
    ['devoluciones', 'Devoluciones', 'Devoluciones'], ['descuentos', 'Promociones y descuentos', 'Descuentos'], ['vendedores', 'Vendedores y comisiones', 'Vendedores'],
    ['reportes', 'Reportes', 'Reportes'], ['config', 'Configuración', 'Configuración'],
  ];
  for (const [id, title, buttonTitle] of pages) {
    if (id !== 'dashboard') await page.locator(`button[title="${buttonTitle}"]`).click();
    await page.waitForFunction(expected => document.querySelector('header h1')?.textContent.trim() === expected, title);
    await scan(`pantalla ${id}`);
  }

  const sections = await page.locator('[data-testid^="settings-section-"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')));
  for (const testId of sections) {
    await page.getByTestId(testId).click();
    await page.waitForTimeout(40);
    await scan(testId);
  }

  await page.locator('button[title="Inventario"]').click();
  await page.waitForFunction(() => document.querySelector('header h1')?.textContent.trim() === 'Inventario');
  const labels = page.getByTestId('inventory-labels');
  if (await labels.count() && await labels.isEnabled()) {
    await labels.click();
    const modal = page.getByTestId('label-modal');
    await modal.waitFor({ state: 'visible', timeout: 1200 }).catch(() => {});
    if (await modal.isVisible().catch(() => false)) await scan('modal de etiquetas');
  }

  await page.evaluate(() => {
    const cases = [
      { code: '42501', message: 'row-level security policy rejected RPC payload' },
      { code: 'PGRST205', message: 'schema cache lookup failed' },
      { code: 'sync_protocol_outdated', message: 'rebootstrap_required epoch 8' },
      { code: 'BARCODE_AMBIGUOUS', message: 'Code128 resolves multiple UUID values' },
      { code: 'quota_exceeded', message: 'localStorage queue persistence failed' },
      { code: 'unknown_error', message: 'HTTP 500 Supabase RPC payload rejected' },
    ];
    cases.forEach(value => window.UI.toast(value, 'var(--danger)'));
  });
  await scan('errores remotos inyectados');
  check('personal no administrativo no recibe detalles técnicos', await page.locator('[data-technical-details]').count() === 0);
  check('sin excepciones de navegador', errors.length === 0, errors.join(' | '));
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}

console.log(`H134_E2E pasaron=${pass} fallaron=${fail}`);
process.exit(fail ? 1 : 0);
