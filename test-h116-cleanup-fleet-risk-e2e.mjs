// H-116 · UI sintética, sin red ni limpieza. Valida el resumen humano y el
// detalle técnico colapsable contra el bundle que se publica.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT=process.cwd();
const EVIDENCE=path.join(ROOT,'.evidence-h116');fs.mkdirSync(EVIDENCE,{recursive:true});
const server=http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  const fp=path.join(ROOT,p); if(!fp.startsWith(ROOT)||!fs.existsSync(fp)){res.writeHead(404);res.end('nf');return;}
  res.writeHead(200,{'Content-Type':p.endsWith('.html')?'text/html':'application/octet-stream'});fs.createReadStream(fp).pipe(res);
});
await new Promise(resolve=>server.listen(8896,'127.0.0.1',resolve));
let pass=0,fail=0;const errors=[];const check=(name,ok,detail='')=>{console.log(`${ok?'✅':'❌'} ${name}${detail?' · '+detail:''}`);ok?pass++:fail++;};
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
page.on('pageerror',e=>errors.push(String(e)));await page.route(/supabase\.co|googleapis\.com|gstatic\.com/,r=>r.abort());
await page.goto('http://127.0.0.1:8896/index.html',{waitUntil:'load'});
await page.waitForFunction(()=>window.SettingsScreen&&window.STORE&&window.AUTH);
await page.evaluate(()=>{
  window.__h116={blocked:false,legacy:false,localBlocked:false};
  const devices=[
    {device_id:'ready',display_name:'Caja principal',state:'ready',protocol_version:2,schema_version:20260818015300,data_epoch:12},
    {device_id:'off',display_name:'Caja apagada',state:'compatible_offline',protocol_version:2,schema_version:20260818015300,data_epoch:12},
    {device_id:'old',display_name:'Laptop anterior',state:'update_on_return',protocol_version:1,schema_version:20260817014900,data_epoch:11},
    {device_id:'david',display_name:'Equipo David',state:'ready',blocking:false,current_pending:0,
      historical_incident_count:2,protocol_version:2,schema_version:20260818015300,data_epoch:12,
      historical_incidents:[
        {operation_id:'bg3',operation_type:'exchange',domain:'exchanges',reference:'BG-260812-0003',status:'retrying',updated_at:'2026-08-12T18:00:00Z'},
        {operation_id:'bg6',operation_type:'exchange',domain:'exchanges',reference:'BG-260812-0006',status:'blocked',updated_at:'2026-08-12T19:00:00Z'},
      ]},
  ];
  const preview=()=>({ok:true,system_mode:'preproduction',protocol_version:3,minimum_client_protocol:3,
    data_epoch:12,preset_requested:'operations',selection_requested:{sales:true},selection_normalized:{sales:true},
    forced_dependencies:[],counts:{ventas:3},documents:{sale_folios:['V-1']},stock:[],plan_hash:'b'.repeat(64),
    fleet:{summary:{ready:2,compatible_offline:1,update_on_return:1,attention:window.__h116.blocked?1:0,unsafe_legacy:window.__h116.legacy?1:0,retired:0,historical_incidents:2},
      devices:window.__h116.blocked
        ? devices.concat([{device_id:'pending',display_name:'Caja 2',state:'attention',blocking:true,protocol_version:1,schema_version:20260817014900,data_epoch:11}])
        : window.__h116.legacy
          ? devices.concat([{device_id:'legacy',display_name:'Caja heredada',state:'unsafe_legacy',blocking:true,protocol_version:0,schema_version:20260803011300,data_epoch:11}])
          : devices},
    blocked_reasons:window.__h116.blocked
      ? [{code:'pending_operation_intersects_cleanup',device_name:'Caja 2',domains:['sales'],
          operations:[{operation_id:'h116-sale',operation_type:'sale',domain:'sales',reference:'H116-V-1',status:'pending'}]}]
      : window.__h116.legacy ? [{code:'client_cannot_be_fenced',device_name:'Caja heredada'}] : [],
    executable:!(window.__h116.blocked||window.__h116.legacy),client_ready:!window.__h116.localBlocked,
    ready:!(window.__h116.blocked||window.__h116.legacy||window.__h116.localBlocked)});
  window.AUTH.canAccess=id=>id==='config'||id==='config.demo';window.AUTH.isAdmin=()=>true;
  window.STORE.pointZeroPreview=async()=>({ok:true,system_mode:'preproduction',schema_version:20260818015300,data_epoch:12,
    preview_token:'h98',snapshot_hash:'a'.repeat(64),queue_pending:0,active_locks:0,active_operation:0,
    sync_complete:true,client_ready:true,ready:true,counts:{productos:1,piezas:1,ventas:1,sale_items:1,
      movimientos:1,apartados:0,pagos:1,devoluciones:0,return_items:0,cambios:0,exchange_items:0,
      prestamos:0,reclasificaciones:0,liquidaciones:0,commission_adjustments:0,physical_card_redemptions:0,
      stock_reservations:0,sale_commits:1,return_commits:0,exchange_commits:0,layaway_liquidation_commits:0,
      folio_counters:1,clientes:1}});
  window.STORE.previewTestDataCleanup=async()=>preview();
  document.body.innerHTML='<div id="h116-root"></div>';ReactDOM.createRoot(document.getElementById('h116-root')).render(React.createElement(window.SettingsScreen));
});
await page.getByTestId('settings-section-demo').click();await page.getByTestId('cleanup-group-sales').check();
await page.getByTestId('cleanup-fleet-details').waitFor();
let body=await page.locator('body').innerText();
check('equipos vigentes aparecen en resumen',body.includes('2 listos'));
check('histórico se separa de pendientes actuales',body.includes('2 incidencias históricas — no bloquean'));
check('apagado compatible no bloquea',body.includes('1 apagados — no bloquean'));
check('equipo viejo se actualiza al volver y no bloquea',body.includes('1 se actualizarán al volver — no bloquean'));
check('continuar habilitado',!(await page.getByTestId('selective-cleanup-open').isDisabled()));
const details=page.getByTestId('cleanup-fleet-details');
check('detalle técnico inicia cerrado',!(await details.evaluate(el=>el.open)));
check('esquema técnico oculto',!(await details.locator('div').first().isVisible()));
await details.locator('summary').click();
check('detalle técnico abre bajo demanda',await details.locator('div').first().isVisible());
check('detalle contiene estado humano y protocolo/esquema/época',(await details.innerText()).includes('Caja apagada: Equipo apagado — no bloquea')&&(await details.innerText()).includes('protocolo 2')&&(await details.innerText()).includes('esquema 20260818015300')&&(await details.innerText()).includes('época 12'));
check('Equipo David declara cero operaciones actuales',(await details.innerText()).includes('Equipo David: 0 operaciones pendientes actuales — no bloquea'));
check('incidencias históricas conservan tipo, folio y estado',
  (await details.innerText()).includes('un cambio BG-260812-0003')
    && (await details.innerText()).includes('estado retrying')
    && (await details.innerText()).includes('un cambio BG-260812-0006')
    && (await details.innerText()).includes('estado blocked'));
for(const width of [320,360,375,390,430,768,1024,1280,1440]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(30);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  check(`responsive ${width}px sin overflow`,!overflow);
  if(width===320||width===1440)await page.screenshot({path:path.join(EVIDENCE,`cleanup-fleet-${width}.png`),fullPage:true});
}
await page.evaluate(()=>{window.__h116.blocked=true;});
await page.getByTestId('cleanup-group-returns').check();
await page.getByText('Caja 2 tiene una venta H116-V-1 pendiente que afecta esta limpieza.').waitFor();
body=await page.locator('body').innerText();
check('bloqueo nombra equipo, tipo y folio',body.includes('Caja 2 tiene una venta H116-V-1 pendiente'));
check('resumen marca equipo que requiere atención',body.includes('1 requieren atención — sí bloquean'));
check('operación intersectante bloquea continuar',await page.getByTestId('selective-cleanup-open').isDisabled());
await page.evaluate(()=>{window.__h116.blocked=false;window.__h116.legacy=true;});
await page.getByTestId('cleanup-group-exchanges').check();
await page.getByText('Caja heredada usa una versión demasiado antigua. Actualízalo o retíralo desde el Centro de equipos.').waitFor();
body=await page.locator('body').innerText();
check('cliente anterior a H-77 muestra acción humana',body.includes('Caja heredada usa una versión demasiado antigua. Actualízalo o retíralo'));
check('cliente anterior a H-77 bloquea continuar',await page.getByTestId('selective-cleanup-open').isDisabled());
await page.evaluate(()=>{window.__h116.legacy=false;window.__h116.localBlocked=true;});
await page.getByTestId('cleanup-group-loans').check();
await page.getByTestId('cleanup-local-sync-block').waitFor();
body=await page.locator('body').innerText();
check('sincronización local pendiente explica el botón bloqueado',body.includes('Esta computadora todavía está sincronizando. Espera a que termine.'));
check('sincronización local pendiente bloquea continuar',await page.getByTestId('selective-cleanup-open').isDisabled());
check('códigos internos no aparecen en UI',!body.includes('pending_operation_intersects_cleanup')&&!body.includes('client_schema_incompatible')&&!body.includes('cleanup_not_synchronized'));
check('sin errores de navegador',errors.length===0,errors.join(' | '));
await browser.close();server.close();console.log(`\nH-116 UI: ${pass} pasaron, ${fail} fallaron`);if(fail)process.exit(1);
