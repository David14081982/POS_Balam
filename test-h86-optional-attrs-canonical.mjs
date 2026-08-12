// H-86 extension - one canonical contract for known custom product attributes.
// This harness is intentionally behavioral: it runs DATA and XLSXIO from the
// distributable bundle, without touching Supabase or the browser profile.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = path.resolve('.');
const ARTIFACT_PATH = String(process.env.H86_ARTIFACT_PATH || '').trim();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.jsx': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let pathname = decodeURIComponent(req.url.split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const file = pathname === '/index.html' && ARTIFACT_PATH ? path.resolve(ARTIFACT_PATH) : path.join(ROOT, pathname);
  const allowed = file.startsWith(ROOT) || (ARTIFACT_PATH && file === path.resolve(ARTIFACT_PATH));
  if (!allowed || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(8866, '127.0.0.1', resolve));

let pass = 0; let fail = 0;
function check(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` - ${detail}` : ''}`);
  condition ? pass++ : fail++;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));
await page.route(/supabase\.co/, route => route.abort());
await page.goto('http://127.0.0.1:8866/index.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.DATA && window.CONFIG && window.XLSXIO && window.XLSX, null, { timeout: 30000 });

const result = await page.evaluate(async () => {
  const D = window.DATA; const C = window.CONFIG; const IO = window.XLSXIO; const X = window.XLSX;
  if (window.STORE) { window.STORE.pushRows = () => {}; window.STORE.pushConfig = () => {}; }
  const clone = value => JSON.parse(JSON.stringify(value));
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const canonical = (attrs, options) => typeof D.canonicalProductAttrs === 'function'
    ? D.canonicalProductAttrs(attrs, options) : clone(attrs || {});
  const stock = (qty = 0) => (C.list('size_letter') || []).map(item => ({
    talla: Object.prototype.hasOwnProperty.call(item.meta || {}, 'value') ? item.meta.value : item.code,
    escala: 'L', stock: qty,
  }));
  const base = over => D.hydrate(Object.assign({
    id: 'h86-attrs', _syncVersion: 7, sku: 'H86-ATTRS', recordModel: 'v1',
    cat: (C.list('category')[0] || {}).code || '21', manga: (C.list('sleeve')[0] || {}).code || 'MC',
    tela: (C.list('fabric')[0] || {}).code || 'ALG', color: (C.list('color')[0] || {}).code || 'BL',
    cuello: (C.list('neck')[0] || {}).code || 'NOR', orn: (C.list('ornament')[0] || {}).code || '—',
    modelo: (C.list(C.modeloKind())[0] || {}).code || 'ADR', nombre: 'H86 ATTRS', ornColors: [],
    precio: 100, costo: 40, pop: false, sizeCategoryId: 'size_letter', stock: stock(),
    attrs: { __sizeCategoryId: 'size_letter', __ornamentColorsBySize: {} },
  }, over || {}));

  const absent = canonical({ __sizeCategoryId: 'size_letter' });
  const empty = canonical({ caracteristicas: '' });
  const nil = canonical({ caracteristicas: null });
  const spaces = canonical({ caracteristicas: '   ' });
  const valid = canonical({ caracteristicas: '23' });
  const multiple = canonical({ caracteristicas: '23', corte: '', __sizeCategoryId: 'size_letter' });
  const reserved = canonical({ caracteristicas: '', __legacy: '', __sizeCategoryId: 'size_letter' });
  const unknown = canonical({ caracteristicas: '', atributo_historico: '' });
  let requiredError = null;
  try {
    canonical({ [C.modeloKind()]: '   ' }, { validateRequired: true, product: { modelo: '' } });
  } catch (error) { requiredError = { code: error.code, kind: error.kind, message: error.message }; }

  const blankProduct = base({ attrs: {
    __sizeCategoryId: 'size_letter', __ornamentColorsBySize: {},
    [C.modeloKind()]: (C.list(C.modeloKind())[0] || {}).code || 'ADR', caracteristicas: '',
  } });
  const absentProduct = base({ attrs: {
    __sizeCategoryId: 'size_letter', __ornamentColorsBySize: {},
    [C.modeloKind()]: (C.list(C.modeloKind())[0] || {}).code || 'ADR',
  } });
  const wb1 = IO.__test.inventoryWorkbook([blankProduct]).wb;
  const toFile = (wb, name) => new File([X.write(wb, { bookType: 'xlsx', type: 'array' })], name,
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const parsed = await IO.parseFile(toFile(wb1, 'h86-optional-attrs.xlsx'));
  const plan = IO.planImport(parsed, [blankProduct], {});
  const applied = [clone(blankProduct)];
  if (plan.ok) IO.applyImportPlan(plan, applied);
  const wb2 = IO.__test.inventoryWorkbook(applied).wb;
  const rows = wb => X.utils.sheet_to_json(wb.Sheets.Inventario, { defval: '' });

  const conflictCurrent = [clone(blankProduct)];
  conflictCurrent[0]._syncVersion = 8;
  const conflictBefore = JSON.stringify(conflictCurrent);
  const conflictPlan = IO.planImport(parsed, conflictCurrent, {});
  let conflictBlocked = false;
  try { IO.applyImportPlan(conflictPlan, conflictCurrent); } catch (_) { conflictBlocked = true; }

  const sigBase = {
    recordModel: 'v2', cat: blankProduct.cat, manga: blankProduct.manga, tela: blankProduct.tela,
    color: blankProduct.color, cuello: blankProduct.cuello, orn: blankProduct.orn,
    modelo: blankProduct.modelo, ornamentColorCodes: [], sizeCategoryId: 'size_letter',
    sizeCode: String((C.list('size_letter')[0] || {}).meta?.value || (C.list('size_letter')[0] || {}).code || 'XS'),
    attrs: { __sizeCategoryId: 'size_letter', [C.modeloKind()]: blankProduct.modelo },
  };
  const signature = attrs => D.physicalSignature(Object.assign({}, sigBase, { attrs: Object.assign({}, sigBase.attrs, attrs) }));

  return {
    authority: typeof D.canonicalProductAttrs === 'function',
    metadata: C.catalogMeta('caracteristicas'),
    absent: !has(absent, 'caracteristicas'), empty: !has(empty, 'caracteristicas'),
    nil: !has(nil, 'caracteristicas'), spaces: !has(spaces, 'caracteristicas'),
    valid: valid.caracteristicas === '23',
    multiple: multiple.caracteristicas === '23' && !has(multiple, 'corte') && multiple.__sizeCategoryId === 'size_letter',
    requiredError,
    reserved: has(reserved, '__legacy') && reserved.__legacy === '' && reserved.__sizeCategoryId === 'size_letter',
    unknown: has(unknown, 'atributo_historico') && unknown.atributo_historico === '',
    eie: plan.ok && JSON.stringify(rows(wb1)) === JSON.stringify(rows(wb2)) && !has(applied[0].attrs, 'caracteristicas'),
    semanticEqual: JSON.stringify(IO.__test.canonicalProductState(blankProduct))
      === JSON.stringify(IO.__test.canonicalProductState(absentProduct)),
    fingerprintEqual: IO.__test.inventoryStateFingerprint([blankProduct])
      === IO.__test.inventoryStateFingerprint([absentProduct]),
    conflictZeroMutation: !conflictPlan.ok && conflictBlocked && JSON.stringify(conflictCurrent) === conflictBefore,
    physicalNoValueEqual: signature({}) === signature({ caracteristicas: '' })
      && signature({}) === signature({ caracteristicas: null })
      && signature({}) === signature({ caracteristicas: '   ' }),
    physicalValidDiffers: signature({}) !== signature({ caracteristicas: '23' }),
  };
});

check('0. DATA publica la autoridad compartida de atributos', result.authority);
check('1. atributo opcional ausente queda ausente', result.absent);
check('2. atributo opcional vacio se omite', result.empty);
check('3. atributo opcional null se omite', result.nil);
check('4. atributo opcional con espacios se omite', result.spaces);
check('5. atributo opcional valido se conserva', result.valid);
check('6. multiples opcionales se canonicalizan por kind conocido', result.multiple);
check('7. atributo obligatorio vacio produce error', result.requiredError?.code === 'CUSTOM_ATTRIBUTE_REQUIRED', JSON.stringify(result.requiredError));
check('8. claves __* se preservan literalmente', result.reserved);
check('9. atributo historico desconocido se preserva literalmente', result.unknown);
check('10. Exportar - Importar - Exportar conserva el canon', result.eie);
check('11. representaciones sin valor son semanticamente iguales', result.semanticEqual);
check('12. representaciones sin valor tienen la misma huella', result.fingerprintEqual);
check('13. conflicto de importacion produce cero mutaciones', result.conflictZeroMutation);
check('14. H94 no cambia referencia por sin-valor y si cambia con Caracteristicas=23',
  result.physicalNoValueEqual && result.physicalValidDiffers);
check('Caracteristicas conserva el contrato CONFIG aprobado', result.metadata?.inForm === true
  && result.metadata?.inReference === true && result.metadata?.inSku === false
  && result.metadata?.filterable === true && result.metadata?.required === false, JSON.stringify(result.metadata));
check('sin errores de pagina', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

await browser.close();
server.close();
console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
