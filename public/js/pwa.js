/**
 * PWA: registro del service worker + botón de instalación.
 * Se carga al final de index.html.
 */
(function () {
  'use strict';

  var installBtn = document.getElementById('installBtn');
  var deferredPrompt = null;

  // ── Registro del service worker ──────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (err) {
        console.warn('No se pudo registrar el service worker:', err);
      });
    });
  }

  // ── Instalación ──────────────────────────────────────────────
  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function showInstallButton() {
    if (installBtn && !isStandalone()) installBtn.classList.remove('hidden');
  }

  function hideInstallButton() {
    if (installBtn) installBtn.classList.add('hidden');
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredPrompt = event;
    showInstallButton();
  });

  if (installBtn) {
    installBtn.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') hideInstallButton();
        deferredPrompt = null;
      });
    });
  }

  window.addEventListener('appinstalled', function () {
    hideInstallButton();
    deferredPrompt = null;
  });

  if (isStandalone()) hideInstallButton();
})();
