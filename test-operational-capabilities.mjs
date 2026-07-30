import fs from 'node:fs';

const read = path => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '';
const model = read('supabase/migrations/20260730008000_pos_h56_operational_capabilities.sql');
const verify = read('supabase/migrations/20260730008100_pos_h56_operational_capabilities_verification.sql');
const commissions = read('supabase/migrations/20260730008200_pos_h56_commission_capabilities.sql');
const commissionsVerify = read('supabase/migrations/20260730008300_pos_h56_commission_capabilities_verification.sql');
const postSale = read('supabase/migrations/20260730008400_pos_h56_post_sale_capabilities.sql');
const postSaleVerify = read('supabase/migrations/20260730008500_pos_h56_post_sale_capabilities_verification.sql');
const data = read('balam/data.jsx');
const store = read('balam/store.jsx');

let passed = 0;
let failed = 0;
function check(label, condition) {
  console.log(`${condition ? '✅' : '❌'} ${label}`);
  condition ? passed++ : failed++;
}

check('crea catálogo estable de capacidades', /create table if not exists pos\.operational_capabilities/i.test(model));
check('separa permisos de rol y overrides individuales', /role_capability_permissions/i.test(model) && /user_capability_overrides/i.test(model));
check('la resolución aplica override, rol y denegación', /resolve_operational_capability/i.test(model) && /override[\s\S]*role[\s\S]*default/i.test(model));
check('la identidad pública se obtiene sólo de auth.uid()', /current_has_capability/i.test(model) && /auth\.uid\(\)/i.test(model));
check('admin conserva todas las capacidades', /cross join pos\.operational_capabilities/i.test(model) && /r\.code = 'admin'/i.test(model));
check('vendedor conserva venta, cobro, devolución, cambio y clientes', /sales\.create/.test(model) && /sales\.collect/.test(model) && /sales\.refund/.test(model) && /sales\.exchange/.test(model) && /customers\.create/.test(model));
check('tablas de capacidades tienen RLS y sin escritura directa', /enable row level security/i.test(model) && /revoke all on pos\.operational_capabilities/i.test(model));
check('verifica matriz completa y acceso negativo', /H56_CAPABILITY_MATRIX_FAILED/.test(verify) && /H56_CAPABILITY_ANON_FAILED/.test(verify));
check('cierre y liquidación exigen capacidades distintas', /commissions\.settle/.test(commissions) && /commissions\.close_period/.test(commissions));
check('las comisiones se ejecutan mediante RPC atómicas', /settle_commission_checked/i.test(commissions) && /close_commission_period_checked/i.test(commissions));
check('las RPC identifican actor con auth.uid y guardan auditoría', /auth\.uid\(\)/i.test(commissions) && /capability_operation_audit/i.test(commissions));
check('liquidations deja de aceptar escritura directa', /revoke\s+(insert|all)[\s\S]*pos\.liquidations/i.test(commissions));
check('la verificación prueba autorización, atomicidad e idempotencia', /H56_COMMISSION_UNAUTHORIZED_FAILED/.test(commissionsVerify) && /H56_COMMISSION_ATOMICITY_FAILED/.test(commissionsVerify) && /H56_COMMISSION_IDEMPOTENCY_FAILED/.test(commissionsVerify));
check('la verificación limpia todas sus fixtures', /delete from pos\.capability_operation_audit/i.test(commissionsVerify) && /delete from auth\.users/i.test(commissionsVerify));
check('el cliente encola liquidación y cierre mediante el gateway', /settleCommission/.test(data) && /closeCommissionPeriod/.test(data));
check('STORE ejecuta exclusivamente las RPC de comisiones', /settle_commission_checked/.test(store) && /close_commission_period_checked/.test(store));
check('las operaciones locales conservan una identidad idempotente', /operationId/.test(data) && /commissionSettle/.test(store) && /commissionClose/.test(store));
check('devoluciones y cambios exigen capacidades independientes',
  /sales\.refund/.test(postSale) && /sales\.exchange/.test(postSale));
check('las RPC históricas dejan de ser ejecutables directamente',
  /revoke all on function pos\.commit_return[\s\S]*from public, anon, authenticated/i.test(postSale)
  && /revoke all on function pos\.commit_exchange[\s\S]*from public, anon, authenticated/i.test(postSale));
check('wrappers protegidos conservan las transacciones vigentes',
  /commit_return_checked/i.test(postSale) && /commit_exchange_checked/i.test(postSale));
check('la verificación cubre autorización, ACL y compatibilidad',
  /H56_POSTSALE_UNAUTHORIZED_FAILED/.test(postSaleVerify)
  && /H56_POSTSALE_ACL_FAILED/.test(postSaleVerify)
  && /H56_POSTSALE_COMPATIBILITY_FAILED/.test(postSaleVerify));

console.log(`\n════════ ${passed} pasaron, ${failed} fallaron ════════`);
if (failed) process.exit(1);
