// H171 local provenance assembler. No I/O, no SQL execution, no authorization.
// Canonical bodies belong in private artifacts; hashes below never reserialize them.
import { createHash } from 'node:crypto';
import { journalHash } from './h171-live-journal.mjs';
import { postgresJsonbHash } from './h171-live-reconciliation.mjs';
import { SNAPSHOT_PROJECT, SNAPSHOT_ACTOR, validateLiveSnapshot, diffLiveSnapshots } from './h171-live-snapshot.mjs';
import { LIVE_CLEANUP_ORDER } from './h171-live-cleanup-sql.mjs';

const SHA = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SECRET = /password|authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|cookie|secret|jwt/i;
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const same = (a,b) => journalHash(a) === journalHash(b);
const clean = v => Array.isArray(v) ? v.map(clean) : v && typeof v === 'object'
  ? Object.fromEntries(Object.entries(v).filter(([k]) => !SECRET.test(k)).map(([k,x]) => [k,clean(x)])) : v;
const hasSecret = v => !!v && typeof v === 'object' && Object.entries(v).some(([k,x]) =>
  (SECRET.test(k) && x !== null) || hasSecret(x));
const key = (table,pk) => table + ':' + journalHash(pk);
const uuidFromMd5 = text => { const h=createHash('md5').update(text).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
const profileRequestId = id => { const h=journalHash(JSON.stringify(id+':profile'));return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; };
const protectedValues = new Set([SNAPSHOT_ACTOR,'BG-260912-0001',
  'cli-1789078624431-0fz3','cli-1789078938103-ams0','cli-1789079431176-jyxi','promo-1789079431430',
  'qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c-B','qa-h148-b766e373-5279-4e4a-818e-0934a4f8757c-C']);
const sharedParents = new Set(['operational_capabilities','permission_roles','screen_permission_catalog']);
const scalarLinks = [
  ['sale_payments','folio','sales','folio'],['sale_commits','folio','sales','folio'],
  ['sale_payments','folio','exchanges','folio'],['movements','ref','exchanges','folio'],
  ['layaway_liquidation_commits','folio','sales','folio'],['stock_reservations','folio','sales','folio'],
  ['sale_items','product_id','products','id'],['return_items','product_id','products','id'],['exchange_items','product_id','products','id'],
  ['returns','folio','sales','folio'],['return_commits','return_id','returns','id'],['return_commits','folio','sales','folio'],
  ['exchanges','origen_folio','sales','folio'],['exchanges','vendedor_id','sellers','id'],['exchange_commits','exchange_id','exchanges','id'],
  ['movements','product_id','products','id'],['movements','return_id','returns','id'],['movements','ref','sales','folio'],
  ['reference_reclassifications','source_product_id','products','id'],['reference_reclassifications','target_product_id','products','id'],
  ['reference_reclassifications','reversal_of','reference_reclassifications','operation_id'],
  ['reference_reclassifications','reversed_by','reference_reclassifications','operation_id'],
  ['liquidations','seller_id','sellers','id'],['commission_adjustments','seller_id','sellers','id'],
  ['online_requests','device_id','sync_devices','device_id'],['config_commits','device_id','sync_devices','device_id'],
];

// This is retained authority metadata, never a cleanup target. A new business
// day is admitted only when this run's confirmed one-folio allocations explain
// every sequence, beginning at 1. Foreign/unexplained increments remain held.
export function proveNewFolioCounter({row,contexts,actorId,run}) {
  if(row.table!=='folio_counters')return null;
  const body=row.body||JSON.parse(row.row_json_text),allocations=new Map();
  for(const x of contexts){const {c,response:r,e,id}=x,b=x.r?.body;
    if(c?.type!=='folio'||r?.prefix!==body.prefix||r?.business_date!==body.business_date)continue;
    const day=/^\d{6}$/.test(c.businessDate||'')?'20'+c.businessDate.slice(0,2)+'-'+c.businessDate.slice(2,4)+'-'+c.businessDate.slice(4):c.businessDate;
    if(e.actorId!==actorId||c.expectedActorId!==actorId||b?.actor_id!==actorId||b.request_id!==id||
      b.state!=='confirmed'||b.command_kind!=='folio'||b.command_hash!==postgresJsonbHash(c)||
      !same(b.response?.result,r)||b.response?.ok!==true||b.response?.requestId!==id||
      !UUID.test(id)||!SHA.test(e.entryHash||'')||!/^\d{4}-\d{2}-\d{2}$/.test(day||'')||
      !/^[A-Z0-9]{1,6}$/.test(c.prefix||'')||c.prefix!==body.prefix||day!==body.business_date||c.floor!==0||
      r.ok!==true||!Number.isSafeInteger(r.from)||r.from<1||r.from!==r.to||
      r.folio!==`${body.prefix}-${day.slice(2).replaceAll('-','')}-${String(r.from).padStart(c.documentKind==='loan'?3:4,'0')}`)return null;
    allocations.set(id,{requestId:id,sequence:r.from,intentSha256:e.entryHash,receiptFullRowMd5:x.r.full_row_md5});
  }
  const proof=[...allocations.values()].sort((a,b)=>a.sequence-b.sequence);
  if(!Number.isSafeInteger(body.last_seq)||body.last_seq<1||proof.length!==body.last_seq||
    proof.some((p,i)=>p.sequence!==i+1||!/^[a-f0-9]{32}$/.test(p.receiptFullRowMd5||'')))return null;
  return {table:'folio_counters',pk_json_text:row.pk_json_text,after_full_md5:row.full_row_md5,
    provenanceSha256:journalHash({actorId,run,allocations:proof}),actorId,run,allocations:proof};
}

// SQL stock/commission writes record sale:<commit UUID>, not an installation ID
// (20260725001700:168 / 20260725001900:266). Admit only the exact returned
// current row of a confirmed sale from a separately proven new QA installation.
export function proveConfirmedSaleWrite({row,context,device,presence,observation,actorId,run,
  newRow=false,newDevice=false,principalProven=false}) {
  const x=context,c=x?.c,b=x?.r?.body,e=x?.e,id=x?.id,d=device?.body;
  if(!newRow||!newDevice||!principalProven||!['products','sellers'].includes(row.table)||
    !UUID.test(id||'')||row.body.sync_device_id!=='sale:'+id||c?.type!=='sale'||
    e?.kind!=='rpc:execute_online_command'||e.actorId!==actorId||e.requestId!==id||
    !SHA.test(e.entryHash||'')||c.expectedActorId!==actorId||c.operationId!==id||
    b?.actor_id!==actorId||b.request_id!==id||b.state!=='confirmed'||b.command_kind!=='sale'||
    b.command_hash!==postgresJsonbHash(c)||b.response?.ok!==true||b.response?.requestId!==id||
    !['A','B','C'].some(label=>b.device_id===`qa-h164-${run}-${label}`)||
    d?.device_id!==b.device_id||d.user_id!==actorId||!['online','revoked'].includes(d.status)||
    d.metadata?.online_only!==true||presence?.kind!=='rpc:online_presence'||presence.actorId!==actorId||
    presence.identities?.deviceId!==d.device_id||presence.command?.p_device_id!==d.device_id||
    presence.command?.p_client_build!==d.client_build||!SHA.test(presence.entryHash||'')||
    !observation?.sequences?.includes(presence.sequence)||
    observation.observedContentSha256!==postgresJsonbHash(clean(d)))return null;
  const response=b.response.result,echo=response?.[row.table]?.find(value=>value.id===row.body.id);
  if(response?.ok!==true||response.sale?.operation_id!==id||response.sale?.folio!==c.header?.folio||
    !echo||postgresJsonbHash(clean(echo))!==postgresJsonbHash(clean(row.body)))return null;
  const expected=row.table==='products'?(c.expectedProducts||[]).find(value=>value.id===row.body.id):
    (c.sellerEffects||[]).find(value=>value.id===row.body.id);
  const version=expected?.[row.table==='products'?'version':'base_version'];
  if(!Number.isSafeInteger(version)||row.body.sync_version!==version+1||
    (row.table==='products'?!c.items?.some(value=>value.product_id===row.body.id&&value.qty>0)||
      !c.stockLines?.some(value=>value.product_id===row.body.id&&value.qty>0):
      !c.header?.vendedores?.includes(row.body.id)))return null;
  return {kind:'CONFIRMED_SALE_WRITE_MARKER',requestId:id,deviceId:d.device_id,
    intentSha256:e.entryHash,receiptFullRowMd5:x.r.full_row_md5,presenceIntentSha256:presence.entryHash};
}

/** All inputs are already durable, private local evidence. This is not a verifier
 * of filesystem durability or a substitute for a fresh locked SQL preflight.
 * authBaseline is a complete, separately backed Auth ID census taken before the
 * first mutation, bound to baselineSnapshot. Auth retirement remains GoTrue-only. */
export function buildLiveCleanupPlan({journalSnapshot,fixtures,reconciliation,baselineSnapshot,currentSnapshot,
  catalog,sourceUrl,backup,authBaseline=null,clientBuild='2026-09-12-h166-online'}) {
  const baseline=validateLiveSnapshot(baselineSnapshot,{catalog,sourceUrl}).snapshot;
  const current=validateLiveSnapshot(currentSnapshot,{catalog,sourceUrl}).snapshot;
  need(same(baseline.catalog,current.catalog),'PLAN_CATALOG_CHANGED');
  const actorId=fixtures?.userId,run=journalSnapshot?.run,prefix='qa-h164-'+run;
  need(UUID.test(actorId||'') && actorId!==SNAPSHOT_ACTOR && UUID.test(run||''),'PLAN_QA_IDENTITY_REQUIRED');
  need(journalSnapshot?.format==='balam-live-journal-v1' && journalSnapshot.projectRef===SNAPSHOT_PROJECT && SHA.test(journalSnapshot.artifactSha256),'PLAN_JOURNAL_BINDING');
  need(fixtures.run===run && fixtures.prefix===prefix && fixtures.email===prefix+'@example.test' &&
    same(fixtures.installations,['A','B','C'].map(x=>prefix+'-'+x)),'PLAN_FIXTURE_BINDING');
  need(SHA.test(backup?.baselineFileSha256) && SHA.test(backup?.currentFileSha256),'PLAN_DURABLE_BACKUP_REQUIRED');
  const entries=journalSnapshot.entries;
  need(Array.isArray(entries) && entries.length>0,'PLAN_EMPTY_JOURNAL');
  let previous=null;
  for(const [i,e] of entries.entries()) {
    const {entryHash,...body}=e;
    need(e.sequence===i+1 && e.previousHash===previous && entryHash===journalHash(body) && e.commandHash===journalHash(e.command),'PLAN_JOURNAL_INTEGRITY');
    need(e.actorId===actorId || e.kind==='auth-principal' && e.identities?.userId===actorId || e.kind==='fixture-plan'&&!e.actorId,'PLAN_JOURNAL_ACTOR');
    need(!hasSecret(e.command),'PLAN_JOURNAL_SECRET');previous=entryHash;
  }
  need(reconciliation?.format==='balam-live-reconciliation-v1' && reconciliation.readOnly===true && reconciliation.reconciled===true &&
    reconciliation.blockers?.length===0 && reconciliation.projectRef===SNAPSHOT_PROJECT && reconciliation.actorId===actorId && reconciliation.run===run &&
    reconciliation.artifactSha256===journalSnapshot.artifactSha256 && reconciliation.snapshotSha256===journalHash(journalSnapshot) &&
    reconciliation.lastEntryHash===previous,'PLAN_RECONCILIATION_BINDING');
  need(reconciliation.entries?.length===entries.length && reconciliation.entries.every((r,i)=>r.sequence===entries[i].sequence &&
    r.kind===entries[i].kind && r.requestId===entries[i].requestId && (['TERMINAL_RECEIPT','OBSERVED_FINAL_STATE'].includes(r.state)||
      r.kind==='fixture-plan'&&r.state==='METADATA_ONLY'&&r.observedMutations===false&&r.identityAttribution==='NONE') && !r.blocker),'PLAN_RECONCILIATION_ENTRIES');
  const schema=new Map(catalog.map(t=>[t.table,t])), rows=new Map(), before=new Map(), byTable=new Map();
  const flatten = snapshot => snapshot.tables.flatMap(t=>t.rows.map(r=>({table:t.table,...r})));
  for(const [snapshot,index] of [[baseline,before],[current,rows]]) for(const r of flatten(snapshot)) {
    const pk=JSON.parse(r.pk_json_text),body=JSON.parse(r.row_json_text),definition=schema.get(r.table);
    need(same(Object.keys(pk).sort(),[...definition.pk].sort()) && definition.pk.every(k=>pk[k]===body[k]) &&
      Object.values(pk).every(v=>typeof v!=='number'||Number.isSafeInteger(v)),'PLAN_PK_BODY_OR_PRECISION');
    const id=key(r.table,pk);need(!index.has(id),'PLAN_DUPLICATE_PK');index.set(id,{...r,pk,body,id});
  }
  for(const r of rows.values()) {if(!byTable.has(r.table))byTable.set(r.table,[]);byTable.get(r.table).push(r);}
  const table = t => byTable.get(t)||[];
  const one = (t,p) => rows.get(key(t,p));
  const where = (t,p) => table(t).filter(r=>Object.entries(p).every(([k,v])=>r.body[k]===v));
  const observed=new Map((reconciliation.identities?.rows||[]).map(r=>[key(r.table,r.pk),r]));
  const requests=reconciliation.identities?.requests||[], proven=new Map(), held=new Map(), blockers=[];
  const hold = (r,reason) => { if(!r)return;const old=held.get(r.id);if(!old)held.set(r.id,{table:r.table,pk_json_text:r.pk_json_text,reason});proven.delete(r.id); };
  const proof = (e,requestId,receipt,kind='SERVER_TERMINAL_RECEIPT') => ({actorId,run,requestId,
    intentSha256:e.entryHash,receiptSha256:journalHash(receipt?.row_json_text ?? {entryHash:e.entryHash,observation:receipt}),kind,sequence:e.sequence});
  const offer = (r,p,relation=null) => {
    if(!r || held.has(r.id))return;
    if(before.has(r.id)){hold(r,'BASELINE_PREEXISTING');return;}
    if(Object.values(r.pk).some(v=>protectedValues.has(v))){hold(r,'PROTECTED_IDENTITY');return;}
    if(!LIVE_CLEANUP_ORDER.includes(r.table)){hold(r,'TABLE_OUTSIDE_RUNNER_SCOPE');return;}
    if(Object.values(r.omitted_column_nullity).some(v=>!v)||hasSecret(r.body)){hold(r,'NONRESTORABLE_SECRET');return;}
    let writeProof=null;
    if(r.body.sync_device_id && !fixtures.installations.includes(r.body.sync_device_id)){
      const id=r.body.sync_device_id.startsWith('sale:')?r.body.sync_device_id.slice(5):null;
      const context=contexts.find(x=>x.id===id&&x.c.type==='sale'),device=context?one('sync_devices',{device_id:context.r.body.device_id}):null;
      const presence=entries.filter(e=>e.kind==='rpc:online_presence'&&e.actorId===actorId&&
        e.identities?.deviceId===device?.body.device_id&&e.command?.p_device_id===device?.body.device_id).at(-1);
      writeProof=proveConfirmedSaleWrite({row:r,context,device,presence,observation:observed.get(device?.id),actorId,run,
        newRow:!before.has(r.id),newDevice:!!device&&!before.has(device.id),principalProven:ownedAuth.has(actorId)});
      if(!writeProof){hold(r,'FOREIGN_WRITE_DEVICE');return;}
    }
    const actorColumn={online_requests:'actor_id',online_account_requests:'actor_id',capability_operation_audit:'actor_user_id',
      reference_reclassifications:'actor_user_id',commission_adjustments:'actor_user_id',permission_change_audit:'actor_user_id',sync_devices:'user_id'}[r.table];
    if(actorColumn&&r.body[actorColumn]!==actorId){hold(r,'RECEIPT_ACTOR_MISMATCH');return;}
    const seen=observed.get(r.id);
    if(seen?.observedContentSha256 && seen.observedContentSha256!==postgresJsonbHash(clean(r.body))){hold(r,'CHANGED_SINCE_RECONCILIATION');return;}
    if(!UUID.test(p.requestId||'')){hold(r,'NO_UUID_INTENT_OR_RECEIPT');return;}
    if(!proven.has(r.id))proven.set(r.id,{row:r,provenance:{...p,...(relation?{relation}: {}),...(writeProof?{lastConfirmedWrite:writeProof}:{})}});
  };
  const receipt = (id,command,e) => {
    const r=one('online_requests',{actor_id:actorId,request_id:id}),b=r?.body;
    need(b && requests.some(x=>x.table==='online_requests'&&x.actorId===actorId&&x.requestId===id&&x.state===b.state&&
      x.contentSha256===postgresJsonbHash(clean(b))),'PLAN_CANONICAL_RECEIPT_RECONCILIATION');
    need(['confirmed','rejected','cancelled'].includes(b.state)&&b.response?.requestId===id&&b.response.ok===(b.state==='confirmed'),'PLAN_RECEIPT_TERMINAL');
    need(b.state==='cancelled' ? b.response.notExecuted===true&&!b.command_hash : command && command.expectedActorId===actorId &&
      b.command_kind===command.type&&b.command_hash===postgresJsonbHash(command),'PLAN_RECEIPT_COMMAND_BINDING');
    offer(r,proof(e,id,r));return r;
  };
  const contexts=[],ownedAuth=new Map(),accountProofs=[];
  const expand = (e,command,response,id,rootReceipt) => {
    if(command.type==='batch') {
      need(Array.isArray(command.commands)&&Array.isArray(response)&&command.commands.length===response.length,'PLAN_BATCH_BINDING');
      command.commands.forEach((c,i)=>expand(e,c,response[i],uuidFromMd5(id+':'+(i+1)),rootReceipt));
    } else contexts.push({e,c:command,response,id,r:rootReceipt,p:proof(e,id,rootReceipt)});
  };
  const principalEntry=entries.find(e=>e.kind==='auth-create'&&e.identities?.userId===actorId&&e.command.qaRun===run&&e.command.emailSha256===journalHash(fixtures.email));
  const principalObservation=(reconciliation.identities?.authUsers||[]).find(u=>u.id===actorId&&u.emailSha256===journalHash(fixtures.email));
  if(principalEntry&&principalObservation)ownedAuth.set(actorId,proof(principalEntry,principalEntry.requestId,principalObservation,'OBSERVED_NODE_INTENT_NOT_SERVER_RECEIPT'));
  else blockers.push({code:'AUTH_PRINCIPAL_CREATION_NOT_PROVEN'});
  // Establish the separately created Auth target before permissions/profile proof.
  for(const e of entries.filter(e=>e.kind.startsWith('edge:admin-users:')||['account-prepare','account-advance'].includes(e.kind))) {
    const r=one('online_account_requests',{actor_id:actorId,request_id:e.requestId}),b=r?.body;
    need(b&&requests.some(x=>x.table==='online_account_requests'&&x.actorId===actorId&&x.requestId===e.requestId&&x.state===b.state&&
      x.contentSha256===postgresJsonbHash(clean(b))),'PLAN_ACCOUNT_RECEIPT_BINDING');
    need(['completed','rejected','cancelled'].includes(b.state),'PLAN_ACCOUNT_NONTERMINAL');
    if(e.kind==='account-prepare')need(b.payload_hash===journalHash(e.command),'PLAN_ACCOUNT_INTENT_HASH');
    if(e.kind==='account-advance')need(b.state===e.command.state&&b.target_user_id===e.command.targetUserId,'PLAN_ACCOUNT_ADVANCE');
    if(e.command.action&&e.command.action!=='resolve')need(e.command.action===b.action,'PLAN_ACCOUNT_ACTION');
    if(e.command.emailSha256)need(e.command.emailSha256===journalHash(String(b.payload?.email||'').trim().toLowerCase()),'PLAN_ACCOUNT_EMAIL');
    if(e.command.targetUserId)need(e.command.targetUserId===b.target_user_id,'PLAN_ACCOUNT_TARGET');
    const p=proof(e,e.requestId,r);offer(r,p);
    if(b.state!=='completed'){need(b.result?.ok===false&&!b.target_user_id,'PLAN_FAILED_ACCOUNT_TARGET');continue;}
    const target=b.target_user_id,auth=(reconciliation.identities?.authUsers||[]).find(u=>u.id===target);
    need(b.action==='create'&&UUID.test(target||'')&&target!==actorId&&target!==SNAPSHOT_ACTOR&&b.result?.ok===true&&
      b.result.id===target&&b.result.requestId===e.requestId&&b.payload?.email===prefix+'-account@example.test'&&
      auth?.emailSha256===journalHash(b.payload.email),'PLAN_ACCOUNT_CREATION_PROOF');
    ownedAuth.set(target,p);accountProofs.push({target,requestId:e.requestId});
    const command=structuredClone(b.payload.profileCommand);need(command?.type==='profileUpdate'&&command.rows?.length===1,'PLAN_ACCOUNT_PROFILE_COMMAND');
    command.rows[0].id=target;const id=profileRequestId(e.requestId),child=receipt(id,command,e);
    need(child.body.state==='confirmed','PLAN_ACCOUNT_PROFILE_CONFIRMATION');expand(e,command,child.body.response.result,id,child);
  }
  for(const e of entries.filter(e=>e.kind==='rpc:execute_online_command'||e.kind==='rpc:resolve_online_request')) {
    const original=e.kind==='rpc:execute_online_command'?e:entries.find(x=>x.kind==='rpc:execute_online_command'&&x.requestId===e.requestId);
    const r=receipt(e.requestId,original?.command,e);
    if(r.body.state==='confirmed'){need(original,'PLAN_RESOLUTION_WITHOUT_INTENT');expand(original,original.command,r.body.response.result,e.requestId,r);}
  }
  for(const e of entries) {
    if(e.kind==='profile-provisioning')for(const expected of e.command.rows||[]) {
      const ids=[prefix+'-admin',...['A','B','C'].map(x=>prefix+'-seller-'+x)],r=one('sellers',{id:expected.id}),o=observed.get(r?.id);
      if(ids.includes(expected.id)&&fixtures.sellers?.includes(expected.id)&&e.identities.profileIds?.includes(expected.id)&&o?.sequences.includes(e.sequence)&&o.observedContentSha256)
        offer(r,proof(e,e.requestId,{observedContentSha256:o.observedContentSha256},'OBSERVED_NODE_INTENT_NOT_SERVER_RECEIPT'));
    }
    if(e.kind==='role-provisioning'&&ownedAuth.has(e.identities?.userId)) {
      const r=one('user_permission_role_assignments',{user_id:e.identities.userId}),o=observed.get(r?.id);
      if(o?.sequences.includes(e.sequence)&&o.observedContentSha256)offer(r,proof(e,e.requestId,{observedContentSha256:o.observedContentSha256},'OBSERVED_NODE_INTENT_NOT_SERVER_RECEIPT'));
    }
  }
  const allowedEntities=new Set(['products','clients','sellers','promotions']);
  for(const x of contexts) {
    const {c,response,id,p,e}=x;
    const audit=one('capability_operation_audit',{operation_id:id});
    if(audit?.body.actor_user_id===actorId)offer(audit,p,'EXACT_OPERATION_ID');
    if(['upsert','profileUpdate','staffUpdate'].includes(c.type)&&allowedEntities.has(c.kind))for(const value of c.rows||[]) {
      const echoed=(Array.isArray(response)?response:response?.[c.kind]||[]).some(r=>r.id===value.id);
      const creating=value.sync_base_version===0||(c.kind==='sellers'&&ownedAuth.has(value.id)&&c.accountRequestId===accountProofs.find(x=>x.target===value.id)?.requestId);
      if(echoed && creating && (c.kind!=='sellers'||fixtures.sellers?.includes(value.id)||ownedAuth.has(value.id)))offer(one(c.kind,{id:value.id}),p,'EXPLICIT_CREATE_VERSION_AND_RETURNED_ID');
    }
    if(c.type==='config') {
      offer(one('config_commits',{operation_id:id}),p,'EXACT_CONFIG_OPERATION');
      for(const setting of c.settings||[])offer(one('settings',{key:setting.key}),p,'EXPLICIT_CONFIG_KEY');
    }
    const parentTable={sale:'sales',return:'returns',exchange:'exchanges',loanOperation:'loan_documents',referenceReclassification:'reference_reclassifications',commissionAdjustment:'commission_adjustments',commissionSettle:'liquidations'}[c.type];
    let parent=null;
    if(parentTable) {
      const pk=c.type==='sale'?{folio:c.header?.folio||c.folio}:c.type==='loanOperation'?{id:c.loan?.id}:
        ['referenceReclassification','commissionAdjustment'].includes(c.type)?{operation_id:id}:c.type==='commissionSettle'?{id:'liq-'+id}:{id:c.header?.id};
      if(Object.values(pk).every(v=>v!==undefined&&v!==null))parent=one(parentTable,pk);
      const creates=c.type==='sale'?c.mode!=='layaway_liquidation'&&!c.expectedSale:c.type==='loanOperation'?c.action==='deliver'&&Number(c.expectedVersion||0)===0:true;
      if(parent&&creates)offer(parent,p,'EXACT_COMMAND_DOCUMENT_ID');
    }
    if(c.type==='referenceReclassification'&&parent)for(const movement of where('movements',{operation_id:id})) {
      const b=movement.body,expected=b.product_id===c.sourceProductId?-Number(c.quantity):b.product_id===c.targetProductId?Number(c.quantity):null;
      if(expected!==null&&Number(b.cant)===expected)offer(movement,p,'EXACT_RECLASSIFICATION_OPERATION_AND_PRODUCT');
    }
    if(['sale','return','exchange'].includes(c.type)&&parent) {
      const childTable=c.type==='sale'?'sale_items':c.type+'_items',column=c.type==='sale'?'folio':c.type+'_id',value=c.type==='sale'?parent.body.folio:parent.body.id;
      for(const child of where(childTable,{[column]:value})) {
        const matches=(c.items||[]).some(item=>item.product_id===child.body.product_id&&Number(item.qty)===Number(child.body.qty)&&
          ['line_id','lado','source_sale_line_id'].every(k=>item[k]==null||item[k]===child.body[k]));
        if(matches&&observed.get(child.id)?.sequences.includes(e.sequence))offer(child,p,'EXPLICIT_ITEM_AND_DOCUMENT:'+parent.id);
      }
      if(c.type==='sale') {
        for(const child of where('sale_payments',{folio:value}))if((c.payments||[c.payment].filter(Boolean)).some(payment=>payment.id===child.body.id&&
          Number(payment.monto)===Number(child.body.monto))&&observed.get(child.id)?.sequences.includes(e.sequence))offer(child,p,'EXPLICIT_PAYMENT_AND_DOCUMENT:'+parent.id);
        offer(one('stock_reservations',{operation_id:c.saleOperationId||c.operationId}),p,'EXACT_RESERVATION_OPERATION');
      }
      const commit=c.type==='sale'?(c.mode==='layaway_liquidation'?'layaway_liquidation_commits':'sale_commits'):c.type+'_commits';
      offer(one(commit,{commit_id:id}),p,'EXACT_COMMIT_REQUEST');
      const folio=c.type==='sale'?value:c.header?.folio;
      if(folio)for(const child of where('movements',{ref:folio}))if((c.moves||[]).some(move=>move.ref===child.body.ref&&move.product_id===child.body.product_id&&
        Number(move.cant)===Number(child.body.cant))&&observed.get(child.id)?.sequences.includes(e.sequence))offer(child,p,'EXPLICIT_MOVEMENT_AND_DOCUMENT:'+parent.id);
      if(c.type==='exchange'&&c.payment?.id)for(const payment of where('sale_payments',{id:c.payment.id}))if(payment.body.folio===c.payment.folio&&
        Number(payment.body.monto)===Number(c.payment.monto))offer(payment,p,'EXACT_EXCHANGE_PAYMENT_ID');
    }
    if(c.type==='permissions'&&c.rpc==='admin_apply_user_screen_permissions_checked'&&ownedAuth.has(c.args?.p_target_user_id)) {
      const target=c.args.p_target_user_id;offer(one('user_permission_role_assignments',{user_id:target}),p,'EXACT_PERMISSION_TARGET');
      for(const screen of Object.keys(c.args.p_overrides||{}))offer(one('user_screen_permission_overrides',{user_id:target,screen_key:screen}),p,'EXPLICIT_PERMISSION_OVERRIDE');
      // batch_id is authoritative only when returned by this checked mutation.
      const batch=response?.batch_id||response?.batchId;
      if(UUID.test(batch||''))for(const child of where('permission_change_audit',{batch_id:batch,actor_user_id:actorId,target_user_id:target}))offer(child,p,'RETURNED_PERMISSION_BATCH');
    }
    if(c.type==='deviceRetire'&&fixtures.installations.includes(c.deviceId)) {
      const r=one('sync_devices',{device_id:c.deviceId});
      const presence=entries.some(e=>e.kind==='rpc:online_presence'&&e.identities?.deviceId===c.deviceId&&e.actorId===actorId);
      if(presence&&r?.body.user_id===actorId&&r.body.status==='revoked'&&r.body.metadata?.online_only===true)offer(r,p,'EXACT_PRESENCE_AND_RETIREMENT');
    }
  }
  // A stopped run may never reach deviceRetire. Its new installation is still
  // attributable through the proven Auth-create root, exact durable presence
  // intent and unchanged canonical observation. Presence has no server UUID or
  // immutable ACK: preserve its real identity separately, never invent either.
  for(const deviceId of fixtures.installations) {
    const r=one('sync_devices',{device_id:deviceId});
    if(!r||proven.has(r.id)||!ownedAuth.has(actorId))continue;
    const e=entries.filter(x=>x.kind==='rpc:online_presence'&&x.actorId===actorId&&
      x.identities?.deviceId===deviceId&&x.command?.p_device_id===deviceId).at(-1);
    const seen=observed.get(r.id);
    if(e&&seen?.sequences.includes(e.sequence)&&seen.observedContentSha256&&
      r.body.user_id===actorId&&r.body.status==='online'&&r.body.metadata?.online_only===true&&
      r.body.client_build===e.command.p_client_build) {
      const root=ownedAuth.get(actorId);
      offer(r,{...root,kind:'OBSERVED_PRESENCE_WITH_PROVEN_AUTH_CREATION',
        receiptSha256:journalHash({authObservationSha256:root.receiptSha256,deviceObservation:seen}),
        presenceIntentSha256:e.entryHash,presenceSequence:e.sequence,presenceRequestId:e.requestId},
      'EXACT_PLANNED_DEVICE_AND_DURABLE_PRESENCE');
    }
  }
  const byOperation=new Map(contexts.map(x=>[x.id,x]));
  const preservedCounterCreations=table('folio_counters').filter(r=>!before.has(r.id))
    .map(row=>proveNewFolioCounter({row,contexts,actorId,run})).filter(Boolean);
  const preservedCounterKeys=new Set(preservedCounterCreations.map(r=>key(r.table,JSON.parse(r.pk_json_text))));
  for(const r of table('sync_activity')) {
    const x=byOperation.get(r.body.operation_id),device=one('sync_devices',{device_id:r.body.device_id});
    if(x&&proven.has(device?.id)&&r.body.user_id===actorId&&r.body.status==='synced'&&r.body.requires_action===false&&r.body.completed_at)
      offer(r,x.p,'EXACT_OPERATION_AND_OWNED_DEVICE');
  }
  // Quarantine has no write intent in the runner. Even a QA-labelled new case is
  // held until an explicit terminal-decision receipt proves its full triple PK.
  for(const r of rows.values()) {
    if(Object.values(r.omitted_column_nullity).some(v=>!v))hold(r,'NONRESTORABLE_SECRET');
    if(!before.has(r.id)&&!proven.has(r.id)&&!held.has(r.id)&&!preservedCounterKeys.has(r.id))hold(r,'UNKNOWN_NEW_ROW_NO_DURABLE_PROVENANCE');
  }
  // Physical and commercial logical closure. No cascade may silently absorb a
  // held or historical child; a QA-labelled child cannot authorize its parent.
  const edges=[];
  const connect=(child,parent,label)=>{if(child&&parent)edges.push({child,parent,label});};
  for(const fk of current.catalog.foreign_keys) {
    const m=/^FOREIGN KEY \(([a-z0-9_", ]+)\) REFERENCES "?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?\(([a-z0-9_", ]+)\)/.exec(fk.definition);
    need(m&&fk.source.startsWith('pos.')&&['pos','auth'].includes(m[2]),'PLAN_FK_UNSUPPORTED');
    const cols=s=>s.split(',').map(x=>x.trim().replaceAll('"','')),source=cols(m[1]),target=cols(m[4]);
    for(const r of table(fk.source.slice(4))) {
      if(source.some(c=>r.body[c]===null||r.body[c]===undefined))continue;
      if(m[2]==='auth') {
        if(proven.has(r.id)&&!source.every(c=>ownedAuth.has(r.body[c])))hold(r,'FOREIGN_AUTH_REFERENCE');
      } else {
        const parents=where(m[3],Object.fromEntries(target.map((k,i)=>[k,r.body[source[i]]])));
        if(!parents.length&&proven.has(r.id))hold(r,'MISSING_PHYSICAL_PARENT');
        for(const parent of parents)connect(r,parent,'FK:'+fk.name);
      }
    }
  }
  const logicalGroups=new Map();
  for(const [child,col,parent,pk] of scalarLinks){const id=child+':'+col;if(!logicalGroups.has(id))logicalGroups.set(id,{child,col,parents:[]});logicalGroups.get(id).parents.push({parent,pk});}
  for(const {child,col,parents} of logicalGroups.values())for(const r of table(child))if(r.body[col]!=null) {
    const matched=parents.flatMap(({parent,pk})=>where(parent,{[pk]:r.body[col]}));
    // A reclassification movement's ref is free-form reason text, whereas its
    // operation_id and both product/quantity legs provide the exact relation.
    const reasonOnly=child==='movements'&&col==='ref'&&byOperation.get(r.body.operation_id)?.c.type==='referenceReclassification';
    if(!matched.length&&proven.has(r.id)&&!reasonOnly)hold(r,'UNKNOWN_LOGICAL_PARENT:'+col);
    for(const p of matched)connect(r,p,'LOGICAL:'+col);
  }
  const descend=(v,k,out=[])=>{if(v&&typeof v==='object'){if(Object.hasOwn(v,k)&&v[k]!=null)out.push(v[k]);for(const c of Object.values(v))descend(c,k,out);}return out;};
  for(const r of rows.values()) {
    const refs=[];
    if(['sales','returns'].includes(r.table))for(const v of r.body.vendedores||[])refs.push(['sellers','id',typeof v==='object'?v?.id:v]);
    if(r.table==='sale_items')for(const v of r.body.promos||[])refs.push(['promotions','id',v?.id]);
    if(r.table==='stock_reservations')for(const v of r.body.lines||[])refs.push(['products','id',v.product_id||v.productId]);
    if(r.table==='loan_documents')for(const [k,t] of [['productId','products'],['clienteId','clients']])for(const v of descend(r.body.document,k))refs.push([t,'id',v]);
    if(r.table==='commission_adjustments')for(const detail of r.body.detalle||[]) {
      if(detail.seller_id)refs.push(['sellers','id',detail.seller_id]);
      for(const line of detail.folios||[])if(line.folio)refs.push(['sales','folio',line.folio]);
    }
    for(const [t,k,v] of refs)if(v!=null){const parents=where(t,{[k]:v});if(!parents.length&&proven.has(r.id))hold(r,'UNKNOWN_LOGICAL_PARENT');for(const p of parents)connect(r,p,'JSON:'+t);}
  }
  let changed=true;
  while(changed){changed=false;for(const {child,parent,label} of edges) {
    if(proven.has(parent.id)&&!proven.has(child.id)){hold(parent,'OUTSIDE_CHILD:'+label);changed=true;}
    if(proven.has(child.id)&&!proven.has(parent.id)&&!sharedParents.has(parent.table)){hold(child,'FOREIGN_OR_HELD_PARENT:'+label);changed=true;}
  }}
  const exactQaDeltas=[...proven.values()].map(({row,provenance})=>({table:row.table,pk_json_text:row.pk_json_text,
    before_full_md5:null,after_full_md5:row.full_row_md5,provenanceSha256:journalHash(provenance)}));
  const diff=diffLiveSnapshots({baseline,final:current,catalog,sourceUrl,exactQaDeltas,approvedMonotonicCreations:preservedCounterCreations});
  const changes=[...diff.new,...diff.removed,...diff.changed];
  // Preserve metadata monotonic advances; every other preexisting mutation is a
  // blocker and never a deletion/restoration proposal.
  for(const change of changes)if(!['EXACT_QA_DELTA','MONOTONIC_ADVANCE_TO_PRESERVE','MONOTONIC_CREATION_TO_PRESERVE'].includes(change.classification)) {
    blockers.push({code:change.classification,table:change.table,pk_json_text:change.pk_json_text});
    const r=one(change.table,JSON.parse(change.pk_json_text));if(r)hold(r,change.classification);
  }
  for(const h of held.values())if(!before.has(key(h.table,JSON.parse(h.pk_json_text))))blockers.push({code:h.reason,table:h.table,pk_json_text:h.pk_json_text});
  const authBaseValid=authBaseline?.format==='balam-live-auth-baseline-v1'&&authBaseline.projectRef===SNAPSHOT_PROJECT&&authBaseline.run===run&&
    authBaseline.actorId===actorId&&authBaseline.artifactSha256===journalSnapshot.artifactSha256&&authBaseline.snapshotSha256===journalHash(baseline)&&
    authBaseline.complete===true&&Array.isArray(authBaseline.ids)&&authBaseline.ids.every(id=>UUID.test(id))&&new Set(authBaseline.ids).size===authBaseline.ids.length&&
    authBaseline.ids.includes(SNAPSHOT_ACTOR)&&SHA.test(authBaseline.fileSha256)&&Array.isArray(baseline.auth_user_ids)&&
    same([...authBaseline.ids].sort(),[...baseline.auth_user_ids].sort());
  const authTargets=[...ownedAuth].map(([id,p])=>({id,provenance:p,emailSha256:journalHash(id===actorId?fixtures.email:prefix+'-account@example.test'),
    marker:id===actorId?{namespace:'user_metadata',key:'balam_online_test',value:run}:{namespace:'app_metadata',key:'balam_account_request_id',value:accountProofs.find(x=>x.target===id)?.requestId},
    status:authBaseValid&&!authBaseline.ids.includes(id)?'PROVEN_NEW_SEPARATE_GOTRUE':'HELD_AUTH_BASELINE_UNPROVEN_OR_PREEXISTING'}));
  // A failed journey can stop before the account gateway. Only observed,
  // proven creations count; never invent the second expected fixture identity.
  const authComplete=[1,2].includes(authTargets.length)&&ownedAuth.has(actorId)&&
    new Set(accountProofs.map(p=>p.target)).size===authTargets.length-1&&authTargets.every(t=>t.status==='PROVEN_NEW_SEPARATE_GOTRUE');
  const targets=[...proven.values()].map(({row,provenance})=>({table:row.table,pk_json_text:row.pk_json_text,full_row_md5:row.full_row_md5,
    // Use this text for an exact private restore. Numeric scale and UTC/ISO text
    // are preserved; never JSON.stringify(JSON.parse(...)) for the backup body.
    row_json_text:row.restorable_row_json_text||row.row_json_text,provenance}));
  const holds=[...held.values()].sort((a,b)=>a.table.localeCompare(b.table)||a.pk_json_text.localeCompare(b.pk_json_text));
  return {format:'balam-live-cleanup-plan-v1',projectRef:SNAPSHOT_PROJECT,actorId,run,artifactSha256:journalSnapshot.artifactSha256,clientBuild,
    reconciled:true,reconciliationSha256:journalHash(reconciliation),journalSha256:journalHash(journalSnapshot),fixturesSha256:journalHash(fixtures),
    backup:{baselineSha256:journalHash(baseline),currentSha256:journalHash(current),baselineFileSha256:backup.baselineFileSha256,currentFileSha256:backup.currentFileSha256},
    targets,holds,blockers,authTargets,authBaseline:authBaseValid?structuredClone(authBaseline):null,
    authBaselineSha256:authBaseValid?journalHash(authBaseline):null,authCleanupManifestComplete:authComplete,
    preservedCounterCreations,
    preservedAdvances:changes.filter(c=>['MONOTONIC_ADVANCE_TO_PRESERVE','MONOTONIC_CREATION_TO_PRESERVE'].includes(c.classification)),
    cleanupManifestComplete:blockers.length===0,readyForReview:blockers.length===0&&authComplete,
    external:{auth:'HELD_SEPARATE_GOTRUE',storage:'HELD_SEPARATE_STORAGE'},
    liveGateOpened:false,certified:false,cleanupVerified:false,executionAuthorized:false,
    privateArtifact:true,observationProofScope:'OBSERVED_NODE_INTENT_NOT_SERVER_RECEIPT binds durable provisioning intent to the reconciled final row; it does not claim a fiscal ACK.'};
}
