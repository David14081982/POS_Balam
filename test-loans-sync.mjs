// test-loans-sync.mjs — H-62: persistencia remota de préstamos sobre el BUNDLE
// distribuido (index.html), no sobre la fuente.
//
// Qué demuestra y qué NO:
//
//   Este arnés prueba el CLIENTE —cola offline, reintento, rebase de versión,
//   choque de folio, pull y migración de los préstamos locales— contra un doble
//   de Supabase que implementa el mismo contrato que `pos.commit_loan_operation`
//   y `pos.loan_documents`. El doble no prueba el servidor: RLS, capacidades,
//   candado y unicidad se demuestran contra la base real en la verificación
//   autocontenida de la migración (`R-SEC-03` · `R-DB-09`). Son las dos mitades
//   de la misma garantía y ninguna sustituye a la otra.
//
//   La red real está cortada: toda petición a supabase.co la resuelve este
//   proceso. No sale un solo byte del equipo (`ADR-007`).
//
// Los controles se localizan por contrato estable, nunca por texto visible
// (`R-DEL-10`). Las semillas representan un estado válido del negocio
// (`R-DEL-12`): un préstamo con prenda real, talla con existencias, persona y
// fechas coherentes.
//
// Uso: node test-loans-sync.mjs
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
await new Promise(r => server.listen(8827, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };
const dia = delta => {
  const d = new Date(Date.now() + delta * 86400000), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const yymmdd = iso => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);

// ── Doble de Supabase ────────────────────────────────────────────────────────
// Reproduce el contrato de `pos.commit_loan_operation` tal y como queda tras la
// migración de H-62: acciones válidas, idempotencia por (operación, payload),
// unicidad de folio, versión esperada, `has_events` y transiciones de estado.
const cloud = {
  online: true,
  loans: new Map(),      // id → fila de pos.loan_documents
  audit: new Map(),      // operation_id → { cap, hash, result }
  rpcCalls: 0,
  reads: 0,
};
const ACTIONS = ['deliver', 'return', 'shortage', 'edit', 'delete', 'reopen'];
const err = (code, message) => ({ status: 400, body: { code, message, details: null, hint: null } });

function commitLoanOperation(args) {
  cloud.rpcCalls++;
  const id = args.p_loan && args.p_loan.id;
  const action = args.p_action;
  const expected = Number(args.p_expected_version) || 0;
  const cap = 'inventory.loan.' + action;
  const hash = JSON.stringify([action, args.p_loan, expected]);
  if (!ACTIONS.includes(action) || !args.p_operation_id || !id) {
    return err('22023', 'INVALID_LOAN_OPERATION');
  }
  // Idempotencia: misma operación y mismo payload devuelven el resultado ya
  // auditado; misma operación con otro contenido es conflicto.
  const seen = cloud.audit.get(args.p_operation_id);
  if (seen) {
    if (seen.cap === cap && seen.hash === hash) return { status: 200, body: seen.result };
    return err('40001', 'LOAN_OPERATION_CONFLICT');
  }
  const old = cloud.loans.get(id);
  let result;
  if (action === 'deliver') {
    if (old) return err('22023', 'INVALID_LOAN_DELIVERY');
    const folio = args.p_loan.folio;
    const state = args.p_loan.estado;
    // La entrega admite los tres estados del contrato: la migración adopta
    // documentos históricos ya cerrados conservando su estado.
    if (!folio || !['pendiente', 'devuelto', 'no_devuelto'].includes(state)
      || !Array.isArray(args.p_loan.lineas) || !args.p_loan.lineas.length) {
      return err('22023', 'INVALID_LOAN_DELIVERY');
    }
    // Unicidad del folio visible. H-62 la devuelve ESTRUCTURADA para que el
    // cliente pueda reidentificar, igual que `commit_sale` con folio_conflict.
    // La restricción SQL es absoluta: alcanza también a los tombstones.
    if ([...cloud.loans.values()].some(r => r.folio === folio)) {
      return { status: 200, body: { ok: false, error: 'folio_conflict' } };
    }
    cloud.loans.set(id, {
      id, folio, state, document: args.p_loan, version: 1,
      has_events: state !== 'pendiente' || (args.p_loan.devoluciones || []).length > 0,
      deleted_at: null, updated_at: new Date().toISOString(),
    });
    result = { ...args.p_loan, _loanVersion: 1 };
  } else {
    if (!old || old.deleted_at) return err('P0002', 'LOAN_NOT_FOUND');
    if (old.version !== expected) return err('40001', 'LOAN_VERSION_CONFLICT');
    if ((action === 'edit' || action === 'delete') && (old.has_events || old.state !== 'pendiente')) {
      return err('23514', 'LOAN_ALREADY_HAS_EFFECTS');
    }
    const next = args.p_loan.estado;
    if (action === 'return') {
      if (old.state === 'devuelto' || !['pendiente', 'devuelto'].includes(next)) return err('23514', 'INVALID_LOAN_RETURN');
      old.has_events = true;
    } else if (action === 'shortage') {
      if (old.state !== 'pendiente' || next !== 'no_devuelto') return err('23514', 'INVALID_LOAN_SHORTAGE');
      old.has_events = true;
    } else if (action === 'reopen') {
      if (old.state !== 'no_devuelto' || next !== 'pendiente') return err('23514', 'INVALID_LOAN_REOPEN');
      old.has_events = true;
    }
    if (action === 'delete') {
      old.deleted_at = new Date().toISOString();
      old.version += 1; old.updated_at = new Date().toISOString();
      result = { id: old.id, version: old.version, deleted_at: old.deleted_at };
    } else {
      old.document = args.p_loan; old.state = next;
      old.version += 1; old.updated_at = new Date().toISOString();
      result = { ...args.p_loan, _loanVersion: old.version };
    }
  }
  cloud.audit.set(args.p_operation_id, { cap, hash, result });
  return { status: 200, body: result };
}

function selectLoanDocuments(rangeHeader) {
  cloud.reads++;
  const rows = [...cloud.loans.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let from = 0, to = rows.length - 1;
  const m = /(\d+)-(\d+)/.exec(rangeHeader || '');
  if (m) { from = Number(m[1]); to = Number(m[2]); }
  return { status: 200, body: rows.slice(from, to + 1) };
}

// Enrutado compartido: TODAS las terminales del arnés hablan con el mismo doble,
// de modo que el contrato remoto está definido una sola vez.
async function enrutarNube(destino) {
  await destino.route(/supabase\.co/, async route => {
    if (!cloud.online) return route.abort();
    const req = route.request();
    const url = req.url();
    let out;
    if (/\/rest\/v1\/rpc\/commit_loan_operation/.test(url)) {
      out = commitLoanOperation(JSON.parse(req.postData() || '{}'));
    } else if (/\/rest\/v1\/loan_documents/.test(url) && req.method() === 'GET') {
      out = selectLoanDocuments(req.headers().range);
    } else {
      // Cualquier otra tabla responde "no existe": `pullDomain` corta sin tocar
      // lo local, que es justo el modo local histórico.
      out = { status: 404, body: { code: '42P01', message: 'relation does not exist' } };
    }
    await route.fulfill({
      status: out.status,
      contentType: 'application/json',
      headers: { 'Content-Range': '0-0/*' },
      body: JSON.stringify(out.body),
    });
  });
}

const b = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await b.newPage({ viewport: { width: 1500, height: 1000 } });
  page.on('pageerror', e => errs.push(String(e)));

  await enrutarNube(page);

  await page.goto('http://127.0.0.1:8827/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.CONFIG && window.STORE, null, { timeout: 25000 });

  const drenar = async (ms = 6000) => {
    await page.evaluate(() => window.STORE.flushQueue());
    await page.waitForFunction(
      () => window.STORE.queueStatus().operations.every(o => o.status !== 'pending' && o.status !== 'retry_wait'),
      null, { timeout: ms },
    ).catch(() => { /* queda pendiente: lo afirma la comprobación */ });
    await page.waitForTimeout(250);
  };
  const pendientes = () => page.evaluate(() => window.STORE.queueStatus().pending);
  const bloqueadas = () => page.evaluate(() => window.STORE.queueStatus().blocked);

  // ── Semilla ────────────────────────────────────────────────────────────────
  const seed = await page.evaluate(() => {
    const D = window.DATA;
    if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; window.STORE.pushSale = () => {}; }
    D.loans.length = 0; D.products.length = 0; D.sales.length = 0;
    try { localStorage.removeItem('balam_sync_queue'); } catch (e) { /* */ }
    D.products.push(D.hydrate({
      id: 'h62a', cat: '21', manga: 'MC', tela: 'ALG', color: 'BL', cuello: 'NOR',
      modelo: '962', nombre: 'GUAYABERA SINCRONIZADA', orn: '—', ornColors: [], precio: 1500,
      costo: 0, pop: false, stock: D.mkStock([0, 4, 0], []),
    }));
    D.saveProducts(); D.saveLoans();
    const p = D.products[0];
    const talla = p.stock.find(v => v.stock > 0).talla;
    return { sku: p.sku, talla, precio: D.listPrice(p, talla), stock: D.stockOf(p, talla) };
  });
  check('la semilla deja una prenda con existencias reales', seed.stock === 4, `stock ${seed.stock}`);

  const registrar = (persona, dias) => page.evaluate(([sku, talla, persona, hoy, esperada]) => {
    const D = window.DATA;
    const p = D.products.find(x => x.sku === sku);
    const r = D.registrarPrestamo({
      fecha: hoy, fechaEsperada: esperada,
      persona: { nombre: persona, tipo: 'cliente' },
      lineas: [{ productId: p.id, sku, talla, qty: 2 }],
      usuario: 'Arnés',
    });
    return r.ok ? { ok: true, id: r.loan.id, folio: r.loan.folio } : { ok: false, error: r.error };
  }, [seed.sku, seed.talla, persona, dia(0), dia(dias)]);

  console.log('\n── A) Un préstamo local llega a la nube ─────────────────');
  const l1 = await registrar('Rodrigo Prestatario', 7);
  check('el préstamo se registra localmente', l1.ok, l1.error || l1.folio);
  await drenar();
  check('el documento queda persistido en Supabase', cloud.loans.size === 1, `filas ${cloud.loans.size}`);
  const remoto1 = cloud.loans.get(l1.id);
  check('la nube conserva el folio visible del vale', !!remoto1 && remoto1.folio === l1.folio, remoto1 && remoto1.folio);
  check('la nube conserva la evidencia congelada de la prenda',
    !!remoto1 && remoto1.document.lineas[0].sku === seed.sku
      && remoto1.document.lineas[0].precio === seed.precio,
    remoto1 && JSON.stringify(remoto1.document.lineas[0] || {}).slice(0, 90));
  check('la nube conserva a la persona que recibió',
    !!remoto1 && remoto1.document.persona.nombre === 'Rodrigo Prestatario');
  check('la cola queda vacía tras confirmar', await pendientes() === 0);
  check('la terminal guarda la versión confirmada por el servidor',
    await page.evaluate(id => (window.DATA.loans.find(l => l.id === id) || {})._loanVersion, l1.id) === 1);

  console.log('\n── B) Reintentar no duplica ────────────────────────────');
  const llamadasAntes = cloud.rpcCalls;
  await page.evaluate(() => window.STORE.flushQueue());
  await page.waitForTimeout(400);
  check('un drenado extra no crea un segundo documento', cloud.loans.size === 1, `filas ${cloud.loans.size}`);
  check('la operación confirmada ya no vuelve a enviarse', cloud.rpcCalls === llamadasAntes,
    `llamadas ${cloud.rpcCalls - llamadasAntes}`);

  console.log('\n── C) Sin conexión ─────────────────────────────────────');
  cloud.online = false;
  const l2 = await registrar('Marisol Sin Red', 3);
  check('sin conexión el préstamo se registra igual', l2.ok, l2.error);
  await drenar(2500);
  check('el préstamo sin conexión no llegó a la nube', cloud.loans.size === 1, `filas ${cloud.loans.size}`);
  check('la operación queda pendiente en la cola', await pendientes() >= 1, `pendientes ${await pendientes()}`);
  check('la operación pendiente NO queda bloqueada', await bloqueadas() === 0);

  console.log('\n── D) Dos movimientos sin conexión sobre el mismo préstamo ─');
  const dev = await page.evaluate(id => {
    const r = window.DATA.registrarDevolucionPrestamo(id, {
      fecha: new Date().toISOString().slice(0, 10),
      lineas: [{ key: window.DATA.loans.find(l => l.id === id).lineas[0].key, qty: 1 }],
    });
    return r.ok ? { ok: true, pendientes: window.DATA.prestamoPendientes(r.loan) } : { ok: false, error: r.error };
  }, l2.id);
  check('la devolución parcial se registra sin conexión', dev.ok && dev.pendientes === 1, dev.error || `faltan ${dev.pendientes}`);

  console.log('\n── E) Al volver la conexión se envía todo, en orden ─────');
  cloud.online = true;
  await drenar(9000);
  check('el préstamo pendiente llegó a la nube', cloud.loans.size === 2, `filas ${cloud.loans.size}`);
  const remoto2 = cloud.loans.get(l2.id);
  check('la devolución parcial también llegó',
    !!remoto2 && remoto2.document.lineas[0].devueltas === 1,
    remoto2 && String(remoto2.document.lineas[0].devueltas));
  check('el documento remoto quedó en la versión 2', !!remoto2 && remoto2.version === 2,
    remoto2 && `v${remoto2.version}`);
  check('ninguna operación quedó bloqueada tras reconectar', await bloqueadas() === 0,
    JSON.stringify(await page.evaluate(() => window.STORE.queueStatus().operations.map(o => [o.status, o.diagnostic && o.diagnostic.code]))));
  check('la cola quedó vacía', await pendientes() === 0, `pendientes ${await pendientes()}`);

  console.log('\n── F) Choque de folio entre dos terminales ─────────────');
  // Otra terminal ya registró hoy el folio que esta terminal va a generar.
  const hoy6 = yymmdd(dia(0));
  const folioAjeno = 'PR-' + hoy6 + '-003';
  cloud.loans.set('otra-terminal-1', {
    id: 'otra-terminal-1', folio: folioAjeno, state: 'pendiente',
    document: { id: 'otra-terminal-1', folio: folioAjeno, estado: 'pendiente', lineas: [], devoluciones: [], persona: { nombre: 'Cliente de otra terminal' } },
    version: 1, has_events: false, deleted_at: null, updated_at: new Date().toISOString(),
  });
  const l3 = await registrar('Choque de Folio', 5);
  check('la terminal genera el folio que ya existe en la nube', l3.folio === folioAjeno, l3.folio);
  await drenar(9000);
  const l3remoto = cloud.loans.get(l3.id);
  check('el préstamo se persiste pese al choque', !!l3remoto, `filas ${cloud.loans.size}`);
  check('el folio se reidentifica con el código de esta terminal',
    !!l3remoto && l3remoto.folio !== folioAjeno && l3remoto.folio.startsWith(folioAjeno + '-'),
    l3remoto && l3remoto.folio);
  check('el folio ya impreso se conserva como alias',
    await page.evaluate(id => {
      const l = window.DATA.loans.find(x => x.id === id) || {};
      return Array.isArray(l.folioAliases) && l.folioAliases.length > 0;
    }, l3.id));
  check('el préstamo sigue localizable por el folio impreso',
    await page.evaluate(([id, folio]) => {
      const l = window.DATA.findLoanByFolio && window.DATA.findLoanByFolio(folio);
      return !!l && l.id === id;
    }, [l3.id, folioAjeno]));
  check('el documento ajeno no se tocó',
    cloud.loans.get('otra-terminal-1').folio === folioAjeno && cloud.loans.get('otra-terminal-1').version === 1);
  check('el choque no dejó operaciones bloqueadas', await bloqueadas() === 0);

  console.log('\n── G) Otra terminal lee los préstamos ──────────────────');
  const antesDeLimpiar = await page.evaluate(() => window.DATA.loans.length);
  // Se borra el almacenamiento local de préstamos: es el escenario de «cambié de
  // equipo» y el de «me borraron los datos del navegador».
  const almacenLimpio = await page.evaluate(() => {
    localStorage.removeItem('balam_pos_loans_v1');
    localStorage.removeItem('balam_sync_queue');
    return localStorage.getItem('balam_pos_loans_v1') === null;
  });
  check('la terminal se queda sin préstamos en su almacenamiento local', almacenLimpio);
  const lecturasPrevias = cloud.reads;
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.DATA && window.STORE, null, { timeout: 25000 });
  await page.evaluate(() => window.STORE.init({ pull: true }));
  await page.waitForTimeout(1200);
  check('la cartera se repuebla leyendo Supabase, no el almacenamiento local',
    cloud.reads > lecturasPrevias, `lecturas ${cloud.reads - lecturasPrevias}`);
  const recuperados = await page.evaluate(() => window.DATA.loans.map(l => ({
    id: l.id, folio: l.folio, estado: l.estado,
    piezas: (l.lineas || []).reduce((a, x) => a + x.qty, 0),
    devueltas: (l.lineas || []).reduce((a, x) => a + (x.devueltas || 0), 0),
    persona: (l.persona || {}).nombre,
  })));
  check('la caché se reconstruye desde Supabase', recuperados.length === antesDeLimpiar + 1,
    `recuperados ${recuperados.length} de ${antesDeLimpiar + 1}`);
  const rec1 = recuperados.find(l => l.id === l1.id);
  check('un préstamo creado en otra terminal se lee completo',
    !!rec1 && rec1.folio === l1.folio && rec1.piezas === 2 && rec1.persona === 'Rodrigo Prestatario',
    JSON.stringify(rec1 || {}));
  const rec2 = recuperados.find(l => l.id === l2.id);
  check('la devolución parcial viaja con el documento',
    !!rec2 && rec2.devueltas === 1, JSON.stringify(rec2 || {}));
  check('el préstamo de la otra terminal también se ve',
    recuperados.some(l => l.id === 'otra-terminal-1'));
  check('la reconstrucción no encoló nada', await pendientes() === 0);

  console.log('\n── H) La campana usa información sincronizada ──────────');
  const vencidoId = 'vencido-remoto-1';
  cloud.loans.set(vencidoId, {
    id: vencidoId, folio: 'PR-' + yymmdd(dia(-9)) + '-001', state: 'pendiente',
    document: {
      id: vencidoId, folio: 'PR-' + yymmdd(dia(-9)) + '-001', estado: 'pendiente',
      fecha: dia(-9) + ' 10:00', fechaEsperada: dia(-2), fechaDevolucion: null,
      persona: { nombre: 'Deudor Remoto', tipo: 'cliente', id: null, tel: '' },
      lineas: [{ key: seed.sku + '|' + seed.talla, productId: 'h62a', sku: seed.sku, nombre: 'GUAYABERA SINCRONIZADA', talla: seed.talla, qty: 1, devueltas: 0, precio: seed.precio }],
      devoluciones: [], nota: '', notaCierre: '', usuario: 'Otra terminal',
    },
    version: 1, has_events: false, deleted_at: null, updated_at: new Date().toISOString(),
  });
  await page.evaluate(() => window.STORE.init({ pull: true }));
  await page.waitForTimeout(1200);
  const alarma = await page.evaluate(() => {
    const vencidos = window.DATA.prestamosVencidos();
    return { total: vencidos.length, folios: vencidos.map(v => v.folio) };
  });
  check('un préstamo vencido de otra terminal alarma en ésta',
    alarma.total === 1 && /^PR-/.test(alarma.folios[0] || ''), JSON.stringify(alarma));

  console.log('\n── I) Un préstamo dado de baja no revive ───────────────');
  // La comprobación sólo vale si el documento ESTABA en la cartera: si no se
  // hubiera bajado nunca, «ya no está» pasaría en vacío (`AP-09`).
  check('el documento a dar de baja estaba en la cartera',
    await page.evaluate(id => window.DATA.loans.some(l => l.id === id), vencidoId));
  cloud.loans.get(vencidoId).deleted_at = new Date().toISOString();
  await page.evaluate(() => window.STORE.init({ pull: true }));
  await page.waitForTimeout(1200);
  check('el documento con baja lógica desaparece de la cartera',
    await page.evaluate(id => !window.DATA.loans.some(l => l.id === id), vencidoId));

  console.log('\n── J) Migración de los préstamos locales existentes ────');
  const migracion = await page.evaluate(() => {
    const D = window.DATA;
    // Estado real anterior a H-62: préstamos en localStorage que nunca se
    // enviaron, sin `_loanVersion`, con sus folios y fechas originales.
    const previos = [
      { id: 'legado-1', folio: 'PR-250101-001', estado: 'pendiente' },
      { id: 'legado-2', folio: 'PR-250101-002', estado: 'devuelto' },
    ].map(base => ({
      ...base,
      fecha: '2025-01-01 09:30', fechaEsperada: '2025-01-08',
      fechaDevolucion: base.estado === 'devuelto' ? '2025-01-05 12:00' : null,
      persona: { nombre: 'Cliente Histórico ' + base.id, tipo: 'cliente', id: null, tel: '' },
      lineas: [{ key: 'SKU|M', productId: 'x', sku: 'SKU', nombre: 'PRENDA HISTÓRICA', talla: 'M', qty: 2, devueltas: base.estado === 'devuelto' ? 2 : 0, precio: 900 }],
      devoluciones: base.estado === 'devuelto' ? [{ fecha: '2025-01-05 12:00', lineas: [{ key: 'SKU|M', qty: 2 }], nota: '' }] : [],
      nota: '', notaCierre: '', usuario: 'Histórico',
    }));
    previos.forEach(l => D.loans.push(l));
    D.saveLoans();
    return previos.map(l => l.id);
  });
  check('hay préstamos locales sin sincronizar que migrar', migracion.length === 2);
  const informe = await page.evaluate(async () => {
    if (!window.STORE.migrateLocalLoans) return { ausente: true };
    return await window.STORE.migrateLocalLoans();
  });
  await drenar(9000);
  check('la migración produce un informe', !informe.ausente && typeof informe === 'object',
    JSON.stringify(informe).slice(0, 140));
  check('el informe declara cuántos documentos detectó',
    !informe.ausente && informe.detectados === 2, JSON.stringify(informe).slice(0, 140));
  check('los dos préstamos históricos llegaron a la nube',
    migracion.every(id => cloud.loans.has(id)),
    migracion.filter(id => !cloud.loans.has(id)).join(','));
  const doc = id => ((cloud.loans.get(id) || {}).document) || {};
  check('la migración conserva el folio original',
    (cloud.loans.get('legado-1') || {}).folio === 'PR-250101-001');
  check('la migración conserva la fecha original',
    doc('legado-1').fecha === '2025-01-01 09:30', doc('legado-1').fecha);
  check('la migración conserva las devoluciones ya registradas',
    (doc('legado-2').devoluciones || []).length === 1);
  check('el préstamo cerrado conserva su estado',
    (cloud.loans.get('legado-2') || {}).state === 'devuelto');
  check('la copia local previa a la migración se conserva',
    await page.evaluate(() => {
      try { return (JSON.parse(localStorage.getItem('balam_pos_loans_premigracion_v1')) || {}).loans.length >= 2; }
      catch (e) { return false; }
    }));

  console.log('\n── K) La migración es idempotente ──────────────────────');
  const filasAntes = cloud.loans.size, llamadasPrevias = cloud.rpcCalls;
  const informe2 = await page.evaluate(async () => {
    if (!window.STORE.migrateLocalLoans) return { ausente: true };
    return await window.STORE.migrateLocalLoans();
  });
  await drenar(6000);
  check('reejecutar la migración no crea documentos nuevos', cloud.loans.size === filasAntes,
    `${filasAntes} → ${cloud.loans.size}`);
  check('reejecutar no reenvía lo ya confirmado', cloud.rpcCalls === llamadasPrevias,
    `llamadas ${cloud.rpcCalls - llamadasPrevias}`);
  check('el segundo informe declara cero pendientes',
    !informe2.ausente && informe2.detectados === 0, JSON.stringify(informe2).slice(0, 140));

  console.log('\n── M) Dos terminales independientes: A → B → A ─────────');
  // Contextos de navegador SEPARADOS: cada uno con su propio `localStorage` y,
  // por tanto, su propio `balam_device_id`. No es la misma terminal recargada:
  // son dos instalaciones distintas contra la misma nube.
  const abrirTerminal = async nombre => {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await enrutarNube(ctx);
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(nombre + ': ' + String(e)));
    await p.goto('http://127.0.0.1:8827/index.html', { waitUntil: 'load' });
    await p.waitForFunction(() => window.DATA && window.CONFIG && window.STORE, null, { timeout: 25000 });
    await p.evaluate(() => {
      if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; window.STORE.pushSale = () => {}; }
    });
    return { ctx, page: p };
  };
  const sincronizar = async t => {
    await t.page.evaluate(() => window.STORE.init({ pull: true }));
    await t.page.waitForTimeout(1200);
  };
  const cartera = t => t.page.evaluate(() => window.DATA.loans.map(l => ({
    id: l.id, folio: l.folio, estado: l.estado,
    piezas: (l.lineas || []).reduce((a, x) => a + (Number(x.qty) || 0), 0),
    devueltas: (l.lineas || []).reduce((a, x) => a + (Number(x.devueltas) || 0), 0),
    persona: (l.persona || {}).nombre, fechaDevolucion: l.fechaDevolucion || null,
    version: l._loanVersion == null ? null : l._loanVersion,
  })));

  const A = await abrirTerminal('A');
  const B = await abrirTerminal('B');
  const idA = await A.page.evaluate(() => window.CORE.getDeviceId());
  const idB = await B.page.evaluate(() => window.CORE.getDeviceId());
  check('A y B son terminales distintas', !!idA && !!idB && idA !== idB, `${idA} · ${idB}`);

  // A registra un préstamo con su propio catálogo local.
  const creado = await A.page.evaluate(() => {
    const D = window.DATA;
    D.products.push(D.hydrate({
      id: 'h62m', cat: '21', manga: 'MC', tela: 'ALG', color: 'AZ', cuello: 'NOR',
      modelo: '999', nombre: 'GUAYABERA DOS TERMINALES', orn: '—', ornColors: [], precio: 2000,
      costo: 0, pop: false, stock: D.mkStock([0, 5, 0], []),
    }));
    D.saveProducts();
    const p = D.products.find(x => x.id === 'h62m');
    const talla = p.stock.find(v => v.stock > 0).talla;
    const hoy = new Date().toISOString().slice(0, 10);
    const manana = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const r = D.registrarPrestamo({
      fecha: hoy, fechaEsperada: manana,
      persona: { nombre: 'Cliente de la Terminal A', tipo: 'cliente' },
      lineas: [{ productId: p.id, sku: p.sku, talla, qty: 3 }],
      usuario: 'Terminal A',
    });
    return r.ok ? { id: r.loan.id, folio: r.loan.folio, key: r.loan.lineas[0].key } : { error: r.error };
  });
  check('A registra el préstamo', !!creado.id, creado.error || creado.folio);
  await A.page.evaluate(() => window.STORE.flushQueue());
  await A.page.waitForTimeout(900);
  check('A lo confirma contra la nube',
    !!cloud.loans.get(creado.id) && cloud.loans.get(creado.id).version === 1);

  // B nunca ha visto ese préstamo: sólo puede llegarle por sincronización.
  const antesEnB = await cartera(B);
  check('B no conocía el préstamo antes de sincronizar',
    !antesEnB.some(l => l.id === creado.id), `${antesEnB.length} en cartera`);
  await sincronizar(B);
  const enB = (await cartera(B)).find(l => l.id === creado.id);
  check('B ve el préstamo creado en A', !!enB, JSON.stringify(await cartera(B)).slice(0, 120));
  check('B lo ve con folio, persona y piezas idénticos',
    !!enB && enB.folio === creado.folio && enB.persona === 'Cliente de la Terminal A' && enB.piezas === 3,
    JSON.stringify(enB || {}));
  check('B lo recibe ya confirmado por el servidor', !!enB && enB.version === 1, enB && `v${enB.version}`);

  // B registra la devolución parcial de una pieza.
  const devB = await B.page.evaluate(([id, key]) => {
    const hoy = new Date().toISOString().slice(0, 10);
    const r = window.DATA.registrarDevolucionPrestamo(id, { fecha: hoy, lineas: [{ key, qty: 1 }] });
    return r.ok ? { ok: true, cerrado: r.cerrado } : { ok: false, error: r.error };
  }, [creado.id, creado.key]);
  check('B registra una devolución parcial', devB.ok && !devB.cerrado, devB.error);
  await B.page.evaluate(() => window.STORE.flushQueue());
  await B.page.waitForTimeout(900);
  check('la devolución de B llega a la nube',
    (cloud.loans.get(creado.id) || {}).version === 2
      && cloud.loans.get(creado.id).document.lineas[0].devueltas === 1,
    `v${(cloud.loans.get(creado.id) || {}).version}`);

  // A vuelve a sincronizar y debe ver lo que hizo B.
  await sincronizar(A);
  const enA = (await cartera(A)).find(l => l.id === creado.id);
  check('A ve la devolución registrada en B', !!enA && enA.devueltas === 1, JSON.stringify(enA || {}));
  check('A sigue viendo el préstamo abierto con dos piezas fuera',
    !!enA && enA.estado === 'pendiente' && enA.piezas - enA.devueltas === 2);

  // B cierra el préstamo devolviendo las dos piezas restantes.
  const cierreB = await B.page.evaluate(([id, key]) => {
    const hoy = new Date().toISOString().slice(0, 10);
    const r = window.DATA.registrarDevolucionPrestamo(id, { fecha: hoy, lineas: [{ key, qty: 2 }] });
    return r.ok ? { ok: true, cerrado: r.cerrado } : { ok: false, error: r.error };
  }, [creado.id, creado.key]);
  check('B cierra el préstamo con la devolución total', cierreB.ok && cierreB.cerrado, cierreB.error);
  await B.page.evaluate(() => window.STORE.flushQueue());
  await B.page.waitForTimeout(900);
  await sincronizar(A);
  const finalA = (await cartera(A)).find(l => l.id === creado.id);
  check('A ve el préstamo como devuelto', !!finalA && finalA.estado === 'devuelto', JSON.stringify(finalA || {}));
  check('A ve la fecha real de devolución', !!finalA && !!finalA.fechaDevolucion, finalA && String(finalA.fechaDevolucion));
  check('las tres piezas constan como regresadas en A',
    !!finalA && finalA.devueltas === 3, finalA && `devueltas ${finalA.devueltas}`);
  check('ninguna de las dos terminales quedó con operaciones bloqueadas',
    (await A.page.evaluate(() => window.STORE.queueStatus().blocked)) === 0
      && (await B.page.evaluate(() => window.STORE.queueStatus().blocked)) === 0);
  check('el inventario de A no se movió en todo el intercambio',
    await A.page.evaluate(() => {
      const p = window.DATA.products.find(x => x.id === 'h62m');
      return p ? window.DATA.stockOf(p, p.stock.find(v => v.stock > 0).talla) : -1;
    }) === 5);
  await A.ctx.close(); await B.ctx.close();

  console.log('\n── L) Coherencia final ─────────────────────────────────');
  check('ninguna operación quedó bloqueada al terminar', await bloqueadas() === 0,
    JSON.stringify(await page.evaluate(() => window.STORE.queueStatus().operations.map(o => [o.type, o.status]))));
  check('el inventario no se movió en todo el recorrido',
    await page.evaluate(([sku, talla]) => {
      const p = window.DATA.products.find(x => x.sku === sku);
      return p ? window.DATA.stockOf(p, talla) : -1;
    }, [seed.sku, seed.talla]) === seed.stock);
  check('sin errores de consola durante el recorrido', errs.length === 0, errs.slice(0, 2).join(' | '));
} finally {
  await b.close();
  server.close();
}
console.log(`\n${pass}/${pass + fail} verificaciones`);
process.exit(fail ? 1 : 0);
