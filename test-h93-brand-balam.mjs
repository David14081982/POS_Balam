import fs from 'node:fs';

const checks = [];
const check = (name, ok) => checks.push({ name, ok: Boolean(ok) });
const read = file => fs.readFileSync(file, 'utf8');

const clients = read('balam/clients.jsx');
const dashboard = read('balam/dashboard.jsx');
const sellers = read('balam/sellers.jsx');
const config = read('balam/config.jsx');

check('alta de cliente usa la marca Balam', clients.includes("Cliente registrado en Balam"));
check('acción rápida usa CRM Balam', dashboard.includes("'CRM Balam'"));
check('descripción del equipo usa Balam', sellers.includes('métricas del equipo Balam'));
check('semilla del rol senior usa Balam', config.includes("label: 'Balam Senior Associate'"));
check('configuración local histórica se migra', config.includes("seniorRole.label === 'Heritage Senior Associate'") && config.includes("seniorRole.label = 'Balam Senior Associate'"));

const visibleSources = [clients, dashboard, sellers];
check('ninguna cadena visible conserva Heritage', visibleSources.every(source => !/Heritage/i.test(source)));

for (const result of checks) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${result.name}`);
const passed = checks.filter(result => result.ok).length;
console.log(`\n${passed}/${checks.length} pruebas H-93 aprobadas`);
if (passed !== checks.length) process.exit(1);
