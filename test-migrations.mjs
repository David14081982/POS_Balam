// Verifica que la cadena formal de Supabase conserva todas las bases históricas
// y que cada versión tiene un identificador único y un orden determinista.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

let passed = 0;
let failed = 0;
function check(name, condition, detail = '') {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` · ${detail}` : ''}`);
  condition ? passed++ : failed++;
}

const migrationDir = 'supabase/migrations';
const files = readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort();
const versions = files.map(name => name.slice(0, 14));
check('1. existe configuración formal de Supabase', existsSync('supabase/config.toml'));
check('2. cada migración tiene versión única', new Set(versions).size === versions.length);
check('3. el orden lexicográfico coincide con el cronológico',
  files.every((name, index) => index === 0 || name > files[index - 1]));

const historical = [
  ['pos_001_config.sql', '20260725000100_pos_001_config.sql'],
  ['pos_002_domain.sql', '20260725000200_pos_002_domain.sql'],
  ['pos_003_users.sql', '20260725000300_pos_003_users.sql'],
  // 004 declara expresamente que promotions (005) debe existir antes.
  ['pos_005_promotions.sql', '20260725000400_pos_005_promotions.sql'],
  ['pos_004_rls.sql', '20260725000500_pos_004_rls.sql'],
  ['pos_006_liquidations.sql', '20260725000600_pos_006_liquidations.sql'],
  ['pos_007_returns.sql', '20260725000700_pos_007_returns.sql'],
  ['pos_008_product_attrs.sql', '20260725000800_pos_008_product_attrs.sql'],
  ['pos_009_sale_courtesy.sql', '20260725000900_pos_009_sale_courtesy.sql'],
  ['pos_010_product_photos.sql', '20260725001000_pos_010_product_photos.sql'],
  ['pos_010_sale_amount_contract.sql', '20260725001050_pos_010_sale_amount_contract.sql'],
  ['pos_011_finance_discount_snapshot.sql', '20260725001100_pos_011_finance_discount_snapshot.sql'],
  ['pos_012_sale_payments.sql', '20260725001200_pos_012_sale_payments.sql'],
];

for (const [source, migration] of historical) {
  const sourcePath = join('supabase', source);
  const migrationPath = join(migrationDir, migration);
  check(`4. ${basename(source)} está versionada sin deriva`,
    existsSync(migrationPath)
      && readFileSync(sourcePath, 'utf8') === readFileSync(migrationPath, 'utf8'));
}

const first = readFileSync(join(migrationDir, files[0]), 'utf8').toLowerCase();
check('5. la primera migración crea el esquema pos',
  files[0].includes('000100_pos_001_config') && first.includes('create schema if not exists pos'));
check('6. concurrencia se aplica después de todas las tablas base',
  files.findIndex(name => name.includes('001300_pos_013_concurrency'))
    > files.findIndex(name => name.includes('001200_pos_012_sale_payments')));
check('7. promotions existe antes de que RLS intente protegerla',
  files.findIndex(name => name.includes('000400_pos_005_promotions'))
    < files.findIndex(name => name.includes('000500_pos_004_rls')));
check('8. el endurecimiento RLS final ocurre después de tablas históricas',
  files.findIndex(name => name.includes('001400_pos_admin_rls'))
    > files.findIndex(name => name.includes('001300_pos_013_concurrency')));
const contract = readFileSync(
  join(migrationDir, '20260725002900_pos_h10_schema_contract_verification.sql'),
  'utf8',
).toLowerCase();
check('9. la cadena termina verificando objetos, RLS y acceso anon',
  contract.includes('h10_schema_contract_missing')
    && contract.includes('h10_rls_disabled')
    && contract.includes('h10_anon_schema_usage'));

console.log(`\n════════ ${passed} pasaron, ${failed} fallaron ════════`);
process.exit(failed ? 1 : 0);
