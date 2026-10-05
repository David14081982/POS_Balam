// H-185: measure complete sale receipts before/after the approved presentation change.
// Transport/lifecycle are covered by H-179/H-180/H-183/H-184; hardware is NOT_TESTED.
// --baseline records the current artifact and intentionally fails the new contract.
// --fijar "reason" records the improved ceiling only after every check passes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const baseline = process.argv.includes('--baseline'), fixIndex = process.argv.indexOf('--fijar');
const reason = fixIndex >= 0 ? process.argv[fixIndex + 1] : null;
if (fixIndex >= 0 && (!reason || reason.startsWith('--'))) throw Error('--fijar requires a reason');
const evidenceDir = 'docs/fixes/evidence', stem = evidenceDir + '/h185-sale-ticket-';
const original = !baseline ? JSON.parse(fs.readFileSync(stem + 'baseline.json', 'utf8')) : null;
const ceiling = !baseline && fs.existsSync(stem + 'ceiling.json') ? JSON.parse(fs.readFileSync(stem + 'ceiling.json', 'utf8')) : null;
const html = fs.readFileSync('index.html'), sha = value => createHash('sha256').update(value).digest('hex');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'balam-h185-'));
const evidence = { baseline, date: new Date().toISOString(), artifactSHA256: sha(html), hardware: 'NOT_TESTED', results: [], cases: {} };
const test = (name, check) => {
  try { check(); evidence.results.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { evidence.results.push({ name, ok: false, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); }
};
const server = createServer((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE
    ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE, headless: true } : { channel: 'chrome', headless: true });
  evidence.renderer = { browser: browser.version(), platform: process.platform };
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1024, height: 900 } });
  await context.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.BalamTicket && window.UI?.receiptGraphic && window.CONFIG && window.DATA);
  const measured = await page.evaluate(async () => {
    const footer = '¡Gracias por su compra! Máximo 7 días para cambios.';
    for (const [key, value] of [['store.logo', ''], ['ticket.footer', footer], ['ticket.tagline', 'Piezas artesanales únicas.'], ['ticket.website', 'BALAMGUAYABERAS.MX']])
      CONFIG.load(CONFIG.prepareMutation('setSetting', [key, value]).state);
    const payments = {};
    DATA.paymentsForSale = folio => (payments[folio] || []).slice();
    const make = (id, count = 1, legacy = false) => {
      const lineas = Array.from({ length: count }, (_, i) => ({ lineId: id + '-line-' + i, productId: id + '-product-' + i,
        sku: 'SKU-H185-CADENA-COMPLETA-' + i, nombre: 'PRENDA LEGACY H185 ' + (i + 1), talla: '3XG', qty: i === 0 ? 2 : 1,
        precio: 450, precioOrig: 450, precioBase: 450, promos: [], ornamento: 'APLICACION-H185', ornColors: ['MULTICOLORES-H185'] }));
      const total = (count + 1) * 450;
      const sale = { folio: 'H185-' + id, fecha: '2026-10-05 12:00', vendedor: 'VENDEDOR H185', metodo: 'Tarjeta', estado: 'Pagado',
        total, descuento: 0, subtotal: total / 1.16, iva: total - total / 1.16, ivaPct: 16, ivaIncluded: true, anticipo: total, saldo: 0, lineas };
      if (!legacy) sale.receiptSnapshot = { version: 1, store: { name: 'TIENDA HISTORICA H185', footer, tagline: 'Piezas artesanales únicas.' },
        sellerName: 'VENDEDOR CONGELADO H185', lines: lineas.map((line, i) => ({ lineId: line.lineId, productId: line.productId,
          sku: line.sku, name: 'PRENDA HISTORICA H185 ' + (i + 1), sizeCode: '3XG', sizeLabel: '3XG HISTORICA', colorLabel: 'BLANCO HISTORICO',
          ornamentLabel: 'APLICACION-H185', ornamentColors: [{ code: 'MC', label: 'MULTICOLORES-H185' }], attributes: [] })) };
      payments[sale.folio] = [{ id: id + '-payment', folio: sale.folio, tipo: 'venta', metodo: sale.metodo, monto: total, fecha: sale.fecha }];
      return { sale };
    };
    const cases = { corta: make('CORTA'), larga: make('LARGA', 12), legacy: make('LEGACY', 1, true), mixto: make('MIXTO'), reimpresion: make('REIMPRESION') };
    cases.mixto.sale.metodo = 'Mixto'; payments[cases.mixto.sale.folio][0].metodo = 'Mixto';
    payments[cases.reimpresion.sale.folio].push({ id: 'exchange-pay', tipo: 'cambio', metodo: 'Efectivo', monto: 100, fecha: '2026-10-05 13:00' });
    for (const kind of ['apartado', 'anticipo', 'abono', 'liquidacion', 'apartadoLiquidado', 'cambio', 'cortesia']) {
      const props = cases[kind] = make(kind.toUpperCase()), sale = props.sale;
      if (kind === 'cortesia') { sale.valorRegalado = sale.total; sale.total = sale.anticipo = 0; sale.metodo = 'Cortesía'; payments[sale.folio] = []; }
      else if (kind === 'cambio') props.exchange = { folio: 'CMB-H185', origenFolio: sale.folio, diferencia: 0, valorNoAprovechado: 0,
        lineas: [{ ...sale.lineas[0], lado: 'devuelto' }, { ...sale.lineas[0], lado: 'entregado' }] };
      else {
        sale.metodo = 'Apartado'; sale.estado = ['liquidacion', 'apartadoLiquidado'].includes(kind) ? 'Pagado' : 'Apartado';
        sale.saldo = sale.estado === 'Pagado' ? 0 : 450; sale.anticipo = sale.total - sale.saldo;
        const first = { id: kind + '-first', folio: sale.folio, tipo: 'anticipo', metodo: 'Efectivo', monto: 450, fecha: sale.fecha };
        payments[sale.folio] = [first];
        if (['abono', 'liquidacion', 'apartadoLiquidado'].includes(kind)) payments[sale.folio].push({ ...first, id: kind + '-last', tipo: kind === 'abono' ? 'abono' : 'liquidacion', monto: kind === 'abono' ? 100 : 450 });
        if (kind === 'abono') { sale.anticipo = 550; sale.saldo = 350; }
        if (['anticipo', 'abono', 'liquidacion'].includes(kind)) props.payment = payments[sale.folio].at(-1);
      }
    }
    const business = () => JSON.stringify([CONFIG.snapshot(), DATA.sales, DATA.products, DATA.payments, DATA.movements, DATA.returns, cases, payments]);
    const before = business(), host = document.createElement('div'); document.body.append(host);
    const root = ReactDOM.createRoot(host), out = {};
    const style = element => { const s = getComputedStyle(element); return { fontSize: s.fontSize, fontFamily: s.fontFamily, lineHeight: s.lineHeight }; };
    for (const [name, props] of Object.entries(cases)) {
      root.render(React.createElement(BalamTicket, props));
      const id = props.exchange?.folio || props.sale.folio;
      for (let i = 0; i < 100 && document.getElementById('balam-ticket')?.dataset.documentId !== id; i++) await new Promise(resolve => setTimeout(resolve, 20));
      await document.fonts.ready;
      const ticket = document.getElementById('balam-ticket'), normal = ['corta', 'larga', 'legacy', 'mixto', 'reimpresion'].includes(name);
      const items = [...ticket.querySelectorAll('span')].filter(node => /^PRENDA (HISTORICA|LEGACY) H185 \d+$/.test(node.textContent));
      const methodLabel = [...ticket.querySelectorAll('p')].find(node => node.textContent === 'Método de pago');
      const thanks = [...ticket.querySelectorAll('p')].find(node => node.textContent === footer);
      const text = ticket.innerText, content = { normal, text, height: ticket.getBoundingClientRect().height,
        gap: methodLabel ? thanks.getBoundingClientRect().top - methodLabel.nextElementSibling.getBoundingClientRect().bottom : null,
        itemGap: items.length > 1 ? items[1].parentElement.parentElement.getBoundingClientRect().top - items[0].parentElement.parentElement.getBoundingClientRect().bottom : null,
        fonts: { name: style(items[0]), price: style(items[0].nextElementSibling), detail: style(items[0].parentElement.nextElementSibling), thanks: style(thanks) },
        guarantees: { items: items.length, expectedItems: props.sale.lineas.length, names: items.every((node, i) => node.textContent === (props.sale.receiptSnapshot?.lines[i].name || props.sale.lineas[i].nombre)),
          sizes: text.includes(name === 'legacy' ? 'Talla: 3XG' : 'Talla: 3XG HISTORICA · BLANCO HISTORICO'), quantities: text.includes('Cant: 2'),
          total: text.includes(UI.fmt(props.sale.total)), footer: text.includes(footer), website: text.includes('BALAMGUAYABERAS.MX'),
          paymentIcon: !normal || !!methodLabel?.parentElement.parentElement.querySelector('.material-symbols-outlined') }, copies: [] };
      for (const label of normal ? [null, 'COPIA CLIENTE', 'COPIA TIENDA'] : [null]) {
        const snapshot = UI.captureReceipt(ticket, label), png = await UI.receiptGraphic(snapshot), img = new Image(); img.src = png; await img.decode();
        const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, img.width, img.height).data;
        const tail = pixels.slice(Math.floor(img.height * .88) * img.width * 4).some((value, i) => i % 4 !== 3 && value < 128);
        const parsed = new DOMParser().parseFromString(snapshot.html, 'text/html');
        content.copies.push({ label, width: img.width, height: img.height, tail, png, html: snapshot.html,
          text: parsed.body.textContent, mark: parsed.querySelector('[data-receipt-copy]')?.textContent || null });
      }
      out[name] = content;
    }
    root.unmount(); host.remove();
    return { cases: out, unchanged: before === business(), frames: document.querySelectorAll('iframe').length };
  });
  for (const [name, current] of Object.entries(measured.cases)) {
    for (const copy of current.copies) {
      const bytes = Buffer.from(copy.png.split(',')[1], 'base64');
      fs.writeFileSync(path.join(output, name + '-' + (copy.label || 'original').replaceAll(' ', '-') + '.png'), bytes);
      copy.pngSHA256 = sha(bytes); copy.htmlSHA256 = sha(copy.html); delete copy.png; delete copy.html;
    }
    evidence.cases[name] = current;
    test(name + ': complete document and copies preserve the commercial details', () => {
      const g = current.guarantees; assert.equal(g.items, g.expectedItems);
      for (const [key, value] of Object.entries(g)) if (typeof value === 'boolean') assert.equal(value, true, key);
      for (const copy of current.copies) { assert.equal(copy.width, 576); assert.equal(copy.tail, true); assert.equal(copy.mark, copy.label);
        assert.ok(copy.text.includes('BALAMGUAYABERAS.MX')); assert.ok(copy.text.includes(current.normal ? 'Total a pagar' : 'BALAM')); }
      if (current.normal) assert.equal(current.copies[1].text.replace('COPIA CLIENTE', ''), current.copies[2].text.replace('COPIA TIENDA', ''));
    });
    if (current.normal) test(name + ': sale omits complete SKU and ornament and leaves a 41 px pause', () => {
      for (const copy of current.copies) assert.doesNotMatch(copy.text, /SKU:|SKU-H185|Ornamento:|APLICACION-H185|MULTICOLORES-H185/);
      assert.ok(Math.abs(current.gap - 41) < .1, 'gap=' + current.gap);
    });
    if (original) test(name + ': measured guarantees and separation retained against baseline', () => {
      const before = original.cases[name]; assert.deepEqual(current.guarantees, before.guarantees); assert.deepEqual(current.fonts, before.fonts);
      assert.equal(current.itemGap, before.itemGap);
      if (current.normal) {
        assert.ok(current.height < before.height); assert.ok(before.gap - current.gap >= 48 - .1);
        current.copies.forEach((copy, i) => assert.ok(copy.height < before.copies[i].height));
        if (ceiling) { assert.ok(current.height <= ceiling.cases[name].height + .1); assert.ok(current.gap <= ceiling.cases[name].gap + .1);
          current.copies.forEach((copy, i) => assert.ok(copy.height <= ceiling.cases[name].copies[i].height)); }
      } else {
        assert.equal(current.text, before.text); assert.equal(current.height, before.height); assert.equal(current.gap, before.gap);
        current.copies.forEach((copy, i) => { assert.equal(copy.htmlSHA256, before.copies[i].htmlSHA256); assert.equal(copy.height, before.copies[i].height);
          if (JSON.stringify(original.renderer) === JSON.stringify(evidence.renderer)) assert.equal(copy.pngSHA256, before.copies[i].pngSHA256); });
      }
    });
  }
  evidence.guarantees = { businessUnchanged: measured.unchanged, resourcesReleased: measured.frames === 0, noPageErrors: errors.length === 0 };
  evidence.cost = Object.fromEntries(Object.entries(evidence.cases).filter(([, value]) => value.normal).map(([name, value]) => [name, { cssHeight: value.height, gap: value.gap, pngHeights: value.copies.map(copy => copy.height) }]));
  evidence.completeness = Object.keys(evidence.cases).length === 12 && Object.values(evidence.cases).every(value => value.copies.every(copy => copy.tail));
  test('read-only receipt rendering completes and releases resources', () => {
    assert.deepEqual(evidence.guarantees, { businessUnchanged: true, resourcesReleased: true, noPageErrors: true }); assert.equal(evidence.completeness, true);
  });
} finally {
  if (browser) await browser.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(stem + (baseline ? 'baseline' : 'final') + '.json', JSON.stringify(evidence, null, 2) + '\n');
}
const passed = evidence.results.filter(result => result.ok).length, failed = evidence.results.length - passed;
if (!failed && !baseline && reason) fs.writeFileSync(stem + 'ceiling.json', JSON.stringify({ reason, date: evidence.date, renderer: evidence.renderer, cases: evidence.cases, guarantees: evidence.guarantees, completeness: evidence.completeness }, null, 2) + '\n');
console.log(`H-185: ${passed}/${evidence.results.length}; artifacts: ${output}`);
process.exitCode = failed ? 1 : 0;
