// test-h76-vaciar-inventario.mjs — H-76: reemplazar el catálogo completo.
//
// Hoy no existe forma de vaciar el inventario. La importación de Excel ACTUALIZA
// por SKU y jamás borra (`inventory.jsx` § confirmImport); la purga de datos de
// prueba conserva el inventario por diseño (`resetTestData`); y borrar producto
// por producto no es una operación, son N operaciones sin cuenta, sin respaldo y
// sin garantía de terminar.
//
// Contrato que se exige aquí:
//   · una autoridad dice QUÉ contiene el inventario y QUÉ impide vaciarlo;
//   · vaciar no reimplementa el borrado: cada producto sale por `removeProduct`,
//     así que su baja viaja por la cola como cualquier otra;
//   · la decisión es todo o nada: si algo bloquea, no se borra NI UN producto;
//   · bloquean una liquidación de apartado sin reconciliar, un apartado vivo y
//     una cola con operaciones sin subir — y cada bloqueo se afirma en los DOS
//     sentidos (`R-DEL-11`);
//   · no toca catálogos, tallas, descuentos, vendedores ni usuarios: la huella
//     de configuración es idéntica antes y después;
//   · la interfaz no deja borrar sin haber exportado el respaldo.
//
// Uso: node test-h76-vaciar-inventario.mjs
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
await new Promise(r => server.listen(8856, '127.0.0.1', r));

let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort());
  await page.addInitScript(() => { window.print = () => {}; });
  await page.goto('http://127.0.0.1:8856/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 30000 });

  await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) ['pushRows', 'pushConfig', 'pushSale', 'pushReturn', 'pushExchange', 'flushQueue']
      .forEach(k => { if (window.STORE[k]) window.STORE[k] = () => {}; });
    // Espía del gateway: `removeProduct` publica la baja por aquí, así que es la
    // prueba de que el vaciado NO borra sólo en local.
    window.__gw = [];
    window.__cola = 0;
    window.CORE.invokeSync = (method, ...args) => {
      window.__gw.push([method].concat(args.map(a => (typeof a === 'object' ? '·' : String(a)))));
      if (method === 'queueStatus') return { operations: new Array(window.__cola).fill({ id: 'op' }) };
      return { ok: true };
    };

    const LOCKS = 'balam_pos_layaway_product_locks_v1';
    window.__semilla = (opts) => {
      const o = opts || {};
      D.sales.length = 0; D.payments.length = 0; D.products.length = 0;
      ['returns', 'exchanges', 'loans', 'movements', 'promos', 'liquidations'].forEach(k => {
        if (Array.isArray(D[k])) D[k].length = 0;
      });
      try { localStorage.removeItem(LOCKS); } catch (e) { /* */ }
      window.__gw = [];
      window.__cola = o.cola || 0;
      // Tres productos con existencias reales repartidas por talla (`R-DEL-12`).
      [['P-A', 'ADRIANO', [['36', 4], ['38', 6]]],
       ['P-B', 'BRAULIO', [['40', 3]]],
       ['P-C', 'CELSO', [['42', 5], ['44', 2], ['46', 1]]]].forEach(([id, nombre, tallas]) => {
        const p = D.hydrate({
          id, cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
          modelo: id.slice(-1), nombre, orn: '—', ornColors: [], precio: 1000, costo: 100,
          pop: false, stock: [],
        });
        p.stock = tallas.map(([talla, stock]) => ({ talla, escala: 'N', stock }));
        p.attrs = Object.assign({}, p.attrs, { __sizeCategoryId: 'size_number' });
        p.sizeCategoryId = 'size_number';
        D.products.push(p);
      });
      if (o.apartado) {
        D.sales.push({
          folio: 'BG-260804-0001', fecha: '2026-08-04 10:00', cliente: 'PEDRO', clienteId: null,
          estado: 'Apartado', vendedores: [], metodoPago: 'Apartado', total: 1000, anticipo: 300,
          saldo: 700, itemCount: 1,
          lineas: [{ productId: 'P-A', sku: D.products[0].sku, nombre: 'ADRIANO', talla: '38', qty: 1, precio: 1000 }],
        });
      }
      if (o.liquidacionPendiente) {
        try {
          localStorage.setItem(LOCKS, JSON.stringify([{
            operationId: 'op-liq-1', folio: 'BG-260804-0002',
            productIds: ['P-B'], productSnapshots: [],
          }]));
        } catch (e) { /* */ }
      }
      D.saveProducts();
      return window.__huella();
    };
    window.__huella = () => ({
      productos: D.products.length,
      piezas: D.products.reduce((a, p) => a + (p.stock || []).reduce((b, v) => b + (Number(v.stock) || 0), 0), 0),
      ids: D.products.map(p => p.id).join(','),
      catalogos: (window.CONFIG.all('size_number') || []).length,
      descuentos: (D.promos || []).length,
      vendedores: (D.sellers || []).length,
    });
  });

  // ── A) La autoridad existe y cuenta lo que hay ────────────────────────────
  console.log('\n── A) La autoridad del inventario ────────────────────────────────');
  const a = await page.evaluate(() => {
    const D = window.DATA;
    window.__semilla();
    return {
      hayFootprint: typeof D.inventoryFootprint === 'function',
      hayClear: typeof D.clearInventory === 'function',
      f: typeof D.inventoryFootprint === 'function' ? D.inventoryFootprint() : null,
    };
  });
  check('existe DATA.inventoryFootprint()', a.hayFootprint === true);
  check('existe DATA.clearInventory()', a.hayClear === true);
  check('cuenta los productos', !!a.f && a.f.productos === 3, JSON.stringify(a.f && a.f.productos));
  check('cuenta las piezas', !!a.f && a.f.piezas === 21, JSON.stringify(a.f && a.f.piezas));
  check('cuenta los renglones de existencias', !!a.f && a.f.renglones === 6, JSON.stringify(a.f && a.f.renglones));
  check('sin nada pendiente no hay bloqueo', !!a.f && a.f.bloqueado === null, JSON.stringify(a.f && a.f.bloqueado));

  // ── B) Vaciar de verdad ───────────────────────────────────────────────────
  console.log('\n── B) Vaciar deja el inventario en cero y no toca nada más ───────');
  const vac = await page.evaluate(() => {
    const D = window.DATA;
    const antes = window.__semilla();
    if (typeof D.clearInventory !== 'function') return { antes, sinAutoridad: true };
    const r = D.clearInventory();
    return { antes, r, despues: window.__huella(), gw: window.__gw };
  });
  check('vaciar responde ok', !vac.sinAutoridad && !!vac.r && vac.r.ok === true, JSON.stringify(vac.r));
  check('no queda ningún producto', !!vac.despues && vac.despues.productos === 0, JSON.stringify(vac.despues && vac.despues.productos));
  check('informa cuántos productos borró', !!vac.r && vac.r.borrados === 3, JSON.stringify(vac.r && vac.r.borrados));
  check('informa cuántas piezas se retiraron', !!vac.r && vac.r.piezas === 21, JSON.stringify(vac.r && vac.r.piezas));
  check('cada baja viaja por la cola (deleteRow por producto)',
    (vac.gw || []).filter(x => x[0] === 'deleteRow' && x[1] === 'products').length === 3,
    JSON.stringify((vac.gw || []).filter(x => x[0] === 'deleteRow').length));
  check('los catálogos de talla quedan intactos', !!vac.despues && vac.despues.catalogos === vac.antes.catalogos,
    `${vac.antes.catalogos} → ${vac.despues && vac.despues.catalogos}`);
  check('los vendedores quedan intactos', !!vac.despues && vac.despues.vendedores === vac.antes.vendedores);
  check('la huella de configuración no cambió', !!vac.r && vac.r.configIntacta === true, JSON.stringify(vac.r && vac.r.configIntacta));

  // ── C) Un apartado vivo lo bloquea ────────────────────────────────────────
  console.log('\n── C) Un apartado vivo bloquea el vaciado ────────────────────────');
  const apt = await page.evaluate(() => {
    const D = window.DATA;
    const antes = window.__semilla({ apartado: true });
    if (typeof D.clearInventory !== 'function') return { antes, sinAutoridad: true };
    const f = D.inventoryFootprint();
    const r = D.clearInventory();
    return { antes, f, r, despues: window.__huella(), gw: window.__gw };
  });
  check('la autoridad avisa del bloqueo por apartado',
    !apt.sinAutoridad && !!apt.f && apt.f.bloqueado === 'LAYAWAY_ACTIVE', JSON.stringify(apt.f && apt.f.bloqueado));
  check('vaciar se rechaza con un apartado vivo', !!apt.r && apt.r.ok === false, JSON.stringify(apt.r));
  check('el rechazo trae código accionable', !!apt.r && apt.r.code === 'LAYAWAY_ACTIVE', String(apt.r && apt.r.code));
  check('y NO borró ni un producto', !!apt.despues && apt.despues.productos === 3, JSON.stringify(apt.despues && apt.despues.productos));
  check('y no encoló ninguna baja', (apt.gw || []).filter(x => x[0] === 'deleteRow').length === 0);

  // ── D) Una liquidación de apartado sin reconciliar lo bloquea ─────────────
  console.log('\n── D) Una liquidación pendiente bloquea el vaciado ───────────────');
  const liq = await page.evaluate(() => {
    const D = window.DATA;
    window.__semilla({ liquidacionPendiente: true });
    if (typeof D.clearInventory !== 'function') return { sinAutoridad: true };
    const f = D.inventoryFootprint();
    const r = D.clearInventory();
    return { f, r, despues: window.__huella() };
  });
  check('la autoridad avisa del bloqueo por liquidación',
    !liq.sinAutoridad && !!liq.f && liq.f.bloqueado === 'LAYAWAY_LOCK', JSON.stringify(liq.f && liq.f.bloqueado));
  check('vaciar se rechaza con una liquidación pendiente', !!liq.r && liq.r.ok === false && liq.r.code === 'LAYAWAY_LOCK', JSON.stringify(liq.r));
  check('y NO borró ni un producto', !!liq.despues && liq.despues.productos === 3);

  // ── E) Una cola sin subir lo bloquea ──────────────────────────────────────
  console.log('\n── E) La cola pendiente bloquea el vaciado ───────────────────────');
  const cola = await page.evaluate(() => {
    const D = window.DATA;
    window.__semilla({ cola: 4 });
    if (typeof D.clearInventory !== 'function') return { sinAutoridad: true };
    const f = D.inventoryFootprint();
    const r = D.clearInventory();
    const bloqueado = window.__huella();
    // Y con la cola vacía, la MISMA semilla sí se vacía (`R-DEL-11`).
    window.__semilla({ cola: 0 });
    const libre = D.clearInventory();
    return { f, r, bloqueado, libre, despues: window.__huella() };
  });
  check('la autoridad avisa del bloqueo por cola',
    !cola.sinAutoridad && !!cola.f && cola.f.bloqueado === 'QUEUE_PENDING', JSON.stringify(cola.f && cola.f.bloqueado));
  check('vaciar se rechaza con operaciones sin subir',
    !!cola.r && cola.r.ok === false && cola.r.code === 'QUEUE_PENDING', JSON.stringify(cola.r));
  check('y NO borró ni un producto', !!cola.bloqueado && cola.bloqueado.productos === 3);
  check('con la cola vacía la misma semilla sí se vacía',
    !!cola.libre && cola.libre.ok === true && cola.despues.productos === 0, JSON.stringify(cola.libre));

  // ── F) Vaciar lo ya vacío ─────────────────────────────────────────────────
  console.log('\n── F) Sin inventario no hay nada que borrar ──────────────────────');
  const vacio = await page.evaluate(() => {
    const D = window.DATA;
    window.__semilla();
    if (typeof D.clearInventory !== 'function') return { sinAutoridad: true };
    D.clearInventory();
    return { segunda: D.clearInventory(), f: D.inventoryFootprint() };
  });
  check('el inventario vacío se declara vacío, no ok',
    !vacio.sinAutoridad && !!vacio.segunda && vacio.segunda.ok === false && vacio.segunda.code === 'EMPTY',
    JSON.stringify(vacio.segunda));
  check('y la autoridad lo refleja', !!vacio.f && vacio.f.productos === 0 && vacio.f.bloqueado === 'EMPTY');

  // ── G) El recorrido real: Configuración → Inventario ──────────────────────
  console.log('\n── G) El recorrido real: Configuración → Inventario → botón ──────');
  await page.evaluate(() => {
    window.__semilla();
    window.confirm = () => true;
    // El respaldo abre una descarga real; se neutraliza el escritor del archivo.
    if (window.XLSX) window.XLSX.writeFile = () => { window.__respaldoEscrito = (window.__respaldoEscrito || 0) + 1; };
    // Sin sesión el vaciado sería mentira —la nube volvería a bajar el catálogo—,
    // así que la tarjeta debe bloquearse. Se ejerce primero SIN sesión.
    if (window.STORE) window.STORE.hasSession = async () => false;
  });
  const irAInventario = async () => {
    await page.evaluate(() => {
      const x = [...document.querySelectorAll('nav button')].find(e => /Configuraci/i.test(e.innerText));
      if (x) x.click();
    });
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const x = document.querySelector('[data-testid="settings-section-negocio"]');
      if (x) x.click();
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const x = document.querySelector('[data-testid="settings-section-inventario"]');
      if (x) x.click();
    });
    await page.waitForTimeout(700);
  };
  await irAInventario();
  const hayTarjeta = await page.evaluate(() => !!document.querySelector('[data-testid="vaciar-inventario"]'));
  check('la pantalla ofrece el botón de vaciado', hayTarjeta === true);
  const sinRespaldo = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="vaciar-inventario"]');
    return b ? b.disabled === true : null;
  });
  check('el botón está BLOQUEADO mientras no haya respaldo', sinRespaldo === true, String(sinRespaldo));
  await page.evaluate(() => {
    const b = document.querySelector('[data-testid="vaciar-inventario-respaldo"]');
    if (b) b.click();
  });
  await page.waitForTimeout(600);
  const sinSesion = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="vaciar-inventario"]');
    return { habilitado: b ? b.disabled === false : null, escrito: window.__respaldoEscrito || 0 };
  });
  check('el respaldo se exporta de verdad', sinSesion.escrito === 1, String(sinSesion.escrito));
  check('con respaldo pero SIN sesión el botón sigue bloqueado',
    sinSesion.habilitado === false, String(sinSesion.habilitado));
  // Ahora con sesión: la tarjeta se remonta y se rehace el respaldo.
  await page.evaluate(() => { if (window.STORE) window.STORE.hasSession = async () => true; });
  await irAInventario();
  await page.evaluate(() => {
    const b = document.querySelector('[data-testid="vaciar-inventario-respaldo"]');
    if (b) b.click();
  });
  await page.waitForTimeout(600);
  const conRespaldo = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="vaciar-inventario"]');
    return { habilitado: b ? b.disabled === false : null, escrito: window.__respaldoEscrito || 0 };
  });
  check('con sesión y respaldo el botón se libera', conRespaldo.habilitado === true, String(conRespaldo.habilitado));
  await page.evaluate(() => {
    const b = document.querySelector('[data-testid="vaciar-inventario"]');
    if (b) b.click();
  });
  await page.waitForTimeout(900);
  const tras = await page.evaluate(() => window.__huella());
  check('el botón deja el inventario en cero', tras.productos === 0, JSON.stringify(tras.productos));
  check('y no tocó los catálogos de talla', tras.catalogos > 0, JSON.stringify(tras.catalogos));
  const informe = await page.evaluate(() =>
    ([...document.querySelectorAll('[data-testid="vaciar-inventario-informe"]')][0] || {}).textContent || '');
  check('la pantalla informa cuántos productos y piezas se retiraron',
    /3\s+producto/i.test(informe) && /21\s+pieza/i.test(informe), informe.slice(0, 160));

  // ── H) La pantalla Inventario refleja el vaciado ──────────────────────────
  await page.evaluate(() => {
    const x = [...document.querySelectorAll('nav button')].find(e => /Inventario/i.test(e.innerText));
    if (x) x.click();
  });
  await page.waitForTimeout(800);
  const enPantalla = await page.evaluate(() => window.DATA.products.length);
  check('Inventario queda sin productos tras el vaciado', enPantalla === 0, String(enPantalla));

  check('sin errores de consola durante el recorrido', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
