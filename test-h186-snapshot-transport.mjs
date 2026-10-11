// H186 lossless snapshot transport. Local PostgreSQL/crypto only, no Supabase.
import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import * as fs from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {createRequire,syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {SNAPSHOT_ACTOR,SNAPSHOT_PROJECT,LARGE_BASELINE_BODY_TABLES,recordedSnapshotCatalog,
  buildLiveSnapshotSql,validateLiveSnapshot,rehydrateLivePointZeroSnapshot} from './h171-live-snapshot.mjs';
import {ROW_BODY_TRANSPORT,decodePrivateSnapshotBodies} from './h171-live-snapshot-transport.mjs';
import {financialSnapshotCatalog} from './qa-h186-financial-journey.mjs';

const read=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
const catalog=financialSnapshotCatalog(recordedSnapshotCatalog({
  authorityAudit:await read('docs/fixes/evidence/h171/authority-audit-before.json'),
  cleanupCatalog:await read('docs/fixes/evidence/h171/cleanup-catalog-before.json'),
}));
const sourceUrl=`https://${SNAPSHOT_PROJECT}.supabase.co/`,passphrase=randomBytes(32).toString('base64url');
const db=new PGlite({extensions:{pgcrypto}});
let baseline,wire;
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const plainSql=()=>buildLiveSnapshotSql({catalog,sourceUrl});
const transportSql=options=>buildLiveSnapshotSql({catalog,sourceUrl,bodyTransport:{passphrase},...options});
const normalize=s=>{const copy=structuredClone(s);delete copy.at;delete copy.snapshot;return copy;};
const decode=(input=wire,key=passphrase)=>decodePrivateSnapshotBodies({input,passphrase:key,catalog,sourceUrl,projectRef:SNAPSHOT_PROJECT});
const capture=async sql=>{
  const results=await db.exec(sql),report=results.find(r=>r.rows?.[0]?.report)?.rows[0].report;
  assert.equal(db.isInTransaction(),false,'READ_ONLY_TRANSACTION_MUST_CLOSE');return report;
};
function defaultValue(column){
  if(!column.not_null)return 'NULL';
  if(column.type==='text')return q('synthetic');
  if(column.type==='uuid')return "'33333333-3333-4333-8333-333333333333'::uuid";
  if(column.type==='boolean')return 'true';
  if(column.type==='jsonb')return "'{}'::jsonb";
  if(column.type==='text[]')return "'{}'::text[]";
  if(column.type==='date')return "DATE '2026-10-10'";
  if(column.type==='timestamp with time zone')return "TIMESTAMPTZ '2026-10-10 13:14:15.123456+00'";
  return '0';
}
async function insert(table,overrides={}){
  const t=catalog.find(t=>t.table===table);
  await db.exec(`INSERT INTO pos.${table}(${t.columns.map(c=>'"'+c.name+'"').join(',')}) VALUES(${t.columns.map(c=>overrides[c.name]??defaultValue(c)).join(',')});`);
}
function firstEnvelope(snapshot){return snapshot.tables.flatMap(t=>t.rows).find(r=>r.row_json_text&&typeof r.row_json_text==='object');}

before(async()=>{
  await db.exec(`CREATE SCHEMA extensions;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE SCHEMA pos;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES('${SNAPSHOT_ACTOR}');`);
  await db.exec(catalog.map(t=>`CREATE TABLE pos.${t.table}(${t.columns.map(c=>`"${c.name}" ${c.type}${c.not_null?' NOT NULL':''}`).join(',')},PRIMARY KEY(${t.pk.map(k=>'"'+k+'"').join(',')}));`).join('\n'));
});
after(async()=>{await db.close();});

test('default retains original plain protocol; opt-in preserves every empty table and transaction guard',async()=>{
  assert.equal(plainSql().includes('pgp_sym_encrypt'),false);
  assert.equal(plainSql().includes('row_body_transport'),false);
  assert.match(plainSql(),/jsonb_agg\(jsonb_build_object/);
  assert.match(transportSql(),/json_agg\(json_build_object/);
  assert.match(transportSql(),/BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(transportSql(),/SNAPSHOT_COLUMN_CATALOG_DRIFT/);
  assert.throws(()=>buildLiveSnapshotSql({catalog,sourceUrl,bodyTransport:{passphrase:'unsafe'}}),/BODY_TRANSPORT_OPTION/);
  const a=await capture(plainSql()),b=await decode(await capture(transportSql()));
  assert.deepEqual(normalize(b.snapshot),normalize(a));
  assert.equal(b.evidence.encryptedBodies,0);assert.equal(b.snapshot.tables.length,64);
  validateLiveSnapshot(b.snapshot,{catalog,sourceUrl});
});

test('full SQL transport preserves canonical scale, Unicode, row order, hashes, restoration and sensitive omissions',async()=>{
  await insert('clients',{id:q('z-synthetic'),total:'116.00'});
  await insert('clients',{id:q('a-synthetic'),total:'0.00'});
  await insert('sellers',{id:q('null-secret'),password_hash:'NULL'});
  await insert('sellers',{id:q('private-secret'),password_hash:q('SYNTHETIC_SECRET_NEVER_TRANSMITTED')});
  const body=JSON.stringify({nested:JSON.stringify({text:('áé 漢字 🐆 "quotes" \\slash\n').repeat(4000),values:[0,1.01,null]})});
  await db.query("UPDATE pos.sellers SET avatar_url=$1 WHERE id='null-secret'",[body]);
  for(const name of ['point_zero_backups','capability_operation_audit','online_requests']){
    const t=catalog.find(t=>t.table===name),column=t.columns.find(c=>c.type==='jsonb');
    await insert(name,{[column.name]:q(body)+'::jsonb'});
  }
  baseline=await capture(plainSql());wire=await capture(transportSql());
  assert.deepEqual(wire.row_body_transport,ROW_BODY_TRANSPORT);
  assert.ok(firstEnvelope(wire));
  assert.equal(wire.tables.find(t=>t.table==='point_zero_backups').rows[0].restorable_row_json_text,null);
  assert.ok(wire.tables.find(t=>t.table==='sellers').rows.find(r=>JSON.parse(r.pk_json_text).id==='null-secret').restorable_row_json_text.ciphertextBase64);
  assert.equal(JSON.stringify(wire).includes(passphrase),false);
  assert.equal(JSON.stringify(wire).includes('SYNTHETIC_SECRET_NEVER_TRANSMITTED'),false);
  const decoded=await decode();validateLiveSnapshot(decoded.snapshot,{catalog,sourceUrl});
  assert.deepEqual(normalize(decoded.snapshot),normalize(baseline));
  assert.ok(decoded.evidence.encryptedBodies>=4);
  const clients=decoded.snapshot.tables.find(t=>t.table==='clients').rows;
  assert.ok(clients[1].row_json_text.includes('116.00'));
  assert.deepEqual(clients.map(r=>JSON.parse(r.pk_json_text).id),['a-synthetic','z-synthetic']);
});

test('exact baseline-body reuse NULLs survive encryption then existing restoration verifies every retained hash',async()=>{
  const reuseBaselineKeys=Object.fromEntries(LARGE_BASELINE_BODY_TABLES.map(name=>[name,
    baseline.tables.find(t=>t.table===name).rows.map(r=>r.pk_json_text).sort()]));
  const compact=await capture(transportSql({reusePointZeroBodies:true,reuseBaselineKeys}));
  assert.equal(compact.tables.find(t=>t.table==='point_zero_backups').rows[0].row_json_text,null);
  assert.equal(compact.tables.find(t=>t.table==='capability_operation_audit').rows[0].row_json_text,null);
  const decoded=await decode(compact),restored=rehydrateLivePointZeroSnapshot({input:decoded.snapshot,baseline,catalog,sourceUrl});
  validateLiveSnapshot(restored,{catalog,sourceUrl});
  assert.deepEqual(restored.tables,baseline.tables);assert.deepEqual(restored.catalog,baseline.catalog);
});

test('wrong passphrase and truncated ciphertext never yield a partial accepted snapshot',async()=>{
  await assert.rejects(decode(wire,randomBytes(32).toString('base64url')),/DECRYPT_FAILED/);
  const copy=structuredClone(wire),row=firstEnvelope(copy);
  row.row_json_text.ciphertextBase64=Buffer.from(row.row_json_text.ciphertextBase64,'base64').subarray(0,20).toString('base64');
  await assert.rejects(decode(copy),/DECRYPT_FAILED/);
});

test('false lengths, corrupt hashes, extra fields, malformed base64 and excessive sizes fail closed',async()=>{
  for(const [mutate,pattern] of [
    [e=>e.utf8Bytes++,/LENGTH_MISMATCH/],
    [e=>e.md5='0'.repeat(32),/HASH_BINDING/],
    [e=>e.sha256='0'.repeat(64),/BODY_HASH/],
    [e=>e.unexpected=true,/ENVELOPE_FIELDS/],
    [e=>e.ciphertextBase64+='!',/BASE64/],
    [e=>e.utf8Bytes=512*1024*1024+1,/LENGTH_INVALID/],
  ]){const copy=structuredClone(wire);mutate(firstEnvelope(copy).row_json_text);await assert.rejects(decode(copy),pattern);}
});

test('body substitution across rows, wrong source and table reordering cannot pass canonical binding',async()=>{
  let copy=structuredClone(wire);
  const rows=copy.tables.flatMap(t=>t.rows).filter(r=>r.row_json_text&&typeof r.row_json_text==='object');
  [rows[0].row_json_text,rows[1].row_json_text]=[rows[1].row_json_text,rows[0].row_json_text];
  await assert.rejects(decode(copy),/HASH_BINDING/);
  copy=structuredClone(wire);copy.source_url='https://foreign.supabase.co/';await assert.rejects(decode(copy),/BINDING/);
  copy=structuredClone(wire);[copy.tables[0],copy.tables[1]]=[copy.tables[1],copy.tables[0]];
  await assert.rejects(decode(copy),/TABLE_ORDER/);
});

test('operator I/O executes private SQL, decodes before canonical persistence and exposes only transport metadata',async()=>{
  const directory=resolve('.evidence-h171-private','h186-io-local-'+randomUUID());
  const linked=join(directory,'linked'),cli=join(directory,'local-transport-cli.mjs');
  await fs.mkdir(join(linked,'supabase','.temp'),{recursive:true,mode:0o700});
  await fs.writeFile(join(linked,'supabase','.temp','project-ref'),SNAPSHOT_PROJECT,{flag:'wx',mode:0o600});
  await fs.writeFile(cli,'// Intercepted local test boundary; never executes or connects.\n',{flag:'wx',mode:0o600});
  const cp=createRequire(import.meta.url)('node:child_process'),real=cp.execFile;
  const fake=()=>{throw Error('ASYNC_SQL_ADAPTER_REQUIRED');};
  let executions=0;
  fake[promisify.custom]=async(executable,args,options)=>{
    assert.equal(executable,process.execPath);assert.equal(args[0],cli);assert.equal(options.cwd,linked);
    assert.equal(options.windowsHide,true);assert.deepEqual(args.slice(1,4),['db','query','--linked']);
    const sqlFile=args[args.indexOf('--file')+1],sql=await fs.readFile(sqlFile,'utf8');
    assert.ok(sqlFile.startsWith(directory));assert.match(sql,/REPEATABLE READ READ ONLY/);
    const results=await db.exec(sql);executions++;
    return {stdout:JSON.stringify({rows:results.flatMap(result=>result.rows||[])}),stderr:''};
  };
  let createLiveAuthorityIO;
  try{cp.execFile=fake;syncBuiltinESMExports();({createLiveAuthorityIO}=await import('./h171-live-authority-io.mjs?local-h186-transport'));
  }finally{cp.execFile=real;syncBuiltinESMExports();}
  const io=await createLiveAuthorityIO({cliPath:cli,linkedDirectory:linked,privateDirectory:join(directory,'run'),
    catalog,sourceUrl,privateSnapshotTransport:'pgcrypto-row-v1'});
  const captured=await io.capture('local-capture');assert.equal(executions,1);
  validateLiveSnapshot(captured.snapshot,{catalog,sourceUrl});
  assert.deepEqual(normalize(captured.snapshot),normalize(baseline));
  const saved=await read(captured.evidence.file);
  assert.deepEqual(saved.local,{path:captured.evidence.file,sourceUrl});
  const {local:localMetadata,...savedCanonical}=saved;assert.deepEqual(savedCanonical,captured.snapshot);
  assert.equal(saved.row_body_transport,undefined);
  const response=await read(captured.queryEvidence.file);
  assert.deepEqual(response.rows.find(r=>r.report).report.row_body_transport,ROW_BODY_TRANSPORT);
  assert.ok(captured.transportEvidence.encryptedBodies>=4);assert.equal(captured.transportEvidence.verified,true);
});
