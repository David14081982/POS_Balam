// core.jsx — Contratos básicos compartidos por módulos globales.
// Carga antes de CONFIG/DATA/STORE y no depende de ninguno de ellos.
(function () {
  const DEVICE_KEY = 'balam_device_id';
  let deviceId = null;
  let catalogProductsAdapter = null;
  let syncGateway = null;

  function getDeviceId() {
    if (deviceId) return deviceId;
    try {
      deviceId = localStorage.getItem(DEVICE_KEY);
      if (!deviceId) {
        deviceId = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(DEVICE_KEY, deviceId);
      }
    } catch (e) {
      deviceId = 'dev-volatile-' + Math.random().toString(36).slice(2, 10);
    }
    return deviceId;
  }

  function registerCatalogProducts(adapter) {
    if (!adapter || typeof adapter.list !== 'function' || typeof adapter.save !== 'function') {
      throw new Error('Adaptador de productos inválido');
    }
    catalogProductsAdapter = adapter;
  }
  function catalogProducts() {
    if (!catalogProductsAdapter) return [];
    const products = catalogProductsAdapter.list();
    return Array.isArray(products) ? products : [];
  }
  function saveCatalogProducts() {
    if (catalogProductsAdapter) catalogProductsAdapter.save();
  }
  function registerSyncGateway(adapter) {
    if (!adapter || typeof adapter !== 'object') throw new Error('Gateway de sincronización inválido');
    syncGateway = adapter;
  }
  function invokeSync(method, ...args) {
    const fn = syncGateway && syncGateway[method];
    return typeof fn === 'function' ? fn.apply(syncGateway, args) : undefined;
  }

  window.CORE = {
    getDeviceId,
    registerCatalogProducts,
    catalogProducts,
    saveCatalogProducts,
    registerSyncGateway,
    invokeSync,
  };
})();
