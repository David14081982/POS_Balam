// H-94 · Configuración objetivo de referencias físicas V2.
// Primera ejecución: debe fallar contra el cliente anterior a esta fase.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const configSrc = read('./balam/config.jsx');
const dataSrc = read('./balam/data.jsx');
const inventorySrc = read('./balam/inventory.jsx');
const settingsSrc = read('./balam/settings.jsx');
const xlsxSrc = read('./balam/xlsx-io.jsx');
const reportsSrc = read('./balam/reports.jsx');
const configMigrationSrc = read('./supabase/migrations/20260811013600_pos_h94_config_target.sql');

let pass = 0, fail = 0;
function ok(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
}

function runtime() {
  const memory = new Map();
  const localStorage = {
    getItem: key => memory.has(key) ? memory.get(key) : null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key), clear: () => memory.clear(),
  };
  let sequence = 0;
  const noop = () => {};
  const sandbox = {
    console, localStorage, Date, setTimeout, clearTimeout, JSON, Math, Object,
    Array, String, Number, Boolean, isNaN, parseInt, parseFloat, RegExp, Error,
    Set, Map, Promise,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    React: { createElement: noop, useRef: () => ({ current: null }), useEffect: noop },
  };
  sandbox.window = {
    localStorage, dispatchEvent: noop, addEventListener: noop, removeEventListener: noop,
    CORE: {
      catalogProducts: () => [], saveCatalogProducts: noop, registerCatalogProducts: noop,
      registerSyncGateway: noop, invokeSync: noop, getDeviceId: () => 'h94-config-test',
    },
    UI: { toast: noop, fmt: n => '$' + Number(n).toFixed(2) },
    crypto: { randomUUID: () => {
      sequence += 1;
      const head = sequence.toString(16).padStart(8, '0');
      return `${head}-0000-4000-8000-${head.padStart(12, '0')}`;
    } },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(configSrc, sandbox);
  vm.runInContext(dataSrc, sandbox);
  sandbox.window.CORE.catalogProducts = () => sandbox.window.DATA.products;
  return { C: sandbox.window.CONFIG, D: sandbox.window.DATA };
}

function ensureProductCatalogs(snapshot) {
  const ensure = (kind, values) => {
    snapshot.catalogs[kind] = snapshot.catalogs[kind] || [];
    values.forEach(([code, label]) => {
      if (!snapshot.catalogs[kind].some(item => item.code === code)) {
        snapshot.catalogs[kind].push({ code, label, active: true, meta: {} });
      }
    });
  };
  ensure('category', [['1', 'Guayabera']]);
  ensure('sleeve', [['ML', 'Manga larga']]);
  ensure('fabric', [['LIN', 'Lino'], ['ALG', 'Algodón']]);
  ensure('color', [['BL', 'Blanco']]);
  ensure('neck', [['MAO', 'Mao'], ['NOR', 'Normal']]);
  ensure('ornament', [['BEL', 'Bordado eléctrico'], ['BRD', 'Bordado']]);
  ensure('ornament_color', [['DRO', 'Dorado'], ['AZL', 'Azul'], ['CF', 'Café']]);
  ensure('size_letter', [['L', 'L'], ['XL', 'XL']]);
  ensure('size_number', [['40', '40']]);
  snapshot.catalogs.producto = [{ code: 'DAN', label: 'DANTE', active: true, meta: {} }];
  snapshot.catalogs.corte = [
    { code: 'SLF', label: 'SLIM FIT', active: true, meta: {} },
    { code: 'REG', label: 'REGULAR', active: true, meta: {} },
  ];
  snapshot.catalogs.caracteristicas = [
    { code: '23', label: '3 TIRAS ESFERAS DORADAS', active: true, meta: {} },
    { code: '26', label: '6 BORDADOS DE PEDAL', active: true, meta: {} },
  ];
  snapshot.catalogMeta.producto = {
    label: 'Modelo', custom: true, formSelect: true, system: false,
    inForm: false, inReference: false, inSku: true, required: false, filterable: false, skuOrder: 2,
  };
  snapshot.catalogMeta.corte = {
    label: 'Corte', custom: true, formSelect: true, system: false,
    inForm: true, inReference: false, inSku: false, required: false, filterable: false, skuOrder: 10,
  };
  snapshot.catalogMeta.caracteristicas = {
    label: 'Características', custom: true, formSelect: true, system: false,
    inForm: false, inReference: false, inSku: false, required: false, filterable: false, skuOrder: 11,
  };
  return snapshot;
}

function publishedSnapshot(C) {
  const snapshot = ensureProductCatalogs(C.snapshot());
  Object.assign(snapshot.catalogMeta.category, { inForm: true, inReference: true, inSku: true, required: true, skuOrder: 1 });
  Object.assign(snapshot.catalogMeta.sleeve, { inForm: true, inReference: true, inSku: true, required: true, skuOrder: 3 });
  Object.assign(snapshot.catalogMeta.fabric, { inForm: true, inReference: true, inSku: false, required: true, filterable: true, skuOrder: 8 });
  Object.assign(snapshot.catalogMeta.color, { inForm: true, inReference: true, inSku: true, required: true, filterable: true, skuOrder: 4 });
  Object.assign(snapshot.catalogMeta.neck, { inForm: true, inReference: true, inSku: false, required: true, skuOrder: 5 });
  Object.assign(snapshot.catalogMeta.ornament, { inForm: false, inReference: true, inSku: false, required: true, skuOrder: 6 });
  Object.assign(snapshot.catalogMeta.ornament_color, { inForm: true, inReference: true, inSku: false, required: false, filterable: true, skuOrder: 7 });
  Object.assign(snapshot.catalogMeta.size_letter, { inForm: false, inReference: true, inSku: false, required: false, skuOrder: 7 });
  Object.assign(snapshot.catalogMeta.size_number, { inForm: false, inReference: true, inSku: true, required: false, skuOrder: 9 });
  return snapshot;
}

function objectiveSnapshot(C) {
  const snapshot = publishedSnapshot(C);
  Object.assign(snapshot.catalogMeta.producto, { inForm: true, inReference: true, inSku: true, required: true, skuOrder: 2 });
  Object.assign(snapshot.catalogMeta.sleeve, { skuOrder: 3 });
  Object.assign(snapshot.catalogMeta.fabric, { inSku: true, skuOrder: 4 });
  Object.assign(snapshot.catalogMeta.color, { skuOrder: 5 });
  Object.assign(snapshot.catalogMeta.neck, { inSku: true, skuOrder: 6 });
  Object.assign(snapshot.catalogMeta.ornament, { inForm: true, inSku: true, required: true, skuOrder: 7 });
  Object.assign(snapshot.catalogMeta.ornament_color, { inSku: true, skuOrder: 8 });
  Object.assign(snapshot.catalogMeta.size_letter, { inSku: false, required: true });
  Object.assign(snapshot.catalogMeta.size_number, { inSku: false, required: true });
  Object.assign(snapshot.catalogMeta.corte, { inReference: true, inSku: false, skuOrder: 10 });
  Object.assign(snapshot.catalogMeta.caracteristicas, { inForm: true, inReference: true, inSku: false, filterable: true, skuOrder: 11 });
  snapshot.catalogMeta.effective_size = {
    label: 'Talla efectiva', inForm: false, inReference: true, inSku: true,
    required: true, skuOrder: 9, system: true, virtual: true, sizeSlot: true,
  };
  const noOrnament = (snapshot.catalogs.ornament || []).find(item => item.code === '—');
  if (noOrnament) noOrnament.meta = { ...(noOrnament.meta || {}), colorMode: 'none' };
  return snapshot;
}

const current = runtime();
const published = publishedSnapshot(current.C);
current.C.load(typeof current.C.h94TargetSnapshot === 'function'
  ? current.C.h94TargetSnapshot(published) : published);
const currentMeta = current.C.allCatalogMeta();

console.log('\n── Reproducción de CONFIG publicada ──');
ok('1. Modelo debe obedecer Alta/Referencia/Obligatorio',
  currentMeta.producto.inForm && currentMeta.producto.inReference && currentMeta.producto.required);
ok('2. Ornamento obligatorio debe estar visible en el alta',
  currentMeta.ornament.required && currentMeta.ornament.inForm);
ok('3. el Constructor debe tener una Talla efectiva única',
  !!currentMeta.effective_size?.inSku
  && !currentMeta.size_letter.inSku && !currentMeta.size_number.inSku);
ok('4. Corte debe formar parte de la identidad física', currentMeta.corte.inReference === true);
ok('5. Características debe estar en Alta/Referencia/Filtros y fuera del SKU',
  currentMeta.caracteristicas.inForm && currentMeta.caracteristicas.inReference
  && currentMeta.caracteristicas.filterable && !currentMeta.caracteristicas.inSku);
ok('6. la receta publicada debe contener todos los segmentos objetivo', (() => {
  const kinds = current.C.skuParts().map(part => part.kind);
  return ['category', 'producto', 'sleeve', 'fabric', 'color', 'neck', 'ornament', 'ornament_color', 'effective_size']
    .every(kind => kinds.includes(kind));
})());

const target = runtime();
target.C.load(objectiveSnapshot(target.C));
const { C, D } = target;
const base = {
  recordModel: 'v2',
  cat: '1', modelo: 'DAN', nombre: 'DANTE', manga: 'ML', tela: 'LIN', color: 'BL',
  cuello: 'MAO', orn: 'BEL', ornamentColorCodes: ['DRO'],
  sizeCategoryId: 'size_number', sizeCode: '40', sizeScale: 'N', stockQuantity: 1,
  precio: 1200, attrs: { producto: 'DAN', corte: 'SLF', caracteristicas: '23', __sizeCategoryId: 'size_number' },
};

console.log('\n── Contratos ejecutables de la CONFIG objetivo ──');
ok('7. orden objetivo exacto, con Corte y Características fuera',
  JSON.stringify(C.skuParts().map(part => part.kind)) === JSON.stringify([
    'category', 'producto', 'sleeve', 'fabric', 'color', 'neck', 'ornament', 'ornament_color', 'effective_size',
  ]), JSON.stringify(C.skuParts().map(part => part.kind)));
ok('8. Modelo aparece exactamente una vez en la firma', (() => {
  const payload = JSON.parse(D.physicalSignature(base));
  return payload.filter(part => part[0] === 'producto' || part[0] === 'model').length === 1;
})(), D.physicalSignature(base));
ok('9. existe una autoridad pública única de Talla efectiva', typeof D.effectiveSize === 'function');
ok('10. talla letra L, XL y talla número 40 producen el token correcto', (() => {
  if (typeof D.effectiveSize !== 'function') return false;
  return D.effectiveSize({ ...base, sizeCategoryId: 'size_letter', sizeCode: 'L' }).skuToken === 'L'
    && D.effectiveSize({ ...base, sizeCategoryId: 'size_letter', sizeCode: 'XL' }).skuToken === 'XL'
    && D.effectiveSize(base).skuToken === '40';
})());
ok('11. multicolor tiene una sola forma canónica CF+DRO', (() => {
  const variants = [['DRO', 'CF'], ['CF', 'DRO'], ['DRO', 'CF', 'DRO']];
  const arrays = variants.map(values => JSON.stringify(D.canonicalReferenceOrnamentColors(values)));
  const skus = variants.map(values => D.sku({ ...base, ornamentColorCodes: values, ornColors: values }));
  return new Set(arrays).size === 1 && arrays[0] === JSON.stringify(['CF', 'DRO'])
    && new Set(skus).size === 1 && skus[0].includes('-CF+DRO-');
})());
let previewSavedDetail = '';
ok('12. preview y referencia guardada producen el mismo SKU canónico', (() => {
  const draft = { ...base, ornamentColorCodes: ['DRO', 'CF', 'DRO'], ornColors: ['DRO', 'CF', 'DRO'] };
  const preview = D.skuPreview(draft);
  const saved = D.createReference(draft, []);
  previewSavedDetail = `${preview} / ${saved.sku}`;
  return preview === saved.sku && saved.sku.includes('-CF+DRO-');
})(), previewSavedDetail);
ok('13. Corte y Características distinguen firmas aunque no el SKU', (() => {
  const cut = { ...base, attrs: { ...base.attrs, corte: 'OTRO' } };
  const feature = { ...base, attrs: { ...base.attrs, caracteristicas: '26' } };
  return D.physicalSignature(base) !== D.physicalSignature(cut)
    && D.physicalSignature(base) !== D.physicalSignature(feature)
    && D.sku(base) === D.sku(cut) && D.sku(base) === D.sku(feature);
})());
ok('14. diagnóstico comercial nombra Corte y Características omitidos', (() => {
  const other = { ...base, attrs: { ...base.attrs, corte: 'OTRO', caracteristicas: '26' } };
  const labels = D.referenceDifferences(base, other).map(diff => diff.label);
  return labels.includes('Corte') && labels.includes('Características');
})());
ok('15. existe estadística por dimensión basada en atributos/snapshots',
  typeof D.referenceDimensionStats === 'function'
  && /referenceDimensionStats/.test(reportsSrc) && !/split\([^)]*sku/i.test(reportsSrc));
ok('16. formulario usa canonicalización y valida colorMode condicional',
  /canonicalReferenceOrnamentColors/.test(inventorySrc)
  && /ornamentColorMode/.test(inventorySrc) && /ornament-color-required/.test(inventorySrc));
ok('17. Excel consume la misma autoridad multicolor',
  /canonicalReferenceOrnamentColors/.test(xlsxSrc));
// H-140 retira por petición del usuario el bloque informativo de colisiones.
ok('18. Constructor conserva diagnóstico de campos ocultos y longitud',
  /Longitud esperada/.test(settingsSrc) && /En el SKU pero oculto del alta/.test(settingsSrc));
ok('19. identidad y etiqueta no se redefinen en esta fase',
  !/variantId\s*=/.test(dataSrc) && /barcodeCode/.test(dataSrc));

const pilotDrafts = [
  { case: 'A', draft: { ...base, stockQuantity: 3 } },
  { case: 'B', draft: { ...base, ornamentColorCodes: ['AZL'], ornColors: ['AZL'], stockQuantity: 2 } },
  { case: 'C', draft: { ...base, ornamentColorCodes: ['DRO', 'CF', 'DRO'], ornColors: ['DRO', 'CF', 'DRO'], stockQuantity: 4 } },
  { case: 'D', draft: { ...base, tela: 'ALG', stockQuantity: 1 } },
  { case: 'E', draft: { ...base, cuello: 'NOR', stockQuantity: 1 } },
  { case: 'F', draft: { ...base, orn: 'BRD', stockQuantity: 1 } },
  { case: 'G', draft: { ...base, attrs: { ...base.attrs, corte: 'REG' }, stockQuantity: 1 } },
  { case: 'H', draft: { ...base, attrs: { ...base.attrs, caracteristicas: '26' }, stockQuantity: 1 } },
  { case: 'I-L', draft: { ...base, sizeCategoryId: 'size_letter', sizeCode: 'L', sizeScale: 'L',
    attrs: { ...base.attrs, __sizeCategoryId: 'size_letter' }, stockQuantity: 1 } },
  { case: 'I-XL', draft: { ...base, sizeCategoryId: 'size_letter', sizeCode: 'XL', sizeScale: 'L',
    attrs: { ...base.attrs, __sizeCategoryId: 'size_letter' }, stockQuantity: 1 } },
  { case: 'J', draft: { ...base, sizeCode: '40', stockQuantity: 1,
    attrs: { ...base.attrs, caracteristicas: '' } } },
];
const pilotReferences = [];
for (const fixture of pilotDrafts) {
  const created = D.createReference(fixture.draft, pilotReferences);
  created.__pilotCase = fixture.case;
  pilotReferences.push(created);
}

console.log('\n── Casos piloto autocontenidos ──');
ok('20. A/B/C generan SKU distintos y stock escalar independiente', (() => {
  const [a, b, c] = pilotReferences;
  return new Set([a.sku, b.sku, c.sku]).size === 3
    && [a.stockQuantity, b.stockQuantity, c.stockQuantity].join(',') === '3,2,4';
})(), pilotReferences.slice(0, 3).map(ref => ref.sku).join(' / '));
ok('21. Material, Cuello y Ornamento cambian el SKU objetivo', (() => {
  const byCase = Object.fromEntries(pilotReferences.map(ref => [ref.__pilotCase, ref]));
  return byCase.D.sku !== byCase.A.sku && byCase.E.sku !== byCase.A.sku
    && byCase.F.sku !== byCase.A.sku;
})());
ok('22. Corte/Características cambian identidad, conservan SKU y advierten', (() => {
  const byCase = Object.fromEntries(pilotReferences.map(ref => [ref.__pilotCase, ref]));
  return byCase.G.sku === byCase.A.sku && byCase.H.sku === byCase.A.sku
    && byCase.G.physicalSignature !== byCase.A.physicalSignature
    && byCase.H.physicalSignature !== byCase.A.physicalSignature
    && byCase.G.referenceWarnings.some(warning => warning.code === 'SKU_DUPLICATE_WARNING')
    && byCase.H.referenceWarnings.some(warning => warning.code === 'SKU_DUPLICATE_WARNING');
})());
ok('23. los casos de talla efectiva terminan en L, XL y 40', (() => {
  const byCase = Object.fromEntries(pilotReferences.map(ref => [ref.__pilotCase, ref]));
  return byCase['I-L'].sku.endsWith('-L') && byCase['I-XL'].sku.endsWith('-XL')
    && byCase.J.sku.endsWith('-40');
})());
ok('24. estadísticas separan Características desde ID/atributos y snapshots', (() => {
  const byCase = Object.fromEntries(pilotReferences.map(ref => [ref.__pilotCase, ref]));
  const sales = [{ lineas: [
    { productId: byCase.A.id, qty: 2, precio: 1200, physicalAttrs: D.physicalSnapshot(byCase.A, '40') },
    { productId: byCase.H.id, qty: 1, precio: 1300, physicalAttrs: D.physicalSnapshot(byCase.H, '40') },
  ] }];
  const rows = D.referenceDimensionStats({ kind: 'caracteristicas', products: pilotReferences, sales });
  const c23 = rows.find(row => row.values[0] === '23');
  const c26 = rows.find(row => row.values[0] === '26');
  return !!c23 && !!c26 && c23.references > c26.references
    && c23.unitsSold === 2 && c23.sales === 2400
    && c26.unitsSold === 1 && c26.sales === 1300;
})());
ok('25. diagnóstico del Constructor calcula colisiones, omitidos y longitud sin regenerar', (() => {
  const before = pilotReferences.map(ref => ref.sku).join('|');
  const impact = D.skuConfigurationImpact('caracteristicas', false, pilotReferences);
  const after = pilotReferences.map(ref => ref.sku).join('|');
  return impact.ok && impact.total === pilotReferences.length && impact.collisions.length >= 1
    && impact.omitted.includes('caracteristicas') && impact.maxLength >= impact.typicalLength
    && before === after;
})());
ok('26. color de ornamento obligatorio bloquea y modo none limpia', (() => {
  const requiredSnapshot = C.snapshot();
  requiredSnapshot.catalogs.ornament.find(item => item.code === 'BEL').meta.colorMode = 'required';
  requiredSnapshot.catalogs.ornament.push({ code: '—', label: 'Sin ornamento', active: true, meta: { colorMode: 'none' } });
  C.load(requiredSnapshot);
  let blocked = false;
  try { D.createReference({ ...base, ornamentColorCodes: [], ornColors: [] }, []); }
  catch (error) { blocked = error.code === 'ORNAMENT_COLOR_REQUIRED'; }
  const none = D.createReference({ ...base, orn: '—', ornamentColorCodes: ['DRO'], ornColors: ['DRO'] }, []);
  C.load(objectiveSnapshot(C));
  return blocked && none.ornamentColorCodes.length === 0 && !none.sku.includes('-DRO-');
})());
ok('27. despliegue CONFIG es aditivo, guardado e incapaz de escribir inventario',
  /h94_product_guard_failed/.test(configMigrationSrc)
  && /v_product_hash_before\s*<>\s*v_product_hash_after/.test(configMigrationSrc)
  && /h94_protected_data_changed/.test(configMigrationSrc)
  && !/(update|delete\s+from|insert\s+into)\s+pos\.products/i.test(configMigrationSrc)
  && !/(update|delete\s+from|insert\s+into)\s+pos\.(sales|movements|returns|exchanges|loan_documents)/i.test(configMigrationSrc));

ok('28. una carga remota sin ornament_color no lo fabrica desde defaults locales', (() => {
  const remote = runtime();
  const snapshot = remote.C.snapshot();
  delete snapshot.catalogs.ornament_color;
  delete snapshot.catalogMeta.ornament_color;
  remote.C.load(snapshot);
  return remote.C.all('ornament_color').length === 0
    && remote.C.catalogMeta('ornament_color') === null;
})());

ok('29. la autoridad remota conserva exactamente los seis valores aprobados', (() => {
  const remote = runtime();
  const snapshot = remote.C.snapshot();
  snapshot.catalogs.ornament_color = [
    ['DRO', 'Dorado'], ['AZL', 'Azul'], ['CF', 'Café'],
    ['PLT', 'Plateado'], ['BL', 'Blanco'], ['NE', 'Negro'],
  ].map(([code, label], sortOrder) => ({ code, label, active: true, sortOrder, meta: {} }));
  snapshot.catalogMeta.ornament_color = {
    label: 'Color de ornamento', field: 'ornamentColorCodes', system: true,
    formSelect: true, multiselect: true, inForm: true, inReference: true,
    inSku: true, required: false, filterable: true, skuOrder: 8,
  };
  remote.C.load(snapshot);
  return JSON.stringify(remote.C.all('ornament_color').map(item => [item.code, item.label]))
    === JSON.stringify([
      ['DRO', 'Dorado'], ['AZL', 'Azul'], ['CF', 'Café'],
      ['PLT', 'Plateado'], ['BL', 'Blanco'], ['NE', 'Negro'],
    ]);
})());

ok('30. migración 13600 crea sólo el namespace independiente aprobado',
  /insert into pos\.lookup\(kind,code,label,active,sort_order,meta,updated_at\)/.test(configMigrationSrc)
  && (configMigrationSrc.match(/\('ornament_color','/g) || []).length === 6
  && /h94_ornament_color_must_be_absent/.test(configMigrationSrc)
  && !/insert into pos\.lookup[\s\S]*select[\s\S]*kind='color'/i.test(configMigrationSrc));

console.log(`\nH-94 CONFIG objetivo: ${pass}/${pass + fail}`);
if (fail) process.exit(1);
