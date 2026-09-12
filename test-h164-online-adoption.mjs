// H164: one case per startup/adoption failure, no commercial server writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync('balam/store.jsx', 'utf8');
const collections = ['products','clients','sellers','promotions','sales','saleItems','payments','returns','returnItems',
  'exchanges','exchangeItems','loans','movements','liquidations','commissionAdjustments','lookup','settings'];
function fixture(options = {}) {
  const storage = new Map(Object.entries(options.storage || {})), calls = [], states = [], handlers = new Map();
  let projected = null;
  const snapshot = { contractVersion:1, configVersion:1, serverTime:new Date().toISOString(),
    commercialQuote:{configVersion:1,promotionsFingerprint:'fixture',sellersFingerprint:'fixture'},
    commissionContext:{periodStart:'',sellerBases:[]}, legacyReviewCount:1,
    ...Object.fromEntries(collections.map(key => [key, []])) };
  const localStorage = { get length() { return storage.size; }, key:i => [...storage.keys()][i] ?? null,
    getItem:k => storage.get(k) ?? null, setItem:(k,v) => storage.set(k,String(v)), removeItem:k => storage.delete(k) };
  const client = { auth:{getSession:async () => ({data:{session:{user:{id:'actor'}}}})},
    channel:() => {if(options.realtimeFailure)throw new Error('Realtime unavailable');return {on(){return this;},subscribe(){return this;}};}, removeChannel(){},
    async rpc(name,args) {
      calls.push({name,args});
      const custom = await options.rpc?.(name,args,{storage,states});
      if (custom !== undefined) return custom;
      if (name === 'online_presence' || name === 'online_connectivity') return {data:{ok:true}};
      if (name === 'online_snapshot') return {data:structuredClone(snapshot)};
      if (name === 'archive_online_legacy') return {data:{ok:true,entries:args.p_entries.map(row => ({sourceKey:row.sourceKey,hash:row.hash,archived:true,classification:'needs_review'}))}};
      if (name === 'online_adoption_report') return {data:{ok:true,revision:1,state:args.p_report.state,serverTime:new Date().toISOString()}};
      throw new Error('Unexpected RPC '+name);
    } };
  const window = {supabase:{createClient:() => client},
    CORE:{getDeviceId:() => 'existing-device',registerSyncGateway(){}},
    CONFIG:{load(){},clearRemote(){}}, DATA:{validateOnlineSnapshot(){},replaceFromOnline:next => {projected=next;}},
    AUTH:{hasSession:() => true,refreshPermissions:async () => true},
    addEventListener:(name,fn) => handlers.set(name,fn),
    dispatchEvent:event => {if(event.type==='syncstatuschange')states.push(event.detail);},
    indexedDB:options.indexedDB,
  };
  const navigator = {onLine:true};
  vm.runInNewContext(source,{window,navigator,localStorage,indexedDB:options.indexedDB,crypto:webcrypto,Headers,Request,
    TextEncoder,URL,Blob,fetch,performance,AbortSignal,queueMicrotask,console,setInterval(){},setTimeout,clearTimeout,
    document:{hidden:false,addEventListener(){}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail;}}});
  return {S:window.STORE,storage,calls,states,handlers,navigator,get projected(){return projected;}};
}
const cases = {
  async foreign_receipt() {
    const key='balam_online_request_v1:11111111-1111-4111-8111-111111111111';
    const original=JSON.stringify({requestId:'11111111-1111-4111-8111-111111111111',userId:'other-actor',kind:'sale',fingerprint:'technical-only'});
    const f=fixture({storage:{[key]:original}});
    await f.S.setSession({});
    assert.equal(f.S.syncStatus().ready,true);
    assert.equal(f.S.syncStatus().hasUnresolvedRequests,false,'Only this actor owns the live confirmation gate');
    assert.equal(f.storage.get(key),original,'Preserve the other actor receipt without resolving or deleting it');
    assert.equal(f.calls.some(c=>c.name==='resolve_online_request'||/execute|commit/.test(c.name)),false);
  },
  async realtime() {
    const f=fixture({realtimeFailure:true});await f.S.setSession({});
    assert.equal(f.S.syncStatus().ready,true,'Realtime must not invalidate a confirmed HTTP snapshot');
    await f.S.refresh();assert.equal(f.S.syncStatus().ready,true);
  },
  async sql() {
    const f=fixture({rpc:name => name==='online_snapshot'?{status:403,error:{code:'42501',message:'permission denied'}}:undefined});
    await assert.rejects(f.S.setSession({}),/permission denied/);
    assert.equal(f.S.syncStatus().connection,'error');
    assert.doesNotMatch(f.S.syncStatus().message,/Sin conexión/);
    assert.equal(f.S.syncStatus().ready,false);
    assert.equal(f.calls.findLast(c=>c.name==='online_adoption_report').args.p_report.code,'SQL_42501');
  },
  async offline() {
    const f=fixture({rpc:name => {if(name==='online_presence')throw new TypeError('Failed to fetch');}});
    await assert.rejects(f.S.setSession({}),/Failed to fetch/);
    assert.equal(f.S.syncStatus().connection,'offline');
    assert.equal(f.S.syncStatus().message,'Sin conexión. BALAM necesita internet para continuar.');
    assert.equal(f.storage.size,0);
  },
  async archive() {
    const original='[{"id":"legacy-real","type":"sale"}]';
    const f=fixture({storage:{balam_sync_queue:original,balam_auth:'keep',balam_device_id:'existing-device'},
      rpc:name => name==='archive_online_legacy'?{data:{ok:true,entries:[]}}:undefined});
    await assert.rejects(f.S.setSession({}),e=>e.code==='LEGACY_EVIDENCE_NOT_ARCHIVED');
    assert.equal(f.storage.get('balam_sync_queue'),original);
    assert.equal(f.storage.get('balam_auth'),'keep');
    assert.equal(f.S.syncStatus().connection,'error');
    assert.equal(f.calls.some(c=>c.name==='online_snapshot'),false);
  },
  async adoption() {
    const original='[{"id":"legacy-real","type":"sale"}]';
    const f=fixture({storage:{balam_sync_queue:original,balam_device_id:'existing-device',balam_auth:'keep',unrelated:'keep'},
      rpc:(name,args,{states})=>{
        if(name==='online_adoption_report' && args.p_report.state==='ready') {
          assert.equal(states.some(s=>s.ready),false,'no readiness before completion ACK');
          assert.equal(args.p_report.remainingLegacy,0);
          assert.equal(args.p_report.archivedCount,1);
        }
      }});
    await f.S.setSession({});
    assert.equal(f.S.syncStatus().ready,true);assert.equal(f.S.syncStatus().adoption.state,'ready');
    assert.equal(f.S.syncStatus().legacyReviewCount,1,'individual case does not block device');
    assert.equal(f.storage.has('balam_sync_queue'),false);
    assert.deepEqual([...f.storage.keys()].sort(),['balam_auth','balam_device_id','unrelated']);
    assert.equal(f.calls.filter(c=>c.name==='archive_online_legacy').length,1);
    assert.equal(f.calls.some(c=>/execute|commit/.test(c.name)),false);
  },
  async changing_source() {
    const f=fixture({storage:{balam_sync_queue:'[]'},rpc:(name,args,{storage})=>{
      if(name==='archive_online_legacy')storage.set('balam_sync_queue','[{"id":"newer"}]');
    }});
    await assert.rejects(f.S.setSession({}),e=>e.code==='LEGACY_SOURCE_CHANGED');
    assert.equal(f.storage.get('balam_sync_queue'),'[{"id":"newer"}]');
    assert.equal(f.S.syncStatus().ready,false);
    assert.equal(f.calls.some(c=>c.name==='online_adoption_report'&&c.args.p_report.state==='ready'),false);
  },
  async completion_ack() {
    let lose=true;
    const f=fixture({rpc:(name,args)=>{
      if(name==='online_adoption_report'&&args.p_report.state==='ready'&&lose)throw new TypeError('Failed to fetch');
    }});
    await assert.rejects(f.S.setSession({}),/Failed to fetch/);
    assert.equal(f.S.syncStatus().ready,false);
    lose=false;await f.S.init();
    assert.equal(f.S.syncStatus().ready,true);
    assert.equal(f.calls.some(c=>/execute|commit/.test(c.name)),false);
  },
  async indexeddb_blocked() {
    const blocked = {open(){const request={};queueMicrotask(()=>request.onblocked?.());return request;}};
    const f=fixture({indexedDB:blocked});
    await assert.rejects(f.S.setSession({}),e=>e.code==='LEGACY_STORAGE_BLOCKED');
    assert.equal(f.S.syncStatus().connection,'error');
    assert.equal(f.calls.some(c=>c.name==='online_snapshot'),false);
  },
  async legacy_other_tab() {
    const f=fixture();await f.S.setSession({});
    f.storage.set('balam_sync_queue','[]');
    f.handlers.get('storage')({key:'balam_sync_queue',newValue:'[]'});
    assert.equal(f.S.syncStatus().ready,false);
    await f.S.init();
    assert.equal(f.storage.has('balam_sync_queue'),false);
    assert.equal(f.S.syncStatus().ready,true);
  },
};
for(const [name,run] of Object.entries(cases)) {
  if(process.env.BALAM_ADOPTION_CASE && process.env.BALAM_ADOPTION_CASE!==name)continue;
  await run();console.log('PASS '+name);
}
