import fs from 'fs';

const data = fs.readFileSync('balam/data.jsx', 'utf8');
const store = fs.readFileSync('balam/store.jsx', 'utf8');
const edge = fs.readFileSync('supabase/functions/admin-users/index.ts', 'utf8');
const migrationPath = 'supabase/migrations/20260726003300_pos_h31_effective_commission.sql';
const migrations = fs.existsSync(migrationPath)
  ? fs.readFileSync(migrationPath, 'utf8')
  : '';
const sellersUi = fs.readFileSync('balam/sellers.jsx', 'utf8');
const pos = fs.readFileSync('balam/pos.jsx', 'utf8');

let pass = 0;
let fail = 0;
const check = (name, condition) => {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
};

const match = data.match(
  /function resolveSellerCommission\(seller\)\s*\{([\s\S]*?)\n  \}/,
);
const run = match
  ? new Function('seller', 'C', match[1])
  : () => ({ effectivePct: NaN, source: 'ausente', level: null });

const levels = [
  {
    code: 'senior',
    label: 'Senior',
    active: true,
    meta: { commissionPct: 7 },
  },
  {
    code: 'legacy-inactive',
    label: 'Nivel anterior',
    active: false,
    meta: { commissionPct: 3 },
  },
  {
    code: 'zero',
    label: 'Sin comisión',
    active: true,
    meta: { commissionPct: 0 },
  },
];
let globalPct = 5;
const C = {
  get: key => (key === 'commission.basePct' ? globalPct : undefined),
  list: kind => (kind === 'seller_role' ? levels.filter(level => level.active !== false) : []),
  all: kind => (kind === 'seller_role' ? levels : []),
};

let result = run({
  commissionPolicyVersion: 1,
  commissionOverridePct: 8,
  sellerLevelCode: 'senior',
}, C);
check('personalizada tiene prioridad sobre nivel y general', result.effectivePct === 8 && result.source === 'personalizada');

result = run({
  commissionPolicyVersion: 1,
  commissionOverridePct: null,
  sellerLevelCode: 'senior',
}, C);
check('nivel válido precede a general', result.effectivePct === 7 && result.source === 'nivel' && result.level?.code === 'senior');

result = run({
  commissionPolicyVersion: 1,
  commissionOverridePct: null,
  sellerLevelCode: null,
}, C);
check('general respalda al vendedor sin personalizada ni nivel', result.effectivePct === 5 && result.source === 'general');

result = run({
  commissionPolicyVersion: 1,
  commissionOverridePct: 0,
  sellerLevelCode: 'senior',
}, C);
check('personalizada 0% es válida', result.effectivePct === 0 && result.source === 'personalizada');

result = run({
  commissionPolicyVersion: 1,
  commissionOverridePct: null,
  sellerLevelCode: 'zero',
}, C);
check('nivel 0% es válido', result.effectivePct === 0 && result.source === 'nivel');

globalPct = 0;
result = run({
  commissionPolicyVersion: 1,
  commissionOverridePct: null,
  sellerLevelCode: null,
}, C);
check('general 0% es válida', result.effectivePct === 0 && result.source === 'general');
globalPct = 5;

result = run({
  commissionPolicyVersion: 1,
  commissionOverridePct: null,
  sellerLevelCode: 'legacy-inactive',
}, C);
check('nivel inactivo previamente asignado conserva resolución', result.effectivePct === 3 && result.source === 'nivel' && result.level?.active === false);

result = run({ comisionPct: 0 }, C);
check('heredada 0% no se confunde con ausencia', result.effectivePct === 0 && result.source === 'heredada');

result = run({ comisionPct: 4.5 }, C);
check('seller.comisionPct existente se conserva como heredada', result.effectivePct === 4.5 && result.source === 'heredada');

result = run({
  role: 'admin',
  active: true,
  commissionPolicyVersion: 1,
  sellerLevelCode: 'senior',
  commissionOverridePct: null,
}, C);
check('resolver comisión no altera rol de acceso', result.effectivePct === 7 && result.level?.code === 'senior');
check('H-29 sigue siendo la única autoridad de elegibilidad POS', data.includes('function isEligibleSeller(seller)') && pos.includes('D.sellers.filter(D.isEligibleSeller)'));
check('H-30 permanece intacto en la pantalla comercial', sellersUi.includes('function SellerAvatar') && sellersUi.includes('s.avatar'));

check('DATA publica una sola autoridad de comisión efectiva', data.includes('resolveSellerCommission,'));
check('STORE persiste personalizada nullable, nivel y versión', /commission_override_pct/.test(store) && /seller_level_code/.test(store) && /commission_policy_version/.test(store));
check('alta local nace bajo la política nueva sin porcentaje personalizado', /commissionOverridePct:\s*null/.test(data) && /commissionPolicyVersion:\s*1/.test(data));
check('alta remota nace bajo la política nueva', /commission_override_pct:\s*null/.test(edge) && /commission_policy_version:\s*1/.test(edge));
check('migración conserva filas existentes como legado', /commission_policy_version\s*=\s*0/i.test(migrations) && /set default 1/i.test(migrations));
check('migración es idempotente', (migrations.match(/if not exists/gi) || []).length >= 3);
check('no se infieren niveles desde comision_pct', !/seller_level_code\s*=.*comision_pct/i.test(migrations));

check('motor de venta histórico no fue conectado en H-31', data.includes('const c = base * (s.comisionPct || 0) / 100;'));
check('devoluciones conservan su cálculo histórico', (data.match(/const c = base \* \(s\.comisionPct \|\| 0\) \/ 100;/g) || []).length === 3);
check('metas y bonos no consumen la autoridad nueva', !/resolveSellerCommission[\s\S]{0,80}(metaMes|bono)/.test(data));

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
