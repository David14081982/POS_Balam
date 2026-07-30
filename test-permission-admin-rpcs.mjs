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
const catalogSnapshotPath =
  'supabase/migrations/20260730007600_pos_h56_permission_catalog_snapshot.sql';
const catalogSnapshotVerificationPath =
  'supabase/migrations/20260730007700_pos_h56_permission_catalog_snapshot_verification.sql';
const catalogSnapshot = fs.existsSync(catalogSnapshotPath)
  ? fs.readFileSync(catalogSnapshotPath, 'utf8')
  : '';
const catalogSnapshotVerification = fs.existsSync(catalogSnapshotVerificationPath)
  ? fs.readFileSync(catalogSnapshotVerificationPath, 'utf8')
  : '';
const editorSnapshotPath =
  'supabase/migrations/20260730007800_pos_h56_permission_editor_snapshot.sql';
const editorSnapshotVerificationPath =
  'supabase/migrations/20260730007900_pos_h56_permission_editor_snapshot_verification.sql';
const editorSnapshot = fs.existsSync(editorSnapshotPath)
  ? fs.readFileSync(editorSnapshotPath, 'utf8')
  : '';
const editorSnapshotVerification = fs.existsSync(editorSnapshotVerificationPath)
  ? fs.readFileSync(editorSnapshotVerificationPath, 'utf8')
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
check('publica snapshot administrativo del catálogo', /admin_screen_permission_catalog_snapshot\s*\(/i.test(catalogSnapshot));
check('el snapshot del catálogo tiene guarda propia y sólo lectura', /can_manage_screen_permissions\s*\(\s*auth\.uid\(\)/i.test(catalogSnapshot) && !/\b(insert|update|delete|truncate)\b/i.test(catalogSnapshot));
check('la verificación remota cubre versión, jerarquía y ACL', /H56_CATALOG_SNAPSHOT_SHAPE_FAILED/.test(catalogSnapshotVerification) && /H56_CATALOG_SNAPSHOT_ACL_FAILED/.test(catalogSnapshotVerification));

check('editor snapshot exposes inherited role state', /admin_user_permission_editor_snapshot\s*\(/i.test(editorSnapshot) && /role_allowed/i.test(editorSnapshot) && /role_configured/i.test(editorSnapshot));
check('editor snapshot lists active roles only', /from pos\.permission_roles[\s\S]*where r\.active/i.test(editorSnapshot));
check('editor snapshot has its own guard and minimal grants', /can_manage_screen_permissions\s*\(\s*auth\.uid\(\)/i.test(editorSnapshot) && /revoke all on function[\s\S]*from public,\s*anon/i.test(editorSnapshot) && /grant execute on function[\s\S]*to authenticated/i.test(editorSnapshot));
check('remote verification covers editor inheritance and ACL', /H56_EDITOR_INHERITANCE_SHAPE_FAILED/.test(editorSnapshotVerification) && /H56_EDITOR_SNAPSHOT_ACL_FAILED/.test(editorSnapshotVerification));

console.log(`\n════════ ${passed} pasaron, ${failed} fallaron ════════`);
if (failed) process.exit(1);
