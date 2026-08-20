import fs from 'node:fs';

const read = file => fs.readFileSync(file, 'utf8');
const migration = read('supabase/migrations/20260820016500_pos_h124_cleanup_preview_stability.sql');
const verification = read('supabase/migrations/20260820016600_pos_h124_cleanup_preview_stability_verification.sql');
const functional = read('test-h124-cleanup-preview-stability-functional.sql');
const settings = read('balam/settings.jsx');
const store = read('balam/store.jsx');
const failures = [];
let passed = 0;
const check = (name, condition) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
  condition ? passed++ : failures.push(name);
};

check('1. existe una autoridad privada para la huella',
  /function\s+pos\.test_data_cleanup_plan_hash\s*\(p_plan jsonb\)/i.test(migration)
    && /revoke all on function pos\.test_data_cleanup_plan_hash\(jsonb\)[\s\S]*authenticated/i.test(migration));
check('2. la huella excluye sólo telemetría de flota',
  /point_zero_sha256\(coalesce\(p_plan, '\{\}'::jsonb\) - 'fleet'\)/i.test(migration));
check('3. la flota usa la autoridad de huella estable',
  /pos\.test_data_cleanup_plan_hash\(v_core\)/i.test(migration));
check('4. la migración falla si el parche no es exacto',
  /H124_FLEET_PATCH_MISMATCH:hash/.test(migration)
    && /H124_FLEET_PATCH_MISMATCH:schema/.test(migration));
check('5. la verificación prohíbe la huella anterior',
  /pos\.point_zero_sha256\(v_core\)[\s\S]*<>0/i.test(verification));
check('6. un latido distinto debe conservar el hash',
  /H124_HEARTBEAT_CHANGED_PLAN_HASH/.test(functional));
check('7. una operación intersectante debe invalidarlo',
  /pending_operation_intersects_cleanup/.test(functional)
    && /H124_BLOCKING_CHANGE_DID_NOT_INVALIDATE_HASH/.test(functional));
check('8. el cliente exige el esquema H-124',
  /SYNC_SCHEMA_VERSION\s*=\s*20260820016500/.test(store));
check('9. la UI reconoce ambas formas del código',
  /\/cleanup_preview_changed\/i/.test(settings));
check('10. la UI refresca y no continúa con el plan viejo',
  /previewTestDataCleanup\([\s\S]{0,220}onPreviewChanged\(refreshed\)/.test(settings));
check('11. el mensaje afirma que no hubo respaldo ni borrado',
  /No se creó ningún respaldo ni se borró información/.test(settings));

console.log(`\nH-124: ${passed} aprobadas, ${failures.length} fallidas`);
if (failures.length) process.exit(1);
