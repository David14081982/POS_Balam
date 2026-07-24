// test-auto-fotos.mjs — Las fotos incrustadas se suben SOLAS a la nube (sin pulsar botón).
// STORE.autoMigratePhotos corre en el arranque (init con pull) y al reconectar. Se prueba
// contra el cliente Supabase real de la app, con auth/storage stubbeados en el cliente cacheado
// (autoMigratePhotos usa ese mismo cliente), sin tocar la nube de verdad.
import { chromium } from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';

const ROOT = path.resolve('.');
const MIME = { '.html': 'text/html', '.jsx': 'text/babel', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/POS Balam.html';
  const fp = path.join(ROOT, p);
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8812, '127.0.0.1', r));

let pass = 0, fail = 0; const errs = [];
const check = (n, c, e = '') => { console.log(`${c ? '✅' : '❌'} ${n}${e ? ' · ' + e : ''}`); c ? pass++ : fail++; };

const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage();
page.on('pageerror', e => errs.push(String(e)));
await page.route(/supabase\.co/, r => r.abort()); // cero tráfico real a la nube
await page.goto('http://127.0.0.1:8812/POS%20Balam.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.STORE && window.CONFIG, null, { timeout: 25000 });
await page.waitForFunction(() => !!window.supabase, null, { timeout: 25000 }); // CDN cargó

const REAL = 'https://telohdbvbvsfmwyriflz.supabase.co/storage/v1/object/public/product-photos/prod-real.jpg';

// Stubs en el cliente CACHEADO (el mismo que usa autoMigratePhotos): sesión OK y storage falso.
async function stubCloud(conSesion) {
  await page.evaluate(async ({ conSesion }) => {
    const c = await window.STORE.ensureClient();
    c.auth.getSession = async () => ({ data: { session: conSesion ? { user: { id: 'u1' } } : null } });
    let uploads = 0;
    c.storage.from = (bucket) => ({
      upload: async () => { uploads++; return { error: null }; },
      getPublicUrl: (p) => ({ data: { publicUrl: 'https://fakecloud/' + bucket + '/' + p } }),
    });
    window.__uploads = () => uploads;
  }, { conSesion });
}

function seed() {
  return page.evaluate(({ REAL }) => {
    const D = window.DATA;
    if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; }
    D.products.length = 0;
    const mk = (id, color, imagen) => { const p = D.hydrate({ id, cat: '21', manga: 'MC', tela: 'ALG', color, cuello: 'NOR', modelo: id.slice(-3), nombre: 'P' + id, orn: '—', ornColors: [], precio: 1000, pop: false, stock: D.mkStock([0, 3], []) }); if (imagen) p.imagen = imagen; return p; };
    const emb = mk('emb1', 'BL', 'data:image/jpeg;base64,' + 'A'.repeat(40000)); // incrustada
    const real = mk('real1', 'AZ', REAL);                                        // URL real ya subida
    const gen = mk('gen1', 'MR');                                                // genérica (hydrate)
    D.products.push(emb, real, gen); D.saveProducts();
    return { total: D.products.length, embEsData: /^data:image\//.test(emb.imagen), genEsAuto: D.isAutoImg(gen.imagen), genUrl: gen.imagen };
  }, { REAL });
}
const estado = () => page.evaluate(() => {
  const D = window.DATA;
  const g = id => (D.products.find(p => p.id === id) || {}).imagen;
  return { emb: g('emb1'), real: g('real1'), gen: g('gen1'), pend: D.products.filter(p => /^data:image\//.test(p.imagen || '')).length, uploads: window.__uploads ? window.__uploads() : -1 };
});

// ── 1) La migración ocurre SOLA dentro del arranque (init con pull) ──────────────────
const s = await seed();
check('fixture: 1 incrustada, 1 URL real, 1 genérica', s.total === 3 && s.embEsData && s.genEsAuto);
await stubCloud(true);
await page.evaluate(() => window.STORE.init({ pull: true }));
await page.waitForTimeout(500);
const d1 = await estado();
check('la foto incrustada se subió SOLA en el arranque', /^https:\/\/fakecloud\//.test(d1.emb || ''), String(d1.emb).slice(0, 40));
check('ya no quedan fotos incrustadas pendientes', d1.pend === 0, 'pend=' + d1.pend);
check('la URL real NO se toca', d1.real === REAL, String(d1.real).slice(0, 45));
check('la foto genérica NO se sube (no es del usuario)', d1.gen === s.genUrl, String(d1.gen).slice(0, 45));
check('solo se subió 1 foto (la incrustada)', d1.uploads === 1, 'uploads=' + d1.uploads);

// ── 2) Segundo arranque: nada pendiente → no vuelve a subir ──────────────────────────
await stubCloud(true);
await page.evaluate(() => window.STORE.init({ pull: true }));
await page.waitForTimeout(400);
check('sin pendientes no sube nada', (await estado()).uploads === 0);

// ── 3) Sin sesión: NO sube y la foto queda pendiente para el próximo arranque ─────────
await seed();
await stubCloud(false);
const n = await page.evaluate(() => window.STORE.autoMigratePhotos());
const d3 = await estado();
check('sin sesión no sube (guard)', n === 0 && d3.uploads === 0, 'n=' + n);
check('la foto incrustada se conserva para reintentar', /^data:image\//.test(d3.emb || ''));

// ── 4) Reconectar (evento online) dispara la migración ───────────────────────────────
await stubCloud(true);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await page.waitForTimeout(600);
const d4 = await estado();
check('al reconectar sube la pendiente sola', /^https:\/\/fakecloud\//.test(d4.emb || '') && d4.pend === 0, String(d4.emb).slice(0, 30));

check('sin errores de página', errs.length === 0, errs.slice(0, 2).join(' | '));
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
await b.close(); server.close();
process.exit(fail ? 1 : 0);
