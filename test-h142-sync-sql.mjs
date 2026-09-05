// Real PostgreSQL engine in memory. No production connection or business data.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.BALAM_PGLITE_MODULE ? pathToFileURL(process.env.BALAM_PGLITE_MODULE).href : '@electric-sql/pglite');
const db=new PGlite();
const baseline=process.argv.includes('--baseline');
try {
 await db.exec(`create schema auth; create schema pos;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}')$$;
 create table pos.sync_devices(device_id text primary key,user_id uuid,user_email text,client_build text,
 protocol_version integer,schema_version bigint,data_epoch bigint,cursors jsonb,queue_pending integer,queue_blocked integer,
 status text,last_seen_at timestamptz,last_synced_at timestamptz);
 insert into pos.sync_devices(device_id,user_id) values('existing','14200000-0000-4000-8000-000000000001');`);
 const file='supabase/migrations/20260905017800_pos_h142_sync_confirmation.sql';
 let sql=fs.readFileSync(file,'utf8');
 if(baseline) sql=sql.replace('coalesce(excluded.last_synced_at,pos.sync_devices.last_synced_at)','excluded.last_synced_at');
 await db.exec(sql);
 const before=JSON.stringify((await db.query('select * from pos.sync_devices')).rows);
 await db.exec(fs.readFileSync('supabase/migrations/20260905017900_pos_h142_sync_confirmation_verification.sql','utf8'));
 const after=JSON.stringify((await db.query('select * from pos.sync_devices')).rows);
 if(before!==after) throw Error('Probe modified pre-existing rows');
 console.log('PASS H142 SQL: null preserved, confirmation advances, revoked remains, invalid counts/auth denied, fixture rollback, prior rows unchanged.');
} catch(error) {console.error('FAIL H142 SQL:',error.code,error.message);process.exitCode=1;} finally {await db.close();}
