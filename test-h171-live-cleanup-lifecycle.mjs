// Complete local lifecycle: actual PostgreSQL SQL, canonical snapshots, FK actions
// and recorded H166 function. The injected GoTrue transport performs LOCAL SQL only.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { createLiveCleanupPlanFixture } from './test-h171-live-cleanup-plan.mjs';
import { installAuthPreflightTestSchema } from './h171-auth-preflight-test-schema.mjs';
import { createLiveCleanupLifecycle } from './h171-live-cleanup-lifecycle.mjs';
import { durableJson } from './h171-live-authority-io.mjs';
import { journalHash } from './h171-live-journal.mjs';
import { buildLiveSnapshotSql,validateLiveSnapshot,SNAPSHOT_PROJECT,SNAPSHOT_ACTOR,diffLiveSnapshots } from './h171-live-snapshot.mjs';
import { buildAuthCleanupPreflightSql,validateAuthCleanupPreflight } from './h171-live-cleanup-auth-preflight.mjs';

const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const cleanupCatalog=await read('docs/fixes/evidence/h171/cleanup-catalog-before.json');
const sourceUrl=`https://${SNAPSHOT_PROJECT}.supabase.co/`,protectedRequest='70549527-4867-4342-94d2-38e770b0f2a9';
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const results=[];
async function scenario({injectForeignChange=false}) {
  let lifecycle,io,setup,sdk,readAuthPreflight,postSqlSnapshot,baselineSnapshot,finalSnapshot;
  const authDeletes=[],authGets=[],sqlCalls=[],preflights=[];
  const f=await createLiveCleanupPlanFixture({sourceUrl,keepJournalOpen:true,
    async beforeBaseline({db,insert}) {
      // PGlite inherits this workstation's Etc/GMT+7. The controlled SDK emits
      // PostgREST UTC/ISO JSON directly from SQL, preserving all microseconds.
      await db.exec("SET TimeZone='UTC';SET DateStyle='ISO, MDY';");
      setup=await installAuthPreflightTestSchema({pg:db,cleanupCatalog});
      await db.query("UPDATE auth.users SET email='local-real-anchor@example.test',created_at='2026-09-12T00:00:00Z',encrypted_password='LOCAL_FOREIGN_SECRET_SENTINEL' WHERE id=$1",[SNAPSHOT_ACTOR]);
      await insert('online_account_requests',{actor_id:q(SNAPSHOT_ACTOR),request_id:q(protectedRequest),state:"'completed'",action:"'delete'",result:"'{\"ok\":true}'::jsonb"});
    },
    async onBaseline({db,catalog,fixtures,accountId,journal,artifactSha256,directory}) {
      const quoteName=name=>{assert.match(name,/^[a-z_][a-z0-9_]*$/);return '"'+name+'"';};
      const forbidden=()=>{throw Error('LOCAL_TEST_FORBIDS_UNREQUESTED_MUTATION_OR_NETWORK');};
      const dbClient={url:sourceUrl.slice(0,-1)+'/rest/v1',schemaName:'pos',rpc:forbidden,
        from(table) {
          assert.ok(catalog.some(t=>t.table===table));const filters=[],query={select(){return query;},eq(column,value){
            assert.ok(catalog.find(t=>t.table===table).columns.some(c=>c.name===column));filters.push([column,value]);return query;},
            async limit(limit) {
              assert.ok(Number.isSafeInteger(limit)&&limit>0&&limit<=1001);
              const where=filters.map(([column],i)=>quoteName(column)+'=$'+(i+1)).join(' AND ');
              const rows=(await db.query(`SELECT to_jsonb(t) body FROM pos.${quoteName(table)} t WHERE ${where} LIMIT ${limit}`,filters.map(([,v])=>v))).rows;
              return {data:rows.map(r=>r.body),error:null};
            },insert:forbidden,update:forbidden,delete:forbidden};return query;
        }};
      sdk={supabaseUrl:sourceUrl.slice(0,-1),auth:{admin:{url:sourceUrl.slice(0,-1)+'/auth/v1',
        async getUserById(id) {
          authGets.push(id);
          const rows=(await db.query(`SELECT jsonb_build_object('id',id,'email',email,'created_at',created_at,
            'user_metadata',raw_user_meta_data,'app_metadata',raw_app_meta_data) body FROM auth.users WHERE id=$1`,[id])).rows;
          return rows.length?{data:{user:rows[0].body},error:null}:{data:{user:null},error:{status:404,code:'user_not_found'}};
        },
        async deleteUser(id,soft) {
          assert.equal(soft,false);assert.notEqual(id,SNAPSHOT_ACTOR);
          assert.ok([fixtures.plannedActorId,accountId].includes(id));
          assert.ok(!authDeletes.some(d=>d.id===id),'No repeated DELETE allowed');
          const before=(await db.query('SELECT revision::text FROM pos.online_snapshot_revision')).rows[0].revision;
          const deleted=await db.query('DELETE FROM auth.users WHERE id=$1 RETURNING id',[id]);
          assert.equal(deleted.rows.length,1);
          const after=(await db.query('SELECT revision::text FROM pos.online_snapshot_revision')).rows[0].revision;
          // The database FK action statements call H166. No manual +7 update.
          assert.equal(BigInt(after)-BigInt(before),7n);authDeletes.push({id,before,after,delta:7});
          return {data:{user:null},error:null};
        },createUser:forbidden,listUsers:forbidden,updateUserById:forbidden}}};
      io={catalog,sourceUrl,directory,
        async query(sql,label) {
          sqlCalls.push(label);await fs.writeFile(join(directory,label+'.sql'),sql,{flag:'wx',mode:0o600});
          if(label==='cleanup-execution'&&injectForeignChange)await db.exec("UPDATE pos.products SET stock_quantity=36 WHERE id='real-product';");
          let output;try{output=await db.exec(sql);}catch(error){await db.exec('ROLLBACK;');delete error.query;throw error;}
          const rows=output.flatMap(r=>r.rows),evidence=await durableJson(join(directory,label+'-response.json'),{rows});
          return {rows,evidence,sqlSha256:journalHash(sql),exitCode:0};
        },
        async capture(label) {
          const result=await io.query(buildLiveSnapshotSql({catalog,sourceUrl}),label);
          const reports=result.rows.filter(r=>r.report?.format==='balam-canonical-snapshot-v1');assert.equal(reports.length,1);
          const snapshot=validateLiveSnapshot(reports[0].report,{catalog,sourceUrl}).snapshot;
          if(label==='before-fixtures')baselineSnapshot=snapshot;if(label==='after-sql-cleanup')postSqlSnapshot=snapshot;if(label==='after-all-cleanup')finalSnapshot=snapshot;
          const evidence=await durableJson(join(directory,label+'.json'),snapshot);return {snapshot,evidence};
        },
        async authBaseline({baseline,run,actorId,artifactSha256}) {
          assert.deepEqual(baseline.snapshot.auth_user_ids,[SNAPSHOT_ACTOR]);assert.ok(!baseline.snapshot.auth_user_ids.includes(actorId));
          const value={format:'balam-live-auth-baseline-v1',projectRef:SNAPSHOT_PROJECT,run,actorId,artifactSha256,
            snapshotSha256:journalHash(baseline.snapshot),complete:true,ids:baseline.snapshot.auth_user_ids};
          const evidence=await durableJson(join(directory,'auth-baseline.json'),value);return {...value,fileSha256:evidence.sha256};
        }};
      readAuthPreflight=async({plan,label})=>{
        const result=await io.query(buildAuthCleanupPreflightSql({plan,catalog,sourceUrl}),label);
        const report=result.rows.find(r=>r.report?.format==='balam-live-auth-preflight-v1')?.report;
        const checked=validateAuthCleanupPreflight({input:report,plan,catalog,sourceUrl});
        assert.equal(checked.ready,true,checked.blockers.join(','));preflights.push(checked.preflight);return checked.preflight;
      };
      // Invoked while the real anchor is the only Auth row. Both future fixture
      // identities and their journal intents are created after this capture.
      assert.equal((await db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,1);
      lifecycle=await createLiveCleanupLifecycle({io,db:dbClient,admin:sdk,journal,fixtures,artifactSha256,
        clientBuild:'2026-09-12-h166-online',readAuthPreflight});
    },
    async afterFixtures({db,userRecords}) {
      for(const [id,user] of userRecords) {
        await db.query('UPDATE auth.users SET email=$2,created_at=$3,encrypted_password=$4 WHERE id=$1',[id,user.email,user.created_at,'LOCAL_QA_SECRET_SENTINEL']);
        await db.query('INSERT INTO auth.identities(id,user_id) VALUES($1,$2)',[randomUUID(),id]);
      }
    }});
  try {
    assert.equal(setup.expectedRevisionDelta,7);assert.equal(setup.authIncomingFks,18);
    if(injectForeignChange) {
      await assert.rejects(lifecycle.finalize(),/CLEANUP_LOCKED_BASELINE_DRIFT:products/);
      assert.equal(authDeletes.length,0);assert.equal(sqlCalls.filter(s=>s==='cleanup-execution').length,1);
      assert.equal((await f.db.query('SELECT count(*)::int n FROM auth.users')).rows[0].n,3);
      assert.equal((await f.db.query('SELECT count(*)::int n FROM pos.sale_items')).rows[0].n,1);
      assert.equal((await f.db.query("SELECT count(*)::int n FROM pos.products WHERE id IN('new-product','new-product-2')")).rows[0].n,2);
      assert.equal((await f.db.query('SELECT count(*)::int n FROM auth.identities')).rows[0].n,2);
      return {case:'foreign hash changed immediately before SQL',pass:true,sqlAttempts:1,authDeletes:0,rollbackVerified:true,remoteCalls:0};
    }
    const report=await lifecycle.finalize();
    assert.equal(report.cleanupVerified,true);assert.equal(report.certified,false);assert.equal(report.exactRowsDeleted,60);
    assert.equal(report.newPosResidue,0);assert.equal(report.newAuthResidue,0);assert.equal(report.nonQaPreserved,true);
    assert.equal(authDeletes.length,2);assert.deepEqual(authDeletes.map(d=>d.delta),[7,7]);
    assert.deepEqual(finalSnapshot.auth_user_ids,baselineSnapshot.auth_user_ids);assert.deepEqual(finalSnapshot.auth_user_ids,[SNAPSHOT_ACTOR]);
    assert.equal((await f.db.query('SELECT count(*)::int n FROM auth.identities')).rows[0].n,0);
    const diff=diffLiveSnapshots({baseline:baselineSnapshot,final:finalSnapshot,catalog:f.catalog,sourceUrl});
    assert.equal(diff.nonQaPreservedWithMonotonicAdvances,true);assert.equal(diff.new.length,0);assert.equal(diff.removed.length,0);
    assert.deepEqual(preflights.at(-1).pos_fingerprints.filter(t=>t.table!=='online_snapshot_revision'),preflights[0].pos_fingerprints.filter(t=>t.table!=='online_snapshot_revision'));
    assert.equal(preflights[0].pos_fingerprints.length,64);assert.equal(preflights[0].fk_catalog.length,18);
    assert.ok(preflights.every(p=>p.storage_owner_counts.every(c=>c.rows===0)));
    const currentRevision=s=>s.tables.find(t=>t.table==='online_snapshot_revision').rows[0].monotonic.counter;
    assert.equal(BigInt(currentRevision(finalSnapshot))-BigInt(currentRevision(postSqlSnapshot)),14n);
    assert.ok(!JSON.stringify(report).includes('SECRET_SENTINEL'));
    await assert.rejects(lifecycle.finalize(),/CLEANUP_LIFECYCLE_ALREADY_ATTEMPTED/);assert.equal(authDeletes.length,2);
    return {case:'complete controller SQL + GoTrue adapter + real FK H166 actions',pass:true,sqlRows:60,sqlTables:31,
      posTablesPreserved:63,authDeletes:2,authDeltaPerDelete:authDeletes.map(d=>d.delta),remainingAuth:1,nativeAuthChildrenRemaining:0,
      foreignActorPreserved:true,protectedRequestPreserved:true,baselinePreserved:true,readOnlyPreflights:preflights.length,
      cleanupVerified:report.cleanupVerified,certified:report.certified,remoteCalls:0};
  }finally{await f.close();}
}
for(const options of [{},{injectForeignChange:true}]) {
  try{results.push(await scenario(options));}catch(error){results.push({case:options.injectForeignChange?'foreign hash guard':'complete lifecycle',pass:false,code:error.code||null,error:error.message,stack:error.stack});}
}
const hashFile=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
const report={scope:'LOCAL_PGLITE_FULL_LIFECYCLE',tests:results.length,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,
  results,controllerSha256:await hashFile('h171-live-cleanup-lifecycle.mjs'),testSha256:await hashFile('test-h171-live-cleanup-lifecycle.mjs'),
  snapshotSha256:await hashFile('h171-live-snapshot.mjs'),assemblerSha256:await hashFile('h171-live-cleanup-plan.mjs'),
  authReaderSha256:await hashFile('h171-live-cleanup-auth-preflight.mjs'),authAdapterSha256:await hashFile('h171-live-cleanup-auth.mjs'),
  remoteCalls:0,certified:false,scopeLimit:'Local cleanup machinery with real recorded FK and H166 function; browser A/B/C business scenarios and deployed environment require their separate live evidence.'};
await fs.writeFile('docs/fixes/evidence/h171/live-cleanup-lifecycle-local.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(report.failed)process.exitCode=1;
