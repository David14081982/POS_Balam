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
      let stored = localStorage.getItem(DEVICE_KEY);
      if (!stored) {
        stored = 'dev-' + crypto.randomUUID();
        localStorage.setItem(DEVICE_KEY, stored);
        if (localStorage.getItem(DEVICE_KEY) !== stored) throw new Error('DEVICE_ID_NOT_STORED');
      }
      deviceId = stored;
    } catch (e) {
      throw Object.assign(new Error('Permite el almacenamiento de este sitio para identificar el equipo y confirmar sus operaciones.'),
        { code: 'DEVICE_IDENTITY_UNAVAILABLE' });
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
  function saveCatalogProducts(productIds) {
    if (!catalogProductsAdapter) throw new Error('Sin conexión. BALAM necesita internet para continuar.');
    return catalogProductsAdapter.save(productIds);
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
    if (typeof fn !== 'function') throw new Error('Sin conexión. BALAM necesita internet para continuar.');
    return fn.apply(syncGateway, args);
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
