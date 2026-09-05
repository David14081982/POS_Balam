// QA de paneles y ciclo de edición. Chrome aislado, sin red comercial.
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const remote=process.argv.find(x=>/^https?:/.test(x));
const ref=process.argv.find(x=>x.startsWith('--entry-ref='))?.slice(12);
const html=ref?execFileSync('git',['show',ref+':index.html'],{maxBuffer:20*1024*1024}):fs.readFileSync('index.html');
const evidence=fs.mkdtempSync(path.join(os.tmpdir(),'balam-h141-'));
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[];const check=(name,ok)=>{checks.push({name,ok:!!ok});console.log(`${ok?'PASS':'FAIL'} ${name}`);};
try{
 const p=await browser.newPage({viewport:{width:1280,height:950}});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/*',r=>{const u=new URL(r.request().url());return u.hostname==='127.0.0.1'||(remote&&u.origin===new URL(remote).origin)?r.continue():r.abort();});
 await p.goto(remote||`http://127.0.0.1:${server.address().port}`);await p.waitForFunction(()=>window.SettingsScreen&&window.DATA);
 const expected=await p.evaluate(()=>{
  AUTH.canAccess=()=>true;CONFIG.addCatalog('Panel de prueba H141');
  window.__before=JSON.stringify([CONFIG.snapshot(),DATA.products]);window.__regen=0;
  DATA.regenerateSkus=()=>{window.__regen++;throw Error('No se autoriza regenerar en esta prueba');};
  document.body.innerHTML='<div id="h141-root"></div>';
  ReactDOM.createRoot(document.getElementById('h141-root')).render(React.createElement(SettingsScreen));
  return 16+Object.values(CONFIG.allCatalogMeta()).filter(x=>x.custom).length;
 });
 await p.getByTestId('settings-section-producto').click();
 const panels=p.locator('details[data-testid^="catalog-panel-"]');
 const count=await panels.count();check('cada tema, incluidos catálogos personalizados, tiene panel',count===expected);
 if(!count)throw Error('El artefacto aún no ofrece paneles plegables');
 check('todos comienzan cerrados',await panels.locator(':scope[open]').count()===0&&await p.locator('details[data-testid^="catalog-panel-"][open]').count()===0);
 const toggle=id=>p.getByTestId('catalog-panel-toggle-'+id).click();
 const isOpen=id=>p.getByTestId('catalog-panel-'+id).evaluate(n=>n.open);
 await toggle('category');await toggle('fabric');check('apertura independiente',await isOpen('category')&&await isOpen('fabric'));
 const body=p.getByTestId('catalog-panel-body-category');
 const code=body.getByPlaceholder('21',{exact:true}),label=body.getByPlaceholder('Nombre visible',{exact:true});
 await code.fill('H141');await label.fill('Borrador sin guardar');
 const node=await code.elementHandle();await toggle('category');
 check('plegar oculta sin desmontar campos',!await code.isVisible()&&await node.evaluate(n=>n.isConnected));
 check('cerrar uno conserva el otro abierto',await isOpen('fabric'));
 await toggle('category');check('reabrir conserva el borrador',await code.inputValue()==='H141'&&await label.inputValue()==='Borrador sin guardar');
 await p.evaluate(()=>window.dispatchEvent(new CustomEvent('configchange')));
 check('actualización de pantalla conserva apertura y borrador',await isOpen('category')&&await code.inputValue()==='H141');
 await toggle('category');await toggle('fabric');
 await toggle('newcat');await p.getByTestId('catalog-panel-body-newcat').getByPlaceholder('Nombre del catálogo').fill('Nuevo sin guardar');
 await toggle('newcat');await toggle('newcat');
 check('crear catálogo conserva su borrador al plegar',await p.getByTestId('catalog-panel-body-newcat').getByPlaceholder('Nombre del catálogo').inputValue()==='Nuevo sin guardar');
 await toggle('newcat');
 const keyboard=p.getByTestId('catalog-panel-toggle-sku');await keyboard.focus();await keyboard.press('Enter');
 check('Enter abre desde teclado',await isOpen('sku'));await keyboard.press('Space');check('Espacio cierra desde teclado',!await isOpen('sku'));
 check('abrir y cerrar no modifica configuración ni SKU',await p.evaluate(()=>window.__before===JSON.stringify([CONFIG.snapshot(),DATA.products])&&window.__regen===0));
 await toggle('category');
 const row=body.locator('[data-testid^="catalog-row-category-"]').first();const rowId=(await row.getAttribute('data-testid')).slice('catalog-row-category-'.length);
 await row.locator('input').first().fill('Nombre editado H141');await toggle('category');await toggle('category');
 check('edición existente conserva el guardado al salir del campo',await row.locator('input').first().inputValue()==='Nombre editado H141'&&await p.evaluate(id=>CONFIG.find('category',id).label==='Nombre editado H141',rowId));
 await p.getByTestId('settings-section-negocio').click();await p.getByTestId('settings-section-producto').click();
 check('volver a entrar inicia todos cerrados',await p.locator('details[data-testid^="catalog-panel-"][open]').count()===0);
 for(const width of [320,360,390,768,1280]){
  await p.setViewportSize({width,height:950});
  check('cabeceras completas y pulsables a '+width,await panels.evaluateAll(nodes=>nodes.every(n=>{const s=n.querySelector('summary'),r=s.getBoundingClientRect();return r.width>0&&r.height>=44&&r.left>=0&&r.right<=innerWidth+1&&s.scrollWidth<=s.clientWidth+1;})));
  if(width===360||width===1280)await p.screenshot({path:path.join(evidence,'closed-'+width+'.png'),fullPage:true});
 }
 for(const panel of await panels.all()){await panel.locator('summary').click();}
 check('todos pueden permanecer abiertos',await p.locator('details[data-testid^="catalog-panel-"][open]').count()===expected);
 await p.getByTestId('catalog-panel-category').scrollIntoViewIfNeeded();
 await p.screenshot({path:path.join(evidence,'open-desktop.png')});
 await p.setViewportSize({width:360,height:950});
 check('contenido ancho tiene desplazamiento y no queda cortado',await p.locator('[data-testid^="catalog-panel-body-"]').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1||getComputedStyle(n).overflowX==='auto')));
 await p.getByTestId('catalog-panel-category').scrollIntoViewIfNeeded();
 await p.screenshot({path:path.join(evidence,'open-mobile.png')});
 await p.getByTestId('settings-section-ventas').click();
 check('otras secciones conservan editor sin paneles',await panels.count()===0&&await p.getByTestId('catalog-row-payment_method-Efectivo').isVisible());
 check('sin excepciones',errors.length===0);
}catch(e){check('recorrido completo: '+e.message,false);}
finally{await browser.close();server.closeAllConnections();server.close();}
fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify(checks,null,2));
console.log(`H-141: ${checks.filter(x=>x.ok).length}/${checks.length} · ${evidence}`);process.exitCode=checks.some(x=>!x.ok)?1:0;
