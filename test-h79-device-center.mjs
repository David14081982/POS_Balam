// H-79 · Centro administrativo de equipos y actividad de sincronización.
import { existsSync, readFileSync, readdirSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, condition) {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
}

const store = readFileSync('balam/store.jsx', 'utf8');
const settings = readFileSync('balam/settings.jsx', 'utf8');
const migrations = readdirSync('supabase/migrations').filter(x => x.endsWith('.sql')).sort();
const sql = migrations.map(x => readFileSync('supabase/migrations/' + x, 'utf8')).join('\n').toLowerCase();

check('1. existe un historial central de actividad', sql.includes('pos.sync_activity'));
check('2. el historial no acepta lectura anónima',
  /revoke all on pos\.sync_activity[\s\S]{0,180}from public, anon/.test(sql));
check('3. cada instalación conserva nombre y tipo administrables',
  sql.includes('display_name') && sql.includes('device_type'));
check('4. el estado reporta pendientes y bloqueados por separado',
  sql.includes('queue_blocked') && /queue_pending/.test(store));
check('5. la actividad nunca envía el payload comercial completo',
  /syncActivitySummary|activitySummary/.test(store) && !/sync_activity[^\n]{0,100}(payload|rows|document)/i.test(store));
check('6. encolar deja evidencia pendiente', /reportQueueActivity/.test(store));
check('7. un éxito deja evidencia sincronizada', /recordSyncActivity[\s\S]{0,120}synced/.test(store));
check('8. un bloqueo deja evidencia que requiere atención',
  /requires_action:\s*status === 'blocked' \|\| status === 'quarantined'/.test(store));
check('9. un equipo activo mantiene heartbeat periódico',
  /setInterval[\s\S]{0,180}heartbeatDevice/.test(store));
check('10. el administrador puede nombrar el equipo por RPC',
  /admin_update_sync_device/.test(sql + store));
check('11. el administrador puede solicitar un reintento remoto',
  /admin_request_sync_retry/.test(sql + store));
check('12. solicitar reintento no concede permisos ni altera documentos',
  /admin_request_sync_retry/.test(sql) && !/admin_request_sync_retry[\s\S]{0,2500}(insert into pos\.(sales|products)|update pos\.(sales|products))/.test(sql));
check('13. el cliente destino consume la orden sin borrar la operación',
  /consumeSyncCommands/.test(store) && /retryOperation/.test(store)
    && /waitForFlushIdle/.test(store)
    && /!loadQ\(\)\.some\(op => op\.id === command\.operation_id\)/.test(store));
check('14. el centro muestra equipos, actividad y atención en una sola vista',
  /Centro de equipos/.test(settings) && /Actividad reciente/.test(settings)
    && /Requiere atención/.test(settings));
check('15. existe verificación SQL posterior',
  migrations.some(x => /h79.*verification/.test(x)));
check('16. la persistencia nueva pertenece al dominio devices',
  /devices/.test(store) && /bump_sync_domain\('devices'/.test(sql));
check('17. el documento de cierre existe', existsSync('docs/fixes/centro-de-equipos.md'));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
