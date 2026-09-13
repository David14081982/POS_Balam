// LOCAL PGlite fixture installation only. Never pass a remote executor/client.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { AUTH_INCOMING_FKS } from './h171-auth-retirement.mjs';

export async function installAuthPreflightTestSchema({pg,cleanupCatalog}) {
  assert.ok(pg instanceof PGlite,'Only an in-process PGlite fixture is supported');
  const known=cleanupCatalog.rows?.[0]?.report||cleanupCatalog;
  const fn=known.functions.find(f=>f.function==='pos.h166_advance_snapshot_revision()');
  assert.equal(fn.definition_md5,'d5a52190abeafe3651416410e174a3e7');
  assert.equal(createHash('md5').update(fn.definition).digest('hex'),fn.definition_md5);
  await pg.exec(`CREATE SCHEMA IF NOT EXISTS auth;CREATE SCHEMA IF NOT EXISTS storage;
 CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY);
 ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text;
 ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb;
 ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb;
 ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz;
 ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS encrypted_password text;
 CREATE TABLE IF NOT EXISTS storage.objects(id uuid PRIMARY KEY,owner uuid,owner_id text);
 CREATE TABLE IF NOT EXISTS storage.buckets(id text PRIMARY KEY,owner uuid,owner_id text);
 CREATE TABLE IF NOT EXISTS storage.s3_multipart_uploads(id text PRIMARY KEY,owner_id text);
 CREATE TABLE IF NOT EXISTS storage.s3_multipart_uploads_parts(id text PRIMARY KEY,owner_id text);`);
  for(const f of AUTH_INCOMING_FKS) {
    const [schema,table]=f.relation.split('.');
    if(schema==='auth')await pg.exec(`CREATE TABLE IF NOT EXISTS auth.${table}(id uuid PRIMARY KEY,user_id uuid);`);
    const existing=await pg.query(`SELECT c.confdeltype::text effect FROM pg_constraint c
     JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
     WHERE c.contype='f' AND c.conrelid=$1::regclass AND c.confrelid='auth.users'::regclass
      AND cardinality(c.conkey)=1 AND a.attname=$2`,[f.relation,f.column]);
    assert.ok(existing.rows.length<=1,'Duplicate incoming Auth FK');
    if(existing.rows.length)assert.equal(existing.rows[0].effect,f.effect,'Existing Auth FK must match recorded delete action');
    else await pg.exec(`ALTER TABLE ${f.relation} ADD CONSTRAINT ${table}_${f.column}_fkey FOREIGN KEY(${f.column}) REFERENCES auth.users(id)${f.effect==='c'?' ON DELETE CASCADE':f.effect==='n'?' ON DELETE SET NULL':''};`);
  }
  await pg.exec(fn.definition+';');
  const tables=new Set(AUTH_INCOMING_FKS.filter(f=>f.relation.startsWith('pos.')).map(f=>f.relation));
  const triggers=known.triggers.filter(t=>t.name==='h166_snapshot_changed'&&tables.has(t.table));
  assert.equal(triggers.length,5);
  for(const t of triggers) {
    const existing=await pg.query("SELECT 1 FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname='h166_snapshot_changed'",[t.table]);
    if(!existing.rows.length)await pg.exec(t.definition+';');
  }
  return {local:true,authIncomingFks:18,nativeAuthTables:8,storageOwnerColumns:6,h166SourceTables:5,expectedRevisionDelta:7,functionMd5:fn.definition_md5};
}
