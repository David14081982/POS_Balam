// H171: reach the real user controls through the horizontal table region.
// --source executes settings.jsx without rebuilding the distributed artifact.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const sourceMode=process.argv.includes('--source');
const output=process.env.BALAM_USERS_OUTPUT||'docs/fixes/evidence/h171-users-responsive';
await fs.mkdir(output,{recursive:true});
const html=await fs.readFile(process.env.BALAM_VERIFIED_HTML||'index.html');
const source=await fs.readFile('balam/settings.jsx','utf8');
const dashboardSource=await fs.readFile('balam/dashboard.jsx','utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');
const evidence={date:new Date().toISOString(),sourceMode,artifactSha256:sha(html),settingsSha256:sha(source),dashboardSha256:sha(dashboardSource),
  scope:'Actual Settings component; local read fixture; updateUser callback intercepted without mutation. No real Auth or remote write certification.',
  viewports:[320,360,390,430,768,1024,1280,1440],rows:[],errors:[],externalRequestsAllowed:0};
const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
let browser;
async function assertReachable(locator,region){
  await locator.scrollIntoViewIfNeeded();
  const box=await locator.boundingBox(),clip=await region.boundingBox();
  assert.ok(box&&clip,'Rendered target and scroll region');
  assert.ok(box.x>=clip.x-1&&box.x+box.width<=clip.x+clip.width+1,'Whole control visible inside its container');
  assert.equal(await locator.evaluate(async e=>{
    const reachable=()=>{
      const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
      return r.left>=-1&&r.right<=innerWidth+1&&(hit===e||e.contains(hit));
    };
    // The mobile navigation closes over 200ms after the dashboard has rendered.
    // Await the same hit condition; a persistent obstruction must still fail.
    const deadline=performance.now()+1000;
    while(!reachable()&&performance.now()<deadline)await new Promise(requestAnimationFrame);
    return reachable();
  }),true,'The user can hit the visible control');
}
try{
  browser=await chromium.launch({...(process.env.BALAM_CHROME_EXECUTABLE
    ?{executablePath:process.env.BALAM_CHROME_EXECUTABLE}:{channel:'chrome'}),headless:true});
  for(const width of evidence.viewports){
    const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
    await context.addInitScript(()=>{
      window.__qaRoots=[];let dom;
      Object.defineProperty(window,'ReactDOM',{configurable:true,get:()=>dom,set:value=>{
        dom=value;let createRoot;
        Object.defineProperty(value,'createRoot',{configurable:true,get:()=>createRoot,set:fn=>{
          createRoot=(...args)=>{const root=fn(...args);window.__qaRoots.push(root);return root;};
        }});
      }});
    });
    await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort('blockedbyclient'));
    const page=await context.newPage();page.on('pageerror',e=>evidence.errors.push({width,message:e.message}));
    await page.goto(base,{waitUntil:'load'});
    await page.waitForFunction(()=>window.AUTH?.isReady()&&window.SettingsScreen&&window.DATA&&window.CONFIG);
    if(sourceMode){await page.addScriptTag({content:source});await page.addScriptTag({content:dashboardSource});}
    await page.evaluate(()=>{
      window.__qaRoots.forEach(root=>root.unmount());
      CONFIG.load(CONFIG.prepareMutation('reset',[]).state);
      const makeUser=(id,active)=>({id,nombre:'Usuario QA '+id,iniciales:'QA',email:id+'@example.invalid',role:'vendedor',active,color:'#334455',metaMes:1000,commissionOverridePct:null,sellerLevelCode:null,_syncVersion:1});
      const keys=['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'];
      const snapshot=Object.fromEntries(keys.map(k=>[k,[]]));snapshot.sellers=[makeUser('h171-active',true),makeUser('h171-inactive',false)];snapshot.commissionContext={periodStart:'',sellerBases:[]};
      const today=new Date();snapshot.clients=[{id:'h171-birthday',nombre:'Cliente cumpleaños QA',generic:false,nacimiento:'2000-'+String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0')+'T12:00:00'}];
      DATA.replaceFromOnline(snapshot);window.__qaBefore=JSON.stringify(DATA.sellers);window.__qaCalls=[];
      DATA.updateUser=async(id,patch)=>{window.__qaCalls.push({id,patch});return {ok:true};};
      AUTH.canAccess=()=>true;AUTH.isAdmin=()=>true;AUTH.requireAccess=()=>true;
      AUTH.current=()=>({id:'h171-admin',nombre:'Admin QA',role:'admin',active:true});AUTH.hasSession=()=>true;AUTH.isReady=()=>true;AUTH.defaultScreen=()=> 'dashboard';AUTH.init=async()=>{};
      Object.defineProperty(AUTH,'accessState',{configurable:true,value:'remote'});
      STORE.assertBusinessReady=()=>true;STORE.serverNow=()=>new Date('2026-09-12T19:00:00Z');
      STORE.syncStatus=()=>({ready:true,connection:'online',synchronized:true,busy:false,lastSuccess:new Date().toISOString(),pendingRequests:[],errors:[]});STORE.syncFleetStatus=async()=>({devices:[],history:[]});
      STORE.setSession=async()=>({ok:true});STORE.init=async()=>({ok:true});STORE.hasSession=async()=>true;STORE.refresh=async()=>({ok:true});
      STORE.execute=()=>{throw new Error('QA_WRITE_FORBIDDEN');};
      document.body.innerHTML='<div id="qa-users"></div>';
      localStorage.setItem('balam-page','config');localStorage.setItem('balam-sidebar','0');
      ReactDOM.createRoot(document.getElementById('qa-users')).render(React.createElement(window.App));
    });
    await page.getByTestId('settings-section-usuarios').click();
    const region=page.locator('[data-horizontal-scroll="settings-users-table"]');
    await region.waitFor();
    const add=page.getByTestId('settings-user-add');await assertReachable(add,page.locator('main'));
    await add.click();await page.getByTestId('settings-user-form').waitFor();
    assert.equal(await page.getByTestId('settings-user-form').getAttribute('data-user-id'),'new');
    await page.getByTestId('settings-user-back').click();await region.waitFor();
    assert.equal(await region.getAttribute('role'),'region');assert.equal(await region.getAttribute('tabindex'),'0');
    assert.equal(await region.evaluate(e=>getComputedStyle(e).overflowX),'auto');
    const before=await region.evaluate(e=>({width:e.clientWidth,total:e.scrollWidth,left:e.scrollLeft}));
    await region.focus();for(let i=0;i<20;i++)await region.press('ArrowRight');
    await page.waitForTimeout(300);
    const after=await region.evaluate(e=>({width:e.clientWidth,total:e.scrollWidth,left:e.scrollLeft}));
    if(before.total>before.width+1)assert.ok(after.left>0,'Keyboard scroll exposes clipped columns');
    await page.screenshot({path:path.join(output,width+'-users-actions.png')});
    for(const id of ['h171-active','h171-inactive']){
      const status=page.getByTestId('settings-user-status-'+id);
      await assertReachable(status,region);
      assert.equal(await status.textContent(),id==='h171-active'?'Activo':'Inactivo');
      const toggle=page.getByTestId('settings-user-toggle-'+id);
      await assertReachable(toggle,region);await toggle.click();
      const edit=page.getByTestId('settings-user-edit-'+id);
      await assertReachable(edit,region);await edit.click();
      const form=page.getByTestId('settings-user-form');await form.waitFor();
      assert.equal(await form.getAttribute('data-user-id'),id,'Edit opens the chosen user');
      await page.getByTestId('settings-user-back').click();await region.waitFor();
    }
    const result=await page.evaluate(()=>({calls:window.__qaCalls,dataUnchanged:window.__qaBefore===JSON.stringify(DATA.sellers),documentWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert.deepEqual(result.calls,[{id:'h171-active',patch:{active:false}},{id:'h171-inactive',patch:{active:true}}]);
    assert.equal(result.dataUnchanged,true);assert.ok(result.documentWidth<=result.viewport+1);
    if(width<768)await page.locator('button[aria-controls="balam-navigation"]').click();
    await page.getByTestId('nav-dashboard').click();
    const birthdays=page.getByTestId('dashboard-birthdays');await birthdays.waitFor();
    assert.ok((await birthdays.textContent()).includes('Cliente cumpleaños QA'),'Birthday list remains available');
    assert.equal(await birthdays.locator('button').count(),0,'No unimplemented greeting action remains');
    const monthly=page.getByTestId('dashboard-chart-view-mes'),weekly=page.getByTestId('dashboard-chart-view-sem');
    await assertReachable(monthly,monthly.locator('xpath=..'));
    assert.equal(await page.getByTestId('dashboard-chart-bars').locator(':scope > div').count(),7);
    await monthly.click();
    assert.equal(await monthly.getAttribute('aria-pressed'),'true');
    assert.equal(await page.getByTestId('dashboard-chart-bars').getAttribute('data-view'),'mes');
    assert.equal(await page.getByTestId('dashboard-chart-bars').locator(':scope > div').count(),6);
    assert.equal(await page.getByTestId('dashboard-chart-summary').textContent(),'Rendimiento mensual del showroom');
    await page.screenshot({path:path.join(output,width+'-dashboard-monthly.png')});
    await assertReachable(weekly,weekly.locator('xpath=..'));await weekly.click();
    assert.equal(await weekly.getAttribute('aria-pressed'),'true');
    assert.equal(await page.getByTestId('dashboard-chart-bars').locator(':scope > div').count(),7);
    evidence.rows.push({width,keyboardBefore:before,keyboardAfter:after,...result,editFormsOpened:2,addFormOpened:true,statusesRead:2,monthlyAndWeeklyChanged:true,birthdayListPreserved:true,noGreetingAction:true,ok:true});
    console.log('PASS '+width+'px: add/status/toggle/edit users and whole monthly/weekly controls in App');await context.close();
  }
  assert.deepEqual(evidence.errors,[]);evidence.ok=true;
}catch(error){evidence.ok=false;evidence.failure=error.message;throw error;}
finally{await fs.writeFile(path.join(output,'matrix.json'),JSON.stringify(evidence,null,2)+'\n');await browser?.close();await new Promise(resolve=>server.close(resolve));}
