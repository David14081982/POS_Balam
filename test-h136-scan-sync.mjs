// Formulario -> SQL -> ajuste de origen/nueva alta -> PDF -> POS -> recarga/pull.
// Transporte aislado. No modifica Supabase ni usa una sesión comercial.
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export async function testScanSync({db,check,read,functionSql}){
 await db.exec('alter table pos.products add column updated_at timestamptz');
 await db.exec(functionSql(read('20260830017200_pos_h133_inventory_v3_contract.sql'),'guard_entity_version'));
 await db.exec(functionSql(read('20260810013400_pos_h94_reference_model_v2.sql'),'h94_sync_v2_stock_shape'));
 await db.exec(`create trigger version_guard before insert or update on pos.products for each row execute function pos.guard_entity_version();
 create trigger stock_shape before insert or update on pos.products for each row execute function pos.h94_sync_v2_stock_shape();`);
 const evidence=process.env.BALAM_SCAN_EVIDENCE||fs.mkdtempSync(path.join(os.tmpdir(),'balam-scan-sync-'));
 const remote=process.argv.find(x=>/^https?:\/\//.test(x));
 fs.mkdirSync(evidence,{recursive:true});
 const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync('index.html'));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const p=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[],calls=[];let lookup=[],settings=[];
 p.on('pageerror',e=>{errors.push(e.message);console.log('SCAN PAGE ERROR',e.message);});
 await p.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'||(remote&&u.origin===new URL(remote).origin)?r.continue():r.abort();});
 await p.exposeFunction('__scanTransport',async(kind,name,args)=>{
  try{
   if(kind==='seed'){lookup=Object.entries(args.catalogs).flatMap(([kind,items])=>items.map((x,i)=>({...x,kind,sort_order:i})));settings=Object.entries(args.settings).map(([key,value])=>({key,value})).concat({key:'_catalogMeta',value:args.catalogMeta});return true;}
   if(kind==='select'){
    if(name==='system_manifest')return {data:[{singleton:true,sync_protocol_min:3,sync_protocol_current:3,schema_version:20260830017500,data_epoch:6,domain_modes:{}}],error:null};
    if(name==='products')return {data:(await db.query('select * from pos.products order by id')).rows,error:null};
    if(name==='clients')return {data:[{id:'c7',nombre:'Público en general',generic:true,compras:0,total:0,sync_version:1}],error:null};
    if(name==='lookup'||name==='settings')return {data:name==='lookup'?lookup:settings,error:null};
    return {data:[],error:null};
   }
   calls.push({name,args});
   if(name==='commit_reference_family_batch')return {data:(await db.query('select pos.commit_reference_family_batch($1,$2,$3,$4,$5) result',[args.p_operation_id,args.p_reference_family_id,JSON.stringify(args.p_rows),args.p_protocol_version,args.p_data_epoch])).rows[0].result,error:null};
   if(name==='commit_config'){lookup=args.p_lookup;settings=args.p_settings;return {data:{ok:true,version:1},error:null};}
   if(['test_data_purge_state','report_sync_device','consume_sync_commands','consume_sync_quarantine_decisions','reserve_folio_block'].includes(name))return {data:[],error:null};
   return {data:null,error:{message:'RPC no implementada en arnés: '+name}};
  }catch(e){return {data:null,error:{message:e.message,code:e.code}};}
 });
 await p.addInitScript(()=>{
  const client={from:name=>{const q={};for(const key of ['select','eq','gte','in','order','range','contains','is','limit'])q[key]=()=>q;
   q.then=(yes,no)=>window.__scanTransport('select',name,{}).then(yes,no);if(name==='sync_activity')q.upsert=async()=>({error:null});return q;},
   rpc:(name,args)=>window.__scanTransport('rpc',name,args),
   auth:{getSession:async()=>({data:{session:window.__scanSession?{user:{id:'13800000-0000-4000-8000-000000000001'}}:null}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};
  Object.defineProperty(window,'supabase',{get:()=>({createClient:()=>client}),set:()=>{}});
 });
 const setup=async pull=>p.evaluate(async pull=>{
  window.__scanSession=true;AUTH.canAccess=()=>true;
  if(!pull){DATA.products.splice(0);DATA.persistProducts();for(const kind of ['producto','corte','caracteristicas'])CONFIG.addItem(kind,{code:'H136',label:'PRUEBA '+kind,active:true});
   CONFIG.addItem('ornament',{code:'SIN',label:'Sin ornamento',active:true,meta:{allowsColors:false}});
   await window.__scanTransport('seed','config',CONFIG.snapshot());}
  await STORE.init({pull});document.body.innerHTML='<div id="scan-root"></div>';
  window.__scanRoot=ReactDOM.createRoot(document.getElementById('scan-root'));
  window.__scanRoot.render(React.createElement(React.Fragment,null,React.createElement(InventoryScreen),React.createElement(UI.ToastHost)));
 },pull);
 const settle=async()=>{try{await p.waitForFunction(()=>STORE.queueStatus().pending===0,null,{timeout:15000});}catch(e){console.log('SCAN QUEUE',JSON.stringify(await p.evaluate(()=>STORE.queueStatus())));throw e;}};
 await p.goto(remote||`http://127.0.0.1:${server.address().port}`);await p.waitForFunction(()=>window.InventoryScreen&&window.DATA);await setup(false);
 const create=async(stock,color)=>{
  const before=await p.evaluate(()=>DATA.products.map(x=>x.id));
  await p.getByTestId('inventory-new-product').click();
  await p.getByTestId('product-name').selectOption('H136');await p.getByTestId('product-field-corte').selectOption('H136');await p.getByTestId('product-field-caracteristicas').selectOption('H136');
  await p.getByTestId('product-field-color').selectOption(color);await p.getByTestId('product-general-price').fill('950');
  await p.getByTestId('product-ornament').selectOption('SIN');
  await p.getByTestId('family-stock-draft-size_letter-2-M').fill(String(stock));
  await p.getByTestId('product-save').click();await p.getByTestId('product-form').waitFor({state:'detached'});await settle();
  return p.evaluate(before=>{const x=DATA.products.find(x=>!before.includes(x.id));return {id:x.id,sku:x.sku,barcode:x.barcodeCode,family:x.referenceFamilyId};},before);
 };
 const label=async(row,name)=>{
  await p.getByTestId('inventory-product-family:'+row.family).click();await p.getByTestId('product-detail-labels').click();
  const downloadPromise=p.waitForEvent('download');await p.getByTestId('labels-download').click();await (await downloadPromise).saveAs(path.join(evidence,name+'.pdf'));
  await p.getByTestId('label-modal-close').click();await p.getByTestId('product-detail-close').click();
  const decoded=JSON.parse(execFileSync(process.env.BALAM_PYTHON||'python',['test-h136-decode-label.py',path.join(evidence,name+'.pdf')],{encoding:'utf8'}));
  check(name+': barras del PDF contienen el código exacto',decoded.codes.length===1&&decoded.codes[0]===row.barcode);
  check(name+': metadatos PDF conservan el SKU comercial del fixture',decoded.text.includes(row.sku));
  if(decoded.codes.length!==1)throw Error('PDF sin un único código verificable');
  row.decodedBarcode=decoded.codes[0];
 };
 const source=await create(5,'BL');await label(source,'anterior');
 await p.getByTestId('inventory-product-family:'+source.family).click();await p.getByTestId('product-detail-edit').click();
 // El contrato usa el ID persistido como rowKey en edición.
 await p.getByTestId('family-stock-'+source.id).fill('3');
 await p.getByTestId('product-save').click();await p.getByTestId('product-form').waitFor({state:'detached'});await settle();
 const target=await create(2,'NE');await label(target,'nuevo');
 const saved=(await db.query('select * from pos.products where id in($1,$2) order by id',[source.id,target.id])).rows;
 check('separación por formularios llega a SQL con stock 3/2',saved.find(x=>x.id===source.id)?.stock_quantity===3&&saved.find(x=>x.id===target.id)?.stock_quantity===2);
 check('origen y nuevo conservan SKU y barcode independientes',saved.length===2&&source.barcode!==target.barcode&&saved.every(x=>[source,target].some(r=>r.id===x.id&&r.sku===x.sku&&r.barcode===x.barcode_code&&x.barcode_contract===3)));
 const inspect=async stage=>{
  await p.evaluate(()=>window.__scanRoot.render(React.createElement(POSScreen,{layout:'side',catalogView:'grid'})));
  for(const row of [source,target]){
   const input=p.getByTestId('pos-barcode-input');await input.fill(row.decodedBarcode);await input.press('Enter');
   const line=p.getByTestId('ticket-line-'+row.id);check(stage+': agrega referencia '+(row===source?'anterior':'nueva'),await line.count()===1);
   const text=await line.innerText();check(stage+': muestra SKU comercial '+(row===source?'anterior':'nuevo'),text.includes(row.sku)&&!text.includes(row.barcode));
  }
  await p.screenshot({path:path.join(evidence,stage+'.png'),fullPage:true});
 };
 await inspect('sincronizado');
 await p.evaluate(()=>{DATA.products.splice(0);DATA.persistProducts();});
 await p.reload();await p.waitForFunction(()=>window.InventoryScreen&&window.DATA);await setup(true);
 check('pull reconstruye ambas identidades y existencias',await p.evaluate(({source,target})=>DATA.products.find(x=>x.id===source.id)?.stockQuantity===3&&DATA.products.find(x=>x.id===target.id)?.stockQuantity===2,{source,target}));
 await inspect('recargado');
 for(const width of [320,360,390,430,768,1024,1280,1440]){
  await p.setViewportSize({width,height:1000});
  const open=p.getByTestId('pos-cart-open');if(await open.isVisible())await open.click();
  const sku=p.getByTestId('ticket-line-sku-'+target.id);
  check('SKU completo visible sin desbordarse a '+width,await sku.isVisible()&&await sku.evaluate(n=>{const r=n.getBoundingClientRect();return n.textContent.includes('SKU:')&&n.scrollWidth<=n.clientWidth+1&&r.left>=0&&r.right<=innerWidth+1;}));
  if(width===360||width===1280)await p.screenshot({path:path.join(evidence,'sku-'+width+'.png'),fullPage:true});
  await p.keyboard.press('Escape');
 }
 check('lecturas no modifican stock confirmado',JSON.stringify(saved)===JSON.stringify((await db.query('select * from pos.products where id in($1,$2) order by id',[source.id,target.id])).rows));
 check('sin excepciones de navegador',errors.length===0,errors);
 fs.writeFileSync(path.join(evidence,'identity.json'),JSON.stringify({source,target,requests:calls.filter(x=>x.name==='commit_reference_family_batch').length},null,2));
 console.log('SCAN EVIDENCE '+evidence);
 }finally{await browser.close();server.closeAllConnections();server.close();}
}
