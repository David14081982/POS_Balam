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
const config = read('balam/config.jsx');
check('la identidad de terminal tiene una sola implementación', (
  !/function getDeviceId\s*\(/.test(data)
  && !/function getDeviceId\s*\(/.test(store)
  && (core.match(/function getDeviceId\s*\(/g) || []).length === 1
));
check('DATA y STORE consumen el contrato CORE', (
  data.includes('window.CORE.getDeviceId()')
  && store.includes('window.CORE.getDeviceId()')
));
check('CONFIG no depende directamente de DATA', !config.includes('window.DATA'));
check('uso de catálogos atraviesa un adaptador único', (
  core.includes('registerCatalogProducts')
  && core.includes('catalogProducts')
  && core.includes('saveCatalogProducts')
  && data.includes('window.CORE.registerCatalogProducts')
  && config.includes('window.CORE.catalogProducts()')
  && config.includes('window.CORE.saveCatalogProducts()')
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

const memory = new Map();
const catalogSandbox = {
  window: { dispatchEvent() {} },
  localStorage: {
    getItem(key) { return memory.get(key) ?? null; },
    setItem(key, value) { memory.set(key, String(value)); },
  },
  CustomEvent: class {},
  console,
};
vm.createContext(catalogSandbox);
vm.runInContext(core + '\n' + config, catalogSandbox);
let productSaves = 0;
const catalogProducts = [{
  id: 'p1', color: 'BL', stock: [],
  attrs: {},
}];
catalogSandbox.window.CORE.registerCatalogProducts({
  list: () => catalogProducts,
  save: () => { productSaves++; },
});
const protectedColor = catalogSandbox.window.CONFIG.removeItem('color', 'BL');
check('la guarda de catálogo conserva códigos usados por productos', (
  protectedColor.ok === false
  && /En uso/.test(protectedColor.error)
));
const custom = catalogSandbox.window.CONFIG.addCatalog('Colección especial');
catalogSandbox.window.CONFIG.addItem(custom.kind, { code: 'ESP', label: 'Especial' });
catalogProducts[0].attrs[custom.kind] = 'ESP';
const removedCustom = catalogSandbox.window.CONFIG.removeCatalog(custom.kind);
check('el adaptador limpia y persiste atributos de catálogo eliminado', (
  removedCustom.ok === true
  && !(custom.kind in catalogProducts[0].attrs)
  && productSaves === 1
));

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
