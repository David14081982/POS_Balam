import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { serviceFixture } from './test-h181-service-fixture.mjs';
import { installPrintTransport } from './test-print-transport.mjs';
const baseline=process.argv.includes('--baseline');
const html=baseline?execFileSync('git',['show','HEAD:index.html'],{maxBuffer:20000000}):fs.readFileSync('index.html');
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.BALAM_CHROME_EXECUTABLE?{executablePath:process.env.BALAM_CHROME_EXECUTABLE}:{channel:'chrome'})});
const evidence=fs.mkdtempSync(path.join(os.tmpdir(),'balam-h181-'));const results=[];
const hash=v=>createHash('sha256').update(v).digest('hex');
const test=async(name,run)=>{try{await run();results.push({name,ok:true});console.log('PASS '+name);}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL '+name+': '+e.message);}};
try {
 for(const profile of ['Android','X11; Linux x86_64']) {
  const backend=serviceFixture(), packets=[];let mode='ok', pending=null, attempts=0;
  const context=await browser.newContext({userAgent:'Mozilla/5.0 ('+profile+') AppleWebKit/537.36 Chrome/140 Safari/537.36',hasTouch:true,serviceWorkers:'block'});
  await context.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());
  await context.addInitScript(installPrintTransport,{counter:'__native',hold:true});
  await context.addInitScript(()=>{window.__links=[];document.addEventListener('click',e=>{if(e.target.matches('a[href^="my.bluetoothprint.scheme:"],a[href^="intent:my.bluetoothprint.scheme:"]')){e.preventDefault();__links.push(e.target.href);}},true);});
  const page=await context.newPage();await page.exposeFunction('__prepare',async payload=>{
    attempts++;
    if(mode==='fail') throw Error('TEST_OFFLINE');
    if(mode==='hold') await new Promise(resolve=>{pending=resolve;});
    const response=await backend.handler(new Request('https://print.example/',{method:'POST',headers:{Authorization:'Bearer seller','x-balam-device-id':'test-device'},body:JSON.stringify(payload)}));
    assert.equal(response.status,200);const data=await response.json();packets.push({payload,data});return data;
  });
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.PrintManager&&window.BalamTicket);
  await page.evaluate(()=>{
    CONFIG.load(CONFIG.prepareMutation('setSetting',['print.thermer',true]).state);
    const invoke=CORE.invokeSync;CORE.invokeSync=(name,payload)=>name==='prepareThermerPrint'?__prepare(payload):invoke(name,payload);
    const host=document.createElement('div');host.id='h181-fixture';document.body.append(host);window.__root=ReactDOM.createRoot(host);
    window.__render=(id,count=3)=>{
      const sale={folio:id,fecha:'2026-10-01',vendedor:'PRUEBA',metodo:'Tarjeta',estado:'Pagado',total:count*500,subtotal:count*500/1.16,iva:count*500*.16/1.16,descuento:0,saldo:0,
        lineas:Array.from({length:count},(_,i)=>({productId:'h181-'+i,sku:'H181-'+i,nombre:'PRENDA '+(i+1),talla:'M',qty:1,precio:500}))};
      __root.render(React.createElement(React.Fragment,{key:id},React.createElement(BalamTicket,{sale}),React.createElement(UI.ReceiptPrintHelp),React.createElement(PrintManager.PrintStatus)));
    };__render('H181-A');
  });
  await test(profile+': prepares both copies automatically without system dialog',async()=>{
    await page.waitForFunction(()=>PrintManager.history().some(j=>j.transport==='thermer'&&j.stage==='WAITING_TURN'),{},{timeout:30000});
    assert.equal(await page.evaluate(()=>__native||0),0);assert.equal(packets.length,1);
  });
  if(!packets.length){await context.close();continue;}
  await test(profile+': full original images and hashes survive JSON/HTTP boundary',async()=>{
    const job=await page.evaluate(()=>PrintManager.history().at(-1));
    const manifest=await (await backend.handler(new Request(packets[0].data.url))).json();
    for(let i=0;i<2;i++){
      const png=packets[0].payload.images[i];assert.equal(hash(png),job.copies[i].payloadHash);
      const response=await backend.handler(new Request(manifest[String(i*2)].path));
      const bytes=Buffer.from(await response.arrayBuffer());assert.deepEqual(bytes,Buffer.from(png.slice(22),'base64'));
      assert.equal(bytes.readUInt32BE(16),576);fs.writeFileSync(path.join(evidence,(profile==='Android'?'android':'desktop-mode')+'-'+i+'.png'),bytes);
      const original=await page.evaluate(async label=>{const prepared=UI.prepareReceipt(undefined,label);await prepared.promise;return prepared.png;},['COPIA CLIENTE','COPIA TIENDA'][i]);assert.equal(png,original);
    }
    assert.notEqual(job.copies[0].payloadHash,job.copies[1].payloadHash);
  });
  await test(profile+': one touch delivers two copies; duplicate touch is ignored',async()=>{
    await page.locator('#h181-fixture').getByTestId('print-next').click();await page.evaluate(()=>PrintManager.sendNext());
    assert.equal(await page.evaluate(()=>__links.length),1);assert.equal(await page.evaluate(()=>__native||0),0);
    assert.equal(await page.evaluate(()=>PrintManager.history().at(-1).stage),'SEND_STARTED');
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    assert.equal(await page.evaluate(()=>PrintManager.history().at(-1).stage),'SEND_STARTED');
    await page.locator('#h181-fixture').getByTestId('print-returned').click();assert.equal(await page.evaluate(()=>PrintManager.history().at(-1).physicalPrintConfirmed),false);
    assert.deepEqual(await page.evaluate(()=>__links),['intent:my.bluetoothprint.scheme://'+packets[0].data.url+'#Intent;package=mate.bluetoothprint;end'], 'The complete response URL must survive the browser handoff');
  });
  await test(profile+': consecutive long document is isolated and delivered intact',async()=>{
    await page.evaluate(()=>__render('H181-LONG',24));
    await page.waitForFunction(()=>PrintManager.history().at(-1).ticketId==='H181-LONG'&&PrintManager.history().at(-1).stage==='WAITING_TURN');
    assert.equal(packets.length,2);assert.notEqual(packets[0].data.url,packets[1].data.url);
    assert.ok(Buffer.from(packets[1].payload.images[0].slice(22),'base64').readUInt32BE(20)>Buffer.from(packets[0].payload.images[0].slice(22),'base64').readUInt32BE(20));
    await page.locator('#h181-fixture').getByTestId('print-next').click();
    assert.deepEqual(await page.evaluate(()=>__links), packets.map(packet=>'intent:my.bluetoothprint.scheme://'+packet.data.url+'#Intent;package=mate.bluetoothprint;end'));
    await page.locator('#h181-fixture').getByTestId('print-returned').click();
    assert.equal(await page.evaluate(()=>PrintManager.history().filter(j=>j.stage==='COMPLETED').length),2);
  });
  await test(profile+': failed preparation retries the frozen document without sending',async()=>{
    mode='fail';await page.evaluate(()=>__render('H181-RETRY'));
    await page.waitForFunction(()=>PrintManager.history().at(-1).stage==='FAILED');
    const frozen=await page.evaluate(()=>PrintManager.history().at(-1).payloadHash);
    await page.evaluate(()=>document.querySelector('#balam-ticket').dataset.changedAfterCapture='true');
    mode='ok';await page.locator('#h181-fixture').getByTestId('print-retry').click();
    await page.waitForFunction(()=>PrintManager.history().at(-1).stage==='WAITING_TURN');
    assert.equal(await page.evaluate(()=>PrintManager.history().at(-1).payloadHash),frozen);
    assert.equal(await page.evaluate(()=>__links.length),2);
  });
  await test(profile+': expired packet refreshes before allowing delivery',async()=>{
    const previous=packets.at(-1), before=attempts;
    // Advance the simulated server too. Otherwise its renewed URL is already
    // expired for the browser and legitimately schedules another refresh in 1s.
    backend.advance(600001);
    await page.evaluate(expiry=>{window.__realNow=Date.now;Date.now=()=>expiry+1;},previous.data.expiresAt);
    try { await page.locator('#h181-fixture').getByTestId('print-next').click(); }
    finally { await page.evaluate(()=>{Date.now=__realNow;}); }
    await page.waitForFunction(()=>PrintManager.history().at(-1).stage==='WAITING_TURN');
    assert.equal(attempts,before+1);assert.equal(await page.evaluate(()=>__links.length),2);
    assert.deepEqual(packets.at(-1).payload.images,previous.payload.images);
    assert.notEqual(packets.at(-1).data.url,previous.data.url);
    await page.locator('#h181-fixture').getByTestId('print-cancel').click();
  });
  await test(profile+': cancellation during upload cannot revive the job; render resources released',async()=>{
    mode='hold';await page.evaluate(()=>__render('H181-CANCEL'));
    await page.waitForFunction(()=>PrintManager.history().at(-1).ticketId==='H181-CANCEL'&&PrintManager.history().at(-1).stage==='RENDER_FINISHED');
    // RENDER_FINISHED is immediately before the exposed upload call.
    for(let i=0;!pending&&i<100;i++) await new Promise(r=>setTimeout(r,20));
    assert.ok(pending);await page.locator('#h181-fixture').getByTestId('print-cancel').click();
    pending();mode='ok';
    await page.waitForFunction(()=>PrintManager.history().at(-1).stage==='CANCELLED');
    await page.evaluate(()=>new Promise(r=>setTimeout(r,100)));
    assert.equal(await page.evaluate(()=>PrintManager.history().at(-1).stage),'CANCELLED');
    assert.equal(await page.evaluate(()=>__links.length),2);
    assert.equal(await page.locator('iframe[data-print-job-id]').count(),0);
  });
  await test(profile+': enabling THERMER preserves Windows printing route',async()=>{
    assert.equal(await page.evaluate(()=>{Object.defineProperty(navigator,'userAgent',{value:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',configurable:true});return UI.usesThermerReceipt();}),false);
  });
  await context.close();
 }
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify({baseline,artifactSHA256:hash(html),results,hardware:'NOT_TESTED'},null,2));
console.log(results.filter(r=>r.ok).length+'/'+results.length+' '+evidence);process.exitCode=results.every(r=>r.ok)?0:1;
