import fs from 'node:fs';

const read = path => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
const migration = read('supabase/migrations/20260820016800_pos_h125_device_attention_projection.sql');
const verification = read('supabase/migrations/20260820016900_pos_h125_device_attention_projection_verification.sql');
const remoteFunctional = read('supabase/migrations/20260820017000_pos_h125_device_attention_projection_functional_verification.sql');
const store = read('balam/store.jsx');
const settings = read('balam/settings.jsx');
const functional = read('test-h125-device-attention-projection-functional.sql');
const failures = [];
let passed = 0;

function check(name, condition) {
  if (condition) { passed++; console.log(`PASS ${name}`); }
  else { failures.push(name); console.error(`FAIL ${name}`); }
}

check('1. projection joins activity with declared device queue',
  /requiresAttention[\s\S]{0,500}queue_pending/.test(store)
    && /requiresAttention[\s\S]{0,500}queue_blocked/.test(store));
check('2. reviewed incident does not require attention again',
  /admin_action\s*!==\s*['"]review['"]/.test(store));
check('3. counter and tab consume the current projection',
  /filter\(item\s*=>\s*item\.requires_attention\)/.test(settings)
    && /attention:\s*activity\.filter\(a\s*=>\s*a\.requires_attention\)/.test(store));
check('4. history remains visible without operational actions',
  /Incidencia hist/.test(settings)
    && /const actionable = item\.requires_attention/.test(settings));
check('5. review closes requires_action in SQL authority',
  /admin_mark_sync_activity_reviewed[\s\S]*requires_action\s*=\s*false/i.test(migration));
check('6. retry request requires current pending and blocked queue',
  /admin_request_sync_retry[\s\S]*queue_pending\s*>\s*0[\s\S]*queue_blocked\s*>\s*0/i.test(migration));
check('7. reviewed incident cannot be retried',
  /admin_request_sync_retry[\s\S]*admin_action\s+is\s+distinct\s+from\s+'review'/i.test(migration));
check('8. command consumption revalidates queue before delivery',
  /consume_sync_commands[\s\S]*queue_pending\s*>\s*0[\s\S]*queue_blocked\s*>\s*0/i.test(migration));
check('9. verification covers BG-260812-0006 and rolls fixtures back',
  /BG-260812-0006/.test(functional) && /rollback\s*;/i.test(functional)
    && /BG-260812-0006/.test(remoteFunctional) && /rollback\s*;/i.test(remoteFunctional));
check('10. deploy verifier exists and schema is raised',
  /H125_DEVICE_ATTENTION_OK/.test(verification)
    && /20260820016800/.test(migration));

console.log(`\nH-125: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
