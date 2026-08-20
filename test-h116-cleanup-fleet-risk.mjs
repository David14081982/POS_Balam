import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const exists = path => fs.existsSync(path) ? read(path) : '';
const migration = exists('supabase/migrations/20260818015300_pos_h116_cleanup_fleet_risk.sql');
const verification = exists('supabase/migrations/20260818015400_pos_h116_cleanup_fleet_risk_verification.sql');
const reconciliation = exists('test-h116-reconciliation-functional.sql');
const store = read('balam/store.jsx');
const settings = read('balam/settings.jsx');
const failures = [];
let passed = 0;

function check(name, condition) {
  if (condition) { passed++; console.log(`PASS ${name}`); }
  else { failures.push(name); console.error(`FAIL ${name}`); }
}

check('1. existe una autoridad SQL de riesgo de flota',
  /function\s+pos\.test_data_cleanup_fleet_risk\s*\(/i.test(migration));
check('2. el preview usa la autoridad de riesgo y no la presencia global',
  /test_data_cleanup_fleet_risk\s*\(\s*pos\.test_data_cleanup_plan/i.test(migration));
check('3. la guarda general anterior se retira del preview efectivo',
  /e\.value\s*#>>\s*'\{\}'\s*=\s*'cleanup_not_synchronized'/i.test(migration)
    && /e\.value->>'code'\s*=\s*'client_schema_incompatible'/i.test(migration));
check('4. una terminal compatible apagada se clasifica sin bloqueo',
  /compatible_offline/i.test(migration) && /blocking[^\n]*false/i.test(verification));
check('5. un cliente anterior cercable queda para actualizar al volver',
  /update_on_return/i.test(migration) && /must_rebootstrap/i.test(verification));
check('6. un cliente demasiado antiguo falla cerrado',
  /v_state\s*:=\s*'unsafe_legacy'[\s\S]{0,120}v_blocking\s*:=\s*true/i.test(migration)
    && /client_cannot_be_fenced/i.test(migration));
check('7. una operacion conocida que intersecta el plan bloquea',
  /pending_operation_intersects_cleanup/i.test(migration));
check('8. una operacion conocida ajena al plan no bloquea',
  /c-isolated/i.test(reconciliation)
    && /state='update_on_return'\s+and blocking=false/i.test(reconciliation));
check('9. una cola sin proyeccion suficiente falla cerrada',
  /pending_scope_unknown/i.test(migration));
check('10. la cuarentena participa en la interseccion',
  /sync_quarantine_cases/i.test(migration) && /pending_review/i.test(migration));
check('11. la ejecucion eleva protocolo y epoca en la misma transaccion',
  /sync_protocol_min\s*=\s*greatest\(sync_protocol_min,\s*2\)/i.test(migration)
    && /data_epoch\s*=\s*data_epoch\s*\+\s*1/i.test(migration));
check('12. el evento nuevo invalida clientes H-113 anteriores',
  /minimum_client_protocol'\s*,\s*3/i.test(migration)
    && /values\s*\(p_cleanup_id,\s*3,\s*3/i.test(migration));
check('13. el cliente vigente declara protocolo de escritura 2',
  /SYNC_PROTOCOL_VERSION\s*=\s*2/.test(store));
check('14. el cliente vigente declara protocolo selectivo 4',
  /SELECTIVE_CLEANUP_PROTOCOL\s*=\s*4/.test(store));
check('15. una limpieza remota no fuerza compatibilidad sin releer manifiesto',
  !/applyRemoteSelectiveCleanup[\s\S]{0,2200}syncCompatibility\s*=\s*['"]ok['"]/.test(store));
check('16. existe autoridad administrativa para retirar/reactivar equipos',
  /admin_set_sync_device_retired/i.test(migration) && /setSyncDeviceRetired/.test(store));
check('17. el heartbeat no reactiva silenciosamente un equipo retirado',
  /status\s*<>\s*'revoked'/i.test(migration));
check('18. la UI traduce A/B/C/D sin exponer codigos como mensaje principal',
  /Equipo apagado — no bloquea/i.test(settings)
    && /Se actualizará al volver — no bloquea/i.test(settings)
    && /Tiene una operación pendiente que afecta esta limpieza — bloquea/i.test(settings)
    && /Equipo demasiado antiguo; actualízalo o retíralo — bloquea/i.test(settings));
check('19. la UI reserva schema/protocolo para Ver detalle',
  /Ver detalle/i.test(settings) && /cleanup-fleet-details/.test(settings));
check('20. la verificacion ejecuta A/B/C/D y el retiro administrativo',
  ['a-offline','b-intersects','c-isolated','d-pre-h77']
    .every(token => reconciliation.includes(token))
    && verification.includes('retired_device'));

console.log(`\nH-116: ${passed} aprobadas, ${failures.length} fallidas`);
if (failures.length) process.exit(1);
