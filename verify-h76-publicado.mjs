// verify-h76-publicado.mjs — H-76: verificación del ARTEFACTO PUBLICADO.
//
// Carga el sitio servido y comprueba, sobre él y no sobre el repositorio:
//   1. el sha256 de lo servido coincide con el artefacto del commit;
//   2. la autoridad del vaciado existe y cuenta lo que hay;
//   3. un apartado vivo lo bloquea y NO borra ni un producto;
//   4. sin bloqueo vacía el inventario y deja intacto todo lo demás;
//   5. la tarjeta real está en Configuración → Inventario y no libera el
//      borrado hasta que haya respaldo.
//
// Uso: node verify-h76-publicado.mjs [url]
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const URL_SITIO = process.argv[2] || 'https://david14081982.github.io/POS_Balam/index.html';
let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const blob = execFileSync('git', ['show', 'HEAD:index.html'], { maxBuffer: 64 * 1024 * 1024 });
const local = createHash('sha256').update(blob).digest('hex');
const bytes = Buffer.from(await (await fetch(URL_SITIO, { cache: 'no-store' })).arrayBuffer());
const servido = createHash('sha256').update(bytes).digest('hex');
check('el sitio sirve exactamente el artefacto del commit', servido === local,
  `servido ${servido.slice(0, 16)}… · commit ${local.slice(0, 16)}…`);
console.log(`   sha256 publicado: ${servido} (${bytes.length} bytes)`);

const b = await chromium.launch({ channel: 'chrome', headless: true });
const errs = [];
try {
  const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
  page.on('pageerror', e => errs.push(String(e)));
  // El artefacto es el PUBLICADO; lo que se corta es la red a Supabase, porque
  // sin credenciales el sitio se queda en la pantalla de acceso y no habría
  // pantalla que recorrer. Sin sesión la app opera en modo local, que es
  // exactamente el estado en el que la tarjeta debe nacer bloqueada.
  await page.route(/supabase\.co/, r => r.abort());
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto(URL_SITIO, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 40000 });

  const r = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'pushExchange', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    window.__gw = [];
    window.CORE.invokeSync = (m, ...a) => { window.__gw.push(m); return m === 'queueStatus' ? { operations: [] } : { ok: true }; };
    const semilla = (apartado) => {
      D.sales.length = 0; D.products.length = 0;
      ['returns', 'exchanges', 'loans', 'movements', 'payments'].forEach(k => { if (Array.isArray(D[k])) D[k].length = 0; });
      try { localStorage.removeItem('balam_pos_layaway_product_locks_v1'); } catch (e) { /* */ }
      window.__gw = [];
      const p = D.hydrate({
        id: 'V-1', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo: '1',
        nombre: 'VERIFICA', orn: '—', ornColors: [], precio: 900, costo: 90, pop: false, stock: [],
      });
      p.stock = [{ talla: '38', escala: 'N', stock: 5 }, { talla: '40', escala: 'N', stock: 2 }];
      p.attrs = Object.assign({}, p.attrs, { __sizeCategoryId: 'size_number' });
      p.sizeCategoryId = 'size_number';
      D.products.push(p);
      if (apartado) {
        D.sales.push({
          folio: 'BG-V-1', fecha: '2026-08-04 10:00', cliente: 'PEDRO', estado: 'Apartado',
          vendedores: [], metodoPago: 'Apartado', total: 900, anticipo: 200, saldo: 700, itemCount: 1,
          lineas: [{ productId: 'V-1', sku: p.sku, nombre: 'VERIFICA', talla: '38', qty: 1, precio: 900 }],
        });
      }
      D.saveProducts();
    };
    const out = { autoridad: typeof D.inventoryFootprint === 'function' && typeof D.clearInventory === 'function' };
    if (!out.autoridad) return out;
    semilla(true);
    out.conApartado = D.clearInventory();
    out.productosTrasBloqueo = D.products.length;
    out.bajasTrasBloqueo = window.__gw.filter(m => m === 'deleteRow').length;
    semilla(false);
    out.antes = D.inventoryFootprint();
    out.vaciado = D.clearInventory();
    out.productosDespues = D.products.length;
    out.bajas = window.__gw.filter(m => m === 'deleteRow').length;
    out.catalogos = (window.CONFIG.all('size_number') || []).length;
    return out;
  });

  check('la autoridad del vaciado viaja en el artefacto publicado', r.autoridad === true);
  check('cuenta las piezas del inventario', !!r.antes && r.antes.piezas === 7, JSON.stringify(r.antes && r.antes.piezas));
  check('un apartado vivo bloquea el vaciado',
    !!r.conApartado && r.conApartado.ok === false && r.conApartado.code === 'LAYAWAY_ACTIVE', JSON.stringify(r.conApartado && r.conApartado.code));
  check('y con el bloqueo no borra ni un producto', r.productosTrasBloqueo === 1 && r.bajasTrasBloqueo === 0,
    `${r.productosTrasBloqueo} producto(s) · ${r.bajasTrasBloqueo} baja(s)`);
  check('sin bloqueo vacía el inventario', !!r.vaciado && r.vaciado.ok === true && r.productosDespues === 0, JSON.stringify(r.vaciado && r.vaciado.ok));
  check('cada baja se publica por la cola', r.bajas === 1, String(r.bajas));
  check('no toca los catálogos de talla', r.catalogos > 0, String(r.catalogos));
  check('la configuración queda intacta', !!r.vaciado && r.vaciado.configIntacta === true);

  // El dominio real exige login (gate de app.jsx). Para RECORRER la pantalla se
  // simula la identidad de administrador SOLO en el navegador del arnés: no hay
  // credenciales, la red a Supabase está cortada y RLS protege los datos reales.
  await page.evaluate(() => {
    const A = window.AUTH;
    const perfil = { id: 'verify-admin', nombre: 'Verificación', role: 'admin', email: 'verify@local' };
    A.hasSession = () => true;
    A.current = () => perfil;
    A.isAdmin = () => true;
    A.canAccess = () => true;
    A.requireAccess = () => true;
    A.isReady = () => true;
    if (window.STORE) window.STORE.setSession = () => Promise.resolve({ ok: true });
    window.dispatchEvent(new Event('authchange'));
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const x = [...document.querySelectorAll('nav button')].find(e => /Configuraci/i.test(e.innerText));
    if (x) x.click();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const x = document.querySelector('[data-testid="settings-section-inventario"]');
    if (x) x.click();
  });
  await page.waitForTimeout(700);
  const ui = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="vaciar-inventario"]');
    return { hay: !!b, bloqueado: b ? b.disabled === true : null, respaldo: !!document.querySelector('[data-testid="vaciar-inventario-respaldo"]') };
  });
  check('la tarjeta está en Configuración → Inventario', ui.hay === true);
  check('ofrece el respaldo antes que el borrado', ui.respaldo === true);
  check('y el botón de borrar nace bloqueado', ui.bloqueado === true, String(ui.bloqueado));
  check('sin errores de consola en el sitio publicado', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones sobre el sitio publicado`);
process.exit(fail ? 1 : 0);
