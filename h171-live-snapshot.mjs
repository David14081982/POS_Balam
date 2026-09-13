// H171 Node preparation only: no network, fixture creation, restoration or deletion.
import * as fs from 'node:fs/promises';
import { resolve, relative, sep, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { journalHash } from './h171-live-journal.mjs';

export const SNAPSHOT_PROJECT = 'telohdbvbvsfmwyriflz';
export const SNAPSHOT_ACTOR = '3f24222e-fd74-4ed2-b56f-f298af574b1e';
export const SNAPSHOT_TABLES_SHA256 = '5b7ce8b6e496da6a37f2ed300f449ded0357183a7636b648f32e7cbe1456ff04';
export const LARGE_BASELINE_BODY_TABLES = Object.freeze([
  'capability_operation_audit', 'sync_conflicts', 'online_legacy_archives', 'test_data_cleanup_backups',
]);
export const SNAPSHOT_OMISSIONS = Object.freeze({
  physical_card_redemptions: Object.freeze(['claim_token']), point_zero_backups: Object.freeze(['preview_token']),
  point_zero_operations: Object.freeze(['preview_token']), sellers: Object.freeze(['password_hash']),
  sync_device_recoveries: Object.freeze(['write_token']),
});
export const MONOTONIC_AUTHORITIES = Object.freeze(Object.fromEntries([
  ['folio_counters', 'last_seq', ['updated_at']], ['online_snapshot_revision', 'revision', []],
  ['config_sync_state', 'version', ['updated_at']], ['sync_domain_versions', 'version', ['updated_at']],
  ['screen_permission_catalog_state', 'catalog_version', ['updated_at']],
].map(([table, counter, clocks]) => [table, Object.freeze({ counter, clocks: Object.freeze(clocks) })])));
const MD5 = /^[a-f0-9]{32}$/;
const SHA = /^[a-f0-9]{64}$/;
const NAME = /^[a-z_][a-z0-9_]*$/;
const md5 = text => createHash('md5').update(text).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const requireValue = (ok, code) => { if (!ok) fail(code); };
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const qi = value => { requireValue(NAME.test(value), 'SNAPSHOT_IDENTIFIER_INVALID'); return '"' + value + '"'; };
const reportOf = value => value?.rows?.[0]?.report || value;
const arrayEqual = (a, b) => journalHash(a) === journalHash(b);

export function snapshotConnection(sourceUrl, projectRef = SNAPSHOT_PROJECT) {
  requireValue(projectRef === SNAPSHOT_PROJECT && typeof sourceUrl === 'string', 'SNAPSHOT_FOREIGN_PROJECT');
  let url; try { url = new URL(sourceUrl); } catch { fail('SNAPSHOT_CONNECTION_BINDING_REQUIRED'); }
  requireValue(!url.username && !url.password && !url.search && !url.hash &&
    (url.href === `https://${SNAPSHOT_PROJECT}.supabase.co/` ||
      url.href === `https://api.supabase.com/v1/projects/${SNAPSHOT_PROJECT}/database/query`),
  'SNAPSHOT_FOREIGN_PROJECT');
  return { projectRef, sourceUrl: url.href };
}

export function recordedSnapshotCatalog({ authorityAudit, cleanupCatalog }) {
  const columns = reportOf(authorityAudit)?.columns?.filter(row => row.schema === 'pos') || [];
  const primary = reportOf(cleanupCatalog)?.primary_keys || [];
  const tables = [...new Set(columns.map(row => row.table))].sort().map(table => {
    const keys = primary.filter(row => row.table === 'pos.' + table);
    requireValue(keys.length === 1 && /^PRIMARY KEY \([a-z0-9_, ]+\)$/.test(keys[0].definition), 'SNAPSHOT_PK_MISSING_OR_UNSUPPORTED');
    return { table, columns: columns.filter(row => row.table === table).map(row => ({
      name: row.column, type: row.type, not_null: row.not_null,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    pk: keys[0].definition.slice(13, -1).split(',').map(key => key.trim()) };
  });
  validateCatalog(tables); return tables;
}
function validateCatalog(catalog) {
  requireValue(Array.isArray(catalog) && catalog.length === 64 &&
    journalHash(catalog.map(row => row.table).sort().join('\n')) === SNAPSHOT_TABLES_SHA256,
  'SNAPSHOT_TABLE_CATALOG_MISMATCH');
  for (const table of catalog) {
    requireValue(NAME.test(table.table) && table.columns.length > 0 &&
      new Set(table.columns.map(c => c.name)).size === table.columns.length &&
      table.columns.every(c => NAME.test(c.name) && typeof c.type === 'string' && typeof c.not_null === 'boolean'),
    'SNAPSHOT_COLUMN_CATALOG_INVALID');
    requireValue(Array.isArray(table.pk) && table.pk.length > 0 && new Set(table.pk).size === table.pk.length &&
      table.pk.every(key => table.columns.some(c => c.name === key && c.not_null)), 'SNAPSHOT_PK_MISSING_OR_INVALID');
    const declared = SNAPSHOT_OMISSIONS[table.table] || [];
    const found = table.columns.filter(c => /password|token|secret|credential/i.test(c.name)).map(c => c.name).sort();
    requireValue(arrayEqual(declared, found) && !table.pk.some(key => declared.includes(key)), 'SNAPSHOT_SENSITIVE_CATALOG_DRIFT');
  }
}
const columnsForGuard = catalog => catalog.flatMap(t => t.columns.map(c => ({ table: t.table, ...c })))
  .sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name));

const columnQuery = `SELECT c.relname::text "table",a.attname::text name,
 pg_catalog.format_type(a.atttypid,a.atttypmod) type,a.attnotnull not_null
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 WHERE n.nspname='pos' AND c.relkind IN('r','p')`;
const pkQuery = `SELECT c.relname::text "table",jsonb_agg(a.attname ORDER BY k.ord) columns
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_index i ON i.indrelid=c.oid AND i.indisprimary
 CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
 JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum
 WHERE n.nspname='pos' AND c.relkind IN('r','p') GROUP BY c.relname`;

const CATALOG_CTES = `columns AS (${columnQuery}), primary_keys AS (${pkQuery}),
table_catalog AS (
 SELECT c.relname::text name,c.relkind::text kind,c.relrowsecurity rls,c.relforcerowsecurity force_rls
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pos' AND c.relkind IN('r','p')
), column_details AS (
 SELECT c.relname::text "table",a.attname::text name,a.attidentity::text identity_kind,a.attgenerated::text generated_kind,
  CASE WHEN d.oid IS NULL THEN NULL ELSE md5(pg_get_expr(d.adbin,d.adrelid)) END default_md5
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='pos' AND c.relkind IN('r','p') AND a.attnum>0 AND NOT a.attisdropped
), foreign_keys AS (
 SELECT c.conname::text name,sn.nspname||'.'||s.relname source,tn.nspname||'.'||t.relname target,
  pg_get_constraintdef(c.oid,true) definition,c.convalidated validated,c.condeferrable deferrable,c.condeferred initially_deferred
 FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_namespace sn ON sn.oid=s.relnamespace
 JOIN pg_class t ON t.oid=c.confrelid JOIN pg_namespace tn ON tn.oid=t.relnamespace
 WHERE c.contype='f' AND (sn.nspname='pos' OR tn.nspname='pos')
), triggers AS (
 SELECT c.relname::text "table",t.tgname::text name,t.tgenabled::text enabled,t.tgisinternal internal,
  md5(pg_get_triggerdef(t.oid,true)) definition_md5,t.tgfoid::regprocedure::text function_signature
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pos'
), functions AS (
 SELECT p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) definition_md5,
  p.prosecdef security_definer,p.provolatile::text volatility,md5(coalesce(p.proacl::text,'')) acl_md5
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE p.prokind IN('f','p') AND (n.nspname='pos' OR p.oid IN(
  SELECT t.tgfoid FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='pos'))
)`;
const CATALOG_VALUE = `jsonb_build_object(
  'tables',(SELECT jsonb_agg(to_jsonb(t) ORDER BY name) FROM table_catalog t),
  'columns',(SELECT jsonb_agg(to_jsonb(t) ORDER BY "table",name) FROM columns t),
  'column_details',(SELECT jsonb_agg(to_jsonb(t) ORDER BY "table",name) FROM column_details t),
  'primary_keys',(SELECT jsonb_agg(to_jsonb(t) ORDER BY "table") FROM primary_keys t),
  'foreign_keys',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY source,name,target),'[]'::jsonb) FROM foreign_keys t),
  'triggers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY "table",name),'[]'::jsonb) FROM triggers t),
  'functions',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY signature),'[]'::jsonb) FROM functions t))`;

// Requires caller search_path=pg_catalog. Reads catalogs only; no BEGIN or row data.
export function buildLiveSnapshotCatalogSql() {
  return `WITH ${CATALOG_CTES} SELECT ${CATALOG_VALUE} AS catalog;\n`;
}

export function buildLiveSnapshotSql({ catalog, sourceUrl, projectRef = SNAPSHOT_PROJECT, reusePointZeroBodies = false, reuseBaselineKeys = null }) {
  const connection = snapshotConnection(sourceUrl, projectRef);
  requireValue(typeof reusePointZeroBodies === 'boolean', 'SNAPSHOT_POINT_ZERO_REUSE_OPTION_INVALID');
  validateCatalog(catalog);
  const ordered = [...catalog].sort((a, b) => a.table.localeCompare(b.table));
  const expectedTables = ordered.map(t => t.table);
  const expectedColumns = columnsForGuard(ordered);
  const expectedPKs = ordered.map(t => ({ table: t.table, columns: t.pk }));
  if (reuseBaselineKeys !== null) {
    requireValue(reusePointZeroBodies && arrayEqual(Object.keys(reuseBaselineKeys).sort(), [...LARGE_BASELINE_BODY_TABLES].sort()),
      'SNAPSHOT_BASELINE_REUSE_TABLES_INVALID');
    for (const name of LARGE_BASELINE_BODY_TABLES) {
      const keys = reuseBaselineKeys[name], expected = ordered.find(t => t.table === name).pk;
      requireValue(Array.isArray(keys) && new Set(keys).size === keys.length && keys.every(text => {
        if (typeof text !== 'string') return false;
        try { const pk = JSON.parse(text); return pk && !Array.isArray(pk) && arrayEqual(Object.keys(pk).sort(), [...expected].sort()) && Object.values(pk).every(v => v !== null); }
        catch { return false; }
      }), 'SNAPSHOT_BASELINE_REUSE_KEYS_INVALID');
    }
  }
  const allRows = ordered.map(t => {
    const omitted = SNAPSHOT_OMISSIONS[t.table] || [];
    const selected = t.columns.filter(c => !omitted.includes(c.name));
    const projection = `jsonb_build_object(${selected.flatMap(c => [q(c.name), 't.' + qi(c.name)]).join(',')})`;
    const pk = `jsonb_build_object(${t.pk.flatMap(key => [q(key), 't.' + qi(key)]).join(',')})::text`;
    const reuseBody = reusePointZeroBodies && t.table === 'point_zero_backups' ? 'true'
      : reuseBaselineKeys && LARGE_BASELINE_BODY_TABLES.includes(t.table)
        ? `(${pk})=ANY(ARRAY[${reuseBaselineKeys[t.table].map(q).join(',')}]::text[])` : null;
    const nullity = omitted.length ? `jsonb_build_object(${omitted.flatMap(key => [q(key), 't.' + qi(key) + ' IS NULL']).join(',')})` : "'{}'::jsonb";
    const restore = omitted.length ? `CASE WHEN ${omitted.map(key => 't.' + qi(key) + ' IS NULL').join(' AND ')} THEN to_jsonb(t)::text ELSE NULL END` : 'NULL::text';
    const authority = MONOTONIC_AUTHORITIES[t.table];
    const monotonic = authority ? `jsonb_build_object('counter',t.${qi(authority.counter)}::text,'clocks',
      ${authority.clocks.length ? `jsonb_build_object(${authority.clocks.flatMap(key => [q(key), `extract(epoch from t.${qi(key)})::text`]).join(',')})` : "'{}'::jsonb"},
      'other_fields_md5',md5((${projection}-ARRAY[${[authority.counter, ...authority.clocks].map(q).join(',')}]::text[])::text))` : 'NULL::jsonb';
    return `SELECT ${q(t.table)}::text "table",${pk} pk_json_text,${reuseBody ? `CASE WHEN ${reuseBody} THEN NULL::text ELSE ${projection}::text END` : projection + '::text'} row_json_text,
      md5(${projection}::text) projected_row_md5,md5(to_jsonb(t)::text) full_row_md5,
      ${nullity} omitted_column_nullity,${reuseBody ? `CASE WHEN ${reuseBody} THEN NULL::text ELSE ${restore} END` : restore} restorable_row_json_text,${monotonic} monotonic
      FROM pos.${qi(t.table)} t`;
  }).join('\nUNION ALL\n');
  return `-- H171 BALAM canonical private snapshot. READ ONLY; never publish row bodies.
-- source binding is supplied/verified by the external executor, not inferred from PostgreSQL.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='120s';
SET LOCAL lock_timeout='5s';
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO, MDY';
SET LOCAL search_path=pg_catalog;
DO $h171_snapshot_guard$
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres'
  OR coalesce(current_setting('role',true),'none')<>'none'
 THEN RAISE EXCEPTION 'SNAPSHOT_STANDARD_POSTGRES_SESSION_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=${q(SNAPSHOT_ACTOR)}::uuid)
 THEN RAISE EXCEPTION 'SNAPSHOT_BALAM_ACTOR_ANCHOR_MISSING'; END IF;
 IF (SELECT jsonb_agg(c.relname::text ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='pos' AND c.relkind IN('r','p')) IS DISTINCT FROM ${q(JSON.stringify(expectedTables))}::jsonb
 THEN RAISE EXCEPTION 'SNAPSHOT_TABLE_CATALOG_DRIFT'; END IF;
 IF (SELECT jsonb_agg(to_jsonb(t) ORDER BY "table",name) FROM (${columnQuery}) t)
  IS DISTINCT FROM ${q(JSON.stringify(expectedColumns))}::jsonb
 THEN RAISE EXCEPTION 'SNAPSHOT_COLUMN_CATALOG_DRIFT'; END IF;
 IF (SELECT jsonb_agg(to_jsonb(t) ORDER BY "table") FROM (${pkQuery}) t)
  IS DISTINCT FROM ${q(JSON.stringify(expectedPKs))}::jsonb
 THEN RAISE EXCEPTION 'SNAPSHOT_PK_CATALOG_DRIFT'; END IF;
END $h171_snapshot_guard$;
WITH expected_tables(name) AS (VALUES ${expectedTables.map(t => '(' + q(t) + ')').join(',')}),
all_rows AS NOT MATERIALIZED (${allRows}),
row_groups AS (
 SELECT r."table",count(*) row_count,jsonb_agg(jsonb_build_object(
  'pk_json_text',r.pk_json_text,'row_json_text',r.row_json_text,
  'projected_row_md5',r.projected_row_md5,'full_row_md5',r.full_row_md5,
  'omitted_column_nullity',r.omitted_column_nullity,
  'restorable_row_json_text',r.restorable_row_json_text,'monotonic',r.monotonic)
  ORDER BY r.pk_json_text) rows FROM all_rows r GROUP BY r."table"
),
${CATALOG_CTES}
SELECT jsonb_build_object('format','balam-canonical-snapshot-v1','at',clock_timestamp(),
 ${reusePointZeroBodies ? "'point_zero_body_reuse','exact-baseline-hashes-v1'," : ''}
 ${reuseBaselineKeys ? `'baseline_body_reuse',${q(JSON.stringify({mode:'exact-baseline-pks-v1',tables:LARGE_BASELINE_BODY_TABLES,pk_set_sha256:journalHash(reuseBaselineKeys)}))}::jsonb,` : ''}
 'expected_project_ref',${q(SNAPSHOT_PROJECT)},'source_url',${q(connection.sourceUrl)},
 'binding','external executor URL plus real actor anchor; PostgreSQL does not attest Supabase project ref',
 'database',current_database(),'session_user',session_user,'current_user',current_user,
 'role',current_setting('role',true),'read_only',current_setting('transaction_read_only'),
 'isolation',current_setting('transaction_isolation'),'timezone',current_setting('TimeZone'),
 'datestyle',current_setting('DateStyle'),'snapshot',pg_current_snapshot()::text,
 'auth_user_ids',(SELECT coalesce(jsonb_agg(id::text ORDER BY id),'[]'::jsonb) FROM auth.users),
 'omissions',${q(JSON.stringify(SNAPSHOT_OMISSIONS))}::jsonb,
 'catalog',${CATALOG_VALUE},
 'tables',(SELECT jsonb_agg(jsonb_build_object('table',e.name,'row_count',coalesce(g.row_count,0),
   'rows',coalesce(g.rows,'[]'::jsonb)) ORDER BY e.name)
   FROM expected_tables e LEFT JOIN row_groups g ON g."table"=e.name)) report;
COMMIT;
`;
}

// Transport optimization only: every hash, PK and nullity above is freshly read
// in the same transaction as the other 63 tables. Never infer unchanged bodies.
export function rehydrateLivePointZeroSnapshot({ input, baseline, catalog, sourceUrl }) {
  const original = validateLiveSnapshot(baseline, { catalog, sourceUrl }).snapshot;
  const current = reportOf(input);
  requireValue(current?.point_zero_body_reuse === 'exact-baseline-hashes-v1', 'SNAPSHOT_POINT_ZERO_REUSE_MARKER_REQUIRED');
  requireValue(arrayEqual(current.catalog, original.catalog), 'SNAPSHOT_POINT_ZERO_REUSE_CATALOG_DRIFT');
  requireValue(Array.isArray(current.tables) && current.tables.filter(t => t.table === 'point_zero_backups').length === 1,
    'SNAPSHOT_POINT_ZERO_REUSE_TABLE_REQUIRED');
  const before = original.tables.find(t => t.table === 'point_zero_backups');
  const fresh = current.tables.find(t => t.table === 'point_zero_backups');
  requireValue(Array.isArray(fresh.rows) && fresh.row_count === before.row_count && fresh.rows.length === before.rows.length,
    'SNAPSHOT_POINT_ZERO_REUSE_COUNT_DRIFT');
  const oldRows = new Map(before.rows.map(row => [row.pk_json_text, row])), seen = new Set();
  const rows = fresh.rows.map(row => {
    const old = oldRows.get(row.pk_json_text);
    requireValue(old && !seen.has(row.pk_json_text), 'SNAPSHOT_POINT_ZERO_REUSE_PK_DRIFT'); seen.add(row.pk_json_text);
    requireValue(row.row_json_text === null && row.restorable_row_json_text === null && row.monotonic === null,
      'SNAPSHOT_POINT_ZERO_REUSE_BODY_NOT_OMITTED');
    requireValue(row.projected_row_md5 === old.projected_row_md5 && row.full_row_md5 === old.full_row_md5 &&
      arrayEqual(row.omitted_column_nullity, old.omitted_column_nullity), 'SNAPSHOT_POINT_ZERO_REUSE_HASH_OR_NULLITY_DRIFT');
    return { ...row, row_json_text: old.row_json_text, restorable_row_json_text: old.restorable_row_json_text };
  });
  const snapshot = { ...current, point_zero_body_reuse: { mode: 'exact-baseline-hashes-v1',
    table: 'point_zero_backups', baseline_snapshot_sha256: journalHash(original), verified_rows: rows.length },
    tables: current.tables.map(table => table === fresh ? { ...table, rows } : table) };
  if (current.baseline_body_reuse) {
    const expectedKeys = Object.fromEntries(LARGE_BASELINE_BODY_TABLES.map(name => [name,
      original.tables.find(t => t.table === name).rows.map(row => row.pk_json_text).sort()]));
    requireValue(arrayEqual(current.baseline_body_reuse, {mode:'exact-baseline-pks-v1',tables:LARGE_BASELINE_BODY_TABLES,
      pk_set_sha256:journalHash(expectedKeys)}), 'SNAPSHOT_BASELINE_REUSE_SCOPE_MISMATCH');
    const verified = {};
    snapshot.tables = snapshot.tables.map(table => {
      if (!LARGE_BASELINE_BODY_TABLES.includes(table.table)) return table;
      const prior = new Map(original.tables.find(t => t.table === table.table).rows.map(row => [row.pk_json_text,row]));
      requireValue(Array.isArray(table.rows) && table.row_count === table.rows.length, 'SNAPSHOT_BASELINE_REUSE_COUNT_DRIFT');
      const seen = new Set();
      const expanded = table.rows.map(row => {
        requireValue(typeof row.pk_json_text === 'string' && !seen.has(row.pk_json_text), 'SNAPSHOT_BASELINE_REUSE_PK_DRIFT');
        seen.add(row.pk_json_text); const old = prior.get(row.pk_json_text);
        if (!old) {
          requireValue(typeof row.row_json_text === 'string', 'SNAPSHOT_BASELINE_REUSE_NEW_BODY_REQUIRED');
          return row; // New rows retain their current complete body and provenance remains unassigned.
        }
        requireValue(row.row_json_text === null && row.restorable_row_json_text === null && row.monotonic === null,
          'SNAPSHOT_BASELINE_REUSE_BODY_NOT_OMITTED');
        requireValue(row.projected_row_md5 === old.projected_row_md5 && row.full_row_md5 === old.full_row_md5 &&
          arrayEqual(row.omitted_column_nullity, old.omitted_column_nullity), 'SNAPSHOT_BASELINE_REUSE_HASH_OR_NULLITY_DRIFT');
        return {...row,row_json_text:old.row_json_text,restorable_row_json_text:old.restorable_row_json_text};
      });
      requireValue([...prior.keys()].every(key => seen.has(key)), 'SNAPSHOT_BASELINE_REUSE_PREEXISTING_ROW_MISSING');
      verified[table.table] = prior.size; return {...table,rows:expanded};
    });
    requireValue(Object.keys(verified).length === LARGE_BASELINE_BODY_TABLES.length, 'SNAPSHOT_BASELINE_REUSE_TABLE_MISSING');
    snapshot.baseline_body_reuse = {...current.baseline_body_reuse,baseline_snapshot_sha256:journalHash(original),verified_rows:verified};
  }
  return validateLiveSnapshot(snapshot, { catalog, sourceUrl }).snapshot;
}

export function validateLiveSnapshot(input, { catalog, sourceUrl }) {
  validateCatalog(catalog); const source = snapshotConnection(sourceUrl), snapshot = reportOf(input);
  requireValue(snapshot?.format === 'balam-canonical-snapshot-v1' && snapshot.expected_project_ref === SNAPSHOT_PROJECT &&
    snapshot.source_url === source.sourceUrl, 'SNAPSHOT_FOREIGN_PROJECT');
  requireValue(snapshot.database === 'postgres' && snapshot.session_user === 'postgres' && snapshot.current_user === 'postgres' &&
    snapshot.role === 'none' && snapshot.read_only === 'on' && snapshot.isolation === 'repeatable read' &&
    snapshot.timezone === 'UTC' && snapshot.datestyle === 'ISO, MDY', 'SNAPSHOT_SESSION_NOT_CANONICAL');
  requireValue(arrayEqual(snapshot.omissions, SNAPSHOT_OMISSIONS), 'SNAPSHOT_OMISSIONS_CHANGED');
  requireValue(Array.isArray(snapshot.auth_user_ids) && new Set(snapshot.auth_user_ids).size === snapshot.auth_user_ids.length &&
    snapshot.auth_user_ids.includes(SNAPSHOT_ACTOR) && snapshot.auth_user_ids.every(id =>
      typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)),
  'SNAPSHOT_AUTH_ID_BASELINE_INVALID');
  requireValue(arrayEqual(snapshot.catalog?.columns, columnsForGuard(catalog)) &&
    arrayEqual(snapshot.catalog?.primary_keys, [...catalog].sort((a, b) => a.table.localeCompare(b.table)).map(t => ({ table: t.table, columns: t.pk }))),
  'SNAPSHOT_CATALOG_MISMATCH');
  requireValue(Array.isArray(snapshot.catalog.tables) &&
    arrayEqual(snapshot.catalog.tables.map(t => t.name), catalog.map(t => t.table).sort()) &&
    Array.isArray(snapshot.catalog.column_details) &&
    arrayEqual(snapshot.catalog.column_details.map(c => [c.table, c.name]), columnsForGuard(catalog).map(c => [c.table, c.name])) &&
    ['foreign_keys', 'triggers', 'functions'].every(k => Array.isArray(snapshot.catalog[k])) &&
    snapshot.catalog.triggers.every(t => MD5.test(t.definition_md5)) &&
    snapshot.catalog.functions.every(f => typeof f.signature === 'string' && MD5.test(f.definition_md5) && MD5.test(f.acl_md5)),
  'SNAPSHOT_CATALOG_COVERAGE_INCOMPLETE');
  requireValue(Array.isArray(snapshot.tables) && snapshot.tables.length === 64 &&
    arrayEqual(snapshot.tables.map(t => t.table), catalog.map(t => t.table).sort()), 'SNAPSHOT_TABLE_COVERAGE_INCOMPLETE');
  let count = 0;
  for (const table of snapshot.tables) {
    const expected = catalog.find(t => t.table === table.table), omitted = SNAPSHOT_OMISSIONS[table.table] || [];
    requireValue(Array.isArray(table.rows) && table.row_count === table.rows.length, 'SNAPSHOT_ROW_COUNT_MISMATCH');
    const keys = new Set();
    for (const row of table.rows) {
      requireValue(typeof row.pk_json_text === 'string' && !keys.has(row.pk_json_text), 'SNAPSHOT_PK_DUPLICATE_OR_MISSING');
      let pk; try { pk = JSON.parse(row.pk_json_text); } catch { fail('SNAPSHOT_PK_INVALID'); }
      requireValue(pk && !Array.isArray(pk) && arrayEqual(Object.keys(pk).sort(), [...expected.pk].sort()) &&
        Object.values(pk).every(v => v !== null), 'SNAPSHOT_PK_INVALID');
      keys.add(row.pk_json_text);
      requireValue(typeof row.row_json_text === 'string' && MD5.test(row.projected_row_md5) && MD5.test(row.full_row_md5) &&
        md5(row.row_json_text) === row.projected_row_md5, 'SNAPSHOT_CANONICAL_TEXT_HASH_MISMATCH');
      requireValue(row.omitted_column_nullity && arrayEqual(Object.keys(row.omitted_column_nullity).sort(), omitted) &&
        Object.values(row.omitted_column_nullity).every(v => typeof v === 'boolean'), 'SNAPSHOT_NULLITY_INCOMPLETE');
      if (omitted.length === 0) requireValue(row.full_row_md5 === row.projected_row_md5, 'SNAPSHOT_FULL_HASH_MISMATCH');
      else if (Object.values(row.omitted_column_nullity).every(Boolean)) requireValue(typeof row.restorable_row_json_text === 'string' &&
        md5(row.restorable_row_json_text) === row.full_row_md5, 'SNAPSHOT_NULL_RECONSTRUCTION_HASH_MISMATCH');
      else requireValue(row.restorable_row_json_text === null, 'SNAPSHOT_SENSITIVE_BODY_FORBIDDEN');
      const authority = MONOTONIC_AUTHORITIES[table.table];
      if (authority) requireValue(typeof row.monotonic?.counter === 'string' && /^-?\d+$/.test(row.monotonic.counter) &&
        MD5.test(row.monotonic.other_fields_md5) && arrayEqual(Object.keys(row.monotonic.clocks || {}).sort(), [...authority.clocks].sort()) &&
        Object.values(row.monotonic.clocks).every(value => typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)),
      'SNAPSHOT_MONOTONIC_METADATA_INCOMPLETE');
      count++;
    }
  }
  return { snapshot, rows: count, catalogSha256: journalHash(snapshot.catalog),
    projectedOnlyRows: snapshot.tables.flatMap(t => t.rows).filter(r => Object.values(r.omitted_column_nullity).some(v => !v)).length };
}

export async function writePrivateLiveSnapshot({ input, catalog, sourceUrl, file,
  privateRoot = resolve('.evidence-h171-private/live-snapshots'), compressGzip = false }) {
  const checked = validateLiveSnapshot(input, { catalog, sourceUrl });
  const root = resolve(privateRoot), target = resolve(file), inside = relative(root, target);
  requireValue(root.split(sep).includes('.evidence-h171-private') && inside && !inside.startsWith('..') &&
    !inside.includes(':'), 'SNAPSHOT_PRIVATE_PATH_REQUIRED');
  requireValue(typeof compressGzip === 'boolean' && (!compressGzip || target.endsWith('.json.gz')), 'SNAPSHOT_COMPRESSION_PATH_INVALID');
  await fs.mkdir(dirname(target), { recursive: true });
  // No parse/re-serialization of any PostgreSQL row string occurs here.
  const encoded = JSON.stringify({ ...checked.snapshot, local: { path: target, sourceUrl } }, null, 2) + '\n';
  // Post-captures retain the complete canonical JSON privately, compressed only
  // on disk. The file digest covers gzip bytes; source digest covers exact JSON.
  const sourceBytes = Buffer.from(encoded), persisted = compressGzip ? gzipSync(sourceBytes) : sourceBytes;
  const handle = await fs.open(target, 'wx', 0o600);
  try { await handle.writeFile(persisted); await handle.sync(); } finally { await handle.close(); }
  if (process.platform !== 'win32') { const directory = await fs.open(dirname(target), 'r'); try { await directory.sync(); } finally { await directory.close(); } }
  const bytes = await fs.readFile(target);
  requireValue(bytes.equals(persisted) && (!compressGzip || gunzipSync(bytes).equals(sourceBytes)), 'SNAPSHOT_PRIVATE_WRITE_VERIFICATION_FAILED');
  return { file: target, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    ...(compressGzip ? {compression:'gzip',sourceSha256:createHash('sha256').update(sourceBytes).digest('hex'),sourceBytes:sourceBytes.length} : {}),
    rows: checked.rows, tables: 64, catalogSha256: checked.catalogSha256, projectedOnlyRows: checked.projectedOnlyRows };
}

function decimalCompare(a, b) {
  const parse = value => { requireValue(typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value), 'SNAPSHOT_MONOTONIC_VALUE_INVALID');
    const negative = value.startsWith('-'), [whole, fraction = ''] = value.replace(/^-/, '').split('.');
    return { n: BigInt((negative ? '-' : '') + whole + fraction), scale: fraction.length }; };
  const x = parse(a), y = parse(b), scale = Math.max(x.scale, y.scale);
  const left = x.n * 10n ** BigInt(scale - x.scale), right = y.n * 10n ** BigInt(scale - y.scale);
  return left < right ? -1 : left > right ? 1 : 0;
}
const rowKey = (table, pk) => table + '\n' + pk;
export function diffLiveSnapshots({ baseline, final, catalog, sourceUrl, exactQaDeltas = [], approvedMonotonicCreations = [] }) {
  const before = validateLiveSnapshot(baseline, { catalog, sourceUrl }), after = validateLiveSnapshot(final, { catalog, sourceUrl });
  const catalogEqual = before.catalogSha256 === after.catalogSha256;
  const approved = new Map();
  for (const item of exactQaDeltas) {
    const key = rowKey(item.table, item.pk_json_text);
    requireValue(catalog.some(t => t.table === item.table) && typeof item.pk_json_text === 'string' &&
      SHA.test(item.provenanceSha256 || '') && [item.before_full_md5, item.after_full_md5].every(v => v === null || MD5.test(v)) &&
      !approved.has(key), 'SNAPSHOT_EXACT_QA_DELTA_INVALID');
    approved.set(key, item);
  }
  const retained=new Map(),retainedUsed=new Set();
  for(const item of approvedMonotonicCreations){
    const pk=JSON.parse(item.pk_json_text),key=rowKey(item.table,item.pk_json_text);
    requireValue(item.table==='folio_counters'&&arrayEqual(Object.keys(pk).sort(),['business_date','prefix'])&&
      /^[A-Z0-9]{1,6}$/.test(pk.prefix)&&/^\d{4}-\d{2}-\d{2}$/.test(pk.business_date)&&
      MD5.test(item.after_full_md5||'')&&SHA.test(item.provenanceSha256||'')&&!retained.has(key)&&!approved.has(key),
      'SNAPSHOT_RETAINED_COUNTER_INVALID');retained.set(key,item);
  }
  const findings = [], used = new Set();
  for (const table of before.snapshot.tables) {
    const left = new Map(table.rows.map(row => [row.pk_json_text, row]));
    const right = new Map(after.snapshot.tables.find(t => t.table === table.table).rows.map(row => [row.pk_json_text, row]));
    for (const pk of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(pk), b = right.get(pk), key = rowKey(table.table, pk), exact = approved.get(key);
      if (exact) {
        requireValue(exact.before_full_md5 === (a?.full_row_md5 ?? null) && exact.after_full_md5 === (b?.full_row_md5 ?? null),
          'SNAPSHOT_QA_HASH_DRIFT'); used.add(key);
      }
      if (a && b && a.full_row_md5 === b.full_row_md5) continue;
      const kind = !a ? 'new' : !b ? 'removed' : 'changed';
      let classification = exact ? 'EXACT_QA_DELTA' : 'NON_QA_' + kind.toUpperCase();
      const sensitive = [a, b].filter(Boolean).some(row => Object.values(row.omitted_column_nullity).some(v => !v));
      const authority = MONOTONIC_AUTHORITIES[table.table];
      if (sensitive) classification = 'HELD_SENSITIVE_COLUMNS_NOT_RESTORABLE';
      else if (authority) {
        if (!b || (a && (decimalCompare(b.monotonic.counter, a.monotonic.counter) < 0 ||
          authority.clocks.some(clock => decimalCompare(b.monotonic.clocks[clock], a.monotonic.clocks[clock]) < 0))))
          classification = 'MONOTONIC_REWIND_OR_REMOVAL';
        else if (!a) classification = 'MONOTONIC_NEW_REQUIRES_REVIEW';
        else if (a.monotonic.other_fields_md5 === b.monotonic.other_fields_md5 &&
          authority.clocks.every(clock => decimalCompare(b.monotonic.clocks[clock], a.monotonic.clocks[clock]) >= 0))
          classification = 'MONOTONIC_ADVANCE_TO_PRESERVE';
      }
      const retention=retained.get(key);
      if(retention){requireValue(!a&&b&&b.full_row_md5===retention.after_full_md5&&
        classification==='MONOTONIC_NEW_REQUIRES_REVIEW','SNAPSHOT_RETAINED_COUNTER_DRIFT');
        classification='MONOTONIC_CREATION_TO_PRESERVE';retainedUsed.add(key);}
      findings.push({ table: table.table, pk_json_text: pk, kind, classification,
        before_full_md5: a?.full_row_md5 ?? null, after_full_md5: b?.full_row_md5 ?? null,
        before_projected_md5: a?.projected_row_md5 ?? null, after_projected_md5: b?.projected_row_md5 ?? null,
        ...(exact ? { provenanceSha256: exact.provenanceSha256 } : {}) });
    }
  }
  requireValue(used.size === approved.size, 'SNAPSHOT_QA_DELTA_TARGET_MISSING');
  requireValue(retainedUsed.size===retained.size,'SNAPSHOT_RETAINED_COUNTER_MISSING');
  const blocking = findings.filter(row => !['EXACT_QA_DELTA', 'MONOTONIC_ADVANCE_TO_PRESERVE','MONOTONIC_CREATION_TO_PRESERVE'].includes(row.classification));
  return { format: 'balam-canonical-diff-v1', catalogEqual, beforeCatalogSha256: before.catalogSha256,
    afterCatalogSha256: after.catalogSha256, beforeRows: before.rows, afterRows: after.rows,
    new: findings.filter(f => f.kind === 'new'), removed: findings.filter(f => f.kind === 'removed'),
    changed: findings.filter(f => f.kind === 'changed'), blocking,
    nonQaExactlyEqual: catalogEqual && findings.every(f => f.classification === 'EXACT_QA_DELTA'),
    nonQaPreservedWithMonotonicAdvances: catalogEqual && blocking.length === 0,
    restorationAuthorized: false, baselineProjectedOnlyRows: before.projectedOnlyRows,
    finalProjectedOnlyRows: after.projectedOnlyRows };
}
