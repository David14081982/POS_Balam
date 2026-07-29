// test-cambio-e2e.mjs — H-42 (C6): recorrido completo del cambio sobre el BUNDLE.
//
// Ejercita `index.html` —el artefacto distribuido— de punta a punta: localizar la
// venta, elegir la operación, marcar lo que el cliente entrega con su motivo y su
// revisión, escanear el código de barras de lo que se lleva, ver el panel
// recalcular, cobrar la diferencia con el checkout del POS, confirmar vendedor,
// registrar e imprimir.
//
// Supabase queda interceptado: no se escribe una sola fila en la nube.
// `window.print` se sustituye por un contador, para poder AFIRMAR que el
// comprobante se mandó a imprimir sin abrir un diálogo en headless.
//
// Uso: node test-cambio-e2e.mjs
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
await new Promise(r => server.listen(8841, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const ok = (n, c, d = '') => { console.log(`${c ? '✅' : '❌'} ${n}${d ? ` · ${d}` : ''}`); c ? pass++ : fail++; };
const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.route(/supabase\.co/, r => r.abort());
  await page.goto('http://127.0.0.1:8841/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 25000 });

  // ── Semilla: una venta de una talla barata, con otra talla más cara ────────
  const semilla = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushSale = () => {}; window.STORE.pushExchange = () => {}; }
    D.products.length = 0; D.sales.length = 0; D.exchanges.length = 0;
    const T = D.SIZES_LETRA;
    const p = D.hydrate({
      id: 'e2e', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
      modelo: '909', nombre: 'CAMISA E2E', orn: '—', ornColors: [], precio: 350, costo: 0,
      pop: false, stock: D.mkStock([5, 5, 5], []),
    });
    p.preciosTalla = { [T[2]]: 450 };   // la tercera talla vale más
    D.products.push(p); D.saveProducts();
    const v = D.recordSale({
      ticket: [{ p, talla: T[0], qty: 1 }], sellerIds: [], client: null,
      metodo: 'Efectivo', estado: 'Pagado', total: 350, itemCount: 1,
    });
    // Un vendedor ELEGIBLE segun H-29: activo, rol vendedor y sin tombstone.
    D.sellers.length = 0;
    D.sellers.push({ id: 'v1', nombre: 'Vendedor E2E', role: 'vendedor', active: true, comisionPct: 0 });
    return { folio: v.folio, cara: T[2], codigo: window.BARCODES.codeOf(p, T[2]) };
  });

  const click = (re) => page.evaluate((r) => {
    const rx = new RegExp(r, 'i');
    const el = [...document.querySelectorAll('button')].find(x => rx.test((x.innerText || '').trim()));
    if (el) { el.click(); return true; } return false;
  }, re.source || re);
  const texto = () => page.evaluate(() => document.body.innerText);
  const setVal = (sel, val) => page.evaluate(([s, v]) => {
    const i = document.querySelector(s); if (!i) return false;
    const set = Object.getOwnPropertyDescriptor(
      i.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype, 'value').set;
    set.call(i, v); i.dispatchEvent(new Event(i.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    return true;
  }, [sel, val]);

  console.log('\n── 1) Localizar la venta y elegir la operación ─────────');
  await page.evaluate(() => { const x = [...document.querySelectorAll('nav button')].find(e => /Devoluciones/.test(e.innerText)); if (x) x.click(); });
  await page.waitForTimeout(1200);
  await page.evaluate((f) => {
    const i = [...document.querySelectorAll('input')].find(x => /folio|buscar/i.test(x.placeholder || ''));
    if (i) { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      s.call(i, f); i.dispatchEvent(new Event('input', { bubbles: true })); }
  }, semilla.folio);
  await page.waitForTimeout(1000);
  await page.evaluate((f) => { const x = [...document.querySelectorAll('button')].find(e => e.innerText.includes(f)); if (x) x.click(); }, semilla.folio);
  await page.waitForTimeout(1000);
  ok('1. la ficha ofrece el tipo de operación', /tipo de operaci/i.test(await texto()));
  ok('2. se puede entrar al cambio', await click(/^cambio$/i));
  await page.waitForTimeout(900);
  const t3 = await texto();
  ok('3. el método de reembolso no aparece en el cambio', !/método de reembolso/i.test(t3));
  ok('4. el panel de resumen está presente desde el inicio', /resumen del cambio/i.test(t3));

  console.log('\n── 2) Marcar lo que el cliente entrega ─────────────────');
  await page.evaluate(() => { const c = document.querySelector('input[type=checkbox]'); if (c) c.click(); });
  await page.waitForTimeout(600);
  await setVal('select', 'Talla');
  await setVal('input[placeholder*="Excelente"]', 'Excelente, sin uso');
  await page.waitForTimeout(400);
  const panel1 = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="cambio-panel"]');
    return a ? a.innerText.replace(/\s+/g, ' ') : '';
  });
  ok('5. lo marcado aparece en el panel al instante', /ENTREGA[\s\S]*CAMISA E2E/i.test(panel1), panel1.slice(0, 90));
  ok('6. el panel reconoce su valor', /\$350\.00/.test(panel1));

  console.log('\n── 3) Escanear lo que el cliente se lleva ──────────────');
  await page.evaluate((code) => {
    const i = [...document.querySelectorAll('input')].find(x => /c[oó]digo de barras/i.test(x.placeholder || ''));
    if (!i) return;
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    s.call(i, code); i.dispatchEvent(new Event('input', { bubbles: true }));
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }, semilla.codigo);
  await page.waitForTimeout(900);
  const panel2 = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="cambio-panel"]');
    return a ? a.innerText.replace(/\s+/g, ' ') : '';
  });
  ok('7. el código de barras agrega la talla exacta', /RECIBE[\s\S]*CAMISA E2E/i.test(panel2), panel2.slice(-140));
  ok('8. el panel aplica el precio de esa talla (H-36)', /\$450\.00/.test(panel2));
  ok('9. el desglose calcula la diferencia', /100\.00/.test(panel2));
  ok('10. distingue que hay diferencia a cobrar', /diferencia a cobrar/i.test(panel2));

  console.log('\n── 4) Deshacer un error ────────────────────────────────');
  const papeleras = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="cambio-panel"]');
    return a ? a.querySelectorAll('[data-testid="cambio-quitar"]').length : 0;
  });
  const quitarUltimo = () => page.evaluate(() => {
    const a = document.querySelector('[data-testid="cambio-panel"]');
    if (!a) return false;
    const b = a.querySelectorAll('[data-testid="cambio-quitar"]');
    if (!b.length) return false;
    b[b.length - 1].click(); return true;
  });
  ok('11. cada renglón del panel se puede quitar', papeleras === 2, 'papeleras=' + papeleras);
  await quitarUltimo();
  await page.waitForTimeout(600);
  const panel3 = await page.evaluate(() => {
    const a = document.querySelector('[data-testid="cambio-panel"]');
    return a ? a.innerText.replace(/\s+/g, ' ') : '';
  });
  ok('12. quitar un renglón recalcula el resumen', /sin mercanc[ií]a elegida/i.test(panel3), panel3.slice(-90));

  // Volver a agregarla, ahora desde el catálogo
  await click(/CAMISA E2E/); await page.waitForTimeout(700);
  await page.evaluate((t) => {
    const x = [...document.querySelectorAll('button')].find(e => e.innerText.includes(t) && /pz/.test(e.innerText));
    if (x) x.click();
  }, semilla.cara);
  await page.waitForTimeout(800);

  console.log('\n── 5) Cobrar, confirmar vendedor y registrar ───────────');
  await setVal('input[placeholder*="Nombre de quien"]', 'Ana Revisora');
  await page.waitForTimeout(300);
  const accion = () => page.evaluate(() => {
    const b = document.querySelector('[data-testid="cambio-accion"]');
    return b ? { texto: b.innerText.replace(/\s+/g, ' ').trim(), activo: !b.disabled } : null;
  });
  const a13 = await accion();
  ok('13. la acción principal invita a cobrar la diferencia',
    !!a13 && a13.activo && /100\.00/.test(a13.texto), a13 ? a13.texto : 'sin acción');
  await page.evaluate(() => document.querySelector('[data-testid="cambio-accion"]').click());
  await page.waitForTimeout(900);
  ok('14. se abre el checkout del Punto de venta',
    await page.evaluate(() => !!document.querySelector('[data-testid="checkout-confirmar"]')));
  // El cobro exige capturar el efectivo recibido: hasta entonces el botón de
  // confirmar está DESHABILITADO. La prueba lo comprueba en vez de suponerlo.
  const bloqueado = await page.evaluate(() => document.querySelector('[data-testid="checkout-confirmar"]').disabled);
  await page.evaluate(() => {
    const i = document.querySelector('[data-testid="checkout-recibido"]');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, '100'); i.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const libre = await page.evaluate(() => !document.querySelector('[data-testid="checkout-confirmar"]').disabled);
  ok('14b. el cobro no se confirma sin capturar el efectivo recibido', bloqueado && libre);
  await page.evaluate(() => document.querySelector('[data-testid="checkout-confirmar"]').click());
  await page.waitForTimeout(900);
  const vendedores = await page.evaluate(() => document.querySelectorAll('[data-testid="cambio-vendedor"]').length);
  ok('15. pide el vendedor que atiende el cambio', vendedores >= 1, 'candidatos=' + vendedores);
  await page.evaluate(() => document.querySelector('[data-testid="cambio-vendedor"]').click());
  await page.waitForTimeout(1400);

  const cierre = await page.evaluate(() => ({
    texto: document.body.innerText.replace(/\s+/g, ' '),
    impreso: window.__printed || 0,
    ticket: !!document.getElementById('balam-ticket'),
    cambios: (window.DATA.exchanges || []).map(e => ({
      folio: e.folio, dif: e.diferencia, vend: e.vendedorId, rev: e.revisadoPor,
      cond: (e.lineas || []).filter(l => l.lado === 'devuelto').map(l => l.condicion),
    })),
  }));
  ok('16. el cambio quedó registrado', cierre.cambios.length === 1, JSON.stringify(cierre.cambios[0] || {}));
  ok('17. con la diferencia cobrada', (cierre.cambios[0] || {}).dif === 100);
  ok('18. con el vendedor atribuido', !!(cierre.cambios[0] || {}).vend);
  ok('19. con la revisión registrada',
    (cierre.cambios[0] || {}).rev === 'Ana Revisora'
      && ((cierre.cambios[0] || {}).cond || [])[0] === 'Excelente, sin uso');
  ok('20. el acuse confirma el cambio', /cambio registrado/i.test(cierre.texto));
  ok('21. el comprobante se mandó a imprimir solo', cierre.impreso >= 1, 'print×' + cierre.impreso);
  ok('22. el comprobante montado es el ticket único del sistema', cierre.ticket);
  ok('23. el comprobante declara el cambio de mercancía',
    /cambio de mercancia/i.test(cierre.texto) && /entrega/i.test(cierre.texto) && /recibe/i.test(cierre.texto));
  ok('24. cero excepciones de página en todo el recorrido', errs.length === 0, errs.slice(0, 2).join(' | '));
} finally {
  await b.close(); server.close();
}
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
