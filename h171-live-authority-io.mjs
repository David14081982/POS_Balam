// H171 operator I/O. Only the explicitly supplied BALAM linked project is usable.
// Credentials and child stdout/stderr never enter thrown errors or console output.
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { resolve, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { createHash,randomBytes } from 'node:crypto';
import { journalHash } from './h171-live-journal.mjs';
import { SNAPSHOT_PROJECT, SNAPSHOT_ACTOR, snapshotConnection, buildLiveSnapshotSql,
  validateLiveSnapshot, writePrivateLiveSnapshot, rehydrateLivePointZeroSnapshot, LARGE_BASELINE_BODY_TABLES } from './h171-live-snapshot.mjs';
import {decodePrivateSnapshotBodies} from './h171-live-snapshot-transport.mjs';

const execute = promisify(execFile);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export async function durableJson(file, value) {
  await fs.mkdir(resolve(file, '..'), { recursive: true });
  const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  const handle=await fs.open(file,'wx',0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  assert.ok((await fs.readFile(file)).equals(bytes),'DURABLE_FILE_READBACK_MISMATCH');
  return {file:resolve(file),sha256:sha(bytes),bytes:bytes.length};
}
export async function createLiveAuthorityIO({cliPath,linkedDirectory,privateDirectory,catalog,sourceUrl,privateSnapshotTransport='plain'}) {
  snapshotConnection(sourceUrl);
  assert.ok(['plain','pgcrypto-row-v1'].includes(privateSnapshotTransport),'PRIVATE_SNAPSHOT_TRANSPORT_INVALID');
  const privateRoot=resolve('.evidence-h171-private'),directory=resolve(privateDirectory);
  const inside=relative(privateRoot,directory);
  assert.ok(inside&&!inside.startsWith('..')&&!inside.includes(':'),'PRIVATE_RUN_DIRECTORY_REQUIRED');
  assert.ok(privateRoot.split(sep).includes('.evidence-h171-private'));
  const cli=resolve(cliPath),linked=resolve(linkedDirectory);
  await fs.access(cli);
  const verifyConnection=async()=>assert.equal((await fs.readFile(join(linked,'supabase','.temp','project-ref'),'utf8')).trim(),SNAPSHOT_PROJECT,'LINKED_PROJECT_MISMATCH');
  await verifyConnection(); await fs.mkdir(directory,{recursive:true});
  async function query(sql,label) {
    assert.match(label,/^[a-z][a-z0-9-]*$/);
    await verifyConnection();
    const file=join(directory,label+'.sql'),handle=await fs.open(file,'wx',0o600);
    try { await handle.writeFile(sql,'utf8');await handle.sync(); } finally { await handle.close(); }
    let stdout;
    try { ({stdout}=await execute(process.execPath,[cli,'db','query','--linked','--file',file,'--output','json'],
      {cwd:linked,encoding:'utf8',timeout:240000,maxBuffer:160*1024*1024,windowsHide:true})); }
    catch(error) {
      const diagnostic={code:'BALAM_SQL_EXECUTION_UNCONFIRMED',exitCode:typeof error.code==='number'?error.code:null,
        killed:error.killed===true,signal:error.signal||null,outputLimit:error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
        statementTimeout:/statement timeout/i.test(error.stderr||''),networkTimeout:/timeout|timed out/i.test(error.stderr||''),
        sqlState:(String(error.stderr||'').match(/SQLSTATE[ :]+([0-9A-Z]{5})/)||[])[1]||null,
        stderrBytes:Buffer.byteLength(error.stderr||''),stdoutBytes:Buffer.byteLength(error.stdout||''),sqlSha256:journalHash(sql)};
      await durableJson(join(directory,label+'-failure.json'),diagnostic);
      throw Object.assign(Error('BALAM_SQL_EXECUTION_UNCONFIRMED'),diagnostic);
    }
    let payload;
    try { payload=JSON.parse(stdout.replace(/^\uFEFF/,'')); } catch { throw Error('BALAM_SQL_RESULT_PARSE_FAILED_RECONCILE_BEFORE_RETRY'); }
    const evidence=await durableJson(join(directory,label+'-response.json'),payload);
    const rows=Array.isArray(payload)?payload:payload.rows;
    assert.ok(Array.isArray(rows),'BALAM_SQL_RESULT_ROWS_REQUIRED');
    return {payload,rows,evidence,sqlSha256:journalHash(sql),exitCode:0};
  }
  async function capture(label,{reusePointZeroFrom}={}) {
    // Validate the original durable snapshot before any optional compact read.
    if(reusePointZeroFrom)validateLiveSnapshot(reusePointZeroFrom,{catalog,sourceUrl});
    const reuseBaselineKeys=reusePointZeroFrom?Object.fromEntries(LARGE_BASELINE_BODY_TABLES.map(name=>[name,
      reusePointZeroFrom.tables.find(t=>t.table===name).rows.map(row=>row.pk_json_text).sort()])):null;
    const passphrase=privateSnapshotTransport==='pgcrypto-row-v1'?randomBytes(32).toString('base64url'):null;
    const result=await query(buildLiveSnapshotSql({catalog,sourceUrl,reusePointZeroBodies:!!reusePointZeroFrom,reuseBaselineKeys,
      bodyTransport:passphrase?{passphrase}:null}),label);
    const reports=result.rows.filter(row=>row.report?.format==='balam-canonical-snapshot-v1');
    assert.equal(reports.length,1,'ONE_CANONICAL_REPORT_REQUIRED');
    const decoded=passphrase?await decodePrivateSnapshotBodies({input:reports[0].report,passphrase,catalog,
      sourceUrl:snapshotConnection(sourceUrl).sourceUrl,projectRef:SNAPSHOT_PROJECT}):{snapshot:reports[0].report};
    const snapshot=reusePointZeroFrom
      ? rehydrateLivePointZeroSnapshot({input:decoded.snapshot,baseline:reusePointZeroFrom,catalog,sourceUrl})
      : validateLiveSnapshot(decoded.snapshot,{catalog,sourceUrl}).snapshot;
    const evidence=await writePrivateLiveSnapshot({input:snapshot,catalog,sourceUrl,
      file:join(directory,label+(reusePointZeroFrom?'.json.gz':'.json')),privateRoot,compressGzip:!!reusePointZeroFrom});
    return {snapshot,evidence,queryEvidence:result.evidence,...(decoded.evidence?{transportEvidence:decoded.evidence}:{})};
  }
  async function authBaseline({baseline,run,actorId,artifactSha256}) {
    assert.notEqual(actorId,SNAPSHOT_ACTOR);assert.ok(!baseline.snapshot.auth_user_ids.includes(actorId),'PLANNED_AUTH_ID_ALREADY_EXISTS');
    const value={format:'balam-live-auth-baseline-v1',projectRef:SNAPSHOT_PROJECT,run,actorId,artifactSha256,
      snapshotSha256:journalHash(baseline.snapshot),complete:true,ids:baseline.snapshot.auth_user_ids};
    const evidence=await durableJson(join(directory,'auth-baseline.json'),value);
    return {...value,fileSha256:evidence.sha256};
  }
  return {query,capture,authBaseline,directory,sourceUrl,catalog,verifyConnection};
}
