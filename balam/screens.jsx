// screens.jsx — Registro central de pantallas, navegación y secciones.
// Los permisos efectivos se incorporarán en fases posteriores de H-56.
(function () {
  const definitions = [
    { id: 'dashboard', title: 'Panel de control', menuLabel: 'Panel de control', icon: 'dashboard', menu: true, component: () => window.DashboardScreen, props: ({ go }) => ({ onNav: go }) },
    { id: 'pos', title: 'Punto de venta', menuLabel: 'Punto de venta', icon: 'pos', menu: true, component: () => window.POSScreen, props: ({ go, tweaks }) => ({ layout: tweaks.ticketPos, catalogView: tweaks.catalogView, onNav: go }) },
    { id: 'inventario', title: 'Inventario', menuLabel: 'Inventario', icon: 'box', menu: true, liveBadge: true, component: () => window.InventoryScreen },
    { id: 'clientes', title: 'Clientes', menuLabel: 'Clientes', icon: 'users', menu: true, component: () => window.ClientsScreen },
    { id: 'apartados', title: 'Apartados', menuLabel: 'Apartados', icon: 'clock', menu: true, component: () => window.LayawayScreen },
    { id: 'prestamos', title: 'Préstamos', menuLabel: 'Préstamos', icon: 'loan', menu: true, component: () => window.LoansScreen },
    { id: 'devoluciones', title: 'Devoluciones', menuLabel: 'Devoluciones', icon: 'undo', menu: true, component: () => window.ReturnsScreen, props: ({ go }) => ({ onNav: go }) },
    { id: 'descuentos', title: 'Promociones y descuentos', menuLabel: 'Descuentos', icon: 'sell', menu: true, component: () => window.DiscountsScreen },
    { id: 'vendedores', title: 'Vendedores y comisiones', menuLabel: 'Vendedores', icon: 'badge', menu: true, component: () => window.SellersScreen },
    { id: 'reportes', title: 'Reportes', menuLabel: 'Reportes', icon: 'chart', menu: true, component: () => window.ReportsScreen, props: ({ go }) => ({ onNav: go }) },
    { id: 'config', title: 'Configuración', menuLabel: 'Configuración', icon: 'gear', menu: true, component: () => window.SettingsScreen },

    { id: 'config.negocio', parentId: 'config', section: 'negocio', title: 'Negocio', icon: 'gear' },
    { id: 'config.producto', parentId: 'config', section: 'producto', title: 'Catálogos de producto', icon: 'box' },
    { id: 'config.ventas', parentId: 'config', section: 'ventas', title: 'Ventas y POS', icon: 'pos' },
    { id: 'config.beneficios', parentId: 'config', section: 'beneficios', title: 'Descuentos adicionales y beneficios', icon: 'tag' },
    { id: 'config.devoluciones', parentId: 'config', section: 'devoluciones', title: 'Devoluciones', icon: 'undo' },
    { id: 'config.vendedores', parentId: 'config', section: 'vendedores', title: 'Vendedores', icon: 'badge' },
    { id: 'config.clientes', parentId: 'config', section: 'clientes', title: 'Clientes', icon: 'users' },
    { id: 'config.inventario', parentId: 'config', section: 'inventario', title: 'Inventario', icon: 'box' },
    { id: 'config.impresion', parentId: 'config', section: 'impresion', title: 'Impresión', icon: 'print' },
    { id: 'config.usuarios', parentId: 'config', section: 'usuarios', title: 'Usuarios', icon: 'users' },
    // Reservada para H-56 Fase 4. Su identidad ya existe para que el servidor
    // pueda protegerla, pero no aparece ni monta UI antes de esa fase.
    { id: 'config.permisos', parentId: 'config', section: 'permisos', title: 'Permisos de visualización', icon: 'shield' },
    // Se conserva `config.demo` como identidad de permiso histórica; su concepto
    // visible evoluciona en H-98 a la administración segura de datos.
    { id: 'config.demo', parentId: 'config', section: 'demo', title: 'Administración / Datos', icon: 'shield' },
  ];

  const ids = new Set();
  definitions.forEach(screen => {
    if (!screen.id || ids.has(screen.id)) throw new Error(`Pantalla duplicada o sin id: ${screen.id || '—'}`);
    ids.add(screen.id);
  });
  definitions.forEach(screen => {
    if (screen.parentId && !ids.has(screen.parentId)) {
      throw new Error(`Padre inexistente para ${screen.id}: ${screen.parentId}`);
    }
    Object.freeze(screen);
  });
  Object.freeze(definitions);

  const byId = new Map(definitions.map(screen => [screen.id, screen]));
  window.SCREENS = Object.freeze({
    version: () => 'h56-screen-registry-v2',
    all: () => definitions.slice(),
    get: id => byId.get(id) || null,
    navigation: () => definitions.filter(screen => screen.menu === true && !screen.parentId),
    childrenOf: parentId => definitions.filter(screen => screen.parentId === parentId && screen.enabled !== false),
  });
})();
