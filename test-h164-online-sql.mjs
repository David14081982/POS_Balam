// H164 local PostgreSQL execution using read-only live catalog definitions.
// No commercial production rows or network; this is not remote certification.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const runtime=process.env.BALAM_PGLITE_ROOT;
const { PGlite }=await import(runtime?pathToFileURL(runtime+'/dist/index.js').href:'@electric-sql/pglite');
const { pgcrypto }=await import(runtime?pathToFileURL(runtime+'/dist/contrib/pgcrypto.js').href:'@electric-sql/pglite/contrib/pgcrypto');
const catalog=JSON.parse(fs.readFileSync('test-fixtures/h164/sql-authority-baseline.json','utf8')).catalog;
const db=new PGlite({extensions:{pgcrypto}});
const ident=x=>'"'+String(x).replaceAll('"','""')+'"';
const lit=x=>"'"+String(x).replaceAll("'","''")+"'";
const run=async(sql,step)=>{try{await db.exec(sql);}catch(e){throw new Error(step+': '+e.message,{cause:e});}};
try{
 await run(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema pos;create schema extensions;
 create extension pgcrypto with schema extensions;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),deleted_at timestamptz,last_sign_in_at timestamptz,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 grant execute on all functions in schema auth to public;
 set check_function_bodies=off;`,'bootstrap');
 for(const schema of catalog.schemas){
  await run(`revoke all on schema ${ident(schema.name)} from public,anon,authenticated,service_role;`,'schema revoke');
  for(const item of (schema.acl||'').replace(/^\{|\}$/g,'').split(',')){
   const [,role,acl]=item.match(/^([^=]*)=([^/]*)\//)||[];
   if(!['authenticated','anon','service_role',''].includes(role))continue;
   const perms=[['U','usage'],['C','create']].filter(([ch])=>acl.includes(ch)).map(([,p])=>p);
   if(perms.length)await run(`grant ${perms.join(',')} on schema ${ident(schema.name)} to ${role?ident(role):'public'};`,'schema grant');
  }
 }
 const identities=new Set(catalog.columns.filter(c=>c.is_identity==='YES').map(c=>c.table_name+'_'+c.column_name+'_seq'));
 for(const s of catalog.sequences)if(!identities.has(s.sequencename))await run(`create sequence pos.${ident(s.sequencename)};`,'sequence');
 for(const t of catalog.tables){
  const cols=catalog.columns.filter(c=>c.table_name===t.name).sort((a,b)=>a.ordinal_position-b.ordinal_position).map(c=>{
   const type=c.data_type==='ARRAY'?ident(c.udt_name.slice(1))+'[]':ident(c.udt_name);
   return `${ident(c.column_name)} ${type}${c.is_identity==='YES'?' generated '+c.identity_generation+' as identity':c.column_default?' default '+c.column_default:''}${c.is_nullable==='NO'?' not null':''}`;
  });
  await run(`create table pos.${ident(t.name)}(${cols.join(',')});`,t.name);
 }
 for(const f of catalog.functions)await run(f.definition+';',f.name);
 for(const v of catalog.views)await run(`create view pos.${ident(v.name)}${v.options?.includes('security_invoker=true')?' with(security_invoker=true)':''} as ${v.definition};`,v.name);
 const sorted=[...catalog.constraints].sort((a,b)=>Number(a.definition.startsWith('FOREIGN'))-Number(b.definition.startsWith('FOREIGN')));
 for(const c of sorted)if(!c.definition.startsWith('TRIGGER'))await run(`alter table ${c.table} add constraint ${ident(c.name)} ${c.definition};`,c.name);
 const constraintNames=new Set(catalog.constraints.map(c=>c.name));
 for(const ix of catalog.indexes){const name=ix.match(/^CREATE (?:UNIQUE )?INDEX (\S+)/)?.[1]?.replaceAll('"','');if(!constraintNames.has(name))await run(ix+';','index '+name);}
 for(const trig of catalog.triggers)await run(trig+';','trigger');
 for(const t of catalog.tables){
  if(t.rls)await run(`alter table pos.${ident(t.name)} enable row level security;`,'rls');
  for(const item of (t.acl||'').replace(/^\{|\}$/g,'').split(',')){
   const [,role,acl]=item.match(/^([^=]*)=([^/]*)\//)||[];
   if(!['authenticated','anon','service_role',''].includes(role))continue;
   const perms=[['r','select'],['a','insert'],['w','update'],['d','delete'],['D','truncate'],['x','references'],['t','trigger']].filter(([ch])=>acl.includes(ch)).map(([,p])=>p);
   if(perms.length)await run(`grant ${perms.join(',')} on pos.${ident(t.name)} to ${role?ident(role):'public'};`,'acl');
  }
 }
 for(const p of catalog.policies){
  await run(`create policy ${ident(p.policyname)} on pos.${ident(p.tablename)} as ${p.permissive} for ${p.cmd} to ${p.roles.map(ident).join(',')}${p.qual?' using('+p.qual+')':''}${p.with_check?' with check('+p.with_check+')':''};`,'policy');
 }
 // Function grants model actual catalog; public EXECUTE is not inferred absent.
 for(const f of catalog.functions){
  await run(`revoke all on function ${f.identity} from public,anon,authenticated;`,'function revoke');
  if(f.acl===null || /(?:\{|,)=X\//.test(f.acl||''))await run(`grant execute on function ${f.identity} to public;`,'function public grant');
  for(const role of ['anon','authenticated','service_role'])if((f.acl||'').includes(role+'=X/'))await run(`grant execute on function ${f.identity} to ${role};`,'function grant');
 }
 await run(`grant usage on all sequences in schema pos to authenticated,service_role;
 alter default privileges in schema pos grant all on tables to anon,authenticated;`,'defaults');
 // A migration connection can SET ROLE postgres from a NOINHERIT login.
 // RESET ROLE would return to that login, not to the effective migration owner.
 await run(`grant anon,authenticated,service_role to postgres;
 create role h164_migrator noinherit;grant postgres to h164_migrator;
 set session authorization h164_migrator;set role postgres;`,'delegated migration identity');
 await run('set check_function_bodies=on;','validate new function bodies');
 await run(fs.readFileSync('supabase/migrations/20260911020800_pos_h164_online_authority.sql','utf8'),'H164 implementation');
 const verification='supabase/migrations/20260911020900_pos_h164_online_authority_verification.sql';
 if(fs.existsSync(verification))await run(fs.readFileSync(verification,'utf8'),'H164 verification');
 await run(fs.readFileSync('supabase/migrations/20260912021000_pos_h164_legacy_exact_discard.sql','utf8'),'H164 exact discard correction');
 await run(fs.readFileSync('supabase/migrations/20260912021100_pos_h164_legacy_exact_discard_verification.sql','utf8'),'H164 exact discard verification');
 const checked=await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='pos' and p.proname like '%online%' order by p.proname`);
 fs.mkdirSync('.evidence-h164',{recursive:true});fs.writeFileSync('.evidence-h164/online-sql-local.json',JSON.stringify({at:new Date().toISOString(),engine:'PGlite PostgreSQL',source:'live catalog including schema/PUBLIC ACL, no production rows',migrations:['20260911020800','20260911020900','20260912021000','20260912021100'],verification:fs.existsSync(verification),functions:checked.rows},null,2)+'\n');
 console.log(JSON.stringify({ok:true,functions:checked.rows.length,verification:fs.existsSync(verification)}));
} catch(error) {
 console.error(JSON.stringify({ok:false,error:error.message,detail:error.cause?.detail,where:error.cause?.where}));
 process.exitCode=1;
} finally {await db.close();}
