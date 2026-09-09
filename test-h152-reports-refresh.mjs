// Real Chrome and DATA persistence; Supabase is blocked. No business writes.
import {chromium} from 'playwright-core';
import {readFileSync,mkdirSync} from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(readFileSync('index.html'));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const out=process.env.BALAM_TEST_OUTPUT||'C:/tmp/h152-reports';mkdirSync(out,{recursive:true});
let browser,passed=0,failed=0;const errors=[];
async function check(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failed++;console.log('FAIL '+name+': '+e.message);}}
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:Number(process.env.BALAM_TEST_WIDTH||1280),height:900}});
 await page.route(/supabase\.co/,r=>r.abort());page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.BALAM_TEST_URL||`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.DATA?.isLocalWriter&&window.ReportsScreen);
 if(process.env.BALAM_REPORTS_SOURCE)await page.addScriptTag({content:readFileSync(process.env.BALAM_REPORTS_SOURCE,'utf8')});
 await page.evaluate(()=>{
  for(const kind of ['sales','returns','exchanges','liquidations','commissionAdjustments'])window.DATA.applyRemote(kind,[],{authoritative:true});
  window.DATA.applyRemote('sellers',[
   {id:'h152-real',nombre:'Vendedora conservada',role:'vendedor',active:true},
   {id:'h152-qa-admin',nombre:'qa-h152 Admin',role:'admin',active:true},
   {id:'h152-qa-seller',nombre:'qa-h152 Seller',role:'vendedor',active:true},
  ],{authoritative:true});
  window.DATA.applyRemote('payments',[790,100].map((monto,i)=>({id:'h152-pay-'+i,folio:'H152-C-'+i,
   fecha:new Date().toISOString(),tipo:'cambio',metodo:'Tarjeta',monto,tarjeta:monto,efectivo:0,transferencia:0,otro:0,
   components:[{methodCode:'Tarjeta',methodLabel:'Tarjeta',amount:monto}]})),{authoritative:true});
  const host=document.createElement('div');host.id='h152-host';document.body.replaceChildren(host);
  window.h152Root=ReactDOM.createRoot(host);window.h152Root.render(React.createElement(window.ReportsScreen,{}));
 });
 await page.getByTestId('reports-tab-summary').waitFor();
 await check('initial report proves both obsolete profiles and the exact $890',async()=>{
  const text=await page.locator('#h152-host').innerText();assert.match(text,/qa-h152 Admin/);assert.match(text,/qa-h152 Seller/);assert.match(text,/\$890/);
 });
 await page.evaluate(()=>window.DATA.applyRemote('sellers',window.DATA.sellers.filter(s=>s.id==='h152-real'),{authoritative:true}));
 await check('open report removes deleted profiles after authoritative pull',()=>page.waitForFunction(()=>!document.querySelector('#h152-host').innerText.includes('qa-h152'),null,{timeout:4000}));
 await page.evaluate(()=>window.DATA.applyRemote('payments',[],{authoritative:true}));
 await check('open report updates money after authoritative payment removal',()=>page.waitForFunction(()=>!document.querySelector('#h152-host').innerText.includes('$890'),null,{timeout:4000}));
 await check('confirmed empty payments are durable and retained seller remains',async()=>{
  assert.equal(await page.evaluate(()=>window.DATA.payments.length),0);
  assert.match(await page.locator('#h152-host').innerText(),/Vendedora conservada/);
 });
 await page.getByTestId('reports-tab-metodos').click();
 await page.evaluate(()=>window.DATA.applyRemote('payments',[{id:'h152-new',folio:'H152-NEW',fecha:new Date().toISOString(),tipo:'venta',metodo:'Tarjeta',monto:50,tarjeta:50,components:[{methodCode:'Tarjeta',methodLabel:'Tarjeta',amount:50}]}],{authoritative:true}));
 await check('active payment report refreshes without resetting the chosen tab',()=>page.waitForFunction(()=>document.querySelector('[data-testid="payment-method-origins"]')&&document.querySelector('#h152-host').innerText.includes('$50.00'),null,{timeout:4000}));
 await page.getByTestId('reports-tab-summary').click();
 await check('summary reflects new payment and excludes deleted profiles',async()=>{const text=await page.locator('#h152-host').innerText();assert.match(text,/\$50/);assert.doesNotMatch(text,/qa-h152/);});
 await check('cleanup projection uses the server payment IDs and preserves another payment with the same folio',async()=>{
  const result=await page.evaluate(()=>{
   window.DATA.applyRemote('payments',[{id:'scope-delete',folio:'H152-SCOPE',monto:50},{id:'scope-keep',folio:'H152-SCOPE',monto:20}],{authoritative:true});
   const result=window.DATA.applySelectiveCleanup({identities:{sale_folios:['H152-SCOPE'],payment_ids:['scope-delete']},stock:[]});
   return {result,ids:window.DATA.payments.map(p=>p.id)};
  });
  assert.equal(result.result.ok,true);assert.deepEqual(result.ids,['scope-keep']);
 });
 await check('legacy cleanup events retain their existing sale-folio behavior',async()=>{
  const remaining=await page.evaluate(()=>{window.DATA.applySelectiveCleanup({identities:{sale_folios:['H152-SCOPE']},stock:[]});return window.DATA.payments.length;});
  assert.equal(remaining,0);
  // The adapter persists the projection; STORE then pulls authority, which
  // emits datachange. Exercise that confirmation before checking the UI.
  await page.evaluate(()=>window.DATA.applyRemote('payments',[],{authoritative:true}));
  await page.waitForFunction(()=>!document.querySelector('#h152-host').innerText.includes('$20'),null,{timeout:4000});
 });
 await check('no runtime errors',async()=>assert.deepEqual(errors,[]));
 await page.screenshot({path:out+'/summary.png',fullPage:true});
}finally{await browser?.close();await new Promise(r=>server.close(r));}
console.log(`H152 reports ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
