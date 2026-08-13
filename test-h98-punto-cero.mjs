// H-98 · Contrato permanente de Punto Cero. La verificación SQL autocontenida
// prueba la transacción real; este arnés fija la costura cliente/UI y evita que
// vuelva a convertirse en una secuencia de borrados desde el navegador.
import fs from 'fs';

let pass = 0, fail = 0;
const check = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? pass++ : fail++;
};

const migration = fs.existsSync('supabase/migrations/20260812013900_pos_h98_point_zero.sql')
  ? fs.readFileSync('supabase/migrations/20260812013900_pos_h98_point_zero.sql', 'utf8') : '';
const verification = fs.existsSync('supabase/migrations/20260812014000_pos_h98_point_zero_verification.sql')
  ? fs.readFileSync('supabase/migrations/20260812014000_pos_h98_point_zero_verification.sql', 'utf8') : '';
const visiblePreview = fs.existsSync('supabase/migrations/20260812014100_pos_h98_visible_preview.sql')
  ? fs.readFileSync('supabase/migrations/20260812014100_pos_h98_visible_preview.sql', 'utf8') : '';
const visiblePreviewVerification = fs.existsSync('supabase/migrations/20260812014200_pos_h98_visible_preview_verification.sql')
  ? fs.readFileSync('supabase/migrations/20260812014200_pos_h98_visible_preview_verification.sql', 'utf8') : '';
const store = fs.readFileSync('balam/store.jsx', 'utf8');
const settings = fs.readFileSync('balam/settings.jsx', 'utf8');
const screens = fs.readFileSync('balam/screens.jsx', 'utf8');

check('migración funcional H-98 presente', !!migration);
check('verificación autocontenida H-98 presente', !!verification);
check('modo de sistema cerrado en PostgreSQL', /system_mode[\s\S]*preproduction[\s\S]*production/.test(migration));
check('preview autoritativo remoto', /function pos\.point_zero_preview\s*\(/.test(migration));
check('preview enumera autoridades de detalle y entrega sello temporal',
  /sale_items/.test(visiblePreview) && /return_items/.test(visiblePreview)
  && /exchange_items/.test(visiblePreview) && /generated_at/.test(visiblePreview));
check('verificación del preview real es de lectura y termina en rollback',
  /point_zero_preview\(\)/.test(visiblePreviewVerification)
  && !/(create_point_zero_backup|execute_point_zero|purge_test_data)\s*\(/.test(visiblePreviewVerification)
  && /rollback/i.test(visiblePreviewVerification));
check('respaldo remoto con huella SHA-256', /function pos\.create_point_zero_backup\s*\(/.test(migration) && /sha-?256/i.test(migration));
check('ejecución transaccional e idempotente', /function pos\.execute_point_zero\s*\(/.test(migration) && /operation_id/i.test(migration));
check('la ejecución compara el preview aprobado', /preview_(token|fingerprint)|snapshot_hash/i.test(migration));
check('auditoría y respaldo son tablas separadas', /pos\.point_zero_operations/.test(migration) && /pos\.point_zero_backups/.test(migration));
check('productos y reclasificaciones entran al plan', /reference_reclassifications/.test(migration) && /delete from pos\.products/.test(migration));
check('configuración, catálogos y personal no se borran', !/delete from pos\.(settings|lookup|sellers|permission_roles)/.test(migration));
check('RPC sensibles requieren administrador y capacidad', /is_active_admin/.test(migration) && /settings\.manage/.test(migration));
check('producción bloquea inequívocamente', /point_zero_production_locked/.test(migration));
check('STORE sólo orquesta RPC de Punto Cero', /pointZeroPreview/.test(store) && /createPointZeroBackup/.test(store) && /executePointZero/.test(store));
check('STORE exige sincronía y cola local vacía', /POINT_ZERO_NOT_SYNCHRONIZED|point_zero_not_synchronized/.test(store));
check('sección administrativa visible con identidad estable', /Administración \/ Datos/.test(screens) && /config\.demo/.test(screens));
check('wizard exige la frase exacta en cliente y servidor', /PUNTO CERO/.test(settings) && /confirmacion/.test(settings) && /point_zero_confirmation_required/.test(migration));
check('respaldo obligatorio antes de ejecutar', /createPointZeroBackup/.test(settings) && /backup/.test(settings));
check('comprobante descargable', /Descargar comprobante de Punto Cero/.test(settings));
check('diagnóstico autoritativo queda visible fuera del wizard',
  /point-zero-diagnostic/.test(settings) && /Actualizado:/.test(settings));
check('un error invalida el preview y bloquea la limpieza',
  /setPreview\(null\)/.test(settings) && /point-zero-error/.test(settings));
check('el cliente no borra tablas para ejecutar Punto Cero', !/executePointZero[\s\S]{0,2500}\.from\([^)]*\)\.delete/.test(store));
check('la verificación cubre rollback y modo producción', /ROLLBACK|rollback/.test(verification) && /production/.test(verification));

console.log(`\nH-98: ${pass} pasaron, ${fail} fallaron`);
if (fail) process.exit(1);
