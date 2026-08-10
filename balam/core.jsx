// core.jsx — Contratos básicos compartidos por módulos globales.
// Carga antes de CONFIG/DATA/STORE y no depende de ninguno de ellos.
(function () {
  const DEVICE_KEY = 'balam_device_id';
  let deviceId = null;
  let catalogProductsAdapter = null;
  let catalogPromotionsAdapter = null;
  let monetaryDocumentsAdapter = null;
  let syncGateway = null;
  const syncActivities = new Map();
  let syncActivitySeq = 0;

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
  function registerMonetaryDocuments(adapter) {
    if (!adapter || typeof adapter.referencesMethod !== 'function') throw new Error('Adaptador monetario inválido');
    monetaryDocumentsAdapter = adapter;
  }
  function monetaryMethodInUse(code) {
    return !!(monetaryDocumentsAdapter && monetaryDocumentsAdapter.referencesMethod(code));
  }
  function registerSyncGateway(adapter) {
    if (!adapter || typeof adapter !== 'object') throw new Error('Gateway de sincronización inválido');
    syncGateway = adapter;
  }
  function invokeSync(method, ...args) {
    const fn = syncGateway && syncGateway[method];
    return typeof fn === 'function' ? fn.apply(syncGateway, args) : undefined;
  }
  function beginActivity(domains, detail) {
    const list = (Array.isArray(domains) ? domains : [domains]).filter(Boolean);
    const token = 'sync-activity-' + (++syncActivitySeq);
    syncActivities.set(token, { domains: list, detail: detail || null });
    try { window.dispatchEvent(new CustomEvent('syncactivitychange', { detail: activityStatus() })); } catch (e) { /* SSR */ }
    return token;
  }
  function endActivity(token) {
    const changed = syncActivities.delete(token);
    if (changed) {
      try { window.dispatchEvent(new CustomEvent('syncactivitychange', { detail: activityStatus() })); } catch (e) { /* SSR */ }
    }
    return changed;
  }
  function domainBusy(domain) {
    for (const activity of syncActivities.values()) {
      if (activity.domains.includes('*') || activity.domains.includes(domain)) return true;
    }
    return false;
  }
  function activityStatus() {
    const domains = {};
    for (const activity of syncActivities.values()) {
      activity.domains.forEach(domain => { domains[domain] = (domains[domain] || 0) + 1; });
    }
    return { active: syncActivities.size, domains };
  }

  window.CORE = {
    getDeviceId,
    registerCatalogProducts,
    catalogProducts,
    saveCatalogProducts,
    registerCatalogPromotions,
    catalogPromotions,
    registerMonetaryDocuments,
    monetaryMethodInUse,
    registerSyncGateway,
    invokeSync,
    beginActivity,
    endActivity,
    domainBusy,
    activityStatus,
  };
})();
