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
  ];
  const preview=()=>({ok:true,system_mode:'preproduction',protocol_version:3,minimum_client_protocol:3,
    data_epoch:12,preset_requested:'operations',selection_requested:{sales:true},selection_normalized:{sales:true},
    forced_dependencies:[],counts:{ventas:3},documents:{sale_folios:['V-1']},stock:[],plan_hash:'b'.repeat(64),
    fleet:{summary:{ready:1,compatible_offline:1,update_on_return:1,attention:window.__h116.blocked?1:0,unsafe_legacy:window.__h116.legacy?1:0,retired:0},
      devices:window.__h116.blocked
        ? devices.concat([{device_id:'pending',display_name:'Caja 2',state:'attention',blocking:true,protocol_version:1,schema_version:20260817014900,data_epoch:11}])
        : window.__h116.legacy
          ? devices.concat([{device_id:'legacy',display_name:'Caja heredada',state:'unsafe_legacy',blocking:true,protocol_version:0,schema_version:20260803011300,data_epoch:11}])
          : devices},
    blocked_reasons:window.__h116.blocked
      ? [{code:'pending_operation_intersects_cleanup',device_name:'Caja 2',domains:['sales']}]
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
await page.getByTestId('settings-section-demo').click();await page.getByTestId('cleanup-preset-operations').click();
await page.getByTestId('cleanup-fleet-details').waitFor();
let body=await page.locator('body').innerText();
check('equipo vigente muestra estado humano',body.includes('Caja principal: Equipo listo — no bloquea'));
check('apagado compatible no bloquea',body.includes('Caja apagada: Equipo apagado — no bloquea'));
check('equipo viejo se actualiza al volver y no bloquea',body.includes('Laptop anterior: Se actualizará al volver — no bloquea'));
check('continuar habilitado',!(await page.getByTestId('selective-cleanup-open').isDisabled()));
const details=page.getByTestId('cleanup-fleet-details');
check('detalle técnico inicia cerrado',!(await details.evaluate(el=>el.open)));
check('esquema técnico oculto',!(await details.locator('div').first().isVisible()));
await details.locator('summary').click();
check('detalle técnico abre bajo demanda',await details.locator('div').first().isVisible());
check('detalle contiene protocolo/esquema/época',(await details.innerText()).includes('protocolo 2')&&(await details.innerText()).includes('esquema 20260818015300')&&(await details.innerText()).includes('época 12'));
for(const width of [320,360,375,390,430,768,1024,1280,1440]){
  await page.setViewportSize({width,height:900});await page.waitForTimeout(30);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  check(`responsive ${width}px sin overflow`,!overflow);
  if(width===320||width===1440)await page.screenshot({path:path.join(EVIDENCE,`cleanup-fleet-${width}.png`),fullPage:true});
}
await page.evaluate(()=>{window.__h116.blocked=true;});
await page.getByRole('button',{name:'Actualizar plan',exact:true}).click();
await page.getByText('Hay una operación pendiente en Caja 2 que podría afectar esta limpieza.').waitFor();
body=await page.locator('body').innerText();
check('bloqueo nombra el equipo y la causa humana',body.includes('Hay una operación pendiente en Caja 2'));
check('estado de operación intersectante es humano',body.includes('Caja 2: Tiene una operación pendiente que afecta esta limpieza — bloquea'));
check('operación intersectante bloquea continuar',await page.getByTestId('selective-cleanup-open').isDisabled());
await page.evaluate(()=>{window.__h116.blocked=false;window.__h116.legacy=true;});
await page.getByRole('button',{name:'Actualizar plan',exact:true}).click();
await page.getByText('Caja heredada: Equipo demasiado antiguo; actualízalo o retíralo — bloquea').waitFor();
body=await page.locator('body').innerText();
check('cliente anterior a H-77 muestra acción humana',body.includes('Caja heredada: Equipo demasiado antiguo; actualízalo o retíralo — bloquea'));
check('cliente anterior a H-77 bloquea continuar',await page.getByTestId('selective-cleanup-open').isDisabled());
await page.evaluate(()=>{window.__h116.legacy=false;window.__h116.localBlocked=true;});
await page.getByRole('button',{name:'Actualizar plan',exact:true}).click();
await page.getByTestId('cleanup-local-sync-block').waitFor();
body=await page.locator('body').innerText();
check('sincronización local pendiente explica el botón bloqueado',body.includes('Esta computadora todavía está sincronizando sus cambios.'));
check('sincronización local pendiente bloquea continuar',await page.getByTestId('selective-cleanup-open').isDisabled());
check('códigos internos no aparecen en UI',!body.includes('pending_operation_intersects_cleanup')&&!body.includes('client_schema_incompatible')&&!body.includes('cleanup_not_synchronized'));
check('sin errores de navegador',errors.length===0,errors.join(' | '));
await browser.close();server.close();console.log(`\nH-116 UI: ${pass} pasaron, ${fail} fallaron`);if(fail)process.exit(1);
