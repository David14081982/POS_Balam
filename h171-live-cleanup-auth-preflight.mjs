// H171: pure SQL preparation/validation. No network, GoTrue call or DML.
import { createHash } from 'node:crypto';
import { journalHash } from './h171-live-journal.mjs';
import { postgresJsonbHash } from './h171-live-reconciliation.mjs';
import { AUTH_INCOMING_FKS } from './h171-auth-retirement.mjs';
import { SNAPSHOT_PROJECT, SNAPSHOT_ACTOR, SNAPSHOT_TABLES_SHA256, snapshotConnection,
  buildLiveSnapshotCatalogSql } from './h171-live-snapshot.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/,MD5=/^[a-f0-9]{32}$/,NAME=/^[a-z_][a-z0-9_]*$/;
const REQUEST='70549527-4867-4342-94d2-38e770b0f2a9';
const H166_FUNCTION_MD5='d5a52190abeafe3651416410e174a3e7';
const fail=(ok,code)=>{if(!ok)throw Object.assign(new Error('AUTH_PREFLIGHT_'+code),{code:'AUTH_PREFLIGHT_'+code});};
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const qi=value=>{fail(NAME.test(value),'IDENTIFIER');return '"'+value+'"';};
const same=(a,b)=>journalHash(a)===journalHash(b);
const md5=value=>createHash('md5').update(value).digest('hex');
const fkKey=f=>`${f.relation}|${f.column||f.columns?.[0]}|${f.effect}`;
const ownerKey=c=>`${c.relation}|${c.column}|${c.type}`;
const source=`https://${SNAPSHOT_PROJECT}.supabase.co/`;
export const AUTH_PREFLIGHT_STORAGE_COLUMNS=Object.freeze([...['buckets','objects'].flatMap(table=>[
  {relation:'storage.'+table,column:'owner',type:'uuid'}, {relation:'storage.'+table,column:'owner_id',type:'text'},
]),...['s3_multipart_uploads','s3_multipart_uploads_parts'].map(table=>({relation:'storage.'+table,column:'owner_id',type:'text'}))].map(Object.freeze));

function binding({plan,catalog,sourceUrl,storageOwnerColumns=AUTH_PREFLIGHT_STORAGE_COLUMNS}) {
  const connection=snapshotConnection(sourceUrl,plan?.projectRef);
  fail(plan?.format==='balam-live-cleanup-plan-v1'&&UUID.test(plan.run)&&UUID.test(plan.actorId)&&plan.actorId!==SNAPSHOT_ACTOR&&
    SHA.test(plan.artifactSha256)&&/^\d{4}-\d{2}-\d{2}-h(?:164|166)-online$/.test(plan.clientBuild),'PLAN_BINDING');
  const targets=plan.authTargets;
  fail(Array.isArray(targets)&&targets.length>=1&&targets.length<=2&&new Set(targets.map(t=>t.id)).size===targets.length&&
    targets.some(t=>t.id===plan.actorId),'EXACT_AUTH_TARGETS');
  fail(plan.authBaseline?.format==='balam-live-auth-baseline-v1'&&plan.authBaseline.projectRef===plan.projectRef&&
    plan.authBaseline.run===plan.run&&plan.authBaseline.actorId===plan.actorId&&plan.authBaseline.artifactSha256===plan.artifactSha256&&
    plan.authBaseline.snapshotSha256===plan.backup?.baselineSha256&&SHA.test(plan.authBaseline.fileSha256)&&
    plan.authBaselineSha256===journalHash(plan.authBaseline)&&plan.authBaseline.complete===true&&Array.isArray(plan.authBaseline.ids)&&plan.authBaseline.ids.includes(SNAPSHOT_ACTOR)&&
    new Set(plan.authBaseline.ids).size===plan.authBaseline.ids.length&&plan.authBaseline.ids.every(id=>UUID.test(id)),'AUTH_BASELINE');
  for(const t of targets) {
    fail(UUID.test(t.id)&&t.id!==SNAPSHOT_ACTOR&&!plan.authBaseline.ids.includes(t.id)&&SHA.test(t.emailSha256)&&
      t.status==='PROVEN_NEW_SEPARATE_GOTRUE'&&t.provenance?.actorId===plan.actorId&&t.provenance?.run===plan.run&&
      UUID.test(t.provenance.requestId)&&SHA.test(t.provenance.intentSha256)&&SHA.test(t.provenance.receiptSha256),'TARGET_PROVENANCE');
    const principal=t.id===plan.actorId;
    fail(t.marker?.namespace===(principal?'user_metadata':'app_metadata')&&t.marker.key===(principal?'balam_online_test':'balam_account_request_id')&&
      t.marker.value===(principal?plan.run:t.provenance.requestId),'TARGET_MARKER');
  }
  fail(Array.isArray(catalog)&&catalog.length===64&&journalHash(catalog.map(t=>t.table).sort().join('\n'))===SNAPSHOT_TABLES_SHA256&&
    catalog.every(t=>NAME.test(t.table)&&Array.isArray(t.columns)&&t.columns.every(c=>NAME.test(c.name))),'POS_CATALOG');
  fail(Array.isArray(storageOwnerColumns)&&same(storageOwnerColumns.map(ownerKey).sort(),AUTH_PREFLIGHT_STORAGE_COLUMNS.map(ownerKey).sort()),'STORAGE_CATALOG_REVIEW_REQUIRED');
  return {targets,connection};
}

const authCatalogSql=`WITH tables AS (
 SELECT c.relname::text name,c.relkind::text kind,c.relrowsecurity rls,c.relforcerowsecurity force_rls
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relkind IN('r','p')
),columns AS (
 SELECT c.relname::text "table",a.attname::text name,format_type(a.atttypid,a.atttypmod) type,a.attnotnull not_null,
 a.attidentity::text identity_kind,a.attgenerated::text generated_kind,
 CASE WHEN d.oid IS NULL THEN NULL ELSE md5(pg_get_expr(d.adbin,d.adrelid)) END default_md5
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='auth' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped
),constraints AS (
 SELECT sn.nspname||'.'||s.relname source,c.conname::text name,c.contype::text type,
 pg_get_constraintdef(c.oid,true) definition,c.convalidated validated,c.condeferrable deferrable,c.condeferred initially_deferred
 FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace
 LEFT JOIN pg_class t ON t.oid=c.confrelid LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace
 WHERE sn.nspname='auth' OR tn.nspname='auth'
),triggers AS (
 SELECT c.relname::text "table",t.tgname::text name,t.tgenabled::text enabled,t.tgisinternal internal,
 md5(pg_get_triggerdef(t.oid,true)) definition_md5,t.tgfoid::regprocedure::text function_signature
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth'
),functions AS (
 SELECT p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) definition_md5,
 p.prosecdef security_definer,p.provolatile::text volatility,md5(coalesce(p.proacl::text,'')) acl_md5
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prokind IN('f','p') AND
 (n.nspname='auth' OR p.oid IN(SELECT t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth'))
) SELECT jsonb_build_object('tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY name) FROM tables t),
 'columns',(SELECT jsonb_agg(to_jsonb(t) ORDER BY "table",name) FROM columns t),
 'constraints',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY source,name),'[]'::jsonb) FROM constraints t),
 'triggers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY "table",name),'[]'::jsonb) FROM triggers t),
 'functions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY signature),'[]'::jsonb) FROM functions t)) catalog`;

export function buildAuthCleanupPreflightSql(input) {
  const {plan,catalog,storageOwnerColumns=AUTH_PREFLIGHT_STORAGE_COLUMNS}=input,{targets,connection}=binding(input);
  const targetValues=targets.map(t=>'('+q(t.id)+'::uuid)').join(',');
  const countQuery=(relation,column,extra)=>{
    const [schema,table]=relation.split('.');
    return `SELECT t.id,${q(relation)}::text relation,${q(column)}::text "column",${extra},count(d.${qi(column)}) rows
 FROM targets t LEFT JOIN ${qi(schema)}.${qi(table)} d ON d.${qi(column)}::text=t.id::text GROUP BY t.id`;
  };
  const logical=catalog.flatMap(t=>t.columns.filter(c=>c.type==='uuid'||/^(actor_id|actor_user_id|target_user_id|user_id|created_by|updated_by|seller_id)$/.test(c.name)||
    (t.table==='sellers'&&c.name==='id')).map(c=>({relation:'pos.'+t.table,column:c.name})));
  const hashes=catalog.map(t=>`SELECT ${q(t.table)}::text "table",md5(to_jsonb(t)::text) row_md5 FROM pos.${qi(t.table)} t`).join('\nUNION ALL\n');
  const remaining=(plan.targets||[]).map(t=>{
    fail(catalog.some(c=>c.table===t.table)&&typeof t.pk_json_text==='string','SQL_TARGET_SCOPE');
    return `SELECT count(*) rows FROM pos.${qi(t.table)} t WHERE to_jsonb(t) @> ${q(t.pk_json_text)}::jsonb`;
  }).join('\nUNION ALL\n')||'SELECT 0::bigint rows';
  return `-- H171 Auth dependency preflight. READ ONLY; no credentials or raw row bodies returned.
-- Executor binding: ${connection.sourceUrl}; payload authority origin: ${source}
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='180s';
SET LOCAL lock_timeout='5s';
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO, MDY';
SET LOCAL search_path=pg_catalog;
WITH targets(id) AS(VALUES ${targetValues}),
pos_catalog AS(${buildLiveSnapshotCatalogSql().trim().replace(/;$/,'')}),
auth_catalog AS(${authCatalogSql}),
row_hashes AS MATERIALIZED(${hashes}),
expected_tables("table") AS(VALUES ${catalog.map(t=>'('+q(t.table)+')').join(',')}),
fingerprints AS(SELECT e."table",count(r.row_md5) row_count,md5(coalesce(string_agg(r.row_md5,'' ORDER BY r.row_md5),'')) full_rows_md5
 FROM expected_tables e LEFT JOIN row_hashes r ON r."table"=e."table" GROUP BY e."table"),
foreign_auth_rows AS MATERIALIZED(SELECT u.id,md5(to_jsonb(u)::text) row_md5 FROM auth.users u WHERE NOT EXISTS(SELECT 1 FROM targets t WHERE t.id=u.id)),
fk_counts AS(${AUTH_INCOMING_FKS.map(f=>countQuery(f.relation,f.column,q(f.effect)+'::text effect')).join('\nUNION ALL\n')}),
logical_counts AS(${logical.map(c=>countQuery(c.relation,c.column,"'logical'::text effect")).join('\nUNION ALL\n')}),
storage_counts AS(${storageOwnerColumns.map(c=>countQuery(c.relation,c.column,q(c.type)+'::text type')).join('\nUNION ALL\n')}),
fk_catalog AS(
 SELECT n.nspname||'.'||r.relname relation,c.confdeltype::text effect,c.convalidated validated,
 (SELECT jsonb_agg(a.attname ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum) columns,
 (SELECT jsonb_agg(a.attname ORDER BY k.ord) FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.attnum) referenced_columns
 FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE c.contype='f' AND c.confrelid='auth.users'::regclass
),storage_catalog AS(
 SELECT 'storage.'||c.relname relation,a.attname::text "column",format_type(a.atttypid,a.atttypmod) type
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname='storage' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped AND a.attname IN('owner','owner_id')
),remaining AS(${remaining})
SELECT jsonb_build_object('format','balam-live-auth-preflight-v1','at',clock_timestamp(),
 'project_ref',${q(plan.projectRef)},'source_url',${q(source)},'executor_source_url',${q(connection.sourceUrl)},
 'run',${q(plan.run)},'actor_id',${q(plan.actorId)},'artifact_sha256',${q(plan.artifactSha256)},'client_build',${q(plan.clientBuild)},'plan_sha256',${q(journalHash(plan))},
 'database',current_database(),'current_user',current_user,'session_user',session_user,'role',current_setting('role',true),
 'read_only',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'),
 'timezone',current_setting('TimeZone'),'datestyle',current_setting('DateStyle'),
 'real_actor_exists',EXISTS(SELECT 1 FROM auth.users WHERE id=${q(SNAPSHOT_ACTOR)}::uuid),
 'real_actor_can_manage',pos.can_manage_screen_permissions(${q(SNAPSHOT_ACTOR)}::uuid),
 'online_enabled',(SELECT enabled FROM pos.online_runtime WHERE singleton),
 'system_mode',(SELECT system_mode FROM pos.system_manifest WHERE singleton),
 'nonterminal_requests',(SELECT count(*) FROM pos.online_requests WHERE state='executing')+(SELECT count(*) FROM pos.online_account_requests WHERE state NOT IN('completed','rejected','cancelled') OR state IS NULL),
 'protected_request',(SELECT jsonb_build_object('id',t.request_id,'fullRowMd5',md5(to_jsonb(t)::text)) FROM pos.online_account_requests t WHERE t.request_id=${q(REQUEST)}::uuid AND t.actor_id=${q(SNAPSHOT_ACTOR)}::uuid),
 'protected_request_state',(SELECT state FROM pos.online_account_requests WHERE request_id=${q(REQUEST)}::uuid AND actor_id=${q(SNAPSHOT_ACTOR)}::uuid),
 'pos_catalog',(SELECT catalog FROM pos_catalog),'auth_dependency_catalog',(SELECT catalog FROM auth_catalog),
 'pos_catalog_sha256',(SELECT encode(sha256(convert_to(catalog::text,'UTF8')),'hex') FROM pos_catalog),
 'auth_dependency_catalog_sha256',(SELECT encode(sha256(convert_to(catalog::text,'UTF8')),'hex') FROM auth_catalog),
 'pos_fingerprints',(SELECT jsonb_agg(to_jsonb(t) ORDER BY "table") FROM fingerprints t),
 'foreign_auth_fingerprint',(SELECT jsonb_build_object('row_count',count(*),'full_rows_md5',md5(coalesce(string_agg(row_md5,'' ORDER BY row_md5),''))) FROM foreign_auth_rows),
 'non_target_auth_ids',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]'::jsonb) FROM foreign_auth_rows),
 'fk_catalog',(SELECT jsonb_agg(to_jsonb(t) ORDER BY relation,columns::text) FROM fk_catalog t),
 'fk_counts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id,relation,"column") FROM fk_counts t),
 'logical_pos_reference_counts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id,relation,"column") FROM logical_counts t),
 'storage_owner_catalog',(SELECT jsonb_agg(to_jsonb(t) ORDER BY relation,"column") FROM storage_catalog t),
 'storage_owner_counts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id,relation,"column") FROM storage_counts t),
 'remaining_exact_rows',(SELECT sum(rows) FROM remaining),'exact_rows_checked',${(plan.targets||[]).length},
 'snapshot_revision',(SELECT jsonb_build_object('value',revision::text,'full_row_md5',md5(to_jsonb(r)::text),'other_fields_md5',md5((to_jsonb(r)-'revision')::text)) FROM pos.online_snapshot_revision r),
 'targets',(SELECT jsonb_agg(jsonb_build_object('id',t.id,'exists',u.id IS NOT NULL,
  'email_sha256',encode(sha256(convert_to(lower(btrim(u.email)),'UTF8')),'hex'),
  'qa_markers',jsonb_strip_nulls(jsonb_build_object('user_metadata.balam_online_test',u.raw_user_meta_data->'balam_online_test',
   'user_metadata.balam_sync_test',u.raw_user_meta_data->'balam_sync_test','app_metadata.balam_account_request_id',u.raw_app_meta_data->'balam_account_request_id'))) ORDER BY t.id)
  FROM targets t LEFT JOIN auth.users u ON u.id=t.id)) report;
COMMIT;
`;
}

export function validateAuthCleanupPreflight({input,plan,catalog,sourceUrl,storageOwnerColumns=AUTH_PREFLIGHT_STORAGE_COLUMNS,baseline}) {
  const {targets,connection}=binding({plan,catalog,sourceUrl,storageOwnerColumns});
  const r=structuredClone(input?.rows?.[0]?.report||input),blockers=[];
  const block=(ok,code)=>{if(!ok)blockers.push(code);};
  fail(r?.format==='balam-live-auth-preflight-v1'&&r.project_ref===plan.projectRef&&r.source_url===source&&r.executor_source_url===connection.sourceUrl&&
    r.run===plan.run&&r.actor_id===plan.actorId&&r.artifact_sha256===plan.artifactSha256&&r.client_build===plan.clientBuild&&r.plan_sha256===journalHash(plan),'RESPONSE_BINDING');
  fail(r.read_only==='on'&&r.isolation==='repeatable read'&&r.database==='postgres'&&r.session_user==='postgres'&&r.current_user==='postgres'&&
    r.role==='none'&&r.timezone==='UTC'&&r.datestyle==='ISO, MDY'&&Number.isFinite(Date.parse(r.at)),'READ_ONLY_SESSION');
  fail(r.pos_catalog&&r.auth_dependency_catalog&&r.pos_catalog_sha256===postgresJsonbHash(r.pos_catalog)&&
    r.auth_dependency_catalog_sha256===postgresJsonbHash(r.auth_dependency_catalog),'CATALOG_HASH');
  fail(Array.isArray(r.pos_fingerprints)&&r.pos_fingerprints.length===64&&
    same(r.pos_fingerprints.map(t=>t.table).sort(),catalog.map(t=>t.table).sort())&&r.pos_fingerprints.every(t=>Number.isSafeInteger(t.row_count)&&t.row_count>=0&&MD5.test(t.full_rows_md5)),'FINGERPRINT_COVERAGE');
  block(same(r.pos_catalog.columns,catalog.flatMap(t=>t.columns.map(c=>({table:t.table,...c}))).sort((a,b)=>a.table.localeCompare(b.table)||a.name.localeCompare(b.name))),'POS_COLUMN_CATALOG_DRIFT');
  const ids=targets.map(t=>t.id).sort(),keys=AUTH_INCOMING_FKS.map(fkKey).sort();
  block(Array.isArray(r.fk_catalog)&&r.fk_catalog.length===18&&r.fk_catalog.every(f=>f.validated===true&&same(f.referenced_columns,['id'])&&f.columns?.length===1)&&same(r.fk_catalog.map(fkKey).sort(),keys),'AUTH_FK_CATALOG_DRIFT');
  fail(Array.isArray(r.fk_counts)&&r.fk_counts.length===ids.length*18&&r.fk_counts.every(c=>ids.includes(c.id)&&Number.isSafeInteger(c.rows)&&c.rows>=0)&&
    ids.every(id=>same(r.fk_counts.filter(c=>c.id===id).map(fkKey).sort(),keys)),'FK_COUNT_COVERAGE');
  block(r.fk_counts.every(c=>c.relation.startsWith('auth.')||c.rows===0),'POS_FK_DEPENDENCIES_REMAIN');
  const logical=catalog.flatMap(t=>t.columns.filter(c=>c.type==='uuid'||/^(actor_id|actor_user_id|target_user_id|user_id|created_by|updated_by|seller_id)$/.test(c.name)||
    (t.table==='sellers'&&c.name==='id')).map(c=>'pos.'+t.table+'|'+c.name)).sort();
  fail(Array.isArray(r.logical_pos_reference_counts)&&r.logical_pos_reference_counts.length===ids.length*logical.length&&
    ids.every(id=>same(r.logical_pos_reference_counts.filter(c=>c.id===id).map(c=>c.relation+'|'+c.column).sort(),logical)),'LOGICAL_COUNT_COVERAGE');
  block(r.logical_pos_reference_counts.every(c=>c.rows===0),'LOGICAL_POS_DEPENDENCIES_REMAIN');
  r.storage_owner_catalog_complete=Array.isArray(r.storage_owner_catalog)&&same(r.storage_owner_catalog.map(ownerKey).sort(),storageOwnerColumns.map(ownerKey).sort());
  block(r.storage_owner_catalog_complete,'STORAGE_CATALOG_DRIFT');
  fail(Array.isArray(r.storage_owner_counts)&&r.storage_owner_counts.length===ids.length*storageOwnerColumns.length&&
    ids.every(id=>same(r.storage_owner_counts.filter(c=>c.id===id).map(ownerKey).sort(),storageOwnerColumns.map(ownerKey).sort())),'STORAGE_COUNT_COVERAGE');
  block(r.storage_owner_counts.every(c=>c.rows===0),'STORAGE_OWNERSHIP_REMAINS');
  fail(Array.isArray(r.targets)&&same(r.targets.map(t=>t.id).sort(),ids)&&r.targets.every(t=>typeof t.exists==='boolean'),'TARGET_COVERAGE');
  for(const target of targets) {
    const t=r.targets.find(t=>t.id===target.id);
    block(!t.exists||(t.email_sha256===target.emailSha256&&same(t.qa_markers,{[target.marker.namespace+'.'+target.marker.key]:target.marker.value})),'TARGET_IDENTITY_MISMATCH');
  }
  block(r.real_actor_exists===true&&r.real_actor_can_manage===true&&r.online_enabled===true&&r.system_mode==='preproduction','AUTHORITY_CONTEXT_CHANGED');
  block(r.protected_request?.id===REQUEST&&MD5.test(r.protected_request?.fullRowMd5)&&r.protected_request_state==='completed','PROTECTED_REQUEST_CHANGED');
  block(r.nonterminal_requests===0,'NONTERMINAL_REQUEST');
  block(r.remaining_exact_rows===0&&r.exact_rows_checked===(plan.targets||[]).length,'SQL_SCOPE_REMAINS');
  fail(Array.isArray(r.non_target_auth_ids)&&same([...r.non_target_auth_ids].sort(),[...plan.authBaseline.ids].sort())&&
    r.foreign_auth_fingerprint?.row_count===r.non_target_auth_ids.length&&MD5.test(r.foreign_auth_fingerprint.full_rows_md5),'FOREIGN_AUTH_CENSUS_CHANGED');
  const fn=r.pos_catalog.functions?.find(f=>f.signature==='pos.h166_advance_snapshot_revision()');
  const sources=AUTH_INCOMING_FKS.filter(f=>f.relation.startsWith('pos.')&&['c','n','d'].includes(f.effect)).flatMap(f=>{
    const t=r.pos_catalog.triggers.find(t=>'pos.'+t.table===f.relation&&t.name==='h166_snapshot_changed');
    if(!t)return [];
    block(t.enabled==='O'&&t.internal===false&&t.function_signature===fn?.signature&&
      t.definition_md5===md5(`CREATE TRIGGER h166_snapshot_changed AFTER INSERT OR DELETE OR UPDATE OR TRUNCATE ON ${f.relation} FOR EACH STATEMENT EXECUTE FUNCTION pos.h166_advance_snapshot_revision()`),'REVISION_TRIGGER_DRIFT');
    return [{...f,trigger_definition_md5:t.definition_md5,function_definition_md5:fn?.definition_md5}];
  });
  block(fn?.definition_md5===H166_FUNCTION_MD5&&sources.length===7,'REVISION_FUNCTION_OR_DELTA_DRIFT');
  fail(r.snapshot_revision&&/^\d+$/.test(r.snapshot_revision.value)&&MD5.test(r.snapshot_revision.full_row_md5)&&MD5.test(r.snapshot_revision.other_fields_md5),'REVISION_MISSING');
  fail(r.pos_fingerprints.find(t=>t.table==='online_snapshot_revision')?.row_count===1,'REVISION_SINGLETON');
  r.snapshot_revision={...r.snapshot_revision,delta_per_delete:sources.length,contract_sha256:journalHash({fk_catalog:r.fk_catalog,trigger_sources:sources}),trigger_sources:sources};
  if(baseline) {
    block(same(r.protected_request,baseline.protected_request)&&r.pos_catalog_sha256===baseline.pos_catalog_sha256&&r.auth_dependency_catalog_sha256===baseline.auth_dependency_catalog_sha256&&
      same(r.foreign_auth_fingerprint,baseline.foreign_auth_fingerprint)&&same(r.non_target_auth_ids,baseline.non_target_auth_ids),'BASELINE_PROTECTION_CHANGED');
    block(same(r.pos_fingerprints.filter(t=>t.table!=='online_snapshot_revision'),baseline.pos_fingerprints.filter(t=>t.table!=='online_snapshot_revision')),'BASELINE_POS_CHANGED');
    // Adapter, which owns the durable DELETE/404 ledger, checks the exact allowed
    // revision delta. This reader never attributes an advance to an intent alone.
  }
  return {preflight:r,readOnly:true,ready:blockers.length===0,blockers,certified:false,cleanupVerified:false};
}
