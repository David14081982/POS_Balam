import fs from 'node:fs';
import vm from 'node:vm';

let passed = 0;
let failed = 0;
function check(label, condition) {
  console.log(`${condition ? '✅' : '❌'} ${label}`);
  condition ? passed++ : failed++;
}

const registryPath = 'balam/screens.jsx';
check('existe el registro central de pantallas', fs.existsSync(registryPath));

let SCREENS = null;
if (fs.existsSync(registryPath)) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(registryPath, 'utf8'), context);
  SCREENS = context.window.SCREENS;
}

check('el registro publica una API inmutable', !!SCREENS && Object.isFrozen(SCREENS));

const all = SCREENS ? SCREENS.all() : [];
const ids = all.map(screen => screen.id);
check('cada pantalla tiene identidad única', ids.length > 0 && new Set(ids).size === ids.length);
check('cada pantalla navegable tiene título, icono y componente',
  all.filter(screen => screen.menu).every(screen => (
    screen.title && screen.icon && typeof screen.component === 'function'
  )));
check('todos los padres declarados existen',
  all.every(screen => !screen.parentId || ids.includes(screen.parentId)));

const top = SCREENS ? SCREENS.navigation() : [];
check('el registro conserva las once pantallas principales',
  top.map(screen => screen.id).join(',') ===
    'dashboard,pos,inventario,clientes,apartados,prestamos,devoluciones,descuentos,vendedores,reportes,config');

const settings = SCREENS ? SCREENS.childrenOf('config') : [];
check('Configuración obtiene sus once secciones del mismo registro',
  settings.map(screen => screen.id).join(',') ===
    'config.negocio,config.producto,config.ventas,config.beneficios,config.devoluciones,config.vendedores,config.clientes,config.inventario,config.impresion,config.usuarios,config.demo');

const app = fs.readFileSync('balam/app.jsx', 'utf8');
check('App construye navegación y títulos desde el registro',
  app.includes('window.SCREENS.navigation()') && app.includes('window.SCREENS.get(visiblePage)'));
check('App monta el componente resuelto por el registro',
  app.includes('visibleScreen.component()') && app.includes('h(VisibleComponent'));
check('App ya no duplica NAV, TITLES ni la cadena de render',
  !app.includes('const NAV = [')
    && !app.includes('const TITLES = {')
    && !app.includes("visiblePage === 'dashboard'"));

const settingsSource = fs.readFileSync('balam/settings.jsx', 'utf8');
check('Configuración deriva sus secciones del registro',
  settingsSource.includes("window.SCREENS.childrenOf('config')")
    && !settingsSource.includes('const SECTIONS = ['));

const source = fs.readFileSync('balam/_source.html', 'utf8');
check('el registro carga antes que Settings y App',
  source.indexOf('balam/screens.jsx') > -1
    && source.indexOf('balam/screens.jsx') < source.indexOf('balam/settings.jsx')
    && source.indexOf('balam/screens.jsx') < source.indexOf('balam/app.jsx'));

console.log(`\n════════ ${passed} pasaron, ${failed} fallaron ════════`);
process.exit(failed ? 1 : 0);
