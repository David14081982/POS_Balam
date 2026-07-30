import fs from 'node:fs';

let passed = 0;
let failed = 0;
function check(label, condition) {
  console.log(`${condition ? '✅' : '❌'} ${label}`);
  condition ? passed++ : failed++;
}

const modelPath = 'supabase/migrations/20260730007000_pos_h56_permission_model.sql';
const verifyPath = 'supabase/migrations/20260730007100_pos_h56_permission_model_verification.sql';
const model = fs.existsSync(modelPath) ? fs.readFileSync(modelPath, 'utf8') : '';
const verify = fs.existsSync(verifyPath) ? fs.readFileSync(verifyPath, 'utf8') : '';
const screens = fs.readFileSync('balam/screens.jsx', 'utf8');

[
  'permission_roles',
  'user_permission_role_assignments',
  'role_screen_permissions',
  'user_screen_permission_overrides',
  'permission_change_audit',
].forEach(table => check(`modelo crea pos.${table}`,
  new RegExp(`create table if not exists pos\\.${table}\\b`, 'i').test(model)));

check('overrides restringen allow y deny',
  /check\s*\(\s*effect\s+in\s*\(\s*'allow'\s*,\s*'deny'\s*\)\s*\)/i.test(model));
check('asignaciones y overrides referencian identidades Auth',
  (model.match(/references\s+auth\.users\s*\(\s*id\s*\)/gi) || []).length >= 2);
check('la resolución declara precedencia override, rol y default',
  /resolve_screen_permission/i.test(model)
    && /override/i.test(model)
    && /role/i.test(model)
    && /default/i.test(model));
check('las APIs cubren actual, listado y consulta administrativa',
  /current_screen_permission/i.test(model)
    && /current_screen_permissions/i.test(model)
    && /admin_screen_permission/i.test(model));
check('las escrituras administrativas son RPC atómicas y auditadas',
  /admin_apply_user_screen_permissions/i.test(model)
    && /admin_apply_role_screen_permissions/i.test(model)
    && /permission_change_audit/i.test(model)
    && /\bbegin\b/i.test(model)
    && /\bcommit\b/i.test(model));
check('las nuevas tablas habilitan RLS y revocan escritura directa',
  (model.match(/enable row level security/gi) || []).length >= 5
    && /revoke all on pos\.permission_roles/i.test(model)
    && /grant select/i.test(model));
check('el registro reserva config.permisos sin mostrarlo todavía',
  /id:\s*'config\.permisos'/.test(screens)
    && /enabled:\s*false/.test(screens));
check('la verificación ejecuta casos positivos y negativos',
  /raise exception/i.test(verify)
    && /override_allow/i.test(verify)
    && /override_deny/i.test(verify)
    && /unknown_screen/i.test(verify)
    && /inactive_user/i.test(verify)
    && /orphan_user/i.test(verify)
    && /last_permission_admin/i.test(verify));

console.log(`\n════════ ${passed} pasaron, ${failed} fallaron ════════`);
process.exit(failed ? 1 : 0);
