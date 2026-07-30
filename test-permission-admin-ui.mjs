import fs from 'node:fs';

const read = path => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
const ui = read('balam/permissions.jsx');
const screens = read('balam/screens.jsx');
const settings = read('balam/settings.jsx');
const source = read('balam/_source.html');

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

check('activa config.permisos en el registro central', /id:\s*'config\.permisos'[\s\S]{0,180}(?!enabled:\s*false)/.test(screens) && !/id:\s*'config\.permisos'[^\n]*enabled:\s*false/.test(screens));
check('carga el editor antes de Configuración', /permissions\.jsx[\s\S]*settings\.jsx/.test(source));
check('Configuración monta el editor registrado', /permisos:\s*[\s\S]*PermissionAdminScreen/.test(settings));
check('filtra las secciones con AUTH.canAccess', /childrenOf\('config'\)[\s\S]{0,120}AUTH\.canAccess/.test(settings));
check('publica el componente administrativo', /window\.PermissionAdminScreen\s*=/.test(ui));
check('deriva catálogo y árbol exclusivamente de SCREENS', /SCREENS\.all\(\)/.test(ui) && !/const\s+(SCREEN|MODULE)_(KEYS|LIST)\s*=/.test(ui));
check('sincroniza catálogo con versión optimista', /admin_screen_permission_catalog_snapshot/.test(ui) && /admin_sync_screen_permission_catalog/.test(ui));
check('lista usuarios Auth con búsqueda y paginación', /admin_permission_users/.test(ui) && /p_search/.test(ui) && /p_offset/.test(ui));
check('carga snapshot de edición completo', /admin_user_permission_editor_snapshot/.test(ui));
check('ofrece heredar, permitir y denegar por hoja', /inherit/.test(ui) && /allow/.test(ui) && /deny/.test(ui));
check('deriva estado triestado de módulos', /indeterminate/.test(ui) && /mixed/.test(ui));
check('muestra origen del permiso efectivo', /role_allowed/.test(ui) && /role_configured/.test(ui) && /permissionReasonLabel/.test(ui));
check('restaura herencia eliminando overrides', /restoreInheritance/.test(ui) && /null/.test(ui));
check('guarda un lote atómico con token esperado', /admin_apply_user_screen_permissions_checked/.test(ui) && /p_expected_version/.test(ui));
check('preserva borrador ante conflicto', /PERMISSION_VERSION_CONFLICT/.test(ui) && /setDraft/.test(ui));
check('refresca AUTH si cambia el usuario actual', /AUTH\.refreshPermissions/.test(ui));
check('protege cambio de usuario con modal propio', /save-and-switch/.test(ui) && /discard-and-switch/.test(ui) && !/window\.confirm/.test(ui));
check('maneja usuario inexistente, inactivo y no autorizado', /TARGET_USER_NOT_FOUND/.test(ui) && /TARGET_USER_INACTIVE/.test(ui) && /PERMISSION_ADMIN_UNAUTHORIZED/.test(ui));
check('maneja la protección del último administrador', /LAST_PERMISSION_ADMIN_REQUIRED/.test(ui));
check('mantiene diseño responsivo sin matriz horizontal', /grid-cols-1[\s\S]*lg:grid-cols/.test(ui) && !/<table/i.test(ui));
check('marca controles funcionales para pruebas E2E', /data-testid/.test(ui));

console.log(`\n════════ ${passed} pasaron, ${failed} fallaron ════════`);
if (failed) process.exit(1);
