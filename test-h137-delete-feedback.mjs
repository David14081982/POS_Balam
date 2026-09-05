// Baja real local y mensajes de bloqueo. Red externa siempre interceptada.
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const remote=process.argv.find(x=>/^https?:/.test(x));
const evidence=process.env.BALAM_DELETE_EVIDENCE||fs.mkdtempSync(path.join(os.tmpdir(),'balam-h137-'));
fs.mkdirSync(evidence,{recursive:true});
const server=remote?null:createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync('index.html'));});
if(server)await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];const check=(name,ok)=>{checks.push({name,ok:!!ok});console.log(`${ok?'PASS':'FAIL'} ${name}`);};
try {
 for(const scope of ['reference','family']){
 const context=await browser.newContext({viewport:{width:1280,height:950}});
 const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'||(remote&&u.origin===new URL(remote).origin)?r.continue():r.abort();});
 await p.goto(remote||`http://127.0.0.1:${server.address().port}`);
 await p.waitForFunction(()=>window.DATA&&window.InventoryScreen);
 const fixture=await p.evaluate(async()=>{
   await STORE.init({pull:false});
   const D=DATA;D.products.splice(0);D.sales.splice(0);D.loans.splice(0);
   const family=crypto.randomUUID();
   const common={referenceFamilyId:family,cat:'1',modelo:'H137',nombre:'H137 prueba',manga:'ML',tela:'ALG',color:'BL',cuello:'TRA',orn:'BEL',precio:100,attrs:{},sizeCategoryId:'size_letter',sizeScale:'L'};
   const refs=['M','L'].map(sizeCode=>D.createReference({...common,sizeCode,stockQuantity:2},[]));
   const other=D.createReference({...common,referenceFamilyId:crypto.randomUUID(),nombre:'Otra familia',sizeCode:'M',color:'NE',stockQuantity:7},[]);
   D.products.push(...refs,other);D.persistProducts();AUTH.canAccess=()=>true;
   D.sales.push({folio:'H137-HISTORICO',estado:'Pagado',returnLimitDays:1,returnExpiresAt:'2020-01-01',lineas:[{lineId:'h137-line',productId:refs[0].id,qty:1,sku:refs[0].sku,talla:'M'}]});
   window.__beforeDocs=JSON.stringify([D.sales,D.payments,D.movements]);
   window.__invoke=CORE.invokeSync;
   const root=document.createElement('div');document.body.append(root);
   ReactDOM.createRoot(root).render(React.createElement(React.Fragment,null,React.createElement(InventoryScreen),React.createElement(UI.ToastHost)));
   return {family,ids:refs.map(x=>x.id),otherId:other.id};
 });
 await p.getByTestId('inventory-product-family:'+fixture.family).click();
 await p.getByTestId('product-detail-delete').click();
 check(scope+': mensajes de otros flujos conservan su significado',await p.evaluate(()=>UI.messageAuthority({code:'PRODUCT_NOT_FOUND'}).title==='Hay información que necesita revisión'));
 if(scope==='reference')await p.getByTestId('product-delete-reference-scope').click();
 const select=()=>p.getByTestId(scope==='family'?'product-delete-family-scope':'product-delete-reference-0').click();
 await p.evaluate(()=>{CORE.invokeSync=(name,...args)=>name==='queueStatus'?{pending:1,operations:[{type:'productFamilyBatch'}]}:window.__invoke(name,...args);});
 await select();
 const queueToast=await p.getByTestId('toast').innerText();
 check(scope+': bloqueo explica cambios pendientes y qué hacer',/cambios pendientes de enviar/.test(queueToast)&&/Centro de equipos/.test(queueToast));
 check(scope+': bloqueo no habilita confirmación ni altera stock',await p.getByTestId('product-delete-confirm').count()===0&&await p.evaluate(()=>DATA.products.length===3&&DATA.products[0].stockQuantity===2));
 await p.setViewportSize({width:360,height:950});
 await p.screenshot({path:path.join(evidence,scope+'-blocked-mobile.png')});
 await p.setViewportSize({width:1280,height:950});
 await p.evaluate(()=>{CORE.invokeSync=window.__invoke;});
 if(scope==='family'){
   const guards=[
    ['apartado','apartado'],
    ['prestamo','préstamo'],
    ['devolucion','devolución o cambio'],
   ];
   for(const [kind,word] of guards){
    await p.evaluate(({kind,id})=>{
     if(kind==='apartado')DATA.sales.push({folio:'H137-ACTIVE',estado:'Apartado',lineas:[{productId:id,qty:1}]});
     if(kind==='prestamo')DATA.loans.push({id:'h137-loan',estado:'pendiente',lineas:[{productId:id,qty:1,devueltas:0}]});
     if(kind==='devolucion'){DATA.sales[0].returnLimitDays=null;DATA.sales[0].returnExpiresAt=null;}
    },{kind,id:fixture.ids[0]});
    await select();
    const copy=await p.getByTestId('toast').innerText();
    check('bloqueo '+kind+' explica su causa sin jerga',copy.includes(word)&&!/restitución|PRODUCT_|LAYAWAY_|cola|durable/.test(copy));
    await p.evaluate(()=>{DATA.sales.splice(1);DATA.sales[0].returnLimitDays=1;DATA.sales[0].returnExpiresAt='2020-01-01';DATA.loans.splice(0);});
   }
 }
 await select();
 check(scope+': confirmación declara stock que se retira',/existencia/.test(await p.getByTestId('product-delete-modal').innerText()));
 for(const width of [320,360,390,430,768,1024,1280,1440]){
   await p.setViewportSize({width,height:950});
   const fits=await p.getByTestId('product-delete-modal').evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&n.scrollWidth<=n.clientWidth+1;});
   check(scope+': modal dentro de pantalla '+width,fits);
 }
 await p.getByTestId('product-delete-confirm').click();
 const result=await p.evaluate(({ids,otherId,scope})=>{
  const targets=scope==='family'?ids:[ids[0]];
  const op=JSON.parse(localStorage.getItem('balam_sync_queue')||'[]').find(x=>x.type==='productDeleteScope');
  return {absent:targets.every(id=>!DATA.products.some(p=>p.id===id)),other:DATA.products.find(p=>p.id===otherId)?.stockQuantity===7,
   remaining:scope==='family'||DATA.products.some(p=>p.id===ids[1]&&p.stockQuantity===2),
   durable:op&&op.scope===scope&&JSON.stringify(op.rowIds.slice().sort())===JSON.stringify(targets.slice().sort()),
   history:window.__beforeDocs===JSON.stringify([DATA.sales,DATA.payments,DATA.movements])};
 },{...fixture,scope});
 for(const [name,ok] of Object.entries(result))check(scope+': baja real '+name,ok);
 await p.screenshot({path:path.join(evidence,scope+'.png')});
 await p.reload();await p.waitForFunction(()=>window.DATA&&window.STORE);
 check(scope+': baja y operación sobreviven recarga',await p.evaluate(({ids,scope})=>{
   const targets=scope==='family'?ids:[ids[0]];
   return targets.every(id=>!DATA.products.some(p=>p.id===id))&&JSON.parse(localStorage.getItem('balam_sync_queue')||'[]').some(x=>x.type==='productDeleteScope');
 },{...fixture,scope}));
 check(scope+': sin excepciones de navegador',errors.length===0);
 await context.close();
 }
}finally{await browser.close();if(server){server.closeAllConnections();server.close();}}
fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(checks,null,2));
console.log(`H-137: ${checks.filter(x=>x.ok).length}/${checks.length}`);
process.exitCode=checks.some(x=>!x.ok)?1:0;
