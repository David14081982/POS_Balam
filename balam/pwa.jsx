(function () {
  const h = React.createElement;
  const { useEffect, useState } = React;
  const BRAND_CACHE = 'balam-pwa-brand-v1';
  const META_KEY = 'balam_pwa_brand_v1';
  const NAVY = '#131b2e';
  const listeners = new Set();
  const mediaStandalone = window.matchMedia ? window.matchMedia('(display-mode: standalone)') : null;
  let installPrompt = null;
  let registration = null;
  let generation = 0;
  let reloading = false;
  let state = {
    supported: false,
    ready: false,
    standalone: !!((mediaStandalone && mediaStandalone.matches) || navigator.standalone),
    canInstall: false,
    installKind: null,
    updateAvailable: false,
    iconSource: 'fallback',
    iconQuality: 'fallback',
    sourceSize: null,
    manifestUrl: '',
    lastInstallOutcome: null,
    error: '',
  };

  function publish(patch) {
    state = { ...state, ...patch };
    listeners.forEach(listener => listener(state));
    try { window.dispatchEvent(new CustomEvent('pwastatechange', { detail: state })); } catch (error) { /* SSR */ }
  }

  function useSnapshot() {
    const [snapshot, setSnapshot] = useState(state);
    useEffect(() => {
      listeners.add(setSnapshot);
      return () => listeners.delete(setSnapshot);
    }, []);
    return snapshot;
  }

  function platformInstallKind() {
    const ua = navigator.userAgent || '';
    const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) return 'ios';
    const safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
    if (safari && /Mac/.test(navigator.platform || ua)) return 'mac-safari';
    return null;
  }

  function scopeUrl() {
    return new URL('./', location.href);
  }

  function setLink(rel, href, sizes) {
    let link = document.querySelector(`link[rel="${rel}"]`);
    if (!link) {
      link = document.createElement('link');
      link.rel = rel;
      document.head.appendChild(link);
    }
    if (sizes) link.sizes = sizes;
    link.href = href;
  }

  function exposeInstallWhenReady() {
    if (installPrompt && !state.standalone) publish({ canInstall: true, installKind: 'prompt' });
  }

  function readMeta() {
    try {
      const value = JSON.parse(localStorage.getItem(META_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (error) { return []; }
  }

  function writeMeta(value) {
    try { localStorage.setItem(META_KEY, JSON.stringify(value)); } catch (error) { /* Cache Storage sigue siendo autoridad materializada */ }
  }

  async function sha256(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function decodeLogo(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('LOGO_DECODE_FAILED'));
      image.src = dataUrl;
    });
  }

  function renderPng(image, size, options) {
    const settings = options || {};
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (settings.background) {
      context.fillStyle = settings.background;
      context.fillRect(0, 0, size, size);
    }
    const maxBox = size * (settings.boxRatio || .84);
    const scale = Math.min(maxBox / image.naturalWidth, maxBox / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
    return new Promise((resolve, reject) => canvas.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('ICON_ENCODE_FAILED')),
      'image/png'
    ));
  }

  async function removeOldBrandResources(cache, keepEntries) {
    const keep = new Set(keepEntries.flatMap(entry => entry.urls || []));
    const requests = await cache.keys();
    await Promise.all(requests.filter(request => !keep.has(request.url)).map(request => cache.delete(request)));
  }

  async function materializeLogo(dataUrl, currentGeneration) {
    const image = await decodeLogo(dataUrl);
    const fullHash = await sha256(dataUrl);
    const hash = fullHash.slice(0, 20);
    const base = scopeUrl();
    const sourceSize = { width: image.naturalWidth, height: image.naturalHeight };
    const quality = Math.max(sourceSize.width, sourceSize.height) >= 512 ? 'sufficient' : 'legacy-upscaled';
    const paths = {
      icon192: `pwa/runtime/icon-${hash}-192.png`,
      icon512: `pwa/runtime/icon-${hash}-512.png`,
      maskable: `pwa/runtime/icon-${hash}-maskable-512.png`,
      apple: `pwa/runtime/icon-${hash}-apple-180.png`,
      favicon: `pwa/runtime/icon-${hash}-64.png`,
    };
    const blobs = {
      icon192: await renderPng(image, 192, { boxRatio: .88 }),
      icon512: await renderPng(image, 512, { boxRatio: .88 }),
      maskable: await renderPng(image, 512, { boxRatio: .68, background: NAVY }),
      apple: await renderPng(image, 180, { boxRatio: .78, background: NAVY }),
      favicon: await renderPng(image, 64, { boxRatio: .86 }),
    };
    if (currentGeneration !== generation) return null;
    const cache = await caches.open(BRAND_CACHE);
    const urls = [];
    for (const key of Object.keys(paths)) {
      const url = new URL(paths[key], base).href;
      urls.push(url);
      await cache.put(url, new Response(blobs[key], {
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public,max-age=31536000,immutable' },
      }));
    }
    const manifest = {
      name: 'BALAM',
      short_name: 'BALAM',
      id: base.pathname,
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: NAVY,
      theme_color: NAVY,
      icons: [
        { src: `./${paths.icon192}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `./${paths.icon512}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `./${paths.maskable}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
    const manifestUrl = new URL(`manifest-${hash}.webmanifest`, base).href;
    await cache.put(manifestUrl, new Response(JSON.stringify(manifest), {
      headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-cache' },
    }));
    urls.push(manifestUrl);
    const entries = [{ hash, urls }, ...readMeta().filter(entry => entry.hash !== hash)].slice(0, 2);
    writeMeta(entries);
    await removeOldBrandResources(cache, entries);
    if (currentGeneration !== generation) return null;
    setLink('manifest', manifestUrl);
    setLink('apple-touch-icon', new URL(paths.apple, base).href, '180x180');
    setLink('icon', new URL(paths.favicon, base).href, '64x64');
    publish({
      ready: true,
      iconSource: 'store.logo',
      iconQuality: quality,
      sourceSize,
      manifestUrl,
      error: '',
    });
    exposeInstallWhenReady();
    return { hash, quality, sourceSize, manifestUrl };
  }

  async function applyBrand() {
    const currentGeneration = ++generation;
    const logo = window.CONFIG && window.CONFIG.get ? window.CONFIG.get('store.logo') : '';
    if (!logo) {
      const base = scopeUrl();
      const manifestUrl = new URL('manifest.webmanifest', base).href;
      setLink('manifest', manifestUrl);
      setLink('apple-touch-icon', new URL('pwa/apple-touch-icon.png', base).href, '180x180');
      setLink('icon', new URL('pwa/favicon-64.png', base).href, '64x64');
      publish({ ready: true, iconSource: 'fallback', iconQuality: 'fallback', sourceSize: null, manifestUrl, error: '' });
      exposeInstallWhenReady();
      return;
    }
    try {
      await materializeLogo(logo, currentGeneration);
    } catch (error) {
      if (currentGeneration !== generation) return;
      const base = scopeUrl();
      const manifestUrl = new URL('manifest.webmanifest', base).href;
      setLink('manifest', manifestUrl);
      setLink('apple-touch-icon', new URL('pwa/apple-touch-icon.png', base).href, '180x180');
      setLink('icon', new URL('pwa/favicon-64.png', base).href, '64x64');
      publish({ ready: true, iconSource: 'fallback', iconQuality: 'invalid-logo', sourceSize: null, manifestUrl, error: error.message || 'LOGO_INVALID' });
      exposeInstallWhenReady();
    }
  }

  function setWaiting(worker) {
    if (!worker) return;
    publish({ updateAvailable: true });
    if (window.UI && window.UI.toast) window.UI.toast('Hay una actualización disponible', 'var(--accent)');
  }

  function observeRegistration(value) {
    registration = value;
    if (registration.waiting) setWaiting(registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaiting(worker);
      });
    });
  }

  function reloadSafety() {
    const activity = window.CORE && window.CORE.activityStatus ? window.CORE.activityStatus() : { active: 0 };
    if (activity.active) return { safe: false, reason: 'Termina la venta o el formulario antes de actualizar.' };
    const queue = window.STORE && window.STORE.queueStatus ? window.STORE.queueStatus() : null;
    if (queue && queue.durability === 'memory') return { safe: false, reason: 'La cola no tiene almacenamiento durable. No cierres esta ventana.' };
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return { safe: false, reason: 'Cierra el diálogo abierto antes de actualizar.' };
    const active = document.activeElement;
    if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) return { safe: false, reason: 'Termina la captura antes de actualizar.' };
    return { safe: true, reason: '' };
  }

  async function activateUpdate() {
    const safety = reloadSafety();
    if (!safety.safe) {
      if (window.UI && window.UI.toast) window.UI.toast(safety.reason, 'var(--danger)');
      return safety;
    }
    const worker = registration && registration.waiting;
    if (!worker) return { safe: false, reason: 'La actualización ya no está pendiente.' };
    worker.postMessage({ type: 'BALAM_SKIP_WAITING' });
    return { safe: true, reason: '' };
  }

  async function requestInstall() {
    if (!installPrompt) return { outcome: 'unavailable' };
    const prompt = installPrompt;
    installPrompt = null;
    publish({ canInstall: false, lastInstallOutcome: 'pending' });
    await prompt.prompt();
    const choice = await prompt.userChoice;
    publish({ lastInstallOutcome: choice && choice.outcome ? choice.outcome : 'unknown' });
    return choice;
  }

  async function init() {
    const protocolOk = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    // H-89 se publica como GitHub Pages project site. No se registra en los
    // arneses históricos que sirven index.html en `/`, ni en file://.
    const deploymentOk = scopeUrl().pathname === '/POS_Balam/';
    if (!protocolOk || !deploymentOk || !('serviceWorker' in navigator) || !('caches' in window) || !crypto.subtle) {
      publish({ supported: false, ready: false, error: 'PWA_UNAVAILABLE' });
      return;
    }
    publish({ supported: true });
    try {
      const value = await navigator.serviceWorker.register(new URL('sw.js', scopeUrl()).href, { scope: scopeUrl().pathname, updateViaCache: 'none' });
      observeRegistration(value);
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('SW_CONTROL_TIMEOUT')), 12000);
          navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      }
      await applyBrand();
      const manualKind = platformInstallKind();
      if (manualKind && !state.standalone) publish({ canInstall: true, installKind: manualKind });
    } catch (error) {
      publish({ supported: false, ready: false, error: error.message || 'PWA_INIT_FAILED' });
    }
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    publish({ canInstall: state.ready && !state.standalone, installKind: 'prompt', lastInstallOutcome: null });
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    publish({ standalone: true, canInstall: false, installKind: null });
  });
  window.addEventListener('configchange', () => { if (state.supported) applyBrand(); });
  window.addEventListener('online', () => { if (registration) registration.update().catch(() => {}); });
  window.addEventListener('focus', () => { if (registration) registration.update().catch(() => {}); });
  setInterval(() => {
    if (registration && navigator.onLine && document.visibilityState === 'visible') registration.update().catch(() => {});
  }, 30 * 60 * 1000);
  navigator.serviceWorker && navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !state.updateAvailable) return;
    reloading = true;
    location.reload();
  });
  if (mediaStandalone) {
    const onStandalone = event => publish({ standalone: event.matches, canInstall: event.matches ? false : state.canInstall });
    if (mediaStandalone.addEventListener) mediaStandalone.addEventListener('change', onStandalone);
    else if (mediaStandalone.addListener) mediaStandalone.addListener(onStandalone);
  }

  function InstallAction({ surface = 'topbar' }) {
    const snapshot = useSnapshot();
    const [instructions, setInstructions] = useState(false);
    if (!snapshot.supported || snapshot.standalone || !snapshot.ready || !snapshot.canInstall) return null;
    const login = surface === 'login';
    const label = 'Instalar BALAM';
    const action = async () => {
      if (snapshot.installKind === 'prompt') { await requestInstall(); return; }
      setInstructions(true);
    };
    const modalText = snapshot.installKind === 'ios'
      ? 'En Safari, toca Compartir y después “Añadir a pantalla de inicio”.'
      : 'En Safari, abre Archivo y selecciona “Añadir al Dock”.';
    return h(React.Fragment, null, [
      h('button', {
        key: 'action', type: 'button', onClick: action,
        className: login
          ? 'mt-5 w-full min-h-11 px-4 rounded-lg inline-flex items-center justify-center gap-2 font-label-sm uppercase tracking-widest text-xs hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          : 'inline-flex items-center justify-center gap-2 min-w-11 h-11 px-3 rounded-lg bg-gold-soft text-gold-text font-label-sm uppercase tracking-widest text-xs hover:opacity-90',
        style: login ? { background: '#131B2E', border: '1px solid #2A3350', color: '#FFE088' } : undefined,
        'aria-label': label,
        'data-testid': login ? 'pwa-login-install-action' : 'pwa-install-action',
      }, [
        h(window.HX.MS, { key: 'i', name: 'download', size: 18 }),
        h('span', { key: 'l', className: login ? '' : 'hidden xl:inline' }, login ? 'Instalar BALAM' : 'Instalar'),
      ]),
      login && snapshot.installKind === 'ios' && h('p', {
        key: 'ios-hint', className: 'mt-2 text-center text-[11px]', style: { color: '#AEB4C5' },
        'data-testid': 'pwa-login-ios-hint',
      }, 'Compartir → Añadir a pantalla de inicio'),
      instructions && h(window.UI.Modal, {
        key: 'instructions', title: 'Instalar BALAM', onClose: () => setInstructions(false), testId: 'pwa-install-instructions',
        footer: h('button', { type: 'button', className: 'h-11 px-5 rounded-lg bg-primary text-on-primary font-semibold', onClick: () => setInstructions(false) }, 'Entendido'),
      }, h('p', { className: 'text-body text-on-surface-variant' }, modalText)),
    ]);
  }

  function Control() {
    const snapshot = useSnapshot();
    if (!snapshot.supported || snapshot.standalone) return null;
    if (!snapshot.updateAvailable) return h(InstallAction, { surface: 'topbar' });
    return h('button', {
      type: 'button', onClick: activateUpdate,
      className: 'inline-flex items-center justify-center gap-2 min-w-11 h-11 px-3 rounded-lg bg-gold-soft text-gold-text font-label-sm uppercase tracking-widest text-xs hover:opacity-90',
      'aria-label': 'Actualizar BALAM', 'data-testid': 'pwa-update-action',
    }, [
      h(window.HX.MS, { key: 'i', name: 'sync', size: 18 }),
      h('span', { key: 'l', className: 'hidden xl:inline' }, 'Actualizar'),
    ]);
  }

  function BrandStatus() {
    const snapshot = useSnapshot();
    if (!snapshot.ready && !snapshot.error) return h('p', { className: 'text-caption text-on-surface-variant mt-3' }, 'Preparando recursos de instalación…');
    if (snapshot.iconQuality === 'legacy-upscaled') return h('p', { className: 'text-caption text-warning mt-3', role: 'status', 'data-testid': 'pwa-logo-quality-warning' },
      `Este logotipo histórico mide ${snapshot.sourceSize.width}×${snapshot.sourceSize.height} px. Los iconos 512 px se generan con pérdida de calidad; sube una fuente de al menos 512 px.`);
    if (snapshot.iconQuality === 'invalid-logo') return h('p', { className: 'text-caption text-warning mt-3', role: 'status' }, 'El logotipo no pudo convertirse; las instalaciones usarán temporalmente el icono fallback de BALAM.');
    if (snapshot.iconSource === 'store.logo') return h('p', { className: 'text-caption text-success mt-3', role: 'status', 'data-testid': 'pwa-logo-ready' },
      `Iconos de instalación listos desde este logotipo (${snapshot.sourceSize.width}×${snapshot.sourceSize.height} px).${snapshot.standalone ? ' Chrome puede conservar el icono instalado anterior hasta aplicar su actualización de identidad.' : ''}`);
    return h('p', { className: 'text-caption text-on-surface-variant mt-3', role: 'status' }, 'Sin logotipo configurado: las instalaciones usan el icono fallback de BALAM.');
  }

  window.PWA = {
    init, applyBrand, activateUpdate, requestInstall, reloadSafety,
    getState: () => state, useSnapshot, InstallAction, Control, BrandStatus,
  };
  init();
})();
