import fs from 'node:fs';
import vm from 'node:vm';

let passed = 0;
let failed = 0;
function check(label, condition) {
  console.log(`${condition ? '✅' : '❌'} ${label}`);
  condition ? passed++ : failed++;
}

const screens = [
  { id: 'dashboard', menu: true, enabled: true },
  { id: 'pos', menu: true, enabled: true },
  { id: 'inventario', menu: true, enabled: true },
  { id: 'config.permisos', parentId: 'config', enabled: false },
];

function snapshot(entries, version = 'pv1') {
  return {
    model_version: 'h56-screen-permissions-v1',
    permission_version: version,
    verified_at: '2026-07-30T12:00:00.000Z',
    permissions: entries,
  };
}

function harness(options = {}) {
  const saved = options.saved || new Map();
  const email = options.email || 'user@example.com';
  const userId = options.userId || '00000000-0000-0000-0000-000000000123';
  const session = options.noSession ? null : {
    user: { id: userId, email },
    access_token: 'test-token',
  };
  let remoteSnapshot = options.snapshot || snapshot([]);
  let profile = options.profile === undefined
    ? { id: userId, nombre: 'Usuario', iniciales: 'US', email, role: 'vendedor', active: true, deleted_at: null }
    : options.profile;
  let offline = !!options.offline;
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
        maybeSingle: async () => offline
          ? { data: null, error: { message: 'Failed to fetch', code: 'NETWORK' } }
          : { data: profile, error: null },
      };
      return query;
    },
    rpc: async name => {
      if (name !== 'current_permission_snapshot') {
        return { data: null, error: { message: `RPC inesperada: ${name}` } };
      }
      const profileStatus = !profile ? 'profile_missing'
        : profile.active === false ? 'user_inactive' : 'active';
      const remoteProfile = profile ? {
        ...profile,
        id: userId,
        seller_id: profile.id,
        avatar_url: profile.avatar_url || null,
      } : null;
      return offline
        ? { data: null, error: { message: 'Failed to fetch', code: 'NETWORK' } }
        : { data: {
          ...remoteSnapshot,
          profile_status: profileStatus,
          profile: remoteProfile,
          base_role: profile?.role || remoteSnapshot.base_role || null,
        }, error: null };
    },
    auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => {},
    },
  };
  const context = {
    console,
    localStorage,
    CustomEvent: class { constructor(type) { this.type = type; } },
    location: { protocol: 'https:', hostname: 'balam.test' },
    window: {
      CORE: { invokeSync: async method => method === 'getClient' ? client : undefined },
      SCREENS: {
        all: () => screens.slice(),
        navigation: () => screens.filter(s => s.menu && s.enabled !== false),
        get: id => screens.find(s => s.id === id) || null,
        version: () => 'registry-v1',
      },
      dispatchEvent() {},
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('balam/auth.jsx', 'utf8'), context);
  return {
    AUTH: context.window.AUTH,
    saved,
    setSnapshot(value) { remoteSnapshot = value; },
    setOffline(value) { offline = value; },
    setProfile(value) { profile = value; },
  };
}

const online = harness({
  snapshot: snapshot([
    { screen_key: 'dashboard', allowed: false, source: 'role', role_code: 'vendedor', effect: null },
    { screen_key: 'pos', allowed: true, source: 'role', role_code: 'vendedor', effect: null },
    { screen_key: 'inventario', allowed: true, source: 'override', role_code: 'vendedor', effect: 'allow' },
  ]),
});
await online.AUTH.init();
check('carga permisos efectivos en línea', online.AUTH.canAccess('pos') === true);
check('resuelve permiso heredado del rol',
  online.AUTH.permissionReason?.('pos')?.code === 'allowed_by_role');
check('resuelve override allow',
  online.AUTH.canAccess('inventario') === true
    && online.AUTH.permissionReason?.('inventario')?.code === 'allowed_by_override');
check('pantalla desconocida se deniega',
  online.AUTH.canAccess('no.existe') === false
    && online.AUTH.permissionReason?.('no.existe')?.code === 'unknown_screen');
check('pantalla nueva ausente del snapshot se deniega',
  online.AUTH.canAccess('config.permisos') === false);
check('API pública de navegación queda completa',
  typeof online.AUTH.requireAccess === 'function'
    && typeof online.AUTH.allowedScreens === 'function'
    && typeof online.AUTH.defaultScreen === 'function'
    && typeof online.AUTH.refreshPermissions === 'function'
    && online.AUTH.defaultScreen() === 'pos');

const deny = harness({
  snapshot: snapshot([
    { screen_key: 'pos', allowed: false, source: 'override', role_code: 'vendedor', effect: 'deny' },
  ]),
});
await deny.AUTH.init();
check('override deny prevalece', deny.AUTH.canAccess('pos') === false
  && deny.AUTH.permissionReason?.('pos')?.code === 'denied_by_override');

const missing = harness({ profile: null, snapshot: snapshot([]) });
await missing.AUTH.init();
check('usuario sin perfil queda fail-closed',
  missing.AUTH.allowedScreens?.().length === 0
    && missing.AUTH.permissionReason?.('pos')?.code === 'profile_missing');

const inactive = harness({
  profile: { id: 'x', nombre: 'Inactivo', email: 'user@example.com', role: 'admin', active: false, deleted_at: null },
  snapshot: snapshot([{ screen_key: 'dashboard', allowed: true, source: 'role', role_code: 'admin', effect: null }]),
});
await inactive.AUTH.init();
check('usuario inactivo queda fail-closed',
  inactive.AUTH.canAccess('dashboard') === false
    && inactive.AUTH.permissionReason?.('dashboard')?.code === 'user_inactive');

const cachedOnline = harness({
  snapshot: snapshot([{ screen_key: 'pos', allowed: true, source: 'role', role_code: 'vendedor', effect: null }], 'cache-v1'),
});
await cachedOnline.AUTH.init();
const cachedOffline = harness({ saved: cachedOnline.saved, offline: true });
await cachedOffline.AUTH.init();
check('caché offline válida conserva sólo permisos verificados',
  cachedOffline.AUTH.canAccess('pos') === true
    && cachedOffline.AUTH.permissionReason?.('pos')?.cached === true
    && cachedOffline.AUTH.canAccess('inventario') === false);

const incompatibleSaved = new Map(cachedOnline.saved);
const cacheKey = [...incompatibleSaved.keys()].find(k => k.includes('access'));
if (cacheKey) {
  const value = JSON.parse(incompatibleSaved.get(cacheKey));
  value.schemaVersion = 999;
  incompatibleSaved.set(cacheKey, JSON.stringify(value));
}
const incompatible = harness({ saved: incompatibleSaved, offline: true });
await incompatible.AUTH.init();
check('caché incompatible se invalida', incompatible.AUTH.allowedScreens?.().length === 0);

const corruptSaved = new Map([[cacheKey || 'balam_auth_access_v2', '{mal-json']]);
const corrupt = harness({ saved: corruptSaved, offline: true });
await corrupt.AUTH.init();
check('caché corrupta se invalida', corrupt.AUTH.allowedScreens?.().length === 0);

const otherUser = harness({
  saved: cachedOnline.saved,
  offline: true,
  email: 'other@example.com',
  userId: '00000000-0000-0000-0000-000000000999',
});
await otherUser.AUTH.init();
check('caché de otro usuario no se reutiliza', otherUser.AUTH.allowedScreens?.().length === 0);

const revoked = harness({
  snapshot: snapshot([{ screen_key: 'pos', allowed: true, source: 'role', role_code: 'vendedor', effect: null }], 'before'),
});
await revoked.AUTH.init();
revoked.setSnapshot(snapshot([
  { screen_key: 'pos', allowed: false, source: 'override', role_code: 'vendedor', effect: 'deny' },
], 'after'));
await revoked.AUTH.refreshPermissions?.();
check('revocación remota reemplaza caché al reconectar',
  revoked.AUTH.canAccess('pos') === false
    && revoked.AUTH.permissionReason?.('pos')?.code === 'denied_by_override');

const none = harness({ snapshot: snapshot([]) });
await none.AUTH.init();
check('usuario sin pantallas permitidas no obtiene destino',
  none.AUTH.defaultScreen?.() === null && none.AUTH.allowedScreens?.().length === 0);

const app = fs.readFileSync('balam/app.jsx', 'utf8');
check('menú, persistencia y navegación interna usan AUTH',
  app.includes('window.AUTH.canAccess')
    && app.includes('window.AUTH.defaultScreen')
    && app.includes('window.AUTH.requireAccess')
    && !app.includes('!REQUIRE_AUTH || window.AUTH.canAccess')
    && !app.includes("setPage('pos')"));
check('pantalla activa revocada no monta componente y muestra acceso restringido',
  app.includes('RestrictedAccessScreen')
    && app.includes('if (!visibleScreen)')
    && app.includes('const VisibleComponent = visibleScreen.component()'));

const authSource = fs.readFileSync('balam/auth.jsx', 'utf8');
check('los módulos padre derivan acceso de sus pantallas hijas',
  authSource.includes("window.SCREENS.childrenOf")
    && authSource.includes("'parent_derived'"));

console.log(`\n════════ ${passed} pasaron, ${failed} fallaron ════════`);
process.exit(failed ? 1 : 0);
