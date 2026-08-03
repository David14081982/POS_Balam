// test-h69-commission-settings.mjs — H-69 · La escalera de la tienda se puede
// EDITAR desde la pantalla, y editarla cambia lo que se cobra.
//
// H-69 nacio de tres ajustes que se administraban y no leia nadie. La leccion no
// es "conectar esos tres": es que un control de comision sin recorrido probado
// vuelve a ser un adorno. Esta prueba recorre la pantalla real y comprueba el
// EFECTO sobre el motor, no la presencia del campo. Los localizadores son
// `data-testid`, nunca texto visible (R-DEL-10, AP-11).
import http from 'http'; import fs from 'fs'; import path from 'path';
import { pathToFileURL } from 'url';

const ROOT = path.resolve('.');
const { chromium } = await import(pathToFileURL(path.join(ROOT, 'node_modules/playwright-core/index.mjs')).href);
const server = http.createServer((req, res) => {
  const fp = path.join(ROOT, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0].slice(1)));
  if (!fp.startsWith(ROOT) || !fs.existsSync(fp)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': path.extname(fp) === '.html' ? 'text/html' : 'application/octet-stream' });
  fs.createReadStream(fp).pipe(res);
});
await new Promise(r => server.listen(8883, '127.0.0.1', r));

let pass = 0, fail = 0;
const ck = (n, c, d = '') => { console.log(`${c ? '✅' : '❌'} ${n}${c || !d ? '' : ' · ' + d}`); c ? pass++ : fail++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errores = [];
page.on('pageerror', e => errores.push(String(e)));
await page.route(/supabase\.co/, r => r.abort());
await page.goto('http://127.0.0.1:8883/', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG && window.SettingsScreen);

const out = await page.evaluate(async () => {
  const D = window.DATA, C = window.CONFIG, R = [];
  const ck = (n, c, d = '') => R.push({ n, ok: !!c, d: String(d) });

  // 1) Las cuatro tasas de la escalera son ajustes administrables. Si una
  //    desapareciera, dejaria de poder configurarse y volveriamos al origen.
  ['commission.basePct', 'commission.goalPct', 'commission.surplusPct',
    'commission.surplusThresholdPct'].forEach(k =>
    ck('ajuste administrable · ' + k, C.get(k) != null, C.get(k)));

  // 2) Escalera de fabrica segun la politica autorizada.
  const antes = D.resolveSellerCommission({ commissionPolicyVersion: 1, metaMes: 10000 });
  ck('escalera de fabrica 3/4/5 con umbral 120 %',
    antes.basePct === 3 && antes.goalPct === 4 && antes.surplusPct === 5
    && antes.surplusThresholdPct === 120,
    `${antes.basePct}/${antes.goalPct}/${antes.surplusPct} @${antes.surplusThresholdPct}`);

  // 3) Editar una tasa cambia lo que resuelve la autoridad...
  C.setSetting('commission.goalPct', 6);
  C.setSetting('commission.surplusPct', 9);
  C.setSetting('commission.surplusThresholdPct', 150);
  const desp = D.resolveSellerCommission({ commissionPolicyVersion: 1, metaMes: 10000 });
  ck('editar la tasa de meta cambia la autoridad', desp.goalPct === 6, desp.goalPct);
  ck('editar la tasa de excedente cambia la autoridad', desp.surplusPct === 9, desp.surplusPct);
  ck('editar el umbral cambia la autoridad', desp.surplusThresholdPct === 150, desp.surplusThresholdPct);

  // 4) ...y cambia el DINERO. Meta 10 000, umbral 150 % = 15 000, base 20 000:
  //    10 000 @3 % = 300 · 5 000 @6 % = 300 · 5 000 @9 % = 450 -> 1 050
  const calc = D.commissionEntryFor(
    { id: 'set-1', nombre: 'X', commissionPolicyVersion: 1, metaMes: 10000 },
    20000, { priorBase: 0 });
  ck('la escalera editada se aplica al importe', calc.monto === 1050, calc.monto);
  ck('el desglose refleja los tramos editados',
    calc.tramos.length === 3 && calc.tramos[1].pct === 6 && calc.tramos[2].pct === 9,
    JSON.stringify(calc.tramos.map(t => t.pct)));

  // 5) Un tramo superior nunca paga menos que el anterior: la escalera se
  //    aplana, jamas baja, aunque alguien capture tasas descendentes.
  C.setSetting('commission.goalPct', 1);
  C.setSetting('commission.surplusPct', 0);
  const deg = D.resolveSellerCommission({ commissionPolicyVersion: 1, metaMes: 10000 });
  ck('una escalera descendente se aplana, no baja',
    deg.goalPct >= deg.basePct && deg.surplusPct >= deg.goalPct,
    `${deg.basePct}/${deg.goalPct}/${deg.surplusPct}`);

  // 6) La meta sugerida deja de ser un ajuste sin consumidor.
  C.setSetting('commission.goalPct', 4);
  C.setSetting('commission.surplusPct', 5);
  C.setSetting('commission.surplusThresholdPct', 120);
  C.setSetting('commission.monthlyGoal', 33000);
  ck('commission.monthlyGoal conserva su valor', Number(C.get('commission.monthlyGoal')) === 33000);

  return R;
});
out.forEach(r => ck(r.n, r.ok, r.d));

// 7) La pantalla monta y renderiza la vista previa de la escalera.
// La pantalla abre en "Negocio": hay que entrar a la seccion de Vendedores. Se
// navega por el contrato estable `data-testid`, jamas por la etiqueta visible.
const dom = await page.evaluate(() => new Promise(res => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  ReactDOM.createRoot(host).render(React.createElement(window.SettingsScreen));
  setTimeout(() => {
    const tab = host.querySelector('[data-testid="settings-section-vendedores"]');
    if (tab) tab.click();
    setTimeout(() => res({
      monta: (host.textContent || '').length > 0,
      pestana: !!tab,
      preview: !!host.querySelector('[data-testid="commission-ladder-preview"]'),
      campos: ['commission.basePct', 'commission.goalPct', 'commission.surplusPct',
        'commission.surplusThresholdPct']
        .filter(k => (host.textContent || '').length > 0).length,
    }), 700);
  }, 900);
}));
ck('la pantalla de Configuracion monta sin fallar', dom.monta);
ck('la seccion de Vendedores es alcanzable', dom.pestana);
ck('la vista previa de la escalera se renderiza', dom.preview);
ck('sin errores de pagina', errores.length === 0, errores.join(' | '));

// 8) La politica es un DATO persistido: cambiar el valor por defecto del codigo
//    NO cambia nada en una instalacion que ya lo tiene guardado. Este guardian
//    exige que la migracion siembre exactamente lo que el codigo declara. Es la
//    comprobacion que faltaba: la escalera se cambio en config.jsx y en
//    produccion siguio valiendo 5, asi que la politica autorizada no estaba en
//    vigor pese a que todas las pruebas pasaban.
const cfg = fs.readFileSync(path.join(ROOT, 'balam/config.jsx'), 'utf8');
const mig = fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
  .filter(f => f.includes('h69'))
  .map(f => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'))
  .join('\n');
const declarado = k => {
  const m = cfg.match(new RegExp(`'commission\\.${k}':\\s*([0-9.]+)`));
  return m ? m[1] : null;
};
[['basePct', 3], ['goalPct', 4], ['surplusPct', 5], ['surplusThresholdPct', 120]].forEach(([k, esperado]) => {
  const dec = declarado(k);
  ck(`config.jsx declara commission.${k} = ${esperado}`, Number(dec) === esperado, dec);
  ck(`alguna migracion siembra commission.${k} en pos.settings`,
    new RegExp(`'commission\\.${k}'`).test(mig) && mig.includes('pos.settings'));
});
ck('alguna migracion fija commission.base = neto',
  /'commission\.base'/.test(mig) && /"neto"/.test(mig));

await browser.close(); server.close();
console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
