// Seventh focused case: predicate admission on a sentinel, no business fixtures.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {fixture} from './test-fixtures/h189/sql-fixture.mjs';
const {db,run,lit,ident}=await fixture();
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
const active=randomUUID(),inactive=randomUUID();
const email=id=>id+'@h190.invalid.test';
try{
 await run("begin;update pos.online_runtime set enabled=false where singleton;insert into pos.permission_roles(code,name) values('admin','Admin');insert into pos.operational_capabilities(capability_key,description) values('sales.refund','Refund'),('permissions.manage','Permissions');insert into pos.role_capability_permissions(role_code,capability_key,allowed) select 'admin',capability_key,true from pos.operational_capabilities;");
 for(const key of ['config.usuarios','config.permisos'])await db.query('insert into pos.screen_permission_catalog(screen_key,is_leaf,active,catalog_version) values($1,true,true,1)',[key]);
 await run("insert into pos.role_screen_permissions(role_code,screen_key,allowed) select 'admin',screen_key,true from pos.screen_permission_catalog");
 for(const id of [active,inactive]){
  await db.query('insert into auth.users(id,email) values($1,$2)',[id,email(id)]);
  await db.query("insert into pos.sellers(id,nombre,email,role,active) values($1,'Synthetic',$2,'admin',$3)",[id,email(id),id===active]);
  await db.query("insert into pos.user_permission_role_assignments(user_id,role_code,active) values($1,'admin',true)",[id]);
 }
 await run('commit;select pos.activate_online_only();');
 for(const f of ['20261107022800_pos_h189_seller_v2_stock.sql','20261113023000_pos_h190_seller_postsale.sql'])await run(fs.readFileSync('supabase/migrations/'+f,'utf8'));
 await run('create temp table h190_policy_sentinel(id integer);insert into h190_policy_sentinel values(1);alter table h190_policy_sentinel enable row level security;grant select on h190_policy_sentinel to authenticated;');
 const schema=await scalar('select nspname from pg_namespace where oid=pg_my_temp_schema()');await run('grant usage on schema '+ident(schema)+' to authenticated');
 // Copy the actual installed refund predicate; policies do not inspect row data.
 const predicate=await scalar("select qual from pg_policies where schemaname='pos' and tablename='returns' and policyname='h190_refund_select'");
 await run('create policy exact_refund_predicate on h190_policy_sentinel for select to authenticated using('+predicate+')');
 const read=async id=>{
  await run("select set_config('request.jwt.claim.sub',"+lit(id)+",false);select set_config('request.jwt.claims',"+lit(JSON.stringify({sub:id,email:email(id),role:'authenticated'}))+",false);set role authenticated;");
  try{return await scalar('select count(*) from h190_policy_sentinel');}finally{await run('reset role');}
 };
 assert.equal(await read(active),1);assert.equal(await read(inactive),0);
 assert.equal(await scalar('select pos.is_active_admin()'),false);
 let error;await run('set role authenticated');try{await scalar('select pos.execute_online_command($1::uuid,$2::jsonb)',[randomUUID(),JSON.stringify({type:'return',expectedActorId:inactive})]);}catch(e){error=e;}finally{await run('reset role');}
 assert.equal(error?.code,'42501');
 await run("select set_config('request.jwt.claim.sub','',false);select set_config('request.jwt.claims','{}',false)");
 await db.query("insert into pos.user_capability_overrides(user_id,capability_key,effect) values($1,'sales.refund','deny')",[active]);
 assert.equal(await read(active),0);
 const result={id:7,status:'PASS',name:'inactive admin cannot read or execute; refund predicate honors explicit capability denial',network:false,sourceHash:createHash('sha256').update(fs.readFileSync('test-h190-policy-roles.mjs')).digest('hex')};
 fs.writeFileSync('docs/fixes/evidence/h190/policy-roles.json',JSON.stringify(result,null,2)+'\n');console.log('PASS 7: '+result.name);
}finally{await db.close();}
