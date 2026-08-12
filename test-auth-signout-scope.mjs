// Alcance del cierre de sesión.
//
// supabase-js v2 usa scope 'global' por defecto en signOut(), que revoca los
// refresh tokens de la cuenta en TODOS los dispositivos. Cerrar sesión en una
// caja no debe expulsar a la bodega ni al teléfono. Estas pruebas fijan el
// alcance 'local' en las dos rutas de auth.jsx que cierran sesión.
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
];

function snapshot(entries) {
  return {
    model_version: 'h56-screen-permissions-v1',
    permission_version: 'pv1',
    verified_at: '2026-08-12T12:00:00.000Z',
    permissions: entries,
  };
}

function harness(options = {}) {
  const saved = new Map();
  const email = options.email || 'admin@balamguayaberas.com';
  const userId = '00000000-0000-0000-0000-000000000123';
  const session = { user: { id: userId, email }, access_token: 'test-token' };
  let profile = options.profile === undefined
    ? { id: 's1', nombre: 'Administrador', iniciales: 'AD', email, role: 'admin', active: true, deleted_at: null }
    : options.profile;
  const signOutCalls = [];
  let signInError = options.signInError || null;

  const remoteSnapshot = snapshot([
    { screen_key: 'dashboard', allowed: true, source: 'role', role_code: 'admin', effect: null },
    { screen_key: 'pos', allowed: true, source: 'role', role_code: 'admin', effect: null },
  ]);

  const client = {
    rpc: async name => {
      if (name !== 'current_permission_snapshot') {
        return { data: null, error: { message: `RPC inesperada: ${name}` } };
      }
      const profileStatus = !profile ? 'profile_missing'
        : profile.active === false ? 'user_inactive' : 'active';
      return { data: {
        ...remoteSnapshot,
        profile_status: profileStatus,
        profile: profile ? { ...profile, id: userId, seller_id: profile.id, avatar_url: null } : null,
        base_role: profile ? profile.role : null,
      }, error: null };
    },
    auth: {
      getSession: async () => ({ data: { session: options.noSession ? null : session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async () => signInError
        ? { data: null, error: { message: signInError } }
        : { data: { session }, error: null },
      // Registra EXACTAMENTE con qué se llamó: el alcance es lo que se prueba.
      signOut: async (...args) => { signOutCalls.push(args); return { error: null }; },
    },
  };
  const context = {
    console,
    localStorage: {
      getItem: key => saved.has(key) ? saved.get(key) : null,
      setItem: (key, value) => saved.set(key, String(value)),
      removeItem: key => saved.delete(key),
    },
    CustomEvent: class { constructor(type) { this.type = type; } },
    location: { protocol: 'https:', hostname: 'balam.test' },
    window: {
      CORE: { invokeSync: async method => method === 'getClient' ? client : undefined },
      SCREENS: {
        all: () => screens.slice(),
        navigation: () => screens.filter(s => s.menu),
        get: id => screens.find(s => s.id === id) || null,
        childrenOf: () => [],
        version: () => 'registry-v1',
      },
      dispatchEvent() {},
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(process.env.AUTH_SOURCE || 'balam/auth.jsx', 'utf8'), context);
  return { AUTH: context.window.AUTH, signOutCalls, saved };
}

function isLocalScope(args) {
  return args.length === 1 && args[0] && args[0].scope === 'local';
}

// ── A. Cierre de sesión normal ──────────────────────────────────────────────
const normal = harness();
await normal.AUTH.init();
check('A. sesión persistida se restaura', normal.AUTH.hasSession() === true);
check('A. perfil administrador resuelto', normal.AUTH.role() === 'admin');

await normal.AUTH.logout();
check('B. logout llama signOut exactamente una vez', normal.signOutCalls.length === 1);
check('B. logout usa alcance local (no expulsa otras terminales)',
  isLocalScope(normal.signOutCalls[0]));
check('B. logout deja la terminal sin sesión', normal.AUTH.hasSession() === false);
check('B. logout deja la terminal sin perfil', normal.AUTH.current() === null);

// ── C. Login sin perfil activo: se cierra sesión, también en local ──────────
const sinPerfil = harness({ profile: null, noSession: true });
await sinPerfil.AUTH.init();
const rechazado = await sinPerfil.AUTH.login('admin@balamguayaberas.com', 'x');
check('C. login sin perfil no concede acceso', rechazado.ok === false);
check('C. login sin perfil cierra sesión', sinPerfil.signOutCalls.length === 1);
check('C. ese cierre también es de alcance local',
  isLocalScope(sinPerfil.signOutCalls[0]));

// ── D. Login correcto no cierra ninguna sesión ──────────────────────────────
const bueno = harness({ noSession: true });
await bueno.AUTH.init();
const aceptado = await bueno.AUTH.login('admin@balamguayaberas.com', 'correcta');
check('D. login correcto concede acceso', aceptado.ok === true);
check('D. login correcto no llama signOut', bueno.signOutCalls.length === 0);
check('D. login correcto deja sesión activa', bueno.AUTH.hasSession() === true);

// ── E. Credenciales inválidas: mensaje traducido, sin cierre global ─────────
const malas = harness({ noSession: true, signInError: 'Invalid login credentials' });
await malas.AUTH.init();
const negado = await malas.AUTH.login('admin@balamguayaberas.com', 'mala');
check('E. credenciales inválidas dan mensaje claro',
  negado.ok === false && negado.error === 'Correo o contraseña incorrectos');
check('E. credenciales inválidas no llaman signOut', malas.signOutCalls.length === 0);

console.log(`\n${passed} verdes, ${failed} rojas`);
process.exit(failed ? 1 : 0);
