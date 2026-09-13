// Real generated loader + React App. Synthetic presentation only; external traffic blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
const html=await fs.readFile(process.env.BALAM_VERIFIED_HTML||'index.html');
const output=process.env.BALAM_TEST_OUTPUT||'.evidence-h171-private/startup-brand/after';
await fs.mkdir(output,{recursive:true});
const evidence={at:new Date().toISOString(),artifactSha256:createHash('sha256').update(html).digest('hex'),scope:'GENERATED_LOADER_AND_REACT_STARTUP_PRESENTATION',cases:[],errors:[],remoteWrites:0};
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(req.url==='/seed'?'<html><body></body></html>':html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
let browser;
const check=(name,pass,details={})=>{evidence.cases.push({name,pass,...details});console.log((pass?'PASS ':'FAIL ')+name);};
try {
 browser=await chromium.launch({headless:true,...(process.env.BALAM_CHROME_EXECUTABLE?{executablePath:process.env.BALAM_CHROME_EXECUTABLE}:{channel:'chrome'})});
 for(const mode of ['cold','cached']) {
  const context=await browser.newContext({viewport:{width:mode==='cold'?1200:390,height:800},serviceWorkers:'block'});
  await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
  if(context.routeWebSocket)await context.routeWebSocket('**/*',ws=>ws.close());
  const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push(e.message));
  await page.goto(base+'/seed');
  await page.evaluate(async mode=>{
   const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
   const g=canvas.getContext('2d');g.fillStyle='#116699';g.fillRect(0,0,512,512);
   const logo=canvas.toDataURL();sessionStorage.setItem('qa-startup-logo',logo);
   if(mode==='cached'){
    const hash='1'.repeat(20),url=location.origin+'/pwa/runtime/icon-'+hash+'-512.png';
    await (await caches.open('balam-pwa-brand-v1')).put(url,await fetch(logo));
    localStorage.setItem('balam_pwa_brand_v1',JSON.stringify([{hash,urls:[url]}]));
    // A legacy config exists but must never be used as presentation authority.
    localStorage.setItem('balam_config_v1',JSON.stringify({settings:{'store.logo':'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'}}));
   }
  },mode);
  await page.addInitScript(()=>{
   window.__startupReads=[];window.__startupFrames=[];window.__roots=[];
   const get=Storage.prototype.getItem;Storage.prototype.getItem=function(k){window.__startupReads.push(k);return get.call(this,k);};
   const listen=document.addEventListener.bind(document);
   document.addEventListener=(type,callback,options)=>listen(type,type==='DOMContentLoaded'?event=>{window.__releaseLoader=()=>callback(event);}:callback,options);
   let dom;Object.defineProperty(window,'ReactDOM',{configurable:true,get:()=>dom,set:value=>{dom=value;let create;Object.defineProperty(value,'createRoot',{configurable:true,get:()=>create,set:impl=>{create=(...args)=>{const root=impl(...args);window.__roots.push(root);return root;};}});}});
   const frame=()=>{let e=document.elementFromPoint(4,4),color='';while(e){color=getComputedStyle(e).backgroundColor;if(color!=='rgba(0, 0, 0, 0)')break;e=e.parentElement;}window.__startupFrames.push({color,root:!!document.getElementById('root')?.childElementCount,cover:!!document.getElementById('balam-startup')});if(!window.__stopFrames)requestAnimationFrame(frame);};requestAnimationFrame(frame);
  });
  await page.goto(base+'/',{waitUntil:'load'});await page.waitForFunction(()=>typeof window.__releaseLoader==='function');
  await page.waitForTimeout(120);
  const initial=await page.evaluate(()=>{const panel=document.getElementById('balam-startup')||document.getElementById('__bundler_thumbnail');const img=panel?.querySelector('img');return{oldB:!!document.getElementById('__balam_fb')&&getComputedStyle(document.getElementById('__balam_fb')).display!=='none',logoVisible:!!img&&img.naturalWidth>0&&getComputedStyle(img).display!=='none',src:img?.getAttribute('src'),legacyRead:__startupReads.includes('balam_config_v1')};});
  await page.screenshot({path:output+'/'+mode+'-loader.png'});
  check(mode+' loader shows company logo without legacy B',initial.logoVisible&&!initial.oldB,{logoVisible:initial.logoVisible,oldB:initial.oldB});
  if(mode==='cached')check('Cached presentation is reused without reading commercial legacy config',initial.src?.startsWith('blob:')&&!initial.legacyRead,{legacyRead:initial.legacyRead});
  await page.evaluate(()=>window.__releaseLoader());
  await page.waitForFunction(()=>window.AUTH?.isReady()&&window.App&&window.CONFIG&&window.STORE,null,{timeout:40000});
  await page.waitForTimeout(80);
  const handoff=await page.evaluate(()=>{window.__stopFrames=true;return{whiteFrames:__startupFrames.filter(f=>f.color==='rgb(255, 255, 255)'||f.color==='rgb(247, 249, 251)').length};});
  check(mode+' loader handoff has no white frame',handoff.whiteFrames===0,handoff);
  await page.evaluate(()=>{
   __roots.forEach(r=>r.unmount());
   const cfg=CONFIG.snapshot();cfg.settings['store.logo']=sessionStorage.getItem('qa-startup-logo');CONFIG.load(cfg);
   window.__gateState={ready:false,connection:'checking',adoption:{state:'working'},errors:[]};
   window.AUTH={current:()=>({id:'startup-fixture',role:'admin'}),isReady:()=>true,hasSession:()=>true,isAdmin:()=>true,canAccess:()=>true,defaultScreen:()=> 'pos',accessState:'ready'};
   window.STORE={syncStatus:()=>window.__gateState,init:async()=>({ok:true}),setSession:async()=>({ok:true})};
   document.getElementById('root').replaceChildren();window.__gateRoot=ReactDOM.createRoot(document.getElementById('root'));__gateRoot.render(React.createElement(App));
  });
  await page.getByTestId('online-gate').waitFor();
  const gate=await page.getByTestId('online-gate').evaluate(el=>{const img=el.querySelector('img');return{background:getComputedStyle(el).backgroundColor,logo:!!img&&img.naturalWidth>0,src:img?.getAttribute('src'),text:el.textContent};});
  check(mode+' updating gate retains logo and dark company surface',gate.background==='rgb(19, 27, 46)'&&gate.logo&&gate.src===await page.evaluate(()=>CONFIG.get('store.logo')),{background:gate.background,logo:gate.logo});
  await page.screenshot({path:output+'/'+mode+'-updating.png'});
  await page.evaluate(()=>{__gateState={ready:false,connection:'offline',errors:[],message:'Sin conexión. BALAM necesita internet para continuar.'};dispatchEvent(new Event('syncstatuschange'));});
  await page.getByTestId('online-gate-retry').waitFor();
  check(mode+' failure still blocks operation and exposes retry',await page.getByTestId('online-gate-retry').isEnabled());
  await context.close();
 }
 assert.deepEqual(evidence.errors,[]);assert.ok(evidence.cases.every(c=>c.pass),'STARTUP_PRESENTATION_FAILED');
}catch(error){evidence.failure=error.message;process.exitCode=1;console.error(error.message);}
finally{await browser?.close();await new Promise(r=>server.close(r));await fs.writeFile(output+'/verification.json',JSON.stringify(evidence,null,2)+'\n');}
