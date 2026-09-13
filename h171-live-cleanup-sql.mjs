// H171 local preparation only. This module neither authorizes nor executes SQL.
import { createHash } from 'node:crypto';
import { journalHash } from './h171-live-journal.mjs';
import { SNAPSHOT_PROJECT, SNAPSHOT_ACTOR, SNAPSHOT_OMISSIONS, validateLiveSnapshot,
  snapshotConnection, buildLiveSnapshotCatalogSql } from './h171-live-snapshot.mjs';

const SHA = /^[a-f0-9]{64}$/, MD5 = /^[a-f0-9]{32}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const NAME = /^[a-z_][a-z0-9_]*$/;
const md5 = value => createHash('md5').update(value).digest('hex');
const need = (ok, code) => { if (!ok) throw Object.assign(new Error(code), { code }); };
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const qi = value => { need(NAME.test(value), 'CLEANUP_IDENTIFIER_INVALID'); return '"' + value + '"'; };
const json = value => q(JSON.stringify(value)) + '::jsonb';
const key = (table, pk) => table + ':' + pk;
const rowsOf = snapshot => snapshot.tables.flatMap(t => t.rows.map(row => ({ table: t.table, ...row })));

// Union of the runner's commercial/technical rows. Shared configuration, counters,
// Auth, Storage, legacy archives, recovery tokens and historical backups are never targets.
export const LIVE_CLEANUP_ORDER = Object.freeze([
  'sale_payments', 'layaway_liquidation_commits', 'sale_commits', 'stock_reservations',
  'exchange_items', 'exchange_commits', 'exchanges', 'return_items', 'return_commits', 'returns',
  'movements', 'reference_reclassifications', 'sale_items', 'sales', 'loan_documents',
  'commission_adjustments', 'liquidations', 'products', 'clients', 'promotions', 'settings',
  'permission_change_audit', 'user_screen_permission_overrides', 'user_permission_role_assignments', 'sellers',
  'sync_activity', 'sync_quarantine_cases', 'config_commits', 'online_account_requests',
  'online_requests', 'capability_operation_audit', 'sync_devices',
]);
const sharedParents = new Set(['operational_capabilities', 'permission_roles', 'screen_permission_catalog']);
// BALAM also has document relationships without physical FKs. These are not inferred from labels.
const links = [
  ['sale_payments', 'folio', 'sales', 'folio'], ['sale_commits', 'folio', 'sales', 'folio'],
  ['sale_payments', 'folio', 'exchanges', 'folio'],
  ['layaway_liquidation_commits', 'folio', 'sales', 'folio'], ['stock_reservations', 'folio', 'sales', 'folio'],
  ['sale_items', 'product_id', 'products', 'id'], ['return_items', 'product_id', 'products', 'id'],
  ['exchange_items', 'product_id', 'products', 'id'], ['returns', 'folio', 'sales', 'folio'],
  ['return_commits', 'return_id', 'returns', 'id'], ['return_commits', 'folio', 'sales', 'folio'],
  ['exchanges', 'origen_folio', 'sales', 'folio'], ['exchanges', 'vendedor_id', 'sellers', 'id'],
  ['exchange_commits', 'exchange_id', 'exchanges', 'id'], ['movements', 'product_id', 'products', 'id'],
  ['movements', 'return_id', 'returns', 'id'], ['movements', 'ref', 'sales', 'folio'],
  ['movements', 'ref', 'exchanges', 'folio'], ['liquidations', 'seller_id', 'sellers', 'id'],
  ['commission_adjustments', 'seller_id', 'sellers', 'id'],
  ['config_commits', 'device_id', 'sync_devices', 'device_id'],
  ['online_requests', 'device_id', 'sync_devices', 'device_id'],
];
const jsonLinks = [
  ['sales', 'vendedores', '$[*]', 'sellers', 'id'],
  ['sales', 'vendedores', '$[*].id', 'sellers', 'id'],
  ['returns', 'vendedores', '$[*]', 'sellers', 'id'],
  ['sale_items', 'promos', '$[*].id', 'promotions', 'id'],
  ['stock_reservations', 'lines', '$[*].product_id', 'products', 'id'],
  ['stock_reservations', 'lines', '$[*].productId', 'products', 'id'],
  ['loan_documents', 'document', '$.**.productId', 'products', 'id'],
  ['loan_documents', 'document', '$.**.clienteId', 'clients', 'id'],
];

// Hash canonical PostgreSQL hashes, never JSON.parse/stringify row bodies. This is
// order-independent even for large historical JSON and preserves numeric scale.
export function cleanupRowsFingerprint(rows) {
  need(rows.every(row => MD5.test(row.full_row_md5)), 'CLEANUP_FULL_HASH_REQUIRED');
  return { row_count: rows.length, full_rows_md5: md5(rows.map(row => row.full_row_md5).sort().join('')) };
}

export function buildLiveCleanupSql({ plan, catalog, baselineSnapshot, currentSnapshot, sourceUrl }) {
  const connection = snapshotConnection(sourceUrl, plan?.projectRef);
  const baseline = validateLiveSnapshot(baselineSnapshot, { catalog, sourceUrl }).snapshot;
  const current = validateLiveSnapshot(currentSnapshot, { catalog, sourceUrl }).snapshot;
  need(plan?.reconciled === true && SHA.test(plan.reconciliationSha256), 'CLEANUP_RECONCILIATION_REQUIRED');
  need(plan.cleanupManifestComplete === true, 'CLEANUP_COMPLETE_MANIFEST_REQUIRED');
  need(UUID.test(plan.run) && UUID.test(plan.actorId) && plan.actorId !== SNAPSHOT_ACTOR, 'CLEANUP_QA_ACTOR_RUN_REQUIRED');
  need(SHA.test(plan.artifactSha256) && /^\d{4}-\d{2}-\d{2}-h(?:164|166)-online$/.test(plan.clientBuild), 'CLEANUP_BUILD_REQUIRED');
  need(plan.backup?.baselineSha256 === journalHash(baseline) && plan.backup?.currentSha256 === journalHash(current), 'CLEANUP_BACKUP_DIGEST_MISMATCH');
  need(SHA.test(plan.backup?.baselineFileSha256) && SHA.test(plan.backup?.currentFileSha256), 'CLEANUP_DURABLE_BACKUP_REQUIRED');
  need(journalHash(baseline.catalog) === journalHash(current.catalog), 'CLEANUP_CATALOG_CHANGED_DURING_RUN');
  need(plan.external?.auth === 'HELD_SEPARATE_GOTRUE' && plan.external?.storage === 'HELD_SEPARATE_STORAGE', 'CLEANUP_EXTERNAL_SCOPE_REQUIRED');
  need(Array.isArray(plan.holds) && Array.isArray(plan.targets), 'CLEANUP_EXPLICIT_SCOPE_REQUIRED');
  // An early failure can create Auth before the first POS write. Zero POS scope
  // still executes the complete locked transaction; it is not a fabricated receipt.
  if (!plan.targets.length) {
    const base = plan.authBaseline, authTargets = plan.authTargets;
    need(plan.readyForReview === true && plan.authCleanupManifestComplete === true &&
      Array.isArray(plan.blockers) && !plan.blockers.length, 'CLEANUP_ZERO_SCOPE_REVIEWED_AUTH_REQUIRED');
    need(base?.format === 'balam-live-auth-baseline-v1' && base.projectRef === plan.projectRef &&
      base.run === plan.run && base.actorId === plan.actorId && base.artifactSha256 === plan.artifactSha256 &&
      base.complete === true && base.snapshotSha256 === plan.backup.baselineSha256 && SHA.test(base.fileSha256) &&
      plan.authBaselineSha256 === journalHash(base) && Array.isArray(base.ids) &&
      journalHash([...base.ids].sort()) === journalHash([...baseline.auth_user_ids].sort()), 'CLEANUP_ZERO_SCOPE_AUTH_BASELINE_REQUIRED');
    need(Array.isArray(authTargets) && [1,2].includes(authTargets.length) &&
      new Set(authTargets.map(t => t.id)).size === authTargets.length && authTargets.some(t => t.id === plan.actorId),
    'CLEANUP_ZERO_SCOPE_NEW_AUTH_REQUIRED');
    for (const t of authTargets) {
      const p = t.provenance, principal = t.id === plan.actorId;
      need(UUID.test(t.id) && t.id !== SNAPSHOT_ACTOR && !base.ids.includes(t.id) &&
        t.status === 'PROVEN_NEW_SEPARATE_GOTRUE' && SHA.test(t.emailSha256) && p?.actorId === plan.actorId &&
        p.run === plan.run && UUID.test(p.requestId) && SHA.test(p.intentSha256) && SHA.test(p.receiptSha256) &&
        Number.isSafeInteger(p.sequence) && p.sequence > 0 &&
        t.marker?.namespace === (principal ? 'user_metadata' : 'app_metadata') &&
        t.marker.key === (principal ? 'balam_online_test' : 'balam_account_request_id') &&
        t.marker.value === (principal ? plan.run : p.requestId), 'CLEANUP_ZERO_SCOPE_AUTH_PROVENANCE_REQUIRED');
    }
    need(journalHash([...current.auth_user_ids].sort()) === journalHash([...base.ids,...authTargets.map(t => t.id)].sort()),
      'CLEANUP_ZERO_SCOPE_AUTH_CENSUS_CHANGED');
  }
  const columns = new Map(catalog.map(t => [t.table, new Set(t.columns.map(c => c.name))]));
  const beforeKeys = new Set(rowsOf(baseline).map(row => key(row.table, row.pk_json_text)));
  const currentRows = new Map(rowsOf(current).map(row => [key(row.table, row.pk_json_text), row]));
  const targetKeys = new Set(), held = new Set();
  for (const hold of plan.holds) {
    need(columns.has(hold.table) && typeof hold.pk_json_text === 'string' && typeof hold.reason === 'string' && hold.reason.length > 0, 'CLEANUP_HOLD_INVALID');
    const id = key(hold.table, hold.pk_json_text);
    need(currentRows.has(id) && !held.has(id), 'CLEANUP_HOLD_IDENTITY_INVALID');
    need(beforeKeys.has(id), 'CLEANUP_NEW_HOLD_REQUIRES_RECONCILIATION'); held.add(id);
  }
  // Every non-restorable omitted value must be explicitly held, even outside scope.
  for (const row of currentRows.values()) if (Object.values(row.omitted_column_nullity).some(v => !v))
    need(held.has(key(row.table, row.pk_json_text)), 'CLEANUP_SECRET_HOLD_REQUIRED');
  const scope = plan.targets.map(target => {
    need(LIVE_CLEANUP_ORDER.includes(target.table), 'CLEANUP_TABLE_NOT_SUPPORTED');
    const id = key(target.table, target.pk_json_text), row = currentRows.get(id);
    need(row && !targetKeys.has(id), 'CLEANUP_TARGET_MISSING_OR_DUPLICATE'); targetKeys.add(id);
    need(!beforeKeys.has(id), 'CLEANUP_BASELINE_ROW_FORBIDDEN');
    need(!held.has(id) && Object.values(row.omitted_column_nullity).every(Boolean), 'CLEANUP_HELD_OR_SECRET_TARGET');
    need(target.full_row_md5 === row.full_row_md5, 'CLEANUP_TARGET_HASH_MISMATCH');
    const p = target.provenance;
    need(p?.run === plan.run && p.actorId === plan.actorId && SHA.test(p.intentSha256) && SHA.test(p.receiptSha256) && UUID.test(p.requestId), 'CLEANUP_INTENT_RECEIPT_PROVENANCE_REQUIRED');
    const pk = JSON.parse(row.pk_json_text);
    need(!Object.values(pk).includes(SNAPSHOT_ACTOR) && !Object.values(pk).includes('BG-260912-0001'), 'CLEANUP_REAL_IDENTITY_FORBIDDEN');
    // Body stays canonical in the private backup; generated SQL contains only PKs/hashes.
    return { table_name: target.table, pk_json_text: row.pk_json_text, row_md5: row.full_row_md5 };
  });
  const selectedTables = LIVE_CLEANUP_ORDER.filter(table => scope.some(row => row.table_name === table));
  const revision = current.tables.find(t => t.table === 'online_snapshot_revision');
  need(revision.rows.length === 1, 'CLEANUP_REVISION_SINGLETON_REQUIRED');
  const revisionTriggers = current.catalog.triggers.filter(t => t.name === 'h166_snapshot_changed');
  need(revisionTriggers.every(t => t.enabled === 'O' && t.function_signature === 'pos.h166_advance_snapshot_revision()' &&
    t.definition_md5 === md5(`CREATE TRIGGER h166_snapshot_changed AFTER INSERT OR DELETE OR UPDATE OR TRUNCATE ON pos.${t.table} FOR EACH STATEMENT EXECUTE FUNCTION pos.h166_advance_snapshot_revision()`)), 'CLEANUP_SNAPSHOT_TRIGGER_CONTRACT_UNSUPPORTED');
  let expectedRevisionDelta = revisionTriggers.filter(t => selectedTables.includes(t.table)).length;
  // FK actions still invalidate an empty child relation after its explicit cleanup.
  // PostgreSQL groups that child's AFTER STATEMENT event within the single parent
  // DELETE, including when it deletes two parents (H171 local recorded-FK proof).
  for (const fk of current.catalog.foreign_keys) if (/ON DELETE (CASCADE|SET NULL|SET DEFAULT)/.test(fk.definition) &&
    selectedTables.includes(fk.target.replace(/^pos\./,'')) && revisionTriggers.some(t => 'pos.'+t.table === fk.source)) {
    need(fk.source !== fk.target, 'CLEANUP_SELF_CASCADE_UNSUPPORTED');
    expectedRevisionDelta += 1;
  }
  const outside = current.tables.filter(t => t.table !== 'online_snapshot_revision').map(t => ({ table_name: t.table,
    ...cleanupRowsFingerprint(t.rows.filter(row => !targetKeys.has(key(t.table, row.pk_json_text)))) }));
  need(outside.length === 63, 'CLEANUP_OUTSIDE_COVERAGE_REQUIRED');
  const manifest = { format: 'balam-new-fixture-cleanup-v1', projectRef: plan.projectRef, sourceUrl: connection.sourceUrl,
    artifactSha256: plan.artifactSha256, clientBuild: plan.clientBuild, actorId: plan.actorId, run: plan.run,
    reconciliationSha256: plan.reconciliationSha256, backup: plan.backup, targets: plan.targets,
    holds: plan.holds, omissions: SNAPSHOT_OMISSIONS, external: plan.external,
    ...(!scope.length ? { authTargets: plan.authTargets, authBaselineSha256: plan.authBaselineSha256 } : {}),
    catalogSha256: journalHash(current.catalog), outside, expectedRevisionDelta };
  const planSha256 = journalHash(manifest);
  const selected = (table, alias) => `EXISTS(SELECT 1 FROM pg_temp.h171_new_scope s WHERE s.table_name=${q(table)} AND to_jsonb(${alias}) @> s.pk)`;
  const check = (query, code) => ` IF EXISTS(${query}) THEN RAISE EXCEPTION ${q(code)}; END IF;`;
  const relations = [];
  for (const fk of current.catalog.foreign_keys) {
    const match = /^FOREIGN KEY \(([a-z0-9_", ]+)\) REFERENCES "?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?\(([a-z0-9_", ]+)\)/.exec(fk.definition);
    need(match && fk.source.startsWith('pos.') && ['pos', 'auth'].includes(match[2]), 'CLEANUP_FK_CONTRACT_UNSUPPORTED:' + fk.name);
    const source = fk.source.slice(4), target = match[3], sourceCols = match[1].split(',').map(v => v.trim().replaceAll('"','')), targetCols = match[4].split(',').map(v => v.trim().replaceAll('"',''));
    need(sourceCols.length === targetCols.length && columns.has(source) && (match[2] === 'pos' ? columns.has(target) : target === 'users'), 'CLEANUP_FK_IDENTITY_UNSUPPORTED');
    relations.push({ source, target, schema: match[2], condition: sourceCols.map((c, i) => `c.${qi(c)}=p.${qi(targetCols[i])}`).join(' AND '), physical: true });
  }
  for (const [source, column, target, parent] of links) if (columns.get(source)?.has(column) && columns.get(target)?.has(parent))
    relations.push({ source, target, schema: 'pos', condition: `c.${qi(column)}::text=p.${qi(parent)}::text`, physical: false });
  for (const [source, column, path, target, parent] of jsonLinks) if (columns.get(source)?.has(column))
    relations.push({ source, target, schema: 'pos', condition: `jsonb_path_exists(c.${qi(column)},${q(path + ' ? (@ == $id)')}::jsonpath,jsonb_build_object('id',p.${qi(parent)}::text))`, physical: false });
  const relationChecks = relations.flatMap(r => {
    const join = `SELECT 1 FROM pos.${qi(r.source)} c JOIN ${r.schema}.${qi(r.target)} p ON ${r.condition}`;
    const checks = [];
    if (selectedTables.includes(r.target) && r.schema === 'pos') checks.push(check(`${join} WHERE ${selected(r.target, 'p')} AND NOT ${selected(r.source, 'c')}`, 'CLEANUP_UNSELECTED_CHILD:' + r.source + ':' + r.target));
    if (selectedTables.includes(r.source) && r.schema === 'pos' && !sharedParents.has(r.target))
      checks.push(check(`${join} WHERE ${selected(r.source, 'c')} AND NOT ${selected(r.target, 'p')}`, 'CLEANUP_FOREIGN_PARENT:' + r.source + ':' + r.target));
    if (selectedTables.includes(r.source) && r.schema === 'auth') checks.push(check(`${join} WHERE ${selected(r.source, 'c')} AND p.id<>${q(plan.actorId)}::uuid AND NOT EXISTS(SELECT 1 FROM pos.online_account_requests a WHERE a.actor_id=${q(plan.actorId)}::uuid AND a.target_user_id=p.id AND a.state='completed' AND a.result->>'ok'='true' AND ${selected('online_account_requests', 'a')})`, 'CLEANUP_FOREIGN_AUTH_REFERENCE:' + r.source));
    return checks;
  }).join('\n');
  const actorChecks = [];
  for (const [table, column] of [['online_requests','actor_id'],['online_account_requests','actor_id'],['capability_operation_audit','actor_user_id'],['permission_change_audit','actor_user_id'],['reference_reclassifications','actor_user_id'],['commission_adjustments','actor_user_id'],['sync_devices','user_id']])
    if (selectedTables.includes(table)) actorChecks.push(check(`SELECT 1 FROM pos.${qi(table)} t WHERE ${selected(table, 't')} AND t.${qi(column)} IS DISTINCT FROM ${q(plan.actorId)}::uuid`, 'CLEANUP_ACTOR_MISMATCH:' + table));
  for (const [table, column] of [['online_account_requests','target_user_id'],['permission_change_audit','target_user_id']])
    if (selectedTables.includes(table)) actorChecks.push(check(`SELECT 1 FROM pos.${qi(table)} t WHERE ${selected(table, 't')} AND t.${qi(column)} IS NOT NULL AND t.${qi(column)}<>${q(plan.actorId)}::uuid AND NOT EXISTS(SELECT 1 FROM pos.online_account_requests a JOIN auth.users u ON u.id=a.target_user_id WHERE a.actor_id=${q(plan.actorId)}::uuid AND a.target_user_id=t.${qi(column)} AND a.state='completed' AND a.result->>'ok'='true' AND a.result->>'id'=u.id::text AND u.raw_app_meta_data->>'balam_account_request_id'=a.request_id::text AND ${selected('online_account_requests', 'a')})`, 'CLEANUP_FOREIGN_ACCOUNT_TARGET:' + table));
  if (selectedTables.includes('online_requests')) actorChecks.push(check(`SELECT 1 FROM pos.online_requests t WHERE ${selected('online_requests', 't')} AND (t.state NOT IN('confirmed','rejected','cancelled') OR t.state IS NULL OR t.response->>'requestId' IS DISTINCT FROM t.request_id::text)`, 'CLEANUP_RECEIPT_NOT_TERMINAL'));
  // Physical CASCADE children must already have been explicitly removed. Same-table
  // NO ACTION self references are handled in one DELETE statement by PostgreSQL.
  const deletes = selectedTables.map(table => {
    const inbound = relations.filter(r => r.physical && r.schema === 'pos' && r.target === table && r.source !== table).map(r =>
      check(`SELECT 1 FROM pos.${qi(r.source)} c JOIN pos.${qi(table)} p ON ${r.condition} WHERE ${selected(table, 'p')}`, 'CLEANUP_REMAINING_FK_CHILD:' + r.source)).join('\n');
    return `${inbound}
 WITH removed AS(DELETE FROM pos.${qi(table)} t USING pg_temp.h171_new_scope s
  WHERE s.table_name=${q(table)} AND to_jsonb(t) @> s.pk AND md5(to_jsonb(t)::text)=s.row_md5
  RETURNING s.table_name,s.pk,s.row_md5) INSERT INTO pg_temp.h171_new_removed SELECT * FROM removed;
 GET DIAGNOSTICS v_count=ROW_COUNT;
 IF v_count<>${scope.filter(r => r.table_name === table).length} THEN RAISE EXCEPTION 'CLEANUP_DELETE_COUNT:${table}'; END IF;`;
  }).join('\n');
  const catalogSql = buildLiveSnapshotCatalogSql().trim().replace(/;$/, '');
  const fingerprint = (table, excluded) => `WITH row_hashes AS MATERIALIZED(SELECT md5(to_jsonb(t)::text) row_md5 FROM pos.${qi(table)} t${excluded ? ' WHERE NOT ' + selected(table, 't') : ''}) SELECT count(*),md5(coalesce(string_agg(row_md5,'' ORDER BY row_md5),'')) FROM row_hashes`;
  const compare = (after = false) => outside.map(t => ` ${fingerprint(t.table_name, !after && selectedTables.includes(t.table_name))} INTO v_count,v_hash;
 IF v_count<>${t.row_count} OR v_hash IS DISTINCT FROM ${q(t.full_rows_md5)} THEN RAISE EXCEPTION 'CLEANUP_${after ? 'OUTSIDE_CHANGED' : 'LOCKED_BASELINE_DRIFT'}:${t.table_name}'; END IF;`).join('\n');
  const sql = `-- H171 NEW fixtures only. Local generator; concrete plan requires technical review.
-- No execution/authorization is conferred by this file. Existing live runner gate stays closed.
-- Plan SHA256 ${planSha256}; project binding is external URL plus real actor anchor.
-- Auth/Storage stay HELD outside SQL. No counter/config restoration or receipt replay.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL statement_timeout='180s';
SET LOCAL lock_timeout='5s';
SET LOCAL TimeZone='UTC';
SET LOCAL DateStyle='ISO, MDY';
SET LOCAL search_path=pg_catalog;
SELECT pg_advisory_xact_lock(hashtextextended('pos.h149.recovery-fence',0));
LOCK TABLE ${catalog.map(t => 'pos.' + qi(t.table)).sort().join(',')} IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE auth.users IN SHARE MODE;
SET LOCAL pos.h171_cleanup_plan_sha256=${q(planSha256)};
CREATE TEMP TABLE h171_new_scope(table_name text NOT NULL,pk jsonb NOT NULL,row_md5 text NOT NULL,PRIMARY KEY(table_name,pk)) ON COMMIT DROP;
INSERT INTO pg_temp.h171_new_scope SELECT x->>'table_name',(x->>'pk_json_text')::jsonb,x->>'row_md5' FROM jsonb_array_elements(${json(scope)}) x;
CREATE TEMP TABLE h171_new_removed(LIKE pg_temp.h171_new_scope INCLUDING ALL) ON COMMIT DROP;
CREATE TEMP TABLE h171_new_revision ON COMMIT DROP AS SELECT * FROM pos.online_snapshot_revision;
CREATE TEMP TABLE h171_new_auth ON COMMIT DROP AS
 WITH row_hashes AS MATERIALIZED(SELECT md5(to_jsonb(t)::text) row_md5 FROM auth.users t)
 SELECT count(*) row_count,md5(coalesce(string_agg(row_md5,'' ORDER BY row_md5),'')) rows_md5 FROM row_hashes;
DO $h171_new_cleanup$
DECLARE v_count bigint;v_hash text;v_row record;v_catalog jsonb;
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres'
  OR coalesce(current_setting('role',true),'none')<>'none' OR auth.uid() IS NOT NULL
 THEN RAISE EXCEPTION 'CLEANUP_STANDARD_OWNER_CONTEXT_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pos.system_manifest WHERE singleton AND system_mode='preproduction')
  OR (SELECT enabled FROM pos.online_runtime WHERE singleton) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'CLEANUP_PREPRODUCTION_ONLY_ONLINE_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=${q(plan.actorId)}::uuid AND raw_user_meta_data->>'balam_online_test'=${q(plan.run)})
  OR pos.can_manage_screen_permissions(${q(SNAPSHOT_ACTOR)}::uuid) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'CLEANUP_QA_OR_REAL_ACTOR_GUARD'; END IF;
${!scope.length ? ` IF (SELECT coalesce(jsonb_agg(id::text ORDER BY id::text),'[]'::jsonb) FROM auth.users) IS DISTINCT FROM ${json([...current.auth_user_ids].sort())}
 THEN RAISE EXCEPTION 'CLEANUP_ZERO_SCOPE_AUTH_CENSUS_DRIFT'; END IF;` : ''}
 IF EXISTS(SELECT 1 FROM pos.online_requests WHERE state='executing')
  OR EXISTS(SELECT 1 FROM pos.online_account_requests WHERE state NOT IN('completed','rejected','cancelled') OR state IS NULL)
 THEN RAISE EXCEPTION 'CLEANUP_NONTERMINAL_REQUEST'; END IF;
 SELECT x.catalog INTO STRICT v_catalog FROM (${catalogSql}) x;
 IF v_catalog IS DISTINCT FROM ${json(current.catalog)} THEN RAISE EXCEPTION 'CLEANUP_CATALOG_DRIFT'; END IF;
 FOR v_row IN SELECT * FROM pg_temp.h171_new_scope LOOP
  EXECUTE format('SELECT count(*) FROM pos.%I t WHERE to_jsonb(t) @> $1 AND md5(to_jsonb(t)::text)=$2',v_row.table_name)
    INTO v_count USING v_row.pk,v_row.row_md5;
  IF v_count<>1 THEN RAISE EXCEPTION 'CLEANUP_EXACT_PK_HASH_DRIFT:%',v_row.table_name; END IF;
 END LOOP;
 IF (SELECT md5(to_jsonb(t)::text) FROM pos.online_snapshot_revision t) IS DISTINCT FROM ${q(revision.rows[0].full_row_md5)}
 THEN RAISE EXCEPTION 'CLEANUP_REVISION_BASELINE_DRIFT'; END IF;
${actorChecks.join('\n')}
${relationChecks}
${compare()}
 -- Existing owner-maintenance context, as used by H164 retirement and approved149.
 PERFORM set_config('request.headers',${json({ 'x-balam-client-build': plan.clientBuild })}::text,true);
 PERFORM set_config('pos.h149_rpc','on',true);
 PERFORM set_config('pos.h149_device','',true);
${deletes}
 IF (SELECT count(*) FROM pg_temp.h171_new_removed)<>${scope.length} THEN RAISE EXCEPTION 'CLEANUP_INCOMPLETE_SCOPE'; END IF;
 -- Force deferred constraints before final comparison: their triggers may write rows.
 SET CONSTRAINTS ALL IMMEDIATE;
${compare(true)}
 WITH row_hashes AS MATERIALIZED(SELECT md5(to_jsonb(t)::text) row_md5 FROM auth.users t)
 SELECT count(*),md5(coalesce(string_agg(row_md5,'' ORDER BY row_md5),'')) INTO v_count,v_hash FROM row_hashes;
 IF NOT EXISTS(SELECT 1 FROM pg_temp.h171_new_auth WHERE row_count=v_count AND rows_md5=v_hash)
 THEN RAISE EXCEPTION 'CLEANUP_AUTH_CHANGED'; END IF;
 IF (SELECT count(*) FROM pos.online_snapshot_revision)<>1 OR
  (SELECT r.revision=b.revision+${expectedRevisionDelta} AND to_jsonb(r)-'revision'=to_jsonb(b)-'revision'
   FROM pos.online_snapshot_revision r JOIN pg_temp.h171_new_revision b USING(singleton)) IS DISTINCT FROM true
 THEN RAISE EXCEPTION 'CLEANUP_SNAPSHOT_REVISION_DELTA'; END IF;
 IF pos.can_manage_screen_permissions(${q(SNAPSHOT_ACTOR)}::uuid) IS DISTINCT FROM true THEN RAISE EXCEPTION 'CLEANUP_REAL_ADMIN_CHANGED'; END IF;
 PERFORM pos.assert_permission_admin_survives();
END $h171_new_cleanup$;
SET CONSTRAINTS ALL IMMEDIATE;
SELECT jsonb_build_object('format','balam-new-fixture-cleanup-result-v1','project_ref',${q(SNAPSHOT_PROJECT)},'run',${q(plan.run)},
 'plan_sha256',${q(planSha256)},'removed_rows',(SELECT count(*) FROM pg_temp.h171_new_removed),
 'removed_manifest',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY table_name,pk::text),'[]'::jsonb) FROM pg_temp.h171_new_removed t),
 'outside_tables_checked',63,'outside_full_hashes',${json(outside)},'snapshot_revision_delta',${expectedRevisionDelta},
 'auth_sql_unchanged',true,'auth_cleanup_verified',false,'storage_cleanup_verified',false,
 'certified',false,'cleanup_verified',false,'holds',${json(plan.holds)}) report;
COMMIT;
`;
  return { sql, manifest, planSha256, reviewRequired: true, liveGateOpened: false,
    certified: false, cleanupVerified: false, expectedRows: scope.length, expectedRevisionDelta };
}
