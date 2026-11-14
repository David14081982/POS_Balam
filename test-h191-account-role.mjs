// One isolated account lifecycle. Auth confirmation is simulated; SQL is real.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {fixture} from './test-fixtures/h189/sql-fixture.mjs';
const {db,run,lit}=await fixture(),admin=randomUUID(),device='h191-isolated';
const scalar=async(s,p=[])=>Object.values((await db.query(s,p)).rows[0])[0];
const email=id=>id+'@h191.invalid.test';
const login=async id=>run("reset role;select set_config('request.jwt.claim.sub',"+lit(id||'')+",false);select set_config('request.jwt.claims',"+lit(JSON.stringify({sub:id,email:email(id),role:'authenticated'}))+",false)");
const asUser=async(fn,role='authenticated')=>{await run('set role '+role);try{return await fn();}finally{await run('reset role');}};
const read=p=>fs.readFileSync(p,'utf8');
const create=async({assigned=false}={})=>{
 const id=randomUUID(),rid=randomUUID(),command={type:'profileUpdate',kind:'sellers',expectedActorId:admin,accountRequestId:rid,rows:[{id:null,nombre:'Synthetic',email:email(id),role:'vendedor',active:true,sync_base_version:0}]};
 const payload={action:'create',id:null,email:email(id),deviceId:device,profileCommand:command};
 await asUser(()=>scalar('select pos.prepare_online_account($1,$2,$3,$4)',[rid,admin,JSON.stringify(payload),'synthetic-'+rid]),'service_role');
 await db.query('insert into auth.users(id,email) values($1,$2)',[id,email(id)]);
 if(assigned){await login(null);await db.query("insert into pos.user_permission_role_assignments(user_id,role_code,active) values($1,'vendedor',false)",[id]);await db.query("insert into pos.user_capability_overrides(user_id,capability_key,effect) values($1,'sales.create','deny')",[id]);await login(admin);}
 await asUser(()=>scalar("select pos.advance_online_account($1,$2,'auth_confirmed',$3,null)",[rid,admin,id]),'service_role');
 command.rows[0].id=id;const req=randomUUID();
 const call=()=>asUser(()=>scalar('select pos.execute_online_command($1,$2)',[req,JSON.stringify(command)]));
 const result=await call();assert.equal(result.ok,true,JSON.stringify(result));
 const assignment=await scalar('select coalesce(jsonb_agg(to_jsonb(a)),\'[]\') from pos.user_permission_role_assignments a where user_id=$1',[id]);
 assert.deepEqual(await call(),result);assert.deepEqual(await scalar('select coalesce(jsonb_agg(to_jsonb(a)),\'[]\') from pos.user_permission_role_assignments a where user_id=$1',[id]),assignment);
 await asUser(()=>scalar("select pos.advance_online_account($1,$2,'completed',$3,'{\"ok\":true}')",[rid,admin,id]),'service_role');
 return {id,assignment};
};
try{
 await run('begin');
 await run("insert into pos.system_manifest(singleton,schema_version,sync_protocol_min,sync_protocol_current,data_epoch,domain_modes) values(true,231,2,2,1,'{}') on conflict do nothing;insert into pos.screen_permission_catalog_state(singleton,catalog_version) values(true,1) on conflict do nothing;insert into pos.permission_roles(code,name,active) values('admin','Admin',true),('vendedor','Seller',true)");
 for(const key of ['pos','config.usuarios','config.permisos'])await db.query('insert into pos.screen_permission_catalog(screen_key,is_leaf,active,catalog_version) values($1,true,true,1)',[key]);
 await run("insert into pos.role_screen_permissions(role_code,screen_key,allowed) select 'admin',screen_key,true from pos.screen_permission_catalog;insert into pos.role_screen_permissions(role_code,screen_key,allowed) values('vendedor','pos',true)");
 for(const cap of ['sales.create','sales.collect','sellers.manage','permissions.manage'])await db.query('insert into pos.operational_capabilities(capability_key,description) values($1,$1)',[cap]);
 await run("insert into pos.role_capability_permissions(role_code,capability_key,allowed) select 'admin',capability_key,true from pos.operational_capabilities;insert into pos.role_capability_permissions(role_code,capability_key,allowed) values('vendedor','sales.create',true),('vendedor','sales.collect',true)");
 await db.query('insert into auth.users(id,email) values($1,$2)',[admin,email(admin)]);
 await db.query("insert into pos.sellers(id,nombre,email,role,active) values($1,'Admin',$2,'admin',true)",[admin,email(admin)]);
 await db.query("insert into pos.user_permission_role_assignments(user_id,role_code) values($1,'admin')",[admin]);
 await run('commit;select pos.activate_online_only()');await login(admin);
 await run("select set_config('request.headers',"+lit(JSON.stringify({'x-balam-device-id':device}))+",false);select pos.online_presence("+lit(device)+",'h191-isolated')");
 const before=await create();assert.equal(before.assignment.length,0);
 await login(before.id);assert.equal(await asUser(()=>scalar("select pos.current_has_capability('sales.create')")),false);await login(admin);
 const oldAssignments=await scalar('select jsonb_agg(to_jsonb(a) order by user_id) from pos.user_permission_role_assignments a');
 for(const name of ['20261114023200_pos_h191_account_role.sql','20261114023300_pos_h191_account_role_verification.sql'])await run(read('supabase/migrations/'+name),name);
 assert.deepEqual(await scalar('select jsonb_agg(to_jsonb(a) order by user_id) from pos.user_permission_role_assignments a'),oldAssignments);
 const after=await create();assert.equal(after.assignment[0].role_code,'vendedor');assert.equal(after.assignment[0].active,true);
 await login(after.id);assert.equal(await asUser(()=>scalar("select pos.current_has_capability('sales.create')")),true);
 await assert.rejects(()=>asUser(()=>scalar("select pos.online_save_entities('sellers','[]')")),{code:'42501'});
 await assert.rejects(()=>asUser(()=>db.exec("insert into pos.user_permission_role_assignments(user_id,role_code) values('"+randomUUID()+"','admin')")),{code:'42501'});
 await login(admin);const existing=await create({assigned:true});assert.equal(existing.assignment[0].active,false);
 assert.equal(await scalar("select effect from pos.user_capability_overrides where user_id=$1",[existing.id]),'deny');
 const snap=await asUser(()=>scalar("select pos.admin_user_permission_snapshot($1,array['pos'])",[before.id]));assert.equal(snap.base_role,null);assert.equal(snap.user.role,'vendedor');
 console.log('PASS 1: baseline reproduces missing role; confirmed creation assigns role, replay and existing permissions preserved; private writes denied');
 // Execute the actual editor save closure, including both fallback and assigned role.
 const source=read('balam/permissions.jsx'),start=source.indexOf('async function save()'),end=source.indexOf('\n    function requestUser',start);
 for(const base of [null,'admin']){let args;const snapshot={...snap,base_role:base};
  const ctx={snapshot,dirty:true,saving:false,setSaving(){},setError(e){if(e)throw Error(e);},rpc:async(_name,a)=>{args=a;},draft:{pos:'allow'},model:{leaves:['pos']},selected:{},loadSnapshot:async()=>{},loadUsers:async()=>{},userSearch:'',window:{AUTH:{current:()=>null},UI:{toast(){}}}};
  await vm.runInNewContext('('+source.slice(start,end).trim()+')()',ctx);assert.equal(args.p_role_code,base||'vendedor');}
 console.log('PASS 2: actual editor save uses profile fallback and preserves existing role');
 fs.mkdirSync('docs/fixes/evidence/h191',{recursive:true});fs.writeFileSync('docs/fixes/evidence/h191/isolated.json',JSON.stringify({at:new Date().toISOString(),passed:2,network:false,auth:'simulated Auth confirmation; actual account RPCs and gateway',baselineMissingRole:true,creationEffectiveSalesCreate:true,replayPreserved:true,existingPermissionsPreserved:true,editorFallback:true},null,2)+'\n');
}catch(e){console.error(e.message,e.cause?.message);process.exitCode=1;}finally{await db.close();}
