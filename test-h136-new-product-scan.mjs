// H-136: alta real, etiqueta descargada, stock separado y errores de lectura.
// Usa sólo una sesión aislada. Ninguna petición de negocio llega a Supabase.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const remote=process.argv.find(arg=>/^https?:\/\//.test(arg));
const evidence=process.env.BALAM_SCAN_EVIDENCE||fs.mkdtempSync(path.join(os.tmpdir(),'balam-h136-'));
fs.mkdirSync(evidence,{recursive:true});
const server=remote?null:createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync('index.html'));});
if(server)await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];
const check=(name,ok,detail)=>{checks.push({name,ok:!!ok,detail});console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`);};
try{
 const p=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{
   const url=new URL(r.request().url());
   return url.hostname==='127.0.0.1'||(remote&&url.origin===new URL(remote).origin)?r.continue():r.abort();
 });
 await p.goto(remote||`http://127.0.0.1:${server.address().port}/`);
 await p.waitForFunction(()=>window.InventoryScreen&&window.DATA&&window.BARCODES);
 await p.evaluate(async()=>{
   await STORE.init({pull:false});
   DATA.products.splice(0);DATA.persistProducts();AUTH.canAccess=()=>true;
   for(const kind of ['producto','corte','caracteristicas'])CONFIG.addItem(kind,{code:'H136',label:'PRUEBA '+kind,active:true});
   document.body.innerHTML='<div id="h136-toast"></div><div id="h136-root"></div>';
   ReactDOM.createRoot(document.getElementById('h136-toast')).render(React.createElement(UI.ToastHost));
   window.__h136Root=ReactDOM.createRoot(document.getElementById('h136-root'));
   window.__h136Root.render(React.createElement(InventoryScreen));
 });
 await p.getByTestId('inventory-new-product').click();
 await p.getByTestId('product-name').selectOption('H136');
 await p.getByTestId('product-field-corte').selectOption('H136');
 await p.getByTestId('product-field-caracteristicas').selectOption('H136');
 await p.getByTestId('product-general-price').fill('950');
 await p.getByTestId('family-zero-sizes-toggle').click();
 await p.getByTestId('family-zero-toggle-draft-size_letter-2-M').click();
 await p.getByTestId('product-save').click();
 await p.getByTestId('product-form').waitFor({state:'detached'});
 const created=await p.evaluate(()=>{
   const target=DATA.products[0];
   const source=DATA.createReference({...target,id:crypto.randomUUID(),referenceFamilyId:crypto.randomUUID(),
     barcodeCode:undefined,barcodeAliases:[],color:'NE',stockQuantity:5},DATA.products);
   DATA.products.push(source);DATA.persistProducts();
   const totalBefore=DATA.products.reduce((sum,row)=>sum+DATA.totalStock(row),0);
   const transfer=DATA.reclassifyReference({sourceProductId:source.id,targetProductId:target.id,quantity:2,reason:'Prueba aislada H-136'});
   window.dispatchEvent(new CustomEvent('configchange'));
   return {id:target.id,sku:target.sku,barcode:target.barcodeCode,familyId:target.referenceFamilyId,sourceId:source.id,sourceBarcode:source.barcodeCode,
     transfer:{ok:transfer.ok,operationId:transfer.operationId},sourceStock:DATA.totalStock(source),targetStock:DATA.totalStock(target),totalBefore,
     totalAfter:DATA.products.reduce((sum,row)=>sum+DATA.totalStock(row),0)};
 });
 const registration=await p.evaluate(id=>{
   const row=JSON.parse(localStorage.getItem('balam_sync_queue')||'[]').flatMap(op=>op.rows||[]).find(row=>row.id===id);
   const local=JSON.parse(localStorage.getItem('balam_pos_products_v2')||'[]').find(row=>row.id===id);
   return {queued:row&&{id:row.id,sku:row.sku,barcode:row.barcode_code},saved:local&&{id:local.id,sku:local.sku,barcode:local.barcodeCode}};
 },created.id);
 check('alta guarda el mismo SKU y barcode en producto y solicitud durable',registration.queued&&registration.saved
   &&registration.queued.sku===created.sku&&registration.saved.sku===created.sku
   &&registration.queued.barcode===created.barcode&&registration.saved.barcode===created.barcode,registration);
 check('alta por formulario y separación conservan stock e identidad',created.transfer.ok&&created.targetStock===2&&created.sourceStock===3&&created.totalBefore===created.totalAfter,created);
 await p.getByTestId('inventory-product-family:'+created.familyId).click();
 await p.getByTestId('product-detail-labels').click();
 const dl=p.waitForEvent('download');await p.getByTestId('labels-download').click();const download=await dl;
 const pdfPath=path.join(evidence,'etiqueta-nueva.pdf');await download.saveAs(pdfPath);
 const pdf=fs.readFileSync(pdfPath);
 check('el producto recién creado descarga un PDF real',pdf.subarray(0,5).toString()==='%PDF-'&&download.suggestedFilename().endsWith('.pdf'));
 await p.getByTestId('label-modal-close').click();await p.getByTestId('product-detail-close').click();
 await p.evaluate(()=>window.__h136Root.render(React.createElement(POSScreen,{layout:'side',catalogView:'grid'})));
 const input=p.getByTestId('pos-barcode-input');
 await input.fill(created.barcode);await input.press('Enter');
 check('la etiqueta nueva agrega la referencia exacta al resumen',await p.getByTestId('ticket-line-'+created.id).count()===1);
 await input.fill(created.sourceBarcode);await input.press('Enter');
 check('el código de origen sigue agregando su propia referencia',await p.getByTestId('ticket-line-'+created.sourceId).count()===1);
 // Recarga desde persistencia real del navegador; no se reinyectan los productos.
 await p.reload();await p.waitForFunction(()=>window.POSScreen&&window.DATA);
 const reloaded=await p.evaluate(created=>({target:BARCODES.resolve(created.barcode).hit?.productId,
   source:BARCODES.resolve(created.sourceBarcode).hit?.productId,targetStock:DATA.products.find(row=>row.id===created.id)?.stockQuantity}),created);
 check('recargar conserva ambos códigos y el stock separado',reloaded.target===created.id&&reloaded.source===created.sourceId&&reloaded.targetStock===2,reloaded);
 await p.evaluate(()=>{
   AUTH.canAccess=()=>true;AUTH.isAdmin=()=>false;AUTH.role=()=> 'vendedor';
   document.body.innerHTML='<div id="h136-toast"></div><div id="h136-root"></div>';
   ReactDOM.createRoot(document.getElementById('h136-toast')).render(React.createElement(UI.ToastHost));
   window.__h136Root=ReactDOM.createRoot(document.getElementById('h136-root'));
   window.__h136Root.render(React.createElement(POSScreen,{layout:'side',catalogView:'grid'}));
   window.__h136Before=JSON.stringify([DATA.products,DATA.sales,DATA.payments,DATA.movements]);
 });
 await input.waitFor();
 const unknown='39999999999999999999999999';
 await input.evaluate(node=>node.blur());
 // Ráfaga determinista: un proceso de pruebas ocupado no representa una pausa
 // física de la lectora. El tecleo humano se ejerce por teclado real más abajo.
 const burst=code=>p.evaluate(code=>{
   for(const key of code)window.dispatchEvent(new KeyboardEvent('keydown',{key,code:'Digit'+key,bubbles:true}));
   window.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true}));
 },code);
 await burst(unknown);
 await p.waitForTimeout(100);
 const globalText=await p.getByTestId('toast').allTextContents();
 check('una lectura V3 desconocida fuera del buscador explica cómo continuar',globalText.some(text=>/No encontramos un producto con este código/.test(text)&&/Busca.*nombre/.test(text)),globalText);
 await input.fill(unknown);await input.press('Enter');await p.waitForTimeout(100);
 const directText=await p.getByTestId('toast').allTextContents();
 check('el buscador da el mismo aviso humano sin mostrar la cadena numérica',directText.some(text=>/No encontramos un producto con este código/.test(text)&&/Busca.*nombre/.test(text))&&!directText.some(text=>text.includes(unknown)),directText);
 check('una lectura desconocida no agrega ni abre otra referencia',await p.locator('[data-testid^="ticket-line-"]').count()===0&&await p.getByTestId('family-size-picker').count()===0);
 // Un nombre comercial que coincide con el número no puede sustituir al barcode.
 await p.evaluate(unknown=>{DATA.products[0].nombre=unknown;},unknown);
 await input.fill('');await input.fill(unknown);await input.press('Enter');
 check('un nombre coincidente no convierte un barcode desconocido en selección comercial',await p.getByTestId('family-size-picker').count()===0);
 await p.screenshot({path:path.join(evidence,'unknown-code.png'),fullPage:true});
 // El nombre usado para la prueba se restaura antes de comparar efectos.
 await p.evaluate(()=>{DATA.products[0].nombre=JSON.parse(window.__h136Before)[0][0].nombre;});
 check('las lecturas fallidas no alteran productos, ventas, pagos ni movimientos',await p.evaluate(()=>window.__h136Before===JSON.stringify([DATA.products,DATA.sales,DATA.payments,DATA.movements])));
 check('el aviso conserva diagnóstico y no inventa un fallo de red',await p.evaluate(()=>{
   const message=UI.messageAuthority({code:'BARCODE_NOT_FOUND',message:'unknown V3 scan'});
   return message.title==='No encontramos un producto con este código'&&message.technicalDetails.includes('BARCODE_NOT_FOUND')&&!/conexión|servidor/.test(message.explanation);
 }));
 for(const width of [320,360,390,430,768,1024,1280,1440]){
   await p.setViewportSize({width,height:950});await input.fill(unknown);await input.press('Enter');
   const notice=p.getByTestId('toast').filter({hasText:'No encontramos un producto con este código'}).first();
   const box=await notice.boundingBox();
   check('aviso legible dentro de pantalla '+width,box&&box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=951);
   if(width===360){
     const ratios=await notice.evaluate(node=>{
       const rgb=s=>s.match(/[\d.]+/g).map(Number);
       const bg=rgb(getComputedStyle(node).backgroundColor);
       const luminance=c=>c.slice(0,3).map(x=>x/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[0.2126,0.7152,0.0722][i],0);
       return [...node.querySelectorAll('p')].map(el=>{
         const fg=rgb(getComputedStyle(el).color),alpha=fg[3]??1;
         const l1=luminance(fg.slice(0,3).map((v,i)=>alpha*v+(1-alpha)*bg[i])),l2=luminance(bg);
         return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
       });
     });
     check('título, explicación y acción contrastan con el fondo',ratios.length===3&&ratios.every(value=>value>=4.5),ratios);
   }
   if(width===360)await p.screenshot({path:path.join(evidence,'unknown-code-mobile.png')});
 }
 const human=await p.evaluateHandle(()=>{const el=document.createElement('input');el.dataset.testid='h136-human-input';document.body.append(el);return el;});
 await human.asElement().fill('Cliente Ana');await human.asElement().focus();
 await p.keyboard.type(' Perez',{delay:5});await p.keyboard.press('Enter');
 check('el tecleo humano en otro campo se conserva',await human.asElement().inputValue()==='Cliente Ana Perez');
 await human.asElement().evaluate(el=>el.blur());
 await burst(created.barcode);await p.waitForTimeout(50);
 check('la captura global de un código válido continúa funcionando',await p.getByTestId('ticket-line-'+created.id).count()===1);
 check('sin excepciones de navegador',errors.length===0,errors);
 fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({created,checks},null,2));
}finally{await browser.close();if(server)server.close();}
console.log(`H-136: ${checks.filter(x=>x.ok).length}/${checks.length} · ${evidence}`);
process.exitCode=checks.some(x=>!x.ok)?1:0;
