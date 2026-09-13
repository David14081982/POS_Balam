// Local PostgreSQL fixtures only. This file never connects to Supabase.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import * as fs from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { journalHash } from './h171-live-journal.mjs';
import { SNAPSHOT_PROJECT, SNAPSHOT_ACTOR, SNAPSHOT_OMISSIONS, recordedSnapshotCatalog,
  buildLiveSnapshotSql, buildLiveSnapshotCatalogSql, validateLiveSnapshot, writePrivateLiveSnapshot, diffLiveSnapshots } from './h171-live-snapshot.mjs';

const read = async path => JSON.parse((await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const authorityAudit = await read('docs/fixes/evidence/h171/authority-audit-before.json');
const cleanupCatalog = await read('docs/fixes/evidence/h171/cleanup-catalog-before.json');
const catalog = recordedSnapshotCatalog({ authorityAudit, cleanupCatalog });
const sourceUrl = `https://api.supabase.com/v1/projects/${SNAPSHOT_PROJECT}/database/query`;
const sql = buildLiveSnapshotSql({ catalog, sourceUrl });
const scratchRoot = resolve('.evidence-h171-private/live-snapshots');
await fs.mkdir(scratchRoot, { recursive: true });
const scratch = await fs.mkdtemp(join(scratchRoot, 'local-test-'));
const checks = [];
const checked = (name, fn) => test(name, async () => { await fn(); checks.push({ name, status: 'PASS' }); });
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const hash = value => createHash('md5').update(value).digest('hex');
function defaultValue(column) {
  if (!column.not_null) return 'NULL';
  if (column.type === 'text') return "'local fixture'";
  if (column.type === 'uuid') return "'33333333-3333-4333-8333-333333333333'::uuid";
  if (column.type === 'boolean') return 'true';
  if (column.type === 'jsonb') return "'{}'::jsonb";
  if (column.type === 'text[]') return "'{}'::text[]";
  if (column.type === 'date') return "DATE '2026-09-12'";
  if (column.type === 'timestamp with time zone') return "TIMESTAMPTZ '2026-09-12 13:14:15.123456+00'";
  return '0';
}
async function database(fn) {
  const db = new PGlite();
  try {
    await db.exec(`CREATE SCHEMA pos; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      INSERT INTO auth.users VALUES('${SNAPSHOT_ACTOR}');`);
    await db.exec(catalog.map(t => `CREATE TABLE pos.${t.table}(${t.columns.map(c =>
      `"${c.name}" ${c.type}${c.not_null ? ' NOT NULL' : ''}`).join(',')}, PRIMARY KEY(${t.pk.map(k => '"' + k + '"').join(',')}));`).join('\n'));
    const insert = async (table, overrides = {}) => {
      const t = catalog.find(t => t.table === table);
      await db.exec(`INSERT INTO pos.${table}(${t.columns.map(c => '"' + c.name + '"').join(',')})
        VALUES(${t.columns.map(c => overrides[c.name] ?? defaultValue(c)).join(',')});`);
    };
    const capture = async () => {
      const results = await db.exec(sql);
      const snapshot = results.find(r => r.rows[0]?.report)?.rows[0].report;
      validateLiveSnapshot(snapshot, { catalog, sourceUrl }); return snapshot;
    };
    await fn({ db, insert, capture });
  } finally { await db.close(); }
}
const row = (snapshot, table, index = 0) => snapshot.tables.find(t => t.table === table).rows[index];
const delta = (a, b, table, oldIndex = 0, newIndex = 0) => ({ table,
  pk_json_text: (row(a, table, oldIndex) || row(b, table, newIndex)).pk_json_text,
  before_full_md5: row(a, table, oldIndex)?.full_row_md5 ?? null,
  after_full_md5: row(b, table, newIndex)?.full_row_md5 ?? null, provenanceSha256: journalHash('LOCAL exact fixture journal') });
const compare = (baseline, final, extra = {}) => diffLiveSnapshots({ baseline, final, catalog, sourceUrl, ...extra });

checked('recorded BALAM catalog requires all64 tables, real PKs and exactly5 omitted columns', async () => {
  assert.equal(catalog.length, 64); assert.equal(Object.values(SNAPSHOT_OMISSIONS).flat().length, 5);
  assert.throws(() => buildLiveSnapshotSql({ catalog: catalog.slice(1), sourceUrl }), /TABLE_CATALOG/);
  const missing = structuredClone(catalog); missing[0].pk = [];
  assert.throws(() => buildLiveSnapshotSql({ catalog: missing, sourceUrl }), /PK_MISSING/);
  const newSecret = structuredClone(catalog); newSecret[0].columns.push({ name: 'new_secret', type: 'text', not_null: false });
  assert.throws(() => buildLiveSnapshotSql({ catalog: newSecret, sourceUrl }), /SENSITIVE_CATALOG_DRIFT/);
});
checked('all64 empty tables remain represented inside one canonical read-only snapshot', () => database(async ({ db, capture }) => {
  const snapshot = await capture();
  assert.equal(snapshot.tables.length, 64); assert.equal(snapshot.tables.every(t => t.row_count === 0 && t.rows.length === 0), true);
  assert.deepEqual(snapshot.auth_user_ids,[SNAPSHOT_ACTOR]);
  assert.equal(snapshot.read_only, 'on'); assert.equal(snapshot.isolation, 'repeatable read');
  assert.equal(snapshot.timezone, 'UTC'); assert.equal(snapshot.datestyle, 'ISO, MDY');
  assert.equal(snapshot.catalog.primary_keys.length, 64);
  await db.exec('SET search_path=pg_catalog;');
  assert.deepEqual((await db.query(buildLiveSnapshotCatalogSql())).rows[0].catalog, snapshot.catalog);
  assert.equal(compare(snapshot, snapshot).nonQaExactlyEqual, true);
}));
checked('canonical numeric scale and microsecond timestamptz survive private JSON storage and typed PostgreSQL reconstruction', () => database(async ({ db, insert, capture }) => {
  await insert('clients', { id: "'canonical-client'", total: '116.00' });
  const snapshot = await capture(), original = row(snapshot, 'clients');
  assert.ok(original.row_json_text.includes('116.00'));
  assert.ok(original.row_json_text.includes('2026-09-12T13:14:15.123456+00:00'));
  assert.notEqual(hash(JSON.stringify(JSON.parse(original.row_json_text))), original.projected_row_md5);
  const manifest = await writePrivateLiveSnapshot({ input: snapshot, catalog, sourceUrl,
    file: join(scratch, 'canonical.json'), privateRoot: scratchRoot });
  const saved = await read(manifest.file), savedRow = row(saved, 'clients');
  assert.equal(savedRow.row_json_text, original.row_json_text);
  await db.exec("SET TimeZone='UTC'; SET DateStyle='ISO, MDY';");
  const restored = await db.query('SELECT md5(to_jsonb(x)::text) row_md5 FROM jsonb_populate_record(NULL::pos.clients,$1::jsonb) x', [savedRow.row_json_text]);
  assert.equal(restored.rows[0].row_md5, original.full_row_md5);
  await assert.rejects(writePrivateLiveSnapshot({ input: snapshot, catalog, sourceUrl, file: join(scratch, 'canonical.json'), privateRoot: scratchRoot }), /EEXIST/);
  await assert.rejects(writePrivateLiveSnapshot({ input: snapshot, catalog, sourceUrl, file: resolve('public-snapshot.json'), privateRoot: scratchRoot }), /PRIVATE_PATH/);
}));
checked('NULL omitted columns have verifiable complete bodies; nonNULL secrets never leave PostgreSQL', () => database(async ({ db, insert, capture }) => {
  await insert('sellers', { id: "'null-sensitive'", password_hash: 'NULL' });
  const before = await capture(), safe = row(before, 'sellers');
  assert.deepEqual(safe.omitted_column_nullity, { password_hash: true });
  assert.ok(!safe.row_json_text.includes('password_hash'));
  assert.ok(safe.restorable_row_json_text.includes('"password_hash": null'));
  await db.exec("SET TimeZone='UTC'; SET DateStyle='ISO, MDY';");
  const restored = await db.query('SELECT md5(to_jsonb(x)::text) row_md5 FROM jsonb_populate_record(NULL::pos.sellers,$1::jsonb) x', [safe.restorable_row_json_text]);
  assert.equal(restored.rows[0].row_md5, safe.full_row_md5);
  await db.exec("UPDATE pos.sellers SET password_hash='LOCAL_SENSITIVE_VALUE_NEVER_EXPORT';");
  const after = await capture(), held = row(after, 'sellers');
  assert.deepEqual(held.omitted_column_nullity, { password_hash: false }); assert.equal(held.restorable_row_json_text, null);
  assert.equal(JSON.stringify(after).includes('LOCAL_SENSITIVE_VALUE_NEVER_EXPORT'), false);
  assert.equal(held.projected_row_md5, safe.projected_row_md5); assert.notEqual(held.full_row_md5, safe.full_row_md5);
  const diff = compare(before, after, { exactQaDeltas: [delta(before, after, 'sellers')] });
  assert.equal(diff.changed[0].classification, 'HELD_SENSITIVE_COLUMNS_NOT_RESTORABLE');
  assert.equal(diff.nonQaPreservedWithMonotonicAdvances, false);
}));
checked('new removed and changed rows require exact PK plus both full hashes; prefixes authorize nothing', () => database(async ({ db, insert, capture }) => {
  await insert('clients', { id: "'qa-prefix-stays-business'", nombre: "'Original'" });
  const before = await capture();
  await db.exec("UPDATE pos.clients SET nombre='Changed';");
  const changed = await capture();
  assert.equal(compare(before, changed).changed[0].classification, 'NON_QA_CHANGED');
  const proof = delta(before, changed, 'clients');
  assert.equal(compare(before, changed, { exactQaDeltas: [proof] }).nonQaExactlyEqual, true);
  assert.throws(() => compare(before, changed, { exactQaDeltas: [{ ...proof, after_full_md5: '0'.repeat(32) }] }), /QA_HASH_DRIFT/);
  await db.exec('DELETE FROM pos.clients;'); // local fixture only
  const removed = await capture();
  assert.equal(compare(before, removed).removed[0].classification, 'NON_QA_REMOVED');
  assert.equal(compare(removed, before).new[0].classification, 'NON_QA_NEW');
  assert.equal(compare(before, removed, { exactQaDeltas: [delta(before, removed, 'clients')] }).nonQaExactlyEqual, true);
}));
checked('NULL-password QA seller delta can be reviewed without an automatic HELD classification', () => database(async ({ db, insert, capture }) => {
  await insert('sellers', { id: "'qa-seller-null'" });
  const before = await capture(); await db.exec("UPDATE pos.sellers SET nombre='QA renamed';");
  const after = await capture();
  const diff = compare(before, after, { exactQaDeltas: [delta(before, after, 'sellers')] });
  assert.equal(diff.changed[0].classification, 'EXACT_QA_DELTA');
  assert.equal(diff.nonQaExactlyEqual, true); assert.equal(diff.restorationAuthorized, false);
}));
checked('revision beyond JS safe integer advances exactly and any rewind blocks even with QA proof', () => database(async ({ db, insert, capture }) => {
  await insert('online_snapshot_revision', { singleton: 'true', revision: '9007199254740993' });
  const before = await capture(); await db.exec('UPDATE pos.online_snapshot_revision SET revision=9007199254740994;');
  const after = await capture(), advance = compare(before, after);
  assert.equal(row(before, 'online_snapshot_revision').monotonic.counter, '9007199254740993');
  assert.equal(advance.changed[0].classification, 'MONOTONIC_ADVANCE_TO_PRESERVE');
  assert.equal(advance.nonQaExactlyEqual, false); assert.equal(advance.nonQaPreservedWithMonotonicAdvances, true);
  assert.equal(compare(after, before, { exactQaDeltas: [delta(after, before, 'online_snapshot_revision')] }).changed[0].classification,
    'MONOTONIC_REWIND_OR_REMOVAL');
}));
checked('folio and config clocks cannot rewind; new counters require review without resetting authority', () => database(async ({ db, insert, capture }) => {
  const empty = await capture();
  await insert('folio_counters', { prefix: "'BG'", last_seq: '4' });
  await insert('config_sync_state', { singleton: 'true', version: '42' });
  const before = await capture();
  assert.equal(compare(empty, before).new.every(r => r.classification === 'MONOTONIC_NEW_REQUIRES_REVIEW'), true);
  await db.exec("UPDATE pos.folio_counters SET last_seq=5,updated_at=updated_at+interval '1 microsecond'; UPDATE pos.config_sync_state SET version=43,updated_at=updated_at+interval '1 microsecond';");
  const after = await capture();
  assert.equal(compare(before, after).changed.every(r => r.classification === 'MONOTONIC_ADVANCE_TO_PRESERVE'), true);
  await db.exec("UPDATE pos.config_sync_state SET updated_at=updated_at-interval '2 microseconds';");
  const badClock = await capture();
  assert.equal(compare(after, badClock).changed[0].classification, 'MONOTONIC_REWIND_OR_REMOVAL');
}));
checked('catalog drift includes FK, trigger and function hashes and invalidates otherwise equal rows', () => database(async ({ db, capture }) => {
  const before = await capture();
  await db.exec(`CREATE FUNCTION pos.local_snapshot_probe() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END';
    CREATE TRIGGER local_snapshot_probe AFTER INSERT ON pos.clients FOR EACH ROW EXECUTE FUNCTION pos.local_snapshot_probe();
    ALTER TABLE pos.clients ADD CONSTRAINT local_snapshot_fk FOREIGN KEY(id) REFERENCES pos.products(id);`);
  const after = await capture(), diff = compare(before, after);
  await db.exec('SET search_path=pg_catalog;');
  assert.deepEqual((await db.query(buildLiveSnapshotCatalogSql())).rows[0].catalog, after.catalog);
  assert.equal(after.catalog.functions.some(f => f.signature === 'pos.local_snapshot_probe()'), true);
  assert.equal(after.catalog.triggers.some(t => !t.internal), true);
  assert.equal(after.catalog.foreign_keys.length, 1); assert.equal(diff.catalogEqual, false); assert.equal(diff.nonQaExactlyEqual, false);
  await db.exec("CREATE OR REPLACE FUNCTION pos.local_snapshot_probe() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN PERFORM 1; RETURN NEW; END';");
  const bodyChanged = await capture();
  assert.notEqual(after.catalog.functions.find(f => f.signature === 'pos.local_snapshot_probe()').definition_md5,
    bodyChanged.catalog.functions.find(f => f.signature === 'pos.local_snapshot_probe()').definition_md5);
  assert.equal(JSON.stringify(bodyChanged).includes('BEGIN PERFORM'), false);
}));
checked('missing PK and extra column/table cause SQL failure before row snapshot output', async () => {
  for (const statement of ['ALTER TABLE pos.clients DROP CONSTRAINT clients_pkey;',
    'ALTER TABLE pos.clients ADD COLUMN extra text;', 'CREATE TABLE pos.extra_table(id text PRIMARY KEY);']) {
    await database(async ({ db, capture }) => { await db.exec(statement); await assert.rejects(capture(), /SNAPSHOT_.*CATALOG_DRIFT/); });
  }
});
checked('foreign project, missing BALAM anchor and non-postgres session fail closed', async () => {
  assert.throws(() => buildLiveSnapshotSql({ catalog, sourceUrl: 'https://foreign.supabase.co/' }), /FOREIGN_PROJECT/);
  assert.throws(() => buildLiveSnapshotSql({ catalog, sourceUrl, projectRef: 'foreign' }), /FOREIGN_PROJECT/);
  await database(async ({ db, capture }) => { await db.exec('DELETE FROM auth.users;'); await assert.rejects(capture(), /ACTOR_ANCHOR_MISSING/); });
  await database(async ({ db, capture }) => { await db.exec('CREATE ROLE local_reader; SET ROLE local_reader;'); await assert.rejects(capture(), /POSTGRES_SESSION_REQUIRED/); });
});
checked('tampered row text, duplicate PK, incomplete coverage and unsafe full body are rejected', () => database(async ({ insert, capture }) => {
  await insert('sellers', { id: "'tamper-fixture'", password_hash: "'LOCAL_VALUE'" });
  const original = await capture();
  for (const mutate of [s => row(s, 'sellers').row_json_text += ' ',
    s => s.tables.pop(), s => { const t = s.tables.find(t => t.table === 'sellers'); t.rows.push(t.rows[0]); t.row_count++; },
    s => row(s, 'sellers').restorable_row_json_text = '{}']) {
    const tampered = structuredClone(original); mutate(tampered);
    assert.throws(() => validateLiveSnapshot(tampered, { catalog, sourceUrl }), /SNAPSHOT_/);
  }
}));

after(async () => {
  await fs.writeFile('docs/fixes/evidence/h171-live-snapshot.sql', sql);
  await fs.writeFile('docs/fixes/evidence/h171-live-snapshot-local-validation.json', JSON.stringify({
    at: new Date().toISOString(), scope: 'LOCAL_PGLITE_NO_NETWORK_NO_REMOTE_MUTATIONS',
    checksPassed: checks.length, expectedChecks: 12, checks,
    tables: catalog.length, columns: catalog.reduce((n, t) => n + t.columns.length, 0), omissions: SNAPSHOT_OMISSIONS,
    moduleSha256: journalHash(await fs.readFile('h171-live-snapshot.mjs', 'utf8')),
    testSha256: journalHash(await fs.readFile('test-h171-live-snapshot.mjs', 'utf8')),
    sqlSha256: journalHash(sql),
    limits: ['Transport binding must be independently verified by the remote executor.',
      'NonNULL omitted values cannot be restored from this snapshot.',
      'No fixture attribution by prefix; exact PK/full hashes require separate provenance.',
      'No remote snapshot, cleanup or distributed certification was executed by this test.'],
  }, null, 2) + '\n');
  const child = relative(scratchRoot, resolve(scratch));
  assert.ok(child && !child.startsWith('..'));
  await fs.rm(scratch, { recursive: true, force: true });
});
