// test-liquidations.mjs — e2e del sync de liquidaciones a la nube (source vía HTTP).
// Verifica: saveLiquidations → STORE.pushRows('liquidations'), mapping MAP.liquidations,
// applyRemote('liquidations') reemplaza, y liquidarComision/cerrarMes registran. Sync real
// neutralizado (run() encola/offline); espiamos pushRows. 0 pageerrors.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const ROOT = path.resolve('.');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/POS Balam.html';
  const fp = path.join(ROOT, p); if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8802, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage();
page.on('pageerror', e => errs.push(String(e)));
await page.goto('http://127.0.0.1:8802/POS%20Balam.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.DATA.liquidarComision && window.STORE, null, { timeout: 20000 });

const r = await page.evaluate(() => {
  const D = window.DATA, out = {};
  // ¿MAP.liquidations registrado con toRow? pushRows con [] devuelve promesa (truthy) si existe; si no, undefined.
  out.mappingOk = !!window.STORE.pushRows('liquidations', []);
  // Espía pushRows (sin tocar la nube).
  const calls = []; window.STORE.pushRows = (k, a) => { calls.push({ k, n: a.length }); };

  // 1) liquidarComision registra + sincroniza
  D.liquidations.length = 0;
  const s = D.sellers.find(x => x.role !== 'admin') || D.sellers[1];
  s.comisionAcum = 500;
  const monto = D.liquidarComision(s.id);
  const e0 = D.liquidations[0];
  out.liquidar = { monto, len: D.liquidations.length, tipo: e0 && e0.tipo, sellerId: e0 && e0.sellerId === s.id, hasFecha: !!(e0 && e0.fecha), acum0: s.comisionAcum, pushed: calls.some(c => c.k === 'liquidations') };

  // 2) cerrarMes liquida pendientes (2 vendedores) → entradas 'corte'
  D.liquidations.length = 0; calls.length = 0;
  D.sellers.forEach(x => { x.comisionAcum = 0; });
  D.sellers[1].comisionAcum = 100; D.sellers[2].comisionAcum = 200;
  const res = D.cerrarMes();
  out.corte = { vendedores: res.vendedores, total: res.total, len: D.liquidations.length, allCorte: D.liquidations.every(l => l.tipo === 'corte'), pushed: calls.some(c => c.k === 'liquidations'), acumReset: D.sellers[1].comisionAcum === 0 && D.sellers[2].comisionAcum === 0 };

  // 3) applyRemote('liquidations') reemplaza desde la nube (fromRow ya aplicado por pullDomain)
  D.applyRemote('liquidations', [
    { id: 'liq-a', sellerId: 's1', seller: 'A', monto: 111, tipo: 'corte', fecha: '2026-02-01 09:00' },
    { id: 'liq-b', sellerId: 's1', seller: 'A', monto: 222, tipo: 'liquidacion', fecha: '2026-03-01 09:00' },
  ]);
  out.applyRemote = { len: D.liquidations.length, montoA: D.liquidations.find(l => l.id === 'liq-a').monto, replaced: !D.liquidations.some(l => l.tipo === 'corte' && l.monto === 100) };
  return out;
});

console.log('\nmappingOk:', r.mappingOk);
console.log('liquidar:', JSON.stringify(r.liquidar));
console.log('corte:', JSON.stringify(r.corte));
console.log('applyRemote:', JSON.stringify(r.applyRemote), '\n');

check('MAP.liquidations registrado (toRow)', r.mappingOk === true);
check('liquidarComision registra 1 entrada', r.liquidar.len === 1 && r.liquidar.monto === 500);
check('Entrada tipo liquidacion + sellerId + fecha', r.liquidar.tipo === 'liquidacion' && r.liquidar.sellerId && r.liquidar.hasFecha);
check('comisionAcum → 0 tras liquidar', r.liquidar.acum0 === 0);
check('saveLiquidations dispara pushRows(liquidations)', r.liquidar.pushed === true);
check('cerrarMes liquida 2 vendedores', r.corte.vendedores === 2 && r.corte.total === 300);
check('2 entradas, todas tipo corte', r.corte.len === 2 && r.corte.allCorte === true);
check('corte dispara pushRows + resetea acum', r.corte.pushed === true && r.corte.acumReset === true);
check('applyRemote reemplaza (2 filas nube)', r.applyRemote.len === 2 && r.applyRemote.montoA === 111 && r.applyRemote.replaced === true);
check('Sin errores de página (pageerror=0)', errs.length === 0, errs.join(' | '));

await b.close(); server.close();
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
