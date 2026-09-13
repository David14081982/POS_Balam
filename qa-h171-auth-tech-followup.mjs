// Read-only SQL generation from BALAM's exact recorded identities; no network.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const dir='docs/fixes/evidence/';
const read=async p=>JSON.parse((await fs.readFile(p,'utf8')).replace(/^\uFEFF/,''));
const audit=(await read(dir+'h171/authority-audit-before.json')).rows[0].report;
const inventory=(await read(dir+'h171/auth-tech-before.json')).rows[0].report;
const six=(await read(dir+'h171/auth-tech-six-receipts-before.json')).rows[0].report;
const backup=(await read('.evidence-h171-private/auth-tech-backup.json')).rows[0].private_snapshot;
const hash=s=>createHash('sha256').update(s).digest('hex');
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
const ident=s=>'"'+s.replaceAll('"','""')+'"';
const key=r=>r.table+'|'+JSON.stringify(r.pk,Object.keys(r.pk).sort());
const commercialIds=new Set(inventory.rows.filter(r=>r.in_separate_commercial_manifest).map(key));
const exact321=backup.technical_rows.map(r=>({table:r.table,pk:r.pk,expected_md5:r.projected_row_md5,proof:'exact QA technical inventory',commercial_overlap:commercialIds.has(key(r))}));
if(exact321.length!==321||six.matched_receipts!==6||six.receipts.some(r=>!r.unchanged_since_inventory||r.contains_current_sale_operation))throw Error('Exact scope changed');
const sixScope=six.receipts.map(r=>{
 const prior=inventory.rows.find(x=>x.table==='online_requests'&&x.pk.actor_id===r.actor_id&&x.pk.request_id===r.request_id);
 if(!prior)throw Error('Receipt lacks exact prior identity');
 return {table:'online_requests',pk:prior.pk,expected_md5:prior.projected_row_md5,proof:'six receipts identity review: different QA operation/product; folio alone is not identity',commercial_overlap:false};
});
const scope=[...exact321,...sixScope].sort((a,b)=>key(a).localeCompare(key(b)));
if(new Set(scope.map(key)).size!==327||scope.some(r=>Object.values(r.pk).includes('70549527-4867-4342-94d2-38e770b0f2a9')||Object.values(r.pk).includes('3f24222e-fd74-4ed2-b56f-f298af574b1e')))throw Error('Unsafe manifest');
const candidateKeys=new Set(scope.map(key));
const receiptIds=new Set(scope.filter(r=>['capability_operation_audit','online_requests','online_account_requests'].includes(r.table)).flatMap(r=>[r.pk.operation_id,r.pk.request_id]).filter(Boolean));
const outsideReceiptReferences=inventory.receipt_incoming_references.filter(r=>receiptIds.has(r.identity)&&!candidateKeys.has(key({table:r.source_table,pk:r.source_pk}))&&!commercialIds.has(key({table:r.source_table,pk:r.source_pk})));
const candidateDevices=scope.filter(r=>r.table==='sync_devices').map(r=>r.pk.device_id);
const outsideDeviceReferences=inventory.rows.filter(r=>r.exact_matches?.some(m=>m.kind==='qa_device'&&candidateDevices.includes(m.value))&&!candidateKeys.has(key(r))&&!commercialIds.has(key(r))).map(r=>({table:r.table,pk:r.pk,projected_row_md5:r.projected_row_md5,classification:r.classification}));
await fs.writeFile(dir+'h171-auth-tech-reference-review.json',JSON.stringify({scope:'Exact candidate references outside technical327 and commercial149; preserve, never implicitly cascade',project_ref:'telohdbvbvsfmwyriflz',outsideReceiptReferences,outsideDeviceReferences,limits:['These are value links, not inferred foreign keys.','Linked history stays intact; QA receipts require a durable exact audit archive before any approved retirement.','No additional rows become removal candidates through this review.']},null,2)+'\n');
const branches=[...new Set(scope.map(r=>r.table))].map(table=>{
 const rows=scope.filter(r=>r.table===table);const pkKeys=Object.keys(rows[0].pk);
 const columns=audit.columns.filter(c=>c.schema==='pos'&&c.table===table&&!/password|token|secret|credential/i.test(c.column));
 const pk='jsonb_build_object('+pkKeys.flatMap(k=>[q(k),'r.'+ident(k)]).join(',')+')';
 const data='jsonb_build_object('+columns.flatMap(c=>[q(c.column),'r.'+ident(c.column)]).join(',')+')';
 return `SELECT t.*, ${data} AS data FROM targets t JOIN pos.${ident(table)} r ON t."table"=${q(table)} AND ${pk}=t.pk`;
});
const sql=`-- H171 BALAM ONLY: private exact canonical JSON text, no mutation.
-- Store output privately. Canonical text preserves PostgreSQL JSON numeric scales.
-- Exact 321 reviewed technical PK/hash plus six reviewed receipts; no broad selection.
-- Auth secrets and credentials are never returned. write_token remains omitted.
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL TIME ZONE 'UTC';
WITH targets AS (
 SELECT * FROM jsonb_to_recordset($h171_exact$${JSON.stringify(scope)}$h171_exact$::jsonb)
 AS t("table" text,pk jsonb,expected_md5 text,proof text,commercial_overlap boolean)
), matched AS MATERIALIZED (${branches.join('\n UNION ALL\n')})
SELECT jsonb_build_object('audit','H171 canonical technical snapshot','project_ref','telohdbvbvsfmwyriflz',
 'at',clock_timestamp(),'read_only',current_setting('transaction_read_only'),'timezone',current_setting('TimeZone'),
 'expected_rows',327,'matched_rows',(SELECT count(*) FROM matched),
 'unchanged_rows',(SELECT count(*) FROM matched WHERE md5(data::text)=expected_md5),
 'technical_rows',(SELECT jsonb_agg(jsonb_build_object('table',"table",'pk',pk,'expected_md5',expected_md5,
 'projected_row_md5',md5(data::text),'unchanged_since_inventory',md5(data::text)=expected_md5,
 'commercial_overlap',commercial_overlap,'proof',proof,'row_json_text',data::text) ORDER BY "table",pk::text) FROM matched),
 'protected_pending_request',(SELECT jsonb_build_object('request_id',request_id,'actor_id',actor_id,'target_user_id',target_user_id,'state',state,'row_md5',md5(to_jsonb(r)::text))
 FROM pos.online_account_requests r WHERE request_id='70549527-4867-4342-94d2-38e770b0f2a9' AND actor_id='3f24222e-fd74-4ed2-b56f-f298af574b1e'),
 'limits',jsonb_build_array('Read-only evidence, not authorization.','8 rows overlap the separate commercial 149.','2 recoveries omit write_token and remain held until its nullity is verified.','Canonical row JSON text must be passed directly to jsonb_populate_record; parsing and reserializing it may lose numeric scale.','Auth recreation is outside this backup.')) AS private_snapshot;
COMMIT;
`;
const recoveries=exact321.filter(r=>r.table==='sync_device_recoveries');
if(recoveries.length!==2)throw Error('Expected exactly two recoveries');
const recoverySql=`-- H171 BALAM ONLY: two exact recoveries, token NULL boolean only.
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
WITH targets(device_id) AS (VALUES ${recoveries.map(r=>'('+q(r.pk.device_id)+')').join(',')})
SELECT jsonb_build_object('audit','H171 recovery omitted credential nullity','project_ref','telohdbvbvsfmwyriflz',
 'at',clock_timestamp(),'read_only',current_setting('transaction_read_only'),'expected_rows',2,
 'rows',(SELECT jsonb_agg(jsonb_build_object('device_id',r.device_id,'write_token_is_null',r.write_token IS NULL) ORDER BY r.device_id)
 FROM targets t JOIN pos.sync_device_recoveries r USING(device_id)),
 'limit','No token value, hash, length or prefix is returned; non-null remains excluded from a restorable retirement proposal.') AS report;
COMMIT;
`;
await fs.writeFile(dir+'h171-auth-tech-canonical-snapshot.sql',sql);
await fs.writeFile(dir+'h171-auth-tech-recovery-nullity.sql',recoverySql);
await fs.writeFile(dir+'h171-auth-tech-proposed-scope.json',JSON.stringify({project_ref:'telohdbvbvsfmwyriflz',purpose:'Review-only exact proposed scope; no authorization or mutation',rows:scope,counts:{technical_original:321,overlap_commercial149:8,additional_original:313,reviewed_receipts:6,additional_with_reviewed_receipts:319,recoveries_held:2,additional_excluding_held:317},sql_sha256:{canonical_snapshot:hash(sql),recovery_nullity:hash(recoverySql)},protected:['3f24222e-fd74-4ed2-b56f-f298af574b1e','70549527-4867-4342-94d2-38e770b0f2a9','35e2c61a-7561-41b9-9535-e39e671a55d3','eef0157e-287a-417d-aa14-c7c3983fc3d7']},null,2)+'\n');
console.log(JSON.stringify({rows:scope.length,overlap:8,additional:319,held:2,canonical_sql_sha256:hash(sql),nullity_sql_sha256:hash(recoverySql)}));
