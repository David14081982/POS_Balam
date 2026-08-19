import fs from 'node:fs';

const read = path => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
const migration = read('supabase/migrations/20260819015500_pos_h118_sync_activity_reconciliation.sql');
const verification = read('supabase/migrations/20260819015600_pos_h118_sync_activity_reconciliation_verification.sql');
const functional = read('test-h118-sync-activity-reconciliation-functional.sql');
const settings = read('balam/settings.jsx');
const failures = [];
let passed = 0;

function check(name, condition) {
  if (condition) { passed++; console.log(`PASS ${name}`); }
  else { failures.push(name); console.error(`FAIL ${name}`); }
}

check('1. H-118 redefine hacia adelante la autoridad H-116',
  /create\s+or\s+replace\s+function\s+pos\.test_data_cleanup_fleet_risk\s*\(/i.test(migration));
check('2. cola cero separa proyecciones historicas de operaciones actuales',
  /queue_pending[\s\S]*historical_incidents/i.test(migration)
    && /current_operations/i.test(migration));
check('3. una cuarentena reproducible conserva el bloqueo',
  /sync_quarantine_cases/i.test(migration)
    && /pending_operation_intersects_cleanup/i.test(migration));
check('4. la cola sin proyeccion suficiente falla cerrada',
  /pending_scope_unknown/i.test(migration));
check('5. el cliente no cercable sigue fallando cerrado',
  /client_cannot_be_fenced/i.test(migration));
check('6. la UI distingue pendientes actuales de incidencias historicas',
  /operaciones pendientes actuales/i.test(settings)
    && /incidencias históricas/i.test(settings));
check('7. la UI conserva folio, tipo y estado disponibles en la autoridad',
  /historical_incidents/i.test(settings)
    && /reference/i.test(settings) && /operation_type/i.test(settings));
check('8. la verificacion funcional fija los casos A-F y termina en rollback',
  ['case-a','case-b','case-c','case-d','case-e','case-f']
    .every(token => functional.includes(token))
    && /rollback\s*;/i.test(functional));
check('9. la migracion de verificacion ejerce la autoridad y aborta',
  /test_data_cleanup_fleet_risk/i.test(verification)
    && /raise\s+exception/i.test(verification) && /rollback\s*;/i.test(verification));
check('10. H-118 no llama ninguna ejecucion destructiva',
  !/execute_test_data_cleanup\s*\(/i.test(functional)
    && !/point_zero/i.test(functional));

console.log(`\nH-118: ${passed} aprobadas, ${failures.length} fallidas`);
if (failures.length) process.exit(1);
