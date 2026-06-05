import { chromium } from 'playwright-core';
import path from 'path'; import url from 'url';
const f = url.pathToFileURL(path.resolve('POS Balam (offline).html')).href;
const b = await chromium.launch({ channel:'chrome', headless:true });
const p = await b.newPage({ viewport:{width:1440,height:1400} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(f,{waitUntil:'load'}); await p.waitForTimeout(4500);
try{ await p.getByRole('button',{name:'Clientes'}).first().click({timeout:4000}); await p.waitForTimeout(1000);
     await p.getByRole('button',{name:'Nuevo cliente'}).first().click({timeout:4000}); await p.waitForTimeout(1200);}catch(e){console.log('nav',e.message);}
await p.screenshot({path:'shot-nuevocliente.png',fullPage:true});
console.log('errs',errs.length); errs.slice(0,5).forEach(e=>console.log(e.slice(0,150)));
await b.close();
