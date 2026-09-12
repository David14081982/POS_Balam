// One execution per transport failure contract. No real commercial data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto, randomUUID } from 'node:crypto';

let timerTick, timerMs, realtimeSignal;
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
  channel: () => ({ on(event,filter,fn) { assert.equal(filter.table,"online_snapshot_revision");realtimeSignal=fn;return this; }, subscribe() { return this; } }), removeChannel() {},
  async rpc(name,args) {
    calls.push({ name,args });
    if (name === 'online_presence') return { data: presence ? { ok:true } : false };
    if (name === 'online_adoption_report') return { data: { ok:true, revision:1, state:args.p_report.state } };
    if (name === 'online_connectivity') { if(connectivityHook) await connectivityHook();return { data: { ok:true } }; }
    if (name === 'online_snapshot_if_changed') return { data: snapshotHook ? await snapshotHook(args) : clone(raw) };
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
  fetch,performance,AbortSignal,queueMicrotask,console, setInterval(fn,ms) {timerTick=fn;timerMs=ms;},setTimeout,clearTimeout,
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


let applied=0, configApplied=0, fullReads=0, lightReads=0;
const originalReplace=window.DATA.replaceFromOnline;window.DATA.replaceFromOnline=s=>{applied++;originalReplace(s);};
const originalLoad=window.CONFIG.load;window.CONFIG.load=c=>{configApplied++;originalLoad(c);};
snapshotHook=args=>{
 if(args.p_revision===raw.snapshotRevision){lightReads++;return {unchanged:true,snapshotRevision:raw.snapshotRevision,serverTime:raw.serverTime};}
 fullReads++;return clone(raw);
};
assert.equal(timerMs,15000);
for(let i=0;i<3;i++){timerTick();await S.init();}
assert.equal(fullReads,0);assert.equal(lightReads,3);assert.equal(applied,0);assert.equal(configApplied,0);
pass('15 second safety checks: zero full snapshots, DATA replacements or CONFIG reloads');
raw.products=[product('remote','Remote create')];raw.snapshotRevision='revision-2';
realtimeSignal();await S.pull();await new Promise(r=>setTimeout(r,30));
assert.equal(fullReads,1);assert.equal(projected.products[0].nombre,'Remote create');
pass('Realtime invalidates, authoritative read confirms exactly one changed snapshot');
raw.products=[];raw.snapshotRevision='revision-3';
timerTick();await S.init();assert.equal(projected.products.length,0);assert.equal(fullReads,2);
pass('missed Realtime: safety check replaces remote empty catalogue');
const revision=raw.snapshotRevision;
snapshotHook=()=>({unchanged:true,snapshotRevision:'wrong-revision',serverTime:raw.serverTime});
await assert.rejects(()=>S.pull(),/No pudimos completar/);assert.equal(S.syncStatus().ready,false);
assert.equal(projected.products.length,0);
pass('unchanged response for another revision is rejected without data adoption');
snapshotHook=()=>clone(raw);await S.init();assert.equal(S.syncStatus().ready,true);
pass('authoritative recovery after an invalid revision response');
assert.equal([...storage.keys()].filter(k=>!k.startsWith('balam_online_request_v1:')).length,0);
console.log(JSON.stringify({suite:'H166 conditional transport',passed,fullReads,lightReads,commercialPersistence:0}));
