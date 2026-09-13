// Actual AUTH/App, deterministic hook host. No SDK network or commercial operations.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const source = name => fs.readFileSync('balam/' + name + '.jsx', 'utf8');
const evidence = { scope: 'Actual AUTH/App startup gates; isolated memory only', sourceSha256: {}, cases: [], networkRequests: 0, commercialWrites: 0 };
for (const name of ['auth', 'app']) evidence.sourceSha256[name] = createHash('sha256').update(source(name)).digest('hex');
const offline = 'Sin conexión. BALAM necesita internet para continuar.';

async function fixture(profileStatus = 'active', permissionFailure = null) {
  const hooks = [], effects = [], handlers = new Map(), toasts = [];
  let cursor = 0, initCalls = 0, initHook = null;
  let status = { ready: false, connection: 'offline', message: offline, errors: [] };
  const snapshot = { model_version: 'h56-screen-permissions-v1', permission_version: '1', verified_at: '2026-09-12T14:00:00Z',
    profile_status: profileStatus, profile: profileStatus === 'active' ? { id: 'existing-profile', nombre: 'Test', role: 'admin', active: true } : null,
    permissions: [{ screen_key: 'pos', allowed: profileStatus === 'active', source: 'role', role_code: 'admin' }] };
  const session = { user: { id: '11111111-1111-4111-8111-111111111111', email: 'test@example.test' } };
  const client = { auth: { getSession: async () => ({ data: { session } }), onAuthStateChange() {}, signOut: async () => ({}) },
    rpc: async () => permissionFailure ? { error: permissionFailure } : { data: snapshot } };
  const React = {
    Fragment: Symbol('Fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(value => value !== false && value != null) }),
    cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }),
    useRef(value) { const index = cursor++; return hooks[index] ||= { current: value }; },
    useState(value) { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof value === 'function' ? value() : value;
      return [hooks[index], next => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next; }]; },
    useEffect(callback, deps) { const index = cursor++; if (!(index in hooks) || !deps || deps.some((value, offset) => value !== hooks[index]?.[offset])) {
      hooks[index] = deps; effects.push(callback); } },
  };
  const window = { React, CORE: { invokeSync: () => client },
    SCREENS: { all: () => [{ id: 'pos' }], get: id => id === 'pos' ? { id, title: 'POS', component: () => function FixturePOS() {} } : null,
      childrenOf: () => [], navigation: () => [{ id: 'pos', title: 'POS', menuLabel: 'POS' }] },
    DATA: { commercialProducts: () => [], sales: [] }, CONFIG: { get: () => undefined },
    HX: { MS() {} }, UI: { toast: message => toasts.push(message), ToastHost() {} }, useTweaks: value => [value],
    addEventListener(name, callback) { const list = handlers.get(name) || []; list.push(callback); handlers.set(name, list); },
    removeEventListener() {}, dispatchEvent(event) { for (const callback of handlers.get(event.type) || []) callback(event); },
    STORE: { syncStatus: () => status, setSession: async () => ({ ok: true }),
      async init() { initCalls++; return initHook ? initHook() : { ok: true }; } },
  };
  const context = vm.createContext({ window, React, console, CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    localStorage: { getItem: () => null, setItem() {} }, document: { body: { style: {} } }, setTimeout, clearTimeout, setInterval() {}, clearInterval() {} });
  vm.runInContext(source('auth'), context, { filename: 'auth.jsx' });
  await window.AUTH.init();
  // The real AUTH resolution is complete; avoid an unrelated second bootstrap from App's mount effect.
  window.AUTH.init = async () => {};
  vm.runInContext(source('app'), context, { filename: 'app.jsx' });
  return { window, toasts, get initCalls() { return initCalls; },
    setStatus(next) { status = next; window.dispatchEvent({ type: 'syncstatuschange' }); },
    setInit(callback) { initHook = callback; },
    render() { cursor = 0; return window.App(); },
    flushEffects() { while (effects.length) effects.shift()(); },
  };
}
const nodes = tree => tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(nodes)] : [];
const text = tree => tree && typeof tree === 'object' ? tree.children.map(text).join(' ') : String(tree || '');
const gate = tree => nodes(tree).find(node => node.props['data-testid'] === 'online-gate');
const banner = tree => nodes(tree).find(node => node.props['data-testid'] === 'online-status');
async function scenario(name, callback) {
  if (process.env.BALAM_STARTUP_CASE && !process.env.BALAM_STARTUP_CASE.split(',').some(part => name.includes(part.trim()))) return;
  try { await callback(); evidence.cases.push({ name, ok: true }); console.log('PASS ' + name); }
  catch (error) { evidence.cases.push({ name, ok: false, error: error.message }); throw error; }
}
try {
  await scenario('Inactive account is not hidden by the commercial offline gate', async () => {
    const app = await fixture('user_inactive');
    assert.equal(app.window.AUTH.accessState, 'user_inactive');
    const tree = app.render();
    assert.equal(gate(tree), undefined, 'Definitive access denial must precede the commercial gate');
    assert.ok(nodes(tree).some(node => node.type?.name === 'AccessDeniedScreen'));
    assert.doesNotMatch(text(tree), /Sin conexión/);
  });
  await scenario('Permission rejection blocks stale readiness and its retry is observed', async () => {
    const app = await fixture('active', { code: '42501', message: 'connection rejected by access policy' });
    app.setStatus({ ready: true, connection: 'online', message: 'Todo actualizado' });
    let tree = app.render(); app.flushEffects();
    assert.equal(app.window.AUTH.accessState, 'permissions_unavailable');
    assert.deepEqual(JSON.parse(JSON.stringify(app.window.AUTH.accessError())), { code: '42501', transport: false });
    assert.deepEqual(Object.keys(app.window.AUTH.accessError()).sort(), ['code', 'transport']);
    assert.equal(text(gate(tree)).includes('No pudimos confirmar el acceso. Inténtalo de nuevo.'), true);
    assert.doesNotMatch(text(tree), /Sin conexión|perfil activo autorizado/);
    let reject;
    app.setInit(() => new Promise((_resolve, fail) => { reject = fail; }));
    const retry = nodes(tree).find(node => node.props['data-testid'] === 'online-gate-retry');
    const pending = retry.props.onClick();
    assert.equal(typeof pending.then, 'function');
    tree = app.render(); app.flushEffects();
    assert.equal(text(gate(tree)).trim(), 'BALAM se está actualizando.');
    reject(Object.assign(new Error('permission denied'), { code: '42501' }));
    await pending;
    tree = app.render();
    assert.match(text(gate(tree)), /No pudimos confirmar el acceso/);
    assert.equal(app.initCalls, 1);
  });
  await scenario('Actual network failure has the requested offline message', async () => {
    const app = await fixture('active', { code: '', message: 'TypeError: Failed to fetch' });
    const tree = app.render();
    assert.equal(app.window.AUTH.accessState, 'remote_unavailable');
    assert.deepEqual(JSON.parse(JSON.stringify(app.window.AUTH.accessError())), { code: 'NETWORK', transport: true });
    assert.match(text(gate(tree)), /Sin conexión\. BALAM necesita internet para continuar\./);
    assert.equal(nodes(tree).some(node => node.type?.name === 'AccessDeniedScreen'), false);
  });
  await scenario('Adoption and permission refresh preserve the shell; completion is announced once', async () => {
    const app = await fixture();
    app.setStatus({ ready: true, connection: 'online', message: 'Todo actualizado' });
    const original = nodes(app.render()).find(node => node.props.key === 'shell'); app.flushEffects();
    app.setStatus({ ready: false, connection: 'checking', message: 'internal stage', adoption: { revision: 1, state: 'working' } });
    let tree = app.render(); app.flushEffects();
    const retained = nodes(tree).find(node => node.props.key === 'shell');
    assert.equal(retained.props.key, original.props.key);
    assert.equal(retained.props.inert, undefined);
    assert.equal(retained.props['aria-hidden'], undefined);
    assert.equal(gate(tree), undefined);
    assert.match(text(banner(tree)), /BALAM se está actualizando/);
    app.window.AUTH.isReady = () => false;
    app.setStatus({ ready: true, connection: 'online', message: 'Todo actualizado', adoption: { revision: 1, state: 'ready' } });
    tree = app.render(); app.flushEffects();
    assert.equal(nodes(tree).find(node => node.props.key === 'shell').children, retained.children);
    assert.equal(nodes(tree).find(node => node.props.key === 'shell').props.inert, '');
    assert.equal(text(gate(tree)).trim(), 'BALAM se está actualizando.');
    assert.equal(app.toasts.length, 0, 'A snapshot cannot bypass unresolved authentication');
    app.window.AUTH.isReady = () => true;
    tree = app.render(); app.flushEffects();
    assert.equal(gate(tree), undefined);
    assert.deepEqual(app.toasts, ['Todo listo. Puedes continuar trabajando.']);
    app.setStatus({ ready: true, connection: 'online', message: 'Todo actualizado', adoption: { revision: 1, state: 'ready' } });
    app.render(); app.flushEffects();
    assert.equal(app.toasts.length, 1);
  });
  await scenario('Uncertain operation keeps its existing form and confirmation message', async () => {
    const app = await fixture();
    app.setStatus({ ready: true, connection: 'online', message: 'Todo actualizado' });
    const original = nodes(app.render()).find(node => node.props.key === 'shell'); app.flushEffects();
    app.setStatus({ ready: false, connection: 'checking', message: 'BALAM se está actualizando.', hasUnresolvedRequests: true,
      errors: [{ code: 'ONLINE_RESULT_UNKNOWN' }], adoption: { revision: 1, state: 'ready' } });
    const tree = app.render();
    assert.equal(nodes(tree).find(node => node.props.key === 'shell').props.key, original.props.key);
    assert.equal(gate(tree), undefined);
    assert.match(text(banner(tree)), /Confirmación pendiente/);
    assert.doesNotMatch(text(banner(tree)), /Sin conexión/);
    assert.equal(nodes(banner(tree)).some(node => node.type === 'button' && !node.props.disabled), true);
  });
  await scenario('Pending confirmation at first load permits a status query without exposing a shell', async () => {
    const app = await fixture();
    app.setStatus({ ready: false, hasUnresolvedRequests: true, connection: 'error' });
    const tree = app.render();
    assert.ok(gate(tree));
    assert.equal(nodes(tree).some(node => node.props.key === 'shell'), false);
    const retry = nodes(tree).find(node => node.props['data-testid'] === 'online-gate-retry');
    assert.equal(!!retry.props.disabled, false);
    await retry.props.onClick();
    assert.equal(app.initCalls, 1);
  });
  await scenario('Confirmed snapshot opens the first shell despite pending account receipt H170', async () => {
    const app = await fixture();
    app.setStatus({ ready: true, connection: 'online', hasUnresolvedRequests: true,
      pendingRequests: [{requestId:'17000000-0000-4000-8000-000000000001',kind:'account'}] });
    const tree = app.render();
    assert.equal(gate(tree), undefined, 'A confirmed snapshot must not be hidden by an unresolved account');
    assert.ok(nodes(tree).some(node => node.props.key === 'shell'));
    assert.match(text(banner(tree)), /Gestión de usuarios/);
  });
  await scenario('Changing user discards the prior shell while the new snapshot loads', async () => {
    const app = await fixture();
    app.setStatus({ ready: true, connection: 'online' });
    assert.ok(nodes(app.render()).some(node => node.props.key === 'shell')); app.flushEffects();
    app.window.AUTH.current = () => ({ id: 'different-profile' });
    app.setStatus({ ready: false, connection: 'checking', hasUnresolvedRequests: true });
    const tree = app.render();
    assert.ok(gate(tree));
    assert.equal(nodes(tree).some(node => node.props.key === 'shell'), false);
  });
} catch (error) { evidence.failure = error.message; process.exitCode = 1; }
finally {
  fs.mkdirSync('.evidence-h164', { recursive: true });
  const output = process.env.BALAM_STARTUP_EVIDENCE || '.evidence-h164/startup-app.json';
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
  console.log(`${evidence.cases.filter(row => row.ok).length} PASS / ${evidence.cases.filter(row => !row.ok).length} FAIL`);
}
