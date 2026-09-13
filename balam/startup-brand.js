// Presentation only. CONFIG remains the authority; never read legacy commercial storage.
(function () {
  if (window.BALAM_STARTUP) return;
  const fallbackLogo = 'balam/startup-logo.png';
  let cachedLogo = fallbackLogo, confirmed = false;
  const styles = {
    frame: { minHeight: '100dvh', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', boxSizing: 'border-box', background: '#131b2e', color: '#f5f0e5', fontFamily: 'Arial, sans-serif' },
    card: { width: '100%', maxWidth: '420px', textAlign: 'center' },
    image: { display: 'block', width: '128px', height: '128px', objectFit: 'contain', margin: '0 auto 28px', borderRadius: '24px' },
    message: { fontSize: '16px', lineHeight: '1.6', margin: '0 0 24px' },
    progress: { width: '72px', height: '3px', borderRadius: '2px', background: '#ffe088', margin: '24px auto 0' },
  };
  function logo() {
    return window.CONFIG?.ready ? window.CONFIG.get('store.logo') || '' : cachedLogo;
  }
  function refresh() {
    const image = document.querySelector('#balam-startup img');
    if (image) { image.src = logo(); image.style.display = logo() ? 'block' : 'none'; }
    window.dispatchEvent(new Event('balamstartupbrandchange'));
  }
  function mount() {
    if (!document.body || document.getElementById('balam-startup')) return;
    const frame = document.createElement('div'); frame.id = 'balam-startup';
    frame.setAttribute('role', 'status'); frame.setAttribute('aria-live', 'polite');
    Object.assign(frame.style, styles.frame, { position: 'fixed', inset: '0', zIndex: '9999' });
    const card = document.createElement('div'); Object.assign(card.style, styles.card);
    const image = document.createElement('img'); image.alt = 'Logotipo de la empresa'; image.src = logo(); Object.assign(image.style, styles.image);
    const message = document.createElement('p'); message.id = '__bundler_loading'; message.textContent = 'Cargando BALAM…'; Object.assign(message.style, styles.message);
    const progress = document.createElement('div'); progress.setAttribute('aria-hidden', 'true'); Object.assign(progress.style, styles.progress);
    card.append(image, message, progress); frame.append(card); document.body.append(frame);
  }
  function dismiss() {
    if (document.getElementById('root')?.childElementCount) document.getElementById('balam-startup')?.remove();
  }
  window.BALAM_STARTUP = { logo, styles, mount, dismiss };
  mount();
  window.addEventListener('configchange', () => {
    if (window.CONFIG?.ready) { confirmed = true; cachedLogo = window.CONFIG.get('store.logo') || ''; }
    refresh();
  });
  // Reuse only already-materialized presentation bytes, even before a worker controls us.
  (async () => {
    try {
      const entries = JSON.parse(localStorage.getItem('balam_pwa_brand_v1') || '[]');
      const entry = Array.isArray(entries) ? entries[0] : null;
      if (!entry || !/^[a-f0-9]{20}$/.test(entry.hash) || !Array.isArray(entry.urls)) return;
      const expected = new URL('pwa/runtime/icon-' + entry.hash + '-512.png', location.href);
      if (!entry.urls.includes(expected.href)) return;
      const response = await (await caches.open('balam-pwa-brand-v1')).match(expected.href);
      if (!response?.ok || !response.headers.get('Content-Type')?.startsWith('image/')) return;
      const blob = await response.blob();
      if (confirmed || window.CONFIG?.ready) return;
      const url = URL.createObjectURL(blob), image = new Image();
      image.onload = () => { if (!confirmed && !window.CONFIG?.ready) { cachedLogo = url; refresh(); } else URL.revokeObjectURL(url); };
      image.onerror = () => URL.revokeObjectURL(url); image.src = url;
    } catch (_) { /* No usable technical cache: keep the embedded company logo. */ }
  })();
})();
