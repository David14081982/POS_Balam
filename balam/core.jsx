// core.jsx — Contratos básicos compartidos por módulos globales.
// Carga antes de CONFIG/DATA/STORE y no depende de ninguno de ellos.
(function () {
  const DEVICE_KEY = 'balam_device_id';
  let deviceId = null;

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

  window.CORE = { getDeviceId };
})();
