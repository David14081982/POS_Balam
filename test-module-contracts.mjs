// Fase 16: contratos globales, orden de carga e identidad única de terminal.
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0, fail = 0;
const check = (name, value) => {
  console.log(`${value ? '✅' : '❌'} ${name}`);
  value ? pass++ : fail++;
};
const read = file => readFileSync(file, 'utf8');

const sourceHtml = read('balam/_source.html');
const entryHtml = read('POS Balam.html');
const scriptsOf = html => [...html.matchAll(/<script type="text\/babel" src="(balam\/[^"]+\.jsx)"><\/script>/g)]
  .map(match => match[1]);
const expectedScripts = [
  'balam/icons.jsx', 'balam/core.jsx', 'balam/config.jsx', 'balam/data.jsx',
  'balam/auth.jsx', 'balam/shared.jsx', 'balam/heritage.jsx',
  'balam/discounts.jsx', 'balam/xlsx-io.jsx', 'balam/barcodes.jsx',
  'balam/tweaks-panel.jsx', 'balam/dashboard.jsx', 'balam/pos.jsx',
  'balam/pos-ticket.jsx', 'balam/inventory.jsx', 'balam/clients.jsx',
  'balam/returns.jsx', 'balam/sellers.jsx', 'balam/reports.jsx',
  'balam/settings.jsx', 'balam/store.jsx', 'balam/app.jsx',
];

check('entrada y fuente segura cargan los mismos módulos', JSON.stringify(scriptsOf(entryHtml)) === JSON.stringify(scriptsOf(sourceHtml)));
check('orden público de módulos está congelado', JSON.stringify(scriptsOf(entryHtml)) === JSON.stringify(expectedScripts));

const data = read('balam/data.jsx');
const store = read('balam/store.jsx');
const core = existsSync('balam/core.jsx') ? read('balam/core.jsx') : '';
check('la identidad de terminal tiene una sola implementación', (
  !/function getDeviceId\s*\(/.test(data)
  && !/function getDeviceId\s*\(/.test(store)
  && (core.match(/function getDeviceId\s*\(/g) || []).length === 1
));
check('DATA y STORE consumen el contrato CORE', (
  data.includes('window.CORE.getDeviceId()')
  && store.includes('window.CORE.getDeviceId()')
));

let generated = 0;
const localStorage = {
  getItem() { throw new Error('storage bloqueado'); },
  setItem() { throw new Error('storage bloqueado'); },
};
const sandbox = {
  window: {},
  localStorage,
  Date: class extends Date { static now() { return 123456789; } },
  Math: Object.create(Math),
};
sandbox.Math.random = () => (++generated) / 100;
vm.createContext(sandbox);
if (core) vm.runInContext(core, sandbox);
const first = sandbox.window.CORE?.getDeviceId?.();
const second = sandbox.window.CORE?.getDeviceId?.();
check('la identidad volátil permanece estable durante la sesión', first === second && first?.startsWith('dev-volatile-'));

const expectedGlobals = {
  'balam/core.jsx': 'CORE',
  'balam/config.jsx': 'CONFIG',
  'balam/data.jsx': 'DATA',
  'balam/auth.jsx': 'AUTH',
  'balam/shared.jsx': 'UI',
  'balam/heritage.jsx': 'HX',
  'balam/discounts.jsx': 'PROMOS',
  'balam/xlsx-io.jsx': 'XLSXIO',
  'balam/barcodes.jsx': 'BARCODES',
  'balam/store.jsx': 'STORE',
  'balam/app.jsx': 'App',
};
for (const [file, globalName] of Object.entries(expectedGlobals)) {
  check(`${file} publica window.${globalName}`, existsSync(file) && read(file).includes(`window.${globalName} =`));
}

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
