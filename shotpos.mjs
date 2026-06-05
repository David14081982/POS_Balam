import { chromium } from 'playwright-core';
import path from 'path'; import url from 'url';
const f = url.pathToFileURL(path.resolve('POS Balam (offline).html')).href;
const b = await chromium.launch({ channel:'chrome', headless:true });
const p = await b.newPage({ viewport:{width:1440,height:950} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto(f,{waitUntil:'load'}); await p.waitForTimeout(5000);
try{ await p.getByRole('button',{name:'Punto de venta'}).first().click({timeout:4000}); await p.waitForTimeout(2500);}catch(e){console.log('nav',e.message);}
await p.screenshot({path:'shot-pos.png'});
console.log('errs',errs.length);
await b.close();
