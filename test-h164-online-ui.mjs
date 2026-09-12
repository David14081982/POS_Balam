// H164: actual generated UI; isolated explicit fixtures, no Supabase writes.
// One case per preserved surface, and one regression for each closed drawer.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';

const html=await fs.readFile(process.env.BALAM_VERIFIED_HTML||'index.html');
const server=createServer((_request,response)=>{response.writeHead(200,{'Content-Type':'text/html'});response.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+server.address().port;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const output=process.env.BALAM_TEST_OUTPUT||'.evidence-h164';await fs.mkdir(output,{recursive:true});
const runId=new Date().toISOString().replace(/[:.]/g,'-');
const evidence={startedAt:new Date().toISOString(),artifactSha256:hash(html),sourceSha256:{},selected:process.env.BALAM_UI_CASE||'all',cases:[],errors:[],remoteBusinessWrites:0,
  scope:'Generated browser UI with explicit read-only fixture snapshots; external network blocked; operating-system print endpoint observed without a physical printer.'};
for(const file of ['test-h164-online-ui.mjs','balam/data.jsx','balam/inventory.jsx','balam/clients.jsx','balam/reports.jsx','balam/shared.jsx','balam/pos-ticket.jsx','balam/xlsx-io.jsx','balam/app.jsx']){
  try{evidence.sourceSha256[file]=hash(await fs.readFile(file));}catch(error){if(error.code!=='ENOENT')throw error;}
}
const save=async()=>{const json=JSON.stringify(evidence,null,2);await fs.writeFile(output+'/online-ui-'+runId+'.json',json);await fs.writeFile(output+'/online-ui.json',json);};
let browser,page;
async function scenario(name,run){
  if(process.env.BALAM_UI_CASE && !process.env.BALAM_UI_CASE.split(',').some(filter=>name.includes(filter.trim()))) return;
  const started=Date.now();
  try{const details=await run();evidence.cases.push({name,ok:true,elapsedMs:Date.now()-started,details});console.log('PASS '+name);}
  catch(error){evidence.cases.push({name,ok:false,elapsedMs:Date.now()-started,error:error.message});await page?.screenshot({path:output+'/online-ui-'+runId+'-failure.png',fullPage:true}).catch(()=>{});throw error;}
  finally{await save();}
}
try {
  browser=await chromium.launch(process.env.BALAM_CHROME_EXECUTABLE?{executablePath:process.env.BALAM_CHROME_EXECUTABLE,headless:true}:{channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await context.addInitScript(()=>{
    // Retain the real bootstrap root so removing its container does not leave a
    // detached App subscribed to the same AUTH/STORE events as this fixture.
    window.__h164ReactRoots=[];let reactDom;
    Object.defineProperty(window,'ReactDOM',{configurable:true,get:()=>reactDom,set:value=>{
      reactDom=value;let createRoot;
      Object.defineProperty(value,'createRoot',{configurable:true,get:()=>createRoot,set:implementation=>{
        createRoot=(...args)=>{const root=implementation(...args);window.__h164ReactRoots.push(root);return root;};
      }});
    }});
  });
  await context.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
  page=await context.newPage();
  page.on('pageerror',error=>evidence.errors.push(error.message));
  await page.goto(base,{waitUntil:'load'});
  await page.waitForFunction(()=>window.AUTH?.isReady()&&window.DATA&&window.InventoryScreen&&window.ClientsScreen&&window.PWA&&window.BARCODES?.ready());
  const fixture=await page.evaluate(()=>{
    const D=window.DATA,C=window.CONFIG;
    C.load(C.prepareMutation('reset',[]).state);
    const id='16400000-0000-4000-8000-000000000001';
    const product=D.createReference({id,referenceFamilyId:'16400000-0000-4000-8000-000000000099',
      nombre:'Prueba de etiqueta',modelo:'H164',cat:'21',manga:'ML',tela:'ALG',color:'BL',cuello:'NOR',
      orn:'—',ornamentColorCodes:[],precio:116,costo:40,stockQuantity:1,sizeCode:'40',sizeScale:'N',
      sizeCategoryId:'size_number',attrs:{__sizeCategoryId:'size_number'}},[]);
    const keys=['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'];
    const snapshot=Object.fromEntries(keys.map(key=>[key,[]]));snapshot.products=[product];
    snapshot.commissionContext={periodStart:'',sellerBases:[]};
    D.replaceFromOnline(snapshot);
    window.AUTH.canAccess=()=>true;window.AUTH.isAdmin=()=>true;
    window.__h164ReactRoots.forEach(root=>root.unmount());
    document.body.innerHTML='<div id="h164-ui"></div>';
    window.__h164Root=ReactDOM.createRoot(document.getElementById('h164-ui'));
    window.__h164Root.render(React.createElement(window.InventoryScreen));
    return {id:product.id,sku:D.materializedSku(product,product.sizeCode),barcode:product.barcodeCode};
  });
  await page.getByTestId('inventory-labels').waitFor();
  await scenario('Inventario: cajón cerrado permite actualizar',async()=>{
    await page.evaluate(()=>document.activeElement?.blur());
    assert.equal(await page.evaluate(()=>window.PWA.reloadSafety().safe),true);
    assert.equal(await page.locator('[aria-label="Detalle del producto"][aria-modal="true"]').count(),0);
  });
  await scenario('V2/barcode V3/etiqueta: identidad, PNG y PDF conservados',async()=>{
    const barcode=await page.evaluate(async()=>{
      const p=window.DATA.products[0],B=window.BARCODES;
      const cert=B.certifySellableReference(p,p.sizeCode);
      const png=await B.toPNGBlob(B.codeOf(p,p.sizeCode));
      return {cert,bytes:png.size,mime:png.type};
    });
    assert.equal(barcode.cert.ok,true,JSON.stringify(barcode.cert));
    assert.equal(barcode.cert.resolvedProductId,fixture.id);assert.ok(barcode.bytes>100);assert.equal(barcode.mime,'image/png');
    await page.getByTestId('inventory-labels').click();
    await page.getByTestId('labels-download').waitFor();
    assert.equal(await page.getByTestId('labels-download').isEnabled(),true);
    const downloaded=page.waitForEvent('download');await page.getByTestId('labels-download').click();
    const download=await downloaded,bytes=await fs.readFile(await download.path());
    assert.ok(bytes.subarray(0,8).toString().startsWith('%PDF-'));
    const expectedSku=fixture.sku.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?')
      .replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
    assert.ok(bytes.toString('latin1').includes(expectedSku),JSON.stringify({expectedSku,metadata:bytes.toString('latin1').match(/BT \/F1[^\n]+/g)}));
    await page.getByTestId('label-modal-close').click();
  });
  await scenario('Excel: vista previa no modifica DATA; export conserva identidad',async()=>{
    const result=await page.evaluate(async()=>{
      const D=window.DATA,IO=window.XLSXIO;
      const before=JSON.stringify(D.products),rows=D.products;
      const changedRows=rows.map(row=>({...row,nombre:'Edición preparada de Excel'}));
      const built=IO.__test.inventoryWorkbook(changedRows);
      const bytes=XLSX.write(built.wb,{bookType:'xlsx',type:'array'});
      const preview=await IO.parseFile(new File([bytes],'H164.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
      const plan=IO.planImport(preview,rows,{});
      const prepared=IO.applyImportPlan(plan,rows);
      return {id:D.products[0].id,unchanged:JSON.stringify(D.products)===before,
        valid:plan.ok,creates:plan.creates,changed:plan.changedUpdates,prepared:prepared.products.length};
    });
    assert.equal(result.id,fixture.id);assert.equal(result.unchanged,true);assert.equal(result.valid,true);
    assert.equal(result.creates,0);assert.equal(result.changed,1);assert.equal(result.prepared,1);
  });
  await scenario('Clientes: cajón cerrado permite actualizar',async()=>{
    await page.evaluate(()=>{window.__h164Root.render(React.createElement(window.ClientsScreen));});
    await page.waitForFunction(()=>!document.querySelector('[data-testid="inventory-labels"]'));
    await page.evaluate(()=>document.activeElement?.blur());
    assert.equal(await page.evaluate(()=>window.PWA.reloadSafety().safe),true);
    assert.equal(await page.locator('[role="dialog"][aria-modal="true"]').count(),0);
  });
  await scenario('Reportes: reimpresión conserva documento histórico confirmado',async()=>{
    const fixtureState=await page.evaluate(()=>{
      const D=window.DATA,p=D.products[0],folio='H164-HIST-0001',fecha=new Date().toISOString().slice(0,10)+' 12:00';
      const line={lineId:'16400000-0000-4000-8000-000000000088',productId:p.id,sku:p.sku,nombre:'Nombre histórico confirmado',talla:p.sizeCode,qty:1,precio:232,precioOrig:232,precioBase:232,promos:[]};
      const sale={folio,fecha,cliente:'Cliente histórico',vendedor:'Vendedor histórico',vendedores:[],estado:'Pagado',metodo:'Efectivo',items:1,subtotal:200,iva:32,ivaPct:16,ivaIncluded:true,total:232,anticipo:232,saldo:0,pagoEfectivo:232,pagoOtro:0,descuento:0,descuentoAdicional:0,comisiones:[],lineas:[line],_operationId:'16400000-0000-4000-8000-000000000077',_stockReserved:true,
        receiptSnapshot:{version:1,store:{name:'Tienda histórica QA',footer:'Conservar documento original'},sellerName:'Vendedor histórico',lines:[{lineId:line.lineId,productId:p.id,sku:p.sku,name:line.nombre,sizeCode:p.sizeCode,sizeLabel:'Talla histórica 40',colorLabel:'Color histórico',ornamentColors:[],attributes:[]}]}};
      const snapshot=Object.fromEntries(['products','sellers','clients','sales','movements','promotions','liquidations','returns','payments','exchanges','loans','commissionAdjustments'].map(key=>[key,[]]));
      snapshot.products=[p];snapshot.sales=[sale];snapshot.payments=[{id:'h164-historical-payment',folio,fecha,monto:232,efectivo:232,tarjeta:0,transferencia:0,otro:0,metodo:'Efectivo',tipo:'venta'}];snapshot.commissionContext={periodStart:'',sellerBases:[]};
      D.replaceFromOnline(snapshot);window.__h164Printed=[];
      const makeFrame=window.UI.receiptFrame;
      window.UI.receiptFrame=async(...args)=>{const frame=await makeFrame(...args);frame.contentWindow.print=()=>{window.__h164Printed.push({html:frame.contentDocument.documentElement.outerHTML,text:frame.contentDocument.body.textContent,documentId:frame.contentDocument.querySelector('[data-document-id]')?.dataset.documentId});frame.contentWindow.dispatchEvent(new Event('afterprint'));};return frame;};
      window.__h164Root.render(React.createElement(window.ReportsScreen));
      return {folio,before:JSON.stringify({sales:D.sales,products:D.products,payments:D.payments})};
    });
    await page.getByTestId('reports-tab-sales').click();
    const reprint=page.getByTestId('sales-reprint-'+fixtureState.folio);await reprint.waitFor();
    assert.match(await reprint.locator('xpath=ancestor::tr').innerText(),/232/);
    await reprint.click();
    await page.waitForFunction(()=>window.__h164Printed.length===1);
    const printed=await page.evaluate(()=>window.__h164Printed[0]);
    assert.equal(printed.documentId,fixtureState.folio);assert.match(printed.text,/Nombre histórico confirmado/);assert.match(printed.text,/Tienda histórica QA/);assert.match(printed.text,/232/);assert.doesNotMatch(printed.text,/Prueba de etiqueta/);
    assert.equal(await page.evaluate(()=>JSON.stringify({sales:DATA.sales,products:DATA.products,payments:DATA.payments})),fixtureState.before);
    await fs.writeFile(output+'/online-ui-'+runId+'-historical-print.html',printed.html);
    await page.getByTestId('sales-reprint-close').click();
    return {folio:fixtureState.folio,printHandoffs:1,printedHtmlSha256:hash(printed.html),authoritativeFixtureUnchanged:true,physicalPrinterTested:false};
  });
  await scenario('Conexión: App conserva el formulario oculto e inerte hasta confirmar',async()=>{
    await page.evaluate(()=>{
      const user={id:'16400000-0000-4000-8000-000000000002',nombre:'Usuario QA'};
      window.AUTH.current=()=>user;window.AUTH.hasSession=()=>true;window.AUTH.isReady=()=>true;
      window.AUTH.init=()=>{};window.AUTH.defaultScreen=()=> 'pos';window.AUTH.canAccess=id=>id==='pos';
      window.STORE.setSession=async()=>({ok:true});window.STORE.init=async()=>({ok:true});
      window.__h164Online={ready:true,connection:'online',message:'Todo actualizado'};
      window.STORE.syncStatus=()=>window.__h164Online;
      window.__h164Mounts=0;window.__h164Unmounts=0;
      window.POSScreen=function Draft(){
        const [value,setValue]=React.useState('');
        React.useEffect(()=>{window.__h164Mounts++;return()=>{window.__h164Unmounts++;};},[]);
        return React.createElement('input',{'data-testid':'retained-draft',value,onChange:event=>setValue(event.target.value)});
      };
      localStorage.setItem('balam-page','pos');
      window.__h164Root.render(React.createElement(window.App));
    });
    await page.getByTestId('retained-draft').fill('Captura sin efectos');
    const original=await page.getByTestId('retained-draft').elementHandle();
    const mountsBefore=await page.evaluate(()=>[window.__h164Mounts,window.__h164Unmounts]);
    assert.deepEqual(mountsBefore,[1,0]);
    await page.evaluate(()=>{
      window.__h164Online={ready:false,connection:'offline',message:'Estamos confirmando la operación. No la repitas.'};
      window.dispatchEvent(new CustomEvent('syncstatuschange'));
    });
    await page.getByTestId('online-gate').waitFor();
    assert.equal(await page.getByTestId('retained-draft').isVisible(),false);
    assert.equal(await page.getByTestId('retained-draft').evaluate(el=>!!el.closest('[inert]')),true);
    await page.evaluate(()=>{
      window.__h164Online={ready:true,connection:'online',message:'Todo actualizado'};
      window.dispatchEvent(new CustomEvent('syncstatuschange'));
    });
    await page.getByTestId('retained-draft').waitFor({state:'visible'});
    assert.equal(await page.getByTestId('retained-draft').inputValue(),'Captura sin efectos');
    assert.equal(await original.evaluate(el=>el.isConnected),true);
    assert.deepEqual(await page.evaluate(()=>[window.__h164Mounts,window.__h164Unmounts]),mountsBefore);
    return {sameDomNode:true,draftPreserved:true,inertWhileBlocked:true,mountsBefore};
  });
  assert.deepEqual(evidence.errors,[]);
  evidence.completedAt=new Date().toISOString();await save();
  console.log(`${evidence.cases.length} PASS / 0 FAIL`);
} catch(error){evidence.failure=error.message;await save();throw error;}
finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
