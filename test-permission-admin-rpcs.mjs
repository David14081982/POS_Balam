import fs from 'node:fs';

const functionalPath =
  'supabase/migrations/20260730007400_pos_h56_permission_admin_api.sql';
const verificationPath =
  'supabase/migrations/20260730007500_pos_h56_permission_admin_api_verification.sql';
const functional = fs.existsSync(functionalPath)
  ? fs.readFileSync(functionalPath, 'utf8')
  : '';
const verification = fs.existsSync(verificationPath)
  ? fs.readFileSync(verificationPath, 'utf8')
  : '';

let passed = 0;
let failed = 0;
function check(label, condition) {
  if (condition) {
    passed++;
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.error(`❌ ${label}`);
  }
}

check('crea una API paginable de identidades Auth', /admin_permission_users\s*\(/i.test(functional));
check('crea snapshot administrativo por usuario', /admin_user_permission_snapshot\s*\(/i.test(functional));
check('crea catálogo servidor persistido', /create table if not exists pos\.screen_permission_catalog/i.test(functional));
check('versiona globalmente el catálogo', /screen_permission_catalog_state/i.test(functional));
check('sincroniza el catálogo con guarda administrativa', /admin_sync_screen_permission_catalog/i.test(functional));
check('la asignación de rol tiene estado activo', /user_permission_role_assignments[\s\S]*add column if not exists active/i.test(functional));
check('publica un token estable de concurrencia', /user_screen_permissions_version\s*\(/i.test(functional));
check('el token incluye rol activo y catálogo', /permission_roles[\s\S]*active/i.test(functional) && /catalog_version/i.test(functional));
check('el guardado recibe una versión esperada', /p_expected_version\s+text/i.test(functional));
check('el guardado serializa por usuario', /pg_advisory_xact_lock/i.test(functional));
check('el conflicto aborta sin sobrescribir', /errcode\s*=\s*'40001'/i.test(functional));
check('el guardado conserva una sola operación auditada', /batch_id/i.test(functional));
check('valida claves contra el catálogo activo', /SCREEN_KEY_(UNKNOWN|INACTIVE)/.test(functional));
check('rechaza duplicados y efectos inválidos', /SCREEN_KEYS_DUPLICATED/.test(functional) && /OVERRIDE_EFFECT_INVALID/.test(functional));
check('rechaza identidad inexistente e inactiva', /TARGET_USER_NOT_FOUND/.test(functional) && /TARGET_USER_INACTIVE/.test(functional));
check('las RPC administrativas conservan guarda propia', (functional.match(/can_manage_screen_permissions\s*\(\s*auth\.uid\(\)/gi) || []).length >= 2);
check('protege la invariante con triggers diferidos', /create constraint trigger[\s\S]*deferrable initially deferred/i.test(functional));
check('public y anon permanecen revocados', /revoke all on function[\s\S]*from public,\s*anon/i.test(functional));
check('la verificación prueba conflicto y atomicidad', /H56_PERMISSION_CONFLICT_FAILED/.test(verification) && /H56_PERMISSION_ATOMICITY_FAILED/.test(verification));
check('la verificación prueba no autorizado y último administrador', /H56_PERMISSION_UNAUTHORIZED_FAILED/.test(verification) && /H56_LAST_PERMISSION_ADMIN_FAILED/.test(verification));
check('la verificación cubre búsqueda, límites e inactivo', /H56_PERMISSION_SEARCH_FAILED/.test(verification) && /H56_PERMISSION_PAGE_LIMIT_FAILED/.test(verification) && /H56_PERMISSION_INACTIVE_FAILED/.test(verification));
check('la verificación cubre todas las causas del token', /H56_TOKEN_ASSIGNMENT_ACTIVE_FAILED/.test(verification) && /H56_TOKEN_ROLE_ACTIVE_FAILED/.test(verification) && /H56_TOKEN_USER_STATE_FAILED/.test(verification) && /H56_TOKEN_CATALOG_FAILED/.test(verification));
check('la verificación prueba ACL y ausencia de acceso anónimo', /H56_PERMISSION_ADMIN_API_ACL_FAILED/.test(verification) && /H56_PERMISSION_ADMIN_ANON_FAILED/.test(verification));

console.log(`\n════════ ${passed} pasaron, ${failed} fallaron ════════`);
if (failed) process.exit(1);
