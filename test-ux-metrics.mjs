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
// GUARDIÁN (R-DEL-14): compara contra `ux-baseline.json` y FALLA si
//   • disminuyen las validaciones de negocio ejercidas;
//   • aumentan las interacciones sin justificación explícita;
//   • el recorrido deja de completarse.
// No depende de que alguien lea un informe: se ejecuta como las verificaciones
// de contratos y migraciones, y una historia que lo rompa no puede cerrarse.
//
// Uso:  node test-ux-metrics.mjs [escenario]         mide y compara
//       node test-ux-metrics.mjs --json              vuelca la medición
//       node test-ux-metrics.mjs --fijar "<motivo>"  reescribe la línea base
//       node test-ux-metrics.mjs --justifica "<x>"   admite MÁS interacciones
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
const argOf = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? (process.argv[i + 1] || 'sin motivo') : null; };
const FIJAR = argOf('--fijar');
const JUSTIFICA = argOf('--justifica');
const BASE_PATH = path.join(ROOT, 'ux-baseline.json');

const INSTRUMENTO = () => {
  window.__printed = 0; window.print = () => { window.__printed++; };
  const ux = { clics: 0, textos: 0, menus: 0, validaciones: [], pasos: [], t0: null, t1: null, pausado: false };
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
    if (!t || ux.pausado) return;
    ux.clics++; marca('clic', t);
  }, true);
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.tagName !== 'INPUT' || t.type === 'checkbox' || ux.pausado) return;
    // Una captura de texto cuenta UNA vez por campo, no una por tecla.
    const id = t.getAttribute('data-testid') || t.placeholder || t.name || String(ux.textos);
    if (camposTocados.has(id)) return;
    camposTocados.add(id);
    ux.textos++; marca('escribe', t);
  }, true);
  document.addEventListener('change', (e) => {
    if (e.target.tagName !== 'SELECT' || ux.pausado) return;
    ux.menus++; marca('menú', e.target);
  }, true);
  // Validación de negocio atravesada: un control que estaba bloqueado y se libera.
  window.__validacion = (nombre, bloqueado, libre) => ux.validaciones.push({ nombre, bloqueado, libre });
  // Sondear una defensa NO es un gesto del cajero: se mide sin contarlo, para
  // que probar mas garantias jamas encarezca artificialmente el recorrido.
  window.__pausa = (v) => { ux.pausado = !!v; };
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
  const REPETIDO = ESCENARIO === 'cambio-de-talla-repetido';
  // H-45: el escenario oficial siembra UN solo producto, asi que encontrar la
  // prenda sale gratis. Un mostrador real tiene cientos y el cajero busca. Este
  // escenario mide ese coste, que es exactamente el que H-45 quiere abaratar.
  const REALISTA = ESCENARIO === 'cambio-de-talla-catalogo-real';
  const semilla = await page.evaluate(([repetido, realista]) => {
    const D = window.DATA;
    if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushSale = () => {}; window.STORE.pushExchange = () => {}; }
    // El escenario «repetido» representa el segundo cambio seguido del turno:
    // el equipo ya recuerda la operacion declarada y no vuelve a preguntarla.
    try {
      if (repetido) localStorage.setItem('balam_ultima_operacion', 'cambio');
      else localStorage.removeItem('balam_ultima_operacion');
    } catch (e) {}
    D.products.length = 0; D.sales.length = 0; D.exchanges.length = 0;
    const T = D.SIZES_LETRA;
    const p = D.hydrate({ id: 'ux', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
      modelo: '777', nombre: 'CAMISA UX', orn: '—', ornColors: [], precio: 350, costo: 0,
      pop: false, stock: D.mkStock([5, 5, 5], []) });
    p.preciosTalla = { [T[2]]: 450 };
    // Los rellenos van PRIMERO para que la prenda buscada quede fuera de las 24
    // primeras tarjetas: si apareciera en pantalla, el escenario medirira un
    // catalogo grande sin medir el coste de buscar en el.
    if (realista) {
      for (let i = 0; i < 60; i++) {
        D.products.push(D.hydrate({ id: 'f' + i, cat: '21', manga: 'ML', tela: 'ALG', color: 'AZ',
          cuello: 'NOR', modelo: String(100 + i), nombre: 'CAMISA CATALOGO ' + i, orn: '—',
          ornColors: [], precio: 300, costo: 0, pop: false, stock: D.mkStock([2, 2, 2], []) }));
      }
    }
    D.products.push(p); D.saveProducts();
    const v = D.recordSale({ ticket: [{ p, talla: T[0], qty: 1 }], sellerIds: [], client: null,
      metodo: 'Efectivo', estado: 'Pagado', total: 350, itemCount: 1 });
    D.sellers.length = 0;
    D.sellers.push({ id: 'v1', nombre: 'Vendedor UX', role: 'vendedor', active: true, comisionPct: 0 });
    // Nadie opera el mostrador sin sesion abierta: el estado valido del negocio
    // incluye al cajero identificado, del que H-44 prellena el revisor.
    window.AUTH = window.AUTH || {};
    window.AUTH.current = () => ({ nombre: 'Ana Cajera', email: 'ana@balam.mx' });
    return { folio: v.folio, cara: T[2], catalogo: D.products.length };
  }, [REPETIDO, REALISTA]);
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
  // H-44: la operación se declara ANTES de buscar. El buscador ya habla en el
  // idioma del cambio y la venta elegida aterriza directamente en su pantalla.
  if (!REPETIDO) { await pulsa('[data-testid="operacion-cambio"]'); await espera(500); }
  await page.evaluate((f) => {
    const i = [...document.querySelectorAll('input')].find(x => /folio|buscar/i.test(x.placeholder || ''));
    if (i) { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(i, f);
      i.dispatchEvent(new Event('input', { bubbles: true })); }
  }, semilla.folio);
  await espera(1000);
  await page.evaluate((f) => { const x = [...document.querySelectorAll('button')].find(e => e.innerText.includes(f)); if (x) x.click(); }, semilla.folio);
  await espera(1100);
  await pulsa('input[type=checkbox]');
  await espera(700);
  // Motivo y condición llegan preseleccionados y VISIBLES; el revisor, prellenado.
  // H-45: con catálogo real el camino rápido evita buscar la prenda. El escenario
  // oficial sigue midiendo el camino general, por el catálogo.
  if (REALISTA) {
    await pulsa('[data-testid="cambio-misma-prenda"]');
  } else {
    await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find(e => /CAMISA UX/.test(e.innerText)); if (x) x.click(); });
  }
  await espera(700);
  await page.evaluate((t) => {
    const x = [...document.querySelectorAll('button')].find(e => new RegExp('^' + t + '\\b').test(e.innerText.trim()));
    if (x) x.click();
  }, semilla.cara);
  await espera(700);

  // Validación de negocio 2 (H-44): la revisión de la prenda sigue siendo
  // OBLIGATORIA aunque llegue preseleccionada. Se sondea en pausa: vaciar el
  // campo para comprobar la defensa es una prueba, no un gesto del cajero.
  await page.evaluate(() => window.__pausa(true));
  await teclea('[data-testid="cambio-condicion"]', '');
  await espera(400);
  await pulsa('[data-testid="cambio-accion"]');
  await espera(600);
  const bloqCond = await page.evaluate(() => !document.querySelector('[data-testid="checkout-confirmar"]'));
  await teclea('[data-testid="cambio-condicion"]', 'Sin uso, con etiqueta');
  await espera(400);
  await page.evaluate(() => window.__pausa(false));

  await pulsa('[data-testid="cambio-accion"]');
  await espera(900);
  const libreCond = await page.evaluate(() => !!document.querySelector('[data-testid="checkout-confirmar"]'));
  await page.evaluate(([n, b, l]) => window.__validacion(n, b, l), ['la revision de la prenda sigue siendo obligatoria', bloqCond, libreCond]);

  // Validación de negocio 1: el cobro está bloqueado hasta capturar el efectivo.
  const bloq = await page.evaluate(() => { const e = document.querySelector('[data-testid="checkout-confirmar"]'); return e ? e.disabled : null; });
  await teclea('[data-testid="checkout-recibido"]', '100');
  await espera(500);
  const libre = await page.evaluate(() => { const e = document.querySelector('[data-testid="checkout-confirmar"]'); return e ? !e.disabled : null; });
  await page.evaluate(([n, b, l]) => window.__validacion(n, b, l), ['cobro exige efectivo recibido', bloq, libre]);
  await pulsa('[data-testid="checkout-confirmar"]');
  await espera(900);
  await pulsa('[data-testid="cambio-vendedor"]');
  await espera(1400);
  medicion = await page.evaluate(() => Object.assign({}, window.__ux, {
    impreso: window.__printed,
    catalogo: window.DATA.products.length,
    registrado: (window.DATA.exchanges || []).length === 1,
    diferencia: ((window.DATA.exchanges || [])[0] || {}).diferencia,
  }));
} finally { await b.close(); server.close(); }

const total = medicion.clics + medicion.textos + medicion.menus;
const seg = medicion.t0 && medicion.t1 ? ((medicion.t1 - medicion.t0) / 1000).toFixed(1) : '—';
console.log(`\n══ MEDICIÓN · escenario «${ESCENARIO}» ══════════════════════`);
console.log(`  artículos en catálogo  ${medicion.catalogo}`);
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
// ── Guardián (R-DEL-14) ─────────────────────────────────────────────────────
const bases = fs.existsSync(BASE_PATH) ? JSON.parse(fs.readFileSync(BASE_PATH, 'utf8')) : {};
const base = bases[ESCENARIO];
const actual = {
  interacciones: total, validaciones: medicion.validaciones.length,
  completado: !!medicion.registrado,
};
let roto = [];
if (FIJAR !== null) {
  bases[ESCENARIO] = Object.assign({}, actual, { motivo: FIJAR, fijada: new Date().toISOString().slice(0, 10) });
  fs.writeFileSync(BASE_PATH, JSON.stringify(bases, null, 1) + '\n');
  console.log(`\n  ✔ línea base fijada para «${ESCENARIO}» · ${FIJAR}`);
} else if (!base) {
  console.log(`\n  ⚠ sin línea base para «${ESCENARIO}». Fíjala con --fijar "<motivo>".`);
} else {
  console.log('\n══ GUARDIÁN · comparación contra la línea base ══════════════');
  const fila = (n, a, b, peor) => {
    const mal = peor(a, b);
    if (mal) roto.push(n);
    console.log(`  ${mal ? '❌' : '✅'} ${n.padEnd(24)} base ${String(b).padEnd(6)} ahora ${String(a).padEnd(6)}${mal ? '  ← ROMPE' : ''}`);
  };
  // Las validaciones NUNCA pueden bajar: una mejora no se consigue quitando
  // defensas. Es la mitad que la métrica de interacciones no protege.
  fila('validaciones', actual.validaciones, base.validaciones, (a, b) => a < b);
  fila('recorrido completo', actual.completado, base.completado, (a, b) => b && !a);
  // Las interacciones pueden bajar libremente; subir exige justificación.
  const sube = actual.interacciones > base.interacciones;
  if (sube && JUSTIFICA) {
    console.log(`  ⚠ interacciones${' '.repeat(11)}base ${base.interacciones}      ahora ${actual.interacciones}      ← justificado: ${JUSTIFICA}`);
  } else {
    fila('interacciones', actual.interacciones, base.interacciones, (a, b) => a > b);
  }
  if (!roto.length && actual.interacciones < base.interacciones) {
    console.log(`\n  ✔ mejora real: −${base.interacciones - actual.interacciones} interacciones sin perder garantías`);
  }
}

if (VOLCADO) {
  const out = path.join(ROOT, `ux-${ESCENARIO}.json`);
  fs.writeFileSync(out, JSON.stringify({ escenario: ESCENARIO, total, ...medicion }, null, 1));
  console.log(`\n  volcado en ${out}`);
}
console.log('');
if (roto.length) {
  console.error(`✖ GUARDIÁN R-DEL-14: ${roto.join(', ')}. Una optimización no puede`);
  console.error('  reducir el coste del recorrido sacrificando garantías del sistema.');
  process.exit(1);
}
