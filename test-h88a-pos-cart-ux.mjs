import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const root=resolve('.'), artifact=process.env.BALAM_ARTIFACT_PATH, mime={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=createServer((req,res)=>{const pathname=decodeURIComponent(req.url.split('?')[0]);const file=artifact&&(pathname==='/'||pathname==='/index.html')?resolve(artifact):join(root,pathname==='/'?'index.html':pathname);if(!file.startsWith(root)||!existsSync(file)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':artifact&&file===resolve(artifact)?'text/html':(mime[extname(file)]||'application/octet-stream')});createReadStream(file).pipe(res);});
await new Promise(r=>server.listen(8896,'127.0.0.1',r));
let browser,passed=0;const failures=[];const check=(ok,name,detail='')=>ok?passed++:failures.push(name+(detail?' · '+detail:''));
try{
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext();
  await context.route(/supabase\.co/,route=>route.fulfill({status:401,contentType:'application/json',body:'{}'}));
  const page=await context.newPage();await page.addInitScript(()=>localStorage.setItem('balam-sidebar','1'));
  await page.goto('http://127.0.0.1:8896/index.html');await page.waitForFunction(()=>window.App&&window.DATA);
  await page.evaluate(()=>{const c=window.CONFIG,o=c.codes;c.codes=function(k){return k==='payment_method'?['Efectivo']:o.apply(this,arguments)};try{window.DATA.seedDemo()}finally{c.codes=o}localStorage.setItem('balam-page','pos');});await page.reload();
  for(const width of [320,360,390,430,768,1024,1280,1440]){
    await page.setViewportSize({width,height:width<500?700:800});await page.waitForFunction(width=>width<1280?!!document.querySelector('[data-testid="pos-cart-access"]'):!document.querySelector('[data-testid="pos-cart-access"]'),width);
    const s=await page.evaluate(width=>{const access=document.querySelector('[data-testid="pos-cart-access"]'),inline=document.querySelector('main > div > aside'),surface=document.querySelector('[data-testid="pos-cart-surface"]');return{access:!!access,inline:!!inline,surface:!!surface,overflow:document.documentElement.scrollWidth-width,accessRect:access&&access.getBoundingClientRect().toJSON()};},width);
    check(s.overflow<=0,`${width}px sin overflow`,String(s.overflow));
    check(width<1280?s.access&&!s.inline:!s.access&&s.inline,`${width}px usa composición correcta`,JSON.stringify(s));
    if(width<1280)check(s.accessRect&&s.accessRect.bottom<= (width<500?700:800)+1,`${width}px acceso visible`);
  }
  await page.setViewportSize({width:390,height:700});
  await page.locator('button[title="Agregar"]').first().click();await page.locator('[role="dialog"] button').last().click();
  const feedback=page.getByTestId('pos-cart-access');check(await feedback.innerText().then(t=>/Ver venta \(1\)/i.test(t)),'cantidad visible al agregar');check(await feedback.innerText().then(t=>/agregado/i.test(t)),'feedback no invasivo visible');
  await page.getByTestId('pos-cart-open').click();check(await page.getByTestId('pos-cart-surface').isVisible(),'bottom sheet móvil abre');check(await page.locator('[data-testid="pos-cart-surface"] main aside, [data-testid="pos-cart-surface"] aside').count()<=1,'una sola superficie editable');
  await page.keyboard.press('Tab');check(await page.evaluate(()=>!!document.activeElement.closest('[data-testid="pos-cart-surface"]')),'foco permanece en carrito');await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement?.dataset?.testid==='pos-cart-open');check(!(await page.getByTestId('pos-cart-surface').count()),'Escape cierra');check(await page.evaluate(()=>document.activeElement?.dataset?.testid==='pos-cart-open'),'foco vuelve al acceso');
  await page.setViewportSize({width:768,height:800});await page.waitForTimeout(80);await page.getByTestId('pos-cart-open').click();const tablet=await page.getByTestId('pos-cart-surface').boundingBox();check(tablet&&tablet.x>0&&Math.round(tablet.height)===800,'tablet usa drawer lateral',JSON.stringify(tablet));
  console.log(`H-88A carrito POS: ${passed} pasaron, ${failures.length} fallaron`);failures.forEach(x=>console.error('❌ '+x));if(failures.length)process.exitCode=1;
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
