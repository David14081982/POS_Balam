// H-103 · conserva la proyección H-102 y restaura chips compactos por talla.
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
const root=resolve('.'),evidence=resolve('.evidence-h103');mkdirSync(evidence,{recursive:true});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'};
const server=createServer((req,res)=>{const path=resolve(root,decodeURIComponent(req.url.split('?')[0]).replace(/^\//,'')||'index.html');if(!path.startsWith(root)){res.writeHead(403);res.end();return;}res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'});createReadStream(path).on('error',()=>{res.writeHead(404);res.end();}).pipe(res);});
await new Promise(done=>server.listen(8913,'127.0.0.1',done));let pass=0,fail=0;const ok=(name,value,detail='')=>{console.log(`${value?'✅':'❌'} ${name}${detail?` · ${detail}`:''}`);value?pass++:fail++;};let browser;
try{
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  await context.route(/supabase\.co/,route=>route.fulfill({status:401,contentType:'application/json',body:'{}'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('balam-page','inventario'));
  await page.goto('http://127.0.0.1:8913/index.html');await page.waitForFunction(()=>window.DATA&&window.CONFIG);
  const fixture=await page.evaluate(()=>{const D=window.DATA,familyId='10300000-0000-4000-8000-000000000103';const base={referenceFamilyId:familyId,cat:'1',modelo:'COM',nombre:'COMPACTO H103',manga:'ML',tela:'ALG',color:'BL',cuello:'TRA',orn:'BEL',precio:1200,sizeCategoryId:'size_number',sizeScale:'N',attrs:{producto:'COM'}};const refs=[];for(const [size,stock,colors] of [['36',2,['DRO']],['38',4,['DRO']],['40',3,['DRO']],['40',2,['AZL']],['42',1,['DRO']]])refs.push(D.createReference({...base,sizeCode:size,stockQuantity:stock,ornamentColorCodes:colors},refs));localStorage.setItem('balam_pos_products_v2',JSON.stringify(refs));return{familyId,total:refs.reduce((sum,row)=>sum+row.stockQuantity,0),ids:refs.map(row=>row.id)};});
  await page.reload();await page.getByTestId('inventory-product-family:'+fixture.familyId).click();
  const stock=page.getByTestId('product-detail-size-stock');await stock.waitFor();
  ok('1. conserva la proyección familiar completa',fixture.total===12&&await page.getByTestId('product-detail-size-chip').count()===4);
  const text=await stock.innerText();ok('2. muestra talla y cantidad agregada',['36','2 pz','38','4 pz','40','5 pz','42','1 pz'].every(value=>text.includes(value)),text.replace(/\n/g,' | '));
  ok('3. desglosa las dos referencias físicas de talla 40',text.includes('DRO')&&text.includes('AZL')&&text.includes('3 pz')&&text.includes('2 pz'));
  for(const width of [320,360,390,430,1280]){
    await page.setViewportSize({width,height:800});
    await stock.scrollIntoViewIfNeeded();
    const metrics=await stock.evaluate(node=>{const style=getComputedStyle(node),chips=[...node.children].map(child=>child.getBoundingClientRect()),rect=node.getBoundingClientRect();return{display:style.display,wrap:style.flexWrap,overflow:Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth),container:rect.width,widths:chips.map(item=>item.width),tops:[...new Set(chips.map(item=>Math.round(item.top)))]};});
    ok(`4.${width} usa chips compactos sin overflow`,metrics.display==='flex'&&metrics.wrap==='wrap'&&metrics.overflow===0&&metrics.widths.every(value=>value<metrics.container),JSON.stringify(metrics));
    await page.screenshot({path:resolve(evidence,`detalle-existencias-${width}.png`),fullPage:true});
  }
  ok('5. recorrido sin errores de página',errors.length===0,errors.join(' | '));
}finally{if(browser)await browser.close();await new Promise(done=>server.close(done));}
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);process.exit(fail?1:0);
