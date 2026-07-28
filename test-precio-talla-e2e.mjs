// test-precio-talla-e2e.mjs — H-36: recorrido funcional controlado sobre el
// BUNDLE distribuido (index.html), no sobre la fuente.
//
// Cubre el flujo que el negocio va a usar de punta a punta:
//   artículo con precio general → excepción por talla capturada en el formulario
//   real → guardado y carga útil de sincronización → reapertura del formulario →
//   rango en el catálogo del POS → precio por talla en el selector → etiqueta →
//   venta de una talla general y una con excepción → evidencia financiera.
//
// Supabase queda interceptado: no se escribe una sola fila en la nube.
//
// Uso: node test-precio-talla-e2e.mjs
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
await new Promise(r => server.listen(8817, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort());
  await page.goto('http://127.0.0.1:8817/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 25000 });

  // ── Artículo con precio general único ──────────────────────────────────────
  const tallas = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; window.STORE.pushSale = () => {}; }
    D.products.length = 0;
    const t = D.SIZES_LETRA.slice(0, 3);            // p. ej. XS, S, M
    const cant = t.map(() => 10);
    D.products.push(D.hydrate({
      id: 'h36e', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
      modelo: '936', nombre: 'CAMISA H36', orn: '—', ornColors: [], precio: 350,
      costo: 0, pop: false, stock: D.mkStock(cant, []),
    }));
    D.saveProducts();
    return t;
  });
  const [T_GEN, , T_EXC] = tallas;                   // primera = general, tercera = excepción

  console.log('\n── A) Captura de la excepción en el formulario real ─────');
  await page.evaluate(() => { const b = [...document.querySelectorAll('nav button')].find(x => /Inventario/.test(x.innerText)); if (b) b.click(); });
  await page.waitForTimeout(900);
  // Abrir la ficha y el formulario de edición como lo hace el administrador.
  await page.evaluate(() => { const c = [...document.querySelectorAll('td')].find(t => /CAMISA H36/.test(t.innerText)); if (c) c.click(); });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Editar producto/i.test(x.innerText)); if (b) b.click(); });
  await page.waitForTimeout(700);

  // innerText respeta `text-transform: uppercase`, así que la comparación va sin
  // distinguir mayúsculas.
  const seccion = await page.evaluate(() => /precios especiales por talla/i.test(document.body.innerText));
  check('1. el formulario ofrece «Precios especiales por talla»', seccion);
  const filasIniciales = await page.evaluate(() =>
    document.body.innerText.includes('Todas las tallas usan el precio general del artículo.'));
  check('2. sin excepciones no pide ningún precio por talla', filasIniciales);

  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Agregar precio/i.test(x.innerText)); if (b) b.click(); });
  await page.waitForTimeout(400);
  const chips = await page.evaluate(t => {
    const btns = [...document.querySelectorAll('button')].filter(x => x.innerText.trim() === t);
    return btns.length;
  }, T_EXC);
  check('3. la fila ofrece las tallas como chips (idioma del Alcance de Descuentos)', chips > 0, `chips «${T_EXC}»: ${chips}`);

  await page.evaluate(t => {
    const btns = [...document.querySelectorAll('button')].filter(x => x.innerText.trim() === t);
    btns[btns.length - 1].click();                   // el chip de la fila de precios
  }, T_EXC);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const inp = [...document.querySelectorAll('input[type=number]')].find(i => i.placeholder === '350');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(inp, '450'); inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const resumen = await page.evaluate(t => document.body.innerText.includes('Tallas ' + t), T_EXC);
  check('4. la fila resume el grupo afectado', resumen, `«Tallas ${T_EXC}»`);

  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Guardar cambios/i.test(x.innerText)); if (b) b.click(); });
  await page.waitForTimeout(900);

  console.log('\n── B) Guardado y carga útil de sincronización ───────────');
  const guardado = await page.evaluate(() => {
    const p = window.DATA.products.find(x => x.id === 'h36e');
    return { mapa: p.preciosTalla, general: p.precio };
  });
  check('5. la excepción quedó guardada como mapa canónico por talla',
    guardado.mapa && Number(guardado.mapa[T_EXC]) === 450 && Object.keys(guardado.mapa).length === 1,
    JSON.stringify(guardado.mapa));
  check('6. el precio general no cambió', guardado.general === 350);

  // `STORE.MAP` no es público y, sin cliente Supabase, `pushRows` no encola: la
  // carga útil de sincronización no es observable desde el navegador. Su
  // contrato lo cubre test-variant-price.mjs (35). Aquí se comprueba lo que sí
  // es observable y es la otra mitad del «guardado»: la persistencia local.
  const persistido = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      if (v.includes('h36e') && v.includes('preciosTalla')) return { k, tiene: v.includes('450') };
    }
    return null;
  });
  check('7. la excepción sobrevive en la persistencia local', persistido && persistido.tiene,
    persistido ? persistido.k : 'no encontrada');
  const vacio = await page.evaluate(() => {
    const D = window.DATA;
    const q = D.hydrate({ id: 'h36z', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
      modelo: '937', nombre: 'SIN EXC', orn: '—', ornColors: [], precio: 500, costo: 0, pop: false,
      stock: D.mkStock([5], []) });
    return { mapa: q.preciosTalla, precio: D.listPrice(q, D.SIZES_LETRA[0]) };
  });
  check('8. un artículo nuevo nace sin excepciones y con su precio general',
    vacio.mapa && Object.keys(vacio.mapa).length === 0 && vacio.precio === 500, JSON.stringify(vacio.mapa));

  console.log('\n── C) Reapertura del formulario ─────────────────────────');
  // Al guardar, saveProduct cierra ficha y formulario: hay que volver a abrir
  // la ficha del producto antes de poder editarlo otra vez.
  await page.evaluate(() => { const c = [...document.querySelectorAll('td')].find(t => /CAMISA H36/.test(t.innerText)); if (c) c.click(); });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Editar producto/i.test(x.innerText)); if (b) b.click(); });
  await page.waitForTimeout(700);
  const reabierto = await page.evaluate(() => {
    const inp = [...document.querySelectorAll('input[type=number]')].map(i => i.value);
    return { valores: inp, texto: document.body.innerText.includes('Las tallas sin precio especial usan el precio general del artículo.') };
  });
  check('9. la excepción reaparece agrupada al reabrir', reabierto.valores.includes('450') && reabierto.texto,
    JSON.stringify(reabierto.valores.slice(0, 8)));
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /^Cancelar$/i.test(x.innerText.trim())); if (b) b.click(); });
  await page.waitForTimeout(500);

  console.log('\n── D) Etiqueta por talla ────────────────────────────────');
  const etiqueta = await page.evaluate(t => {
    const D = window.DATA, p = D.products.find(x => x.id === 'h36e');
    return { exc: D.listPrice(p, t), gen: D.listPrice(p, D.SIZES_LETRA[0]) };
  }, T_EXC);
  check('10. la etiqueta de la talla con excepción usa su precio',
    etiqueta.exc === 450 && etiqueta.gen === 350, `${T_EXC}=${etiqueta.exc} · ${T_GEN}=${etiqueta.gen}`);

  console.log('\n── E) Punto de Venta ────────────────────────────────────');
  await page.evaluate(() => { const b = [...document.querySelectorAll('nav button')].find(x => /Punto de venta/i.test(x.innerText)); if (b) b.click(); });
  await page.waitForTimeout(1200);
  const rango = await page.evaluate(() => document.body.innerText);
  check('11. el catálogo anuncia el rango antes de elegir talla',
    /\$350\.00\s*–\s*\$450\.00/.test(rango), (rango.match(/\$350\.00[^\n]{0,20}/) || [''])[0].trim());

  // El botón «Agregar» de la tarjeta abre el selector de talla. Apuntar a la
  // tarjeta por texto era frágil y además daba un FALSO POSITIVO: la propia
  // tarjeta ya muestra «$350.00 – $450.00», así que la página contenía ambas
  // cadenas sin que el modal se hubiera abierto nunca.
  const abrirSelector = async () => {
    await page.evaluate(() => { const b = document.querySelector('button[title="Agregar"]'); if (b) b.click(); });
    await page.waitForTimeout(800);
  };
  await abrirSelector();
  const selector = await page.evaluate(() => ({
    abierto: /Selecciona talla/i.test(document.body.innerText),
    texto: document.body.innerText,
  }));
  check('12. el selector de talla muestra el precio real de cada talla',
    selector.abierto && selector.texto.includes('$450.00') && selector.texto.includes('$350.00'),
    selector.abierto ? 'modal abierto' : 'el modal NO se abrió');

  await page.evaluate(t => {
    const btn = [...document.querySelectorAll('button')].find(x => x.innerText.includes(t) && x.innerText.includes('pz'));
    if (btn) btn.click();
  }, T_EXC);
  await page.waitForTimeout(600);
  await abrirSelector();
  await page.evaluate(t => {
    const btn = [...document.querySelectorAll('button')].find(x => x.innerText.includes(t) && x.innerText.includes('pz'));
    if (btn) btn.click();
  }, T_GEN);
  await page.waitForTimeout(700);

  const carrito = await page.evaluate(() => {
    // El resumen es el <aside> que habla de total, no el de navegación.
    const asides = [...document.querySelectorAll('aside')];
    const res = asides.find(a => /total/i.test(a.innerText)) || asides[asides.length - 1];
    return { texto: (res ? res.innerText : document.body.innerText).replace(/\s+/g, ' ').trim().slice(0, 400) };
  });
  check('13. el resumen del carrito suma los precios de cada talla', /\$?800\.00/.test(carrito.texto),
    carrito.texto.slice(0, 160));

  console.log('\n── F) Venta y evidencia financiera ──────────────────────');
  const venta = await page.evaluate(() => {
    const D = window.DATA, p = D.products.find(x => x.id === 'h36e');
    const t = D.SIZES_LETRA.slice(0, 3);
    const ticket = [{ p, talla: t[0], qty: 1 }, { p, talla: t[2], qty: 1 }];
    const total = ticket.reduce((a, l) => a + D.listPrice(l.p, l.talla) * l.qty, 0);
    const v = D.recordSale({ ticket, sellerIds: [], client: null, metodo: 'Efectivo', estado: 'Pagado', total, itemCount: 2 });
    return {
      total: v.total, subtotal: v.subtotal, iva: v.iva, descuento: v.descuento,
      lineas: (v.lineas || []).map(l => ({ talla: l.talla, precioOrig: l.precioOrig, precioBase: l.precioBase })),
    };
  });
  check('14. total = 350 + 450', venta.total === 800, `total=${venta.total}`);
  check('15. subtotal + IVA = total', Math.abs(venta.subtotal + venta.iva - venta.total) < 0.01,
    `${venta.subtotal} + ${venta.iva} = ${venta.total}`);
  check('16. sin promoción no se inventa descuento', venta.descuento === 0, `descuento=${venta.descuento}`);
  const lg = venta.lineas.find(l => l.talla === T_GEN) || {};
  const le = venta.lineas.find(l => l.talla === T_EXC) || {};
  check('17. precioOrig congela el precio de SU talla', lg.precioOrig === 350 && le.precioOrig === 450,
    `${T_GEN}=${lg.precioOrig} · ${T_EXC}=${le.precioOrig}`);
  check('18. precioBase también respeta la talla', lg.precioBase === 350 && le.precioBase === 450);

  check('19. cero excepciones de página en todo el recorrido', errs.length === 0, errs.slice(0, 2).join(' | '));
} finally {
  await b.close();
  server.close();
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
