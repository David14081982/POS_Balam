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

C.load(C.prepareMutation('reset', []).state);
const family=randomUUID();
const make=(size,stock=4)=>D.createReference({id:randomUUID(),referenceFamilyId:family,nombre:'H166',modelo:'H166',cat:'21',manga:'ML',tela:'ALG',color:'BL',cuello:'NOR',orn:'—',ornamentColorCodes:[],precio:116,costo:40,stockQuantity:stock,sizeCode:size,sizeScale:'N',sizeCategoryId:'size_number',attrs:{__sizeCategoryId:'size_number'}},[]);
let source={...Object.fromEntries(keys.map(k=>[k,[]])),commissionContext:{periodStart:'',sellerBases:[]}};
source.products=[make('40'),make('42')];
D.replaceFromOnline(source);
let count=0;
function projection(label, expectedStock, changed=true){
 const before=D.commercialProjectionCalculations;
 const result=D.commercialProducts();
 assert.equal(result.reduce((n,p)=>n+p.totalStock,0),expectedStock,label);
 for(let i=0;i<8;i++)assert.equal(D.commercialProducts(),result,'all consumers share exact result');
 if(result.length){assert.equal(D.referenceFamilyProjection(family),result[0]);assert.equal(D.referenceFamily(result[0].references[0]).length,result[0].referenceCount);}
 assert.equal(D.commercialProjectionCalculations-before,changed?1:0,label+' calculations');
 count++;console.log('PASS '+label);return result;
}
const initial=projection('initial confirmed family',8);
const revision=D.commercialProjectionRevision;
C.load(C.snapshot());D.replaceFromOnline(source);
assert.equal(D.commercialProjectionRevision,revision);assert.equal(projection('unchanged CONFIG and products',8,false),initial);
source.clients=[{id:'client',nombre:'H166'}];D.replaceFromOnline(source);
assert.equal(projection('unrelated client snapshot',8,false),initial);
source.products.push({...make('44'),barcodeCode:D.barcodeFromId?.(randomUUID())||'different'});D.replaceFromOnline(source);projection('product created',12);
source.products[0].nombre='Edited';D.replaceFromOnline(source);assert.notEqual(projection('product edited',12)[0].nombre,'H166');
source.products.splice(2,1);D.replaceFromOnline(source);projection('product deleted',8);
source.products[0].stockQuantity=9;D.replaceFromOnline(source);projection('remote stock changed',13);
const config=C.snapshot();config.settings['stock.lowThreshold']=99;C.load(config);projection('CONFIG changed',13);
const logo=C.snapshot();logo.settings['store.logo']='data:image/png;base64,fixture';C.load(logo);projection('logo revision invalidates derived projection',13);
source.products.forEach(p=>p.stockQuantity=0);D.replaceFromOnline(source);projection('Point Zero confirmed stock',0);
source.products=[];D.replaceFromOnline(source);projection('remote empty catalogue',0);
source.products=[make('40',2)];D.replaceFromOnline(source);projection('remote new catalogue',2);
const detached=D.products;detached[0].stockQuantity=77;
assert.equal(D.commercialProducts()[0].totalStock,2,'draft does not mutate shared authority');
assert.equal(D.commercialProducts(detached)[0].totalStock,77,'draft projection cannot borrow confirmed revision');
assert.equal(storageCalls,0);
console.log(JSON.stringify({suite:'H166 revision contract',passed:count,stale:0,storageCalls}));
