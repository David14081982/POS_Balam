// One execution per transport failure contract. No real commercial data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, randomUUID } from 'node:crypto';

const actor = randomUUID(), handlers = new Map(), storage = new Map();
let authenticatedActor=actor, connectivityHook=null;
const localStorage = {
  get length() { return storage.size; }, key: index => [...storage.keys()][index] ?? null,
  getItem: key => storage.get(key) ?? null, setItem: (key,value) => storage.set(key,String(value)),
  removeItem: key => storage.delete(key),
};
const keys = ['products','clients','sellers','promotions','sales','saleItems','payments','returns','returnItems',
  'exchanges','exchangeItems','loans','movements','liquidations','commissionAdjustments','lookup','settings'];
const raw = { contractVersion: 1, snapshotRevision: "test-revision", unchanged: false, configVersion: 2, serverTime: '2026-09-12T00:00:00Z',
  commercialQuote: {configVersion:2,promotionsFingerprint:'test',sellersFingerprint:'test'},
  commissionContext:{periodStart:'',sellerBases:[]},
  ...Object.fromEntries(keys.map(key => [key, []])) };
let projected, configState, commitCount = 0, executeHook, snapshotHook, presence = true, unavailableResolution = false;
const receipts = new Map(), calls = [], archived = [];
const clone = value => JSON.parse(JSON.stringify(value));
const client = {
  auth: { getSession: async () => ({ data: { session: { user: { id: authenticatedActor }, access_token: 'test-token' } } }) },
  channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {},
  async rpc(name,args) {
    calls.push({ name,args });
    if (name === 'online_presence') return { data: presence ? { ok:true } : false };
    if (name === 'online_adoption_report') return { data: { ok:true, revision:1, state:args.p_report.state } };
    if (name === 'online_connectivity') { if(connectivityHook) await connectivityHook();return { data: { ok:true } }; }
    if (name === 'online_snapshot_if_changed') return { data: snapshotHook ? await snapshotHook() : clone(raw) };
    if (name === 'archive_online_legacy') {
      archived.push(...args.p_entries);
      return { data: { ok:true, entries: args.p_entries.map(row => ({ ...row, archived:true, classification:'needs_review' })) } };
    }
    if (name === 'resolve_online_request') {
      if (unavailableResolution) throw new Error('Still disconnected');
      if (!receipts.has(args.p_request_id)) receipts.set(args.p_request_id, { ok:false, notExecuted:true, error: { code:'REQUEST_NOT_EXECUTED',message:'No ejecutada' } });
      return { data: receipts.get(args.p_request_id) };
    }
    if (name === 'online_request_result') return {data:receipts.has(args.p_request_id)
      ? {found:true,receipt:receipts.get(args.p_request_id)} : {found:false}};
    if (name === 'execute_online_command') {
      commitCount++;
      return executeHook(args);
    }
    throw new Error('Unexpected RPC ' + name);
  },
};
const window = {
  supabase: { createClient: () => client }, crypto: webcrypto,
  CORE: { getDeviceId: () => 'h164-test', registerSyncGateway() {} },
  CONFIG: { load(next) { configState=clone(next); }, clearRemote() {} },
  DATA: { validateOnlineSnapshot() {}, replaceFromOnline: snapshot => { projected = clone(snapshot); } },
  AUTH: { hasSession: () => true, refreshPermissions: async () => true },
  addEventListener: (event,fn) => handlers.set(event,fn), dispatchEvent() {},
};
const navigator = { onLine:true };
const context = vm.createContext({ window,navigator,localStorage,crypto:webcrypto,Headers,Request,TextEncoder,URL,Blob,
  fetch,performance,AbortSignal,queueMicrotask,console, setInterval() {},setTimeout,clearTimeout,
  document: { addEventListener() {}, hidden:false },
  CustomEvent: class { constructor(type,init) { this.type=type; this.detail=init?.detail; } },
});
vm.runInContext(fs.readFileSync('balam/store.jsx','utf8'),context,{filename:'store.jsx'});
const S = window.STORE;
await S.setSession({ id:actor });
let passed = 0;
const pass = name => { passed++; console.log('PASS ' + name); };
const referenceKeys = () => [...storage.keys()].filter(key => key.startsWith('balam_online_request_v1:'));
const product = (id,name) => ({ id,nombre:name,stock:[],record_model:'v1',sync_version:1 });

if(!process.env.BALAM_TRANSPORT_CASE) {
// Offline means no commercial RPC and no locally stored request or business row.
navigator.onLine=false;
await assert.rejects(() => S.execute({ type:'upsert' }), /Sin conexión\. BALAM necesita internet para continuar\./);
assert.equal(commitCount,0); assert.equal(referenceKeys().length,0); assert.equal(projected.products.length,0);
navigator.onLine=true;
pass('offline: zero commercial requests, effects and new references');

// Rejected domain transaction never reports success or changes projection optimistically.
executeHook=async args => {
  const receipt={ok:false,error:{code:'40001',message:'ENTITY_VERSION_CONFLICT'}};
  receipts.set(args.p_request_id,receipt); return {data:receipt};
};
await assert.rejects(() => S.execute({type:'upsert',rows:[]}),/ENTITY_VERSION_CONFLICT/);
assert.equal(referenceKeys().length,0); assert.equal(projected.products.length,0);
pass('definitive rejection: no success or phantom pending');

// Server commits exactly once then drops its HTTP response; resolve, never resend.
const lostId=randomUUID();
executeHook=async args => {
  raw.products=[product('confirmed','Remoto')];
  receipts.set(args.p_request_id,{ok:true,result:{id:'confirmed'}});
  throw new Error('Response lost after commit');
};
const beforeLost=commitCount;
const confirmed=await S.execute({type:'upsert',operationId:lostId,rows:[{id:'confirmed'}]});
assert.equal(confirmed.ok,true); assert.equal(commitCount,beforeLost+1);
assert.equal(projected.products[0].nombre,'Remoto'); assert.equal(referenceKeys().length,0);
pass('lost response after commit: resolve identity, one commit, remote projection');

// A prolonged outage resumes the original await after authority returns, without another write.
const extendedId=randomUUID(), beforeExtended=commitCount;
unavailableResolution=true;
const original=S.execute({type:'upsert',operationId:extendedId,rows:[{id:'confirmed'}]});
while (S.syncStatus().busy) await new Promise(resolve=>setImmediate(resolve));
assert.equal(S.syncStatus().ready,false);assert.equal(referenceKeys().length,1);
assert.equal(S.syncStatus().message,'Estamos confirmando la operación. No la repitas.');
unavailableResolution=false;await S.refresh();
assert.equal((await original).ok,true);assert.equal(commitCount,beforeExtended+1);
assert.equal(referenceKeys().length,0);
pass('prolonged lost response: original form await resumes after remote confirmation');

// A repeated stable identity returns its first result despite regenerated transient line IDs.
const repeated=await S.execute({type:'upsert',operationId:extendedId,rows:[{id:'different-transient-id'}]});
assert.equal(repeated.ok,true);assert.equal(commitCount,beforeExtended+1);
pass('repeated identity: authoritative receipt is consulted before sending any changed payload');

// An absent request gets a terminal cancellation; delayed execution is forbidden by SQL.
const cancelled=randomUUID();
storage.set('balam_online_request_v1:'+cancelled,JSON.stringify({requestId:cancelled,userId:actor,kind:'sale',fingerprint:'opaque'}));
await S.refresh();
assert.equal(receipts.get(cancelled).notExecuted,true); assert.equal(referenceKeys().length,0);
pass('reload reference: resolve/cancel absent request without commercial replay');

// A pre-commit poll must finish before a write; only a post-commit snapshot authorizes success.
let releaseOld;
snapshotHook=()=>new Promise(resolve => {releaseOld=resolve;});
const poll=S.refresh();
while(!releaseOld) await new Promise(resolve=>setImmediate(resolve));
const old=clone(raw), beforeRace=commitCount;
executeHook=async args => {
  raw.products=[product('confirmed','Nuevo confirmado')];
  const receipt={ok:true,result:{id:'confirmed'}}; receipts.set(args.p_request_id,receipt); return {data:receipt};
};
const writing=S.execute({type:'upsert',rows:[{id:'confirmed',nombre:'Nuevo confirmado'}]});
await new Promise(resolve=>setImmediate(resolve));
assert.equal(commitCount,beforeRace);
snapshotHook=null; releaseOld(old); await poll; await writing;
assert.equal(projected.products[0].nombre,'Nuevo confirmado');
pass('read/write race: a snapshot started before commit cannot certify the write');

// No event delivery is needed: full query restores authority, including authoritative empties.
raw.products=[]; await S.refresh(); assert.equal(projected.products.length,0);
pass('missed realtime/reconnection query: remote empty replaces stale rows');

// A retired presence false is never accepted as online success.
presence=false; await assert.rejects(()=>S.init(),/retirado/); assert.equal(S.syncStatus().ready,false);
presence=true;
pass('heartbeat false: retired device remains blocked');

// Exact migration: preserve original remotely, no replay, preserve unrelated/auth/UI keys.
const legacy=JSON.stringify([{id:randomUUID(),type:'sale',header:{total:117}}]);
storage.set('balam_sync_queue',legacy); storage.set('unrelated-app','keep'); storage.set('balam_auth','keep-auth');
const beforeArchive=commitCount;
await S.init();
assert.equal(commitCount,beforeArchive); assert.equal(storage.has('balam_sync_queue'),false);
assert.equal(archived[0].original,legacy); assert.equal(archived[0].kind,'operation');
assert.equal(storage.get('unrelated-app'),'keep'); assert.equal(storage.get('balam_auth'),'keep-auth');
pass('legacy intake: original archived by hash, no replay, only exact old key removed');

// Source-level boundary for retired runtime: compatibility stubs must not revive queue consumers.
for(const name of ['flushQueue','queueStatus','retryOperation','rebootstrapFromCloud','ensureFolioBlock','clearQueue']) assert.equal(S[name],undefined,name);
for(const name of ['data','config']) assert.doesNotMatch(fs.readFileSync('balam/'+name+'.jsx','utf8'),/localStorage\.(?:getItem|setItem)|indexedDB\.open/);
pass('retired runtime: no queue API and no commercial persistence in DATA/CONFIG');
}

if(!process.env.BALAM_TRANSPORT_CASE || process.env.BALAM_TRANSPORT_CASE === 'config') {
// A setting change preserves the exact existing catalogue order; an explicit move changes only its kind.
raw.lookup=[{kind:'size',code:'M',label:'Mediana',active:true,meta:{custom:1},sort_order:10},
  {kind:'size',code:'L',label:'Grande',active:true,meta:{},sort_order:30},
  {kind:'color',code:'AZ',label:'Azul',active:true,meta:{},sort_order:99}];
raw.settings=[{key:'store.name',value:'Original'}];
await S.refresh();
const settingState=clone(configState);settingState.settings['store.name']='Actualizado';
let sentConfig;
executeHook=async args=>{sentConfig=clone(args.p_command);raw.lookup=clone(sentConfig.lookup);raw.settings=clone(sentConfig.settings);
  const receipt={ok:true,result:{version:3}};receipts.set(args.p_request_id,receipt);return {data:receipt};};
const originalLookup=clone(raw.lookup);
await S.execute({type:'config',state:settingState});
assert.deepEqual(sentConfig.lookup,originalLookup);
assert.equal(sentConfig.settings.find(row=>row.key==='store.name').value,'Actualizado');
const movedState=clone(configState);movedState.catalogs.size.reverse();
await S.execute({type:'config',state:movedState});
assert.deepEqual(sentConfig.lookup.filter(row=>row.kind==='size').map(row=>[row.code,row.sort_order]),[['L',0],['M',1]]);
assert.deepEqual(sentConfig.lookup.find(row=>row.kind==='color'),originalLookup.find(row=>row.kind==='color'));
pass('configuration: preserve historical order on settings; reorder only the requested catalogue');
}

if(!process.env.BALAM_TRANSPORT_CASE || process.env.BALAM_TRANSPORT_CASE === 'session') {
// A different authenticated user arriving during the probe cannot receive the original draft.
const beforeSession=commitCount;
connectivityHook=async()=>{
  connectivityHook=null;authenticatedActor=randomUUID();
  await S.setSession({id:authenticatedActor}).catch(()=>{});
};
await assert.rejects(()=>S.execute({type:'upsert',rows:[{id:'belongs-to-first-user'}]}),error=>error.code==='SESSION_CHANGED');
assert.equal(commitCount,beforeSession);assert.equal(referenceKeys().length,0);
pass('session changed during request: zero commands or references under the other user');
}
console.log(`${passed} PASS / 0 FAIL`);
