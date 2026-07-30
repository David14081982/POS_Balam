import fs from 'node:fs';
import vm from 'node:vm';

let failures = 0;
function check(condition, label) {
  if (condition) console.log(`✅ ${label}`);
  else { failures++; console.error(`❌ ${label}`); }
}

function authHarness(email, sellers, options = {}) {
  const matched = sellers.find(s => s.email.toLowerCase() === email.toLowerCase());
  const session = { user: { id: options.userId || matched?.id || 'orphan-auth-id', email }, access_token: 'test-token' };
  const screenIds = ['dashboard', 'pos', 'inventario', 'clientes', 'apartados', 'prestamos', 'devoluciones', 'descuentos', 'vendedores', 'reportes', 'config'];
  const saved = options.saved || new Map();
  const localStorage = {
    getItem: key => saved.has(key) ? saved.get(key) : null,
    setItem: (key, value) => saved.set(key, String(value)),
    removeItem: key => saved.delete(key),
  };
  const client = {
    from: () => {
      const query = {
        select: () => query,
        ilike: () => query,
        eq: () => query,
        is: () => query,
        maybeSingle: async () => {
          const row = sellers.find(s => s.email.toLowerCase() === email.toLowerCase() && s.active !== false);
          return options.failProfile
            ? { data: null, error: { message: 'network' } }
            : { data: row ? { ...row, avatar_url: row.avatar || null, deleted_at: null } : null, error: null };
        },
      };
      return query;
    },
    rpc: async name => {
      if (options.failProfile) return { data: null, error: { message: 'network', code: 'NETWORK' } };
      if (name !== 'current_permission_snapshot') return { data: null, error: { message: 'rpc' } };
      const role = matched?.role;
      return { data: {
        model_version: 'h56-screen-permissions-v1',
        permission_version: `${role || 'none'}-v1`,
        verified_at: '2026-07-30T12:00:00.000Z',
        profile_status: matched ? 'active' : 'profile_missing',
        profile: matched ? {
          ...matched,
          id: session.user.id,
          seller_id: matched.id,
          avatar_url: matched.avatar || null,
        } : null,
        base_role: role || null,
        permissions: screenIds.map(screen_key => ({
          screen_key,
          allowed: role === 'admin' || (role === 'vendedor' && screen_key === 'pos'),
          source: role ? 'role' : 'default',
          role_code: role || null,
          effect: null,
        })),
      }, error: null };
    },
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  };
  const listeners = [];
  const context = {
    console,
    localStorage,
    CustomEvent: class { constructor(type) { this.type = type; } },
    location: { protocol: 'https:', hostname: 'balam.test' },
    window: {
      DATA: { sellers },
      CORE: {
        invokeSync: async method => method === 'getClient' ? client : undefined,
      },
      SCREENS: {
        version: () => 'h56-screen-registry-v1',
        all: () => screenIds.map(id => ({ id, menu: true })),
        navigation: () => screenIds.map(id => ({ id, menu: true })),
        get: id => screenIds.includes(id) ? { id, menu: true } : null,
      },
      dispatchEvent: event => listeners.push(event.type),
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('balam/auth.jsx', 'utf8'), context);
  return { AUTH: context.window.AUTH, listeners, saved };
}

{
  const { AUTH } = authHarness('seller@example.com', [
    { id: 's1', nombre: 'Venta Uno', email: 'seller@example.com', role: 'vendedor', active: true },
  ]);
  await AUTH.init();
  check(AUTH.current()?.role === 'vendedor', '1. conserva el rol vendedor del perfil');
  check(AUTH.isAdmin() === false, '2. una sesión de vendedor no se considera administradora');
  check(AUTH.canAccess?.('pos') === true, '3. vendedor puede entrar a Punto de Venta');
  check(AUTH.canAccess?.('inventario') === false, '4. vendedor no puede entrar a Inventario');
}

{
  const { AUTH } = authHarness('admin@example.com', [
    { id: 'a1', nombre: 'Admin Uno', email: 'admin@example.com', role: 'admin', active: true },
  ]);
  await AUTH.init();
  const registryContext = { window: {} };
  vm.createContext(registryContext);
  vm.runInContext(fs.readFileSync('balam/screens.jsx', 'utf8'), registryContext);
  const routes = registryContext.window.SCREENS.navigation();
  check(routes.every(route => AUTH.canAccess(route.id) === true),
    '15. administrador conserva acceso a todas las pantallas principales');
}

{
  const { AUTH } = authHarness('orphan@example.com', []);
  await AUTH.init();
  check(AUTH.current() === null, '5. cuenta sin perfil no recibe identidad administrativa');
  check(AUTH.canAccess?.('pos') === false, '6. cuenta sin perfil no puede entrar al POS');
}

{
  const app = fs.readFileSync('balam/app.jsx', 'utf8');
  check(app.includes('navigation.filter(n => canAccess(n.id))'), '7. el menú central se filtra con el contrato de acceso');
  check(app.includes('const visiblePage = canAccess(page) ? page : defaultPage'), '8. una página persistida prohibida se redirige');
  check(app.includes('window.AUTH.defaultScreen()'), '9. el destino seguro lo decide AUTH');
  check(app.includes('window.STORE.setSession(window.AUTH.current())'),
    '11. cada authchange entrega la identidad efectiva a STORE');
  check(!app.includes('window.STORE && !window.STORE.enabled'),
    '12. un segundo login no omite la reinicialización por STORE.enabled');
}

{
  const online = authHarness('offline@example.com', [
    { id: 's2', nombre: 'Caja Offline', email: 'offline@example.com', role: 'vendedor', active: true },
  ]);
  await online.AUTH.init();
  const offline = authHarness('offline@example.com', [], { saved: online.saved, failProfile: true, userId: 's2' });
  await offline.AUTH.init();
  check(offline.AUTH.canAccess('pos') === true, '10. sesión persistida conserva POS sin conexión con perfil previamente verificado');
}

{
  const store = fs.readFileSync('balam/store.jsx', 'utf8');
  check(store.includes('op.ownerId = activeOwnerId()'),
    '13. cada operación nueva conserva el propietario de sesión');
  check(store.includes('opBelongsToActiveSession'),
    '14. la cola sólo drena operaciones de la sesión activa');
}

if (failures) {
  console.error(`\n════════ ${failures} fallaron ════════`);
  process.exit(1);
}
console.log('\n════════ 15 pasaron, 0 fallaron ════════');
