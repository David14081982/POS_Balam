import fs from 'fs';

const data = fs.readFileSync('balam/data.jsx', 'utf8');
const sellers = fs.readFileSync('balam/sellers.jsx', 'utf8');
const pos = fs.readFileSync('balam/pos.jsx', 'utf8');
const settings = fs.readFileSync('balam/settings.jsx', 'utf8');

let pass = 0;
let fail = 0;
const check = (name, condition) => {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
};

const match = data.match(/function isEligibleSeller\(seller\)\s*\{([\s\S]*?)\n  \}/);
const isEligibleSeller = match
  ? new Function('seller', match[1])
  : () => false;

const profiles = [
  [{ role: 'admin', active: true, _deletedAt: null }, false, 'administrador activo'],
  [{ role: 'vendedor', active: true, _deletedAt: null }, true, 'vendedor activo'],
  [{ role: 'vendedor', active: false, _deletedAt: null }, false, 'vendedor inactivo'],
  [{ role: 'gerente', active: true, _deletedAt: null }, false, 'gerente activo'],
  [{ role: 'vendedor', active: true, _deletedAt: '2026-07-26' }, false, 'perfil eliminado local'],
  [{ role: 'vendedor', active: true, deleted_at: '2026-07-26' }, false, 'perfil eliminado remoto'],
];

check('DATA publica una autoridad única de elegibilidad', data.includes('isEligibleSeller,'));
for (const [profile, expected, label] of profiles) {
  check(`${label}: ${expected ? 'elegible' : 'excluido'}`, isEligibleSeller(profile) === expected);
}
check(
  'Vendedores deriva su colección con la autoridad compartida',
  sellers.includes('D.sellers.filter(D.isEligibleSeller)')
);
check(
  'POS usa la misma autoridad compartida',
  pos.includes('D.sellers.filter(D.isEligibleSeller)')
);
check(
  'Configuración → Usuarios conserva el catálogo completo de personal',
  settings.includes("D.sellers.map(s => h('tr'")
);

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
