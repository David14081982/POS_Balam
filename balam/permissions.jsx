// permissions.jsx — Editor administrativo de permisos de visualización (H-56).
(function () {
  const { useEffect, useMemo, useRef, useState } = React;
  const { MS, GlassCard, SerifHeading } = window.HX;
  const h = React.createElement;
  const PAGE_SIZE = 100;

  async function rpc(name, args) {
    const client = await window.CORE.invokeSync('getClient');
    if (!client) throw new Error('NETWORK_UNAVAILABLE');
    const { data, error } = await client.schema('pos').rpc(name, args || {});
    if (error) throw error;
    return data;
  }

  function registryModel() {
    const screens = window.SCREENS.all().filter(s => s.enabled !== false);
    const byParent = new Map();
    screens.forEach(s => {
      const key = s.parentId || '';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(s);
    });
    const leavesOf = id => {
      const children = byParent.get(id) || [];
      return children.length ? children.flatMap(child => leavesOf(child.id)) : [id];
    };
    const entries = screens.map(s => ({
      screen_key: s.id,
      parent_key: s.parentId || null,
      is_leaf: !(byParent.get(s.id) || []).length,
    }));
    return {
      screens,
      entries,
      leaves: entries.filter(e => e.is_leaf).map(e => e.screen_key),
      groups: (byParent.get('') || []).map(s => ({
        screen: s,
        leaves: leavesOf(s.id),
      })),
    };
  }

  function sameCatalog(remote, desired) {
    const rows = (remote && remote.entries) || [];
    const activeRows = rows.filter(row => row.active === true);
    const map = new Map(rows.map(row => [row.screen_key, row]));
    return activeRows.length === desired.length && desired.every(entry => {
      const row = map.get(entry.screen_key);
      return row && row.active === true && row.parent_key === entry.parent_key &&
        row.is_leaf === entry.is_leaf;
    });
  }

  async function ensureCatalog(model) {
    let snapshot = await rpc('admin_screen_permission_catalog_snapshot');
    if (sameCatalog(snapshot, model.entries)) return snapshot;
    try {
      await rpc('admin_sync_screen_permission_catalog', {
        p_entries: model.entries,
        p_expected_version: snapshot.version,
      });
    } catch (error) {
      if (!/CATALOG_VERSION_CONFLICT/.test(error.message || '')) throw error;
    }
    snapshot = await rpc('admin_screen_permission_catalog_snapshot');
    if (!sameCatalog(snapshot, model.entries)) throw new Error('CATALOG_SYNC_INCOMPLETE');
    return snapshot;
  }

  function errorLabel(error) {
    const text = [error && error.code, error && error.message, error && error.details].filter(Boolean).join(' ');
    if (/PERMISSION_VERSION_CONFLICT/.test(text)) return { kind: 'conflict', text: 'Los permisos cambiaron en otra sesión. Recarga la versión remota antes de volver a guardar.' };
    if (/PERMISSION_ADMIN_UNAUTHORIZED|42501/.test(text)) return { kind: 'auth', text: 'Tu sesión no tiene autorización para administrar permisos.' };
    if (/TARGET_USER_NOT_FOUND/.test(text)) return { kind: 'missing', text: 'La cuenta seleccionada ya no existe.' };
    if (/TARGET_USER_INACTIVE/.test(text)) return { kind: 'inactive', text: 'La cuenta seleccionada está inactiva y no puede modificarse.' };
    if (/LAST_PERMISSION_ADMIN_REQUIRED|LAST_PERMISSION_ADMIN/.test(text)) return { kind: 'last-admin', text: 'Este cambio dejaría la plataforma sin un administrador capaz de gestionar usuarios y permisos.' };
    if (/NETWORK|Failed to fetch|fetch/i.test(text)) return { kind: 'network', text: 'No fue posible conectar con Supabase. El borrador se conserva para reintentar.' };
    return { kind: 'server', text: 'No fue posible guardar los permisos. El borrador se conserva.' };
  }

  function permissionReasonLabel(mode, permission) {
    if (mode === 'allow') return 'Permitido individualmente';
    if (mode === 'deny') return 'Denegado individualmente';
    if (permission && permission.role_configured) {
      return permission.role_allowed ? 'Permitido por rol' : 'Denegado por rol';
    }
    return 'Denegado por defecto';
  }

  function TriSwitch({ state, onClick, testId }) {
    const ref = useRef(null);
    useEffect(() => {
      if (ref.current) ref.current.indeterminate = state === 'mixed';
    }, [state]);
    return h('label', { className: 'inline-flex items-center gap-2 cursor-pointer select-none' }, [
      h('input', {
        key: 'input', ref, type: 'checkbox', checked: state === 'on',
        'data-testid': testId, onChange: onClick,
        className: 'w-5 h-5 accent-primary rounded',
      }),
      h('span', { key: 'label', className: 'text-caption text-on-surface-variant' },
        state === 'mixed' ? 'Parcial' : state === 'on' ? 'Permitido' : 'Denegado'),
    ]);
  }

  function Choice({ active, label, onClick, testId }) {
    return h('button', {
      type: 'button', onClick, 'data-testid': testId,
      className: 'px-2.5 py-1.5 rounded-md text-overline uppercase font-bold border transition ' +
        (active ? 'bg-primary text-on-primary border-primary' :
          'bg-surface text-on-surface-variant border-outline-variant hover:border-primary'),
    }, label);
  }

  function ConfirmSwitchModal({ user, busy, onSave, onDiscard, onCancel }) {
    return h('div', { className: 'fixed inset-0 z-50 bg-black/35 grid place-items-center p-4' },
      h(GlassCard, { className: 'w-full max-w-md p-6' }, [
        h(SerifHeading, { key: 'title', children: 'Cambios sin guardar' }),
        h('p', { key: 'body', className: 'mt-2 text-body text-on-surface-variant' },
          `Hay cambios pendientes. ¿Qué deseas hacer antes de abrir ${user.display_name}?`),
        h('div', { key: 'actions', className: 'mt-6 flex flex-wrap justify-end gap-2' }, [
          h('button', { key: 'cancel', onClick: onCancel, className: 'px-4 h-10 text-caption', disabled: busy }, 'Cancelar'),
          h('button', { key: 'discard', 'data-testid': 'discard-and-switch', onClick: onDiscard, className: 'px-4 h-10 border border-outline-variant rounded-lg text-caption', disabled: busy }, 'Descartar y cambiar'),
          h('button', { key: 'save', 'data-testid': 'save-and-switch', onClick: onSave, className: 'px-4 h-10 bg-primary text-on-primary rounded-lg text-caption', disabled: busy }, busy ? 'Guardando…' : 'Guardar y cambiar'),
        ]),
      ]));
  }

  function PermissionAdminScreen() {
    const model = useMemo(registryModel, []);
    const screenById = useMemo(() => new Map(model.screens.map(s => [s.id, s])), [model]);
    const [users, setUsers] = useState([]);
    const [hasMoreUsers, setHasMoreUsers] = useState(false);
    const [userSearch, setUserSearch] = useState('');
    const [screenSearch, setScreenSearch] = useState('');
    const [selected, setSelected] = useState(null);
    const [snapshot, setSnapshot] = useState(null);
    const [draft, setDraft] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [pendingUser, setPendingUser] = useState(null);
    const [reloadNonce, setReloadNonce] = useState(0);
    const dirty = Object.keys(draft).length > 0;

    async function loadUsers(search, append) {
      const offset = append ? users.length : 0;
      const rows = await rpc('admin_permission_users', {
        p_search: search || null, p_limit: PAGE_SIZE, p_offset: offset,
      });
      setUsers(previous => append ? previous.concat(rows || []) : (rows || []));
      setHasMoreUsers((rows || []).length === PAGE_SIZE);
      return rows || [];
    }

    async function loadSnapshot(user, keepDraft) {
      if (!user) return;
      setLoading(true);
      setError(null);
      try {
        const data = await rpc('admin_user_permission_editor_snapshot', {
          p_target_user_id: user.user_id,
          p_screen_keys: model.leaves,
        });
        setSnapshot(data);
        if (!keepDraft) setDraft({});
      } catch (e) {
        setError(errorLabel(e));
      } finally {
        setLoading(false);
      }
    }

    useEffect(() => {
      let live = true;
      (async () => {
        setLoading(true);
        try {
          await ensureCatalog(model);
          const rows = await loadUsers('', false);
          if (live && rows.length) setSelected(rows[0]);
        } catch (e) {
          if (live) setError(errorLabel(e));
        } finally {
          if (live) setLoading(false);
        }
      })();
      return () => { live = false; };
    }, [model]);

    useEffect(() => {
      if (selected) loadSnapshot(selected, reloadNonce > 0);
    }, [selected, reloadNonce]);

    useEffect(() => {
      const timer = setTimeout(() => {
        loadUsers(userSearch, false).catch(e => setError(errorLabel(e)));
      }, 250);
      return () => clearTimeout(timer);
    }, [userSearch]);

    if (!window.AUTH.canAccess('config.permisos')) {
      return h(GlassCard, { className: 'p-8' }, [
        h(SerifHeading, { key: 'title', children: 'Acceso restringido' }),
        h('p', { key: 'body', className: 'mt-2 text-body text-on-surface-variant' }, 'No tienes permiso para administrar la visualización de pantallas.'),
      ]);
    }

    const permissions = new Map(((snapshot && snapshot.permissions) || []).map(p => [p.screen_key, p]));
    const savedOverrides = (snapshot && snapshot.overrides) || {};
    function mode(key) {
      if (Object.prototype.hasOwnProperty.call(draft, key)) return draft[key] === null ? 'inherit' : draft[key];
      return savedOverrides[key] || 'inherit';
    }
    function allowed(key) {
      const value = mode(key);
      if (value === 'allow') return true;
      if (value === 'deny') return false;
      const permission = permissions.get(key);
      return !!(permission && permission.role_configured && permission.role_allowed);
    }
    function setMode(key, value) {
      const original = savedOverrides[key] || 'inherit';
      setDraft(previous => {
        const next = { ...previous };
        if (value === original) delete next[key];
        else next[key] = value === 'inherit' ? null : value;
        return next;
      });
    }
    function restoreInheritance() {
      const next = {};
      model.leaves.forEach(key => {
        if (savedOverrides[key]) next[key] = null;
      });
      setDraft(next);
    }
    function visibleLeaves(group) {
      const query = screenSearch.trim().toLocaleLowerCase('es');
      if (!query) return group.leaves;
      const groupMatch = group.screen.title.toLocaleLowerCase('es').includes(query);
      return group.leaves.filter(key => groupMatch ||
        (screenById.get(key) && screenById.get(key).title.toLocaleLowerCase('es').includes(query)));
    }
    function groupState(keys) {
      const values = keys.map(allowed);
      if (values.every(Boolean)) return 'on';
      if (values.every(value => !value)) return 'off';
      return 'mixed';
    }
    function toggleGroup(keys) {
      const effect = groupState(keys) === 'on' ? 'deny' : 'allow';
      keys.forEach(key => setMode(key, effect));
    }

    async function save() {
      if (!snapshot || !dirty || saving) return true;
      setSaving(true);
      setError(null);
      try {
        await rpc('admin_apply_user_screen_permissions_checked', {
          p_target_user_id: snapshot.user.id,
          p_role_code: snapshot.base_role,
          p_overrides: draft,
          p_expected_version: snapshot.permission_version,
          p_screen_keys: model.leaves,
        });
        const current = window.AUTH.current && window.AUTH.current();
        await loadSnapshot(selected, false);
        await loadUsers(userSearch, false);
        if (current && current.id === snapshot.user.id) await window.AUTH.refreshPermissions();
        window.UI.toast('Permisos guardados', 'var(--accent)');
        return true;
      } catch (e) {
        setError(errorLabel(e));
        return false;
      } finally {
        setSaving(false);
      }
    }

    function requestUser(user) {
      if (selected && selected.user_id === user.user_id) return;
      if (dirty) setPendingUser(user);
      else setSelected(user);
    }
    async function saveAndSwitch() {
      if (await save()) {
        setSelected(pendingUser);
        setPendingUser(null);
      }
    }
    function discardAndSwitch() {
      setDraft({});
      setSelected(pendingUser);
      setPendingUser(null);
    }

    const groups = model.groups.map(group => ({ ...group, visible: visibleLeaves(group) }))
      .filter(group => group.visible.length);

    return h('div', { className: 'min-w-0' }, [
      h('div', { key: 'head', className: 'mb-5 flex flex-wrap items-end justify-between gap-3' }, [
        h('div', { key: 'copy' }, [
          h(SerifHeading, { key: 'title', children: 'Permisos de visualización' }),
          h('p', { key: 'hint', className: 'mt-1 text-caption text-on-surface-variant' }, 'Los módulos se derivan de sus pantallas. Cada cambio se guarda por usuario.'),
        ]),
        dirty && h('span', { key: 'dirty', className: 'px-3 py-1.5 rounded-full bg-gold-soft text-gold-text text-overline font-bold uppercase' }, `${Object.keys(draft).length} cambios pendientes`),
      ]),
      error && h('div', { key: 'error', className: 'mb-4 p-3 rounded-lg bg-danger-soft text-danger text-caption flex items-center justify-between gap-3' }, [
        h('span', { key: 'text' }, error.text),
        error.kind === 'conflict' && h('button', { key: 'reload', onClick: () => setReloadNonce(n => n + 1), className: 'font-bold underline' }, 'Recargar versión remota'),
      ]),
      h('div', { key: 'layout', className: 'grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-5 min-w-0' }, [
        h(GlassCard, { key: 'users', className: 'p-3 h-fit lg:sticky lg:top-6 min-w-0' }, [
          h('label', { key: 'label', className: 'block text-overline uppercase font-bold text-on-surface-variant mb-2' }, 'Usuarios con acceso'),
          h('input', {
            key: 'search', value: userSearch, onChange: e => setUserSearch(e.target.value),
            placeholder: 'Buscar nombre o correo', 'data-testid': 'permission-user-search',
            className: 'w-full h-10 px-3 rounded-lg bg-surface-container-low border border-outline-variant text-caption',
          }),
          h('div', { key: 'list', className: 'mt-2 max-h-72 lg:max-h-[65vh] overflow-y-auto space-y-1' }, [
            ...users.map(user => h('button', {
              key: user.user_id, onClick: () => requestUser(user),
              'data-testid': `permission-user-${user.user_id}`,
              className: 'w-full p-3 rounded-lg text-left ' +
                (selected && selected.user_id === user.user_id ? 'bg-primary/10 text-primary' : 'hover:bg-surface-container-low'),
            }, [
              h('div', { key: 'name', className: 'font-medium text-body truncate' }, user.display_name),
              h('div', { key: 'email', className: 'text-caption text-on-surface-variant truncate' }, user.email),
              h('div', { key: 'meta', className: 'mt-1 flex flex-wrap gap-1 text-overline uppercase' }, [
                h('span', { key: 'status' }, user.profile_status === 'active' ? 'Activo' : 'Inactivo'),
                h('span', { key: 'role' }, `· ${user.role_code || 'Sin rol'}`),
                user.has_overrides && h('span', { key: 'overrides' }, '· Personalizado'),
              ]),
              h('div', { key: 'modified', className: 'text-overline text-on-surface-variant/70 truncate' },
                user.last_modified_at ? `Actualizado ${new Date(user.last_modified_at).toLocaleDateString('es-MX')}` : 'Sin cambios'),
            ])),
            hasMoreUsers && h('button', {
              key: 'more', onClick: () => loadUsers(userSearch, true).catch(e => setError(errorLabel(e))),
              'data-testid': 'permission-users-more',
              className: 'w-full h-10 rounded-lg border border-outline-variant text-caption hover:border-primary',
            }, 'Cargar más usuarios'),
          ]),
        ]),
        h('div', { key: 'editor', className: 'min-w-0 space-y-4' },
          !selected ? h(GlassCard, { className: 'p-8 text-center text-on-surface-variant' }, 'No hay usuarios disponibles.')
            : loading || !snapshot ? h(GlassCard, { className: 'p-8 text-center text-on-surface-variant' }, 'Cargando permisos…')
            : [
                h(GlassCard, { key: 'summary', className: 'p-4 flex flex-wrap items-center justify-between gap-3' }, [
                  h('div', { key: 'identity', className: 'min-w-0' }, [
                    h('div', { key: 'name', className: 'font-headline text-h2 text-primary truncate' }, snapshot.user.name),
                    h('div', { key: 'meta', className: 'text-caption text-on-surface-variant' }, `${snapshot.user.email} · Rol base: ${snapshot.base_role || 'Sin rol'}`),
                  ]),
                  h('button', { key: 'restore', onClick: restoreInheritance, disabled: !Object.keys(savedOverrides).length, className: 'px-3 h-10 rounded-lg border border-outline-variant text-caption disabled:opacity-40' }, 'Restaurar toda la herencia'),
                ]),
                h('input', {
                  key: 'screen-search', value: screenSearch, onChange: e => setScreenSearch(e.target.value),
                  placeholder: 'Buscar pantalla o módulo', 'data-testid': 'permission-screen-search',
                  className: 'w-full h-11 px-3 rounded-lg bg-surface border border-outline-variant text-body',
                }),
                ...groups.map(group => h(GlassCard, { key: group.screen.id, className: 'p-4 min-w-0' }, [
                  h('div', { key: 'head', className: 'flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-outline-variant' }, [
                    h('div', { key: 'title', className: 'flex items-center gap-2' }, [
                      h(MS, { key: 'icon', name: group.screen.icon, size: 18 }),
                      h('span', { key: 'text', className: 'font-headline text-h2 text-primary' }, group.screen.title),
                    ]),
                    h(TriSwitch, { key: 'switch', state: groupState(group.visible), onClick: () => toggleGroup(group.visible), testId: `permission-group-${group.screen.id}` }),
                  ]),
                  h('div', { key: 'leaves', className: 'divide-y divide-outline-variant/60' },
                    group.visible.map(key => {
                      const screen = screenById.get(key);
                      const currentMode = mode(key);
                      const permission = permissions.get(key);
                      return h('div', { key, className: 'py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3' }, [
                        h('div', { key: 'copy', className: 'min-w-0' }, [
                          h('div', { key: 'title', className: 'text-body font-medium' }, screen ? screen.title : key),
                          h('div', { key: 'reason', className: 'text-caption text-on-surface-variant' }, permissionReasonLabel(currentMode, permission)),
                        ]),
                        h('div', { key: 'choices', className: 'flex flex-wrap gap-1.5 shrink-0' }, [
                          h(Choice, { key: 'inherit', label: 'Heredar', active: currentMode === 'inherit', onClick: () => setMode(key, 'inherit'), testId: `permission-${key}-inherit` }),
                          h(Choice, { key: 'allow', label: 'Permitir', active: currentMode === 'allow', onClick: () => setMode(key, 'allow'), testId: `permission-${key}-allow` }),
                          h(Choice, { key: 'deny', label: 'Denegar', active: currentMode === 'deny', onClick: () => setMode(key, 'deny'), testId: `permission-${key}-deny` }),
                        ]),
                      ]);
                    })),
                ])),
                h('div', { key: 'actions', className: 'sticky bottom-3 flex justify-end gap-3 p-3 rounded-xl bg-surface/95 shadow-e2 border border-outline-variant' }, [
                  h('button', { key: 'discard', disabled: !dirty || saving, onClick: () => setDraft({}), className: 'px-5 h-11 text-caption disabled:opacity-40' }, 'Descartar'),
                  h('button', { key: 'save', 'data-testid': 'permission-save', disabled: !dirty || saving, onClick: save, className: 'px-6 h-11 rounded-lg bg-primary text-on-primary text-caption font-bold disabled:opacity-40' }, saving ? 'Guardando…' : 'Guardar cambios'),
                ]),
              ]),
      ]),
      pendingUser && h(ConfirmSwitchModal, {
        key: 'modal', user: pendingUser, busy: saving,
        onSave: saveAndSwitch, onDiscard: discardAndSwitch,
        onCancel: () => setPendingUser(null),
      }),
    ]);
  }

  window.PermissionAdminScreen = PermissionAdminScreen;
})();
