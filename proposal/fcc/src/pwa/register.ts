import './install';

/** Dev never caches Vite source or local credentials. Production requires HTTPS (localhost is allowed). */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(() => console.warn('[FCC] Offline installation unavailable; app remains usable online.'));
  }, { once: true });
}
