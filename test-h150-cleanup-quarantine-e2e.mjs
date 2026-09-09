// UI/QA only: isolated Chrome profile, all remote traffic blocked.
import {chromium} from 'playwright-core';
import {readFileSync,mkdirSync} from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const out=process.env.BALAM_TEST_OUTPUT||'C:/tmp/balam-h150-ui';mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(readFileSync(process.env.BALAM_TEST_HTML||'index.html'));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});let pass=0;const errors=[];
try{
 const page=await browser.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
 await page.route(/supabase\.co|googleapis\.com|gstatic\.com/,r=>r.abort());
 await page.goto(process.env.BALAM_TEST_URL||`http://127.0.0.1:${server.address().port}/`);
 await page.waitForFunction(()=>window.SettingsScreen&&window.STORE&&window.AUTH);
 await page.evaluate(()=>{
  window.AUTH.canAccess=id=>id==='config'||id==='config.demo';window.AUTH.isAdmin=()=>true;
  window.__h150={backups:0,executions:0};
  const counts=Object.fromEntries(['productos','piezas','ventas','sale_items','movimientos','apartados','pagos','devoluciones','return_items','cambios','exchange_items','prestamos','reclasificaciones','liquidaciones','commission_adjustments','physical_card_redemptions','stock_reservations','sale_commits','return_commits','exchange_commits','layaway_liquidation_commits','folio_counters','clientes'].map(k=>[k,0]));
  window.STORE.pointZeroPreview=async()=>({ok:true,system_mode:'preproduction',schema_version:20260830017500,data_epoch:7,preview_token:'fixture',counts,queue_pending:0,active_locks:0,sync_complete:true,client_ready:true,ready:true});
  window.STORE.previewTestDataCleanup=async(_p,selection)=>({ok:true,system_mode:'preproduction',preset_requested:'custom',selection_requested:selection,selection_normalized:selection,
   counts:{ventas:0,operaciones_archivadas:2},documents:{},stock:[],plan_hash:'a'.repeat(64),protocol_version:6,minimum_client_protocol:6,
   quarantine_discard:[{device_id:'A',device_name:'Equipo EIFBB1',operation_id:'sale-1',operation_type:'sale',domain:'sales',reference:'BG-PRUEBA',remote_epoch:7,payload_hash:'a'.repeat(64),status:'pending_review'},
    {device_id:'A',device_name:'Equipo EIFBB1',operation_id:'delete-1',operation_type:'productDeleteScope',domain:'products',remote_epoch:7,payload_hash:'b'.repeat(64),status:'pending_review'}],
   fleet:{summary:{ready:1},devices:[]},blocked_reasons:[],executable:true,client_ready:true,ready:true});
  window.STORE.createTestDataCleanupBackup=async preview=>{window.__h150.backups++;return{backup_id:'backup',document:{plan:preview}};};
  window.STORE.downloadTestDataCleanupDocument=()=>{};
  window.STORE.executeTestDataCleanup=async opts=>{window.__h150.executions++;return{ok:true,cleanup_id:'cleanup',quarantine_discard:opts.preview.quarantine_discard};};
  document.body.innerHTML='<div id="h150-root"></div>';ReactDOM.createRoot(document.getElementById('h150-root')).render(React.createElement(window.SettingsScreen));
 });
 await page.getByTestId('settings-section-demo').click();await page.getByTestId('cleanup-group-sales').check();
 await page.getByTestId('selective-cleanup-open').waitFor();await page.waitForTimeout(500);
 assert.equal(await page.getByTestId('cleanup-quarantine-summary').count(),1,'Archived discards must be visible before confirmation');pass++;
 const summary=page.getByTestId('cleanup-quarantine-summary');
 assert.match(await summary.innerText(),/2 operaciones archivadas/);pass++;
 assert.match(await summary.innerText(),/baja de producto/i);pass++;
 assert.equal(await page.getByTestId('selective-cleanup-open').isDisabled(),false);pass++;
 assert.equal(await page.getByTestId('cleanup-quarantine-details').evaluate(e=>e.open),false);pass++;
 await page.getByTestId('cleanup-quarantine-details').locator('summary').click();
 assert.match(await summary.innerText(),/Equipo EIFBB1/);assert.match(await summary.innerText(),/BG-PRUEBA/);pass++;
 for(const width of [320,360,390,430,768,1024,1280,1440]){
  await page.setViewportSize({width,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow ${width}`);pass++;
  if(width===320||width===1280)await page.screenshot({path:`${out}/quarantine-${width}.png`,fullPage:true});
 }
 await page.getByTestId('selective-cleanup-open').click();
 const dialog=page.getByTestId('selective-cleanup-dialog');await dialog.waitFor();
 assert.equal(await dialog.getByTestId('cleanup-quarantine-summary').count(),1);pass++;
 assert.equal(await page.evaluate(()=>window.__h150.executions),0);pass++;
 await dialog.getByTestId('selective-cleanup-backup').click();
 const input=dialog.getByTestId('selective-cleanup-confirmation');await input.waitFor();
 await input.fill('LIMPIAR OPERACIONES');
 await dialog.getByRole('button',{name:'Continuar',exact:true}).click();
 assert.match(await dialog.innerText(),/2 operaciones archivadas/);pass++;
 await dialog.getByTestId('selective-cleanup-execute').click();
 await page.waitForFunction(()=>window.__h150.executions===1);
 assert.equal(await page.evaluate(()=>window.__h150.backups),1);pass++;
 assert.match(await dialog.innerText(),/2 operaciones archivadas descartadas/);pass++;
 assert.deepEqual(errors,[]);pass++;
 console.log(`H150_UI_QA_OK ${pass}/${pass}`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
