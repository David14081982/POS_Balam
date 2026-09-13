// Generates review-only SQL from BALAM's recorded remote catalogue and exact manifests.
// Does not connect to a database, read credentials, or execute mutations.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir='docs/fixes/evidence/';
const read=async name=>JSON.parse((await fs.readFile(dir+'h171/'+name,'utf8')).replace(/^\uFEFF/,''));
const audit=(await read('authority-audit-before.json')).rows[0].report;
const follow=(await read('provenance-followup-before.json')).rows[0].report;
const cleanup=(await read('cleanup-dry-run-v2-before.json')).rows[0].report;
const backup=await read('backup-manifest.json');
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const ident=value=>'"'+value.replaceAll('"','""')+'"';
const users=audit.auth_candidates.map(row=>row.user_id).sort();
const protectedActor='3f24222e-fd74-4ed2-b56f-f298af574b1e';
const protectedRequest='70549527-4867-4342-94d2-38e770b0f2a9';
if(users.length!==11||users.includes(protectedActor))throw new Error('Unexpected exact Auth target manifest');
const runs=[...new Set([...audit.fixture_sources.map(r=>r.run),...follow.additional_run_receipts.map(r=>r.run),'b766e373-5279-4e4a-818e-0934a4f8757c'])].sort();
const columns=audit.columns.filter(c=>c.schema==='pos');
const tables=[...new Set(columns.map(c=>c.table))].sort();
const omitted=columns.filter(c=>/password|token|secret|credential/i.test(c.column));
const technical=['capability_operation_audit','config_commits','online_account_requests','online_requests','permission_change_audit','sync_activity','sync_conflicts','sync_device_recoveries','sync_devices','sync_quarantine_cases','user_capability_overrides','user_permission_role_assignments','user_screen_permission_overrides'];
const preserve=['clients','commission_adjustments','exchange_commits','exchange_items','exchanges','folio_counters','inventory_contract_state','inventory_sync_baselines','inventory_v1_v2_map','inventory_v3_backups','inventory_v3_operations','layaway_liquidation_commits','liquidations','loan_documents','lookup','movements','online_legacy_archives','online_legacy_operations','online_runtime','online_snapshot_revision','operational_capabilities','permission_roles','physical_card_redemptions','point_zero_backups','point_zero_operations','products','promotions','purged_documents','reference_reclassifications','return_commits','return_items','returns','role_capability_permissions','role_screen_permissions','sale_commits','sale_items','sale_payments','sales','screen_permission_catalog','screen_permission_catalog_state','selective_cleanup_events','sellers','settings','stock_reservations','sync_domain_versions','system_manifest','test_data_cleanup_backups','test_data_cleanup_operations','test_data_purges'];
const branches=tables.map(table=>{
  const keys=columns.filter(c=>c.table===table&&!omitted.includes(c)).map(c=>c.column);
  return `SELECT ${q(table)}::text AS relation, jsonb_build_object(${keys.flatMap(k=>[q(k),'r.'+ident(k)]).join(',')}) AS data FROM pos.${ident(table)} r`;
});
const header=`-- H171 BALAM ONLY — review-only exact Auth/technical inventory.
-- Supabase project: telohdbvbvsfmwyriflz. No deletion or authorization is encoded.
-- Generated from the recorded remote catalogue; a catalogue mismatch invalidates coverage.
-- Public output contains identities/counts/hashes only. Never return Auth passwords/tokens.
BEGIN READ ONLY;
SET LOCAL statement_timeout='90s';
WITH
qa_users(id) AS (VALUES ${users.map(id=>'('+q(id)+'::uuid)').join(',')}),
qa_runs(run) AS (VALUES ${runs.map(id=>'('+q(id)+')').join(',')}),
commercial_scope AS (
 SELECT * FROM jsonb_to_recordset($h171_commercial_scope$${JSON.stringify(cleanup.scope)}$h171_commercial_scope$::jsonb)
 AS x("table" text,pk jsonb,row_md5 text,run text,proof text)
),
expected_tables(name) AS (VALUES ${tables.map(t=>'('+q(t)+')').join(',')}),
technical_tables(name) AS (VALUES ${technical.map(t=>'('+q(t)+')').join(',')}),
preserved_tables(name) AS (VALUES ${preserve.map(t=>'('+q(t)+')').join(',')}),
auth_metadata AS MATERIALIZED (
 SELECT u.id,u.created_at,u.updated_at,u.last_sign_in_at,u.banned_until,u.deleted_at,
  jsonb_strip_nulls(jsonb_build_object(
   'balam_online_test',u.raw_user_meta_data->'balam_online_test',
   'balam_sync_test',u.raw_user_meta_data->'balam_sync_test',
   'balam_account_request_id',u.raw_app_meta_data->'balam_account_request_id')) AS qa_metadata
 FROM auth.users u JOIN qa_users q ON q.id=u.id
),
qa_devices AS MATERIALIZED (
 SELECT device_id FROM pos.sync_devices WHERE user_id IN(SELECT id FROM qa_users)
 UNION SELECT device_id FROM pos.online_requests WHERE actor_id IN(SELECT id FROM qa_users)
 UNION SELECT device_id FROM pos.sync_activity WHERE user_id IN(SELECT id FROM qa_users)
 UNION SELECT device_id FROM pos.online_legacy_archives WHERE actor_id IN(SELECT id FROM qa_users)
 UNION SELECT device_id FROM pos.online_legacy_operations WHERE actor_id IN(SELECT id FROM qa_users)
),
qa_request_ids AS MATERIALIZED (
 SELECT request_id FROM pos.online_requests WHERE actor_id IN(SELECT id FROM qa_users)
 UNION SELECT request_id FROM pos.online_account_requests
 WHERE actor_id IN(SELECT id FROM qa_users) OR target_user_id IN(SELECT id FROM qa_users)
),
qa_capability_ids AS MATERIALIZED (
 SELECT operation_id FROM pos.capability_operation_audit WHERE actor_user_id IN(SELECT id FROM qa_users)
),
seed_tokens(kind,value) AS MATERIALIZED (
 SELECT 'qa_auth',id::text FROM qa_users
 UNION SELECT 'qa_run',run FROM qa_runs
 UNION SELECT 'qa_device',device_id FROM qa_devices WHERE nullif(device_id,'') IS NOT NULL
 UNION SELECT 'related_request',request_id::text FROM qa_request_ids
 UNION SELECT 'qa_capability_receipt',operation_id::text FROM qa_capability_ids
 UNION SELECT 'protected_actor',${q(protectedActor)}
 UNION SELECT 'protected_request',${q(protectedRequest)}
 UNION SELECT 'protected_business_operation','35e2c61a-7561-41b9-9535-e39e671a55d3'
 UNION SELECT 'protected_sale','BG-260912-0001'
 UNION SELECT 'protected_legacy_operation','eef0157e-287a-417d-aa14-c7c3983fc3d7'
),
all_rows AS MATERIALIZED (
 ${branches.join('\n UNION ALL\n ')}
),
pk_catalog AS MATERIALIZED (
 SELECT c.relname AS relation,array_agg(a.attname ORDER BY keys.ordinality) AS names
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_index i ON i.indrelid=c.oid AND i.indisprimary
 CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY keys(attnum,ordinality)
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=keys.attnum
 WHERE n.nspname='pos' GROUP BY c.relname
),
keyed_rows AS MATERIALIZED (
 SELECT r.relation,r.data,md5(r.data::text) AS projected_row_md5,
  coalesce((SELECT jsonb_object_agg(k,r.data->k) FROM unnest(p.names) k),jsonb_build_object('__NO_PRIMARY_KEY_ROW_HASH',md5(r.data::text))) AS pk,
  p.names IS NOT NULL AS pk_verified
 FROM all_rows r LEFT JOIN pk_catalog p ON p.relation=r.relation
),
-- Exact JSON string values only; no LIKE, prefix, email, or timestamp selection.
scalar_values AS MATERIALIZED (
 SELECT DISTINCT r.relation,r.pk,v.value#>>'{}' AS value
 FROM keyed_rows r CROSS JOIN LATERAL
  jsonb_path_query(r.data,'strict $.** ? (@.type() == "string")') v(value)
),
matches AS MATERIALIZED (
 SELECT v.relation,v.pk,jsonb_agg(DISTINCT jsonb_build_object('kind',s.kind,'value',s.value)) AS exact_matches,
  bool_or(s.kind LIKE 'protected_%') AS contains_protected_identity
 FROM scalar_values v JOIN seed_tokens s ON s.value=v.value GROUP BY v.relation,v.pk
),
receipt_tokens AS MATERIALIZED (
 SELECT 'capability_operation_audit'::text AS relation,operation_id::text AS identity FROM qa_capability_ids
 UNION SELECT 'online_or_account_request',request_id::text FROM qa_request_ids
),
receipt_backrefs AS MATERIALIZED (
 SELECT t.relation AS receipt_type,t.identity,v.relation AS source_table,v.pk AS source_pk
 FROM receipt_tokens t JOIN scalar_values v ON v.value=t.identity
),
-- A known QA actor can still touch a preserved business identity. Provenance
-- does not override that dependency or the separate owner-reviewed manifest.
business_identity_values AS MATERIALIZED (
 SELECT r.relation,r.pk,j.value#>>'{}' AS identity,
 CASE WHEN r.relation IN('clients','commission_adjustments','exchange_commits','exchange_items','exchanges','inventory_sync_baselines','inventory_v3_backups','inventory_v3_operations','layaway_liquidation_commits','liquidations','loan_documents','movements','online_legacy_archives','online_legacy_operations','point_zero_backups','point_zero_operations','products','reference_reclassifications','return_commits','return_items','returns','sale_commits','sale_items','sale_payments','sales','sellers','stock_reservations','test_data_cleanup_backups','test_data_cleanup_operations','test_data_purges')
 THEN 'DOCUMENT_OR_HISTORY' ELSE 'CATALOG_OR_GLOBAL_AUTHORITY' END AS reference_kind
 FROM keyed_rows r JOIN preserved_tables p ON p.name=r.relation
 CROSS JOIN LATERAL jsonb_each(r.pk) j
 WHERE jsonb_typeof(j.value)='string' AND length(j.value#>>'{}')>=8
 AND NOT EXISTS(SELECT 1 FROM qa_users q WHERE q.id::text=j.value#>>'{}')
 AND NOT EXISTS(SELECT 1 FROM commercial_scope c WHERE c."table"=r.relation AND c.pk=r.pk)
),
technical_business_links AS MATERIALIZED (
 SELECT DISTINCT v.relation,v.pk,b.relation AS preserved_table,b.pk AS preserved_pk,b.identity,b.reference_kind
 FROM scalar_values v JOIN technical_tables t ON t.name=v.relation
 JOIN business_identity_values b ON b.identity=v.value
),
classified AS MATERIALIZED (
 SELECT r.*,m.exact_matches,m.contains_protected_identity,
  CASE WHEN m.contains_protected_identity OR p.name IS NOT NULL OR EXISTS(
         SELECT 1 FROM technical_business_links b WHERE b.relation=r.relation AND b.pk=r.pk AND b.reference_kind='DOCUMENT_OR_HISTORY')
       THEN 'BUSINESS_HISTORY_TO_PRESERVE'
       WHEN t.name IS NOT NULL AND r.pk_verified THEN 'KNOWN_QA_TECHNICAL' ELSE 'UNKNOWN' END AS classification,
  t.name IS NOT NULL AS is_technical_table,
  s.pk IS NOT NULL AS in_separate_commercial_manifest,s.row_md5 AS commercial_manifest_row_md5
 FROM keyed_rows r JOIN matches m ON m.relation=r.relation AND m.pk=r.pk
 LEFT JOIN technical_tables t ON t.name=r.relation
 LEFT JOIN preserved_tables p ON p.name=r.relation
 LEFT JOIN commercial_scope s ON s."table"=r.relation AND s.pk=r.pk
),
foreign_keys AS MATERIALIZED (
 SELECT c.conname,c.conrelid::regclass::text AS source,c.confrelid::regclass::text AS target,
 pg_get_constraintdef(c.oid) AS definition,c.confdeltype AS deletion_action,c.condeferrable,c.condeferred
 FROM pg_constraint c WHERE c.contype='f' AND (
 c.confrelid='auth.users'::regclass OR c.connamespace='pos'::regnamespace)
),
coverage AS (
 SELECT ARRAY(SELECT name FROM expected_tables EXCEPT SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pos' AND c.relkind IN('r','p')) AS missing_expected_tables,
 ARRAY(SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pos' AND c.relkind IN('r','p') EXCEPT SELECT name FROM expected_tables) AS unexpected_live_tables
)
`;
const provenance={projectRef:'telohdbvbvsfmwyriflz',exactAuthIds:users,exactRuns:runs,commercialBackupSha256:backup.sha256,commercialManifestMd5:cleanup.manifest_md5,h148CertificateSha256:'b4c86b1bc8a63464f44d3d45a203bc46d8f9b937b541fd3220c58a99faa3ee38',omittedCredentialColumns:omitted.map(c=>c.table+'.'+c.column),classificationIsDeletionAuthorization:false};
const publicSql=header+`SELECT jsonb_build_object(
 'audit','H171 exact Auth technical inventory','project_ref','telohdbvbvsfmwyriflz',
 'generated_at',clock_timestamp(),'read_only',current_setting('transaction_read_only'),
 'provenance',$h171_provenance$${JSON.stringify(provenance)}$h171_provenance$::jsonb,
 'catalogue_coverage',(SELECT to_jsonb(c) FROM coverage c),
 'all_pos_table_counts',(SELECT jsonb_agg(x ORDER BY relation) FROM(SELECT e.name AS relation,count(k.relation) AS rows FROM expected_tables e LEFT JOIN keyed_rows k ON k.relation=e.name GROUP BY e.name)x),
 'auth_metadata',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM auth_metadata a),
 'capability_receipts',(SELECT count(*) FROM qa_capability_ids),
 'related_requests',(SELECT count(*) FROM qa_request_ids),
 'exact_device_ids',(SELECT jsonb_agg(device_id ORDER BY device_id) FROM qa_devices),
 'classification_counts',(SELECT jsonb_agg(x ORDER BY relation,classification) FROM(SELECT relation,classification,count(*) AS rows FROM classified GROUP BY relation,classification)x),
 'rows',(SELECT jsonb_agg(jsonb_build_object('table',relation,'pk',pk,'projected_row_md5',projected_row_md5,'classification',classification,'exact_matches',exact_matches,'in_separate_commercial_manifest',in_separate_commercial_manifest,'commercial_manifest_row_md5',commercial_manifest_row_md5) ORDER BY relation,pk::text) FROM classified),
 'receipt_incoming_references',(SELECT jsonb_agg(to_jsonb(r) ORDER BY receipt_type,identity,source_table,source_pk::text) FROM receipt_backrefs r),
 'technical_business_links',(SELECT jsonb_agg(to_jsonb(b) ORDER BY relation,pk::text,preserved_table,preserved_pk::text) FROM technical_business_links b),
 'missing_primary_keys',(SELECT jsonb_agg(DISTINCT relation) FROM keyed_rows WHERE NOT pk_verified),
 'foreign_keys',(SELECT jsonb_agg(to_jsonb(f) ORDER BY source,conname) FROM foreign_keys f),
 'limits',jsonb_build_array('Classification is provenance, never deletion authorization.','All business/global/legacy authorities remain protected, including rows assigned to the separate commercial review.','Protected business actor and request 70549527 are never retirement candidates.','No credentials, Auth tokens or passwords are selected.','Row fingerprints omit declared credential columns; they are not full-row restore hashes.','Outgoing receipt contents may mention business history: review exact backrefs before any removal.','Auth metadata cannot restore an Auth identity, password or session.','A table-catalogue mismatch invalidates complete coverage.')) AS report;
COMMIT;
`;
const privateSql=header+`-- PRIVATE OUTPUT ONLY: save outside committed evidence; contains QA candidate audit bodies.
-- Protected bodies are not exported; only their identity/hash is retained here.
-- This SELECT is an audit archive; no database mutation and no Auth restoration claim.
SELECT jsonb_build_object('audit','H171 private technical snapshot','project_ref','telohdbvbvsfmwyriflz',
 'generated_at',clock_timestamp(),'read_only',current_setting('transaction_read_only'),
 'provenance',$h171_provenance$${JSON.stringify(provenance)}$h171_provenance$::jsonb,
 'catalogue_coverage',(SELECT to_jsonb(c) FROM coverage c),
 'auth_metadata',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM auth_metadata a),
 'technical_rows',(SELECT jsonb_agg(jsonb_build_object('table',relation,'pk',pk,'classification',classification,'projected_row_md5',projected_row_md5,'row_without_credential_columns',data) ORDER BY relation,pk::text) FROM classified WHERE classification='KNOWN_QA_TECHNICAL'),
 'protected_business_reference_hashes',(SELECT jsonb_agg(jsonb_build_object('table',relation,'pk',pk,'classification',classification,'projected_row_md5',projected_row_md5) ORDER BY relation,pk::text) FROM classified WHERE classification<>'KNOWN_QA_TECHNICAL'),
 'restore_limit','Never a full Auth/credential/session backup. Omitted columns are listed. Protected technical records remain protected even when archived.') AS private_snapshot;
COMMIT;
`;
await fs.writeFile(dir+'h171-auth-tech-inventory.sql',publicSql);
await fs.writeFile(dir+'h171-auth-tech-private-snapshot.sql',privateSql);
await fs.writeFile(dir+'h171-auth-tech-provenance.json',JSON.stringify({...provenance,generatedAt:new Date().toISOString(),expectedPosTables:tables.length,inventorySqlSha256:createHash('sha256').update(publicSql).digest('hex'),privateSqlSha256:createHash('sha256').update(privateSql).digest('hex')},null,2)+'\n');
console.log(JSON.stringify({exactAuthIds:users.length,runs:runs.length,tables:tables.length,commercialManifest:cleanup.scope.length,omittedCredentialColumns:omitted.length,outputSqlBytes:publicSql.length}));
