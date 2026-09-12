const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),http=require('http');
const {chromium}=require('playwright-core');
const repo=process.cwd();
const out=fs.mkdtempSync(path.join(os.tmpdir(),'balam-navigation-brand-'));console.log('EVIDENCE '+out);
const evidence={startedAt:new Date().toISOString(),scope:'Read-only public artifact; private synthetic browser fixtures; no production login or commercial writes',public:{},branding:[],navigation:[],errors:[],blockedNetwork:[],productionWrites:0};
const save=()=>fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(evidence,null,2));
let browser,server;
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.BALAM_CHROME_EXECUTABLE ? {executablePath:process.env.BALAM_CHROME_EXECUTABLE}:{channel:'chrome'})});
 const html=fs.readFileSync(process.env.BALAM_VERIFIED_HTML || path.join(repo,'index.html'));evidence.public={artifactSha256:crypto.createHash('sha256').update(html).digest('hex')};
 server=http.createServer((req,res)=>{let relative=decodeURIComponent(req.url.split('?')[0]).replace(/^\/POS_Balam\//,'').replace(/^\//,'');if(relative==='/'||relative==='')relative='index.html';const target=path.resolve(repo,relative);if(!target.startsWith(path.resolve(repo)+path.sep)){res.writeHead(403);res.end();return;}try{const data=relative==='index.html'?html:fs.readFileSync(target);const ext=path.extname(relative);res.writeHead(200,{'Content-Type':ext==='.html'?'text/html':ext==='.js'?'text/javascript':ext==='.png'?'image/png':ext==='.webmanifest'?'application/manifest+json':'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const navContext=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});await navContext.route('**/*',route=>route.request().url().startsWith(base)&&route.request().method()==='GET'?route.continue():route.abort());if(navContext.routeWebSocket)await navContext.routeWebSocket('**/*',ws=>ws.close());
 const nav=await navContext.newPage();nav.on('pageerror',e=>evidence.errors.push(e.message));await nav.addInitScript(()=>{window.__roots=[];let rd;Object.defineProperty(window,'ReactDOM',{configurable:true,get:()=>rd,set:value=>{rd=value;let cr;Object.defineProperty(value,'createRoot',{configurable:true,get:()=>cr,set:f=>{cr=(...args)=>{const r=f(...args);__roots.push(r);return r;};}});}});window.__long=[];new PerformanceObserver(l=>l.getEntries().forEach(e=>__long.push({start:e.startTime,duration:e.duration}))).observe({type:'longtask',buffered:true});});
 await nav.goto(base+'/index.html',{waitUntil:'load'});await nav.waitForFunction(()=>window.AUTH?.isReady()&&window.DATA&&window.InventoryScreen&&window.BARCODES?.ready());
 await nav.evaluate(()=>{__roots.forEach(r=>r.unmount());document.body.innerHTML='<div id="qa-root"></div>';window.__root=ReactDOM.createRoot(document.getElementById('qa-root'));const user={id:'16600000-0000-4000-8000-000000000001',nombre:'QA',iniciales:'QA',role:'admin',active:true};AUTH.current=()=>user;AUTH.hasSession=()=>true;AUTH.isReady=()=>true;AUTH.init=()=>{};AUTH.canAccess=()=>true;AUTH.requireAccess=()=>true;AUTH.isAdmin=()=>true;AUTH.defaultScreen=()=> 'dashboard';Object.defineProperty(AUTH,'accessState',{configurable:true,value:'remote'});STORE.setSession=async()=>({ok:true});STORE.init=async()=>({ok:true});STORE.syncStatus=()=>({ready:true,connection:'online',synchronized:true,adoption:{state:'ready'},errors:[]});});
  await nav.evaluate(count=>{const D=DATA,C=CONFIG;C.load(C.prepareMutation('reset',[]).state);const p=D.createReference({id:'16600000-0000-4000-8000-000000000100',referenceFamilyId:'16600000-0000-4000-8000-000000000200',nombre:'Producto QA',modelo:'QA',cat:'21',manga:'ML',tela:'ALG',color:'BL',cuello:'NOR',orn:'—',ornamentColorCodes:[],precio:116,costo:40,stockQuantity:4,sizeCode:'40',sizeScale:'N',sizeCategoryId:'size_number',attrs:{__sizeCategoryId:'size_number'}},[]);const snapshot=Object.fromEntries(['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'].map(k=>[k,[]]));snapshot.products=Array.from({length:count},(_,i)=>({...p,id:crypto.randomUUID(),referenceFamilyId:crypto.randomUUID(),nombre:'Producto QA '+i,modelo:'QA'+i,barcodeCode:'BG-QA-'+String(i).padStart(8,'0')}));snapshot.clients=[{id:'16600000-0000-4000-8000-000000000003',nombre:'Publico general QA',generic:true,compras:0,total:0,ultima:'',talla:''}];snapshot.commissionContext={periodStart:'',sellerBases:[]};D.replaceFromOnline(snapshot);localStorage.setItem('balam-page','pos');__root.render(React.createElement(App));},1500);

 const assert=require('assert/strict');
 await nav.evaluate(()=>{
  document.getElementById('qa-root').style.height='100%'; // production #root contract
  const keys=['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'];
  const snapshot=Object.fromEntries(keys.map(k=>[k,DATA[k==='promotions'?'promos':k]]));snapshot.commissionContext=DATA.commissionContext;
  snapshot.products.forEach(p=>p.barcodeCode=DATA.barcodeFromId(p.id));DATA.replaceFromOnline(snapshot);
  CORE.registerSyncGateway({...STORE,serverNow:()=>new Date('2026-09-12T19:00:00Z'),getQuoteContext:()=>({configVersion:CONFIG.version})});
  const Panel=window.TicketPanel;window.TicketPanel=props=>{window.__ticketTotal=props.grandTotal;window.__ticket=props.ticket.map(l=>({id:l.productId,talla:l.talla,qty:l.qty,barcode:l.p.barcodeCode}));return React.createElement(Panel,props);};
 });
 await nav.waitForFunction(()=>document.querySelector('#balam-navigation'));
 await nav.getByTestId('pos-catalog-scroll').waitFor();
 await nav.waitForTimeout(500);
 const firstCount=await nav.locator('[data-testid^="pos-product-family:"]').count();
 assert.equal(firstCount,48,'production root height must leave unvisited cards unmounted');
 await nav.waitForTimeout(500);assert.equal(await nav.locator('[data-testid^="pos-product-family:"]').count(),firstCount,'no eager background mounting');
 await nav.getByTestId('pos-catalog-scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
 await nav.waitForFunction(n=>document.querySelectorAll('[data-testid^="pos-product-family:"]').length>n,firstCount);
 const end=await nav.evaluate(()=>{const p=DATA.products.at(-1);return {id:p.id,barcode:p.barcodeCode,name:p.nombre,family:p.referenceFamilyId};});
 const input=nav.getByTestId('pos-barcode-input');await input.fill(end.name);
 await nav.waitForFunction(()=>document.querySelectorAll('[data-testid^="pos-product-family:"]').length===1);
 await nav.getByTestId('pos-product-add-family:'+end.family).click();
 await nav.locator('[data-testid^="family-size-pick-"]').click();
 await nav.waitForFunction(id=>window.__ticket?.some(l=>l.id===id&&l.qty===1),end.id);
 await input.fill(end.barcode);await input.press('Enter');
 await nav.waitForFunction(id=>window.__ticket?.some(l=>l.id===id&&l.qty===2),end.id);
 assert.equal(await nav.evaluate(id=>__ticket.find(l=>l.id===id).barcode,end.id),end.barcode);
 assert.equal(await nav.evaluate(()=>__ticketTotal),232,'confirmed list price unchanged');
 // Dispatch one HID burst in-browser: CDP round trips under concurrent load
 // must not turn a scanner burst into human typing (>50 ms gaps).
 await nav.evaluate(code=>{document.activeElement.blur();for(const key of code)window.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));},end.barcode);
 await nav.waitForFunction(id=>__ticket?.some(l=>l.id===id&&l.qty===3),end.id);
 const emptySize=await nav.getByTestId('pos-size-filter').evaluate(el=>[...el.options].find(o=>o.value!=='all'&&!DATA.sizeFilterMatch(DATA.products[0],o.value)).value);
 await nav.getByTestId('pos-size-filter').selectOption(emptySize);
 await nav.waitForFunction(()=>document.querySelectorAll('[data-testid^="pos-product-family:"]').length===0);
 await nav.getByTestId('pos-size-filter').selectOption('all');
 await nav.waitForFunction(()=>document.querySelectorAll('[data-testid^="pos-product-family:"]').length>0);
 // Presentation may be unloaded; scanner identity remains products.id/barcode.
 for(const width of [390,768,1280]){
  await nav.setViewportSize({width,height:900});
  await nav.waitForTimeout(80);
  assert.ok(await nav.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'responsive '+width);
  assert.equal(await nav.evaluate(id=>__ticket.find(l=>l.id===id).qty,end.id),3);
 }
 await input.fill('does-not-exist');await nav.waitForFunction(()=>document.querySelectorAll('[data-testid^="pos-product-family:"]').length===0);
 await input.fill('');await nav.waitForFunction(()=>document.querySelectorAll('[data-testid^="pos-product-family:"]').length>0);
 const remote=await nav.evaluate(()=>{const keys=['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'];return {...Object.fromEntries(keys.map(k=>[k,DATA[k==='promotions'?'promos':k]])),commissionContext:DATA.commissionContext};});
 remote.products=[];await nav.evaluate(s=>DATA.replaceFromOnline(s),remote);
 await nav.waitForFunction(()=>document.querySelectorAll('[data-testid^="pos-product-family:"]').length===0);
 assert.deepEqual(evidence.errors,[]);
 evidence.pos={initialMounted:firstCount,logicalReferences:1500,progressiveScroll:true,searchLast:true,scannerExactIdentity:true,globalScanner:true,sizeFilter:true,prices:true,cartAndSizes:true,remoteEmpty:true,responsive:[390,768,1280]};
 await navContext.close();evidence.completedAt=new Date().toISOString();save();console.log('PASS '+JSON.stringify(evidence.pos));console.log('DONE '+out);
})().catch(e=>{evidence.failure=e.stack;save();console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
