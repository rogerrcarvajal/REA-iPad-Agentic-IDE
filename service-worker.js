const CACHE_NAME = 'rea-ipad-ide-v2';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/styles.css',
  './manifest.json',
  './vendor/lightning-fs.min.js',
  './vendor/isomorphic-git.umd.min.js',
  './vendor/isomorphic-git-http-web.umd.js',
  './vendor/marked.umd.js',
  './vendor/purify.min.js',
  './js/app.js',
  './js/fs-manager.js',
  './js/git-service.js',
  './js/editor-manager.js',
  './js/agent-orchestrator.js',
  './js/ai-provider.js',
  './js/google-auth.js',
  './js/settings.js',
  './js/touch-toolbar.js',
  './js/terminal.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Never cache dynamic API calls
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).catch(() => {
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});
