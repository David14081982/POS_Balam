// H-168: recovery of H-157 website tests for the current online contract.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const evidence = process.env.BALAM_WEBSITE_EVIDENCE || 'docs/fixes/evidence/h168-after';
fs.mkdirSync(evidence, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'));
const artifactSha256 = createHash('sha256').update(html).digest('hex');
const results = [], errors = [], commands = [];
let remoteConfig;
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
};
const server = createServer((req, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }), headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await context.addInitScript(() => {
    window.__testRoots = []; window.print = () => {}; let reactDom;
    Object.defineProperty(window, 'ReactDOM', { configurable: true, get: () => reactDom, set: value => {
      reactDom = value; let createRoot;
      Object.defineProperty(value, 'createRoot', { configurable: true, get: () => createRoot, set: implementation => {
        createRoot = (...args) => { const root = implementation(...args); window.__testRoots.push(root); return root; };
      }});
    }});
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('__confirmConfig', async command => {
    if (command.type !== 'config') throw Error('Unexpected write: ' + command.type);
    commands.push(structuredClone(command)); remoteConfig = structuredClone(command.state);
    return structuredClone(remoteConfig);
  });
  async function setup() {
    await page.goto(url);
    await page.waitForFunction(() => window.AUTH?.isReady() && window.SettingsScreen && window.BalamReturnReceipt);
    if (!remoteConfig) {
      remoteConfig = await page.evaluate(() => CONFIG.prepareMutation('reset', []).state);
      delete remoteConfig.settings['ticket.website'];
    }
    await page.evaluate(state => {
      __testRoots.forEach(root => root.unmount());
      document.body.innerHTML = '<div id="h168-host"></div>';
      CONFIG.load(state);
      const snapshot = Object.fromEntries(['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'].map(key => [key, []]));
      snapshot.commissionContext = { periodStart: '', sellerBases: [] }; DATA.replaceFromOnline(snapshot);
      AUTH.canAccess = () => true; AUTH.isAdmin = () => true;
      window.__online = true; window.__reject = false; window.__delay = 0;
      const invoke = CORE.invokeSync;
      CORE.invokeSync = (method, ...args) => {
        if (method === 'serverNow') return new Date('2026-09-12T19:00:00Z');
        if (method === 'assertBusinessReady') { if (!__online) throw Error('Sin conexión. BALAM necesita internet para continuar.'); return true; }
        if (method !== 'execute') {
          try { return invoke(method, ...args); }
          catch (error) { error.message = method + ': ' + error.message; throw error; }
        }
        return (async () => {
          if (__reject) throw Error('REJECTED_CONFIG_FIXTURE');
          if (__delay) await new Promise(resolve => setTimeout(resolve, __delay));
          CONFIG.load(await __confirmConfig(args[0])); return { ok: true };
        })();
      };
    }, remoteConfig);
  }
  async function mountSettings() {
    await page.evaluate(() => {
      window.__h168Root?.unmount();
      __h168Root = ReactDOM.createRoot(document.getElementById('h168-host'));
      __h168Root.render(React.createElement(SettingsScreen));
    });
    await page.getByTestId('settings-section-impresion').click();
  }
  await setup(); await mountSettings();
  const field = page.getByTestId('config-field-ticket.website');
  const fieldExists = await field.count() === 1;
  check('Configuración → Impresión ofrece el campo de página web', fieldExists);
  check('snapshot histórico sin clave muestra BALAMGUAYABERAS.MX', await page.evaluate(() => CONFIG.get('ticket.website')) === 'BALAMGUAYABERAS.MX');
  check('leer el default no modifica el snapshot confirmado', await page.evaluate(() => !Object.hasOwn(CONFIG.snapshot().settings, 'ticket.website')));
  check('tarjeta Página web aparece debajo de Pie de ticket', await page.getByTestId('ticket-website-card').evaluateAll(nodes => !!nodes[0] && nodes[0].previousElementSibling?.textContent.includes('Pie de ticket')));
  if (fieldExists) {
    check('campo muestra el dominio inicial', await field.inputValue() === 'BALAMGUAYABERAS.MX');
    await field.fill('Tienda.Balam.mx/Contacto'); await field.press('Tab');
    await page.waitForFunction(() => CONFIG.get('ticket.website') === 'Tienda.Balam.mx/Contacto');
    check('guardar espera y adopta la confirmación por el gateway vigente', remoteConfig.settings['ticket.website'] === 'Tienda.Balam.mx/Contacto' && commands.length === 1);
    await page.evaluate(() => { const next = CONFIG.snapshot(); next.settings['ticket.website'] = 'Remota.Balam.mx'; CONFIG.load(next); });
    await page.waitForFunction(() => document.querySelector('[data-testid="config-field-ticket.website"]').value === 'Remota.Balam.mx');
    await field.focus(); await field.press('Tab');
    check('una actualización recibida se muestra sin reenviarla al salir', commands.length === 1 && await field.inputValue() === 'Remota.Balam.mx');
    await field.fill('Borrador.Balam.mx');
    await page.evaluate(() => CONFIG.setSetting('ticket.tagline', 'Otro ajuste confirmado.'));
    check('otro ajuste conserva el borrador del campo', await field.inputValue() === 'Borrador.Balam.mx');
    await field.press('Tab');
    await page.waitForFunction(() => CONFIG.get('ticket.website') === 'Borrador.Balam.mx');
    await page.evaluate(() => { __delay = 250; window.__pending = CONFIG.setSetting('ticket.website', 'Confirmada.Balam.mx'); });
    check('una intención pendiente no cambia CONFIG', await page.evaluate(() => CONFIG.get('ticket.website')) === 'Borrador.Balam.mx');
    await page.evaluate(() => __pending); await page.evaluate(() => { __delay = 0; });
    const rejected = await page.evaluate(async () => {
      __reject = true; try { await CONFIG.setSetting('ticket.website', 'Rechazada.Balam.mx'); return false; }
      catch { return CONFIG.get('ticket.website') === 'Confirmada.Balam.mx'; } finally { __reject = false; }
    });
    check('rechazo no cambia la página confirmada', rejected);
    const offline = await page.evaluate(async () => {
      __online = false; try { await CONFIG.setSetting('ticket.website', 'Offline.Balam.mx'); return false; }
      catch { return CONFIG.get('ticket.website') === 'Confirmada.Balam.mx'; } finally { __online = true; }
    });
    check('sin conexión no guarda ni crea una cola', offline);
    check('no almacena configuración comercial en localStorage', await page.evaluate(() => !localStorage.getItem('balam_config_v1')));
    await setup(); await mountSettings();
    check('recarga reconstruye el campo desde el snapshot remoto', await field.inputValue() === 'Confirmada.Balam.mx');
  }
  check('CONFIG.load respeta valor personalizado y vacío explícito', await page.evaluate(() => {
    let next = CONFIG.snapshot(); next.settings['ticket.website'] = 'Remota.Balam.mx'; CONFIG.load(next);
    const custom = CONFIG.get('ticket.website') === 'Remota.Balam.mx';
    next = CONFIG.snapshot(); next.settings['ticket.website'] = ''; CONFIG.load(next);
    return custom && CONFIG.get('ticket.website') === '';
  }));
  // Estado documental válido e inmutable: ni la impresión ni una edición de web
  // deben escribir ventas, pagos, stock o snapshots históricos.
  await page.evaluate(() => {
    __h168Root.unmount();
    const host = document.getElementById('h168-host');
    __h168Root = ReactDOM.createRoot(host);
    window.__h168Sale = {
      id: 'h168-sale', folio: 'BG-260912-0157', fecha: '2026-09-12 12:00', estado: 'Pagado',
      metodo: 'Efectivo', vendedor: 'Vendedora de prueba', cliente: 'Público en general',
      total: 500, subtotal: 431.03, iva: 68.97, ivaPct: 16, ivaIncluded: true, saldo: 0,
      lineas: [{ productId: 'h168-reference', line_id: 'h168-line', sku: 'SKU-H157-M', talla: 'M',
        nombre: 'GUAYABERA DE PRUEBA', qty: 1, precio: 500, precioOrig: 500, precioBase: 500, promos: [] }],
    };
    window.__h168Frozen = { version: 1, sellerName: 'Vendedora de prueba', store: {
      name: 'Balam Guayaberas', footer: 'Gracias por su compra.', tagline: 'Texto histórico preservado.', website: 'SITIO-HISTORICO.COM',
    }, lines: [{ name: 'GUAYABERA DE PRUEBA', sku: 'SKU-H157-M', sizeLabel: 'M' }] };
    window.__h168Business = JSON.stringify([DATA.sales, DATA.payments, DATA.products, DATA.movements, DATA.returns, __h168Sale, __h168Frozen]);
  });
  async function render(kind) {
    await page.evaluate(kind => {
      const sale = { ...__h168Sale };
      if (kind !== 'historica-v1') sale.receiptSnapshot = __h168Frozen;
      if (['anticipo', 'abono'].includes(kind)) { sale.estado = 'Apartado'; sale.saldo = 300; }
      const props = { sale };
      if (['anticipo', 'abono', 'liquidacion', 'cambio'].includes(kind)) props.payment = {
        id: 'h168-payment', folio: sale.folio, fecha: sale.fecha, tipo: kind, monto: 200, metodo: 'Efectivo',
      };
      if (kind === 'cambio') props.exchange = { folio: 'CMB-H157', origenFolio: sale.folio, diferencia: 200,
        lineas: [{ ...sale.lineas[0], lado: 'devuelto' }, { ...sale.lineas[0], lado: 'entregado' }] };
      if (kind === 'devolucion') props.returnDoc = { id: 'DEV-H157', folio: sale.folio, fecha: sale.fecha,
        total: 500, metodo: 'Efectivo', lineas: sale.lineas };
      __h168Root.render(React.createElement(kind === 'devolucion' ? BalamReturnReceipt : BalamTicket, props));
    }, kind);
    const receipt = page.locator(kind === 'devolucion' ? '#balam-return-receipt' : '#balam-ticket');
    await receipt.waitFor({ state: 'attached' });
    await page.waitForTimeout(80);
    return receipt;
  }
  await page.evaluate(() => CONFIG.setSetting('ticket.website', 'Tienda.Balam.mx/Contacto'));
  for (const kind of ['historica-v1', 'venta-v2', 'reimpresion', 'anticipo', 'abono', 'liquidacion', 'cambio', 'devolucion']) {
    const receipt = await render(kind);
    const text = await receipt.innerText();
    check(`${kind}: imprime la web vigente una sola vez`, text.split('Tienda.Balam.mx/Contacto').length === 2);
    check(`${kind}: omite dominio obsoleto y snapshot de contacto`, !/BALAMGUAYABERAS\.COM|SITIO-HISTORICO\.COM/i.test(text));
  }
  let receipt = await render('venta-v2');
  await page.evaluate(() => CONFIG.setSetting('ticket.website', 'Actualizada.Balam.mx'));
  await page.waitForTimeout(100);
  check('ticket ya abierto refleja cambio de configuración', (await receipt.innerText()).includes('Actualizada.Balam.mx'));
  for (const empty of ['', '   ']) {
    await page.evaluate(value => CONFIG.setSetting('ticket.website', value), empty);
    receipt = await render('venta-v2');
    check(`valor ${JSON.stringify(empty)} oculta la web sin recuperar dominio anterior`, await receipt.getByTestId('receipt-website').count() === 0 && !/BALAMGUAYABERAS\.(COM|MX)/i.test(await receipt.innerText()));
  }
  const literal = 'Balam.mx/<img src=x onerror="window.__h168Injected=1">&contacto';
  await page.evaluate(value => CONFIG.setSetting('ticket.website', value), literal);
  receipt = await render('venta-v2');
  check('ticket interpreta el valor como texto literal', (await receipt.textContent()).includes(literal) && await page.evaluate(() => !window.__h168Injected));
  const longWebsite = 'https://' + 'subdominio'.repeat(18) + '.balam.mx/contacto';
  await page.evaluate(value => CONFIG.setSetting('ticket.website', value), longWebsite);
  receipt = await render('venta-v2');
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ media: 'print' });
    const layout = await receipt.evaluate(node => ({ width: node.getBoundingClientRect().width, scroll: node.scrollWidth, text: node.textContent }));
    check(`web larga a ${width}px se conserva completa sin desbordar ticket`, layout.text.includes(longWebsite) && layout.scroll <= Math.ceil(layout.width), layout);
  }
  await receipt.screenshot({ path: path.join(evidence, 'ticket-web-larga.png') });
  await page.pdf({ path: path.join(evidence, 'ticket-web-larga.pdf'), preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  check('cambiar web e imprimir conserva documentos, snapshot y stock', await page.evaluate(() => __h168Business === JSON.stringify([DATA.sales, DATA.payments, DATA.products, DATA.movements, DATA.returns, __h168Sale, __h168Frozen])));

  await page.evaluate(async value => {
    await CONFIG.setSetting('ticket.website', value); __h168Root.render(React.createElement(ReportsScreen));
  }, literal);
  await page.getByTestId('reports-tab-metodos').click();
  const popupPromise = context.waitForEvent('page');
  await page.getByTestId('payment-method-ticket').click();
  const popup = await popupPromise; await popup.waitForLoadState('domcontentloaded');
  check('ticket de Reportes imprime página web literal con HTML escapado', (await popup.locator('main').textContent()).includes(literal)
    && await popup.evaluate(() => !window.__h168Injected && !document.querySelector('img[src="x"]')));
  check('Reportes usa el mismo contrato visible de página web', await popup.getByTestId('receipt-website').count() === 1);
  await popup.close();
  await page.evaluate(() => CONFIG.setSetting('ticket.website', ''));
  const emptyPopupPromise = context.waitForEvent('page');
  await page.getByTestId('payment-method-ticket').click();
  const emptyPopup = await emptyPopupPromise; await emptyPopup.waitForLoadState('domcontentloaded');
  check('web vacía también se omite en ticket de Reportes', await emptyPopup.getByTestId('receipt-website').count() === 0);
  await emptyPopup.close();
  await mountSettings(); await page.setViewportSize({ width: 1280, height: 900 });
  if (fieldExists) {
    await page.getByTestId('config-field-ticket.website').fill('BALAMGUAYABERAS.MX');
    await page.getByTestId('config-field-ticket.website').press('Tab');
  }
  await page.locator('#h168-host').screenshot({ path: path.join(evidence, 'configuracion-impresion-escritorio.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#h168-host').screenshot({ path: path.join(evidence, 'configuracion-impresion-movil.png') });

  check('sin excepciones de navegador', errors.length === 0, errors);
  await context.close();
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ artifactSha256, scope: 'Final HTML; CONFIG and receipts real, remote confirmation simulated; no live Supabase or physical printer', results, errors }, null, 2));
}
console.log(results.filter(result => result.ok).length + '/' + results.length + ' verificaciones · ' + evidence);
process.exitCode = results.some(result => !result.ok) ? 1 : 0;
