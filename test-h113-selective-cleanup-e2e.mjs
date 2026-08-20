// H-113 · UI sintética, sin red ni borrado. Recorre las cinco puertas y todos
// los anchos exigidos contra los módulos fuente.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT=process.cwd();
const EVIDENCE=path.join(ROOT,'.evidence-h113');fs.mkdirSync(EVIDENCE,{recursive:true});
const server=http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  const fp=path.join(ROOT,p); if(!fp.startsWith(ROOT)||!fs.existsSync(fp)){res.writeHead(404);res.end('nf');return;}
  res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html':'application/octet-stream'});fs.createReadStream(fp).pipe(res);
});
await new Promise(resolve=>server.listen(8897,'127.0.0.1',resolve));
let pass=0,fail=0;const errors=[];const check=(name,ok,detail='')=>{console.log(`${ok?'✅':'❌'} ${name}${detail?' · '+detail:''}`);ok?pass++:fail++;};
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
page.on('pageerror',e=>errors.push(String(e)));await page.route(/supabase\.co|googleapis\.com|gstatic\.com/,r=>r.abort());
await page.goto('http://127.0.0.1:8897/index.html',{waitUntil:'load'});
await page.waitForFunction(()=>window.SettingsScreen&&window.STORE&&window.AUTH);
await page.evaluate(()=>{
  window.__h113={backup:0,execute:0,receipt:0,downloads:[]};
  const pointZero=()=>({ok:true,system_mode:'preproduction',schema_version:20260817014900,data_epoch:11,
    preview_token:'h98',snapshot_hash:'a'.repeat(64),queue_pending:0,active_locks:0,active_operation:0,
    sync_complete:true,client_ready:true,ready:true,counts:{productos:2,piezas:20,ventas:1,sale_items:1,
      movimientos:1,apartados:0,pagos:1,devoluciones:1,return_items:1,cambios:1,exchange_items:2,
      prestamos:1,reclasificaciones:0,liquidaciones:1,commission_adjustments:0,physical_card_redemptions:0,
      stock_reservations:0,sale_commits:1,return_commits:1,exchange_commits:1,layaway_liquidation_commits:0,
      folio_counters:1,clientes:1}});
  const selective=(preset,selection)=>({ok:true,system_mode:'preproduction',protocol_version:2,
    minimum_client_protocol:2,data_epoch:11,preset_requested:preset,selection_requested:selection,
    selection_normalized:Object.assign({},selection),forced_dependencies:selection.sales&&!selection.returns?['returns:dependent_on_sales']:[],
    counts:{ventas:3,devoluciones:1,cambios:1,prestamos:1,comisiones:2,reclasificaciones:0,clientes:0},
    documents:{sale_folios:['V-1'],sale_operation_ids:['OP-1'],return_ids:['R-1'],exchange_ids:['E-1'],
      loan_ids:['L-1'],liquidation_ids:['Q-1'],commission_adjustment_ids:[],reclassification_ids:[],customer_ids:[]},
    stock:[{product_id:'P-V2-A',talla:'40',current_stock:7,delta:2,target_stock:9}],blocked_reasons:[],
    plan_hash:'b'.repeat(64),executable:true,client_ready:true,ready:true});
  window.AUTH.canAccess=id=>id==='config'||id==='config.demo';window.AUTH.isAdmin=()=>true;
  window.STORE.pointZeroPreview=async()=>pointZero();
  window.STORE.previewTestDataCleanup=async(p,s)=>selective(p,s||{});
  window.STORE.createTestDataCleanupBackup=async p=>{window.__h113.backup++;return{ok:true,backup_id:'B-113',document:{format:'balam-selective-cleanup-backup-v2',plan_hash:p.plan_hash}};};
  window.STORE.downloadTestDataCleanupDocument=(doc,kind,id)=>{window.__h113.downloads.push({kind,id});return{bytes:10};};
  window.STORE.executeTestDataCleanup=async o=>{window.__h113.execute++;if(o.confirmation!=='LIMPIAR OPERACIONES')throw new Error('bad confirmation');return{ok:true,cleanup_id:'C-113',data_epoch:12};};
  window.STORE.testDataCleanupReceipt=async id=>{window.__h113.receipt++;return{format:'balam-selective-cleanup-receipt-v2',cleanup_id:id};};
  document.body.innerHTML='<div id="h113-root"></div>';ReactDOM.createRoot(document.getElementById('h113-root')).render(React.createElement(window.SettingsScreen));
});
await page.getByTestId('settings-section-demo').click();await page.getByTestId('selective-cleanup-card').waitFor();
check('ocho dominios de limpieza visibles',(await page.getByTestId('selective-cleanup-card').locator('input[type=checkbox]').count())===8);
for(const key of ['sales','returns','exchanges','loans','commissions'])await page.getByTestId('cleanup-group-'+key).check();
await page.getByText('Todo está listo para limpiar.').waitFor();
for(const width of [320,360,375,390,430,768,1024,1280,1440]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(30);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  check(`responsive ${width}px sin overflow`,!overflow);
  if(width===320||width===1440)await page.screenshot({path:path.join(EVIDENCE,`selective-cleanup-${width}.png`),fullPage:true});
}
check('grupos semánticos accesibles',await page.getByTestId('cleanup-group-returns').isVisible()&&await page.getByTestId('cleanup-group-exchanges').isVisible());
check('preview muestra inventario antes y después',(await page.locator('body').innerText()).includes('Piezas afectadas antes')&&(await page.locator('body').innerText()).includes('Piezas afectadas después'));
await page.getByTestId('selective-cleanup-open').click();
check('modal tiene nombre accesible',await page.getByRole('dialog',{name:'Confirmar limpieza'}).isVisible());
await page.getByTestId('selective-cleanup-backup').click();
await page.getByTestId('selective-cleanup-confirmation').waitFor();
check('frase tiene label accesible',await page.getByLabel('Frase de confirmación').isVisible());
check('backup precede confirmación',(await page.evaluate(()=>window.__h113.backup))===1);
const next=page.getByRole('button',{name:'Continuar',exact:true});
await page.getByTestId('selective-cleanup-confirmation').fill('LIMPIAR OPERACIONES ');check('frase inexacta bloquea',await next.isDisabled());
await page.getByTestId('selective-cleanup-confirmation').fill('LIMPIAR OPERACIONES');check('frase exacta habilita',!(await next.isDisabled()));
await next.click();check('advertencia final separada',(await page.locator('body').innerText()).includes('Advertencia final'));
await page.getByTestId('selective-cleanup-execute').click();await page.getByText('LIMPIEZA COMPLETADA',{exact:true}).waitFor();
check('ejecución única',(await page.evaluate(()=>window.__h113.execute))===1);
await page.getByRole('button',{name:'Descargar comprobante',exact:true}).click();
check('comprobante separado',(await page.evaluate(()=>window.__h113.receipt))===1&&(await page.evaluate(()=>window.__h113.downloads.map(x=>x.kind).join(',')))==='respaldo,comprobante');
check('sin errores de navegador',errors.length===0,errors.join(' | '));
await browser.close();server.close();console.log(`\nH-113 UI: ${pass} pasaron, ${fail} fallaron`);if(fail)process.exit(1);
