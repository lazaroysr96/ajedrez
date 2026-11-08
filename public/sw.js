/**
 * Service Worker de AJEDREZ
 * - App shell precacheado para abrir sin conexión.
 * - Navegación: red primero, caché como respaldo (offline).
 * - Estáticos propios: stale-while-revalidate.
 * - API: siempre red (nunca se cachean partidas ni chat).
 * - CDN (Supabase, libsodium, Stockfish): stale-while-revalidate.
 */
'use strict';

var CACHE_VERSION = 'ajedrez-v1';
var SHELL_CACHE = CACHE_VERSION + '-shell';
var RUNTIME_CACHE = CACHE_VERSION + '-runtime';

var APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/css/style.css',
  '/js/api-client.js',
  '/js/chess-engine.js',
  '/js/chat-types.js',
  '/js/chat-panel.js',
  '/js/app.js',
  '/js/pwa.js',
  '/icon.jpg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/icon-180.png',
  '/icons/favicon-32.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // addAll falla entero si un recurso falla: añadimos uno a uno.
      return Promise.all(
        APP_SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () {
            // Un recurso ausente no debe impedir la instalación del SW.
          });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key.indexOf(CACHE_VERSION) !== 0;
        }).map(function (key) {
          return caches.delete(key);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // API: sin caché (datos vivos de partidas y chat).
  if (url.origin === self.location.origin && url.pathname.indexOf('/api/') === 0) {
    return;
  }

  // Navegación: red primero, app shell como respaldo offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(function (response) {
          if (response && response.ok) {
            var copy = response.clone();
            caches.open(SHELL_CACHE).then(function (cache) {
              cache.put('/index.html', copy);
            });
          }
          return response;
        })
        .catch(function () {
          return caches.match('/index.html').then(function (cached) {
            return cached || caches.match('/');
          });
        })
    );
    return;
  }

  // Estáticos: stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request));
});

function staleWhileRevalidate(request) {
  return caches.open(RUNTIME_CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request)
        .then(function (response) {
          if (response && (response.ok || response.type === 'opaque')) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(function () {
          return cached;
        });
      return cached || network;
    });
  });
}
