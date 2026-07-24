// Verifica resetTestData(): borra lo transaccional de prueba, CONSERVA inventario/vendedores
// y devuelve al stock lo que consumieron las ventas de prueba.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = path.resolve('c:/Users/david/Downloads/POS BALAM');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/POS Balam.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8801, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage();
page.on('pageerror', e => errs.push(String(e)));
await page.route(/supabase\.co/, r => r.abort());
await page.goto('http://127.0.0.1:8801/POS%20Balam.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.DATA.resetTestData && window.CONFIG, null, { timeout: 25000 });

const r = await page.evaluate(() => {
  const D = window.DATA, out = {};
  const pushed = [];
  if (window.STORE) {
    window.STORE.pushSale = () => {}; window.STORE.pushReturn = () => {};
    window.STORE.pushRows = (k) => pushed.push(k);
  }
  // Inventario "real" que NO se debe tocar
  const p = D.hydrate({ id: 'inv-real-1', cat: '21', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'NOR', modelo: '777', nombre: 'Guayabera Real', orn: '—', ornColors: [], precio: 500, costo: 200, pop: false, stock: D.mkStock([0, 10], []) });
  D.products.push(p); D.saveProducts();
  const seller = { id: 'v-reset-1', nombre: 'Vendedor Reset', iniciales: 'VR', color: '#333', comisionPct: 10, metaMes: 5000, ventasMes: 0, ventasNum: 0, comisionAcum: 0, bono: 'Sin bono', role: 'vendedor', email: 'v@x.com', passwordHash: 'HASH-NO-BORRAR', active: true };
  D.sellers.push(seller); D.saveSellers();
  const cli = D.addClient({ nombre: 'Cliente Prueba', tel: '555' });
  D.promos.push({ id: 'promo-prueba', nombre: 'Promo test', tipo: 'pct', valor: 10, scope: {}, pausado: false, creado: Date.now() }); D.savePromos();
  D.liquidations.push({ id: 'liq-1', sellerId: seller.id, seller: seller.nombre, monto: 100, tipo: 'liquidacion', fecha: '2026-07-01 10:00' });
  // Movimiento de INVENTARIO (debe sobrevivir)
  D.movements.unshift({ fecha: '2026-07-01 09:00', tipo: 'Entrada', producto: p.nombre, sku: p.sku, cant: 10, ref: 'carga inicial' }); D.saveMovements();

  const e = p.stock.find(v => v.stock > 3); const talla = e.talla;
  out.stock0 = e.stock;

  // Pruebas: venta de 3, venta apartada de 2 (no descuenta), devolución de 1
  const s1 = D.recordSale({ ticket: [{ p, talla, qty: 3 }], sellerIds: [seller.id], client: cli, metodo: 'Efectivo', estado: 'Pagado', total: 1500, itemCount: 3 });
  const s2 = D.recordSale({ ticket: [{ p, talla, qty: 2 }], sellerIds: [seller.id], client: cli, metodo: 'Efectivo', estado: 'Apartado', total: 1000, itemCount: 2 });
  out.stockTrasVenta = p.stock.find(v => v.talla === talla).stock;
  D.recordReturn({ folio: s1.folio, lineas: [{ sku: p.sku, nombre: p.nombre, talla, qty: 1, motivo: 'talla', precio: 500 }], metodo: 'Efectivo' });
  out.stockTrasDevol = p.stock.find(v => v.talla === talla).stock;
  out.antes = { sales: D.sales.length, returns: D.returns.length, promos: D.promos.length, liq: D.liquidations.length, clients: D.clients.length, movs: D.movements.length, sellerVentas: seller.ventasMes };

  pushed.length = 0;
  D.resetTestData();

  const pf = D.products.find(x => x.id === 'inv-real-1');
  const sf = D.sellers.find(x => x.id === 'v-reset-1');
  out.despues = {
    sales: D.sales.length, returns: D.returns.length, promos: D.promos.length,
    liq: D.liquidations.length, clients: D.clients.length,
    clientesGenerico: D.clients.every(c => c.generic),
    movs: D.movements.length, movsTipos: [...new Set(D.movements.map(m => m.tipo))],
    products: D.products.length, productoVive: !!pf,
    precio: pf && pf.precio, costo: pf && pf.costo,
    stock: pf && pf.stock.find(v => v.talla === talla).stock,
    sellerVive: !!sf, sellerHash: sf && sf.passwordHash, sellerPct: sf && sf.comisionPct,
    sellerMeta: sf && sf.metaMes, ventasMes: sf && sf.ventasMes, ventasNum: sf && sf.ventasNum,
    comisionAcum: sf && sf.comisionAcum,
    pushed: pushed.slice(),
  };
  // ¿Sobrevive a una recarga del storage? (los seeds no deben repoblar)
  out.persistido = {
    sales: JSON.parse(localStorage.getItem('balam_pos_sales_v1') || '[]').length,
    promos: JSON.parse(localStorage.getItem('balam_pos_promos_v1') || '[]').length,
    products: JSON.parse(localStorage.getItem('balam_pos_products_v2') || '[]').length,
  };
  return out;
});

console.log(JSON.stringify(r, null, 1));
const d = r.despues;
check('venta descontó stock (10→7)', r.stock0 === 10 && r.stockTrasVenta === 7, `${r.stock0}→${r.stockTrasVenta}`);
check('devolución reingresó 1 (7→8)', r.stockTrasDevol === 8, String(r.stockTrasDevol));
check('STOCK RESTAURADO al valor previo a las pruebas', d.stock === r.stock0, `got=${d.stock} exp=${r.stock0}`);
check('INVENTARIO conservado (producto vive)', d.productoVive && d.products >= 1);
check('precio y costo intactos', d.precio === 500 && d.costo === 200);
check('ventas borradas', d.sales === 0);
check('devoluciones borradas', d.returns === 0);
check('descuentos/promos borrados', d.promos === 0);
check('liquidaciones borradas', d.liq === 0);
check('clientes: solo el genérico', d.clients === 1 && d.clientesGenerico);
check('movimientos de venta/devolución borrados', !d.movsTipos.includes('Venta') && !d.movsTipos.includes('Devolución'));
check('movimiento de inventario "Entrada" CONSERVADO', d.movsTipos.includes('Entrada'), JSON.stringify(d.movsTipos));
check('vendedor conservado con su contraseña', d.sellerVive && d.sellerHash === 'HASH-NO-BORRAR');
check('vendedor conserva % comisión y meta', d.sellerPct === 10 && d.sellerMeta === 5000);
check('acumulados del vendedor en cero', d.ventasMes === 0 && d.ventasNum === 0 && d.comisionAcum === 0);
check('sube a la nube products/sellers/clients', ['products', 'sellers', 'clients'].every(k => d.pushed.includes(k)), JSON.stringify(d.pushed));
check('NO re-sube promociones ni ventas', !d.pushed.includes('promotions'));
check('persistido: sin ventas/promos, con productos', r.persistido.sales === 0 && r.persistido.promos === 0 && r.persistido.products >= 1);
check('sin errores de página', errs.length === 0, errs.join(' | '));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
