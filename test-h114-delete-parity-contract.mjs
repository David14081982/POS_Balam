import fs from 'node:fs';

const read = path => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
const checks = [];
const check = (name, condition) => checks.push({ name, ok: Boolean(condition) });

const inventory = read('balam/inventory.jsx');
const data = read('balam/data.jsx');
const store = read('balam/store.jsx');
const migration = read('supabase/migrations/20260818015100_pos_h114_product_delete_scope.sql');
const verification = read('supabase/migrations/20260818015200_pos_h114_product_delete_scope_verification.sql');

check('Inventario expone baja V2', /product-detail-delete/.test(inventory) && !/!p\.isFamilyProjection\s*&&\s*h\('button',[\s\S]{0,300}Eliminar/.test(inventory));
check('familia múltiple distingue referencia y familia', /Eliminar una referencia/.test(inventory) && /Eliminar toda la familia/.test(inventory));
check('selector muestra identidad humana sin UUID', /product-delete-reference/.test(inventory) && /referenceDeleteLabel/.test(inventory));
check('toda baja exige confirmación', /product-delete-confirm/.test(inventory) && /Confirmar eliminación/.test(inventory));
check('DATA publica autoridad de alcance', /function productDeletionGuard\(/.test(data) && /function removeProductScope\(/.test(data));
check('guardas reutilizan apartado, préstamo, cola y saldo', /assertLayawayProductsUnlocked/.test(data) && /loanedQty\(/.test(data) && /queueStatus/.test(data) && /saleLineBalance\(/.test(data));
check('STORE encola una sola operación de alcance', /type:\s*'productDeleteScope'/.test(store) && /function deleteProductScope\(/.test(store));
check('STORE llama RPC familiar atómica', /delete_products_checked_v2/.test(store));
check('migración exige inventory.delete', /require_current_capability\('inventory\.delete'\)/.test(migration));
check('migración valida alcance familiar exacto', /REFERENCE_FAMILY_SCOPE_MISMATCH/.test(migration) && /reference_family_id/.test(migration));
check('migración conserva tombstone e idempotencia', /deleted_at\s*=\s*now\(\)/i.test(migration) && /capability_operation_audit/.test(migration));
check('servidor bloquea préstamo y restitución futura', /PRODUCT_OPEN_LOAN/.test(migration) && /PRODUCT_RETURNABLE_HISTORY/.test(migration));
check('verificación cubre referencia, familia, permisos e idempotencia', /H-114/.test(verification) && /inventory\.delete/.test(verification) && /idempot/i.test(verification));

for (const result of checks) console.log(`${result.ok ? 'OK' : 'FAIL'} · ${result.name}`);
const failed = checks.filter(result => !result.ok);
console.log(`\nH-114 contrato: ${checks.length - failed.length}/${checks.length} verificaciones aprobadas.`);
if (failed.length) process.exit(1);
