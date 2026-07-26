// auth.jsx — Sesión de la TERMINAL con Supabase Auth (autenticación REAL).
// Modelo: cada persona inicia sesión con Supabase Auth y su perfil activo en pos.sellers
// determina el rol efectivo (administrador o vendedor).
// la sesión persiste (token en localStorage, auto-refresh) → la terminal queda
// autenticada entre recargas. El último perfil verificado se conserva para arranque offline.
// Con RLS activo, cada rol sólo puede leer/escribir las operaciones autorizadas de pos.*
//   → la llave anon embebida deja de ser un riesgo.
// Las cuentas se administran mediante la Edge Function admin-users.
(function () {
  let session = null;
  let profile = null;
  let ready = false;
  let subscribed = false;
  let resolveSeq = 0;
  const PROFILE_KEY = 'balam_auth_profile_v1';

  function emit() { try { window.dispatchEvent(new CustomEvent('authchange')); } catch (e) { /* */ } }
  async function client() { return await window.CORE.invokeSync('getClient') || null; }
  function cachedProfile(email) {
    try {
      const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      return saved && String(saved.email || '').toLowerCase() === String(email || '').toLowerCase() ? saved : null;
    } catch (e) { return null; }
  }
  function saveProfile(value) {
    try {
      if (value) localStorage.setItem(PROFILE_KEY, JSON.stringify(value));
      else localStorage.removeItem(PROFILE_KEY);
    } catch (e) { /* almacenamiento no disponible */ }
  }

  async function resolveProfile(c, nextSession) {
    const seq = ++resolveSeq;
    session = nextSession || null;
    profile = null;
    if (session && session.user && session.user.email && c) {
      try {
        const email = String(session.user.email).trim();
        const { data, error } = await c.from('sellers')
          .select('id,nombre,iniciales,email,role,avatar_url,active,deleted_at')
          .ilike('email', email)
          .eq('active', true)
          .is('deleted_at', null)
          .maybeSingle();
        if (!error && data) {
          profile = {
            id: data.id, nombre: data.nombre, iniciales: data.iniciales || 'US',
            email: data.email, role: data.role || 'vendedor',
            avatar: data.avatar_url || null, active: data.active !== false,
          };
          saveProfile(profile);
        } else if (error) {
          // Una sesión ya persistida debe poder abrir la caja sin conexión.
          // Sólo se acepta el último perfil verificado para el mismo correo.
          profile = cachedProfile(email);
        } else {
          saveProfile(null);
        }
      } catch (e) { profile = cachedProfile(session.user.email); }
    }
    if (seq !== resolveSeq) return;
    ready = true;
    emit();
  }

  function traducir(msg) {
    const m = String(msg || '').toLowerCase();
    if (m.includes('invalid login')) return 'Correo o contraseña incorrectos';
    if (m.includes('email not confirmed')) return 'La cuenta aún no está confirmada';
    if (m.includes('failed to fetch') || m.includes('network')) return 'Sin conexión con la nube';
    return msg || 'No se pudo iniciar sesión';
  }

  // Carga la sesión persistida y se suscribe a cambios. Llamar al montar la app.
  async function init() {
    const c = await client();
    if (!c) { ready = true; emit(); return; }
    let initial = null;
    try { const { data } = await c.auth.getSession(); initial = (data && data.session) || null; } catch (e) { initial = null; }
    if (!subscribed) {
      subscribed = true;
      c.auth.onAuthStateChange((_evt, s) => { ready = false; resolveProfile(c, s || null); });
    }
    await resolveProfile(c, initial);
  }

  async function login(email, password) {
    const c = await client();
    if (!c) return { ok: false, error: 'Sin conexión con la nube' };
    try {
      const { data, error } = await c.auth.signInWithPassword({ email: String(email).trim(), password: String(password) });
      if (error) return { ok: false, error: traducir(error.message) };
      ready = false;
      await resolveProfile(c, data.session || null);
      if (!profile) {
        try { await c.auth.signOut(); } catch (e) { /* */ }
        session = null; profile = null; ready = true; emit();
        return { ok: false, error: 'La cuenta no tiene un perfil activo con acceso' };
      }
      return { ok: true };
    } catch (e) { return { ok: false, error: traducir(e.message) }; }
  }

  async function logout() {
    const c = await client();
    try { if (c) await c.auth.signOut(); } catch (e) { /* */ }
    resolveSeq++; session = null; profile = null; ready = true; emit();
  }

  // Identidad para la UI: enlaza con la persona en pos.sellers por email (nombre/iniciales/rol).
  function current() { return profile; }
  function role() { return profile ? profile.role : null; }
  function isAdmin() { return role() === 'admin'; }
  function canAccess(page) {
    if (!profile) return false;
    if (profile.role === 'admin') return true;
    return profile.role === 'vendedor' && page === 'pos';
  }
  function hasSession() { return !!session; }
  function isReady() { return ready; }

  window.AUTH = { init, login, logout, current, role, isAdmin, canAccess, hasSession, isReady };
})();
