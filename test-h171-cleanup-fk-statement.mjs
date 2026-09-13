// One focal LOCAL PGlite reproduction: recorded H166/FK, no remote executor.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {recordedSnapshotCatalog} from './h171-live-snapshot.mjs';
import {LIVE_CLEANUP_ORDER} from './h171-live-cleanup-sql.mjs';
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const authorityAudit=await read('docs/fixes/evidence/h171/authority-audit-before.json');
const cleanupCatalog=await read('docs/fixes/evidence/h171/cleanup-catalog-before.json');
const actual=cleanupCatalog.rows[0].report,audit=authorityAudit.rows[0].report;
const plan=await read('.evidence-h171-private/live-runs/57a5e11f-7a4b-4926-9993-f9f712d12063/cleanup-plan.json');
const catalog=recordedSnapshotCatalog({authorityAudit,cleanupCatalog}),fn=actual.functions.find(f=>f.function==='pos.h166_advance_snapshot_revision()');
const fk=audit.foreign_keys.find(f=>f.constraint==='sale_items_folio_fkey');
assert.equal(createHash('md5').update(fn.definition).digest('hex'),'d5a52190abeafe3651416410e174a3e7');
assert.equal(fk.definition,'FOREIGN KEY (folio) REFERENCES pos.sales(folio) ON DELETE CASCADE');
const q=v=>"'"+String(v).replaceAll("'","''")+"'",tables=LIVE_CLEANUP_ORDER.filter(t=>plan.targets.some(r=>r.table===t)),checks=[];
const db=new PGlite();
try{
  await db.exec("SET TimeZone='UTC';SET DateStyle='ISO, MDY';CREATE SCHEMA pos;"+
    catalog.filter(t=>tables.includes(t.table)||t.table==='online_snapshot_revision').map(t=>`CREATE TABLE pos.${t.table}(${t.columns.map(c=>`"${c.name}" ${c.type}${c.not_null?' NOT NULL':''}`).join(',')},PRIMARY KEY(${t.pk.join(',')}));`).join('')+
    "INSERT INTO pos.online_snapshot_revision(singleton,revision) VALUES(true,0);"+fn.definition+';'+
    `ALTER TABLE ${fk.source} ADD CONSTRAINT ${fk.constraint} ${fk.definition};`+
    actual.triggers.filter(t=>t.name==='h166_snapshot_changed'&&tables.includes(t.table.slice(4))).map(t=>t.definition+';').join(''));
  const revision=async()=>Number((await db.query('SELECT revision FROM pos.online_snapshot_revision')).rows[0].revision);
  const insert=async r=>db.exec(`INSERT INTO pos.${r.table} SELECT * FROM jsonb_populate_record(NULL::pos.${r.table},${q(r.row_json_text)}::jsonb);`);
  for(const parents of [1,2]){
    await db.exec('BEGIN;');for(const r of plan.targets.filter(t=>t.table==='sales').slice(0,parents))await insert(r);
    assert.equal((await db.query('SELECT count(*)::int n FROM pos.sale_items')).rows[0].n,0);
    const before=await revision();await db.exec('WITH removed AS(DELETE FROM pos.sales RETURNING folio) SELECT count(*) FROM removed;');
    const delta=(await revision())-before;assert.equal(delta,2);
    checks.push({parents,children:0,deleteStatements:1,revisionDelta:delta,interpretation:'one sales statement plus one grouped empty sale_items statement'});
    await db.exec('ROLLBACK;');
  }
  await db.exec('BEGIN;');for(const table of [...tables].reverse())for(const r of plan.targets.filter(t=>t.table===table))await insert(r);
  const before=await revision(),deltas=[];
  for(const table of tables){const start=await revision(),count=plan.targets.filter(t=>t.table===table).length;
    const removed=await db.query(`WITH removed AS(DELETE FROM pos.${table} RETURNING 1) SELECT count(*)::int n FROM removed`);
    assert.equal(removed.rows[0].n,count);deltas.push({table,rows:count,revisionDelta:(await revision())-start});}
  const observed=(await revision())-before;assert.equal(observed,9);assert.equal(deltas.find(t=>t.table==='sales').revisionDelta,2);
  await db.exec('ROLLBACK;');
  const output={format:'balam-h171-fk-statement-revision-local-v1',at:new Date().toISOString(),localOnly:true,remoteWrites:0,
    run:plan.run,functionDefinitionMd5:fn.definition_md5,fk:fk.definition,checks,exactFixtureRows:plan.targets.length,
    directInvalidatingStatements:deltas.filter(t=>t.revisionDelta>0).length,observedRevisionDelta:observed,previousIncorrectExpectation:10,correctedExpectation:9,deltas,
    scope:'Actual recorded column types, H166 definitions and sale_items FK; all28 backed rows. Other business guards are outside this narrow trigger-count reproduction.',
    revisionGuardStillExact:true,noRevisionRewind:true,certified:false};
  await fs.writeFile('docs/fixes/evidence/h171/final-cleanup-fk-statement-local.json',JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({PASS:true,parents1Delta:2,parents2Delta:2,exactRows:28,observedRevisionDelta:9,remoteWrites:0}));
}catch(error){console.error(JSON.stringify({localTestFailed:true,code:error.code||null,message:error.message}));process.exitCode=1;}
finally{await db.close();}
