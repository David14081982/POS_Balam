// H-80 · El centro de equipos converge y no genera tráfico por estado idéntico.
import { readFileSync, readdirSync } from 'node:fs';

let pass = 0, fail = 0;
function check(name, condition) {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
}

const store = readFileSync('balam/store.jsx', 'utf8');
const migrations = readdirSync('supabase/migrations').filter(x => x.endsWith('.sql')).sort();
const sql = migrations.map(x => readFileSync('supabase/migrations/' + x, 'utf8')).join('\n').toLowerCase();

check('1. el heartbeat no vuelve a proyectar toda la cola',
  !/async function heartbeatDevice[\s\S]{0,1200}await reportQueueActivity\(c\)/.test(store));
check('2. una actividad idéntica no invalida devices',
  /h80_sync_activity_material_change/.test(sql)
    && /is not distinct from/.test(sql));
check('3. insertar o borrar actividad sigue invalidando devices',
  /tg_op in \('insert','delete'\)/.test(sql));
check('4. un cambio material de estado sigue invalidando devices',
  /new\.status[\s\S]{0,900}old\.status/.test(sql));
check('5. devices se aplica sin reconciliación comercial',
  /function invalidateDomain[\s\S]{0,650}domain === 'devices'[\s\S]{0,500}syncfleetchange/.test(store));
check('6. el cursor de devices avanza antes de publicar la flota',
  /domain === 'devices'[\s\S]{0,300}syncCursors\[domain\] = next[\s\S]{0,300}syncfleetchange/.test(store));
check('7. existe verificación SQL posterior para H-80',
  migrations.some(x => /h80.*verification/.test(x)));

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
