// Real runner helpers through VM, local fake DATA/transport, no live entrypoint.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join, relative } from 'node:path';
import vm from 'node:vm';
import { openLiveJournal, journalHash } from './h171-live-journal.mjs';
import { runCoreJourney } from './qa-h171-core-journey.mjs';

const source=await fs.readFile('test-h164-live-online.mjs','utf8');
const start=source.indexOf('function planCoreJourneyFixtures('),end=source.indexOf('\nsave();',start);
assert.ok(start>0&&end>start);
const helpers=vm.runInThisContext(`({assert,randomUUID})=>{${source.slice(start,end)};return {planCoreJourneyFixtures,seedCoreJourneyReferences};}`)({assert,randomUUID});
const planStart=source.indexOf("  await mutationJournal.prepare({kind:'fixture-plan'"),planEnd=source.indexOf('\n  const manifest =',planStart);
assert.ok(planStart>0&&planEnd>planStart);
const prepare=vm.runInThisContext(`async({mutationJournal,run,fixtures})=>{${source.slice(planStart,planEnd)}}`);
const onceStart=source.indexOf('async function once('),onceEnd=source.indexOf('\nasync function verify(',onceStart);
assert.ok(onceStart>0&&onceEnd>onceStart);
const onceFactory=vm.runInNewContext(`scope=>{const {fixtures,db,check,currentCase,save}=scope;let currentStep=null;const retryRejectedCase=null;
 ${source.slice(onceStart,onceEnd)};return once;}`,{assert,structuredClone});
const results=[];
const check=async(name,fn)=>{await fn();results.push({name,pass:true});};
const fresh=()=>({products:Array.from({length:7},()=>randomUUID())});
function browserFixture({existing=false,colors=['BL','BE']}={}){
  const fixtures=fresh(),plan=helpers.planCoreJourneyFixtures(fixtures),calls={created:[],saved:[]};
  const DATA={products:existing?[{id:plan.productIds[0]}]:[],ornamentColorMode:()=> 'required',
    createReference(candidate,others){calls.created.push({candidate:structuredClone(candidate),others:others.length});return {...candidate,sku:candidate.color+'-'+candidate.id};},
    async saveProductRows(rows){calls.saved.push(structuredClone(rows));DATA.products.push(...rows);}};
  const CONFIG={allCatalogMeta:()=>({custom_required:{custom:true,required:true}}),modeloKind:()=> 'model',
    sizeCategories:()=>[{id:'size_number',scale:'N'}],list:kind=>(kind==='color'?colors:kind==='size_number'?['40']:['active']).map(code=>({code}))};
  const page={evaluate:async(fn,args)=>vm.runInNewContext('('+fn.toString()+')',{window:{DATA,CONFIG}})(args)};
  return {fixtures,plan,calls,page};
}
await check('two exact UUIDs extend seven historical products once and preserve their positions',async()=>{
  const fixtures=fresh(),original=[...fixtures.products],plan=helpers.planCoreJourneyFixtures(fixtures);
  assert.equal(fixtures.products.length,9);assert.deepEqual(fixtures.products.slice(0,7),original);
  assert.deepEqual([...plan.productIds],fixtures.products.slice(7));assert.equal(plan.referenceFamilyId,plan.productIds[0]);
  assert.equal(helpers.planCoreJourneyFixtures(fixtures),plan);assert.equal(fixtures.products.length,9);
});
await check('missing historical identities, duplicate IDs and altered stock plan fail closed',async()=>{
  assert.throws(()=>helpers.planCoreJourneyFixtures({products:[]}),/seven historical/);
  for(const mutate of [f=>f.products[8]=f.products[0],f=>f.coreJourney.initialStocks[0]=12,f=>f.coreJourney.unitPrice=1]){
    const f=fresh();helpers.planCoreJourneyFixtures(f);mutate(f);assert.throws(()=>helpers.planCoreJourneyFixtures(f));
  }
});
await check('durable fixture plan excludes later UI observations and remains stable on resume',async()=>{
  const root=resolve('.evidence-h171-private');await fs.mkdir(root,{recursive:true});
  const dir=await fs.mkdtemp(join(root,'core-plan-test-')),run=randomUUID();
  const journal=await openLiveJournal({file:join(dir,'journal.json'),run,projectRef:'telohdbvbvsfmwyriflz',artifactSha256:journalHash('LOCAL artifact')});
  try{
    const fixtures=fresh();helpers.planCoreJourneyFixtures(fixtures);
    await prepare({mutationJournal:journal,run,fixtures});
    fixtures.coreJourney.steps=[{name:'login',ok:true}];fixtures.coreJourney.print={folio:'LOCAL-FOLIO'};
    await prepare({mutationJournal:journal,run,fixtures});
    const saved=JSON.parse(await fs.readFile(join(dir,'journal.json'),'utf8'));
    assert.equal(saved.entries.length,2);assert.equal(saved.entries[0].commandHash,saved.entries[1].commandHash);
    assert.equal(saved.entries[0].identities.productIds.length,9);assert.equal(saved.entries[0].identities.coreJourneyProductIds.length,2);
    assert.equal(JSON.stringify(saved).includes('LOCAL-FOLIO'),false);
  }finally{await journal.close();const child=relative(root,dir);assert.ok(child&&!child.startsWith('..'));await fs.rm(dir,{recursive:true,force:true});}
});
await check('actual seeding helper calls createReference twice then one exact save using active catalog and planned stocks',async()=>{
  const f=browserFixture(),expected=await helpers.seedCoreJourneyReferences(f.page,f.plan,'local-run');
  assert.equal(f.calls.created.length,2);assert.equal(f.calls.saved.length,1);
  assert.deepEqual(f.calls.saved[0].map(p=>p.id),[...f.plan.productIds]);
  assert.deepEqual(f.calls.saved[0].map(p=>p.stockQuantity),[3,2]);assert.equal(f.calls.created[1].others,1);
  for(const p of f.calls.saved[0]){assert.equal(p.precio,116);assert.equal(p.referenceFamilyId,f.plan.referenceFamilyId);assert.equal(p.sizeCode,'40');assert.equal(p.attrs.custom_required,'active');assert.deepEqual(p.ornamentColorCodes,['active']);}
  assert.equal(expected.commercialKey,'family:'+f.plan.referenceFamilyId);assert.equal(expected.sizeGroupKey,'size_number::N::40');
  assert.equal(Object.hasOwn(expected,'login'),false);
});
await check('existing identity is rejected before any seed creation or save',async()=>{
  const f=browserFixture({existing:true});await assert.rejects(helpers.seedCoreJourneyReferences(f.page,f.plan,'local-run'),/SEED_ID_ALREADY_EXISTS/);
  assert.equal(f.calls.created.length,0);assert.equal(f.calls.saved.length,0);
});
await check('two distinct active colors are mandatory before seeding',async()=>{
  const f=browserFixture({colors:['BL','BL']});await assert.rejects(helpers.seedCoreJourneyReferences(f.page,f.plan,'local-run'),/TWO_ACTIVE_COLORS_REQUIRED/);
  assert.equal(f.calls.created.length,0);assert.equal(f.calls.saved.length,0);
});
const caseName='Core UI journey on C then B/A compare authoritative state',label='C logout login and actual UI sale',key=caseName+' / '+label;
await check('confirmed UI request checkpoint stops resume instead of repeating any UI sale',async()=>{
  let repeated=0,saves=0;const requestId=randomUUID();
  const once=onceFactory({currentCase:caseName,fixtures:{checkpoints:{[key]:{requestIds:[requestId]}}},check:r=>r.data,save:()=>saves++,
    db:{from:()=>({select(){return this;},in(){return Promise.resolve({data:[{request_id:requestId,state:'confirmed',response:{ok:true}}]});}})}});
  await assert.rejects(once(label,async()=>repeated++),/QA_RESUME_RECONCILE_STEP/);assert.equal(repeated,0);assert.equal(saves,0);
});
await check('completed UI checkpoint is read without repeating actions',async()=>{
  const value={folio:'LOCAL-UI',steps:Array.from({length:9},()=>({ok:true}))};let repeated=0;
  const once=onceFactory({currentCase:caseName,fixtures:{checkpoints:{[key]:{complete:true,value}}},save:()=>{},db:{},check:x=>x});
  assert.equal(await once(label,async()=>repeated++),value);assert.equal(repeated,0);
});
await check('logout uses stable UI contract and login failure never exposes Playwright credential call logs',async()=>{
  const calls=[],steps=[],secret='LOCAL_PASSWORD_MUST_NEVER_APPEAR';
  const page={locator(selector){return{isVisible:async()=>false,waitFor:async()=>{},fill:async()=>{calls.push(selector);throw Error('fill('+secret+')');}};},
    getByTestId(id){return{click:async()=>calls.push(id)};}};
  let error;try{await runCoreJourney(page,{login:{email:'local@example.invalid',password:secret}},{relogin:true,onStep:async row=>steps.push(row)});}catch(e){error=e;}
  assert.equal(error.message,'CORE_UI_LOGIN_FAILED');assert.equal(JSON.stringify(error).includes(secret),false);
  assert.equal(calls[0],'auth-logout');assert.equal(steps[0].name,'logout');
});
await check('source has the inert logout contract and preserves historical fixture positions before the equipment test',async()=>{
  const app=await fs.readFile('balam/app.jsx','utf8');assert.ok(app.includes("'data-testid': 'auth-logout'"));
  assert.ok(source.indexOf("await verify('Core UI journey")<source.indexOf("await verify('Equipment history"));
  assert.ok(source.includes("ids: fixtures.products.slice(0,7)"));
  // Presence only. The executable gate/recovery/guard suites provide the actual behavior proof.
});
await fs.writeFile('docs/fixes/evidence/h171/core-runner-integration-local.json',JSON.stringify({
  scope:'Actual helper bodies via VM and fake DATA; no network. Finalization behavior has separate executable journal integration tests.',
  tests:results.length,passed:results.length,failed:0,results,runnerSha256:journalHash(source),
  helperSha256:journalHash(await fs.readFile('qa-h171-core-journey.mjs','utf8')),certified:false,remoteWrites:0,
},null,2)+'\n');
console.log(results.length+' PASS / 0 FAIL; local helpers only, live gate unchanged');
