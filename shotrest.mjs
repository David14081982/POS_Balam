import { chromium } from 'playwright-core';
import path from 'path'; import url from 'url';
const f = url.pathToFileURL(path.resolve('POS Balam (offline).html')).href;
const b = await chromium.launch({ channel:'chrome', headless:true });
const p = await b.newPage({ viewport:{width:1440,height:900} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(f,{waitUntil:'load'}); await p.waitForTimeout(4500);
for (const [nav,file] of [['Reportes','shot-reportes.png'],['Clientes','shot-clientes.png'],['Vendedores','shot-vendedores.png']]){
  try{ await p.getByRole('button',{name:nav}).first().click({timeout:4000}); await p.waitForTimeout(1800);}catch(e){console.log('nav',nav,e.message);}
  await p.screenshot({path:file}); console.log('shot',file);
}
console.log('errs',errs.length); await b.close();
