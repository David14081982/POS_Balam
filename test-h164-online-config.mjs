import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let passed = 0;
async function scenario(name, run) {
  await run(); passed++; console.log(`PASS ${name}`);
}
const source = name => fs.readFileSync(`balam/${name}.jsx`, 'utf8');
const offlineMessage = 'Sin conexión. BALAM necesita internet para continuar.';

await scenario('CONFIG: intención aislada, rechazo y confirmación remota sin persistencia comercial', async () => {
  let online = false, reject, resolve, command, events = 0, storageTouches = 0;
  const window = { dispatchEvent() { events++; }, CORE: {
    catalogProducts: () => [],
    invokeSync(name, value) {
      if (name === 'assertBusinessReady') { if (!online) throw new Error(offlineMessage); return true; }
      assert.equal(name, 'execute'); command = value;
      return new Promise((yes, no) => { resolve = yes; reject = no; });
    },
  } };
  const context = vm.createContext({ window, CustomEvent: class {}, localStorage: {
    getItem() { storageTouches++; return '{"settings":{"stock.lowThreshold":999}}'; },
    setItem() { storageTouches++; }, removeItem() { storageTouches++; },
  } });
  vm.runInContext(source('config'), context);
  const config = window.CONFIG;
  config.load({ v: 1, catalogs: { color: [{ code: 'B', label: 'Blanco', active: true }] }, catalogMeta: {}, settings: { 'stock.lowThreshold': 4 } });
  const baseEvents = events;
  await assert.rejects(config.setSetting('stock.lowThreshold', 8), error => error.message === offlineMessage);
  assert.equal(config.get('stock.lowThreshold'), 4);
  online = true;
  const failed = config.setSetting('stock.lowThreshold', 8);
  assert.equal(config.get('stock.lowThreshold'), 4);
  assert.equal(events, baseEvents);
  reject(new Error('VERSION_CONFLICT'));
  await assert.rejects(failed, /VERSION_CONFLICT/);
  assert.equal(config.get('stock.lowThreshold'), 4);
  const accepted = config.setSetting('stock.lowThreshold', 9);
  assert.equal(command.type, 'config');
  assert.equal(command.state.settings['stock.lowThreshold'], 9);
  config.load(command.state);
  resolve({ ok: true, result: { confirmed: true } });
  assert.equal((await accepted).ok, true);
  assert.equal(config.get('stock.lowThreshold'), 9);
  const external = config.find('color', 'B'); external.label = 'Mutado';
  assert.equal(config.find('color', 'B').label, 'Blanco');
  assert.equal(storageTouches, 0);
  config.clearRemote();
  assert.equal(config.ready, false);
  assert.equal(config.get('stock.lowThreshold'), undefined);
});

await scenario('AUTH: la caché antigua no autoriza y la reconexión vuelve a comprobar permisos', async () => {
  let online = false, storageTouches = 0;
  const session = { user: { id: '11111111-1111-4111-8111-111111111111', email: 'qa@example.test' } };
  const client = { auth: { getSession: async () => ({ data: { session } }), onAuthStateChange() {} },
    async rpc() {
      if (!online) return { error: { code: 'NETWORK', message: 'Failed to fetch' } };
      return { data: { model_version: 'h56-screen-permissions-v1', permission_version: '1', verified_at: new Date().toISOString(),
        profile_status: 'active', base_role: 'admin', profile: { id: session.user.id, nombre: 'QA', role: 'admin', active: true },
        permissions: [{ screen_key: 'pos', allowed: true, source: 'role', role_code: 'admin' }] } };
    },
  };
  const window = { dispatchEvent() {}, CORE: { invokeSync: async () => client }, SCREENS: {
    all: () => [{ id: 'pos', enabled: true }], get: id => ({ id, enabled: true }), childrenOf: () => [], navigation: () => [{ id: 'pos' }],
  } };
  const context = vm.createContext({ window, CustomEvent: class {}, location: { hostname: 'localhost', protocol: 'http:' },
    localStorage: { getItem() { storageTouches++; return '{}'; }, setItem() { storageTouches++; } } });
  vm.runInContext(source('auth'), context);
  await window.AUTH.init();
  assert.equal(window.AUTH.hasSession(), true);
  assert.equal(window.AUTH.canAccess('pos'), false);
  assert.equal(window.AUTH.accessState, 'remote_unavailable');
  online = true;
  assert.equal(await window.AUTH.refreshPermissions(), true);
  assert.equal(window.AUTH.canAccess('pos'), true);
  assert.equal(storageTouches, 0);
});

await scenario('PWA: un panel cerrado no bloquea; un diálogo abierto y una confirmación activa sí', async () => {
  const text = source('pwa');
  const fn = text.slice(text.indexOf('  function reloadSafety()'), text.indexOf('  async function activateUpdate()'));
  let hidden = true, busy = false;
  const window = { CORE: { activityStatus: () => ({ active: 0 }) }, STORE: { syncStatus: () => ({ busy }) } };
  const context = vm.createContext({ window, document: {
    querySelectorAll: () => [{ closest: () => hidden ? {} : null }], activeElement: null,
  } });
  vm.runInContext(`${fn}; globalThis.check = reloadSafety`, context);
  assert.equal(context.check().safe, true);
  hidden = false;
  assert.equal(context.check().reason, 'Cierra el diálogo abierto antes de actualizar.');
  hidden = true; busy = true;
  assert.equal(context.check().reason, 'Estamos confirmando la operación. No la repitas.');
});

console.log(`H164 CONFIG/AUTH/PWA ${passed}/${passed}`);
