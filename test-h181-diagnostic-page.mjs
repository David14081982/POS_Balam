import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { diagnosticPng, diagnosticManifest } from './h181-thermer-diagnostic.mjs';

const html=fs.readFileSync('pwa/thermer-check.html');
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const storage='https://telohdbvbvsfmwyriflz.supabase.co/storage/v1/object/sign/balam-thermer-private/';
const id='1790884800-11111111-1111-4111-8111-111111111111';
const url=storage+id+'.json?token=fixture';
const paths=[0,1].map(n=>storage+id+'-'+n+'.png?token=fixture');
const images=[diagnosticPng(96),diagnosticPng(2438)],packet=diagnosticManifest(paths);
const browser=await chromium.launch({headless:true,...(process.env.BALAM_CHROME_EXECUTABLE?{executablePath:process.env.BALAM_CHROME_EXECUTABLE}:{channel:'chrome'})});
let passed=0;
async function scenario(name,options,run){
 const context=await browser.newContext({serviceWorkers:'block',hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140 Safari/537.36'});
 const requests=[];
 await context.route('**/*',route=>{
  const request=route.request(),requested=request.url();
  if(requested.startsWith(base)) return route.continue();
  requests.push(requested);
  const headers={'Access-Control-Allow-Origin':'*'};
  if(requested===url) return options.hold ? undefined : route.fulfill({status:options.denied?403:200,headers,contentType:'application/json',body:JSON.stringify(options.manifest||packet)});
  const index=paths.indexOf(requested);
  if(index>=0) return route.fulfill({headers,contentType:'image/png',body:options.corrupt?Buffer.from('invalid'):images[index]});
  return route.abort();
 });
 await context.addInitScript(()=>{window.__links=[];document.addEventListener('click',e=>{const a=e.target.closest('a');if(a?.href.startsWith('intent:my.bluetoothprint.scheme:')){e.preventDefault();__links.push(a.href);}},true);window.print=()=>{throw Error('UNEXPECTED_NATIVE_PRINT');};});
 const page=await context.newPage();
 try {
  const fragment=new URLSearchParams({url:options.target||url,expires:String(options.expired?Date.now()-1000:Date.now()+600000)});
  await page.goto(base+'/#'+fragment);
  await run(page,requests);passed++;console.log('PASS '+name);
 } finally {await context.close();}
}
try {
 await scenario('complete images preflight; one deliberate handoff; no duplicate',{},async(page,requests)=>{
  await page.waitForFunction(()=>!document.getElementById('print').disabled);
  assert.deepEqual(requests,[url,...paths]);assert.equal(await page.evaluate(()=>__links.length),0);
  await page.getByTestId('diagnostic-print').click();await page.evaluate(()=>document.getElementById('print').click());
  assert.deepEqual(await page.evaluate(()=>__links),['intent:my.bluetoothprint.scheme://'+url+'#Intent;package=mate.bluetoothprint;end']);
  assert.match(await page.getByTestId('diagnostic-status').textContent(),/solicitó/);
 });
 await scenario('foreign capability blocked before network',{target:'https://example.com/test.json?token=x'},async(page,requests)=>{
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('No se pudo'));
  assert.equal(requests.length,0);assert.equal(await page.getByTestId('diagnostic-print').isDisabled(),true);
 });
 await scenario('expired packet blocked before network',{expired:true},async(page,requests)=>{
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('venció'));
  assert.equal(requests.length,0);assert.equal(await page.getByTestId('diagnostic-print').isDisabled(),true);
 });
 await scenario('corrupt image blocks handoff',{corrupt:true},async(page)=>{
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('No se pudo'));
  assert.equal(await page.getByTestId('diagnostic-print').isDisabled(),true);assert.equal(await page.evaluate(()=>__links.length),0);
 });
 await scenario('unexpected manifest blocked',{manifest:{'0':{type:0,content:'unexpected'}}},async(page,requests)=>{
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('No se pudo'));
  assert.deepEqual(requests,[url]);assert.equal(await page.getByTestId('diagnostic-print').isDisabled(),true);
 });
 await scenario('download denial preserves independent text control',{denied:true},async(page)=>{
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('No se pudo'));
  await page.getByTestId('diagnostic-control').click();
  assert.deepEqual(await page.evaluate(()=>__links),['intent:my.bluetoothprint.scheme://https://david14081982.github.io/POS_Balam/pwa/thermer-control.json#Intent;package=mate.bluetoothprint;end']);
  const control=JSON.parse(fs.readFileSync('pwa/thermer-control.json'));
  assert.deepEqual(Object.values(control).map(v=>v.type),[0,0]);
  assert.ok(Object.values(control).every(v=>v.format===0&&/^[A-Z ]+$/.test(v.content)));
 });
 await scenario('pending download aborts and exposes text control',{hold:true},async(page,requests)=>{
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('No se pudo'),null,{timeout:40000});
  assert.deepEqual(requests,[url]);
  assert.equal(await page.getByTestId('diagnostic-print').isDisabled(),true);
  assert.equal(await page.getByTestId('diagnostic-control').isVisible(),true);
  assert.equal(await page.evaluate(()=>__links.length),0);
 });
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
console.log(passed+'/7 diagnostic browser checks; physical THERMER NOT_TESTED');
