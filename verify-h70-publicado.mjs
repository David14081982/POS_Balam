// verify-h70-publicado.mjs — H-70: verificación del ARTEFACTO PUBLICADO.
//
// No inspecciona el archivo: lo carga desde el sitio servido y le pregunta al
// programa en ejecución. Un `grep` sobre index.html no prueba que la autoridad
// exista ni que la pantalla la consuma.
//
// Comprueba, en este orden:
//   1. El sha256 de lo servido coincide con el artefacto del commit.
//   2. `window.DATA.clientSalesSummary` existe y responde en el navegador.
//   3. Un cliente real con sus ventas se ve en la tabla y en su cajón.
//
// La producción exige iniciar sesión, así que el recorrido normal no llega a
// Clientes sin credenciales. Por eso la pantalla se monta aquí directamente
// —`window.ClientsScreen` del MISMO paquete servido— sobre datos creados por las
// autoridades reales del paquete. Lo que se audita es el código publicado, no una
// copia local ni una captura vieja.
//
// Deja una captura en .evidence-h70/ como evidencia visual.
//
// Uso: node verify-h70-publicado.mjs [url]
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const URL_SITIO = process.argv[2] || 'https://david14081982.github.io/POS_Balam/index.html';
let pass = 0, fail = 0;
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };
const num = (s) => Number(String(s == null ? '' : s).replace(/[^0-9.-]/g, '')) || 0;

// ── 1) Identidad del artefacto servido ───────────────────────────────────────
// Se compara contra el BLOB DEL COMMIT, no contra el archivo del disco: en
// Windows la copia de trabajo tiene CRLF y el repositorio guarda LF, así que el
// archivo local pesa un byte más por línea aunque el contenido sea el mismo. Lo
// que el sitio sirve es exactamente lo que el commit guardó.
const blob = execFileSync('git', ['show', 'HEAD:index.html'], { maxBuffer: 64 * 1024 * 1024 });
const local = createHash('sha256').update(blob).digest('hex');
const bytes = Buffer.from(await (await fetch(URL_SITIO, { cache: 'no-store' })).arrayBuffer());
const servido = createHash('sha256').update(bytes).digest('hex');
check('el sitio sirve exactamente el artefacto del commit', servido === local, `servido ${servido.slice(0, 16)}… · commit ${local.slice(0, 16)}…`);
console.log(`   sha256 publicado: ${servido} (${bytes.length} bytes)`);

const b = await chromium.launch({ channel: 'chrome', headless: true });
const errs = [];
try {
  const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort()); // la nube exige login; aquí sólo se audita el motor
  await page.addInitScript(() => { localStorage.setItem('balam-page', 'clientes'); });
  await page.goto(URL_SITIO, { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.STORE, null, { timeout: 30000 });

  // ── 2) La autoridad existe EN EJECUCIÓN ────────────────────────────────────
  const api = await page.evaluate(() => ({
    resumen: typeof window.DATA.clientSalesSummary,
    resumenes: typeof window.DATA.clientSalesSummaries,
    actualizar: typeof window.DATA.updateClient,
    pushClient: typeof window.STORE.pushClient,
  }));
  check('DATA publica la autoridad de compras del cliente',
    api.resumen === 'function' && api.resumenes === 'function', JSON.stringify(api));
  check('DATA publica la edición por identidad y STORE el envío por ficha',
    api.actualizar === 'function' && api.pushClient === 'function', JSON.stringify(api));

  // ── 3) Un cliente con sus ventas, creado por las autoridades reales ────────
  const seed = await page.evaluate(() => {
    const D = window.DATA;
    window.STORE.pushRows = () => {}; window.STORE.pushSale = () => {};
    window.STORE.pushClient = () => {}; window.STORE.pushReturn = () => {};
    D.sales.length = 0; D.returns.length = 0; D.exchanges.length = 0;
    D.payments.length = 0; D.products.length = 0; D.movements.length = 0;
    D.products.push(D.hydrate({
      id: 'v70-p', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
      modelo: '970', nombre: 'GUAYABERA VERIFICACION', orn: '—', ornColors: [],
      precio: 1200, costo: 0, pop: false, stock: D.mkStock([0, 30, 0], []),
    }));
    D.saveProducts();
    const P = D.products[0], talla = D.SIZES_LETRA[1];
    D.clients.length = 0;
    const cli = { id: 'v70-c', nombre: 'Verónica Balam', tel: '9991234567', compras: 0, total: 0, ultima: '', talla: 'M', notas: '', generic: false };
    D.clients.push(cli, { id: 'c7', nombre: 'Público en general', tel: '—', compras: 0, total: 0, ultima: '', talla: '', notas: '', generic: true });
    D.saveClients(false);
    const venta = (total, fecha) => D.recordSale({
      ticket: [{ p: P, talla, qty: 1, res: { unit: total, orig: total, promos: [] } }],
      sellerIds: [], client: cli, metodo: 'Efectivo', estado: 'Pagado', itemCount: 1,
      subtotal: Math.round((total / 1.16) * 100) / 100, iva: Math.round((total - total / 1.16) * 100) / 100,
      total, anticipo: total, pagoEfectivo: total, pagoOtro: 0, ivaPct: 16, ivaIncluded: true, fecha,
    });
    venta(1200, '2026-07-22 11:00');
    venta(800, '2026-08-01 16:30');
    D.saveSales();
    // Contadores desnormalizados APAGADOS: es el estado real de una terminal que
    // no cobró esas ventas, o de cualquiera después del pull.
    D.clients.forEach(c => { c.compras = 0; c.total = 0; c.ultima = ''; });
    D.saveClients(false);
    window.dispatchEvent(new CustomEvent('configchange', { detail: { domain: true } }));
    return { contadoresEnCero: D.clients.every(c => !c.compras && !c.total) };
  });
  check('los contadores desnormalizados están en cero (peor caso real)', seed.contadoresEnCero === true);

  // Montaje de la pantalla PUBLICADA (la sesión de producción no está disponible
  // aquí; ver nota de cabecera). Se usa el mismo componente que registra el
  // paquete servido, sin sustituir ni parchear nada.
  const montada = await page.evaluate(() => {
    if (typeof window.ClientsScreen !== 'function') return 'sin ClientsScreen';
    const host = document.createElement('div');
    host.id = 'h70-host';
    document.body.innerHTML = '';
    document.body.appendChild(host);
    window.ReactDOM.createRoot(host).render(window.React.createElement(window.ClientsScreen));
    return 'ok';
  });
  check('el paquete publicado registra la pantalla Clientes', montada === 'ok', montada);

  await page.waitForTimeout(700);
  const fila = await page.evaluate(() => {
    const tr = document.querySelector('[data-testid="clients-row"][data-client-id="v70-c"]');
    if (!tr) return null;
    const t = id => { const el = tr.querySelector(`[data-testid="${id}"]`); return el ? el.textContent : ''; };
    return { nombre: t('clients-cell-nombre'), compras: t('clients-cell-compras'), total: t('clients-cell-total'), ultima: t('clients-cell-ultima') };
  });
  check('la tabla muestra al cliente con sus compras derivadas',
    !!fila && num(fila.compras) === 2 && num(fila.total) === 2000 && /01\/08\/26/.test(fila.ultima),
    JSON.stringify(fila));

  const kpis = await page.evaluate(() => {
    const v = id => { const el = document.querySelector(`[data-testid="${id}"]`); return el ? el.textContent : null; };
    return { registrados: v('clients-kpi-registrados'), facturado: v('clients-kpi-facturado') };
  });
  check('los KPI concuerdan con la columna', num(kpis.facturado) === 2000 && num(kpis.registrados) === 1, JSON.stringify(kpis));

  await page.evaluate(() => document.querySelector('[data-testid="clients-row"][data-client-id="v70-c"]').click());
  await page.waitForTimeout(500);
  const cajon = await page.evaluate(() => {
    const dr = document.querySelector('[data-testid="client-drawer"]');
    if (!dr) return null;
    const t = id => { const el = dr.querySelector(`[data-testid="${id}"]`); return el ? el.textContent : ''; };
    return { compras: t('client-drawer-compras'), total: t('client-drawer-total'), ultima: t('client-drawer-ultima'), folios: [...dr.querySelectorAll('[data-testid="client-history-row"]')].map(x => x.getAttribute('data-folio')) };
  });
  check('el cajón muestra el historial de ventas del cliente',
    !!cajon && num(cajon.compras) === 2 && num(cajon.total) === 2000 && cajon.folios.length === 2,
    JSON.stringify(cajon));

  mkdirSync('.evidence-h70', { recursive: true });
  await page.screenshot({ path: '.evidence-h70/clientes-con-sus-ventas.png', fullPage: false });
  console.log('   captura: .evidence-h70/clientes-con-sus-ventas.png');
  check('sin errores de página durante el recorrido', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
}
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
