// H164: one execution per distinct DATA command. No real commercial writes.
// Proves async confirmation boundary with actual DATA/CONFIG; SQL is certified separately.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const handlers = new Map();
let storageCalls = 0, offline = false, pending = null;
let productAdapter, promoAdapter, moneyAdapter;
const window = {
  crypto: { randomUUID },
  addEventListener(name, fn) { const list = handlers.get(name) || []; list.push(fn); handlers.set(name, list); },
  dispatchEvent(event) { for (const fn of handlers.get(event.type) || []) fn(event); },
  CORE: {
    getDeviceId: () => 'h164-isolated-contract',
    registerCatalogProducts: adapter => { productAdapter = adapter; },
    registerCatalogPromotions: adapter => { promoAdapter = adapter; },
    registerMonetaryDocuments: adapter => { moneyAdapter = adapter; },
    catalogProducts: () => productAdapter?.list() || [],
    catalogPromotions: () => promoAdapter?.list() || [],
    monetaryMethodInUse: code => moneyAdapter?.referencesMethod(code) || false,
    invokeSync(name, ...args) {
      if (name === 'getQuoteContext') return { configVersion: 7, opaqueVersionField: 'preserve-entire-context' };
      if (name === 'serverNow') return new Date('2026-09-11T19:00:00Z');
      if (name === 'assertBusinessReady') {
        if (offline) throw Object.assign(new Error('Sin conexión. BALAM necesita internet para continuar.'), { code: 'ONLINE_OFFLINE' });
        return true;
      }
      if (name === 'allocateFolio') return Promise.resolve({ ok: true, folio: args[0].kind === 'loan' ? 'PR-260911-001' : 'BG-260911-0100' });
      assert.equal(pending, null, 'no nested/parallel commercial command');
      return new Promise((resolve, reject) => { pending = { name, args, resolve, reject }; });
    },
  },
};
const context = vm.createContext({ window, console, setTimeout, clearTimeout,
  CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  localStorage: new Proxy({}, { get() { storageCalls++; throw new Error('Commercial storage access prohibited'); } }),
});
for (const file of ['config', 'data']) vm.runInContext(fs.readFileSync(`balam/${file}.jsx`, 'utf8'), context, { filename: file + '.jsx' });
const C = window.CONFIG, D = window.DATA;
const keys = ['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'];
const snapshot = () => ({ ...Object.fromEntries(keys.map(key => [key, JSON.parse(JSON.stringify(D[key === 'promotions' ? 'promos' : key]))])), commissionContext: JSON.parse(JSON.stringify(D.commissionContext)) });
assert.equal(D.products.length, 0, 'startup does not adopt local products');
assert.equal(D.sellers.length, 0, 'startup does not seed a local admin');
C.load(C.prepareMutation('reset', []).state);
const talla = D.SIZES_LETRA[0];
const product = (id, price = 116) => D.hydrate({ id, recordModel: 'v1', cat: '21', modelo: id,
  nombre: id, tela: 'ALG', manga: 'ML', color: 'BL', cuello: 'NOR', orn: '—', ornColors: [],
  precio: price, costo: 40, sizeCategoryId: 'size_letter', attrs: { __sizeCategoryId: 'size_letter' },
  stock: [{ talla, escala: 'L', stock: 8 }], _syncVersion: 3 });
const p1 = product('h164-source'), p2 = product('h164-target', 232), p3 = product('h164-empty');
const sourceLine = { lineId: randomUUID(), productId: p1.id, sku: p1.sku, nombre: p1.nombre,
  talla, qty: 1, precio: 116, precioOrig: 116, listPrice: 116, effectivePrice: 116 };
const existingSale = { folio: 'BG-260911-0001', fecha: '2026-09-11 10:00', _operationId: randomUUID(),
  clienteId: 'h164-client', cliente: 'Cliente', vendedores: ['h164-seller'], vendedor: 'Vendedor',
  estado: 'Pagado', metodo: 'Efectivo', subtotal: 100, iva: 16, total: 116, saldo: 0, anticipo: 116,
  items: 1, descuento: 0, comision: 5, comisiones: [{ sellerId: 'h164-seller', base: 100, monto: 5, pct: 5 }],
  lineas: [sourceLine], returnLimitDays: null, returnExpiresAt: null };
const layaway = { ...existingSale, folio: 'BG-260911-0002', _operationId: randomUUID(), estado: 'Apartado', anticipo: 16, saldo: 100, comision: 0, comisiones: [] };
const loan = { id: randomUUID(), folio: 'PR-260911-000', fecha: '2026-09-11 10:00', fechaEsperada: '2026-09-12',
  estado: 'pendiente', _loanVersion: 2, persona: { tipo: 'cliente', nombre: 'Cliente' },
  lineas: [{ ...sourceLine, key: p1.sku + '|' + talla, qty: 2, devueltas: 0 }], devoluciones: [] };
const base = { products: [p1,p2,p3], sellers: [
  { id: 'h164-admin', nombre: 'Admin', role: 'admin', active: true, _syncVersion: 1 },
  { id: 'h164-seller', nombre: 'Vendedor', role: 'vendedor', active: true, comisionPct: 5, commissionPolicyVersion: 0,
    ventasMes: 100, ventasNum: 1, comisionAcum: 5, _syncVersion: 2 }],
  clients: [{ id: 'h164-client', nombre: 'Cliente', tel: '555', total: 116, compras: 1, generic: false, _syncVersion: 1 }],
  sales: [existingSale,layaway], movements: [], promotions: [{ id: 'h164-promo', nombre: 'Promo', tipo: 'pct', valor: 5, pausado: true, scope: {}, _syncVersion: 1 }],
  liquidations: [], returns: [], payments: [], exchanges: [], loans: [loan], commissionAdjustments: [],
  commissionContext: {periodStart:'',sellerBases:[{sellerId:'h164-admin',baseRaw:0},{sellerId:'h164-seller',baseRaw:100}]} };
const reset = extra => { pending = null; offline = false; D.replaceFromOnline({ ...JSON.parse(JSON.stringify(base)), ...extra }); };
let passed = 0;
const selectedCases = process.argv.slice(2);
const selected = name => !selectedCases.length || selectedCases.includes(name);
const paymentIds = { 'abono apartado': randomUUID(), 'liquidación apartado': randomUUID() };
const pass = name => { passed++; console.log('PASS ' + name); };
async function submitOnce(name, invoke, requestName, applyAuthority) {
  const before = JSON.stringify(snapshot());
  let settled = false;
  const result = Promise.resolve().then(invoke).then(value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  for (let i = 0; i < 30 && !pending && !settled; i++) await Promise.resolve();
  assert.ok(pending, `${name}: command reached gateway`);
  assert.equal(pending.name, requestName, name);
  assert.equal(settled, false, `${name}: no result before ACK`);
  assert.equal(JSON.stringify(snapshot()), before, `${name}: no optimistic effects`);
  const request = pending; pending = null;
  if (paymentIds[name]) {
    const [saleDraft, effects] = request.args;
    const payment = effects.payment || effects.payments.at(-1);
    assert.equal(effects.commitId, paymentIds[name], 'request identity is stable for this payment');
    assert.notEqual(effects.commitId, saleDraft._operationId, 'payment request does not reuse original sale identity');
    assert.equal(payment.id, 'pay-' + paymentIds[name], 'payment row has the same stable identity');
    if (name === 'abono apartado') {
      assert.equal(effects.mode, 'payment');
      assert.equal(effects.expectedSale.saldo, 100);
      assert.equal(effects.expectedSale.anticipo, 16);
      assert.equal(effects.expectedSale.operationId, layaway._operationId);
    }
  }
  if (applyAuthority) {
    const response = applyAuthority(request.args);
    request.resolve(response || { ok: true });
  } else request.reject(Object.assign(new Error('Server rejected command'), { code: 'H164_REJECTED' }));
  const answer = await result;
  if (applyAuthority) assert.ifError(answer.error);
  else { assert.equal(answer.error?.code, 'H164_REJECTED', name); assert.equal(JSON.stringify(snapshot()), before, `${name}: rejection has no effects`); }
  pass(name);
  return answer.value;
}

if (selected('venta')) {
reset();
const operationId = randomUUID();
const sale = await submitOnce('venta: snapshot financial preserved, authority before success', () => D.recordSale({
  ticket: [{ p: D.products[0], talla, qty: 1 }], sellerIds: ['h164-seller'], client: D.clients[0],
  metodo: 'Efectivo', estado: 'Pagado', itemCount: 1, operationId,
}), 'pushSale', ([draft,effects]) => {
  assert.equal(draft.total,116); assert.equal(draft.subtotal,100); assert.equal(draft.iva,16);
  assert.equal(draft.comision,5); assert.equal(effects.payments.length,1);
  assert.equal(effects.productVersions[0].id,p1.id); assert.equal(effects.productVersions[0].baseVersion,3);
  assert.equal(effects.quoteContext.opaqueVersionField,'preserve-entire-context');
  const remote = snapshot();
  remote.products[0].stock[0].stock = 7;
  remote.sales.unshift({ ...draft, authoritativeMarker: 'server', _stockReserved: true });
  remote.payments = effects.payments;
  D.replaceFromOnline(remote);
  return { ok: true };
});
assert.equal(sale.authoritativeMarker,'server'); assert.equal(D.products[0].stock[0].stock,7);
}

const cases = [
  ['devolución', () => D.recordReturn({ folio: existingSale.folio, operationId: randomUUID(), lineas: [{ ...sourceLine, sourceSaleLineId: sourceLine.lineId, motivo: 'Talla' }], metodo: 'Efectivo' }), 'pushReturn'],
  ['cambio', () => D.recordExchange({ origenFolio: existingSale.folio, operationId: randomUUID(), vendedorId: 'h164-seller', metodoPago: 'Efectivo',
    lineas: [{ ...sourceLine, sourceSaleLineId: sourceLine.lineId, lado: 'devuelto', condicion: 'Bueno' }, { productId:p2.id, sku:p2.sku,nombre:p2.nombre,talla,qty:1,lado:'entregado' }] }), 'pushExchange'],
  ['abono apartado', () => D.registrarPagoApartado(layaway.folio,{monto:20,metodo:'Efectivo',operationId:paymentIds['abono apartado']}),'pushSale'],
  ['liquidación apartado', () => D.registrarPagoApartado(layaway.folio,{monto:100,metodo:'Efectivo',operationId:paymentIds['liquidación apartado']}),'settleLayaway'],
  ['liquidación comisión', () => D.liquidarComision('h164-seller'),'settleCommission'],
  ['cierre periodo', () => D.cerrarMes(),'closeCommissionPeriod'],
  ['ajuste comisión', () => D.applyCommissionAdjustment({operationId:randomUUID(),renglones:[{sellerId:'h164-seller',folio:existingSale.folio,comision:1}],porVendedor:[{sellerId:'h164-seller',comision:1,ventas:1}],totales:{comision:1}}),'applyCommissionAdjustment'],
  ['cliente alta', () => D.addClient({nombre:'Nuevo',tel:'999',email:'n@example.test'}),'pushRows'],
  ['cliente edición', () => D.updateClient('h164-client',{nombre:'Editado'}),'pushRows'],
  ['cliente baja', () => D.removeClient('h164-client'),'deleteRow'],
  ['personal alta', () => D.addUser({nombre:'Nuevo',role:'vendedor'}),'pushRows'],
  ['personal edición', () => D.updateUser('h164-seller',{nombre:'Editado'}),'pushRows'],
  ['personal baja', () => D.removeUser('h164-seller'),'deleteRow'],
  ['promoción alta', () => D.addPromo({nombre:'Nueva',tipo:'pct',valor:5}),'pushRows'],
  ['promoción edición', () => D.updatePromo('h164-promo',{nombre:'Editada'}),'pushRows'],
  ['promoción duplicación', () => D.duplicatePromo('h164-promo'),'pushRows'],
  ['promoción baja', () => D.removePromo('h164-promo'),'deleteRow'],
  ['préstamo alta', () => D.registrarPrestamo({fecha:'2026-09-11',fechaEsperada:'2026-09-12',persona:{tipo:'cliente',nombre:'Cliente'},lineas:[{productId:p2.id,talla,qty:1}]}),'pushLoanOperation'],
  ['préstamo devolución', () => D.registrarDevolucionPrestamo(loan.id,{fecha:'2026-09-11',lineas:[{key:loan.lineas[0].key,qty:1}]}),'pushLoanOperation'],
  ['préstamo faltante', () => D.marcarPrestamoNoDevuelto(loan.id,{fecha:'2026-09-11',nota:'Faltante'}),'pushLoanOperation'],
  ['préstamo edición', () => D.actualizarPrestamo(loan.id,{nota:'Editado'}),'pushLoanOperation'],
  ['préstamo baja', () => D.eliminarPrestamo(loan.id),'pushLoanOperation'],
  ['producto escritura', () => D.saveProductRows([{...D.products[2],nombre:'Editado'}]),'pushRows'],
  ['producto baja', () => D.removeProductScope({scope:'reference',productIds:[p3.id]}),'deleteProductScope'],
];
for (const [name,fn,request] of cases) { if (selected(name)) { reset(); await submitOnce(name,fn,request); } }

if (selected('cambio cotización obsoleta')) {
  reset();
  const remote = snapshot(); remote.products[1]._syncVersion = 4; remote.products[1].precio = 348;
  D.replaceFromOnline(remote);
  const before = JSON.stringify(snapshot());
  const answer = await D.recordExchange({ origenFolio: existingSale.folio, operationId: randomUUID(), vendedorId: 'h164-seller', metodoPago:'Efectivo',
    lineas:[{...sourceLine,sourceSaleLineId:sourceLine.lineId,lado:'devuelto',condicion:'Bueno'},
      {productId:p2.id,expectedProductVersion:3,sku:p2.sku,nombre:p2.nombre,talla,qty:1,lado:'entregado'}] });
  assert.equal(answer.ok,false); assert.equal(answer.code,'ONLINE_PRODUCT_CHANGED');
  assert.equal(pending,null); assert.equal(JSON.stringify(snapshot()),before);
  pass('cambio cotización obsoleta: no repricing, request, or local effect');
}

if (selected('comisión remota con histórico restringido')) {
  reset({returns:[],commissionContext:{periodStart:'',sellerBases:[{sellerId:'h164-admin',baseRaw:0},{sellerId:'h164-seller',baseRaw:25}]}});
  assert.equal(D.sellerPeriodBase('h164-seller'),25,'Server base includes historical documents hidden by RLS');
  assert.equal(D.sellerPeriodBase('h164-seller',existingSale.folio),0,'Subtract visible excluded sale before clamping');
  const before=JSON.stringify(snapshot()), incomplete=snapshot(); delete incomplete.commissionContext;
  assert.throws(()=>D.replaceFromOnline(incomplete),{code:'ONLINE_COMMISSION_CONTEXT_INCOMPLETE'});
  assert.equal(JSON.stringify(snapshot()),before);
  pass('comisión remota con histórico restringido: authoritative base and atomic context validation');
}

if (selected('identidad remota incompleta')) {
  reset(); const before=JSON.stringify(snapshot()), malformed=snapshot();
  malformed.products[0].recordModel='v2'; delete malformed.products[0].referenceFamilyId;
  assert.throws(()=>D.replaceFromOnline(malformed),{code:'ONLINE_PRODUCT_IDENTITY_INCOMPLETE'});
  assert.equal(JSON.stringify(snapshot()),before);
  pass('identidad remota incompleta: no invented family or partial projection');
}

if (selected('promoción reloj servidor')) {
  context.React={createElement:()=>null}; window.UI={fmt:String,toast:()=>{}}; window.HX={};
  const RealDate=Date;
  context.Date=class extends RealDate {constructor(...args){super(...(args.length?args:['2040-01-01T00:00:00Z']));}static now(){return RealDate.parse('2040-01-01T00:00:00Z');}};
  vm.runInContext(fs.readFileSync('balam/discounts.jsx','utf8'),context,{filename:'discounts.jsx'});
  assert.equal(window.PROMOS.estado({inicio:'2026-09-11',horaInicio:'11:00',fin:'2026-09-11',horaFin:'13:00'}),'Activo');
  context.Date=RealDate;
  pass('promoción reloj servidor: current window ignores wrong device clock');
}

if (!selectedCases.length) {
reset(); offline = true;
const beforeOffline = JSON.stringify(snapshot());
await assert.rejects(() => D.saveProductRows([{...D.products[2],nombre:'Offline'}]),{code:'ONLINE_OFFLINE'});
assert.equal(pending,null); assert.equal(JSON.stringify(snapshot()),beforeOffline); pass('sin Internet: no request, no mutation, no pending');

reset(); const beforeDetached = JSON.stringify(snapshot());
D.products[0].stock[0].stock=0; D.clients.push({id:'phantom'}); D.sellers[1].comisionAcum=0;
assert.equal(JSON.stringify(snapshot()),beforeDetached); pass('public arrays detached from authoritative projection');

const beforeIncomplete = JSON.stringify(snapshot());
assert.throws(() => D.replaceFromOnline({products:[]}), /ONLINE_SNAPSHOT_INCOMPLETE/);
assert.equal(JSON.stringify(snapshot()),beforeIncomplete); pass('incomplete remote snapshot applies nothing');
assert.equal(storageCalls,0); pass('commercial localStorage access zero');
for (const name of ['saveProducts','saveClients','persistProducts','applySaleCommitResult','seedDemo','resetTestData','reverseExchangeCommission','reverseSaleCommission']) assert.equal(D[name],undefined,name+' retired');
pass('retired persistence/replay APIs have no fallback');
}
console.log(JSON.stringify({suite:'H164 DATA online boundary',passed,failed:0,realSupabase:false,storageCalls}));
