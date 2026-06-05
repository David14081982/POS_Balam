import { chromium } from 'playwright-core';
import path from 'path'; import url from 'url';
const f = url.pathToFileURL(path.resolve('montage.html')).href;
const b = await chromium.launch({ channel:'chrome', headless:true });
const p = await b.newPage({ viewport:{width:1500,height:900} });
await p.goto(f,{waitUntil:'networkidle'}); await p.waitForTimeout(2000);
await p.screenshot({path:'montage.png',fullPage:true}); await b.close(); console.log('ok');
