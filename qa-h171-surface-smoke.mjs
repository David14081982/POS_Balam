// H171 discovery only: real baseline bundle, explicit read-only snapshots, zero external network.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const root=process.cwd();
const output=path.join(root,process.env.BALAM_TEST_OUTPUT||'docs/fixes/evidence/h171-smoke');
await fs.mkdir(output,{recursive:true});
const html=await fs.readFile(process.env.BALAM_VERIFIED_HTML||'index.html');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const evidence={startedAt:new Date().toISOString(),artifactSha256:sha(html),artifactRole:sha(html)==='ae53f13541729ecb3fff768d4a974a44fd5fe790f7d7961d6fde1dd28801665d'?'baseline published H170; before H171 source changes':'H171 candidate bundle; immutable bytes loaded once at harness startup',
  scope:'Navigation, rendered populated/empty fixture states, browser errors, network cage and horizontal overflow. No financial workflow, real Auth/RLS, persisted save, physical hardware, or A/B/C certification.',
  browser:'Chromium headless',viewports:process.env.BALAM_TEST_WIDTHS?process.env.BALAM_TEST_WIDTHS.split(',').map(Number):[320,360,390,430,768,1024,1280,1440],rows:[],errors:[],consoleErrors:[],blockedRequests:[],failedRequests:[],dialogs:[],remoteBusinessWrites:0};
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const save=()=>fs.writeFile(path.join(output,'matrix.json'),JSON.stringify(evidence,null,2));
let browser;
async function stable(page){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForTimeout(120);}
async function capture(page,width,id,kind,started,initialErrors){
  await stable(page);
  const state=await page.evaluate(()=>{
    const viewport=document.documentElement.clientWidth;
    const scope=document.querySelector('main')||document.body;
    const candidates=[];
    for(const element of scope.querySelectorAll('*')){
      const r=element.getBoundingClientRect(),css=getComputedStyle(element);
      if(!r.width||!r.height||r.bottom<=0||r.top>=innerHeight||css.visibility==='hidden'||css.display==='none')continue;
      if(r.left>=-1&&r.right<=viewport+1)continue;
      let contained=false;
      for(let p=element.parentElement;p&&p!==document.body;p=p.parentElement){
        const ps=getComputedStyle(p),pr=p.getBoundingClientRect();
        if(/auto|scroll|hidden|clip/.test(ps.overflowX)&&pr.left>=-1&&pr.right<=viewport+1){contained=true;break;}
      }
      if(!contained&&candidates.length<16)candidates.push({tag:element.tagName,testId:element.dataset.testid||null,
        text:(element.innerText||'').trim().slice(0,110),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width)});
    }
    const controls=[...scope.querySelectorAll('button,input,select,textarea,a')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
    const clippedControls=[];
    for(const e of controls){
      const r=e.getBoundingClientRect();
      if(r.bottom<=0||r.top>=innerHeight||e.disabled)continue;
      for(let p=e.parentElement;p&&p!==document.body;p=p.parentElement){
        const css=getComputedStyle(p),pr=p.getBoundingClientRect();
        if(/auto|scroll/.test(css.overflowX))break;
        if(/hidden|clip/.test(css.overflowX)&&(r.left<pr.left-1||r.right>pr.right+1)){
          clippedControls.push({tag:e.tagName,testId:e.dataset.testid||null,text:(e.innerText||e.getAttribute('aria-label')||e.placeholder||'').trim().slice(0,80),left:Math.round(r.left),right:Math.round(r.right),clipLeft:Math.round(pr.left),clipRight:Math.round(pr.right)});break;
        }
      }
    }
    return {title:document.querySelector('main h1')?.textContent||null,bodyChars:scope.innerText.length,
      headings:[...scope.querySelectorAll('h1,h2,h3')].map(e=>e.textContent),visibleControls:controls.length,
      unlabeledFields:controls.filter(e=>/INPUT|SELECT|TEXTAREA/.test(e.tagName)&&e.type!=='hidden'&&!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')).length,
      viewport,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,
      mainWidth:scope.clientWidth,mainScrollWidth:scope.scrollWidth,uncontainedOverflow:candidates,clippedControls,
      commercialStorageKeys:Object.keys(localStorage).filter(k=>/^balam_pos_|^balam_config|^balam_sync_queue/.test(k))};
  });
  const filename=String(width)+'-'+id.replaceAll('.','-')+'.png';
  await page.screenshot({path:path.join(output,filename),fullPage:false});
  const row={viewport:width,height:width<768?844:900,id,kind,rendered:state.bodyChars>20,
    jsErrors:evidence.errors.slice(initialErrors),...state,screenshot:filename,elapsedMs:Date.now()-started};
  row.rootOverflow=Math.max(state.documentWidth,state.bodyWidth)>state.viewport+1;
  row.status=!row.rendered||row.jsErrors.length?'BROKEN':row.rootOverflow||state.uncontainedOverflow.length||state.clippedControls.length?'LAYOUT_REVIEW':'RENDERED';
  evidence.rows.push(row);await save();
  return row;
}
try{
  browser=await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE?{executablePath:process.env.BALAM_CHROME_EXECUTABLE,headless:true}:{channel:'chrome',headless:true});
  for(const width of evidence.viewports){
    const context=await browser.newContext({viewport:{width,height:width<768?844:900},serviceWorkers:'block'});
    await context.addInitScript(()=>{
      window.__qaRoots=[];let reactDom;
      Object.defineProperty(window,'ReactDOM',{configurable:true,get:()=>reactDom,set:value=>{
        reactDom=value;let createRoot;
        Object.defineProperty(value,'createRoot',{configurable:true,get:()=>createRoot,set:implementation=>{
          createRoot=(...args)=>{const root=implementation(...args);window.__qaRoots.push(root);return root;};
        }});
      }});
    });
    await context.route('**/*',route=>{
      const req=route.request(),url=req.url();
      if(url.startsWith(base))return route.continue();
      evidence.blockedRequests.push({viewport:width,url,method:req.method()});return route.abort('blockedbyclient');
    });
    const page=await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror',error=>evidence.errors.push({viewport:width,message:error.message}));
    page.on('console',message=>{if(message.type()==='error')evidence.consoleErrors.push({viewport:width,message:message.text().slice(0,500)});});
    page.on('requestfailed',request=>evidence.failedRequests.push({viewport:width,url:request.url(),failure:request.failure()?.errorText}));
    page.on('dialog',async dialog=>{evidence.dialogs.push({viewport:width,type:dialog.type(),message:dialog.message()});await dialog.dismiss();});
    await page.goto(base,{waitUntil:'load'});
    await page.waitForFunction(()=>window.AUTH?.isReady()&&window.DATA&&window.App&&window.BARCODES?.ready(),null,{timeout:30000});
    await capture(page,width,'login','unauthenticated-entry',Date.now(),0);
    const fixture=await page.evaluate(()=>{
      const D=window.DATA,C=window.CONFIG;
      C.load(C.prepareMutation('reset',[]).state);
      const p=D.createReference({id:'17100000-0000-4000-8000-000000000001',referenceFamilyId:'17100000-0000-4000-8000-000000000099',
        nombre:'Guayabera QA de lectura',modelo:'H171',cat:'21',manga:'ML',tela:'ALG',color:'BL',cuello:'NOR',orn:'—',ornamentColorCodes:[],precio:116,costo:40,stockQuantity:3,sizeCode:'40',sizeScale:'N',sizeCategoryId:'size_number',attrs:{__sizeCategoryId:'size_number'}},[]);
      const today=new Date(),date=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-')+' 12:00';
      const seller={id:'17100000-0000-4000-8000-000000000002',nombre:'Vendedor QA',iniciales:'VQ',color:'#334455',email:'seller-qa@example.invalid',role:'vendedor',active:true,comisionPct:5,comisionAcum:0,ventasMes:0,ventasNum:0,metaMes:1000};
      const user={id:'17100000-0000-4000-8000-000000000003',nombre:'Administrador QA',iniciales:'AQ',color:'#445566',email:'admin-qa@example.invalid',role:'admin',active:true};
      const client={id:'17100000-0000-4000-8000-000000000004',nombre:'Cliente QA',email:'client-qa@example.invalid',tel:'9990000000',iniciales:'CQ',compras:1,total:116,ultima:date.slice(0,10),active:true,generic:false};
      const generic={id:'c7',nombre:'Público en general',tel:'—',compras:0,total:0,ultima:'',talla:'',notas:'',generic:true};
      const line={lineId:'17100000-0000-4000-8000-000000000005',productId:p.id,sku:p.sku,nombre:p.nombre,talla:p.sizeCode,qty:1,precio:116,precioOrig:116,precioBase:116,promos:[]};
      const sale={folio:'H171-HIST-0001',fecha:date,clienteId:client.id,cliente:client.nombre,vendedor:seller.nombre,vendedores:[seller.id],estado:'Pagado',metodo:'Efectivo',items:1,subtotal:100,iva:16,ivaPct:16,ivaIncluded:true,total:116,anticipo:116,saldo:0,pagoEfectivo:116,pagoOtro:0,descuento:0,descuentoAdicional:0,comision:0,comisiones:[],lineas:[line],_operationId:'17100000-0000-4000-8000-000000000006',_stockReserved:true};
      const layaway={...sale,folio:'H171-AP-0001',estado:'Apartado',metodo:'Apartado',anticipo:16,saldo:100,pagoEfectivo:16,_operationId:'17100000-0000-4000-8000-000000000007',_stockReserved:false};
      const keys=['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'];
      const snapshot=Object.fromEntries(keys.map(key=>[key,[]]));Object.assign(snapshot,{products:[p],sellers:[seller,user],clients:[generic,client],sales:[sale,layaway],payments:[{id:'17100000-0000-4000-8000-000000000008',folio:sale.folio,fecha:date,monto:116,efectivo:116,tarjeta:0,transferencia:0,otro:0,metodo:'Efectivo',tipo:'venta'}],commissionContext:{periodStart:'',sellerBases:[]}});
      D.replaceFromOnline(snapshot);
      window.__qaDataBefore=JSON.stringify(keys.map(k=>[k,D[k==='promotions'?'promos':k]]));window.__qaConfigBefore=JSON.stringify(C.snapshot());window.__qaWriteAttempts=[];window.__qaReads=[];
      const deny=(...args)=>{window.__qaWriteAttempts.push(args[0]?.type||String(args[0]||'write'));throw new Error('QA_READ_ONLY_WRITE_BLOCKED');};
      const screens=window.SCREENS.all(),entries=screens.map(s=>({screen_key:s.id,parent_key:s.parentId||null,is_leaf:!screens.some(child=>child.parentId===s.id),active:true}));
      const rpc=async(name,args)=>{window.__qaReads.push(name);if(name==='admin_screen_permission_catalog_snapshot')return {data:{version:1,entries},error:null};
        if(name==='admin_permission_users')return {data:[{user_id:user.id,display_name:user.nombre,email:user.email,active:true,base_role:'admin'}],error:null};
        if(name==='admin_user_permission_editor_snapshot')return {data:{user:{id:user.id,active:true},base_role:'admin',permission_version:1,overrides:{},permissions:entries.filter(e=>e.is_leaf).map(e=>({...e,role_configured:true,role_allowed:true}))},error:null};
        throw new Error('QA_READ_RPC_UNSUPPORTED:'+name);};
      const fakeClient={schema:()=>fakeClient,rpc};
      const realInvoke=window.CORE.invokeSync;
      window.CORE.invokeSync=(name,...args)=>name==='getClient'?fakeClient:name==='serverNow'?new Date():name==='execute'?deny(...args):realInvoke(name,...args);
      window.AUTH.current=()=>user;window.AUTH.hasSession=()=>true;window.AUTH.isReady=()=>true;window.AUTH.isAdmin=()=>true;
      window.AUTH.canAccess=()=>true;window.AUTH.requireAccess=()=>true;window.AUTH.defaultScreen=()=> 'dashboard';window.AUTH.init=async()=>{};
      Object.defineProperty(window.AUTH,'accessState',{configurable:true,value:'remote'});
      const status={ready:true,connection:'online',synchronized:true,busy:false,lastSuccess:new Date().toISOString(),hasUnresolvedRequests:false,pendingRequests:[],errors:[],legacyReviewCount:0};
      const S=window.STORE;S.syncStatus=()=>status;S.setSession=async()=>({ok:true});S.init=async()=>({ok:true});S.hasSession=async()=>true;S.getClient=async()=>fakeClient;S.execute=deny;
      S.refresh=async()=>({ok:true});S.synchronizeNow=async()=>({ok:true,message:'Fixture de lectura; no consulta remota'});
      S.syncFleetStatus=async()=>({devices:[{device_id:'17100000-0000-4000-8000-000000000009',display_name:'Equipo QA lectura',device_type:'pc',status:'active',connection:'online',last_seen_at:new Date().toISOString(),user_email:user.email,client_build:'H171-fixture'}],history:[],activity:[],current:1,disconnected:0,attention:0});
      const counts=Object.fromEntries(['productos','referencias_v2','piezas','ventas','sale_items','pagos','movimientos','devoluciones','return_items','cambios','exchange_items','prestamos','reclasificaciones','liquidaciones','commission_adjustments','physical_card_redemptions','stock_reservations','sale_commits','return_commits','exchange_commits','layaway_liquidation_commits','folio_counters','clientes'].map(k=>[k,0]));
      S.pointZeroPreview=async()=>({ok:true,preview_token:'QA_READ_ONLY_PREVIEW',counts,system_mode:'production',ready:false,generated_at:new Date().toISOString(),preserved:['Configuración','Catálogos','Usuarios']});
      S.previewTestDataCleanup=async()=>({ok:true,executable:false,ready:false,system_mode:'production',counts:{},blocked_reason:'QA read-only fixture'});
      window.__qaRoots.forEach(r=>r.unmount());document.body.innerHTML='<div id="root"></div>';
      localStorage.setItem('balam-page','dashboard');localStorage.setItem('balam-sidebar','0');
      window.__qaRoot=ReactDOM.createRoot(document.getElementById('root'));window.__qaRoot.render(React.createElement(window.App));
      return {products:1,clients:2,genericClients:1,sellers:2,sales:2,payments:1,empty:['loans','returns','exchanges','promotions','liquidations'],screens:window.SCREENS.navigation().map(s=>({id:s.id,title:s.title})),sections:window.SCREENS.childrenOf('config').map(s=>({id:s.id,section:s.section,title:s.title}))};
    });
    evidence.fixture=fixture;
    for(const screen of fixture.screens){
      const start=Date.now(),initialErrors=evidence.errors.length;
      try{
        if(width<768)await page.locator('button[aria-controls="balam-navigation"]').click();
        await page.getByTestId('nav-'+screen.id).click();
        await page.waitForFunction(id=>localStorage.getItem('balam-page')===id,screen.id);
        await capture(page,width,screen.id,'screen',start,initialErrors);
      }catch(error){evidence.rows.push({viewport:width,id:screen.id,kind:'screen',status:'HARNESS_OR_RENDER_FAILURE',error:error.message});await save();}
    }
    for(const section of fixture.sections){
      const start=Date.now(),initialErrors=evidence.errors.length;
      try{
        await page.getByTestId('settings-section-'+section.section).click();
        if(section.section==='permisos')await page.getByTestId('permission-user-search').waitFor();
        if(section.section==='demo')await page.getByTestId('point-zero-mode').waitFor();
        await capture(page,width,section.id,'settings-section',start,initialErrors);
      }catch(error){evidence.rows.push({viewport:width,id:section.id,kind:'settings-section',status:'HARNESS_OR_RENDER_FAILURE',error:error.message});await save();}
    }
    const preservation=await page.evaluate(()=>({dataUnchanged:window.__qaDataBefore===JSON.stringify(['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'].map(k=>[k,DATA[k==='promotions'?'promos':k]])),configUnchanged:window.__qaConfigBefore===JSON.stringify(CONFIG.snapshot()),writeAttempts:window.__qaWriteAttempts,readAdapters:window.__qaReads}));
    evidence.preservation??=[];evidence.preservation.push({viewport:width,...preservation});
    console.log(width+'px: '+evidence.rows.filter(row=>row.viewport===width).length+' surfaces; '+evidence.rows.filter(row=>row.viewport===width&&row.status!=='RENDERED').length+' observations');
    await context.close();
  }
  evidence.completedAt=new Date().toISOString();
  evidence.summary={rows:evidence.rows.length,rendered:evidence.rows.filter(r=>r.rendered).length,layoutReview:evidence.rows.filter(r=>r.status==='LAYOUT_REVIEW').length,clippedControls:evidence.rows.reduce((n,r)=>n+(r.clippedControls||[]).length,0),failures:evidence.rows.filter(r=>/BROKEN|FAILURE/.test(r.status)).length,pageErrors:evidence.errors.length,consoleErrors:evidence.consoleErrors.length,externalRequestsAllowed:0,writeAttempts:evidence.preservation.reduce((n,r)=>n+r.writeAttempts.length,0)};
  const ids=[...new Set(evidence.rows.map(row=>row.id))];
  const labels={RENDERED:'OK',LAYOUT_REVIEW:'REVIEW',BROKEN:'ERROR',HARNESS_OR_RENDER_FAILURE:'ERROR'};
  const coverage=['# H171 — matriz de navegación', '', 'Artefacto SHA-256: `'+evidence.artifactSha256+'`.', '',
    'OK indica render, ausencia de errores JS y ausencia de overflow o controles recortados visibles. Fixture explícito, transporte externo cerrado; no certifica operaciones financieras, Auth/RLS reales ni hardware.', '',
    '| Superficie | '+evidence.viewports.join(' | ')+' |','|---|'+evidence.viewports.map(()=> '---').join('|')+'|',
    ...ids.map(id=>'| '+id+' | '+evidence.viewports.map(width=>labels[evidence.rows.find(row=>row.id===id&&row.viewport===width)?.status]||'MISSING').join(' | ')+' |'),'',
    'Resultados: '+JSON.stringify(evidence.summary)+'.',''];
  await fs.writeFile(path.join(output,'coverage.md'),coverage.join('\n'));
  await save();console.log(JSON.stringify(evidence.summary));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await save();}
