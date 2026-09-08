import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';

const out=process.env.BALAM_TEST_OUTPUT || join(tmpdir(),'balam-h148-durability');
mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try {
 const context=await browser.newContext();
 await context.route('**/*',route=>route.request().url()==='http://127.0.0.1:9148/'
  ? route.fulfill({contentType:'text/html',body:process.env.BALAM_VERIFIED_HTML ? readFileSync(process.env.BALAM_VERIFIED_HTML,'utf8') : '<!doctype html><title>H148 storage regression</title>'}) : route.abort());
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:9148/');
 // Source injection lets the exact same red/green gate run before rebuilding.
 // The final delivery also runs with BALAM_VERIFIED_HTML against the bundle.
 if(!process.env.BALAM_VERIFIED_HTML) {
  await page.evaluate(readFileSync('balam/core.jsx','utf8'));
  await page.evaluate(readFileSync('balam/config.jsx','utf8'));
  await page.evaluate(readFileSync('balam/data.jsx','utf8'));
 }
 await page.waitForFunction(()=>window.DATA?.applyRemote && window.CONFIG);
 await page.evaluate(()=>window.DATA.awaitLocalWriter(3000));
 const report=await page.evaluate(()=>{
  const cases=[];
  const original=Storage.prototype.setItem;
  const domains=['products','clients','sellers','promotions','sales','payments','returns','exchanges','loans','liquidations','commissionAdjustments','movements'];
  for(const domain of domains) {
   Storage.prototype.setItem=function(key,value){if(key.startsWith('balam_pos_'))throw new DOMException('Test quota','QuotaExceededError');return original.call(this,key,value);};
   let applied;try{applied=window.DATA.applyRemote(domain,[],{authoritative:true});}catch(e){applied=false;}
   Storage.prototype.setItem=original;
   cases.push({id:`durability:${domain}`,ok:applied===false,applied});
   const retried=window.DATA.applyRemote(domain,[],{authoritative:true});
   cases.push({id:`retry:${domain}`,ok:retried===true,applied:retried});
  }
  const snapshot=window.CONFIG.snapshot();
  Storage.prototype.setItem=function(key,value){if(key==='balam_config_v1')throw new DOMException('Test quota','QuotaExceededError');return original.call(this,key,value);};
  const applied=window.CONFIG.load(snapshot);
  Storage.prototype.setItem=original;
  cases.push({id:'durability:config',ok:applied===false,applied});
  const retry=window.CONFIG.load(snapshot);cases.push({id:'retry:config',ok:retry===true,applied:retry});
  const writes=[];
  window.CORE.registerSyncGateway({pushRows:(kind,rows)=>writes.push({kind,ids:rows.map(row=>row.id)})});
  const D=window.DATA;
  D.clients.push({id:'untouched-client',nombre:'Preservar'});
  const client=D.addClient({nombre:'QA nueva',tel:'QA exclusiva'});
  cases.push({id:'intent:client-create-scoped',ok:writes.length===1 && writes[0].ids.length===1 && writes[0].ids[0]===client.id});
  writes.length=0;
  D.promos.push({id:'untouched-promo',nombre:'Preservar'});
  const promo=D.addPromo({nombre:'QA nueva',pausado:true});
  cases.push({id:'intent:promotion-create-scoped',ok:writes.length===1 && writes[0].ids.length===1 && writes[0].ids[0]===promo.id});
  writes.length=0;
  D.sellers.push({id:'untouched-seller',nombre:'Preservar',role:'admin'});
  D.updateUser('untouched-seller',{nombre:'Cambio explícito'});
  cases.push({id:'intent:seller-edit-scoped',ok:writes.length===1 && writes[0].ids.length===1 && writes[0].ids[0]==='untouched-seller'});
  writes.length=0;D.saveClients();D.saveSellers();D.savePromos();
  cases.push({id:'projection:persistence-is-not-an-intent',ok:writes.length===0});
  D.products.push({id:'qa-quota-intent',recordModel:'v1',nombre:'QA',modelo:'1',attrs:{},stock:[]});
  Storage.prototype.setItem=function(key,value){if(key==='balam_pos_products_v2')throw new DOMException('Test quota','QuotaExceededError');return original.call(this,key,value);};
  D.saveProducts(['qa-quota-intent']);Storage.prototype.setItem=original;
  cases.push({id:'intent:product-survives-projection-quota',ok:writes.some(w=>w.kind==='products'&&w.ids.includes('qa-quota-intent'))});
  const rejected=D.applySyncResult('clients',[{id:'untouched-client',nombre:'Edición concurrente',_syncVersion:2,_deletedAt:null}],{'untouched-client':1},'delete');
  cases.push({id:'delete:version-increment-without-tombstone-is-rejected',ok:rejected.conflicts===1});
  return cases;
 });
 results.push(...report);
} finally {await browser.close();}
writeFileSync(join(out,'result.json'),JSON.stringify(results,null,2));
for(const r of results)console.log(`${r.ok?'PASS':'FAIL'} ${r.id}`);
console.log(`${results.filter(x=>x.ok).length}/${results.length}`);
process.exitCode=results.some(x=>!x.ok)?1:0;
