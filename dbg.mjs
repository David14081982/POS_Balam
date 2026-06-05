import { chromium } from 'playwright-core';
import path from 'path'; import url from 'url';
const f = url.pathToFileURL(path.resolve('POS Balam (offline).html')).href;
const b = await chromium.launch({ channel:'chrome', headless:true });
const p = await b.newPage();
await p.goto(f,{waitUntil:'load'}); await p.waitForTimeout(4500);
const r = await p.evaluate(()=>{
  const map = window.__IMG_MAP;
  const prod = window.DATA && window.DATA.products[0];
  const imagen = prod && prod.imagen;
  return {
    hasMap: !!map,
    mapKeys: map ? Object.keys(map).length : 0,
    firstKey: map ? Object.keys(map)[0] : null,
    firstVal: map ? Object.values(map)[0] : null,
    prodImagen: imagen,
    mapHasImagen: map && imagen ? !!map[imagen] : null,
    imgCount: document.querySelectorAll('img').length,
    firstImgSrc: (document.querySelector('img')||{}).src,
  };
});
console.log(JSON.stringify(r,null,2));
await b.close();
