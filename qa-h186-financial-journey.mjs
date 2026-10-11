// H186 LIVE extension. This module never provisions, connects or cleans up itself.
// The H171 caller owns exact identities, the durable mutation journal, baseline,
// canonical backup and verified cleanup. All commercial fixtures are new rows.
import assert from 'node:assert/strict';
import {writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {installPrintTransport} from './test-print-transport.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const cents=value=>Math.round(Number(value)*100);

// Passive, local-only diagnosis. Successful snapshot bodies and all request
// bodies/headers are never read. Only fixed messages and SQLSTATE tokens leave
// the error response; arbitrary PostgreSQL details remain private to transport.
export function installFinancialSnapshotTelemetry(terminals,file){
  const pending=new Set(),listeners=[],requests=new WeakMap();let sequence=0,writeFailed=false,closed=false;
  const append=row=>{try{appendFileSync(file,JSON.stringify(row)+'\n');}catch{writeFailed=true;}};
  append({event:'installed',at:new Date().toISOString(),terminals:terminals.map(t=>t.name)});
  const row=(state,event,extra={})=>({event,terminal:state.terminal,rpc:state.rpc,sequence:state.sequence,
    startedAt:state.startedAt,endedAt:event==='request'?null:new Date().toISOString(),
    durationMs:Math.max(0,Math.round((performance.now()-state.started)*100)/100),...extra});
  const identify=request=>{try{const match=new URL(request.url()).pathname.match(/^\/rest\/v1\/rpc\/(online_snapshot_if_changed|online_snapshot)$/);
    return match?match[1]:null;}catch{return null;}};
  const safeError=body=>{
    const code=typeof body?.code==='string'&&/^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(body.code)?body.code:null;
    const message=body?.message;
    const allowed=new Map([['canceling statement due to statement timeout','STATEMENT_TIMEOUT'],
      ['canceling statement due to user request','STATEMENT_CANCELLED']]);
    return {code,errorClass:code==='57014'&&allowed.has(message)?allowed.get(message):'REDACTED',
      message:code==='57014'&&allowed.has(message)?message:'REDACTED'};
  };
  for(const terminal of terminals){
    assert.ok(['A','B','C'].includes(terminal.name),'H186_TELEMETRY_TERMINAL');
    const page=terminal.page;
    const onRequest=request=>{const rpc=identify(request);if(!rpc)return;
      const state={terminal:terminal.name,rpc,sequence:++sequence,startedAt:new Date().toISOString(),started:performance.now()};
      requests.set(request,state);append(row(state,'request'));};
    const onResponse=response=>{const state=requests.get(response.request());if(!state)return;
      state.status=response.status();append(row(state,'response',{httpStatus:state.status}));
      if(state.status<400)return;
      let timer;
      const task=(async()=>{try{
        const body=await Promise.race([response.json(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),1500);})]);
        append(row(state,'error',{httpStatus:state.status,...safeError(body)}));
      }catch{append(row(state,'error',{httpStatus:state.status,code:null,errorClass:'BODY_UNAVAILABLE',message:'REDACTED'}));}
      finally{clearTimeout(timer);}})();
      pending.add(task);void task.finally(()=>pending.delete(task));
    };
    const onFinished=request=>{const state=requests.get(request);if(state)append(row(state,'finished',{httpStatus:state.status??null}));};
    const onFailed=request=>{const state=requests.get(request);if(state)append(row(state,'failed',
      {httpStatus:state.status??null,code:null,errorClass:'NETWORK_FAILED',message:'REDACTED'}));};
    for(const [event,handler]of [['request',onRequest],['response',onResponse],['requestfinished',onFinished],['requestfailed',onFailed]]){
      page.on(event,handler);listeners.push([page,event,handler]);}
  }
  return {async close(){if(closed)return;closed=true;
    for(const [page,event,handler]of listeners)page.off(event,handler);
    await Promise.allSettled([...pending]);append({event:'closed',at:new Date().toISOString(),requests:sequence});
    assert.equal(writeFailed,false,'H186_SNAPSHOT_TELEMETRY_WRITE_FAILED');}};
}

export const FINANCIAL_CASES=Object.freeze([
  {name:'pct30',product:0,total:875,subtotal:754.31,iva:120.69,original:1250,ui:true},
  {name:'pct60',product:1,total:500,subtotal:431.03,iva:68.97,original:1250,ui:true},
  {name:'pct100',product:2,total:0,subtotal:0,iva:0,original:1250,ui:true},
  {name:'fixed50',product:3,total:1200,subtotal:1034.48,iva:165.52,original:1250},
  {name:'stack20plus30plus50',product:4,total:575,subtotal:495.69,iva:79.31,original:1250},
  {name:'additional100',product:5,additional:100,total:775,subtotal:668.10,iva:106.90,original:1250},
  {name:'splitQty3Additional1',product:6,qty:3,additional:1,total:2624,subtotal:2262.07,iva:361.93,original:3750},
]);

// Independent integer arithmetic for the LIVE oracle; it never calls DATA's
// rounding or reversal helpers. Inputs are confirmed monetary snapshots.
const ratioCents=(amount,numerator,denominator)=>{
  const product=BigInt(amount)*BigInt(numerator),divisor=BigInt(denominator);
  assert.ok(divisor>0n);return Number((product*2n+divisor)/(divisor*2n));
};
export function expectedReturnCommissionRows(sale,previousReturns,refund){
  assert.equal(Number(sale.financial_version??sale.financialVersion),2);
  if(cents(refund)===0)return [];
  const total=cents(sale.total),closed=previousReturns.reduce((sum,row)=>sum+cents(row.total),cents(refund))===total;
  return (sale.comisiones||[]).map(entry=>{
    const previous=previousReturns.flatMap(row=>row.comisiones||[]).filter(row=>row.sellerId===entry.sellerId);
    const remaining=field=>Math.max(0,cents(entry[field])-previous.reduce((sum,row)=>sum+cents(row[field]),0));
    const reversal=field=>(closed?remaining(field):Math.min(remaining(field),ratioCents(cents(entry[field]),cents(refund),total)))/100;
    return {sellerId:entry.sellerId,base:reversal('base'),monto:reversal('monto')};
  });
}
export function assertReturnCommissionRows(actual,expected){
  const rows=value=>(value||[]).map(row=>({sellerId:row.sellerId,base:cents(row.base),monto:cents(row.monto)}))
    .sort((a,b)=>a.sellerId.localeCompare(b.sellerId));
  assert.deepEqual(rows(actual),rows(expected),'H186_RETURN_COMMISSION_SNAPSHOT_MISMATCH');
}
export function assertCommissionBalances(before,after,deltas){
  assert.deepEqual(after.map(row=>row.id).sort(),before.map(row=>row.id).sort(),'H186_COMMISSION_SELLER_IDENTITIES');
  for(const row of before){const actual=after.find(next=>next.id===row.id),delta=deltas.filter(item=>item.sellerId===row.id)
    .reduce((sum,item)=>sum+cents(item.amount),0);
    assert.equal(cents(actual.comision_acum),Math.max(0,cents(row.comision_acum)+delta),'H186_COMMISSION_SELLER_DELTA');}
}

// Do not weaken the snapshot schema guard. Declare only this reviewed migration;
// buildLiveSnapshotSql still compares every column and type to the real database.
export function financialSnapshotCatalog(historical){
  const catalog=structuredClone(historical),sales=catalog.find(row=>row.table==='sales');
  assert.ok(sales,'H186_SALES_CATALOG_REQUIRED');
  for(const column of [{name:'financial_version',type:'smallint',not_null:false},
    {name:'financial_request',type:'jsonb',not_null:false},
    {name:'original_total',type:'numeric(12,2)',not_null:false}]){
    const existing=sales.columns.find(row=>row.name===column.name);
    if(existing)assert.deepEqual(existing,column,'H186_FINANCIAL_COLUMN_DRIFT');
    else sales.columns.push(column);
  }
  sales.columns.sort((a,b)=>a.name.localeCompare(b.name));
  const runtime=catalog.find(row=>row.table==='online_runtime');
  if(runtime){const column={name:'min_financial_version',type:'smallint',not_null:true};
    const existing=runtime.columns.find(row=>row.name===column.name);
    if(existing)assert.deepEqual(existing,column,'H186_MIN_FINANCIAL_COLUMN_DRIFT');else runtime.columns.push(column);
    runtime.columns.sort((a,b)=>a.name.localeCompare(b.name));}
  return catalog;
}

// Read every current physical reference, including zero stock. The catalog is
// never sold, edited or reserved: quote_sale is a read-only SQL authority.
export async function runFinancialCatalogAudit(page){
  return page.evaluate(async()=>{
    const D=window.DATA,P=window.PROMOS,products=D.products.slice(),promos=D.promos.slice();
    const fail=(message,details)=>{throw Error('H186_CATALOG_'+message+':'+JSON.stringify(details));};
    const equal=(actual,expected,context)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))fail('MISMATCH',{context,actual,expected});};
    const numbers=(row,fields)=>fields.map(key=>Number(row[key]));
    const identities=products.map(p=>{
      const size=p.sizeCode||(D.resolveProductSizes(p).sizes.find(s=>s.active)||{}).value;
      if(size==null)fail('SIZE_UNRESOLVED',{productId:p.id});return {p,size:String(size)};
    });
    const scopes=promos.map(promo=>{P.validate(promo);const included=identities.filter(({p,size})=>P.match(promo,p,size)).length;
      return {id:promo.id,state:P.estado(promo),type:promo.tipo,value:Number(promo.valor),included,excluded:products.length-included};});
    const inputs=[];
    for(const {p,size}of identities)for(const qty of [1,2,3])inputs.push({key:p.id+':'+qty,p,talla:size,qty,res:D.resolveLineDiscount(p,size)});
    const client=await window.STORE.ensureClient(),batches=[];
    const lineNumbers=['qty','originalTotal','configuredTotal','remaining','additionalDiscount','finalUnit'];
    for(let offset=0;offset<inputs.length;offset+=100){
      const ticket=inputs.slice(offset,offset+100),expected=D.saleQuote(ticket,[]);
      const response=await client.schema('pos').rpc('quote_sale',{p_inputs:ticket.map(l=>({key:l.key,productId:l.p.id,talla:l.talla,qty:l.qty})),p_applications:[],p_courtesy:false});
      if(response.error)fail('RPC_ERROR',{offset,message:response.error.message});const actual=response.data;
      equal(numbers(actual,['originalTotal','configuredDiscountTotal','beforeAdditionalTotal','additionalDiscountTotal','finalTotal','subtotal','iva']),
        numbers(expected,['originalTotal','configuredDiscountTotal','beforeAdditionalTotal','additionalDiscountTotal','finalTotal','subtotal','iva']),{offset,scope:'header'});
      equal(actual.lines.length,expected.lines.length,{offset,scope:'lineCount'});
      for(let index=0;index<expected.lines.length;index++){
        const a=actual.lines[index],e=expected.lines[index],context={productId:ticket[index].p.id,qty:ticket[index].qty};
        equal(a.key,e.key,context);equal(numbers(a,lineNumbers),numbers(e,lineNumbers),context);
        equal(numbers(a.res,['orig','unit']),numbers(e.res,['orig','unit']),context);
        equal(a.res.promos.map(p=>p.id).sort(),e.res.promos.map(p=>p.id).sort(),{...context,scope:'promotionIds'});
        equal(a.parts.map(p=>numbers(p,['qty','unit','additionalDiscount'])),e.parts.map(p=>numbers(p,['qty','unit','additionalDiscount'])),{...context,scope:'exactParts'});
      }
      batches.push({offset,count:ticket.length,total:actual.finalTotal,subtotal:actual.subtotal,iva:actual.iva});
    }
    return {referencesAudited:products.length,referencesTotal:products.length,promotionsAudited:promos.length,promotionsTotal:promos.length,
      activePromotions:scopes.filter(p=>p.state==='Activo').length,stockZeroReferences:identities.filter(({p,size})=>D.stockOf(p,size)===0).length,
      quantities:[1,2,3],scenariosAudited:inputs.length,scenariosTotal:products.length*3,scopes,batches,mismatches:0,
      sales:0,stockMutations:0,reservations:0,settingsMutations:0,method:'Current DATA/PROMOS plus real SQL quote_sale, read-only chunks of 100'};
  });
}

// Admission may change between confirmed commands. Waiting never dispatches
// an action; once dispatched, any error propagates without replay or retry.
export async function financialMutation(terminal,ready,action){
  await ready(terminal);
  return action();
}

async function seed(page,ids,prefix){
  return page.evaluate(async({ids,prefix})=>{
    const D=window.DATA,C=window.CONFIG,P=window.PROMOS,own=new Set(ids);
    if(ids.length!==9||ids.some(id=>D.products.some(p=>p.id===id)))throw Error('H186_NEW_PRODUCT_IDENTITIES_REQUIRED');
    const first=kind=>{const item=C.list(kind)[0];if(!item)throw Error('H186_ACTIVE_CATALOG_REQUIRED:'+kind);return item.code;};
    const category=C.sizeCategories().find(item=>item.scale&&C.list(item.id).length);
    if(!category)throw Error('H186_ACTIVE_SIZE_REQUIRED');
    const size=first(category.id),meta=C.allCatalogMeta(),modelKind=C.modeloKind();
    const base={cat:first('category'),manga:first('sleeve'),tela:first('fabric'),color:first('color'),cuello:first('neck'),orn:first('ornament'),
      sizeCategoryId:category.id,sizeScale:category.scale,sizeCode:size,attrs:{__sizeCategoryId:category.id},ornamentColorCodes:[]};
    for(const[kind,definition]of Object.entries(meta))if(definition.custom&&definition.required&&kind!==modelKind)base.attrs[kind]=first(kind);
    if(D.ornamentColorMode(base)==='required')base.ornamentColorCodes=[first('ornament_color')];
    // Try existing categories without altering their settings or any active promo.
    // An unavoidable existing global promotion aborts this scenario before writes.
    const free=C.list('category').find(row=>!P.active().some(promo=>P.match(promo,{...base,cat:row.code,modelo:prefix+'-H186-0'},size)));
    if(!free)throw Error('H186_NO_ISOLATED_EXISTING_CATEGORY');base.cat=free.code;
    const prepared=ids.map((id,index)=>D.createReference({...base,id,referenceFamilyId:id,
      modelo:prefix+'-H186-'+index,nombre:prefix+' JOEL '+index,precio:1250,costo:563,
      stockQuantity:index===8?1:20,imagen:null,barcodeAliases:[],physicalIdentityLocked:false,_syncVersion:0,_deletedAt:null},D.products));
    for(const p of prepared){
      if(D.products.some(old=>String(old.modelo)===String(p.modelo)))throw Error('H186_MODEL_COLLISION');
      if(P.active().some(promo=>P.match(promo,p,p.sizeCode)))throw Error('H186_EXISTING_PROMOTION_AFFECTS_FIXTURE');
    }
    const benefit=C.list('additional_benefit').find(row=>row.meta?.benefitType==='fixed'&&row.meta.scope==='ticket'
      &&(row.meta.allowsCustomValue===true||row.meta.allowsCustomValue==='true')
      &&!(row.meta.requiresFolio===true||row.meta.requiresFolio==='true')&&row.meta.origin!=='Tarjeta física'
      &&(!Number(row.meta.maxAmount)||Number(row.meta.maxAmount)>=100));
    if(!benefit)throw Error('H186_EXISTING_MANUAL_AMOUNT_BENEFIT_REQUIRED');
    if(!C.list('payment_method').some(row=>row.code==='Efectivo'))throw Error('H186_ACTIVE_CASH_METHOD_REQUIRED');
    await D.saveProductRows(prepared);
    return {products:prepared.map(p=>({id:p.id,model:p.modelo,sku:p.sku,size:p.sizeCode,
      sizeGroupKey:category.id+'::'+category.scale+'::'+size,commercialKey:'family:'+p.id})),benefitCode:benefit.code,
      commercialProductsUntouched:D.products.filter(p=>!own.has(p.id)).length};
  },{ids,prefix});
}

async function addIsolatedPromo(page,product,tipo,valor,ids,prefix){
  return page.evaluate(async({product,tipo,valor,ids,prefix})=>{
    const D=window.DATA,P=window.PROMOS,own=new Set(ids),draft={nombre:prefix+' '+tipo+valor+' '+product.id,
      tipo,valor,pausado:false,inicio:'',fin:'',horaInicio:'',horaFin:'',scope:{modelos:[product.model]}};
    const affected=D.products.filter(p=>P.productMatch(draft,p));
    if(!affected.length||affected.some(p=>!own.has(p.id)||p.id!==product.id))throw Error('H186_PROMOTION_SCOPE_NOT_EXCLUSIVELY_OWN');
    const saved=await D.addPromo(draft);
    return {id:saved.id,productId:product.id,tipo,valor,existingAffected:0,affected:affected.map(p=>p.id)};
  },{product,tipo,valor,ids,prefix});
}

async function domainSale(terminal,product,{qty=1,additional=0,operationId,benefitCode}){
  return terminal.page.evaluate(async({product,qty,additional,operationId,benefitCode,sellerId})=>{
    const D=window.DATA,C=window.CONFIG,p=D.products.find(p=>p.id===product.id),apps=[];
    if(additional){const benefit=C.list('additional_benefit').find(b=>b.code===benefitCode),m=benefit.meta;
      apps.push({id:'h186-'+operationId,benefitCode,benefitName:benefit.label,origin:m.origin,benefitType:m.benefitType,
        value:additional,maxPercent:Number(m.maxPercent)||0,maxAmount:Number(m.maxAmount)||0,scope:m.scope,
        combinable:m.combinable===true||m.combinable==='true',reason:'QA H186 exact owned fixtures',onlineVerified:true,
        appliedBy:window.AUTH.current()?.email||'',appliedAt:new Date().toISOString()});}
    const ticket=[{key:p.id+'-'+p.sizeCode,p,talla:p.sizeCode,qty,res:D.resolveLineDiscount(p,p.sizeCode)}];
    const quote=D.saleQuote(ticket,apps);
    const client=await window.STORE.ensureClient();
    const authority=await client.schema('pos').rpc('quote_sale',{p_inputs:ticket.map(l=>({key:l.key,productId:p.id,talla:l.talla,qty:l.qty})),p_applications:apps,p_courtesy:false});
    if(authority.error)throw Error(authority.error.message);
    for(const field of ['originalTotal','configuredDiscountTotal','additionalDiscountTotal','finalTotal','subtotal','iva'])
      if(Number(authority.data[field])!==Number(quote[field]))throw Error('H186_QUOTE_AUTHORITY_DIFF:'+field);
    return D.recordSale({operationId,ticket,additionalDiscounts:apps,quote,sellerIds:[sellerId],client:null,
      metodo:'Efectivo',estado:'Pagado',itemCount:qty});
  },{product,qty,additional,operationId,benefitCode,sellerId:terminal.sellerId});
}

// Runs in the browser. DATA prepares its real draft and reserves only its QA
// folio; the commercial command stops before STORE/network and is never faked.
export async function captureFinancialDraft({product,operationId,sellerId}){
  const D=window.DATA,core=window.CORE,original=core.invokeSync;
  const p=D.products.find(row=>row.id===product.id);let draft=null;
  if(!p)throw Error('H186_OWN_DRAFT_PRODUCT_REQUIRED');
  core.invokeSync=function(method,...args){
    if(method!=='pushSale')return original.call(this,method,...args);
    if(draft)throw Error('H186_MULTIPLE_DRAFTS_FORBIDDEN');
    draft={sale:structuredClone(args[0]),effects:structuredClone(args[1])};
    throw Object.assign(Error('H186_DRAFT_CAPTURED'),{code:'H186_DRAFT_CAPTURED'});
  };
  try{
    await D.recordSale({operationId,ticket:[{key:p.id+'-'+p.sizeCode,p,talla:p.sizeCode,qty:1}],
      sellerIds:[sellerId],client:null,metodo:'Efectivo',estado:'Pagado',itemCount:1});
    throw Error('H186_DRAFT_MUST_NOT_COMMIT');
  }catch(error){if(error.code!=='H186_DRAFT_CAPTURED')throw error;}
  finally{core.invokeSync=original;}
  if(!draft)throw Error('H186_DRAFT_REQUIRED');return draft;
}

export function financialAttempt(draft,kind,requestId){
  assert.ok(['iva','total','payment','correct'].includes(kind));
  const value=structuredClone(draft),sale=value.sale,effects=value.effects;
  assert.equal(sale.financialVersion,2);assert.ok(sale.total>0);assert.equal(effects.payments.length,1);
  sale._operationId=requestId;effects.commitId=requestId;
  if(kind==='iva')sale.iva=(cents(sale.iva)+1)/100;
  if(kind==='total')sale.total=(cents(sale.total)+1)/100;
  if(kind==='payment'){
    const payment=effects.payments[0];
    assert.equal(payment.components.length,1);assert.equal(payment.components[0].methodCode,'Efectivo');
    assert.equal(cents(payment.efectivo),cents(payment.monto));assert.ok(payment.monto>.01);
    payment.monto=(cents(payment.monto)-1)/100;payment.efectivo=payment.monto;
    payment.components[0].amount=payment.monto;
  }
  return value;
}

async function financialRejections({terminal,product,fixtures,folioPrefix,db,check,once,op,stock,ready}){
  assert.ok(fixtures.products.includes(product.id));assert.ok(fixtures.sellers.includes(terminal.sellerId));
  assert.ok(await stock(product.id)>=2,'H186_CONTROL_AND_EXCHANGE_STOCK_REQUIRED');
  const draft=await once('H186 capture uncommitted financial draft',()=>financialMutation(terminal,ready,
    ()=>terminal.page.evaluate(captureFinancialDraft,{product,operationId:op(),sellerId:terminal.sellerId})));
  const folio=draft.sale.folio;assert.ok(folio.startsWith(folioPrefix+'-'));assert.equal(draft.effects.clientId,null);
  assert.deepEqual([...new Set(draft.sale.lineas.map(row=>row.productId))],[product.id]);
  const readState=async()=>{
    const replies=await Promise.all([
      db.from('products').select('stock_quantity,sync_version').eq('id',product.id).single(),
      db.from('sellers').select('id,comision_acum,ventas_mes,ventas_num').eq('id',terminal.sellerId).single(),
      ...['sales','sale_items','sale_payments'].map(table=>db.from(table).select(table==='sales'?'folio':'id').eq('folio',folio)),
      db.from('movements').select('id').eq('ref',folio),
    ]);
    const [reference,seller,sales,items,payments,movements]=replies.map(check);
    return {reference,seller,sales:sales.length,items:items.length,payments:payments.length,movements:movements.length};
  };
  const rejected=[];
  for(const[kind,token]of [['iva','FINANCIAL_QUOTE_MISMATCH'],['total','FINANCIAL_QUOTE_MISMATCH'],['payment','FINANCIAL_PAYMENT_TOTAL_MISMATCH']]){
    rejected.push(await once('H186 SQL rejects altered '+kind,async()=>{
      const before=await readState();for(const key of ['sales','items','payments','movements'])assert.equal(before[key],0);
      const requestId=op(),attempt=financialAttempt(draft,kind,requestId);
      const answer=await financialMutation(terminal,ready,()=>terminal.page.evaluate(async({sale,effects})=>{
        try{return {rejected:false,result:await window.STORE.pushSale(sale,effects)};}
        catch(error){return {rejected:true,code:error.code||null,message:error.message};}
      },attempt));
      assert.equal(answer.rejected,true,'H186_ALTERED_'+kind+'_MUST_REJECT');
      assert.ok(fixtures.requestIds.includes(requestId),'H186_REJECTION_MUST_BE_JOURNALED');
      const receipt=check(await db.from('online_requests').select('actor_id,state,response').eq('request_id',requestId).single());
      assert.equal(receipt.actor_id,fixtures.userId);assert.equal(receipt.state,'rejected');assert.equal(receipt.response.ok,false);
      const remote=receipt.response.error;assert.match(remote.message,new RegExp(token));
      const after=await readState();assert.deepEqual(after,before,'Rejected financial command changed owned data');
      assert.equal(check(await db.from('stock_reservations').select('operation_id').eq('operation_id',requestId)).length,0);
      return {kind,requestId,state:receipt.state,errorCode:remote.code,errorMessage:remote.message,
        stockBefore:Number(before.reference.stock_quantity),stockAfter:Number(after.reference.stock_quantity),
        commissionsUnchanged:true,saleRows:0,itemRows:0,paymentRows:0,movementRows:0,reservations:0};
    }));
  }
  const control=await once('H186 valid control after financial rejections',async()=>{
    const before=await stock(product.id),requestId=op();
    const response=await financialMutation(terminal,ready,()=>terminal.page.evaluate(({sale,effects})=>window.STORE.pushSale(sale,effects),financialAttempt(draft,'correct',requestId)));
    assert.equal(response.ok,true);assert.ok(fixtures.requestIds.includes(requestId));
    const receipt=check(await db.from('online_requests').select('actor_id,state,response').eq('request_id',requestId).single());
    assert.equal(receipt.actor_id,fixtures.userId);assert.equal(receipt.state,'confirmed');assert.equal(receipt.response.ok,true);
    assert.equal(await stock(product.id),before-1);
    return {folio,requestId,total:draft.sale.total,stockBefore:before,stockAfter:before-1};
  });
  return {action:'Real DATA draft, STORE money wire, browser mutation journal and SQL authority',rejected,control};
}

export async function assertFinancialReceiptIdentity(page,folio,product,expected){
  const evidence=await page.evaluate(folio=>{
    const sale=window.DATA.sales.find(row=>row.folio===folio);
    const ticket=document.querySelector('#balam-ticket[data-document-type="sale"]');
    return {sale,text:ticket?.textContent||'',documentId:ticket?.getAttribute('data-document-id')};
  },folio);
  const {sale,text}=evidence;
  assert.ok(sale,'H186_CONFIRMED_RECEIPT_SALE_REQUIRED');
  assert.equal(evidence.documentId,folio);assert.equal(sale.financialVersion,2);
  assert.equal(sale.originalTotal,expected.original);assert.equal(sale.total,expected.total);
  const lines=sale.lineas,snapshot=sale.receiptSnapshot;
  assert.ok(Array.isArray(lines)&&lines.length>0);assert.equal(snapshot?.version,1);
  assert.equal(snapshot.lines.length,lines.length);
  assert.equal(new Set(lines.map(line=>line.lineId)).size,lines.length);
  assert.equal(lines.reduce((sum,line)=>sum+Number(line.qty),0),expected.qty||1);
  assert.equal(lines.reduce((sum,line)=>sum+cents(line.precio)*Number(line.qty),0),cents(expected.total));
  for(const line of lines){
    assert.ok(line.lineId);assert.equal(line.productId,product.id);assert.equal(line.sku,product.sku);
    const frozen=snapshot.lines.find(row=>row.lineId===line.lineId);
    assert.ok(frozen,'H186_FROZEN_RECEIPT_LINE_REQUIRED');
    assert.equal(frozen.productId,line.productId);assert.equal(frozen.sku,line.sku);
    assert.equal(frozen.name,line.nombre);assert.equal(frozen.sizeCode,line.talla);
    assert.ok(frozen.name&&text.includes(frozen.name),'H186_VISIBLE_FROZEN_NAME_REQUIRED');
    assert.ok(text.includes('Talla: '+(frozen.sizeLabel||frozen.sizeCode)),'H186_VISIBLE_FROZEN_SIZE_REQUIRED');
  }
  return {lineIds:lines.map(line=>line.lineId),snapshotSHA256:sha(JSON.stringify(snapshot)),
    exactLineTotal:lines.reduce((sum,line)=>sum+cents(line.precio)*Number(line.qty),0)/100};
}

async function uiSale(terminal,product,expected,out){
  const page=terminal.page;
  await page.getByTestId('nav-pos').click();
  await page.getByTestId('pos-barcode-input').fill(product.model);
  await page.getByTestId('pos-product-'+product.commercialKey).click();
  await page.getByTestId('family-size-pick-'+product.sizeGroupKey).click();
  const variant=page.getByTestId('family-variant-pick-'+product.id);
  if(await variant.isVisible())await variant.click();
  const cart=page.getByTestId('pos-cart-open');if(await cart.isVisible())await cart.click();
  await page.getByTestId('ticket-line-'+product.id).waitFor();
  await assertRenderedMoney(page,'body',expected);
  await page.screenshot({path:join(out,'h186-'+expected.name+'-summary.png'),fullPage:true});
  await page.getByTestId('pos-checkout-open').click();
  await assertRenderedMoney(page,'[role="dialog"]',expected);
  if(expected.total===0){assert.equal(await page.getByTestId('checkout-recibido').count(),0);assert.equal(await page.getByTestId('checkout-confirmar').isEnabled(),true);}
  else{await page.getByTestId('checkout-method-Efectivo').click();assert.equal(await page.getByTestId('checkout-confirmar').isDisabled(),true);
    await page.getByTestId('checkout-recibido').fill(String(expected.total-.01));assert.equal(await page.getByTestId('checkout-confirmar').isDisabled(),true);
    await page.getByTestId('checkout-recibido').fill(String(expected.total));}
  await page.screenshot({path:join(out,'h186-'+expected.name+'-checkout.png'),fullPage:true});
  await page.getByTestId('checkout-confirmar').click();await page.getByTestId('seller-pick-'+terminal.sellerId).click();
  await page.getByTestId('seller-pick-confirm').click();await page.getByTestId('receipt-print').waitFor({timeout:60000});
  const ticket=page.locator('#balam-ticket[data-document-type="sale"]');
  const folio=await ticket.getAttribute('data-document-id'),html=await ticket.evaluate(el=>el.outerHTML),text=await ticket.textContent();
  await assertRenderedMoney(page,'#balam-ticket',expected);
  assert.ok(folio);const identity=await assertFinancialReceiptIdentity(page,folio,product,expected);
  if(expected.total===0)assert.match(text,/Sin cobro/);
  writeFileSync(join(out,'h186-'+expected.name+'-ticket.html'),html);
  await page.keyboard.press('Escape');await page.getByTestId('receipt-print').waitFor({state:'detached'});
  return {folio,renderedTicketSha256:sha(html),identity,physicalPrint:'NOT_TESTED',action:'real POS UI'};
}

async function assertRenderedMoney(page,selector,expected){
  const values=await page.evaluate(selector=>{
    const roots=[...document.querySelectorAll(selector)],root=roots.at(-1);
    if(!root)throw Error('H186_FINANCIAL_UI_ROOT_REQUIRED');
    const read=label=>{const node=[...root.querySelectorAll('span')].find(n=>n.textContent===label
      ||(label==='Precio original'&&n.textContent.startsWith('Precio original (')));
      if(!node&&label==='Total a pagar'){const total=[...root.querySelectorAll('div')].find(n=>n.textContent==='Total a cobrar');
        return total?.parentElement?.nextElementSibling?.textContent||null;}
      return node?.nextElementSibling?.textContent||null;};
    return {original:read('Precio original'),subtotal:read('Importe'),iva:read('IVA (16%)'),total:read('Total a pagar')};
  },selector);
  for(const[field,value]of Object.entries(values)){assert.ok(value!=null,'H186_MISSING_RENDERED_'+field);
    assert.equal(Number(value.replace(/[^\d.-]/g,'')),expected[field],selector+' '+field);}
  return values;
}

export async function runFinancialJourney({terminals,fixtures,prefix,out,db,check,once,op,remember,converge,race,oneWinner,stock,ready}){
  assert.equal(terminals.length,3);const [A,B,C]=terminals,steps=[],sales={},commissionEvidence=[];
  const telemetry=installFinancialSnapshotTelemetry(terminals,join(out,'h186-snapshot-telemetry.jsonl'));
  try{
  const runtime=check(await db.from('online_runtime').select('min_financial_version').single());
  const serverMinimumFinancialVersion=Number(runtime.min_financial_version);
  assert.ok([1,2].includes(serverMinimumFinancialVersion),'H186_SERVER_FINANCIAL_POLICY_REQUIRED');
  assert.equal(await A.page.evaluate(()=>window.CONFIG.get('returns.reverseCommission')),true,'H186_COMMISSION_REVERSAL_SETTING_REQUIRED');
  const catalogAudit=await once('H186 complete commercial catalog READ ONLY',()=>runFinancialCatalogAudit(A.page));
  writeFileSync(join(out,'h186-catalog-readonly-audit.json'),JSON.stringify(catalogAudit,null,2));
  const folioPrefix='Q'+sha(fixtures.run).slice(0,5).toUpperCase();
  assert.equal(check(await db.from('folio_counters').select('prefix').eq('prefix',folioPrefix).limit(1)).length,0,'H186_QA_FOLIO_PREFIX_ALREADY_EXISTS');
  fixtures.financialFolioPrefix=folioPrefix;
  for(const terminal of terminals){
    // Only the prefix read is substituted; CONFIG state and all financial data
    // remain authoritative. No config write or change to a business counter.
    await terminal.page.evaluate(prefix=>{const get=window.CONFIG.get;window.CONFIG.get=(key,...args)=>key==='folio.prefix'?prefix:get(key,...args);},folioPrefix);
    await terminal.page.evaluate(installPrintTransport,{counter:'__h186LivePrints',hold:false});
  }
  const seeded=await once('H186 seed nine exact isolated references',()=>financialMutation(A,ready,()=>seed(A.page,fixtures.products,prefix)));
  await converge();
  const definitions=[[0,'pct',30],[1,'pct',60],[2,'pct',100],[3,'fijo',50],[4,'pct',20],[4,'pct',30],[4,'fijo',50],[5,'pct',30],[6,'pct',30],[8,'pct',30]];
  for(const[index,tipo,valor]of definitions){const promo=await once('H186 owned promotion '+index+' '+tipo+valor,
    ()=>financialMutation(A,ready,()=>addIsolatedPromo(A.page,seeded.products[index],tipo,valor,fixtures.products,prefix)));remember('promotions',promo.id);steps.push(promo);}
  await converge();
  const verifySale=async(expected,folio)=>{
    assert.ok(folio.startsWith(folioPrefix+'-'),'H186_OWN_FOLIO_REQUIRED');
    const header=check(await db.from('sales').select('*').eq('folio',folio).single());
    const items=check(await db.from('sale_items').select('*').eq('folio',folio));
    const payments=check(await db.from('sale_payments').select('*').eq('folio',folio));
    assert.equal(Number(header.financial_version),2);assert.equal(Number(header.original_total),expected.original);
    for(const field of ['total','subtotal','iva'])assert.equal(Number(header[field]),expected[field],expected.name+' '+field);
    assert.equal(cents(header.subtotal)+cents(header.iva),cents(header.total));assert.equal(header.cliente_id,null);
    assert.equal(items.reduce((sum,l)=>sum+cents(l.precio)*Number(l.qty),0),cents(header.total),'Persisted exact line sum');
    assert.equal(payments.reduce((sum,p)=>sum+cents(p.monto),0),cents(header.total));
    if(expected.total===0){assert.equal(payments.length,0);assert.equal(header.metodo,'Efectivo');assert.equal(Number(header.valor_regalado),0);}
    for(const terminal of terminals){const local=await terminal.page.evaluate(f=>window.DATA.sales.find(s=>s.folio===f),folio);
      assert.ok(local,terminal.name+' sale authority projection');assert.equal(local.financialVersion,2);assert.equal(local.originalTotal,expected.original);
      for(const field of ['total','subtotal','iva'])assert.equal(local[field],expected[field],terminal.name+' '+field);
      assert.equal(local.lineas.reduce((sum,l)=>sum+cents(l.precio)*Number(l.qty),0),cents(expected.total));}
    return {folio,header,items,paymentCount:payments.length};
  };
  const negativeEvidence=await financialRejections({terminal:A,product:seeded.products[7],fixtures,folioPrefix,db,check,once,op,stock,ready});
  remember('sales',negativeEvidence.control.folio);await converge();
  await verifySale({name:'rejectionControl',original:1250,total:1250,subtotal:1077.59,iva:172.41},negativeEvidence.control.folio);
  steps.push({name:'server rejects altered IVA, total and payment',...negativeEvidence});
  for(const[index,expected]of FINANCIAL_CASES.entries()){
    const terminal=terminals[index%3],product=seeded.products[expected.product];
    const value=await once('H186 sale '+expected.name,()=>financialMutation(terminal,ready,()=>expected.ui?uiSale(terminal,product,expected,out):
      domainSale(terminal,product,{qty:expected.qty,additional:expected.additional,operationId:op(),benefitCode:seeded.benefitCode})));
    remember('sales',value.folio);await converge();sales[expected.name]=await verifySale(expected,value.folio);
    steps.push({name:expected.name,folio:value.folio,total:expected.total,terminal:terminal.name,action:expected.ui?'POS UI':'DATA domain + real quote_sale RPC',
      renderedTicketSha256:value.renderedTicketSha256,identity:value.identity});
  }
  const split=sales.splitQty3Additional1;
  assert.equal(split.items.length,2);assert.deepEqual(split.items.map(l=>[Number(l.qty),Number(l.precio)]).sort((a,b)=>a[1]-b[1]),[[1,874.66],[2,874.67]]);
  const sellerBalances=async ids=>ids.length?check(await db.from('sellers').select('id,comision_acum').in('id',ids)):[];
  const verifyLocalBalances=async(before,deltas)=>{
    const ids=before.map(row=>row.id);
    assertCommissionBalances(before,await sellerBalances(ids),deltas);
    for(const terminal of terminals){const after=await terminal.page.evaluate(ids=>window.DATA.sellers.filter(row=>ids.includes(row.id))
      .map(row=>({id:row.id,comision_acum:row.comisionAcum})),ids);assertCommissionBalances(before,after,deltas);}
  };
  const refund=async(terminal,folio,lineId,qty,label)=>{
    const source=check(await db.from('sales').select('financial_version,total,comisiones').eq('folio',folio).single());
    const previous=check(await db.from('returns').select('total,comisiones').eq('folio',folio));
    const line=check(await db.from('sale_items').select('precio').eq('folio',folio).eq('line_id',lineId).single());
    const expectedRefund=cents(line.precio)*qty/100,expected=expectedReturnCommissionRows(source,previous,expectedRefund);
    const before=await sellerBalances([...new Set((source.comisiones||[]).map(row=>row.sellerId))]);
    const value=await once(label,()=>financialMutation(terminal,ready,()=>terminal.page.evaluate(async({folio,lineId,qty,operationId})=>{
      const D=window.DATA,sale=D.sales.find(s=>s.folio===folio),line=sale.lineas.find(l=>l.lineId===lineId);
      const result=await D.recordReturn({folio,operationId,lineas:[{...line,sourceSaleLineId:lineId,qty,motivo:'H186 owned fixture'}],metodo:'Efectivo',notas:'QA H186'});
      if(!result.ok)throw Error(result.error);return result;
    },{folio,lineId,qty,operationId:op()})));remember('returns',value.ret.id);await converge();
    const persisted=check(await db.from('returns').select('total,comisiones').eq('id',value.ret.id).single());
    assert.equal(cents(persisted.total),cents(expectedRefund));assertReturnCommissionRows(persisted.comisiones,expected);
    assertReturnCommissionRows(value.ret.comisiones,expected);
    for(const current of terminals){const local=await current.page.evaluate(id=>window.DATA.returns.find(row=>row.id===id),value.ret.id);
      assert.ok(local);assert.equal(cents(local.total),cents(expectedRefund));assertReturnCommissionRows(local.comisiones,expected);}
    await verifyLocalBalances(before,expected.map(row=>({sellerId:row.sellerId,amount:-row.monto})));
    commissionEvidence.push({label,folio,refund:expectedRefund,reversals:expected,remaining:await sellerBalances(before.map(row=>row.id))});
    return value.ret;
  };
  const first=split.items.find(l=>Number(l.qty)===2),second=split.items.find(l=>Number(l.qty)===1);
  assert.equal((await refund(B,split.folio,first.line_id,1,'H186 partial fractional refund')).total,874.67);
  assert.ok(split.header.comisiones.length>0&&split.header.comisiones.some(row=>Number(row.monto)>0),'H186_NONZERO_FROZEN_COMMISSION_REQUIRED');
  const exchangeBalances=await sellerBalances([...new Set([C.sellerId,...split.header.comisiones.map(row=>row.sellerId)])]);
  const changed=await once('H186 fractional source exchange',()=>financialMutation(C,ready,()=>C.page.evaluate(async({folio,lineId,productId,sellerId,operationId})=>{
    const D=window.DATA,sale=D.sales.find(s=>s.folio===folio),line=sale.lineas.find(l=>l.lineId===lineId),p=D.products.find(p=>p.id===productId);
    const result=await D.recordExchange({origenFolio:folio,operationId,vendedorId:sellerId,usuario:'QA H186',metodoPago:'Efectivo',notas:'QA H186',lineas:[
      {...line,sourceSaleLineId:lineId,lado:'devuelto',qty:1,motivo:'QA H186'},
      {productId:p.id,expectedProductVersion:p._syncVersion,sku:p.sku,nombre:p.nombre,talla:p.sizeCode,lado:'entregado',qty:1}]});
    if(!result.ok)throw Error(result.error);return result;
  },{folio:split.folio,lineId:second.line_id,productId:seeded.products[7].id,sellerId:C.sellerId,operationId:op()})));
  remember('exchanges',changed.exchange.id);await converge();
  const exchange=check(await db.from('exchanges').select('*').eq('id',changed.exchange.id).single());
  assert.equal(Number(exchange.valor_reconocido),874.66);assert.equal(Number(exchange.valor_entregado),1250);assert.equal(Number(exchange.diferencia),375.34);
  const expectedExchangeBase=exchange.comision_base==='bruto'?375.34:ratioCents(cents(375.34),100,116)/100;
  assert.equal(Number(exchange.comision_pct),5,'H186_OWN_SELLER_FROZEN_RATE');
  const expectedExchangeCommission=ratioCents(cents(expectedExchangeBase),5,100)/100;
  assert.equal(Number(exchange.comision_base_importe),expectedExchangeBase);assert.equal(Number(exchange.comision_monto),expectedExchangeCommission);
  for(const terminal of terminals){const local=await terminal.page.evaluate(id=>window.DATA.exchanges.find(row=>row.id===id),changed.exchange.id);
    assert.ok(local);assert.equal(local.comisionBaseImporte,expectedExchangeBase);assert.equal(local.comisionMonto,expectedExchangeCommission);}
  await verifyLocalBalances(exchangeBalances,[{sellerId:C.sellerId,amount:expectedExchangeCommission}]);
  commissionEvidence.push({label:'H186 exchange only commissions its positive difference',base:expectedExchangeBase,amount:expectedExchangeCommission,
    originalCommissionReversed:0,rate:5});
  assert.equal((await refund(A,split.folio,first.line_id,1,'H186 remaining fractional refund')).total,874.67);
  const splitReturns=check(await db.from('returns').select('comisiones').eq('folio',split.folio));
  const retained=split.header.comisiones.map(entry=>({sellerId:entry.sellerId,
    amount:(cents(entry.monto)-splitReturns.flatMap(row=>row.comisiones||[]).filter(row=>row.sellerId===entry.sellerId)
      .reduce((sum,row)=>sum+cents(row.monto),0))/100}));
  assert.ok(retained.every(row=>row.amount>0),'H186_EXCHANGED_PIECE_COMMISSION_MUST_REMAIN');
  commissionEvidence.push({label:'H186 retained original commission on exchanged piece',retained});
  assert.equal((await refund(B,sales.additional100.folio,sales.additional100.items[0].line_id,1,'H186 full additional refund')).total,775);
  assert.equal((await refund(C,sales.pct100.folio,sales.pct100.items[0].line_id,1,'H186 zero refund')).total,0);
  steps.push({name:'exact fractional returns and exchange',refunds:[874.67,874.67,775,0],recognized:874.66,difference:375.34,action:'DATA domain, authoritative persistence and A/B/C'});
  await converge();const raceProduct=seeded.products[8],before=await stock(raceProduct.id);assert.equal(before,1);
  const winner=oneWinner(await race(A,B,()=>domainSale(A,raceProduct,{operationId:op(),benefitCode:seeded.benefitCode}),
    ()=>domainSale(B,raceProduct,{operationId:op(),benefitCode:seeded.benefitCode}),command=>command?.type==='sale'));
  remember('sales',winner.folio);await converge();assert.equal(await stock(raceProduct.id),0);
  await verifySale({...FINANCIAL_CASES[0],name:'concurrent30'},winner.folio);
  steps.push({name:'one unit race',winner:winner.folio,confirmed:1,rejected:1,stock:0});
  const firstPromo=steps.find(row=>row.productId===seeded.products[0].id&&row.tipo==='pct');
  assert.ok(fixtures.promotions.includes(firstPromo.id));
  await once('H186 change only owned current price',()=>financialMutation(A,ready,()=>A.page.evaluate(async id=>{
    const D=window.DATA,p=D.products.find(p=>p.id===id);
    await D.saveProductRows([{...p,precio:1300}]);
  },seeded.products[0].id)));
  await once('H186 change only owned current promotion',()=>financialMutation(A,ready,
    ()=>A.page.evaluate(promoId=>window.DATA.updatePromo(promoId,{valor:50}),firstPromo.id)));
  // Reconstruct each independent context exclusively from authoritative state.
  for(const terminal of terminals){await terminal.page.reload({waitUntil:'domcontentloaded'});await ready(terminal);}
  const domains=await converge();
  for(const expected of FINANCIAL_CASES)await verifySale(expected,sales[expected.name].folio);
  await C.page.evaluate(installPrintTransport,{counter:'__h186LiveReprints',hold:false});
  await C.page.getByTestId('nav-reportes').click();await C.page.getByTestId('reports-tab-sales').click();
  const sellerFilter=C.page.locator('select').filter({has:C.page.locator('option[value="'+A.sellerId+'"]')});
  await sellerFilter.selectOption(A.sellerId);
  const reportControl=C.page.getByTestId('sales-reprint-'+sales.pct30.folio);
  await reportControl.waitFor();const reportRow=await reportControl.locator('xpath=ancestor::tr').textContent();
  assert.match(reportRow,/\$\s*875(?:\.00)?/);await reportControl.click();
  await C.page.locator('#balam-ticket').waitFor();await assertRenderedMoney(C.page,'#balam-ticket',FINANCIAL_CASES[0]);
  const reprint=await C.page.locator('#balam-ticket').evaluate(el=>el.outerHTML);
  writeFileSync(join(out,'h186-frozen-reprint.html'),reprint);
  await C.page.getByTestId('sales-reprint-close').click();
  steps.push({name:'report and frozen reprint after owned price/promo changes',folio:sales.pct30.folio,
    currentList:1300,currentPromo:50,recordedOriginal:1250,recordedTotal:875,recordedIVA:120.69,
    reportRowSha256:sha(reportRow),reprintSha256:sha(reprint),action:'real report UI after reload on C'});
  return {schema:'h186-live-financial-v1',terminals:terminals.map(t=>t.name),catalogAudit,negativeEvidence,commissionEvidence,steps,domains,
    testedFinancialVersion:2,serverMinimumFinancialVersion,transitionalCompatibility:serverMinimumFinancialVersion===1,
    promotionsRestrictedToOwnModels:true,existingProductsMatchedByNewPromotions:0,settingsMutations:0,
    commercialClientsUsed:0,source:'final generated artifact',hardware:'NOT_TESTED',reloads:3,
    folioPrefix,folioIsolation:'Only CONFIG.get(folio.prefix) substituted in terminal memory; no settings writes; real reserve RPC; existing prefixes unchanged.',
    postSaleUi:'Not certified here; real DATA APIs and persisted authority are exercised. UI fixtures have separate evidence.'};
  }finally{await telemetry.close();}
}
