import fs from 'fs';
import vm from 'vm';

let pass = 0, fail = 0;
const check = (name, condition) => {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
};

const configSrc = fs.readFileSync('balam/config.jsx', 'utf8');
const dataSrc = fs.readFileSync('balam/data.jsx', 'utf8').replace(/\r\n/g, '\n');
const ticketSrc = fs.readFileSync('balam/pos-ticket.jsx', 'utf8');
const settingsSrc = fs.readFileSync('balam/settings.jsx', 'utf8');

const storage = new Map();
const context = {
  window: {
    CORE: {
      catalogProducts: () => [],
      invokeSync: () => {},
    },
    dispatchEvent: () => {},
  },
  localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  },
  CustomEvent: function CustomEvent() {},
  console,
};
context.window.localStorage = context.localStorage;
vm.runInNewContext(configSrc, context);

const initial = context.window.CONFIG.all('additional_benefit');
const pct = initial.find(x => x.code === 'MANUAL_PERCENT');
const amount = initial.find(x => x.code === 'MANUAL_AMOUNT');
check('configuración inicial ofrece porcentaje manual', pct?.meta?.benefitType === 'percentage' && pct.meta.allowsCustomValue === true);
check('configuración inicial ofrece importe manual', amount?.meta?.benefitType === 'fixed' && amount.meta.allowsCustomValue === true);
check('porcentaje manual conserva máximo administrable', Number(pct?.meta?.maxPercent) === 100);
const historic = context.window.CONFIG.snapshot();
historic.catalogs.additional_benefit = historic.catalogs.additional_benefit
  .filter(x => !['MANUAL_PERCENT', 'MANUAL_AMOUNT'].includes(x.code));
delete historic.settings['benefits.manualOptionsV1'];
context.window.CONFIG.load(historic);
const repaired = context.window.CONFIG.all('additional_benefit');
check('configuración histórica recibe las dos opciones una sola vez',
  repaired.filter(x => ['MANUAL_PERCENT', 'MANUAL_AMOUNT'].includes(x.code)).length === 2);
context.window.CONFIG.updateItem('additional_benefit', 'MANUAL_PERCENT', {
  label: 'Descuento libre hasta 18%',
  meta: { maxPercent: 18, active: true },
});
const edited = context.window.CONFIG.find('additional_benefit', 'MANUAL_PERCENT');
check('administrador puede renombrar y limitar la opción', edited.label === 'Descuento libre hasta 18%' && edited.meta.maxPercent === 18);
const afterMigration = context.window.CONFIG.snapshot();
afterMigration.catalogs.additional_benefit = afterMigration.catalogs.additional_benefit
  .filter(x => x.code !== 'MANUAL_AMOUNT');
context.window.CONFIG.load(afterMigration);
check('una opción eliminada por el administrador no reaparece',
  !context.window.CONFIG.find('additional_benefit', 'MANUAL_AMOUNT'));
check('modal expone captura estable para el valor manual', /data-testid': 'additional-discount-custom-value'/.test(ticketSrc));
check('modal distingue porcentaje de importe', /Porcentaje de descuento/.test(ticketSrc) && /Importe del descuento/.test(ticketSrc));
check('Configuración explica las opciones manuales', /Porcentaje manual/.test(settingsSrc) && /Importe manual/.test(settingsSrc));

const quoteMatch = dataSrc.match(/function saleQuote\(ticket, applications\) \{([\s\S]*?)\n  \}/);
const money = n => Math.round((Number(n) || 0) * 100) / 100;
const quoteFn = new Function('ticket', 'applications', 'money', quoteMatch[1]);
const quote = apps => quoteFn(
  [{ key: 'a', qty: 1, res: { orig: 1000, unit: 800, promos: [] } }],
  apps,
  money,
);
check('porcentaje escrito por vendedor calcula sobre base vigente',
  quote([{ id: 'p', benefitType: 'percentage', value: 12.5, maxPercent: 20, scope: 'ticket' }]).finalTotal === 700);
check('importe escrito por vendedor se descuenta exactamente',
  quote([{ id: 'm', benefitType: 'fixed', value: 175.25, maxAmount: 300, scope: 'ticket' }]).finalTotal === 624.75);
let blockedPercent = false, blockedAmount = false;
try { quote([{ id: 'p', benefitType: 'percentage', value: 21, maxPercent: 20, scope: 'ticket' }]); } catch { blockedPercent = true; }
try { quote([{ id: 'm', benefitType: 'fixed', value: 301, maxAmount: 300, scope: 'ticket' }]); } catch { blockedAmount = true; }
check('límites del administrador bloquean porcentaje e importe', blockedPercent && blockedAmount);

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail ? 1 : 0);
