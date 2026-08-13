import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const dir = resolve('.evidence-label-visual');
const files = [
  ['A · PDF anterior (referencia visual)', 'etiqueta-anterior-01.png'],
  ['B · Antes de corregir', 'etiqueta-actual-antes.png'],
  ['C · Nueva 60×40 (identidad V2)', 'etiqueta-h99-typical.png'],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1540, height: 620 }, deviceScaleFactor: 1 });
  const cards = (await Promise.all(files.map(async ([title, name]) => {
    const data = (await readFile(resolve(dir, name))).toString('base64');
    return `<section><h2>${title}</h2><div class="frame"><img src="data:image/png;base64,${data}"></div></section>`;
  }))).join('');
  await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;padding:30px;background:#eef0f4;font-family:Arial,sans-serif;color:#131b2e}h1{text-align:center;margin:0 0 26px;font-size:25px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}section{background:white;border:1px solid #c8cfdb;border-radius:16px;padding:16px;box-shadow:0 4px 16px #17203318}h2{text-align:center;font-size:17px;margin:0 0 14px}.frame{height:380px;display:grid;place-items:center;background:#fafafa;border:1px solid #e1e5ec;overflow:hidden}.frame img{display:block;max-width:100%;max-height:100%;object-fit:contain}</style><h1>Etiqueta Balam 60×40 · Comparativa visual</h1><main>${cards}</main>`, { waitUntil: 'load' });
  await page.screenshot({ path: resolve(dir, 'comparativa-a-b-c.png'), fullPage: true });
} finally { await browser.close(); }
