// Edición real y Excel; frontera remota controlada, cero escrituras comerciales.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';

const results=[];
async function test(name,run){try{await run();results.push({name,ok:true});console.log('PASS '+name);}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL '+name+': '+e.message);}}
const src=fs.readFileSync('balam/inventory.jsx','utf8');
const handler=src.slice(src.indexOf('    async function saveProduct('),src.indexOf('    function confirmDeletion('));
function fixture(save){
  const events=[],p={id:'exact-id',precio:10};
  const ctx={D:{products:[p],hydrate:x=>({...x}),isV2Reference:()=>false,updateReference:x=>({...x}),saveProductRows:save,saveProductFamily:save},
    editSavePending:{current:false},setSavingEdit(){},toast:x=>events.push(x),refresh(){},setEditing:()=>events.push('closed'),setDetail(){},setLabelTargets(){}};
  vm.createContext(ctx);vm.runInContext(handler,ctx);return {ctx,p,events};
}
await test('Errores de edición conservan código y contexto',async()=>{
  const {ctx,p,events}=fixture(async()=>{throw Object.assign(new Error('invalid uuid'),{code:'22P02'});});
  await ctx.saveProduct({...p,precio:20},'edit');
  assert.ok(!events.includes('closed'));assert.equal(events[0].code,'22P02');assert.equal(events[0].context,'product_edit');
});
await test('Resultado vacío o de otro ID nunca anuncia éxito',async()=>{
  for(const result of [[],false,[{id:'other-id'}]]){
    const {ctx,p,events}=fixture(async()=>result);await ctx.saveProduct({...p,precio:20},'edit');
    assert.ok(!events.includes('closed'));assert.equal(events[0].code,'PRODUCT_EDIT_UNCONFIRMED');
  }
});
await test('Un envío por clic doble; cierre sólo tras confirmación',async()=>{
  let release,calls=0;const waiting=new Promise(r=>release=r);
  const {ctx,p,events}=fixture(()=>{calls++;return waiting;});
  const first=ctx.saveProduct({...p,precio:20},'edit');const second=ctx.saveProduct({...p,precio:20},'edit');
  assert.equal(calls,1);assert.ok(!events.includes('closed'));release([{...p,precio:20}]);await Promise.all([first,second]);
  assert.equal(events.filter(x=>x==='closed').length,1);assert.equal(ctx.editSavePending.current,false);
});
await test('Clasificación de edición no inventa importación y conserva estados online',()=>{
  const s=fs.readFileSync('balam/shared.jsx','utf8'),ctx=vm.createContext({window:{}});
  vm.runInContext(s.slice(s.indexOf('  const TECHNICAL_JARGON'),s.indexOf('  function HumanMessage('))+'\nglobalThis.authority=messageAuthority;',ctx);
  for(const code of ['REFERENCE_SIGNATURE_DUPLICATE','REFERENCE_RECLASSIFICATION_REQUIRED','22P02']){
    const m=ctx.authority({context:'product_edit',code,message:'invalid JSON uuid reference_'});
    assert.doesNotMatch([m.title,m.explanation,m.action].join(' '),/archivo|plantilla|importa/i);
  }
  assert.equal(ctx.authority({context:'product_edit',code:'ONLINE_RESULT_UNKNOWN'}).title,'Estamos confirmando la operación. No la repitas.');
});

if(!process.argv.includes('--contract-only')&&results.every(r=>r.ok)){
  const html=fs.readFileSync('index.html'),server=http.createServer((q,r)=>{r.setHeader('Content-Type','text/html');r.end(html);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try{
    browser=await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE?{executablePath:process.env.BALAM_CHROME_EXECUTABLE,headless:true}:{channel:'chrome',headless:true});
    const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
    const url='http://127.0.0.1:'+server.address().port;
    await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
    await context.addInitScript(()=>{
      window.__roots=[];let rd;
      Object.defineProperty(window,'ReactDOM',{configurable:true,get:()=>rd,set:v=>{rd=v;let create;Object.defineProperty(v,'createRoot',{configurable:true,get:()=>create,set:fn=>{create=(...a)=>{const r=fn(...a);window.__roots.push(r);return r;};}});}});
    });
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    async function mount(state){
      await page.goto(url);await page.waitForFunction(()=>window.AUTH?.isReady()&&window.DATA&&window.InventoryScreen&&window.XLSXIO);
      return page.evaluate(state=>{
        const D=window.DATA,C=window.CONFIG;
        if(state)C.load(state.config);else{
          C.load(C.prepareMutation('reset',[]).state);
          C.load(C.prepareMutation('addItem',['producto',{code:'H172',label:'Edicion H172'}]).state);
        }
        const common={nombre:'Edicion H172',modelo:'H172',cat:'21',manga:'ML',tela:'ALG',color:'BL',cuello:'NOR',orn:'—',ornamentColorCodes:[],ornColors:[],precio:116,costo:40,sizeCategoryId:'size_number',attrs:{producto:'H172',__sizeCategoryId:'size_number'}};
        const products=state?.snapshot.products||[
          D.hydrate({...common,id:'17200000-0000-4000-8000-000000000001',recordModel:'v1',stock:[{talla:'38',escala:'N',stock:3}],preciosTalla:{}}),
          D.createReference({...common,id:'17200000-0000-4000-8000-000000000002',referenceFamilyId:'17200000-0000-4000-8000-000000000099',sizeCode:'40',sizeScale:'N',stockQuantity:3},[]),
        ];
        const keys=['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'];
        const snapshot=state?.snapshot||Object.fromEntries(keys.map(k=>[k,k==='products'?products:[]]));
        snapshot.commissionContext={periodStart:'',sellerBases:[]};window.__snapshot=snapshot;D.replaceFromOnline(snapshot);
        const save=async rows=>{
          if(window.__rejectEdit){window.__rejectEdit=false;throw Object.assign(new Error('invalid uuid'),{code:'22P02'});}
          window.__snapshot.products=window.__snapshot.products.map(p=>rows.find(r=>r.id===p.id)||p);
          D.replaceFromOnline(window.__snapshot);return {ok:true};
        };
        window.CORE.registerSyncGateway({assertBusinessReady:()=>true,pushRows:(kind,rows)=>save(rows),pushProductFamilyBatch:(id,rows)=>save(rows)});
        window.AUTH.canAccess=()=>true;window.AUTH.isAdmin=()=>true;
        window.__roots.forEach(r=>r.unmount());document.body.innerHTML='<div id="h172"></div>';
        ReactDOM.createRoot(document.getElementById('h172')).render(React.createElement(window.UI.ToastHost));
        document.body.insertAdjacentHTML('beforeend','<div id="h172-inventory"></div>');
        ReactDOM.createRoot(document.getElementById('h172-inventory')).render(React.createElement(window.InventoryScreen));
        return {config:C.snapshot(),snapshot:window.__snapshot,products:D.products};
      },state);
    }
    let state=await mount(null);const original=state.products;
    for(const [i,p] of original.entries())await test('V'+(i+1)+': editar, confirmar, recargar y conservar identidad',async()=>{
      await page.getByTestId('inventory-product-'+(p.referenceFamilyId?'family:'+p.referenceFamilyId:p.id)).click();
      await page.getByTestId('product-detail-edit').click();await page.getByTestId('product-general-price').fill(String(200+i));
      if(i===1){
        await page.evaluate(()=>window.__rejectEdit=true);await page.getByTestId('product-save').click();
        await page.getByText('No se pudo confirmar el guardado',{exact:true}).waitFor();
        assert.ok(await page.getByTestId('product-form').isVisible());assert.equal(await page.getByTestId('product-general-price').inputValue(),'201');
        assert.equal(await page.getByText('El archivo no tiene el formato esperado',{exact:true}).count(),0);
      }
      await page.getByTestId('product-save').click();
      await page.getByTestId('product-form').waitFor({state:'detached',timeout:5000}).catch(async()=>{
        throw new Error(JSON.stringify(await page.evaluate(()=>({
          errors:document.querySelector('[data-testid="product-form-errors"]')?.innerText,
          messages:[...document.querySelectorAll('[data-message-level]')].map(n=>n.innerText),
          prices:window.DATA.products.map(p=>[p.id,p.precio]),
        }))));
      });
      state=await page.evaluate(()=>({snapshot:window.__snapshot,config:window.CONFIG.snapshot()}));state=await mount(state);
      const saved=state.products.find(row=>row.id===p.id);assert.equal(saved.precio,200+i);
      for(const key of ['id','sku','barcodeCode','physicalSignature'])assert.equal(saved[key]||'',p[key]||'');
      const stock=rows=>rows.filter(r=>Number(r.stock)).map(r=>[r.escala,String(r.talla),Number(r.stock)]).sort();assert.deepEqual(stock(saved.stock),stock(p.stock));
    });
    await test('Excel serializado incluye precios editados e identidad V1/V2',async()=>{
      const rows=await page.evaluate(()=>{const X=window.XLSX,{wb}=window.XLSXIO.__test.inventoryWorkbook(window.DATA.products);const read=X.read(X.write(wb,{type:'array',bookType:'xlsx'}),{type:'array'});return X.utils.sheet_to_json(read.Sheets.Inventario);});
      original.forEach((p,i)=>{const row=rows.find(r=>r._BALAM_ID_PRODUCTO===p.id);assert.equal(row.Precio,200+i);assert.equal(row.SKU,p.sku);if(i===1)assert.equal(row._BALAM_BARCODE_CODE,p.barcodeCode);});
      assert.deepEqual(errors,[]);
    });
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
fs.mkdirSync('.evidence-h172',{recursive:true});
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
fs.writeFileSync('.evidence-h172/'+(process.argv.includes('--contract-only')?'baseline':'verification')+'.json',JSON.stringify({results,artifactSha256:sha('index.html'),sourceSha256:{inventory:sha('balam/inventory.jsx'),shared:sha('balam/shared.jsx')},remoteBusinessWrites:0},null,2));
console.log(`${results.filter(r=>r.ok).length}/${results.length}`);process.exitCode=results.every(r=>r.ok)?0:1;
