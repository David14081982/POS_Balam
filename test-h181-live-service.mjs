// Explicit operator validation: only two fictitious PNGs, exact cleanup, no sales.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
const ref='telohdbvbvsfmwyriflz', base='https://'+ref+'.supabase.co', bucket='balam-thermer-private';
let keys;
try { keys=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','projects','api-keys','--project-ref',ref,'-o','json'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']})); }
catch { throw Error('BALAM_OPERATOR_KEYS_UNAVAILABLE'); }
if(!Array.isArray(keys)) keys=keys.keys || keys.api_keys;
const service=keys.find(k=>k.name==='service_role')?.api_key;
const anon=keys.find(k=>k.name==='anon')?.api_key;
assert.ok(service&&anon,'LEGACY_SERVER_KEYS_REQUIRED');
const client=createClient(base,service,{auth:{persistSession:false,autoRefreshToken:false}});
if(process.argv.includes('--create-bucket')) {
 const existing=await client.storage.getBucket(bucket);
 if(!existing.data) {
  const result=await client.storage.createBucket(bucket,{public:false,fileSizeLimit:1100000,allowedMimeTypes:['application/json','image/png']});
  assert.equal(result.error,null,'CREATE_PRIVATE_BUCKET_FAILED');
 }
 const configured=await client.storage.updateBucket(bucket,{public:false,fileSizeLimit:1100000,allowedMimeTypes:['application/json','image/png']});assert.equal(configured.error,null);
 const check=await client.storage.getBucket(bucket);assert.equal(check.data?.public,false);
 console.log('PASS private bucket provisioned; no client policies or business changes');
 process.exit(0);
}
const fixturePath=process.argv.find(a=>a.endsWith('.png'));
assert.ok(fixturePath,'PNG_FIXTURE_REQUIRED');
const image=fs.readFileSync(fixturePath),now=Math.floor(Date.now()/1000),id=now+'-'+randomUUID();
const names=[id+'-0.png',id+'-1.png',id+'.json'];let url;
const results=[];
async function check(name,run){await run();results.push({name,ok:true});console.log('PASS '+name);}
try {
 const store=client.storage.from(bucket),paths=[];
 for(const name of names.slice(0,2)) {
  const put=await store.upload(name,image,{upsert:false,contentType:'image/png',cacheControl:'0'});assert.equal(put.error,null,'FIXTURE_UPLOAD_FAILED');
  const sign=await store.createSignedUrl(name,600);assert.equal(sign.error,null);paths.push(sign.data.signedUrl);
 }
 const manifest={'0':{type:1,path:paths[0],align:0},'1':{type:0,content:' ',bold:0,align:0},'2':{type:1,path:paths[1],align:0}};
 const put=await store.upload(names[2],JSON.stringify(manifest),{upsert:false,contentType:'application/json',cacheControl:'0'});assert.equal(put.error,null);
 const sign=await store.createSignedUrl(names[2],600);assert.equal(sign.error,null);url=sign.data.signedUrl;
 await check('bucket private',async()=>assert.equal((await client.storage.getBucket(bucket)).data.public,false));
 await check('public download denied',async()=>assert.notEqual((await fetch(base+'/storage/v1/object/public/'+bucket+'/'+names[2])).status,200));
 for(const [label,credential] of [['anonymous',null],['anon-key',anon],['server-key',service]]) await check(label+' creation denied',async()=>{
   const headers={'Content-Type':'application/json'};if(credential) headers.Authorization='Bearer '+credential;
   const response=await fetch(base+'/functions/v1/thermer-print',{method:'POST',headers,body:'{}'});assert.ok([401,403].includes(response.status),'UNEXPECTED_POST_STATUS_'+response.status);
 });
 await check('tampered signed URL denied',async()=>assert.notEqual((await fetch(url.replace('token=','token=x'))).status,200));
 const response=await fetch(url);assert.equal(response.status,200);const delivered=await response.json();
 await check('exact JSON protocol and both complete images',async()=>{
  assert.deepEqual(Object.keys(delivered),['0','1','2']);assert.ok(response.headers.get('Content-Type').includes('application/json'));
  for(const n of ['0','2']){assert.equal(delivered[n].type,1);assert.equal(delivered[n].align,0);const png=await fetch(delivered[n].path);assert.equal(png.status,200);assert.deepEqual(Buffer.from(await png.arrayBuffer()),image);}
 });
} finally {
 const result=await client.storage.from(bucket).remove(names);assert.equal(result.error,null,'EXACT_FIXTURE_CLEANUP_FAILED');
 const gone=await client.storage.from(bucket).download(names[2]);assert.ok(gone.error,'FIXTURE_STILL_PRESENT');
 console.log('PASS exact fixture cleanup');
}
fs.writeFileSync('docs/fixes/evidence/h181-live-service.json',JSON.stringify({project:ref,results,fixtureSHA256:createHash('sha256').update(image).digest('hex'),cleanup:true,hardware:'NOT_TESTED',activeUserPost:'NOT_TESTED: role matrix executed in isolated handler'},null,2)+'\n');
