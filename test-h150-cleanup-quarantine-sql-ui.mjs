// Chrome UI -> real PostgreSQL; only h150_exact on loopback, always rollback.
import {chromium} from 'playwright-core';
import {spawn} from 'node:child_process';
import {readFileSync,mkdirSync} from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const out=process.env.BALAM_TEST_OUTPUT||'C:/tmp/h150-sql-ui';mkdirSync(out,{recursive:true});
const child=spawn(process.env.BALAM_PSQL||'C:/Program Files/PostgreSQL/18/bin/psql.exe',
 ['-X','-w','-h','127.0.0.1','-p','55424','-U','postgres','-d','h150_exact','-Atq','-P','pager=off'],
 {env:{...process.env,PGCLIENTENCODING:'UTF8'},windowsHide:true});
let output='',errors='',pending,serial=Promise.resolve(),seq=0;
child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
child.stderr.on('data',s=>errors+=s);
child.stdout.on('data',s=>{
 output+=s;
 if(pending&&output.includes(pending.marker)){
  const p=pending;pending=null;clearTimeout(p.timeout);
  const text=output.slice(0,output.indexOf(p.marker)).trim();output='';
  if(/ERROR:|FATAL:/.test(errors))p.reject(new Error(errors));else p.resolve(text);
 }
});
child.on('exit',code=>{if(pending){clearTimeout(pending.timeout);pending.reject(new Error(`psql exited ${code}: ${errors}`));pending=null;}});
function sql(statement){
 const work=()=>new Promise((resolve,reject)=>{
  output='';errors='';const marker=`H150_END_${++seq}`;
  pending={resolve,reject,marker,timeout:setTimeout(()=>reject(new Error('SQL timeout')),20000)};
  child.stdin.write(statement+'\n\\echo '+marker+'\n');
 });
 const result=serial.then(work);serial=result.catch(()=>{});return result;
}
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const json=v=>quote(JSON.stringify(v))+'::jsonb';
const query=async s=>JSON.parse(await sql('select '+s+';'));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(readFileSync('index.html'));});
let browser;let checks=0;const consoleErrors=[];
try{
 const fixture=readFileSync('test-h150-cleanup-quarantine-overlap.sql','utf8').split('create function pg_temp.h150_fail_receipt()')[0];
 await sql(fixture);
 assert.equal(await sql('select current_database();'),'h150_exact');checks++;
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 page.on('pageerror',e=>consoleErrors.push(e.message));
 await page.route(/supabase\.co|googleapis\.com|gstatic\.com/,r=>r.abort());
 await page.exposeFunction('h150SQL',async(method,arg)=>{
  if(method==='preview')return {...await query(`pos.preview_test_data_cleanup('custom',${json(arg)},6)`),client_ready:true,ready:true};
  if(method==='backup')return query(`pos.create_test_data_cleanup_backup('custom',${json(arg.selection_requested)},${quote(arg.plan_hash)},6,'sql-ui','h150-exec-A')`);
  if(method==='execute')return query(`pos.execute_test_data_cleanup('h150-ui-cleanup','custom',${json(arg.preview.selection_requested)},${quote(arg.preview.plan_hash)},${quote(arg.backupId)}::uuid,${quote(arg.confirmation)},6,'sql-ui','h150-exec-A')`);
  throw new Error('Unsupported SQL UI method');
 });
 await page.goto(process.env.BALAM_TEST_URL||`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.SettingsScreen&&window.STORE&&window.AUTH);
 await page.evaluate(()=>{
  window.AUTH.canAccess=id=>id==='config'||id==='config.demo';window.AUTH.isAdmin=()=>true;
  const counts=Object.fromEntries(['productos','piezas','ventas','sale_items','movimientos','apartados','pagos','devoluciones','return_items','cambios','exchange_items','prestamos','reclasificaciones','liquidaciones','commission_adjustments','physical_card_redemptions','stock_reservations','sale_commits','return_commits','exchange_commits','layaway_liquidation_commits','folio_counters','clientes'].map(k=>[k,0]));
  window.STORE.pointZeroPreview=async()=>({ok:true,system_mode:'preproduction',schema_version:20260830017500,data_epoch:7,preview_token:'fixture',counts,queue_pending:0,active_locks:0,sync_complete:true,client_ready:true,ready:true});
  window.STORE.previewTestDataCleanup=(_preset,selection)=>window.h150SQL('preview',selection);
  window.STORE.createTestDataCleanupBackup=p=>window.h150SQL('backup',p);
  window.STORE.executeTestDataCleanup=o=>window.h150SQL('execute',o);
  document.body.innerHTML='<div id="h150-root"></div>';ReactDOM.createRoot(document.getElementById('h150-root')).render(React.createElement(window.SettingsScreen));
 });
 await page.getByTestId('settings-section-demo').click();await page.getByTestId('cleanup-group-sales').check();
 await page.waitForFunction(()=>!document.querySelector('[data-testid="selective-cleanup-open"]').disabled);
 assert.match(await page.getByTestId('cleanup-quarantine-summary').innerText(),/2 operaciones archivadas/);checks++;
 await page.getByTestId('selective-cleanup-open').click();
 const dialog=page.getByTestId('selective-cleanup-dialog');
 const downloadEvent=page.waitForEvent('download');await dialog.getByTestId('selective-cleanup-backup').click();
 const download=await downloadEvent;await download.saveAs(`${out}/backup.json`);
 const backup=JSON.parse(readFileSync(`${out}/backup.json`,'utf8'));
 assert.equal(backup.payload.sales.length,2);assert.equal(backup.payload.quarantined_operations.length,2);checks++;
 await dialog.getByTestId('selective-cleanup-confirmation').waitFor();
 // The confirmation gate is the only disabled button in this state.
 assert.equal(await dialog.locator('button:disabled').count(),1);
 const confirmationGate=await dialog.locator('button:disabled').elementHandle();
 await dialog.getByTestId('selective-cleanup-confirmation').fill('LIMPIAR OPERACIONES');
 assert.equal(await confirmationGate.isDisabled(),false);checks++;
 await confirmationGate.click();
 await dialog.getByTestId('selective-cleanup-execute').click();
 await page.waitForFunction(()=>document.querySelector('[data-testid="selective-cleanup-dialog"]').textContent.includes('LIMPIEZA COMPLETADA'));
 checks++;
 assert.match(await dialog.innerText(),/2 operaciones archivadas descartadas/);checks++;
 const state=await query(`jsonb_build_object('sales',(select count(*) from pos.sales),'commits',(select count(*) from pos.sale_commits),'v1',(select (stock->0->>'stock')::int from pos.products where id='h150-v1'),'v2',(select stock_quantity from pos.products where id='h150-v2'),'receipt',pos.test_data_cleanup_receipt('h150-ui-cleanup'))`);
 assert.equal(state.sales,0);assert.equal(state.commits,0);checks++;
 assert.equal(state.v1,9);assert.equal(state.v2,10);checks++;
 assert.equal(state.receipt.result.status,'completed');checks++;
 for(const width of [320,1280]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks++;
  await page.screenshot({path:`${out}/completed-${width}.png`});
 }
 assert.deepEqual(consoleErrors,[]);checks++;
 console.log(`H150_SQL_UI_OK ${checks}/${checks}`);
}finally{
 if(browser)await browser.close();if(server.listening)await new Promise(r=>server.close(r));
 if(child.exitCode===null){await sql('rollback;');child.stdin.end('\\q\n');}
}
