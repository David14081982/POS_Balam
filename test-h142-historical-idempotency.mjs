// H142/S11: real deployed hash/idempotency functions in local PostgreSQL.
// Seeds already-committed synthetic documents. Financial first-commit paths
// are covered separately by the recovery SQL simulation, not by this test.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.BALAM_PGLITE_MODULE
  ? pathToFileURL(process.env.BALAM_PGLITE_MODULE).href : '@electric-sql/pglite');
// Portable, sanitized pg_get_functiondef capture: full SQL bodies only.
// Its source, capture date and deliberate test seams are documented in the fixture.
const captured = JSON.parse(readFileSync(new URL('./test-fixtures/h142-idempotency-contracts.json', import.meta.url), 'utf8'));
const definitions = new Map(captured.functions.map(row => {
  if (createHash('sha256').update(row.definition).digest('hex') !== row.sha256)
    throw Error(`Captured SQL integrity mismatch: ${row.name}`);
  return [row.name, row.definition];
}));
const db = new PGlite(); let pass = 0, fail = 0;
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail || {})}`); ok ? pass++ : fail++; };
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
try {
  await db.exec(`create schema pos; create role anon; create role authenticated;
    create table pos.products(id text primary key,record_model text,deleted_at timestamptz,
      barcode_code text,barcode_aliases jsonb,stock_quantity integer);
    create table pos.inventory_v1_v2_map(source_v1_product_id text,raw_size_value text,size_scale text,target_v2_product_id text);
    create table pos.sale_items(id bigint,line_id text,folio text,product_id text,talla text,barcode_code text);
    create table pos.sales(folio text primary key,estado text,return_expires_at date);
    create table pos.exchange_items(id bigint,line_id text,exchange_id text,lado text,product_id text,talla text,barcode_code text);
    create table pos.exchanges(id text primary key,folio text,origen_folio text);
    create table pos.returns(id text primary key,folio text,comisiones jsonb,prior_sale_state text);
    create table pos.return_commits(commit_id text primary key,payload_hash text,return_id text,folio text);
    create table pos.exchange_commits(commit_id text primary key,payload_hash text,exchange_id text,folio text);
    create table pos.clients(id text primary key);
    create table pos.sellers(id text primary key);
    create table pos.qa_metadata_calls(name text);
    create function pos.is_active_admin() returns boolean language sql as $$select true$$;
    create function pos.is_active_seller() returns boolean language sql as $$select false$$;
    create function pos.require_current_capability(text) returns void language plpgsql as $$begin
      if current_setting('qa.denied',true)='true' then raise exception 'QA_PERMISSION_DENIED' using errcode='42501'; end if;
    end$$;
    insert into pos.products values('p','v2',null,'CURRENT-BARCODE','["HISTORICAL-BARCODE"]',7);
    insert into pos.sales values('SOURCE','Pagado',null);
    insert into pos.sale_items values(1,'SOURCE-LINE','SOURCE','p','M','HISTORICAL-BARCODE');`);
  // Metadata post-processors are explicit test seams; the captured permission
  // wrappers and full commit hash/early-return authorities are executed intact.
  for (const [name, signature] of [
    ['record_exchange_commission_policy', 'jsonb'],
    ['h83_persist_exchange_ornaments', 'text,jsonb'], ['h83_persist_return_ornaments', 'text,jsonb'],
    ['h94_persist_exchange_references', 'text,jsonb'], ['h94_persist_return_references', 'text,jsonb'],
  ]) await db.exec(`create function pos.${name}(${signature}) returns void language plpgsql as $$begin
    insert into pos.qa_metadata_calls values('${name}'); end$$;`);
  for (const name of ['commit_exchange','commit_return','h133_operational_items',
    'h83_commit_exchange_delegate','h83_commit_return_delegate',
    'h94_commit_exchange_delegate','h94_commit_return_delegate',
    'h94_assert_v2_document_items','h133_commit_exchange_delegate','h133_commit_return_delegate']) {
    const definition = definitions.get(name);
    if (!definition) throw Error(`Missing captured SQL function: ${name}`);
    await db.exec(definition);
  }
  await db.exec(readFileSync(new URL('./supabase/migrations/20260905018000_pos_h142_historical_replay.sql', import.meta.url), 'utf8'));
  const baseline = (await q('select jsonb_agg(to_jsonb(p)) data from pos.products p'))[0].data;
  const sourceBefore = (await q('select jsonb_agg(to_jsonb(s)) data from pos.sale_items s'))[0].data;
  for (const type of ['return','exchange']) for (const encoding of ['raw-historical','canonical']) {
    const id = `${type}-${encoding}`, commit = `commit-${id}`;
    const header = type === 'return' ? { id, folio: 'SOURCE' }
      : { id, folio: `F-${id}`, origen_folio: 'SOURCE' };
    const returned = { line_id: `${id}-line`, source_sale_line_id: 'SOURCE-LINE',
      product_id: 'p', sku: 'SKU-M', talla: 'M', qty: 1, barcode_code: 'HISTORICAL-BARCODE' };
    const items = type === 'return' ? [{ ...returned, return_id: id }]
      : [{ ...returned, lado: 'devuelto' }, { ...returned, line_id: `${id}-deliver`, source_sale_line_id: undefined,
        lado: 'entregado', barcode_code: 'CURRENT-BARCODE' }];
    const canonical = (await q('select pos.h133_operational_items($1::jsonb,$2,$3) data',
      [JSON.stringify(items), type === 'exchange', 'SOURCE']))[0].data;
    const storedItems = encoding === 'canonical' ? canonical : items;
    const stocks = [{ product_id: 'p', talla: 'M', qty: 1 }];
    if (type === 'return') {
      await q('insert into pos.returns(id,folio) values($1,$2)', [id,'SOURCE']);
      await q(`insert into pos.return_commits values($1,md5(jsonb_build_object(
        'return',$2::jsonb,'items',$3::jsonb,'moves','[]'::jsonb,'stock_lines',$4::jsonb,
        'client_effect',null::jsonb,'seller_effects','[]'::jsonb,'legacy',false)::text),$5,$6)`,
      [commit,JSON.stringify(header),JSON.stringify(storedItems),JSON.stringify(stocks),id,'SOURCE']);
    } else {
      await q('insert into pos.exchanges values($1,$2,$3)',[id,header.folio,'SOURCE']);
      await q(`insert into pos.exchange_commits values($1,md5(jsonb_build_object(
        'exchange',$2::jsonb,'items',$3::jsonb,'moves','[]'::jsonb,'payment','null'::jsonb,
        'seller_effects','[]'::jsonb)::text),$4,$5)`,[commit,JSON.stringify(header),JSON.stringify(storedItems),id,header.folio]);
    }
    const invoke = async payload => (await q(type === 'return'
      ? `select pos.commit_return_checked($1,$2::jsonb,$3::jsonb,'[]',$4::jsonb,null,'[]',false) data`
      : `select pos.commit_exchange_checked($1,$2::jsonb,$3::jsonb,'[]',null,'[]') data`,
    type === 'return' ? [commit,JSON.stringify(header),JSON.stringify(payload),JSON.stringify(stocks)]
      : [commit,JSON.stringify(header),JSON.stringify(payload)]))[0].data;
    await db.exec('truncate pos.qa_metadata_calls');
    const first = await invoke(items), second = await invoke(items);
    check(`${type}/${encoding}: original payload replays idempotently twice`,
      first.ok && first.idempotent && second.ok && second.idempotent, { first, second });
    const calls = await q('select name,count(*)::int count from pos.qa_metadata_calls group by name');
    check(`${type}/${encoding}: mismatch probe has no metadata side effects`, calls.every(row => row.count === 2), calls);
    const changed = structuredClone(items); changed[0].qty = 2;
    await db.exec('truncate pos.qa_metadata_calls');
    let mismatch; try { mismatch = await invoke(changed); } catch (error) { mismatch = { error: error.message }; }
    check(`${type}/${encoding}: changed payload rejected`, mismatch.ok !== true && mismatch.error === 'commit_mismatch', mismatch);
    check(`${type}/${encoding}: rejected payload has no metadata writes`, (await q('select count(*)::int count from pos.qa_metadata_calls'))[0].count === 0);
    await db.exec("set qa.denied='true'"); let denied;
    try { await invoke(items); } catch (error) { denied = error.code; }
    await db.exec("set qa.denied='false'");
    check(`${type}/${encoding}: historical replay retains capability guard`, denied === '42501', { denied });
  }
  check('all replay cases preserve stock/product snapshot', JSON.stringify(baseline) === JSON.stringify((await q('select jsonb_agg(to_jsonb(p)) data from pos.products p'))[0].data));
  check('all replay cases preserve original sale line snapshot', JSON.stringify(sourceBefore) === JSON.stringify((await q('select jsonb_agg(to_jsonb(s)) data from pos.sale_items s'))[0].data));
} finally { await db.close(); }
console.log(`H142 historical idempotency: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
