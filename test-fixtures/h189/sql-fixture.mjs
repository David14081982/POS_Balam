// Isolated catalog loader, adapted from test-h186-financial-sql.mjs. No network.
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
export async function fixture(){
const catalog=JSON.parse(fs.readFileSync('test-fixtures/h164/sql-authority-baseline.json','utf8')).catalog;
const db=new PGlite({extensions:{pgcrypto}});
const ident=x=>'"'+String(x).replaceAll('"','""')+'"';
const lit=x=>"'"+String(x).replaceAll("'","''")+"'";
const run=async(sql,label)=>{try{return await db.exec(sql);}catch(e){throw new Error((label||'SQL')+': '+e.message,{cause:e});}};

 await run(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema pos;create schema extensions;
 create extension pgcrypto with schema extensions;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz,last_sign_in_at timestamptz,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant execute on all functions in schema auth to public;set check_function_bodies=off;`,'bootstrap');
 for(const s of catalog.schemas){
  await run(`revoke all on schema ${ident(s.name)} from public,anon,authenticated,service_role;`);
  for(const item of (s.acl||'').replace(/^\{|\}$/g,'').split(',')){
   const [,role,acl]=item.match(/^([^=]*)=([^/]*)\//)||[];
   if(!['authenticated','anon','service_role',''].includes(role))continue;
   const perms=[['U','usage'],['C','create']].filter(([c])=>acl.includes(c)).map(([,p])=>p);
   if(perms.length)await run(`grant ${perms.join(',')} on schema ${ident(s.name)} to ${role?ident(role):'public'};`);
  }
 }
 const identities=new Set(catalog.columns.filter(c=>c.is_identity==='YES').map(c=>c.table_name+'_'+c.column_name+'_seq'));
 for(const s of catalog.sequences)if(!identities.has(s.sequencename))await run(`create sequence pos.${ident(s.sequencename)};`);
 for(const t of catalog.tables){
  const cols=catalog.columns.filter(c=>c.table_name===t.name).sort((a,b)=>a.ordinal_position-b.ordinal_position).map(c=>
   `${ident(c.column_name)} ${c.data_type==='ARRAY'?ident(c.udt_name.slice(1))+'[]':ident(c.udt_name)}${c.is_identity==='YES'?' generated '+c.identity_generation+' as identity':c.column_default?' default '+c.column_default:''}${c.is_nullable==='NO'?' not null':''}`);
  await run(`create table pos.${ident(t.name)}(${cols.join(',')});`,t.name);
 }
 for(const f of catalog.functions)await run(f.definition+';',f.name);
 for(const v of catalog.views)await run(`create view pos.${ident(v.name)}${v.options?.includes('security_invoker=true')?' with(security_invoker=true)':''} as ${v.definition};`,v.name);
 for(const c of [...catalog.constraints].sort((a,b)=>Number(a.definition.startsWith('FOREIGN'))-Number(b.definition.startsWith('FOREIGN'))))
  if(!c.definition.startsWith('TRIGGER'))await run(`alter table ${c.table} add constraint ${ident(c.name)} ${c.definition};`,c.name);
 const cn=new Set(catalog.constraints.map(c=>c.name));
 for(const ix of catalog.indexes){const n=ix.match(/^CREATE (?:UNIQUE )?INDEX (\S+)/)?.[1]?.replaceAll('"','');if(!cn.has(n))await run(ix+';',n);}
 for(const t of catalog.triggers)await run(t+';','trigger');
 for(const t of catalog.tables){
  if(t.rls)await run(`alter table pos.${ident(t.name)} enable row level security;`);
  for(const item of (t.acl||'').replace(/^\{|\}$/g,'').split(',')){
   const [,role,acl]=item.match(/^([^=]*)=([^/]*)\//)||[];
   if(!['authenticated','anon','service_role',''].includes(role))continue;
   const perms=[['r','select'],['a','insert'],['w','update'],['d','delete'],['D','truncate'],['x','references'],['t','trigger']].filter(([c])=>acl.includes(c)).map(([,p])=>p);
   if(perms.length)await run(`grant ${perms.join(',')} on pos.${ident(t.name)} to ${role?ident(role):'public'};`);
  }
 }
 for(const p of catalog.policies)await run(`create policy ${ident(p.policyname)} on pos.${ident(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(ident).join(',')}${p.qual?' using('+p.qual+')':''}${p.with_check?' with check('+p.with_check+')':''};`);
 for(const f of catalog.functions){
  await run(`revoke all on function ${f.identity} from public,anon,authenticated;`);
  if(f.acl===null||/(?:\{|,)=X\//.test(f.acl||''))await run(`grant execute on function ${f.identity} to public;`);
  for(const role of ['anon','authenticated','service_role'])if((f.acl||'').includes(role+'=X/'))await run(`grant execute on function ${f.identity} to ${role};`);
 }
 await run('grant usage on all sequences in schema pos to authenticated,service_role;set check_function_bodies=on;');
 for(const file of ['20260911020800_pos_h164_online_authority.sql','20260912021000_pos_h164_legacy_exact_discard.sql','20260912021200_pos_h164_optional_json_null.sql'])
  await run(fs.readFileSync('supabase/migrations/'+file,'utf8'),file);

 for(const file of ['20260912022000_pos_h166_conditional_snapshot.sql','20261010022500_pos_h186_financial_authority.sql','20261011022600_pos_h186_quote_readonly_device.sql','20261011022700_pos_h186_commission_snapshot.sql'])await run(fs.readFileSync('supabase/migrations/'+file,'utf8'),file);
 const query=db.query.bind(db);db.query=async(sql,...args)=>{try{return await query(sql,...args);}catch(e){e.message+=' [SQL: '+sql+']';throw e;}};
 return {db,run,lit,ident};
}
