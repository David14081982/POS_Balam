// test-loans-screen.mjs — H-46: recorrido funcional de la pantalla de Préstamos
// sobre el BUNDLE distribuido (index.html), no sobre la fuente.
//
// Cubre el flujo completo que el negocio va a usar:
//   pantalla en el menú lateral → alta con producto, talla, cantidad, persona y
//   fechas → validaciones de captura en LOS DOS SENTIDOS (`R-DEL-11`) → efecto en
//   la cartera y NO en el inventario → devolución parcial → devolución total con
//   fecha real → vencidos y aviso en la campana → declarar la pérdida → reapertura
//   → persistencia local → salidas (Excel, vale impreso, listado impreso).
//
// Los controles se localizan por `data-testid`, nunca por texto visible, ícono ni
// orden (`R-DEL-10` · `AP-11`). Las aserciones sobre texto que el usuario debe LEER
// van sin distinguir mayúsculas, porque la tipografía Heritage aplica
// `text-transform: uppercase`.
//
// Supabase queda interceptado: no se escribe una sola fila en la nube.
//
// Uso: node test-loans-screen.mjs
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
await new Promise(r => server.listen(8825, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };
const dia = delta => {
  const d = new Date(Date.now() + delta * 86400000), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.route(/supabase\.co/, r => r.abort());
  await page.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  await page.goto('http://127.0.0.1:8825/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG, null, { timeout: 25000 });

  const texto = () => page.evaluate(() => document.body.innerText);
  const testid = t => `[data-testid="${t}"]`;
  const clickId = async t => {
    const el = await page.$(testid(t));
    if (!el) return false;
    await el.click();
    return true;
  };
  const fillId = async (t, v) => {
    const el = await page.$(testid(t));
    if (!el) return false;
    await el.fill(String(v));
    return true;
  };
  const pressId = async (t, key) => {
    const el = await page.$(testid(t));
    if (!el) return false;
    await el.press(key);
    return true;
  };
  const disabledId = t => page.evaluate(s => {
    const el = document.querySelector(s);
    return el ? !!el.disabled : null;
  }, testid(t));

  console.log('\n── 0) El módulo existe ──────────────────────────────────');
  const existe = await page.evaluate(() => typeof window.LoansScreen === 'function');
  check('el bundle publica window.LoansScreen', existe);
  if (!existe) {
    check('sin el módulo el resto del recorrido no puede ejercerse', false, 'reproducción de H-46');
    console.log(`\n${pass}/${pass + fail} verificaciones`);
    process.exit(1);
  }

  // ── Semilla: catálogo real y un cliente registrado ──────────────────────────
  const seed = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; window.STORE.pushSale = () => {}; }
    D.loans.length = 0; D.products.length = 0; D.sales.length = 0;
    try { localStorage.removeItem('balam_sync_queue'); } catch (e) { /* */ }
    D.products.push(D.hydrate({
      id: 'h46a', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
      modelo: '946', nombre: 'GUAYABERA PRESTAMO', orn: '—', ornColors: [], precio: 1200,
      costo: 0, pop: false, stock: D.mkStock([0, 6, 0], []),
    }));
    D.products.push(D.hydrate({
      id: 'h46b', cat: '20', manga: 'ML', tela: 'POL', color: 'NE', cuello: 'ITA',
      modelo: '947', nombre: 'CAMISA VITRINA', orn: '—', ornColors: [], precio: 800,
      costo: 0, pop: false, stock: D.mkStock([0, 0, 3], []),
    }));
    D.saveProducts();
    if (!D.clients.find(c => c.id === 'cli-h46')) {
      D.clients.push({ id: 'cli-h46', nombre: 'Rodrigo Prestatario', tel: '999 111 2233', compras: 0, total: 0, ultima: '', talla: '', notas: '', generic: false });
    }
    const p = D.products[0];
    const talla = p.stock.find(v => v.stock > 0).talla;
    return { sku: p.sku, talla, stock: D.stockOf(p, talla), precio: D.listPrice(p, talla), sku2: D.products[1].sku };
  });
  check('la semilla deja existencias con las que comparar', seed.stock === 6, `stock ${seed.stock}`);

  console.log('\n── A) La pantalla existe en el menú lateral ─────────────');
  const navOk = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav button')].find(x => /Pr[eé]stamos/i.test(x.innerText));
    if (btn) btn.click();
    return !!btn;
  });
  await page.waitForTimeout(700);
  check('«Préstamos» aparece en el menú lateral', navOk);
  const titulo = await page.evaluate(() => (document.querySelector('header h1') || {}).textContent || '');
  check('la barra superior titula la pantalla', /pr[eé]stamos/i.test(titulo.trim()), titulo);
  const vacia = await texto();
  check('la pantalla vacía explica para qué sirve', /no hay pr[eé]stamos registrados/i.test(vacia) && /obligaci[oó]n de volver/i.test(vacia));
  check('la pantalla ofrece registrar, exportar e imprimir',
    !!(await page.$(testid('loans-nuevo'))) && !!(await page.$(testid('loans-excel'))) && !!(await page.$(testid('loans-imprimir'))));

  console.log('\n── B) Alta: validaciones en los dos sentidos ───────────');
  check('se abre la captura del préstamo', await clickId('loans-nuevo'));
  await page.waitForTimeout(400);
  check('sin mercancía ni persona el registro está bloqueado', await disabledId('prestamo-confirmar') === true);

  check('el buscador de prendas acepta la búsqueda', await fillId('prestamo-buscar-producto', 'PRESTAMO'));
  await page.waitForTimeout(350);
  check('el catálogo ofrece la prenda buscada', await clickId('prestamo-producto-' + seed.sku));
  await page.waitForTimeout(300);
  const conTallas = await texto();
  check('el selector de talla muestra existencias y precio de la talla',
    /elige la talla/i.test(conTallas) && conTallas.includes('6 pz') && /1,200/.test(conTallas));
  // Mismo idioma que el Punto de venta: sólo las tallas con existencia, agrupadas
  // por escala. Ofrecer las veinte tallas es el antipatrón AP-10.
  const ofrecidas = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="prestamo-talla-"]')].map(e => e.dataset.testid));
  check('sólo se ofrecen las tallas con existencia', JSON.stringify(ofrecidas) === JSON.stringify(['prestamo-talla-' + seed.talla]), JSON.stringify(ofrecidas));
  check('una talla sin existencia se puede pedir expresamente', !!(await page.$(testid('prestamo-tallas-agotadas'))));
  check('elegir la prenda cierra el desplegable del catálogo', !(await page.$(testid('prestamo-producto-' + seed.sku))));
  check('la talla se puede elegir', await clickId('prestamo-talla-' + seed.talla));
  await page.waitForTimeout(300);
  check('con mercancía pero sin persona sigue bloqueado', await disabledId('prestamo-confirmar') === true);

  check('la cantidad sube con el control del renglón', await clickId('prestamo-mas-' + seed.sku + '|' + seed.talla));
  await page.waitForTimeout(250);
  check('el resumen del préstamo suma piezas y valor', /2 pieza\(s\)/i.test(await texto()));

  check('el nombre de quien recibe se puede escribir', await fillId('prestamo-persona', 'Rodrigo'));
  await page.waitForTimeout(350);
  check('el autocompletado ofrece al cliente registrado', await clickId('prestamo-candidato-cli-h46'));
  await page.waitForTimeout(250);
  const conPersona = await page.evaluate(s => (document.querySelector(s) || {}).value, testid('prestamo-telefono'));
  check('elegir al cliente trae su teléfono', String(conPersona).includes('999 111 2233'), String(conPersona));
  check('con mercancía y persona el registro se libera', await disabledId('prestamo-confirmar') === false);

  // Fechas incoherentes: vuelve a bloquear y lo dice.
  await fillId('prestamo-esperada', dia(-30));
  await page.waitForTimeout(300);
  check('una devolución anterior al préstamo bloquea el registro', await disabledId('prestamo-confirmar') === true);
  check('la captura explica por qué está bloqueada', /no puede ser anterior al pr[eé]stamo/i.test(await texto()));
  check('el atajo de plazo repone una fecha válida', await clickId('prestamo-plazo-7'));
  await page.waitForTimeout(250);
  check('con fechas coherentes vuelve a liberarse', await disabledId('prestamo-confirmar') === false);

  await fillId('prestamo-nota', 'Se la lleva para la boda del sábado');
  check('el préstamo se registra', await clickId('prestamo-confirmar'));
  await page.waitForTimeout(700);

  console.log('\n── B2) Lector de código de barras (H-48) ───────────────');
  // El código se teclea en el buscador y se cierra con Enter, igual que lo haría un
  // lector USB HID. La pieza exacta entra sin pasar por el selector de talla.
  const codigo = await page.evaluate(([sku, talla]) => {
    const p = window.DATA.products.find(x => x.sku === sku);
    return window.BARCODES.codeOf(p, talla);
  }, [seed.sku, seed.talla]);
  check('el código de la pieza se construye con la autoridad del negocio', /\S/.test(codigo), codigo);
  await clickId('loans-nuevo');
  await page.waitForTimeout(400);
  await fillId('prestamo-buscar-producto', codigo);
  await pressId('prestamo-buscar-producto', 'Enter');
  await page.waitForTimeout(400);
  const trasLeer = await page.evaluate(() => ({
    lineas: [...document.querySelectorAll('[data-testid^="prestamo-mas-"]')].map(e => e.dataset.testid),
    tallasAbiertas: !!document.querySelector('[data-testid^="prestamo-talla-"]'),
    buscador: (document.querySelector('[data-testid="prestamo-buscar-producto"]') || {}).value,
  }));
  check('leer el código agrega la pieza exacta al préstamo',
    JSON.stringify(trasLeer.lineas) === JSON.stringify(['prestamo-mas-' + seed.sku + '|' + seed.talla]), JSON.stringify(trasLeer.lineas));
  check('leer el código no pregunta la talla: ya venía en la etiqueta', trasLeer.tallasAbiertas === false);
  check('el buscador queda listo para la siguiente lectura', trasLeer.buscador === '');
  // Segunda lectura de la misma etiqueta: suma cantidad, no duplica el renglón.
  await fillId('prestamo-buscar-producto', codigo);
  await pressId('prestamo-buscar-producto', 'Enter');
  await page.waitForTimeout(350);
  check('leer dos veces la misma etiqueta suma cantidad sin duplicar renglón', /2 pieza\(s\)/i.test(await texto()));
  // Un código inexistente se distingue de una búsqueda sin resultados.
  await fillId('prestamo-buscar-producto', '99-XX-XXX-XX-000-M');
  await pressId('prestamo-buscar-producto', 'Enter');
  await page.waitForTimeout(400);
  check('un código desconocido lo dice como código, no como búsqueda', /c[oó]digo no encontrado/i.test(await texto()));

  // Lector con el foco FUERA del buscador: la ráfaga se reconoce y no queda escrita
  // dentro del campo que tenía el foco.
  await fillId('prestamo-persona', 'Rodrigo');
  await page.click(testid('prestamo-persona'));
  const hid = await page.evaluate(async code => {
    const el = document.querySelector('[data-testid="prestamo-persona"]');
    el.focus();
    for (const ch of code) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      set.call(el, el.value + ch);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 5));
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise(r => setTimeout(r, 250));
    return { persona: document.querySelector('[data-testid="prestamo-persona"]').value };
  }, codigo);
  check('el lector funciona con el foco fuera del buscador', /3 pieza\(s\)/i.test(await texto()));
  check('la ráfaga del lector no se queda escrita en el nombre de la persona', hid.persona === 'Rodrigo', hid.persona);
  await clickId('prestamo-cancelar');
  await page.waitForTimeout(400);
  check('cancelar la captura no registra nada', await page.evaluate(() => window.DATA.loans.length === 1));

  console.log('\n── C) Lo que el préstamo dejó escrito ──────────────────');
  const alta = await page.evaluate(() => {
    const D = window.DATA;
    const l = D.loans[0];
    return {
      total: D.loans.length, folio: l.folio, estado: l.estado, piezas: D.prestamoPiezas(l),
      fuera: D.prestamoPendientes(l), fecha: l.fecha, esperada: l.fechaEsperada,
      devolucion: l.fechaDevolucion, nota: l.nota, persona: l.persona,
      linea: l.lineas[0], atraso: D.prestamoAtraso(l),
      prestadas: D.loanedQty(l.lineas[0].sku, l.lineas[0].talla),
      stock: D.stockOf(D.products[0], l.lineas[0].talla),
      cola: localStorage.getItem('balam_sync_queue') || '',
      texto: document.body.innerText,
    };
  });
  check('el préstamo nace con folio propio de préstamo', /^PR-\d{6}-\d{3}$/.test(alta.folio), alta.folio);
  check('el folio del préstamo no gasta el consecutivo de ventas', !alta.folio.startsWith('BG-'));
  check('nace pendiente, con sus dos piezas fuera', alta.estado === 'pendiente' && alta.piezas === 2 && alta.fuera === 2);
  check('guarda la fecha del préstamo y la esperada', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(alta.fecha) && alta.esperada === dia(7));
  check('la fecha real de devolución nace vacía', alta.devolucion === null);
  check('congela la evidencia de la prenda y su precio',
    alta.linea.nombre === 'GUAYABERA PRESTAMO' && alta.linea.sku === seed.sku && alta.linea.precio === seed.precio);
  check('congela a la persona que recibió', alta.persona.tipo === 'cliente' && alta.persona.nombre === 'Rodrigo Prestatario' && alta.persona.id === 'cli-h46');
  check('conserva la nota de captura', /boda del s[aá]bado/.test(alta.nota));
  check('el préstamo NO descuenta inventario', alta.stock === 6, `stock ${alta.stock}`);
  check('la autoridad de unidades prestadas las reporta', alta.prestadas === 2);
  check('un préstamo dentro de plazo no está vencido', alta.atraso.vencido === false && alta.atraso.dias === -7);
  check('el préstamo encola la entrega protegida sin escribir inventario directamente',
    /"type":"loanOperation"/.test(alta.cola) && /"action":"deliver"/.test(alta.cola),
    alta.cola.slice(0, 120));

  console.log('\n── D) La cartera en pantalla ───────────────────────────');
  check('el indicador de piezas fuera las cuenta', /piezas fuera/i.test(alta.texto) && /2 pieza\(s\) fuera del negocio/i.test(alta.texto));
  check('el indicador de valor prestado usa el precio congelado', /valor prestado/i.test(alta.texto) && /\$2,400/.test(alta.texto));
  check('el indicador de vencidos empieza limpio', /vencidos/i.test(alta.texto) && /ninguno pasado de fecha/i.test(alta.texto));
  check('la fila identifica a la persona y la mercancía',
    alta.texto.includes(alta.folio) && /rodrigo prestatario/i.test(alta.texto) && /guayabera prestamo t/i.test(alta.texto));
  check('la fila anuncia el plazo restante', /vence en 7 d[ií]as/i.test(alta.texto));
  check('la pantalla declara que un préstamo no descuenta inventario', /no descuenta inventario/i.test(alta.texto));
  // Formato visible: el negocio lee dia/mes/ano. Lo GUARDADO sigue en AAAA-MM-DD
  // —ya afirmado arriba sobre el documento—; aqui se exige que nada ISO llegue a la
  // pantalla, que es lo que se devolveria por descuido al tocar la presentacion.
  const hoyDMA = dia(0).split('-').reverse().join('/');
  check('la fecha del préstamo se muestra en día/mes/año', alta.texto.includes(hoyDMA), hoyDMA);
  check('ninguna fecha ISO se escapa a la pantalla', !/\d{4}-\d{2}-\d{2}/.test(alta.texto),
    (alta.texto.match(/\d{4}-\d{2}-\d{2}/) || [''])[0]);

  console.log('\n── E) Detalle y devolución parcial ─────────────────────');
  check('la fila despliega su detalle', await clickId('loan-detalle-' + alta.folio));
  await page.waitForTimeout(400);
  const detalle = await texto();
  check('el detalle muestra la mercancía con su SKU', /mercanc[ií]a prestada/i.test(detalle) && detalle.includes(seed.sku));
  check('el detalle muestra las tres fechas del negocio',
    /devoluci[oó]n esperada/i.test(detalle) && /devoluci[oó]n real/i.test(detalle) && /pendiente/i.test(detalle));
  check('el detalle también fecha en día/mes/año, con la hora del préstamo',
    new RegExp(hoyDMA.replace(/\//g, '\\/') + ' \\d{2}:\\d{2}').test(detalle) && !/\d{4}-\d{2}-\d{2}/.test(detalle));
  check('el detalle ofrece editar, declarar pérdida y eliminar',
    !!(await page.$(testid('loan-editar-' + alta.folio)))
    && !!(await page.$(testid('loan-perdido-' + alta.folio)))
    && !!(await page.$(testid('loan-eliminar-' + alta.folio))));

  check('la fila ofrece registrar la devolución', await clickId('loan-devolver-' + alta.folio));
  await page.waitForTimeout(450);
  const modalDev = await texto();
  check('la devolución abre con las piezas fuera y el plazo', /registrar devoluci[oó]n/i.test(modalDev) && /piezas fuera/i.test(modalDev));
  const clave = seed.sku + '|' + seed.talla;
  await fillId('devolucion-qty-' + clave, '0');
  await page.waitForTimeout(250);
  check('sin piezas indicadas la devolución está bloqueada', await disabledId('devolucion-confirmar') === true);
  await fillId('devolucion-qty-' + clave, '1');
  await page.waitForTimeout(250);
  check('con una pieza la devolución se libera', await disabledId('devolucion-confirmar') === false);
  check('la devolución parcial anticipa lo que seguirá fuera', /piezas fuera despu[eé]s/i.test(await texto()));
  await clickId('devolucion-confirmar');
  await page.waitForTimeout(700);

  const parcial = await page.evaluate(() => {
    const D = window.DATA; const l = D.loans[0];
    return {
      estado: l.estado, fuera: D.prestamoPendientes(l), devolucion: l.fechaDevolucion,
      asientos: (l.devoluciones || []).length, texto: document.body.innerText,
      stock: D.stockOf(D.products[0], l.lineas[0].talla),
    };
  });
  check('una devolución parcial deja el préstamo pendiente', parcial.estado === 'pendiente' && parcial.fuera === 1);
  check('la fecha real sigue vacía mientras falte mercancía', parcial.devolucion === null);
  check('la devolución parcial queda asentada', parcial.asientos === 1);
  check('la fila muestra el avance de la devolución', /1 de 2 devueltas/i.test(parcial.texto));
  check('devolver no altera el inventario tampoco', parcial.stock === 6, `stock ${parcial.stock}`);

  // La defensa, no el síntoma: pedir más piezas de las que faltan se rechaza en la autoridad.
  const exceso = await page.evaluate(clave => {
    const D = window.DATA;
    return D.registrarDevolucionPrestamo(D.loans[0].id, { lineas: [{ key: clave, qty: 5 }] });
  }, clave);
  check('la autoridad rechaza devolver más piezas de las que faltan', exceso.ok === false && /s[oó]lo faltan 1/i.test(exceso.error), exceso.error || '');

  console.log('\n── F) Devolución total y fecha real ────────────────────');
  await clickId('loan-devolver-' + alta.folio);
  await page.waitForTimeout(450);
  check('la devolución total se anuncia antes de confirmar', /cerrar el pr[eé]stamo/i.test(await texto()));
  await clickId('devolucion-confirmar');
  await page.waitForTimeout(700);
  const cerrado = await page.evaluate(() => {
    const D = window.DATA; const l = D.loans[0];
    return {
      estado: l.estado, fuera: D.prestamoPendientes(l), devolucion: l.fechaDevolucion,
      prestadas: D.loanedQty(l.lineas[0].sku, l.lineas[0].talla),
      vencido: D.prestamoAtraso(l).vencido, texto: document.body.innerText,
    };
  });
  check('el préstamo queda devuelto y sin piezas fuera', cerrado.estado === 'devuelto' && cerrado.fuera === 0);
  check('la fecha REAL de devolución queda registrada', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(cerrado.devolucion)), String(cerrado.devolucion));
  check('un préstamo devuelto deja de contar como prestado', cerrado.prestadas === 0);
  check('un préstamo devuelto nunca está vencido', cerrado.vencido === false);
  check('el préstamo cerrado sale del filtro «Pendientes»', !cerrado.texto.includes(alta.folio));
  check('el filtro «Devueltos» lo recupera', await clickId('loans-filtro-devueltos'));
  await page.waitForTimeout(400);
  check('el préstamo devuelto aparece con su estado', (await texto()).includes(alta.folio) && /devuelto/i.test(await texto()));

  console.log('\n── F2) Leer una prenda en la cartera (H-48) ────────────');
  // El préstamo ya está devuelto: con el filtro en «Pendientes» no se lista. Leer su
  // etiqueta debe encontrarlo igual, porque la pregunta es «¿quién tuvo esta pieza?».
  await clickId('loans-filtro-pendientes');
  await page.waitForTimeout(350);
  check('con el filtro en pendientes el préstamo cerrado no se lista', !(await texto()).includes(alta.folio));
  await fillId('loans-buscar', codigo);
  await page.waitForTimeout(450);
  const enCartera = await texto();
  check('leer una prenda la encuentra en cualquier estado', enCartera.includes(alta.folio));
  check('la cartera declara que la búsqueda vino de una lectura',
    !!(await page.$(testid('loans-escaneo'))) && /c[oó]digo le[ií]do/i.test(enCartera) && /en cualquier estado/i.test(enCartera));
  // Prenda real del catálogo que todavía no ha salido en ningún préstamo: la respuesta
  // es sobre la PIEZA, no un «no coincide con el filtro».
  const codigoLibre = await page.evaluate(sku => {
    const p = window.DATA.products.find(x => x.sku === sku);
    return window.BARCODES.codeOf(p, p.stock.find(v => v.stock > 0).talla);
  }, seed.sku2);
  await fillId('loans-buscar', codigoLibre);
  await page.waitForTimeout(400);
  check('leer una prenda que nunca salió lo dice sobre la pieza, no sobre el filtro',
    /no est[aá] en ning[uú]n pr[eé]stamo/i.test(await texto()));
  await fillId('loans-buscar', '');
  await page.waitForTimeout(350);

  console.log('\n── G) Vencidos y aviso en la campana ───────────────────');
  const vencido = await page.evaluate(() => {
    const D = window.DATA;
    const dia = d => { const x = new Date(Date.now() + d * 86400000), p = n => String(n).padStart(2, '0'); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`; };
    const p = D.products[1];
    const talla = p.stock.find(v => v.stock > 0).talla;
    const r = D.registrarPrestamo({
      lineas: [{ productId: p.id, talla, qty: 3 }],
      persona: { tipo: 'empleado', nombre: 'Empleado Vitrina' },
      fecha: dia(-20), fechaEsperada: dia(-6), usuario: 'Arnés',
    });
    // Fuerza el repintado de la aplicación, como haría cualquier cambio de configuración.
    if (window.AUTH) window.AUTH.isAdmin = () => true;
    window.dispatchEvent(new Event('configchange'));
    window.dispatchEvent(new Event('authchange'));
    return {
      ok: r.ok, folio: r.ok ? r.loan.folio : null,
      atraso: r.ok ? D.prestamoAtraso(r.loan) : null,
      vencidos: D.prestamosVencidos().length,
    };
  });
  check('un préstamo con fecha pasada se registra', vencido.ok === true);
  check('la autoridad lo declara vencido con sus días de atraso', vencido.atraso && vencido.atraso.vencido === true && vencido.atraso.dias === 6, JSON.stringify(vencido.atraso));
  check('sólo ese préstamo está vencido', vencido.vencidos === 1);
  await page.waitForTimeout(500);
  await clickId('loans-filtro-vencidos');
  await page.waitForTimeout(450);
  const enVencidos = await texto();
  check('el filtro «Vencidos» lo lista', enVencidos.includes(vencido.folio));
  check('la fila dice cuántos días lleva de atraso', /vencido hace 6 d[ií]as/i.test(enVencidos));
  check('el indicador de vencidos lo cuenta', /el m[aá]s atrasado, 6 d[ií]a/i.test(enVencidos));

  // El repintado de React no ocurre en el mismo tick del clic: se espera antes de leer.
  const abrioCampana = await page.evaluate(() => {
    const btn = document.querySelector('button[title="Notificaciones"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await page.waitForTimeout(400);
  const campana = await texto();
  check('la campana administrativa está disponible', abrioCampana);
  check('la campana anuncia el préstamo vencido',
    /pr[eé]stamo vencido/i.test(campana) && campana.includes(vencido.folio) && /sin regresar desde/i.test(campana));
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const bk = document.querySelector('.fixed.inset-0.z-\\[65\\]'); if (bk) bk.click(); });
  await page.waitForTimeout(300);

  console.log('\n── H) Declarar la pérdida y reabrir ────────────────────');
  await clickId('loans-filtro-vencidos');
  await page.waitForTimeout(350);
  await clickId('loan-detalle-' + vencido.folio);
  await page.waitForTimeout(350);
  check('el detalle ofrece declarar la mercancía no devuelta', await clickId('loan-perdido-' + vencido.folio));
  await page.waitForTimeout(400);
  const aviso = await texto();
  check('la confirmación dice qué está en juego',
    /declarar mercanc[ií]a no devuelta/i.test(aviso) && /3 pieza\(s\)/i.test(aviso) && /\$2,400/.test(aviso));
  await fillId('confirmar-nota', 'No contesta el teléfono');
  check('la pérdida se confirma', await clickId('confirmar-aceptar'));
  await page.waitForTimeout(700);
  const perdido = await page.evaluate(folio => {
    const D = window.DATA; const l = D.loans.find(x => x.folio === folio);
    return {
      estado: l.estado, cierre: l.fechaCierre, nota: l.notaCierre,
      vencidos: D.prestamosVencidos().length, atraso: D.prestamoAtraso(l).vencido,
      prestadas: D.loanedQty(l.lineas[0].sku, l.lineas[0].talla),
      devolucion: l.fechaDevolucion,
    };
  }, vencido.folio);
  check('el préstamo queda como no devuelto con su motivo', perdido.estado === 'no_devuelto' && /no contesta/i.test(perdido.nota));
  check('la pérdida registra su fecha de cierre', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(perdido.cierre)));
  check('la fecha real de devolución sigue vacía: no regresó', perdido.devolucion === null);
  check('un préstamo declarado perdido deja de alarmar como vencido', perdido.vencidos === 0 && perdido.atraso === false);
  check('lo no devuelto deja de contarse como prestado', perdido.prestadas === 0);
  await clickId('loans-filtro-perdidos');
  await page.waitForTimeout(400);
  check('el filtro «No devueltos» lo lista con su pérdida', (await texto()).includes(vencido.folio));

  const reabre = await page.evaluate(folio => {
    const D = window.DATA; const l = D.loans.find(x => x.folio === folio);
    const r = D.registrarDevolucionPrestamo(l.id, { lineas: [{ key: l.lineas[0].key, qty: 3 }], nota: 'Apareció' });
    return { ok: r.ok, cerrado: r.cerrado, estado: r.ok ? r.loan.estado : null, real: r.ok ? r.loan.fechaDevolucion : null };
  }, vencido.folio);
  check('la mercancía dada por perdida todavía puede regresar', reabre.ok === true && reabre.cerrado === true && reabre.estado === 'devuelto');
  check('al regresar tarde se registra su fecha real', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(String(reabre.real)));

  console.log('\n── I) Persistencia local ───────────────────────────────');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.LoansScreen, null, { timeout: 25000 });
  const tras = await page.evaluate(() => ({
    total: window.DATA.loans.length,
    folios: window.DATA.loans.map(l => l.folio),
    estados: window.DATA.loans.map(l => l.estado),
  }));
  check('los préstamos sobreviven a recargar la terminal', tras.total === 2 && tras.folios.includes(alta.folio) && tras.folios.includes(vencido.folio),
    JSON.stringify(tras.folios));

  console.log('\n── J) Salidas y respaldo ───────────────────────────────');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav button')].find(x => /Pr[eé]stamos/i.test(x.innerText));
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  await clickId('loans-filtro-todos');
  await page.waitForTimeout(400);
  check('existe la exportación a Excel de préstamos', await page.evaluate(() => typeof window.XLSXIO.exportLoans === 'function'));

  const vale = await page.evaluate(folio => {
    let html = '';
    const real = window.open;
    window.open = () => ({ document: { write: s => { html += s; }, close: () => {} } });
    const btn = document.querySelector(`[data-testid="loan-vale-${folio}"]`);
    if (btn) btn.click();
    return new Promise(res => setTimeout(() => { window.open = real; res(html); }, 400));
  }, alta.folio);
  check('el vale impreso se genera en su propia ventana', /vale de pr[eé]stamo/i.test(vale), vale ? '' : 'documento vacío');
  check('el vale identifica folio, persona y fechas',
    vale.includes(alta.folio) && /rodrigo prestatario/i.test(vale) && /devoluci[oó]n esperada/i.test(vale));
  check('el vale trae la mercancía con su valor', /guayabera prestamo/i.test(vale) && /\$2,400\.00/.test(vale));
  check('el vale trae el compromiso y las firmas', /me comprometo a devolverla/i.test(vale) && /firma de quien recibe/i.test(vale));
  check('el vale fecha en día/mes/año, incluido el compromiso',
    vale.includes(hoyDMA) && new RegExp('m[aá]s tardar el ' + dia(7).split('-').reverse().join('/').replace(/\//g, '\\/')).test(vale)
    && !/\d{4}-\d{2}-\d{2}/.test(vale));
  check('el vale aclara que no es un comprobante de venta', /no es un comprobante de venta/i.test(vale));
  check('el vale no pide red', !/<script[^>]*src=/i.test(vale) && !/https?:\/\//.test(vale));

  const listado = await page.evaluate(() => {
    const D = window.DATA;
    D.loans[0].persona.nombre = 'Persona <script>alert(1)</script>';
    D.saveLoans();
    window.dispatchEvent(new Event('configchange'));
    let html = '';
    const real = window.open;
    window.open = () => ({ document: { write: s => { html += s; }, close: () => {} } });
    return new Promise(res => setTimeout(() => {
      const btn = document.querySelector('[data-testid="loans-imprimir"]');
      if (btn) btn.click();
      window.open = real;
      setTimeout(() => res(html), 120);
    }, 500));
  });
  check('el listado impreso trae encabezado, totales y filas',
    /mercanc[ií]a prestada/i.test(listado) && /piezas fuera/i.test(listado) && /totales/i.test(listado) && listado.includes(alta.folio));
  check('el listado impreso escapa el contenido del negocio', /Persona &lt;script&gt;/.test(listado) && !/<script>alert/.test(listado));
  check('el listado impreso no pide red', !/<script[^>]*src=/i.test(listado) && !/https?:\/\//.test(listado));
  check('el listado impreso fecha en día/mes/año', listado.includes(hoyDMA) && !/\d{4}-\d{2}-\d{2}/.test(listado));

  check('sin errores de consola durante el recorrido', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
