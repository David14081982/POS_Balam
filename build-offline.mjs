// build-offline.mjs — Regenera "POS Balam (offline).html" desde el source modular.
// Embebe módulos balam/*, libs CDN (react/babel/xlsx/tailwind) y fuentes woff2 → 100% offline.
// Reusa el loader/skeleton del bundle existente (solo reemplaza manifest + template).
// Uso: node build-offline.mjs
import fs from 'fs';
import zlib from 'zlib';
import { randomUUID } from 'crypto';
import { execSync } from 'child_process';

const OUT = 'POS Balam (offline).html';
// El .html del nivel raíz desaparece (OneDrive/AV). Guardo copia estable en balam/ y uso fallback.
const SAFE = 'balam/_source.html';
let SRC = 'POS Balam.html';
if (fs.existsSync(SRC)) {
  try { fs.copyFileSync(SRC, SAFE); } catch (e) { /* ignore */ }
} else if (fs.existsSync(SAFE)) {
  console.warn('POS Balam.html no existe; restaurando desde', SAFE);
  try { fs.copyFileSync(SAFE, SRC); } catch (e) { SRC = SAFE; }
}
// Wrapper = loader/skeleton. Uso el BACKUP si existe, si no el OUT actual (que ya tiene el loader).
const WRAPPER = fs.existsSync('POS Balam (offline).BACKUP.html') ? 'POS Balam (offline).BACKUP.html' : OUT;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const MIME = { js: 'text/javascript', jsx: 'text/jsx', css: 'text/css', woff2: 'font/woff2' };

const manifest = {};
function addBytes(buf, mime, compress = true) {
  const uuid = randomUUID();
  let data = buf, compressed = false;
  if (compress) { data = zlib.gzipSync(buf); compressed = true; }
  manifest[uuid] = { data: Buffer.from(data).toString('base64'), mime, compressed };
  return uuid;
}
async function fetchBuf(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(url.slice(0, 70) + ' -> HTTP ' + r.status);
  return Buffer.from(await r.arrayBuffer());
}

let template = fs.readFileSync(SRC, 'utf8');

// 1) Módulos locales balam/* (scripts .jsx + .css)
const localPaths = [...new Set([...template.matchAll(/(?:src|href)="(balam\/[^"]+)"/g)].map(m => m[1]))];
for (const p of localPaths) {
  const ext = p.split('.').pop();
  const uuid = addBytes(fs.readFileSync(p), MIME[ext] || 'application/octet-stream', true);
  template = template.split('"' + p + '"').join('"' + uuid + '"');
  console.log('local  ', p);
}

// 1.5) Tailwind → CSS estático (Play CDN no funciona tras document swap del loader)
const twCdnRe = /<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"><\/script>\s*/;
const twCfgRe = /<script>\s*tailwind\.config[\s\S]*?<\/script>\s*/;
const cfgMatch = template.match(twCfgRe);
if (cfgMatch) {
  const inner = cfgMatch[0].replace(/^<script>/, '').replace(/<\/script>\s*$/, '');
  const cfg = new Function('const tailwind={};' + inner + ';return tailwind.config;')();
  cfg.content = ['./balam/*.jsx'];
  fs.writeFileSync('.tw.config.cjs', 'module.exports = ' + JSON.stringify(cfg) + ';');
  fs.writeFileSync('.tw.in.css', '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n');
  console.log('compilando tailwind estático (npx tailwindcss)…');
  execSync('npx --yes tailwindcss@3.4.17 -c .tw.config.cjs -i .tw.in.css -o .tw.out.css --minify', { stdio: 'inherit' });
  const css = fs.readFileSync('.tw.out.css', 'utf8');
  template = template.replace(twCfgRe, '').replace(twCdnRe, '<style id="tw-static">' + css + '</style>\n');
  for (const f of ['.tw.config.cjs', '.tw.in.css', '.tw.out.css']) if (fs.existsSync(f)) fs.unlinkSync(f);
  console.log('tailwind estático:', (css.length / 1024).toFixed(0) + 'KB embebido');
} else { console.warn('  AVISO: no hallé tailwind.config; queda Play CDN (puede fallar en bundle)'); }

// 2) Libs CDN en src="https://..." (react, react-dom, babel, xlsx)
const cdnSrcs = [...new Set([...template.matchAll(/src="(https:\/\/[^"]+)"/g)].map(m => m[1]))];
for (const url of cdnSrcs) {
  try {
    const uuid = addBytes(await fetchBuf(url), 'text/javascript', true);
    template = template.split('"' + url + '"').join('"' + uuid + '"');
    console.log('cdn js ', url.slice(0, 60));
  } catch (e) { console.warn('  SKIP (queda online):', e.message); }
}

// 3) Google Fonts <link href="...css2..."> → inline <style> con woff2 embebidos
const fontLinks = [...template.matchAll(/<link[^>]*href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"[^>]*>/g)];
for (const m of fontLinks) {
  const linkTag = m[0], cssUrl = m[1];
  try {
    let css = (await fetchBuf(cssUrl)).toString('utf8');
    const woffs = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g)].map(x => x[1]))];
    for (const w of woffs) { const uuid = addBytes(await fetchBuf(w), 'font/woff2', false); css = css.split(w).join(uuid); }
    template = template.replace(linkTag, '<style>\n' + css + '\n</style>');
    console.log('font   ', cssUrl.slice(0, 50), '·', woffs.length, 'woff2');
  } catch (e) { console.warn('  SKIP font (queda online):', e.message); }
}

// 3.5) Imágenes remotas en balam/*.jsx (Unsplash + Google) → embebidas como blob (offline)
const allJsx = fs.readdirSync('balam').filter(f => f.endsWith('.jsx')).map(f => fs.readFileSync('balam/' + f, 'utf8')).join('\n');
const imgUrls = [...new Set([...allJsx.matchAll(/https:\/\/(?:images\.unsplash\.com|lh3\.googleusercontent\.com)\/[^"'\s)]+/g)].map(m => m[0]))];
const imgMap = {};
for (const u of imgUrls) {
  try {
    const mime = u.includes('lh3.googleusercontent') ? 'image/png' : 'image/jpeg';
    imgMap[u] = addBytes(await fetchBuf(u), mime, false);
    console.log('foto   ', u.slice(0, 52));
  } catch (e) { console.warn('  SKIP foto:', e.message); }
}
if (Object.keys(imgMap).length) {
  template = template.replace('</head>', '<script>window.__IMG_MAP=' + JSON.stringify(imgMap) + ';</script>\n</head>');
  console.log('fotos embebidas:', Object.keys(imgMap).length);
}

// 4) Inyectar en el wrapper (loader/skeleton existente): reemplazar 3 bloques
let wrapper = fs.readFileSync(WRAPPER, 'utf8');
function setBlock(html, type, content) {
  const open = '<script type="__bundler/' + type + '">';
  const i = html.indexOf(open);
  if (i < 0) throw new Error('bloque faltante: ' + type);
  const s = i + open.length, e = html.indexOf('</script>', s);
  return html.slice(0, s) + content + html.slice(e);
}
const esc = (s) => s.split('</').join('<\\/'); // no cerrar el <script> contenedor
wrapper = setBlock(wrapper, 'manifest', esc(JSON.stringify(manifest)));
wrapper = setBlock(wrapper, 'ext_resources', '[]');
wrapper = setBlock(wrapper, 'template', esc(JSON.stringify(template)));

fs.writeFileSync(OUT, wrapper);
// index.html = copia exacta del bundle, lista para servir en el VPS (entrada del sitio).
fs.writeFileSync('index.html', wrapper);
console.log('\nOK ->', OUT, '·', (wrapper.length / 1e6).toFixed(2) + 'MB ·', Object.keys(manifest).length, 'assets');
console.log('OK -> index.html (copia para deploy)');
