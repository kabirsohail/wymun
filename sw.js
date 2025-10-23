const CACHE = 'yi-portal-v1.2.0';
const ASSETS = [
  './',
  './index.html',
  './terms.html',
  './assets/css/style.css?v=1.2.0',
  './assets/js/app.js?v=1.2.0',
  './assets/img/yimun-wordmark.svg',
  './invites/',
  './submittedDocuments/',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => k===CACHE?null:caches.delete(k)))));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Cache-first for app shell; network for PDFs
  if (ASSETS.some(a => e.request.url.includes(a))) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
