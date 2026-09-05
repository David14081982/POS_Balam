// UI + DATA + STORE del bundle real, transporte Supabase sustituido por PostgreSQL aislado.
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import fs from 'node:fs';
export async function testDeleteSync({db,check}){
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync('index.html'));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const scope of ['reference','family']){
  const context=await browser.newContext();const p=await context.newPage();const errors=[],calls=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  let release;const gate=new Promise(r=>release=r);
  await p.exposeFunction('__h137Transport',async(kind,name,args)=>{
   try{
    if(kind==='select'){
     if(name==='system_manifest')return {data:[{singleton:true,sync_protocol_min:3,sync_protocol_current:3,schema_version:20260830017500,data_epoch:6,domain_modes:{}}],error:null};
     if(name==='products')return {data:(await db.query('select * from pos.products order by id')).rows,error:null};
     return {data:[],error:null};
    }
    calls.push({name,args});let result;
    if(name==='commit_reference_family_batch'){
     await gate;
     result=await db.query('select pos.commit_reference_family_batch($1,$2,$3,$4,$5) result',[args.p_operation_id,args.p_reference_family_id,JSON.stringify(args.p_rows),args.p_protocol_version,args.p_data_epoch]);
    }else if(name==='delete_products_checked_v2'){
     result=await db.query('select pos.delete_products_checked_v2($1,$2,$3,$4,$5,$6,$7) result',[args.p_operation_id,args.p_scope,args.p_reference_family_id,JSON.stringify(args.p_targets),args.p_device_id,args.p_protocol_version,args.p_data_epoch]);
    }else if(name==='commit_config')return {data:{ok:true,version:1},error:null}; // catálogo del fixture, fuera de la baja
    else if(['test_data_purge_state','report_sync_device','report_sync_activity','consume_sync_commands','consume_sync_quarantine_decisions','reserve_folio_block'].includes(name))return {data:[],error:null};
    else return {data:null,error:{message:'RPC no implementada por el arnés: '+name}};
    return {data:result.rows[0].result,error:null};
   }catch(e){return {data:null,error:{message:e.message,code:e.code}};}
  });
  await p.addInitScript(()=>{
   const client={
    from:name=>{const q={};for(const method of ['select','eq','gte','in','order','range','contains','is','limit'])q[method]=()=>q;q.then=(yes,no)=>window.__h137Transport('select',name,{}).then(yes,no);if(name==='sync_activity')q.upsert=async()=>({error:null});return q;},
    rpc:(name,args)=>window.__h137Transport('rpc',name,args),
    auth:{getSession:async()=>({data:{session:window.__h137Session?{user:{id:'13800000-0000-4000-8000-000000000001'}}:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
   };
   Object.defineProperty(window,'supabase',{get:()=>({createClient:()=>client}),set:()=>{},configurable:false});
  });
  const setup=async(pull)=>p.evaluate(async pull=>{
   window.__h137Session=true;AUTH.canAccess=()=>true;
   if(!pull){DATA.products.splice(0);DATA.sales.splice(0);DATA.loans.splice(0);DATA.persistProducts();
    for(const kind of ['producto','corte','caracteristicas'])CONFIG.addItem(kind,{code:'H137',label:'PRUEBA '+kind,active:true});}
   await STORE.init({pull});
   document.body.innerHTML='<div id="h137-root"></div>';
   ReactDOM.createRoot(document.getElementById('h137-root')).render(React.createElement(React.Fragment,null,React.createElement(InventoryScreen),React.createElement(UI.ToastHost)));
  },pull);
  await p.goto(`http://127.0.0.1:${server.address().port}`);await p.waitForFunction(()=>window.InventoryScreen&&window.DATA);await setup(false);
  await p.getByTestId('inventory-new-product').click();
  await p.getByTestId('product-name').selectOption('H137');
  await p.getByTestId('product-field-corte').selectOption('H137');
  await p.getByTestId('product-field-caracteristicas').selectOption('H137');
  await p.getByTestId('product-general-price').fill('950');
  await p.getByTestId('family-zero-sizes-toggle').click();
  for(const [index,size] of [[2,'M'],[3,'L']])await p.getByTestId(`family-zero-toggle-draft-size_letter-${index}-${size}`).click();
  await p.getByTestId('product-save').click();await p.getByTestId('product-form').waitFor({state:'detached'});
  const fixture=await p.evaluate(()=>({family:DATA.products[0].referenceFamilyId,ids:DATA.products.map(x=>x.id)}));
  check(scope+': formulario crea dos referencias',fixture.ids.length===2);
  await p.getByTestId('inventory-product-family:'+fixture.family).click();await p.getByTestId('product-detail-delete').click();
  if(scope==='reference')await p.getByTestId('product-delete-reference-scope').click();
  const select=()=>p.getByTestId(scope==='family'?'product-delete-family-scope':'product-delete-reference-0').click();
  await select();
  check(scope+': alta en vuelo explica por qué esperar',/cambios pendientes de enviar/.test(await p.getByTestId('toast').innerText())&&await p.getByTestId('product-delete-confirm').count()===0);
  release();
  try{await p.waitForFunction(()=>STORE.queueStatus().pending===0&&DATA.products.every(x=>x._syncVersion===1),null,{timeout:15000});}
  catch(e){console.log('SYNC DIAGNOSTIC',JSON.stringify(await p.evaluate(()=>({q:STORE.queueStatus(),products:DATA.products.map(x=>({id:x.id,version:x._syncVersion}))}))),calls.map(x=>x.name));throw e;}
  await select();await p.getByTestId('product-delete-confirm').click();
  await p.waitForFunction(()=>STORE.queueStatus().pending===0,null,{timeout:15000});
  const deletion=calls.find(x=>x.name==='delete_products_checked_v2');
  check(scope+': eliminación usa versiones confirmadas del alta',deletion&&deletion.args.p_targets.length===(scope==='family'?2:1)&&deletion.args.p_targets.every(x=>fixture.ids.includes(x.id)&&x.baseVersion===1));
  const tombstones=(await db.query('select id from pos.products where reference_family_id=$1 and deleted_at is not null',[fixture.family])).rows;
  check(scope+': baja de pantalla llega a PostgreSQL',tombstones.length===(scope==='family'?2:1));
  const control=(await db.query('select id from pos.products where deleted_at is null and reference_family_id<>$1 limit 1',[fixture.family])).rows[0].id;
  await p.evaluate(()=>{DATA.products.splice(0);DATA.persistProducts();}); // exige restaurar desde SQL, no sólo conservar caché
  await p.reload();await p.waitForFunction(()=>window.InventoryScreen&&window.DATA);await setup(true);
  check(scope+': recarga con pull mantiene la baja y cola vacía',await p.evaluate(ids=>ids.every(id=>!DATA.products.some(x=>x.id===id))&&STORE.queueStatus().pending===0,tombstones.map(x=>x.id)));
  check(scope+': pull reconstruye inventario desde PostgreSQL',await p.evaluate(id=>DATA.products.some(x=>x.id===id),control));
  check(scope+': sin excepciones de navegador',errors.length===0);
  await context.close();
 }}finally{await browser.close();server.closeAllConnections();server.close();}
}
