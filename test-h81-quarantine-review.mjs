// H-81 · Expediente legible y decisión segura de cuarentena.
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

check('1. existe expediente central de cuarentena', sql.includes('pos.sync_quarantine_cases'));
check('2. el expediente conserva huella y no el payload completo',
  sql.includes('payload_hash') && sql.includes('payload_summary') && !sql.includes('payload_full'));
check('3. anónimo no puede leer ni escribir expedientes',
  /revoke all on pos\.sync_quarantine_cases[\s\S]{0,180}from public, anon/.test(sql));
check('4. reportar deriva usuario autenticado en servidor',
  /function pos\.report_sync_quarantine[\s\S]{0,1600}auth\.uid\(\)/.test(sql));
check('5. sólo administrador decide',
  /function pos\.admin_decide_sync_quarantine[\s\S]{0,700}is_active_admin/.test(sql));
check('6. la decisión no escribe documentos comerciales',
  !/admin_decide_sync_quarantine[\s\S]{0,2500}(insert into pos\.(sales|products)|update pos\.(sales|products))/.test(sql));
check('7. el equipo de origen consume aprobaciones',
  /consumeSyncQuarantineDecisions/.test(store) && /consume_sync_quarantine_decisions/.test(store));
check('8. aprobar restaura la operación original a la cola',
  /restoreQuarantinedOperation[\s\S]{0,1800}saveQ/.test(store));
check('9. la ejecución atraviesa flushQueue',
  /consumeSyncQuarantineDecisions[\s\S]{0,2200}flushQueue/.test(store));
check('10. el JSON técnico se conserva', /function exportSyncRecovery/.test(store));
check('11. existe reporte Excel con resumen y operaciones',
  /exportQuarantineReport/.test(store) && /book_new/.test(store)
    && /Resumen/.test(store) && /Operaciones/.test(store));
check('12. el centro muestra cuarentena y permite exportar',
  /data-testid[^\n]*sync-quarantine/.test(settings) && /exportQuarantineReport/.test(settings));
check('13. aprobar y rechazar tienen contratos estables',
  /data-testid[^\n]*quarantine-approve/.test(settings)
    && /data-testid[^\n]*quarantine-reject/.test(settings));
check('14. existe verificación SQL conductual posterior',
  migrations.some(x => /h81.*verification/.test(x)));
check('15. existe documento de cierre', existsSync('docs/fixes/revision-de-cuarentena.md'));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
