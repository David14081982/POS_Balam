// H164: real Supabase, final built artifact, three independent browser contexts.
// Opt-in only. One scenario per distinct behavior; no queue replay or business cleanup.
// QA history is retained with exact fixture IDs. Provisioning credentials stay in Node.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright-core';

if (process.env.BALAM_ONLINE_LIVE !== '1') {
  console.error('NOT CERTIFIED: set BALAM_ONLINE_LIVE=1 after remote migration review and final artifact build.');
  process.exit(2);
}
const source = readFileSync('balam/store.jsx', 'utf8');
const url = source.match(/const SUPABASE_URL = '([^']+)'/)[1];
const publishable = source.match(/const SUPABASE_KEY = '([^']+)'/)[1];
const build = source.match(/const BUILD = '([^']+)'/)[1];
const project = new URL(url).hostname.split('.')[0];
const resumeDir = process.env.BALAM_LIVE_RESUME_DIR ? resolve(process.env.BALAM_LIVE_RESUME_DIR) : null;
const priorFixtures = resumeDir ? JSON.parse(readFileSync(join(resumeDir,'fixtures.json'),'utf8')) : null;
const run = priorFixtures?.run || randomUUID(), prefix = 'qa-h164-' + run;
const out = resumeDir || process.env.BALAM_TEST_OUTPUT || join(tmpdir(), prefix);
mkdirSync(out, { recursive: true });
const artifactPath = resolve(process.env.BALAM_VERIFIED_HTML || 'index.html');
const html = readFileSync(artifactPath);
assert.ok(html.toString().includes(build), 'Build artifact must contain current online-only source build');
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : stable(value)).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const result = resumeDir ? JSON.parse(readFileSync(join(out,'matrix.json'),'utf8')) : { run, project, build, artifactPath, artifactSha256: digest(html), certifierSha256: digest(readFileSync(import.meta.filename)),
  startedAt: new Date().toISOString(), profiles: 3, certified: false, cases: [],
  method: 'Real HTTPS RPC/authority; isolated Chromium A/B/C; failures abort real transport only; no mocked authority or service_role in browser',
  scope: 'Domain APIs on the final browser artifact plus rendered offline/recovery screen. Visual workflows have separate UI regression evidence.' };
assert.equal(result.run,run);assert.equal(result.project,project);assert.equal(priorFixtures?.prefix||prefix,prefix);
if(resumeDir){assert.equal(result.certified,false,'A completed matrix must not execute again');assert.equal(result.artifactSha256,digest(html),'Resume requires the same final artifact; review changed cases before authorizing a new artifact matrix');}
result.sessions ||= [];result.sessions.push({startedAt:new Date().toISOString(),resume:!!resumeDir,artifactSha256:digest(html),certifierSha256:digest(readFileSync(import.meta.filename))});delete result.failure;
const fixtures = priorFixtures || { run, prefix, products: Array.from({ length: 7 }, () => randomUUID()), sellers: [], sales: [], returns: [], exchanges: [],
  loans: [], clients: [], promotions: [], operationIds: [], requestIds: [], installations: ['A','B','C'].map(name => prefix + '-' + name), configKeys: [] };
fixtures.checkpoints ||= {};
fixtures.createdAccountIds ||= [];
const save = () => { writeFileSync(join(out, 'matrix.json'), JSON.stringify(result, null, 2)); writeFileSync(join(out, 'fixtures.json'), JSON.stringify(fixtures, null, 2)); };
function remember(kind, value) { if (!fixtures[kind].includes(value)) fixtures[kind].push(value); save(); return value; }
const op = () => remember('operationIds', randomUUID());
function observeCommand(command) {
  if (!command || typeof command !== 'object') return;
  for (const child of command.commands || []) observeCommand(child);
  if (command.type === 'sale' && command.header?.folio) remember('sales', command.header.folio);
  if (command.type === 'return' && command.header?.id) remember('returns', command.header.id);
  if (command.type === 'exchange' && command.header?.id) remember('exchanges', command.header.id);
  if (command.type === 'loanOperation' && command.loan?.id) remember('loans', command.loan.id);
  const collection = {clients:'clients',promotions:'promotions'}[command.kind];
  if (collection) for (const row of command.rows || []) if (row.id) remember(collection,row.id);
}
save();
const keys = JSON.parse(execFileSync(process.execPath, [resolve('node_modules/supabase/dist/supabase.js'), 'projects', 'api-keys', '--project-ref', project, '--output', 'json'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }));
const serviceKey = (Array.isArray(keys) ? keys : keys.rows).find(row => row.name === 'service_role')?.api_key;
assert.ok(serviceKey, 'Authenticated server provisioning key required');
const boundedFetch = (input, options = {}) => fetch(input, { ...options, signal: options.signal
  ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch } };
const admin = createClient(url, serviceKey, options), db = admin.schema('pos');
const check = response => { if (response.error) throw Error(response.error.message); return response.data; };
const tables = ['products','clients','sellers','promotions','sales','sale_items','returns','return_items','exchanges','exchange_items','sale_payments','loan_documents','liquidations','commission_adjustments','movements','lookup','settings','stock_reservations'];
const keyFor = (table, row) => String(table === 'sales' ? row.folio : table === 'settings' ? row.key : ['commission_adjustments','stock_reservations'].includes(table) ? row.operation_id : row.id);
async function rawRows(table) {
  const rows = [], order = table === 'sales' ? 'folio' : table === 'settings' ? 'key' : ['commission_adjustments','stock_reservations'].includes(table) ? 'operation_id' : 'id';
  for (let start = 0; ; start += 1000) { const page = check(await db.from(table).select('*').order(order).range(start, start + 999)); rows.push(...page); if (page.length < 1000) return rows; }
}
const cleanExisting = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['updated_at','sync_version','sync_base_version','sync_device_id'].includes(key)));
let baseline, browser, server, userId, address, currentCase=null, currentStep=null;
const terminals = [];
async function once(label, action, recover) {
  const key=(currentCase||'bootstrap')+' / '+label,existing=fixtures.checkpoints[key];
  if(existing?.complete)return existing.value;
  if(existing?.requestIds?.length){
    const receipts=check(await db.from('online_requests').select('request_id,state,response').in('request_id',existing.requestIds));
    if(receipts.some(row=>row.state==='confirmed')){
      if(recover){existing.value=await recover(receipts);existing.complete=true;existing.recoveredFromAuthority=true;save();return existing.value;}
      throw Error('QA_RESUME_RECONCILE_STEP: '+key+'; confirmed request IDs '+receipts.filter(row=>row.state==='confirmed').map(row=>row.request_id).join(',')+'. No operation was repeated. Recover this exact checkpoint from authority before continuing.');
    }
  }
  const checkpoint=existing||{startedAt:new Date().toISOString(),requestIds:[]};fixtures.checkpoints[key]=checkpoint;save();const previous=currentStep;currentStep=key;
  try{const value=await action();checkpoint.value=value??null;checkpoint.complete=true;checkpoint.completedAt=new Date().toISOString();save();return value;}
  finally{currentStep=previous;}
}
async function verify(name, action) {
  if(result.cases.some(row=>row.name===name&&row.pass)){console.log('SKIP prior PASS '+name);return;}
  currentCase=name;
  console.log('START ' + name); const started = Date.now(); delete result.lastRace; save();
  try { const evidence = await action(); result.cases.push({ name, pass: true, elapsedMs: Date.now() - started, evidence, ...(result.lastRace ? {concurrency:result.lastRace} : {}) }); console.log('PASS ' + name); }
  catch (error) { result.cases.push({ name, pass: false, elapsedMs: Date.now() - started, error: error.message }); console.log('FAIL ' + name + ': ' + error.message); throw error; }
  finally { currentCase=null;save(); }
}
async function ready(terminal) { await terminal.page.waitForFunction(() => window.STORE?.syncStatus().ready === true, null, { timeout: 60000 }); }
async function storageState(terminal) {
  return terminal.page.evaluate(async () => {
    const business = Object.keys(localStorage).filter(key => /^balam_pos_(products|sellers|clients|sales|moves|promos|liq|returns|payments|exchanges|loans|commission|periodo|folio|sale_commit|layaway)/.test(key) || /^balam_sync_/.test(key) || /^balam_(?:config|cfg)_v\d+/.test(key));
    const receipts = Object.keys(localStorage).filter(key => key.startsWith('balam_online_request_v1:')).map(key => JSON.parse(localStorage.getItem(key)));
    const databaseNames = indexedDB.databases ? (await indexedDB.databases()).map(row => row.name) : [];
    const commercial = value => {
      if (!value || typeof value !== 'object') return false;
      if (Array.isArray(value)) return value.some(commercial);
      if (Object.keys(value).some(key => /^(stock|stock_quantity|stockQuantity|sales|clients|payments|movements|lineas|sale_items|comisionAcum|products|queue|pendingOps)$/.test(key))) return true;
      return Object.values(value).some(commercial);
    };
    const databases = [];
    for (const name of databaseNames) {
      const database = await new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      try { for (const store of database.objectStoreNames) {
        const values=await new Promise((resolve,reject)=>{const request=database.transaction(store,'readonly').objectStore(store).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        databases.push({name,store,rows:values.length,commercialRows:values.filter(value=>{if(typeof value==='string'){try{return commercial(JSON.parse(value));}catch{return false;}}return commercial(value);}).length});
      }} finally {database.close();}
    }
    const requests = [];
    for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) if (/supabase\.co\/(rest|functions)\//.test(request.url)) requests.push(request.url);
    const queueKeys=Object.keys(localStorage).filter(key=>/durable_queue|pending_ops|pendingOps|commercial_queue|sale_commit_journal|layaway.*journal/.test(key));
    return { business, receipts, databases, businessCacheEntries: requests.length, queueKeys, legacyPendingApi:typeof window.STORE.pending, status: window.STORE.syncStatus() };
  });
}
const specs = [
  ['products','products','id',[['nombre','nombre'],['precio','precio'],['stockQuantity','stock_quantity'],['sizeCode','size_code'],['barcodeCode','barcode_code'],['referenceFamilyId','reference_family_id'],['barcodeAliases','barcode_aliases']]],
  ['clients','clients','id',[['nombre','nombre'],['total','total'],['compras','compras']]],
  ['sellers','sellers','id',[['nombre','nombre'],['active','active'],['comisionAcum','comision_acum'],['ventasMes','ventas_mes'],['ventasNum','ventas_num']]],
  ['promos','promotions','id',[['nombre','nombre'],['valor','valor'],['pausado','pausado'],['scope','scope']]],
  ['sales','sales','folio',[['total','total'],['subtotal','subtotal'],['iva','iva'],['estado','estado'],['saldo','saldo'],['anticipo','anticipo'],['_operationId','operation_id'],['_stockReserved','stock_reserved']]],
  ['payments','sale_payments','id',[['folio','folio'],['monto','monto'],['efectivo','efectivo'],['tarjeta','tarjeta'],['transferencia','transferencia'],['otro','otro']]],
  ['returns','returns','id',[['folio','folio'],['total','total']]],
  ['exchanges','exchanges','id',[['folio','folio'],['diferencia','diferencia'],['origenFolio','origen_folio'],['valorReconocido','valor_reconocido'],['valorEntregado','valor_entregado']]],
  ['liquidations','liquidations','id',[['monto','monto'],['sellerId','seller_id'],['tipo','tipo']]],
  ['movements','movements','id',[['tipo','tipo'],['cant','cant'],['sku','sku'],['ref','ref'],['productId','product_id'],['operationId','operation_id']]],
];
async function converge(active = terminals) {
  await Promise.all(active.map(terminal => terminal.page.evaluate(() => window.STORE.refresh())));
  const remote = Object.fromEntries(await Promise.all(tables.map(async table => [table, await rawRows(table)])));
  const reserved = new Set(remote.stock_reservations.map(row => String(row.operation_id)));
  remote.sales = remote.sales.map(row=>({...row,stock_reserved:reserved.has(String(row.operation_id))}));
  const evidence = [];
  for (const [local, table, key, fields] of specs) {
    const pick = (row, side) => Object.fromEntries([[key,key], ...fields].map(([left,right]) => [left, row[side ? right : left] == null || row[side ? right : left] === '' ? null : row[side ? right : left]]));
    const order = rows => rows.sort((a,b) => String(a[key]).localeCompare(String(b[key])));
    const expected = order(remote[table].filter(row => !row.deleted_at).map(row => pick(row, true)));
    for (const terminal of active) {
      const actual = order((await terminal.page.evaluate(local => window.DATA[local], local)).map(row => pick(row, false)));
      assert.deepEqual(actual, expected, terminal.name + ' differs from Supabase: ' + table);
    }
    evidence.push({ domain: local, fields:[key,...fields.map(([field])=>field)], rows: expected.length, sha256: digest(expected), terminals: active.map(terminal => terminal.name) });
  }
  const stockProjection = (row, remoteSide) => ({ id:row.id, stock:((remoteSide ? row.record_model : row.recordModel)==='v2'
    ? [{talla:remoteSide?row.size_code:row.sizeCode,escala:remoteSide?row.size_scale:row.sizeScale,stock:remoteSide?row.stock_quantity:row.stockQuantity}]
    : row.stock||[]).filter(item=>Number(item.stock)!==0).map(item=>({talla:String(item.talla),escala:item.escala||'L',stock:Number(item.stock)}))
      .sort((a,b)=>(a.escala+':'+a.talla).localeCompare(b.escala+':'+b.talla)) });
  const expectedStocks=remote.products.filter(row=>!row.deleted_at).map(row=>stockProjection(row,true)).sort((a,b)=>a.id.localeCompare(b.id));
  for(const terminal of active){const actual=(await terminal.page.evaluate(()=>window.DATA.products)).map(row=>stockProjection(row,false)).sort((a,b)=>a.id.localeCompare(b.id));
    assert.deepEqual(actual,expectedStocks,terminal.name+' V1/V2 stock differs from authoritative quantity');}
  evidence.push({domain:'stock V1/V2',rows:expectedStocks.length,sha256:digest(expectedStocks)});
  for (const [local,table,parent] of [['sales','sale_items','folio'],['returns','return_items','return_id'],['exchanges','exchange_items','exchange_id']]) {
    const foreignIds = new Set(fixtures[local]);
    const children = remote[table].filter(row => foreignIds.has(row[parent]));
    for (const terminal of active) {
      const docs = await terminal.page.evaluate(({local,ids}) => window.DATA[local].filter(row => ids.includes(row.folio) || ids.includes(row.id)), {local,ids:[...foreignIds]});
      for (const doc of docs) {
        const rows = children.filter(row => row[parent] === (local === 'sales' ? doc.folio : doc.id));
        assert.equal(doc.lineas.length, rows.length, local + ' child count');
        for (const line of doc.lineas) {
          const row = rows.find(row => row.line_id === line.lineId);
          assert.ok(row, table + ' historical line identity');
          assert.equal(line.productId, row.product_id); assert.equal(Number(line.qty), Number(row.qty));
          assert.equal(Number(line.precio), Number(row.precio)); assert.equal(line.barcodeCode ?? null, row.barcode_code ?? null);
        }
      }
    }
    evidence.push({ domain: table, rows: children.length, sha256: digest(children) });
  }
  for (const terminal of active) {
    const loans = await terminal.page.evaluate(() => window.DATA.loans);
    const expected = remote.loan_documents.filter(row => !row.deleted_at);
    assert.equal(loans.length, expected.length);
    for (const row of expected) {
      const loan = loans.find(doc => doc.id === row.id); assert.ok(loan); assert.equal(loan._loanVersion, Number(row.version));
      for (const key of Object.keys(row.document).filter(key => !key.startsWith('_'))) assert.deepEqual(loan[key], row.document[key], terminal.name + ' loan ' + key);
    }
    const adjustments = await terminal.page.evaluate(() => window.DATA.commissionAdjustments.map(row => ({ id: row.operationId, total: row.totales.comision })).sort((a,b) => a.id.localeCompare(b.id)));
    assert.deepEqual(adjustments, remote.commission_adjustments.map(row => ({ id: row.operation_id, total: Number(row.total) })).sort((a,b) => a.id.localeCompare(b.id)));
    const storage = await storageState(terminal);
    assert.deepEqual(storage.business, []); assert.equal(storage.businessCacheEntries, 0);assert.deepEqual(storage.queueKeys,[]);assert.equal(storage.legacyPendingApi,'undefined');
    assert.equal(storage.databases.filter(row=>row.store==='durable_queue').reduce((sum,row)=>sum+row.rows,0),0);
    assert.equal(storage.databases.reduce((sum,row)=>sum+row.commercialRows,0),0,'IndexedDB has no commercial rows');
    assert.deepEqual(storage.receipts, [], 'only unresolved technical references may remain');
    assert.equal(storage.status.ready, true);
  }
  return evidence;
}
async function race(...args){
  const checkpoint=await once('Concurrent request outcomes',()=>performRace(...args));
  assert.equal(checkpoint.arrived,2,'both requests must reach the real server boundary');
  const receipts=check(await db.from('online_requests').select('request_id,state,response').in('request_id',checkpoint.requestIds));
  assert.equal(receipts.length,2,'Both race attempts have authoritative receipts');
  assert.equal(receipts.filter(row=>row.state==='confirmed'&&row.response?.ok===true).length,1,'One authoritative commit');
  const rejected=receipts.find(row=>row.state==='rejected'&&row.response?.ok===false);assert.ok(rejected,'Loser was authoritatively rejected, not a network failure');
  assert.match(JSON.stringify(rejected.response.error||{}),/VERSION_CONFLICT|QUOTE_CHANGED|INSUFFICIENT|STOCK|quantity|QUANTITY|already_returned|loan_version|PRODUCT_NOT_FOUND|ENTITY_NOT_FOUND|DELETED|CONFLICT/i,'Expected concurrency guard');
  result.lastRace={requestIds:checkpoint.requestIds,rejection:rejected.response.error};return checkpoint.outcomes;
}
async function performRace(first, second, actionFirst, actionSecond, predicate) {
  const pattern = url + '/rest/v1/rpc/execute_online_command';
  let arrived = 0, release; const requestIds = [];
  const gate = new Promise(resolve => { release = resolve; });
  const timeout = setTimeout(() => release(), 45000);
  const intercept = async route => {
    if (!predicate(route.request().postDataJSON()?.p_command)) return route.continue();
    requestIds.push(route.request().postDataJSON().p_request_id);
    arrived++; if (arrived === 2) release(); await gate; return route.continue();
  };
  await first.context.route(pattern, intercept); await second.context.route(pattern, intercept);
  try {
    const outcomes=await Promise.allSettled([actionFirst(),actionSecond()]);
    return {arrived,requestIds,outcomes:outcomes.map(row=>row.status==='rejected'?{status:'rejected',reason:{message:row.reason?.message,code:row.reason?.code}}:row)};
  }
  finally { clearTimeout(timeout); release(); await first.context.unroute(pattern, intercept); await second.context.unroute(pattern, intercept); }
}
function oneWinner(outcomes) {
  const success = outcomes.filter(outcome => outcome.status === 'fulfilled' && outcome.value?.ok !== false);
  assert.equal(success.length, 1, 'server must confirm exactly one competing mutation');
  return success[0].value;
}
async function sell(terminal, id, { qty = 1, layaway = false, operationId = op(), discount = false } = {}) {
  const sale = await terminal.page.evaluate(async ({id,qty,layaway,operationId,sellerId,clientId,discount}) => {
    const D = window.DATA, p = D.products.find(row => row.id === id);
    return D.recordSale({ operationId, ticket: [{ p, talla: p.sizeCode, qty }], sellerIds: [sellerId], client: D.clients.find(row => row.id === clientId),
      metodo: layaway ? 'Apartado' : 'Efectivo', estado: layaway ? 'Apartado' : 'Pagado', itemCount: qty,
      ...(layaway ? { anticipo: 10, pagoEfectivo: 10, pagoOtro: 0 } : {}),
      ...(discount ? { additionalDiscounts: [{ id: 'qa-discount', origin: 'Otro', reason: 'QA H164', benefitType: 'fixed', scope: 'ticket', value: 1 }] } : {}) });
  }, { id, qty, layaway, operationId, sellerId: terminal.sellerId, clientId: fixtures.clients[0], discount });
  remember('sales', sale.folio); return sale;
}
const stock = async id => Number(check(await db.from('products').select('stock_quantity').eq('id', id).single()).stock_quantity);
try {
  const manifest = check(await db.from('system_manifest').select('*').eq('singleton', true).single());
  assert.equal(manifest.system_mode, 'preproduction', 'Live fixtures require explicitly configured preproduction');
  result.manifest = manifest;
  check(await db.from('online_requests').select('request_id').limit(1)); // Additive gateway migrations must already exist.
  if(resumeDir){
    const stored=JSON.parse(readFileSync(join(out,'baseline.json'),'utf8'));assert.equal(stored.run,run);assert.equal(stored.project,project);
    baseline=Object.fromEntries(tables.map(table=>[table,new Map(stored.tables[table])]));
  }else{
    baseline=Object.fromEntries(await Promise.all(tables.map(async table=>[table,new Map((await rawRows(table)).map(row=>[keyFor(table,row),digest(cleanExisting(row))]))])));
    writeFileSync(join(out,'baseline.json'),JSON.stringify({run,project,createdAt:new Date().toISOString(),tables:Object.fromEntries(tables.map(table=>[table,[...baseline[table]]]))},null,2));
  }
  const email = fixtures.email || prefix + '@example.test', password = randomBytes(32).toString('base64url');
  if(fixtures.userId){
    userId=fixtures.userId;const existing=check(await admin.auth.admin.getUserById(userId)).user;
    assert.equal(existing.email,email);assert.equal(existing.user_metadata?.balam_online_test,run,'Only the exact retained QA account may rotate its password');
    check(await admin.auth.admin.updateUserById(userId,{password,ban_duration:'none'}));
  }else{
    userId = check(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { balam_online_test: run } })).user.id;
    fixtures.userId = userId; fixtures.email = email; save();
  }
  const adminId = remember('sellers', prefix + '-admin');
  const sellerIds = ['A','B','C'].map(name => remember('sellers', prefix + '-seller-' + name));
  const caseNames=[...readFileSync(import.meta.filename,'utf8').matchAll(/await verify\('([^']+)'/g)].map(match=>match[1]);
  if(caseNames.every(name=>result.cases.some(row=>row.name===name&&row.pass))){result.certified=true;throw Object.assign(Error('Completed matrix: finish exact QA account retirement only'),{completedMatrix:true});}
  const existingDevices=check(await db.from('sync_devices').select('device_id,status,metadata').in('device_id',fixtures.installations));
  const retiredIds=new Set(existingDevices.filter(row=>row.status==='revoked').map(row=>row.device_id));
  if(retiredIds.size)assert.ok(caseNames.filter(name=>!name.startsWith('Equipment history')).every(name=>result.cases.some(row=>row.name===name&&row.pass)),'A retired QA installation may resume only final equipment verification');
  await once('Provision exact QA sellers',async()=>{
    const intended=[{id:adminId,nombre:prefix+' Admin',email,role:'admin',active:true,comision_pct:0,sync_base_version:0},...sellerIds.map((id,index)=>({id,nombre:prefix+' '+index,role:'vendedor',active:true,comision_pct:5,commission_override_pct:5,commission_policy_version:1,sync_base_version:0}))];
    const present=check(await db.from('sellers').select('id,nombre').in('id',fixtures.sellers));for(const row of present)assert.ok(row.nombre.startsWith(prefix));
    const missing=intended.filter(row=>!present.some(existing=>existing.id===row.id));if(missing.length)check(await db.from('sellers').insert(missing));return true;
  });
  await once('Provision exact QA role',async()=>{
    const present=check(await db.from('user_permission_role_assignments').select('*').eq('user_id',userId).eq('role_code','admin'));
    if(!present.length)check(await db.from('user_permission_role_assignments').insert({user_id:userId,role_code:'admin',active:true}));return true;
  });
  server = http.createServer((request,response) => { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); response.end(html); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); address = 'http://127.0.0.1:' + server.address().port + '/';
  browser = await chromium.launch({ ...(process.env.BALAM_CHROME_EXECUTABLE ? { executablePath: process.env.BALAM_CHROME_EXECUTABLE } : { channel: 'chrome' }), headless: true });
  for (const [index,name] of ['A','B','C'].entries()) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(), errors = [];
    const terminal = { name, context, page, errors, sellerId: sellerIds[index] }; terminals.push(terminal);
    page.setDefaultTimeout(60000); page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (request.headers().apikey === serviceKey) errors.push('Provisioning key crossed the browser boundary');
      if (!request.url().includes('/rpc/execute_online_command')) return;
      const body = request.postDataJSON(); if (body?.p_request_id){remember('requestIds',body.p_request_id);if(currentStep){const step=fixtures.checkpoints[currentStep];if(!step.requestIds.includes(body.p_request_id))step.requestIds.push(body.p_request_id);save();}}
      observeCommand(body?.p_command);
    });
    await context.addInitScript(({device}) => { if (location.hostname === '127.0.0.1') localStorage.setItem('balam_device_id', device); }, { device: fixtures.installations[index] });
    await page.goto(address, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.AUTH?.isReady() && window.STORE);
    if(retiredIds.has(fixtures.installations[index])){terminal.retired=true;continue;}
    const login = await page.evaluate(({email,password}) => window.AUTH.login(email,password), {email,password});
    assert.equal(login.ok, true, 'independent authenticated login ' + name); await ready(terminal);
    // Realtime remains disabled for the entire matrix: refresh must recover every domain.
    await page.evaluate(async () => (await window.STORE.ensureClient()).removeAllChannels());
  }
  const [A,B,C] = terminals, [sourceId,targetId,lastId,deleteId,editId,reclassId,reclassTargetId] = fixtures.products;
  await verify('A/B/C bootstrap and Realtime disabled', () => converge());
  await verify('Create V2 products with barcode V3', async () => {
    await once('Create seven exact references',()=>A.page.evaluate(async ({ids,prefix}) => {
      const D=window.DATA,C=window.CONFIG,meta=C.allCatalogMeta(),modelKind=C.modeloKind();
      const first=kind=>{const item=C.list(kind)[0];if(!item)throw Error('Active remote catalog required: '+kind);return item.code;};
      const category=C.sizeCategories().find(item=>item.scale&&C.list(item.id).length);
      if(!category)throw Error('An active authoritative size category is required');
      const base={cat:first('category'),manga:first('sleeve'),tela:first('fabric'),color:first('color'),cuello:first('neck'),orn:first('ornament'),sizeCategoryId:category.id,sizeScale:category.scale,sizeCode:first(category.id),attrs:{__sizeCategoryId:category.id},ornamentColorCodes:[]};
      for(const [kind,definition] of Object.entries(meta))if(definition.custom&&definition.required&&kind!==modelKind)base.attrs[kind]=first(kind);
      if(D.ornamentColorMode(base)==='required')base.ornamentColorCodes=[first('ornament_color')];
      const prepared = [];
      for (const [index,id] of ids.entries()) {
        const candidate=D.createReference({...base,id,referenceFamilyId:id,modelo:prefix+'-'+index,nombre:prefix+' '+index,imagen:null,
          stockQuantity:index===2?1:index===3?0:12,precio:index===1?232:116,costo:25,barcodeAliases:[],physicalIdentityLocked:false,_syncVersion:0,_deletedAt:null},D.products.concat(prepared));
        prepared.push(candidate);
      }
      await D.saveProductRows(prepared);
    }, { ids: fixtures.products, prefix }));
    return converge();
  });
  await verify('Client and customer profile', async () => {
    const client = await once('Create exact client',()=>A.page.evaluate(prefix => window.DATA.addClient({nombre:prefix,tel:prefix,notas:'QA H164 retained test history'}), prefix));
    remember('clients', client.id); await converge();
    await once('Edit client address',()=>B.page.evaluate(id => window.DATA.updateClient(id,{direccion:'QA H164'}), client.id));
    return converge();
  });
  await verify('Concurrent product edit rejects stale version', async () => {
    const edit = (terminal,price) => terminal.page.evaluate(({id,price}) => window.DATA.saveProductRows([window.DATA.updateReference({id,precio:price})]), {id:editId,price});
    oneWinner(await race(A,B,() => edit(A,117),() => edit(B,118), command => command?.kind === 'products'));
    assert.ok([117,118].includes(Number(check(await db.from('products').select('precio').eq('id',editId).single()).precio)));
    return converge();
  });
  await verify('Delete while another terminal uses product', async () => {
    const outcomes = await race(A,B,
      () => A.page.evaluate(id => window.DATA.removeProductScope({scope:'reference',productIds:[id]}),deleteId),
      () => B.page.evaluate(id => window.DATA.saveProductRows([window.DATA.updateReference({id,nombre:'QA stale edit'})]),deleteId),
      command => command?.kind === 'products' || command?.type === 'productDeleteScope');
    oneWinner(outcomes); await converge();
    const row = check(await db.from('products').select('*').eq('id',deleteId).single());
    if (!row.deleted_at) { const removed = await once('Retire surviving own reference',()=>A.page.evaluate(id => window.DATA.removeProductScope({scope:'reference',productIds:[id]}),deleteId)); assert.equal(removed.ok,true); }
    return converge();
  });
  await verify('Stock movement / reference reclassification', async () => {
    const before = await once('Stock before reclassification',async()=>[await stock(reclassId),await stock(reclassTargetId)]);
    const moved = await once('Reclassify one unit',()=>A.page.evaluate(args => window.DATA.reclassifyReference(args), { sourceProductId:reclassId,targetProductId:reclassTargetId,quantity:1,operationId:op(),actor:prefix,reason:'QA H164' }));
    assert.equal(moved.ok,true); assert.equal(await stock(reclassId),before[0]-1); assert.equal(await stock(reclassTargetId),before[1]+1);
    return converge();
  });
  await verify('Promotion and isolated commercial configuration', async () => {
    await once('Create paused exact promotion',()=>{const promoId=remember('promotions','promo-'+op());return A.page.evaluate(({id,prefix}) => window.DATA.addPromo({id,nombre:prefix,tipo:'pct',valor:5,pausado:true,scope:{}}), {id:promoId,prefix});});
    const configKey = remember('configKeys','qa.h164.'+run);
    await once('Set exact QA setting',()=>A.page.evaluate(({key,value}) => window.CONFIG.setSetting(key,value), {key:configKey,value:prefix}));
    await converge();
    for (const terminal of terminals) assert.equal(await terminal.page.evaluate(key => window.CONFIG.get(key),configKey),prefix);
    return { configurationKey:configKey, domains:await converge() };
  });
  await verify('Auth account gateway creates one exact QA account and profile',async()=>{
    fixtures.accountRequestId ||= op();save();
    const requestId=fixtures.accountRequestId,email=prefix+'-account@example.test';
    const value=await once('Create exact QA access account',async()=>{
      const receipt=check(await db.from('online_account_requests').select('*').eq('request_id',requestId).maybeSingle());
      if(receipt?.state==='completed')return {ok:true,body:receipt.result};
      if(receipt)throw Error('QA_RESUME_ACCOUNT_RECEIPT: '+requestId+' is '+receipt.state+'. Resolve this exact server receipt; its password was not persisted and no new account request will be sent.');
      return A.page.evaluate(payload=>window.STORE.callFunction('admin-users',payload),{requestId,action:'create',email,password:randomBytes(32).toString('base64url'),nombre:prefix+' Account',role:'vendedor',avatar:'',commissionOverridePct:0,sellerLevelCode:null,metaMes:0});
    });
    assert.equal(value.ok,true);const id=value.body?.id;assert.ok(id);remember('createdAccountIds',id);remember('sellers',id);
    const account=check(await admin.auth.admin.getUserById(id)).user;assert.equal(account.email,email);assert.equal(account.app_metadata?.balam_account_request_id,requestId);
    const receipt=check(await db.from('online_account_requests').select('*').eq('request_id',requestId).single());
    assert.equal(receipt.state,'completed');assert.equal(receipt.actor_id,userId);assert.equal(receipt.target_user_id,id);
    const profile=check(await db.from('sellers').select('*').eq('id',id).single());assert.equal(profile.email,email);assert.equal(profile.role,'vendedor');assert.equal(profile.active,true);
    return {requestId,authUserId:id,receiptState:receipt.state,emailsSent:0,domains:await converge()};
  });
  await verify('Permission mutation affects only the exact QA account',async()=>{
    const id=fixtures.createdAccountIds[0];assert.ok(id);
    const changed=await once('Apply one QA screen override',()=>A.page.evaluate(async({id,requestId})=>{
      const screens=window.SCREENS.all().filter(screen=>screen.enabled!==false),keys=screens.filter(screen=>!screens.some(child=>child.parentId===screen.id)).map(screen=>screen.id);
      const client=await window.STORE.ensureClient();
      const before=await client.schema('pos').rpc('admin_user_permission_editor_snapshot',{p_target_user_id:id,p_screen_keys:keys});if(before.error)throw before.error;
      const screen=keys.find(key=>key.includes('reporte'))||keys[0];if(!screen)throw Error('Authoritative screen registry required');
      const receipt=await window.CORE.invokeSync('execute',{type:'permissions',requestId,rpc:'admin_apply_user_screen_permissions_checked',args:{p_target_user_id:id,p_role_code:before.data.base_role,p_overrides:{[screen]:'deny'},p_expected_version:before.data.permission_version,p_screen_keys:keys}});
      return {receipt,screen,keys,previousVersion:before.data.permission_version};
    },{id,requestId:op()}));
    assert.equal(changed.receipt.ok,true);
    const snapshot=await A.page.evaluate(async({id,keys})=>{const client=await window.STORE.ensureClient();const response=await client.schema('pos').rpc('admin_user_permission_editor_snapshot',{p_target_user_id:id,p_screen_keys:keys});if(response.error)throw response.error;return response.data;},{id,keys:changed.keys});
    assert.equal(snapshot.overrides[changed.screen],'deny');assert.notEqual(snapshot.permission_version,changed.previousVersion);
    return {targetUserId:id,screen:changed.screen,permissionVersion:snapshot.permission_version,domains:await converge()};
  });
  let sold=fixtures.primarySaleFolio?check(await db.from('sales').select('*').eq('folio',fixtures.primarySaleFolio).single()):null;
  await verify('Sale / payment / commission / lost response after COMMIT', async () => {
    const transport=await once('One sale with response loss',async()=>{
    const operationId = op(), pattern = url + '/rest/v1/rpc/execute_online_command', resolvePattern = url + '/rest/v1/rpc/resolve_online_request';
    const before = await stock(sourceId); let committed = 0, resolverCalls = 0;
    const lose = async route => { if (route.request().postDataJSON()?.p_command?.type !== 'sale') return route.continue(); committed++; await route.fetch(); await route.abort('failed'); };
    const holdResolve = async route => { resolverCalls++; await route.abort('failed'); };
    await A.context.route(pattern,lose); await A.context.route(resolvePattern,holdResolve);
    let finished=false;
    const purchase=sell(A,sourceId,{qty:3,operationId,discount:true}).then(value=>{finished=true;return {value};},error=>{finished=true;return {error};});
    try {
      await A.page.waitForFunction(()=>window.STORE.syncStatus().message==='Estamos confirmando la operación. No la repitas.');
      assert.equal(finished,false,'Original confirmation remains unresolved while outcome cannot be read');
      await A.page.getByText('Estamos confirmando la operación. No la repitas.',{exact:true}).waitFor();
    }
    finally { await A.context.unroute(pattern,lose); await A.context.unroute(resolvePattern,holdResolve); }
    await A.page.evaluate(() => window.STORE.refresh()); await ready(A);
    const answer=await purchase;
    if(answer.value?.folio){fixtures.primarySaleFolio=answer.value.folio;save();}
    return {operationId,before,committed,resolverCalls,answer:{value:answer.value,error:answer.error?.message}};
    });
    const {operationId,before,committed,resolverCalls,answer}=transport;
    assert.equal(committed,1); assert.ok(resolverCalls>=1); assert.equal(await stock(sourceId),before-3);
    assert.ifError(answer.error); assert.ok(answer.value?.folio,'Original awaiting caller receives its confirmed operation');
    const rows = check(await db.from('sales').select('*').eq('operation_id',operationId)); assert.equal(rows.length,1);
    remember('sales',rows[0].folio); sold = rows[0];
    assert.equal(check(await db.from('online_requests').select('state').eq('request_id',operationId).single()).state,'confirmed');
    assert.ok(Number(sold.total)>0); assert.ok(Math.abs(Number(sold.total)-Number(sold.subtotal)-Number(sold.iva))<0.009);
    const payments = check(await db.from('sale_payments').select('*').eq('folio',sold.folio)); assert.equal(payments.length,1);
    assert.equal(Number(payments[0].monto),Number(sold.total));
    return { commercialRequests:committed,resolverCalls,stockDelta:-3,domains:await converge() };
  });
  await verify('Two terminals sell the last unit', async () => {
    const outcomes = await race(A,B,() => sell(A,lastId),() => sell(B,lastId),command => command?.type === 'sale');
    oneWinner(outcomes); assert.equal(await stock(lastId),0); return converge();
  });
  await verify('Concurrent return consumes a sale line once', async () => {
    const returned = terminal => terminal.page.evaluate(async ({folio,operationId}) => {
      const sale = window.DATA.sales.find(row=>row.folio===folio), line = sale.lineas[0];
      const value = await window.DATA.recordReturn({folio,operationId,lineas:[{...line,sourceSaleLineId:line.lineId,qty:2,motivo:'QA H164'}],metodo:'Efectivo',notas:'QA H164'});
      if(!value.ok) throw Error(value.error); return value;
    }, {folio:sold.folio,operationId:op()});
    const before = await once('Stock before return',()=>stock(sourceId)), value = oneWinner(await race(A,B,()=>returned(A),()=>returned(B),command=>command?.type==='return'));
    remember('returns',value.ret.id); assert.equal(await stock(sourceId),before+2); return converge();
  });
  await verify('Concurrent exchange consumes remaining line once', async () => {
    const exchange = terminal => terminal.page.evaluate(async ({folio,id,sellerId,operationId}) => {
      const D=window.DATA,sale=D.sales.find(row=>row.folio===folio),line=sale.lineas[0],p=D.products.find(row=>row.id===id);
      const value = await D.recordExchange({origenFolio:folio,operationId,vendedorId:sellerId,usuario:'QA H164',metodoPago:'Efectivo',notas:'QA H164',lineas:[
        {...line,sourceSaleLineId:line.lineId,lado:'devuelto',qty:1,motivo:'QA H164'},
        {productId:p.id,expectedProductVersion:p._syncVersion,sku:p.sku,nombre:p.nombre,talla:p.sizeCode,lado:'entregado',qty:1}]});
      if(!value.ok) throw Error(value.error); return value;
    },{folio:sold.folio,id:targetId,sellerId:terminal.sellerId,operationId:op()});
    const before=await once('Stock before exchange',async()=>[await stock(sourceId),await stock(targetId)]), value=oneWinner(await race(A,B,()=>exchange(A),()=>exchange(B),command=>command?.type==='exchange'));
    remember('exchanges',value.exchange.id); assert.equal(await stock(sourceId),before[0]+1); assert.equal(await stock(targetId),before[1]-1);
    return converge();
  });
  await verify('Loan / concurrent return preserves document version', async () => {
    const before=await once('Stock before loan',()=>stock(targetId));
    const created=await once('Create one loan',()=>A.page.evaluate(async({id,prefix})=>{const D=window.DATA,p=D.products.find(row=>row.id===id),date=new Date().toISOString().slice(0,10);
      return D.registrarPrestamo({fecha:date,fechaEsperada:date,persona:{nombre:prefix,tipo:'otro'},lineas:[{productId:id,talla:p.sizeCode,qty:1}],nota:'QA H164'});},{id:targetId,prefix}));
    assert.equal(created.ok,true); remember('loans',created.loan.id); await converge();
    const returned=terminal=>terminal.page.evaluate(async id=>{const D=window.DATA,l=D.loans.find(row=>row.id===id);const value=await D.registrarDevolucionPrestamo(id,{fecha:new Date().toISOString().slice(0,10),lineas:[{key:l.lineas[0].key,qty:1}]});if(!value.ok)throw Error(value.error);return value;},created.loan.id);
    oneWinner(await race(A,B,()=>returned(A),()=>returned(B),command=>command?.type==='loanOperation'));
    assert.equal(await stock(targetId),before,'Loan contract does not move stock'); return converge();
  });
  await verify('Layaway / concurrent payment / settlement', async () => {
    const before=await once('Stock before layaway',()=>stock(targetId)),layaway=await once('Create one layaway',()=>sell(A,targetId,{layaway:true})); await converge();
    if(!fixtures.checkpoints[currentCase+' / Settle layaway']?.complete)assert.equal(await stock(targetId),before);
    const partial=terminal=>terminal.page.evaluate(async args=>{const value=await window.DATA.registrarPagoApartado(args.folio,args);if(!value.ok)throw Error(value.error);return value;},
      {folio:layaway.folio,monto:20,metodo:'Efectivo',operationId:op()});
    const outcomes=await race(A,B,()=>partial(A),()=>partial(B),command=>command?.type==='sale');
    oneWinner(outcomes);
    const successful=outcomes.filter(row=>row.status==='fulfilled');
    await converge();
    const current=await once('Payment header after concurrent abono',async()=>check(await db.from('sales').select('*').eq('folio',layaway.folio).single()));
    assert.equal(Number(current.anticipo),10+successful.length*20,'No lost or duplicated payment');
    const settled=await once('Settle layaway',()=>C.page.evaluate(async({folio,operationId})=>{const D=window.DATA,s=D.sales.find(row=>row.folio===folio);return D.registrarPagoApartado(folio,{monto:s.saldo,metodo:'Efectivo',operationId});},{folio:layaway.folio,operationId:op()}));
    assert.equal(settled.ok,true); assert.equal(settled.liquidado,true); assert.equal(await stock(targetId),before-1); return converge();
  });
  await verify('Commission settlement for the isolated seller', async () => {
    const value=await once('Settle exact QA seller commission',()=>A.page.evaluate(id=>window.DATA.liquidarComision(id),A.sellerId));
    assert.ok(Number(value)>=0); return converge();
  });
  await verify('No Internet blocks operation, stock, success, pending; reconnect reads authority', async () => {
    const before=await stock(targetId),requests=[];
    const observer=request=>{if(request.url().includes('/rpc/execute_online_command'))requests.push(request.url());};
    A.page.on('request',observer); await A.context.setOffline(true);
    try {
      await A.page.waitForFunction(()=>!window.STORE.syncStatus().ready);
      const denied=await A.page.evaluate(async id=>{try{await window.DATA.saveProductRows([window.DATA.updateReference({id,precio:999})]);return {success:true};}catch(error){return {success:false,message:error.message,stock:window.DATA.products.find(row=>row.id===id).stockQuantity};}},targetId);
      assert.equal(denied.success,false); assert.match(denied.message,/Sin conexión\. BALAM necesita internet para continuar\./);
      assert.equal(denied.stock,before); assert.equal(requests.length,0);const storage=await storageState(A);assert.deepEqual(storage.queueKeys,[]);assert.equal(storage.legacyPendingApi,'undefined');assert.equal(storage.databases.filter(row=>row.store==='durable_queue').reduce((sum,row)=>sum+row.rows,0),0);
      await A.page.getByText('Sin conexión. BALAM necesita internet para continuar.',{exact:true}).waitFor();
      assert.equal(await A.page.getByTestId('receipt-print').count(),0); await A.page.screenshot({path:join(out,'offline.png'),fullPage:true});
    } finally { await A.context.setOffline(false); A.page.off('request',observer); }
    await ready(A); assert.equal(await stock(targetId),before); return converge();
  });
  await verify('Reload and close/reopen rebuild only from Supabase', async () => {
    await B.page.reload({waitUntil:'domcontentloaded'}); await ready(B); await B.page.evaluate(async()=>(await window.STORE.ensureClient()).removeAllChannels());
    await C.page.close(); C.page=await C.context.newPage(); C.page.on('pageerror',error=>C.errors.push(error.message));
    await C.page.goto(address,{waitUntil:'domcontentloaded'}); await ready(C); await C.page.evaluate(async()=>(await window.STORE.ensureClient()).removeAllChannels());
    return converge();
  });
  await verify('Existing commercial history preserved', async () => {
    const counts={};
    for(const table of tables){const now=new Map((await rawRows(table)).map(row=>[keyFor(table,row),digest(cleanExisting(row))]));
      for(const [key,hash] of baseline[table])assert.equal(now.get(key),hash,'Existing row changed or lost: '+table+'/'+key);
      counts[table]=baseline[table].size;}
    return {unchangedExistingRows:counts,lost:0};
  });
  await verify('Equipment history separates exact retired QA installations', async () => {
    const recoverRetirement=async id=>{const row=check(await db.from('sync_devices').select('device_id,status,metadata').eq('device_id',id).single());assert.equal(row.status,'revoked');return {ok:true,deviceId:id};};
    for(const id of fixtures.installations.slice(1))await once('Retire exact installation '+id,()=>A.page.evaluate(id=>window.STORE.setSyncDeviceRetired(id,true,'QA H164 certification ended'),id),()=>recoverRetirement(id));
    await once('Fleet separates retired B and C',async()=>{
      const fleet=await A.page.evaluate(()=>window.STORE.syncFleetStatus());
      for(const id of fixtures.installations.slice(1)){assert.equal(fleet.devices.some(row=>row.device_id===id),false);assert.equal(fleet.history.some(row=>row.device_id===id),true);}return {verified:true};
    });
    await once('Retire exact installation '+fixtures.installations[0],()=>A.page.evaluate(id=>window.STORE.setSyncDeviceRetired(id,true,'QA H164 certification ended'),fixtures.installations[0]),()=>recoverRetirement(fixtures.installations[0]));
    return {retiredOwnInstallations:fixtures.installations,existingInstallationsChanged:0};
  });
  for(const terminal of terminals)assert.deepEqual(terminal.errors,[],'Browser exceptions '+terminal.name);
  result.certified=true; result.finishedAt=new Date().toISOString();
} catch(error) { if(!error.completedMatrix){result.failure=error.message; process.exitCode=1;} }
finally {
  result.fixturePolicy='Business QA history retained; no replay, no Punto Cero, no delete of business rows. Exact identities in fixtures.json.';
  if(baseline&&!result.certified)result.preservation='Incomplete run: retained fixtures and account for exact reconciliation; do not clean by prefix.';
  if(result.certified&&userId){
    try { check(await db.from('sellers').update({active:false}).in('id',fixtures.sellers));for(const id of [userId,...fixtures.createdAccountIds])check(await admin.auth.admin.updateUserById(id,{ban_duration:'876000h'})); result.qaAccount='retained inactive'; }
    catch(error){result.qaAccount='retained; retirement requires review: '+error.message; result.certified=false; process.exitCode=1;}
  }
  await browser?.close(); await new Promise(resolve=>server?server.close(resolve):resolve()); save();
  console.log(JSON.stringify({certified:result.certified,cases:result.cases.length,artifactSha256:result.artifactSha256,evidence:out}));
}
