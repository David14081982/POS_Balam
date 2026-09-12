// auth.jsx — sesión, perfil y autoridad única de permisos de pantalla.
(function () {
  let session = null;
  let profile = null;
  let access = null;
  let accessState = 'profile_missing';
  let ready = false;
  let subscribed = false;
  let resolveSeq = 0;

  const PERMISSION_MODEL_VERSION = 'h56-screen-permissions-v1';

  function emit() {
    try { window.dispatchEvent(new CustomEvent('authchange')); } catch (e) { /* */ }
  }
  async function client() {
    return await window.CORE.invokeSync('getClient') || null;
  }
  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }
  function registeredScreens() {
    return window.SCREENS && window.SCREENS.all ? window.SCREENS.all() : [];
  }
  function requestedScreenKeys() {
    return registeredScreens().map(screen => screen.id);
  }
  function registeredScreen(screenKey) {
    return window.SCREENS && window.SCREENS.get
      ? window.SCREENS.get(screenKey)
      : null;
  }
  function isRemoteUnavailable(error) {
    const code = String((error && error.code) || '').toUpperCase();
    const message = String((error && error.message) || error || '').toLowerCase();
    return code === 'NETWORK'
      || message.includes('failed to fetch')
      || message.includes('network')
      || message.includes('load failed')
      || message.includes('connection');
  }
  function normalizeProfile(data, fallbackEmail) {
    return {
      id: data.id || data.seller_id,
      nombre: data.nombre,
      iniciales: data.iniciales || 'US',
      email: data.email || fallbackEmail,
      role: data.role || null,
      baseRole: null,
      avatar: data.avatar_url || null,
      active: data.active !== false,
    };
  }
  function normalizePermissions(rows) {
    if (!Array.isArray(rows)) return null;
    const known = new Set(requestedScreenKeys());
    const permissions = {};
    for (const row of rows) {
      if (!row || !known.has(row.screen_key) || typeof row.allowed !== 'boolean') {
        return null;
      }
      if (!['override', 'role', 'default'].includes(row.source)) return null;
      if (row.effect != null && !['allow', 'deny'].includes(row.effect)) return null;
      permissions[row.screen_key] = {
        allowed: row.allowed,
        source: row.source,
        roleCode: row.role_code || null,
        effect: row.effect || null,
      };
    }
    return permissions;
  }
  function normalizeRemoteSnapshot(data) {
    const raw = Array.isArray(data) && data.length === 1 ? data[0] : data;
    if (!raw || raw.model_version !== PERMISSION_MODEL_VERSION
        || !raw.permission_version || !raw.verified_at) return null;
    const permissions = normalizePermissions(raw.permissions);
    if (!permissions) return null;
    if (!['active', 'profile_missing', 'user_inactive'].includes(raw.profile_status)) return null;
    return {
      profileStatus: raw.profile_status,
      profile: raw.profile || null,
      access: {
        modelVersion: raw.model_version,
        permissionVersion: String(raw.permission_version),
        verifiedAt: String(raw.verified_at),
        baseRole: raw.base_role || null,
        permissions,
        cached: false,
      },
    };
  }
  function applyResolved(nextProfile, nextAccess, state) {
    profile = nextProfile ? { ...nextProfile, baseRole: nextAccess ? nextAccess.baseRole : null } : null;
    access = nextAccess;
    accessState = state;
  }
  async function fetchPermissionSnapshot(c) {
    try {
      const { data, error } = await c.rpc('current_permission_snapshot', {
        p_screen_keys: requestedScreenKeys(),
      });
      if (error) return { snapshot: null, error };
      const snapshot = normalizeRemoteSnapshot(data);
      return snapshot
        ? { snapshot, error: null }
        : { snapshot: null, error: { message: 'Respuesta de permisos incompatible', code: 'INCOMPATIBLE' } };
    } catch (error) {
      return { snapshot: null, error };
    }
  }

  async function resolveProfile(c, nextSession, options = {}) {
    const seq = ++resolveSeq;
    const preserveResolved = options.preserveResolved === true;
    session = nextSession || null;
    if (!preserveResolved) applyResolved(null, null, 'profile_missing');

    if (session && session.user && session.user.email && session.user.id && c) {
      const remote = await fetchPermissionSnapshot(c);
      // A newer resolution or logout owns the state now; never apply an old reply.
      if (seq !== resolveSeq) return;
      if (remote.snapshot && remote.snapshot.profileStatus === 'active'
          && remote.snapshot.profile) {
        const nextProfile = normalizeProfile(remote.snapshot.profile, session.user.email);
        applyResolved(nextProfile, remote.snapshot.access, 'remote');
      } else if (remote.snapshot && remote.snapshot.profileStatus === 'user_inactive') {
        applyResolved(null, null, 'user_inactive');
      } else if (remote.snapshot && remote.snapshot.profileStatus === 'profile_missing') {
        applyResolved(null, null, 'profile_missing');
      } else if (isRemoteUnavailable(remote.error)) {
        applyResolved(null, null, 'remote_unavailable');
      } else {
        applyResolved(null, null, 'permissions_unavailable');
      }
    }
    if (seq !== resolveSeq) return;
    ready = true;
    emit();
  }

  function traducir(msg) {
    const m = String(msg || '').toLowerCase();
    if (m.includes('invalid login')) return 'Correo o contraseña incorrectos';
    if (m.includes('email not confirmed')) return 'La cuenta aún no está confirmada';
    if (m.includes('failed to fetch') || m.includes('network')) return 'Sin conexión. BALAM necesita internet para continuar.';
    return msg || 'No se pudo iniciar sesión';
  }
  async function init() {
    const c = await client();
    if (!c) { ready = true; emit(); return; }
    let initial = null;
    try {
      const { data } = await c.auth.getSession();
      initial = (data && data.session) || null;
    } catch (e) { initial = null; }
    if (!subscribed) {
      subscribed = true;
      c.auth.onAuthStateChange((_evt, next) => {
        const nextSession = next || null;
        const sameResolvedUser = ready && profile && access
          && session && session.user && nextSession && nextSession.user
          && session.user.id === nextSession.user.id;
        if (!sameResolvedUser) {
          ready = false;
          emit();
        }
        resolveProfile(c, nextSession, { preserveResolved: sameResolvedUser });
      });
    }
    await resolveProfile(c, initial);
  }
  async function login(email, password) {
    const c = await client();
    if (!c) return { ok: false, error: 'Sin conexión. BALAM necesita internet para continuar.' };
    try {
      const { data, error } = await c.auth.signInWithPassword({
        email: String(email).trim(), password: String(password),
      });
      if (error) return { ok: false, error: traducir(error.message) };
      ready = false;
      emit();
      await resolveProfile(c, data.session || null);
      if (!profile) {
        // Alcance local: esta terminal no pudo resolver perfil, pero eso no es
        // motivo para revocar los refresh tokens de las demás terminales.
        try { await c.auth.signOut({ scope: 'local' }); } catch (e) { /* */ }
        session = null;
        ready = true;
        emit();
        return { ok: false, error: accessState === 'user_inactive'
          ? 'La cuenta está inactiva'
          : 'La cuenta no tiene un perfil activo con acceso' };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: traducir(e.message) };
    }
  }
  async function logout() {
    const c = await client();
    // supabase-js v2 usa scope 'global' por defecto y revoca la sesión de la
    // cuenta en TODOS los dispositivos. Cerrar sesión en una caja no debe
    // expulsar a la bodega ni al teléfono: el alcance es esta terminal.
    try { if (c) await c.auth.signOut({ scope: 'local' }); } catch (e) { /* */ }
    resolveSeq++;
    session = null;
    applyResolved(null, null, 'profile_missing');
    ready = true;
    emit();
  }
  async function refreshPermissions() {
    if (!session) return false;
    const seq = ++resolveSeq;
    const c = await client();
    if (!c || seq !== resolveSeq) return false;
    // Keep the verified screen mounted while the same identity refreshes.
    // The response still replaces permissions (including revocations/errors).
    const remote = await fetchPermissionSnapshot(c);
    if (seq !== resolveSeq) return false;
    if (remote.snapshot && remote.snapshot.profileStatus === 'active'
        && remote.snapshot.profile) {
      const nextProfile = normalizeProfile(remote.snapshot.profile, session.user.email);
      applyResolved(nextProfile, remote.snapshot.access, 'remote');
      ready = true;
      emit();
      return true;
    }
    if (remote.snapshot && remote.snapshot.profileStatus === 'user_inactive') {
      applyResolved(null, null, 'user_inactive');
    } else if (remote.snapshot && remote.snapshot.profileStatus === 'profile_missing') {
      applyResolved(null, null, 'profile_missing');
    } else if (isRemoteUnavailable(remote.error)) {
      applyResolved(null, null, 'remote_unavailable');
    } else {
      access = null;
      accessState = 'permissions_unavailable';
    }
    ready = true;
    emit();
    return false;
  }

  function current() { return profile; }
  function role() { return profile ? (profile.baseRole || profile.role) : null; }
  function isAdmin() { return role() === 'admin'; }
  function permissionReason(screenKey) {
    const screen = registeredScreen(screenKey);
    if (!screen) return { code: 'unknown_screen', allowed: false, cached: false };
    if (accessState === 'remote_unavailable' || accessState === 'permissions_unavailable') {
      return { code: accessState, allowed: false, cached: false };
    }
    if (accessState === 'profile_missing') {
      return { code: 'profile_missing', allowed: false, cached: false };
    }
    if (accessState === 'user_inactive') {
      return { code: 'user_inactive', allowed: false, cached: false };
    }
    if (screen.enabled === false) {
      return { code: 'denied_by_default', allowed: false, cached: !!(access && access.cached) };
    }
    const children = window.SCREENS && window.SCREENS.childrenOf
      ? window.SCREENS.childrenOf(screenKey)
      : [];
    if (children.length) {
      const childReasons = children.map(child => permissionReason(child.id));
      return {
        code: 'parent_derived',
        allowed: childReasons.some(reason => reason.allowed),
        source: 'derived',
        cached: childReasons.some(reason => reason.cached),
        verifiedAt: access && access.verifiedAt,
      };
    }
    const entry = access && access.permissions ? access.permissions[screenKey] : null;
    if (!entry) {
      return { code: 'denied_by_default', allowed: false, cached: !!(access && access.cached) };
    }
    let code = 'denied_by_default';
    if (entry.source === 'override') {
      code = entry.allowed ? 'allowed_by_override' : 'denied_by_override';
    } else if (entry.source === 'role') {
      code = entry.allowed ? 'allowed_by_role' : 'denied_by_role';
    }
    return {
      code,
      allowed: entry.allowed === true,
      source: entry.source,
      roleCode: entry.roleCode,
      effect: entry.effect,
      cached: !!access.cached,
      verifiedAt: access.verifiedAt,
    };
  }
  function canAccess(screenKey) {
    return permissionReason(screenKey).allowed === true;
  }
  function requireAccess(screenKey) {
    return canAccess(screenKey);
  }
  function allowedScreens() {
    return registeredScreens()
      .filter(screen => screen.enabled !== false && canAccess(screen.id))
      .map(screen => screen.id);
  }
  function defaultScreen() {
    const navigation = window.SCREENS && window.SCREENS.navigation
      ? window.SCREENS.navigation()
      : [];
    const first = navigation.find(screen => canAccess(screen.id));
    return first ? first.id : null;
  }
  function hasSession() { return !!session; }
  function isReady() { return ready; }

  window.AUTH = {
    init, login, logout, current, role, isAdmin,
    canAccess, requireAccess, allowedScreens, defaultScreen,
    permissionReason, refreshPermissions, hasSession, isReady,
    get accessState() { return accessState; },
  };
})();
