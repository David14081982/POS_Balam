// One actual bundle flow: seller consultation in every settings section,
// followed by the unchanged administrator controls. External network blocked.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';
const html=fs.readFileSync('index.html'),errors=[];
const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser,page;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({serviceWorkers:'block'});
 await context.addInitScript(()=>{
  window.__roots=[];let dom;
  Object.defineProperty(window,'ReactDOM',{configurable:true,get:()=>dom,set:v=>{dom=v;let create;Object.defineProperty(v,'createRoot',{configurable:true,get:()=>create,set:impl=>{create=(...args)=>{const r=impl(...args);window.__roots.push(r);return r;};}});}});
 });
 const base='http://127.0.0.1:'+server.address().port;
 await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.waitForFunction(()=>window.AUTH?.isReady()&&window.SettingsScreen&&window.DATA);
 const sections=await page.evaluate(()=>{
  window.__roots.forEach(r=>r.unmount());window.__admin=false;
  window.AUTH.isAdmin=()=>window.__admin;window.AUTH.canAccess=()=>true;
  window.CONFIG.load(window.CONFIG.prepareMutation('reset',[]).state);
  window.STORE.assertBusinessReady=()=>true;
  window.STORE.serverNow=()=>new Date('2026-11-14T19:00:00Z');
  window.STORE.syncStatus=()=>({ready:true,connection:'online'});
  window.STORE.syncFleetStatus=async()=>({devices:[],history:[]});
  window.__writes=0;window.STORE.execute=async()=>{window.__writes++;throw Error('Unexpected write');};
  document.body.innerHTML='<div id="test"></div>';window.__root=ReactDOM.createRoot(document.getElementById('test'));window.__root.render(React.createElement(window.SettingsScreen));
  return window.SCREENS.childrenOf('config').map(s=>s.section);
 });
 await page.getByTestId('settings-readonly').waitFor();
 for(const section of sections){
  await page.getByTestId('settings-section-'+section).click();
  await page.waitForFunction(s=>document.querySelector('[data-testid="settings-section-'+s+'"]')?.className.includes('font-medium'),section);
  assert.equal(await page.locator('input:not([disabled]),select:not([disabled]),textarea:not([disabled])').count(),0,section+' editable');
  assert.equal(await page.locator('button:not([data-testid^="settings-section-"])').count(),0,section+' action');
 }
 assert.equal(await page.evaluate(()=>window.__writes),0);
 await page.getByTestId('settings-section-impresion').click();
 assert.ok(await page.locator('[data-testid^="config-readonly-"]').count()>0,'read-only switches retain their values');
 await page.evaluate(()=>{window.__admin=true;window.__root.render(React.createElement(window.SettingsScreen));});
 await page.getByTestId('settings-section-usuarios').click();await page.getByTestId('settings-user-add').waitFor();
 assert.equal(await page.getByTestId('settings-user-add').isEnabled(),true);
 await page.getByTestId('settings-section-negocio').click();assert.ok(await page.locator('input:not([disabled])').count()>0);
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>window.__writes),0);
 fs.mkdirSync('docs/fixes/evidence/h192',{recursive:true});fs.writeFileSync('docs/fixes/evidence/h192/settings-ui.json',JSON.stringify({at:new Date().toISOString(),passed:1,case:'9: seller read-only settings and administrator controls',sections,remoteWrites:0,artifactSha256:createHash('sha256').update(html).digest('hex')},null,2)+'\n');
 console.log('PASS 9: settings consultation, no seller writes; administrator controls preserved');
}catch(e){console.error(e.message,errors,await page?.locator('body').innerText().catch(()=>''));process.exitCode=1;}finally{await browser?.close();server.close();}
