// test-ux-metrics.mjs — H-43: medidor instrumentado del recorrido del cajero.
//
// NO es un arnés de aprobación: no falla, MIDE. Se ejecuta antes y después de
// cualquier cambio de interfaz y sus dos salidas se comparan (R-DEL-13).
//
// Captura, con escuchas en fase de captura sobre el documento:
//   • clics sobre controles reales;
//   • capturas de texto — un campo cuenta UNA vez, no una por tecla;
//   • selecciones de menú, aparte, porque cuestan dos gestos;
//   • tiempo entre el primer y el último gesto;
//   • validaciones de negocio atravesadas.
//
// Identifica cada paso por `data-testid` cuando existe y sólo entonces por
// texto, para que la traza siga siendo legible cuando el copy cambie (R-DEL-10).
//
// Uso:  node test-ux-metrics.mjs [escenario]     (por omisión: cambio-de-talla)
//       node test-ux-metrics.mjs --json          (vuelca la medición completa)
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = path.resolve('.');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8847, '127.0.0.1', r));

const ESCENARIO = process.argv.find(a => !a.startsWith('-') && /^[a-z-]+$/.test(a) && a !== 'node') || 'cambio-de-talla';
const VOLCADO = process.argv.includes('--json');

const INSTRUMENTO = () => {
  window.__printed = 0; window.print = () => { window.__printed++; };
  const ux = { clics: 0, textos: 0, menus: 0, validaciones: [], pasos: [], t0: null, t1: null };
  window.__ux = ux;
  const camposTocados = new Set();
  const nombra = (el) => el.getAttribute('data-testid')
    || (el.tagName === 'INPUT' ? (el.placeholder || el.type) : (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30))
    || el.tagName.toLowerCase();
  const marca = (tipo, el) => {
    const now = Date.now();
    if (ux.t0 === null) ux.t0 = now;
    ux.t1 = now;
    ux.pasos.push({ n: ux.pasos.length + 1, tipo, control: nombra(el) });
  };
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, [role=button], label, input[type=checkbox]');
    if (!t) return;
    ux.clics++; marca('clic', t);
  }, true);
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.tagName !== 'INPUT' || t.type === 'checkbox') return;
    // Una captura de texto cuenta UNA vez por campo, no una por tecla.
    const id = t.getAttribute('data-testid') || t.placeholder || t.name || String(ux.textos);
    if (camposTocados.has(id)) return;
    camposTocados.add(id);
    ux.textos++; marca('escribe', t);
  }, true);
  document.addEventListener('change', (e) => {
    if (e.target.tagName !== 'SELECT') return;
    ux.menus++; marca('menú', e.target);
  }, true);
  // Validación de negocio atravesada: un control que estaba bloqueado y se libera.
  window.__validacion = (nombre, bloqueado, libre) => ux.validaciones.push({ nombre, bloqueado, libre });
};

const b = await chromium.launch({ channel: 'chrome', headless: true });
let medicion = null;
try {
  const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript(INSTRUMENTO);
  await page.route(/supabase\.co/, r => r.abort());
  await page.goto('http://127.0.0.1:8847/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 25000 });

  // Semilla REPRESENTATIVA del negocio (R-DEL-12): venta real, vendedor elegible
  // según H-29, y otra talla del mismo artículo con precio distinto (H-36).
  const semilla = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushSale = () => {}; window.STORE.pushExchange = () => {}; }
    D.products.length = 0; D.sales.length = 0; D.exchanges.length = 0;
    const T = D.SIZES_LETRA;
    const p = D.hydrate({ id: 'ux', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
      modelo: '777', nombre: 'CAMISA UX', orn: '—', ornColors: [], precio: 350, costo: 0,
      pop: false, stock: D.mkStock([5, 5, 5], []) });
    p.preciosTalla = { [T[2]]: 450 };
    D.products.push(p); D.saveProducts();
    const v = D.recordSale({ ticket: [{ p, talla: T[0], qty: 1 }], sellerIds: [], client: null,
      metodo: 'Efectivo', estado: 'Pagado', total: 350, itemCount: 1 });
    D.sellers.length = 0;
    D.sellers.push({ id: 'v1', nombre: 'Vendedor UX', role: 'vendedor', active: true, comisionPct: 0 });
    return { folio: v.folio, cara: T[2] };
  });
  const espera = (ms) => page.waitForTimeout(ms);
  const teclea = (sel, val) => page.evaluate(([s, v]) => {
    const i = document.querySelector(s); if (!i) return false;
    const proto = i.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, v);
    i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true;
  }, [sel, val]);
  const pulsa = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (e) { e.click(); return true; } return false; }, sel);

  // ── Escenario: cambio de talla ────────────────────────────────────────────
  await page.evaluate(() => { const x = [...document.querySelectorAll('nav button')].find(e => /Devoluciones/.test(e.innerText)); if (x) x.click(); });
  await espera(1200);
  await page.evaluate((f) => {
    const i = [...document.querySelectorAll('input')].find(x => /folio|buscar/i.test(x.placeholder || ''));
    if (i) { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, f);
      i.dispatchEvent(new Event('input', { bubbles: true })); }
  }, semilla.folio);
  await espera(1000);
  await page.evaluate((f) => { const x = [...document.querySelectorAll('button')].find(e => e.innerText.includes(f)); if (x) x.click(); }, semilla.folio);
  await espera(1000);
  await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find(e => /^cambio$/i.test(e.innerText.trim())); if (x) x.click(); });
  await espera(900);
  await pulsa('input[type=checkbox]');
  await espera(600);
  await teclea('select', 'Talla');
  await teclea('input[placeholder*="Excelente"]', 'Excelente, sin uso');
  await espera(400);
  await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find(e => /CAMISA UX/.test(e.innerText)); if (x) x.click(); });
  await espera(700);
  await page.evaluate((t) => {
    const x = [...document.querySelectorAll('button')].find(e => e.innerText.includes(t) && /pz/.test(e.innerText));
    if (x) x.click();
  }, semilla.cara);
  await espera(800);
  await teclea('input[placeholder*="Nombre de quien"]', 'Ana Revisora');
  await espera(300);
  await pulsa('[data-testid="cambio-accion"]');
  await espera(900);
  // Validación de negocio: el cobro está bloqueado hasta capturar el efectivo.
  const bloq = await page.evaluate(() => document.querySelector('[data-testid="checkout-confirmar"]').disabled);
  await teclea('[data-testid="checkout-recibido"]', '100');
  await espera(500);
  const libre = await page.evaluate(() => !document.querySelector('[data-testid="checkout-confirmar"]').disabled);
  await page.evaluate(([n, b, l]) => window.__validacion(n, b, l), ['cobro exige efectivo recibido', bloq, libre]);
  await pulsa('[data-testid="checkout-confirmar"]');
  await espera(900);
  await pulsa('[data-testid="cambio-vendedor"]');
  await espera(1400);

  medicion = await page.evaluate(() => Object.assign({}, window.__ux, {
    impreso: window.__printed,
    registrado: (window.DATA.exchanges || []).length === 1,
    diferencia: ((window.DATA.exchanges || [])[0] || {}).diferencia,
  }));
} finally { await b.close(); server.close(); }

const total = medicion.clics + medicion.textos + medicion.menus;
const seg = medicion.t0 && medicion.t1 ? ((medicion.t1 - medicion.t0) / 1000).toFixed(1) : '—';
console.log(`\n══ MEDICIÓN · escenario «${ESCENARIO}» ══════════════════════`);
console.log(`  clics ................ ${medicion.clics}`);
console.log(`  capturas de texto .... ${medicion.textos}`);
console.log(`  menús desplegados .... ${medicion.menus}`);
console.log(`  ─────────────────────────`);
console.log(`  TOTAL INTERACCIONES .. ${total}`);
console.log(`  tiempo del recorrido . ${seg} s`);
console.log(`\n  recorrido completado: ${medicion.registrado ? 'sí' : 'NO'} · diferencia ${medicion.diferencia} · impresiones ${medicion.impreso}`);
console.log(`  validaciones de negocio atravesadas: ${medicion.validaciones.length}`);
medicion.validaciones.forEach(v => console.log(`    · ${v.nombre} — bloqueado: ${v.bloqueado} · liberado: ${v.libre}`));
console.log('\n  paso a paso:');
medicion.pasos.forEach(p => console.log(`   ${String(p.n).padStart(2)}. ${p.tipo.padEnd(8)} ${p.control}`));
if (VOLCADO) {
  const out = path.join(ROOT, `ux-${ESCENARIO}.json`);
  fs.writeFileSync(out, JSON.stringify({ escenario: ESCENARIO, total, ...medicion }, null, 1));
  console.log(`\n  volcado en ${out}`);
}
console.log('');
