// build-offline.mjs — Regenera "POS Balam (offline).html" desde el source modular.
// Embebe módulos balam/* (JSX PRECOMPILADO en build: el bundle no carga Babel ni compila
// en el navegador), libs CDN (react production/xlsx/tailwind) y fuentes woff2 → 100% offline.
// Reusa el loader/skeleton del bundle existente (solo reemplaza manifest + template).
// Uso: node build-offline.mjs
import fs from 'fs';
import zlib from 'zlib';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const OUT = 'POS Balam (offline).html';
const RESOURCE_CACHE = process.env.BALAM_BUILD_RESOURCE_CACHE || 'balam/vendor/build-resources.json';
const REFRESH_RESOURCES = process.env.BALAM_REFRESH_BUILD_RESOURCES === '1';
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
const resourceCache = fs.existsSync(RESOURCE_CACHE)
  ? JSON.parse(fs.readFileSync(RESOURCE_CACHE, 'utf8'))
  : {};

const manifest = {};
function assetId(buf, mime, compress) {
  const hex = createHash('sha256')
    .update(mime).update('\0')
    .update(compress ? 'gzip' : 'raw').update('\0')
    .update(buf)
    .digest('hex')
    .slice(0, 32);
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20),
  ].join('-');
}
function addBytes(buf, mime, compress = true) {
  const uuid = assetId(buf, mime, compress);
  let data = buf, compressed = false;
  if (compress) { data = zlib.gzipSync(buf); compressed = true; }
  manifest[uuid] = { data: Buffer.from(data).toString('base64'), mime, compressed };
  return uuid;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[n] = value >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let value = 0xffffffff;
  for (const byte of buf) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}
function fallbackIconPng(size, maskable = false) {
  const width = size, height = size;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  const navy = [0x13, 0x1b, 0x2e, 0xff], gold = [0xff, 0xe0, 0x88, 0xff];
  const motifScale = maskable ? 0.82 : 1;
  const cx = .5, cy = .5, radius = .33 * motifScale;
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1); rows[row] = 0;
    for (let x = 0; x < width; x++) {
      const nx = (x + .5) / width, ny = (y + .5) / height;
      const inGold = Math.hypot(nx - cx, ny - cy) <= radius;
      const vertical = nx >= cx - .105 * motifScale && nx <= cx - .035 * motifScale
        && ny >= cy - .19 * motifScale && ny <= cy + .19 * motifScale;
      const lobe = [cy - .095 * motifScale, cy + .095 * motifScale].some(centerY => {
        const distance = Math.hypot(nx - (cx - .015 * motifScale), ny - centerY);
        return nx >= cx - .06 * motifScale && distance >= .065 * motifScale && distance <= .13 * motifScale;
      });
      const color = inGold && !(vertical || lobe) ? gold : navy;
      const offset = row + 1 + x * 4;
      rows[offset] = color[0]; rows[offset + 1] = color[1]; rows[offset + 2] = color[2]; rows[offset + 3] = color[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
async function fetchBuf(url) {
  const cached = resourceCache[url];
  if (!REFRESH_RESOURCES) {
    if (!cached) throw new Error('recurso no fijado: ' + url);
    const buf = Buffer.from(cached.data, 'base64');
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== cached.sha256) throw new Error('hash inválido en cache: ' + url);
    return buf;
  }
  const r = await globalThis.fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(url.slice(0, 70) + ' -> HTTP ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  resourceCache[url] = {
    sha256: createHash('sha256').update(buf).digest('hex'),
    data: buf.toString('base64'),
  };
  return buf;
}

let template = fs.readFileSync(SRC, 'utf8');

// 0) Precompilar JSX EN EL BUILD. El bundle deja de cargar Babel (~3MB) y de compilar
// los ~7800 renglones de JSX en el navegador en cada arranque: aquí se transpilan UNA
// vez con el MISMO @babel/standalone (misma URL/versión del template → mismo output)
// y el bundle recibe JavaScript listo para ejecutar. El dev "POS Balam.html" NO cambia
// (sigue compilando al vuelo para editar cómodo). Si Babel no se puede descargar, el
// build degrada al comportamiento anterior (Babel en runtime) sin fallar.
let transpile = null;
const babelUrl = (template.match(/https:\/\/unpkg\.com\/@babel\/standalone[^"]+/) || [])[0];
if (babelUrl) {
  try {
    const vm = await import('vm');
    const sandbox = { console };
    vm.createContext(sandbox);
    vm.runInContext((await fetchBuf(babelUrl)).toString('utf8'), sandbox);
    const B = sandbox.Babel;
    // presets ['react']: el mismo default que transformScriptTags aplica a text/babel.
    transpile = (src, filename) => B.transform(src, { presets: ['react'], filename }).code;
    console.log('babel  ', 'precompilando JSX en build (' + babelUrl.slice(29, 55) + ')');
  } catch (e) {
    throw new Error('no se pudo cargar Babel fijado: ' + e.message);
  }
}

// 1) Módulos locales balam/* (scripts .jsx + .css)
const localPaths = [...new Set([...template.matchAll(/(?:src|href)="(balam\/[^"]+)"/g)].map(m => m[1]))];
for (const p of localPaths) {
  const ext = p.split('.').pop();
  let buf = fs.readFileSync(p), mime = MIME[ext] || 'application/octet-stream';
  if (transpile && ext === 'jsx') { buf = Buffer.from(transpile(buf.toString('utf8'), p), 'utf8'); mime = 'text/javascript'; }
  const uuid = addBytes(buf, mime, true);
  template = template.split('"' + p + '"').join('"' + uuid + '"');
  console.log('local  ', p + (transpile && ext === 'jsx' ? ' (precompilado)' : ''));
}

if (transpile) {
  // Tags de módulos: text/babel → script clásico. El loader ya los ejecuta en orden
  // (recrea cada <script> y espera su onload); solo dejan de pasar por Babel.
  template = template.replace(/<script type="text\/babel" src="/g, '<script src="');
  // Scripts text/babel INLINE (el boot de ReactDOM al final): transpilar su contenido.
  // Se ejecuta en orden de documento, después de todos los módulos — mismo efecto que
  // transformScriptTags. Guard: si un tag inline trajera src, se deja intacto.
  template = template.replace(/<script type="text\/babel"([^>]*)>([\s\S]*?)<\/script>/g,
    (m, attrs, code) => /src=/.test(attrs) ? m : '<script>\n' + transpile(code, 'inline-boot.jsx') + '\n</script>');
  // Babel ya no se necesita en runtime: fuera su <script> (no se descarga ni embebe).
  template = template.replace(/\s*<script src="https:\/\/unpkg\.com\/@babel\/standalone[^"]*"[^>]*><\/script>/, '');
  // React de producción (sin verificaciones de desarrollo: más ligero y rápido). Se
  // quitan integrity/crossorigin de esos tags: el hash SRI era del build development
  // (el loader los strippea en runtime de todas formas, pero mejor no dejar SRI falso).
  template = template.replace(/src="(https:\/\/unpkg\.com\/react(?:-dom)?@[^"]*)\.development\.js"[^>]*>/g,
    (m, base) => 'src="' + base + '.production.min.js">');
  console.log('babel  ', 'bundle sin Babel runtime · React production');
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
  console.log('compilando tailwind estático (dependencia local)…');
  execSync('node node_modules/tailwindcss/lib/cli.js -c .tw.config.cjs -i .tw.in.css -o .tw.out.css --minify', { stdio: 'inherit' });
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
  } catch (e) {
    throw new Error('no se pudo fijar script externo: ' + e.message);
  }
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
  } catch (e) {
    throw new Error('no se pudo fijar fuente externa: ' + e.message);
  }
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
  } catch (e) {
    throw new Error('no se pudo fijar imagen externa: ' + e.message);
  }
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

// H-89: recursos HTTP externos al HTML autocontenido. Las fuentes viven en balam/;
// estos archivos de raíz son artefactos reproducibles para GitHub Pages.
const buildHash = createHash('sha256').update(wrapper).digest('hex').slice(0, 20);
const swSource = fs.readFileSync('balam/pwa-sw.js', 'utf8');
if (!swSource.includes('__BALAM_BUILD_HASH__')) throw new Error('token PWA build hash faltante');
fs.writeFileSync('sw.js', swSource.replaceAll('__BALAM_BUILD_HASH__', buildHash));
fs.copyFileSync('balam/pwa-manifest.webmanifest', 'manifest.webmanifest');
fs.mkdirSync('pwa', { recursive: true });
fs.writeFileSync('pwa/icon-192.png', fallbackIconPng(192));
fs.writeFileSync('pwa/icon-512.png', fallbackIconPng(512));
fs.writeFileSync('pwa/icon-maskable-512.png', fallbackIconPng(512, true));
fs.writeFileSync('pwa/apple-touch-icon.png', fallbackIconPng(180));
fs.writeFileSync('pwa/favicon-64.png', fallbackIconPng(64));
if (REFRESH_RESOURCES) {
  fs.writeFileSync(RESOURCE_CACHE, JSON.stringify(resourceCache, null, 2) + '\n');
  console.log('OK ->', RESOURCE_CACHE, '·', Object.keys(resourceCache).length, 'recursos fijados');
}
console.log('\nOK ->', OUT, '·', (wrapper.length / 1e6).toFixed(2) + 'MB ·', Object.keys(manifest).length, 'assets');
console.log('OK -> index.html (copia para deploy)');
console.log('OK -> PWA shell', buildHash, '· manifest, service worker y 5 iconos');
