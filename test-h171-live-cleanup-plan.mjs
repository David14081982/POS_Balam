// H171: actual canonical PostgreSQL types + actual journal/reconciler, local only.
import assert from 'node:assert/strict';
import { test,after } from 'node:test';
import * as fs from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { openLiveJournal,journalHash } from './h171-live-journal.mjs';
import { createLiveReconciler,postgresJsonbHash } from './h171-live-reconciliation.mjs';
import { SNAPSHOT_PROJECT,SNAPSHOT_ACTOR,recordedSnapshotCatalog,buildLiveSnapshotSql,SNAPSHOT_OMISSIONS } from './h171-live-snapshot.mjs';
import { buildLiveCleanupPlan } from './h171-live-cleanup-plan.mjs';
import { buildLiveCleanupSql } from './h171-live-cleanup-sql.mjs';
import { verifyCanonicalFixtureBackup,verifyLiveSqlPostcheck } from './h171-live-cleanup-validation.mjs';
import { createLiveCleanupLifecycle } from './h171-live-cleanup-lifecycle.mjs';

// Importable integration fixture: importing this module performs no setup or test.
export async function createLiveCleanupPlanFixture({sourceUrl=`https://api.supabase.com/v1/projects/${SNAPSHOT_PROJECT}/database/query`,
  beforeBaseline=null,onBaseline=null,afterFixtures=null,keepJournalOpen=false}={}) {
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const catalog=recordedSnapshotCatalog({authorityAudit:await read('docs/fixes/evidence/h171/authority-audit-before.json'),cleanupCatalog:await read('docs/fixes/evidence/h171/cleanup-catalog-before.json')});
const origin=`https://${SNAPSHOT_PROJECT}.supabase.co`;
const temp=await fs.mkdtemp(join(resolve('.'),'.h171-plan-test-')),db=new PGlite(),run=randomUUID(),actorId=randomUUID(),accountId=randomUUID(),prefix='qa-h164-'+run;
const artifactSha256=journalHash('synthetic artifact'),journal=await openLiveJournal({file:join(temp,'journal.json'),run,projectRef:SNAPSHOT_PROJECT,artifactSha256});
const q=v=>"'"+String(v).replaceAll("'","''")+"'",j=v=>q(JSON.stringify(v))+'::jsonb';
const plain=s=>s.tables.flatMap(t=>t.rows.map(r=>({table:t.table,...r,body:JSON.parse(r.row_json_text)})));
const pkFor=(t,b)=>Object.fromEntries(catalog.find(c=>c.table===t).pk.map(k=>[k,b[k]]));
const find=(s,t,p)=>s.tables.find(x=>x.table===t).rows.find(r=>Object.entries(p).every(([k,v])=>JSON.parse(r.pk_json_text)[k]===v));
const fixtures={run,prefix,userId:actorId,plannedActorId:actorId,email:prefix+'@example.test',installations:['A','B','C'].map(x=>prefix+'-'+x),
  sellers:[prefix+'-admin',...['A','B','C'].map(x=>prefix+'-seller-'+x)],products:['new-product','new-product-2'],createdAccountIds:[],clients:[],promotions:[],configKeys:[]};
const userRecords=new Map([[actorId,{id:actorId,email:fixtures.email,created_at:'2026-09-12T12:00:00.000Z',user_metadata:{balam_online_test:run},app_metadata:{},banned_until:null}]]);
function defaultValue(c) {
  if(!c.not_null)return 'NULL';
  if(c.type==='text')return "'synthetic'";
  if(c.type==='uuid')return q(actorId)+'::uuid';
  if(c.type==='boolean')return 'true';
  if(c.type==='jsonb')return "'[]'::jsonb";
  if(c.type==='text[]')return "'{}'::text[]";
  if(c.type==='date')return "DATE '2026-09-12'";
  if(c.type==='timestamp with time zone')return "TIMESTAMPTZ '2026-09-12 12:13:14.123456+00'";
  return '0';
}
async function insert(t,values) {
  const def=catalog.find(x=>x.table===t);
  await db.exec(`INSERT INTO pos.${t}(${def.columns.map(c=>'"'+c.name+'"').join(',')}) VALUES(${def.columns.map(c=>values[c.name]??defaultValue(c)).join(',')});`);
}
await db.exec(`CREATE SCHEMA pos;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_user_meta_data jsonb,raw_app_meta_data jsonb);
 INSERT INTO auth.users VALUES('${SNAPSHOT_ACTOR}','{}','{}');
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT NULL::uuid$$;
 CREATE FUNCTION pos.can_manage_screen_permissions(uuid) RETURNS boolean LANGUAGE sql AS $$SELECT $1='${SNAPSHOT_ACTOR}'::uuid$$;
 CREATE FUNCTION pos.assert_permission_admin_survives() RETURNS void LANGUAGE plpgsql AS $$BEGIN
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='${SNAPSHOT_ACTOR}') THEN RAISE EXCEPTION 'LAST_ADMIN'; END IF;END$$;
 ${catalog.map(t=>`CREATE TABLE pos.${t.table}(${t.columns.map(c=>'"'+c.name+'" '+c.type+(c.not_null?' NOT NULL':'')).join(',')},PRIMARY KEY(${t.pk.map(k=>'"'+k+'"').join(',')}));`).join('\n')}`);
// Real physical FK catalogue, including cross-schema Auth ownership, is available
// to the assembler even though synthetic test data uses only the relevant subset.
const audit=(await read('docs/fixes/evidence/h171/authority-audit-before.json')).rows[0].report;
await db.exec(audit.foreign_keys.filter(f=>f.source.startsWith('pos.')).map(f=>`ALTER TABLE ${f.source} ADD CONSTRAINT ${f.constraint} ${f.definition};`).join('\n'));
await insert('online_snapshot_revision',{singleton:'true',revision:'10'});
await insert('system_manifest',{system_mode:"'preproduction'"});await insert('online_runtime',{enabled:'true'});
await insert('permission_roles',{code:"'admin'"});await insert('permission_roles',{code:"'seller'"});
await insert('screen_permission_catalog',{screen_key:"'reports'"});
await insert('operational_capabilities',{capability_key:"'synthetic-capability'"});
await insert('clients',{id:"'real-client'"});await insert('products',{id:"'real-product'",stock_quantity:'37'});
await insert('sales',{folio:"'BG-260912-0001'",cliente_id:"'real-client'",vendedores:"'[]'::jsonb",items:'0'});
await insert('settings',{key:"'existing-config'",value:j({legitimate:true})});
await insert('folio_counters',{prefix:"'BG'",business_date:"DATE '2026-09-12'",last_seq:'1'});
const capture=async()=> (await db.exec(buildLiveSnapshotSql({catalog,sourceUrl}))).find(r=>r.rows[0]?.report)?.rows[0].report;
if(beforeBaseline)await beforeBaseline({db,catalog,insert,fixtures,run,actorId,accountId,userRecords});
const baselineSnapshot=await capture();
if(onBaseline)await onBaseline({db,catalog,insert,fixtures,run,actorId,accountId,userRecords,journal,sourceUrl,artifactSha256,directory:temp,capture});
const add=(kind,command,identities={},requestId=randomUUID())=>journal.prepare({kind,checkpoint:'local controlled scenario',actorId,requestId,command,identities});
async function online(command,response={},state='confirmed',requestId=randomUUID(),device=fixtures.installations[0]) {
  const signed={...command,expectedActorId:actorId};const e=await add('rpc:execute_online_command',signed,{requestId},requestId);
  await insert('online_requests',{actor_id:q(actorId),request_id:q(requestId),device_id:q(device),state:q(state),command_kind:q(signed.type),command_hash:q(postgresJsonbHash(signed)),response:j({ok:state==='confirmed',requestId,result:response})});return e;
}
await add('auth-create',{qaRun:run,emailSha256:journalHash(fixtures.email)},{userId:actorId});
await db.exec(`INSERT INTO auth.users(id,raw_user_meta_data,raw_app_meta_data) VALUES('${actorId}',${j({balam_online_test:run})},'{}');`);
for(const device of fixtures.installations) {
  await insert('sync_devices',{device_id:q(device),user_id:q(actorId),status:"'revoked'",client_build:"'2026-09-12-h166-online'",metadata:j({online_only:true})});
  await add('rpc:online_presence',{p_client_build:'2026-09-12-h166-online'},{deviceId:device},'online_presence:'+device);
  await online({type:'deviceRetire',deviceId:device,retired:true},{ok:true},'confirmed',randomUUID(),fixtures.installations[0]);
}
const sellerRows=fixtures.sellers.map(id=>({id,active:false,nombre:'Synthetic profile',role:'vendedor'}));
await add('profile-provisioning',{rows:sellerRows},{profileIds:fixtures.sellers});
for(const r of sellerRows)await insert('sellers',{id:q(r.id),active:'false',nombre:q(r.nombre),role:q(r.role),password_hash:'NULL'});
await add('role-provisioning',{role_code:'admin',active:true},{userId:actorId});
await insert('user_permission_role_assignments',{user_id:q(actorId),role_code:"'admin'",active:'true',assigned_by:q(actorId)});
for(const id of fixtures.products)await insert('products',{id:q(id),stock_quantity:'3',precio:'116.00',sync_device_id:q(fixtures.installations[0])});
await online({type:'upsert',kind:'products',rows:fixtures.products.map(id=>({id,precio:116,sync_base_version:0}))},fixtures.products.map(id=>({id})));
await insert('clients',{id:"'new-client'",total:'116.00'});await online({type:'upsert',kind:'clients',rows:[{id:'new-client',total:116,sync_base_version:0}]},[{id:'new-client'}]);
await insert('promotions',{id:"'new-promo'"});await online({type:'upsert',kind:'promotions',rows:[{id:'new-promo',sync_base_version:0}]},[{id:'new-promo'}]);
const saleId=randomUUID(),folio='BG-260912-0002';
await insert('sales',{folio:q(folio),cliente_id:"'new-client'",operation_id:q(saleId),vendedores:j([fixtures.sellers[1]]),items:'1'});
await insert('sale_items',{id:'1711',folio:q(folio),product_id:"'new-product'",qty:'1',promos:j([{id:'new-promo'}])});
await insert('sale_payments',{id:"'synthetic-payment'",folio:q(folio),monto:'116.00',operation_id:q(saleId)});
await insert('sale_commits',{commit_id:q(saleId),operation_id:q(saleId),folio:q(folio)});
await insert('stock_reservations',{operation_id:q(saleId),folio:q(folio),lines:j([{product_id:'new-product',qty:1}])});
await online({type:'sale',operationId:saleId,header:{folio},items:[{product_id:'new-product',qty:1}],payments:[{id:'synthetic-payment',monto:116}]},{ok:true},'confirmed',saleId);
const configId=randomUUID();await insert('settings',{key:"'new-config'",value:j({numeric:116})});
await insert('config_commits',{operation_id:q(configId),device_id:q(fixtures.installations[0])});
await online({type:'config',settings:[{key:'new-config',value:{numeric:116}}]},{ok:true},'confirmed',configId);
const accountRequest=randomUUID(),email=prefix+'-account@example.test';
const profileCommand={type:'profileUpdate',kind:'sellers',rows:[{id:null,nombre:'Synthetic account',email,role:'vendedor'}],accountRequestId:accountRequest,expectedActorId:actorId};
await add('edge:admin-users:create',{requestId:accountRequest,action:'create',emailSha256:journalHash(email)},{requestId:accountRequest},accountRequest);
await db.exec(`INSERT INTO auth.users(id,raw_user_meta_data,raw_app_meta_data) VALUES('${accountId}','{}',${j({balam_account_request_id:accountRequest})});`);
await insert('online_account_requests',{actor_id:q(actorId),request_id:q(accountRequest),action:"'create'",state:"'completed'",target_user_id:q(accountId),
  payload:j({action:'create',id:null,email,profileCommand}),result:j({ok:true,id:accountId,requestId:accountRequest})});
userRecords.set(accountId,{id:accountId,email,created_at:'2026-09-12T12:01:00.000Z',user_metadata:{},app_metadata:{balam_account_request_id:accountRequest}});
await insert('sellers',{id:q(accountId),email:q(email),role:"'vendedor'",active:'false',password_hash:'NULL'});
const h=journalHash(JSON.stringify(accountRequest+':profile')),profileId=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
const childCommand=structuredClone(profileCommand);childCommand.rows[0].id=accountId;
await insert('online_requests',{actor_id:q(actorId),request_id:q(profileId),device_id:q(fixtures.installations[0]),state:"'confirmed'",command_kind:"'profileUpdate'",command_hash:q(postgresJsonbHash(childCommand)),response:j({ok:true,requestId:profileId,result:[{id:accountId}]})});
const returnRequest=randomUUID(),returnId='synthetic-return';
await insert('returns',{id:q(returnId),folio:q(folio),vendedores:j([fixtures.sellers[1]])});
await insert('return_items',{id:'1721',return_id:q(returnId),product_id:"'new-product'",qty:'1'});
await insert('return_commits',{commit_id:q(returnRequest),return_id:q(returnId),folio:q(folio)});
await insert('movements',{id:'1722',ref:q(folio),return_id:q(returnId),product_id:"'new-product'",cant:'1'});
await online({type:'return',header:{id:returnId,folio},items:[{product_id:'new-product',qty:1}],moves:[{ref:folio,product_id:'new-product',cant:1}]},{ok:true},'confirmed',returnRequest);
const exchangeRequest=randomUUID(),exchangeId='synthetic-exchange',exchangeFolio='CAM-260912-001';
await insert('exchanges',{id:q(exchangeId),folio:q(exchangeFolio),origen_folio:q(folio),vendedor_id:q(fixtures.sellers[1])});
await insert('exchange_items',{id:'1731',exchange_id:q(exchangeId),product_id:"'new-product-2'",qty:'1',lado:"'entregado'"});
await insert('exchange_commits',{commit_id:q(exchangeRequest),exchange_id:q(exchangeId),folio:q(exchangeFolio)});
await insert('movements',{id:'1732',ref:q(exchangeFolio),product_id:"'new-product-2'",cant:'-1'});
await insert('sale_payments',{id:"'exchange-payment'",folio:q(exchangeFolio),monto:'12.00'});
await online({type:'exchange',header:{id:exchangeId,folio:exchangeFolio,origen_folio:folio},items:[{product_id:'new-product-2',qty:1,lado:'entregado'}],
  moves:[{ref:exchangeFolio,product_id:'new-product-2',cant:-1}],payment:{id:'exchange-payment',folio:exchangeFolio,monto:12}},{ok:true},'confirmed',exchangeRequest);
const loanRequest=randomUUID();await insert('loan_documents',{id:"'synthetic-loan'",document:j({lineas:[{productId:'new-product-2'}],clienteId:'new-client'})});
await online({type:'loanOperation',action:'deliver',expectedVersion:0,loan:{id:'synthetic-loan',lineas:[{productId:'new-product-2'}]}},{ok:true},'confirmed',loanRequest);
const reclassRequest=randomUUID();await insert('reference_reclassifications',{operation_id:q(reclassRequest),source_product_id:"'new-product'",target_product_id:"'new-product-2'",quantity:'1',actor_user_id:q(actorId)});
await insert('movements',{id:'1741',operation_id:q(reclassRequest),product_id:"'new-product'",cant:'-1',ref:"'synthetic reclass reason'"});
await insert('movements',{id:'1742',operation_id:q(reclassRequest),product_id:"'new-product-2'",cant:'1',ref:"'synthetic reclass reason'"});
await online({type:'referenceReclassification',sourceProductId:'new-product',targetProductId:'new-product-2',quantity:1},{ok:true},'confirmed',reclassRequest);
await insert('capability_operation_audit',{operation_id:q(reclassRequest),actor_user_id:q(actorId),capability_key:"'synthetic-capability'"});
const liquidationRequest=randomUUID();await insert('liquidations',{id:q('liq-'+liquidationRequest),seller_id:q(fixtures.sellers[1]),monto:'10.00'});
await online({type:'commissionSettle',sellerId:fixtures.sellers[1]},{amount:10},'confirmed',liquidationRequest);
const adjustmentRequest=randomUUID();await insert('commission_adjustments',{operation_id:q(adjustmentRequest),actor_user_id:q(actorId),detalle:j([{seller_id:fixtures.sellers[1],folios:[{folio,comision:1}]}])});
await online({type:'commissionAdjustment',rows:[{folio,sellerId:fixtures.sellers[1],comision:1}]},{ok:true},'confirmed',adjustmentRequest);
const paymentRequest=randomUUID();await insert('sale_payments',{id:"'layaway-payment'",folio:q(folio),monto:'20.00'});
await insert('layaway_liquidation_commits',{commit_id:q(paymentRequest),operation_id:q(saleId),folio:q(folio),payment_id:"'layaway-payment'"});
await online({type:'sale',mode:'layaway_liquidation',folio,operationId:paymentRequest,saleOperationId:saleId,payment:{id:'layaway-payment',folio,monto:20}},{ok:true},'confirmed',paymentRequest);
const permissionRequest=randomUUID(),permissionBatch=randomUUID();
await insert('user_permission_role_assignments',{user_id:q(accountId),role_code:"'seller'",active:'false',assigned_by:q(actorId)});
await insert('user_screen_permission_overrides',{user_id:q(accountId),screen_key:"'reports'",effect:"'deny'",updated_by:q(actorId)});
await insert('permission_change_audit',{id:'1751',batch_id:q(permissionBatch),actor_user_id:q(actorId),target_user_id:q(accountId),role_code:"'seller'",screen_key:"'reports'"});
await online({type:'permissions',rpc:'admin_apply_user_screen_permissions_checked',args:{p_target_user_id:accountId,p_overrides:{reports:'deny'}}},{batch_id:permissionBatch},'confirmed',permissionRequest);
await insert('sync_activity',{device_id:q(fixtures.installations[0]),operation_id:q(saleId),user_id:q(actorId),status:"'synced'",requires_action:'false',completed_at:"TIMESTAMPTZ '2026-09-12 13:00:00+00'"});
await db.exec("UPDATE pos.folio_counters SET last_seq=2;UPDATE pos.online_snapshot_revision SET revision=20;");
if(afterFixtures)await afterFixtures({db,catalog,insert,fixtures,run,actorId,accountId,userRecords});
const currentSnapshot=await capture();
function readClients(input) {
  const rows=plain(input.currentSnapshot),forbidden=()=>{throw Error('NO NETWORK OR MUTATION ALLOWED');};
  const dbClient={url:origin+'/rest/v1',schemaName:'pos',rpc:forbidden,from(table){const filters={},query={select(){return query;},eq(k,v){filters[k]=v;return query;},
    async limit(){return {data:rows.filter(r=>r.table===table&&Object.entries(filters).every(([k,v])=>r.body[k]===v)).map(r=>structuredClone(r.body)),error:null};},delete:forbidden,insert:forbidden,update:forbidden};return query;}};
  const admin={supabaseUrl:origin,auth:{admin:{url:origin+'/auth/v1',async getUserById(id){return {data:{user:userRecords.get(id)},error:null};},deleteUser:forbidden,createUser:forbidden,listUsers:forbidden}}};
  return {db:dbClient,admin};
}
async function reconcile(input) {
  const {db:dbClient,admin}=readClients(input);
  input.reconciliation=await createLiveReconciler({db:dbClient,admin,expectedProjectRef:SNAPSHOT_PROJECT,expectedActorId:actorId,protectedAuthIds:[SNAPSHOT_ACTOR]}).reconcile({snapshot:input.journalSnapshot,fixtures:input.fixtures});
  assert.equal(input.reconciliation.reconciled,true,JSON.stringify(input.reconciliation.blockers));return input;
}
const original={journalSnapshot:journal.snapshot(),fixtures,catalog,sourceUrl,baselineSnapshot,currentSnapshot,
  backup:{baselineFileSha256:journalHash('baseline private durable bytes'),currentFileSha256:journalHash('current private durable bytes')},
  authBaseline:{format:'balam-live-auth-baseline-v1',projectRef:SNAPSHOT_PROJECT,run,actorId,artifactSha256,snapshotSha256:journalHash(baselineSnapshot),complete:true,ids:[SNAPSHOT_ACTOR],fileSha256:journalHash('complete auth ID census')}};
await reconcile(original);if(!keepJournalOpen)await journal.close();
const input=()=>structuredClone(original),plan=v=>buildLiveCleanupPlan(v);
// Local PostgreSQL regenerates just the deliberately modified test row; production
// assembler never accepts a JS reserialization as the canonical restore body.
async function change(v,table,pk,patch,{baseline=false,add=false}={}) {
  const snapshot=baseline?v.baselineSnapshot:v.currentSnapshot,container=snapshot.tables.find(t=>t.table===table);
  const row=find(snapshot,table,pk),body={...(row?JSON.parse(row.restorable_row_json_text||row.row_json_text):{}),...pk,...patch};
  const omitted=SNAPSHOT_OMISSIONS[table]||[],omitSQL='ARRAY['+omitted.map(q).join(',')+']::text[]';
  const pkSQL='jsonb_build_object('+catalog.find(t=>t.table===table).pk.flatMap(k=>[q(k),'t."'+k+'"']).join(',')+')';
  const result=(await db.query(`SELECT ${pkSQL}::text pk_json_text,(to_jsonb(t)-${omitSQL})::text row_json_text,
    md5((to_jsonb(t)-${omitSQL})::text) projected_row_md5,md5(to_jsonb(t)::text) full_row_md5,
    to_jsonb(t)::text full_text FROM jsonb_populate_record(NULL::pos.${table},$1::jsonb)t`,[JSON.stringify(body)])).rows[0];
  const full=JSON.parse(result.full_text),nullity=Object.fromEntries(omitted.map(k=>[k,full[k]===null]));
  const updated={...row,...result,omitted_column_nullity:nullity,restorable_row_json_text:omitted.length&&Object.values(nullity).every(Boolean)?result.full_text:null,monotonic:row?.monotonic||null};delete updated.full_text;
  if(add){container.rows.push(updated);container.row_count++;}else Object.assign(row,updated);
  return updated;
}
const close=async()=>{await journal.close();await db.close();await fs.rm(temp,{recursive:true,force:true});};
const reopenJournal=()=>openLiveJournal({file:join(temp,'journal.json'),run,projectRef:SNAPSHOT_PROJECT,artifactSha256});
return {db,input,plan,capture,reconcile,readClients,change,find,insert,catalog,sourceUrl,fixtures,run,prefix,actorId,accountId,folio,saleId,userRecords,directory:temp,journal,reopenJournal,close};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
const {input,plan,change,find,reconcile,fixtures,actorId,accountId,folio,saleId,run,prefix,close}=await createLiveCleanupPlanFixture();
after(close);

test('real journal + reconciler +64 typed snapshot proves exact new rows and preserves real sale/counters',()=>{
  const p=plan(input());assert.equal(p.cleanupManifestComplete,true,JSON.stringify(p.blockers));assert.equal(p.readyForReview,true);
  assert.equal(p.authTargets.length,2);assert.ok(p.authTargets.every(t=>t.status==='PROVEN_NEW_SEPARATE_GOTRUE'));
  for(const t of ['products','clients','promotions','sellers','sales','sale_items','sale_payments','sale_commits','stock_reservations','settings','config_commits','online_requests','online_account_requests','sync_devices'])assert.ok(p.targets.some(r=>r.table===t),t);
  for(const t of ['returns','return_items','return_commits','exchanges','exchange_items','exchange_commits','movements','reference_reclassifications','loan_documents','liquidations','commission_adjustments','layaway_liquidation_commits','user_screen_permission_overrides','permission_change_audit','sync_activity','capability_operation_audit'])assert.ok(p.targets.some(r=>r.table===t),t);
  assert.ok(p.preservedAdvances.some(x=>x.table==='folio_counters'));assert.ok(p.targets.every(r=>!r.pk_json_text.includes('BG-260912-0001')));
  assert.equal(p.certified,false);assert.equal(p.cleanupVerified,false);assert.equal(p.liveGateOpened,false);assert.equal(p.executionAuthorized,false);
  assert.match(p.targets.find(r=>r.table==='clients').row_json_text,/116\.00/);
  const generated=buildLiveCleanupSql({...input(),plan:p});assert.equal(generated.expectedRows,p.targets.length);assert.equal(generated.liveGateOpened,false);
});
test('new QA prefix/date row without durable intent is held and SQL generation refuses partial readiness',async()=>{
  const v=input();await change(v,'clients',{id:prefix+'-unproven'},{nombre:prefix,total:0},{add:true});const p=plan(v);
  assert.equal(p.cleanupManifestComplete,false);assert.ok(p.holds.some(r=>r.reason==='UNKNOWN_NEW_ROW_NO_DURABLE_PROVENANCE'));
  assert.throws(()=>buildLiveCleanupSql({...v,plan:p}),/COMPLETE|RECONCILIATION/);
});
test('same UUID in baseline cannot be called QA even with exact intent and returned ID',()=>{
  const v=input(),r=find(v.currentSnapshot,'products',{id:'new-product'}),t=v.baselineSnapshot.tables.find(t=>t.table==='products');t.rows.push(structuredClone(r));t.row_count++;
  const p=plan(v);assert.ok(p.holds.some(h=>h.table==='products'&&h.reason==='BASELINE_PREEXISTING'));assert.ok(!p.targets.some(t=>t.pk_json_text===r.pk_json_text&&t.table==='products'));
});
test('reused real folio retains sale0001 and propagates hold through QA child relationships',async()=>{
  const v=input();await change(v,'sale_items',{id:1711},{folio:'BG-260912-0001'});await reconcile(v);const p=plan(v);
  assert.equal(p.cleanupManifestComplete,false);assert.ok(!p.targets.some(t=>t.table==='products'&&t.pk_json_text.includes('new-product"')));
  assert.ok(!p.targets.some(t=>t.pk_json_text.includes('BG-260912-0001')));
});
test('preexisting commercial client linked to new sale holds the sale and children',async()=>{
  const v=input();await change(v,'sales',{folio},{cliente_id:'real-client'});await reconcile(v);const p=plan(v);
  assert.ok(p.holds.some(t=>t.table==='sales'&&t.reason.startsWith('FOREIGN_OR_HELD_PARENT:')));assert.equal(p.cleanupManifestComplete,false);
});
test('external new child cannot be silently swept with a proven parent',async()=>{
  const v=input();await change(v,'sale_items',{id:1712},{folio,product_id:'new-product',qty:2,promos:[]},{add:true});const p=plan(v);
  assert.equal(p.cleanupManifestComplete,false);assert.ok(p.holds.some(h=>h.table==='sales'&&h.reason.startsWith('OUTSIDE_CHILD:')));
});
test('canonical receipt that changed after reconciliation is rejected before any plan',async()=>{
  const v=input();await change(v,'online_requests',{actor_id:actorId,request_id:saleId},{state:'executing'});
  assert.throws(()=>plan(v),/CANONICAL_RECEIPT_RECONCILIATION/);
});
test('changed parsed authority row holds exact PK while canonical backup is never rehashed in JS',async()=>{
  const v=input();await change(v,'sales',{folio},{total:999});const p=plan(v);
  assert.ok(p.holds.some(h=>h.table==='sales'&&h.reason==='CHANGED_SINCE_RECONCILIATION'));assert.equal(p.cleanupManifestComplete,false);
});
test('foreign sync_device_id on an explicit QA row is held',async()=>{
  const v=input();await change(v,'products',{id:'new-product'},{sync_device_id:'real-workstation'});const p=plan(v);
  assert.ok(p.holds.some(h=>h.reason==='FOREIGN_WRITE_DEVICE'));assert.equal(p.cleanupManifestComplete,false);
});
test('nonNULL omitted credential is never emitted as restore body or selected',async()=>{
  const v=input();await change(v,'sellers',{id:fixtures.sellers[0]},{password_hash:'synthetic-nonsecret-test-sentinel'});const p=plan(v);
  assert.ok(p.holds.some(h=>h.reason==='NONRESTORABLE_SECRET'));assert.ok(!JSON.stringify(p).includes('synthetic-nonsecret-test-sentinel'));assert.equal(p.cleanupManifestComplete,false);
});
test('nested secret in a new row remains held without exporting it',async()=>{
  const v=input();await change(v,'settings',{key:'new-config'},{value:{access_token:'synthetic-secret-sentinel'}});const p=plan(v);
  assert.ok(p.holds.some(h=>h.reason==='NONRESTORABLE_SECRET'));assert.ok(!JSON.stringify(p).includes('synthetic-secret-sentinel'));
});
test('unchanged historical omitted credential is an informative hold, preserving full readiness',async()=>{
  const v=input();const p=await change(v,'sellers',{id:'historical'},{password_hash:'historical-test-sentinel'},{add:true});
  const base=v.baselineSnapshot.tables.find(t=>t.table==='sellers');base.rows.push(structuredClone(p));base.row_count++;
  v.authBaseline.snapshotSha256=journalHash(v.baselineSnapshot);const result=plan(v);
  assert.equal(result.cleanupManifestComplete,true);assert.ok(result.holds.some(h=>h.reason==='NONRESTORABLE_SECRET'));assert.ok(!JSON.stringify(result).includes('historical-test-sentinel'));
});
test('preexisting CONFIG mutation is held and never restored/deleted',async()=>{
  const v=input();await change(v,'settings',{key:'existing-config'},{value:{legitimate:false}});const p=plan(v);
  assert.equal(p.cleanupManifestComplete,false);assert.ok(p.holds.some(h=>h.reason==='NON_QA_CHANGED'));assert.ok(!p.targets.some(t=>t.pk_json_text.includes('existing-config')));
});
test('removed historical row blocks readiness without inventing a current deletion target',()=>{
  const v=input(),t=v.currentSnapshot.tables.find(t=>t.table==='clients');t.rows=t.rows.filter(r=>!r.pk_json_text.includes('real-client'));t.row_count--;
  const p=plan(v);assert.equal(p.cleanupManifestComplete,false);assert.ok(p.blockers.some(b=>b.code==='NON_QA_REMOVED'));
});
test('Auth census missing, incomplete, empty or preexisting target stays separate and held',()=>{
  for(const mutate of [v=>v.authBaseline=null,v=>v.authBaseline.complete=false,v=>v.authBaseline.ids=[],v=>v.authBaseline.ids.push(accountId)]) {
    const v=input();mutate(v);const p=plan(v);assert.equal(p.authCleanupManifestComplete,false);assert.equal(p.readyForReview,false);
    assert.ok(p.authTargets.some(t=>t.status.startsWith('HELD_')));assert.equal(p.external.auth,'HELD_SEPARATE_GOTRUE');
  }
});
test('durable chain, run, actor, artifact and reconciliation bindings cannot be substituted',()=>{
  for(const mutate of [v=>v.journalSnapshot.entries[0].command.qaRun=randomUUID(),v=>v.fixtures.userId=SNAPSHOT_ACTOR,
    v=>v.reconciliation.snapshotSha256='0'.repeat(64),v=>v.reconciliation.artifactSha256='0'.repeat(64),v=>v.reconciliation.entries[0].state='UNCERTAIN',v=>v.backup.currentFileSha256='']) {
    const v=input();mutate(v);assert.throws(()=>plan(v),/PLAN_/);
  }
});
test('PK text inconsistent with canonical typed body is rejected',()=>{
  const v=input();find(v.currentSnapshot,'products',{id:'new-product'}).pk_json_text='{"id": "substituted"}';assert.throws(()=>plan(v),/PK_BODY/);
});
test('node provisioning proof explicitly does not claim a server or fiscal receipt',()=>{
  const p=plan(input()),node=p.targets.find(t=>t.table==='sellers'&&t.pk_json_text.includes('-admin'));
  assert.equal(node.provenance.kind,'OBSERVED_NODE_INTENT_NOT_SERVER_RECEIPT');assert.equal(node.provenance.intentSha256.length,64);assert.equal(node.provenance.receiptSha256.length,64);
  assert.match(p.observationProofScope,/does not claim a fiscal ACK/);
});
test('freshly observed extra sale child still needs an item from the durable command',async()=>{
  const v=input();await change(v,'sale_items',{id:1791},{folio,product_id:'new-product',qty:99,promos:[]},{add:true});await reconcile(v);
  const p=plan(v);assert.equal(p.cleanupManifestComplete,false);assert.ok(p.holds.some(h=>h.pk_json_text.includes('1791')));
});
test('permission audit with another batch is held despite exact QA actor and account',async()=>{
  const v=input();await change(v,'permission_change_audit',{id:1792},{actor_user_id:actorId,target_user_id:accountId,batch_id:randomUUID()},{add:true});
  const p=plan(v);assert.equal(p.cleanupManifestComplete,false);assert.ok(p.holds.some(h=>h.pk_json_text.includes('1792')));
});
test('device must have confirmed retirement and final revoked state',async()=>{
  const v=input();await change(v,'sync_devices',{device_id:fixtures.installations[1]},{status:'online'});await reconcile(v);const p=plan(v);
  assert.equal(p.cleanupManifestComplete,false);assert.ok(p.holds.some(h=>h.table==='sync_devices'&&h.pk_json_text.includes('-B')));
});
test('new quarantine full triple PK remains held without a terminal decision intent',async()=>{
  const v=input();await change(v,'sync_quarantine_cases',{device_id:fixtures.installations[0],operation_id:saleId,remote_epoch:1},{},{add:true});const p=plan(v);
  assert.equal(p.cleanupManifestComplete,false);assert.ok(p.holds.some(h=>h.table==='sync_quarantine_cases'&&JSON.parse(h.pk_json_text).remote_epoch===1));
});
test('Auth ID census must equal the authority IDs captured in the baseline transaction',()=>{
  const v=input();v.authBaseline.ids.push(randomUUID());const p=plan(v);assert.equal(p.authBaseline,null);assert.equal(p.authCleanupManifestComplete,false);
});
test('early failed journey before account creation retires only its one proven principal',async()=>{
  const v=input(),removedRequests=new Set();
  v.journalSnapshot.entries=v.journalSnapshot.entries.filter(e=>{
    const remove=e.kind.startsWith('edge:admin-users:')||e.command.type==='permissions';if(remove)removedRequests.add(e.requestId);return !remove;
  });
  for(const t of v.currentSnapshot.tables) {
    t.rows=t.rows.filter(r=>{const b=JSON.parse(r.row_json_text);
      if(t.table==='online_account_requests'||t.table==='permission_change_audit')return false;
      if(['sellers','user_permission_role_assignments','user_screen_permission_overrides'].includes(t.table)&&(b.id===accountId||b.user_id===accountId))return false;
      if(t.table==='online_requests'&&(removedRequests.has(b.request_id)||b.command_kind==='profileUpdate'))return false;
      return true;
    });t.row_count=t.rows.length;
  }
  v.currentSnapshot.auth_user_ids=v.currentSnapshot.auth_user_ids.filter(id=>id!==accountId);
  let previous=null;for(const [i,e] of v.journalSnapshot.entries.entries()){e.sequence=i+1;e.previousHash=previous;e.commandHash=journalHash(e.command);const{entryHash,...body}=e;e.entryHash=journalHash(body);previous=e.entryHash;}
  await reconcile(v);const p=plan(v);assert.equal(p.authCleanupManifestComplete,true);assert.equal(p.readyForReview,true);
  assert.deepEqual(p.authTargets.map(t=>t.id),[actorId]);assert.ok(!p.targets.some(t=>t.pk_json_text.includes(accountId)));
});
test('an edit receipt cannot prove creation of a row that appeared after baseline',async()=>{
  const v=input(),e=v.journalSnapshot.entries.find(e=>e.command.type==='upsert'&&e.command.kind==='clients');e.command.rows[0].sync_base_version=7;
  let previous=null;for(const entry of v.journalSnapshot.entries){entry.previousHash=previous;entry.commandHash=journalHash(entry.command);const{entryHash,...body}=entry;entry.entryHash=journalHash(body);previous=entry.entryHash;}
  await change(v,'online_requests',{actor_id:actorId,request_id:e.requestId},{command_hash:postgresJsonbHash(e.command)});await reconcile(v);const p=plan(v);
  assert.equal(p.cleanupManifestComplete,false);assert.ok(p.holds.some(h=>h.table==='clients'&&h.pk_json_text.includes('new-client')));
});
test('fixture-plan metadata records no mutation and never attributes its planned IDs',async()=>{
  const v=input(),products=Array.from({length:9},()=>randomUUID());v.fixtures.products=products;
  v.fixtures.coreJourney={schema:'h171-core-ui-v1',productIds:products.slice(7),referenceFamilyId:products[7],initialStocks:[3,2],unitPrice:116};
  v.journalSnapshot.entries.unshift({kind:'fixture-plan',actorId:null,contextName:'Node',requestId:run,checkpoint:'bootstrap / exact product identities before provisioning',
    command:{run,coreJourney:v.fixtures.coreJourney},identities:{productIds:products,coreJourneyProductIds:products.slice(7)}});
  let previous=null;for(const [i,e] of v.journalSnapshot.entries.entries()){e.sequence=i+1;e.previousHash=previous;e.commandHash=journalHash(e.command);const{entryHash,...body}=e;e.entryHash=journalHash(body);previous=e.entryHash;}
  await reconcile(v);const p=plan(v);assert.equal(p.cleanupManifestComplete,true);assert.ok(!p.targets.some(t=>products.some(id=>t.pk_json_text.includes(id))));
});
test('canonical backup restores all60 exact rows across31 actual PostgreSQL table types',async()=>{
  const v=input(),p=plan(v),report=await verifyCanonicalFixtureBackup({plan:p,catalog:v.catalog});
  assert.equal(report.verified,true);assert.equal(report.restoredRows,60);assert.equal(new Set(report.checks.map(c=>c.table)).size,31);
  assert.equal(report.planSha256,journalHash(p));assert.equal(report.localOnly,true);
});
test('typed restore refuses an altered canonical numeric amount under its original full hash',async()=>{
  const v=input(),p=plan(v),target=p.targets.find(t=>t.table==='clients');assert.match(target.row_json_text,/116\.00/);
  target.row_json_text=target.row_json_text.replace('116.00','117.00');
  await assert.rejects(verifyCanonicalFixtureBackup({plan:p,catalog:v.catalog}),/BACKUP_TYPED_RESTORE_HASH_MISMATCH/);
});
let committedLocal;
test('actual generated SQL COMMIT removes60 exact rows and independent postcheck verifies63 outside tables',async()=>{
  const f=await createLiveCleanupPlanFixture();
  try {
    const v=f.input(),p=plan(v),generated=buildLiveCleanupSql({...v,plan:p});
    const output=await f.db.exec(generated.sql),result=output.find(r=>r.rows[0]?.report)?.rows[0].report,postSnapshot=await f.capture();
    const args={...v,plan:p,generated,result,postSnapshot};
    const report=verifyLiveSqlPostcheck(args);assert.equal(report.remainingExactRows,0);assert.equal(report.exactRowsChecked,60);
    assert.equal(report.protectedTables,63);assert.equal(report.baselinePreserved,true);assert.equal(report.certified,false);
    assert.equal(postSnapshot.auth_user_ids.length,3);assert.ok(find(postSnapshot,'sales',{folio:'BG-260912-0001'}));
    // This fixture installs real physical FKs and PostgreSQL types, while owner
    // permission functions are controlled and H166 triggers are not installed.
    // Production H166/fence behavior is covered by separate reviewed SQL suites.
    assert.equal(generated.expectedRevisionDelta,0);committedLocal=args;
  }finally{await f.close();}
});
test('independent postcheck rejects a surviving exact fixture and an altered removal receipt',()=>{
  assert.ok(committedLocal);
  const v=structuredClone(committedLocal),target=v.plan.targets[0],container=v.postSnapshot.tables.find(t=>t.table===target.table);
  container.rows.push(structuredClone(find(v.currentSnapshot,target.table,JSON.parse(target.pk_json_text))));container.row_count++;
  assert.throws(()=>verifyLiveSqlPostcheck(v),/CLEANUP_TARGET_STILL_PRESENT/);
  const wrong=structuredClone(committedLocal);wrong.result.removed_manifest.pop();assert.throws(()=>verifyLiveSqlPostcheck(wrong),/EXACT_REMOVAL_RECEIPT_REQUIRED/);
});
test('independent postcheck rejects outside commercial drift and any Auth SQL deletion',async()=>{
  const v=structuredClone(committedLocal),carrier={currentSnapshot:v.postSnapshot};
  await change(carrier,'products',{id:'real-product'},{stock_quantity:36});assert.throws(()=>verifyLiveSqlPostcheck(v),/POSTCHECK_OUTSIDE_FULL_HASH_CHANGED/);
  const auth=structuredClone(committedLocal);auth.postSnapshot.auth_user_ids=auth.postSnapshot.auth_user_ids.filter(id=>id!==actorId);
  // The committed integration fixture has independently allocated UUIDs.
  auth.postSnapshot.auth_user_ids=auth.postSnapshot.auth_user_ids.filter(id=>id!==auth.plan.actorId);
  assert.throws(()=>verifyLiveSqlPostcheck(auth),/SQL_CHANGED_AUTH_IDENTITIES/);
});
test('controller refuses a late durable intent beforeSQL and cannot repeat finalize',async()=>{
  const f=await createLiveCleanupPlanFixture({sourceUrl:`https://${SNAPSHOT_PROJECT}.supabase.co/`}),ledger=await f.reopenJournal();
  let sqlCalls=0;
  try {
    const v=f.input(),clients=f.readClients(v),io={catalog:f.catalog,sourceUrl:f.sourceUrl,directory:f.directory,
      async capture(label) {
        if(label==='before-fixtures')return {snapshot:v.baselineSnapshot,evidence:{sha256:v.backup.baselineFileSha256}};
        assert.equal(label,'after-scenarios');
        await ledger.prepare({kind:'auth-ban',checkpoint:'synthetic late intent',actorId:f.actorId,identities:{userId:f.actorId},command:{duration:'controlled'}});
        return {snapshot:v.currentSnapshot,evidence:{sha256:v.backup.currentFileSha256}};
      },async authBaseline(){return v.authBaseline;},async query(){sqlCalls++;throw Error('SQL MUST NOT BE REACHED');}};
    const lifecycle=await createLiveCleanupLifecycle({io,...clients,journal:ledger,fixtures:f.fixtures,
      artifactSha256:v.journalSnapshot.artifactSha256,clientBuild:'2026-09-12-h166-online',readAuthPreflight:async()=>{throw Error('AUTH PREFLIGHT MUST NOT BE REACHED');}});
    await assert.rejects(lifecycle.finalize(),/MUTATION_EMITTER_NOT_QUIESCENT/);assert.equal(sqlCalls,0);
    await assert.rejects(lifecycle.finalize(),/CLEANUP_LIFECYCLE_ALREADY_ATTEMPTED/);assert.equal(sqlCalls,0);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM pos.sale_items')).rows[0].n,1);
  }finally{await ledger.close();await f.close();}
});
test('controller refuses an unsupported source binding before any capture or mutation',async()=>{
  let captures=0;
  await assert.rejects(createLiveCleanupLifecycle({io:{sourceUrl:'https://unrelated.invalid',async capture(){captures++;}},
    journal:{snapshot:()=>({projectRef:SNAPSHOT_PROJECT})},readAuthPreflight:async()=>({})}),/LIVE_CLEANUP_CANONICAL_SOURCE_ORIGIN_REQUIRED/);
  assert.equal(captures,0);
});
}
