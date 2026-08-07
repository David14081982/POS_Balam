// H-77 · Contrato de sincronización viva y evolutiva.
// Primero funciona como reproducción roja: exige las defensas, no una forma
// accidental del código. Las pruebas dinámicas A→B se añaden al existir el seam.
import { existsSync, readFileSync, readdirSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
}

const store = readFileSync('balam/store.jsx', 'utf8');
const core = readFileSync('balam/core.jsx', 'utf8');
const migrations = readdirSync('supabase/migrations').filter(x => x.endsWith('.sql')).sort();
const sql = migrations.map(x => readFileSync('supabase/migrations/' + x, 'utf8')).join('\n').toLowerCase();

check('1. existe la decisión del protocolo',
  existsSync('docs/architect/decisions/ADR-012-protocolo-evolutivo-de-sincronizacion.md'));
check('2. el servidor publica un manifiesto versionado', sql.includes('pos.system_manifest'));
check('3. el servidor registra terminales', sql.includes('pos.sync_devices'));
check('4. existe un reloj durable por dominio', sql.includes('pos.sync_domain_versions'));
check('5. existe una época de línea base', /data_epoch|inventory_epoch/.test(sql));
check('6. el cliente declara versión de protocolo', /sync_protocol_version/i.test(store));
check('7. STORE tiene un registro declarativo de dominios', /sync_domains|domain_registry/i.test(store));
check('8. Realtime escucha sólo invalidaciones',
  /postgres_changes/.test(store) && /sync_domain_versions/.test(store));
check('9. el cliente conserva cursores durables', /sync_domain_cursors/.test(store));
check('10. un evento perdido se recupera al volver visible', /visibilitychange/.test(store));
check('11. reconectar también reconcilia entrada',
  /addEventListener\(['"]online['"][\s\S]{0,500}reconcil/i.test(store));
check('12. existe compuerta de actividad compartida',
  /beginActivity|activity\.begin/.test(core + store));
check('13. STORE expone estado demostrable de sincronización', /syncStatus/.test(store));
check('14. configuración se confirma por RPC atómica',
  /commit_config/.test(store) && /create or replace function pos\.commit_config/.test(sql));
check('15. una época obsoleta tiene rechazo nombrado',
  /epoch_mismatch|stale_epoch|rebootstrap_required/.test(sql));
check('16. la infraestructura nueva tiene verificación SQL posterior',
  migrations.some(x => /h77.*verification/.test(x)));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
check('17. inventario viejo pierde permiso y escribe con protocolo/época',
  /revoke all on function pos\.save_products_checked\(uuid,jsonb\) from authenticated/.test(sql)
    && /save_products_checked_v2/.test(store + sql));
check('18. el punto cero queda firmado y auditable',
  /inventory_sync_baselines/.test(sql) && /establishPointZero/.test(store));
check('19. una cola obsoleta se conserva en cuarentena antes del rebootstrap',
  /balam_sync_quarantine_/.test(store) && /exportSyncRecovery/.test(store));
check('20. el panel puede demostrar el estado de toda la flota',
  /syncFleetStatus/.test(store) && /sync_devices/.test(sql));

process.exit(fail ? 1 : 0);
