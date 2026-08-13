// H-94 · Modelo aditivo de referencias físicas V2.
// Esta prueba fija las fronteras que no pueden volver a depender de SKU+talla.
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const configSrc = read('./balam/config.jsx');
const dataSrc = read('./balam/data.jsx');
const barcodeSrc = read('./balam/barcodes.jsx');
const inventorySrc = read('./balam/inventory.jsx');
const posSrc = read('./balam/pos.jsx');
const returnsSrc = read('./balam/returns.jsx');
const settingsSrc = read('./balam/settings.jsx');
const storeSrc = read('./balam/store.jsx');
const xlsxSrc = read('./balam/xlsx-io.jsx');
const migrationPath = './supabase/migrations/20260810013400_pos_h94_reference_model_v2.sql';

let pass = 0, fail = 0;
function ok(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
}

function configRuntime() {
  const memory = new Map();
  const sandbox = {
    console,
    localStorage: {
      getItem: key => memory.get(key) || null,
      setItem: (key, value) => memory.set(key, String(value)),
    },
    CustomEvent: class {},
    window: {
      dispatchEvent() {}, addEventListener() {},
      CORE: { invokeSync() {}, catalogProducts: () => [], saveCatalogProducts() {} },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(configSrc, sandbox);
  return sandbox.window.CONFIG;
}

const C = configRuntime();
console.log('\n── CONFIG y firma física ──');
ok('1. existe el catálogo independiente Color de ornamento', C.catalogMeta('ornament_color')?.label === 'Color de ornamento');
ok('2. CONFIG mantiene EN REFERENCIA y EN SKU como dimensiones separadas aunque ambas inicien activas',
  typeof C.referenceParts === 'function' && C.catalogMeta('ornament_color')?.inReference === true
  && C.catalogMeta('ornament_color')?.inSku === true);
ok('3. Material y Color Tela son categorías distintas',
  C.catalogMeta('fabric')?.label === 'Material' && C.catalogMeta('color')?.label === 'Color Tela');
ok('4. talla, material, cuello, ornamento y sus colores forman la referencia inicial', (() => {
  const kinds = (C.referenceParts?.() || []).map(part => part.kind);
  return ['fabric', 'color', 'neck', 'ornament', 'ornament_color'].every(kind => kinds.includes(kind))
    && kinds.includes('effective_size');
})());

console.log('\n── Autoridad V2 ──');
ok('5. DATA publica el contrato de referencia V2',
  /function isV2Reference\(/.test(dataSrc) && /function createReference\(/.test(dataSrc));
ok('6. la firma física se canonicaliza desde CONFIG',
  /function physicalSignature\(/.test(dataSrc) && /referenceParts\(/.test(dataSrc));
ok('7. multicolor usa el orden estable del catálogo independiente',
  /ornament_color/.test(dataSrc) && /canonicalOrnamentColors/.test(dataSrc));
ok('8. las altas usan UUID y no new-timestamp',
  /createReference\(/.test(inventorySrc) && !/id:\s*'new-'\s*\+\s*Date\.now\(\)/.test(inventorySrc));
ok('9. una referencia V2 persiste talla única y stock escalar',
  /stockQuantity/.test(dataSrc) && /sizeCode/.test(dataSrc) && /recordModel/.test(dataSrc));
ok('10. una firma física duplicada se bloquea sin fusionar IDs',
  /REFERENCE_SIGNATURE_DUPLICATE/.test(dataSrc));

console.log('\n── Barcode, POS y documentos ──');
ok('11. Code128 V2 codifica barcodeCode, no SKU',
  /p\.barcodeCode/.test(barcodeSrc) && /isV2Reference/.test(barcodeSrc));
ok('12. barcode duplicado se bloquea y nunca elige la primera coincidencia',
  /BARCODE_AMBIGUOUS/.test(barcodeSrc) && !/for \(let a = 0; a < prods\.length; a\+\+\)[\s\S]{0,500}return \{ p, talla/.test(barcodeSrc));
ok('13. carrito y escaneo conservan products.id',
  /productId/.test(posSrc) && /BARCODE_AMBIGUOUS/.test(posSrc));
ok('14. líneas nuevas congelan lineId, productId y barcodeCode',
  /lineId/.test(dataSrc) && /barcodeCode/.test(dataSrc));
ok('15. posventa prioriza lineId/productId y bloquea ambigüedad legacy',
  /lineId/.test(returnsSrc) && /productId/.test(returnsSrc) && /AMBIGUOUS/.test(dataSrc));

console.log('\n── Persistencia, Excel y etiqueta ──');
ok('16. existe migración aditiva H-94', existsSync(new URL(migrationPath, import.meta.url)));
if (existsSync(new URL(migrationPath, import.meta.url))) {
  const migration = read(migrationPath);
  ok('17. la base protege barcode y firma V2 con índices parciales',
    /barcode_code[\s\S]+unique/i.test(migration) && /physical_signature[\s\S]+unique/i.test(migration));
  ok('17a. un barcode V2 no puede reutilizarse después de una baja lógica',
    /pos_products_v2_barcode_code_uq[\s\S]{0,160}where record_model = 'v2';/i.test(migration));
  ok('17b. la base conserva un candado físico monotónico después de tener stock',
    /physical_identity_locked/.test(migration)
    && /old\.physical_identity_locked/.test(migration));
  ok('18. la migración no convierte filas V1', !/update\s+pos\.products\s+set\s+record_model\s*=\s*'v2'/i.test(migration));
  ok('18b. la migración aborta si cambia cualquier fila preexistente V1',
    /h94_preexisting_rows_baseline/i.test(migration)
    && /H94_PREEXISTING_DATA_CHANGED/.test(migration)
    && /H94_V1_INTACT/.test(migration));
  const saleHelper = migration.match(/create or replace function pos\.h94_persist_sale_references[\s\S]*?\n\$\$;/i)?.[0] || '';
  const returnHelper = migration.match(/create or replace function pos\.h94_persist_return_references[\s\S]*?\n\$\$;/i)?.[0] || '';
  const exchangeHelper = migration.match(/create or replace function pos\.h94_persist_exchange_references[\s\S]*?\n\$\$;/i)?.[0] || '';
  ok('18a. una venta V2 no exige sourceSaleLineId', !/V2_SOURCE_LINE_ID_REQUIRED/.test(saleHelper));
  ok('18b. devolución y lado devuelto del cambio exigen sourceSaleLineId',
    /V2_SOURCE_LINE_ID_REQUIRED/.test(returnHelper)
    && /lado'='devuelto'[\s\S]*V2_SOURCE_LINE_ID_REQUIRED/.test(exchangeHelper));
} else {
  ok('17. la base protege barcode y firma V2 con índices parciales', false);
  ok('17a. un barcode V2 no puede reutilizarse después de una baja lógica', false);
  ok('17b. la base conserva un candado físico monotónico después de tener stock', false);
  ok('18. la migración no convierte filas V1', false);
  ok('18a. una venta V2 no exige sourceSaleLineId', false);
  ok('18b. devolución y lado devuelto del cambio exigen sourceSaleLineId', false);
}
ok('19. STORE sincroniza todos los campos V2 sin eliminar stock[] legacy',
  /record_model/.test(storeSrc) && /barcode_code/.test(storeSrc) && /stock_quantity/.test(storeSrc) && /stock:\s*p\.stock/.test(storeSrc));
ok('19a. el pull de movimientos conserva la identidad idempotente de reclasificacion',
  /operationId:\s*r\.operation_id\s*\|\|\s*undefined/.test(storeSrc)
  && /reversalOf:\s*r\.reversal_of\s*\|\|\s*undefined/.test(storeSrc));
ok('20. Excel V2 exporta identidad técnica/logística y stock escalar',
  /barcodeCode/.test(xlsxSrc) && /recordModel/.test(xlsxSrc) && /stockQuantity/.test(xlsxSrc));
ok('21. SKU duplicado es advertencia y barcode/ID duplicado es bloqueo',
  /SKU_DUPLICATE_WARNING/.test(xlsxSrc) && /BARCODE_DUPLICATE/.test(xlsxSrc));
ok('22. la etiqueta muestra SKU pero no barcode como texto',
  /sku:\s*s\.p\.sku/.test(inventorySrc) && /barcode:\s*s\.code/.test(inventorySrc));
ok('22a. Constructor informa longitud y aptitud Code128 sin confundir SKU con barcode V2',
  /Longitud esperada/.test(settingsSrc) && /V2 siempre codifica el barcode logístico/.test(settingsSrc));

function v2Terminal() {
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
    Set, Map, Promise, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    React: { createElement: noop, useRef: () => ({ current: null }), useEffect: noop },
  };
  sandbox.window = {
    localStorage, dispatchEvent: noop, addEventListener: noop, removeEventListener: noop,
    CORE: {
      catalogProducts: () => [], saveCatalogProducts: noop, registerCatalogProducts: noop,
      registerSyncGateway: noop, invokeSync: noop, getDeviceId: () => 'h94-device',
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
  vm.runInContext(barcodeSrc, sandbox);
  sandbox.window.CORE.catalogProducts = () => sandbox.window.DATA.products;
  if (typeof sandbox.window.DATA.applyFolioBlock === 'function') {
    sandbox.window.DATA.applyFolioBlock('BG', new Date().toISOString().slice(2, 10).replace(/-/g, ''), 1, 100);
  }
  return { D: sandbox.window.DATA, B: sandbox.window.BARCODES, C: sandbox.window.CONFIG };
}

console.log('\n── Combinaciones físicas ejecutables ──');
const runtime = v2Terminal();
const baseDraft = {
  cat: '21', modelo: 'DAN', manga: 'ML', tela: 'ALG', color: 'BL', cuello: 'MAO',
  orn: 'Bordado Eléctrico', ornamentColorCodes: ['DRO'], sizeCategoryId: 'size_number',
  sizeCode: '40', stockQuantity: 2, nombre: 'Daniela', precio: 1200,
};
const a = runtime.D.createReference({ ...baseDraft, sku: '21-DAN-ML-ALG-BL-40' }, runtime.D.products);
runtime.D.products.push(a);
const colorDifferent = runtime.D.createReference({ ...baseDraft, ornamentColorCodes: ['AZL'], sku: a.sku }, runtime.D.products);
runtime.D.products.push(colorDifferent);
const materialDifferent = runtime.D.createReference({ ...baseDraft, tela: 'POL', sku: a.sku }, runtime.D.products);
runtime.D.products.push(materialDifferent);
const neckDifferent = runtime.D.createReference({ ...baseDraft, cuello: 'NOR', sku: a.sku }, runtime.D.products);
runtime.D.products.push(neckDifferent);

ok('23. misma talla + distinto color de ornamento crea otra identidad',
  a.id !== colorDifferent.id && a.physicalSignature !== colorDifferent.physicalSignature
  && a.barcodeCode !== colorDifferent.barcodeCode);
ok('24. mismo color de ornamento + distinto Material crea otra identidad',
  a.id !== materialDifferent.id && a.physicalSignature !== materialDifferent.physicalSignature);
ok('25. distinto Cuello crea otra identidad',
  a.id !== neckDifferent.id && a.physicalSignature !== neckDifferent.physicalSignature);
ok('26. los SKU iguales sólo producen advertencias comerciales',
  [colorDifferent, materialDifferent, neckDifferent].every(ref =>
    (ref.referenceWarnings || []).some(warning => warning.code === 'SKU_DUPLICATE_WARNING')));
const multiA = { ...baseDraft, ornamentColorCodes: ['PLT', 'DRO', 'AZL'] };
const multiB = { ...baseDraft, ornamentColorCodes: ['AZL', 'PLT', 'DRO'] };
ok('27. una combinación multicolor tiene orden canónico estable',
  runtime.D.physicalSignature(multiA) === runtime.D.physicalSignature(multiB)
  && JSON.stringify(runtime.D.canonicalReferenceOrnamentColors(multiA.ornamentColorCodes)) === JSON.stringify(['AZL', 'DRO', 'PLT']));
ok('28. products.id y barcodeCode duplicados bloquean el alta', (() => {
  let idBlocked = false, barcodeBlocked = false;
  try { runtime.D.createReference({ ...baseDraft, id: a.id, ornamentColorCodes: ['CF'] }, runtime.D.products); }
  catch (error) { idBlocked = error.code === 'REFERENCE_ID_DUPLICATE'; }
  try { runtime.D.createReference({ ...baseDraft, barcodeCode: a.barcodeCode, ornamentColorCodes: ['NE'] }, runtime.D.products); }
  catch (error) { barcodeBlocked = error.code === 'BARCODE_DUPLICATE'; }
  return idBlocked && barcodeBlocked;
})());
ok('29. el escaneo resuelve barcodeCode directamente a products.id', (() => {
  const result = runtime.B.resolve(a.barcodeCode);
  return result.ok && result.hit.productId === a.id && result.hit.p === a;
})());
ok('30. un barcode ambiguo bloquea y no devuelve la primera coincidencia', (() => {
  runtime.D.products.push({ ...colorDifferent, id: 'otro-id', barcodeCode: a.barcodeCode });
  const result = runtime.B.resolve(a.barcodeCode);
  runtime.D.products.pop();
  return !result.ok && result.code === 'BARCODE_AMBIGUOUS' && result.matches.length === 2;
})());
ok('31. el código logístico V2 es estable y corto para Code128',
  a.barcodeCode.length === 16 && runtime.B.codeOf(a, a.sizeCode) === a.barcodeCode, a.barcodeCode);
ok('32. una referencia con stock no admite edición física silenciosa', (() => {
  try { runtime.D.updateReference({ ...a, cuello: 'ITA' }); return false; }
  catch (error) { return error.code === 'REFERENCE_RECLASSIFICATION_REQUIRED'; }
})());
const reclassified = runtime.D.reclassifyReference({
  sourceProductId: a.id, targetProductId: colorDifferent.id, quantity: 1,
  actor: 'Admin H94', reason: 'Corrección física verificada', operationId: '00000000-0000-4000-8000-000000000094',
});
ok('33. reclasificar mueve stock sin fusionar las referencias',
  reclassified.ok && a.stockQuantity === 1 && colorDifferent.stockQuantity === 3
  && a.id !== colorDifferent.id);
ok('34. reintentar la reclasificación es idempotente', (() => {
  const again = runtime.D.reclassifyReference({
    sourceProductId: a.id, targetProductId: colorDifferent.id, quantity: 1,
    actor: 'Admin H94', reason: 'Corrección física verificada', operationId: reclassified.operationId,
  });
  return again.ok && again.idempotent && a.stockQuantity === 1 && colorDifferent.stockQuantity === 3;
})());
const sale = runtime.D.recordSale({
  ticket: [{ p: a, talla: a.sizeCode, qty: 1 }], sellerIds: [], client: null,
  metodo: 'Efectivo', estado: 'Pagado', total: 1200, itemCount: 1,
});
const frozen = sale.lineas[0];
ok('35. la venta congela lineId, productId, barcode, SKU, atributos y precios',
  !!frozen.lineId && frozen.productId === a.id && frozen.barcodeCode === a.barcodeCode
  && frozen.sku === a.sku && frozen.physicalAttrs?.material === 'ALG'
  && frozen.listPrice === 1200 && frozen.effectivePrice === 1200
  && frozen.discountSnapshot?.additional === 0, JSON.stringify(frozen));
const returned = runtime.D.recordReturn({
  folio: sale.folio, metodo: 'Efectivo',
  lineas: [{ sourceSaleLineId: frozen.lineId, productId: frozen.productId, sku: frozen.sku,
    nombre: frozen.nombre, talla: frozen.talla, qty: 1, motivo: 'Talla' }],
});
ok('36. la devolución resuelve la referencia exacta por lineId/productId aun con SKU repetido',
  returned.ok && returned.ret.lineas[0].productId === a.id
  && returned.ret.lineas[0].sourceSaleLineId === frozen.lineId
   && returned.ret.lineas[0].listPrice === frozen.listPrice
   && returned.ret.lineas[0].effectivePrice === frozen.effectivePrice);
ok('37. EN REFERENCIA no puede redefinirse cuando ya existen referencias V2', (() => {
  const result = runtime.C.setCatalogMeta('fabric', { inReference: false });
  return !result.ok && result.code === 'REFERENCE_RULE_LOCKED'
    && runtime.C.catalogMeta('fabric').inReference === true;
})());
const loan = runtime.D.registrarPrestamo({
  persona: { tipo: 'otro', nombre: 'Taller H94', tel: '6620000000' },
  fecha: '2026-08-10', fechaEsperada: '2026-08-11', usuario: 'Admin H94',
  lineas: [{ productId: a.id, talla: a.sizeCode, qty: 1 }],
});
ok('38. el préstamo congela identidad, barcode, SKU, atributos y precios', (() => {
  const line = loan.loan && loan.loan.lineas[0];
  return loan.ok && !!line?.lineId && line.productId === a.id && line.barcodeCode === a.barcodeCode
    && line.sku === a.sku && line.physicalAttrs?.material === 'ALG'
    && line.listPrice === 1200 && line.effectivePrice === 1200
    && line.discountSnapshot?.additional === 0;
})());
const saleForExchange = runtime.D.recordSale({
  ticket: [{ p: a, talla: a.sizeCode, qty: 1 }], sellerIds: [], client: null,
  metodo: 'Efectivo', estado: 'Pagado', total: 1200, itemCount: 1,
});
const exchangeSource = saleForExchange.lineas[0];
const exchanged = runtime.D.recordExchange({
  origenFolio: saleForExchange.folio, usuario: 'Admin H94', metodoPago: 'Efectivo',
  lineas: [
    { lado: 'devuelto', sourceSaleLineId: exchangeSource.lineId, productId: a.id,
      sku: a.sku, nombre: a.nombre, talla: a.sizeCode, qty: 1, condicion: 'Vendible' },
    { lado: 'entregado', productId: colorDifferent.id, sku: colorDifferent.sku,
      nombre: colorDifferent.nombre, talla: colorDifferent.sizeCode, qty: 1 },
  ],
});
ok('39. el cambio congela cada referencia exacta sin resolver por SKU', (() => {
  const lines = exchanged.exchange?.lineas || [];
  const returnedLine = lines.find(line => line.lado === 'devuelto');
  const deliveredLine = lines.find(line => line.lado === 'entregado');
  return exchanged.ok && returnedLine?.productId === a.id
    && returnedLine.sourceSaleLineId === exchangeSource.lineId
    && deliveredLine?.productId === colorDifferent.id
    && deliveredLine.barcodeCode === colorDifferent.barcodeCode
    && deliveredLine.physicalAttrs?.ornamentColorCodes?.[0] === 'AZL'
    && deliveredLine.listPrice === 1200 && deliveredLine.effectivePrice === 1200;
})(), JSON.stringify(exchanged));
const reversed = runtime.D.reclassifyReference({
  sourceProductId: colorDifferent.id, targetProductId: a.id, quantity: 1,
  actor: 'Admin H94', reason: 'Reversa controlada',
  operationId: '00000000-0000-4000-8000-000000000095', reversalOf: reclassified.operationId,
});
ok('40. la reversa exige el inverso exacto y mueve stock sin reescribir documentos',
  reversed.ok && colorDifferent.stockQuantity === 1 && a.stockQuantity === 2
  && sale.lineas[0].physicalAttrs.ornamentColorCodes[0] === 'DRO');
const fullSource = runtime.D.createReference({ ...baseDraft, modelo: 'FULL-A', stockQuantity: 2 }, runtime.D.products);
runtime.D.products.push(fullSource);
const fullTarget = runtime.D.createReference({ ...baseDraft, modelo: 'FULL-B', stockQuantity: 0 }, runtime.D.products);
runtime.D.products.push(fullTarget);
const fullMove = runtime.D.reclassifyReference({
  sourceProductId: fullSource.id, targetProductId: fullTarget.id, quantity: 2,
  actor: 'Admin H94', reason: 'Traslado total', operationId: '00000000-0000-4000-8000-000000000096',
});
const fullRetry = runtime.D.reclassifyReference({
  sourceProductId: fullSource.id, targetProductId: fullTarget.id, quantity: 2,
  actor: 'Admin H94', reason: 'Traslado total', operationId: fullMove.operationId,
});
ok('41. reintentar un traslado total reconoce idempotencia aun con origen en cero',
  fullMove.ok && fullSource.stockQuantity === 0 && fullTarget.stockQuantity === 2
  && fullRetry.ok && fullRetry.idempotent);
ok('42. una referencia que tuvo stock sigue físicamente bloqueada al quedar en cero', (() => {
  try { runtime.D.updateReference({ ...fullSource, cuello: 'ITA' }); return false; }
  catch (error) { return error.code === 'REFERENCE_RECLASSIFICATION_REQUIRED'; }
})());

console.log(`\nH-94: ${pass}/${pass + fail}`);
if (fail) process.exit(1);
