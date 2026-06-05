// auth.jsx — Sesión de la TERMINAL con Supabase Auth (autenticación REAL).
// Modelo: el dueño/admin inicia sesión UNA vez (email + contraseña de Supabase Auth);
// la sesión persiste (token en localStorage, auto-refresh) → la terminal queda
// autenticada entre recargas. Los VENDEDORES no inician sesión (se eligen por venta).
// Con RLS activo (pos_004), solo la sesión autenticada puede leer/escribir pos.*
//   → la llave anon embebida deja de ser un riesgo.
// La cuenta dueño se crea fuera de banda (Dashboard → Authentication → Add user,
//   o supabase/create-owner.mjs). La app solo INICIA SESIÓN.
(function () {
  let session = null;
  let ready = false;
  let subscribed = false;

  function emit() { try { window.dispatchEvent(new CustomEvent('authchange')); } catch (e) { /* */ } }
  async function client() { return (window.STORE && window.STORE.getClient) ? await window.STORE.getClient() : null; }

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
    try { const { data } = await c.auth.getSession(); session = (data && data.session) || null; } catch (e) { session = null; }
    if (!subscribed) {
      subscribed = true;
      c.auth.onAuthStateChange((_evt, s) => { session = s || null; emit(); });
    }
    ready = true; emit();
  }

  async function login(email, password) {
    const c = await client();
    if (!c) return { ok: false, error: 'Sin conexión con la nube' };
    try {
      const { data, error } = await c.auth.signInWithPassword({ email: String(email).trim(), password: String(password) });
      if (error) return { ok: false, error: traducir(error.message) };
      session = data.session || null; emit();
      return { ok: true };
    } catch (e) { return { ok: false, error: traducir(e.message) }; }
  }

  async function logout() {
    const c = await client();
    try { if (c) await c.auth.signOut(); } catch (e) { /* */ }
    session = null; emit();
  }

  // Identidad para la UI: enlaza con la persona en pos.sellers por email (nombre/iniciales/rol).
  function current() {
    if (!session || !session.user) return null;
    const email = (session.user.email || '').toLowerCase();
    const s = (window.DATA && window.DATA.sellers || []).find(x => (x.email || '').toLowerCase() === email);
    return s
      ? { id: s.id, nombre: s.nombre, iniciales: s.iniciales || 'AD', email: s.email, role: s.role || 'admin', avatar: s.avatar || null }
      : { id: 'auth', nombre: session.user.email || 'Administrador', iniciales: 'AD', email: session.user.email, role: 'admin', avatar: null };
  }
  function isAdmin() { return !!session; }
  function hasSession() { return !!session; }
  function isReady() { return ready; }

  window.AUTH = { init, login, logout, current, isAdmin, hasSession, isReady };
})();
