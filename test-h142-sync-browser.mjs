import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright-core');
const out=process.env.BALAM_TEST_OUTPUT || join(tmpdir(),'balam-h142-browser');
mkdirSync(out,{recursive:true});
const html=readFileSync('index.html','utf8');
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.route('**/*',route=>route.fulfill(route.request().url()==='http://127.0.0.1:8919/'?{status:200,contentType:'text/html',body:html}:{status:401,contentType:'application/json',body:'{}'}));
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('balam-page','inventario'));
 await page.goto('http://127.0.0.1:8919/');await page.waitForFunction(()=>window.DATA&&window.STORE?.enabled);await page.waitForTimeout(250);
 const conflict=await page.evaluate(()=>{
  const D=window.DATA;
  const common={referenceFamilyId:'14200000-0000-4000-8000-000000000010',cat:'1',modelo:'PRE',nombre:'AUDIT CONFLICT',manga:'ML',tela:'ALG',color:'BL',cuello:'TRA',orn:'BEL',precio:100,attrs:{},sizeCategoryId:'size_letter',sizeScale:'L',sizeCode:'M',stockQuantity:10,ornamentColorCodes:['AZL']};
  const local=D.createReference(common,[]);local._syncVersion=1;
  D.products.splice(0,D.products.length,local);D.persistProducts();
  const remote=JSON.parse(JSON.stringify(local));remote._syncVersion=2;remote.nombre='SERVER CONFIRMED';remote.stockQuantity=8;remote.stock.forEach(s=>s.stock=8);
  const r=D.applySyncResult('products',[remote],{[local.id]:1},'upsert');
  return {localBefore:{stock:10,version:1},remote:{stock:8,version:2},result:r,localAfter:{stock:D.products[0].stockQuantity,version:D.products[0]._syncVersion,nombre:D.products[0].nombre}};
 });
 results.push({id:'S07',description:'Real DATA confuses one newer server version with acceptance',ok:conflict.result.conflicts===1&&conflict.localAfter.stock===8&&conflict.localAfter.version===2,evidence:conflict});
 await page.screenshot({path:out+'/S07-conflict-ui.png',fullPage:true});
 await page.evaluate(async()=>{
  const D=window.DATA,S=window.STORE,c=await S.getClient();
  D.products.splice(0);D.persistProducts();
  window.__audit={entered:false,sent:[],created:[]};
  c.auth.getSession=async()=>({data:{session:{user:{id:'14200000-0000-4000-8000-000000000001',email:'audit@example.test'}}}});
  const empty=()=>{const p=Promise.resolve({data:[],error:null});for(const method of ['select','eq','in','order','range','limit','gte','contains'])p[method]=()=>p;return p;};
  c.from=table=>table==='sync_activity'?{upsert:async row=>{
    if(row.status==='synced'&&!window.__audit.entered){window.__audit.entered=true;await new Promise(resolve=>window.__audit.release=resolve);}return {data:null,error:null};
   }}:{select:empty,upsert:empty,update:empty};
  c.rpc=async(name,args)=>{
   if(name==='save_products_checked'||name==='save_products_checked_v2'){
    window.__audit.sent.push(...args.p_rows.map(r=>r.id));
    return {data:args.p_rows.map(r=>({...r,sync_version:Number(r.sync_base_version)+1})),error:null};
   }return {data:null,error:null};
  };
  const common={cat:'1',modelo:'PRE',manga:'ML',tela:'ALG',color:'BL',cuello:'TRA',orn:'BEL',precio:100,attrs:{},sizeCategoryId:'size_letter',sizeScale:'L',sizeCode:'M',stockQuantity:1,ornamentColorCodes:['AZL']};
  window.__audit.make=(suffix)=>D.createReference({...common,referenceFamilyId:'14200000-0000-4000-8000-0000000000'+suffix,nombre:'AUDIT PRODUCT '+suffix},[]);
  const first=window.__audit.make('21');D.products.push(first);window.__audit.created.push(first.id);D.saveProducts([first.id]);
 });
 await page.waitForFunction(()=>window.__audit.entered);
 await page.evaluate(()=>{const p=window.__audit.make('22');window.DATA.products.push(p);window.__audit.created.push(p.id);window.DATA.saveProducts([p.id]);window.__audit.pendingBefore=window.STORE.queueStatus().pending;});
 await page.evaluate(()=>window.__audit.release());await page.waitForTimeout(350);
 const capture=await page.evaluate(()=>({created:window.__audit.created,sent:window.__audit.sent,pendingBefore:window.__audit.pendingBefore,pendingAfter:window.STORE.queueStatus().pending,ids:window.DATA.products.map(p=>p.id),durableIds:JSON.parse(localStorage.getItem('balam_pos_products_v2')||'[]').map(p=>p.id)}));
 results.push({id:'S01-browser',description:'Real published DATA/STORE loses second send while keeping local product',ok:capture.pendingBefore===2&&capture.pendingAfter===0&&capture.created.length===2&&capture.sent.length===2&&capture.durableIds.includes(capture.created[1]),evidence:capture});
 await page.screenshot({path:out+'/S01-local-with-empty-queue.png',fullPage:true});
 await page.reload();await page.waitForFunction(()=>window.DATA&&window.STORE?.enabled);await page.waitForTimeout(150);
 const afterReload=await page.evaluate(()=>({ids:window.DATA.products.map(p=>p.id),pending:window.STORE.queueStatus().pending}));
 results.push({id:'S01-reload',description:'Unsent product survives reload with empty queue',ok:afterReload.pending===0&&capture.created.every(id=>afterReload.ids.includes(id)),evidence:afterReload});
 await page.screenshot({path:out+'/S01-after-reload.png',fullPage:true});
 const visibleBefore=await page.getByTestId(/^inventory-product-family:/).count();
 const actualAfter=await page.evaluate(()=>{
  const D=window.DATA;const next=JSON.parse(JSON.stringify(D.products));
  const third=D.createReference({...next[0],id:undefined,barcodeCode:undefined,referenceFamilyId:'14200000-0000-4000-8000-000000000023',nombre:'REMOTE THIRD',sizeCode:'L',stockQuantity:3},[]);
  next.push(third);D.applyRemote('products',next,{authoritative:true});return D.commercialProducts().length;
 });
 await page.waitForTimeout(100);
 const visibleAfter=await page.getByTestId(/^inventory-product-family:/).count();
 await page.screenshot({path:out+'/S09-stale-inventory-view.png',fullPage:true});
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('configchange')));await page.waitForTimeout(100);
 const visibleAfterConfigEvent=await page.getByTestId(/^inventory-product-family:/).count();
 results.push({id:'S09',description:'Inventory screen ignores products datachange from live pull',ok:visibleBefore===2&&actualAfter===3&&visibleAfter===3&&visibleAfterConfigEvent===3,evidence:{visibleBefore,actualAfter,visibleAfter,visibleAfterConfigEvent}});
 writeFileSync(out+'/browser-probes.json',JSON.stringify({publishedSha256:createHash('sha256').update(html).digest('hex'),scope:'Local built bundle, isolated Chrome profile, all external requests intercepted, synthetic fixtures',results,pageErrors:errors},null,2));
 console.log(results.map(r=>`${r.ok?'PASS':'FAIL'} ${r.id}`).join('\n')); if(errors.length)throw Error(errors.join('\n'));
}finally{await browser.close();}
process.exitCode=results.some(r=>!r.ok)?1:0;
