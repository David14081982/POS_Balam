import fs from 'node:fs';
import vm from 'node:vm';

let failures = 0;
function check(condition, label) {
  if (condition) console.log(`✅ ${label}`);
  else { failures++; console.error(`❌ ${label}`); }
}

function authHarness(email, sellers, options = {}) {
  const session = { user: { email }, access_token: 'test-token' };
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
    window: {
      DATA: { sellers },
      STORE: { getClient: async () => client },
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
  const { AUTH } = authHarness('orphan@example.com', []);
  await AUTH.init();
  check(AUTH.current() === null, '5. cuenta sin perfil no recibe identidad administrativa');
  check(AUTH.canAccess?.('pos') === false, '6. cuenta sin perfil no puede entrar al POS');
}

{
  const app = fs.readFileSync('balam/app.jsx', 'utf8');
  check(app.includes('NAV.filter(n => canAccess(n.id))'), '7. el menú se filtra con el contrato de acceso');
  check(app.includes('const visiblePage = canAccess(page) ? page : defaultPage'), '8. una página persistida prohibida se redirige');
  check(app.includes("user && user.role === 'vendedor' ? 'pos' : 'dashboard'"), '9. vendedor tiene Punto de Venta como destino seguro');
}

{
  const online = authHarness('offline@example.com', [
    { id: 's2', nombre: 'Caja Offline', email: 'offline@example.com', role: 'vendedor', active: true },
  ]);
  await online.AUTH.init();
  const offline = authHarness('offline@example.com', [], { saved: online.saved, failProfile: true });
  await offline.AUTH.init();
  check(offline.AUTH.canAccess('pos') === true, '10. sesión persistida conserva POS sin conexión con perfil previamente verificado');
}

if (failures) {
  console.error(`\n════════ ${failures} fallaron ════════`);
  process.exit(1);
}
console.log('\n════════ 10 pasaron, 0 fallaron ════════');
