import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.jsx';
import './index.css';

// Register Workbox PWA Service Worker with immediate activation & clean auto-reload
let refreshing = false;

if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Reload only when an existing SW controller is replaced by a newer build
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateSW(true);
  },
  onRegisteredSW(swUrl, registration) {
    console.log('[PWA] Workbox Service Worker registered:', swUrl);

    if (registration) {
      // Check for fresh deploys whenever user switches back to the standalone PWA
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {});
        }
      });
    }
  },
  onRegisterError(err) {
    console.warn('[PWA] Service Worker registration failed:', err);
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
