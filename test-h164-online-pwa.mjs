// H164: one real Chromium service-worker lifecycle; static assets only.
// Local technical API probes perform no commercial or Supabase operation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const root=process.cwd(),output=process.env.BALAM_TEST_OUTPUT||'.evidence-h164';
await fs.mkdir(output,{recursive:true});
const hash=value=>createHash('sha256').update(value).digest('hex');
const html=await fs.readFile(process.env.BALAM_VERIFIED_HTML||'index.html'),sw=await fs.readFile('sw.js');
const sourceSw=await fs.readFile('balam/pwa-sw.js');
const activationSw=process.env.BALAM_PWA_ACTIVATION_SOURCE==='1'?Buffer.from(sourceSw.toString().replaceAll('__BALAM_BUILD_HASH__','h164-activation-source')):sw;
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const evidence={startedAt:new Date().toISOString(),artifactSha256:hash(html),serviceWorkerSha256:hash(sw),activationWorkerSha256:hash(activationSw),activationUsesSource:process.env.BALAM_PWA_ACTIVATION_SOURCE==='1',certifierSha256:hash(await fs.readFile(import.meta.filename)),cases:[],remoteBusinessWrites:0,
  scope:'Actual generated service worker in a fresh Chromium context. Same-origin and cross-origin technical API probes, static offline cache, reconnect. No real Supabase operation.'};
let revision=0,browser;
const requests=[];
const respond=(request,response)=>{
  const url=new URL(request.url,'http://localhost');requests.push({path:url.pathname,method:request.method});
  if(url.pathname.startsWith('/rest/v1/')){response.writeHead(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Cache-Control':'no-store'});response.end(JSON.stringify({revision:++revision,method:request.method}));return;}
  if(url.pathname==='/probe.html'){response.writeHead(200,{'Content-Type':'text/html'});response.end('<!doctype html><title>H164 technical PWA probe</title>');return;}
  if(url.pathname==='/sw-activation.js'){response.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});response.end(activationSw);return;}
  const relative=url.pathname.replace(/^\/+/,''),target=path.resolve(root,relative||'index.html');
  if(!target.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
  fs.readFile(target).then(bytes=>{const ext=path.extname(target);response.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.webmanifest':'application/manifest+json','.png':'image/png'}[ext]||'application/octet-stream'),'Cache-Control':'no-store'});response.end(bytes);}).catch(()=>{response.writeHead(404);response.end();});
};
const server=createServer(respond),crossServer=createServer(respond);
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
await new Promise(resolve=>crossServer.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port,cross='http://127.0.0.1:'+crossServer.address().port;
let name='PWA: caché estática; API directa; corte y recuperación de Internet';
try{
  browser=await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE?{executablePath:process.env.BALAM_CHROME_EXECUTABLE,headless:true}:{channel:'chrome',headless:true});
  if(process.env.BALAM_PWA_CASE!=='activation'){
  const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage();
  await page.goto(base+'/probe.html');
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  const probe=async(url,method='GET')=>page.evaluate(async({url,method})=>{try{const response=await fetch(url,{method,cache:'no-store'});return {ok:response.ok,data:await response.json()};}catch(error){return {ok:false,error:error.name};}},{url,method});
  const first=await probe(base+'/rest/v1/products'),second=await probe(base+'/rest/v1/products');
  assert.equal(first.ok,true);assert.equal(second.ok,true);assert.ok(second.data.revision>first.data.revision);
  const post=await probe(base+'/rest/v1/rpc/technical_probe','POST');assert.equal(post.data.method,'POST');
  const crossResult=await probe(cross+'/rest/v1/products');assert.equal(crossResult.ok,true);
  await context.setOffline(true);
  const offline=await probe(base+'/rest/v1/products');assert.equal(offline.ok,false);
  const shell=await page.evaluate(async()=>{const response=await fetch('/index.html');return response.ok?await response.text():'';});assert.equal(hash(shell),hash(html));
  const navigation=await context.newPage();const offlineResponse=await navigation.goto(base+'/offline-navigation',{waitUntil:'commit'});assert.equal(hash(await offlineResponse.body()),hash(html));await navigation.close();
  await context.setOffline(false);
  const recovered=await probe(base+'/rest/v1/products');assert.equal(recovered.ok,true);assert.ok(recovered.data.revision>crossResult.data.revision);
  const cache=await page.evaluate(async()=>{const entries=[];for(const name of await caches.keys())for(const request of await(await caches.open(name)).keys())entries.push({cache:name,url:request.url});return entries;});
  const allowed=new Set(['index.html','manifest.webmanifest','pwa/icon-192.png','pwa/icon-512.png','pwa/icon-maskable-512.png','pwa/apple-touch-icon.png','pwa/favicon-64.png']);
  assert.equal(cache.length,allowed.size);for(const entry of cache){assert.ok(entry.cache.startsWith('balam-shell-'));assert.ok(allowed.has(new URL(entry.url).pathname.slice(1)),entry.url);}
  evidence.cases.push({name,ok:true,apiResponses:[first,second,post,crossResult,recovered],offlineRequestRejected:true,offlineShellSha256:hash(shell),offlineNavigationFallback:true,cache,networkRequests:requests});
  console.log('PASS '+name);await context.close();
  }
  if(!process.env.BALAM_PWA_CASE||process.env.BALAM_PWA_CASE==='activation'){
    name='PWA: activación preserva evidencia comercial antigua y retira sólo recursos estáticos';
    const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage();await page.goto(base+'/probe.html');
    const expected=JSON.stringify([{id:'h164-legacy-evidence',stock_quantity:3}]);
    await page.evaluate(async expected=>{
      await(await caches.open('balam-shell-h164-old-static')).put('/old-asset.js',new Response('old static asset'));
      await(await caches.open('balam-shell-h164-old-commercial')).put('https://qa.supabase.co/rest/v1/products',new Response(expected,{'headers':{'Content-Type':'application/json'}}));
      await navigator.serviceWorker.register('/sw-activation.js',{scope:'/'});await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
    },expected);
    const actual=await page.evaluate(async()=>({names:await caches.keys(),body:await(await(await caches.open('balam-shell-h164-old-commercial')).match('https://qa.supabase.co/rest/v1/products')).text()}));
    assert.equal(actual.names.includes('balam-shell-h164-old-static'),false);assert.equal(actual.names.includes('balam-shell-h164-old-commercial'),true);assert.equal(actual.body,expected);
    evidence.cases.push({name,ok:true,retainedEvidenceSha256:hash(actual.body),oldStaticCacheRemoved:true,commercialCacheUntouched:true});console.log('PASS '+name);await context.close();
  }
  evidence.completedAt=new Date().toISOString();console.log(evidence.cases.length+' PASS / 0 FAIL');
}catch(error){evidence.cases.push({name,ok:false,error:error.message});evidence.failure=error.stack;throw error;}
finally{const json=JSON.stringify(evidence,null,2);await fs.writeFile(output+'/online-pwa-'+runId+'.json',json);await fs.writeFile(output+'/online-pwa.json',json);await browser?.close();await Promise.all([server,crossServer].map(server=>new Promise(resolve=>server.close(resolve))));}
