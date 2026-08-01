// core.jsx — Contratos básicos compartidos por módulos globales.
// Carga antes de CONFIG/DATA/STORE y no depende de ninguno de ellos.
(function () {
  const DEVICE_KEY = 'balam_device_id';
  let deviceId = null;
  let catalogProductsAdapter = null;
  let catalogPromotionsAdapter = null;
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
  // H-63: las promociones referencian tallas por valor dentro de scope.tallas, así que
  // una guarda de catálogo necesita leerlas. Va por el mismo gateway que los productos
  // para conservar la dirección DATA → CONFIG (R-CLI-05): DATA registra, CONFIG consulta.
  function registerCatalogPromotions(adapter) {
    if (!adapter || typeof adapter.list !== 'function') {
      throw new Error('Adaptador de promociones inválido');
    }
    catalogPromotionsAdapter = adapter;
  }
  function catalogPromotions() {
    if (!catalogPromotionsAdapter) return [];
    const promotions = catalogPromotionsAdapter.list();
    return Array.isArray(promotions) ? promotions : [];
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
    registerCatalogPromotions,
    catalogPromotions,
    registerSyncGateway,
    invokeSync,
  };
})();
