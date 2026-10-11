// H-186: executable DATA contract; the gateway captures uncommitted drafts only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

let captured, productAdapter, promoAdapter;
const window = {crypto:{randomUUID},addEventListener(){},dispatchEvent(){},CORE:{
  getDeviceId:()=> 'h186-isolated',registerCatalogProducts:a=>productAdapter=a,
  registerCatalogPromotions:a=>promoAdapter=a,registerMonetaryDocuments(){},
  catalogProducts:()=>productAdapter?.list()||[],catalogPromotions:()=>promoAdapter?.list()||[],
  invokeSync(name,...args){
    if(name==='getQuoteContext')return {configVersion:7,opaque:'retained'};
    if(name==='serverNow')return new Date('2026-10-10T19:00:00Z');
    if(name==='assertBusinessReady')return true;
    if(name==='allocateFolio')return Promise.resolve({ok:true,folio:'H186-261010-0001'});
    captured={name,args};return Promise.reject(Object.assign(new Error('isolated gateway'),{code:'H186_CAPTURE'}));
  }
}};
const ctx=vm.createContext({window,console,setTimeout,clearTimeout,CustomEvent:class{},
  localStorage:new Proxy({},{get(){throw new Error('No commercial local storage');}})});
for(const file of ['config','data'])vm.runInContext(fs.readFileSync(`balam/${file}.jsx`,'utf8'),ctx);
const D=window.DATA,C=window.CONFIG;
C.load(C.prepareMutation('reset',[]).state);
const clean=x=>JSON.parse(JSON.stringify(x));
const talla=D.SIZES_LETRA[0];
const product=D.hydrate({id:randomUUID(),recordModel:'v1',cat:'21',modelo:'H186',nombre:'JOEL fixture',
  tela:'ALG',manga:'ML',color:'BL',cuello:'NOR',orn:'—',precio:1250,costo:563,
  sizeCategoryId:'size_letter',attrs:{__sizeCategoryId:'size_letter'},stock:[{talla,escala:'L',stock:20}],_syncVersion:1});
const base={products:[product],clients:[{id:'h186-client',nombre:'Fixture',generic:false,_syncVersion:1}],
  sellers:[],sales:[],payments:[],returns:[],exchanges:[],promotions:[],movements:[],loans:[],liquidations:[],commissionAdjustments:[],
  commissionContext:{periodStart:'',sellerBases:[]}};
const reset=extra=>{captured=null;D.replaceFromOnline({...clean(base),...extra});};
const line=(orig,unit,qty=1,key='a')=>({key,p:D.products[0],talla,qty,res:{orig,unit,promos:[]}});
const fixed=value=>({benefitType:'fixed',value,origin:'Otro',reason:'Fixture autorizado',scope:'ticket',combinable:true});
const cents=n=>Math.round(n*100);
let passed=0,failed=0;
async function test(name,fn){reset();try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message);}}
async function draft(ticket,options={}){
  const quote=D.saleQuote(ticket,options.apps||[]);
  await assert.rejects(D.recordSale({ticket,quote,sellerIds:[],client:D.clients[0],metodo:'Efectivo',estado:'Pagado',
    itemCount:ticket.reduce((n,l)=>n+l.qty,0),...options}),e=>e.code==='H186_CAPTURE');
  assert.equal(captured.name,'pushSale');return captured.args;
}

await test('JOEL amounts and included IVA',()=>{
  for(const [pct,total,subtotal,iva] of [[30,875,754.31,120.69],[50,625,538.79,86.21],[60,500,431.03,68.97],[100,0,0,0]]){
    const q=D.saleQuote([line(1250,total)],[]);
    assert.equal(q.financialVersion,2);assert.equal(q.originalTotal,1250);assert.equal(q.configuredDiscountTotal,1250-total);
    assert.equal(q.finalTotal,total);assert.equal(q.subtotal,subtotal);assert.equal(q.iva,iva);
  }
});
await test('decimal HALF UP agrees with numeric instead of floating point',()=>{
  assert.equal(D.moneyRound(1.005),1.01);assert.equal(D.moneyRatio(2.01,50,100),1.01);
  assert.equal(D.moneyRound(-1.005),-1.01);assert.throws(()=>D.moneyRound(NaN));
  const q=D.saleQuote([line(2.01,2.01)],[{...fixed(50),benefitType:'percentage'}]);
  assert.equal(q.additionalDiscountTotal,1.01);assert.equal(q.finalTotal,1);
});
await test('additional allocation cannot spend more than its budget',()=>{
  const q=D.saleQuote(['a','b','c','d'].map(key=>line(.01,.01,1,key)),[fixed(.02)]);
  assert.equal(q.additionalDiscountTotal,.02);assert.equal(q.finalTotal,.02);
  assert.deepEqual(clean(q.lines.map(l=>l.additionalDiscount)),[.01,.01,0,0]);
});
await test('multiple units retain every cent in persisted segments',async()=>{
  const [s,e]=await draft([line(.14,.14,3)],{apps:[fixed(.01)]});
  assert.equal(s.total,.41);assert.equal(s.financialVersion,2);assert.equal(s.originalTotal,.42);
  assert.equal(s.lineas.reduce((n,l)=>n+cents(l.precio)*l.qty,0),41);
  assert.deepEqual(clean(s.lineas.map(l=>[l.qty,l.precio])),[[2,.14],[1,.13]]);
  assert.equal(new Set(s.lineas.map(l=>l.lineId)).size,2);
  assert.equal(s.receiptSnapshot.lines.length,2);
  assert.equal(cents(s.lineas.reduce((n,l)=>n+l.descuentoAdicional,0)),1);
  assert.deepEqual(clean(s.financialRequest.inputs),[{key:'a',productId:product.id,talla,qty:3}]);
  assert.equal(e.payments[0].monto,.41);assert.equal(e.quoteContext.opaque,'retained');assert.equal(D.sales.length,0);
});
await test('additional residue is fully applied when final line has only one cent',()=>{
  const q=D.saleQuote(Array.from({length:10},(_,i)=>line(.01,.01,1,String(i))),[fixed(.04)]);
  assert.equal(q.additionalDiscountTotal,.04);assert.equal(q.finalTotal,.06);
  assert.equal(q.applications[0].discountAmount,.04);
  assert.deepEqual(clean(q.lines.map(l=>l.additionalDiscount)),[0,0,0,0,0,0,.01,.01,.01,.01]);
});
await test('100 percent produces no invented payments',async()=>{
  const [s,e]=await draft([line(1250,0)]);
  assert.equal(s.total,0);assert.equal(s.subtotal,0);assert.equal(s.iva,0);assert.equal(s.metodo,'Efectivo');
  assert.equal(s.descuento,1250);assert.equal(e.payments.length,0);assert.equal(s.valorRegalado,0);
});
await test('explicit courtesy keeps gift evidence and coherent zero tax',async()=>{
  const [s,e]=await draft([line(1250,875)],{metodo:'Cortesía'});
  assert.equal(s.total,0);assert.equal(s.subtotal,0);assert.equal(s.iva,0);assert.equal(s.valorRegalado,875);
  assert.equal(s.originalTotal,1250);assert.equal(s.financialRequest.courtesy,true);assert.equal(e.payments.length,0);
});
await test('new exchange recognized value is paid price; legacy unchanged',()=>{
  const l={lineId:randomUUID(),productId:product.id,sku:product.sku,talla,qty:1,precio:500,precioBase:875,precioOrig:1250};
  reset({sales:[{folio:'new',financialVersion:2,lineas:[l]},{folio:'old',lineas:[l]}]});
  assert.equal(D.recognizedValue('new',l.sku,talla,l.lineId),500);
  assert.equal(D.recognizedValue('old',l.sku,talla,l.lineId),875);
});
await test('malformed inputs cannot become valid monetary quote',()=>{
  for(const value of [NaN,Infinity,-1])assert.throws(()=>D.saleQuote([line(value,value)],[]));
  for(const qty of [0,-1,.5,NaN])assert.throws(()=>D.saleQuote([line(1,1,qty)],[]));
});
await test('fixed additional discounts reject fractional cents before checkout, matching SQL',()=>{
  const ticket=[line(1250,875)];
  for(const value of [1.005,1.004,.009]){
    assert.throws(()=>D.saleQuote(ticket,[fixed(value)]),/dos decimales/);
  }
  for(const value of [.01,1.01]){
    const q=D.saleQuote(ticket,[fixed(value)]);
    assert.equal(q.applications[0].value,value);
    assert.equal(q.additionalDiscountTotal,value);
    assert.equal(cents(q.finalTotal),87500-cents(value));
  }
  const percentage=D.saleQuote(ticket,[{...fixed(1.005),benefitType:'percentage'}]);
  assert.equal(percentage.additionalDiscountTotal,8.79,'SQL allows additional percentage precision beyond two decimals');
});
await test('partial returns refund exact segment price and consume exact identity',async()=>{
  const [s,e]=await draft([line(.14,.14,3)],{apps:[fixed(.01)]});
  const original=clean(s);
  reset({sales:[s],payments:clean(e.payments)});
  const last=s.lineas[1];
  await assert.rejects(D.recordReturn({folio:s.folio,lineas:[{...last,sourceSaleLineId:last.lineId,qty:1}],metodo:'Efectivo'}),x=>x.code==='H186_CAPTURE');
  assert.equal(captured.name,'pushReturn');assert.equal(captured.args[0].total,.13);
  assert.equal(captured.args[0].lineas[0].sourceSaleLineId,last.lineId);
  assert.deepEqual(clean(D.sales[0]),original,'rejected fixture gateway cannot mutate source');
});
await test('zero-priced return restores quantity without refund components',async()=>{
  const [s]=await draft([line(1250,0)]);
  reset({sales:[s]});const l=s.lineas[0];
  await assert.rejects(D.recordReturn({folio:s.folio,lineas:[{...l,sourceSaleLineId:l.lineId,qty:1}]}),x=>x.code==='H186_CAPTURE');
  assert.equal(captured.name,'pushReturn');assert.equal(captured.args[0].total,0);
  assert.deepEqual(clean(captured.args[0].components),[]);
});
await test('return after exchanging another piece never refunds that piece twice',async()=>{
  const [s,e]=await draft([line(.14,.14,3)],{apps:[fixed(.01)]});
  const a=s.lineas[0],b=s.lineas[1];
  reset({sales:[s],payments:clean(e.payments),exchanges:[{id:'fixture-cambio',origenFolio:s.folio,
    lineas:[{...a,sourceSaleLineId:a.lineId,lado:'devuelto',qty:2}]}]});
  await assert.rejects(D.recordReturn({folio:s.folio,lineas:[{...b,sourceSaleLineId:b.lineId,qty:1}],metodo:'Efectivo'}),x=>x.code==='H186_CAPTURE');
  assert.equal(captured.args[0].total,.13,'only the remaining paid piece is refundable');
});

// Exercise the real return/exchange preparation. Only the intercepted gateway
// receipts are projected into this private fixture; no STORE or network exists.
function commissionScenario({version=2,high=874.67,low=874.66,amount=226.21,commissionBase=2262.07,zeroLine=false}={}){
  const sellerId=randomUUID(),exchangeSellerId=randomUUID();
  const target=D.hydrate({...clean(product),id:randomUUID(),sku:'QA-COMMISSION-TARGET',modelo:'QA-TARGET',precio:1250});
  const sourceLine=(qty,precio)=>({lineId:randomUUID(),productId:product.id,sku:product.sku,nombre:product.nombre,
    talla,qty,precio,precioBase:precio,precioOrig:1250});
  const sale={folio:'QA-COMMISSION',fecha:'2026-10-10 12:00',estado:'Pagado',financialVersion:version,
    metodo:'Efectivo',cliente:'',total:(cents(high)*2+cents(low))/100,subtotal:commissionBase,
    iva:(cents(high)*2+cents(low)-cents(commissionBase))/100,vendedores:[sellerId],
    comision:amount,comisionBase:'neto',comisiones:[{sellerId,base:commissionBase,monto:amount,pct:10,source:'fixture',policyVersion:1}],
    lineas:[sourceLine(2,high),sourceLine(1,low),...(zeroLine?[sourceLine(1,0)]:[])]};
  const sellers=[{id:sellerId,nombre:'Original',role:'vendedor',active:true,comisionAcum:amount,ventasMes:sale.total,ventasNum:1,_syncVersion:1},
    {id:exchangeSellerId,nombre:'Cambio',role:'vendedor',active:true,commissionOverridePct:10,commissionPolicyVersion:1,
      comisionAcum:0,ventasMes:0,ventasNum:0,_syncVersion:1}];
  const returns=[],exchanges=[];
  const config=C.snapshot();config.settings['returns.reverseCommission']=true;config.settings['commission.base']='neto';C.load(config);
  const project=()=>reset({products:[clean(product),clean(target)],sales:[clean(sale)],sellers:clean(sellers),returns:clean(returns),exchanges:clean(exchanges),
    commissionContext:{periodStart:'',sellerBases:sellers.map(row=>({sellerId:row.id,baseRaw:0}))}});
  const applyEffects=effects=>effects.forEach(effect=>{const seller=sellers.find(row=>row.id===effect.id);assert.ok(seller);
    seller.comisionAcum=effect.after_comision_acum;if(effect.after_ventas_mes!=null)seller.ventasMes=effect.after_ventas_mes;seller._syncVersion++;});
  return {sale,sellers,returns,exchanges,
    async refund(selection){
      project();const lineas=selection.map(([index,qty])=>({...sale.lineas[index],sourceSaleLineId:sale.lineas[index].lineId,qty}));
      await assert.rejects(D.recordReturn({folio:sale.folio,lineas,metodo:'Efectivo'}),e=>e.code==='H186_CAPTURE');
      assert.equal(captured.name,'pushReturn');const [ret,effects]=clean(captured.args);
      returns.push(ret);applyEffects(effects.sellerEffects);sale.estado='Devolución parcial';return {ret,effects};
    },
    async exchange(){
      project();const source=sale.lineas[1];
      await assert.rejects(D.recordExchange({origenFolio:sale.folio,vendedorId:exchangeSellerId,metodoPago:'Efectivo',lineas:[
        {...source,sourceSaleLineId:source.lineId,lado:'devuelto',qty:1},
        {productId:target.id,expectedProductVersion:target._syncVersion,sku:target.sku,nombre:target.nombre,talla,lado:'entregado',qty:1}
      ]}),e=>e.code==='H186_CAPTURE');
      assert.equal(captured.name,'pushExchange');const [exchange,effects]=clean(captured.args);
      assert.ok(effects.sellerEffects.every(row=>row.id===exchangeSellerId),'exchange cannot reverse original commission');
      exchanges.push(exchange);applyEffects(effects.sellerEffects);return {exchange,effects};
    }
  };
}
await test('V2 split return/exchange/return preserves commission on the exchanged value',async()=>{
  const scenario=commissionScenario();
  const first=await scenario.refund([[0,1]]);assert.equal(first.ret.total,874.67);assert.equal(first.ret.comisiones[0].monto,75.4);
  const change=await scenario.exchange();assert.equal(change.exchange.valorReconocido,874.66);
  assert.equal(change.exchange.diferencia,375.34);assert.equal(change.exchange.comisionMonto,32.36);
  const last=await scenario.refund([[0,1]]);assert.equal(last.ret.total,874.67);assert.equal(last.ret.comisiones[0].monto,75.4);
  assert.equal(last.ret.comisiones[0].base,754.03);assert.equal(scenario.sellers[0].comisionAcum,75.41);
  assert.equal(scenario.sellers[1].comisionAcum,32.36);
});
await test('V2 one-cent commission survives two tiny refunds and an exchange',async()=>{
  const scenario=commissionScenario({high:.01,low:.01,amount:.01,commissionBase:.03});
  assert.equal((await scenario.refund([[0,1]])).ret.comisiones[0].monto,0);
  await scenario.exchange();assert.equal((await scenario.refund([[0,1]])).ret.comisiones[0].monto,0);
  assert.equal(scenario.sellers[0].comisionAcum,.01);
});
await test('V2 total refund without an exchange closes the frozen commission exactly',async()=>{
  const scenario=commissionScenario();await scenario.refund([[0,1]]);
  const last=await scenario.refund([[0,1],[1,1]]);
  assert.equal(last.ret.total,1749.33);assert.equal(last.ret.comisiones[0].monto,150.81);
  assert.equal(last.ret.comisiones[0].base,1508.04);assert.equal(scenario.sellers[0].comisionAcum,0);
});
await test('V2 monetary completion closes a cent before a remaining zero-priced piece',async()=>{
  const scenario=commissionScenario({high:.01,low:.01,amount:.01,commissionBase:.03,zeroLine:true});
  await scenario.refund([[0,1]]);await scenario.refund([[0,1]]);
  const lastPaid=await scenario.refund([[1,1]]);assert.equal(lastPaid.ret.total,.01);assert.equal(lastPaid.ret.comisiones[0].monto,.01);
  const zero=await scenario.refund([[2,1]]);assert.equal(zero.ret.total,0);assert.deepEqual(zero.ret.components,[]);
  assert.deepEqual(zero.ret.comisiones,[]);assert.deepEqual(zero.effects.sellerEffects,[]);assert.equal(scenario.sellers[0].comisionAcum,0);
});
await test('legacy return/exchange/return retains its historical refund and commission rule',async()=>{
  const scenario=commissionScenario({version:1});await scenario.refund([[0,1]]);await scenario.exchange();
  const last=await scenario.refund([[0,1]]);assert.equal(last.ret.total,1749.33);
  assert.equal(last.ret.comisiones[0].monto,150.81);assert.equal(scenario.sellers[0].comisionAcum,0);
});
await test('V2 proportional commission rounds half cents exactly and closes the remainder',async()=>{
  const scenario=commissionScenario({high:10.05,low:0,amount:2.01,commissionBase:17.33});
  const first=await scenario.refund([[0,1]]);
  assert.equal(first.ret.total,10.05);assert.equal(first.ret.comisiones[0].monto,1.01);assert.equal(first.ret.comisiones[0].base,8.67);
  const last=await scenario.refund([[0,1],[1,1]]);
  assert.equal(last.ret.comisiones[0].monto,1);assert.equal(last.ret.comisiones[0].base,8.66);
  assert.equal(scenario.sellers[0].comisionAcum,0);
});
await test('legacy proportional half-cent rounding remains unchanged',async()=>{
  const scenario=commissionScenario({version:1,high:10.05,low:0,amount:2.01,commissionBase:17.33});
  assert.equal((await scenario.refund([[0,1]])).ret.comisiones[0].monto,1);
  assert.equal((await scenario.refund([[0,1],[1,1]])).ret.comisiones[0].monto,1.01);
  assert.equal(scenario.sellers[0].comisionAcum,0);
});
console.log(JSON.stringify({passed,failed,remoteWrites:0}));
process.exitCode=failed?1:0;
