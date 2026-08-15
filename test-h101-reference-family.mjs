// H-101 · Familia administrativa y captura masiva V2.
// Primero nace roja: fija la autoridad mínima antes de implementar UI/RPC.
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const configSrc = read('./balam/config.jsx');
const dataSrc = read('./balam/data.jsx');
const storeSrc = read('./balam/store.jsx');
const xlsxSrc = read('./balam/xlsx-io.jsx');
const inventorySrc = read('./balam/inventory.jsx');
const migrationPath = './supabase/migrations/20260814014300_pos_h101_reference_families.sql';
const verificationPath = './supabase/migrations/20260814014400_pos_h101_reference_families_verification.sql';
const guardPath = './supabase/migrations/20260814014500_pos_h101_reference_family_scope_guard.sql';
const guardVerificationPath = './supabase/migrations/20260814014600_pos_h101_reference_family_scope_guard_verification.sql';

let pass = 0, fail = 0;
function ok(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
}

function runtime() {
  const memory = new Map(); let sequence = 0;
  const noop = () => {};
  const localStorage = {
    getItem: key => memory.has(key) ? memory.get(key) : null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key), clear: () => memory.clear(),
  };
  const sandbox = {
    console, localStorage, Date, setTimeout, clearTimeout, JSON, Math, Object,
    Array, String, Number, Boolean, isNaN, parseInt, parseFloat, RegExp, Error,
    Set, Map, Promise, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  };
  sandbox.window = {
    localStorage, dispatchEvent: noop, addEventListener: noop, removeEventListener: noop,
    CORE: { catalogProducts: () => [], saveCatalogProducts: noop, registerCatalogProducts: noop,
      registerSyncGateway: noop, invokeSync: noop, getDeviceId: () => 'h101-device' },
    UI: { toast: noop },
    crypto: { randomUUID: () => {
      sequence += 1; const head = sequence.toString(16).padStart(8, '0');
      return `${head}-0000-4000-8000-${head.padStart(12, '0')}`;
    } },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(configSrc, sandbox);
  vm.runInContext(dataSrc, sandbox);
  return { C: sandbox.window.CONFIG, D: sandbox.window.DATA };
}

const { C, D } = runtime();
const base = {
  cat: '1', modelo: 'ADR', nombre: 'ADRIANO', manga: 'MC', tela: 'LIN', color: 'BL',
  cuello: 'MAO', orn: 'Bordado Eléctrico', ornamentColorCodes: ['DRO'],
  sizeCategoryId: 'size_number', sizeCode: '38', stockQuantity: 3, precio: 1150,
  attrs: { corte: 'SLF', caracteristicas: '23' },
};
const familyId = '10100000-0000-4000-8000-000000000101';

console.log('\n── Autoridad de familia ──');
ok('1. CONFIG publica captureScope interno',
  C.catalogMeta('category')?.captureScope === 'family'
  && C.catalogMeta('ornament_color')?.captureScope === 'reference'
  && C.catalogMeta('corte')?.captureScope === 'reference');
const zero = D.createReference({ ...base, referenceFamilyId: familyId, sizeCode: '44', stockQuantity: 0 }, []);
ok('2. createReference preserva referenceFamilyId explícito', zero.referenceFamilyId === familyId);
ok('3. una referencia seleccionada existe con stock escalar cero',
  zero.recordModel === 'v2' && zero.stockQuantity === 0 && zero.stock?.[0]?.stock === 0);
const singleton = D.createReference({ ...base, sizeCode: '46', stockQuantity: 0 }, []);
ok('4. V2 individual sin familia recibe UUID singleton',
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(singleton.referenceFamilyId || ''));
D.products.push(zero, D.createReference({ ...base, referenceFamilyId: familyId, sizeCode: '40', stockQuantity: 5 }, [zero]));
ok('5. DATA reconstruye hermanos sólo por UUID exacto',
  typeof D.referenceFamily === 'function'
  && D.referenceFamily(zero).length === 2
  && D.referenceFamily(singleton).length === 0);

console.log('\n── Persistencia y frontera ──');
ok('6. STORE sube y baja reference_family_id',
  /reference_family_id:\s*p\.referenceFamilyId/.test(storeSrc)
  && /referenceFamilyId:\s*r\.reference_family_id/.test(storeSrc));
ok('7. la cola conserva lotes por rowIds exactos',
  /rowIds/.test(storeSrc) && /product_scope_required/.test(storeSrc));
ok('8. existe RPC H-101 transaccional y auditado',
  existsSync(new URL(migrationPath, import.meta.url))
  && /commit_reference_family_batch/i.test(read(migrationPath))
  && /capability_operation_audit/i.test(read(migrationPath)));
ok('9. existe verificación H-101 separada', existsSync(new URL(verificationPath, import.meta.url)));
ok('9b. el RPC rechaza IDs V1 o ajenos y oculta su implementación interna',
  existsSync(new URL(guardPath, import.meta.url))
  && /REFERENCE_FAMILY_EXISTING_SCOPE_MISMATCH/.test(read(guardPath))
  && /revoke all on function pos\.commit_reference_family_batch_h101_internal/.test(read(guardPath))
  && existsSync(new URL(guardVerificationPath, import.meta.url)));

console.log('\n── Excel y experiencia ──');
ok('10. Excel declara columna técnica de familia',
  /_BALAM_REFERENCE_FAMILY_ID/.test(xlsxSrc) && /referenceFamilyId/.test(xlsxSrc));
ok('11. Excel sigue actualizando V2 por ID, no por familia',
  /_BALAM_ID_PRODUCTO/.test(xlsxSrc) && !/byFamily\[incoming\.referenceFamilyId\]/.test(xlsxSrc));
ok('12. Nuevo producto distingue seleccionar referencia de stock positivo',
  /createReferenceSelected|selectedForCreation/.test(inventorySrc));
ok('13. Editar V2 reconstruye la familia administrativa',
  /referenceFamily\(/.test(inventorySrc) && /referenceFamilyId/.test(inventorySrc));
ok('14. la UI no expone terminología técnica',
  !/['"`]reference_family_id['"`]/.test(inventorySrc));

console.log('\n── Piloto sintético ADRIANO ──');
const pilot = D.materializeReferenceFamily({ ...base, referenceFamilyId: familyId }, [
  { selectedForCreation: true, sizeCode: '38', sizeScale: 'N', stockQuantity: 3, precio: 1150, ornamentColorCodes: ['DRO'] },
  { selectedForCreation: true, sizeCode: '40', sizeScale: 'N', stockQuantity: 5, precio: 1150, ornamentColorCodes: ['DRO'] },
  { selectedForCreation: true, sizeCode: '40', sizeScale: 'N', stockQuantity: 2, precio: 1150, ornamentColorCodes: ['AZL'] },
  { selectedForCreation: true, sizeCode: '42', sizeScale: 'N', stockQuantity: 8, precio: 1250, ornamentColorCodes: ['CF', 'DRO'] },
  { selectedForCreation: true, sizeCode: '44', sizeScale: 'N', stockQuantity: 0, precio: 1150, ornamentColorCodes: ['DRO'] },
  { selectedForCreation: false, sizeCode: '46', sizeScale: 'N', stockQuantity: 0, precio: 1150, ornamentColorCodes: ['DRO'] },
], [], familyId);
const ids = pilot.references.map(row => row.id);
const barcodes = pilot.references.map(row => row.barcodeCode);
ok('15. el piloto materializa exactamente cinco referencias seleccionadas', pilot.references.length === 5);
ok('16. las cinco referencias tienen products.id únicos', new Set(ids).size === 5);
ok('17. las cinco referencias tienen barcodes únicos', new Set(barcodes).size === 5);
ok('18. todas comparten un referenceFamilyId',
  new Set(pilot.references.map(row => row.referenceFamilyId)).size === 1
  && pilot.references[0].referenceFamilyId === familyId);
ok('19. stock total derivado = 18', pilot.totalPieces === 18);
ok('20. talla 40 total derivado = 7',
  pilot.references.filter(row => row.sizeCode === '40').reduce((sum, row) => sum + row.stockQuantity, 0) === 7);
const size40 = pilot.references.filter(row => row.sizeCode === '40');
ok('21. 40/DRO y 40/AZL son independientes',
  size40.length === 2 && size40[0].id !== size40[1].id
  && size40[0].physicalSignature !== size40[1].physicalSignature);
ok('22. multicolor CF+DRO queda canónico en su referencia',
  JSON.stringify(pilot.references.find(row => row.sizeCode === '42').ornamentColorCodes) === JSON.stringify(['CF', 'DRO']));
ok('23. precios especiales se materializan por referencia',
  pilot.references.find(row => row.sizeCode === '42').precio === 1250
  && pilot.references.find(row => row.sizeCode === '38').precio === 1150);
const zeroPilot = pilot.references.find(row => row.sizeCode === '44');
ok('24. la referencia 44 existe y conserva stock cero',
  !!zeroPilot && zeroPilot.stockQuantity === 0 && zeroPilot.id && zeroPilot.barcodeCode);
ok('25. STORE usa un único lote familiar con rowIds exactos',
  /familyBatch:\s*true/.test(storeSrc) && /pushProductFamilyBatch/.test(storeSrc)
  && /commit_reference_family_batch/.test(storeSrc));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
