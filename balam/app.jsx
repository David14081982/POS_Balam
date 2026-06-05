// app.jsx — Shell principal (Heritage): sidebar, topbar, router. Exporta window.App
(function () {
  const { useState, useEffect } = React;
  const D = window.DATA;
  const { useTweaks } = window;
  const { MS } = window.HX;
  const h = React.createElement;

  const NAV = [
    { id: 'dashboard', label: 'Panel de control', icon: 'dashboard' },
    { id: 'pos', label: 'Punto de venta', icon: 'pos' },
    { id: 'inventario', label: 'Inventario', icon: 'box', liveBadge: true },
    { id: 'clientes', label: 'Clientes', icon: 'users' },
    { id: 'devoluciones', label: 'Devoluciones', icon: 'undo' },
    { id: 'descuentos', label: 'Descuentos', icon: 'sell', admin: true },
    { id: 'vendedores', label: 'Vendedores', icon: 'badge', admin: true },
    { id: 'reportes', label: 'Reportes', icon: 'chart', admin: true },
    { id: 'config', label: 'Configuración', icon: 'gear', admin: true },
  ];
  const ADMIN_PAGES = { descuentos: 1, vendedores: 1, reportes: 1, config: 1 };
  // Exigir login SOLO en dominio real (https). En local (file:// o localhost) la app
  // abre directo para desarrollo; la seguridad real de datos la da RLS en el servidor.
  const REQUIRE_AUTH = (() => {
    try {
      const hn = location.hostname;
      const dev = location.protocol === 'file:' || hn === 'localhost' || hn === '127.0.0.1' || hn === '';
      return !dev;
    } catch (e) { return false; }
  })();
  const TITLES = {
    dashboard: 'Panel de control', pos: 'Punto de venta', inventario: 'Inventario',
    clientes: 'Clientes', devoluciones: 'Devoluciones', descuentos: 'Promociones y descuentos', vendedores: 'Vendedores y comisiones', reportes: 'Reportes', config: 'Configuración',
  };

  // Solo tweaks que siguen vigentes con Heritage (layout de POS)
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "ticketPos": "right",
    "catalogView": "grid"
  }/*EDITMODE-END*/;

  function App() {
    const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
    const [page, setPage] = useState(() => localStorage.getItem('balam-page') || 'dashboard');
    useEffect(() => { localStorage.setItem('balam-page', page); }, [page]);
    // Auth real (Supabase) + nube. Solo una sesión autenticada sincroniza pos.* (RLS).
    const [, bumpCfg] = useState(0);
    useEffect(() => {
      const onCfg = () => bumpCfg(v => v + 1);
      const onAuth = () => {
        bumpCfg(v => v + 1);
        // Al iniciar sesión, jala config + dominio de la nube (una sola vez).
        if (window.AUTH.hasSession() && window.STORE && !window.STORE.enabled) window.STORE.init({ pull: true });
      };
      window.addEventListener('configchange', onCfg);
      window.addEventListener('authchange', onAuth);
      if (window.AUTH.init) window.AUTH.init(); // carga sesión persistida → dispara authchange
      // En dev (sin gate de login) sincroniza la nube aunque no haya sesión (anon), como antes.
      if (!REQUIRE_AUTH && window.STORE && !window.STORE.enabled) window.STORE.init({ pull: true });
      return () => { window.removeEventListener('configchange', onCfg); window.removeEventListener('authchange', onAuth); };
    }, []);

    const admin = window.AUTH.current();
    const isAdmin = !!admin;
    function go(id) { setPage(id); }

    // Gate de seguridad SOLO en dominio real: sin sesión no se muestra la app (RLS protege).
    if (REQUIRE_AUTH) {
      if (window.AUTH.isReady && !window.AUTH.isReady()) {
        return h('div', { className: 'h-full grid place-items-center', style: { background: '#131B2E' } },
          h('div', { className: 'text-sm', style: { color: '#5D637B' } }, 'Cargando…'));
      }
      if (!window.AUTH.hasSession()) return h(LoginScreen, { key: 'login' });
    }

    return h('div', { className: 'flex h-full bg-background font-body text-on-surface' }, [
      // ---------- Sidebar ----------
      h('aside', { key: 'sb', className: 'w-64 shrink-0 flex flex-col py-4', style: { background: '#131B2E' } }, [
        h('div', { key: 'br', className: 'px-6 mb-8 mt-2 flex items-center gap-3' }, [
          h('div', { key: 'm', className: 'w-9 h-9 rounded-lg grid place-items-center shrink-0 overflow-hidden', style: { background: '#1C2437', color: '#FFE088' } },
            window.CONFIG.get('store.logo') ? h('img', { src: window.CONFIG.get('store.logo'), className: 'w-full h-full object-cover' }) : h(JaguarMark, { size: 22 })),
          h('div', { key: 'n' }, [
            h('div', { key: 'a', className: 'font-headline text-[18px] text-white leading-none' }, 'Balam'),
            h('div', { key: 'b', className: 'text-[10px] uppercase tracking-widest mt-1', style: { color: '#5D637B' } }, 'Artisanal Heritage'),
          ]),
        ]),
        h('nav', { key: 'nav', className: 'flex-1 px-3 flex flex-col gap-1' },
          NAV.map(n => {
            const active = page === n.id;
            const badge = n.liveBadge ? String(D.products.length) : n.badge;
            const locked = n.admin && !isAdmin && REQUIRE_AUTH;
            return h('button', {
              key: n.id,
              className: 'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors text-left ' + (active ? 'font-semibold' : ''),
              style: active ? { background: '#1C2437', color: '#FFE088' } : { color: '#5D637B' },
              onMouseEnter: e => { if (!active) e.currentTarget.style.background = '#1C2437'; },
              onMouseLeave: e => { if (!active) e.currentTarget.style.background = 'transparent'; },
              onClick: () => go(n.id),
              title: locked ? 'Requiere iniciar sesión como administrador' : n.label,
            }, [
              h(MS, { key: 'i', name: n.icon, size: 20, fill: active }),
              h('span', { key: 'l', className: 'flex-1 text-sm' }, n.label),
              locked && h(MS, { key: 'lk', name: 'lock', size: 14, style: { color: '#5D637B' } }),
              !locked && badge && h('span', { key: 'b', className: 'px-1.5 py-0.5 text-[10px] font-bold rounded', style: { background: '#131B2E', color: active ? '#FFE088' : '#5D637B' } }, badge),
            ]);
          })),
        h('div', { key: 'cta', className: 'px-3 mt-2' },
          h('button', {
            className: 'w-full flex items-center justify-center gap-2 py-3 font-label-sm uppercase tracking-widest text-xs rounded-lg active:scale-95 transition-all hover:opacity-90',
            style: { background: '#FFE088', color: '#131B2E' },
            onClick: () => setPage('pos'),
          }, [h(MS, { key: 'i', name: 'add', size: 18 }), 'Nueva venta'])),
        h('div', { key: 'foot', className: 'px-3 mt-4 pt-4', style: { borderTop: '1px solid #1C2437' } },
          h('button', {
            className: 'w-full flex items-center gap-3 px-2 py-1.5 rounded-lg transition-colors',
            onMouseEnter: e => { e.currentTarget.style.background = '#1C2437'; },
            onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; },
            onClick: () => { if (isAdmin) window.AUTH.logout(); },
            title: isAdmin ? 'Cerrar sesión' : 'Modo local',
          }, [
            h('div', { key: 'a', className: 'w-9 h-9 rounded-full grid place-items-center text-xs font-bold', style: { background: isAdmin ? '#FFE088' : '#1C2437', color: isAdmin ? '#131B2E' : '#5D637B' } },
              isAdmin ? (admin.iniciales || 'JB') : h(MS, { name: 'user', size: 18 })),
            h('div', { key: 'm', className: 'flex-1 text-left min-w-0' }, [
              h('div', { key: 'n', className: 'text-sm font-medium text-white truncate' }, isAdmin ? admin.nombre : 'Modo local'),
              h('div', { key: 'r', className: 'text-[10px] uppercase tracking-widest', style: { color: '#5D637B' } }, isAdmin ? 'Administrador' : 'Sin candado'),
            ]),
            h(MS, { key: 'i', name: isAdmin ? 'logout' : 'arrowUpRight', size: 18, style: { color: '#5D637B' } }),
          ])),
      ]),
      // ---------- Contenido ----------
      h('main', { key: 'ct', className: 'flex-1 flex flex-col min-w-0' }, [
        // Topbar
        h('header', { key: 'tb', className: 'h-16 shrink-0 flex items-center gap-4 px-6 bg-surface/80 backdrop-blur-md border-b border-outline-variant' }, [
          h('h1', { key: 't', className: 'font-headline text-headline-md text-primary' }, TITLES[page]),
          h('div', { key: 's', className: 'flex-1' }),
          page !== 'pos' && h('button', {
            key: 'pos', className: 'inline-flex items-center gap-2 px-4 h-10 bg-secondary-container text-on-secondary-container font-label-sm uppercase tracking-widest text-xs rounded-lg hover:opacity-90 transition',
            onClick: () => setPage('pos'),
          }, [h(MS, { key: 'i', name: 'pos', size: 18 }), 'Nueva venta']),
          h('button', { key: 'b', className: 'w-10 h-10 grid place-items-center text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors', title: 'Notificaciones' }, h(MS, { name: 'bell', size: 20 })),
          h('div', { key: 'date', className: 'flex items-center gap-1.5 text-xs text-on-surface-variant capitalize' }, [h(MS, { key: 'i', name: 'calendar', size: 16 }), new Date().toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })]),
        ]),
        // Pantalla
        page === 'dashboard' ? h(window.DashboardScreen, { key: 'dash', onNav: go })
          : page === 'pos' ? h(window.POSScreen, { key: 'pos', layout: t.ticketPos, catalogView: t.catalogView, onNav: go })
          : page === 'inventario' ? h(window.InventoryScreen, { key: 'inv' })
          : page === 'clientes' ? h(window.ClientsScreen, { key: 'cli' })
          : page === 'devoluciones' ? h(window.ReturnsScreen, { key: 'dev', onNav: go })
          : page === 'descuentos' ? h(window.DiscountsScreen, { key: 'desc' })
          : page === 'vendedores' ? h(window.SellersScreen, { key: 'ven' })
          : page === 'reportes' ? h(window.ReportsScreen, { key: 'rep' })
          : h(window.SettingsScreen, { key: 'cfg' }),
      ]),
      // Toasts
      h(window.UI.ToastHost, { key: 'toast' }),
    ]);
  }

  // ---------- Login de la terminal (Supabase Auth, pantalla completa) ----------
  function LoginScreen() {
    const { toast } = window.UI;
    const [email, setEmail] = useState('');
    const [pass, setPass] = useState('');
    const [busy, setBusy] = useState(false);
    const logo = window.CONFIG.get('store.logo');
    const nombre = window.CONFIG.get('store.name') || 'Balam Guayaberas';

    const input = 'w-full border-0 border-b py-3 text-body bg-transparent focus:ring-0 px-0 transition-all';
    const lbl = 'block text-overline uppercase font-bold tracking-widest mb-1';

    async function submit() {
      if (busy) return;
      if (!email.trim() || !pass) { toast('Escribe correo y contraseña', 'var(--danger)'); return; }
      setBusy(true);
      try {
        const r = await window.AUTH.login(email, pass);
        if (r.ok) { toast('Sesión iniciada', 'var(--accent)'); return; }
        toast(r.error || 'No se pudo iniciar sesión', 'var(--danger)');
      } finally { setBusy(false); }
    }

    return h('div', { className: 'h-full w-full grid place-items-center p-6', style: { background: '#131B2E' } },
      h('div', { className: 'w-full max-w-sm rounded-2xl p-8 shadow-2xl', style: { background: '#0E1424' } }, [
        h('div', { key: 'br', className: 'flex flex-col items-center mb-8' }, [
          h('div', { key: 'm', className: 'w-16 h-16 rounded-2xl grid place-items-center overflow-hidden mb-4', style: { background: '#1C2437', color: '#FFE088' } },
            logo ? h('img', { src: logo, className: 'w-full h-full object-cover' }) : h(JaguarMark, { size: 34 })),
          h('h1', { key: 't', className: 'font-headline', style: { fontSize: '30px', letterSpacing: '0.12em', color: '#fff' } }, 'BALAM'),
          h('p', { key: 's', className: 'text-overline uppercase tracking-widest mt-1', style: { color: '#5D637B' } }, nombre),
        ]),
        h('div', { key: 'em', className: 'mb-5' }, [
          h('label', { key: 'l', className: lbl, style: { color: '#5D637B' } }, 'Correo'),
          h('input', { key: 'i', className: input, style: { color: '#fff', borderColor: '#2A3350' }, type: 'email', value: email, onChange: e => setEmail(e.target.value), placeholder: 'admin@balam.com', autoFocus: true, onKeyDown: e => { if (e.key === 'Enter') submit(); } }),
        ]),
        h('div', { key: 'pw', className: 'mb-7' }, [
          h('label', { key: 'l', className: lbl, style: { color: '#5D637B' } }, 'Contraseña'),
          h('input', { key: 'i', className: input, style: { color: '#fff', borderColor: '#2A3350' }, type: 'password', value: pass, onChange: e => setPass(e.target.value), placeholder: '••••••••', onKeyDown: e => { if (e.key === 'Enter') submit(); } }),
        ]),
        h('button', {
          key: 'go', className: 'w-full h-12 rounded-lg font-label-sm uppercase tracking-widest text-xs flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50',
          style: { background: '#FFE088', color: '#131B2E' }, onClick: submit, disabled: busy,
        }, [h(MS, { key: 'i', name: 'check', size: 18 }), busy ? 'Entrando…' : 'Iniciar sesión']),
        h('p', { key: 'note', className: 'text-center mt-6 text-[11px]', style: { color: '#5D637B' } }, 'Acceso exclusivo del administrador de la tienda.'),
      ]));
  }

  // Marca jaguar (Balam = jaguar en maya)
  function JaguarMark({ size = 22 }) {
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' }, [
      h('path', { key: 'a', d: 'M5 8c0-1 .6-2.4 1.4-2 .8.4 1 1.6 1 2.4M18 8c0-1-.6-2.4-1.4-2-.8.4-1 1.6-1 2.4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
      h('path', { key: 'b', d: 'M12 5.5c3.6 0 6 2.6 6 6 0 3.2-2.7 7-6 7s-6-3.8-6-7c0-3.4 2.4-6 6-6z', stroke: 'currentColor', strokeWidth: 1.6 }),
      h('circle', { key: 'e1', cx: 9.6, cy: 11, r: 1, fill: 'currentColor' }),
      h('circle', { key: 'e2', cx: 14.4, cy: 11, r: 1, fill: 'currentColor' }),
      h('path', { key: 'n', d: 'M12 13.2l-1.1 1.2c-.1.5.5.9 1.1.9s1.2-.4 1.1-.9L12 13.2z', fill: 'currentColor' }),
      h('path', { key: 'w', d: 'M12 15.3v1.4M9 15l-2 .6M15 15l2 .6', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
    ]);
  }

  window.App = App;
})();
